import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BASE_CONFIG, DIMENSIONS, stableId, type SwarmConfig } from "@agentswarm/shared";
import type { ExecuteJob, EvalDeps, JobContext, SimFounder, Store } from "../contracts";
import { createExecuteJob, createJobRegistry } from "../jobs";
import { createProviderRegistry } from "../providers";
import { createSimWorld } from "../sim";
import { writeAtomicFile } from "./persistence";
import {
  candidateChanges,
  createEvalService,
  decideCandidate,
  EVAL_WORLD_SEED,
  proposeTrainChange,
  type Candidate,
  type EvalOptions,
} from "./index";

const roots: string[] = [];
const fixedNow = () => new Date("2026-11-12T12:00:00.000Z");

async function newFlow(options: EvalOptions = {}, executeOverride?: ExecuteJob) {
  const root = await mkdtemp(path.join(tmpdir(), "agentswarm-eval-"));
  roots.push(root);
  const jobs = createJobRegistry();
  const execute = executeOverride ?? createExecuteJob({ jobs, providers: createProviderRegistry({}) });
  const deps: EvalDeps = {
    store: null,
    jobs,
    executeJob: execute,
    flowsDir: root,
    now: fixedNow,
  };
  return { root, jobs, service: createEvalService(deps, options) };
}

