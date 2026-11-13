import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BASE_CONFIG,
  EMPTY_STEERING,
  MODELS,
  PARAM_DEFS,
  effectiveRoute,
  effectiveThresholds,
  effectiveWeights,
  getJob,
  scoreFounder,
  type Brain,
  type EvalFlowDTO,
  type EvalFlowSummary,
  type EvalMetricDef,
  type EvalVariant,
  type ModelRoute,
  type PromoteVariantInput,
  type RunEvalRoundInput,
  type SwarmConfig,
} from "@agentswarm/shared";
import type { EvalDeps, EvalService } from "../contracts";
import { ServiceError } from "../contracts";
import type { SimWorld } from "../contracts";
import type { SimFounder } from "../contracts";
import { createRng, hashSeed } from "../sim";
import {
  DEFAULT_COHORT_SIZE,
  DEFAULT_EVAL_CASES,
  DEFAULT_REPS,
  EVAL_WORLD_SEED,
  generateEvalCases,
  runEvalCase,
  type EvalCase,
  type EvalCaseRun,
} from "./runner";
import { ndcg5, pedigreeLeak, precision5, rankMatch, recall5, top5Match } from "./metrics";
import { createPartnerEval, PARTNER_CALLS_FLOW_ID } from "./partner";
import { createPastEval, PAST_FOUNDERS_FLOW_ID } from "./past";
import { serializeEvalFlow } from "./lock";
import { appendJsonLine, readJsonLines, writeAtomicFile } from "./persistence";

export { ndcg5, pedigreeLeak, precision5, rankMatch, recall5, top5Match };
export { DEFAULT_EVAL_CASES, DEFAULT_COHORT_SIZE, DEFAULT_REPS, EVAL_WORLD_SEED, generateEvalCases, runEvalCase } from "./runner";
export type { EvalCase, EvalScoreFn } from "./runner";

export const ASSESS_RANKING_ID = "assess-ranking";
export const ASSESS_RANKING_LABEL = "Ranking quality";
export { PARTNER_CALLS_FLOW_ID };
export { PAST_FOUNDERS_FLOW_ID };
export { partnerAgreement, partnerSplit } from "./partner";
export const SYNTHETIC_DATA_NOTE =
  "Synthetic founders with known outcomes. This shows the loop works; it says nothing yet about real founders.";

const FLOW_DESCRIPTION = "Given the same evidence, does the configuration rank founders with stronger hidden quality above the rest?";
const GOAL = { target: "rank_match", direction: "higher", hold: ["pedigree_leak", "cost_usd"] } as const;
const METRICS: Array<EvalMetricDef & { kind: string }> = [
  { id: "rank_match", kind: "quality", label: "Ranking quality", better: "higher", description: "How closely the swarm's ranking matches the founders' true strength. 1 is a perfect match, 0 is no better than chance." },
  { id: "top5_match", kind: "quality", label: "Top five match", better: "higher", description: "The share of the five truly strongest founders that the pipeline ranks in its top five." },
  { id: "precision5", kind: "quality", label: "Hits in top 5", better: "higher", description: "The share of the first five founders with positive outcomes." },
  { id: "pedigree_leak", kind: "fairness", label: "Pedigree leak", better: "lower", description: "Absolute correlation between score residuals after accounting for true quality and school or employer prestige. Zero is ideal." },
  { id: "cost_usd", kind: "performance", label: "Cost", better: "lower", description: "Total known cost of the seven job calls for one case and repetition; unpriced calls count as zero and are recorded separately." },
];
const PERF_FIELDS = ["input_tokens", "output_tokens", "cost_usd", "unpriced_calls"];

export interface EvalOptions {
  /** Smaller deterministic benchmark for focused tests or local probes. */
  cohortCount?: number;
  cohortSize?: number;
  repetitions?: number;
  /** Allows an explicitly selected starting config, useful for controlled evaluation. */
  initialConfig?: SwarmConfig;
  /** Optional ranking-score override for oracle/null controls and controlled scorer experiments. */
  scoreFn?: (founder: SimFounder, config: SwarmConfig) => number | null;
  /** Optional proposer override for controlled experiments. It receives train ids only. */
  propose?: typeof proposeTrainChange;
  /** The model that judges past cases. null or absent uses the analysts' own routes. */
  pastJudge?: ModelRoute | null;
}

interface TriedChange {
  key: string;
  kept: boolean;
}

interface EvalState {
  current_round: number;
  reps: number;
  goal: typeof GOAL;
  best: { round: number; test_score: number };
  train_ids: string[];
  test_ids: string[];
  metrics: Array<{ id: string; kind: string; label: string; better: "higher" | "lower" }>;
  perf_fields: string[];
  tried: TriedChange[];
  noise_floor?: number | null;
  metric_noise_floors?: Record<string, number>;
  case_definitions?: EvalCase[];
  proposal_train_ids?: string[];
  variant_created_at?: Record<string, string>;
  variant_brains?: Record<string, Brain>;
  updated_at?: string;
  proposer_exhausted?: boolean;
}

interface ResultRow {
  prompt_id: string;
  rep: number;
  prompt: string;
  tags: string[];
  grade: Record<string, number>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  cost_usd: number;
  unpriced_calls: number;
  status: "ok";
}

