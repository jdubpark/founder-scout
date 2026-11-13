import {
  EMPTY_STEERING,
  effectiveRoute,
  effectiveThresholds,
  effectiveWeights,
  getJob,
  groundJudgments,
  scoreFounder,
  stableId,
  type Agent,
  type AssessOutput,
  type Brain,
  type EvidenceBrief,
  type InvestigateInput,
  type Judgment,
  type ModelJobId,
  type ModelRoute,
  type ScoreResult,
  type Swarm,
  type SwarmConfig,
  type TraceTurn,
  type Usage,
} from "@agentswarm/shared";
import { createRng, createSimWorld, hashSeed } from "../sim";
import type { ExecuteJob, JobContext, JobRegistry, SimFounder, SimWorld } from "../contracts";

export const EVAL_WORLD_SEED = 314159;
export const DEFAULT_EVAL_CASES = 120;
export const DEFAULT_COHORT_SIZE = 20;
export const DEFAULT_REPS = 2;

const INVESTIGATION_JOBS = [
  "investigate.background",
  "investigate.code",
  "investigate.company",
  "investigate.media",
  "investigate.redflags",
] as const satisfies readonly ModelJobId[];

export interface EvalCase {
  id: string;
  founderIds: string[];
  tags: string[];
  prompt: string;
}

export interface GenerateEvalCasesOptions {
  cohortCount?: number;
  cohortSize?: number;
  world?: SimWorld;
}

export interface GenerateEvalCasesResult {
  world: SimWorld;
  cases: EvalCase[];
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [out[index], out[swap]] = [out[swap]!, out[index]!];
  }
  return out;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return result;
}

/**
 * Makes fixed, disjoint cohorts from a seeded simulation world. Every cohort
 * contains at least one positive-outcome founder; callers own any later split.
 */
export function generateEvalCases(
  options: GenerateEvalCasesOptions = {},
): GenerateEvalCasesResult {
  const cohortCount = positiveInteger(options.cohortCount, DEFAULT_EVAL_CASES, "cohortCount");
  const cohortSize = positiveInteger(options.cohortSize, DEFAULT_COHORT_SIZE, "cohortSize");
  const requiredFounders = cohortCount * cohortSize;
  if (!Number.isSafeInteger(requiredFounders)) {
    throw new RangeError("The requested cohort count and size exceed the safe integer range.");
  }

  let world = options.world;
  if (!world) {
    let founderCount = Math.max(requiredFounders, cohortCount * 4);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const candidateWorld = createSimWorld({ seed: EVAL_WORLD_SEED, founders: founderCount });
      const positiveCount = candidateWorld.founders().filter((founder) => founder.outcome === 1).length;
      if (positiveCount >= cohortCount) {
        world = candidateWorld;
        break;
      }
      founderCount *= 2;
    }
    if (!world) throw new RangeError("Could not generate a simulation world with at least one positive founder per cohort.");
  }
  const founders = world.founders();
  if (founders.length < requiredFounders) {
    throw new RangeError(
      `The simulation world has ${founders.length} founders; ${requiredFounders} are required.`,
    );
  }

  const rng = createRng(hashSeed(world.seed, "eval-cohort-assignment", cohortCount, cohortSize));
  const positives = shuffled(founders.filter((founder) => founder.outcome === 1), rng);
  const negatives = shuffled(founders.filter((founder) => founder.outcome === 0), rng);
  const founderById = new Map(founders.map((founder) => [founder.simId, founder]));
  if (positives.length < cohortCount) {
    throw new RangeError(
      `The simulation world has ${positives.length} positive founders; ${cohortCount} are required to seed every cohort.`,
    );
  }

  // Reserve one positive for each cohort before distributing the remaining
  // founders, so filling an early cohort cannot starve a later one.
  const firstPositive = positives.slice(0, cohortCount);
  const remaining = shuffled([...positives.slice(cohortCount), ...negatives], rng);
  let nextFounder = 0;
  const cases: EvalCase[] = Array.from({ length: cohortCount }, (_, index) => {
    const id = `cohort_${String(index + 1).padStart(2, "0")}`;
    const ids = [firstPositive[index]!.simId];
    while (ids.length < cohortSize) {
      const founder = remaining[nextFounder++];
      if (!founder) throw new RangeError("Not enough unused founders to complete the requested cohorts.");
      ids.push(founder.simId);
    }
    const positiveCount = ids.filter((founderId) => founderById.get(founderId)?.outcome === 1).length;
    return {
      id,
      founderIds: ids,
      tags: [`positive_count:${positiveCount}`],
      prompt: `This cohort contains ${positiveCount} founders with a known positive simulated outcome.`,
    };
  });

  return { world, cases };
}

