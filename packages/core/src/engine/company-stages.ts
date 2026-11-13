/**
 * Company work inside a run. These stages keep company identity, research and
 * decisions separate from the founder's personal record.
 */

import {
  COMPANY_DIMENSIONS,
  companyIdentityDomain,
  companyReasonLabel,
  effectiveCompanyWeights,
  effectiveThresholds,
  groundCompanyJudgments,
  groundPoints,
  normalizeCompanyName,
  numberParam,
  scoreCompany,
  decideDeal,
  stableId,
  stringParam,
  type Agent,
  type Company,
  type CompanyAssessment,
  type CompanyBrief,
  type CompanyMember,
  type CompanyRef,
  type CompanyResearchInput,
  type Evidence,
  type EvidenceBrief,
  type Founder,
  type ProfileLinks,
  type SourceId,
} from "@agentswarm/shared";
import { normalizeName } from "../db";
import type { PersonRecord } from "../contracts";
import { evidenceBrief, founderBrief, hashEvidence } from "./pipeline";
import { forEachConcurrent, type EngineRuntime } from "./runtime";

const RESEARCH_JOBS = ["company.product", "company.traction", "company.team"] as const;
type ResearchJob = (typeof RESEARCH_JOBS)[number];

function activeAgents(runtime: EngineRuntime, jobs: readonly string[]): Agent[] {
  return runtime.agents.filter((agent) => agent.status === "active" && jobs.includes(agent.jobId));
}

function companyRef(runtime: EngineRuntime, company: Company): CompanyRef {
  return {
    id: company.id,
    name: company.name,
    url: company.url,
    oneLiner: company.oneLiner,
    mission: company.mission,
    sector: company.sector,
    stage: company.stage,
    links: company.links,
    team: runtime.deps.store.listCompanyMembers(company.id).map(({ name, role, isFounder }) => ({ name, role, isFounder })),
    simId: company.simId,
  };
}

function foundersFor(runtime: EngineRuntime, companyId: string): Founder[] {
  return runtime.deps.store.foundersOfCompany(companyId);
}

function latestFounderAssessment(runtime: EngineRuntime, founder: Founder) {
  return runtime.deps.store.latestAssessment(founder.id);
}

function leadFounder(runtime: EngineRuntime, founders: readonly Founder[]): Founder | null {
  return [...founders].sort((a, b) => {
    const aa = latestFounderAssessment(runtime, a);
    const ba = latestFounderAssessment(runtime, b);
    return (ba?.composite ?? -1) - (aa?.composite ?? -1) || a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id);
  })[0] ?? null;
}