async function rows(file: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("assess-ranking persistence", () => {
  it("keeps an existing state intact if a temporary state write fails midway", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-eval-atomic-"));
    roots.push(root);
    const statePath = path.join(root, "_state.json");
    const original = "{\"current_round\":0}\n";
    await writeFile(statePath, original, "utf8");
    await expect(writeAtomicFile(statePath, "{\"current_round\":1}\n", async (temp, contents) => {
      expect(temp).not.toBe(statePath);
      expect(path.dirname(temp)).toBe(path.dirname(statePath));
      expect(await readFile(statePath, "utf8")).toBe(original);
      await writeFile(temp, contents.slice(0, 8), "utf8");
      throw new Error("simulated interrupted write");
    })).rejects.toThrow("simulated interrupted write");
    expect(await readFile(statePath, "utf8")).toBe(original);
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps equal ranking quality when a held metric improves beyond noise, but rejects any target drop", () => {
    const current = { rank_match: 0.5, pedigree_leak: 0.31, cost_usd: 30 };
    const floors = { rank_match: 0.01, pedigree_leak: 0.02, cost_usd: 0.1 };
    const guardrailWin = decideCandidate(current, { ...current, pedigree_leak: 0.2 }, floors, true);
    expect(guardrailWin.keep).toBe(true);
    expect(guardrailWin.rule).toBe("guardrail");
    expect(guardrailWin.rationale).toContain("pedigree leak fell from 0.31 to 0.20 with ranking quality unchanged");

    const smallCostRise = decideCandidate(current, {
      ...current,
      pedigree_leak: 0.2,
      cost_usd: current.cost_usd! * 1.0001,
    }, floors, true);
    expect(smallCostRise.keep).toBe(true);
    expect(smallCostRise.rule).toBe("guardrail");

    const targetLoss = decideCandidate(current, { ...current, rank_match: 0.499999, pedigree_leak: 0.1 }, floors, true);
    expect(targetLoss.keep).toBe(false);
    expect(targetLoss.rationale).toContain("ranking quality fell");
  });

  it("lists all eval flows with real-data labels and includes partner calls only with a store", async () => {
    const noStore = await newFlow({ cohortCount: 4, cohortSize: 8, repetitions: 1 });
    const noStoreFlows = await noStore.service.listFlows();
    expect(noStoreFlows.map((flow) => flow.id)).toEqual(["assess-ranking", "past-founders", "hunt-yield"]);
    expect(noStoreFlows.find((flow) => flow.id === "assess-ranking")?.realData).toBe(false);
    expect(noStoreFlows.find((flow) => flow.id === "past-founders")?.realData).toBe(true);
    const emptyRanking = await noStore.service.getFlow("assess-ranking");
    expect(emptyRanking.dataNote).toBe("Synthetic founders with known outcomes. This shows the loop works; it says nothing yet about real founders.");
    expect(emptyRanking.narrative).toBe("");
    expect(emptyRanking.metrics.map((metric) => metric.label)).toEqual([
      "Ranking quality", "Top five match", "Hits in top 5", "Pedigree leak", "Cost",
    ]);

    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-eval-store-"));
    roots.push(root);
    const jobs = createJobRegistry();
    const service = createEvalService({
      store: { listSwarms: () => [] } as unknown as Store,
      jobs,
      executeJob: createExecuteJob({ jobs, providers: createProviderRegistry({}) }),
      flowsDir: root,
      now: fixedNow,
    });
    const summaries = await service.listFlows();
    expect(summaries.map((flow) => flow.id)).toEqual(["assess-ranking", "partner-calls", "past-founders", "hunt-yield"]);
    expect(summaries.find((flow) => flow.id === "partner-calls")?.realData).toBe(false);
    const partner = await service.getFlow("partner-calls");
    expect(partner.variants).toEqual([]);
    expect(partner.dataNote).toBe("Needs 4 Yes and 4 No calls in each half of a fixed random split. No calls yet.");
    expect(partner.narrative).toBe("");
    expect(partner.metrics.map((metric) => metric.label)).toEqual([
      "Agreement with your calls", "No calls surfaced", "Yes calls surfaced",
    ]);
  });

  it("reverts train-only hunt gains and keeps a held-out gain beyond the world bootstrap noise", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-hunt-eval-"));
    roots.push(root);
    const jobs = createJobRegistry();
    let proposalIndex = 0;
    const service = createEvalService({
      store: null, jobs, executeJob: createExecuteJob({ jobs, providers: createProviderRegistry({}) }), flowsDir: root,
      huntTrial: async ({ seed, config }) => {
        const strongEarlyFounderIds = Array.from({ length: 10 }, (_, index) => `f${index}`);
        const train = seed < 929;
        const depth = Number(config.params["hunt.max_depth"]);
        const count = train ? (depth >= 3 ? 10 : 2) : (depth >= 4 ? 10 : 5);
        return {
          kept: strongEarlyFounderIds.slice(0, count).map((simFounderId) => ({ simFounderId, quality: 0.9, early: true })),
          strongEarlyAvailable: 10, strongEarlyFounderIds, runnerCalls: 1, pages: 1, searches: 0,
          plantedRead: 1, plantedFailed: 0, lateKept: 0, costUsd: 0, unpricedCalls: 0, models: {},
        };
      },
    }, {
      huntPropose: async ({ currentConfig, evaluate }) => {
        proposalIndex += 1;
        const value = proposalIndex === 1 ? 3 : 4;
        const config = { ...currentConfig, params: { ...currentConfig.params, "hunt.max_depth": value } };
        return { key: `hunt.max_depth:${value}`, description: `set max depth to ${value}`, config, train: await evaluate(config) };
      },
    });
    const result = await service.runRounds("hunt-yield", { rounds: 2, brain: "sim" });
    expect(result.variants.map(({ id, status }) => [id, status])).toEqual([
      ["baseline", "baseline"], ["v1", "reverted"], ["v2", "champion"],
    ]);
    expect(result.variants[1]?.train.strong_early_found).toBeGreaterThan(result.variants[0]?.train.strong_early_found ?? 0);
    expect(result.variants[1]?.test.strong_early_found).toBe(result.variants[0]?.test.strong_early_found);
    expect(result.variants[2]?.test.strong_early_found).toBeGreaterThan((result.variants[0]?.test.strong_early_found ?? 0) + (result.noiseFloor ?? 0));
    const liveBaseline = await service.runRounds("hunt-yield", { rounds: 0, brain: "live", budgetUsd: 2 });
    expect(liveBaseline.callsModels).toBe(true);
    await expect(service.runRounds("hunt-yield", { rounds: 1, brain: "live" })).rejects.toMatchObject({ status: 409 });
  });

  it("stores a stable stratified split and recomputes the headline from result rows", async () => {
    const { root, service } = await newFlow({ cohortCount: 8, cohortSize: 8, repetitions: 2 });
    const result = await service.runRounds("assess-ranking", { rounds: 0 });
    const flowDir = path.join(root, "assess-ranking");
    const state = JSON.parse(await readFile(path.join(flowDir, "_state.json"), "utf8")) as {
      train_ids: string[];
      test_ids: string[];
      case_definitions: Array<{ id: string; founderIds: string[]; tags: string[] }>;
    };
    expect(state.train_ids).toHaveLength(4);
    expect(state.test_ids).toHaveLength(4);
    expect(new Set([...state.train_ids, ...state.test_ids]).size).toBe(8);
    expect(state.case_definitions.flatMap((item) => item.founderIds)).toHaveLength(64);
    expect(new Set(state.case_definitions.flatMap((item) => item.founderIds)).size).toBe(64);
    const world = createSimWorld({ seed: EVAL_WORLD_SEED, founders: 1024 });
    for (const item of state.case_definitions) {
      expect(item.founderIds.some((founderId) => world.founder(founderId)?.outcome === 1)).toBe(true);
    }
    const trainTags = new Map<string, number>();
    const allTags = new Map<string, number>();
    for (const item of state.case_definitions) {
      const tag = item.tags[0]!;
      allTags.set(tag, (allTags.get(tag) ?? 0) + 1);
      if (state.train_ids.includes(item.id)) trainTags.set(tag, (trainTags.get(tag) ?? 0) + 1);
    }
    for (const [tag, count] of allTags) {
      expect(Math.abs((trainTags.get(tag) ?? 0) - count / 2)).toBeLessThanOrEqual(0.5);
    }

    const resultRows = await rows(path.join(flowDir, "baseline", "results.jsonl"));
    expect(resultRows).toHaveLength(8 * 2);
    for (const row of resultRows) {
      expect(Object.keys(row.grade as object).sort()).toEqual([
        "cost_usd", "ndcg5", "pedigree_leak", "precision5", "rank_match", "recall5", "top5_match",
      ]);
      expect(row.status).toBe("ok");
      const trace = path.join(flowDir, "baseline", "traces", `${String(row.prompt_id)}_rep${String(row.rep)}.json`);
      const transcript = JSON.parse(await readFile(trace, "utf8")) as Array<{ role: string; content: string }>;
      expect(Array.isArray(transcript)).toBe(true);
      expect(transcript.every((turn) => typeof turn.role === "string" && typeof turn.content === "string")).toBe(true);
    }
    const testIds = new Set(state.test_ids);
    const testRows = resultRows.filter((row) => testIds.has(String(row.prompt_id)));
    const headline = testRows.reduce((sum, row) => sum + Number((row.grade as Record<string, number>).rank_match), 0) / testRows.length;
    expect(result.baseline).toBeCloseTo(headline, 12);
    const saved = JSON.parse(await readFile(path.join(flowDir, "_state.json"), "utf8")) as { train_ids: string[]; test_ids: string[] };
    await service.runRounds("assess-ranking", { rounds: 0 });
    const repeated = JSON.parse(await readFile(path.join(flowDir, "_state.json"), "utf8")) as { train_ids: string[]; test_ids: string[] };
    expect(repeated).toEqual(saved);
  });

  it("resumes a partially written variant by running only missing case and repetition pairs", async () => {
    const options = { cohortCount: 6, cohortSize: 8, repetitions: 2 };
    const initial = await newFlow(options);
    await initial.service.runRounds("assess-ranking", { rounds: 0 });
    const resultsFile = path.join(initial.root, "assess-ranking", "baseline", "results.jsonl");
    const completeRows = await rows(resultsFile);
    const partialRows = completeRows.slice(0, completeRows.length / 2);
    await writeFile(
      resultsFile,
      partialRows.map((row) => JSON.stringify(row)).join("\n") + "\n{\"prompt_id\":\"unfinished\",\"score\":",
      "utf8",
    );

    let calls = 0;
    const jobs = createJobRegistry();
    const execute = createExecuteJob({ jobs, providers: createProviderRegistry({}) });
    const counting = (async (...args: Parameters<ExecuteJob>) => {
      calls += 1;
      return execute(...args);
    }) as ExecuteJob;
    const resumed = createEvalService({ store: null, jobs, executeJob: counting, flowsDir: initial.root, now: fixedNow }, options);
    await resumed.runRounds("assess-ranking", { rounds: 0 });
    expect(calls).toBe((completeRows.length - partialRows.length) * 8 * 7);
    expect(await rows(resultsFile)).toHaveLength(completeRows.length);
  });

  it("writes failed case attempts separately and excludes them from results and means", async () => {
    const base = await newFlow({ cohortCount: 6, cohortSize: 8, repetitions: 1 });
    const jobs = base.jobs;
    const execute = createExecuteJob({ jobs, providers: createProviderRegistry({}) });
    const failedSwarm = stableId("swm", "eval:cohort_01");
    const failing = (async (jobId: Parameters<ExecuteJob>[0], input: Parameters<ExecuteJob>[1], context: JobContext, options: Parameters<ExecuteJob>[3]) => {
      if (context.swarm.id === failedSwarm) throw new Error("synthetic case failure");
      return execute(jobId as never, input as never, context, options);
    }) as ExecuteJob;
    const service = createEvalService({ store: null, jobs, executeJob: failing, flowsDir: base.root, now: fixedNow }, { cohortCount: 6, cohortSize: 8, repetitions: 1 });
    const flow = await service.runRounds("assess-ranking", { rounds: 0 });
    const variantDir = path.join(base.root, "assess-ranking", "baseline");
    const resultRows = await rows(path.join(variantDir, "results.jsonl"));
    const errors = await rows(path.join(variantDir, "errors.jsonl"));
    expect(resultRows).toHaveLength(5);
    expect(resultRows.some((row) => row.prompt_id === "cohort_01")).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("synthetic case failure");
    const state = JSON.parse(await readFile(path.join(base.root, "assess-ranking", "_state.json"), "utf8")) as { test_ids: string[] };
    const heldOut = resultRows.filter((row) => state.test_ids.includes(String(row.prompt_id)));
    const mean = heldOut.reduce((sum, row) => sum + Number((row.grade as Record<string, number>).rank_match), 0) / heldOut.length;
    expect(flow.baseline).toBeCloseTo(mean, 12);
  });

  it("reverts a candidate with any failed case as an incomplete run", async () => {
    const jobs = createJobRegistry();
    const execute = createExecuteJob({ jobs, providers: createProviderRegistry({}) });
    const failCandidateCase: ExecuteJob = async (jobId, input, context, options) => {
      if (context.config.label.startsWith("Round 1:") && context.swarm.id === stableId("swm", "eval:cohort_01")) {
        throw new Error("candidate case failed");
      }
      return execute(jobId as never, input as never, context, options);
    };
    const initialConfig = { ...BASE_CONFIG, params: { ...BASE_CONFIG.params, "weights.built_hard_things": 1 } };
    const propose: EvalOptions["propose"] = async ({ currentConfig }) => ({
      key: "weights.built_hard_things=2",
      description: "Weight: Built hard things 1 → 2",
      reason: "Forced incomplete-run check.",
      config: { ...currentConfig, params: { ...currentConfig.params, "weights.built_hard_things": 2 } },
    });
    const { root, service } = await newFlow({ cohortCount: 6, cohortSize: 8, repetitions: 1, initialConfig, propose }, failCandidateCase);
    const flow = await service.runRounds("assess-ranking", { rounds: 1 });
    expect(flow.variants[1]?.status).toBe("reverted");
    expect(flow.bestVariant).toBe("baseline");
    expect(await readFile(path.join(root, "assess-ranking", "v1", "change.md"), "utf8")).toContain("incomplete run");
    expect((await rows(path.join(root, "assess-ranking", "v1", "errors.jsonl"))).length).toBeGreaterThan(0);
  });

  it("refuses to resume a baseline with a different brain mode", async () => {
    const { service } = await newFlow({ cohortCount: 4, cohortSize: 8, repetitions: 1 });
    await service.runRounds("assess-ranking", { rounds: 0, brain: "sim" });
    await expect(service.runRounds("assess-ranking", { rounds: 0, brain: "live" })).rejects.toThrow(
      "Cannot resume baseline with brain live; its existing results use sim.",
    );
  });

  it("uses only train ids in the proposer and skips candidate keys already in tried", async () => {
    const { root, jobs, service } = await newFlow({ cohortCount: 6, cohortSize: 6, repetitions: 1 });
    const observed: string[][] = [];
    const propose = async (input: Parameters<typeof proposeTrainChange>[0]): Promise<Candidate | null> => {
      observed.push([...input.trainCaseIds]);
      return null;
    };
    const controlled = createEvalService({ store: null, jobs, executeJob: createExecuteJob({ jobs, providers: createProviderRegistry({}) }), flowsDir: root, now: fixedNow }, { cohortCount: 6, cohortSize: 6, repetitions: 1, propose });
    await controlled.runRounds("assess-ranking", { rounds: 1 });
    const state = JSON.parse(await readFile(path.join(root, "assess-ranking", "_state.json"), "utf8")) as { train_ids: string[]; test_ids: string[] };
    expect(observed).toHaveLength(1);
    expect(observed[0]?.length).toBe(3);
    expect(observed[0]?.every((id) => state.train_ids.includes(id))).toBe(true);
    expect(observed[0]?.some((id) => state.test_ids.includes(id))).toBe(false);

    const allCandidates = candidateChanges(BASE_CONFIG, jobs);
    const onlyTrain = ["cohort_train_only"];
    const seen: string[][] = [];
    const proposal = await proposeTrainChange({
      currentConfig: BASE_CONFIG,
      trainCaseIds: onlyTrain,
      tried: allCandidates.map((candidate) => ({ key: candidate.key, kept: false })),
      jobs,
      evaluate: async (_config, ids) => {
        seen.push([...ids]);
        return { rank_match: 0.5, pedigree_leak: 0.1, cost_usd: 0.01 };
      },
    });
    expect(proposal).toBeNull();
    expect(seen).toEqual([onlyTrain]);
  });

  it("falls back to a train-only guardrail improvement when no candidate improves the target", async () => {
    const params = { ...BASE_CONFIG.params, "weights.built_hard_things": 0 };
    const currentConfig = { ...BASE_CONFIG, params };
    const seen: string[][] = [];
    const proposal = await proposeTrainChange({
      currentConfig,
      trainCaseIds: ["train_case"],
      tried: [],
      jobs: createJobRegistry(),
      evaluate: async (config, ids) => {
        seen.push([...ids]);
        return {
          rank_match: 0.5,
          pedigree_leak: config.params["weights.built_hard_things"] === 1 ? 0.1 : 0.3,
          cost_usd: 30,
        };
      },
    });
    expect(proposal?.key).toBe("weights.built_hard_things=1");
    expect(seen.every((ids) => ids.join() === "train_case")).toBe(true);
  });

  it("climbs the default benchmark with the built-in proposer from weak building weights", async () => {
    const params = { ...BASE_CONFIG.params, "weights.built_hard_things": 0, "weights.technical_depth": 0 };
    const initialConfig = { ...BASE_CONFIG, params };
    const { service } = await newFlow({ cohortCount: 24, cohortSize: 20, repetitions: 2, initialConfig });
    const flow = await service.runRounds("assess-ranking", { rounds: 3 });
    const baseline = flow.variants.find((variant) => variant.id === "baseline")!;
    const kept = flow.variants.filter((variant) => variant.round > 0 && variant.status === "champion");
    expect(kept.length).toBeGreaterThan(0);
    expect(flow.best).toBeGreaterThan((baseline.test.rank_match ?? 0) + (flow.noiseFloor ?? 0));
  }, 60_000);

  it("keeps a planted single weight change only when the held-out score improves", async () => {
    const weights: Record<string, number> = Object.fromEntries(DIMENSIONS.map((dimension) => [`weights.${dimension.id}`, 0]));
    weights["weights.communication"] = 1;
    const initialConfig = { ...BASE_CONFIG, params: weights };
    const proposer: EvalOptions["propose"] = async ({ currentConfig }) => ({
      key: "weights.built_hard_things=1",
      description: "Weight: Built hard things 0 → 1",
      reason: "Training cases showed better ranking.",
      config: { ...currentConfig, params: { ...currentConfig.params, "weights.built_hard_things": 1 } },
    });
    const scoreFn = (founder: SimFounder, config: SwarmConfig) => {
      const weight = config.params["weights.built_hard_things"];
      if (typeof weight === "number" && weight > 0) return founder.quality;
      return 1 - founder.quality;
    };
    const { root, service } = await newFlow({
      cohortCount: 12,
      cohortSize: 20,
      repetitions: 2,
      initialConfig,
      propose: proposer,
      scoreFn,
    });
    const result = await service.runRounds("assess-ranking", { rounds: 1 });
    expect(result.variants).toHaveLength(2);
    expect(result.variants[1]?.changes).toContain("Weight: Built hard things 0 → 1");
    expect(result.variants[1]?.status, JSON.stringify({
      baseline: result.variants[0]?.test,
      candidate: result.variants[1]?.test,
      noiseFloor: result.noiseFloor,
    })).toBe("champion");
    expect(result.bestVariant).toBe("v1");
    const patch = await readFile(path.join(root, "assess-ranking", "v1", "change.patch"), "utf8");
    expect(patch).toContain("weights.built_hard_things");
    expect((await readFile(path.join(root, "assess-ranking", "v1", "change.md"), "utf8")).split("\n")[0]).toBe("Weight: Built hard things 0 → 1");
    const stateFile = path.join(root, "assess-ranking", "_state.json");
    const bestScoreBeforeResume = (JSON.parse(await readFile(stateFile, "utf8")) as { best: { test_score: number } }).best.test_score;
    await service.runRounds("assess-ranking", { rounds: 0 });
    const bestScoreAfterResume = (JSON.parse(await readFile(stateFile, "utf8")) as { best: { test_score: number } }).best.test_score;
    expect(bestScoreAfterResume).toBeCloseTo(bestScoreBeforeResume, 12);
  });

  it("reverts a forced harmful change and a target gain that breaches the cost guardrail", async () => {
    const lowWeights: Record<string, number> = Object.fromEntries(DIMENSIONS.map((dimension) => [`weights.${dimension.id}`, 0]));
    lowWeights["weights.built_hard_things"] = 1;
    const force = (nextConfig: typeof BASE_CONFIG, key: string, description: string): EvalOptions["propose"] => async () => ({
      key,
      description,
      reason: "Forced guardrail control.",
      config: nextConfig,
    });
    const harmfulConfig = { ...BASE_CONFIG, params: { ...lowWeights, "weights.built_hard_things": 0 } };
    const rankingScore = (founder: SimFounder, config: SwarmConfig) => {
      const weight = config.params["weights.built_hard_things"];
      if (typeof weight === "number" && weight > 0) return founder.quality;
      return 1 - founder.quality;
    };

    const harmful = await newFlow({
      cohortCount: 10,
      cohortSize: 20,
      repetitions: 2,
      initialConfig: { ...BASE_CONFIG, params: lowWeights },
      propose: force(harmfulConfig, "weights.built_hard_things=0", "Weight: Built hard things 1 → 0"),
      scoreFn: rankingScore,
    });
    const harmfulFlow = await harmful.service.runRounds("assess-ranking", { rounds: 1 });
    expect(harmfulFlow.variants[1]?.status).toBe("reverted");
    expect(harmfulFlow.bestVariant).toBe("baseline");

    const unpricedRoute = { provider: "sim", model: "unpriced", effort: "low" as const };
    const modelJobs = [
      "investigate.background", "investigate.code", "investigate.company", "investigate.media",
      "investigate.redflags", "verify.claims", "assess.judgments",
    ] as const;
    const unpricedRoutes = Object.fromEntries(modelJobs.map((jobId) => [jobId, unpricedRoute])) as SwarmConfig["routes"];
    const cheapConfig: SwarmConfig = {
      ...BASE_CONFIG,
      params: lowWeights,
      routes: unpricedRoutes,
    };
    const expensive = await newFlow({
      cohortCount: 10,
      cohortSize: 20,
      repetitions: 2,
      initialConfig: cheapConfig,
      propose: force({ ...cheapConfig, routes: { ...cheapConfig.routes, "assess.judgments": { provider: "claude-cli", model: "claude-opus-5-5", effort: "high" } } }, "assess.judgments.model=claude-opus-5-5", "Assess model: Claude Opus"),
      scoreFn: (founder, config) => config.routes["assess.judgments"]?.model === "claude-opus-5-5"
        ? founder.quality
        : 1 - founder.quality,
    });
    const costFlow = await expensive.service.runRounds("assess-ranking", { rounds: 1 });
    expect(costFlow.variants[1]?.test.rank_match).toBeGreaterThan(costFlow.variants[0]?.test.rank_match ?? 0);
    expect(costFlow.variants[1]?.costUsd).toBeGreaterThan((costFlow.variants[0]?.costUsd ?? 0) * 1.25);
    expect(costFlow.variants[1]?.status).toBe("reverted");
    expect(costFlow.bestVariant).toBe("baseline");
  });

  it("refuses automatic live rounds after allowing a measured baseline", async () => {
    const { service } = await newFlow({ cohortCount: 4, cohortSize: 8, repetitions: 1 });
    await service.runRounds("assess-ranking", { rounds: 0, brain: "sim" });
    await expect(service.runRounds("assess-ranking", { rounds: 1, brain: "live" })).rejects.toThrow(
      "Automatic eval rounds on real models need a spending approval step",
    );
  });

  it("produces byte-identical local artifacts for identical inputs and injected time", async () => {
    const snapshots: string[][] = [];
    for (let index = 0; index < 2; index += 1) {
      const { root, service } = await newFlow({ cohortCount: 4, cohortSize: 8, repetitions: 1 });
      await service.runRounds("assess-ranking", { rounds: 0 });
      const files = async (base: string, prefix = ""): Promise<string[]> => {
        const entries = await readdir(base, { withFileTypes: true });
        const found: string[] = [];
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
          const full = path.join(base, entry.name);
          const relative = path.join(prefix, entry.name);
          if (entry.isDirectory()) found.push(...await files(full, relative));
          else found.push(`${relative}\n${await readFile(full, "utf8")}`);
        }
        return found;
      };
      snapshots.push(await files(path.join(root, "assess-ranking")));
    }
    expect(snapshots[0]).toEqual(snapshots[1]);
  });

  it("stamps the present when no clock is supplied, as on the server", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-eval-clock-"));
    roots.push(root);
    const jobs = createJobRegistry();
    const executeJob = createExecuteJob({ jobs, providers: createProviderRegistry({}) });
    const service = createEvalService({ store: null, jobs, executeJob, flowsDir: root }, { cohortCount: 4, cohortSize: 8, repetitions: 1 });
    const before = Date.now();
    const flow = await service.runRounds("assess-ranking", { rounds: 0 });
    expect(Date.parse(flow.updatedAt ?? "")).toBeGreaterThanOrEqual(before);
    expect(flow.variants.map((variant) => Date.parse(variant.createdAt) >= before)).toEqual([true]);
  });
});
