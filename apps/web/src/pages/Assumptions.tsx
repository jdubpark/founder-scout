import { useState } from "react";
import type { AssumptionRow } from "@agentswarm/shared";
import { EmptyState, ErrorNote, PageHeader, Panel, SkeletonRows } from "../components/ui/layout";
import { Caution, Status } from "../components/ui/marks";
import { useAssumptions } from "../lib/queries";
import { useSwarm } from "../lib/swarm";
import { AssumptionRowView } from "../features/assumptions/AssumptionRowView";
import { STATUS_LABEL, STATUS_MARK, STATUS_ORDER, countByStatus, groupByArea } from "../features/assumptions/model";

export default function AssumptionsPage() {
  const { swarm, swarmId } = useSwarm();
  const data = useAssumptions(swarmId);
  const [openId, setOpenId] = useState<string | null>(null);

  const header = <PageHeader title="Assumptions" />;

  if (!swarm) {
    return (
      <>
        {header}
        <EmptyState title="No swarm yet" />
      </>
    );
  }

  if (data.error) {
    return (
      <>
        {header}
        <ErrorNote title="The assumptions could not be loaded">{data.error.message}</ErrorNote>
      </>
    );
  }

  if (!data.data) {
    return (
      <>
        {header}
        <SkeletonRows rows={8} />
      </>
    );
  }

  const { rows, outcomesBasis, callsBasis } = data.data;
  const counts = countByStatus(rows);
  const groups = groupByArea(rows);
  const noEvidence = outcomesBasis === null && callsBasis === null;

  return (
    <>
      {header}

      <div className="flex flex-col gap-6">
        {outcomesBasis ? <Caution>{outcomesBasis}</Caution> : null}
        {callsBasis ? <Caution>{callsBasis}</Caution> : null}

        <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
          {STATUS_ORDER.map((status) => (
            <div key={status} className="flex items-center gap-2">
              <dt>
                <Status state={STATUS_MARK[status]}>{STATUS_LABEL[status]}</Status>
              </dt>
              <dd className="figure m-0 text-xl font-black text-ink">{counts[status]}</dd>
            </div>
          ))}
        </dl>

        {noEvidence ? <EmptyState title="No evidence yet" /> : null}

        {groups.map((group) => (
          <Panel key={group.id} title={group.label}>
            <ul className="m-0 flex list-none flex-col p-0">
              {group.rows.map((row: AssumptionRow) => (
                <AssumptionRowView
                  key={row.id}
                  row={row}
                  open={openId === row.id}
                  onToggle={() => setOpenId(openId === row.id ? null : row.id)}
                />
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}
