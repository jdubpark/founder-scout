import {
  booleanParam,
  latestCalls,
  numberParam,
  stableId,
} from "@agentswarm/shared";
import type {
  Assessment,
  EvidenceBrief,
  Founder,
  FounderBrief,
  Memo,
  MemoInput,
  OutreachAction,
  OutreachKind,
  OutreachPlanInput,
  OutreachProposal,
} from "@agentswarm/shared";
import type { EngineRuntime } from "./runtime";

const OPEN_OUTREACH_STATUSES = ["proposed", "approved", "dispatched"] as const;

/** Limits the plan to one action of each founder-facing kind and two references. */
const OUTREACH_KIND_CAPS: Record<OutreachKind, number> = {
  email_founder: 1,
  call_founder: 1,
  call_reference: 2,
};

interface AssessedCandidate {
  founder: Founder;
  assessment: Assessment;
}

function candidateOrder(a: AssessedCandidate, b: AssessedCandidate): number {
  return b.assessment.composite - a.assessment.composite || a.founder.id.localeCompare(b.founder.id);
}

function founderBrief(runtime: EngineRuntime, founder: Founder): FounderBrief {
  const sightings = runtime.deps.store.listLeads({ founderId: founder.id }).map((lead) => ({
    source: lead.source,
    title: lead.sourceTitle,
    why: lead.why,
    ref: lead.sourceRef,
  }));

  return {
    id: founder.id,
    name: founder.name,
    headline: founder.headline,
    location: founder.location,
    company: founder.company,
    links: founder.links,
    tags: founder.tags,
    sightings,
    simId: founder.simId,
  };
}

function evidenceBriefs(runtime: EngineRuntime, founderId: string): EvidenceBrief[] {
  return runtime.deps.store.listEvidence(founderId, { verifications: ["supported"] }).map((evidence) => ({
    id: evidence.id,
    kind: evidence.kind,
    source: evidence.source,
    url: evidence.url,
    title: evidence.title,
    excerpt: evidence.excerpt,
    claim: evidence.claim,
    publishedAt: evidence.publishedAt,
    verification: evidence.verification,
    sim: evidence.sim,
  }));
}

function currentSurfaceCandidates(runtime: EngineRuntime): AssessedCandidate[] {
  return runtime.deps.store.listFounders({ swarmId: runtime.swarm.id })
    .flatMap((founder) => {
      const assessment = runtime.deps.store.latestAssessment(founder.id);
      return assessment?.runId === runtime.run.id && assessment.decision === "surface"
        ? [{ founder, assessment }]
        : [];
    })
    .sort(candidateOrder);
}

function hasOpenOutreach(runtime: EngineRuntime, founderId: string): boolean {
  return runtime.deps.store.listOutreach({
    swarmId: runtime.swarm.id,
    founderId,
    statuses: [...OPEN_OUTREACH_STATUSES],
  }).length > 0;
}

function hasLatestYesCall(runtime: EngineRuntime, founderId: string): boolean {
  return latestCalls(runtime.deps.store.allFeedback(runtime.swarm.id)).get(founderId)?.verdict === "yes";
}

function latestYesCandidates(runtime: EngineRuntime): AssessedCandidate[] {
  const latestByFounder = latestCalls(runtime.deps.store.allFeedback(runtime.swarm.id));
  const approvedFounderIds = new Set(
    [...latestByFounder.values()]
      .filter((feedback) => feedback.verdict === "yes")
      .map((feedback) => feedback.founderId),
  );

  return runtime.deps.store.listFounders({ swarmId: runtime.swarm.id })
    .flatMap((founder) => {
      if (!approvedFounderIds.has(founder.id) || hasOpenOutreach(runtime, founder.id)) return [];
      const assessment = runtime.deps.store.latestAssessment(founder.id);
      return assessment ? [{ founder, assessment }] : [];
    })
    .sort(candidateOrder);
}

function fallbackMemo(assessment: Assessment, founderName: string): Memo {
  const strengths = assessment.judgments
    .filter((judgment) => judgment.level !== null && judgment.level >= 3 && judgment.rationale.trim())
    .sort((a, b) => (b.level! * b.confidence) - (a.level! * a.confidence))
    .slice(0, 3)
    .map((judgment) => judgment.rationale);
  const risks = assessment.flags
    .filter((flag) => flag.severity === "warning" || flag.severity === "critical")
    .map((flag) => flag.message);
  const openQuestions = assessment.judgments
    .filter((judgment) => judgment.level === null || judgment.confidence < 0.5)
    .map((judgment) => judgment.rationale.trim())
    .filter(Boolean)
    .slice(0, 5);

  return {
    headline: `Partner-approved introduction for ${founderName}`,
    body: assessment.summary,
    strengths,
    risks,
    openQuestions,
    nextStep: "Prepare a human-reviewed outreach proposal following the partner's yes call.",
  };
}

function disclosureFor(kind: OutreachKind, fundName: string, founderName: string): string {
  switch (kind) {
    case "email_founder":
      return `This message was drafted with the help of an AI assistant working for ${fundName} and was reviewed by a partner before it was sent.`;
    case "call_founder":
      return `I’m an AI assistant calling on behalf of ${fundName}. With your consent, may I take notes during our conversation?`;
    case "call_reference":
      return `I’m an AI assistant calling on behalf of ${fundName}. With your consent, may I take notes while we discuss your professional relationship with ${founderName}?`;
  }
}