function latestCompanyCall(runtime: EngineRuntime, companyId: string) {
  return runtime.deps.store.listCompanyFeedback(companyId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null;
}

function companyStatus(decision: CompanyAssessment["decision"]): Company["status"] {
  switch (decision) {
    case "surface": return "surfaced";
    case "needs_evidence": return "needs_evidence";
    case "watch": return "watch";
    case "pass": return "passed";
  }
}

function finalStatus(runtime: EngineRuntime, companyId: string, decision: CompanyAssessment["decision"]): Company["status"] {
  const call = latestCompanyCall(runtime, companyId);
  if (call?.verdict === "no") return "passed";
  if (call?.verdict === "yes") return "surfaced";
  return companyStatus(decision);
}

function linkMember(
  runtime: EngineRuntime,
  companyId: string,
  name: string,
  role: string | null,
  links: ProfileLinks,
  source: SourceId,
  sourceUrl: string | null,
  background: string | null,
  isFounder: boolean,
  founders: readonly Founder[],
): void {
  const matched = founders.find((founder) => normalizeName(founder.name) === normalizeName(name));
  const member: CompanyMember = {
    id: stableId("mem", `${companyId}:${normalizeName(name)}`),
    companyId,
    name: name.trim(),
    role,
    isFounder: isFounder || matched !== undefined,
    founderId: matched?.id ?? null,
    links,
    background,
    source,
    sourceUrl,
    addedAt: runtime.now().toISOString(),
  };
  runtime.deps.store.upsertCompanyMember(member);
}

function founderLinks(founder: Founder): ProfileLinks {
  return founder.links;
}

/** Resolve company identity without a model call. */
export async function runCompanyResolve(runtime: EngineRuntime): Promise<void> {
  const founders = runtime.deps.store.listFounders({ swarmId: runtime.swarm.id })
    .filter((founder) => founder.status !== "archived" && Boolean(founder.company.name?.trim()))
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));

  for (const founder of founders) {
    const name = founder.company.name!.trim();
    const normalizedName = normalizeCompanyName(name);
    if (!normalizedName) continue;
    const domain = companyIdentityDomain(founder.company.url);
    const linked = founder.companyId ? runtime.deps.store.getCompany(founder.companyId) : null;
    let company: Company | null = null;

    // Two founders share a company only when the company NAME matches. A site alone is not
    // enough: many unrelated companies live under one host (a page on a site builder, a
    // profile on a directory), and merging them would file one company's evidence under
    // another. With the name matching, the site settles which of several same-named
    // companies it is.
    const sameName = runtime.deps.store.findCompaniesByName(runtime.swarm.id, normalizedName);
    if (domain) {
      company = sameName.find((candidate) => candidate.domain === domain) ?? null;
      if (!company) {
        // A company known only by name gets its site when a founder first supplies one.
        const withoutSite = sameName.filter((candidate) => !candidate.domain);
        if (linked && !linked.domain && normalizeCompanyName(linked.name) === normalizedName) company = linked;
        else if (withoutSite.length === 1) company = withoutSite[0]!;
        if (company) {
          company = runtime.deps.store.updateCompany(company.id, {
            domain,
            url: company.url ?? founder.company.url,
            updatedAt: runtime.now().toISOString(),
          });
        }
      }
    } else if (linked && normalizeCompanyName(linked.name) === normalizedName) {
      company = linked;
    } else if (sameName.length === 1) {
      company = sameName[0]!;
    }

    if (!company) {
      const timestamp = runtime.now().toISOString();
      company = {
        id: stableId("cmp", `${runtime.swarm.id}:${domain ?? ""}:${normalizedName}`),
        swarmId: runtime.swarm.id,
        name,
        domain,
        url: founder.company.url,
        oneLiner: founder.company.oneLiner,
        mission: null,
        sector: null,
        stage: founder.company.stage,
        links: { github: null, x: null, linkedin: null, docs: null, careers: null },
        status: "tracked",
        firstSeenAt: timestamp,
        updatedAt: timestamp,
        lastResearchedAt: null,
        lastAssessedAt: null,
        nextRecheckAt: null,
        simId: founder.simId,
      };
      runtime.deps.store.insertCompany(company);
    } else {
      const patch: Partial<Company> = { updatedAt: runtime.now().toISOString() };
      if (!company.domain && domain) patch.domain = domain;
      if (!company.url && founder.company.url) patch.url = founder.company.url;
      if (!company.oneLiner && founder.company.oneLiner) patch.oneLiner = founder.company.oneLiner;
      if (!company.stage && founder.company.stage) patch.stage = founder.company.stage;
      company = runtime.deps.store.updateCompany(company.id, patch);
    }

    if (founder.companyId !== company.id) {
      runtime.deps.store.updateFounder(founder.id, { companyId: company.id, updatedAt: runtime.now().toISOString() });
    }
    linkMember(runtime, company.id, founder.name, "Founder", founderLinks(founder), founder.sources[0] ?? "manual", null, null, true, [founder]);
  }
}

function companyGaps(runtime: EngineRuntime, companyId: string): CompanyResearchInput["gaps"] {
  const assessment = runtime.deps.store.latestCompanyAssessment(companyId);
  if (!assessment) return [];
  const judgments = new Map(assessment.judgments.map((judgment) => [judgment.dimension, judgment]));
  return COMPANY_DIMENSIONS.filter((dimension) => {
    const judgment = judgments.get(dimension.id);
    return !judgment || judgment.level === null || judgment.confidence < 0.5;
  }).map(({ id, label, question }) => ({ dimension: id, label, question }));
}

function eligibleFounders(runtime: EngineRuntime, companyId: string, minFit: number): Founder[] {
  return foundersFor(runtime, companyId).filter((founder) =>
    founder.status !== "screened_out" && founder.status !== "passed" && founder.status !== "archived" &&
    founder.fit !== null && founder.fit >= minFit,
  );
}

function companyEvidenceBrief(evidence: Evidence): EvidenceBrief {
  return { ...evidenceBrief(evidence), facet: evidence.facet ?? null };
}

