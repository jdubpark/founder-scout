import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Trophy, UserCheck, ArrowLeftRight } from "lucide-react";
import type { AssumptionRow } from "@agentswarm/shared";
import { Chip, Status } from "../../components/ui/marks";
import { cn } from "../../lib/cn";
import { EvidenceBar } from "./EvidenceBar";
import { STATUS_LABEL, STATUS_MARK, differs } from "./model";

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** One assumption: the statement, its status and its evidence. Opens in place to show the rest. */
export function AssumptionRowView({ row, open, onToggle }: { row: AssumptionRow; open: boolean; onToggle: () => void }) {
  const outcomes = row.evidence.outcomes;
  const calls = row.evidence.calls;
  const disagree = differs(row);

  return (
    <li className="border-b border-rule last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-4 py-2.5 text-left hover:bg-sunk"
      >
        {open ? <ChevronDown className="size-4 shrink-0 text-ink-3" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-base text-ink" title={row.statement}>
          {row.statement}
        </span>
        {row.stated ? null : <Chip>Unstated</Chip>}
        <Status state={STATUS_MARK[row.status]} className="w-24 shrink-0">
          {STATUS_LABEL[row.status]}
        </Status>
        <div className="flex shrink-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            <Trophy className="size-3.5 text-ink-3" role="img" aria-label="Past companies" />
            <EvidenceBar name="Past companies" stat={outcomes} />
          </span>
          <span className="flex items-center gap-2">
            <UserCheck className="size-3.5 text-ink-3" role="img" aria-label="Partner's calls" />
            <EvidenceBar name="Partner's calls" stat={calls} />
          </span>
        </div>
        <span className={cn("flex w-5 shrink-0 justify-center", !disagree && "invisible")}>
          {disagree ? <ArrowLeftRight className="size-4 text-bistre" role="img" aria-label="Differs" /> : null}
        </span>
      </button>
      {open ? <Detail row={row} /> : null}
    </li>
  );
}

function Detail({ row }: { row: AssumptionRow }) {
  const { evidence } = row;
  return (
    <div className="flex flex-col gap-3 pb-4 pl-7 text-base">
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-2">
        <dt className="text-ink-2">Lives</dt>
        <dd className="m-0 text-ink">{row.lives}</dd>
        {row.current !== null ? (
          <>
            <dt className="text-ink-2">Current</dt>
            <dd className="m-0 figure font-bold text-ink">{row.current}</dd>
          </>
        ) : null}
        {evidence.outcomes ? (
          <>
            <dt className="text-ink-2">Cases and winners</dt>
            <dd className="m-0 figure font-bold text-ink">
              {evidence.outcomes.n} cases, {evidence.outcomes.positives} winners
            </dd>
          </>
        ) : null}
        {evidence.unknownShare !== null ? (
          <>
            <dt className="text-ink-2">Unanswered</dt>
            <dd className="m-0 figure font-bold text-ink">{percent(evidence.unknownShare)}</dd>
          </>
        ) : null}
        {evidence.detail !== null ? (
          <>
            <dt className="text-ink-2">Detail</dt>
            <dd className="m-0 text-ink">{evidence.detail}</dd>
          </>
        ) : null}
        {row.prior ? (
          <>
            <dt className="text-ink-2">Published</dt>
            <dd className="m-0 flex flex-col gap-0.5 text-ink">
              <span>{row.prior.says}</span>
              <span className="text-sm text-ink-3">{row.prior.source}</span>
            </dd>
          </>
        ) : null}
      </dl>
      {row.paramKey !== null ? (
        <div>
          <Link to="/swarm" className="text-base font-bold text-navy hover:underline">
            Change
          </Link>
        </div>
      ) : null}
    </div>
  );
}
