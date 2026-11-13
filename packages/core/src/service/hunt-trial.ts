import { BASE_CONFIG, JOBS, stableId, type Swarm, type SwarmConfig } from "@agentswarm/shared";
import type { HuntTrialInput, HuntTrialResult, Store } from "../contracts";
import { openStore } from "../db";
import { createExecuteJob, createJobRegistry } from "../jobs";
import { createProviderRegistry } from "../providers";
import { createSimRepoFinder, createSimSources, createSimWorld } from "../sim";
import { createSimWebAccess } from "../sources";
import { createRunController } from "../engine";

const TRIAL_TIME = "2026-01-01T00:00:00.000Z";

function buildTrialStore(store: Store, config: SwarmConfig, seed: number): Swarm {
  const swarmId = stableId("swm", `hunt-trial:${seed}`);
  const at = TRIAL_TIME;
  store.saveConfig(config);
  const swarm: Swarm = {
    id: swarmId,
    name: "Hunt yield trial",
    status: "active",
    thesis: {
      summary: "Find strong early technical founders building useful companies.",
      sectors: [], stages: [], geos: [], avoid: [],
    },
    configId: config.id,
    createdAt: at,
    updatedAt: at,
  };
  store.insertSwarm(swarm);
  for (const job of JOBS) {
    store.insertAgent({
      id: stableId("agt", `${swarmId}:${job.id}`), swarmId, jobId: job.id,
      classId: job.classId, name: job.label, status: "active", beat: null, state: {}, createdAt: at,
    });
  }
  return swarm;
}

export function createHuntTrial(env: NodeJS.ProcessEnv = process.env, options: { founders?: number } = {}) {
  return async (input: HuntTrialInput): Promise<HuntTrialResult> => {
    const store = openStore(":memory:");
    try {
      const world = createSimWorld({ seed: input.seed, days: input.days, ...(options.founders === undefined ? {} : { founders: options.founders }) });
      const config = { ...input.config, id: input.config.id || BASE_CONFIG.id };
      const swarm = buildTrialStore(store, config, input.seed);
      const jobs = createJobRegistry();
      const providers = createProviderRegistry(env);
      const executeJob = createExecuteJob({ jobs, providers });
      const sources = createSimSources(world);
      const repositories = createSimRepoFinder(world);
      const runs = createRunController({
        store, jobs, executeJob,
        sources: { sim: sources, live: sources },
        repos: { sim: repositories, live: repositories },
        web: { sim: createSimWebAccess(world), live: createSimWebAccess(world) },
        simWorld: world,
        fundName: "the fund",
        now: () => new Date(TRIAL_TIME),
        sleep: async () => undefined,
      });
      for (let day = 0; day < input.days; day += 1) {
        if (input.signal?.aborted) throw input.signal.reason ?? new Error("Hunt trial cancelled.");
        const started = await runs.start({ swarmId: swarm.id, scope: "hunt", trigger: "eval", brain: input.brain, sources: "sim", budgetUsd: input.budgetUsd / input.days });
        const cancel = () => { void runs.cancel(started.id).catch(() => undefined); };
        input.signal?.addEventListener("abort", cancel, { once: true });
        try {
          await runs.wait(started.id);
          if (input.signal?.aborted) throw input.signal.reason ?? new Error("Hunt trial cancelled.");
        } finally {
          input.signal?.removeEventListener("abort", cancel);
        }
      }
      const hunt = store.getHunt(swarm.id);
      const calls = hunt ? store.listHuntCalls(hunt.id) : [];
      const kept = store.listHuntLeads(swarm.id, 10000).flatMap((lead) => {
        if (!lead.founderId) return [];
        const founder = store.getFounder(lead.founderId);
        const truth = founder?.simId ? world.founder(founder.simId) : undefined;
        if (!founder || !truth || founder.status === "lead" || founder.status === "screened_out") return [];
        return [{ simFounderId: truth.simId, quality: truth.quality, early: truth.stage === "pre-seed" || truth.stage === "seed" }];
      });
      const uniqueKept = [...new Map(kept.map((person) => [person.simFounderId, person])).values()];
      const strongEarly = world.strongEarlyFounders(input.days - 1);
      const allRuns = store.listRuns(swarm.id, input.days + 1);
      const trialTasks = allRuns.flatMap((run) => store.listTasks({ runId: run.id }));
      const runnerTasks = trialTasks.filter((task) => task.jobId === "hunt.look" || task.jobId === "hunt.sift");
      const byModel = new Map<string, typeof runnerTasks>();
      for (const task of runnerTasks.filter((item) => item.jobId === "hunt.look")) {
        const model = task.model || "unknown";
        byModel.set(model, [...(byModel.get(model) ?? []), task]);
      }
      const models = Object.fromEntries([...byModel].map(([model, modelTasks]) => {
        const ids = new Set(modelTasks.map((task) => task.id));
        const pages = calls.filter((call) => call.taskId && ids.has(call.taskId) && call.trailId !== null).length;
        const peopleKept = uniqueKept.filter((person) => {
          const lead = store.listHuntLeads(swarm.id, 10000).find((item) => item.founderId && store.getFounder(item.founderId)?.simId === person.simFounderId);
          return lead?.discoveredByTaskId ? ids.has(lead.discoveredByTaskId) : false;
        }).length;
        const peopleRefused = calls.filter((call) => call.taskId && ids.has(call.taskId)).reduce((sum, call) => sum + call.dropped, 0);
        const plantedFailed = calls.filter((call) => call.taskId && ids.has(call.taskId) && call.control === "failed").length;
        const latencies = modelTasks.map((task) => task.latencyMs).filter((value): value is number => value !== null).sort((a, b) => a - b);
        const middle = Math.floor(latencies.length / 2);
        const medianLatencyMs = latencies.length === 0 ? null : latencies.length % 2
          ? latencies[middle]!
          : (latencies[middle - 1]! + latencies[middle]!) / 2;
        return [model, { pages, peopleKept, peopleRefused, plantedFailed, medianLatencyMs }];
      }));
      const planted = calls.filter((call) => call.tool === "look" && call.trailId === null);
      const stages: Record<string, number> = { "pre-seed": 0, seed: 1, "series A": 2 };
      const latestStage = String(config.params["hunt.latest_stage"] ?? "seed").replaceAll("_", " ");
      const latestRank = stages[latestStage] ?? 1;
      const pages = calls.filter((call) => call.tool === "look" && call.trailId !== null && call.result !== "blocked" && call.result !== "failed").length;
      return {
        kept: uniqueKept,
        strongEarlyAvailable: strongEarly.length,
        strongEarlyFounderIds: strongEarly.map((founder) => founder.simId),
        runnerCalls: runnerTasks.length,
        pages,
        searches: calls.filter((call) => call.tool === "search").length,
        plantedRead: planted.length,
        plantedFailed: planted.filter((call) => call.control === "failed").length,
        lateKept: uniqueKept.filter((person) => (stages[world.founder(person.simFounderId)?.stage ?? "series A"] ?? 2) > latestRank).length,
        costUsd: allRuns.reduce((sum, run) => sum + run.costUsd, 0),
        unpricedCalls: runnerTasks.filter((task) => task.costUsd === null).length,
        models,
      };
    } finally {
      store.close();
    }
  };
}
