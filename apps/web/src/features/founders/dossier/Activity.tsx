import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import type { Lead, OutreachAction, TaskRun } from "@agentswarm/shared";
import { ErrorNote, Panel, SkeletonRows } from "../../../components/ui/layout";
import { Status } from "../../../components/ui/marks";
import { Sheet } from "../../../components/ui/overlay";
import { Table, TableScroll, Td, Th, Tr } from "../../../components/ui/table";
import { ago, dateShort, plural, usd } from "../../../lib/format";
import { useTask } from "../../../lib/queries";
import { SourceLink } from "../SourceLink";
import { OUTREACH_KIND_LABEL, OUTREACH_VIEW, ROLE_LABEL, TASK_VIEW, jobLabel, sourceLabel } from "../labels";
import { SourceIcon } from "../../../components/icons";

export function SpottedPanel({ leads }: { leads: Lead[] }) {
  return (
    <Panel title="Spotted" aside={<span>{plural(leads.length, "sighting")}</span>}>
      {leads.length === 0 ? (
        <p className="text-base text-ink-2">None yet</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {leads.map((lead) => (
            <li key={lead.id} className="flex items-center gap-3 border-b border-rule py-2.5 first:pt-0">
              <span role="img" aria-label={sourceLabel(lead.source)} title={sourceLabel(lead.source)} className="shrink-0">
                <SourceIcon source={lead.source} className="size-4 text-ink-2" />
              </span>
              <div className="min-w-0 flex-1">
                <SourceLink href={lead.sourceRef}>{lead.sourceTitle}</SourceLink>
              </div>
              <span className="figure text-sm text-ink-3">{dateShort(lead.discoveredAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function OutreachPanel({ outreach }: { outreach: OutreachAction[] }) {
  // Outreach exists only after a Yes. Until then the panel would say nothing.
  if (outreach.length === 0) return null;
  return (
    <Panel title="Outreach">
      <ul className="m-0 flex list-none flex-col p-0">
          {outreach.map((action) => {
            const view = OUTREACH_VIEW[action.status];
            return (
              <li key={action.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule py-2.5 first:pt-0">
                <span className="font-bold text-ink">{OUTREACH_KIND_LABEL[action.kind]}</span>
                <span className="text-ink-2">{action.target.name}</span>
                <Status state={view.mark}>{view.label}</Status>
                <Link to="/approvals" className="ml-auto inline-flex items-center gap-1 text-sm font-bold text-navy hover:underline">
                  Approvals
                  <ExternalLink className="size-3.5" aria-hidden />
                </Link>
              </li>
            );
          })}
      </ul>
    </Panel>
  );
}

export function AgentWorkPanel({ tasks }: { tasks: TaskRun[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = tasks.find((t) => t.id === openId) ?? null;

  return (
    <Panel title="Agent work" aside={<span>{plural(tasks.length, "task")}</span>}>
      {tasks.length === 0 ? (
        <p className="text-base text-ink-2">None yet</p>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>State</Th>
                <Th>Model</Th>
                <Th numeric>Cost</Th>
                <Th numeric>When</Th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const view = TASK_VIEW[task.status];
                return (
                  <Tr key={task.id}>
                    <Td>
                      <button type="button" onClick={() => setOpenId(task.id)} className="text-left font-bold text-ink hover:text-navy hover:underline">
                        {jobLabel(task.jobId)}
                      </button>
                    </Td>
                    <Td>
                      <Status state={view.mark}>{view.label}</Status>
                    </Td>
                    <Td className="font-mono text-sm text-ink-2">{task.model}</Td>
                    <Td numeric>{usd(task.costUsd)}</Td>
                    <Td numeric className="text-ink-2">
                      {ago(task.startedAt)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      )}

      <TaskSheet taskId={open?.id ?? null} task={open} onClose={() => setOpenId(null)} />
    </Panel>
  );
}

function TaskSheet({ taskId, task, onClose }: { taskId: string | null; task: TaskRun | null; onClose: () => void }) {
  const transcript = useTask(taskId);

  return (
    <Sheet
      open={taskId !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={task ? jobLabel(task.jobId) : "Task"}
      description={task ? `${task.model} · ${usd(task.costUsd)}` : undefined}
      width="lg"
    >
      {transcript.isLoading ? (
        <SkeletonRows rows={6} />
      ) : transcript.error ? (
        <ErrorNote title="No transcript">{transcript.error.message}</ErrorNote>
      ) : transcript.data?.trace && transcript.data.trace.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-4 p-0">
          {transcript.data.trace.map((turn, index) => (
            <li key={index} className="flex min-w-0 flex-col gap-1 border-b border-rule pb-4 last:border-b-0">
              <p className="text-sm font-bold text-ink-3">
                {ROLE_LABEL[turn.role]}
                {turn.name ? <span className="font-mono font-normal">{` · ${turn.name}`}</span> : null}
              </p>
              <div className="font-mono text-sm break-words whitespace-pre-wrap text-ink">{turn.content}</div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-base text-ink-2">No transcript</p>
      )}
    </Sheet>
  );
}
