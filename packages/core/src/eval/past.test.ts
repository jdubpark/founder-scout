import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BASE_CONFIG,
  DEFAULT_ROUTES,
  COMPANY_DIMENSIONS,
  DIMENSIONS,
  type AssessInput,
  type CompanyAssessInput,
  type ModelRoute,
  type PastCase,
  type SwarmConfig,
} from "@agentswarm/shared";
import { ProviderError, type EvalDeps, type JobContext, type JobRegistry } from "../contracts";
import { createEvalService, decideCandidate } from "./index";
import { createPastEval, PAST_FOUNDERS_FLOW_ID, type PastEvalOptions } from "./past";

const roots: string[] = [];
const guidance = "Prioritize repeated paid use over announced intent.";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function evidence(caseIndex: number, outcome: 0 | 1) {
  const token = `opaque-token-${String(caseIndex).padStart(2, "0")}`;
  return [
    {
      kind: "article" as const,
      source: "web" as const,
      title: `Acme Company ${caseIndex} report 2018`,
      text: `A public profile published in 2018. ${token}. ${outcome ? "paying customers" : "prototype only"}.`,
      date: "2018-06-01",
    },
    {
      kind: "article" as const,
      source: "web" as const,
      title: "Later company result",
      text: `UNICORN_VALUE and Founder Person ${caseIndex} in 2022`,
      date: "2022-01-01",
    },
  ];
}

function makeCases(options: { cohorts?: number; perCohort?: number; reversedTest?: boolean; reversedValidate?: boolean } = {}): PastCase[] {
  const cohortCount = options.cohorts ?? 4;
  const perCohort = options.perCohort ?? 4;
  const cases: PastCase[] = [];
  for (let cohort = 0; cohort < cohortCount; cohort += 1) {
    for (let position = 0; position < perCohort; position += 1) {
      const evidenceOutcome: 0 | 1 = position % 2 === 0 ? 1 : 0;
      let outcome = evidenceOutcome;
      if (options.reversedValidate && cohort === 1) outcome = outcome === 1 ? 0 : 1;
      if (options.reversedTest && cohort >= Math.max(2, Math.floor(cohortCount / 2))) outcome = outcome === 1 ? 0 : 1;
      const index = cases.length + 1;
      cases.push({
        id: `private-case-reference-${String(index).padStart(2, "0")}`,
        cohort: `period-${String(cohort + 1).padStart(2, "0")}`,
        asOf: "2018-12-31",
        subject: {
          company: `Acme Company ${index}`,
          aliases: [`ACME-${index}`],
          people: [`Founder Person ${index}`],
          domains: [`acme-${index}.example`],
          handles: [`@acme${index}`],
        },
        evidence: evidence(index, evidenceOutcome),
        outcome,
        outcomeSource: `private label source ${index}`,
      });
    }
  }
  return cases;
}

async function setup(cases: PastCase[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "past-founders-eval-"));
  roots.push(root);
  const datasetsDir = path.join(root, "datasets");
  const datasetDir = path.join(datasetsDir, PAST_FOUNDERS_FLOW_ID);
  const flowsDir = path.join(root, "flows");
  await mkdir(datasetDir, { recursive: true });
  await writeFile(path.join(datasetDir, "cases.jsonl"), cases.map((item) => JSON.stringify(item)).join("\n") + "\n");
  return { root, datasetsDir, flowsDir, cases };
}

function draftRows(dimensions: readonly { id: string }[], evidenceId: string, levelFor: (id: string) => number): Array<Record<string, unknown>> {
  return dimensions.map((dimension) => ({
    dimension: dimension.id,
    level: levelFor(dimension.id),
    confidence: 1,
    rationale: "The supplied evidence supports this answer.",
    evidenceIds: [evidenceId],
    counterEvidenceIds: [],
  }));
}