function modelPipelineKey(config: SwarmConfig): string {
  const params = Object.fromEntries(Object.entries(config.params)
    .filter(([key]) => !key.startsWith("weights."))
    .sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify({ params, routes: config.routes, promptVariants: config.promptVariants });
}

function evaluationRow(
  evalCase: EvalCase,
  run: EvalCaseRun,
  config: SwarmConfig,
  world: SimWorld,
  scoreFn: EvalOptions["scoreFn"],
): ResultRow {
  const weights = effectiveWeights(EMPTY_STEERING, config);
  const thresholds = effectiveThresholds(EMPTY_STEERING, config);
  const scored = run.rows.map((row) => {
    const founder = world.founder(row.founderId)!;
    const scoring = scoreFounder({
      judgments: row.judgments.map((judgment) => ({
        dimension: judgment.dimension,
        level: judgment.level,
        confidence: judgment.confidence,
      })),
      weights,
      thresholds,
      fit: 1,
    });
    return {
      founder,
      outcome: row.outcome,
      score: scoreFn ? scoreFn(founder, config) : scoring.composite,
    };
  });
  const ranked = [...scored].sort((left, right) =>
    (right.score ?? 0) - (left.score ?? 0) || left.founder.simId.localeCompare(right.founder.simId));
  const scores = scored.map((row) => row.score ?? 0);
  const qualities = scored.map((row) => row.founder.quality);
  const outcomes = ranked.map((row) => row.outcome);
  return {
    prompt_id: evalCase.id,
    rep: 1,
    prompt: evalCase.prompt,
    tags: evalCase.tags,
    grade: {
      rank_match: rankMatch(scores, qualities),
      top5_match: top5Match(scores, qualities),
      precision5: precision5(outcomes),
      pedigree_leak: pedigreeLeak(scores, qualities, scored.map((row) => row.founder.pedigree)),
      cost_usd: run.costUsd,
      ndcg5: ndcg5(outcomes),
      recall5: recall5(outcomes),
    },
    model: run.rows[0]?.calls.find((call) => call.jobId === "assess.judgments")?.model ?? "unknown",
    usage: { input_tokens: run.usage.inputTokens, output_tokens: run.usage.outputTokens },
    cost_usd: run.costUsd,
    unpriced_calls: run.unpricedCalls,
    status: "ok",
  };
}

interface VariantMeta {
  id: string;
  round: number;
  description: string;
  rationale: string;
  status: "baseline" | "kept" | "reverted";
  config: SwarmConfig;
  createdAt: string;
}

export interface Candidate {
  key: string;
  description: string;
  reason: string;
  config: SwarmConfig;
}

type Means = Record<string, number>;

export interface CandidateDecision {
  keep: boolean;
  rationale: string;
  rule: "ranking" | "guardrail" | "reverted";
}

// With no clock supplied, use the real one. A fixed fallback stamped every round "1970" on the server.
const fallbackNow = () => new Date();
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function flowDir(deps: EvalDeps, id: string): string {
  return path.join(deps.flowsDir, id);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readRows(filePath: string): Promise<ResultRow[]> {
  return readJsonLines<ResultRow>(filePath);
}

async function readState(dir: string): Promise<EvalState | null> {
  const file = path.join(dir, "_state.json");
  return (await exists(file)) ? readJson<EvalState>(file) : null;
}

async function writeState(dir: string, state: EvalState): Promise<void> {
  await writeAtomicFile(path.join(dir, "_state.json"), json(state));
}

function caseMap(state: EvalState): Map<string, EvalCase> {
  return new Map((state.case_definitions ?? []).map((item) => [item.id, item]));
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [out[index], out[other]] = [out[other]!, out[index]!];
  }
  return out;
}

function splitCases(cases: readonly EvalCase[]): { train: string[]; test: string[] } {
  const target = Math.floor(cases.length / 2);
  const rng = createRng(hashSeed(EVAL_WORLD_SEED, "assess-ranking", "stratified-split"));
  const groups = new Map<string, EvalCase[]>();
  for (const item of cases) {
    const tag = item.tags.join("|");
    const rows = groups.get(tag) ?? [];
    rows.push(item);
    groups.set(tag, rows);
  }
  const buckets = [...groups.entries()].map(([tag, rows]) => ({
    tag,
    rows: shuffle(rows, rng),
    exact: (rows.length * target) / cases.length,
    count: Math.floor((rows.length * target) / cases.length),
  }));
  let remaining = target - buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  for (const bucket of buckets.sort((a, b) => (b.exact - b.count) - (a.exact - a.count) || a.tag.localeCompare(b.tag))) {
    if (remaining === 0) break;
    if (bucket.count < bucket.rows.length) {
      bucket.count += 1;
      remaining -= 1;
    }
  }
  const train: string[] = [];
  const test: string[] = [];
  for (const bucket of buckets) {
    train.push(...bucket.rows.slice(0, bucket.count).map((item) => item.id));
    test.push(...bucket.rows.slice(bucket.count).map((item) => item.id));
  }
  return { train: shuffle(train, rng), test: shuffle(test, rng) };
}

function initialState(cases: EvalCase[], reps: number, now: Date): EvalState {
  const split = splitCases(cases);
  const proposalRng = createRng(hashSeed(EVAL_WORLD_SEED, "proposal-subset"));
  return {
    current_round: 0,
    reps,
    goal: GOAL,
    best: { round: 0, test_score: 0 },
    train_ids: split.train,
    test_ids: split.test,
    metrics: METRICS.map(({ id, kind, label, better }) => ({ id, kind, label, better })),
    perf_fields: [...PERF_FIELDS],
    tried: [],
    noise_floor: null,
    metric_noise_floors: {},
    case_definitions: cases,
    proposal_train_ids: shuffle(split.train, proposalRng).slice(0, Math.min(10, split.train.length)),
    variant_created_at: { baseline: now.toISOString() },
    updated_at: now.toISOString(),
  };
}

function metricValue(row: ResultRow, key: string): number {
  return row.grade[key] ?? 0;
}

function means(rows: readonly ResultRow[]): Means {
  if (rows.length === 0) return {};
  const out: Means = {};
  for (const metric of METRICS) {
    out[metric.id] = rows.reduce((sum, row) => sum + metricValue(row, metric.id), 0) / rows.length;
  }
  return out;
}

function rowsForIds(rows: readonly ResultRow[], ids: readonly string[]): ResultRow[] {
  const selected = new Set(ids);
  return rows.filter((row) => selected.has(row.prompt_id));
}

function hasCompleteCoverage(rows: readonly ResultRow[], caseIds: readonly string[], reps: number): boolean {
  const coverage = new Set(rows.map((row) => `${row.prompt_id}|${row.rep}`));
  const expectedCount = caseIds.length * reps;
  return rows.length === expectedCount && coverage.size === expectedCount &&
    caseIds.every((caseId) => Array.from({ length: reps }, (_, index) => `${caseId}|${index + 1}`)
      .every((pair) => coverage.has(pair)));
}

function noiseFloors(rows: readonly ResultRow[], testIds: readonly string[], reps: number): Record<string, number> {
  const byCase = new Map<string, Map<number, ResultRow>>();
  for (const row of rowsForIds(rows, testIds)) {
    const repsForCase = byCase.get(row.prompt_id) ?? new Map<number, ResultRow>();
    repsForCase.set(row.rep, row);
    byCase.set(row.prompt_id, repsForCase);
  }
  const output: Record<string, number> = {};
  for (const metric of METRICS) {
    const diffs: number[] = [];
    for (const caseRows of byCase.values()) {
      const a = caseRows.get(1);
      const b = caseRows.get(2);
      if (a && b && reps >= 2) diffs.push(metricValue(b, metric.id) - metricValue(a, metric.id));
    }
    if (diffs.length < 2) {
      output[metric.id] = 0;
      continue;
    }
    const average = diffs.reduce((sum, diff) => sum + diff, 0) / diffs.length;
    const variance = diffs.reduce((sum, diff) => sum + (diff - average) ** 2, 0) / (diffs.length - 1);
    output[metric.id] = (1.96 * Math.sqrt(variance)) / Math.sqrt(diffs.length);
  }
  return output;
}

function bootstrapInterval(values: readonly number[], seed: number): [number, number] | null {
  if (values.length === 0) return null;
  if (values.length === 1) return [values[0]!, values[0]!];
  const rng = createRng(seed);
  const samples: number[] = [];
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(rng() * values.length)]!;
    }
    samples.push(sum / values.length);
  }
  samples.sort((a, b) => a - b);
  return [samples[Math.floor(samples.length * 0.025)]!, samples[Math.floor(samples.length * 0.975)]!];
}

