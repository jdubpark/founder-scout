import { useMemo, useState } from "react";
import {
  COMPANY_DIMENSIONS,
  type CompanyAssessment,
  type CompanyDimension,
  type CompanyDimensionGroup,
  type CompanyJudgment,
  type Evidence,
  type Level,
} from "@agentswarm/shared";
import { Panel } from "../../components/ui/layout";
import { CompanyEvidenceCard } from "./Evidence";
import { COMPANY_GROUP_LABEL } from "./labels";
import { cn } from "../../lib/cn";

const GROUP_ORDER: CompanyDimensionGroup[] = ["problem", "product", "progress", "team", "risk"];
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

/** The company rubric in the founder rubric's layout: one row per question, the chosen one explained with its evidence. */
export function CompanyRubric({ assessment, evidence }: { assessment: CompanyAssessment; evidence: Evidence[] }) {
  const byId = useMemo(() => new Map(evidence.map((e) => [e.id, e])), [evidence]);
  const judgmentFor = (dimension: string): CompanyJudgment | undefined =>
    assessment.judgments.find((j) => j.dimension === dimension);

  const firstWithEvidence = COMPANY_DIMENSIONS.findIndex((d) => (judgmentFor(d.id)?.evidenceIds.length ?? 0) > 0);
  const [selected, setSelected] = useState<string>(
    COMPANY_DIMENSIONS[firstWithEvidence >= 0 ? firstWithEvidence : 0]?.id ?? "",
  );

  const current = COMPANY_DIMENSIONS.find((d) => d.id === selected) ?? COMPANY_DIMENSIONS[0];
  const judgment = judgmentFor(selected);
  const support = (judgment?.evidenceIds ?? []).map((id) => byId.get(id)).filter((e): e is Evidence => e !== undefined);
  const against = (judgment?.counterEvidenceIds ?? []).map((id) => byId.get(id)).filter((e): e is Evidence => e !== undefined);

  return (
    <Panel title="Rubric">
      <div className="grid grid-cols-1 gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          {GROUP_ORDER.map((group) => {
            const dimensions = COMPANY_DIMENSIONS.filter((d) => d.group === group);
            if (dimensions.length === 0) return null;
            return (
              <div key={group} className="flex flex-col">
                <h3 className="px-3 pb-1 text-sm font-bold text-ink-3">{COMPANY_GROUP_LABEL[group]}</h3>
                {dimensions.map((dimension) => (
                  <DimensionRow
                    key={dimension.id}
                    dimension={dimension}
                    judgment={judgmentFor(dimension.id)}
                    selected={dimension.id === selected}
                    onSelect={() => setSelected(dimension.id)}
                  />
                ))}
              </div>
            );
          })}
        </div>

        <section aria-label={current.label} className="flex min-w-0 flex-col gap-3">
          <div>
            <h3 className="text-lg font-black text-ink">{current.label}</h3>
            <p className="text-base text-ink-2">{judgment?.level == null ? UNSETTLED : current.levels[judgment.level]}</p>
          </div>
          {support.length > 0 || against.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {support.map((item) => (
                <CompanyEvidenceCard key={item.id} item={item} role="supports" />
              ))}
              {against.map((item) => (
                <CompanyEvidenceCard key={item.id} item={item} role="against" />
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </Panel>
  );
}

function DimensionRow({
  dimension,
  judgment,
  selected,
  onSelect,
}: {
  dimension: CompanyDimension;
  judgment: CompanyJudgment | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const level = judgment?.level ?? null;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex h-9 items-center justify-between gap-4 rounded-sm px-3 text-left",
        selected ? "bg-blue-tint" : "hover:bg-sunk",
      )}
    >
      <span className="truncate font-bold text-ink">{dimension.label}</span>
      {level === null ? <span className="text-sm text-ink-3">Unknown</span> : <LevelBar level={level} />}
    </button>
  );
}
