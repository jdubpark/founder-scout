import { useId } from "react";
import { Star } from "lucide-react";
import type { FounderRow } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/overlay";
import { useCreateDirective } from "../../lib/queries";

export const BAR_PARAM = "assess.surface_threshold";
export const COVERAGE_PARAM = "assess.min_coverage";

/** Would this founder be put in front of partners at the given bar? Same rule as scoring.ts. */
export function wouldSurface(row: FounderRow, bar: number, minCoverage: number): boolean {
  return row.composite !== null && row.coverage !== null && row.composite >= bar && row.coverage >= minCoverage;
}

interface BarPanelProps {
  swarmId: string;
  /** Every scored founder in the swarm, which the readout counts. null while they load. */
  rows: FounderRow[] | null;
  /** The bar in force, 0 to 1. */
  saved: number;
  minCoverage: number;
  /** The slider value in 0 to 100 while it is being dragged, or null when it sits on the saved bar. */
  draft: number | null;
  onDraft: (value: number | null) => void;
}

/** The score a founder has to reach to be surfaced, as one slider on the filter row. */
export function BarPanel({ swarmId, rows, saved, minCoverage, draft, onDraft }: BarPanelProps) {
  const create = useCreateDirective();
  const toast = useToast();
  const id = useId();

  const savedInt = Math.round(saved * 100);
  const current = draft ?? savedInt;
  const dirty = draft !== null && draft !== savedInt;
  const atCurrent = rows ? rows.filter((row) => wouldSurface(row, current / 100, minCoverage)).length : null;

  const save = () => {
    create.mutate(
      { scope: { swarmId }, kind: "param", key: BAR_PARAM, value: Number((current / 100).toFixed(2)) },
      {
        onSuccess: () => {
          onDraft(null);
          toast.done("Bar saved");
        },
        onError: (error) => toast.problem("The bar was not saved", error.message),
      },
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-bold text-ink-2">
        <Star className="size-4 text-gold-ink" aria-hidden />
        Bar
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={current}
        onChange={(event) => {
          const next = Number(event.target.value);
          onDraft(next === savedInt ? null : next);
        }}
        className="w-44 accent-navy"
      />
      <span className="figure w-6 text-right text-base font-black text-ink">{current}</span>
      <span aria-live="polite" className="figure text-sm text-ink-2">
        {dirty && atCurrent !== null ? `${atCurrent} would surface` : ""}
      </span>
      {dirty ? (
        <>
          <Button variant="primary" size="sm" onClick={save} busy={create.isPending} busyLabel="Saving">
            Save
          </Button>
          <Button variant="quiet" size="sm" onClick={() => onDraft(null)}>
            Reset
          </Button>
        </>
      ) : null}
    </div>
  );
}
