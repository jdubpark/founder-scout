/**
 * The records the swarm keeps. Timestamps are ISO-8601 strings in UTC.
 */

import type { CompanyDimensionId, EvidenceFacet } from "./company";
import type { ClassId, JobId, ProviderId, SourceId } from "./registry";
import type { DimensionId } from "./rubric";
import type { CompanyDimensionScore, Decision, DimensionScore, Level, ScoreFlag } from "./scoring";
import type { Usage } from "./models";
import type { ParamValue } from "./params";

/* ----------------------------- Swarms ------------------------------ */

/** What a swarm is looking for. Free text plus tags the screener uses. */
export interface Thesis {
  /** One or two sentences in the partner's own words. */
  summary: string;
  sectors: string[];
  stages: string[];
  geos: string[];
  /** Things to stay away from. */
  avoid: string[];
}

export type SwarmStatus = "active" | "paused";

export interface Swarm {
  id: string;
  name: string;
  status: SwarmStatus;
  thesis: Thesis;
  /** The config currently in force (the "champion"). */
  configId: string;
  createdAt: string;
  updatedAt: string;
}

export type AgentStatus = "active" | "paused";

/**
 * One persistent agent in a swarm. A swarm starts with one agent per enabled
 * job; more can be added, each with its own "beat" (a focus area).
 */
export interface Agent {
  id: string;
  swarmId: string;
  jobId: JobId;
  classId: ClassId;
  name: string;
  status: AgentStatus;
  /** Focus area, for example "Rust infrastructure". */
  beat: string | null;
  /** Private working state such as the last item a scout has read. */
  state: Record<string, unknown>;
  createdAt: string;
}

/* ----------------------------- People ------------------------------ */

export interface ProfileLinks {
  github: string | null;
  linkedin: string | null;
  x: string | null;
  site: string | null;
  scholar: string | null;
}

export const EMPTY_LINKS: ProfileLinks = {
  github: null,
  linkedin: null,
  x: null,
  site: null,
  scholar: null,
};

export interface CompanyInfo {
  name: string | null;
  url: string | null;
  oneLiner: string | null;
  stage: string | null;
}

export type FounderStatus =
  /** Seen by a scout, not yet screened. */
  | "lead"
  /** Below the thesis-fit bar. Kept so the same person is not re-screened daily. */
  | "screened_out"
  /** Passed the screen and is waiting for a deep dive. */
  | "queued"
  /** Above the bar: put in front of the partners for a yes or a no. */
  | "surfaced"
  /** Looks strong on thin evidence: more evidence is being gathered. */
  | "needs_evidence"
  /** Not there yet: re-checked on a schedule. */
  | "watch"
  /** Below the watch bar after a deep dive, or a partner said no. */
  | "passed"
  /** An approved outreach action has been sent. */
  | "contacted"
  /** A partner is meeting them. */
  | "meeting"
  /** Removed from view, for example after a deletion request. */
  | "archived";

export interface Founder {
  id: string;
  swarmId: string;
  name: string;
  headline: string | null;
  location: string | null;
  company: CompanyInfo;
  /** The company record this founder belongs to, once one has been matched. */
  companyId?: string | null;
  links: ProfileLinks;
  status: FounderStatus;
  /** Thesis fit 0..1 from the screener. */
  fit: number | null;
  fitReasons: string[];
  tags: string[];
  /** 0..1 confidence that all evidence is about this one person. */
  identityConfidence: number | null;
  /** Sources that have sighted this founder. */
  sources: SourceId[];
  firstSeenAt: string;
  updatedAt: string;
  lastAssessedAt: string | null;
  nextRecheckAt: string | null;
  /** Set only for simulated founders. Never shown as a real identifier. */
  simId: string | null;
}

/** A single sighting of a person by a scout, before or after matching. */
export interface Lead {
  id: string;
  swarmId: string;
  founderId: string | null;
  source: SourceId;
  /** URL of the item the person was found in. */
  sourceRef: string;
  sourceTitle: string;
  personName: string;
  role: string | null;
  companyName: string | null;
  companyUrl: string | null;
  oneLiner: string | null;
  links: ProfileLinks;
  /** Why the scout flagged this person. */
  why: string;
  discoveredByTaskId: string | null;
  discoveredAt: string;
  /** Set for a lead a runner found on a hunt: the trail it was found on. */
  trailId?: string | null;
  /** The page's own words that show it. Code found them on the page before the lead was kept. */
  quote?: string | null;
  /** What the page says about how far along the company is, when it was about one. */
  stage?: import("./hunt").StageRead | null;
  /** 0 to 1 from `stage`, where 1 is as early as a company can be seen. Computed by code. */
  earliness?: number | null;
}

