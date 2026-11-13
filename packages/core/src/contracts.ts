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
  Company,
  CompanyAssessment,
  CompanyDimensionId,
  CompanyEvidenceDraft,
  CompanyFeedback,
  CompanyListDTO,
  CompanyMember,
  CompanyQuery,
  CompanyStatus,
  CoachReport,
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
  NetworkContact,
  OutreachAction,
  OutreachKind,
  OutreachStatus,
  ProfileLinks,
  PromoteVariantInput,
  QuoteStatus,
  TeamMemberDraft,
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
  MemberStats,
  OutcomeEvidence,
  FrontierItem,
  Hunt,
  HuntCall,
  HuntNote,
  PageLink,
  Pools,
  Trail,
  Skill,
} from "@agentswarm/shared";

/* ================================================================== */
/* Model providers                                                      */
/* ================================================================== */

export interface ProviderRequest<T> {
  jobId: ModelJobId;
  /** structured = no tools; research = web search and fetch; repo_review = read-only files in repoDir. */
  kind: Extract<JobKind, "structured" | "research" | "search" | "repo_review">;
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

/* ================================================================== */
/* The open web, for the hunt                                           */
/* ================================================================== */

/**
 * What came back from asking for one page. `text` and `links` are the page as a runner will
 * see it: readable text, and its links numbered in the order they appear.
 */
export interface PageRead {
  /**
   * ok          the page was read;
   * blocked     it was not asked for, or the site said no: a host the system never requests,
   *             a private address, robots.txt, a login wall, a refusal;
   * unreachable no answer, an error, or too little text to read;
   * not_text    not a page of text (an image, a download, a document format not read here).
   */
  status: "ok" | "blocked" | "unreachable" | "not_text";
  /** One line a person can read, for anything other than ok. */
  detail: string;
  /** The address after redirects. */
  url: string;
  title: string;
  text: string;
  links: PageLink[];
  /** Simulator only: the synthetic founders this page is about. Never placed in a prompt. */
  simFounderIds?: string[];
}

/**
 * Reads one public page for the hunt. Implemented in src/sources (live) and src/sim.
 *
 * The live reader is where the rules about addresses are kept, because the address comes from
 * a model or from a page: it never requests a host on the deny list (`isNeverFetchHost`) or a
 * private network address, it connects only to the address it validated, it reads robots.txt
 * and obeys it, it waits between requests to the same host, it never sends a login or a
 * cookie, and it gives up on a page that is too large or is not text.
 */
export interface WebReader {
  read(url: string, options?: { simDay?: number | null; signal?: AbortSignal }): Promise<PageRead>;
}

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  /** Simulator only. Never placed in a prompt. */
  simFounderIds?: string[];
}

/** One way of searching: a site's own search API, or a web search service. */
export interface SearchEngine {
  /** Stable id the navigator names in a search, for example "hn", "github" or "web". */
  readonly id: string;
  readonly label: string;
  /** What it searches, in a line, shown to the navigator so it can write a query for it. */
  readonly searches: string;
  /** The search is done by a model with a search tool, so the hunt runs this job and reads its hits. */
  readonly job?: "hunt.search";
  status(): Promise<{ configured: boolean; detail: string }>;
  search(query: string, limit: number, options?: { simDay?: number | null; signal?: AbortSignal }): Promise<SearchHit[]>;
}

