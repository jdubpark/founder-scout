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
    repoDir?: string | null;
  }): Promise<TaskResult<J> | null>;
}

