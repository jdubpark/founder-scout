import {
  BASE_CONFIG,
  EMPTY_MEMBER_STATS,
  EMPTY_STEERING,
  JOBS,
  MODEL_JOB_IDS,
  PROVIDERS,
  effectiveRoute,
  getModel,
  DEFAULT_REBALANCE,
  memberYield,
  poolProblems,
  producesEvidence,
  rebalance,
  stableId,
  withDefaultPools,
  type JobId,
  type ModelJobId,
  type PoolChange,
  type PoolMember,
  type Pools,
  type PoolsDTO,
  type RebalanceReport,
  type SetPoolInput,
  type SwarmConfig,
} from "@agentswarm/shared";
import type { Store } from "../contracts";
import { ServiceError } from "../contracts";

export const POOL_WINDOW_DAYS = 14;

export interface PoolsDeps {
  store: Pick<Store, "getSwarm" | "getConfig" | "saveConfig" | "updateSwarm" | "transaction" | "memberStats">;
  defaultPools?: () => Promise<Pools>;
  now: () => Date;
}

const modelJobIds = new Set<string>(MODEL_JOB_IDS);

function requireSwarm(deps: PoolsDeps, swarmId: string) {
  const swarm = deps.store.getSwarm(swarmId);
  if (!swarm) throw new ServiceError(404, "Swarm not found.");
  return swarm;
}

function swarmConfig(deps: PoolsDeps, configId: string): SwarmConfig {
  return deps.store.getConfig(configId) ?? BASE_CONFIG;
}

function windowStart(now: Date): string {
  return new Date(now.getTime() - POOL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function copyPools(source: Pools | undefined): Pools {
  const pools: Pools = {};
  for (const [jobId, members] of Object.entries(source ?? {})) {
    pools[jobId as JobId] = members.map((member) => ({ ...member, route: { ...member.route } }));
  }
  return pools;
}

function savePoolsConfig(
  deps: PoolsDeps,
  swarmId: string,
  configId: string,
  pools: Pools,
): SwarmConfig {
  const previous = swarmConfig(deps, configId);
  const next: SwarmConfig = { ...previous, pools };
  if (Object.keys(pools).length === 0) delete next.pools;
  next.id = stableId("cfg", `${swarmId}:${JSON.stringify(pools)}:${previous.id}`);

  deps.store.transaction(() => {
    deps.store.saveConfig(next);
    // The store's update patch type omits this persisted timestamp, though the row supports it.
    deps.store.updateSwarm(swarmId, { configId: next.id, updatedAt: deps.now().toISOString() } as never);
  });
  return next;
}

export async function poolsView(deps: PoolsDeps, swarmId: string): Promise<PoolsDTO> {
  const defaults = await deps.defaultPools?.() ?? {};
  const swarm = requireSwarm(deps, swarmId);
  const config = withDefaultPools(swarmConfig(deps, swarm.configId), defaults);
  const since = windowStart(deps.now());
  const pools = JOBS.filter((job) => modelJobIds.has(job.id)).map((job) => {
    const members = config.pools?.[job.id as ModelJobId];
    if (!members?.length) {
      return {
        jobId: job.id as ModelJobId,
        label: job.label,
        classId: job.classId,
        members: [],
        route: effectiveRoute(job.id as ModelJobId, EMPTY_STEERING, config),
      };
    }

    const stats = deps.store.memberStats(swarmId, job.id as ModelJobId, since);
    const byMember = new Map(stats.map((entry) => [entry.memberId, entry]));
    return {
      jobId: job.id as ModelJobId,
      label: job.label,
      classId: job.classId,
      members: members.map((member) => {
        const memberStats = byMember.get(member.id) ?? EMPTY_MEMBER_STATS(member.id);
        return {
          ...member,
          modelLabel: getModel(member.route.model)?.label ?? member.route.model,
          stats: memberStats,
          yieldPerUsd: memberYield(memberStats),
        };
      }),
      route: null,
    };
  });
  return { pools, windowDays: POOL_WINDOW_DAYS };
}

export function setPool(deps: PoolsDeps, swarmId: string, jobId: string, input: SetPoolInput): SwarmConfig {
  const swarm = requireSwarm(deps, swarmId);
  if (!modelJobIds.has(jobId)) {
    throw new ServiceError(400, "Choose a job that calls a model.", { jobId: "Choose a job that calls a model." });
  }

  const members: PoolMember[] = input.members.map((member) => ({
    id: member.id,
    route: { ...member.route },
    share: member.share,
    status: member.status ?? "active",
    note: null,
  }));
  const problems = poolProblems(members);
  if (problems.length > 0) {
    const message = problems.join(" ");
    throw new ServiceError(400, message, { members: message });
  }
  const invalidRoute = input.members.some((member) =>
    !member.route ||
    !PROVIDERS.some((provider) => provider.id === member.route.provider) ||
    typeof member.route.model !== "string" ||
    member.route.model.trim().length === 0 ||
    member.route.model.length > 100,
  );
  if (invalidRoute) {
    const message = "Choose a known provider and a model name up to 100 characters.";
    throw new ServiceError(400, message, { members: message });
  }

  const current = swarmConfig(deps, swarm.configId);
  const pools = copyPools(current.pools);
  // An empty entry deliberately masks a default pool and sends the job by its ordinary route.
  pools[jobId as ModelJobId] = members;
  return savePoolsConfig(deps, swarmId, current.id, pools);
}

export async function rebalancePools(
  deps: PoolsDeps,
  swarmId: string,
  options: { apply: boolean },
): Promise<{ report: RebalanceReport; config: SwarmConfig | null }> {
  requireSwarm(deps, swarmId);
  const defaults = await deps.defaultPools?.() ?? {};
  // Read again after resolving defaults so a pool saved while the provider check was pending survives.
  const swarm = requireSwarm(deps, swarmId);
  const config = swarmConfig(deps, swarm.configId);
  const effective = withDefaultPools(config, defaults);
  const since = windowStart(deps.now());
  const savedPools = copyPools(config.pools);
  const changes: PoolChange[] = [];
  let changed = false;

  for (const job of JOBS) {
    const members = effective.pools?.[job.id];
    if (!members) continue;
    const result = rebalance(members, deps.store.memberStats(swarmId, job.id, since), DEFAULT_REBALANCE, producesEvidence(job.id));
    changes.push({ jobId: job.id, label: job.label, changes: result.changes, note: result.note });
    if (JSON.stringify(result.members) !== JSON.stringify(members)) {
      changed = true;
      // Rebalanced defaults become an explicit config choice for this job only.
      savedPools[job.id] = result.members;
    }
  }

  if (options.apply && changed) {
    const saved = savePoolsConfig(deps, swarmId, config.id, savedPools);
    return { report: { applied: true, pools: changes }, config: saved };
  }
  return { report: { applied: false, pools: changes }, config: null };
}
