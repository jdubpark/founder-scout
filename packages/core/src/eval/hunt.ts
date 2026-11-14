import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BASE_CONFIG, getParamDef, type Brain, type EvalFlowDTO, type EvalMetricDef, type EvalVariant, type PromoteVariantInput, type RunEvalRoundInput, type SwarmConfig } from "@agentswarm/shared";
import type { EvalDeps, EvalFlowSummary, HuntTrialResult } from "../contracts";
import { ServiceError } from "../contracts";
import { createRng, hashSeed } from "../sim";
import { serializeEvalFlow } from "./lock";
import { writeAtomicFile } from "./persistence";

export const HUNT_YIELD_FLOW_ID = "hunt-yield";
export const HUNT_YIELD_LABEL = "Hunt yield";
const DESCRIPTION = "With the same allowance of runner calls on a simulated web, does the hunt find more strong early founders?";
const DATA_NOTE = "This is a simulated web. It tunes how the hunt spends its calls and compares models on equal footing. It says nothing about real founders.";
const PARAMETERS = ["hunt.pages_per_search", "hunt.stale_after", "hunt.max_depth"] as const;
const METRICS: EvalMetricDef[] = [
  { id: "strong_early_found", label: "Strong early founders found", better: "higher", description: "Distinct runner-reported founders with hidden quality at least 0.6 and true stage at or before seed, found in one simulated world over the trial's days. Every variant has the same turns and wave size, so the same allowance of calls." },
  { id: "late_found", label: "Late-stage founders found", better: "lower", description: "Share of runner-reported people whose true company stage is past the configured latest stage." },
  { id: "weak_found", label: "Weak founders found", better: "lower", description: "Share of runner-reported people with hidden founder quality under 0.4." },
  { id: "planted_failed", label: "Planted pages failed", better: "lower", description: "Planted pages a runner fell for, per planted page read." },
  { id: "strong_early_per_100_calls", label: "Strong early founders per 100 runner calls", better: "higher", description: "How much each call found. Reported, not the goal: a hunt that stops reading early scores well here and finds fewer people." },
  { id: "calls", label: "Runner calls", better: "lower", description: "Runner model calls used by one case, out of the same allowance for every variant. Reported, not held." },
];
const REPORT_METRICS = ["found_people", "kept_people"] as const;
const SEEDS = [17, 83, 191, 307, 419, 557, 683, 809, 929, 1049, 1181, 1301, 1427, 1543, 1667, 1783];
/** What the loop climbs: a count, because every variant has the same allowance of calls. A rate for each call would reward a hunt that stops early. */
const HEADLINE = "strong_early_found";
/** Days in one trial, and what a simulated trial may pretend to spend: enough that the settings, not the money, decide what it reads. */
const TRIAL_DAYS = 3;
const SIM_TRIAL_BUDGET_USD = 40 * TRIAL_DAYS;
/**
 * The least a live baseline may be given: a dollar for each world. One day of one world is
 * about four navigator turns and up to forty-eight runner calls, which cost about $0.25 to
 * $0.30 on the default models when measured on 2026-11-13.
 */
const LIVE_BASELINE_MIN_USD = SEEDS.length;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type Metrics = Record<string, number>;
interface CaseResult { id: string; seed: number; metrics: Metrics; result: HuntTrialResult }
interface Variant { id: string; round: number; description: string; rationale: string; status: "baseline" | "kept" | "reverted"; config: SwarmConfig; createdAt: string; cases: CaseResult[] }
interface State { baselineConfig: SwarmConfig; variants: Variant[]; bestVariant: string; currentRound: number; tried: string[]; updatedAt: string; lastBrain: Brain; noiseFloor: number }

export interface HuntEvalOptions {
  decideCandidate(current: Record<string, number>, candidate: Record<string, number>, floors: Readonly<Record<string, number>>, complete: boolean, baseline?: Record<string, number>, goal?: { target: string; hold: readonly string[]; labels?: Readonly<Record<string, string>> }): { keep: boolean; rationale: string; rule: string };
  propose?: (input: { currentConfig: SwarmConfig; trainIds: string[]; tried: string[]; evaluate(config: SwarmConfig): Promise<Metrics> }) => Promise<{ key: string; description: string; config: SwarmConfig; train: Metrics } | null>;
}

