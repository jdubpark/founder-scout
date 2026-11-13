import type { Evidence, EvidenceFacet } from "@agentswarm/shared";
import { FacetIcon } from "../../components/icons";
import { Panel } from "../../components/ui/layout";
import { monthYear } from "./labels";

const MAX_POINTS = 8;

/** The facets that show movement over time. */
const TIMELINE_FACETS: ReadonlySet<EvidenceFacet> = new Set<EvidenceFacet>(["traction", "funding", "product"]);

/**
 * Verified dated evidence on one line, oldest on the left. Each dot is the item's facet icon,
 * placed in proportion to its date. The title is the accessible name and the hover text.
 */
export function ProgressPanel({ evidence }: { evidence: Evidence[] }) {
  const points = evidence
    .filter(
      (e): e is Evidence & { publishedAt: string; facet: EvidenceFacet } =>
        e.verification === "supported" &&
        e.publishedAt !== null &&
        e.facet !== null &&
        e.facet !== undefined &&
        TIMELINE_FACETS.has(e.facet),
    )
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
    .slice(-MAX_POINTS);
  if (points.length === 0) return null;

  const times = points.map((p) => Date.parse(p.publishedAt));
  const first = Math.min(...times);
  const last = Math.max(...times);
  // Keep the outer dots fully on the track.
  const place = (t: number) => (last === first ? 50 : 4 + ((t - first) / (last - first)) * 92);

  return (
    <Panel title="Progress">
      <div className="relative h-20 w-full">
        <div aria-hidden className="absolute inset-x-0 top-4 h-0.5 rounded-full bg-rule-strong" />
        {points.map((p, i) => (
          <div
            key={`${p.id}-${i}`}
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1.5"
            style={{ left: `${place(Date.parse(p.publishedAt))}%` }}
          >
            <span
              role="img"
              aria-label={p.title}
              title={p.title}
              className="flex size-8 items-center justify-center rounded-full border border-navy bg-surface text-ink-2"
            >
              <FacetIcon facet={p.facet} className="size-4" />
            </span>
            <span className="figure text-xs whitespace-nowrap text-ink-2">{monthYear(p.publishedAt)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