function evidenceForResearch(runtime: EngineRuntime, companyId: string): EvidenceBrief[] {
  return runtime.deps.store.listCompanyEvidence(companyId).map(companyEvidenceBrief);
}

function addCompanyEvidence(
  runtime: EngineRuntime,
  founderId: string,
  companyId: string,
  taskId: string,
  drafts: readonly import("@agentswarm/shared").CompanyEvidenceDraft[],
): number {
  let inserted = 0;
  for (const draft of drafts) {
    if (runtime.stopped()) break;
    const excerpt = draft.excerpt.trim().slice(0, 1200);
    const claim = draft.claim.trim();
    if (!excerpt || !claim || !draft.url?.trim()) continue;
    const hash = hashEvidence("web", draft.url, excerpt);
    const item: Evidence = {
      id: stableId("evd", `${runtime.run.id}:${taskId}:${hash}`),
      founderId,
      companyId,
      facet: draft.facet,
      kind: draft.kind,
      source: "web",
      url: draft.url.trim(),
      title: draft.title.trim() || "Untitled evidence",
      excerpt,
      claim,
      publishedAt: draft.publishedAt,
      capturedAt: runtime.now().toISOString(),
      collectedByTaskId: taskId,
      hash,
      verification: "unverified",
      verificationNote: null,
      sim: draft.sim ?? null,
    };
    if (runtime.deps.store.insertEvidence(item)) inserted += 1;
  }
  if (inserted > 0) runtime.addStats({ evidence: inserted });
  return inserted;
}

function mergeProfile(runtime: EngineRuntime, company: Company, profile: import("@agentswarm/shared").CompanyProfileUpdate): Company {
  const url = profile.url?.trim() || null;
  const domain = companyIdentityDomain(url);
  return runtime.deps.store.updateCompany(company.id, {
    ...(company.url || !url ? {} : { url }),
    ...(company.domain || !domain ? {} : { domain }),
    ...(profile.oneLiner?.trim() ? { oneLiner: profile.oneLiner.trim() } : {}),
    ...(profile.sector?.trim() ? { sector: profile.sector.trim() } : {}),
    ...(profile.stage?.trim() ? { stage: profile.stage.trim() } : {}),
    ...(profile.missionText?.trim() ? { mission: { text: profile.missionText.trim(), url: profile.missionUrl?.trim() || null } } : {}),
    links: {
      github: profile.github?.trim() || company.links.github,
      x: profile.x?.trim() || company.links.x,
      linkedin: profile.linkedin?.trim() || company.links.linkedin,
      docs: profile.docs?.trim() || company.links.docs,
      careers: profile.careers?.trim() || company.links.careers,
    },
    updatedAt: runtime.now().toISOString(),
  });
}

function addResearchTeam(runtime: EngineRuntime, companyId: string, members: readonly import("@agentswarm/shared").TeamMemberDraft[], founders: readonly Founder[]): void {
  for (const member of members) {
    if (!member.name.trim()) continue;
    linkMember(runtime, companyId, member.name, member.role, member.links, "web", member.sourceUrl, member.background, member.isFounder, founders);
  }
}

function addPeopleTeam(runtime: EngineRuntime, company: Company, founders: readonly Founder[], people: readonly PersonRecord[]): void {
  for (const person of people) {
    if (!person.name.trim()) continue;
    const links: ProfileLinks = {
      github: null,
      linkedin: person.profileUrl,
      x: null,
      site: null,
      scholar: null,
    };
    linkMember(runtime, company.id, person.name, person.current?.title ?? null, links, "people_data", person.profileUrl, null, false, founders);
  }
}

function researchPriority(runtime: EngineRuntime, company: Company, minFit: number) {
  const founders = eligibleFounders(runtime, company.id, minFit);
  const best = founders.map((founder) => ({ founder, assessment: latestFounderAssessment(runtime, founder) }))
    .sort((a, b) => (b.assessment?.composite ?? -1) - (a.assessment?.composite ?? -1) ||
      (b.founder.fit ?? -1) - (a.founder.fit ?? -1) || a.founder.firstSeenAt.localeCompare(b.founder.firstSeenAt))[0];
  return { founders, score: best?.assessment?.composite ?? -1, fit: best?.founder.fit ?? -1 };
}