/* ---------------------------- Evidence ----------------------------- */

export type EvidenceKind =
  | "profile"
  | "repo"
  | "code_review"
  | "paper"
  | "post"
  | "launch"
  | "talk"
  | "interview"
  | "article"
  | "funding"
  | "reference"
  | "call_transcript"
  | "filing"
  | "other";

export type Verification =
  | "unverified"
  | "supported"
  | "unsupported"
  | "contradicted"
  | "wrong_person";

/**
 * A noisy observation of one rubric dimension that the simulator attaches to
 * synthetic evidence. Real evidence never has this.
 */
export interface SimSignal {
  dimension: DimensionId | CompanyDimensionId;
  /** 0..1 */
  value: number;
}

/**
 * Hidden ground truth the simulator attaches to synthetic evidence so that
 * simulated agents, and the evals, have something real to be right or wrong
 * about. Never present on real evidence and never placed in a prompt.
 */
export interface SimMeta {
  signals: SimSignal[];
  /** Whether the excerpt really supports the claim and is about this person. */
  truth: Exclude<Verification, "unverified">;
  /**
   * Set on a planted control. A planted claim is blatant by construction, so the simulated
   * fact-checker misses it far less often than an ordinary unsupported claim.
   */
  planted?: boolean;
}

/** Whether code found an item's quoted text at the address it cites. */
export type QuoteStatus =
  /** The quoted words are on the page. */
  | "found"
  /** The page was read and the quoted words are not on it. The item is rejected. */
  | "not_found"
  /** The page could not be read (blocked, too little text, not a web page). The fact-checker decides. */
  | "unreachable";

/** One sourced fact about a founder or a company: an excerpt and the claim it supports. */
export interface Evidence {
  id: string;
  /** The founder this was collected for. Company evidence is filed under the company's lead founder. */
  founderId: string;
  /** Set when the fact is about the company rather than the person. */
  companyId?: string | null;
  /** What a company fact is about. null for facts about a person. */
  facet?: EvidenceFacet | null;
  /** Result of the quote check, when one ran. */
  quote?: QuoteStatus | null;
  kind: EvidenceKind;
  source: SourceId;
  url: string | null;
  title: string;
  /** The source's own words, at most about 1200 characters. */
  excerpt: string;
  /** What this evidence shows about the founder, in one sentence. */
  claim: string;
  publishedAt: string | null;
  capturedAt: string;
  collectedByTaskId: string | null;
  /** Content hash used to drop duplicates. */
  hash: string;
  verification: Verification;
  verificationNote: string | null;
  sim: SimMeta | null;
}

/* --------------------------- Assessment ---------------------------- */

export interface Judgment {
  dimension: DimensionId;
  level: Level | null;
  confidence: number;
  rationale: string;
  evidenceIds: string[];
  counterEvidenceIds: string[];
}

export interface Assessment {
  id: string;
  founderId: string;
  runId: string | null;
  configId: string;
  composite: number;
  cracked: number;
  founderScore: number;
  coverage: number;
  potential: number | null;
  fit: number | null;
  decision: Decision;
  reasons: string[];
  flags: ScoreFlag[];
  breakdown: DimensionScore[];
  judgments: Judgment[];
  /** One-paragraph summary from the rubric analyst. */
  summary: string;
  memo: Memo | null;
  createdAt: string;
}

export interface Memo {
  headline: string;
  /** Markdown. */
  body: string;
  strengths: string[];
  risks: string[];
  openQuestions: string[];
  nextStep: string;
}

/* ----------------------------- Companies --------------------------- */

export type CompanyStatus =
  /** Known, not yet researched. */
  | "tracked"
  /** Above the bar: put in front of the partners for a yes or a no. */
  | "surfaced"
  /** Looks strong on thin evidence: more evidence is being gathered. */
  | "needs_evidence"
  /** Not there yet: re-checked on a schedule. */
  | "watch"
  /** Below the watch bar after research, or a partner said no. */
  | "passed"
  | "archived";

