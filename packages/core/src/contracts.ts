/**
 * The seams inside the engine. Each interface here is implemented in exactly
 * one directory, so the pieces can be built and tested independently:
 *
 *   Store            src/db
 *   ModelProvider    src/providers
 *   SourceAdapter    src/sources      (live)   and   src/sim   (simulated)
 *   SimWorld         src/sim
 *   JobDefinition    src/jobs
 *   RunController    src/engine
 *   EvalService      src/eval
 *   SwarmService     src/service
 */

import type { z } from "zod";
import type {
  Agent,
  ApiClient,
  Assessment,
  AuditEntry,
  Brain,
  Directive,
  EvalFlowDTO,
  EvalFlowSummary,
  Evidence,
  EvidenceDraft,
  Feedback,
  Founder,
  FounderListDTO,
  FounderQuery,
  FounderStatus,
  InvestigationDepth,
  JobId,
  JobInput,
  JobKind,
  JobOutput,
  Lead,
  Memo,
  ModelJobId,
  ModelRoute,
  OutreachAction,
  OutreachKind,
  OutreachStatus,
  ProfileLinks,
  PromoteVariantInput,
  ProviderId,
  ProviderStatus,
  RawItem,
  RepoContributor,
  RepoRef,
  ResolvedSteering,
  Run,
  RunEvalRoundInput,
  Settings,
  SourceId,
  SourceStatus,
  StartRunInput,
  Swarm,
  SwarmConfig,
  TaskRun,
  Thesis,
  TraceTurn,
  Usage,
  Verification,
  DimensionId,
} from "@agentswarm/shared";

/* ================================================================== */
/* Model providers                                                      */
/* ================================================================== */

export interface ProviderRequest<T> {
  jobId: ModelJobId;
  /** structured = no tools; research = web search and fetch; repo_review = read-only files in repoDir. */
  kind: Extract<JobKind, "structured" | "research" | "repo_review">;
  route: ModelRoute;
  system: string;
  prompt: string;
  /** The output must parse with this schema. */
  schema: z.ZodType<T>;
  /** A short name for the schema, letters, digits and underscores only. */
  schemaName: string;
  /** Checkout the agent may read. Required for repo_review. */
  repoDir?: string | null;
  /** Hard spend ceiling for this one call, when the provider can enforce one. */
  maxBudgetUsd?: number | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProviderResult<T> {
  /** Already validated against the request schema. */
  output: T;
  provider: ProviderId;
  /** The model that actually served the call, read from the response. */
  model: string;
  usage: Usage;
  /** Provider-reported cost, else a list-price estimate, else null. Never a guess. */
  costUsd: number | null;
  latencyMs: number;
  trace: TraceTurn[];
}

export type ProviderErrorKind =
  | "not_configured"
  | "unsupported"
  | "timeout"
  | "rate_limited"
  | "refused"
  | "invalid_output"
  | "budget"
  | "transport"
  | "cancelled";

/** Every provider failure is one of these, so the engine can decide whether to retry. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  /** Usage billed before the failure, when known. Failed spend is still spend. */
  readonly usage: Usage | null;
  readonly costUsd: number | null;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options: { retryable?: boolean; usage?: Usage | null; costUsd?: number | null; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProviderError";
    this.kind = kind;
    this.retryable = options.retryable ?? (kind === "timeout" || kind === "rate_limited" || kind === "transport");
    this.usage = options.usage ?? null;
    this.costUsd = options.costUsd ?? null;
  }
}

export interface ModelProvider {
  readonly id: ProviderId;
  /** Cheap readiness check: binaries and credentials. Must not call a model. */
  status(): Promise<{ configured: boolean; detail: string }>;
  run<T>(req: ProviderRequest<T>): Promise<ProviderResult<T>>;
}

export interface ProviderRegistry {
  get(id: ProviderId): ModelProvider;
  statuses(): Promise<ProviderStatus[]>;
}

/* ================================================================== */
/* Sources                                                              */
/* ================================================================== */

