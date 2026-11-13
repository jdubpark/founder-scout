import type { Assessment } from "@agentswarm/shared";
import { IconButton } from "../../../components/ui/Button";
import { Caution } from "../../../components/ui/marks";
import { Hint } from "../../../components/ui/overlay";
import { Info } from "lucide-react";
import { DECISION_LABEL } from "../../../lib/stages";
import { ScoreDial } from "../../../components/ScoreDial";
import { DecisionIcon } from "../../../components/icons";

const CAUTION: Record<"critical" | "warning", string> = {
  critical: "Review before contact",
  warning: "Check claims",
};

/** The decision, the five scores as dials, and any caution. */
export function Verdict({ assessment, thesisNotes }: { assessment: Assessment | null; thesisNotes: string }) {
  if (!assessment) return <p className="text-base text-ink-2">Not scored yet</p>;

  const why = [assessment.summary, ...assessment.reasons].join(" ");
  const flags = assessment.flags.filter((f) => f.severity !== "info");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex items-center gap-2">
          <DecisionIcon decision={assessment.decision} className="size-6" />
          <span className="text-lg font-black text-ink">{DECISION_LABEL[assessment.decision]}</span>
          <Hint text={why}>
            <IconButton label="Why">
              <Info />
            </IconButton>
          </Hint>
        </div>
        <ScoreDial value={assessment.composite} label="Overall" tone="green" />
        <ScoreDial value={assessment.cracked} label="Engineering" tone="green" />
        <ScoreDial value={assessment.founderScore} label="Founder" tone="green" />
        <Hint text={thesisNotes || "No thesis notes"}>
          <div>
            <ScoreDial value={assessment.fit} label="Thesis fit" tone="bistre" />
          </div>
        </Hint>
        <ScoreDial value={assessment.coverage} label="Evidence coverage" tone="gold" />
      </div>

      {flags.map((flag) => (
        <div key={flag.code} className="flex items-center gap-2">
          <Caution>{CAUTION[flag.severity === "critical" ? "critical" : "warning"]}</Caution>
          <Hint text={flag.message}>
            <IconButton label="Details">
              <Info />
            </IconButton>
          </Hint>
        </div>
      ))}
    </div>
  );
}