/** A sentence in someone else's words, with where it was read. */
export interface SourcedText {
  text: string;
  url: string | null;
}

export interface CompanyLinks {
  github: string | null;
  x: string | null;
  /** Kept as a pointer a person can open. The system never requests it. */
  linkedin: string | null;
  docs: string | null;
  careers: string | null;
}

export const EMPTY_COMPANY_LINKS: CompanyLinks = {
  github: null,
  x: null,
  linkedin: null,
  docs: null,
  careers: null,
};

/** One company a swarm is following. Several founders can belong to it. */
export interface Company {
  id: string;
  swarmId: string;
  name: string;
  /** The company's own site host, used to recognise the same company again. */
  domain: string | null;
  url: string | null;
  /** What it does, in one plain sentence. */
  oneLiner: string | null;
  /** The mission in the company's own words. */
  mission: SourcedText | null;
  /** The line the company's own site leads with, in its own words. */
  tagline: SourcedText | null;
  sector: string | null;
  stage: string | null;
  links: CompanyLinks;
  status: CompanyStatus;
  firstSeenAt: string;
  updatedAt: string;
  lastResearchedAt: string | null;
  lastAssessedAt: string | null;
  nextRecheckAt: string | null;
  /** Set only for simulated companies. Never shown as a real identifier. */
  simId: string | null;
}

/** One person on a company's team, as publicly listed. Professional details only. */
export interface CompanyMember {
  id: string;
  companyId: string;
  name: string;
  role: string | null;
  isFounder: boolean;
  /** Set when this person is also a founder the swarm follows. */
  founderId: string | null;
  links: ProfileLinks;
  /** One line of relevant earlier work. */
  background: string | null;
  source: SourceId;
  /** Where the team listing was read. */
  sourceUrl: string | null;
  addedAt: string;
}

export interface CompanyJudgment {
  dimension: CompanyDimensionId;
  level: Level | null;
  confidence: number;
  rationale: string;
  evidenceIds: string[];
  counterEvidenceIds: string[];
}

/** A point in a brief, with the evidence it rests on. A point that cites nothing verified is dropped. */
export interface CitedPoint {
  text: string;
  evidenceIds: string[];
}

/** The company in a few lines, for a partner with two minutes. */
export interface CompanyBrief {
  summary: string;
  moat: CitedPoint | null;
  strengths: CitedPoint[];
  risks: CitedPoint[];
  openQuestions: string[];
}

export interface CompanyAssessment {
  id: string;
  companyId: string;
  runId: string | null;
  configId: string;
  /** 0..1 the company on its own rubric. */
  company: number;
  companyCoverage: number;
  companyPotential: number | null;
  /** The founder whose score stands for the team, and that score. null when none is assessed. */
  leadFounderId: string | null;
  team: number | null;
  /** 0..1 founders and company together. This is what the bar is applied to. */
  deal: number;
  coverage: number;
  potential: number | null;
  decision: Decision;
  reasons: string[];
  flags: ScoreFlag[];
  breakdown: CompanyDimensionScore[];
  judgments: CompanyJudgment[];
  brief: CompanyBrief;
  createdAt: string;
}

/** A partner's call on a company: would we fund this, yes or no, and why. */
export interface CompanyFeedback {
  id: string;
  companyId: string;
  author: string;
  verdict: FeedbackVerdict;
  /** Ids from COMPANY_REASONS for this verdict. */
  reasonTags: string[];
  note: string | null;
  createdAt: string;
}

/* ----------------------------- Network ----------------------------- */

/**
 * One connection from a member's own exported contact list, uploaded by that
 * member. Name, company and position only: the export's email column is never stored.
 */
export interface NetworkContact {
  id: string;
  /** Who uploaded the list. */
  owner: string;
  name: string;
  company: string | null;
  position: string | null;
  /** A pointer a person can open. The system never requests it. */
  profileUrl: string | null;
  connectedOn: string | null;
  importedAt: string;
  /** What the same contact showed in the previous upload, when it differs. */
  previous: { company: string | null; position: string | null } | null;
}

export type FeedbackVerdict = "yes" | "no";

