import { useState } from "react";
import { Plus, Scale } from "lucide-react";
import {
  getJob,
  type JobId,
  type PoolMemberView,
  type PoolView,
  type RebalanceReport,
  type SwarmTreeDTO,
} from "@agentswarm/shared";
import { ClassIcon } from "../../components/icons";
import { Button } from "../../components/ui/Button";
import { ErrorNote, SkeletonRows } from "../../components/ui/layout";
import { Sheet, useToast } from "../../components/ui/overlay";
import { Status } from "../../components/ui/marks";
import { useRebalancePools, usePools } from "../../lib/queries";
import { routeText } from "./route";
import { PoolForm } from "./PoolForm";
import { draftFromMember, draftFromRoute, type MemberDraft } from "./poolDraft";
import { memberFigures, sharePercentText } from "./poolFigures";

const COLUMNS = "grid grid-cols-[8rem_minmax(0,1fr)_7rem_4.5rem_6rem_5rem_5.5rem] items-center gap-3";

/** The pools of every job in the swarm, grouped by class, with each member's share and figures. */
export function PoolsTab({ tree, swarmId }: { tree: SwarmTreeDTO; swarmId: string }) {
  const pools = usePools(swarmId);
  const rebalance = useRebalancePools();
  const toast = useToast();
  const [editing, setEditing] = useState<JobId | null>(null);
  const [report, setReport] = useState<RebalanceReport | null>(null);

  if (pools.error) return <ErrorNote title="Could not load">{pools.error.message}</ErrorNote>;
  if (!pools.data) return <SkeletonRows rows={6} />;

  const data = pools.data;
  const anyPool = data.pools.some((p) => p.members.length > 0);
  const windowText = data.windowDays === 1 ? "Last day" : `Last ${data.windowDays} days`;

  const preview = () =>
    rebalance.mutate(
      { swarmId, apply: false },
      {
        onSuccess: (result) => setReport(result),
        onError: (failure) => toast.problem("Shares were not checked", failure.message),
      },
    );

  const apply = () =>
    rebalance.mutate(
      { swarmId, apply: true },
      {
        onSuccess: () => {
          setReport(null);
          toast.done("Shares saved");
        },
        onError: (failure) => toast.problem("Shares were not saved", failure.message),
      },
    );

  const groups = tree.classes
    .map((c) => ({ classId: c.cls.id, label: c.cls.label, views: data.pools.filter((p) => p.classId === c.cls.id) }))
    .filter((g) => g.views.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-sm font-bold text-ink-2">{windowText}</p>
        <Button
          variant="secondary"
          size="sm"
          icon={<Scale />}
          disabled={!anyPool}
          busy={rebalance.isPending && report === null}
          busyLabel="Checking"
          onClick={preview}
        >
          Rebalance
        </Button>
      </div>

      {groups.map((group) => (
        <section key={group.classId} className="flex flex-col">
          <h3 className="m-0 mb-1 flex items-center gap-2 text-sm font-bold text-ink-3">
            <ClassIcon classId={group.classId} />
            {group.label}
          </h3>
          {group.views.map((view) =>
            editing === view.jobId ? (
              <div key={view.jobId} className="py-2">
                <p className="m-0 mb-2 text-base font-bold text-ink">{view.label}</p>
                <PoolForm
                  swarmId={swarmId}
                  jobId={view.jobId}
                  initial={initialDrafts(view)}
                  onDone={() => setEditing(null)}
                />
              </div>
            ) : view.members.length === 0 ? (
              <NoPoolLine key={view.jobId} view={view} onAdd={() => setEditing(view.jobId)} />
            ) : (
              <PoolBlock key={view.jobId} view={view} onEdit={() => setEditing(view.jobId)} />
            ),
          )}
        </section>
      ))}

      <Sheet
        open={report !== null}
        onOpenChange={(open) => {
          if (!open) setReport(null);
        }}
        title="Rebalance"
      >
        {report ? (
          <div className="flex flex-col gap-5">
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {report.pools.map((item) => (
                <li key={item.jobId} className="flex flex-col gap-1.5">
                  <p className="m-0 text-base font-bold text-ink">{item.label}</p>
                  {item.changes.length > 0 ? (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {item.changes.map((line, i) => (
                        <li key={i} className="text-base text-ink-2">
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-base text-ink-3">{item.note ?? "No change"}</p>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-end gap-2">
              <Button variant="quiet" onClick={() => setReport(null)} disabled={rebalance.isPending}>
                Close
              </Button>
              {report.pools.some((p) => p.changes.length > 0) ? (
                <Button variant="primary" onClick={apply} busy={rebalance.isPending} busyLabel="Saving">
                  Apply
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

/** A job with no pool: its label and the model it runs on, on one quiet line. */
function NoPoolLine({ view, onAdd }: { view: PoolView; onAdd: () => void }) {
  const job = getJob(view.jobId);
  return (
    <div className="flex items-center justify-between gap-3 border-b border-rule py-2">
      <span className="min-w-0 truncate text-base text-ink">{view.label}</span>
      <div className="flex shrink-0 items-center gap-3">
        <span className="truncate text-sm text-ink-2">{view.route ? routeText(job.kind, view.route) : "No model"}</span>
        {view.route ? (
          <Button variant="quiet" size="sm" icon={<Plus />} onClick={onAdd}>
            Add pool
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PoolBlock({ view, onEdit }: { view: PoolView; onEdit: () => void }) {
  return (
    <div className="flex flex-col gap-2 border-b border-rule py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-base font-bold text-ink">{view.label}</span>
        <Button variant="quiet" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <div className={`${COLUMNS} text-sm font-bold text-ink-3`} aria-hidden>
        <span>Member</span>
        <span>Model</span>
        <span>Share</span>
        <span className="text-right">Tasks</span>
        <span className="text-right">Supported</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Yield</span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {view.members.map((member) => (
          <MemberLine key={member.id} member={member} />
        ))}
      </ul>
    </div>
  );
}

function MemberLine({ member }: { member: PoolMemberView }) {
  const f = memberFigures(member);
  return (
    <li className={member.status === "benched" ? "flex flex-col gap-1 py-2 opacity-60" : "flex flex-col gap-1 py-2"}>
      <div className={`${COLUMNS} text-base`}>
        <span className="truncate font-mono text-sm text-ink">{member.id}</span>
        <span className="truncate text-ink-2">{member.modelLabel}</span>
        <span className="flex items-center gap-2">
          <span className="relative h-2 flex-1 rounded-full bg-sunk" role="img" aria-label={`Share ${sharePercentText(member.share)}`}>
            <span className="absolute inset-y-0 left-0 rounded-full bg-green-2" style={{ width: `${member.share * 100}%` }} />
          </span>
          <span className="figure w-9 text-right text-sm font-bold text-ink">{sharePercentText(member.share)}</span>
        </span>
        <span className="figure text-right text-ink-2">{f.tasks}</span>
        <span className="figure text-right text-ink-2">{f.supported}</span>
        <span className="figure text-right text-ink-2">{f.cost}</span>
        <span className="figure text-right font-bold text-ink">{f.yield}</span>
      </div>
      {f.benched ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Status state="paused">Benched</Status>
          {member.note ? <span className="text-ink-2">{member.note}</span> : null}
        </div>
      ) : null}
      {f.controls ? <span className="text-sm text-ink-3">Planted checks {f.controls}</span> : null}
    </li>
  );
}

function initialDrafts(view: PoolView): MemberDraft[] {
  if (view.members.length > 0) return view.members.map(draftFromMember);
  return view.route ? [draftFromRoute(view.route)] : [];
}
