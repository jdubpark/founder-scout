import type { MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Users } from "lucide-react";
import { COMPANY_REASONS, type CompanyRow } from "@agentswarm/shared";
import { DecisionIcon, SourceIcon } from "../../components/icons";
import { YesNo } from "../../components/YesNo";
import { Avatar, Meter } from "../../components/ui/layout";
import { Chip } from "../../components/ui/marks";
import { Table, Td, Th, Tr } from "../../components/ui/table";
import { score100 } from "../../lib/format";
import { DECISION_LABEL } from "../../lib/stages";

export function companyPath(id: string): string {
  return `/companies/${encodeURIComponent(id)}`;
}

/** Controls inside a row keep their own behaviour; only the rest of the row opens the company. */
const OWN_CLICK = "a, button, input, textarea, select, label, [data-no-open]";

export function CompanyTable({ rows }: { rows: CompanyRow[] }) {
  const navigate = useNavigate();
  const location = useLocation();

  const open = (id: string, event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest(OWN_CLICK)) return;
    navigate(companyPath(id), { state: { back: location.search } });
  };

  return (
    <Table>
      <thead>
        <tr>
          <Th>Company</Th>
          <Th numeric>Overall</Th>
          <Th>Scores</Th>
          <Th>Call</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.id} interactive onClick={(event) => open(row.id, event)}>
            <Td>
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={row.name} />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      to={companyPath(row.id)}
                      state={{ back: location.search }}
                      title={row.name}
                      className="min-w-0 truncate font-bold text-ink hover:underline"
                    >
                      {row.name}
                    </Link>
                    {row.stage ? <Chip>{row.stage}</Chip> : null}
                    {row.sector ? <Chip>{row.sector}</Chip> : null}
                    <FounderDots founders={row.founders} />
                  </div>
                  {row.tagline || row.oneLiner ? (
                    <p className="max-w-96 truncate text-sm text-ink-3" title={row.tagline ? `"${row.tagline}"` : row.oneLiner ?? ""}>
                      {row.tagline ? `"${row.tagline}"` : row.oneLiner}
                    </p>
                  ) : null}
                  {row.moat ? <p className="max-w-96 truncate text-sm text-ink-2" title={row.moat}>{row.moat}</p> : null}
                </div>
              </div>
            </Td>
            <Td className="min-w-40">
              <div className="flex items-center justify-end gap-3">
                <Meter value={row.deal} label={`Overall for ${row.name}`} showFigure={false} className="w-24" />
                <span className="figure w-8 text-right font-bold text-ink">{score100(row.deal)}</span>
                {row.decision ? (
                  <span role="img" aria-label={DECISION_LABEL[row.decision]} title={DECISION_LABEL[row.decision]}>
                    <DecisionIcon decision={row.decision} />
                  </span>
                ) : null}
              </div>
            </Td>
            <Td className="min-w-52">
              <div className="flex flex-col gap-1.5">
                <ScoreBar label="Founders" value={row.team} />
                <ScoreBar label="Company" value={row.company} />
              </div>
            </Td>
            <Td data-no-open className="min-w-24 whitespace-nowrap">
              <div className="flex items-center justify-end gap-3">
                {row.knownPeople > 0 ? (
                  <span
                    role="img"
                    aria-label={`${row.knownPeople} people you know work here`}
                    title={`${row.knownPeople} people you know work here`}
                    className="flex items-center gap-1 text-sm text-ink-2"
                  >
                    <SourceIcon source="network" className="size-3.5" />
                    <span className="figure font-bold">{row.knownPeople}</span>
                  </span>
                ) : null}
                <YesNo
                  companyId={row.id}
                  reasonOptions={COMPANY_REASONS}
                  verdict={row.feedback}
                  reasons={row.feedbackReasons}
                  size="row"
                  className="flex-nowrap"
                />
              </div>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-sm text-ink-3">{label}</span>
      <Meter value={value} label={`${label} score`} className="w-24" />
    </div>
  );
}

/** Up to three founders of the company as small avatars, then "+N" for the rest. */
function FounderDots({ founders }: { founders: CompanyRow["founders"] }) {
  const shown = founders.slice(0, 3);
  const more = founders.length - shown.length;
  if (shown.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center">
      <span className="flex -space-x-1.5">
        {shown.map((f) => (
          <span
            key={f.id}
            role="img"
            aria-label={f.name}
            title={f.name}
            className="inline-flex overflow-hidden rounded-full ring-2 ring-surface"
          >
            <Avatar name={f.name} size="sm" />
          </span>
        ))}
      </span>
      {more > 0 ? <span className="figure ml-1 text-sm font-bold text-ink-3">+{more}</span> : null}
    </span>
  );
}