function meanPerCase(rows: readonly ResultRow[], ids: readonly string[], metric: string): number[] {
  const selected = new Set(ids);
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    if (!selected.has(row.prompt_id)) continue;
    const values = grouped.get(row.prompt_id) ?? [];
    values.push(metricValue(row, metric));
    grouped.set(row.prompt_id, values);
  }
  return [...grouped.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
}

function isSameConfig(left: SwarmConfig, right: SwarmConfig): boolean {
  return JSON.stringify({ params: left.params, routes: left.routes, promptVariants: left.promptVariants }) ===
    JSON.stringify({ params: right.params, routes: right.routes, promptVariants: right.promptVariants });
}

function valueForParam(key: string, config: SwarmConfig): number {
  const value = config.params[key];
  if (typeof value === "number") return value;
  const def = PARAM_DEFS.find((item) => item.key === key);
  return typeof def?.default === "number" ? def.default : 0;
}

export function candidateChanges(config: SwarmConfig, jobs: EvalDeps["jobs"]): Candidate[] {
  const candidates: Candidate[] = [];
  const addParam = (key: string, delta: number, description: string) => {
    const def = PARAM_DEFS.find((item) => item.key === key);
    if (!def || typeof def.min !== "number" || typeof def.max !== "number") return;
    const current = valueForParam(key, config);
    const next = Math.min(def.max, Math.max(def.min, Math.round((current + delta) * 100) / 100));
    if (next === current) return;
    const nextConfig = clone(config);
    nextConfig.params[key] = next;
    if (isSameConfig(config, nextConfig)) return;
    const keyId = `${key}=${next}`;
    candidates.push({ key: keyId, description, reason: "Train-only comparison on the fixed training subset.", config: nextConfig });
  };

  for (const def of PARAM_DEFS) {
    if (!def.tunable || !def.key.startsWith("weights.")) continue;
    for (const direction of [-1, 1]) {
      const value = valueForParam(def.key, config);
      const next = Math.min(def.max ?? 5, Math.max(def.min ?? 0, value + direction));
      if (next === value) continue;
      const label = `${def.label} ${value} → ${next}`;
      addParam(def.key, direction, label);
    }
  }
  addParam("assess.unknown_prior", -0.05, "Change the unknown-answer prior by -0.05");
  addParam("assess.unknown_prior", 0.05, "Change the unknown-answer prior by +0.05");
  addParam("assess.surface_threshold", -0.03, "Change the surface threshold by -0.03");
  addParam("assess.surface_threshold", 0.03, "Change the surface threshold by +0.03");
  addParam("assess.min_coverage", -0.05, "Change minimum evidence coverage by -0.05");
  addParam("assess.min_coverage", 0.05, "Change minimum evidence coverage by +0.05");

  const currentVariant = config.promptVariants["assess.judgments"] ?? "base";
  for (const promptVariant of jobs.get("assess.judgments").promptVariants) {
    if (promptVariant === currentVariant) continue;
    const nextConfig = clone(config);
    nextConfig.promptVariants["assess.judgments"] = promptVariant;
    candidates.push({ key: `assess.judgments.prompt=${promptVariant}`, description: `Assess prompt: ${promptVariant}`, reason: "Train-only comparison on the fixed training subset.", config: nextConfig });
  }

  const modelOptions = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
  for (const model of modelOptions) {
    const nextConfig = clone(config);
    const baseRoute = effectiveRoute("assess.judgments", EMPTY_STEERING, config);
    nextConfig.routes["assess.judgments"] = { ...baseRoute, provider: "claude-cli", model };
    if (!isSameConfig(config, nextConfig)) candidates.push({ key: `assess.judgments.model=${model}`, description: `Assess model: ${modelLabel(model)}`, reason: "Train-only comparison on the fixed training subset.", config: nextConfig });
  }
  for (const model of ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"]) {
    const nextConfig = clone(config);
    const baseRoute = effectiveRoute("verify.claims", EMPTY_STEERING, config);
    nextConfig.routes["verify.claims"] = { ...baseRoute, provider: "codex-cli", model };
    if (!isSameConfig(config, nextConfig)) candidates.push({ key: `verify.claims.model=${model}`, description: `Verifier model: ${modelLabel(model)}`, reason: "Train-only comparison on the fixed training subset.", config: nextConfig });
  }
  return candidates;
}

function modelLabel(modelId: string): string {
  return MODELS.find((model) => model.id === modelId)?.label ?? modelId;
}

export async function proposeTrainChange(input: {
  currentConfig: SwarmConfig;
  trainCaseIds: readonly string[];
  tried: readonly TriedChange[];
  jobs: EvalDeps["jobs"];
  evaluate(config: SwarmConfig, caseIds: readonly string[]): Promise<Means>;
}): Promise<Candidate | null> {
  const current = await input.evaluate(input.currentConfig, input.trainCaseIds);
  let best: Candidate | null = null;
  let bestGain = 0;
  let guardrailFallback: Candidate | null = null;
  let fallbackGain = 0;
  const tried = new Set(input.tried.map((entry) => entry.key));
  for (const candidate of candidateChanges(input.currentConfig, input.jobs)) {
    if (tried.has(candidate.key)) continue;
    const metrics = await input.evaluate(candidate.config, input.trainCaseIds);
    const gain = (metrics.rank_match ?? 0) - (current.rank_match ?? 0);
    const leaksAllowed = (metrics.pedigree_leak ?? 0) <= (current.pedigree_leak ?? 0) + Math.abs(current.pedigree_leak ?? 0) * 0.1;
    const costsAllowed = (metrics.cost_usd ?? 0) <= (current.cost_usd ?? 0) + Math.abs(current.cost_usd ?? 0) * 0.1;
    if (gain > bestGain && leaksAllowed && costsAllowed) {
      best = candidate;
      bestGain = gain;
    }
    if (gain >= 0 && leaksAllowed && costsAllowed) {
      const leakGain = (current.pedigree_leak ?? 0) - (metrics.pedigree_leak ?? 0);
      const costGain = (current.cost_usd ?? 0) - (metrics.cost_usd ?? 0);
      const relativeGain = Math.max(
        leakGain / Math.max(Math.abs(current.pedigree_leak ?? 0), 1e-9),
        costGain / Math.max(Math.abs(current.cost_usd ?? 0), 1e-9),
      );
      if (relativeGain > fallbackGain) {
        guardrailFallback = candidate;
        fallbackGain = relativeGain;
      }
    }
  }
  return best ?? guardrailFallback;
}

