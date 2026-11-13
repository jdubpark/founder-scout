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
  RunScope,
  Settings,
  SourceMode,
  StageId,
  Swarm,
  SwarmStatus,
  TaskRun,
  Thesis,
} from "./domain";
import type { ContaminationReport } from "./past";
import type { MemberStats, PoolMember } from "./pools";
import type { AssumptionsDTO } from "./assumptions";
import type { HuntCall, HuntNote, LatestStage, StageRead, Trail, TrailStats, TrailStatus } from "./hunt";
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

export type SettingsPatch = Partial<Omit<Settings, "schedule" | "autopilot">> & {
  autopilot?: Partial<Settings["autopilot"]>;
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
  /** Guidance the swarm wrote for itself for this job, from the config in use. Empty for other scopes. */
  lessons?: string[];
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
  /** "hunt" runs only the hunt, matching and the fit screen. Default: the whole pipeline. */
  scope?: RunScope;
  /** For a hunt-only run: the most waves of runners it may send. */
  waves?: number;
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
  /** What the swarm last did to improve itself, if it has tried. */
  coach?: CoachReport | null;
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
  /** For a flow built on past cases: what the leak controls did. Absent for other flows. */
  contamination?: ContaminationReport | null;
  /** Whether the cases are real. Only a flow on real data may change the swarm by itself. */
  realData?: boolean;
}

/** What the swarm did the last time it tried to improve itself. */
export interface CoachReport {
  at: string;
  mode: Settings["autopilot"]["mode"];
  spentUsd: number;
  flows: Array<{
    flowId: string;
    label: string;
    /** Rounds run this time. */
    rounds: number;
    /** What each kept round changed, in words. */
    kept: string[];
    /** The change that was put into use without a person, if any. */
    applied: string | null;
    /** Why nothing was run or applied, when that is the case. */
    note: string | null;
  }>;
  /** What the pools of agents did after this run: shares moved, members benched. */
  pools?: PoolChange[];
}

/* ----------------------- Pools of agents --------------------------- */

export interface PoolMemberView extends PoolMember {
  /** The model's display name. */
  modelLabel: string;
  stats: MemberStats;
  /** Supported items for each dollar, or null when the job produces nothing the checks count. */
  yieldPerUsd: number | null;
}

export interface PoolView {
  jobId: JobId;
  label: string;
  classId: ClassId;
  /** Empty when the job is done by its one route. */
  members: PoolMemberView[];
  /** The route the job uses when it has no pool. */
  route: ModelRoute | null;
}

export interface PoolsDTO {
  pools: PoolView[];
  /** Days of tasks the figures cover. */
  windowDays: number;
}

export interface SetPoolInput {
  /** An empty list removes the pool, and the job goes back to its one route. */
  members: Array<{ id: string; route: ModelRoute; share: number; status?: "active" | "benched" }>;
}

export interface PoolChange {
  jobId: JobId;
  label: string;
  changes: string[];
  /** Why nothing moved, when nothing did. */
  note: string | null;
}

export interface RebalanceReport {
  /** true when the new shares were saved. false when this was a look at what would change. */
  applied: boolean;
  pools: PoolChange[];
}

/* ---------------------- What a change would do --------------------- */

export interface DecisionFlip {
  id: string;
  name: string;
  from: string;
  to: string;
  scoreFrom: number;
  scoreTo: number;
}

/**
 * What putting a config into use would change today, worked out by re-scoring the rubric
 * answers already on file. No model is called.
 */
export interface PreviewDTO {
  founders: DecisionFlip[];
  companies: DecisionFlip[];
  considered: { founders: number; companies: number };
  /** Parts of the change that re-scoring cannot show, such as a new line of guidance. */
  unseen: string[];
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
  /** false while the flow lacks the cases it needs to measure anything. `dataNote` says what is missing. */
  ready?: boolean;
  /** true when measuring this flow calls a model, so a round costs money and takes a budget. */
  callsModels?: boolean;
  /** On the answer to a run-rounds request only: what that request spent on model calls, in dollars. */
  spentUsd?: number;
}

export interface RunEvalRoundInput {
  rounds?: number;
  brain?: Brain;
  /** The most this call may spend on model calls, in dollars. A flow that costs nothing ignores it. */
  budgetUsd?: number;
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
  /**
   * GET /api/evals/:id?swarmId=  `promotedVariant` is the variant the named swarm is running.
   * Without a swarm it is filled only when there is exactly one swarm to mean.
   */
  getEvalFlow(id: string, swarmId?: string): Promise<EvalFlowDTO>;
  /** POST /api/evals/:id/rounds */
  runEvalRounds(id: string, input?: RunEvalRoundInput): Promise<EvalFlowDTO>;
  /** POST /api/evals/:id/promote */
  promoteEvalVariant(id: string, input: PromoteVariantInput): Promise<SwarmConfig>;
  /** POST /api/evals/:id/preview */
  previewEvalVariant(id: string, input: PromoteVariantInput): Promise<PreviewDTO>;

