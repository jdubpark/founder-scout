import { Link } from "react-router-dom";
import { ArrowLeft, Link2 } from "lucide-react";
import { COMPANY_REASONS, type Company, type CompanyFeedback, type Decision } from "@agentswarm/shared";
import { useApi } from "../../lib/api/context";
import { Avatar } from "../../components/ui/layout";
import { Caution, Chip } from "../../components/ui/marks";
import { DECISION_LABEL } from "../../lib/stages";
import { DecisionIcon } from "../../components/icons";
import { YesNo } from "../../components/YesNo";

/** Name, site, stage and sector, the decision, and the partner's call. */
export function CompanyHeader({
  company,
  feedback,
  decision,
  backTo,
}: {
  company: Company;
  feedback: CompanyFeedback[];
  decision: Decision | null;
  backTo: string;
}) {
  const { demo } = useApi();
  const latest = [...feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;

  return (
    <header className="flex min-w-0 items-start gap-4 border-b border-rule pb-5">
      <Link
        to={backTo}
        aria-label="Back to companies"
        className="mt-2 inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-2 hover:bg-sunk hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
      </Link>
      <Avatar name={company.name} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 break-words text-2xl leading-tight font-black text-ink">{company.name}</h1>
          {company.url ? (
            <a
              href={company.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${company.name} site`}
              title="Open site"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-navy hover:bg-blue-tint"
            >
              <Link2 className="size-4" aria-hidden />
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {decision ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-ink-2">
              <DecisionIcon decision={decision} />
              {DECISION_LABEL[decision]}
            </span>
          ) : null}
          {company.stage ? <Chip>{company.stage}</Chip> : null}
          {company.sector ? <Chip>{company.sector}</Chip> : null}
          {/* A simulated company is labelled wherever it appears, on a real server as much as in the demo. */}
          {demo || company.simId ? <Caution>Simulated</Caution> : null}
        </div>
      </div>
      <YesNo
        companyId={company.id}
        reasonOptions={COMPANY_REASONS}
        verdict={latest?.verdict ?? null}
        reasons={latest?.reasonTags ?? []}
        size="full"
        className="shrink-0"
      />
    </header>
  );
}
