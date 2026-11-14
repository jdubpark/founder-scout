import { describe, expect, it } from "vitest";
import { BASE_CONFIG } from "@agentswarm/shared";
import type { SimFounder, SimWorld } from "../contracts";
import { createExecuteJob, createJobRegistry } from "../jobs";
import { createProviderRegistry } from "../providers";
import { createSimWorld } from "../sim";
import { ndcg5, precision5 } from "./metrics";
import { EVAL_WORLD_SEED, runEvalCase } from "./runner";

function makeOutcomeControlledWorld(): { world: SimWorld; founders: SimFounder[] } {
  const source = createSimWorld({ seed: EVAL_WORLD_SEED, founders: 10 });
  const founders = source.founders().map((founder, index) => ({
    ...founder,
    // In ID order, one positive lands in the top-five tie window and one outside it.
    outcome: index === 2 || index === 8 ? 1 as const : 0 as const,
  }));
  const foundersById = new Map(founders.map((founder) => [founder.simId, founder]));
  const world: SimWorld = {
    ...source,
    founders: () => founders.map((founder) => ({ ...founder })),
    founder: (simId) => {
      const founder = foundersById.get(simId);
      return founder ? { ...founder } : undefined;
    },
  };
  return { world, founders };
}

describe("evaluation cohort runner", () => {
  it("ranks oracle outcomes perfectly and keeps constant and null controls at the ID-order baseline", async () => {
    const { world, founders } = makeOutcomeControlledWorld();
    const evalCase = {
      id: "cohort_01",
      founderIds: founders.map((founder) => founder.simId),
      tags: ["positive_count:2"],
      prompt: "This cohort contains 2 founders with a known positive simulated outcome.",
    };
    const jobs = createJobRegistry();
    const executeJob = createExecuteJob({ jobs, providers: createProviderRegistry({}) });
    const shared = {
      evalCase,
      repetition: 1,
      config: BASE_CONFIG,
      jobs,
      executeJob,
      world,
      brain: "sim" as const,
      now: () => new Date("2026-11-12T00:00:00.000Z"),
    };

    const oracle = await runEvalCase({
      ...shared,
      scoreFn: (founder) => founder.outcome,
    });
    const constant = await runEvalCase({ ...shared, scoreFn: () => 0.5 });
    const nullControl = await runEvalCase({ ...shared, scoreFn: () => null });

    const oracleOutcomes = oracle.rows.map((row) => row.outcome);
    expect(ndcg5(oracleOutcomes)).toBe(1);
    expect(oracle.metrics.truePositives).toBe(2);
    expect(oracle.metrics.falsePositives).toBe(3);
    expect(constant.rows.every((row) => row.score === 0.5)).toBe(true);
    expect(nullControl.rows.every((row) => row.score === null)).toBe(true);

    const idOrder = [...evalCase.founderIds].sort((left, right) => left.localeCompare(right));
    const expectedJobs = [
      "investigate.background",
      "investigate.code",
      "investigate.company",
      "investigate.media",
      "investigate.redflags",
      "verify.claims",
      "assess.judgments",
    ];
    for (const control of [constant, nullControl]) {
      expect(control.rows.map((row) => row.founderId)).toEqual(idOrder);
      const outcomes = control.rows.map((row) => row.outcome);
      const prevalence = 2 / founders.length;
      expect(precision5(outcomes)).toBeCloseTo(prevalence, 12);
      expect(ndcg5(outcomes)).toBeGreaterThan(0.5 * prevalence);
      expect(ndcg5(outcomes)).toBeLessThan(1.5 * prevalence + 0.1);
      expect(control.rows.every((row) => row.calls.length === 7)).toBe(true);
      expect(control.rows.every((row) => row.calls.map((call) => call.jobId).join(",") === expectedJobs.join(","))).toBe(true);
      expect(control.rows.every((row) => row.calls.every((call) => call.trace.length > 0))).toBe(true);
    }

    const oracleScore = oracle.rows.find((row) => row.founderId === founders[0]!.simId)!.scoring.composite;
    const controlScore = constant.rows.find((row) => row.founderId === founders[0]!.simId)!.scoring.composite;
    expect(controlScore).toBe(oracleScore);
  });
});