const configPath = (root: string, variant: Variant) => path.join(root, `${variant.id}.json`);
const reportPath = (root: string) => path.join(root, "_state.json");
function stageRank(stage: string): number {
  const normalized = stage.toLocaleLowerCase().replace(/[_-]+/g, " ").trim();
  if (normalized === "pre seed") return 0;
  if (normalized === "seed") return 1;
  if (/^series [a-z]$/.test(normalized)) return 2 + normalized.charCodeAt(normalized.length - 1) - 97;
  return 0;
}
function latestStageRank(config: SwarmConfig): number {
  return stageRank(String(config.params["hunt.latest_stage"] ?? "seed"));
}
function caseMetrics(result: HuntTrialResult, config: SwarmConfig): Metrics {
  const people = result.found;
  const unique = [...new Map(people.map((person) => [person.simFounderId, person])).values()];
  const isEarly = (person: typeof unique[number]) => stageRank(person.stage) <= 1;
  const strongEarly = unique.filter((person) => person.quality >= 0.6 && isEarly(person)).length;
  const calls = result.runnerCalls;
  const per100 = calls > 0 ? (strongEarly / calls) * 100 : 0;
  const latest = latestStageRank(config);
  return {
    strong_early_found: strongEarly,
    strong_early_per_100_calls: per100,
    late_found: unique.length ? unique.filter((person) => stageRank(person.stage) > latest).length / unique.length : 0,
    weak_found: unique.length ? unique.filter((person) => person.quality < 0.4).length / unique.length : 0,
    planted_failed: result.plantedRead ? result.plantedFailed / result.plantedRead : 0,
    calls,
    found_people: unique.length,
    kept_people: new Set(result.kept.map((person) => person.simFounderId)).size,
  };
}
function means(rows: readonly CaseResult[]): Metrics {
  const ids = [...METRICS.map((metric) => metric.id), ...REPORT_METRICS];
  return Object.fromEntries(ids.map((id) => [id, round3(avg(rows.map((row) => row.metrics[id] ?? 0)))]));
}
/**
 * How far the mean of these values would move if other worlds had been drawn: 1.96 standard
 * errors, from a bootstrap over the worlds. A simulated trial is repeatable, so which worlds were
 * drawn is the only noise there is.
 */
function bootstrapNoise(values: readonly number[], seed: number): number {
  if (values.length < 2) return 0;
  const rng = createRng(hashSeed(seed, "hunt-yield", "bootstrap"));
  const draws = Array.from({ length: 1000 }, () => avg(Array.from({ length: values.length }, () => values[Math.floor(rng() * values.length)]!)));
  const center = avg(draws);
  return 1.96 * Math.sqrt(avg(draws.map((value) => (value - center) ** 2)));
}

/** What the keep rule holds steady. Runner calls are reported and not held: the headline is already for each call, and the turns and wave size that cap them are the same for every variant. */
const HOLD = ["late_found", "weak_found", "planted_failed"] as const;

/**
 * The noise floor of each metric for one comparison. A candidate and the config it would replace
 * are measured on the same worlds, so the floor is the spread of the world-by-world differences,
 * not of either mean. A world missing from either side is left out.
 */
function pairedFloors(current: readonly CaseResult[], candidate: readonly CaseResult[]): Record<string, number> {
  const before = new Map(current.map((row) => [row.id, row]));
  const pairs = candidate.flatMap((row) => { const other = before.get(row.id); return other ? [{ row, other }] : []; });
  return Object.fromEntries([HEADLINE, ...HOLD].map((metric) => [
    metric,
    bootstrapNoise(pairs.map(({ row, other }) => (row.metrics[metric] ?? 0) - (other.metrics[metric] ?? 0)), textSeedOf(metric)),
  ]));
}
const textSeedOf = (text: string): number => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
function bootstrapInterval(values: readonly number[], seed: number): [number, number] | null {
  if (values.length === 0) return null;
  if (values.length === 1) return [values[0]!, values[0]!];
  const rng = createRng(hashSeed(seed, "hunt-yield", "interval"));
  const draws = Array.from({ length: 2000 }, () => avg(Array.from({ length: values.length }, () => values[Math.floor(rng() * values.length)]!))).sort((a, b) => a - b);
  return [draws[Math.floor((draws.length - 1) * 0.025)]!, draws[Math.ceil((draws.length - 1) * 0.975)]!];
}
function candidates(config: SwarmConfig, tried: string[]): Array<{ key: string; description: string; config: SwarmConfig }> {
  const result: Array<{ key: string; description: string; config: SwarmConfig }> = [];
  for (const key of PARAMETERS) {
    const definition = getParamDef(key);
    if (!definition?.tunable) continue;
    const current = Number(config.params[key] ?? definition.default);
    const step = definition.step ?? 1;
    for (const direction of [-1, 1]) {
      const value = Math.min(definition.max ?? Infinity, Math.max(definition.min ?? -Infinity, current + direction * step));
      const proposalKey = `${key}:${value}`;
      if (value === current || tried.includes(proposalKey)) continue;
      const next = clone(config);
      next.params[key] = value;
      result.push({ key: proposalKey, description: `${key} ${current} → ${value}`, config: next });
    }
  }
  return result;
}
function summarize(variants: readonly EvalVariant[], state: State | null): EvalFlowSummary {
  const baseline = variants.find((variant) => variant.id === "baseline");
  const best = variants.find((variant) => variant.id === state?.bestVariant);
  const baselineRows = state?.variants.find((variant) => variant.id === "baseline")?.cases ?? [];
  const baselineAll = baselineRows.length ? avg(baselineRows.map((row) => row.metrics[HEADLINE] ?? 0)) : null;
  return { id: HUNT_YIELD_FLOW_ID, label: HUNT_YIELD_LABEL, description: DESCRIPTION, headlineMetric: HEADLINE, baseline: baselineAll, best: best?.test[HEADLINE] ?? null, rounds: state?.currentRound ?? 0, updatedAt: state?.updatedAt ?? null, realData: false };
}