function readableValue(metric: string, value: number): string {
  return metric === "cost_usd" ? `$${value.toFixed(2)}` : value.toFixed(2);
}

/** Applies the held-out noise gates for target gains and free guardrail gains. */
export function decideCandidate(
  current: Means,
  candidate: Means,
  noiseFloors: Readonly<Record<string, number>>,
  complete: boolean,
  baseline: Means = current,
): CandidateDecision {
  const target = GOAL.target;
  const currentTarget = current[target] ?? 0;
  const candidateTarget = candidate[target] ?? 0;
  const targetNoise = noiseFloors[target] ?? 0;
  if (!complete) return { keep: false, rationale: "Reverted: incomplete run.", rule: "reverted" };

  const holdTolerance = (metric: string) => Math.max(
    noiseFloors[metric] ?? 0,
    Math.abs(current[metric] ?? 0) * 0.01,
  );
  const worseHold = GOAL.hold.find((metric) =>
    (candidate[metric] ?? 0) > (current[metric] ?? 0) + holdTolerance(metric));
  const baselineCostLimit = (baseline.cost_usd ?? 0) * 1.25;
  const exceedsCostLimit = (candidate.cost_usd ?? 0) > baselineCostLimit;
  const improvedHolds = GOAL.hold.filter((metric) =>
    (current[metric] ?? 0) - (candidate[metric] ?? 0) > holdTolerance(metric));
  const targetRise = candidateTarget - currentTarget;
  if (targetRise > targetNoise && !worseHold && !exceedsCostLimit) {
    return {
      keep: true,
      rationale: `Kept: ranking quality rose from ${currentTarget.toFixed(3)} to ${candidateTarget.toFixed(3)}, beyond its noise of ${targetNoise.toFixed(3)}.`,
      rule: "ranking",
    };
  }
  if (candidateTarget >= currentTarget && improvedHolds.length > 0 && !worseHold && !exceedsCostLimit) {
    const bestMetric = improvedHolds.sort((left, right) => {
      const leftGain = ((current[left] ?? 0) - (candidate[left] ?? 0)) / Math.max(Math.abs(current[left] ?? 0), 1e-9);
      const rightGain = ((current[right] ?? 0) - (candidate[right] ?? 0)) / Math.max(Math.abs(current[right] ?? 0), 1e-9);
      return rightGain - leftGain;
    })[0]!;
    const metricLabel = bestMetric === "pedigree_leak" ? "pedigree leak" : "cost";
    const targetNote = candidateTarget === currentTarget ? "ranking quality unchanged" : "ranking quality no lower";
    return {
      keep: true,
      rationale: `Kept: ${metricLabel} fell from ${readableValue(bestMetric, current[bestMetric] ?? 0)} to ${readableValue(bestMetric, candidate[bestMetric] ?? 0)} with ${targetNote}.`,
      rule: "guardrail",
    };
  }

  if (worseHold) {
    const before = current[worseHold] ?? 0;
    const after = candidate[worseHold] ?? 0;
    const label = worseHold === "pedigree_leak" ? "pedigree leak" : "cost";
    return {
      keep: false,
      rationale: `Reverted: ${label} rose from ${readableValue(worseHold, before)} to ${readableValue(worseHold, after)}, beyond its tolerance of ${readableValue(worseHold, holdTolerance(worseHold))}.`,
      rule: "reverted",
    };
  }
  if (exceedsCostLimit) {
    return {
      keep: false,
      rationale: `Reverted: cost rose to ${readableValue("cost_usd", candidate.cost_usd ?? 0)}, above the baseline limit of ${readableValue("cost_usd", baselineCostLimit)}.`,
      rule: "reverted",
    };
  }
  if (targetRise < 0) {
    return { keep: false, rationale: `Reverted: ranking quality fell from ${currentTarget.toFixed(3)} to ${candidateTarget.toFixed(3)}.`, rule: "reverted" };
  }
  return {
    keep: false,
    rationale: `Reverted: the ranking quality gain of ${Math.max(0, targetRise).toFixed(3)} is inside the noise of ${targetNoise.toFixed(3)}.`,
    rule: "reverted",
  };
}

function unifiedJsonDiff(previous: SwarmConfig, current: SwarmConfig): string {
  const before = JSON.stringify(previous, null, 2).split("\n");
  const after = JSON.stringify(current, null, 2).split("\n");
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const removed = before.slice(prefix, before.length - suffix).map((line) => `-${line}`);
  const added = after.slice(prefix, after.length - suffix).map((line) => `+${line}`);
  return [`--- previous/config.json`, `+++ current/config.json`, `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`, ...removed, ...added, ""].join("\n");
}

async function readVariantDirs(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  return (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && (entry.name === "baseline" || /^v\d+$/.test(entry.name)))
    .map((entry) => entry.name)
    .sort((a, b) => (a === "baseline" ? 0 : Number(a.slice(1))) - (b === "baseline" ? 0 : Number(b.slice(1))));
}

function variantRound(id: string): number {
  return id === "baseline" ? 0 : Number(id.slice(1));
}

async function ensureVariantLayout(dir: string): Promise<void> {
  await mkdir(path.join(dir, "traces"), { recursive: true });
  await writeFile(path.join(dir, "errors.jsonl"), "", { flag: "wx" }).catch(() => undefined);
  await writeFile(path.join(dir, "results.jsonl"), "", { flag: "wx" }).catch(() => undefined);
}