  /** GET /api/swarms/:id/assumptions */
  getAssumptions(swarmId: string): Promise<AssumptionsDTO>;

  /** GET /api/swarms/:id/pools */
  getPools(swarmId: string): Promise<PoolsDTO>;
  /** PUT /api/swarms/:id/pools/:jobId */
  setPool(swarmId: string, jobId: JobId, input: SetPoolInput): Promise<PoolsDTO>;
  /** POST /api/swarms/:id/pools/rebalance  With `apply` false, reports what would change and saves nothing. */
  rebalancePools(swarmId: string, input?: { apply?: boolean }): Promise<RebalanceReport>;

  /** GET /api/swarms/:id/hunt */
  getHunt(swarmId: string): Promise<HuntDTO>;
  /** POST /api/swarms/:id/hunt/trails  A person opens a trail. It needs a name and somewhere to start. */
  addHuntTrail(swarmId: string, input: AddTrailInput): Promise<HuntDTO>;
  /** PATCH /api/swarms/:id/hunt/trails/:trailId */
  updateHuntTrail(swarmId: string, trailId: string, input: UpdateTrailInput): Promise<HuntDTO>;
  /** POST /api/swarms/:id/hunt/notes  A line for the notebook. The navigator reads it on its next turn. */
  addHuntNote(swarmId: string, input: { text: string }): Promise<HuntDTO>;
  /** DELETE /api/swarms/:id/hunt/notes/:noteId */
  removeHuntNote(swarmId: string, noteId: string): Promise<HuntDTO>;
}

/* ------------------------------ The hunt --------------------------- */

/** A trail with what is waiting on it and how much of the next wave code would give it. */
export interface HuntTrailView extends Trail {
  /** Searches and pages waiting. */
  queued: number;
  /** `trailScore`: attention times yield. */
  score: number;
  /** Share of the next wave, 0 to 1. 0 for a trail that is not open or has nothing waiting. */
  share: number;
}

/** A person the hunt found, for the list of recent finds. */
export interface HuntFind {
  leadId: string;
  personName: string;
  companyName: string | null;
  oneLiner: string | null;
  /** The page the person was found on. */
  sourceRef: string;
  trailId: string | null;
  stage: StageRead | null;
  earliness: number | null;
  /** The founder record the lead was matched to, once it was. */
  founderId: string | null;
  /** That founder's status, so the list can show who the screener kept. */
  founderStatus: FounderStatus | null;
  discoveredAt: string;
}

export interface HuntEngineView {
  id: string;
  label: string;
  /** What it searches, in a line. */
  searches: string;
  configured: boolean;
  detail: string;
}

/** Everything the Hunt page shows for one swarm. */
export interface HuntDTO {
  swarmId: string;
  /** false when a person turned the hunt off for this swarm. */
  enabled: boolean;
  /** true while a run of this swarm is in its hunt stage. */
  active: boolean;
  /** Turns the navigator has taken since the hunt began. */
  turn: number;
  navigator: { agentId: string | null; paused: boolean; route: ModelRoute | null };
  /** The runner jobs with the models that share them. */
  runners: PoolView[];
  /** Search engines in the mode the swarm's scheduled runs use. */
  engines: HuntEngineView[];
  limits: { turns: number; waveSize: number; maxDepth: number; budgetShare: number; latestStage: LatestStage; plantedEvery: number };
  /** Sums over every trail, open or closed. */
  totals: TrailStats;
  /** Planted pages read, and how many a runner fell for. */
  planted: { read: number; failed: number };
  /** Open trails first, by score, then paused, then closed. */
  trails: HuntTrailView[];
  /** Newest first. */
  notes: HuntNote[];
  /** Newest first, at most a hundred. */
  calls: HuntCall[];
  /** One entry per navigator turn, oldest first, at most thirty. */
  waves: Array<{ turn: number; at: string; calls: number; leads: number; costUsd: number }>;
  /** Newest first, at most thirty. */
  finds: HuntFind[];
}

export interface AddTrailInput {
  name: string;
  /** What to look for. Defaults to the name. */
  intent?: string;
  searches?: Array<{ engine: string; query: string }>;
  pages?: string[];
}

export interface UpdateTrailInput {
  /** "open" re-opens a closed or paused trail. */
  status?: TrailStatus;
  pinned?: boolean;
  /** 1 to 5. */
  weight?: number;
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
  /** Present in snapshots made since these pages existed. */
  assumptions?: AssumptionsDTO;
  pools?: PoolsDTO;
  preview?: PreviewDTO;
  /** Keyed by swarm id. */
  hunts?: Record<string, HuntDTO>;
}

/** Error body every non-2xx API response uses. */
export interface ApiErrorBody {
  error: string;
  /** Field-level problems for form validation. */
  fields?: Record<string, string>;
}

/** Header that names who is acting, recorded in the audit trail. */
export const ACTOR_HEADER = "x-actor";