export interface SourceFetchRequest {
  limit: number;
  /** Only items newer than this, when the source supports it. */
  since: string | null;
  /** Whatever this adapter returned as `cursor` last time for this agent. */
  cursor: unknown;
  beat: string | null;
  thesis: Thesis;
  /** Day number in the simulated world. Ignored by live adapters. */
  simDay: number | null;
  signal?: AbortSignal;
}

export interface SourceFetchResult {
  items: RawItem[];
  cursor: unknown;
}

export interface SourceAdapter {
  readonly id: SourceId;
  status(): Promise<{ configured: boolean; detail: string }>;
  fetch(req: SourceFetchRequest): Promise<SourceFetchResult>;
}

export interface SourceRegistry {
  /** null when this source has no adapter in the current mode. */
  get(id: SourceId): SourceAdapter | null;
  statuses(): Promise<SourceStatus[]>;
}

/** Finds a founder's repositories and prepares one for review. */
export interface RepoFinder {
  /** The founder's own most significant repositories, best first. */
  topRepos(links: ProfileLinks, simId: string | null, limit: number): Promise<RepoRef[]>;
  /**
   * Make the repository readable on disk. Returns the ref with `localPath`
   * set, or with `localPath` null when there is nothing to check out (as in
   * simulation). `cleanup` removes anything created.
   */
  checkout(repo: RepoRef): Promise<{ repo: RepoRef; cleanup(): Promise<void> }>;
  /**
   * Who committed to the repository and how much, most commits first, or null when the host
   * cannot say. Optional: the simulated finder has no such record.
   */
  contributors?(repo: RepoRef): Promise<RepoContributor[] | null>;
}

/* ================================================================== */
/* Simulation                                                           */
/* ================================================================== */

/** A synthetic founder with hidden ground truth. Entirely fictional. */
export interface SimFounder {
  simId: string;
  name: string;
  headline: string;
  location: string;
  sector: string;
  stage: string;
  companyName: string;
  companyOneLiner: string;
  links: ProfileLinks;
  /** True level 0..1 per rubric dimension. */
  latent: Record<DimensionId, number>;
  /** 0..1 overall quality the outcome is drawn from. */
  quality: number;
  /**
   * 0..1 prestige of schools and employers. Deliberately only weakly related
   * to quality, so an eval can detect a system that learns to score pedigree.
   */
  pedigree: number;
  /** 1 = the "good outcome" label used by evals. */
  outcome: 0 | 1;
  /** The day this founder first becomes visible in any source. */
  appearsOnDay: number;
  /** Which sources ever show this founder. */
  visibleIn: SourceId[];
}

export interface SimWorld {
  readonly seed: number;
  founders(): SimFounder[];
  founder(simId: string): SimFounder | undefined;
  /** Items a source shows on one day. Deterministic for (source, day). */
  itemsFor(source: SourceId, day: number, limit: number): RawItem[];
  /**
   * Evidence an investigator job would find. Deterministic for the inputs.
   * Includes some items whose hidden truth is not "supported", for the
   * fact-checker to catch.
   */
  evidenceFor(simId: string, jobId: JobId, depth: InvestigationDepth): EvidenceDraft[];
  repos(simId: string): RepoRef[];
  /** A synthetic call transcript consistent with the founder's hidden truth. */
  transcript(simId: string, kind: OutreachKind, targetName: string): string;
}

/* ================================================================== */
/* Jobs                                                                 */
/* ================================================================== */

export interface JobContext {
  swarm: Swarm;
  agent: Agent;
  steering: ResolvedSteering;
  /** Rendered guidance text. Empty string when there is none. */
  steeringBlock: string;
  config: SwarmConfig;
  route: ModelRoute;
  /** Which prompt variant to use for this job. "base" by default. */
  promptVariant: string;
  now: Date;
  /** Present when the task runs against the simulated world. */
  sim: SimWorld | null;
  /** Deterministic random numbers in [0, 1) for this task. */
  rng: () => number;
}