/** How a hunt reaches the web in one source mode. */
export interface WebAccess {
  reader: WebReader;
  engines: readonly SearchEngine[];
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

/**
 * A synthetic company with hidden ground truth. Entirely fictional. Its id is its
 * founder's simId: in the simulated world every founder has one company.
 */
export interface SimCompany {
  simId: string;
  name: string;
  url: string;
  oneLiner: string;
  /** The mission as the company would state it. */
  mission: string;
  tagline: string;
  sector: string;
  stage: string;
  /** True level 0..1 per company rubric dimension. */
  latent: Record<CompanyDimensionId, number>;
  /** 0..1 overall company quality, related to but not the same as the founder's. */
  quality: number;
  /** Other people on the team, besides the founder. */
  team: TeamMemberDraft[];
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
  /** The company of a simulated founder. Derived from its own random stream, so founders are unchanged. */
  company(simId: string): SimCompany | undefined;
  /**
   * Evidence a company research job would find. Deterministic for the inputs. Includes some
   * items whose hidden truth is not "supported", for the fact-checker to catch.
   */
  companyEvidenceFor(simId: string, jobId: JobId, depth: InvestigationDepth): CompanyEvidenceDraft[];
  /**
   * The simulated web, for the hunt. A page exists at an address or it does not; what it says
   * is deterministic for (address, day). There are listing pages that link to project pages,
   * project pages that name their founders and say how far along they are, and pages about
   * nobody. Some places are rich in strong early founders and some are not, so a hunt has
   * something to learn. null for an address the simulated web does not have.
   */
  page(url: string, day: number): PageRead | null;
  /** What a simulated search engine returns. Deterministic for the inputs. Empty for an unknown engine. */
  search(engine: string, query: string, day: number, limit: number): SearchHit[];
  /** The search engines the simulated web has: the same ids as the live ones. */
  engines(): Array<{ id: string; label: string; searches: string }>;
  /** Strong early founders visible on the simulated web by this day. Hidden from prompts. */
  strongEarlyFounders(day: number): SimFounder[];
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
  readonly kind: Extract<JobKind, "structured" | "research" | "search" | "repo_review">;
  readonly outputSchema: z.ZodType<unknown>;
  /** Names of the prompt variants this job has. Always includes "base". */
  readonly promptVariants: readonly string[];
  /**
   * The live prompt. Must include `ctx.steeringBlock`, fence every piece of
   * outside content as untrusted data, and never include simulator fields.
   */
  buildPrompt(input: JobInput<J>, ctx: JobContext): { system: string; prompt: string };
  /** Ids of reviewed notes inserted into this task's system prompt. */
  selectedSkills?(input: JobInput<J>, ctx: JobContext): string[];
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
  /** A short hash of the instructions sent, so a silent change of wording shows up on the task. */
  promptHash?: string;
  /** Reviewed skill ids included in this task's system prompt. */
  skills?: string[];
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
    /**
     * Why the previous attempt's answer was rejected. When set, the model is shown the reason
     * and asked to answer again. Used once per task, for an answer that failed validation.
     */
    repair?: string | null;
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
  /** Record whether code found an item's quoted words at the address it cites. */
  setQuote(evidenceId: string, quote: QuoteStatus): void;

  insertAssessment(assessment: Assessment): void;
  latestAssessment(founderId: string): Assessment | null;
  assessmentHistory(founderId: string): Array<{ at: string; composite: number; decision: Assessment["decision"] }>;
  setMemo(assessmentId: string, memo: Memo): void;

  /* ---- Companies ---- */

  insertCompany(company: Company): void;
  getCompany(id: string): Company | null;
  updateCompany(id: string, patch: Partial<Omit<Company, "id" | "swarmId">>): Company;
  /** The company a swarm knows under this site host, if any. */
  findCompanyByDomain(swarmId: string, domain: string): Company | null;
  /** Companies whose normalised name matches exactly. Name matching is a fallback for when there is no site. */
  findCompaniesByName(swarmId: string, normalizedName: string): Company[];
  listCompanies(filter: { swarmId: string; statuses?: CompanyStatus[] }): Company[];
  /** Rows for the Companies page, with counts per status. */
  companyRows(query: CompanyQuery): CompanyListDTO;
  /** Founders that belong to a company, in the order they were first seen. */
  foundersOfCompany(companyId: string): Founder[];

