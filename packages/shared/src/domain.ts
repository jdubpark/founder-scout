/**
 * The records the swarm keeps. Timestamps are ISO-8601 strings in UTC.
 */

import type { ClassId, JobId, ProviderId, SourceId } from "./registry";
import type { DimensionId } from "./rubric";
import type { Decision, DimensionScore, Level, ScoreFlag } from "./scoring";
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
  /** Above the bar: put in front of the partners. */
  | "surfaced"
  /** Looks strong on thin evidence: more evidence is being gathered. */
  | "needs_evidence"
  /** Not there yet: re-checked on a schedule. */
  | "watch"
  /** Below the watch bar after a deep dive. */
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
  dimension: DimensionId;
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
}

/** One sourced fact about a founder: an excerpt and the claim it supports. */
export interface Evidence {
  id: string;
  founderId: string;
  kind: EvidenceKind;
  source: SourceId;
  url: string | null;
  title: string;
  /** A quote or close paraphrase of the source, at most about 1200 characters. */
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

export type FeedbackVerdict = "up" | "down" | "meet" | "pass" | "invested";

/** A partner's reaction. This is the label the improvement loop learns from. */
export interface Feedback {
  id: string;
  founderId: string;
  author: string;
  verdict: FeedbackVerdict;
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
export type RunTrigger = "schedule" | "manual" | "eval";

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  /** Stopped starting new work because the spend cap was reached. */
  | "budget_stopped";

export const STAGES = [
  { id: "plan", label: "Plan" },
  { id: "scout", label: "Scout" },
  { id: "resolve", label: "Match" },
  { id: "screen", label: "Screen" },
  { id: "investigate", label: "Investigate" },
  { id: "verify", label: "Fact-check" },
  { id: "assess", label: "Assess" },
  { id: "memo", label: "Memo" },
  { id: "outreach", label: "Outreach plan" },
  { id: "debrief", label: "Debrief" },
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

export interface Settings {
  /** When true no new run or task starts, anywhere. */
  killSwitch: boolean;
  schedule: ScheduleSettings;
  /** Name recorded as the author of steering and approvals. */
  operatorName: string;
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
  operatorName: "Partner",
};

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
}