export interface JobDefinition<J extends ModelJobId = ModelJobId> {
  readonly id: J;
  readonly kind: Extract<JobKind, "structured" | "research" | "repo_review">;
  readonly outputSchema: z.ZodType<unknown>;
  /** Names of the prompt variants this job has. Always includes "base". */
  readonly promptVariants: readonly string[];
  /**
   * The live prompt. Must include `ctx.steeringBlock`, fence every piece of
   * outside content as untrusted data, and never include simulator fields.
   */
  buildPrompt(input: JobInput<J>, ctx: JobContext): { system: string; prompt: string };
  /**
   * Deterministic stand-in for the model. Reads only what a model could see
   * plus the simulator's hidden signals, and must respond to the route and to
   * numeric steering the way a real model plausibly would.
   */
  simulate(input: JobInput<J>, ctx: JobContext): JobOutput<J>;
  summarizeInput(input: JobInput<J>): string;
  summarizeOutput(output: JobOutput<J>): string;
  /** How many leads, evidence items, verdicts or judgments the output holds. */
  countItems(output: JobOutput<J>): number;
}

export interface JobRegistry {
  get<J extends ModelJobId>(id: J): JobDefinition<J>;
}

export interface JobExecution<J extends ModelJobId> {
  output: JobOutput<J>;
  provider: ProviderId;
  model: string;
  usage: Usage;
  costUsd: number | null;
  latencyMs: number;
  trace: TraceTurn[];
}

/**
 * Run one job once. With brain "sim" it calls `simulate` and reports the
 * usage and cost the routed model would plausibly have incurred, so budgets
 * and dashboards behave as they will in production. With brain "live" it
 * calls the routed provider. Used by the engine and by the eval runner.
 */
