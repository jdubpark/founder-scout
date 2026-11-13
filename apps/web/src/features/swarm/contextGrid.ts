import {
  CONTEXT_POOLS,
  CROSSINGS,
  JOB_INPUT_POOLS,
  getJob,
  poolsReadBy,
  type ClassId,
  type ContextPool,
  type Crossing,
  type JobId,
  type ModelJobId,
  type PoolId,
} from "@agentswarm/shared";

/** Whether a job is one that calls a model and so has declared pools. Code jobs read nothing. */
export function isModelJob(jobId: JobId): jobId is ModelJobId {
  return Object.prototype.hasOwnProperty.call(JOB_INPUT_POOLS, jobId);
}

/** The pools one job reads. Empty for a job that calls no model. */
export function poolsForJob(jobId: JobId): PoolId[] {
  return isModelJob(jobId) ? poolsReadBy(jobId) : [];
}

/** Whether any job of this class reads the pool. */
export function classReadsPool(classId: ClassId, pool: PoolId): boolean {
  return (Object.keys(JOB_INPUT_POOLS) as ModelJobId[]).some(
    (jobId) => getJob(jobId).classId === classId && poolsReadBy(jobId).includes(pool),
  );
}

export interface ContextRow {
  pool: ContextPool;
  /** One cell per class, in the order given. */
  cells: Array<{ classId: ClassId; filled: boolean }>;
}

/** The grid: one row per pool in CONTEXT_POOLS order, one cell per class. */
export function contextGrid(classIds: readonly ClassId[]): ContextRow[] {
  return CONTEXT_POOLS.map((pool) => ({
    pool,
    cells: classIds.map((classId) => ({ classId, filled: classReadsPool(classId, pool.id) })),
  }));
}

export function poolLabel(id: PoolId): string {
  return CONTEXT_POOLS.find((pool) => pool.id === id)?.label ?? id;
}

export interface CrossingLine extends Crossing {
  fromLabel: string;
  toLabel: string;
}

/** The crossings, with the pool labels a line shows. */
export function crossingLines(): CrossingLine[] {
  return CROSSINGS.map((crossing) => ({
    ...crossing,
    fromLabel: poolLabel(crossing.from),
    toLabel: poolLabel(crossing.to),
  }));
}

/** Who carries a crossing, as the word on its tag. */
export const CARRIER_LABEL: Record<Crossing["by"], string> = {
  code: "Code",
  person: "Person",
  scouts: "Scouts",
  "fact-checker": "Fact-checker",
  eval: "Eval",
};
