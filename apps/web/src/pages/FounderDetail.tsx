import { Link, useLocation, useParams } from "react-router-dom";
import { ErrorNote, PageHeader, Panel, SkeletonRows } from "../components/ui/layout";
import { DossierHeader } from "../features/founders/dossier/Header";
import { Verdict } from "../features/founders/dossier/Verdict";
import { Rubric } from "../features/founders/dossier/Rubric";
import { MemoPanel } from "../features/founders/dossier/Memo";
import { AllEvidence } from "../features/founders/dossier/Evidence";
import { AgentWorkPanel, OutreachPanel, SpottedPanel } from "../features/founders/dossier/Activity";
import { useFounder } from "../lib/queries";

export default function FounderDetailPage() {
  const { founderId = "" } = useParams();
  const location = useLocation();
  const detail = useFounder(founderId || null);

  // The list passes its filters along, so the way back keeps them.
  const back = (location.state as { back?: unknown } | null)?.back;
  const backTo = `/founders${typeof back === "string" ? back : ""}`;

  if (detail.error) {
    return (
      <>
        <PageHeader title="Founder" />
        <ErrorNote
          title="This dossier could not be loaded"
          action={
            <Link to={backTo} className="font-bold text-navy hover:underline">
              Founders
            </Link>
          }
        >
          {detail.error.message}
        </ErrorNote>
      </>
    );
  }

  if (!detail.data) return <SkeletonRows rows={10} />;

  const { founder, company, assessment, history: _history, evidence, leads, outreach, feedback, tasks } = detail.data;

  return (
    <div className="flex flex-col gap-10">
      <DossierHeader founder={founder} company={company} leads={leads} feedback={feedback} backTo={backTo} knownPeople={detail.data.knownPeople ?? []} />
      <Verdict assessment={assessment} thesisNotes={founder.fitReasons.join(" · ")} />
      <MemoPanel memo={assessment?.memo ?? null} />
      <Panel title="Rubric">
        <Rubric assessment={assessment} evidence={evidence} />
      </Panel>
      <AllEvidence evidence={evidence} />
      <SpottedPanel leads={leads} />
      <OutreachPanel outreach={outreach} />
      <AgentWorkPanel tasks={tasks} />
    </div>
  );
}