export type EvalMetricGrade = "true_positive" | "false_positive" | "false_negative" | "true_negative";

export interface EvalJobCall {
  id: string;
  jobId: ModelJobId;
  route: ModelRoute;
  promptVariant: string;
  seed: number;
  model: string;
  costUsd: number | null;
  usage: Usage;
  trace: TraceTurn[];
}

export interface EvalFounderRow {
  founderId: string;
  name: string;
  outcome: 0 | 1;
  score: number | null;
  scoring: ScoreResult;
  /** Frozen analyst output, reusable when testing weight-only score changes. */
  judgments: Judgment[];
  rank: number;
  topFive: boolean;
  grade: EvalMetricGrade;
  evidenceCollected: number;
  evidenceRejected: number;
  calls: EvalJobCall[];
  costUsd: number;
  unpricedCalls: number;
  models: string[];
  usage: Usage;
}

export interface EvalTranscript {
  founderId: string;
  founderName: string;
  outcome: 0 | 1;
  score: number | null;
  rank: number;
  calls: EvalJobCall[];
}

export interface EvalCaseMetrics {
  founders: number;
  positives: number;
  topFive: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precisionAtFive: number;
  recallAtFive: number;
}

export interface EvalCaseRun {
  caseId: string;
  caseTags: string[];
  casePrompt: string;
  repetition: number;
  brain: Brain;
  rows: EvalFounderRow[];
  metrics: EvalCaseMetrics;
  costUsd: number;
  unpricedCalls: number;
  models: string[];
  usage: Usage;
  selectedTranscripts: {
    topFive: EvalTranscript[];
    positiveOutsideTopFive: EvalTranscript[];
  };
}

export type EvalScoreFn = (founder: SimFounder) => number | null;

export interface RunEvalCaseOptions {
  evalCase: EvalCase;
  repetition: number;
  config: SwarmConfig;
  jobs: JobRegistry;
  executeJob: ExecuteJob;
  world: SimWorld;
  brain: Brain;
  /** Injected clock; the runner never reads the host clock directly. */
  now: () => Date;
  /** Overrides only the final ranking score, for oracle and null controls. */
  scoreFn?: EvalScoreFn;
}

const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  webSearches: 0,
};

function addUsage(total: Usage, usage: Usage): void {
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
  total.cachedInputTokens += usage.cachedInputTokens;
  total.cacheWriteTokens += usage.cacheWriteTokens;
  total.webSearches += usage.webSearches;
}

function makeFounderBrief(founder: SimFounder) {
  return {
    id: founder.simId,
    name: founder.name,
    headline: founder.headline,
    location: founder.location,
    company: {
      name: founder.companyName,
      url: founder.links.site,
      oneLiner: founder.companyOneLiner,
      stage: founder.stage,
    },
    links: founder.links,
    tags: [founder.sector, founder.stage],
    sightings: [],
    simId: founder.simId,
  };
}

