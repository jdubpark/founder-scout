import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Feedback, Founder, ProfileLinks } from "@agentswarm/shared";
import { useApi } from "../../../lib/api/context";
import { Avatar } from "../../../components/ui/layout";
import { Caution, Status } from "../../../components/ui/marks";
import { STATUS_VIEW } from "../../../lib/stages";
import { YesNo } from "../../../components/YesNo";
import { SourceLink } from "../SourceLink";

const PROFILE_LINKS: Array<[keyof ProfileLinks, string]> = [
  ["github", "GitHub"],
  ["linkedin", "LinkedIn"],
  ["x", "X"],
  ["site", "Website"],
  ["scholar", "Scholar"],
];

export function DossierHeader({ founder, feedback, backTo }: { founder: Founder; feedback: Feedback[]; backTo: string }) {
  const { demo } = useApi();
  const status = STATUS_VIEW[founder.status];
  const latest = [...feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const company = [founder.company.name, founder.headline].filter(Boolean).join(" · ");
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
        {company ? <p className="truncate text-base text-ink-2" title={company}>{company}</p> : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          <Status state={status.mark}>{status.label}</Status>
          {demo ? <Caution>Simulated</Caution> : null}
          {links.map((link) => (
            <SourceLink key={link.key} href={link.href}>
              {link.label}
            </SourceLink>
          ))}
        </div>
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
