import { useState } from "react";
import { Bot, CornerDownLeft, Settings2, User, Wrench, type LucideIcon } from "lucide-react";
import { getJob, type TaskRun, type TraceTurn } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { ErrorNote, SkeletonRows } from "../../components/ui/layout";
import { Sheet } from "../../components/ui/overlay";
import { Caution, Status } from "../../components/ui/marks";
import { plural } from "../../lib/format";
import { useTask } from "../../lib/queries";
import { TASK_STATUS } from "./labels";

const TURN: Record<TraceTurn["role"], { label: string; icon: LucideIcon }> = {
  system: { label: "System", icon: Settings2 },
  user: { label: "User", icon: User },
  assistant: { label: "Assistant", icon: Bot },
  tool_call: { label: "Tool call", icon: Wrench },
  tool_result: { label: "Tool result", icon: CornerDownLeft },
};

const COLLAPSED_LINES = 6;

/** Reads one task: the steering it was given, then its transcript. */
export function TaskSheet({
  row,
  open,
  onOpenChange,
}: {
  row: TaskRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Loaded only while open, so closed sheets make no request.
  const detail = useTask(open && row ? row.id : null);
  const task = detail.data ?? row;
  const label = row ? safeJob(row.jobId) : "Task";

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={label} width="lg">
      {!task ? null : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
            <Status state={TASK_STATUS[task.status].mark}>{TASK_STATUS[task.status].label}</Status>
            <span className="figure">{task.model}</span>
            {task.control === "passed" ? <Status state="ok">Planted check passed</Status> : null}
            {task.control === "failed" ? <Status state="error">Planted check failed</Status> : null}
            {task.promptHash ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-ink-3">Prompt</span>
                <span className="figure font-mono text-ink">
                  {task.promptVariant && task.promptVariant !== "base"
                    ? `${task.promptVariant} · ${task.promptHash}`
                    : task.promptHash}
                </span>
              </span>
            ) : null}
          </div>

          {task.error ? <Caution>{task.error}</Caution> : null}

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="name-caps m-0 text-sm text-ink">Steering</h3>
              <span className="text-sm text-ink-3">{plural(task.steering.directiveIds.length, "directive")}</span>
            </div>
            {task.steering.block ? (
              <div className="bg-sunk p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-ink">
                {task.steering.block}
              </div>
            ) : (
              <p className="m-0 text-base text-ink-3">None</p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="name-caps m-0 text-sm text-ink">Transcript</h3>
            {detail.error ? (
              <ErrorNote title="The transcript could not be loaded">{detail.error.message}</ErrorNote>
            ) : detail.isLoading ? (
              <SkeletonRows rows={4} />
            ) : detail.data?.trace && detail.data.trace.length > 0 ? (
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {detail.data.trace.map((turn, i) => (
                  <Turn key={i} turn={turn} />
                ))}
              </ol>
            ) : (
              <p className="m-0 text-base text-ink-3">None</p>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}

function Turn({ turn }: { turn: TraceTurn }) {
  const [expanded, setExpanded] = useState(false);
  const view = TURN[turn.role];
  const Icon = view.icon;
  const lines = turn.content.split("\n");
  const long = lines.length > COLLAPSED_LINES || turn.content.length > 800;
  const shown = long && !expanded ? lines.slice(0, COLLAPSED_LINES).join("\n") : turn.content;

  return (
    <li className="flex flex-col gap-1.5 border-t border-rule pt-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-2">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span>{view.label}</span>
        {turn.name ? <span className="font-mono text-xs text-ink-3">{turn.name}</span> : null}
      </div>
      <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-ink">
        {shown}
        {long && !expanded ? <span className="text-ink-3">{"\n…"}</span> : null}
      </div>
      {long ? (
        <div>
          <Button variant="quiet" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Show less" : "Show all"}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function safeJob(id: TaskRun["jobId"]): string {
  try {
    return getJob(id).label;
  } catch {
    return id;
  }
}
