import { ExternalLink } from "lucide-react";
import type { CitedPoint, CompanyAssessment, SourcedText } from "@agentswarm/shared";
import { Chip } from "../../components/ui/marks";
import { Panel } from "../../components/ui/layout";
import { plural } from "../../lib/format";

/** The company's own words, with a link to where they were read. */
export function MissionPanel({ mission }: { mission: SourcedText }) {
  return (
    <Panel title="Mission">
      <blockquote className="m-0 flex max-w-[68ch] items-start gap-2 border-l-2 border-rule-strong pl-4 text-lg text-ink">
        <span>{mission.text}</span>
        {mission.url ? (
          <a
            href={mission.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Source of the mission"
            title="Source"
            className="mt-1 inline-flex shrink-0 text-navy hover:text-ink"
          >
            <ExternalLink className="size-4" aria-hidden />
          </a>
        ) : null}
      </blockquote>
    </Panel>
  );
}

/** The company in a few lines: a summary, cited strengths and risks, and open questions. */
export function BriefPanel({ brief }: { brief: CompanyAssessment["brief"] }) {
  const hasLists = brief.strengths.length > 0 || brief.risks.length > 0;
  return (
    <Panel title="Brief">
      <div className="flex flex-col gap-6">
        {brief.summary ? <p className="prose-measure text-base text-ink">{brief.summary}</p> : null}

        {hasLists ? (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {brief.strengths.length > 0 ? <PointList title="Strengths" points={brief.strengths} tone="green" /> : null}
            {brief.risks.length > 0 ? <PointList title="Risks" points={brief.risks} tone="bistre" /> : null}
          </div>
        ) : null}

        {brief.openQuestions.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-ink-3">Open questions</h3>
            <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-base text-ink">
              {brief.openQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function PointList({ title, points, tone }: { title: string; points: CitedPoint[]; tone: "green" | "bistre" }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-bold text-ink-3">{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {points.map((point) => {
          const sources = point.evidenceIds.length;
          const label = `${sources} ${plural(sources, "source")}`;
          return (
            <li key={point.text} className="flex items-start gap-3 text-base text-ink">
              <span className="min-w-0 flex-1">{point.text}</span>
              <Chip tone={tone} title={label}>
                {sources}
              </Chip>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
