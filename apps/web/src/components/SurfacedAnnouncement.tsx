import { Link } from "react-router-dom";
import type { CompanyRow, FounderRow } from "@agentswarm/shared";
import { cn } from "../lib/cn";
import { score100 } from "../lib/format";
import { Avatar, EmptyState } from "./ui/layout";
import { YesNo } from "./YesNo";

/**
 * The surfaced founders as a list, each with its score and the partner's Yes or No right on
 * the row, so the list can be worked without opening anything. Founders still waiting for a
 * call come first, best score first; the ones already called follow. When there are companies
 * waiting for a call too, they are listed under their own small label.
 */
export function SurfacedAnnouncement({
  rows,
  companies = [],
  className,
}: {
  rows: FounderRow[];
  companies?: CompanyRow[];
  className?: string;
}) {
  const ranked = [...rows].sort(
    (a, b) => Number(a.feedback !== null) - Number(b.feedback !== null) || (b.composite ?? -1) - (a.composite ?? -1),
  );

  if (ranked.length === 0 && companies.length === 0) {
    return (
      <EmptyState
        title="Nobody cleared the bar"
        className={className}
        action={
          <Link to="/founders" className="font-bold text-navy">
            See who is close
          </Link>
        }
      />
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {ranked.length > 0 ? (
        <ol className="m-0 flex list-none flex-col p-0">
          {ranked.map((row) => (
            <li key={row.id} className="flex min-w-0 items-center gap-3 border-b border-rule py-2.5 last:border-b-0">
              <Avatar name={row.name} />
              <Link to={`/founders/${row.id}`} className="group min-w-0 flex-1 no-underline">
                <span className="block truncate text-base font-black text-ink group-hover:underline">{row.name}</span>
                <span className="block truncate text-sm text-ink-2">
                  {[row.companyName, row.headline].filter(Boolean).join(" · ")}
                </span>
              </Link>
              <span
                className="figure w-9 shrink-0 text-right text-lg font-black text-ink"
                aria-label={`Overall score ${score100(row.composite)} out of 100`}
              >
                {score100(row.composite)}
              </span>
              <YesNo founderId={row.id} verdict={row.feedback} reasons={row.feedbackReasons} />
            </li>
          ))}
        </ol>
      ) : null}

      {companies.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h3 className="m-0 text-sm font-bold text-ink-3">Companies</h3>
          <ol className="m-0 flex list-none flex-col p-0">
            {companies.map((company) => (
              <li key={company.id} className="flex min-w-0 items-center gap-3 border-b border-rule py-2.5 last:border-b-0">
                <Avatar name={company.name} />
                <Link
                  to={`/companies/${encodeURIComponent(company.id)}`}
                  className="group min-w-0 flex-1 no-underline"
                >
                  <span className="block truncate text-base font-black text-ink group-hover:underline">{company.name}</span>
                  {company.oneLiner ? (
                    <span className="block truncate text-sm text-ink-2" title={company.oneLiner}>
                      {company.oneLiner}
                    </span>
                  ) : null}
                </Link>
                <span
                  className="figure w-9 shrink-0 text-right text-lg font-black text-ink"
                  aria-label={`Overall score ${score100(company.deal)} out of 100`}
                >
                  {score100(company.deal)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
