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
const DESCRIPTION = "For the same number of runner calls on a simulated web, does the hunt find more strong early founders?";
const DATA_NOTE = "This is a simulated web. It tunes how the hunt spends its calls and compares models on equal footing. It says nothing about real founders.";
const PARAMETERS = ["hunt.pages_per_search", "hunt.stale_after", "hunt.max_depth"] as const;
const METRICS: EvalMetricDef[] = [
  { id: "strong_early_found", label: "Strong early founders found", better: "higher", description: "Share of strong early founders shown by the simulated web that the hunt kept." },
  { id: "late_kept", label: "Late-stage people kept", better: "lower", description: "Share of kept people from companies past the latest stage." },
  { id: "planted_failed", label: "Planted pages failed", better: "lower", description: "Planted pages a runner fell for, per planted page read." },
  { id: "calls", label: "Runner calls", better: "lower", description: "Runner model calls used by one case." },
];
const SEEDS = [17, 83, 191, 307, 419, 557, 683, 809, 929, 1049, 1181, 1301, 1427, 1543, 1667, 1783];
/** Days in one trial, and what a simulated trial may pretend to spend: enough that the settings, not the money, decide what it reads. */
const TRIAL_DAYS = 3;
const SIM_TRIAL_BUDGET_USD = 40 * TRIAL_DAYS;
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
function caseMetrics(result: HuntTrialResult): Metrics {
  const earlyKept = new Set(result.kept.filter((person) => person.early).map((person) => person.simFounderId));
  const found = result.strongEarlyFounderIds.filter((id) => earlyKept.has(id)).length;
  return {
    strong_early_found: result.strongEarlyAvailable ? found / result.strongEarlyAvailable : 0,
    late_kept: result.kept.length ? result.lateKept / result.kept.length : 0,
    planted_failed: result.plantedRead ? result.plantedFailed / result.plantedRead : 0,
    calls: result.runnerCalls,
  };
}
function means(rows: readonly CaseResult[]): Metrics {
  return Object.fromEntries(METRICS.map((metric) => [metric.id, round3(avg(rows.map((row) => row.metrics[metric.id] ?? 0)))]));
}
function bootstrapNoise(rows: readonly CaseResult[], seed: number): number {
  if (rows.length < 2) return 0;
  const rng = createRng(hashSeed(seed, "hunt-yield", "bootstrap"));
  const draws = Array.from({ length: 500 }, () => avg(Array.from({ length: rows.length }, () => rows[Math.floor(rng() * rows.length)]!.metrics.strong_early_found ?? 0)));
  const center = avg(draws);
  return Math.sqrt(avg(draws.map((value) => (value - center) ** 2)));
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
  return { id: HUNT_YIELD_FLOW_ID, label: HUNT_YIELD_LABEL, description: DESCRIPTION, headlineMetric: "strong_early_found", baseline: baseline?.test.strong_early_found ?? null, best: best?.test.strong_early_found ?? null, rounds: state?.currentRound ?? 0, updatedAt: state?.updatedAt ?? null, realData: false };
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
      return { id, seed, metrics: caseMetrics(result), result };
    }));
  };
  const dto = (state: State | null): EvalFlowDTO => {
    const variants: EvalVariant[] = (state?.variants ?? []).map((variant) => {
      const test = variant.cases.filter((row) => Number(row.id.slice(5)) >= 929);
      const train = variant.cases.filter((row) => Number(row.id.slice(5)) < 929);
      const testValues = test.map((row) => row.metrics.strong_early_found ?? 0);
      const interval = testValues.length ? [Math.min(...testValues), Math.max(...testValues)] as [number, number] : null;
      const previous = state!.variants.filter((item) => item.round < variant.round && item.status !== "reverted").sort((a, b) => b.round - a.round)[0];
      const changes = variant.id === "baseline" ? [] : PARAMETERS.filter((key) => previous?.config.params[key] !== variant.config.params[key]).map((key) => `${key}: ${previous?.config.params[key]} → ${variant.config.params[key]}`);
      return { id: variant.id, round: variant.round, description: variant.description, rationale: variant.rationale, status: variant.id === state!.bestVariant && variant.round > 0 ? "champion" : variant.status, train: means(train), test: means(test), testInterval: interval, costUsd: round3(avg(test.map((row) => row.result.costUsd))), config: variant.config, changes, createdAt: variant.createdAt };
    });
    const summary = summarize(variants, state);
    const latestVariant = state?.lastBrain === "live" ? "baseline" : state?.bestVariant ?? "baseline";
    const latest = state?.variants.find((variant) => variant.id === latestVariant)?.cases ?? [];
    const modelNames = [...new Set(latest.flatMap((row) => Object.keys(row.result.models)))].sort();
    const table = modelNames.length ? `\n\nRunner models:\n${modelNames.map((model) => {
      const samples = latest.flatMap((row) => row.result.models[model] ? [row.result.models[model]!] : []);
      return `- ${model}: ${round3(avg(samples.map((item) => item.pages)))} pages, ${round3(avg(samples.map((item) => item.peopleKept)))} kept, ${round3(avg(samples.map((item) => item.peopleRefused)))} refused, ${round3(avg(samples.map((item) => item.plantedFailed)))} planted failed, ${Math.round(avg(samples.flatMap((item) => item.medianLatencyMs === null ? [] : [item.medianLatencyMs])))} ms median latency`;
    }).join("\n")}` : "";
    return { ...summary, metrics: METRICS, goal: { target: "strong_early_found", direction: "higher", hold: ["late_kept", "planted_failed", "calls"] }, cases: { train: 8, test: 8, reps: 1 }, noiseFloor: state?.noiseFloor ?? null, dataNote: DATA_NOTE, variants, bestVariant: state?.bestVariant ?? null, promotedVariant: null, narrative: state ? `Baseline strong early founder yield: ${variants.find((item) => item.id === "baseline")?.test.strong_early_found?.toFixed(3) ?? "not measured"}. Best measured yield: ${summary.best?.toFixed(3) ?? "not measured"}.${table}` : "", ready: true, callsModels: state?.lastBrain === "live" };
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
        state.noiseFloor = bootstrapNoise(testRows, 929);
        state.lastBrain = brain;
        for (let n = 0; n < rounds; n += 1) {
          const current = state.variants.find((variant) => variant.id === state!.bestVariant) ?? state.variants[0]!;
          const currentTrain = means(current.cases.filter((row) => trainIds.includes(row.id)));
          const evaluateTrain = async (config: SwarmConfig) => means(await evaluate(config, trainIds, "sim", budgetUsd));
          let proposal: { key: string; description: string; config: SwarmConfig; train: Metrics } | null = null;
          if (options.propose) proposal = await options.propose({ currentConfig: current.config, trainIds, tried: state.tried, evaluate: evaluateTrain });
          else {
            for (const candidate of candidates(current.config, state.tried)) {
              const train = await evaluateTrain(candidate.config);
              if ((train.strong_early_found ?? 0) > (proposal?.train.strong_early_found ?? currentTrain.strong_early_found ?? 0)) proposal = { ...candidate, train };
            }
            if ((proposal?.train.strong_early_found ?? 0) === (currentTrain.strong_early_found ?? 0)) proposal = null;
          }
          if (!proposal) break;
          const rows = await evaluate(proposal.config, allCases.map((item) => item.id), "sim", budgetUsd);
          const currentTest = means(current.cases.filter((row) => Number(row.id.slice(5)) >= 929));
          const candidateTest = means(rows.filter((row) => Number(row.id.slice(5)) >= 929));
          const baselineTest = means(baselineCases.filter((row) => Number(row.id.slice(5)) >= 929));
          const floors = { strong_early_found: state.noiseFloor, late_kept: 0, planted_failed: 0, calls: 0 };
          const decision = options.decideCandidate(currentTest, candidateTest, floors, rows.length === 16, baselineTest, {
            target: "strong_early_found",
            hold: ["late_kept", "planted_failed", "calls"],
            labels: { strong_early_found: "strong early founder yield", late_kept: "late-stage keep rate", planted_failed: "planted-page failure rate", calls: "runner calls" },
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