  /** Replace-or-insert by (company, normalised name), so a later listing updates the same person. */
  upsertCompanyMember(member: CompanyMember): CompanyMember;
  listCompanyMembers(companyId: string): CompanyMember[];

  /** Evidence about a company, across whichever founders it was filed under. */
  listCompanyEvidence(companyId: string, options?: { verifications?: Verification[] }): Evidence[];

  insertCompanyAssessment(assessment: CompanyAssessment): void;
  latestCompanyAssessment(companyId: string): CompanyAssessment | null;
  companyAssessmentHistory(companyId: string): Array<{ at: string; deal: number; decision: CompanyAssessment["decision"] }>;

  insertCompanyFeedback(feedback: CompanyFeedback): void;
  listCompanyFeedback(companyId: string): CompanyFeedback[];
  /** Every call on any company of a swarm, oldest first. */
  allCompanyFeedback(swarmId: string): CompanyFeedback[];

  /* ---- A partner's uploaded contact list ---- */

  /** Replace one owner's whole list. Returns the list as stored, with `previous` filled where a contact changed. */
  replaceNetwork(owner: string, contacts: NetworkContact[]): NetworkContact[];
  listNetwork(owner?: string): NetworkContact[];
  removeNetwork(owner: string): number;
  /** Contacts whose company matches this normalised company name. */
  networkAtCompany(normalizedCompanyName: string): NetworkContact[];

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
  listTasks(filter: { runId?: string; founderId?: string; companyId?: string; agentId?: string; limit?: number }): TaskRun[];
  /** Sum of known task cost for a run. */
  runCost(runId: string): number;
  /** Per-agent activity since a point in time. */
  nodeStats(swarmId: string, sinceIso: string): NodeStatRow[];

  audit(entry: Omit<AuditEntry, "id" | "at">): AuditEntry;
  recentAudit(limit: number): AuditEntry[];
  /**
   * What each pool member did for one job since a date, counted from tasks and from the
   * evidence those tasks collected. A task with no member recorded is counted under "".
   *
   * For "hunt.look", whose output is leads and not evidence, the three item counts are taken
   * from leads instead: `items` is the leads its tasks found, `supported` those the fit
   * screener kept (matched to a founder whose status is anything but "lead" or
   * "screened_out"), and `rejected` those it dropped ("screened_out").
   */
  memberStats(swarmId: string, jobId: JobId, sinceIso: string): MemberStats[];

  /* ---- The hunt: a navigator's notebook, kept between runs ---- */