function depsFor(
  files: Awaited<ReturnType<typeof setup>>,
  options: {
    mode?: "weights" | "guidance" | "flat" | "recognition" | "single-flip";
    cost?: number;
    spendAllowance?: boolean;
    delayMs?: number;
    costForConfig?: (ctx: JobContext) => number;
    store?: unknown;
    sensitive?: (text: string) => string[];
  } = {},
) {
  const calls: Array<{ job: string; input: unknown; ctx: JobContext; maxBudgetUsd?: number; costUsd?: number }> = [];
  const stats = { active: 0, maxActive: 0 };
  const cohortCount = new Set(files.cases.map((item) => item.cohort)).size;
  const periodSize = files.cases.length / cohortCount;
  const executeJob = async (job: string, input: unknown, ctx: JobContext, runOptions: { maxBudgetUsd?: number }) => {
    const call: typeof calls[number] = { job, input, ctx, maxBudgetUsd: runOptions.maxBudgetUsd };
    calls.push(call);
    stats.active += 1;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    const evidenceRows = (input as AssessInput | CompanyAssessInput).evidence;
    const evidenceId = evidenceRows[0]?.id ?? "past-evidence-1";
    const joined = evidenceRows.map((item) => `${item.title} ${item.excerpt}`).join(" ").toLowerCase();
    const winnerEvidence = joined.includes("paying customers");
    const hasGuidance = (ctx.config.lessons?.["assess.company"] ?? []).some((line) => line === guidance || line === "Weigh a prior shipped product over a promised one");
    const companyLevel = (dimension: string) => {
      if (options.mode === "weights") {
        if (dimension === "traction") return winnerEvidence ? 4 : 0;
        if (dimension === "team") return winnerEvidence ? 0 : 4;
      }
      if (options.mode === "single-flip") {
        const token = joined.match(/opaque-token-(\d+)/)?.[1];
        const caseIndex = token ? Number(token) : 0;
        if (caseIndex >= 1 && caseIndex <= periodSize) {
          if (dimension === "traction") return winnerEvidence ? 4 : 0;
          if (dimension === "team") return winnerEvidence ? 0 : 4;
        }
        if (caseIndex > periodSize && caseIndex <= 2 * periodSize) {
          if (caseIndex === periodSize + 1) {
            if (dimension === "traction") return 4;
            if (dimension === "team") return 0;
          }
          if (dimension === "traction" || dimension === "team") return 2;
        }
      }
      if (options.mode === "recognition" && dimension === "traction") {
        return joined.includes("opaque-token-09") ? 0 : winnerEvidence ? 4 : 0;
      }
      if (options.mode === "guidance" && hasGuidance && dimension === "traction") return winnerEvidence ? 4 : 0;
      return 2;
    };
    const founderLevel = () => 2;
    const output = job === "assess.judgments"
      ? { judgments: draftRows(DIMENSIONS, evidenceId, founderLevel), summary: "assessed" }
      : {
          judgments: draftRows(COMPANY_DIMENSIONS, evidenceId, companyLevel),
          summary: "assessed",
          strengths: [],
          risks: [],
          openQuestions: [],
        };
    const costUsd = options.spendAllowance ? (runOptions.maxBudgetUsd ?? 0) : options.costForConfig?.(ctx) ?? options.cost ?? 0;
    call.costUsd = costUsd;
    stats.active -= 1;
    return {
      output,
      provider: "openai-api",
      model: "fake-model",
      usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, webSearches: 0 },
      costUsd,
      latencyMs: 1,
      trace: [],
    };
  };
  const deps = {
    store: options.store ?? null,
    jobs: {} as JobRegistry,
    executeJob: executeJob as unknown as EvalDeps["executeJob"],
    flowsDir: files.flowsDir,
    datasetsDir: files.datasetsDir,
    now: () => new Date("2026-11-13T00:00:00.000Z"),
    sensitive: options.sensitive,
  } as EvalDeps;
  return { deps, calls, stats };
}

function pastFlow(deps: EvalDeps, options: Omit<PastEvalOptions, "decideCandidate"> = {}) {
  return createPastEval(deps, { ...options, decideCandidate });
}

const guessFor = (prompt: string, cases: readonly PastCase[], recognizedTokens: ReadonlySet<number>) => {
  const item = cases.find((entry, index) => prompt.includes(`opaque-token-${String(index + 1).padStart(2, "0")}`));
  if (!item) return { company: null, people: [] };
  const index = cases.indexOf(item) + 1;
  return recognizedTokens.has(index) ? { company: item.subject.company, people: [] } : { company: null, people: [] };
};

function noRecognition(cases: readonly PastCase[]) {
  return async ({ prompt }: { prompt: string }) => guessFor(prompt, cases, new Set());
}

function varyJudgmentLevelsAcrossRepetitions(deps: EvalDeps) {
  const run = deps.executeJob;
  const repetitions = new Map<string, number>();
  deps.executeJob = (async (job, input, ctx, runOptions) => {
    const result = await run(job, input, ctx, runOptions);
    const evidenceRows = (input as AssessInput | CompanyAssessInput).evidence;
    const joined = evidenceRows.map((item) => `${item.title} ${item.excerpt}`).join(" ");
    const token = joined.match(/opaque-token-(\d+)/)?.[1] ?? "missing";
    const key = `${job}:${token}`;
    const repetition = (repetitions.get(key) ?? 0) + 1;
    repetitions.set(key, repetition);
    const dimensions = job === "assess.judgments" ? DIMENSIONS : COMPANY_DIMENSIONS;
    const evidenceId = evidenceRows[0]?.id ?? "past-evidence-1";
    const judgments = draftRows(dimensions, evidenceId, (id) => id === dimensions[0]!.id ? (repetition % 2 ? 0 : 4) : 2)
      .map((row) => row.dimension === dimensions[1]!.id ? { ...row, level: null } : row);
    const output = job === "assess.judgments"
      ? { judgments, summary: "assessed" }
      : { judgments, summary: "assessed", strengths: [], risks: [], openQuestions: [] };
    return { ...result, output } as typeof result;
  }) as EvalDeps["executeJob"];
}

