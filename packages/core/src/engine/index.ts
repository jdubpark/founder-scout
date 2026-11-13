import {
  BASE_CONFIG,
  CLASSES_SHOWN_CALLS,
  ZERO_STATS,
  effectiveRoute,
  getJob,
  getParamDef,
  latestCalls,
  numberParam,
  renderSteeringBlock,
  renderCallsBlock,
  resolveSteering,
  stableId,
  swarmIdentity,
  type Agent,
  type JobInput,
  type JobOutput,
  type ModelJobId,
  type Run,
  type RunStats,
  type StageId,
  type Swarm,
  type SwarmConfig,
  type TaskRun,
  type Usage,
} from "@agentswarm/shared";
import { ProviderError, ServiceError } from "../contracts";
import type { EngineDeps, RunController, JobExecution } from "../contracts";
import { redactSensitive } from "../jobs";
import { createRng, hashSeed } from "../sim";
import { runPipelineStages } from "./pipeline";
import { runFinalStages } from "./final-stages";
import type { EngineRuntime, PlainTaskInput, TaskResult } from "./runtime";

const iso = (date: Date): string => date.toISOString();
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

function addUsage(total: Usage, usage: Usage | null): Usage {
  if (!usage) return total;
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
    cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
    webSearches: total.webSearches + usage.webSearches,
  };
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
    } else {
      await new Promise<void>((resolve) => this.queue.push(resolve));
      this.active += 1;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.queue.shift()?.();
    };
  }
}

interface ActiveExecution {
  abort: AbortController;
  promise: Promise<Run>;
  cancelled: boolean;
}

