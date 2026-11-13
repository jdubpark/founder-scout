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
    <Table>
      <thead>
        <tr>
          <Th>Founder</Th>
          <Th>Status</Th>
          <Th numeric>Overall</Th>
          <Th>Call</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const status = STATUS_VIEW[row.status];
          const marked = wouldSurface?.has(row.id) ?? false;
          const quiet = [row.companyName, row.headline].filter(Boolean).join(" · ");
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
                    {quiet ? (
                      <p className="max-w-72 truncate text-sm text-ink-3" title={quiet}>
                        {quiet}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Td>
              <Td className="whitespace-nowrap">
                <Status state={status.mark}>{status.label}</Status>
              </Td>
              <Td className="min-w-40">
                <div className="flex items-center justify-end gap-3">
                  <Meter value={row.composite} threshold={threshold} label={`Overall for ${row.name}`} showFigure={false} className="w-24" />
                  <span className="figure w-8 text-right font-bold text-ink">{score100(row.composite)}</span>
                  {marked ? <Chip tone="gold">Surface</Chip> : null}
                </div>
              </Td>
              <Td data-no-open className="min-w-24 whitespace-nowrap">
                <YesNo founderId={row.id} verdict={row.feedback} reasons={row.feedbackReasons} size="row" className="flex-nowrap" />
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
