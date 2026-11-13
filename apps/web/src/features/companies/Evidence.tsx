import { useState } from "react";
import { Check, Info } from "lucide-react";
import { EVIDENCE_FACETS, FACET_LABEL, type Evidence, type EvidenceFacet } from "@agentswarm/shared";
import { IconButton } from "../../components/ui/Button";
import { Panel } from "../../components/ui/layout";
import { Chip, Status } from "../../components/ui/marks";
import { Hint } from "../../components/ui/overlay";
import { EvidenceIcon, FacetIcon, SourceIcon } from "../../components/icons";
import { dateShort, plural } from "../../lib/format";
import { SourceLink } from "../founders/SourceLink";
import { EVIDENCE_KIND_LABEL, VERIFICATION_VIEW, isRejected, sourceLabel } from "../founders/labels";
import { cn } from "../../lib/cn";

/** One piece of company evidence. The quote is the proof; a check shows when it was found at its source. */
export function CompanyEvidenceCard({ item, role }: { item: Evidence; role?: "supports" | "against" }) {
  const rejected = isRejected(item.verification);
  const verification = VERIFICATION_VIEW[item.verification];
  const detail = [item.claim, item.verificationNote].filter(Boolean).join(" Check: ");
  const facetName = item.facet ? FACET_LABEL[item.facet] : EVIDENCE_KIND_LABEL[item.kind];
  return (
    <article className={cn("flex min-w-0 flex-col gap-2 rounded-lg border border-rule p-3", rejected ? "bg-sunk" : "bg-surface")}>
      <div className="flex min-w-0 items-center gap-2">
        <span role="img" aria-label={facetName} title={facetName} className="shrink-0">
          {item.facet ? (
            <FacetIcon facet={item.facet} className="size-4 text-ink-2" />
          ) : (
            <EvidenceIcon kind={item.kind} className="size-4 text-ink-2" />
          )}
        </span>
        <div className="min-w-0 flex-1 font-bold">
          <SourceLink href={item.url}>{item.title}</SourceLink>
        </div>
        {item.quote === "found" ? (
          <span role="img" aria-label="Quote found at source" title="Quote found at source" className="shrink-0">
            <Check className="size-4 text-green" aria-hidden />
          </span>
        ) : null}
        {role === "supports" ? <Chip tone="green">For</Chip> : null}
        {role === "against" ? <Chip tone="bistre">Against</Chip> : null}
      </div>

      <blockquote className={cn("m-0 border-l-0 text-sm", rejected ? "text-ink-3" : "text-ink")}>{item.excerpt}</blockquote>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        <span role="img" aria-label={sourceLabel(item.source)} title={sourceLabel(item.source)} className="flex items-center gap-1.5">
          <SourceIcon source={item.source} className="size-3.5" />
          {item.publishedAt ? <span className="figure">{dateShort(item.publishedAt)}</span> : null}
        </span>
        <Status state={verification.mark}>{rejected ? `${verification.label}, not counted` : verification.label}</Status>
        {detail ? (
          <Hint text={detail}>
            <IconButton label="Claim and check">
              <Info />
            </IconButton>
          </Hint>
        ) : null}
      </div>
    </article>
  );
}

/** Evidence grouped by facet. Counted items come first; rejected ones stay quiet at the end. */
export function EvidencePanel({ evidence }: { evidence: Evidence[] }) {
  const [facet, setFacet] = useState<EvidenceFacet | null>(null);
  if (evidence.length === 0) return null;

  const present = EVIDENCE_FACETS.filter((f) => evidence.some((e) => e.facet === f));
  const shown = evidence.filter((e) => facet === null || e.facet === facet);
  const notCounted = shown.filter((e) => isRejected(e.verification)).length;
  const ordered = [...shown.filter((e) => !isRejected(e.verification)), ...shown.filter((e) => isRejected(e.verification))];

  return (
    <Panel title="Evidence" aside={<span>{notCounted > 0 ? `${plural(shown.length, "item")} · ${notCounted} not counted` : plural(shown.length, "item")}</span>}>
      <div className="flex flex-col gap-4">
        {present.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Facets">
            {present.map((f) => {
              const on = facet === f;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFacet(on ? null : f)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-bold",
                    on ? "border-navy bg-blue-tint text-ink" : "border-rule-strong bg-surface text-ink-2 hover:bg-sunk hover:text-ink",
                  )}
                >
                  <FacetIcon facet={f} className="size-3.5" />
                  {FACET_LABEL[f]}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ordered.map((item) => (
            <CompanyEvidenceCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </Panel>
  );
}
