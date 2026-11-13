import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { OutreachRow } from "@agentswarm/shared";
import { Segmented, type SegmentedOption } from "../components/ui/Field";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "../components/ui/layout";
import { useOutreach } from "../lib/queries";
import { useSwarm } from "../lib/swarm";
import { GROUPS, groupRows, isGroupId, type GroupId } from "../features/approvals/groups";
import { OutreachItem } from "../features/approvals/OutreachItem";

const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);

export default function ApprovalsPage() {
  const { swarmId } = useSwarm();
  const [params, setParams] = useSearchParams();
  // One read of every item gives all four counts; the tabs filter it.
  const outreach = useOutreach(swarmId ? { swarmId, status: "all" } : null);
  const rows: OutreachRow[] = useMemo(() => outreach.data ?? [], [outreach.data]);

  const param = params.get("status");
  const active: GroupId = isGroupId(param) ? param : "waiting";

  const waiting = useMemo(
    () => groupRows(rows, "waiting").sort((a, b) => time(a.createdAt) - time(b.createdAt)),
    [rows],
  );
  const shown = useMemo(() => {
    if (active === "waiting") return waiting;
    return groupRows(rows, active).sort((a, b) => time(b.decidedAt ?? b.updatedAt) - time(a.decidedAt ?? a.updatedAt));
  }, [active, rows, waiting]);

  const options: SegmentedOption<GroupId>[] = GROUPS.map((g) => ({
    value: g.id,
    label: g.label,
    count: groupRows(rows, g.id).length,
  }));

  const choose = (id: GroupId) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === "waiting") next.delete("status");
        else next.set("status", id);
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader title="Approvals">
        {outreach.data ? (
          <Segmented value={active} onChange={choose} options={options} label="Status" className="self-start" />
        ) : null}
      </PageHeader>

      {outreach.error ? (
        <ErrorNote title="Approvals could not be loaded">{outreach.error.message}</ErrorNote>
      ) : !outreach.data ? (
        <SkeletonRows rows={4} />
      ) : shown.length === 0 ? (
        active === "waiting" ? (
          <EmptyState
            title="No drafts waiting"
            action={
              <Link to="/founders" className="text-base font-semibold text-green-2">
                Open founders
              </Link>
            }
          />
        ) : (
          <EmptyState title="Nothing here yet" />
        )
      ) : (
        <>
          <ul className="m-0 flex max-w-3xl list-none flex-col gap-4 p-0">
            {shown.map((row) => (
              <li key={row.id}>
                <OutreachItem row={row} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
