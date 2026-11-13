import { describe, expect, it } from "vitest";
import {
  BASE_CONFIG,
  EMPTY_MEMBER_STATS,
  JOBS,
  MODEL_JOB_IDS,
  runnerPools,
  type MemberStats,
  type ModelJobId,
  type ModelRoute,
  type PoolMember,
  type Pools,
  type Swarm,
  type SwarmConfig,
} from "@agentswarm/shared";
import { ServiceError } from "../contracts";
import type { PoolsDeps } from "./pools";
import { POOL_WINDOW_DAYS, poolsView, rebalancePools, setPool } from "./pools";

const fixedNow = new Date("2026-11-13T12:00:00.000Z");
const stamp = fixedNow.toISOString();
// A job whose output is evidence the checks then judge, so its pool has something to balance on.
const firstJob = "investigate.background" as const;
const secondJob = MODEL_JOB_IDS.find((id) => id !== firstJob)!;

function route(model: string, provider = "sim"): ModelRoute {
  return { provider: provider as ModelRoute["provider"], model };
}

function member(id: string, share: number, model = `model-${id}`): PoolMember {
  return { id, route: route(model), share, status: "active", note: null };
}

function stats(memberId: string, overrides: Partial<MemberStats> = {}): MemberStats {
  return { ...EMPTY_MEMBER_STATS(memberId), ...overrides };
}

