import type {
  Agent,
  Brain,
  JobInput,
  JobOutput,
  JobId,
  ModelJobId,
  Run,
  RunStats,
  StageId,
  Swarm,
  SwarmConfig,
  TaskRun,
} from "@agentswarm/shared";
import type { EngineDeps } from "../contracts";

export interface PlainTaskInput {
  agent: Agent;
  stage: StageId;
  jobId: JobId;
  status: TaskRun["status"];
  provider: TaskRun["provider"];
  model: string;
  inputSummary: string;
  founderId?: string | null;
  companyId?: string | null;
  skipReason?: string | null;
  output?: unknown;
  outputSummary?: string | null;
  itemsOut?: number;
  error?: string | null;
}

export interface TaskResult<J extends ModelJobId> {
  task: TaskRun;
  output: JobOutput<J> | null;
}

/** Shared per-run state and task boundary used by the ordered stage handlers. */
export interface EngineRuntime {
  deps: EngineDeps;
  run: Run;
  swarm: Swarm;
  config: SwarmConfig;
  agents: Agent[];
  brain: Brain;
  concurrency: number;
  signal: AbortSignal;
  now(): Date;
  stopped(): boolean;
  persist(): void;
  setStage(stage: StageId): void;
  addStats(delta: Partial<RunStats>): void;
  recordPlainTask(input: PlainTaskInput): TaskRun;
  resolve(agent: Agent | null, key: string): import("@agentswarm/shared").ResolvedSteering;
  runJob<J extends ModelJobId>(input: {
    agent: Agent;
    stage: StageId;
    jobId: J;
    input: JobInput<J>;
    founderId?: string | null;
    /** Set for work on a company, so the company page can list it. */
    companyId?: string | null;
    repoDir?: string | null;
  }): Promise<TaskResult<J> | null>;
}

/** Run independent stage work without starting more than the configured number at once. */
export async function forEachConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  stopped: () => boolean,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && !stopped()) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        await work(items[index]!);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, worker));
  if (failed) throw failure;
}

