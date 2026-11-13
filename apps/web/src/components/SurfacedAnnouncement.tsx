import { Link } from "react-router-dom";
import type { FounderRow } from "@agentswarm/shared";
import { cn } from "../lib/cn";
import { score100 } from "../lib/format";
import { Avatar, EmptyState } from "./ui/layout";
import { YesNo } from "./YesNo";

/**
 * The surfaced founders as a list, each with its score and the partner's Yes or No right on
 * the row, so the list can be worked without opening anything. Founders still waiting for a
 * call come first, best score first; the ones already called follow.
 */
export function SurfacedAnnouncement({ rows, className }: { rows: FounderRow[]; className?: string }) {
  const ranked = [...rows].sort(
    (a, b) => Number(a.feedback !== null) - Number(b.feedback !== null) || (b.composite ?? -1) - (a.composite ?? -1),
  );

  if (ranked.length === 0) {
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
    <ol className={cn("m-0 flex list-none flex-col p-0", className)}>
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
  );
}