  /** The swarm's hunt, if it has started one. A swarm has at most one. */
  getHunt(swarmId: string): Hunt | null;
  /** Insert, or replace the one with the same id. */
  saveHunt(hunt: Hunt): void;
  /** Oldest first. */
  listTrails(huntId: string): Trail[];
  getTrail(id: string): Trail | null;
  /** Insert, or replace the one with the same id. */
  saveTrail(trail: Trail): void;
  /**
   * Queue searches and pages. The hunt holds an address, or a search's words on one engine,
   * once. Asked for again:
   *  - still waiting on the same trail: nothing changes;
   *  - still waiting on another trail: it moves to the trail that asks now, because the first
   *    may have been closed, and work left on a closed trail is never done;
   *  - a page that was read or passed over: nothing. A page is never read twice;
   *  - a search that was run: it is put back in the queue when it is asked for by a run other
   *    than the one that ran it, or on a later day than it ran (`ranBy` and `ranAt`, which
   *    `setFrontierState` records; for an item that never recorded them, `runId` and
   *    `addedAt`), because a search run again later finds new people. Asked for by the run
   *    that ran it, on the day it ran, nothing: it would find the same things.
   * Returns the items that are waiting on the asking trail because of this call.
   */
  addFrontier(items: FrontierItem[]): FrontierItem[];
  /** One item as it is stored now, or null. A wave is planned from a list that may have aged. */
  getFrontierItem(id: string): FrontierItem | null;
  /** Oldest first. */
  listFrontier(huntId: string, filter?: { state?: FrontierItem["state"]; trailId?: string }): FrontierItem[];
  /** `ran` is given when a search has just been run: when, and by which run. */
  setFrontierState(id: string, state: FrontierItem["state"], ran?: { at: string; runId: string | null }): void;
  insertHuntNote(note: HuntNote): void;
  /** Newest first. */
  listHuntNotes(huntId: string, limit: number): HuntNote[];
  /** false when there was no such note. */
  removeHuntNote(id: string): boolean;
  insertHuntCall(call: HuntCall): void;
  /** Newest first. */
  listHuntCalls(huntId: string, filter?: { turn?: number; runId?: string; limit?: number }): HuntCall[];
  /** Leads the swarm's hunt found (those with a trail), newest first. */
  listHuntLeads(swarmId: string, limit: number): Lead[];
  /**
   * For each trail of a hunt, how many of its leads the fit screener kept: leads matched to a
   * founder whose status is anything but "lead" or "screened_out". Trails with none are absent.
   */
  keptByTrail(huntId: string): Map<string, number>;
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

/* ================================================================== */
/* Checks that code does without a model                                */
/* ================================================================== */

/**
 * Opens the page an evidence item cites and looks for the item's quoted words there.
 * Implemented in src/sources. It refuses addresses on the fetch deny list (see
 * `DENIED_HOSTS`) and private network addresses, because the address comes from a model.
 */
export interface QuoteChecker {
  check(url: string, excerpt: string, signal?: AbortSignal): Promise<{ status: QuoteStatus; detail: string }>;
}

/* ================================================================== */
/* Professional-profile data                                            */
/* ================================================================== */

/** One person as a data vendor reports them. Professional details only. */
export interface PersonRecord {
  /** The vendor's own id for this person. */
  vendorId: string;
  /** Vendor name, for example "People Data Labs". */
  vendor: string;
  name: string;
  headline: string | null;
  location: string | null;
  /** A pointer a person can open. The system never requests it. */
  profileUrl: string | null;
  current: { title: string | null; company: string | null; companyUrl: string | null; startDate: string | null } | null;
  experience: Array<{ title: string | null; company: string | null; startDate: string | null; endDate: string | null }>;
  education: Array<{ school: string | null; degrees: string[]; startDate: string | null; endDate: string | null }>;
  /** When the vendor last confirmed the record, as the vendor reports it. */
  lastVerifiedAt: string | null;
  /** 0..1 how sure the vendor is that this is the person asked for. null for search results. */
  matchConfidence: number | null;
}

/** How to ask for one person. A profile link is accepted, but a name and company is preferred. */
export type PersonKey =
  | { name: string; company: string | null }
  | { profileUrl: string }
  | { vendorId: string };

/**
 * Lookups against a professional-profile data vendor. The engine uses these to fill in a
 * known founder's work history and a company's team. Implemented per vendor in src/sources.
 */
export interface PeopleLookup {
  readonly vendor: string;
  status(): Promise<{ configured: boolean; detail: string }>;
  /** One person's record, or null when the vendor has no confident match. */
  enrich(key: PersonKey, signal?: AbortSignal): Promise<PersonRecord | null>;
  /** People who currently work at a company, most senior first, at most `limit`. */
  team(company: { name: string; domain: string | null }, limit: number, signal?: AbortSignal): Promise<PersonRecord[]>;
}

/** What the engine is built from. Implemented by `createRunController` in src/engine. */
export interface EngineDeps {
  store: Store;
  jobs: JobRegistry;
  executeJob: ExecuteJob;
  /** Quote check for live runs. Absent in tests and simulations, where sources are not real pages. */
  quotes?: QuoteChecker | null;
  /** Vendor lookups for live runs. null when no vendor is connected. */
  people?: PeopleLookup | null;
  /** Source adapters for each source mode. */
  sources: { sim: SourceRegistry; live: SourceRegistry };
  repos: { sim: RepoFinder; live: RepoFinder };
  /** How the hunt reaches the web in each source mode. Absent: a run has no hunt stage. */
  web?: { sim: WebAccess; live: WebAccess };
  /**
   * Pools for jobs whose config names none, resolved once when a run starts: the runner pool
   * of `runnerPools`, built from the providers that are ready. A pool in the config wins.
   */
  defaultPools?: () => Promise<Pools>;
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
  /**
   * Judged past cases from the periods used for tuning, reduced to scores and rubric levels,
   * for testing the assumptions the swarm runs on. The later periods are never included: they
   * are kept untouched for the headline. null when no past case has been judged yet.
   */
  outcomeEvidence?(): Promise<OutcomeEvidence | null>;
}

/** What the eval subsystem is built from. Implemented by `createEvalService` in src/eval. */
export interface EvalDeps {
  /** Needed by flows built from partner calls. Flows on synthetic data work without it. */
  store: Store | null;
  jobs: JobRegistry;
  executeJob: ExecuteJob;
  /** Directory that holds one sub-directory per eval flow. Created when missing. */
  flowsDir: string;
  /**
   * Directory that holds eval datasets built from real past data, for example
   * `past-founders/cases.jsonl`. A flow on past cases is offered only when its dataset is there.
   */
  datasetsDir?: string;
  /**
   * Needed by flows that ask a model something outside the agents' jobs: the recognition
   * probe and the proposer of learned guidance. Without it those flows run in simulation only.
   */
  providers?: ProviderRegistry;
  /** Runs one isolated hunt trial; ground truth is joined inside the service. */
  huntTrial?: HuntTrial;
  /**
   * Names the personal attributes a text states, empty when it states none. A learned line
   * that states one is discarded. Passed in because the check lives with the jobs.
   */
  sensitive?: (text: string) => string[];
  now?: () => Date;
  logger?: Logger;
}

export interface HuntTrialInput {
  seed: number;
  days: number;
  config: SwarmConfig;
  brain: Brain;
  budgetUsd: number;
  signal?: AbortSignal;
}

export interface HuntTrialPerson {
  simFounderId: string;
  quality: number;
  early: boolean;
}

export interface HuntTrialModelStats {
  pages: number;
  peopleKept: number;
  peopleRefused: number;
  plantedFailed: number;
  medianLatencyMs: number | null;
}

export interface HuntTrialResult {
  kept: HuntTrialPerson[];
  strongEarlyAvailable: number;
  strongEarlyFounderIds: string[];
  runnerCalls: number;
  pages: number;
  searches: number;
  plantedRead: number;
  plantedFailed: number;
  lateKept: number;
  costUsd: number;
  unpricedCalls: number;
  models: Record<string, HuntTrialModelStats>;
}

export type HuntTrial = (input: HuntTrialInput) => Promise<HuntTrialResult>;

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
  /**
   * Let the swarm try to improve itself, within the autopilot setting: run eval rounds, and in
   * "apply" mode put a kept change into use when it was measured on real data. Called after
   * each scheduled run. Never throws for an eval that is busy or not ready.
   */
  coach(swarmId: string): Promise<CoachReport>;
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
  /** The hunt's search engines in each mode, for the Hunt page. */
  web?: { sim: WebAccess; live: WebAccess };
  /** Reviewed playbooks shown in the steering preview and used by the job registry. */
  skillLibrary?: readonly Skill[];
  /** The same defaults the engine uses, so the pools a person sees are the pools that run. */
  defaultPools?: () => Promise<Pools>;
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
  /** Directory for eval datasets built from real past data. Defaults to "datasets" beside `flowsDir`. */
  datasetsDir?: string;
  /** The model that judges past cases. null or absent uses the analysts' own routes. */
  evalJudge?: ModelRoute | null;
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