export function createRunController(deps: EngineDeps): RunController {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const executions = new Map<string, ActiveExecution>();

  function markCancelled(runId: string, active: ActiveExecution): Run {
    active.cancelled = true;
    active.abort.abort();
    const current = deps.store.getRun(runId);
    if (!current) throw new ServiceError(404, "Run not found.");
    if (current.status === "queued" || current.status === "running") {
      return deps.store.updateRun(runId, { status: "cancelled" });
    }
    return current;
  }

  function resolveForAgent(agent: Agent | null, key: string, swarmId: string, at: Date) {
    const def = getParamDef(key);
    const isSwarm = def?.appliesTo.includes("swarm") ?? false;
    if (isSwarm) return resolveSteering(deps.store.listDirectives(), swarmIdentity(swarmId), at);
    if (!agent) throw new Error(`Parameter ${key} requires an agent identity.`);
    return resolveSteering(deps.store.listDirectives(), {
      swarmId,
      classId: agent.classId,
      jobId: agent.jobId,
      agentId: agent.id,
    }, at);
  }

  function beginExecution(run: Run, active: ActiveExecution): Promise<Run> {
    let currentRun = run;
    const loadedSwarm = deps.store.getSwarm(run.swarmId);
    if (!loadedSwarm) throw new Error(`Swarm ${run.swarmId} disappeared while the run was being created.`);
    let currentSwarm: Swarm = loadedSwarm;
    let config: SwarmConfig = deps.store.getConfig(run.configId) ?? BASE_CONFIG;
    let agents = deps.store.listAgents(run.swarmId);
    let stats: RunStats = { ...ZERO_STATS };
    let taskSequence = 0;
    let budgetStopped = false;
    let modelTaskStarted = false;
    let activeRun = active;
    let semaphore = new Semaphore(1);
    let context: EngineRuntime | null = null;
    const sim = run.brain === "sim" || run.sources === "sim" ? deps.simWorld : null;

    const persist = () => {
      currentRun = deps.store.updateRun(run.id, {
        stats: { ...stats },
        costUsd: deps.store.runCost(run.id),
      });
      if (context) context.run = currentRun;
    };
    const stopped = () => {
      if (activeRun.cancelled) return true;
      if (deps.store.getSettings().killSwitch) {
        markCancelled(run.id, activeRun);
        return true;
      }
      return false;
    };
    const setStage = (stage: StageId) => {
      if (stopped()) return;
      currentRun = deps.store.updateRun(run.id, { status: "running", stage });
      if (context) context.run = currentRun;
    };
    const addStats = (delta: Partial<RunStats>) => {
      for (const [key, value] of Object.entries(delta) as Array<[keyof RunStats, number]>) {
        stats[key] += value;
      }
      persist();
    };
    const steeringForTask = (agent: Agent) => resolveSteering(deps.store.listDirectives(), {
      swarmId: run.swarmId,
      classId: agent.classId,
      jobId: agent.jobId,
      agentId: agent.id,
    }, now());
    const steeringBlockForTask = (agent: Agent, steering: ReturnType<typeof steeringForTask>): string => {
      const block = renderSteeringBlock(steering, {
        swarms: { [run.swarmId]: currentSwarm.name },
        agents: { [agent.id]: agent.name },
      });
      if (!CLASSES_SHOWN_CALLS.includes(agent.classId)) return block;
      const examples = [...latestCalls(deps.store.allFeedback(run.swarmId)).values()].map((feedback) => {
        const founder = deps.store.getFounder(feedback.founderId);
        const details = founder?.company.oneLiner ?? founder?.headline;
        const about = founder?.company.name && details
          ? `${founder.company.name}: ${details}`
          : founder?.company.name ?? details ?? founder?.name ?? "Candidate";
        return {
          verdict: feedback.verdict,
          about,
          reasonTags: [...feedback.reasonTags],
          note: feedback.note,
          at: feedback.createdAt,
        };
      });
      const callsBlock = renderCallsBlock(examples);
      return [block, callsBlock].filter(Boolean).join("\n\n");
    };
    const taskSeed = (agent: Agent, founderId: string | null, attempt: number) =>
      createRng(hashSeed(run.id, agent.id, founderId ?? "", attempt));

    const makeRecord = (input: Omit<TaskRun, "id" | "runId" | "swarmId" | "trace">): TaskRun => {
      const task: TaskRun = {
        id: stableId("tsk", `${run.id}:${taskSequence++}`),
        runId: run.id,
        swarmId: run.swarmId,
        ...input,
      };
      deps.store.insertTask(task);
      stats.tasks += 1;
      if (task.status === "failed") stats.failures += 1;
      persist();
      return task;
    };

    const recordPlainTask = (input: PlainTaskInput): TaskRun => {
      const agentSteering = steeringForTask(input.agent);
      const job = getJob(input.jobId);
      const route = job.kind === "code" ? null : effectiveRoute(input.jobId, agentSteering, config);
      const at = iso(now());
      const snapshot = {
        directiveIds: [...agentSteering.directiveIds],
        params: Object.fromEntries(Object.entries(agentSteering.params).map(([key, value]) => [key, value.value])),
        block: steeringBlockForTask(input.agent, agentSteering),
      };
      return makeRecord({
        agentId: input.agent.id,
        jobId: input.jobId,
        classId: input.agent.classId,
        stage: input.stage,
        founderId: input.founderId ?? null,
        status: input.status,
        skipReason: input.skipReason ?? null,
        attempt: 1,
        provider: input.provider,
        model: input.model,
        effort: route?.effort ?? null,
        inputSummary: input.inputSummary,
        outputSummary: input.outputSummary ?? null,
        output: input.output ?? null,
        steering: snapshot,
        usage: null,
        costUsd: null,
        latencyMs: null,
        itemsOut: input.itemsOut ?? 0,
        error: input.error ?? null,
        startedAt: at,
        finishedAt: at,
      });
    };

    context = {
      deps,
      run: currentRun,
      swarm: currentSwarm,
      config,
      agents,
      brain: run.brain,
      now,
      stopped,
      persist,
      setStage,
      addStats,
      recordPlainTask,
      resolve: (agent, key) => resolveForAgent(agent, key, run.swarmId, now()),
      runJob: async <J extends ModelJobId>(args: {
        agent: Agent;
        stage: StageId;
        jobId: J;
        input: JobInput<J>;
        founderId?: string | null;
        repoDir?: string | null;
      }): Promise<TaskResult<J> | null> => {
        const { agent, stage, jobId, input, founderId = null, repoDir = null } = args;
        if (stopped()) return null;
        const job = deps.jobs.get(jobId);
        const steering = steeringForTask(agent);
        const route = effectiveRoute(jobId, steering, config);
        const steeringBlock = steeringBlockForTask(agent, steering);
        const taskBudgetUsd = numberParam("budget.task_usd", steering, config);
        const timestamp = iso(now());
        const snapshot = {
          directiveIds: [...steering.directiveIds],
          params: Object.fromEntries(Object.entries(steering.params).map(([key, value]) => [key, value.value])),
          block: steeringBlock,
        };
        const taskBase = {
          agentId: agent.id,
          jobId,
          classId: agent.classId,
          stage,
          founderId,
          attempt: 1,
          provider: route.provider,
          model: route.model,
          effort: route.effort ?? null,
          inputSummary: job.summarizeInput(input),
          outputSummary: null,
          output: null,
          steering: snapshot,
          usage: null,
          costUsd: null,
          latencyMs: null,
          itemsOut: 0,
          error: null,
          startedAt: timestamp,
          finishedAt: null,
        } as const;

        if (agent.status === "paused") {
          const task = makeRecord({ ...taskBase, status: "skipped", skipReason: "Agent is paused.", finishedAt: timestamp });
          return { task, output: null };
        }
        if (!getJob(jobId).enabled) {
          const task = makeRecord({ ...taskBase, status: "skipped", skipReason: "Job is not enabled.", finishedAt: timestamp });
          return { task, output: null };
        }

        const release = await semaphore.acquire();
        try {
          if (stopped()) return null;
          if (deps.store.runCost(run.id) >= run.budgetUsd) {
            budgetStopped = true;
            const task = makeRecord({ ...taskBase, status: "skipped", skipReason: "spend cap reached", finishedAt: iso(now()) });
            stats.skippedBudget += 1;
            persist();
            return { task, output: null };
          }

          const steeringTask = makeRecord({ ...taskBase, status: "running", skipReason: null });
          modelTaskStarted = true;
          let totalUsage: Usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, webSearches: 0 };
          let hasReportedUsage = false;
          let knownCost = 0;
          let hasKnownCost = false;
          let totalLatency = 0;
          const traces: NonNullable<TaskRun["trace"]> = [];
          let finalOutput: JobOutput<J> | null = null;
          let finalError: unknown = null;
          let attempts = 0;
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            if (stopped()) {
              finalError = new ProviderError("cancelled", "Run cancelled.");
              break;
            }
            // Both caps are ceilings on total spend, so each attempt gets only what is left of the
            // run's cap and of this task's cap. Spend recorded for earlier attempts counts.
            const runLeft = run.budgetUsd - deps.store.runCost(run.id);
            const taskLeft = taskBudgetUsd - knownCost;
            const allowance = Math.min(runLeft, taskLeft);
            if (allowance <= 0) {
              if (runLeft <= 0) budgetStopped = true;
              finalError = new ProviderError("budget", runLeft <= 0 ? "The run's spend cap was reached." : "This task's spend cap was reached.");
              break;
            }
            attempts = attempt;
            deps.store.updateTask(steeringTask.id, { attempt });
            const taskContext = {
              swarm: currentSwarm,
              agent,
              steering,
              steeringBlock,
              config,
              route,
              promptVariant: config.promptVariants[jobId] ?? "base",
              now: now(),
              sim,
              rng: taskSeed(agent, founderId, attempt),
            };
            try {
              const execution: JobExecution<J> = await deps.executeJob(jobId, input, taskContext, {
                brain: run.brain,
                repoDir,
                maxBudgetUsd: allowance,
                signal: activeRun.abort.signal,
              });
              finalOutput = execution.output;
              totalUsage = addUsage(totalUsage, execution.usage);
              hasReportedUsage = true;
              if (execution.costUsd !== null) {
                hasKnownCost = true;
                knownCost += execution.costUsd;
              }
              totalLatency += execution.latencyMs;
              traces.push(...execution.trace);
              finalError = null;
              break;
            } catch (error) {
              finalError = error;
              if (error instanceof ProviderError) {
                totalUsage = addUsage(totalUsage, error.usage);
                if (error.usage !== null) hasReportedUsage = true;
                if (error.costUsd !== null) {
                  hasKnownCost = true;
                  knownCost += error.costUsd;
                }
                deps.store.updateTask(steeringTask.id, {
                  attempt,
                  usage: hasReportedUsage ? totalUsage : null,
                  costUsd: hasKnownCost ? knownCost : null,
                });
                persist();
                if (!error.retryable || attempt === 3 || stopped()) break;
                if (run.brain !== "sim") {
                  const jitter = taskSeed(agent, founderId, attempt)();
                  const delay = Math.round(250 * (2 ** (attempt - 1)) * (0.5 + jitter));
                  await Promise.race([
                    sleep(delay),
                    new Promise<void>((resolve) => activeRun.abort.signal.addEventListener("abort", () => resolve(), { once: true })),
                  ]);
                }
                continue;
              }
              break;
            }
          }

          const succeeded = finalOutput !== null && finalError === null;
          const finishedAt = iso(now());
          const outputSummary = succeeded && finalOutput !== null ? job.summarizeOutput(finalOutput) : null;
          const outputItems = succeeded && finalOutput !== null ? job.countItems(finalOutput) : 0;
          const patch = {
            status: succeeded ? "succeeded" as const : "failed" as const,
            attempt: attempts,
            output: succeeded ? finalOutput : null,
            outputSummary,
            usage: hasReportedUsage ? totalUsage : null,
            costUsd: hasKnownCost ? knownCost : null,
            latencyMs: totalLatency,
            itemsOut: outputItems,
            // A provider's refusal or parse error can quote what it was reading.
            error: succeeded ? null : redactSensitive(errorMessage(finalError ?? "Job failed.")),
            finishedAt,
            trace: traces,
          };
          deps.store.updateTask(steeringTask.id, patch);
          const updated = deps.store.getTask(steeringTask.id, { withTrace: true }) ?? { ...steeringTask, ...patch };
          if (!succeeded) stats.failures += 1;
          persist();
          return { task: updated, output: finalOutput };
        } finally {
          release();
        }
      },
    };

    const finish = (status: Run["status"], error: string | null) => {
      const spendCapReached = budgetStopped || (modelTaskStarted && deps.store.runCost(run.id) >= run.budgetUsd);
      const finalStatus = activeRun.cancelled || deps.store.getRun(run.id)?.status === "cancelled"
        ? "cancelled"
        : spendCapReached && status === "succeeded" ? "budget_stopped" : status;
      const finishedAt = iso(now());
      currentRun = deps.store.updateRun(run.id, {
        status: finalStatus,
        stage: null,
        stats: { ...stats },
        costUsd: deps.store.runCost(run.id),
        error: finalStatus === "failed" ? error : null,
        finishedAt,
      });
      deps.store.audit({
        actor: deps.store.getSettings().operatorName,
        action: "run.finished",
        target: run.id,
        detail: { status: finalStatus, costUsd: currentRun.costUsd, stats: currentRun.stats, error: currentRun.error },
      });
      return currentRun;
    };

    const execute = async (): Promise<Run> => {
      try {
        if (stopped()) return finish("cancelled", null);
        currentRun = deps.store.updateRun(run.id, { status: "running" });
        setStage("plan");
        currentSwarm = deps.store.getSwarm(run.swarmId) ?? currentSwarm;
        config = deps.store.getConfig(run.configId) ?? BASE_CONFIG;
        agents = deps.store.listAgents(run.swarmId);
        const planIdentity = swarmIdentity(run.swarmId);
        const planSteering = resolveSteering(deps.store.listDirectives(), planIdentity, now());
        const concurrency = numberParam("run.concurrency", planSteering, config);
        semaphore = new Semaphore(concurrency);
        context!.swarm = currentSwarm;
        context!.config = config;
        context!.agents = agents;
        context!.run = currentRun;
        stats = { ...ZERO_STATS };
        persist();
        if (!stopped()) await runPipelineStages(context!);
        if (!stopped()) await runFinalStages(context!);
        return finish("succeeded", null);
      } catch (error) {
        deps.logger?.error("Run failed unexpectedly.", { runId: run.id, error: errorMessage(error) });
        return finish("failed", errorMessage(error));
      } finally {
        executions.delete(run.id);
      }
    };

    return execute();
  }

  return {
    async start(input) {
      const settings = deps.store.getSettings();
      if (settings.killSwitch) throw new ServiceError(409, "The kill switch is on. Turn it off before starting a run.");
      const swarm = deps.store.getSwarm(input.swarmId);
      if (!swarm) throw new ServiceError(404, "This swarm does not exist.");
      if (swarm.status === "paused") throw new ServiceError(409, "This swarm is paused. Resume it before starting a run.");
      if (deps.store.activeRun(swarm.id)) throw new ServiceError(409, "This swarm already has a queued or running run.");
      const config = deps.store.getConfig(swarm.configId) ?? BASE_CONFIG;
      const at = now();
      const sources = input.sources ?? settings.schedule.sources;
      const brain = input.brain ?? settings.schedule.brain;
      const runSteering = resolveSteering(deps.store.listDirectives(), swarmIdentity(swarm.id), at);
      const budgetUsd = input.budgetUsd ?? numberParam("budget.run_usd", runSteering, config);
      const previous = deps.store.listRuns(swarm.id, 10000).filter((run) => run.simDay !== null);
      const simDay = sources === "sim"
        ? Math.max(-1, ...previous.map((run) => run.simDay ?? -1)) + 1
        : null;
      const run: Run = {
        id: stableId("run", `${swarm.id}:${iso(at)}:${input.trigger}:${deps.store.listRuns(swarm.id, 10000).length}`),
        swarmId: swarm.id,
        trigger: input.trigger,
        brain,
        sources,
        status: "queued",
        stage: "plan",
        configId: config.id,
        budgetUsd,
        costUsd: 0,
        stats: { ...ZERO_STATS },
        error: null,
        simDay,
        startedAt: iso(at),
        finishedAt: null,
      };
      deps.store.insertRun(run);
      const active: ActiveExecution = { abort: new AbortController(), promise: Promise.resolve(run), cancelled: false };
      executions.set(run.id, active);
      active.promise = Promise.resolve().then(() => beginExecution(run, active));
      return run;
    },

    async cancel(runId) {
      const run = deps.store.getRun(runId);
      if (!run) throw new ServiceError(404, "Run not found.");
      const active = executions.get(runId);
      if (!active) {
        if (run.status === "queued" || run.status === "running") {
          return deps.store.updateRun(runId, { status: "cancelled" });
        }
        return run;
      }
      return markCancelled(runId, active);
    },

    async wait(runId) {
      const run = deps.store.getRun(runId);
      if (!run) throw new ServiceError(404, "Run not found.");
      const active = executions.get(runId);
      return active ? active.promise : run;
    },

    async recover() {
      const interrupted = deps.store.interruptedRuns();
      const timestamp = iso(now());
      for (const run of interrupted) {
        let unfinishedCount = 0;
        for (const task of deps.store.listTasks({ runId: run.id })) {
          if (task.status === "queued" || task.status === "running") {
            unfinishedCount += 1;
            deps.store.updateTask(task.id, {
              status: "failed",
              error: "The server stopped while this run was in progress.",
              finishedAt: timestamp,
            });
          }
        }
        deps.store.updateRun(run.id, {
          status: "failed",
          error: "The server stopped while this run was in progress.",
          finishedAt: timestamp,
          costUsd: deps.store.runCost(run.id),
          stats: { ...run.stats, failures: run.stats.failures + unfinishedCount },
        });
        deps.store.audit({
          actor: deps.store.getSettings().operatorName,
          action: "run.recovered",
          target: run.id,
          detail: { status: "failed", error: "The server stopped while this run was in progress." },
        });
      }
      return interrupted.length;
    },
  };
}