function harness(config: SwarmConfig = BASE_CONFIG, defaultPools?: () => Promise<Pools>) {
  const configs = new Map<string, SwarmConfig>([[config.id, config]]);
  let swarm: Swarm = {
    id: "swarm-test",
    name: "Test swarm",
    status: "active",
    thesis: { summary: "AI tools", sectors: ["AI"], stages: ["Pre-seed"], geos: [], avoid: [] },
    configId: config.id,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const memberStats = new Map<string, MemberStats[]>();
  const statsCalls: Array<{ swarmId: string; jobId: string; sinceIso: string }> = [];
  const store: PoolsDeps["store"] = {
    getSwarm: (id) => id === swarm.id ? swarm : null,
    getConfig: (id) => configs.get(id) ?? null,
    saveConfig: (saved) => { configs.set(saved.id, saved); },
    updateSwarm: (id, patch) => {
      if (id !== swarm.id) throw new Error(`Unexpected swarm ${id}`);
      swarm = { ...swarm, ...patch };
      return swarm;
    },
    transaction: (work) => work(),
    memberStats: (swarmId, jobId, sinceIso) => {
      statsCalls.push({ swarmId, jobId, sinceIso });
      return memberStats.get(jobId) ?? [];
    },
  };
  return {
    deps: { store, now: () => fixedNow, ...(defaultPools ? { defaultPools } : {}) },
    configs,
    swarm: () => swarm,
    setStats: (jobId: string, rows: MemberStats[]) => { memberStats.set(jobId, rows); },
    statsCalls,
  };
}

function expectRefusal(work: () => unknown, status: number, field?: string): ServiceError {
  let caught: unknown;
  try {
    work();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ServiceError);
  const error = caught as ServiceError;
  expect(error.status).toBe(status);
  if (field) expect(error.fields).toHaveProperty(field);
  return error;
}

describe("pools service functions", () => {
  it("views pooled and unpooled model jobs with stats, yield and model label fallback", async () => {
    const configuredRoute = route("sim-model");
    const config: SwarmConfig = {
      ...BASE_CONFIG,
      id: "cfg_view",
      routes: { [secondJob]: configuredRoute },
      pools: { [firstJob]: [member("alpha", 0.5, "not-in-the-model-catalog"), member("idle", 0.5)] },
    };
    const h = harness(config);
    h.setStats(firstJob, [stats("alpha", { tasks: 12, items: 3, supported: 6, costUsd: 3 })]);

    const view = await poolsView(h.deps, "swarm-test");

    expect(view.windowDays).toBe(POOL_WINDOW_DAYS);
    expect(view.pools.map((pool) => pool.jobId)).toEqual(
      JOBS.filter((job) => MODEL_JOB_IDS.includes(job.id as ModelJobId)).map((job) => job.id),
    );
    const pooled = view.pools.find((pool) => pool.jobId === firstJob)!;
    expect(pooled.route).toBeNull();
    expect(pooled.members[0]).toMatchObject({
      id: "alpha",
      modelLabel: "not-in-the-model-catalog",
      stats: stats("alpha", { tasks: 12, items: 3, supported: 6, costUsd: 3 }),
      yieldPerUsd: 2,
    });
    expect(pooled.members[1]?.stats).toEqual(EMPTY_MEMBER_STATS("idle"));
    expect(pooled.members[1]?.yieldPerUsd).toBeNull();
    expect(view.pools.find((pool) => pool.jobId === secondJob)).toMatchObject({
      members: [],
      route: configuredRoute,
    });
    expect(h.statsCalls).toEqual([{ swarmId: "swarm-test", jobId: firstJob, sinceIso: "2026-10-30T12:00:00.000Z" }]);
  });

  it("saves a new config for replacement and empty-list route fallback without changing prior configs", () => {
    const original: SwarmConfig = { ...BASE_CONFIG, id: "cfg_original", label: "Original", pools: { [firstJob]: [member("old", 1)] } };
    const h = harness(original);
    const before = structuredClone(original);

    const saved = setPool(h.deps, "swarm-test", firstJob, { members: [{ id: "new", route: route("custom-model"), share: 1 }] });

    expect(saved).not.toBe(original);
    expect(saved).toMatchObject({ label: "Original", pools: { [firstJob]: [{ id: "new", share: 1, status: "active", note: null }] } });
    expect(h.configs.get("cfg_original")).toEqual(before);
    expect(h.configs.get(saved.id)).toBe(saved);
    expect(h.swarm()).toMatchObject({ configId: saved.id, updatedAt: stamp });

    const removed = setPool(h.deps, "swarm-test", firstJob, { members: [] });
    expect(removed).not.toBe(saved);
    expect(removed.pools?.[firstJob]).toEqual([]);
    expect(h.configs.get(saved.id)).toEqual(saved);
    expect(h.swarm().configId).toBe(removed.id);
  });

  it("refuses unknown swarms, non-model jobs and invalid pool members with their fields", () => {
    const h = harness();
    const valid = { members: [{ id: "alpha", route: route("known"), share: 1 }] };

    expectRefusal(() => setPool(h.deps, "missing", firstJob, valid), 404);
    expectRefusal(() => setPool(h.deps, "swarm-test", "not-a-model-job", valid), 400, "jobId");

    const invalidPool = expectRefusal(() => setPool(h.deps, "swarm-test", firstJob, {
      members: [{ id: "Bad Name", route: route("known"), share: 1 }],
    }), 400, "members");
    expect(invalidPool.fields.members).toContain("A member's name is 1 to 24 lower-case letters, digits or hyphens.");

    const invalidProvider = expectRefusal(() => setPool(h.deps, "swarm-test", firstJob, {
      members: [{ id: "alpha", route: route("known", "not-a-provider"), share: 1 }],
    }), 400, "members");
    expect(invalidProvider.fields.members).toContain("known provider");

    expectRefusal(() => setPool(h.deps, "swarm-test", firstJob, {
      members: [{ id: "alpha", route: route("  "), share: 1 }],
    }), 400, "members");
    expectRefusal(() => setPool(h.deps, "swarm-test", firstJob, {
      members: [{ id: "alpha", route: route("m".repeat(101)), share: 1 }],
    }), 400, "members");
  });

  it("reports share changes without saving when apply is false", async () => {
    const config: SwarmConfig = { ...BASE_CONFIG, id: "cfg_preview", pools: { [firstJob]: [member("alpha", 0.5), member("beta", 0.5)] } };
    const h = harness(config);
    h.setStats(firstJob, [
      stats("alpha", { tasks: 20, items: 10, supported: 10, costUsd: 1 }),
      stats("beta", { tasks: 20, items: 2, supported: 2, costUsd: 1 }),
    ]);

    const result = await rebalancePools(h.deps, "swarm-test", { apply: false });

    expect(result.report).toEqual({ applied: false, pools: [{
      jobId: firstJob,
      label: JOBS.find((job) => job.id === firstJob)!.label,
      changes: [
        "alpha: 50% → 60% of tasks (10.0 supported items per dollar).",
        "beta: 50% → 40% of tasks (2.0 supported items per dollar).",
      ],
      note: null,
    }] });
    expect(result.config).toBeNull();
    expect(h.configs.size).toBe(1);
    expect(h.swarm().configId).toBe(config.id);
  });

  it("saves and points the swarm at a rebalanced config when changes are applied", async () => {
    const config: SwarmConfig = { ...BASE_CONFIG, id: "cfg_apply", pools: { [firstJob]: [member("alpha", 0.5), member("beta", 0.5)] } };
    const h = harness(config);
    h.setStats(firstJob, [
      stats("alpha", { tasks: 20, items: 10, supported: 10, costUsd: 1 }),
      stats("beta", { tasks: 20, items: 2, supported: 2, costUsd: 1 }),
    ]);

    const result = await rebalancePools(h.deps, "swarm-test", { apply: true });

    expect(result.report.applied).toBe(true);
    expect(result.config?.pools?.[firstJob]?.map((item) => item.share)).toEqual([0.6, 0.4]);
    expect(h.configs.get(result.config!.id)).toBe(result.config);
    expect(h.configs.get(config.id)).toEqual(config);
    expect(h.swarm()).toMatchObject({ configId: result.config!.id, updatedAt: stamp });
  });

  it("does not save when shares already match the measured yields", async () => {
    const config: SwarmConfig = { ...BASE_CONFIG, id: "cfg_matched", pools: { [firstJob]: [member("alpha", 0.6), member("beta", 0.4)] } };
    const h = harness(config);
    h.setStats(firstJob, [
      stats("alpha", { tasks: 20, items: 3, supported: 3, costUsd: 1 }),
      stats("beta", { tasks: 20, items: 2, supported: 2, costUsd: 1 }),
    ]);

    const result = await rebalancePools(h.deps, "swarm-test", { apply: true });

    expect(result.report).toEqual({ applied: false, pools: [{
      jobId: firstJob,
      label: JOBS.find((job) => job.id === firstJob)!.label,
      changes: [],
      note: "Shares already match what each member produces.",
    }] });
    expect(result.config).toBeNull();
    expect(h.configs.size).toBe(1);
    expect(h.swarm().configId).toBe(config.id);
  });

  it("benches a member that accepts planted false claims and preserves the final member", async () => {
    const config: SwarmConfig = { ...BASE_CONFIG, id: "cfg_control", pools: { [firstJob]: [member("unreliable", 0.5), member("steady", 0.5)] } };
    const h = harness(config);
    h.setStats(firstJob, [
      stats("unreliable", { controls: 30, controlsFailed: 12 }),
      stats("steady"),
    ]);

    const result = await rebalancePools(h.deps, "swarm-test", { apply: true });

    expect(result.report.applied).toBe(true);
    expect(result.report.pools[0]?.changes).toEqual([
      "unreliable benched. Accepted the planted false claim in 12 of 30 checks.",
    ]);
    expect(result.config?.pools?.[firstJob]).toEqual([
      { ...member("unreliable", 0.5), share: 0, status: "benched", note: "Accepted the planted false claim in 12 of 30 checks." },
      { ...member("steady", 0.5), share: 1 },
    ]);
    expect(h.swarm().configId).toBe(result.config?.id);
  });

  it("returns an empty report and saves nothing when the swarm has no pools", async () => {
    const h = harness();

    const result = await rebalancePools(h.deps, "swarm-test", { apply: true });

    expect(result).toEqual({ report: { applied: false, pools: [] }, config: null });
    expect(h.configs.size).toBe(1);
    expect(h.swarm().configId).toBe(BASE_CONFIG.id);
  });

  it("rebalances configured defaults and saves only the changed job pool", async () => {
    const h = harness(BASE_CONFIG, async () => runnerPools(() => true));
    h.setStats("hunt.look", [
      stats("deepseek-flash", { tasks: 20, items: 10, supported: 10, costUsd: 1 }),
      stats("muse-ember", { tasks: 20, items: 2, supported: 2, costUsd: 1 }),
    ]);

    const result = await rebalancePools(h.deps, "swarm-test", { apply: true });

    expect(result.report.applied).toBe(true);
    expect(result.report.pools.find((pool) => pool.jobId === "hunt.look")?.changes).toHaveLength(2);
    expect(result.config?.pools?.["hunt.look"]?.map((item) => item.share)).toEqual([0.6, 0.4]);
    expect(result.config?.pools?.["hunt.sift"]).toBeUndefined();
  });

  it("keeps a pool saved while default pool resolution is pending", async () => {
    let releaseDefaults!: (pools: Pools) => void;
    const defaults = new Promise<Pools>((resolve) => { releaseDefaults = resolve; });
    const h = harness(BASE_CONFIG, () => defaults);
    h.setStats("hunt.look", [
      stats("deepseek-flash", { tasks: 20, items: 10, supported: 10, costUsd: 1 }),
      stats("muse-ember", { tasks: 20, items: 2, supported: 2, costUsd: 1 }),
    ]);

    const pending = rebalancePools(h.deps, "swarm-test", { apply: true });
    setPool(h.deps, "swarm-test", firstJob, { members: [{ id: "custom", route: route("custom-model"), share: 1 }] });
    releaseDefaults(runnerPools(() => true));
    const result = await pending;

    expect(result.config?.pools?.[firstJob]?.map((item) => item.id)).toEqual(["custom"]);
    expect(result.config?.pools?.["hunt.look"]?.map((item) => item.share)).toEqual([0.6, 0.4]);
  });

  it("leaves the shares of a job that produces no evidence alone, and can still bench one of its members", async () => {
    const checker = "verify.claims" as const;
    const config: SwarmConfig = { ...BASE_CONFIG, id: "cfg_checker", pools: { [checker]: [member("careful", 0.5), member("credulous", 0.5)] } };
    const h = harness(config);
    h.setStats(checker, [stats("careful", { tasks: 40, costUsd: 4 }), stats("credulous", { tasks: 40, costUsd: 0.4 })]);
    const steady = await rebalancePools(h.deps, "swarm-test", { apply: true });
    expect(steady.report).toEqual({ applied: false, pools: [{
      jobId: checker,
      label: JOBS.find((job) => job.id === checker)!.label,
      changes: [],
      note: "This job produces nothing the checks can count, so shares are left as they are.",
    }] });

    h.setStats(checker, [stats("careful", { tasks: 40, controls: 40, controlsFailed: 1 }), stats("credulous", { tasks: 40, controls: 40, controlsFailed: 16 })]);
    const benched = await rebalancePools(h.deps, "swarm-test", { apply: true });
    expect(benched.report.applied).toBe(true);
    expect(benched.config?.pools?.[checker]?.map((item) => [item.id, item.status, item.share])).toEqual([["careful", "active", 1], ["credulous", "benched", 0]]);
  });
});
