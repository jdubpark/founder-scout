import { Info } from "lucide-react";
import type { CompanyAssessment, ScoreFlag } from "@agentswarm/shared";
import { IconButton } from "../../components/ui/Button";
import { Caution } from "../../components/ui/marks";
import { Hint } from "../../components/ui/overlay";
import { ScoreDial } from "../../components/ScoreDial";

const CAUTION: Record<ScoreFlag["severity"], string> = {
  critical: "Review before contact",
  warning: "Check claims",
  info: "",
};

/** Overall, founders, company and evidence coverage as dials, with the reasons behind the call. */
export function CompanyScores({ assessment }: { assessment: CompanyAssessment }) {
  const flags = assessment.flags.filter((f) => f.severity !== "info");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <ScoreDial value={assessment.deal} label="Overall" tone="green" />
        <ScoreDial value={assessment.team} label="Founders" tone="green" />
        <ScoreDial value={assessment.company} label="Company" tone="green" />
        <ScoreDial value={assessment.coverage} label="Evidence coverage" tone="gold" />
        {assessment.reasons.length > 0 ? (
          <Hint text={assessment.reasons.join(" ")}>
            <IconButton label="Why">
              <Info />
            </IconButton>
          </Hint>
        ) : null}
      </div>

      {flags.map((flag) => (
        <div key={flag.code} className="flex items-center gap-2">
          <Caution>{CAUTION[flag.severity]}</Caution>
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
