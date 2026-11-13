import { useMemo, useState } from "react";
import { DIMENSIONS, type Assessment, type Dimension, type DimensionGroup, type Evidence, type Judgment, type Level } from "@agentswarm/shared";
import { EvidenceCard } from "./Evidence";

const GROUPS: Array<{ id: DimensionGroup; title: string }> = [
  { id: "cracked", title: "Engineering" },
  { id: "founder", title: "Founder" },
  { id: "integrity", title: "Claims match record" },
];

const UNSETTLED = "Not settled by the evidence";

/** Five steps; the reached ones are filled. Level 0 fills the first step. */
function LevelBar({ level }: { level: Level | null }) {
  if (level === null) return null;
  return (
    <span className="flex items-center gap-1" role="img" aria-label={`Level ${level} of 4`}>
      {[0, 1, 2, 3, 4].map((step) => (
        <span key={step} className={step <= level ? "h-2 w-6 rounded-full bg-green-2" : "h-2 w-6 rounded-full bg-sunk"} />
      ))}
    </span>
  );
}

export function Rubric({ assessment, evidence }: { assessment: Assessment | null; evidence: Evidence[] }) {
  const byId = useMemo(() => new Map(evidence.map((e) => [e.id, e])), [evidence]);
  const judgmentFor = (dimension: string): Judgment | undefined =>
    assessment?.judgments.find((j) => j.dimension === dimension);

  // Open on the first question that has evidence behind it.
  const firstWithEvidence = DIMENSIONS.findIndex((d) => (judgmentFor(d.id)?.evidenceIds.length ?? 0) > 0);
  const [selected, setSelected] = useState<string>(DIMENSIONS[firstWithEvidence >= 0 ? firstWithEvidence : 0]?.id ?? "");

  if (!assessment) return <p className="text-base text-ink-2">Not scored yet</p>;

  const current = DIMENSIONS.find((d) => d.id === selected) ?? DIMENSIONS[0];
  const judgment = judgmentFor(selected);
  const support = (judgment?.evidenceIds ?? []).map((id) => byId.get(id)).filter((e): e is Evidence => e !== undefined);
  const against = (judgment?.counterEvidenceIds ?? []).map((id) => byId.get(id)).filter((e): e is Evidence => e !== undefined);

  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        {GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col">
            <h3 className="px-3 pb-1 text-sm font-bold text-ink-3">{group.title}</h3>
            {DIMENSIONS.filter((d) => d.group === group.id).map((dimension) => (
              <DimensionRow
                key={dimension.id}
                dimension={dimension}
                judgment={judgmentFor(dimension.id)}
                selected={dimension.id === selected}
                onSelect={() => setSelected(dimension.id)}
              />
            ))}
          </div>
        ))}
      </div>

      <section aria-label={current.label} className="flex min-w-0 flex-col gap-3">
        <div>
          <h3 className="text-lg font-black text-ink">{current.label}</h3>
          <p className="text-base text-ink-2">
            {judgment?.level == null ? UNSETTLED : current.levels[judgment.level]}
          </p>
        </div>
        {support.length === 0 && against.length === 0 ? <p className="text-base text-ink-3">No evidence</p> : null}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {support.map((item) => (
            <EvidenceCard key={item.id} item={item} role="supports" />
          ))}
          {against.map((item) => (
            <EvidenceCard key={item.id} item={item} role="against" />
          ))}
        </div>
      </section>
    </div>
  );
}

function DimensionRow({
  dimension,
  judgment,
  selected,
  onSelect,
}: {
  dimension: Dimension;
  judgment: Judgment | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const level = judgment?.level ?? null;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={
        selected
          ? "flex h-9 items-center justify-between gap-4 rounded-sm bg-blue-tint px-3 text-left"
          : "flex h-9 items-center justify-between gap-4 rounded-sm px-3 text-left hover:bg-sunk"
      }
    >
      <span className="truncate font-bold text-ink">{dimension.label}</span>
      {level === null ? <span className="text-sm text-ink-3">Unknown</span> : <LevelBar level={level} />}
    </button>
  );
}
