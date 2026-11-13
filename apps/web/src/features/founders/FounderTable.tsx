import type { MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { FounderRow } from "@agentswarm/shared";
import { Avatar, Meter } from "../../components/ui/layout";
import { Chip, Status } from "../../components/ui/marks";
import { Table, Td, Th, Tr } from "../../components/ui/table";
import { score100 } from "../../lib/format";
import { STATUS_VIEW } from "../../lib/stages";
import { YesNo } from "../../components/YesNo";

interface FounderTableProps {
  rows: FounderRow[];
  /** The bar in force or previewed, 0 to 1. undefined while it loads. */
  threshold: number | undefined;
  /** Founders that would surface at the previewed bar. null when no preview is open. */
  wouldSurface: ReadonlySet<string> | null;
}

export function dossierPath(id: string): string {
  return `/founders/${encodeURIComponent(id)}`;
}

/** Controls inside a row keep their own behaviour; only the rest of the row opens the dossier. */
const OWN_CLICK = "a, button, input, textarea, select, label, [data-no-open]";

export function FounderTable({ rows, threshold, wouldSurface }: FounderTableProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const open = (id: string, event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest(OWN_CLICK)) return;
    navigate(dossierPath(id), { state: { back: location.search } });
  };

  return (
    <Table className="table-fixed">
      <colgroup>
        <col className="w-[12%]" /><col className="w-[22%]" /><col className="w-[9%]" /><col className="w-[8%]" />
        <col className="w-[14%]" /><col className="w-[11%]" /><col className="w-[14%]" /><col className="w-[10%]" />
      </colgroup>
      <thead>
        <tr>
          <Th>Founder</Th>
          <Th>Company</Th>
          <Th>Industry</Th>
          <Th>Round</Th>
          <Th>Moat</Th>
          <Th>Status</Th>
          <Th numeric>Overall</Th>
          <Th>Call</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const status = STATUS_VIEW[row.status];
          const marked = wouldSurface?.has(row.id) ?? false;
          const companyLine = row.tagline ? `"${row.tagline}"` : row.companyOneLiner;
          return (
            <Tr key={row.id} interactive onClick={(event) => open(row.id, event)}>
              <Td>
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={row.name} />
                  <div className="min-w-0">
                    <Link
                      to={dossierPath(row.id)}
                      state={{ back: location.search }}
                      title={row.name}
                      className="block max-w-72 truncate font-bold text-ink hover:underline"
                    >
                      {row.name}
                    </Link>
                  </div>
                </div>
              </Td>
              <Td>
                {row.companyId ? (
                  <Link to={`/companies/${encodeURIComponent(row.companyId)}`} title={row.companyName ?? "-"} className="block truncate font-bold text-ink hover:underline">
                    {row.companyName ?? "-"}
                  </Link>
                ) : <span className="block truncate font-bold text-ink" title={row.companyName ?? "-"}>{row.companyName ?? "-"}</span>}
                <p className="truncate text-sm text-ink-3" title={companyLine ?? "-"}>{companyLine ?? "-"}</p>
              </Td>
              <Td>
                {row.sector ? <Chip title={row.sector} className="max-w-full truncate">{row.sector}</Chip> : <span className="text-ink-3">-</span>}
              </Td>
              <Td>
                {row.stage ? <Chip title={row.stage}>{row.stage}</Chip> : <span className="text-ink-3">-</span>}
              </Td>
              <Td title={row.moat ?? "-"}>
                <span className="block truncate text-sm text-ink-2">{row.moat ?? "-"}</span>
              </Td>
              <Td>
                <Status state={status.mark} className="min-w-0">
                  <span className="block truncate" title={status.label}>{status.label}</span>
                </Status>
              </Td>
              <Td>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
                  <Meter value={row.composite} threshold={threshold} label={`Overall for ${row.name}`} showFigure={false} className="w-14 shrink-0" />
                  <span className="figure w-7 text-right font-bold text-ink">{score100(row.composite)}</span>
                  {marked ? <Chip tone="gold">Surface</Chip> : null}
                </div>
              </Td>
              <Td data-no-open className="whitespace-nowrap">
                <YesNo founderId={row.id} verdict={row.feedback} reasons={row.feedbackReasons} size="row" className="flex-nowrap" />
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
