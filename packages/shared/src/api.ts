/**
 * The contract between the server and the dashboard.
 *
 * `ApiClient` is implemented three times: by the dashboard's HTTP client, by
 * its demo client (a frozen snapshot, used for the shareable demo), and it is
 * mirrored one-to-one by the server's routes. REST paths are listed next to
 * each method.
 */

import type {
  Agent,
  Assessment,
  AuditEntry,
  Brain,
  Company,
  CompanyAssessment,
  CompanyFeedback,
  CompanyMember,
  CompanyStatus,
  Evidence,
  Feedback,
  FeedbackVerdict,
  Founder,
  FounderStatus,
  Lead,
  NetworkContact,
  OutreachAction,
  OutreachDraft,
  OutreachStatus,
  Run,
  Settings,
  SourceMode,
  StageId,
  Swarm,
  SwarmStatus,
  TaskRun,
  Thesis,
} from "./domain";
import type { ClassId, ClassMeta, JobId, JobMeta, ModelRoute, ProviderId, SourceId } from "./registry";
import type { ParamValue } from "./params";
import type { Decision } from "./scoring";
import type { CallsSummary, SteeringSuggestion } from "./feedback";
import type {
  Directive,
  DirectiveKind,
  DirectiveStatus,
  EffectiveParam,
  ResolvedSteering,
  ScopeLevel,
  ScopeSelector,
  SwarmConfig,
} from "./steering";

/* ------------------------------ Settings --------------------------- */

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
  /** Plain-language reason, never a secret. */
  detail: string;
}

export interface SourceStatus {
  id: SourceId;
  label: string;
  configured: boolean;
  detail: string;
}

export interface SettingsDTO {
  settings: Settings;
  providers: ProviderStatus[];
  sources: SourceStatus[];
  /** When the scheduler will next start a run, if it is enabled. */
  nextRunAt: string | null;
}

export type SettingsPatch = Partial<Omit<Settings, "schedule">> & {
  schedule?: Partial<Settings["schedule"]>;
};

/* ------------------------------- Swarms ---------------------------- */

export interface CreateSwarmInput {
  name: string;
  thesis: Thesis;
}

export interface UpdateSwarmInput {
  name?: string;
  status?: SwarmStatus;
  thesis?: Thesis;
}

export interface NodeStats {
  /** Tasks finished in the last 24 hours. */
  tasks: number;
  failures: number;
  /** Known spend in the last 24 hours. */
  costUsd: number;
  /** Leads, evidence items or judgments produced, depending on the job. */
  itemsOut: number;
  lastRunAt: string | null;
}

export type NodeHealth = "ok" | "warn" | "error" | "idle" | "paused" | "planned";

export interface AgentNode {
  agent: Agent;
  health: NodeHealth;
  directiveCount: number;
  stats: NodeStats;
  /** One line about the most recent task, or null if it has never run. */
  lastOutput: string | null;
}

export interface JobNode {
  job: JobMeta;
  health: NodeHealth;
  /** Directives attached to exactly this job scope. */
  directiveCount: number;
  /** The route in force after config and steering. */
  route: ModelRoute;
  stats: NodeStats;
  agents: AgentNode[];
}

export interface ClassNode {
  cls: ClassMeta;
  health: NodeHealth;
  /** Directives attached to exactly this class scope. */
  directiveCount: number;
  stats: NodeStats;
  jobs: JobNode[];
}

export interface SwarmTreeDTO {
  swarm: Swarm;
  config: SwarmConfig;
  /** Directives attached to this swarm as a whole. */
  swarmDirectiveCount: number;
  /** Directives that apply to everything. */
  globalDirectiveCount: number;
  classes: ClassNode[];
}

export interface AddAgentInput {
  jobId: JobId;
  name?: string;
  beat?: string | null;
}

export interface UpdateAgentInput {
  name?: string;
  status?: "active" | "paused";
  beat?: string | null;
}

/* ------------------------------ Steering --------------------------- */

export interface DirectiveRow extends Directive {
  level: ScopeLevel;
  scopeLabel: string;
  /** Tasks that ran with this directive applied. */
  appliedCount: number;
  lastAppliedAt: string | null;
  /** Set when a param directive's value is no longer valid. */
  problem: string | null;
}

export interface DirectiveFilter {
  /** Directives that would apply to this swarm (global ones included). */
  swarmId?: string;
  level?: ScopeLevel;
  kind?: DirectiveKind;
  status?: DirectiveStatus;
  /** Directives attached to exactly this scope. */
  scope?: ScopeSelector;
}