/** Research selected companies with the active product, traction and team agents. */
export async function runCompanyResearch(runtime: EngineRuntime, companyCandidates: Set<string>): Promise<void> {
  const researchers = activeAgents(runtime, RESEARCH_JOBS);
  if (researchers.length === 0) return;
  const limit = numberParam("company.max_companies", runtime.resolve(researchers[0]!, "company.max_companies"), runtime.config);
  if (limit <= 0) return;
  const byJob = new Map<ResearchJob, Agent>();
  for (const jobId of RESEARCH_JOBS) {
    const agent = researchers.find((candidate) => candidate.jobId === jobId);
    if (agent) byJob.set(jobId, agent);
  }
  if (byJob.size === 0) return;

  const now = runtime.now().getTime();
  const companies = runtime.deps.store.listCompanies({ swarmId: runtime.swarm.id }).filter((company) => company.status !== "archived");
  const noCall = (company: Company) => latestCompanyCall(runtime, company.id)?.verdict === "no";
  const minFit = numberParam("screen.min_fit", runtime.resolve(null, "screen.min_fit"), runtime.config);
  const candidates: Array<{ company: Company; mode: "deep" | "normal"; score?: number; fit?: number; due?: string }> = [];
  const included = new Set<string>();
  const push = (item: (typeof candidates)[number]) => {
    if (!included.has(item.company.id) && !noCall(item.company)) {
      included.add(item.company.id);
      candidates.push(item);
    }
  };

  for (const company of companies) {
    if (company.status === "needs_evidence" && runtime.deps.store.companyAssessmentHistory(company.id).length === 1) {
      push({ company, mode: "deep" });
    }
  }
  const neverResearched = companies.filter((company) => company.lastResearchedAt === null && !included.has(company.id))
    .map((company) => ({ company, ...researchPriority(runtime, company, minFit) }))
    .filter((candidate) => candidate.founders.length > 0)
    .sort((a, b) => b.score - a.score || b.fit - a.fit || a.company.firstSeenAt.localeCompare(b.company.firstSeenAt));
  for (const candidate of neverResearched) push({ company: candidate.company, mode: "normal", score: candidate.score, fit: candidate.fit });
  const due = companies.filter((company) => company.nextRecheckAt !== null && new Date(company.nextRecheckAt).getTime() <= now && !included.has(company.id))
    .sort((a, b) => a.nextRecheckAt!.localeCompare(b.nextRecheckAt!) || a.id.localeCompare(b.id));
  for (const company of due) push({ company, mode: "normal", due: company.nextRecheckAt! });

  const selected = candidates.slice(0, limit);
  await forEachConcurrent(selected, runtime.concurrency, runtime.stopped, async ({ company: initial, mode }) => {
    if (runtime.stopped()) return;
    const company = runtime.deps.store.getCompany(initial.id);
    if (!company || noCall(company)) return;
    const founders = foundersFor(runtime, company.id);
    const lead = leadFounder(runtime, founders);
    if (!lead) return;
    const known = evidenceForResearch(runtime, company.id);
    const gaps = companyGaps(runtime, company.id);
    const results = await Promise.all(RESEARCH_JOBS.flatMap((jobId) => {
      const agent = byJob.get(jobId);
      if (!agent) return [];
      const depth = mode === "deep" ? "deep" : stringParam("investigate.depth", runtime.resolve(agent, "investigate.depth"), runtime.config) as CompanyResearchInput["depth"];
      const input: CompanyResearchInput = {
        company: companyRef(runtime, company),
        founders: founders.map((founder) => founderBrief(runtime, founder)),
        thesis: runtime.swarm.thesis,
        known,
        depth,
        gaps,
      };
      return [runtime.runJob({ agent, stage: "investigate", jobId, input, founderId: lead.id, companyId: company.id })
        .then((result) => ({ jobId, result }))];
    }));
    const successful = results.filter(({ result }) => result?.task.status === "succeeded" && result.output !== null);
    if (successful.length === 0) return;
    let current = company;
    for (const { result } of successful) {
      const output = result!.output!;
      addCompanyEvidence(runtime, lead.id, company.id, result!.task.id, output.evidence);
      current = mergeProfile(runtime, current, output.profile);
      addResearchTeam(runtime, company.id, output.team, founders);
    }
    if (runtime.run.sources === "live" && runtime.deps.people) {
      try {
        const people = await runtime.deps.people.team({ name: current.name, domain: current.domain }, 10, runtime.signal);
        addPeopleTeam(runtime, current, founders, people);
      } catch (error) {
        console.warn("Company team lookup failed", company.id, error);
      }
    }
    runtime.deps.store.updateCompany(company.id, { lastResearchedAt: runtime.now().toISOString(), updatedAt: runtime.now().toISOString() });
    companyCandidates.add(company.id);
    runtime.addStats({ companiesResearched: 1 });
  });
}

