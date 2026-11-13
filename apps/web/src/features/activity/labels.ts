import { Bot, CalendarClock, FlaskConical, Hand, type LucideIcon } from "lucide-react";
import type { Run, RunStatus, RunTrigger, TaskStatus } from "@agentswarm/shared";
import type { MarkState } from "../../components/ui/marks";
import { duration } from "../../lib/format";

export const RUN_STATUS: Record<RunStatus, { label: string; mark: MarkState }> = {
  queued: { label: "Queued", mark: "idle" },
  running: { label: "Running", mark: "running" },
  succeeded: { label: "Succeeded", mark: "ok" },
  failed: { label: "Failed", mark: "error" },
  cancelled: { label: "Stopped", mark: "paused" },
  budget_stopped: { label: "Stopped at cap", mark: "warn" },
};

export const TRIGGER: Record<RunTrigger, { label: string; icon: LucideIcon }> = {
  schedule: { label: "Schedule", icon: CalendarClock },
  manual: { label: "Manual", icon: Hand },
  eval: { label: "Eval", icon: FlaskConical },
  agent: { label: "Outside agent", icon: Bot },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; mark: MarkState }> = {
  queued: { label: "Queued", mark: "idle" },
  running: { label: "Running", mark: "running" },
  succeeded: { label: "Done", mark: "ok" },
  failed: { label: "Failed", mark: "error" },
  skipped: { label: "Skipped", mark: "planned" },
};

/** A run is simulated when either its brain or its sources are simulated. */
export function isSimulated(run: Pick<Run, "brain" | "sources">): boolean {
  return run.brain === "sim" || run.sources === "sim";
}

export function isActive(run: Pick<Run, "status">): boolean {
  return run.status === "running" || run.status === "queued";
}

/** Time from start to finish, or to now while the run is still going. */
export function runDuration(run: Pick<Run, "startedAt" | "finishedAt">, now: number = Date.now()): string {
  const start = Date.parse(run.startedAt);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return duration(end - start);
}

export const MODE_LABEL = { sim: "Simulation", live: "Live" } as const;
