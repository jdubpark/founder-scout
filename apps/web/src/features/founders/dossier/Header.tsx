import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { normalizeRoundLabel, stageLabel, type Company, type Feedback, type Founder, type Lead, type NetworkContact, type ProfileLinks } from "@agentswarm/shared";
import { useApi } from "../../../lib/api/context";
import { Avatar } from "../../../components/ui/layout";
import { Caution, Status } from "../../../components/ui/marks";
import { STATUS_VIEW } from "../../../lib/stages";
import { YesNo } from "../../../components/YesNo";
import { SourceIcon } from "../../../components/icons";
import { SourceLink } from "../SourceLink";

const PROFILE_LINKS: Array<[keyof ProfileLinks, string]> = [
  ["github", "GitHub"],
  ["linkedin", "LinkedIn"],
  ["x", "X"],
  ["site", "Website"],
  ["scholar", "Scholar"],
];

export function DossierHeader({
  founder,
  company,
  leads,
  feedback,
  backTo,
  knownPeople = [],
}: {
  founder: Founder;
  company: Company | null;
  leads: Lead[];
  feedback: Feedback[];
  backTo: string;
  knownPeople?: NetworkContact[];
}) {
  const { demo } = useApi();
  const status = STATUS_VIEW[founder.status];
  const latest = [...feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const companyName = company?.name ?? founder.company.name;
  const leadStage = [...leads].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt)).find((lead) => lead.stage)?.stage ?? null;
  const round = normalizeRoundLabel(company?.stage ?? null) ?? normalizeRoundLabel(founder.company.stage) ?? stageLabel(leadStage);
  const tagline = company?.tagline?.text;
  const companyLine = [companyName, company?.sector, round, tagline ? `"${tagline}"` : company?.oneLiner ?? founder.company.oneLiner]
    .filter(Boolean).join(" · ");
  const links = PROFILE_LINKS.flatMap(([key, label]) => {
    const href = founder.links[key];
    return href ? [{ key, label, href }] : [];
  });

  return (
    <header className="flex min-w-0 items-start gap-4 border-b border-rule pb-5">
      <Link to={backTo} aria-label="Back to founders" className="mt-2 inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-2 hover:bg-sunk hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
      </Link>
      <Avatar name={founder.name} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h1 className="break-words text-2xl leading-tight font-black text-ink">{founder.name}</h1>
        {companyLine ? (
          <p className="truncate text-base text-ink-2" title={companyLine}>
            {founder.companyId && companyName ? (
              <Link to={`/companies/${encodeURIComponent(founder.companyId)}`} className="font-bold text-navy hover:underline">
                {companyName}
              </Link>
            ) : (
              companyName
            )}
            {company ? [company.sector, round, tagline ? `"${tagline}"` : company.oneLiner ?? founder.company.oneLiner].filter(Boolean).map((part) => ` · ${part}`).join("") : ""}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          <Status state={status.mark}>{status.label}</Status>
          {/* A simulated founder is labelled wherever they appear, on a real server as much as in the demo. */}
          {demo || founder.simId ? <Caution>Simulated</Caution> : null}
          {links.map((link) => (
            <SourceLink key={link.key} href={link.href}>
              {link.label}
            </SourceLink>
          ))}
        </div>
        {knownPeople.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            <span className="flex items-center gap-1.5 font-bold text-ink-2">
              <SourceIcon source="network" />
              You know
            </span>
            {knownPeople.map((person) => (
              <span key={person.id} className="flex min-w-0 items-baseline gap-1.5">
                <span className="font-bold text-ink">{person.name}</span>
                {person.position ? <span className="truncate text-ink-2" title={person.position}>{person.position}</span> : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <YesNo
        founderId={founder.id}
        verdict={latest?.verdict ?? null}
        reasons={latest?.reasonTags ?? []}
        size="full"
        className="shrink-0"
      />
    </header>
  );
}
