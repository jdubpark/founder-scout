import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { AGENT_CLASSES, CLASS_IDS, getJob, type ClassId, type TaskRun } from "@agentswarm/shared";
import { ClassIcon } from "../../components/icons";
import { Caution, Status } from "../../components/ui/marks";
import { Table, TableScroll, Td, Th, Tr } from "../../components/ui/table";
import { Avatar } from "../../components/ui/layout";
import { cn } from "../../lib/cn";
import { duration, tokens, usd } from "../../lib/format";
import { TASK_STATUS } from "./labels";

/** Class buttons and the problems toggle above the task table. */
export function TaskFilters({
  tasks,
  classFilter,
  onClass,
  onlyProblems,
  onProblems,
}: {
  tasks: TaskRun[];
  classFilter: ClassId | null;
  onClass: (id: ClassId | null) => void;
  onlyProblems: boolean;
  onProblems: (value: boolean) => void;
}) {
  const problems = tasks.filter(isProblem).length;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {CLASS_IDS.map((id) => {
        const cls = AGENT_CLASSES.find((c) => c.id === id);
        const n = tasks.filter((t) => t.classId === id).length;
        const pressed = classFilter === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={pressed}
            onClick={() => onClass(pressed ? null : id)}
            disabled={n === 0}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-sm font-semibold transition-colors duration-150 disabled:opacity-40",
              pressed ? "border-navy bg-blue-tint text-ink" : "border-rule-strong bg-surface text-ink-2 hover:text-ink",
            )}
          >
            <ClassIcon classId={id} />
            {cls?.label ?? id}
            <span className="figure text-ink-3">{n}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={onlyProblems}
        onClick={() => onProblems(!onlyProblems)}
        className={cn(
          "ml-auto inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-sm font-semibold transition-colors duration-150",
          onlyProblems ? "border-navy bg-blue-tint text-ink" : "border-rule-strong bg-surface text-ink-2 hover:text-ink",
        )}
      >
        <AlertTriangle className="size-4" aria-hidden />
        Problems only
        <span className="figure">{problems}</span>
      </button>
    </div>
  );
}

export function isProblem(task: TaskRun): boolean {
  return task.status === "failed" || task.status === "skipped";
}

export function TasksTable({
  tasks,
  names,
  onOpen,
  openId,
}: {
  tasks: TaskRun[];
  names: ReadonlyMap<string, string>;
  onOpen: (id: string) => void;
  openId: string | null;
}) {
  if (tasks.length === 0) {
    return <p className="m-0 text-base text-ink-3">None</p>;
  }
  return (
    <TableScroll>
      <Table>
        <thead>
          <tr>
            <Th>Job</Th>
            <Th>Founder</Th>
            <Th>State</Th>
            <Th>Model</Th>
            <Th numeric>In</Th>
            <Th numeric>Out</Th>
            <Th numeric>Cost</Th>
            <Th numeric>Time</Th>
            <Th>Result</Th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const job = safeJob(t.jobId);
            const state = TASK_STATUS[t.status];
            const founderName = t.founderId ? names.get(t.founderId) ?? "Founder" : null;
            return (
              <Tr key={t.id} interactive selected={openId === t.id} onClick={() => onOpen(t.id)}>
                <Td>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(t.id);
                    }}
                    className="inline-flex max-w-full items-center gap-2 text-left text-base font-semibold text-ink underline-offset-4 hover:underline"
                  >
                    <ClassIcon classId={t.classId} className="text-ink-2" />
                    <span className="truncate">{job}</span>
                  </button>
                </Td>
                <Td>
                  {t.founderId && founderName ? (
                    <Link
                      to={`/founders/${encodeURIComponent(t.founderId)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex max-w-48 items-center gap-2 text-base font-bold text-ink hover:underline"
                      title={founderName}
                    >
                      <Avatar name={founderName} size="sm" />
                      <span className="truncate">{founderName}</span>
                    </Link>
                  ) : (
                    <span className="text-base text-ink-3">—</span>
                  )}
                </Td>
                <Td>
                  <Status state={state.mark}>{state.label}</Status>
                </Td>
                <Td>
                  <span className="block max-w-40 truncate text-sm text-ink-2" title={t.model}>
                    {t.model}
                  </span>
                </Td>
                <Td numeric>{tokens(t.usage?.inputTokens)}</Td>
                <Td numeric>{tokens(t.usage?.outputTokens)}</Td>
                <Td numeric>{usd(t.costUsd)}</Td>
                <Td numeric>{duration(t.latencyMs)}</Td>
                <Td className="min-w-64">
                  <Result task={t} />
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </TableScroll>
  );
}

function Result({ task }: { task: TaskRun }) {
  if (task.status === "failed") {
    return <Caution className="line-clamp-2">{task.error ?? "Failed"}</Caution>;
  }
  if (task.status === "skipped") {
    return <span className="line-clamp-2 text-base text-ink-2">{task.skipReason ?? "Skipped"}</span>;
  }
  return <span className="line-clamp-2 text-base text-ink-2">{task.outputSummary ?? "—"}</span>;
}

function safeJob(id: TaskRun["jobId"]): string {
  try {
    return getJob(id).label;
  } catch {
    return id;
  }
}

