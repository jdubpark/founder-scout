import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BASE_CONFIG,
  DIMENSIONS,
  type Assessment,
  type Feedback,
  type Founder,
  type Judgment,
  type Swarm,
  type SwarmConfig,
} from "@agentswarm/shared";
import type { EvalDeps } from "../contracts";
import { openStore } from "../db";
import {
  PARTNER_CALLS_FLOW_ID,
  createPartnerEval,
  partnerAgreement,
  partnerSplit,
  passesAcceptance,
  type PartnerEvaluation,
} from "./partner";

const scratchDirs: string[] = [];
const stores: ReturnType<typeof openStore>[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface SeedCase {
  founderId: string;
  verdict: Feedback["verdict"];
  split: "train" | "test";
}

interface SeedOptions {
  perClassPerSplit?: number;
  reverseTestLabels?: boolean;
  planted?: boolean;
  zeroWeights?: boolean;
}

function makeSwarm(id: string): Swarm {
  const createdAt = "2026-11-12T00:00:00.000Z";
  return {
    id,
    name: `Swarm ${id}`,
    status: "active",
    thesis: { summary: "Seed-stage software companies.", sectors: [], stages: [], geos: [], avoid: [] },
    configId: BASE_CONFIG.id,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeFounder(id: string, swarmId: string, fit = 0.9): Founder {
  return {
    id,
    swarmId,
    name: `Founder ${id}`,
    headline: "Builder",
    location: "New York",
    company: { name: `Company ${id}`, url: null, oneLiner: "Software company", stage: "seed" },
    links: { github: null, linkedin: null, x: null, site: null, scholar: null },
    status: "surfaced",
    fit,
    fitReasons: [],
    tags: [],
    identityConfidence: 1,
    sources: ["github"],
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    lastAssessedAt: "2026-11-12T00:00:00.000Z",
    nextRecheckAt: null,
    simId: null,
  };
}

function makeJudgments(verdict: Feedback["verdict"], planted: boolean): Judgment[] {
  return DIMENSIONS.map((dimension) => ({
    dimension: dimension.id,
    level: planted && dimension.id === "built_hard_things"
      ? verdict === "yes" ? 4 : 0
      : 2,
    confidence: 1,
    rationale: "Frozen eval fixture judgment.",
    evidenceIds: [],
    counterEvidenceIds: [],
  }));
}

function makeAssessment(id: string, founderId: string, verdict: Feedback["verdict"], planted: boolean): Assessment {
  return {
    id,
    founderId,
    runId: null,
    configId: BASE_CONFIG.id,
    composite: 0.5,
    cracked: 0.5,
    founderScore: 0.5,
    coverage: 1,
    potential: 0.5,
    fit: 0.1,
    decision: "watch",
    reasons: [],
    flags: [],
    breakdown: [],
    judgments: makeJudgments(verdict, planted),
    summary: "Frozen fixture assessment.",
    memo: null,
    createdAt: "2026-11-12T00:00:00.000Z",
  };
}

function makeFeedback(id: string, founderId: string, verdict: Feedback["verdict"], createdAt: string): Feedback {
  return { id, founderId, author: "Partner", verdict, reasonTags: [], note: null, createdAt };
}

function tempFlowDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentswarm-partner-eval-"));
  scratchDirs.push(dir);
  return dir;
}

function makeFixture(options: SeedOptions = {}) {
  const store = openStore(":memory:");
  stores.push(store);
  const perClassPerSplit = options.perClassPerSplit ?? 4;
  const swarms = [makeSwarm("swm_partner_a"), makeSwarm("swm_partner_b")];
  for (const swarm of swarms) store.insertSwarm(swarm);
  const params = { ...BASE_CONFIG.params };
  for (const dimension of DIMENSIONS) {
    params[`weights.${dimension.id}`] = options.zeroWeights ? 0 : dimension.defaultWeight;
  }
  params["weights.built_hard_things"] = 0;
  const config: SwarmConfig = { ...BASE_CONFIG, params };
  store.saveConfig(config);

  const seedCases: SeedCase[] = [];
  let sequence = 0;
  for (const split of ["train", "test"] as const) {
    for (const expectedVerdict of ["yes", "no"] as const) {
      let filled = 0;
      while (filled < perClassPerSplit) {
        const founderId = `fnd_partner_${String(sequence++).padStart(3, "0")}`;
        if (partnerSplit(founderId) !== split) continue;
        const verdict = options.reverseTestLabels && split === "test"
          ? expectedVerdict === "yes" ? "no" : "yes"
          : expectedVerdict;
        const swarm = swarms[seedCases.length % swarms.length]!;
        const founder = makeFounder(founderId, swarm.id);
        store.insertFounder(founder);
        store.insertAssessment(makeAssessment(`asm_${founderId}`, founderId, verdict, options.planted ?? true));
        // An older opposite call proves that the flow labels the founder with latestCalls.
        const oldVerdict = verdict === "yes" ? "no" : "yes";
        store.insertFeedback(makeFeedback(`fbk_old_${founderId}`, founderId, oldVerdict, "2026-11-01T00:00:00.000Z"));
        store.insertFeedback(makeFeedback(`fbk_new_${founderId}`, founderId, verdict, "2026-11-02T00:00:00.000Z"));
        seedCases.push({ founderId, verdict, split });
        filled += 1;
      }
    }
  }

  const flowsDir = tempFlowDir();
  const deps: EvalDeps = {
    store,
    jobs: {} as EvalDeps["jobs"],
    executeJob: async () => { throw new Error("Partner-call evaluation must remain model-free."); },
    flowsDir,
    now: () => new Date("2026-11-12T12:00:00.000Z"),
  };
  return { store, deps, seedCases, eval: createPartnerEval(deps, { bootstrapSamples: 100, seed: 17 }) };
}

function addFounderCall(
  fixture: ReturnType<typeof makeFixture>,
  founderId: string,
  verdict: Feedback["verdict"],
): void {
  if (fixture.store.getFounder(founderId)) {
    fixture.store.insertFeedback(makeFeedback(`fbk_added_${founderId}`, founderId, verdict, "2026-11-12T11:00:00.000Z"));
    return;
  }
  const swarm = fixture.store.listSwarms()[0]!;
  fixture.store.insertFounder(makeFounder(founderId, swarm.id));
  fixture.store.insertAssessment(makeAssessment(`asm_${founderId}`, founderId, verdict, true));
  fixture.store.insertFeedback(makeFeedback(`fbk_added_${founderId}`, founderId, verdict, "2026-11-12T11:00:00.000Z"));
}

describe("partner-calls eval flow", () => {
  it("hashes founders evenly into stable halves", () => {
    const halves = Array.from({ length: 1000 }, (_, index) => partnerSplit(`fnd_${index}`));
    const testCount = halves.filter((split) => split === "test").length;
    expect(testCount).toBeGreaterThan(450);
    expect(testCount).toBeLessThan(550);
    expect(partnerSplit("fnd_stable")).toBe(partnerSplit("fnd_stable"));
  });

  it("returns a deficit DTO without writing artifacts before each split has four calls per verdict", async () => {
    const fixture = makeFixture({ perClassPerSplit: 4 });
    const missingTestYes = fixture.seedCases.find((item) => item.split === "test" && item.verdict === "yes")!;
    const latest = fixture.store.listFeedback(missingTestYes.founderId).at(-1)!;
    // Move one latest test yes call to no, leaving only three yes calls in that split.
    const testYes = fixture.seedCases.filter((item) => item.split === "test" && item.verdict === "yes");
    for (const item of testYes.slice(0, 1)) {
      fixture.store.insertFeedback(makeFeedback(`fbk_flip_${item.founderId}`, item.founderId, "no", "2026-11-03T00:00:00.000Z"));
    }
    expect(latest.verdict).toBe("yes");
    const [summary] = await fixture.eval.listFlows();
    const fromGet = await fixture.eval.getFlow(PARTNER_CALLS_FLOW_ID);
    const fromRun = await fixture.eval.runRounds(PARTNER_CALLS_FLOW_ID);
    expect(summary).toMatchObject({ id: PARTNER_CALLS_FLOW_ID, baseline: null, best: null });
    expect(fromGet).toMatchObject({
      baseline: null,
      best: null,
      bestVariant: null,
      variants: [],
      ready: false,
      callsModels: false,
      dataNote: expect.stringContaining("Needs 4 Yes and 4 No calls in each half of a fixed random split"),
    });
    expect(fromRun.spentUsd).toBe(0);
    const { spentUsd: _spentUsd, ...runDto } = fromRun;
    expect(runDto).toEqual(fromGet);
    expect(fromGet.dataNote).not.toMatch(/\b(train|test):/);
    expect(existsSync(join(fixture.deps.flowsDir, PARTNER_CALLS_FLOW_ID))).toBe(false);
  });

  it("serializes a read concurrent with a round so it cannot erase the round state", async () => {
    const fixture = makeFixture({ perClassPerSplit: 8, planted: true });
    await Promise.all([
      fixture.eval.getFlow(PARTNER_CALLS_FLOW_ID),
      fixture.eval.runRounds(PARTNER_CALLS_FLOW_ID, { rounds: 1 }),
    ]);
    const state = JSON.parse(readFileSync(join(fixture.deps.flowsDir, PARTNER_CALLS_FLOW_ID, "_state.json"), "utf8")) as {
      best: string;
      tried: Array<{ id: string }>;
    };
    expect(state.best).toBe("v1");
    expect(state.tried.map((item) => item.id)).toEqual(["baseline", "v1"]);
  });

  it("keeps the founder split fixed when a newer partner call changes the label", async () => {
    const fixture = makeFixture({ perClassPerSplit: 8 });
    const base = fixture.store.getConfig(BASE_CONFIG.id)!;
    fixture.store.saveConfig({
      ...base,
      params: { ...base.params, "weights.built_hard_things": 1 },
    });
    expect((await fixture.eval.runRounds(PARTNER_CALLS_FLOW_ID, { rounds: 0 })).variants).toHaveLength(1);
    const before = await fixture.eval.getFlow(PARTNER_CALLS_FLOW_ID);
    const changed = fixture.seedCases.find((item) => item.split === "train" && item.verdict === "yes")!;
    const flowDir = join(fixture.deps.flowsDir, PARTNER_CALLS_FLOW_ID);
    const resultFile = join(flowDir, "baseline", "results.jsonl");
    const beforeResult = readFileSync(resultFile, "utf8").split("\n")
      .filter(Boolean).map((line) => JSON.parse(line) as {
        founderId: string;
        prompt_id: string;
        rep: number;
        prompt: string;
        tags: string[];
        grade: Record<string, number>;
        model: string;
        usage: { input_tokens: number; output_tokens: number };
        cost_usd: number;
        unpriced_calls: number;
        status: string;
        verdict: string;
      })
      .find((row) => row.founderId === changed.founderId)!;
    const state = JSON.parse(readFileSync(join(flowDir, "_state.json"), "utf8")) as {
      tried: Array<{ id: string; key: string; kept: boolean }>;
      best: string;
      current_round: number;
    };
    addFounderCall(fixture, changed.founderId, "no");
    const after = await fixture.eval.getFlow(PARTNER_CALLS_FLOW_ID);
    const afterResult = readFileSync(resultFile, "utf8").split("\n")
      .filter(Boolean).map((line) => JSON.parse(line) as { founderId: string; verdict: string })
      .find((row) => row.founderId === changed.founderId)!;

    expect(after.cases).toEqual(before.cases);
    expect(after.variants[0]!.train.agreement).toBeLessThan(before.variants[0]!.train.agreement!);
    expect(after.variants[0]!.test.agreement).toBe(before.variants[0]!.test.agreement);
    expect(beforeResult.verdict).toBe("yes");
    expect(beforeResult).toMatchObject({
      prompt_id: changed.founderId,
      rep: 1,
      tags: ["yes", "train"],
      model: "frozen-assessment",
      usage: { input_tokens: 0, output_tokens: 0 },
      cost_usd: 0,
      unpriced_calls: 0,
      status: "ok",
    });
    expect(afterResult.verdict).toBe("no");
    expect(state).toMatchObject({
      tried: [{ id: "baseline", key: "", kept: true }],
      best: "baseline",
      current_round: 0,
    });
    expect(existsSync(join(flowDir, "metrics.md"))).toBe(true);
    expect(existsSync(join(flowDir, "narrative.md"))).toBe(true);
  });

  it("counts tied yes/no scores as half agreement", () => {
    expect(partnerAgreement([
      { founderId: "yes_high", verdict: "yes", score: 0.8 },
      { founderId: "yes_tie", verdict: "yes", score: 0.5 },
      { founderId: "no", verdict: "no", score: 0.5 },
    ])).toBe(0.75);
    expect(partnerAgreement([{ founderId: "yes", verdict: "yes", score: 0.7 }])).toBeNull();
  });

  it("chooses the proposal from training data even when held-out labels change", async () => {
    const first = makeFixture({ perClassPerSplit: 8 });
    const second = makeFixture({ perClassPerSplit: 8, reverseTestLabels: true });
    const [firstFlow, secondFlow] = await Promise.all([
      first.eval.runRounds(PARTNER_CALLS_FLOW_ID, { rounds: 1 }),
      second.eval.runRounds(PARTNER_CALLS_FLOW_ID, { rounds: 1 }),
    ]);
    const firstProposal = firstFlow.variants.find((variant) => variant.id === "v1")!;
    const secondProposal = secondFlow.variants.find((variant) => variant.id === "v1")!;

    expect(firstProposal.description).toBe(secondProposal.description);
    expect(firstProposal.rationale).toBe(secondProposal.rationale);
    expect(firstProposal.changes).toEqual(secondProposal.changes);
    expect(firstProposal.description).toContain(" → ");
    expect(firstProposal.changes[0]).toBe(firstProposal.description);
    const tried = JSON.parse(readFileSync(join(first.deps.flowsDir, PARTNER_CALLS_FLOW_ID, "_state.json"), "utf8")) as {
      tried: Array<{ key: string }>;
    };
    expect(tried.tried[1]?.key).toMatch(/^(weights\.[\w_]+|assess\.(unknown_prior|surface_threshold|min_coverage))=/);
  });

  it("keeps the planted useful weight change and rejects a random-label improvement", async () => {
    const planted = makeFixture({ perClassPerSplit: 8, planted: true });
    const plantedFlow = await planted.eval.runRounds(PARTNER_CALLS_FLOW_ID, { rounds: 1 });
    const plantedVariant = plantedFlow.variants.find((variant) => variant.id === "v1")!;
    expect(plantedVariant.description).toBe("Weight: Built hard things 0 → 1");
    expect(plantedVariant.changes).toEqual([plantedVariant.description]);
    expect((await planted.eval.getFlow(PARTNER_CALLS_FLOW_ID)).variants.find((variant) => variant.id === "v1")?.changes)
      .toEqual([plantedVariant.description]);
    const state = JSON.parse(readFileSync(join(planted.deps.flowsDir, PARTNER_CALLS_FLOW_ID, "_state.json"), "utf8")) as {
      tried: Array<{ key: string }>;
    };
    expect(state.tried[1]?.key).toBe("weights.built_hard_things=1");
    expect(plantedVariant.status).toBe("champion");
    expect(plantedVariant.test.agreement).toBeGreaterThan(plantedFlow.variants[0]!.test.agreement!);
    const variantDir = join(planted.deps.flowsDir, PARTNER_CALLS_FLOW_ID, plantedVariant.id);
    expect(JSON.parse(readFileSync(join(variantDir, "summary.json"), "utf8"))).toEqual({
      description: plantedVariant.description,
      target: "agreement",
      status: "kept",
    });
    expect(readFileSync(join(variantDir, "change.md"), "utf8").split("\n")[0]).toBe(plantedVariant.description);
    expect(readFileSync(join(variantDir, "change.patch"), "utf8")).toContain("--- previous/config.json");
    expect(existsSync(join(variantDir, "results.jsonl"))).toBe(true);

    const random = makeFixture({ perClassPerSplit: 8, planted: false });
    const randomFlow = await random.eval.runRounds(PARTNER_CALLS_FLOW_ID, { rounds: 1 });
    const randomVariant = randomFlow.variants.find((variant) => variant.id === "v1");
    expect(randomVariant).toBeUndefined();
    expect(randomFlow.bestVariant).toBe("baseline");
  });

  it("rejects a test improvement that increases the no-surfaced rate", async () => {
    const fixture = makeFixture({ perClassPerSplit: 8, planted: true, zeroWeights: true });
    const noCall = fixture.seedCases.find((item) => item.split === "test" && item.verdict === "no")!;
    const assessment = fixture.store.latestAssessment(noCall.founderId)!;
    fixture.store.insertAssessment({
      ...assessment,
      id: `asm_high_no_${noCall.founderId}`,
      createdAt: "2026-11-13T00:00:00.000Z",
      judgments: assessment.judgments.map((judgment) =>
        judgment.dimension === "built_hard_things" ? { ...judgment, level: 4 } : judgment,
      ),
    });

    const flow = await fixture.eval.runRounds(PARTNER_CALLS_FLOW_ID, { rounds: 1 });
    const variant = flow.variants.find((entry) => entry.id === "v1")!;
    expect(variant.train.agreement).toBeGreaterThan(flow.variants[0]!.train.agreement!);
    expect(variant.test.agreement).toBeGreaterThan(flow.variants[0]!.test.agreement!);
    expect(variant.test.no_surfaced).toBeGreaterThan(flow.variants[0]!.test.no_surfaced!);
    expect(variant.status).toBe("reverted");
    expect(flow.bestVariant).toBe("baseline");
  });

  it("never scores simulated and live answers together, and starts again when live calls arrive", async () => {
    const fixture = makeFixture();
    const simulated = await fixture.eval.getFlow(PARTNER_CALLS_FLOW_ID);
    expect(simulated.baseline).not.toBeNull();
    expect(simulated.realData).toBe(false);
    expect(simulated.ready).toBe(true);
    expect(simulated.callsModels).toBe(false);

    // One founder assessed by a live run gets a call. From now on only live answers count, and
    // one case is far too few, so the eval waits instead of blending it with sixteen simulated ones.
    const swarm = fixture.store.listSwarms()[0]!;
    fixture.store.insertRun({
      id: "run_live_1", swarmId: swarm.id, trigger: "manual", brain: "live", sources: "live", status: "succeeded", stage: null,
      configId: BASE_CONFIG.id, budgetUsd: 5, costUsd: 1, stats: {} as never, error: null, simDay: null,
      startedAt: "2026-11-12T09:00:00.000Z", finishedAt: "2026-11-12T09:10:00.000Z",
    });
    fixture.store.insertFounder(makeFounder("fnd_partner_live", swarm.id));
    fixture.store.insertAssessment({ ...makeAssessment("asm_live", "fnd_partner_live", "yes", true), runId: "run_live_1" });
    fixture.store.insertFeedback(makeFeedback("fbk_live", "fnd_partner_live", "yes", "2026-11-12T11:30:00.000Z"));

    const afterLive = await fixture.eval.getFlow(PARTNER_CALLS_FLOW_ID);
    expect(afterLive.realData).toBe(true);
    expect(afterLive.baseline).toBeNull();
    expect(afterLive.variants).toEqual([]);
    expect(afterLive.dataNote).toContain("1 Yes");
  });

  it("keeps a change that holds agreement and clearly surfaces fewer noes, and nothing that lowers agreement", () => {
    const evaluation = (agreement: number, noSurfaced: number): PartnerEvaluation => ({
      train: { agreement, no_surfaced: noSurfaced, yes_surfaced: 0.5 },
      test: { agreement, no_surfaced: noSurfaced, yes_surfaced: 0.5 },
      interval: null,
      noiseFloor: 0.1,
    });
    const current = evaluation(0.8, 0.3);
    // Agreement unchanged, a third fewer noes surfaced: a free improvement.
    expect(passesAcceptance(evaluation(0.8, 0.2), current)).toBe(true);
    // A gain beyond the noise with noes no worse is kept as before.
    expect(passesAcceptance(evaluation(0.95, 0.3), current)).toBe(true);
    // A gain inside the noise is not, and neither is any change that lowers agreement or surfaces more noes.
    expect(passesAcceptance(evaluation(0.85, 0.3), current)).toBe(false);
    expect(passesAcceptance(evaluation(0.79, 0.1), current)).toBe(false);
    expect(passesAcceptance(evaluation(0.95, 0.4), current)).toBe(false);
  });
});
