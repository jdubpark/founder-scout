import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Run } from "@agentswarm/shared";
import { Meter } from "../../components/ui/layout";
import { Chip, Status } from "../../components/ui/marks";
import { Table, TableScroll, Td, Th, Tr } from "../../components/ui/table";
import { count, dateTime, usd } from "../../lib/format";
import { getStage } from "../../lib/stages";
import { isActive, isSimulated, RUN_STATUS, TRIGGER } from "./labels";

export function RunsTable({ runs }: { runs: Run[] }) {
  const navigate = useNavigate();

  // A click on a link inside the row is left to the link.
  const open = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    if ((event.target as HTMLElement).closest("a")) return;
    navigate(`/activity/${id}`);
  };

  return (
    <TableScroll>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Status</Th>
            <Th numeric>Leads</Th>
            <Th numeric>Investigated</Th>
            <Th numeric>Surfaced</Th>
            <Th>Cost</Th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const status = RUN_STATUS[run.status];
            const TriggerIcon = TRIGGER[run.trigger].icon;
            const share = run.budgetUsd > 0 ? run.costUsd / run.budgetUsd : null;
            const stage = run.stage && isActive(run) ? getStage(run.stage).label : null;
            return (
              <Tr key={run.id} interactive onClick={(e) => open(e, run.id)}>
                <Td>
                  <span className="inline-flex items-center gap-2">
                    <TriggerIcon className="size-4 shrink-0 text-ink-3" aria-hidden />
                    <Link to={`/activity/${run.id}`} className="font-bold text-ink hover:underline">
                      {dateTime(run.startedAt)}
                    </Link>
                    {isSimulated(run) ? <Chip tone="red">Simulated</Chip> : null}
                  </span>
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-3">
                    <Status state={status.mark}>{stage ? `${status.label}: ${stage}` : status.label}</Status>
                    {run.stats.failures > 0 ? <Status state="error">{`${count(run.stats.failures)} failed`}</Status> : null}
                  </span>
                </Td>
                <Td numeric>{count(run.stats.leads)}</Td>
                <Td numeric>{count(run.stats.investigated)}</Td>
                <Td numeric className="text-gold-ink">{count(run.stats.surfaced)}</Td>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <div className="w-24">
                      <Meter value={share} label="Cost against cap" showFigure={false} />
                    </div>
                    <span className="figure whitespace-nowrap text-sm text-ink-2">
                      {usd(run.costUsd)} / {usd(run.budgetUsd)}
                    </span>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </TableScroll>
  );
}
