import { STAGES, type Decision, type FounderStatus, type StageId } from "@agentswarm/shared";
import type { MarkState } from "../components/ui/marks";

export function getStage(id: StageId) {
  return STAGES.find((s) => s.id === id) ?? { id, label: id };
}

/** The words partners see for each founder status, and the mark and chip tone that go with them. */
export const STATUS_VIEW: Record<
  FounderStatus,
  { label: string; mark: MarkState; tone: "neutral" | "green" | "gold" | "red" | "bistre"; help: string }
> = {
  lead: { label: "New lead", mark: "idle", tone: "neutral", help: "Seen by a scout and not yet screened." },
  screened_out: { label: "Outside thesis", mark: "idle", tone: "neutral", help: "Below the thesis-fit bar." },
  queued: { label: "Queued", mark: "idle", tone: "neutral", help: "Passed the screen and waiting for a deep dive." },
  surfaced: { label: "Surfaced", mark: "surfaced", tone: "gold", help: "Above the bar. Worth a partner's attention." },
  needs_evidence: {
    label: "Needs evidence",
    mark: "warn",
    tone: "bistre",
    help: "What is known looks strong, but too little is known.",
  },
  watch: { label: "Watching", mark: "warn", tone: "bistre", help: "Not there yet. Re-checked on a schedule." },
  passed: { label: "Passed", mark: "idle", tone: "neutral", help: "Below the watch bar after a deep dive." },
  contacted: { label: "Contacted", mark: "ok", tone: "green", help: "An approved message or call has gone out." },
  meeting: { label: "Meeting", mark: "ok", tone: "green", help: "A partner is meeting them." },
  archived: { label: "Archived", mark: "paused", tone: "neutral", help: "Removed from view." },
};

export const DECISION_LABEL: Record<Decision, string> = {
  surface: "Surface",
  needs_evidence: "Needs evidence",
  watch: "Watch",
  pass: "Pass",
};
