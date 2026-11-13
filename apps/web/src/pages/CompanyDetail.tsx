import { Link, useLocation, useParams } from "react-router-dom";
import { ErrorNote, PageHeader, SkeletonRows } from "../components/ui/layout";
import { AgentWorkPanel } from "../features/founders/dossier/Activity";
import { CompanyHeader } from "../features/companies/Header";
import { CompanyScores } from "../features/companies/Scores";
import { BriefPanel, MissionPanel } from "../features/companies/Brief";
import { ProgressPanel } from "../features/companies/Progress";
import { TeamPanel } from "../features/companies/Team";
import { CompanyRubric } from "../features/companies/Rubric";
import { EvidencePanel } from "../features/companies/Evidence";
import { useCompany } from "../lib/queries";

export default function CompanyDetailPage() {
  const { companyId = "" } = useParams();
  const location = useLocation();
  const detail = useCompany(companyId || null);

  // The list passes its filters along, so the way back keeps them.
  const back = (location.state as { back?: unknown } | null)?.back;
  const backTo = `/companies${typeof back === "string" ? back : ""}`;

  if (detail.error) {
    return (
      <>
        <PageHeader title="Company" />
        <ErrorNote
          title="This company could not be loaded"
          action={
            <Link to={backTo} className="font-bold text-navy hover:underline">
              Companies
            </Link>
          }
        >
          {detail.error.message}
        </ErrorNote>
      </>
    );
  }

  if (!detail.data) return <SkeletonRows rows={10} />;

  const { company, members, founders, assessment, evidence, feedback, tasks, knownPeople } = detail.data;

  return (
    <div className="flex flex-col gap-10">
      <CompanyHeader company={company} feedback={feedback} decision={assessment?.decision ?? null} backTo={backTo} />
      {assessment ? <CompanyScores assessment={assessment} /> : null}
      {company.mission ? <MissionPanel mission={company.mission} /> : null}
      {assessment ? <BriefPanel brief={assessment.brief} /> : null}
      <ProgressPanel evidence={evidence} />
      <TeamPanel members={members} founders={founders} knownPeople={knownPeople} />
      {assessment ? <CompanyRubric assessment={assessment} evidence={evidence} /> : null}
      <EvidencePanel evidence={evidence} />
      {tasks.length > 0 ? <AgentWorkPanel tasks={tasks} /> : null}
    </div>
  );
}