function makeSwarm(evalCase: EvalCase, config: SwarmConfig, timestamp: string): Swarm {
  return {
    id: stableId("swm", `eval:${evalCase.id}`),
    name: "Evaluation cohort",
    status: "active",
    thesis: {
      summary: "Seed-stage technology companies solving substantial problems for growing markets.",
      sectors: [],
      stages: ["seed"],
      geos: [],
      avoid: [],
    },
    configId: config.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function makeAgent(
  evalCase: EvalCase,
  founderId: string,
  repetition: number,
  jobId: ModelJobId,
  swarmId: string,
  timestamp: string,
): Agent {
  return {
    id: stableId("agt", `${evalCase.id}:${founderId}:${jobId}:rep_${repetition}`),
    swarmId,
    jobId,
    classId: getJob(jobId).classId,
    name: getJob(jobId).label,
    status: "active",
    beat: null,
    state: {},
    createdAt: timestamp,
  };
}

function metricGrade(outcome: 0 | 1, topFive: boolean): EvalMetricGrade {
  if (outcome === 1) return topFive ? "true_positive" : "false_negative";
  return topFive ? "false_positive" : "true_negative";
}

/** Executes the investigation, verification, and assessment flow for one cohort repetition. */
export async function runEvalCase(options: RunEvalCaseOptions): Promise<EvalCaseRun> {
  const {
    evalCase,
    repetition,
    config,
    jobs,
    executeJob,
    world,
    brain,
    now,
    scoreFn,
  } = options;
  if (!Number.isSafeInteger(repetition) || repetition < 1) {
    throw new RangeError("repetition must be a positive safe integer.");
  }

  const startedAt = now();
  const timestamp = startedAt.toISOString();
  const swarm = makeSwarm(evalCase, config, timestamp);
  const resolved = EMPTY_STEERING;
  const weights = effectiveWeights(resolved, config);
  const thresholds = effectiveThresholds(resolved, config);
  const founders = evalCase.founderIds.map((founderId) => {
    const founder = world.founder(founderId);
    if (!founder) throw new Error(`Founder ${founderId} from ${evalCase.id} is absent from the simulation world.`);
    return founder;
  });
  if (new Set(evalCase.founderIds).size !== evalCase.founderIds.length) {
    throw new Error(`Evaluation case ${evalCase.id} contains duplicate founder IDs.`);
  }

  const runFounder = async (founder: SimFounder): Promise<EvalFounderRow> => {
    const founderBrief = makeFounderBrief(founder);
    const calls: EvalJobCall[] = [];
    const evidence: EvidenceBrief[] = [];
    let evidenceCollected = 0;

    const execute = async <J extends ModelJobId>(
      jobId: J,
      input: Parameters<ExecuteJob>[1],
    ) => {
      const agent = makeAgent(evalCase, founder.simId, repetition, jobId, swarm.id, timestamp);
      const steering = EMPTY_STEERING;
      const route = effectiveRoute(jobId, steering, config);
      const requestedVariant = config.promptVariants[jobId] ?? "base";
      const promptVariant = jobs.get(jobId).promptVariants.includes(requestedVariant)
        ? requestedVariant
        : "base";
      const seed = hashSeed(world.seed, evalCase.id, founder.simId, jobId, repetition);
      const context: JobContext = {
        swarm,
        agent,
        steering,
        steeringBlock: "",
        config,
        route,
        promptVariant,
        now: now(),
        sim: world,
        rng: createRng(seed),
      };
      const execution = await executeJob(jobId, input as never, context, { brain });
      calls.push({
        id: stableId("tsk", `${evalCase.id}:${founder.simId}:${jobId}:rep_${repetition}`),
        jobId,
        route,
        promptVariant,
        seed,
        model: execution.model,
        costUsd: execution.costUsd,
        usage: execution.usage,
        trace: execution.trace,
      });
      return execution;
    };

    for (const jobId of INVESTIGATION_JOBS) {
      const investigateInput: InvestigateInput = {
        founder: founderBrief,
        thesis: swarm.thesis,
        known: [],
        depth: "standard",
        repo: jobId === "investigate.code" ? world.repos(founder.simId)[0] ?? null : null,
      };
      const execution = await execute(jobId, investigateInput);
      const drafts = execution.output.evidence;
      evidenceCollected += drafts.length;
      const source = getJob(jobId).source ?? "web";
      for (let index = 0; index < drafts.length; index += 1) {
        const draft = drafts[index]!;
        evidence.push({
          id: stableId("evd", `${evalCase.id}:${founder.simId}:${jobId}:${index}:rep_${repetition}`),
          kind: draft.kind,
          source,
          url: draft.url,
          title: draft.title,
          excerpt: draft.excerpt,
          claim: draft.claim,
          publishedAt: draft.publishedAt,
          verification: "unverified",
          sim: draft.sim ?? null,
        });
      }
    }

    const verifyExecution = await execute("verify.claims", { founder: founderBrief, evidence });
    const verifyOutput = verifyExecution.output;
    const verdicts = new Map(verifyOutput.verdicts.map((verdict) => [verdict.evidenceId, verdict]));
    const supportedEvidence = evidence.flatMap((item) => {
      const verdict = verdicts.get(item.id);
      return verdict?.verdict === "supported"
        ? [{ ...item, verification: "supported" as const }]
        : [];
    });

    const assessExecution = await execute("assess.judgments", {
      founder: founderBrief,
      thesis: swarm.thesis,
      evidence: supportedEvidence,
      partnerNotes: [],
    });
    const assessment = assessExecution.output as AssessOutput;
    // The same rule as the pipeline, so the eval scores what a run would score: an answer
    // that cites no supplied, supported evidence is unsettled.
    const judgments = groundJudgments(assessment.judgments, new Set(supportedEvidence.map((item) => item.id)));
    const scoring = scoreFounder({ judgments, weights, thresholds, fit: 1 });
    const score = scoreFn ? scoreFn(founder) : scoring.composite;
    const usage = { ...ZERO_USAGE };
    let costUsd = 0;
    let unpricedCalls = 0;
    for (const call of calls) {
      addUsage(usage, call.usage);
      if (call.costUsd === null) unpricedCalls += 1;
      else costUsd += call.costUsd;
    }
    return {
      founderId: founder.simId,
      name: founder.name,
      outcome: founder.outcome,
      score,
      scoring,
      judgments,
      rank: 0,
      topFive: false,
      grade: "true_negative",
      evidenceCollected,
      evidenceRejected: evidence.length - supportedEvidence.length,
      calls,
      costUsd,
      unpricedCalls,
      models: [...new Set(calls.map((call) => call.model))],
      usage,
    };
  };

  const rows = await Promise.all(founders.map(runFounder));
  const ranked = [...rows].sort((left, right) => {
    return (right.score ?? 0) - (left.score ?? 0) || left.founderId.localeCompare(right.founderId);
  });
  const topFiveIds = new Set(ranked.slice(0, 5).map((row) => row.founderId));
  ranked.forEach((row, index) => {
    row.rank = index + 1;
    row.topFive = topFiveIds.has(row.founderId);
    row.grade = metricGrade(row.outcome, row.topFive);
  });

  const totals = { ...ZERO_USAGE };
  let costUsd = 0;
  let unpricedCalls = 0;
  const allModels = new Set<string>();
  for (const row of rows) {
    addUsage(totals, row.usage);
    costUsd += row.costUsd;
    unpricedCalls += row.unpricedCalls;
    row.models.forEach((model) => allModels.add(model));
  }

  const truePositives = rows.filter((row) => row.grade === "true_positive").length;
  const falsePositives = rows.filter((row) => row.grade === "false_positive").length;
  const falseNegatives = rows.filter((row) => row.grade === "false_negative").length;
  const trueNegatives = rows.filter((row) => row.grade === "true_negative").length;
  const positives = rows.filter((row) => row.outcome === 1).length;
  const selectedTranscripts = (selected: EvalFounderRow[]): EvalTranscript[] => selected.map((row) => ({
    founderId: row.founderId,
    founderName: row.name,
    outcome: row.outcome,
    score: row.score,
    rank: row.rank,
    calls: row.calls,
  }));

  return {
    caseId: evalCase.id,
    caseTags: [...evalCase.tags],
    casePrompt: evalCase.prompt,
    repetition,
    brain,
    rows: ranked,
    metrics: {
      founders: rows.length,
      positives,
      topFive: Math.min(5, rows.length),
      truePositives,
      falsePositives,
      falseNegatives,
      trueNegatives,
      precisionAtFive: ranked.filter((row) => row.topFive).length === 0
        ? 0
        : truePositives / ranked.filter((row) => row.topFive).length,
      recallAtFive: positives === 0 ? 0 : truePositives / positives,
    },
    costUsd,
    unpricedCalls,
    models: [...allModels].sort(),
    usage: totals,
    selectedTranscripts: {
      topFive: selectedTranscripts(ranked.filter((row) => row.topFive)),
      positiveOutsideTopFive: selectedTranscripts(ranked.filter((row) => row.outcome === 1 && !row.topFive)),
    },
  };
}
