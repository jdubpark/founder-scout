import { Info } from "lucide-react";
import type { Evidence } from "@agentswarm/shared";
import { IconButton } from "../../../components/ui/Button";
import { Panel } from "../../../components/ui/layout";
import { Chip, Status } from "../../../components/ui/marks";
import { Hint } from "../../../components/ui/overlay";
import { dateShort, plural } from "../../../lib/format";
import { SourceLink } from "../SourceLink";
import { VERIFICATION_VIEW, isRejected, sourceLabel, EVIDENCE_KIND_LABEL } from "../labels";
import { EvidenceIcon, SourceIcon } from "../../../components/icons";

/** One piece of evidence. The quote is the proof; the rest is icons and short labels. */
export function EvidenceCard({ item, role }: { item: Evidence; role?: "supports" | "against" }) {
  const rejected = isRejected(item.verification);
  const verification = VERIFICATION_VIEW[item.verification];
  const kind = EVIDENCE_KIND_LABEL[item.kind];
  // The claim this item was collected for, and what the fact-checker said about it.
  const detail = [item.claim, item.verificationNote].filter(Boolean).join(" Check: ");
  return (
    <article
      className={
        rejected
          ? "flex min-w-0 flex-col gap-2 rounded-lg border border-rule bg-sunk p-3"
          : "flex min-w-0 flex-col gap-2 rounded-lg border border-rule bg-surface p-3"
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <span role="img" aria-label={kind} title={kind} className="shrink-0">
          <EvidenceIcon kind={item.kind} className="size-4 text-ink-2" />
        </span>
        <div className="min-w-0 flex-1 font-bold">
          <SourceLink href={item.url}>{item.title}</SourceLink>
        </div>
        {role === "supports" ? <Chip tone="green">For</Chip> : null}
        {role === "against" ? <Chip tone="bistre">Against</Chip> : null}
      </div>

      <blockquote className={rejected ? "m-0 border-l-0 text-sm text-ink-3" : "m-0 border-l-0 text-sm text-ink"}>{item.excerpt}</blockquote>

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

export function AllEvidence({ evidence }: { evidence: Evidence[] }) {
  const notCounted = evidence.filter((e) => isRejected(e.verification)).length;
  return (
    <Panel title="Evidence" aside={<span>{notCounted > 0 ? `${plural(evidence.length, "item")} · ${notCounted} not counted` : plural(evidence.length, "item")}</span>}>
      {evidence.length === 0 ? (
        <p className="text-base text-ink-2">No evidence yet</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* What counts comes first; what the fact-checker rejected goes last. */}
          {[...evidence.filter((e) => !isRejected(e.verification)), ...evidence.filter((e) => isRejected(e.verification))].map((item) => (
            <EvidenceCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </Panel>
  );
}
