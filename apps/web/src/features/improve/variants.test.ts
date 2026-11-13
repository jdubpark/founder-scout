import { describe, expect, it } from "vitest";
import { BASE_CONFIG, type EvalFlowDTO, type EvalVariant } from "@agentswarm/shared";
import { canUseVariant, inUseVariant } from "./variants";

const variant = (id: string, status: EvalVariant["status"]): EvalVariant => ({
  id, round: id === "baseline" ? 0 : Number(id.slice(1)), description: id, rationale: "", status,
  train: {}, test: {}, testInterval: null, costUsd: 0, config: { ...BASE_CONFIG, id: `cfg_${id}` }, changes: [], createdAt: "2026-11-13T00:00:00.000Z",
});
const flow = (promotedVariant: string | null, variants: EvalVariant[]): EvalFlowDTO => ({
  id: "ranking", label: "Ranking", description: "", headlineMetric: "rank", baseline: 0.5, best: 0.6, rounds: 1, updatedAt: null,
  metrics: [], goal: { target: "rank", direction: "higher", hold: [] }, cases: { train: 4, test: 4, reps: 1 }, noiseFloor: null,
  dataNote: "", variants, bestVariant: "v1", promotedVariant, narrative: "",
});

describe("which round is in use", () => {
  const rounds = [variant("baseline", "baseline"), variant("v1", "champion"), variant("v2", "reverted")];

  it("is the round the server says the swarm's config carries", () => {
    expect(inUseVariant(flow("v1", rounds))).toBe("v1");
  });

  it("is the starting point when the config carries none of this eval's rounds, whatever its id", () => {
    // A swarm that has only had a pool of agents added holds a config with a new id.
    expect(inUseVariant(flow(null, rounds), "cfg_pools_1a2b3c")).toBe("baseline");
    expect(inUseVariant(flow(null, []))).toBeNull();
  });

  it("offers every round the eval did not revert, except the one in use", () => {
    expect(canUseVariant(variant("v1", "champion"), false)).toBe(true);
    expect(canUseVariant(variant("v1", "champion"), true)).toBe(false);
    expect(canUseVariant(variant("v2", "reverted"), false)).toBe(false);
    expect(canUseVariant(variant("baseline", "baseline"), false)).toBe(true);
  });
});