/**
 * A partner's call on a candidate: yes or no, and why. A founder can be
 * called more than once; the most recent call is the one in force. These are
 * the labels the improvement loop learns from.
 */
export interface Feedback {
  id: string;
  founderId: string;
  author: string;
  verdict: FeedbackVerdict;
  /** Ids of the quick reasons that were tapped (see FEEDBACK_REASONS). */
  reasonTags: string[];
  /** Anything the partner typed. */
  note: string | null;
  createdAt: string;
}

/* ----------------------------- Outreach ---------------------------- */

export type OutreachKind = "email_founder" | "call_founder" | "call_reference";

export type OutreachStatus =
  /** Drafted by the swarm, waiting for a person. */
  | "proposed"
  /** A person approved it. Nothing has been sent yet. */
  | "approved"
  | "rejected"
  /** Sent or dialled by a dispatcher, or marked as sent by a person. */
  | "dispatched"
  /** Finished, with a summary and usually a transcript. */
  | "completed"
  | "failed"
  | "cancelled";

export interface OutreachTarget {
  name: string;
  role: string | null;
  /** How this person relates to the founder, for references. */
  relationship: string | null;
  /** Where to reach them, described, not a private number. */
  channelHint: string | null;
}

export interface OutreachDraft {
  subject: string | null;
  body: string | null;
  agenda: string[];
  questions: string[];
  /** The sentence that tells the recipient who is contacting them and that an AI is involved. */
  disclosure: string;
}

