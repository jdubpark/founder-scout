import {
  JOBS,
  SOURCES,
  type EvidenceKind,
  type FeedbackVerdict,
  type JobId,
  type OutreachKind,
  type OutreachStatus,
  type SourceId,
  type TaskStatus,
  type TraceTurn,
  type Verification,
} from "@agentswarm/shared";
import type { MarkState } from "../../components/ui/marks";

export function sourceLabel(id: SourceId): string {
  return SOURCES.find((s) => s.id === id)?.label ?? id;
}

export function jobLabel(id: JobId | string): string {
  return JOBS.find((j) => j.id === id)?.label ?? id;
}

/** Verifications the fact-checker rejected. These items are shown but never counted. */
export const REJECTED_VERIFICATIONS: ReadonlySet<Verification> = new Set<Verification>([
  "unsupported",
  "contradicted",
  "wrong_person",
]);

export function isRejected(verification: Verification): boolean {
  return REJECTED_VERIFICATIONS.has(verification);
}

export const VERIFICATION_VIEW: Record<Verification, { label: string; mark: MarkState }> = {
  unverified: { label: "Not checked", mark: "idle" },
  supported: { label: "Supported", mark: "ok" },
  unsupported: { label: "Unsupported", mark: "error" },
  contradicted: { label: "Contradicted", mark: "error" },
  wrong_person: { label: "Wrong person", mark: "error" },
};

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  profile: "Profile",
  repo: "Repository",
  code_review: "Code review",
  paper: "Paper",
  post: "Post",
  launch: "Launch",
  talk: "Talk",
  interview: "Interview",
  video: "Video",
  article: "Article",
  funding: "Funding",
  reference: "Reference",
  call_transcript: "Conversation",
  filing: "Filing",
  other: "Other",
};

/** The partner's call, in words for the rare place that needs them. */
export const CALL_LABEL: Record<FeedbackVerdict, string> = { yes: "Yes", no: "No" };

export const OUTREACH_KIND_LABEL: Record<OutreachKind, string> = {
  email_founder: "Email to founder",
  call_founder: "Call with founder",
  call_reference: "Call with a reference",
};

export const OUTREACH_VIEW: Record<OutreachStatus, { label: string; mark: MarkState }> = {
  proposed: { label: "Waiting for a decision", mark: "warn" },
  approved: { label: "Approved, not sent", mark: "idle" },
  rejected: { label: "Rejected", mark: "idle" },
  dispatched: { label: "Sent", mark: "ok" },
  completed: { label: "Completed", mark: "ok" },
  failed: { label: "Failed", mark: "error" },
  cancelled: { label: "Cancelled", mark: "paused" },
};

export const TASK_VIEW: Record<TaskStatus, { label: string; mark: MarkState }> = {
  queued: { label: "Queued", mark: "idle" },
  running: { label: "Running", mark: "running" },
  succeeded: { label: "Done", mark: "ok" },
  failed: { label: "Failed", mark: "error" },
  skipped: { label: "Skipped", mark: "paused" },
};

export const ROLE_LABEL: Record<TraceTurn["role"], string> = {
  system: "System",
  user: "Input",
  assistant: "Model",
  tool_call: "Tool call",
  tool_result: "Tool result",
};