export interface CreateDirectiveInput {
  scope: ScopeSelector;
  kind: DirectiveKind;
  key?: string | null;
  value?: ParamValue | null;
  text?: string | null;
  priority?: number;
  note?: string | null;
  expiresAt?: string | null;
}

export interface UpdateDirectiveInput {
  status?: DirectiveStatus;
  value?: ParamValue | null;
  text?: string | null;
  priority?: number;
  note?: string | null;
  expiresAt?: string | null;
}

export interface EffectiveSteeringQuery {
  swarmId: string;
  /** Give an agent id, or a class or job to preview that scope. */
  agentId?: string;
  classId?: ClassId;
  jobId?: JobId;
}

export interface EffectiveSteeringDTO {
  /** Human label for what was resolved, for example "GitHub scout 1". */
  label: string;
  resolved: ResolvedSteering;
  /** The exact guidance text the agent receives. Empty when there is none. */
  block: string;
  /**
   * The recent partner calls this agent is shown as examples, as the exact
   * text placed after the guidance. Empty for agents that are not shown calls.
   */
  callsBlock: string;
  /** Every parameter relevant to this scope with its value and where it came from. */
  params: Array<EffectiveParam & { label: string; scopeLabel: string | null }>;
  /** The model route in force, when the scope is one job or agent. */
  route: ModelRoute | null;
  /** Lines of guidance with a readable scope label, in the order applied. */
  guidance: Array<{
    kind: "rule" | "opinion" | "context";
    text: string;
    directiveId: string;
    scopeLabel: string;
  }>;
}

/* ------------------------------ Founders --------------------------- */

export interface FounderRow {
  id: string;
  name: string;
  headline: string | null;
  companyName: string | null;
  status: FounderStatus;
  decision: Decision | null;
  composite: number | null;
  cracked: number | null;
  founderScore: number | null;
  fit: number | null;
  coverage: number | null;
  sources: SourceId[];
  evidenceCount: number;
  flagCount: number;
  /** The partner's most recent call on this founder, if any. */
  feedback: FeedbackVerdict | null;
  /** The reasons given with that call. */
  feedbackReasons: string[];
  /** The company record this founder belongs to, if one is matched. */
  companyId?: string | null;
  firstSeenAt: string;
  updatedAt: string;
}

export type FounderSort = "composite" | "cracked" | "fit" | "recent";

export interface FounderQuery {
  swarmId: string;
  status?: FounderStatus | "all";
  decision?: Decision;
  q?: string;
  sort?: FounderSort;
  limit?: number;
  offset?: number;
}

export interface FounderListDTO {
  rows: FounderRow[];
  total: number;
  /** Count per status, ignoring the status filter, for filter tabs. */
  counts: Partial<Record<FounderStatus, number>>;
}

export interface FounderDetailDTO {
  founder: Founder;
  assessment: Assessment | null;
  /** Composite score at each past assessment, oldest first. */
  history: Array<{ at: string; composite: number; decision: Decision }>;
  evidence: Evidence[];
  leads: Lead[];
  outreach: OutreachAction[];
  feedback: Feedback[];
  /** The tasks that worked on this founder, newest first, without traces. */
  tasks: TaskRun[];
  /** People in the partners' uploaded contact lists who work at this founder's company. */
  knownPeople?: NetworkContact[];
}

/** A person a partner types in by hand, for example after seeing them on a professional network. */
export interface AddFounderInput {
  swarmId: string;
  name: string;
  companyName?: string | null;
  companyUrl?: string | null;
  /** Any public link for the person: a site, a code host profile, a professional profile. */
  link?: string | null;
  /** Why this person is worth a look, in the partner's words. */
  why?: string | null;
}

export interface FeedbackInput {
  verdict: FeedbackVerdict;
  /** Ids from FEEDBACK_REASONS for this verdict. */
  reasonTags?: string[];
  note?: string | null;
}

/* ------------------------------ Companies -------------------------- */

export interface CompanyRow {
  id: string;
  name: string;
  oneLiner: string | null;
  sector: string | null;
  stage: string | null;
  status: CompanyStatus;
  decision: Decision | null;
  /** 0..1 founders and company together. */
  deal: number | null;
  /** 0..1 the company on its own rubric. */
  company: number | null;
  /** 0..1 the lead founder's score. */
  team: number | null;
  coverage: number | null;
  /** Founders of this company the swarm follows, lead first. */
  founders: Array<{ id: string; name: string }>;
  teamSize: number;
  evidenceCount: number;
  flagCount: number;
  /** The partner's most recent call on this company, if any. */
  feedback: FeedbackVerdict | null;
  feedbackReasons: string[];
  /** How many people in the partners' uploaded contact lists work here. */
  knownPeople: number;
  firstSeenAt: string;
  updatedAt: string;
}

