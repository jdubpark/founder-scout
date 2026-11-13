import { Link } from "react-router-dom";
import type { FounderRow } from "@agentswarm/shared";
import { cn } from "../lib/cn";
import { score100 } from "../lib/format";
import { EmptyState } from "./ui/layout";
import { StateMark } from "./ui/marks";

/**
 * The surfaced founders, set the way a syndicate announcement orders its
 * names: position and size are the ranking. One lead, a bracket of up to four,
 * then everyone else in running columns, with a rule between brackets.
 *
 * This is the dashboard's one signature element. Use it only for the current
 * surfaced list; every other list of founders is an ordinary table.
 */
export function SurfacedAnnouncement({ rows, className }: { rows: FounderRow[]; className?: string }) {
  const ranked = [...rows].sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));
  const lead = ranked[0];
  const second = ranked.slice(1, 5);
  const rest = ranked.slice(5);

  if (!lead) {
    return (
      <EmptyState title="Nobody cleared the bar in the last run" className={className}>
        Founders appear here when their overall score reaches the bar for this swarm and enough of the rubric is
        backed by evidence. To see more, lower the bar or widen the thesis in{" "}
        <Link to="/steering" className="font-semibold text-green-2">
          Steering
        </Link>
        , or look at who is close on the{" "}
        <Link to="/founders" className="font-semibold text-green-2">
          Founders
        </Link>{" "}
        page.
      </EmptyState>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <Entry row={lead} rank={1} size="lead" />

      {second.length > 0 ? (
        <ol
          start={2}
          className="m-0 grid list-none grid-cols-1 gap-x-8 border-t border-rule-strong p-0 pt-1 sm:grid-cols-2"
        >
          {second.map((row, i) => (
            <li key={row.id} className="min-w-0 border-b border-rule last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0">
              <Entry row={row} rank={i + 2} size="second" />
            </li>
          ))}
        </ol>
      ) : null}

      {rest.length > 0 ? (
        <ol
          start={6}
          className="m-0 grid list-none grid-cols-1 gap-x-8 border-t border-rule-strong p-0 pt-2 sm:grid-cols-2 xl:grid-cols-3"
        >
          {rest.map((row, i) => (
            <li key={row.id} className="min-w-0">
              <Entry row={row} rank={i + 6} size="rest" />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Entry({ row, rank, size }: { row: FounderRow; rank: number; size: "lead" | "second" | "rest" }) {
  const figure = score100(row.composite);
  return (
    <Link
      to={`/founders/${row.id}`}
      className={cn(
        "group flex min-w-0 items-baseline justify-between gap-4 no-underline",
        size === "lead" ? "pb-4" : size === "second" ? "py-2.5" : "py-1",
      )}
      aria-label={`${rank}. ${row.name}${row.companyName ? `, ${row.companyName}` : ""}. Overall score ${figure} out of 100.`}
    >
      <span className="min-w-0">
        <span
          className={cn(
            "name-caps block text-ink decoration-1 underline-offset-4 group-hover:underline",
            size === "lead" ? "text-3xl" : size === "second" ? "text-lg" : "truncate text-base",
          )}
        >
          {size === "lead" ? (
            <StateMark state="surfaced" className="mr-2.5 inline-block size-4 -translate-y-0.5 text-gold" />
          ) : null}
          {row.name}
        </span>
        {size !== "rest" ? (
          <span className={cn("mt-0.5 block text-ink-2", size === "lead" ? "prose-measure text-md" : "truncate text-sm")}>
            {row.companyName ? <span className="font-semibold text-ink">{row.companyName}</span> : null}
            {row.companyName && row.headline ? " · " : null}
            {row.headline}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "figure shrink-0 font-semibold text-ink",
          size === "lead" ? "text-3xl" : size === "second" ? "text-lg" : "text-base",
        )}
      >
        {figure}
      </span>
    </Link>
  );
}