describe("past founders eval", () => {
  it("keeps the judging pack masked and cut off, and excludes recognised cases from the headline", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps, calls } = depsFor(files, { mode: "recognition" });
    const recognized = new Set([9, 10]);
    const flow = pastFlow(deps, {
      probe: async ({ prompt }) => {
        if (prompt.includes("opaque-token-11")) throw new Error("probe failed");
        return guessFor(prompt, cases, recognized);
      },
      repetitions: 1,
    });

    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });

    expect(result.realData).toBe(true);
    expect(result.ready).toBe(true);
    expect(result.callsModels).toBe(true);
    expect(result.variants).toHaveLength(1);
    expect(result.contamination).toMatchObject({ cases: cases.length, recognised: 2, itemsCutOff: cases.length });
    expect(result.variants[0]?.test.recognised_share).toBe(0.25);
    expect(result.variants[0]?.test.clean_auc).not.toBe(result.variants[0]?.test.auc_all);
    expect(result.variants[0]?.testInterval?.[0]).toBeLessThanOrEqual(result.variants[0]?.test.clean_auc ?? 0);
    expect(result.variants[0]?.testInterval?.[1]).toBeGreaterThanOrEqual(result.variants[0]?.test.clean_auc ?? 0);
    expect(result.contamination?.recognisedScore).not.toBeNull();
    expect(result.dataNote).toContain("1 recognition probes could not be checked");
    expect(result.dataNote.endsWith("The judging model was trained after these outcomes, so the score is an upper bound on skill, not proof of it.")).toBe(true);
    expect(calls.length).toBe(cases.length * 2);
    for (const call of calls) {
      const visible = JSON.stringify({ input: call.input, context: { ...call.ctx, rng: "rng" } });
      expect(visible).not.toContain("UNICORN_VALUE");
      expect(visible).not.toContain("2022");
      expect(visible).toContain("[year]");
      expect(visible).not.toContain("private-case-reference-");
      expect(visible).not.toContain("private label source");
      expect(visible).not.toContain("period-01");
      expect(visible).not.toContain("Acme Company");
      expect(visible).not.toContain("Founder Person");
      expect(visible).not.toContain("2018");
      const evidenceRows = (call.input as AssessInput | CompanyAssessInput).evidence;
      expect(evidenceRows.every((item) => item.publishedAt === null && item.url === null && item.sim === null)).toBe(true);
      expect(evidenceRows.every((item) => item.excerpt.length <= 1200)).toBe(true);
    }
  });

  it("returns read-only clean train evidence with per-repetition score and level means", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps, calls } = depsFor(files);
    varyJudgmentLevelsAcrossRepetitions(deps);
    const recognized = new Set([1, 9]);
    let probeCalls = 0;
    const flow = pastFlow(deps, {
      probe: async ({ prompt }) => {
        probeCalls += 1;
        return guessFor(prompt, cases, recognized);
      },
      repetitions: 2,
    });

    expect(await flow.outcomeEvidence()).toBeNull();
    await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    const callsBeforeRead = calls.length;
    const probesBeforeRead = probeCalls;
    const cachePath = path.join(files.flowsDir, PAST_FOUNDERS_FLOW_ID, "_cache.json");
    const statePath = path.join(files.flowsDir, PAST_FOUNDERS_FLOW_ID, "_state.json");
    const [cacheBefore, stateBefore] = await Promise.all([readFile(cachePath), readFile(statePath)]);

    const result = await flow.outcomeEvidence();

    expect(result).not.toBeNull();
    expect(result?.cases).toHaveLength(7);
    expect(result?.cases.every((item) => ["period-01", "period-02"].includes(item.group))).toBe(true);
    expect(result?.cases.map((item) => item.outcome)).toHaveLength(7);
    expect(result?.cases.every((item) => typeof item.founder === "number" && typeof item.company === "number" && typeof item.deal === "number")).toBe(true);
    expect(result?.cases[0]?.founderLevels[DIMENSIONS[0]!.id]).toBe(0.5);
    expect(result?.cases[0]?.founderLevels[DIMENSIONS[1]!.id]).toBeNull();
    expect(result?.cases[0]?.companyLevels[COMPANY_DIMENSIONS[0]!.id]).toBe(0.5);
    expect(result?.cases[0]?.companyLevels[COMPANY_DIMENSIONS[1]!.id]).toBeNull();
    expect(result?.recognised).toBe(2);
    expect(result?.probed).toBe(cases.length);
    expect(result?.basis).toContain("7 past companies from 2 earlier periods");
    expect(result?.basis).toContain("claude-opus-5-5");
    const serviceOutcomeEvidence = createEvalService(deps).outcomeEvidence;
    expect(serviceOutcomeEvidence).toBeDefined();
    if (serviceOutcomeEvidence) expect(await serviceOutcomeEvidence()).toEqual(result);
    const serialized = JSON.stringify(result);
    for (const index of [9, 10, 11, 12, 13, 14, 15, 16]) {
      expect(serialized).not.toContain(`opaque-token-${String(index).padStart(2, "0")}`);
      expect(serialized).not.toContain(`private-case-reference-${String(index).padStart(2, "0")}`);
    }
    expect(calls).toHaveLength(callsBeforeRead);
    expect(probeCalls).toBe(probesBeforeRead);
    const [cacheAfter, stateAfter] = await Promise.all([readFile(cachePath), readFile(statePath)]);
    expect(cacheAfter.equals(cacheBefore)).toBe(true);
    expect(stateAfter.equals(stateBefore)).toBe(true);
    const unusable = pastFlow(depsFor(await setup(makeCases({ cohorts: 1, perCohort: 8 }))).deps);
    expect(await unusable.outcomeEvidence(), "an unusable split has no clean training evidence").toBeNull();
  });

  it("reports a shuffled baseline for clean test cases", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const flow = pastFlow(depsFor(files, { mode: "flat" }).deps, { probe: noRecognition(cases), repetitions: 1 });

    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    const placebo = result.contamination?.placebo;

    expect(placebo).not.toBeNull();
    expect(placebo?.mean).toBeCloseTo(0.5, 2);
    expect(placebo?.p95).toBeGreaterThanOrEqual(0.5);
    expect(result.narrative).toContain("With outcomes shuffled inside each period the score averages");
  });

  it("counts only cached era answers and does not re-probe entries without a year", async () => {
    const cases = makeCases();
    cases[0]!.asOf = "2018-12-31";
    cases[1]!.asOf = "2020-12-31";
    cases[2]!.asOf = "2012-12-31";
    const files = await setup(cases);
    const probe = vi.fn(async ({ prompt }: { prompt: string }) => {
      const index = Number(prompt.match(/opaque-token-(\d+)/)?.[1] ?? 0);
      const guess = guessFor(prompt, cases, new Set());
      if (index === 1) return { ...guess, year: 2019 };
      if (index === 2) return { ...guess, year: 2023 };
      if (index === 3) return { ...guess, year: null };
      return guess;
    });
    const flow = pastFlow(depsFor(files).deps, { probe, repetitions: 1 });

    const baseline = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    expect(probe).toHaveBeenCalledTimes(cases.length);
    expect(probe.mock.calls[0]?.[0].prompt).toContain("Also give the calendar year you believe this was written in, or null if you cannot tell.");
    // The split exposes two eras here; one fixed year can cover both, while the probe names one.
    expect(baseline.contamination).toMatchObject({ eraNamed: 1, eraProbed: 2, eraFixed: 2 });
    expect(baseline.narrative).toContain("the judge was within one for 1 of 2 masked cases; always answering one year would be for 2.");

    const repeated = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    expect(probe).toHaveBeenCalledTimes(cases.length);
    expect(repeated.contamination).toMatchObject({ eraNamed: 1, eraProbed: 2 });
  });

  it("splits earlier cohorts for training, keeps a generalizable company weight, and reuses cached judgments", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const initial: SwarmConfig = {
      ...BASE_CONFIG,
      params: { "cweights.traction": 4, "cweights.team": 4 },
    };
    const { deps, calls } = depsFor(files, { mode: "weights" });
    const flow = pastFlow(deps, { initialConfig: initial, probe: noRecognition(cases), repetitions: 1 });
    const baseline = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    const baselineCallCount = calls.length;
    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });

    expect(baseline.cases.train).toBe(8);
    expect(baseline.cases.test).toBe(8);
    expect(result.variants).toHaveLength(2);
    expect(result.variants[1]?.status).toBe("champion");
    expect(result.variants[1]?.description).toContain("Traction");
    expect(result.variants[1]?.test.clean_auc).toBeGreaterThan(result.variants[0]?.test.clean_auc ?? 0);
    expect(calls.length).toBe(baselineCallCount);
    await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    expect(calls.length).toBe(baselineCallCount);
  });

  it.each([
    {
      name: "keeps a change that validates even when it scores worse on the report-only test periods",
      split: { reversedTest: true },
      status: "champion",
      testIsWorse: true,
      rationale: "Kept:",
    },
    {
      name: "reverts a change that looks better on test but fails validation",
      split: { reversedValidate: true },
      status: "reverted",
      testIsWorse: false,
      rationale: "Reverted:",
    },
  ])("$name", async ({ split, status, testIsWorse, rationale }) => {
    const cases = makeCases(split);
    const files = await setup(cases);
    const initial: SwarmConfig = { ...BASE_CONFIG, params: { "cweights.traction": 4, "cweights.team": 4 } };
    const { deps } = depsFor(files, { mode: "weights" });
    const flow = pastFlow(deps, { initialConfig: initial, probe: noRecognition(cases), repetitions: 1 });

    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });
    const candidate = result.variants[1];
    expect(candidate?.status, "the validation period decides whether the variant is kept").toBe(status);
    expect(candidate?.test.clean_auc, "the report-only test period reports the variant's score").toEqual(expect.any(Number));
    const candidateTest = candidate?.test.clean_auc;
    const currentTest = result.variants[0]?.test.clean_auc;
    if (typeof candidateTest === "number" && typeof currentTest === "number") {
      expect(candidateTest < currentTest, "test score relation is a report, not the keep rule").toBe(testIsWorse);
    }
    expect(result.bestVariant, "only a validation keeper becomes best").toBe(status === "champion" ? candidate?.id : "baseline");
    expect(candidate?.rationale).toContain(rationale);
  });

  it("uses the paired bootstrap floor for a small validation slice and keeps a clear gain on a larger slice", async () => {
    const smallCases = makeCases({ perCohort: 16 });
    const smallFiles = await setup(smallCases);
    const initial: SwarmConfig = { ...BASE_CONFIG, params: { "cweights.traction": 4, "cweights.team": 4 } };
    const smallDeps = depsFor(smallFiles, { mode: "single-flip" }).deps;
    const smallFlow = pastFlow(smallDeps, { initialConfig: initial, probe: noRecognition(smallCases), repetitions: 1 });
    const small = await smallFlow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });

    expect(small.variants[1]?.status).toBe("reverted");
    expect(small.variants[1]?.rationale).toContain("noise floor");

    const largeCases = makeCases({ perCohort: 20 });
    const largeFiles = await setup(largeCases);
    const largeDeps = depsFor(largeFiles, { mode: "weights" }).deps;
    const largeFlow = pastFlow(largeDeps, { initialConfig: initial, probe: noRecognition(largeCases), repetitions: 1 });
    const large = await largeFlow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });

    expect(large.variants[1]?.status).toBe("champion");
  });

  it("proposes guidance from train mistakes only, judges it on train first, and carries a kept line", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps, calls } = depsFor(files, { mode: "guidance" });
    const proposer = vi.fn(async (input: { cases: Array<{ evidence: Array<{ text: string }> }> }) => {
      const serialized = JSON.stringify(input);
      expect(serialized).not.toContain("period-03");
      expect(serialized).not.toContain("period-04");
      expect(serialized).not.toContain("private-case-reference-");
      expect(serialized).not.toContain("Acme Company");
      expect(serialized).toContain("opaque-token-02");
      expect(serialized).not.toContain("opaque-token-05");
      expect(serialized).not.toContain("opaque-token-09");
      return [{ job: "assess.company" as const, text: guidance, rationale: "This focuses on stronger customer evidence." }];
    });
    const flow = pastFlow(deps, {
      probe: noRecognition(cases),
      proposeGuidance: proposer,
      repetitions: 1,
    });

    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });
    const variant = result.variants[1];

    expect(proposer).toHaveBeenCalledTimes(1);
    expect(variant?.status).toBe("champion");
    expect(variant?.description).toContain("Guidance for the company analyst");
    expect(variant?.config.lessons?.["assess.company"]).toContain(guidance);
    expect(calls.some((call) => (call.ctx.config.lessons?.["assess.company"] ?? []).includes(guidance))).toBe(true);
  });

  it("uses baseline validation cost as the shared keep-rule limit", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps } = depsFor(files, {
      mode: "guidance",
      costForConfig: (ctx) => ctx.config.lessons?.["assess.company"] ? 0.2 : 0.1,
    });
    const flow = pastFlow(deps, {
      probe: noRecognition(cases),
      proposeGuidance: async () => [{ job: "assess.company", text: guidance, rationale: "Read customer evidence." }],
      repetitions: 1,
    });

    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });

    // The line ranks better and costs twice as much per case, which is past the limit set by the baseline.
    expect(result.variants[1]?.status).toBe("reverted");
    expect(result.variants[1]?.rationale).toMatch(/cost rose/i);
    expect(result.variants[1]?.train.clean_auc).toBeGreaterThan(result.variants[0]?.train.clean_auc ?? 0);
    expect(result.variants[1]?.train.cost_usd).toBeGreaterThan(result.variants[0]?.train.cost_usd ?? 0);
    // A rejected line is not judged on the later periods.
    expect(result.variants[1]?.test).toEqual({});
  });

  it("rejects unsafe guidance and matches subject names as whole words", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps, calls } = depsFor(files, { mode: "guidance", sensitive: (text) => /age/i.test(text) ? ["age"] : [] });
    const proposer = async () => [
      { job: "assess.company" as const, text: "Acme Company 1 is a good example.", rationale: "contains a company" },
      { job: "assess.company" as const, text: "x".repeat(241), rationale: "too long" },
      { job: "assess.company" as const, text: "Use the founder's age when assessing traction.", rationale: "sensitive" },
    ];
    const flow = pastFlow(deps, {
      probe: noRecognition(cases),
      proposeGuidance: proposer,
      repetitions: 1,
    });

    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });

    expect(result.variants).toHaveLength(1);
    expect(calls).toHaveLength(cases.length * 2);
    expect(result.narrative).toContain("3 suggested lines were refused");
    expect(result.narrative).toContain("one named a subject");
    expect(result.narrative).toContain("one stated a personal attribute");

    const namedCases = makeCases();
    namedCases[0]!.subject.company = "Brex";
    namedCases[0]!.subject.people = ["Ann", "Or"];
    const namedFiles = await setup(namedCases);
    const namedFlow = pastFlow(depsFor(namedFiles, { mode: "guidance" }).deps, {
      probe: noRecognition(namedCases),
      proposeGuidance: async () => [
        { job: "assess.company", text: "Weigh shipped product or a promised roadmap differently.", rationale: "A one-word short name is ignored." },
        { job: "assess.company", text: "Announced product evidence is weaker than repeated paid use.", rationale: "A name inside a larger word is allowed." },
      ],
      repetitions: 1,
    });
    const named = await namedFlow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });
    expect(named.narrative).not.toContain("one named a subject");
  });

  it("stops before starting calls at the budget ceiling and resumes from cached jobs", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps, calls } = depsFor(files, { cost: 0.1 });
    const flow = pastFlow(deps, { probe: noRecognition(cases), repetitions: 1, concurrency: 1 });

    const short = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 0.1 });
    const countAfterShort = calls.length;
    const resumed = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });

    expect(short.baseline).toBeNull();
    expect(short.ready).toBe(true);
    expect(short.spentUsd).toBe(0.1);
    expect(short.narrative).toContain("stopped for the budget");
    expect(countAfterShort).toBe(1);
    expect(resumed.baseline).not.toBeNull();
    expect(calls.length).toBe(cases.length * 2);
  });

  it("ends cleanly when a call runs into its own allowance, counts what that call spent, and resumes", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps, calls } = depsFor(files, { cost: 0.1 });
    const working = deps.executeJob;
    let failAt = 3;
    deps.executeJob = (async (...args: Parameters<EvalDeps["executeJob"]>) => {
      if (calls.length + 1 === failAt) {
        failAt = -1;
        // What a provider throws when the model stops at the per-call ceiling it was given.
        throw new ProviderError("budget", "stopped at its budget", { costUsd: 0.07 });
      }
      return working(...args);
    }) as EvalDeps["executeJob"];
    const flow = pastFlow(deps, { probe: noRecognition(cases), repetitions: 1, concurrency: 1 });

    const stopped = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    expect(stopped.baseline).toBeNull();
    expect(stopped.narrative).toContain("stopped for the budget");
    // Two calls that finished at 0.1 each, and the 0.07 the stopped call had already used.
    expect(stopped.spentUsd).toBeCloseTo(0.27, 6);

    const resumed = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    expect(resumed.baseline).not.toBeNull();
    expect(calls.length).toBe(cases.length * 2);
  });

  it("leaves one case out when its call fails, says so, and judges it on the next run", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps, calls } = depsFor(files, { mode: "weights" });
    const working = deps.executeJob;
    let healthy = false;
    deps.executeJob = (async (job, input, ...rest) => {
      const text = JSON.stringify(input);
      if (!healthy && job === "assess.company" && text.includes("opaque-token-03")) throw new Error("the answer did not match the schema");
      return working(job, input, ...rest);
    }) as EvalDeps["executeJob"];
    const flow = pastFlow(deps, { probe: noRecognition(cases), repetitions: 1, concurrency: 1 });

    const first = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    expect(first.baseline).not.toBeNull();
    expect(first.narrative).toContain("1 call failed and that case is left out");
    const callsAfterFirst = calls.length;
    expect(callsAfterFirst).toBe(cases.length * 2 - 1);

    healthy = true;
    const second = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    // Only the one missing judgment is paid for, and the baseline now covers every case.
    expect(calls.length).toBe(callsAfterFirst + 1);
    expect(second.narrative).not.toContain("failed");
    expect(second.contamination?.cases).toBe(cases.length);
  });

  it("does not keep a line whose score rose only because a failed call dropped a case", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps } = depsFor(files, { mode: "guidance" });
    const working = deps.executeJob;
    // With the line in place, the company analyst's call fails for one case of the held-back period.
    deps.executeJob = (async (job, input, ctx, ...rest) => {
      const hasLine = (ctx.config.lessons?.["assess.company"] ?? []).includes(guidance);
      if (hasLine && job === "assess.company" && JSON.stringify(input).includes("opaque-token-06")) throw new Error("the answer did not match the schema");
      return working(job, input, ctx, ...rest);
    }) as EvalDeps["executeJob"];
    const flow = pastFlow(deps, {
      probe: noRecognition(cases),
      proposeGuidance: async () => [{ job: "assess.company" as const, text: guidance, rationale: "Read customer evidence." }],
      repetitions: 1,
    });

    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });
    const variant = result.variants[1];
    expect(variant?.status).toBe("reverted");
    expect(variant?.rationale).toContain("incomplete");
    expect(result.bestVariant).toBe("baseline");
  });

  it("counts what a failed proposer call spent, and stops the round when it hit the allowance", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps } = depsFor(files, { mode: "flat" });
    const flow = pastFlow(deps, {
      probe: noRecognition(cases),
      proposeGuidance: async () => { throw new ProviderError("budget", "stopped at its budget", { costUsd: 0.4 }); },
      repetitions: 1,
    });
    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 3, budgetUsd: 100 });
    expect(result.spentUsd).toBeCloseTo(0.4, 6);
    expect(result.narrative).toContain("stopped for the budget");
    expect(result.variants).toHaveLength(1);
  });

  it("does not pay to judge a rejected guidance line on the later periods", async () => {
    // The line helps on the earliest period and hurts on the held-back one, so it is reverted.
    const cases = makeCases({ reversedValidate: true });
    const files = await setup(cases);
    const { deps, calls } = depsFor(files, { mode: "guidance" });
    const flow = pastFlow(deps, {
      probe: noRecognition(cases),
      proposeGuidance: async () => [{ job: "assess.company" as const, text: guidance, rationale: "Looks better on the earliest period." }],
      repetitions: 1,
    });

    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });
    const variant = result.variants[1];
    expect(variant?.status).toBe("reverted");
    expect(variant?.test).toEqual({});
    expect(variant?.testInterval).toBeNull();
    expect(variant?.rationale).toContain("Not measured on the later periods");
    const withLine = calls.filter((call) => (call.ctx.config.lessons?.["assess.company"] ?? []).includes(guidance));
    expect(withLine.length).toBeGreaterThan(0);
    // Cases 9 to 16 are the two later periods. None of them was judged with the rejected line.
    for (const call of withLine) {
      const text = JSON.stringify(call.input);
      for (let index = 9; index <= 16; index += 1) expect(text).not.toContain(`opaque-token-${String(index).padStart(2, "0")}`);
    }
  });

  it("measures a new baseline when the judging model changes, and reuses the old one's judgments on the way back", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps, calls } = depsFor(files, { mode: "weights" });
    const judge = (model: string): SwarmConfig => ({
      ...BASE_CONFIG,
      routes: { ...BASE_CONFIG.routes, "assess.judgments": { provider: "claude-cli", model }, "assess.company": { provider: "claude-cli", model } },
    });
    const run = (model: string) => pastFlow(deps, { probe: noRecognition(cases), repetitions: 1, initialConfig: judge(model) })
      .runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });

    const first = await run("judge-a");
    expect(first.baseline).not.toBeNull();
    expect(calls.length).toBe(cases.length * 2);
    expect(new Set(calls.map((call) => call.ctx.route.model))).toEqual(new Set(["judge-a"]));

    // Another judge has judged nothing yet: every case is judged again, by it.
    await run("judge-b");
    expect(calls.length).toBe(cases.length * 4);
    expect(new Set(calls.slice(cases.length * 2).map((call) => call.ctx.route.model))).toEqual(new Set(["judge-b"]));

    // Back to the first judge: its judgments are still cached, so nothing is paid for twice.
    const back = await run("judge-a");
    expect(calls.length).toBe(cases.length * 4);
    expect(back.baseline).toBe(first.baseline);
  });

  it("blocks a contributor judge route for analyst, recognition, and guidance calls", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps, calls } = depsFor(files, { mode: "flat" });
    const contributorRoute: ModelRoute = { provider: "meta-api", model: "muse-spark-1.3-contributor" };
    const initialConfig: SwarmConfig = {
      ...BASE_CONFIG,
      routes: {
        ...BASE_CONFIG.routes,
        "assess.judgments": contributorRoute,
        "assess.company": contributorRoute,
      },
    };
    const directRoutes: ModelRoute[] = [];
    let guidanceCalls = 0;
    const flow = pastFlow(deps, {
      initialConfig,
      repetitions: 1,
      probe: async ({ route, prompt }) => {
        directRoutes.push(route);
        return guessFor(prompt, cases, new Set());
      },
      proposeGuidance: async ({ route }) => {
        guidanceCalls += 1;
        directRoutes.push(route);
        return [];
      },
    });

    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });

    expect(calls.every((call) => call.ctx.route.model !== contributorRoute.model)).toBe(true);
    expect(directRoutes.length).toBeGreaterThan(0);
    expect(directRoutes.every((route) => route.model !== contributorRoute.model)).toBe(true);
    expect(guidanceCalls).toBeGreaterThan(0);
    expect(directRoutes.every((route) => JSON.stringify(route) === JSON.stringify(DEFAULT_ROUTES["assess.judgments"]))).toBe(true);
    expect(calls.every((call) => JSON.stringify(call.ctx.route) === JSON.stringify(DEFAULT_ROUTES[call.job as "assess.judgments" | "assess.company"]))).toBe(true);
    expect(result.narrative).toContain("Contributor routes fall back to each job's default model");
  });

  it("runs at most four cases at once and reserves the budget across overlapping calls", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const { deps, calls, stats } = depsFor(files, { spendAllowance: true, delayMs: 5 });
    const flow = pastFlow(deps, { probe: noRecognition(cases), repetitions: 1 });

    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 8 });
    const recordedSpend = calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0);

    expect(stats.maxActive).toBeLessThanOrEqual(4);
    expect(stats.maxActive).toBeGreaterThan(1);
    expect(recordedSpend).toBe(8);
    expect(result.spentUsd).toBe(recordedSpend);
    expect(result.spentUsd).toBeLessThanOrEqual(8);
    expect(result.ready).toBe(true);
    expect(result.baseline).toBeNull();
  });

  it("reports the perfect-score interval and leaves it null with only one clean test case", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const config: SwarmConfig = { ...BASE_CONFIG, params: { "cweights.traction": 5, "cweights.team": 4 } };
    const perfectFlow = pastFlow(depsFor(files, { mode: "weights" }).deps, {
      initialConfig: config,
      probe: noRecognition(cases),
      repetitions: 1,
    });
    const perfect = await perfectFlow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    expect(perfect.variants[0]?.test.clean_auc).toBe(1);
    expect(perfect.variants[0]?.testInterval).toEqual([1, 1]);
    expect(perfect.contamination?.placebo?.atLeastObserved).toBeLessThan(0.05);

    const sparseCases = makeCases();
    const sparseFiles = await setup(sparseCases);
    const sparseFlow = pastFlow(depsFor(sparseFiles).deps, {
      initialConfig: config,
      probe: async ({ prompt }) => {
        const item = sparseCases.find((entry) => prompt.includes(`opaque-token-${String(sparseCases.indexOf(entry) + 1).padStart(2, "0")}`));
        const caseIndex = item ? sparseCases.indexOf(item) + 1 : 0;
        return caseIndex >= 10 ? { company: item!.subject.company, people: [] } : { company: null, people: [] };
      },
      repetitions: 1,
    });
    const sparse = await sparseFlow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 0, budgetUsd: 100 });
    expect(sparse.contamination?.recognised).toBe(7);
    expect(sparse.variants[0]?.testInterval).toBeNull();
  });

  it("lists not-ready datasets plainly and refuses simulation", async () => {
    const cases = makeCases();
    const files = await setup(cases.slice(0, 4));
    const { deps } = depsFor(files);
    const flow = pastFlow(deps);
    const notEnough = await flow.getFlow(PAST_FOUNDERS_FLOW_ID);
    expect(notEnough.ready).toBe(false);
    expect(notEnough.callsModels).toBe(true);
    expect(notEnough.baseline).toBeNull();
    expect(notEnough.variants).toEqual([]);
    expect(notEnough.dataNote).toContain("Needs at least 8 past cases");
    await expect(flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "sim" })).rejects.toThrow("Simulated agents cannot read real text");

    const noDatasetFlow = pastFlow({ ...deps, datasetsDir: undefined });
    const noDataset = await noDatasetFlow.getFlow(PAST_FOUNDERS_FLOW_ID);
    expect(noDataset.dataNote).toContain("No past cases yet");
    const noDatasetRun = await noDatasetFlow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live" });
    expect(noDatasetRun.ready).toBe(false);
    expect(noDatasetRun.spentUsd).toBe(0);

    const oneCohort = await setup(makeCases({ cohorts: 1, perCohort: 8 }));
    const noPeriods = await pastFlow(depsFor(oneCohort).deps).getFlow(PAST_FOUNDERS_FLOW_ID);
    expect(noPeriods.variants).toEqual([]);
    expect(noPeriods.dataNote).toContain("training period and a later test period");

    const oneSided = makeCases().map((item) => item.cohort === "period-03" || item.cohort === "period-04" ? { ...item, outcome: 1 as const } : item);
    const halfMissing = await pastFlow(depsFor(await setup(oneSided)).deps).getFlow(PAST_FOUNDERS_FLOW_ID);
    expect(halfMissing.variants).toEqual([]);
    expect(halfMissing.dataNote).toContain("each hold at least one company that later did well and one that did not");
  });

  it("measures a two-period baseline but does not try changes without fit and validation periods", async () => {
    const cases = makeCases({ cohorts: 2, perCohort: 4 });
    const files = await setup(cases);
    const flow = pastFlow(depsFor(files).deps, { probe: noRecognition(cases), repetitions: 1 });

    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });

    expect(result.ready).toBe(true);
    expect(result.variants).toHaveLength(1);
    expect(result.rounds).toBe(0);
    expect(result.narrative).toContain("Trying changes needs three periods that each hold a company that later did well and one that did not: two to learn and choose on, and a later one to report.");
  });

  it("overlays only the variant's differences on the current swarm config", async () => {
    const cases = makeCases();
    const files = await setup(cases);
    const initial: SwarmConfig = {
      ...BASE_CONFIG,
      params: { "cweights.traction": 4, "cweights.team": 4 },
    };
    const swarm = { id: "swarm-a", configId: "cfg-current" };
    const current: SwarmConfig = {
      ...BASE_CONFIG,
      id: "cfg-current",
      label: "Current",
      params: { unrelated: 3, "cweights.traction": 2, "cweights.team": 2 },
      lessons: { "assess.company": ["Keep this existing guidance."] },
    };
    const store = {
      getSwarm: () => swarm,
      getConfig: () => current,
    };
    const { deps } = depsFor(files, { mode: "weights", store });
    const flow = pastFlow(deps, { initialConfig: initial, probe: noRecognition(cases), repetitions: 1 });
    const result = await flow.runRounds(PAST_FOUNDERS_FLOW_ID, { brain: "live", rounds: 1, budgetUsd: 100 });
    const config = await flow.variantConfig(PAST_FOUNDERS_FLOW_ID, { variant: result.bestVariant!, swarmId: "swarm-a" });

    expect(config.params.unrelated).toBe(3);
    expect(config.params["cweights.traction"]).toBe(5);
    expect(config.params["cweights.team"]).toBe(2);
    expect(config.lessons?.["assess.company"]).toContain("Keep this existing guidance.");
    expect(config.id).toContain("cfg_past-founders_");
  });

});