export type CompanySort = "deal" | "company" | "team" | "recent";

export interface CompanyQuery {
  swarmId: string;
  status?: CompanyStatus | "all";
  q?: string;
  sort?: CompanySort;
  limit?: number;
  offset?: number;
}

export interface CompanyListDTO {
  rows: CompanyRow[];
  total: number;
  /** Count per status, ignoring the status filter, for filter tabs. */
  counts: Partial<Record<CompanyStatus, number>>;
}

export interface CompanyDetailDTO {
  company: Company;
  members: CompanyMember[];
  /** Founders of this company the swarm follows, lead first. */
  founders: FounderRow[];
  assessment: CompanyAssessment | null;
  /** Deal score at each past assessment, oldest first. */
  history: Array<{ at: string; deal: number; decision: Decision }>;
  /** Company evidence, newest first. */
  evidence: Evidence[];
  feedback: CompanyFeedback[];
  /** The tasks that worked on this company, newest first, without traces. */
  tasks: TaskRun[];
  /** People in the partners' uploaded contact lists who work here. */
  knownPeople: NetworkContact[];
}

export interface CompanyFeedbackInput {
  verdict: FeedbackVerdict;
  /** Ids from COMPANY_REASONS for this verdict. */
  reasonTags?: string[];
  note?: string | null;
}

/* ------------------------------- Network --------------------------- */

export interface NetworkDTO {
  /** One row per person who has uploaded a list. */
  owners: Array<{ owner: string; contacts: number; importedAt: string }>;
  total: number;
}

export interface NetworkImportInput {
  /** The text of the exported connections file, as downloaded. */
  csv: string;
}

export interface NetworkImportResult {
  owner: string;
  imported: number;
  /** Contacts whose company or position differs from the previous upload. */
  changed: number;
  /** Changed contacts that now look like founders and were added as leads. */
  leads: number;
  network: NetworkDTO;
}

/* ------------------------------ Outreach --------------------------- */

export interface OutreachRow extends OutreachAction {
  founderName: string;
  founderHeadline: string | null;
  composite: number | null;
}

export interface OutreachQuery {
  swarmId: string;
  status?: OutreachStatus | "all";
}

export interface OutreachDecisionInput {
  decision: "approve" | "reject";
  note?: string | null;
  /** An edited draft to save with the approval. */
  draft?: OutreachDraft;
}

export interface OutreachCompleteInput {
  summary: string;
  /** Pasted transcript or notes. Stored as evidence and debriefed on the next run. */
  transcript?: string | null;
}

/* -------------------------------- Runs ----------------------------- */

export interface StartRunInput {
  swarmId: string;
  brain?: Brain;
  sources?: SourceMode;
  /** Overrides the spend cap for this run only. */
  budgetUsd?: number;
}

export interface StageProgress {
  stage: StageId;
  label: string;
  state: "pending" | "running" | "done" | "skipped";
  tasks: number;
  failures: number;
  costUsd: number;
}

export interface RunDetailDTO {
  run: Run;
  stages: StageProgress[];
  /** Tasks without traces, in the order they were created. */
  tasks: TaskRun[];
}

/* ------------------------------ Overview --------------------------- */

export interface Alert {
  id: string;
  level: "info" | "warning" | "error";
  title: string;
  detail: string;
  at: string;
  /** A dashboard route to open, for example "/approvals". */
  link: string | null;
}

export interface FunnelDay {
  /** YYYY-MM-DD */
  date: string;
  leads: number;
  screenedIn: number;
  investigated: number;
  surfaced: number;
  costUsd: number;
}

export interface OverviewDTO {
  swarm: Swarm;
  /** Totals for the most recent run day. */
  today: {
    leads: number;
    screenedIn: number;
    investigated: number;
    surfaced: number;
    pendingApprovals: number;
    costUsd: number;
    budgetUsd: number;
  };
  /** Up to 14 days, oldest first. */
  funnel: FunnelDay[];
  /** Cumulative totals across the swarm's life, widest stage first. */
  totals: { leads: number; founders: number; screenedIn: number; investigated: number; surfaced: number };
  topFounders: FounderRow[];
  /** The best companies still waiting for a partner's call. */
  topCompanies?: CompanyRow[];
  /** Surfaced companies with no call yet. */
  companiesWaiting?: number;
  alerts: Alert[];
  lastRun: Run | null;
  activeRun: Run | null;
  nextRunAt: string | null;
  classHealth: Array<{ classId: ClassId; label: string; health: NodeHealth; note: string }>;
  sourceYield: Array<{ source: SourceId; label: string; leads: number; surfaced: number }>;
  spendByClass: Array<{ classId: ClassId; label: string; costUsd: number }>;
  /** Headline eval score per round for the main flow, oldest first. */
  evalTrend: Array<{ variant: string; test: number }>;
  /** Partner yes and no calls: counts, how many surfaced founders still wait, and the common reasons. */
  calls: CallsSummary;
  recentAudit: AuditEntry[];
}

