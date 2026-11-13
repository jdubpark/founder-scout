import type { ContaminationReport } from "@agentswarm/shared";
import { Fact } from "../../components/ui/layout";
import { InfoHint } from "../steering/InfoHint";
import { score } from "./variants";

const MASK_HINT =
  "Names and years are removed before a model sees a case, and it is then asked to name the company and the year. " +
  "Cases it names are scored apart and left out of the headline. Shuffled is what the same cases give when their outcomes are shuffled: a headline should sit above it.";

/**
 * The hint, with what one fixed answer would score on the year question. Dated counts a year
 * given within one, so over a short span a model dates most cases by always saying the middle.
 */
export function maskHint(report: Pick<ContaminationReport, "eraFixed">): string {
  if (typeof report.eraFixed !== "number") return MASK_HINT;
  return `${MASK_HINT} Dated counts a year given within one. Always answering one year would date ${report.eraFixed}, so Dated means something only above that.`;
}

/** "10 / 158", kept on one line so a narrow column never breaks the figure in two. */
export function share(part: number | null | undefined, whole: number | null | undefined): string {
  if (typeof part !== "number" || typeof whole !== "number" || whole <= 0) return "—";
  return `${part} / ${whole}`;
}

/** What shuffled outcomes give: the average, and the value 95% of shuffles fall below. */
export function shuffled(placebo: ContaminationReport["placebo"]): string {
  if (!placebo) return "—";
  return `${score(placebo.mean)} (${score(placebo.p95)})`;
}

/** The leak controls for a flow built on past cases, under the row of Start, Best and Noise. */
export function ContaminationFacts({ report }: { report: ContaminationReport }) {
  return (
    <div className="flex items-start gap-2">
      <dl className="m-0 grid min-w-0 flex-1 grid-cols-3 gap-x-8 whitespace-nowrap">
        <Fact label="Named">{share(report.recognised, report.cases)}</Fact>
        <Fact label="Dated">{share(report.eraNamed, report.eraProbed)}</Fact>
        <Fact label="Cut by date">{report.itemsCutOff}</Fact>
        <Fact label="Clean">{score(report.cleanScore)}</Fact>
        <Fact label="Named score">{score(report.recognisedScore)}</Fact>
        <Fact label="Shuffled">{shuffled(report.placebo)}</Fact>
      </dl>
      <InfoHint text={maskHint(report)} />
    </div>
  );
}