export function createHuntEval(deps: EvalDeps, options: HuntEvalOptions) {
  const root = path.join(deps.flowsDir, HUNT_YIELD_FLOW_ID);
  const lockKey = path.resolve(root);
  const stateFile = reportPath(root);
  const readState = async (): Promise<State | null> => {
    try { return JSON.parse(await readFile(stateFile, "utf8")) as State; } catch { return null; }
  };
  const writeState = (state: State) => writeAtomicFile(stateFile, JSON.stringify(state, null, 2) + "\n");
  const evaluate = async (config: SwarmConfig, ids: readonly string[], brain: Brain, budgetUsd: number): Promise<CaseResult[]> => {
    if (!deps.huntTrial) throw new ServiceError(503, "Hunt yield needs a service trial runner.");
    return Promise.all(ids.map(async (id) => {
      const seed = Number(id.slice(5));
      // A simulated call costs nothing real, but it is priced as its model would be so that
      // budgets behave. The trial must not be cut short by that pretend money: with the caller's
      // few dollars split over sixteen worlds and three days, the hunt could not afford one
      // navigator turn and every variant scored zero. Real money still limits a live measurement.
      const trialBudgetUsd = brain === "sim" ? SIM_TRIAL_BUDGET_USD : budgetUsd / ids.length;
      const result = await deps.huntTrial!({ seed, days: TRIAL_DAYS, config, brain, budgetUsd: trialBudgetUsd });
      return { id, seed, metrics: caseMetrics(result, config), result };
    }));
  };
  const dto = (state: State | null): EvalFlowDTO => {
    const variants: EvalVariant[] = (state?.variants ?? []).map((variant) => {
      const test = variant.cases.filter((row) => Number(row.id.slice(5)) >= 929);
      const train = variant.cases.filter((row) => Number(row.id.slice(5)) < 929);
      const testValues = test.map((row) => row.metrics[HEADLINE] ?? 0);
      const interval = bootstrapInterval(testValues, hashSeed(929, variant.id));
      const previous = state!.variants.filter((item) => item.round < variant.round && item.status !== "reverted").sort((a, b) => b.round - a.round)[0];
      const changes = variant.id === "baseline" ? [] : PARAMETERS.filter((key) => previous?.config.params[key] !== variant.config.params[key]).map((key) => `${key}: ${previous?.config.params[key]} → ${variant.config.params[key]}`);
      return { id: variant.id, round: variant.round, description: variant.description, rationale: variant.rationale, status: variant.id === state!.bestVariant && variant.round > 0 ? "champion" : variant.status, train: means(train), test: means(test), testInterval: interval, costUsd: round3(avg(test.map((row) => row.result.costUsd))), config: variant.config, changes, createdAt: variant.createdAt };
    });
    const summary = summarize(variants, state);
    const baselineCases = state?.variants.find((variant) => variant.id === "baseline")?.cases ?? [];
    const baselineValues = baselineCases.map((row) => row.metrics[HEADLINE] ?? 0);
    const baselineRange = bootstrapInterval(baselineValues, 17);
    const baselineMean = avg(baselineValues);
    const positiveWorlds = baselineValues.filter((value) => value > 0).length;
    const metricLine = (values: Metrics) => [
      `strong early found=${(values[HEADLINE] ?? 0).toFixed(2)}`,
      `per 100 calls=${(values.strong_early_per_100_calls ?? 0).toFixed(2)}`,
      `late=${(values.late_found ?? 0).toFixed(3)}`,
      `weak=${(values.weak_found ?? 0).toFixed(3)}`,
      `planted failed=${(values.planted_failed ?? 0).toFixed(3)}`,
      `calls=${(values.calls ?? 0).toFixed(1)}`,
      `found=${(values.found_people ?? 0).toFixed(1)}`,
      `fit kept=${(values.kept_people ?? 0).toFixed(1)}`,
    ].join(", ");
    const latestVariant = state?.lastBrain === "live" ? "baseline" : state?.bestVariant ?? "baseline";
    const latest = state?.variants.find((variant) => variant.id === latestVariant)?.cases ?? [];
    const modelNames = [...new Set(latest.flatMap((row) => Object.keys(row.result.models)))].sort();
    const table = modelNames.length ? `\n\nRunner models:\n${modelNames.map((model) => {
      const samples = latest.flatMap((row) => row.result.models[model] ? [row.result.models[model]!] : []);
      return `- ${model}: ${round3(avg(samples.map((item) => item.pages)))} pages, ${round3(avg(samples.map((item) => item.peopleKept)))} kept, ${round3(avg(samples.map((item) => item.peopleRefused)))} refused, ${round3(avg(samples.map((item) => item.plantedFailed)))} planted failed, ${Math.round(avg(samples.flatMap((item) => item.medianLatencyMs === null ? [] : [item.medianLatencyMs])))} ms median latency`;
    }).join("\n")}` : "";
    const baseline = variants.find((item) => item.id === "baseline");
    const roundLines = variants.filter((item) => item.round > 0).map((item) =>
      `Round ${item.round} proposed ${item.description}; train: ${metricLine(item.train)}; held-out: ${metricLine(item.test)}; ${item.status === "champion" ? "kept as champion" : item.status}.`);
    const narrative = state
      ? `Baseline strong early founders found in a world: ${baselineMean.toFixed(3)} across ${baselineValues.length} worlds; 95% bootstrap range [${baselineRange?.[0].toFixed(3) ?? "n/a"}, ${baselineRange?.[1].toFixed(3) ?? "n/a"}]; ${positiveWorlds}/${baselineValues.length} worlds above zero. Noise floor: ${(state.noiseFloor ?? 0).toFixed(3)} (1.96 standard errors of the held-out mean, from a bootstrap over worlds; a change is compared world by world, so its own floor is the spread of those differences). Baseline fit-screener counts: ${metricLine(means(baselineCases))}. Best held-out yield: ${summary.best?.toFixed(3) ?? "not measured"}.${roundLines.length ? `\n\n${roundLines.join("\n")}` : ""}${table}`
      : "";
    return { ...summary, headlineMetric: HEADLINE, baseline: baselineValues.length ? baselineMean : null, metrics: METRICS, goal: { target: HEADLINE, direction: "higher", hold: [...HOLD] }, cases: { train: 8, test: 8, reps: 1 }, noiseFloor: state?.noiseFloor ?? null, dataNote: DATA_NOTE, variants, bestVariant: state?.bestVariant ?? null, promotedVariant: null, narrative, ready: true, callsModels: state?.lastBrain === "live" };
  };
  const allCases = SEEDS.map((seed) => ({ id: `case-${seed}` }));
  const getState = async () => readState();
  return {
    async listFlows() {
      return serializeEvalFlow(lockKey, async () => {
        const state = await getState();
        return [summarize(dto(state).variants, state)];
      });
    },
    async getFlow(id: string) {
      if (id !== HUNT_YIELD_FLOW_ID) throw new ServiceError(404, `Unknown eval flow: ${id}`);
      return serializeEvalFlow(lockKey, async () => dto(await getState()));
    },
    async runRounds(id: string, input: RunEvalRoundInput = {}) {
      if (id !== HUNT_YIELD_FLOW_ID) throw new ServiceError(404, `Unknown eval flow: ${id}`);
      const brain = input.brain ?? "sim";
      const rounds = Math.max(0, Math.floor(input.rounds ?? 1));
      if (brain === "live" && rounds > 0) throw new ServiceError(409, "Automatic eval rounds on real models need a spending approval step that does not exist yet. Run a baseline without automatic rounds to measure it.");
      const budgetUsd = input.budgetUsd ?? 3;
      if (brain === "live" && budgetUsd < LIVE_BASELINE_MIN_USD) {
        throw new ServiceError(409, "A live baseline has real models read " + SEEDS.length + " simulated worlds for " + TRIAL_DAYS + " days each. Give it a budget of at least " + LIVE_BASELINE_MIN_USD + " dollars. With less the hunts would be cut short, and the result would say nothing.");
      }
      return serializeEvalFlow(lockKey, async () => {
        await mkdir(root, { recursive: true });
        let state = await getState();
        if (!state) state = { baselineConfig: clone(BASE_CONFIG), variants: [], bestVariant: "baseline", currentRound: 0, tried: [], updatedAt: new Date().toISOString(), lastBrain: brain, noiseFloor: 0 };
        const baselineConfig = state.variants.find((variant) => variant.id === "baseline")?.config ?? state.baselineConfig;
        const savedBaseline = state.variants.find((variant) => variant.id === "baseline");
        const baselineCases = brain !== state.lastBrain || !savedBaseline
          ? await evaluate(baselineConfig, allCases.map((item) => item.id), brain, budgetUsd)
          : savedBaseline.cases;
        if (!savedBaseline) state.variants.push({ id: "baseline", round: 0, description: "Baseline configuration", rationale: "Starting configuration.", status: "baseline", config: baselineConfig, createdAt: new Date().toISOString(), cases: baselineCases });
        else if (brain !== state.lastBrain) savedBaseline.cases = baselineCases;
        const trainIds = allCases.slice(0, 8).map((item) => item.id);
        const testRows = baselineCases.filter((row) => Number(row.id.slice(5)) >= 929);
        state.noiseFloor = bootstrapNoise(testRows.map((row) => row.metrics[HEADLINE] ?? 0), 929);
        state.lastBrain = brain;
        for (let n = 0; n < rounds; n += 1) {
          const current = state.variants.find((variant) => variant.id === state!.bestVariant) ?? state.variants[0]!;
          const evaluateTrain = async (config: SwarmConfig) => means(await evaluate(config, trainIds, "sim", budgetUsd));
          let proposal: { key: string; description: string; config: SwarmConfig; train: Metrics } | null = null;
          if (options.propose) proposal = await options.propose({ currentConfig: current.config, trainIds, tried: state.tried, evaluate: evaluateTrain });
          else {
            for (const candidate of candidates(current.config, state.tried)) {
              const train = await evaluateTrain(candidate.config);
              if (!proposal || (train[HEADLINE] ?? 0) > (proposal.train[HEADLINE] ?? 0)) proposal = { ...candidate, train };
            }
          }
          if (!proposal) break;
          const rows = await evaluate(proposal.config, allCases.map((item) => item.id), "sim", budgetUsd);
          const heldOut = (cases: readonly CaseResult[]) => cases.filter((row) => Number(row.id.slice(5)) >= 929);
          const currentTest = means(heldOut(current.cases));
          const candidateTest = means(heldOut(rows));
          const baselineTest = means(heldOut(baselineCases));
          const floors = pairedFloors(heldOut(current.cases), heldOut(rows));
          const decision = options.decideCandidate(currentTest, candidateTest, floors, rows.length === 16, baselineTest, {
            target: HEADLINE,
            hold: HOLD,
            labels: { [HEADLINE]: "strong early founders found", late_found: "late-found share", weak_found: "weak-found share", planted_failed: "planted-page failure rate" },
          });
          const kept = decision.keep;
          const round = state.currentRound + 1;
          const id = `v${round}`;
          const config = { ...proposal.config, id: `cfg_hunt-yield_${id}`, label: `Round ${round}: ${proposal.description}` };
          state.variants.push({ id, round, description: proposal.description, rationale: decision.rationale, status: kept ? "kept" : "reverted", config, createdAt: new Date().toISOString(), cases: rows });
          state.tried.push(proposal.key);
          state.currentRound = round;
          if (kept) state.bestVariant = id;
          state.updatedAt = new Date().toISOString();
          state.lastBrain = "sim";
          await writeState(state);
        }
        state.updatedAt = new Date().toISOString();
        await writeState(state);
        const result = dto(state);
        result.spentUsd = brain === "live" ? round3(avg(baselineCases.map((row) => row.result.costUsd)) * baselineCases.length) : 0;
        return result;
      });
    },
    async variantConfig(id: string, input: PromoteVariantInput) {
      if (id !== HUNT_YIELD_FLOW_ID) throw new ServiceError(404, `Unknown eval flow: ${id}`);
      const state = await getState();
      const variant = state?.variants.find((item) => item.id === input.variant);
      if (!variant) throw new ServiceError(404, "Unknown hunt-yield variant.");
      return { ...variant.config, id: `cfg_hunt-yield_${input.variant}_${input.swarmId}`, label: `hunt-yield ${input.variant}` };
    },
  };
}