/* -------------------------------- Evals ---------------------------- */

export interface EvalMetricDef {
  id: string;
  label: string;
  better: "higher" | "lower";
  description: string;
}

export interface EvalVariant {
  /** "baseline" or "v1", "v2", ... */
  id: string;
  /** 0 for the baseline. */
  round: number;
  /** One line: what changed. */
  description: string;
  /** Why the change was proposed. */
  rationale: string;
  status: "baseline" | "kept" | "reverted" | "champion";
  /** Mean of each metric on the train split. */
  train: Record<string, number>;
  /** Mean of each metric on the held-out test split. This is the headline. */
  test: Record<string, number>;
  /** 95% interval of the headline metric on test, when computed. */
  testInterval: [number, number] | null;
  costUsd: number | null;
  /** The config this variant ran with. */
  config: SwarmConfig;
  /** Readable list of parameter and route changes versus the previous kept variant. */
  changes: string[];
  createdAt: string;
}

export interface EvalFlowSummary {
  id: string;
  label: string;
  description: string;
  headlineMetric: string;
  baseline: number | null;
  best: number | null;
  rounds: number;
  updatedAt: string | null;
}

export interface EvalFlowDTO extends EvalFlowSummary {
  metrics: EvalMetricDef[];
  goal: { target: string; direction: "higher" | "lower"; hold: string[] };
  cases: { train: number; test: number; reps: number };
  /** Smallest change in the headline metric the flow can tell from noise. */
  noiseFloor: number | null;
  /** What the cases are made of, so nobody mistakes synthetic for real. */
  dataNote: string;
  variants: EvalVariant[];
  bestVariant: string | null;
  /** The variant whose config the swarm is currently running, if any. */
  promotedVariant: string | null;
  narrative: string;
}

export interface RunEvalRoundInput {
  rounds?: number;
  brain?: Brain;
}

export interface PromoteVariantInput {
  variant: string;
  swarmId: string;
}

/* ------------------------------- Client ---------------------------- */

export interface ApiClient {
  /** GET /api/settings */
  getSettings(): Promise<SettingsDTO>;
  /** PATCH /api/settings */
  updateSettings(patch: SettingsPatch): Promise<SettingsDTO>;

  /** GET /api/swarms */
  listSwarms(): Promise<Swarm[]>;
  /** POST /api/swarms */
  createSwarm(input: CreateSwarmInput): Promise<Swarm>;
  /** PATCH /api/swarms/:id */
  updateSwarm(id: string, patch: UpdateSwarmInput): Promise<Swarm>;
  /** GET /api/swarms/:id/overview */
  getOverview(swarmId: string): Promise<OverviewDTO>;
  /** GET /api/swarms/:id/tree */
  getTree(swarmId: string): Promise<SwarmTreeDTO>;
  /** POST /api/swarms/:id/agents */
  addAgent(swarmId: string, input: AddAgentInput): Promise<Agent>;
  /** PATCH /api/agents/:id */
  updateAgent(agentId: string, patch: UpdateAgentInput): Promise<Agent>;

  /** GET /api/directives  (filter as query string; `scope` as JSON) */
  listDirectives(filter?: DirectiveFilter): Promise<DirectiveRow[]>;
  /** POST /api/directives */
  createDirective(input: CreateDirectiveInput): Promise<Directive>;
  /** PATCH /api/directives/:id */
  updateDirective(id: string, patch: UpdateDirectiveInput): Promise<Directive>;
  /** GET /api/steering/effective */
  getEffectiveSteering(query: EffectiveSteeringQuery): Promise<EffectiveSteeringDTO>;
  /** GET /api/swarms/:id/suggestions  (steering proposed from patterns in the partners' calls) */
  listSuggestions(swarmId: string): Promise<SteeringSuggestion[]>;
  /** POST /api/swarms/:id/suggestions/dismiss  (body: { key }) */
  dismissSuggestion(swarmId: string, key: string): Promise<SteeringSuggestion[]>;