export interface OutreachAction {
  id: string;
  swarmId: string;
  founderId: string;
  kind: OutreachKind;
  target: OutreachTarget;
  rationale: string;
  draft: OutreachDraft;
  /** Why contacting this person is appropriate, for example "founder-provided reference". */
  consentBasis: string;
  status: OutreachStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  resultSummary: string | null;
  transcriptEvidenceId: string | null;
  createdByTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------- Runs ------------------------------ */

export type Brain = "sim" | "live";
export type SourceMode = "sim" | "live";
/** "agent" = started by an outside agent holding the navigator's seat, for one wave of runners. */
export type RunTrigger = "schedule" | "manual" | "eval" | "agent";

/**
 * How much of the pipeline a run does. "hunt" is the hunt alone, then matching and the fit
 * screen so the trails learn who was kept; everything that costs real money waits for a full run.
 */
export type RunScope = "full" | "hunt";

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  /** Stopped starting new work because the spend cap was reached. */
  | "budget_stopped";

/**
 * The order a run works through. "Follow up" comes first because it turns the
 * results of outreach approved since the last run into evidence, which the
 * later stages then use.
 */
export const STAGES = [
  { id: "plan", label: "Plan" },
  { id: "debrief", label: "Follow up" },
  { id: "scout", label: "Scout" },
  { id: "hunt", label: "Hunt" },
  { id: "resolve", label: "Match" },
  { id: "screen", label: "Screen" },
  { id: "investigate", label: "Investigate" },
  { id: "verify", label: "Fact-check" },
  { id: "assess", label: "Assess" },
  { id: "memo", label: "Memo" },
  { id: "outreach", label: "Outreach plan" },
  { id: "digest", label: "Digest" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export interface RunStats {
  rawItems: number;
  leads: number;
  newFounders: number;
  mergedLeads: number;
  screened: number;
  screenedIn: number;
  investigated: number;
  evidence: number;
  evidenceRejected: number;
  assessed: number;
  surfaced: number;
  needsEvidence: number;
  watch: number;
  passed: number;
  outreachProposed: number;
  tasks: number;
  failures: number;
  skippedBudget: number;
  /** Companies researched, assessed and surfaced in this run. */
  companiesResearched: number;
  companiesAssessed: number;
  companiesSurfaced: number;
  /** Evidence rejected because its quoted text was not at the source it cites. */
  quotesRejected: number;
  /** Fact-check calls thrown away because the checker accepted a planted false claim. */
  controlsFailed: number;
}

export const ZERO_STATS: RunStats = {
  rawItems: 0,
  leads: 0,
  newFounders: 0,
  mergedLeads: 0,
  screened: 0,
  screenedIn: 0,
  investigated: 0,
  evidence: 0,
  evidenceRejected: 0,
  assessed: 0,
  surfaced: 0,
  needsEvidence: 0,
  watch: 0,
  passed: 0,
  outreachProposed: 0,
  tasks: 0,
  failures: 0,
  skippedBudget: 0,
  companiesResearched: 0,
  companiesAssessed: 0,
  companiesSurfaced: 0,
  quotesRejected: 0,
  controlsFailed: 0,
};

export interface Run {
  id: string;
  swarmId: string;
  trigger: RunTrigger;
  brain: Brain;
  sources: SourceMode;
  status: RunStatus;
  stage: StageId | null;
  configId: string;
  budgetUsd: number;
  costUsd: number;
  stats: RunStats;
  error: string | null;
  /** Day number in the simulated world, for simulated sources. */
  simDay: number | null;
  /** Absent on a full run. */
  scope?: RunScope;
  /** For a hunt-only run: the most waves of runners it may send. Absent: as many as the navigator has turns. */
  waves?: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

/** One turn of a task transcript, in the shape eval reports expect. */
export interface TraceTurn {
  role: "system" | "user" | "assistant" | "tool_call" | "tool_result";
  content: string;
  name?: string;
}

/** What steering an agent was given for one task, kept for the audit trail. */
export interface SteeringSnapshot {
  directiveIds: string[];
  params: Record<string, ParamValue>;
  /** The exact guidance text placed in the prompt. */
  block: string;
}

/** One execution of one agent on one input. */
export interface TaskRun {
  id: string;
  runId: string;
  swarmId: string;
  agentId: string;
  jobId: JobId;
  classId: ClassId;
  stage: StageId;
  founderId: string | null;
  /** Set for tasks that worked on a company. */
  companyId?: string | null;
  status: TaskStatus;
  skipReason: string | null;
  attempt: number;
  provider: ProviderId;
  model: string;
  effort: string | null;
  /** A short human description of the input, for lists. */
  inputSummary: string;
  /** A short human description of the result, for lists. */
  outputSummary: string | null;
  output: unknown | null;
  steering: SteeringSnapshot;
  usage: Usage | null;
  /** null when the provider reported no cost and the model has no confirmed price. */
  costUsd: number | null;
  latencyMs: number | null;
  /** Leads, evidence items, verdicts or judgments this task produced. */
  itemsOut: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Which wording of the job's prompt was used, for example "base" or "blind-pedigree". */
  promptVariant?: string | null;
  /** A short hash of the instructions this task was given, so a silent change of wording shows up. */
  promptHash?: string | null;
  /** For a fact-check call that carried a planted false claim: whether the checker rejected it. */
  control?: "passed" | "failed" | null;
  /** The pool member this task was sent to, when the job has a pool. */
  poolMember?: string | null;
  /** Loaded only by the task detail endpoint. */
  trace?: TraceTurn[];
}

/* ------------------------------ Settings --------------------------- */

export interface ScheduleSettings {
  enabled: boolean;
  /** Five-field cron expression. */
  cron: string;
  timezone: string;
  brain: Brain;
  sources: SourceMode;
}

/**
 * How far the swarm may steer itself from its own evals.
 * - off:     evals run only when a person starts them.
 * - suggest: after each scheduled run the swarm runs eval rounds and shows what it would change.
 * - apply:   it also puts a kept change into use, when that change was measured on real data.
 */
export type AutopilotMode = "off" | "suggest" | "apply";

export interface AutopilotSettings {
  mode: AutopilotMode;
  /** The most the swarm may spend on eval model calls in one day, in dollars. 0 keeps it to evals that cost nothing. */
  budgetUsd: number;
}

export interface Settings {
  /** When true no new run or task starts, anywhere. */
  killSwitch: boolean;
  schedule: ScheduleSettings;
  autopilot: AutopilotSettings;
  /** Name recorded as the author of steering and approvals. */
  operatorName: string;
  /** Suggested-steering keys a partner has dismissed, so they are not offered again. */
  dismissedSuggestions: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  killSwitch: false,
  schedule: {
    enabled: false,
    cron: "0 6 * * *",
    timezone: "America/Los_Angeles",
    brain: "sim",
    sources: "sim",
  },
  // The swarm looks for improvements by itself but changes nothing until a person says so.
  autopilot: { mode: "suggest", budgetUsd: 0 },
  operatorName: "Partner",
  dismissedSuggestions: [],
};

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
}
