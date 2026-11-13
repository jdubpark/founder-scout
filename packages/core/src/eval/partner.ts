import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  BASE_CONFIG,
  DIMENSIONS,
  EMPTY_STEERING,
  effectiveThresholds,
  effectiveWeights,
  getParamDef,
  latestCalls,
  scoreFounder,
  stableId,
  type Assessment,
  type Brain,
  type EvalFlowDTO,
  type EvalFlowSummary,
  type EvalVariant,
  type FeedbackVerdict,
  type Founder,
  type Judgment,
  type PromoteVariantInput,
  type RunEvalRoundInput,
  type Swarm,
  type SwarmConfig,
} from "@agentswarm/shared";
import type { EvalDeps } from "../contracts";
import { ServiceError } from "../contracts";
import { serializeEvalFlow } from "./lock";
import { writeAtomicFile } from "./persistence";

export const PARTNER_CALLS_FLOW_ID = "partner-calls";
export const PARTNER_CALLS_MIN_PER_CLASS_PER_SPLIT = 4;

const FLOW_LABEL = "Agreement with your calls";
const FLOW_DESCRIPTION = "Checks whether the swarm's model-free founder scores rank partner yes calls above no calls.";
const DEFAULT_BOOTSTRAP_SAMPLES = 500;

export interface PartnerObservation {
  founderId: string;
  verdict: FeedbackVerdict;
  score: number;
}

/** Pairwise yes/no ranking agreement. A tied score earns half credit. */
export function partnerAgreement(observations: readonly PartnerObservation[]): number | null {
  const yes = observations.filter((item) => item.verdict === "yes");
  const no = observations.filter((item) => item.verdict === "no");
  if (yes.length === 0 || no.length === 0) return null;

  let total = 0;
  for (const positive of yes) {
    for (const negative of no) {
      if (positive.score > negative.score) total += 1;
      else if (positive.score === negative.score) total += 0.5;
    }
  }
  return total / (yes.length * no.length);
}

/** Stable 50/50 split based only on founder ID. */
export function partnerSplit(founderId: string): "train" | "test" {
  return fnv1a(founderId) % 2 === 0 ? "test" : "train";
}

interface PartnerCase {
  founderId: string;
  /** Whether the stored rubric answers came from a simulated or a live run. */
  brain: Brain;
  simId: string | null;
  verdict: FeedbackVerdict;
  split: "train" | "test";
  fit: number | null;
  judgments: Judgment[];
  config: SwarmConfig;
}

type PartnerPatch = Record<string, number>;

interface TriedVariant {
  id: string;
  key: string;
  kept: boolean;
  round: number;
  createdAt: string;
  patch: PartnerPatch;
}

interface StoredVariant extends EvalVariant {
  /** Parameter overrides shared across swarms, layered over each swarm config. */
  patch: PartnerPatch;
  changeKey: string;
}

interface StoredFlow {
  tried: TriedVariant[];
  best: string;
  current_round: number;
  /** Which kind of assessments this state was built from. Absent in older state, which was simulated. */
  mode?: Brain;
}

export interface PartnerEvalOptions {
  /** Number of stratified bootstrap draws used for test intervals and the acceptance gate. */
  bootstrapSamples?: number;
  /** Stable seed for bootstrap draws. */
  seed?: number;
}

export interface PartnerMetrics {
  agreement: number | null;
  no_surfaced: number;
  yes_surfaced: number;
}

export interface PartnerEvaluation {
  train: PartnerMetrics;
  test: PartnerMetrics;
  interval: [number, number] | null;
  noiseFloor: number | null;
}
type Evaluation = PartnerEvaluation;