export type ExecuteJob = <J extends ModelJobId>(
  jobId: J,
  input: JobInput<J>,
  ctx: JobContext,
  options: {
    brain: Brain;
    repoDir?: string | null;
    maxBudgetUsd?: number | null;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
) => Promise<JobExecution<J>>;

/* ================================================================== */
/* Store                                                                */
/* ================================================================== */

export interface NodeStatRow {
  agentId: string;
  tasks: number;
  failures: number;
  costUsd: number;
  itemsOut: number;
  lastRunAt: string | null;
  lastOutput: string | null;
}

/**
 * Persistence. Synchronous, backed by SQLite. Every method is a single
 * statement or runs inside a transaction, so callers never see a half-written
 * record.
 */
export interface Store {
  close(): void;
  transaction<T>(fn: () => T): T;

  getSettings(): Settings;
  saveSettings(settings: Settings): void;

  getConfig(id: string): SwarmConfig | null;
  saveConfig(config: SwarmConfig): void;
  listConfigs(): SwarmConfig[];

  listSwarms(): Swarm[];
  getSwarm(id: string): Swarm | null;
  insertSwarm(swarm: Swarm): void;
  updateSwarm(id: string, patch: Partial<Pick<Swarm, "name" | "status" | "thesis" | "configId">>): Swarm;

  listAgents(swarmId: string): Agent[];
  getAgent(id: string): Agent | null;
  insertAgent(agent: Agent): void;
  updateAgent(id: string, patch: Partial<Pick<Agent, "name" | "status" | "beat" | "state">>): Agent;

  /** Every directive that is not archived, plus archived ones when asked. */
  listDirectives(options?: { includeArchived?: boolean }): Directive[];
  getDirective(id: string): Directive | null;
  insertDirective(directive: Directive): void;
  updateDirective(
    id: string,
    patch: Partial<Pick<Directive, "status" | "value" | "text" | "priority" | "note" | "expiresAt">>,
  ): Directive;
  /** How often each directive has been applied to a task, and when last. */
  directiveUsage(): Map<string, { appliedCount: number; lastAppliedAt: string | null }>;

  insertLead(lead: Lead): void;
  listLeads(filter: { swarmId?: string; founderId?: string; unmatchedOnly?: boolean }): Lead[];
  attachLead(leadId: string, founderId: string): void;

  insertFounder(founder: Founder): void;
  getFounder(id: string): Founder | null;
  updateFounder(id: string, patch: Partial<Omit<Founder, "id" | "swarmId">>): Founder;
  /** A founder in this swarm sharing any non-null profile link, compared case-insensitively. */
  findFounderByLinks(swarmId: string, links: ProfileLinks): Founder | null;
  /** Founders in this swarm whose normalised name equals the argument. */
  findFoundersByName(swarmId: string, normalizedName: string): Founder[];
  listFounders(filter: {
    swarmId: string;
    statuses?: FounderStatus[];
    /** Only founders whose nextRecheckAt is at or before this time. */
    recheckDueBefore?: string;
    limit?: number;
  }): Founder[];
  /** The dashboard list: founders joined with their latest assessment and feedback. */
  founderRows(query: FounderQuery): FounderListDTO;

  /** Returns false, and stores nothing, when this founder already has evidence with the same hash. */
  insertEvidence(evidence: Evidence): boolean;
  listEvidence(founderId: string, options?: { verifications?: Verification[] }): Evidence[];
  setVerification(evidenceId: string, verification: Verification, note: string | null): void;

  insertAssessment(assessment: Assessment): void;
  latestAssessment(founderId: string): Assessment | null;
  assessmentHistory(founderId: string): Array<{ at: string; composite: number; decision: Assessment["decision"] }>;
  setMemo(assessmentId: string, memo: Memo): void;

  insertFeedback(feedback: Feedback): void;
  listFeedback(founderId: string): Feedback[];
  /** All feedback for a swarm's founders, oldest first. The labels evals learn from. */
  allFeedback(swarmId: string): Feedback[];

  insertOutreach(action: OutreachAction): void;
  getOutreach(id: string): OutreachAction | null;
  updateOutreach(id: string, patch: Partial<Omit<OutreachAction, "id" | "swarmId" | "founderId">>): OutreachAction;
  listOutreach(filter: { swarmId?: string; founderId?: string; statuses?: OutreachStatus[] }): OutreachAction[];

  insertRun(run: Run): void;
  getRun(id: string): Run | null;
  updateRun(id: string, patch: Partial<Omit<Run, "id" | "swarmId">>): Run;
  /** Newest first. */
  listRuns(swarmId: string, limit: number): Run[];
  /** The swarm's run that is queued or running, if any. */
  activeRun(swarmId: string): Run | null;
  /** Runs left queued or running by a process that died. */
  interruptedRuns(): Run[];

  /** Also records which directives were applied, for directiveUsage. */
  insertTask(task: TaskRun): void;
  updateTask(id: string, patch: Partial<Omit<TaskRun, "id" | "runId" | "swarmId">>): void;
  getTask(id: string, options: { withTrace: boolean }): TaskRun | null;
  /** Oldest first, without traces. */
  listTasks(filter: { runId?: string; founderId?: string; agentId?: string; limit?: number }): TaskRun[];
  /** Sum of known task cost for a run. */
  runCost(runId: string): number;
  /** Per-agent activity since a point in time. */
  nodeStats(swarmId: string, sinceIso: string): NodeStatRow[];

  audit(entry: Omit<AuditEntry, "id" | "at">): AuditEntry;
  recentAudit(limit: number): AuditEntry[];
}

/* ================================================================== */
/* Engine                                                               */
/* ================================================================== */

export interface RunController {
  /**
   * Create a run and start executing it in the background. Resolves with the
   * run record as soon as it exists. Rejects if the kill switch is on, the
   * swarm is paused, or the swarm already has an active run.
   */
  start(input: StartRunInput & { trigger: Run["trigger"] }): Promise<Run>;
  /** Stop starting new tasks for this run and mark it cancelled. */
  cancel(runId: string): Promise<Run>;
  /** Resolves when the run has finished, for tests and the command line. */
  wait(runId: string): Promise<Run>;
  /** Mark runs orphaned by a crash as failed. Call once at startup. */
  recover(): Promise<number>;
}

export interface Logger {
  info(message: string, detail?: Record<string, unknown>): void;
  warn(message: string, detail?: Record<string, unknown>): void;
  error(message: string, detail?: Record<string, unknown>): void;
}

/** What the engine is built from. Implemented by `createRunController` in src/engine. */
export interface EngineDeps {
  store: Store;
  jobs: JobRegistry;
  executeJob: ExecuteJob;
  /** Source adapters for each source mode. */
  sources: { sim: SourceRegistry; live: SourceRegistry };
  repos: { sim: RepoFinder; live: RepoFinder };
  simWorld: SimWorld;
  /** How the fund is named in outreach drafts and disclosures. */
  fundName: string;
  now?: () => Date;
  /** Injected so tests do not wait on retry backoff. */
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
}

/* ================================================================== */
/* Evals                                                                */
/* ================================================================== */

export interface EvalService {
  listFlows(): Promise<EvalFlowSummary[]>;
  getFlow(id: string): Promise<EvalFlowDTO>;
  /** Run the baseline if it is missing, then up to `rounds` improvement rounds. */
  runRounds(id: string, input?: RunEvalRoundInput): Promise<EvalFlowDTO>;
  /** The config of a variant, for promotion into a swarm. */
  variantConfig(id: string, input: PromoteVariantInput): Promise<SwarmConfig>;
}

/** What the eval subsystem is built from. Implemented by `createEvalService` in src/eval. */
export interface EvalDeps {
  /** Needed by flows built from partner calls. Flows on synthetic data work without it. */
  store: Store | null;
  jobs: JobRegistry;
  executeJob: ExecuteJob;
  /** Directory that holds one sub-directory per eval flow. Created when missing. */
  flowsDir: string;
  now?: () => Date;
  logger?: Logger;
}

/* ================================================================== */
/* Service                                                              */
/* ================================================================== */

/**
 * Everything the server and the command line call. `as(actor)` returns the
 * API surface with that name recorded on every change it makes.
 */
export interface SwarmService {
  as(actor: string): ApiClient;
  readonly runs: RunController;
  readonly evals: EvalService;
  /**
   * Start a scheduled run for every active swarm that is not already running. With `only`,
   * for those swarms alone, so a catch-up for one swarm does not rerun the others.
   */
  runScheduled(only?: readonly string[]): Promise<Run[]>;
  /** Create the first swarm with sensible defaults if the store is empty. */
  ensureSeeded(): Promise<void>;
  close(): void;
}

/** A failure the API should report to the caller, with an HTTP status. */
export class ServiceError extends Error {
  readonly status: number;
  readonly fields: Record<string, string>;

  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.fields = fields;
  }
}