async function runVariantCases(input: {
  deps: EvalDeps;
  root: string;
  variant: string;
  config: SwarmConfig;
  state: EvalState;
  brain: Brain;
  world: SimWorld;
  scoreFn?: EvalOptions["scoreFn"];
  caseIds: readonly string[];
}): Promise<ResultRow[]> {
  const variantDir = path.join(input.root, input.variant);
  await ensureVariantLayout(variantDir);
  const resultsFile = path.join(variantDir, "results.jsonl");
  const priorRows = await readRows(resultsFile);
  const recordedBrain = input.state.variant_brains?.[input.variant];
  if (priorRows.length > 0 && recordedBrain === undefined) {
    throw new ServiceError(409, `Cannot safely resume ${input.variant}: existing result rows have no recorded brain mode.`);
  }
  if (recordedBrain !== undefined && recordedBrain !== input.brain) {
    throw new ServiceError(409, `Cannot resume ${input.variant} with brain ${input.brain}; its existing results use ${recordedBrain}.`);
  }
  if (recordedBrain === undefined) {
    input.state.variant_brains = { ...input.state.variant_brains, [input.variant]: input.brain };
    await writeState(input.root, input.state);
  }
  const done = new Set(priorRows.map((row) => `${row.prompt_id}|${row.rep}`));
  const cases = caseMap(input.state);
  const tasks: Array<{ evalCase: EvalCase; rep: number }> = [];
  for (const caseId of input.caseIds) {
    const evalCase = cases.get(caseId);
    if (!evalCase) continue;
    for (let rep = 1; rep <= input.state.reps; rep += 1) {
      if (!done.has(`${caseId}|${rep}`)) tasks.push({ evalCase, rep });
    }
  }
  type Outcome = { row: ResultRow } | { failure: { prompt_id: string; rep: number; error_class: string; message: string } };
  const completed: Array<Outcome | undefined> = Array(tasks.length);
  let nextToPublish = 0;
  let publishQueue: Promise<void> = Promise.resolve();
  const publishReady = (): Promise<void> => {
    publishQueue = publishQueue.then(async () => {
      while (completed[nextToPublish] !== undefined) {
        const outcome = completed[nextToPublish]!;
        if ("row" in outcome) {
          await appendJsonLine(resultsFile, outcome.row);
          priorRows.push(outcome.row);
        } else {
          await appendJsonLine(path.join(variantDir, "errors.jsonl"), outcome.failure);
        }
        nextToPublish += 1;
      }
    });
    return publishQueue;
  };
  const attempt = async ({ evalCase, rep }: { evalCase: EvalCase; rep: number }): Promise<Outcome> => {
    try {
      const run = await runEvalCase({
        evalCase,
        repetition: rep,
        config: input.config,
        jobs: input.deps.jobs,
        executeJob: input.deps.executeJob,
        world: input.world,
        brain: input.brain,
        now: () => input.deps.now?.() ?? fallbackNow(),
        scoreFn: input.scoreFn ? (founder) => input.scoreFn!(founder, input.config) : undefined,
      });
      const traceFile = path.join(variantDir, "traces", `${evalCase.id}_rep${rep}.json`);
      const trace = [...run.selectedTranscripts.topFive, ...run.selectedTranscripts.positiveOutsideTopFive]
        .flatMap((transcript) => transcript.calls
          .filter((call) => call.jobId === "assess.judgments")
          .flatMap((call) => call.trace.map(({ role, content }) => ({ role, content }))));
      await writeFile(traceFile, json(trace), "utf8");
      const outcomes = run.rows.map((row) => row.outcome);
      const founderTruth = run.rows.map((row) => input.world.founder(row.founderId)!);
      const scores = run.rows.map((row) => row.score ?? 0);
      const qualities = founderTruth.map((founder) => founder.quality);
      return { row: {
        prompt_id: evalCase.id,
        rep,
        prompt: evalCase.prompt,
        tags: evalCase.tags,
        grade: {
          rank_match: rankMatch(scores, qualities),
          top5_match: top5Match(scores, qualities),
          precision5: precision5(outcomes),
          pedigree_leak: pedigreeLeak(scores, qualities, founderTruth.map((founder) => founder.pedigree)),
          cost_usd: run.costUsd,
          ndcg5: ndcg5(outcomes),
          recall5: recall5(outcomes),
        },
        model: run.rows[0]?.calls.find((call) => call.jobId === "assess.judgments")?.model ?? "unknown",
        usage: { input_tokens: run.usage.inputTokens, output_tokens: run.usage.outputTokens },
        cost_usd: run.costUsd,
        unpriced_calls: run.unpricedCalls,
        status: "ok",
      } };
    } catch (error) {
      return { failure: {
        prompt_id: evalCase.id,
        rep,
        error_class: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      } };
    }
  };
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      completed[index] = await attempt(tasks[index]!);
      await publishReady();
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, worker));
  await publishQueue;
  return priorRows;
}

async function writeVariantMeta(dir: string, meta: VariantMeta): Promise<void> {
  await mkdir(dir, { recursive: true });
  // config.json is what marks a variant as published, so it is written last. A process stopped
  // between the two writes leaves no config, and the variant is simply published again.
  await writeAtomicFile(path.join(dir, "summary.json"), json({ description: meta.description, target: GOAL.target, status: meta.status }));
  await writeAtomicFile(path.join(dir, "config.json"), json(meta.config));
}

function roundMeans(rows: readonly ResultRow[], ids: readonly string[]): Means {
  return means(rowsForIds(rows, ids));
}

async function updateReports(root: string, state: EvalState, variants: readonly VariantMeta[], rowsByVariant: Map<string, ResultRow[]>): Promise<void> {
  const tableRows = variants.map((variant) => {
    const test = roundMeans(rowsByVariant.get(variant.id) ?? [], state.test_ids);
    return `| ${variant.id} | ${variant.status} | ${formatMetric(test.rank_match)} | ${formatMetric(test.top5_match)} | ${formatMetric(test.precision5)} | ${formatMetric(test.pedigree_leak)} | ${formatMetric(test.cost_usd)} |`;
  });
  const status = [
    "| Variant | Status | Ranking quality | Top five match | Hits in top 5 | Pedigree leak | Cost |",
    "|---|---|---:|---:|---:|---:|---:|",
    ...tableRows,
  ].join("\n");
  await writeFile(path.join(root, "metrics.md"), [
    "# Ranking quality metrics",
    "",
    SYNTHETIC_DATA_NOTE,
    "",
    ...METRICS.map((metric) => `- **${metric.label}** (${metric.better}): ${metric.description}`),
    "",
    "## Test means by variant",
    "",
    status,
    "",
  ].join("\n"), "utf8");
  const winning = variants.find((variant) => variant.round === state.best.round);
  const winnerReason = state.current_round === 0
    ? "The baseline is the only measured variant so far."
    : winning?.round === state.current_round
      ? "The latest kept change cleared the held-out noise floor and its guardrails."
      : "Later candidates did not clear the held-out improvement and guardrail checks, so the earlier winner remains in place.";
  const narrative = [
    "# Ranking quality progress",
    "",
    status,
    "",
    `The current winner is ${winning?.id ?? "not established"}${winning ? ` (${winning.description})` : ""}. ${winnerReason} The held-out ranking quality score uses synthetic founders with known outcomes and establishes nothing about real founders.`,
    state.noise_floor === null || state.noise_floor === undefined ? "" : `The baseline test noise floor is ${formatMetric(state.noise_floor)} ranking quality.`,
    state.proposer_exhausted ? "The train-only proposer found no untried change with a training gain inside its guardrails, so the loop stopped." : "",
    "",
  ].filter(Boolean).join("\n");
  await writeFile(path.join(root, "narrative.md"), narrative, "utf8");
}

function formatMetric(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(4);
}