interface ParamMutation {
  key: string;
  from: number;
  value: number;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function flowFile(deps: EvalDeps): string {
  return join(deps.flowsDir, PARTNER_CALLS_FLOW_ID, "_state.json");
}

function currentTime(deps: EvalDeps): string {
  return (deps.now?.() ?? new Date("1970-01-01T00:00:00.000Z")).toISOString();
}

function countBySplit(cases: readonly PartnerCase[], split: PartnerCase["split"]): { yes: number; no: number } {
  const values = cases.filter((item) => item.split === split);
  return {
    yes: values.filter((item) => item.verdict === "yes").length,
    no: values.filter((item) => item.verdict === "no").length,
  };
}

function isReady(cases: readonly PartnerCase[]): boolean {
  return (["train", "test"] as const).every((split) => {
    const counts = countBySplit(cases, split);
    return counts.yes >= PARTNER_CALLS_MIN_PER_CLASS_PER_SPLIT
      && counts.no >= PARTNER_CALLS_MIN_PER_CLASS_PER_SPLIT;
  });
}

function partnerCases(deps: EvalDeps): PartnerCase[] {
  if (!deps.store) return [];

  const cases: PartnerCase[] = [];
  for (const swarm of deps.store.listSwarms()) {
    const calls = latestCalls(deps.store.allFeedback(swarm.id));
    for (const founder of deps.store.listFounders({ swarmId: swarm.id })) {
      const call = calls.get(founder.id);
      const assessment = deps.store.latestAssessment(founder.id);
      if (!call || !assessment) continue;
      cases.push(makeCase(founder, swarm, assessment, call.verdict, deps));
    }
  }
  // Simulated and live rubric answers are never scored together. Once any called founder has
  // live answers, only live cases count; until then the eval runs on the simulated ones.
  const mode: Brain = cases.some((item) => item.brain === "live") ? "live" : "sim";
  return cases.filter((item) => item.brain === mode).sort((left, right) => left.founderId.localeCompare(right.founderId));
}

/** The kind of run that produced the cases, which all share one after `partnerCases`. */
function modeOf(cases: readonly PartnerCase[]): Brain {
  return cases[0]?.brain ?? "sim";
}

function makeCase(
  founder: Founder,
  swarm: Swarm,
  assessment: Assessment,
  verdict: FeedbackVerdict,
  deps: EvalDeps,
): PartnerCase {
  // An assessment with no run (seeded by hand or imported) is treated as simulated, the safe side.
  const run = assessment.runId ? deps.store?.getRun(assessment.runId) ?? null : null;
  return {
    founderId: founder.id,
    brain: run?.brain ?? "sim",
    simId: founder.simId,
    verdict,
    split: partnerSplit(founder.id),
    fit: founder.fit,
    // Copy the latest assessment's judgments into this read snapshot. No model is called during scoring.
    judgments: assessment.judgments.map((judgment) => ({
      ...judgment,
      evidenceIds: [...judgment.evidenceIds],
      counterEvidenceIds: [...judgment.counterEvidenceIds],
    })),
    config: deps.store?.getConfig(swarm.configId) ?? BASE_CONFIG,
  };
}

function configWithPatch(config: SwarmConfig, patch: PartnerPatch): SwarmConfig {
  return {
    ...config,
    params: { ...config.params, ...patch },
  };
}

function scoreCase(item: PartnerCase, patch: PartnerPatch) {
  const config = configWithPatch(item.config, patch);
  return scoreFounder({
    judgments: item.judgments.map((judgment) => ({
      dimension: judgment.dimension,
      level: judgment.level,
      confidence: judgment.confidence,
    })),
    weights: effectiveWeights(EMPTY_STEERING, config),
    thresholds: effectiveThresholds(EMPTY_STEERING, config),
    fit: item.fit,
  });
}

function scoreSplit(cases: readonly PartnerCase[], split: PartnerCase["split"], patch: PartnerPatch): PartnerMetrics {
  const rows = cases
    .filter((item) => item.split === split)
    .map((item) => {
      const scoring = scoreCase(item, patch);
      return {
        founderId: item.founderId,
        verdict: item.verdict,
        score: scoring.composite,
        decision: scoring.decision,
      };
    });
  const yes = rows.filter((item) => item.verdict === "yes");
  const no = rows.filter((item) => item.verdict === "no");
  return {
    agreement: partnerAgreement(rows),
    no_surfaced: no.length === 0 ? 0 : no.filter((item) => item.decision === "surface").length / no.length,
    yes_surfaced: yes.length === 0 ? 0 : yes.filter((item) => item.decision === "surface").length / yes.length,
  };
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function quantile(values: readonly number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * probability;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  const fraction = index - low;
  return sorted[low]! * (1 - fraction) + sorted[high]! * fraction;
}

function bootstrapSeed(seed: number, cases: readonly PartnerCase[], patches: readonly PartnerPatch[]): number {
  const identity = [
    seed,
    ...cases.map((item) => `${item.founderId}:${item.verdict}`).sort(),
    ...patches.map((patch) => JSON.stringify(sortedPatch(patch))),
  ].join("|");
  return fnv1a(identity);
}

function sortedPatch(patch: PartnerPatch): PartnerPatch {
  return Object.fromEntries(Object.entries(patch).sort(([left], [right]) => left.localeCompare(right)));
}

function bootstrapValues(
  cases: readonly PartnerCase[],
  patch: PartnerPatch,
  samples: number,
  seed: number,
): number[] {
  const split = cases.filter((item) => item.split === "test");
  const yes = split.filter((item) => item.verdict === "yes");
  const no = split.filter((item) => item.verdict === "no");
  const rng = makeRng(bootstrapSeed(seed, split, [patch]));
  const scores = new Map<string, number>();
  for (const item of split) {
    scores.set(item.founderId, scoreCase(item, patch).composite);
  }

  const values: number[] = [];
  for (let iteration = 0; iteration < samples; iteration += 1) {
    const draw = (group: readonly PartnerCase[]) => Array.from({ length: group.length }, () => group[Math.floor(rng() * group.length)]!);
    const drawnYes = draw(yes);
    const drawnNo = draw(no);
    const observations = [...drawnYes, ...drawnNo].map((item) => ({
      founderId: item.founderId,
      verdict: item.verdict,
      score: scores.get(item.founderId)!,
    }));
    const agreement = partnerAgreement(observations);
    if (agreement !== null) values.push(agreement);
  }
  return values;
}

function bootstrapInterval(values: readonly number[]): [number, number] | null {
  if (values.length === 0) return null;
  return [quantile(values, 0.025), quantile(values, 0.975)];
}

function bootstrapHalfWidth(values: readonly number[]): number | null {
  const interval = bootstrapInterval(values);
  return interval === null ? null : (interval[1] - interval[0]) / 2;
}

function evaluate(
  cases: readonly PartnerCase[],
  patch: PartnerPatch,
  samples: number,
  seed: number,
  against?: PartnerPatch,
): Evaluation {
  const train = scoreSplit(cases, "train", patch);
  const test = scoreSplit(cases, "test", patch);
  const interval = bootstrapInterval(bootstrapValues(cases, patch, samples, seed));
  const delta = against === undefined ? null : bootstrapHalfWidth(bootstrapValues(cases, against, samples, seed));
  return { train, test, interval, noiseFloor: delta };
}

function parameterMutations(cases: readonly PartnerCase[], patch: PartnerPatch): ParamMutation[] {
  const keys = [
    ...DIMENSIONS.map((dimension) => `weights.${dimension.id}`),
    "assess.unknown_prior",
    "assess.surface_threshold",
    "assess.min_coverage",
  ];
  const mutations: ParamMutation[] = [];
  for (const key of keys) {
    const def = getParamDef(key);
    if (!def || typeof def.default !== "number" || def.min === undefined || def.max === undefined) continue;
    const current = patch[key] ?? average(cases.map((item) => effectiveValue(item.config, key)));
    const step = key.startsWith("weights.") ? 1 : key === "assess.unknown_prior" ? 0.05 : key === "assess.surface_threshold" ? 0.03 : 0.05;
    for (const direction of [-1, 1] as const) {
      const value = roundParam(current + direction * step);
      if (value < def.min || value > def.max || value === current) continue;
      mutations.push({ key, from: current, value });
    }
  }
  return mutations;
}

function effectiveValue(config: SwarmConfig, key: string): number {
  const configured = config.params[key];
  const def = getParamDef(key);
  return typeof configured === "number" ? configured : typeof def?.default === "number" ? def.default : 0;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundParam(value: number): number {
  return Math.round(value * 1000) / 1000;
}

interface ProposedCandidate {
  patch: PartnerPatch;
  key: string;
  from: number;
  value: number;
  train: PartnerMetrics;
}

function patchKey(patch: PartnerPatch): string {
  return JSON.stringify(sortedPatch(patch));
}

function proposeFromTrain(
  trainCases: readonly PartnerCase[],
  currentPatch: PartnerPatch,
  usedChanges: ReadonlySet<string>,
): ProposedCandidate | null {
  const current = scoreSplit(trainCases, "train", currentPatch);
  if (current.agreement === null) return null;
  const currentAgreement = current.agreement;
  const candidates = parameterMutations(trainCases, currentPatch).flatMap((mutation) => {
    const patch = { ...currentPatch, [mutation.key]: mutation.value };
    const changeKey = mutation.key + "=" + mutation.value;
    if (usedChanges.has(changeKey)) return [];
    if (currentPatch[mutation.key] === undefined
      && trainCases.every((item) => effectiveValue(item.config, mutation.key) === mutation.value)) return [];
    const train = scoreSplit(trainCases, "train", patch);
    if (train.agreement === null || train.no_surfaced > current.no_surfaced) return [];
    // Worth trying when agreement rises on train, or holds while fewer noes would be surfaced.
    const gains = train.agreement > currentAgreement;
    const freeGuardrailGain = train.agreement === currentAgreement && train.no_surfaced < current.no_surfaced;
    if (!gains && !freeGuardrailGain) return [];
    return [{ patch, key: mutation.key, from: mutation.from, value: mutation.value, train }];
  });
  candidates.sort((left, right) =>
    ((right.train.agreement ?? -1) - currentAgreement) - ((left.train.agreement ?? -1) - currentAgreement)
    || left.train.no_surfaced - right.train.no_surfaced
    || left.key.localeCompare(right.key)
    || left.value - right.value,
  );
  return candidates[0] ?? null;
}

function representativeConfig(cases: readonly PartnerCase[], patch: PartnerPatch, variantId: string): SwarmConfig {
  const base = cases[0]?.config ?? BASE_CONFIG;
  return {
    ...configWithPatch(base, patch),
    id: stableId("cfg", `${PARTNER_CALLS_FLOW_ID}:${variantId}:${patchKey(patch)}`),
    label: `Partner calls ${variantId}`,
  };
}

function emptySummary(): EvalFlowSummary {
  return {
    id: PARTNER_CALLS_FLOW_ID,
    label: FLOW_LABEL,
    description: FLOW_DESCRIPTION,
    headlineMetric: "agreement",
    baseline: null,
    best: null,
    rounds: 0,
    updatedAt: null,
  };
}

const METRICS = [
  { id: "agreement", label: "Agreement with your calls", better: "higher", description: "Fraction of yes/no founder pairs where a yes call scores higher; ties count as half." },
  { id: "no_surfaced", label: "No calls surfaced", better: "lower", description: "Rate of partner no calls whose score meets the surface decision threshold." },
  { id: "yes_surfaced", label: "Yes calls surfaced", better: "higher", description: "Rate of partner yes calls whose score meets the surface decision threshold." },
] as const;

function dataNote(cases: readonly PartnerCase[], includeDeficits = false): string {
  const simIds = cases.map((item) => item.simId);
  const sourceKind = simIds.length === 0
    ? "no eligible founders yet"
    : simIds.every((id) => id !== null)
      ? "simulated founders"
      : simIds.every((id) => id === null)
        ? "real founders"
        : "simulated and real founders";
  if (includeDeficits) {
    const yes = cases.filter((item) => item.verdict === "yes").length;
    const no = cases.length - yes;
    // The halves are a fixed random split, so the totals can look sufficient before each half is.
    const halves = (["train", "test"] as const).map((split) => countBySplit(cases, split));
    const short = Math.max(
      0,
      ...halves.flatMap((half) => [PARTNER_CALLS_MIN_PER_CLASS_PER_SPLIT - half.yes, PARTNER_CALLS_MIN_PER_CLASS_PER_SPLIT - half.no]),
    );
    const needs = `Needs ${PARTNER_CALLS_MIN_PER_CLASS_PER_SPLIT} Yes and ${PARTNER_CALLS_MIN_PER_CLASS_PER_SPLIT} No calls in each half of a fixed random split.`;
    if (cases.length === 0) return `${needs} No calls yet.`;
    return `${needs} So far: ${yes} Yes and ${no} No among ${sourceKind}; at least ${short} more ${short === 1 ? "is" : "are"} needed.`;
  }
  return `Replays your ${cases.length} Yes / No calls for ${sourceKind}.`;
}

function emptyDto(cases: readonly PartnerCase[]): EvalFlowDTO {
  return {
    ...emptySummary(),
    metrics: [...METRICS],
    goal: { target: "agreement", direction: "higher", hold: ["no_surfaced"] },
    cases: {
      train: cases.filter((item) => item.split === "train").length,
      test: cases.filter((item) => item.split === "test").length,
      reps: 1,
    },
    noiseFloor: null,
    dataNote: dataNote(cases, true),
    variants: [],
    bestVariant: null,
    promotedVariant: null,
    narrative: "",
  };
}

function metricRecord(metrics: PartnerMetrics): Record<string, number> {
  return {
    agreement: metrics.agreement ?? 0,
    no_surfaced: metrics.no_surfaced,
    yes_surfaced: metrics.yes_surfaced,
  };
}

/** A held metric moves only when it changes by more than this share of its value (and at least one point). */
const HELD_TOLERANCE = 0.01;

/**
 * The same two ways to earn a keep as the ranking flow, judged on test: agreement rises by more
 * than its noise with no more noes surfaced; or agreement is not lower at all and clearly fewer
 * noes are surfaced.
 */
export function passesAcceptance(candidate: PartnerEvaluation, current: PartnerEvaluation): boolean {
  if (candidate.test.agreement === null || current.test.agreement === null || candidate.noiseFloor === null) return false;
  const tolerance = Math.max(HELD_TOLERANCE, current.test.no_surfaced * HELD_TOLERANCE);
  const noesWorse = candidate.test.no_surfaced > current.test.no_surfaced + tolerance;
  const noesBetter = current.test.no_surfaced - candidate.test.no_surfaced > tolerance;
  if (noesWorse) return false;
  if (candidate.test.agreement > current.test.agreement + candidate.noiseFloor) return true;
  return candidate.test.agreement >= current.test.agreement && noesBetter;
}

function initialStoredFlow(): StoredFlow {
  return {
    tried: [{ id: "baseline", key: "", kept: true, round: 0, createdAt: "", patch: {} }],
    best: "baseline",
    current_round: 0,
  };
}

function baselineVariant(cases: readonly PartnerCase[], samples: number, seed: number, timestamp: string): StoredVariant {
  const patch: PartnerPatch = {};
  const evaluation = evaluate(cases, patch, samples, seed);
  return {
    id: "baseline",
    round: 0,
    description: "Current swarm configurations",
    rationale: "Scores the latest frozen judgments with each founder's current thesis fit.",
    status: "champion",
    train: metricRecord(evaluation.train),
    test: metricRecord(evaluation.test),
    testInterval: evaluation.interval,
    costUsd: 0,
    config: representativeConfig(cases, patch, "baseline"),
    changes: [],
    createdAt: timestamp,
    patch,
    changeKey: "",
  };
}

function flowFromStored(
  cases: readonly PartnerCase[],
  stored: StoredFlow,
  records: StoredVariant[],
  samples: number,
  seed: number,
  timestamp: string,
): { state: StoredFlow; records: StoredVariant[]; dto: EvalFlowDTO } {
  const variants = records.length > 0 ? records : [baselineVariant(cases, samples, seed, timestamp)];
  const baselineRecord = variants.find((entry) => entry.id === "baseline")
    ?? baselineVariant(cases, samples, seed, timestamp);
  const baselineEval = evaluate(cases, baselineRecord.patch, samples, seed);
  Object.assign(baselineRecord, refreshedVariant(baselineRecord, cases, baselineRecord.patch, baselineEval, timestamp));

  let championRecord = baselineRecord;
  let championEval = baselineEval;
  let revertedForTestNoise = false;
  const ordered = [baselineRecord, ...variants.filter((entry) => entry.id !== "baseline").sort((a, b) => a.round - b.round)];
  for (const entry of ordered.slice(1)) {
    const candidate = evaluate(cases, entry.patch, samples, seed, championRecord.patch);
    Object.assign(entry, refreshedVariant(entry, cases, entry.patch, candidate, timestamp));
    if (passesAcceptance(candidate, championEval)) {
      championRecord.status = "kept";
      entry.status = "champion";
      championRecord = entry;
      championEval = candidate;
    } else {
      entry.status = "reverted";
      const trainedGain = candidate.train.agreement !== null
        && championEval.train.agreement !== null
        && candidate.train.agreement > championEval.train.agreement
        && candidate.train.no_surfaced <= championEval.train.no_surfaced;
      if (trainedGain && candidate.test.agreement !== null && championEval.test.agreement !== null
        && candidate.noiseFloor !== null
        && candidate.test.agreement <= championEval.test.agreement + candidate.noiseFloor
        && candidate.test.no_surfaced <= championEval.test.no_surfaced) {
        revertedForTestNoise = true;
      }
    }
  }

  const sorted = ordered.sort((a, b) => a.round - b.round);
  const state: StoredFlow = {
    tried: sorted.map((variant) => ({
      id: variant.id,
      key: variant.changeKey,
      kept: variant.status !== "reverted",
      round: variant.round,
      createdAt: variant.createdAt,
      patch: variant.patch,
    })),
    best: championRecord.id,
    current_round: Math.max(stored.current_round, ...sorted.map((variant) => variant.round)),
  };
  const bestAgreement = championRecord.test.agreement ?? null;
  const dto: EvalFlowDTO = {
    ...emptyDto(cases),
    metrics: [...METRICS],
    baseline: baselineRecord.test.agreement ?? null,
    best: bestAgreement,
    rounds: state.current_round,
    updatedAt: timestamp,
    noiseFloor: bootstrapHalfWidth(bootstrapValues(cases, championRecord.patch, samples, seed)),
    variants: sorted.map(({ patch: _patch, ...variant }) => variant),
    bestVariant: state.best,
    dataNote: dataNote(cases),
    narrative: revertedForTestNoise
      ? "A candidate improved agreement on training calls but did not clear the held-out threshold. The test sample is still too small to distinguish this change from noise, so it was not kept."
      : (sorted.length - 1) + " variants; current champion " + state.best
        + " agrees with " + percent(bestAgreement) + " of held-out partner-call pairs.",
  };
  return { state, records: sorted, dto };
}

function refreshedVariant(
  original: EvalVariant,
  cases: readonly PartnerCase[],
  patch: PartnerPatch,
  evaluation: Evaluation,
  timestamp: string,
): EvalVariant {
  return {
    ...original,
    train: metricRecord(evaluation.train),
    test: metricRecord(evaluation.test),
    testInterval: evaluation.interval,
    config: representativeConfig(cases, patch, original.id),
    createdAt: original.createdAt || timestamp,
  };
}

function percent(value: number | null): string {
  return value === null ? "not available" : `${Math.round(value * 100)}%`;
}

function previousKeptConfig(
  records: readonly StoredVariant[],
  variant: StoredVariant,
): SwarmConfig {
  const index = records.findIndex((entry) => entry.id === variant.id);
  const previous = records.slice(0, index).reverse()
    .find((entry) => entry.status === "champion" || entry.status === "kept");
  return previous?.config ?? records.find((entry) => entry.id === "baseline")!.config;
}

function unifiedConfigDiff(previous: SwarmConfig, candidate: SwarmConfig): string {
  const before = JSON.stringify(previous, null, 2).split("\n");
  const after = JSON.stringify(candidate, null, 2).split("\n");
  return "--- previous/config.json\n"
    + "+++ candidate/config.json\n"
    + "@@ -1," + before.length + " +1," + after.length + " @@\n"
    + before.map((line) => "-" + line).join("\n") + "\n"
    + after.map((line) => "+" + line).join("\n") + "\n";
}

async function readStored(file: string): Promise<StoredFlow | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as StoredFlow;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(file: string, contents: string): Promise<void> {
  await writeAtomicFile(file, contents);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeAtomic(file, JSON.stringify(value, null, 2) + "\n");
}

async function loadVariants(flowDir: string, state: StoredFlow): Promise<StoredVariant[]> {
  const variants: StoredVariant[] = [];
  for (const tried of state.tried) {
    const variantDir = join(flowDir, tried.id);
    const summary = JSON.parse(await readFile(join(variantDir, "summary.json"), "utf8")) as {
      description: string;
      target: string;
      status: "baseline" | "kept" | "reverted";
    };
    const config = JSON.parse(await readFile(join(variantDir, "config.json"), "utf8")) as SwarmConfig;
    const patch = tried.patch;
    let rationale = "Scores current partner-call labels using the latest frozen assessments.";
    try {
      const change = await readFile(join(variantDir, "change.md"), "utf8");
      rationale = change.split("\n").slice(2).join("\n").trim() || rationale;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const status: EvalVariant["status"] = state.best === tried.id
      ? "champion"
      : summary.status === "reverted" ? "reverted" : tried.id === "baseline" ? "kept" : "kept";
    variants.push({
      id: tried.id,
      round: tried.round,
      description: summary.description,
      rationale,
      status,
      train: {},
      test: {},
      testInterval: null,
      costUsd: 0,
      config,
      changes: tried.id === "baseline" ? [] : [summary.description],
      createdAt: tried.createdAt,
      patch,
      changeKey: tried.key,
    });
  }
  return variants;
}

function resultRows(cases: readonly PartnerCase[], patch: PartnerPatch): Array<Record<string, unknown>> {
  const scored = cases.map((item) => ({ item, scoring: scoreCase(item, patch) }));
  const bySplit = new Map<PartnerCase["split"], typeof scored>();
  for (const row of scored) {
    const group = bySplit.get(row.item.split) ?? [];
    group.push(row);
    bySplit.set(row.item.split, group);
  }
  return scored.map(({ item, scoring }) => {
    const group = bySplit.get(item.split) ?? [];
    const yes = group.filter(({ item: candidate }) => candidate.verdict === "yes");
    const no = group.filter(({ item: candidate }) => candidate.verdict === "no");
    const opposite = item.verdict === "yes" ? no : yes;
    const agreement = opposite.length === 0 ? null : opposite.reduce((sum, other) => {
      if (item.verdict === "yes") {
        return sum + (scoring.composite > other.scoring.composite ? 1 : scoring.composite === other.scoring.composite ? 0.5 : 0);
      }
      return sum + (other.scoring.composite > scoring.composite ? 1 : other.scoring.composite === scoring.composite ? 0.5 : 0);
    }, 0) / opposite.length;
    const surfaced = scoring.decision === "surface" ? 1 : 0;
    return {
      founderId: item.founderId,
      prompt_id: item.founderId,
      rep: 1,
      prompt: "Compare this founder's frozen assessment score with the latest partner call.",
      tags: [item.verdict, item.split],
      grade: {
        agreement: agreement ?? 0,
        no_surfaced: item.verdict === "no" ? surfaced : 0,
        yes_surfaced: item.verdict === "yes" ? surfaced : 0,
      },
      model: "frozen-assessment",
      usage: { input_tokens: 0, output_tokens: 0 },
      cost_usd: 0,
      unpriced_calls: 0,
      status: "ok",
      split: item.split,
      verdict: item.verdict,
      score: scoring.composite,
      decision: scoring.decision,
      agreement,
      yes_surfaced: item.verdict === "yes" ? surfaced : 0,
      no_surfaced: item.verdict === "no" ? surfaced : 0,
    };
  });
}

async function writeArtifacts(
  deps: EvalDeps,
  cases: readonly PartnerCase[],
  state: StoredFlow,
  records: readonly StoredVariant[],
  dto: EvalFlowDTO,
): Promise<void> {
  const flowDir = join(deps.flowsDir, PARTNER_CALLS_FLOW_ID);
  await mkdir(flowDir, { recursive: true });
  for (const variant of records) {
    const variantDir = join(flowDir, variant.id);
    await mkdir(variantDir, { recursive: true });
    const { patch } = variant;
    await writeJson(join(variantDir, "config.json"), variant.config);
    const diskStatus = variant.status === "reverted" ? "reverted" : variant.id === "baseline" && variant.id === state.best ? "baseline" : "kept";
    await writeJson(join(variantDir, "summary.json"), {
      description: variant.description,
      target: "agreement",
      status: diskStatus,
    });
    const rows = resultRows(cases, patch);
    await writeAtomic(join(variantDir, "results.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    if (variant.id !== "baseline") {
      const previous = previousKeptConfig(records, variant);
      await writeAtomic(join(variantDir, "change.patch"), unifiedConfigDiff(previous, variant.config));
      await writeAtomic(join(variantDir, "change.md"), variant.description + "\n\n" + variant.rationale + "\n");
    }
  }
  const metrics = dto.variants.map((variant) =>
    "| " + variant.id
      + " | " + percent(variant.test.agreement ?? null)
      + " | " + percent(variant.test.no_surfaced ?? 0)
      + " | " + percent(variant.test.yes_surfaced ?? 0)
      + " | " + variant.status + " |",
  );
  await writeAtomic(
    join(flowDir, "metrics.md"),
    "# Metrics\n\n"
      + METRICS.map((metric) => "- " + metric.label + " (" + metric.id + ", " + metric.better + "): " + metric.description).join("\n")
      + "\n\nTrain cases: " + dto.cases.train + "; test cases: " + dto.cases.test
      + "; bootstrap half-width: " + percent(dto.noiseFloor) + ".\n\n"
      + "| Variant | Agreement | No surfaced rate | Yes surfaced rate | Status |\n"
      + "| --- | ---: | ---: | ---: | --- |\n"
      + metrics.join("\n") + "\n",
  );
  await writeAtomic(
    join(flowDir, "narrative.md"),
    "# " + FLOW_LABEL + "\n\n"
      + "| Variant | Agreement | No surfaced rate | Yes surfaced rate | Status |\n"
      + "| --- | ---: | ---: | ---: | --- |\n"
      + metrics.join("\n") + "\n\n"
      + dto.narrative + "\n\n" + dto.dataNote + "\n",
  );
  await writeJson(flowFile(deps), state);
}

function validateRounds(input: RunEvalRoundInput | undefined): number {
  const rounds = input?.rounds ?? 1;
  if (!Number.isSafeInteger(rounds) || rounds < 0 || rounds > 20) {
    throw new RangeError("rounds must be an integer from 0 to 20.");
  }
  return rounds;
}

function proposalDescription(candidate: ProposedCandidate): { description: string; rationale: string; changes: string[] } {
  const label = getParamDef(candidate.key)?.label ?? candidate.key;
  const displayChange = label + " " + candidate.from + " → " + candidate.value;
  return {
    description: displayChange,
    rationale: "Selected using training-split agreement (" + percent(candidate.train.agreement)
      + ") and no surfaced call rate (" + percent(candidate.train.no_surfaced) + ").",
    changes: [displayChange],
  };
}

function nextVariantId(state: StoredFlow): { id: string; round: number } {
  const round = Math.max(state.current_round, ...state.tried.map((entry) => entry.round)) + 1;
  return { id: `v${round}`, round };
}

function bestChampion(state: StoredFlow, records: readonly StoredVariant[]): StoredVariant {
  return records.find((entry) => entry.id === state.best)
    ?? records.find((entry) => entry.id === "baseline")!;
}

function sampleCount(options: PartnerEvalOptions): number {
  const samples = options.bootstrapSamples ?? DEFAULT_BOOTSTRAP_SAMPLES;
  if (!Number.isSafeInteger(samples) || samples < 100 || samples > 10_000) {
    throw new RangeError("bootstrapSamples must be an integer from 100 to 10000.");
  }
  return samples;
}

/** Builds the partner-call eval flow; its artifacts are refreshed from Store on each read and run. */
export function createPartnerEval(deps: EvalDeps, options: PartnerEvalOptions = {}) {
  const samples = sampleCount(options);
  const seed = options.seed ?? 314159;
  const lockKey = resolve(deps.flowsDir, PARTNER_CALLS_FLOW_ID);
  // Every read of this flow re-derives its files from the store, so reads are writers too. They
  // are quick, so a second process waits briefly for the flow instead of being refused at once.
  const guarded = <T>(action: () => Promise<T>): Promise<T> =>
    serializeEvalFlow(lockKey, action, { file: join(deps.flowsDir, `.${PARTNER_CALLS_FLOW_ID}.lock`), waitMs: 5_000 });
  if (!Number.isSafeInteger(seed)) throw new RangeError("seed must be a safe integer.");

  const refresh = async (): Promise<{ state: StoredFlow | null; records: StoredVariant[]; dto: EvalFlowDTO }> => {
    const cases = partnerCases(deps);
    if (!isReady(cases)) return { state: null, records: [], dto: emptyDto(cases) };
    const file = flowFile(deps);
    const mode = modeOf(cases);
    const stored = await readStored(file);
    // State built from the other kind of assessments is not carried over: the eval starts again.
    const existing = stored && (stored.mode ?? "sim") === mode ? stored : null;
    const seeded = { ...(existing ?? initialStoredFlow()), mode };
    const loaded = existing ? await loadVariants(join(deps.flowsDir, PARTNER_CALLS_FLOW_ID), existing) : [];
    const timestamp = currentTime(deps);
    const refreshed = flowFromStored(cases, seeded, loaded, samples, seed, timestamp);
    await writeArtifacts(deps, cases, refreshed.state, refreshed.records, refreshed.dto);
    return refreshed;
  };

  return {
    async listFlows(): Promise<EvalFlowSummary[]> {
      if (!deps.store) return [];
      return guarded(async () => [(await refresh()).dto]);
    },

    async getFlow(id: string): Promise<EvalFlowDTO> {
      if (id !== PARTNER_CALLS_FLOW_ID) throw new ServiceError(404, "Unknown eval flow: " + id);
      return guarded(async () => (await refresh()).dto);
    },

    async runRounds(id: string, input?: RunEvalRoundInput): Promise<EvalFlowDTO> {
      if (id !== PARTNER_CALLS_FLOW_ID) throw new ServiceError(404, "Unknown eval flow: " + id);
      const rounds = validateRounds(input);
      return guarded(async () => {
      const cases = partnerCases(deps);
      const initial = await refresh();
      if (!initial.state) return initial.dto;
      let state = initial.state;
      let records = initial.records;
      let dto = initial.dto;

      for (let index = 0; index < rounds; index += 1) {
        const champion = bestChampion(state, records);
        const trainCases = cases.filter((item) => item.split === "train");
        const usedChanges = new Set(state.tried.map((entry) => entry.key));
        const proposal = proposeFromTrain(trainCases, champion.patch, usedChanges);
        if (!proposal) break;

        const evaluation = evaluate(cases, proposal.patch, samples, seed, champion.patch);
        const { id: variantId, round } = nextVariantId(state);
        const description = proposalDescription(proposal);
        records.push({
          id: variantId,
          round,
          description: description.description,
          rationale: description.rationale,
          status: "reverted",
          train: metricRecord(evaluation.train),
          test: metricRecord(evaluation.test),
          testInterval: evaluation.interval,
          costUsd: 0,
          config: representativeConfig(cases, proposal.patch, variantId),
          changes: description.changes,
          createdAt: currentTime(deps),
          patch: proposal.patch,
          changeKey: proposal.key + "=" + proposal.value,
        });
        state = {
          ...state,
          tried: records.map((record) => ({
            id: record.id,
            key: record.changeKey,
            kept: record.status !== "reverted",
            round: record.round,
            createdAt: record.createdAt,
            patch: record.patch,
          })),
          current_round: round,
        };
        const updated = flowFromStored(cases, state, records, samples, seed, currentTime(deps));
        state = updated.state;
        records = updated.records;
        dto = updated.dto;
        await writeArtifacts(deps, cases, state, records, dto);
      }
      return dto;
      });
    },

    async variantConfig(id: string, input: PromoteVariantInput): Promise<SwarmConfig> {
      if (id !== PARTNER_CALLS_FLOW_ID) throw new ServiceError(404, "Unknown eval flow: " + id);
      if (!deps.store) throw new ServiceError(404, "Partner calls evaluation needs a store.");
      const store = deps.store;
      return guarded(async () => {
      const refreshed = await refresh();
      if (!refreshed.state) throw new ServiceError(404, "Partner calls evaluation is below its minimum label count.");
      const variant = refreshed.records.find((entry) => entry.id === input.variant);
      if (!variant) throw new ServiceError(404, "Unknown partner-calls variant: " + input.variant);
      const swarm = store.getSwarm(input.swarmId);
      if (!swarm) throw new ServiceError(404, "Unknown swarm: " + input.swarmId);
      const base = store.getConfig(swarm.configId) ?? BASE_CONFIG;
      return {
        ...configWithPatch(base, variant.patch),
        id: "cfg_partner-calls_" + input.variant + "_" + input.swarmId,
        label: "partner-calls " + input.variant,
      };
      });
    },
  };
}