function makeOutreachAction(
  runtime: EngineRuntime,
  candidate: AssessedCandidate,
  proposal: OutreachProposal,
  taskId: string,
  proposalIndex: number,
  now: string,
): OutreachAction {
  const disclosure = disclosureFor(proposal.kind, runtime.deps.fundName, candidate.founder.name);

  return {
    id: stableId("out", `${runtime.run.id}:${taskId}:${candidate.founder.id}:${proposalIndex}`),
    swarmId: runtime.swarm.id,
    founderId: candidate.founder.id,
    kind: proposal.kind,
    target: proposal.target,
    rationale: proposal.rationale,
    draft: {
      subject: proposal.subject,
      body: proposal.body,
      agenda: proposal.agenda,
      questions: proposal.questions,
      disclosure,
    },
    consentBasis: proposal.consentBasis,
    status: "proposed",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    resultSummary: null,
    transcriptEvidenceId: null,
    createdByTaskId: taskId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Run the memo, outreach-plan, and digest stages in order. */
export async function runFinalStages(runtime: EngineRuntime): Promise<void> {
  if (runtime.stopped()) return;
  runtime.setStage("memo");
  const candidates = currentSurfaceCandidates(runtime);
  const memoAgent = runtime.agents.find((agent) => agent.jobId === "assess.memo");

  if (memoAgent) {
    for (const candidate of candidates) {
      if (runtime.stopped()) return;
      if (candidate.assessment.memo) continue;

      const input: MemoInput = {
        founder: founderBrief(runtime, candidate.founder),
        thesis: runtime.swarm.thesis,
        evidence: evidenceBriefs(runtime, candidate.founder.id),
        judgments: candidate.assessment.judgments,
        summary: candidate.assessment.summary,
        score: {
          composite: candidate.assessment.composite,
          cracked: candidate.assessment.cracked,
          founder: candidate.assessment.founderScore,
          coverage: candidate.assessment.coverage,
          decision: candidate.assessment.decision,
          breakdown: candidate.assessment.breakdown,
        },
      };
      const result = await runtime.runJob({
        agent: memoAgent,
        stage: "memo",
        jobId: "assess.memo",
        input,
        founderId: candidate.founder.id,
      });
      if (!result) return;
      if (result.output) {
        runtime.deps.store.setMemo(candidate.assessment.id, result.output);
        runtime.persist();
      }
    }
  }

  if (runtime.stopped()) return;
  runtime.setStage("outreach");
  const outreachAgent = runtime.agents.find((agent) => agent.jobId === "outreach.plan");
  const enabled = booleanParam("outreach.enabled", runtime.resolve(null, "outreach.enabled"), runtime.config);
  const maxFounders = numberParam("outreach.max_proposals", runtime.resolve(null, "outreach.max_proposals"), runtime.config);

  if (enabled && outreachAgent && maxFounders > 0) {
    let foundersPlanned = 0;

    for (const candidate of latestYesCandidates(runtime)) {
      if (runtime.stopped()) return;
      if (foundersPlanned >= maxFounders) break;
      if (!hasLatestYesCall(runtime, candidate.founder.id) || hasOpenOutreach(runtime, candidate.founder.id)) continue;
      const assessment = runtime.deps.store.latestAssessment(candidate.founder.id);
      if (!assessment) continue;
      // Partner approval can precede a model memo; keep the plan useful without
      // inventing assessment facts by deriving this fallback only from the record.
      const memo = assessment.memo ?? fallbackMemo(assessment, candidate.founder.name);

      const input: OutreachPlanInput = {
        founder: founderBrief(runtime, candidate.founder),
        thesis: runtime.swarm.thesis,
        memo,
        evidence: evidenceBriefs(runtime, candidate.founder.id),
        fundName: runtime.deps.fundName,
      };
      const result = await runtime.runJob({
        agent: outreachAgent,
        stage: "outreach",
        jobId: "outreach.plan",
        input,
        founderId: candidate.founder.id,
      });
      if (!result) return;
      if (!result.output) continue;
      if (!hasLatestYesCall(runtime, candidate.founder.id) || hasOpenOutreach(runtime, candidate.founder.id)) continue;

      const counts: Record<OutreachKind, number> = { email_founder: 0, call_founder: 0, call_reference: 0 };
      for (const action of runtime.deps.store.listOutreach({ swarmId: runtime.swarm.id, founderId: candidate.founder.id })) {
        counts[action.kind] += 1;
      }
      const now = runtime.now().toISOString();
      let candidateProposals = 0;
      for (const [proposalIndex, proposal] of result.output.actions.entries()) {
        if (counts[proposal.kind] >= OUTREACH_KIND_CAPS[proposal.kind]) continue;
        counts[proposal.kind] += 1;
        runtime.deps.store.insertOutreach(makeOutreachAction(runtime, candidate, proposal, result.task.id, proposalIndex, now));
        candidateProposals += 1;
      }
      if (candidateProposals > 0) {
        foundersPlanned += 1;
        runtime.addStats({ outreachProposed: candidateProposals });
        runtime.persist();
      }
    }
  }

  if (runtime.stopped()) return;
  runtime.setStage("digest");
  runtime.persist();
}