function readableChanges(previous: SwarmConfig, current: SwarmConfig): string[] {
  const changes: string[] = [];
  for (const key of new Set([...Object.keys(previous.params), ...Object.keys(current.params)])) {
    const before = previous.params[key];
    const after = current.params[key];
    if (after === undefined) continue;
    const def = PARAM_DEFS.find((item) => item.key === key);
    const oldValue = before ?? def?.default ?? "unset";
    if (oldValue === after) continue;
    const label = def?.label ?? key;
    changes.push(`${label} ${String(oldValue)} → ${String(after)}`);
  }
  for (const key of new Set([...Object.keys(previous.routes), ...Object.keys(current.routes)] as Array<keyof SwarmConfig["routes"]>)) {
    const before = effectiveRoute(key, EMPTY_STEERING, previous);
    const after = effectiveRoute(key, EMPTY_STEERING, current);
    if (before.model !== after.model) changes.push(`${getJob(key).label} model: ${modelLabel(before.model)} → ${modelLabel(after.model)}`);
    if (before.provider !== after.provider && before.model === after.model) changes.push(`${getJob(key).label} provider: ${before.provider} → ${after.provider}`);
    if (before.effort !== after.effort) changes.push(`${getJob(key).label} reasoning effort: ${before.effort ?? "default"} → ${after.effort ?? "default"}`);
  }
  for (const key of new Set([...Object.keys(previous.promptVariants), ...Object.keys(current.promptVariants)] as Array<keyof SwarmConfig["promptVariants"]>)) {
    const before = previous.promptVariants[key] ?? "base";
    const after = current.promptVariants[key] ?? "base";
    if (before !== after) changes.push(`${getJob(key).label} prompt: ${before} → ${after}`);
  }
  return changes;
}

function variantId(round: number): string {
  return round === 0 ? "baseline" : `v${round}`;
}

async function metadataFor(root: string, state: EvalState): Promise<VariantMeta[]> {
  const out: VariantMeta[] = [];
  for (const id of await readVariantDirs(root)) {
    const configPath = path.join(root, id, "config.json");
    const summaryPath = path.join(root, id, "summary.json");
    if (!(await exists(configPath)) || !(await exists(summaryPath))) continue;
    const config = await readJson<SwarmConfig>(configPath);
    const summary = await readJson<{ description: string; target: string; status: VariantMeta["status"] }>(summaryPath);
    out.push({
      id,
      round: variantRound(id),
      description: summary.description,
      rationale: id === "baseline" ? "Starting configuration." : await readReason(path.join(root, id, "change.md")),
      status: summary.status,
      config,
      createdAt: state.variant_created_at?.[id] ?? "1970-01-01T00:00:00.000Z",
    });
  }
  return out;
}

async function readReason(file: string): Promise<string> {
  if (!(await exists(file))) return "";
  const text = await readFile(file, "utf8");
  return text.split("\n").slice(1).join(" ").trim();
}

async function writeChangeFiles(root: string, round: number, description: string, reason: string, previous: SwarmConfig, current: SwarmConfig): Promise<void> {
  const dir = path.join(root, variantId(round));
  await writeAtomicFile(path.join(dir, "change.md"), `${description}\n\n${reason}\n`);
  await writeAtomicFile(path.join(dir, "change.patch"), unifiedJsonDiff(previous, current));
}

function summarize(id: string, variants: readonly EvalVariant[], state: EvalState | null, updatedAt: string | null): EvalFlowSummary {
  const baseline = variants.find((variant) => variant.id === "baseline");
  const best = variants.find((variant) => variant.round === state?.best.round);
  return {
    id,
    label: ASSESS_RANKING_LABEL,
    description: FLOW_DESCRIPTION,
    headlineMetric: GOAL.target,
    baseline: baseline?.test[GOAL.target] ?? null,
    best: best?.test[GOAL.target] ?? null,
    rounds: state?.current_round ?? 0,
    updatedAt,
    realData: false,
  };
}

async function buildVariantDtos(root: string, state: EvalState): Promise<EvalVariant[]> {
  const variantMetas = await metadataFor(root, state);
  const all = new Map<string, ResultRow[]>();
  for (const meta of variantMetas) all.set(meta.id, await readRows(path.join(root, meta.id, "results.jsonl")));
  return variantMetas.map((meta) => {
    const rows = all.get(meta.id) ?? [];
    const train = roundMeans(rows, state.train_ids);
    const testRows = rowsForIds(rows, state.test_ids);
    const test = means(testRows);
    const perCase = meanPerCase(rows, state.test_ids, GOAL.target);
    const previous = variantMetas.filter((candidate) => candidate.round < meta.round && candidate.status !== "reverted").sort((a, b) => b.round - a.round)[0];
    const baselineConfig = variantMetas.find((candidate) => candidate.id === "baseline")?.config ?? BASE_CONFIG;
    const priorConfig = meta.id === "baseline" ? baselineConfig : previous?.config ?? baselineConfig;
    return {
      id: meta.id,
      round: meta.round,
      description: meta.description,
      rationale: meta.rationale,
      status: meta.round === state.best.round && meta.round > 0 ? "champion" : meta.status,
      train,
      test,
      testInterval: bootstrapInterval(perCase, hashSeed(EVAL_WORLD_SEED, meta.id, "test-bootstrap")),
      costUsd: test.cost_usd ?? null,
      config: meta.config,
      changes: meta.id === "baseline" ? [] : readableChanges(priorConfig, meta.config),
      createdAt: meta.createdAt,
    };
  });
}

async function refreshNarrative(root: string): Promise<string> {
  const file = path.join(root, "narrative.md");
  return (await exists(file)) ? readFile(file, "utf8") : "";
}

function flowOptions(options: EvalOptions) {
  return {
    cohortCount: options.cohortCount ?? DEFAULT_EVAL_CASES,
    cohortSize: options.cohortSize ?? DEFAULT_COHORT_SIZE,
  };
}