/** Cron parsing lives in the server, which owns the scheduler. */
export interface CronHelper {
  isValid(expression: string): boolean;
  /** ISO time of the next firing after `from`, or null when the expression is invalid. */
  next(expression: string, timezone: string, from: Date): string | null;
}

/** What the service is built from. Implemented by `createSwarmService` in src/service. */
export interface ServiceDeps {
  store: Store;
  runs: RunController;
  evals: EvalService;
  providers: ProviderRegistry;
  /** Live source adapters, for the settings page's status list. */
  liveSources: SourceRegistry;
  cron: CronHelper;
  now?: () => Date;
  logger?: Logger;
}

/** Everything needed to assemble a working system. Implemented by `createApp` in src/service. */
export interface AppOptions {
  /** SQLite file path, or ":memory:". */
  dbPath: string;
  /** Scratch directory for repository checkouts. */
  dataDir: string;
  /** Directory for eval flows. */
  flowsDir: string;
  cron: CronHelper;
  env?: NodeJS.ProcessEnv;
  /** Seed of the simulated world that simulated runs draw from. */
  simSeed?: number;
  fundName?: string;
  now?: () => Date;
  logger?: Logger;
}

export interface App {
  service: SwarmService;
  store: Store;
  providers: ProviderRegistry;
  close(): void;
}

export type { EvalFlowDTO, EvalFlowSummary, Evidence, Feedback, Assessment, Lead, OutreachAction };