  /** GET /api/founders */
  listFounders(query: FounderQuery): Promise<FounderListDTO>;
  /** GET /api/founders/:id */
  getFounder(id: string): Promise<FounderDetailDTO>;
  /** POST /api/founders/:id/feedback */
  addFeedback(founderId: string, input: FeedbackInput): Promise<Feedback>;
  /** POST /api/founders */
  addFounder(input: AddFounderInput): Promise<Lead>;

  /** GET /api/companies?swarmId=&status=&q=&sort=&limit=&offset= */
  listCompanies(query: CompanyQuery): Promise<CompanyListDTO>;
  /** GET /api/companies/:id */
  getCompany(id: string): Promise<CompanyDetailDTO>;
  /** POST /api/companies/:id/feedback */
  addCompanyFeedback(companyId: string, input: CompanyFeedbackInput): Promise<CompanyFeedback>;

  /** GET /api/network */
  getNetwork(): Promise<NetworkDTO>;
  /** POST /api/network/import */
  importNetwork(input: NetworkImportInput): Promise<NetworkImportResult>;
  /** DELETE /api/network/:owner */
  removeNetwork(owner: string): Promise<NetworkDTO>;

  /** GET /api/outreach */
  listOutreach(query: OutreachQuery): Promise<OutreachRow[]>;
  /** POST /api/outreach/:id/decision */
  decideOutreach(id: string, input: OutreachDecisionInput): Promise<OutreachAction>;
  /** POST /api/outreach/:id/complete */
  completeOutreach(id: string, input: OutreachCompleteInput): Promise<OutreachAction>;

  /** GET /api/runs?swarmId=&limit= */
  listRuns(swarmId: string, limit?: number): Promise<Run[]>;
  /** GET /api/runs/:id */
  getRun(id: string): Promise<RunDetailDTO>;
  /** GET /api/tasks/:id  (includes the trace) */
  getTask(id: string): Promise<TaskRun>;
  /** POST /api/runs  (returns as soon as the run is created; it executes in the background) */
  startRun(input: StartRunInput): Promise<Run>;
  /** POST /api/runs/:id/cancel */
  cancelRun(id: string): Promise<Run>;

  /** GET /api/evals */
  listEvalFlows(): Promise<EvalFlowSummary[]>;
  /** GET /api/evals/:id */
  getEvalFlow(id: string): Promise<EvalFlowDTO>;
  /** POST /api/evals/:id/rounds */
  runEvalRounds(id: string, input?: RunEvalRoundInput): Promise<EvalFlowDTO>;
  /** POST /api/evals/:id/promote */
  promoteEvalVariant(id: string, input: PromoteVariantInput): Promise<SwarmConfig>;
}

/* -------------------------------- Demo ----------------------------- */

/**
 * A frozen copy of everything the dashboard reads, produced from a simulated
 * run. The dashboard's demo build ships one of these instead of calling a
 * server, so the whole interface can be shared as a single static page.
 */
export interface DemoSnapshot {
  generatedAt: string;
  /** Shown on every page, for example "Simulated founders. No real people or companies." */
  note: string;
  settings: SettingsDTO;
  swarms: Swarm[];
  /** Keyed by swarm id. */
  overview: Record<string, OverviewDTO>;
  /** Keyed by swarm id. */
  tree: Record<string, SwarmTreeDTO>;
  directives: DirectiveRow[];
  /** Every non-archived founder row per swarm id, unfiltered. */
  founders: Record<string, FounderRow[]>;
  /** Keyed by founder id. May cover only the most interesting founders. */
  founderDetails: Record<string, FounderDetailDTO>;
  /** Every non-archived company row per swarm id, unfiltered. */
  companies?: Record<string, CompanyRow[]>;
  /** Keyed by company id. May cover only the most interesting companies. */
  companyDetails?: Record<string, CompanyDetailDTO>;
  /** Keyed by swarm id. */
  outreach: Record<string, OutreachRow[]>;
  /** Keyed by swarm id, newest first. */
  runs: Record<string, Run[]>;
  /** Keyed by run id. */
  runDetails: Record<string, RunDetailDTO>;
  /** Keyed by task id, with traces. May cover only some tasks. */
  tasks: Record<string, TaskRun>;
  evalFlows: EvalFlowDTO[];
}

/** Error body every non-2xx API response uses. */
export interface ApiErrorBody {
  error: string;
  /** Field-level problems for form validation. */
  fields?: Record<string, string>;
}

/** Header that names who is acting, recorded in the audit trail. */
export const ACTOR_HEADER = "x-actor";