export function createEvalService(deps: EvalDeps, options: EvalOptions = {}): EvalService {
  const partnerFlow = deps.store ? createPartnerEval(deps) : null;
  // A named judge does both analysts' work on past cases. The swarm's own analysts are unchanged.
  const pastFlow = createPastEval(deps, {
    decideCandidate,
    ...(options.pastJudge
      ? { initialConfig: { ...BASE_CONFIG, routes: { ...BASE_CONFIG.routes, "assess.judgments": options.pastJudge, "assess.company": options.pastJudge } } }
      : {}),
  });
  const knownFlow = (id: string): void => {
    if (id !== ASSESS_RANKING_ID) throw new ServiceError(404, `Unknown eval flow: ${id}`);
  };

  async function getStateOrEmpty(): Promise<{ root: string; state: EvalState | null; variants: EvalVariant[] }> {
    const root = flowDir(deps, ASSESS_RANKING_ID);
    const state = await readState(root);
    if (!state) return { root, state: null, variants: [] };
    const variants = await buildVariantDtos(root, state);
    return { root, state, variants };
  }

  async function getAssessmentFlow(): Promise<EvalFlowDTO> {
    const root = flowDir(deps, ASSESS_RANKING_ID);
    const state = await readState(root);
    if (!state) {
      const emptySummary = summarize(ASSESS_RANKING_ID, [], null, null);
      return {
        ...emptySummary,
        metrics: METRICS.map(({ kind: _kind, ...metric }) => metric),
        goal: { target: GOAL.target, direction: GOAL.direction, hold: [...GOAL.hold] },
        cases: { train: Math.floor((options.cohortCount ?? DEFAULT_EVAL_CASES) / 2), test: (options.cohortCount ?? DEFAULT_EVAL_CASES) - Math.floor((options.cohortCount ?? DEFAULT_EVAL_CASES) / 2), reps: options.repetitions ?? DEFAULT_REPS },
        noiseFloor: null,
        dataNote: SYNTHETIC_DATA_NOTE,
        variants: [],
        bestVariant: null,
        promotedVariant: null,
        narrative: "",
        ready: true,
        callsModels: false,
      };
    }
    const variants = await buildVariantDtos(root, state);
    const best = variants.find((variant) => variant.round === state.best.round);
    const baseline = variants.find((variant) => variant.id === "baseline");
    const summary = summarize(ASSESS_RANKING_ID, variants, state, state.updated_at ?? null);
    const dynamicFloors = baseline ? noiseFloors(await readRows(path.join(root, "baseline", "results.jsonl")), state.test_ids, state.reps) : {};
    return {
      ...summary,
      metrics: METRICS.map(({ kind: _kind, ...metric }) => metric),
      goal: { target: GOAL.target, direction: GOAL.direction, hold: [...GOAL.hold] },
      cases: { train: state.train_ids.length, test: state.test_ids.length, reps: state.reps },
      noiseFloor: baseline ? dynamicFloors.rank_match ?? null : null,
      dataNote: SYNTHETIC_DATA_NOTE,
      variants,
      bestVariant: best?.id ?? null,
      promotedVariant: null,
      narrative: await refreshNarrative(root),
      ready: true,
      callsModels: false,
    };
  }

  const rankingLockKey = path.resolve(flowDir(deps, ASSESS_RANKING_ID));
  // Rounds change state over many steps, so only one process may run them on a flow at a time.
  // Reads only read files that are replaced atomically, and need no cross-process lock.
  const rankingWrite = <T>(action: () => Promise<T>): Promise<T> =>
    serializeEvalFlow(rankingLockKey, action, { file: path.join(deps.flowsDir, `.${ASSESS_RANKING_ID}.lock`) });

  return {
    async listFlows(): Promise<EvalFlowSummary[]> {
      const summary = await serializeEvalFlow(rankingLockKey, async () => {
        const { state, variants } = await getStateOrEmpty();
        return summarize(ASSESS_RANKING_ID, variants, state, state?.updated_at ?? null);
      });
      return [summary, ...(partnerFlow ? await partnerFlow.listFlows() : []), ...(await pastFlow.listFlows())];
    },

    async getFlow(id: string): Promise<EvalFlowDTO> {
      if (id === PARTNER_CALLS_FLOW_ID) {
        if (!partnerFlow) throw new ServiceError(404, `Unknown eval flow: ${id}`);
        return partnerFlow.getFlow(id);
      }
      if (id === PAST_FOUNDERS_FLOW_ID) return pastFlow.getFlow(id);
      knownFlow(id);
      return serializeEvalFlow(rankingLockKey, getAssessmentFlow);
    },

    async runRounds(id: string, input: RunEvalRoundInput = {}): Promise<EvalFlowDTO> {
      if (id === PARTNER_CALLS_FLOW_ID) {
        if (!partnerFlow) throw new ServiceError(404, `Unknown eval flow: ${id}`);
        return partnerFlow.runRounds(id, input);
      }
      if (id === PAST_FOUNDERS_FLOW_ID) return pastFlow.runRounds(id, input);
      knownFlow(id);
      return rankingWrite(async () => {
      const brain = input.brain ?? "sim";
      const roundsRequested = Math.max(0, Math.floor(input.rounds ?? 1));
      if (brain === "live" && roundsRequested > 0) {
        throw new ServiceError(409, "Automatic eval rounds on real models need a spending approval step that does not exist yet. Run a baseline without automatic rounds to measure it.");
      }
      const root = flowDir(deps, id);
      let state = await readState(root);
      let world: SimWorld;
      if (!state) {
        const generated = generateEvalCases(flowOptions(options));
        world = generated.world;
        const reps = options.repetitions ?? DEFAULT_REPS;
        if (!Number.isSafeInteger(reps) || reps < 1) throw new RangeError("repetitions must be a positive safe integer.");
        const now = deps.now?.() ?? fallbackNow();
        state = initialState(generated.cases, reps, now);
        await mkdir(root, { recursive: true });
        await writeState(root, state);
      } else {
        const savedCases = state.case_definitions ?? [];
        world = generateEvalCases({
          cohortCount: savedCases.length || options.cohortCount,
          cohortSize: savedCases[0]?.founderIds.length || options.cohortSize,
        }).world;
      }

      const baselineDir = path.join(root, "baseline");
      if (!(await exists(path.join(baselineDir, "config.json")))) {
        const baselineConfig = clone(options.initialConfig ?? BASE_CONFIG);
        baselineConfig.id = "cfg_assess-ranking_baseline";
        baselineConfig.label = "Round 0: baseline";
        await mkdir(baselineDir, { recursive: true });
        await writeVariantMeta(baselineDir, {
          id: "baseline", round: 0, description: "Baseline configuration", rationale: "Starting configuration.", status: "baseline", config: baselineConfig, createdAt: state.variant_created_at?.baseline ?? "1970-01-01T00:00:00.000Z",
        });
        await ensureVariantLayout(baselineDir);
      }
      const baselineConfig = await readJson<SwarmConfig>(path.join(baselineDir, "config.json"));
      const allIds = [...state.train_ids, ...state.test_ids];
      await runVariantCases({ deps, root, variant: "baseline", config: baselineConfig, state, brain, world, scoreFn: options.scoreFn, caseIds: allIds });
      let baselineRows = await readRows(path.join(baselineDir, "results.jsonl"));
      const baselineFloors = noiseFloors(baselineRows, state.test_ids, state.reps);
      state.noise_floor = baselineFloors.rank_match ?? 0;
      state.metric_noise_floors = baselineFloors;
      const bestRows = state.best.round === 0
        ? baselineRows
        : await readRows(path.join(root, variantId(state.best.round), "results.jsonl"));
      state.best.test_score = roundMeans(bestRows, state.test_ids).rank_match ?? state.best.test_score;
      state.updated_at = (deps.now?.() ?? fallbackNow()).toISOString();
      await writeState(root, state);
      const baselineMetas = await metadataFor(root, state);
      const baselineRowsByVariant = new Map<string, ResultRow[]>();
      for (const meta of baselineMetas) baselineRowsByVariant.set(meta.id, await readRows(path.join(root, meta.id, "results.jsonl")));
      await updateReports(root, state, baselineMetas, baselineRowsByVariant);

      for (let count = 0; count < roundsRequested; count += 1) {
        const currentRound = state.best.round;
        const currentId = variantId(currentRound);
        const currentConfig = await readJson<SwarmConfig>(path.join(root, currentId, "config.json"));
        const subset = state.proposal_train_ids ?? state.train_ids.slice(0, 10);
        const trainingRuns = new Map<string, EvalCaseRun>();
        const evaluate = async (config: SwarmConfig, caseIds: readonly string[]): Promise<Means> => {
          const pipelineKey = modelPipelineKey(config);
          const rows = await Promise.all(caseIds.map(async (caseId) => {
            const evalCase = caseMap(state!).get(caseId);
            if (!evalCase) return null;
            const cacheKey = `${pipelineKey}|${caseId}`;
            let run = trainingRuns.get(cacheKey);
            if (!run) {
              run = await runEvalCase({
                evalCase,
                repetition: 1,
                config,
                jobs: deps.jobs,
                executeJob: deps.executeJob,
                world,
                brain: "sim",
                now: () => deps.now?.() ?? fallbackNow(),
                scoreFn: options.scoreFn ? (founder) => options.scoreFn!(founder, config) : undefined,
              });
              trainingRuns.set(cacheKey, run);
            }
            return evaluationRow(evalCase, run, config, world, options.scoreFn);
          }));
          return means(rows.filter((row): row is ResultRow => row !== null));
        };
        const proposer = options.propose ?? proposeTrainChange;
        const proposal = await proposer({ currentConfig, trainCaseIds: subset, tried: state.tried, jobs: deps.jobs, evaluate });
        if (!proposal) {
          state.proposer_exhausted = true;
          state.updated_at = (deps.now?.() ?? fallbackNow()).toISOString();
          await writeState(root, state);
          break;
        }
        const round = state.current_round + 1;
        const variant = variantId(round);
        const currentTrain = await evaluate(currentConfig, subset);
        const proposalTrain = await evaluate(proposal.config, subset);
        const trainReason = `Train-only evidence on ${subset.length} fixed cases: ranking quality ${formatMetric(currentTrain.rank_match)} → ${formatMetric(proposalTrain.rank_match)}, pedigree leak ${formatMetric(currentTrain.pedigree_leak)} → ${formatMetric(proposalTrain.pedigree_leak)}, cost ${formatMetric(currentTrain.cost_usd)} → ${formatMetric(proposalTrain.cost_usd)}.`;
        const variantConfig = clone(proposal.config);
        variantConfig.id = `cfg_assess-ranking_${variant}`;
        variantConfig.label = `Round ${round}: ${proposal.description}`;
        const createdAt = (deps.now?.() ?? fallbackNow()).toISOString();
        await mkdir(path.join(root, variant), { recursive: true });
        await writeVariantMeta(path.join(root, variant), {
          id: variant, round, description: proposal.description, rationale: trainReason, status: "reverted", config: variantConfig, createdAt,
        });
        await writeChangeFiles(root, round, proposal.description, trainReason, currentConfig, variantConfig);
        await runVariantCases({ deps, root, variant, config: variantConfig, state, brain: "sim", world, scoreFn: options.scoreFn, caseIds: allIds });
        const candidateRows = await readRows(path.join(root, variant, "results.jsonl"));
        baselineRows = await readRows(path.join(root, "baseline", "results.jsonl"));
        const currentRows = await readRows(path.join(root, currentId, "results.jsonl"));
        const candidateTest = roundMeans(candidateRows, state.test_ids);
        const currentTest = roundMeans(currentRows, state.test_ids);
        const baselineTest = roundMeans(baselineRows, state.test_ids);
        const complete = [candidateRows, currentRows, baselineRows]
          .every((rows) => hasCompleteCoverage(rows, allIds, state!.reps));
        const decision = decideCandidate(currentTest, candidateTest, state.metric_noise_floors ?? {}, complete, baselineTest);
        const status = decision.keep ? "kept" : "reverted";
        await writeChangeFiles(root, round, proposal.description, `${trainReason} ${decision.rationale}`, currentConfig, variantConfig);
        await writeAtomicFile(path.join(root, variant, "summary.json"), json({ description: proposal.description, target: GOAL.target, status }));
        state.current_round = round;
        state.tried.push({ key: proposal.key, kept: decision.keep });
        state.variant_created_at = { ...(state.variant_created_at ?? {}), [variant]: createdAt };
        if (decision.keep) state.best = { round, test_score: candidateTest.rank_match ?? 0 };
        state.updated_at = (deps.now?.() ?? fallbackNow()).toISOString();
        await writeState(root, state);
        const variants = await metadataFor(root, state);
        const rowsByVariant = new Map<string, ResultRow[]>();
        for (const meta of variants) rowsByVariant.set(meta.id, await readRows(path.join(root, meta.id, "results.jsonl")));
        await updateReports(root, state, variants, rowsByVariant);
      }

      const metas = await metadataFor(root, state);
      const rowsByVariant = new Map<string, ResultRow[]>();
      for (const meta of metas) rowsByVariant.set(meta.id, await readRows(path.join(root, meta.id, "results.jsonl")));
      await updateReports(root, state, metas, rowsByVariant);
      const dto = await getAssessmentFlow();
      dto.spentUsd = 0;
      return dto;
      });
    },

    async variantConfig(id: string, input: PromoteVariantInput): Promise<SwarmConfig> {
      if (id === PARTNER_CALLS_FLOW_ID) {
        if (!partnerFlow) throw new ServiceError(404, `Unknown eval flow: ${id}`);
        return partnerFlow.variantConfig(id, input);
      }
      if (id === PAST_FOUNDERS_FLOW_ID) return pastFlow.variantConfig(id, input);
      knownFlow(id);
      return serializeEvalFlow(rankingLockKey, async () => {
      const root = flowDir(deps, id);
      const file = path.join(root, input.variant, "config.json");
      if (!(await exists(file))) throw new ServiceError(404, `Unknown eval variant: ${input.variant}`);
      const config = await readJson<SwarmConfig>(file);
      const round = variantRound(input.variant);
      const labelPrefix = `Round ${round}:`;
      return {
        ...config,
        id: `cfg_assess-ranking_${input.variant}`,
        label: config.label.startsWith(labelPrefix) ? config.label : `${labelPrefix} ${config.label}`,
      };
      });
    },

    outcomeEvidence() {
      return pastFlow.outcomeEvidence();
    },
  };
}