function partnerNotes(runtime: EngineRuntime, companyId: string): string[] {
  return runtime.deps.store.listCompanyFeedback(companyId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((call) => {
      const reasons = call.reasonTags.map(companyReasonLabel).filter(Boolean);
      const note = call.note?.trim() ?? "";
      return `${call.verdict === "yes" ? "Yes" : "No"}${reasons.length ? ` (${reasons.join("; ")})` : ""}${note ? `: ${note}` : ""}`;
    });
}

function dealFor(runtime: EngineRuntime, company: Company, assessment: CompanyAssessment, weights: ReturnType<typeof effectiveCompanyWeights>, thresholds: ReturnType<typeof effectiveThresholds>, teamShare: number) {
  const founders = foundersFor(runtime, company.id);
  const assessed = founders.map((founder) => ({ founder, assessment: latestFounderAssessment(runtime, founder) }))
    .filter((entry): entry is typeof entry & { assessment: NonNullable<typeof entry.assessment> } => entry.assessment !== null)
    .sort((a, b) => b.assessment.composite - a.assessment.composite || a.founder.firstSeenAt.localeCompare(b.founder.firstSeenAt));
  const lead = assessed[0] ?? null;
  const team = lead ? {
    composite: lead.assessment.composite,
    coverage: lead.assessment.coverage,
    potential: lead.assessment.potential,
    integrityCritical: lead.assessment.flags.some((flag) => flag.code === "integrity_critical"),
  } : null;
  const fit = lead ? (lead.assessment.fit ?? lead.founder.fit) : founders.reduce<number | null>((highest, founder) =>
    founder.fit === null ? highest : highest === null ? founder.fit : Math.max(highest, founder.fit), null);
  const scored = scoreCompany({ judgments: assessment.judgments, weights, unknownPrior: thresholds.unknownPrior });
  const deal = decideDeal({
    company: {
      composite: assessment.company,
      coverage: assessment.companyCoverage,
      potential: assessment.companyPotential,
      claimsCritical: scored.claimsCritical,
      flags: scored.flags,
      breakdown: assessment.breakdown,
    },
    team,
    fit,
    thresholds,
    teamShare,
  });
  return { leadFounderId: lead?.founder.id ?? null, team, fit, deal };
}

function saveDealAssessment(
  runtime: EngineRuntime,
  company: Company,
  previous: CompanyAssessment,
  result: ReturnType<typeof dealFor>,
  id: string,
  runId: string | null,
  recheckDays: number,
): CompanyAssessment {
  const createdAt = runtime.now().toISOString();
  const assessment: CompanyAssessment = {
    ...previous,
    id,
    companyId: company.id,
    runId,
    leadFounderId: result.leadFounderId,
    team: result.team?.composite ?? null,
    deal: result.deal.score,
    coverage: result.deal.coverage,
    potential: result.deal.potential,
    decision: result.deal.decision,
    reasons: result.deal.reasons,
    flags: result.deal.flags,
    createdAt,
  };
  runtime.deps.store.insertCompanyAssessment(assessment);
  const status = finalStatus(runtime, company.id, assessment.decision);
  runtime.deps.store.updateCompany(company.id, {
    status,
    lastAssessedAt: createdAt,
    nextRecheckAt: new Date(runtime.now().getTime() + recheckDays * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: createdAt,
  });
  runtime.addStats({ companiesAssessed: 1, companiesSurfaced: assessment.decision === "surface" ? 1 : 0 });
  return assessment;
}

/** Ground the company rubric in checked evidence, combine with the lead founder, and decide. */
export async function runCompanyAssess(runtime: EngineRuntime, companyCandidates: Set<string>): Promise<void> {
  const agent = activeAgents(runtime, ["assess.company"])[0];
  if (!agent) return;
  const weights = effectiveCompanyWeights(runtime.resolve(agent, "cweights.mission"), runtime.config);
  const thresholds = effectiveThresholds(runtime.resolve(agent, "assess.surface_threshold"), runtime.config);
  const teamShare = numberParam("deal.team_share", runtime.resolve(agent, "deal.team_share"), runtime.config);
  const recheckDays = numberParam("recheck.days", runtime.resolve(agent, "recheck.days"), runtime.config);

  // A company researched in an earlier run can have its evidence verified only now, for example
  // when that run's fact-check was thrown away by a failed planted check. It is assessed as soon
  // as there is verified evidence newer than its last assessment, not at the next re-check.
  const toAssess = new Set(companyCandidates);
  for (const company of runtime.deps.store.listCompanies({ swarmId: runtime.swarm.id, statuses: ["tracked", "needs_evidence", "watch", "surfaced"] })) {
    if (toAssess.has(company.id) || !company.lastResearchedAt) continue;
    const verified = runtime.deps.store.listCompanyEvidence(company.id, { verifications: ["supported"] });
    const newest = verified.reduce((latest, item) => (item.capturedAt > latest ? item.capturedAt : latest), "");
    if (newest && (!company.lastAssessedAt || newest > company.lastAssessedAt)) toAssess.add(company.id);
  }

  await forEachConcurrent([...toAssess], runtime.concurrency, runtime.stopped, async (companyId) => {
    const company = runtime.deps.store.getCompany(companyId);
    if (!company || company.swarmId !== runtime.swarm.id) return;
    const evidence = runtime.deps.store.listCompanyEvidence(company.id, { verifications: ["supported"] });
    if (evidence.length === 0 && runtime.deps.store.listCompanyEvidence(company.id, { verifications: ["unverified"] }).length > 0) return;
    const input = {
      company: companyRef(runtime, company),
      thesis: runtime.swarm.thesis,
      evidence: evidence.map(companyEvidenceBrief),
      partnerNotes: partnerNotes(runtime, company.id),
    };
    const result = await runtime.runJob({ agent, stage: "assess", jobId: "assess.company", input, companyId: company.id });
    if (!result || result.task.status !== "succeeded" || !result.output) return;
    const supplied = new Set(input.evidence.map((item) => item.id));
    const judgments = groundCompanyJudgments(result.output.judgments, supplied);
    const score = scoreCompany({ judgments, weights, unknownPrior: thresholds.unknownPrior });
    const brief: CompanyBrief = {
      summary: result.output.summary.trim(),
      strengths: groundPoints(result.output.strengths, supplied),
      risks: groundPoints(result.output.risks, supplied),
      openQuestions: result.output.openQuestions.map((question) => question.trim()).filter(Boolean),
    };
    const companyAssessment: CompanyAssessment = {
      id: stableId("cas", `${runtime.run.id}:${company.id}`),
      companyId: company.id,
      runId: runtime.run.id,
      configId: runtime.config.id,
      company: score.composite,
      companyCoverage: score.coverage,
      companyPotential: score.potential,
      leadFounderId: null,
      team: null,
      deal: 0,
      coverage: 0,
      potential: null,
      decision: "pass",
      reasons: [],
      flags: [],
      breakdown: score.breakdown,
      judgments,
      brief,
      createdAt: runtime.now().toISOString(),
    };
    const combined = dealFor(runtime, company, companyAssessment, weights, thresholds, teamShare);
    const completed = saveDealAssessment(runtime, company, companyAssessment, combined, companyAssessment.id, runtime.run.id, recheckDays);
    runtime.deps.store.updateCompany(company.id, { status: finalStatus(runtime, company.id, completed.decision) });
  });

  // A founder can change the deal while no company evidence has changed. Carry the previous
  // company judgment forward and recompute only the combined score and decision.
  const companies = runtime.deps.store.listCompanies({ swarmId: runtime.swarm.id }).filter((company) => !toAssess.has(company.id));
  await forEachConcurrent(companies, runtime.concurrency, runtime.stopped, async (company) => {
    const previous = runtime.deps.store.latestCompanyAssessment(company.id);
    if (!previous) return;
    const founders = foundersFor(runtime, company.id);
    const lead = leadFounder(runtime, founders);
    const latest = lead ? latestFounderAssessment(runtime, lead) : null;
    if (!latest || latest.createdAt <= previous.createdAt) return;
    const combined = dealFor(runtime, company, previous, weights, thresholds, teamShare);
    saveDealAssessment(runtime, company, previous, combined, stableId("cas", `${runtime.run.id}:${company.id}`), runtime.run.id, recheckDays);
  });
}
