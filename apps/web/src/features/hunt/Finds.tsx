import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import type { HuntDTO, HuntFind } from "@agentswarm/shared";
import { Chip } from "../../components/ui/marks";
import { InfoHint } from "../steering/InfoHint";
import { earlinessSteps, findMark } from "./model";
import { stageLabel } from "@agentswarm/shared";

function FindRow({ find, trailName }: { find: HuntFind; trailName: string | null }) {
  const mark = findMark(find);
  const steps = earlinessSteps(find.earliness);
  const status = mark === "kept" ? { label: "Kept", tone: "green" as const } : mark === "dropped" ? { label: "Not kept", tone: "neutral" as const } : { label: "Waiting", tone: "neutral" as const };
  const stage = stageLabel(find.stage);
  return (
    <li className="flex min-w-0 items-center gap-2 border-b border-rule py-2">
      <div className="min-w-0 flex-1 truncate text-sm" title={[find.personName, find.companyName, find.oneLiner].filter(Boolean).join(", ")}>
        {find.founderId ? <Link to={`/founders/${encodeURIComponent(find.founderId)}`} className="font-bold text-navy hover:underline">{find.personName}</Link> : <span className="font-bold text-ink">{find.personName}</span>}
        <span className="text-ink-2">{[find.companyName, find.oneLiner].filter(Boolean).map((part) => `, ${part}`).join("")}</span>
      </div>
      {stage ? <Chip>{stage}</Chip> : null}
      {steps !== null ? <div role="meter" aria-label={`Earliness ${steps} of 5`} aria-valuemin={0} aria-valuemax={5} aria-valuenow={steps} className="flex shrink-0 items-center gap-0.5">{[1, 2, 3, 4, 5].map((step) => <span key={step} className={`h-1.5 w-2 rounded-sm ${step <= steps ? "bg-green-2" : "bg-rule-strong"}`} />)}</div> : null}
      {trailName ? <Chip className="max-w-24 truncate">{trailName}</Chip> : null}
      <Chip tone={status.tone}>{status.label}</Chip>
      <a href={find.sourceRef} target="_blank" rel="noreferrer noopener" aria-label={`Open source for ${find.personName}`} title="Open source" className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:bg-sunk hover:text-navy"><ExternalLink className="size-4" aria-hidden /></a>
    </li>
  );
}

export function Finds({ hunt }: { hunt: HuntDTO }) {
  const trailNames = new Map(hunt.trails.map((trail) => [trail.id, trail.name]));
  return (
    <section className="min-w-0">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-md font-black text-ink">Finds</h2>
        <span className="inline-flex items-center gap-1 text-xs text-ink-3">Earliness<InfoHint text="Earliness combines funding, team, and progress stage." /></span>
      </header>
      <ul className="m-0 list-none p-0">
        {hunt.finds.map((find) => <FindRow key={find.leadId} find={find} trailName={find.trailId ? trailNames.get(find.trailId) ?? null : null} />)}
      </ul>
    </section>
  );
}
