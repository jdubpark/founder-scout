import type { StageProgress } from "@agentswarm/shared";
import { StateMark, Status, type MarkState } from "../../components/ui/marks";
import { cn } from "../../lib/cn";
import { plural, usd } from "../../lib/format";

const STATE_WORD: Record<StageProgress["state"], string> = {
  done: "Done",
  running: "Running",
  pending: "Waiting",
  skipped: "Skipped",
};

const STATE_MARK: Record<StageProgress["state"], MarkState> = {
  done: "ok",
  running: "running",
  pending: "idle",
  skipped: "planned",
};

/**
 * The stages as one connected sequence. The rule between two stages is green
 * once the stage before it is done, so the track reads as progress.
 */
export function StageTrack({ stages }: { stages: StageProgress[] }) {
  return (
    <ol aria-label="Stages" className="m-0 flex list-none p-0">
      {stages.map((s, i) => {
        const first = i === 0;
        const last = i === stages.length - 1;
        const done = s.state === "done";
        const reached = done || s.state === "running";
        return (
          <li
            key={s.stage}
            aria-current={s.state === "running" ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center gap-2 px-1"
          >
            <div className="flex w-full items-center">
              <span className={cn("h-px flex-1", first ? "invisible" : reached ? "bg-green-2" : "bg-rule-strong")} />
              <StateMark state={STATE_MARK[s.state]} className="mx-1.5" />
              <span className={cn("h-px flex-1", last ? "invisible" : done ? "bg-green-2" : "bg-rule-strong")} />
            </div>
            <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
              <span className="text-sm font-semibold text-ink">{s.label}</span>
              <span className="text-xs text-ink-3">{STATE_WORD[s.state]}</span>
              <span className="figure text-sm text-ink-2">{s.tasks > 0 ? plural(s.tasks, "task") : "No tasks"}</span>
              {s.failures > 0 ? <Status state="error">{`${s.failures} failed`}</Status> : null}
              {s.tasks > 0 ? (
                <span className="figure text-xs text-ink-3">{s.costUsd > 0 ? usd(s.costUsd) : "not priced"}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
