import {
  COMPANY_DIMENSIONS,
  COMPANY_DIMENSION_IDS,
  EVIDENCE_KINDS,
  EVIDENCE_FACETS,
  stableId,
} from "@agentswarm/shared";
import type {
  CompanyAssessInput,
  CompanyAssessOutput,
  CompanyDimensionId,
  CompanyEvidenceDraft,
  CompanyProfileUpdate,
  CompanyResearchInput,
  CompanyResearchOutput,
  EvidenceBrief,
  TeamMemberDraft,
} from "@agentswarm/shared";
import type { JobContext } from "../contracts";
import { containsSensitive, explicitJson, renderEvidence, renderThesis, safeTag } from "./common";

export type CompanyJobId = "company.product" | "company.traction" | "company.team" | "assess.company";

const EMPTY_PROFILE: CompanyProfileUpdate = {
  url: null,
  oneLiner: null,
  missionText: null,
  missionUrl: null,
  taglineText: null,
  taglineUrl: null,
  sector: null,
  stage: null,
  github: null,
  x: null,
  linkedin: null,
  docs: null,
  careers: null,
};

const GAP_INSTRUCTION = "The last assessment could not settle these questions. Look for sources that would settle them before anything else.";

const FOCUS: Record<Exclude<CompanyJobId, "assess.company">, string> = {
  "company.product": "the company's mission, shipped product and outside access, alternatives and other teams on the problem, and what the company says comes next in a roadmap, changelog, blog, or talk",
  "company.traction": "dated public launches, releases, named customers or users, published usage, funding rounds and filings, and hiring milestones",
  "company.team": "the professional team beyond the lead founder, using the company's team page, code host organisation, press, and conference pages",
};

export function companySystemRules(id: CompanyJobId): string {
  if (id === "assess.company") {
    return "\nAnswer each company rubric question from the supplied verified evidence. Give a level from 0 to 4 or null when the evidence does not settle it, confidence, rationale, and evidence IDs. Partner notes are context for questions, not evidence. Write a plain, non-promotional summary of at most about 80 words. Every strength, risk, and moat must cite supplied evidence IDs. Give one sentence on what would make the company hard to copy, or null when verified evidence shows no moat. Never return a score, ranking, or decision.";
  }
  const rules = [
    "Every evidence item needs a facet, source address, and excerpt copied word for word from that page. Do not paraphrase or tidy excerpts. Quote at least one full sentence, because a few words cannot be checked. To skip words between passages, put \" ... \" between them. Code discards an excerpt whose words are not on the cited page.",
    "Use public professional information about the company and its team only. Do not repeat evidence already supplied as known.",
    "Fill the profile with the company site, a one-line description in plain words, sector, stage, and links when found.",
    "Read linkedin.com anonymously like any public page, and never log in to it or any other site.",
    "Use the requested depth to scale search effort: quick is a small set of strong sources, standard is a balanced search, and deep follows primary sources and checks independent reporting.",
    "In notes, state what you looked for and did not find.",
  ];
  if (id === "company.traction") {
    rules.push("Record the date stated by a source in publishedAt, and leave it null when the source gives no date. Prefer sources outside the company for customer, usage, and money claims. If sources contradict one another, record the contradiction as facet risk.");
  }
  if (id === "company.team") {
    rules.push("Return only professional details. For each team member include their name, role, founder status, one line of relevant earlier work, and the page that lists them.");
  }
  if (id === "company.product") {
    rules.push("Copy the company's own mission exactly into profile.missionText and tagline exactly into profile.taglineText, with each page address in its matching URL field. Never paraphrase either line. Return the mission as evidence with facet mission. Check what has shipped and whether outsiders can use it, alternatives and other teams working on the problem, and the stated roadmap.");
  }
  return "\n" + rules.join(" ");
}

export function buildCompanyPrompt(
  id: CompanyJobId,
  input: CompanyResearchInput | CompanyAssessInput,
  ctx: JobContext,
): string {
  if (id === "assess.company") {
    const value = input as CompanyAssessInput;
    const prompt = [
      "Task: assess the company against every rubric dimension. Answer each question independently from verified evidence, cite supplied evidence IDs, and use null when unsettled. Partner notes are context only and cannot support an answer. Add a plain summary of the company and its current position in at most about 80 words, sourced strengths and risks, one cited sentence on what may make it hard to copy or null when evidence shows no moat, and open questions. Do not return any score, ranking, or decision.",
      safeTag("investment_thesis", renderThesis(value.thesis)),
      safeTag("company", explicitJson({
        id: value.company.id,
        name: value.company.name,
        url: value.company.url,
        oneLiner: value.company.oneLiner,
        mission: value.company.mission,
        tagline: value.company.tagline,
        sector: value.company.sector,
        stage: value.company.stage,
        links: value.company.links,
        team: value.company.team,
      })),
      safeTag("verified_evidence", renderEvidence(value.evidence)),
      safeTag("partner_notes", explicitJson(value.partnerNotes)),
      safeTag("company_rubric", explicitJson(COMPANY_DIMENSIONS.map((dimension) => ({
        id: dimension.id,
        question: dimension.question,
        levels: dimension.levels,
      })))),
    ];
    if (ctx.steeringBlock) prompt.push(ctx.steeringBlock);
    return prompt.join("\n\n");
  }

  const value = input as CompanyResearchInput;
  const prompt = [
    "Task: research the company described in the company block for " + FOCUS[id] + ". Return sourced evidence, a careful profile update, team listings when relevant, and notes on what was not found.",
  ];
  if (value.gaps.length) {
    const gaps = value.gaps.map((gap) => ({ label: gap.label, question: gap.question }));
    prompt.push(safeTag("open_questions", GAP_INSTRUCTION + "\n" + explicitJson(gaps)));
  }
  prompt.push(
    safeTag("company", explicitJson({
      id: value.company.id,
      name: value.company.name,
      url: value.company.url,
      oneLiner: value.company.oneLiner,
      mission: value.company.mission,
      tagline: value.company.tagline,
      sector: value.company.sector,
      stage: value.company.stage,
      links: value.company.links,
      team: value.company.team,
    })),
    safeTag("founders", explicitJson(value.founders.map((founder) => ({
      name: founder.name,
      headline: founder.headline,
      company: founder.company,
      links: founder.links,
    })))),
    safeTag("investment_thesis", renderThesis(value.thesis)),
    safeTag("known_evidence", renderEvidence(value.known)),
    safeTag("research_depth", value.depth),
  );
  if (ctx.steeringBlock) prompt.push(ctx.steeringBlock);
  return prompt.join("\n\n");
}

const blankResearch = (notes: string): CompanyResearchOutput => ({
  evidence: [],
  profile: { ...EMPTY_PROFILE },
  team: [],
  notes,
});

export function simulateCompanyResearch(
  id: Exclude<CompanyJobId, "assess.company">,
  input: CompanyResearchInput,
  ctx: JobContext,
): CompanyResearchOutput {
  const company = input.company.simId && ctx.sim ? ctx.sim.company(input.company.simId) : undefined;
  if (!company || !ctx.sim) return blankResearch("No simulated company source record is available; no claims were added.");

  const knownUrls = new Set(input.known.map((item) => item.url?.trim()).filter((url): url is string => Boolean(url)));
  const evidence = ctx.sim.companyEvidenceFor(company.simId, id, input.depth)
    .filter((item) => !item.url || !knownUrls.has(item.url.trim()));
  const profile: CompanyProfileUpdate = {
    ...EMPTY_PROFILE,
    url: company.url,
    oneLiner: company.oneLiner,
    missionText: company.mission,
    missionUrl: company.url,
    taglineText: company.tagline,
    taglineUrl: company.url,
    sector: company.sector,
    stage: company.stage,
  };
  return {
    evidence,
    profile,
    team: id === "company.team" ? company.team : [],
    notes: evidence.length
      ? "Synthetic company sources found at " + input.depth + " depth."
      : "No new synthetic company evidence was found beyond the material already on file.",
  };
}

function normalizeName(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanNullable(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed && !containsSensitive(trimmed) ? trimmed : null;
}

function normalizeCompanyEvidence(items: CompanyEvidenceDraft[], input: CompanyResearchInput): CompanyEvidenceDraft[] {
  const knownUrls = new Set(input.known.map((item) => item.url?.trim()).filter((url): url is string => Boolean(url)));
  return items
    .filter((item) => EVIDENCE_FACETS.includes(item.facet))
    .filter((item) => (EVIDENCE_KINDS as readonly string[]).includes(item.kind))
    .map((item) => ({ ...item, url: item.url?.trim() || null, title: item.title.trim(), excerpt: item.excerpt.trim(), claim: item.claim.trim() }))
    .filter((item) => Boolean(item.url) && !knownUrls.has(item.url!))
    .filter((item) => item.excerpt.length > 0 && item.claim.length > 0)
    .filter((item) => !containsSensitive(item.title, item.url, item.excerpt, item.claim))
    .map((item) => ({ ...item, excerpt: item.excerpt.slice(0, 1200) }));
}

export function normalizeCompanyResearch(input: CompanyResearchInput, output: CompanyResearchOutput): CompanyResearchOutput {
  const cleanProfile = Object.fromEntries(
    Object.entries(output.profile).map(([key, value]) => [key, cleanNullable(value)]),
  ) as CompanyProfileUpdate;
  const seen = new Set<string>();
  const team: TeamMemberDraft[] = [];
  for (const member of output.team) {
    const name = member.name.trim();
    const key = normalizeName(name);
    if (!name || !key || seen.has(key) || containsSensitive(name)) continue;
    seen.add(key);
    team.push({
      ...member,
      name,
      role: cleanNullable(member.role),
      background: cleanNullable(member.background),
      sourceUrl: cleanNullable(member.sourceUrl),
      links: Object.fromEntries(Object.entries(member.links).map(([field, value]) => [field, cleanNullable(value)])) as TeamMemberDraft["links"],
    });
  }
  return {
    evidence: normalizeCompanyEvidence(output.evidence, input),
    profile: cleanProfile,
    team,
    notes: output.notes,
  };
}

const safeLevel = (value: number | null): number | null =>
  value === null || !Number.isFinite(value) ? null : Math.round(Math.max(0, Math.min(4, value)));

export function normalizeCompanyAssessment(input: CompanyAssessInput, output: CompanyAssessOutput): CompanyAssessOutput {
  const evidenceIds = new Set(input.evidence.map((item) => item.id));
  const byDimension = new Map<CompanyDimensionId, CompanyAssessOutput["judgments"][number]>();
  for (const judgment of output.judgments) {
    if (!(COMPANY_DIMENSION_IDS as readonly string[]).includes(judgment.dimension)) continue;
    byDimension.set(judgment.dimension, {
      ...judgment,
      level: safeLevel(judgment.level),
      confidence: Number.isFinite(judgment.confidence) ? Math.max(0, Math.min(1, judgment.confidence)) : 0,
      evidenceIds: [...new Set(judgment.evidenceIds.filter((id) => evidenceIds.has(id)))],
      counterEvidenceIds: [...new Set(judgment.counterEvidenceIds.filter((id) => evidenceIds.has(id)))],
    });
  }
  const judgments = COMPANY_DIMENSIONS.map((dimension) => byDimension.get(dimension.id) ?? ({
    dimension: dimension.id,
    level: null,
    confidence: 0,
    rationale: "The supplied evidence does not settle this dimension.",
    evidenceIds: [],
    counterEvidenceIds: [],
  }));
  const cleanPoints = (points: CompanyAssessOutput["strengths"]): CompanyAssessOutput["strengths"] => points
    .map((point) => ({
      text: point.text.trim(),
      evidenceIds: [...new Set(point.evidenceIds.filter((id) => evidenceIds.has(id)))],
    }))
    .filter((point) => point.text && point.evidenceIds.length > 0);
  return {
    judgments,
    summary: output.summary.trim().slice(0, 1200),
    moat: output.moat ? cleanPoints([output.moat])[0] ?? null : null,
    strengths: cleanPoints(output.strengths),
    risks: cleanPoints(output.risks),
    openQuestions: output.openQuestions.map((question) => question.trim()).filter(Boolean),
  };
}

export interface CompanySimulationMath {
  noise: number;
  gaussian(): number;
}

export function simulateCompanyAssessment(
  input: CompanyAssessInput,
  math: CompanySimulationMath,
): CompanyAssessOutput {
  const judgments: CompanyAssessOutput["judgments"] = COMPANY_DIMENSIONS.map((dimension) => {
    const sources = input.evidence.filter((item) => item.sim?.signals.some((signal) => signal.dimension === dimension.id));
    const signals = sources.flatMap((item) => item.sim?.signals.filter((signal) => signal.dimension === dimension.id) ?? []);
    if (!signals.length) return {
      dimension: dimension.id,
      level: null,
      confidence: 0,
      rationale: "The verified evidence does not settle this dimension.",
      evidenceIds: [],
      counterEvidenceIds: [],
    };
    const average = signals.reduce((sum, signal) => sum + signal.value, 0) / signals.length;
    const level = Math.max(0, Math.min(4, Math.floor((average + math.gaussian() * math.noise) * 5)));
    const ids = [...new Set(sources.map((item) => item.id))];
    return {
      dimension: dimension.id,
      level,
      confidence: Math.min(0.95, 0.55 + 0.15 * ids.length),
      rationale: "Based on " + sources.map((item) => item.title).join("; ") + ".",
      evidenceIds: ids,
      counterEvidenceIds: [],
    };
  });
  // The simulated brief says what the rubric says: each point is the rubric's own description of
  // the level that was judged, so a simulated brief reads like a real one and stays grounded.
  const ranked = judgments.filter((judgment) => judgment.level !== null).sort((a, b) => (b.level ?? -1) - (a.level ?? -1));
  const point = (judgment: (typeof ranked)[number]) => {
    const dimension = COMPANY_DIMENSIONS.find((item) => item.id === judgment.dimension)!;
    return { text: dimension.label + ": " + dimension.levels[judgment.level as number], evidenceIds: judgment.evidenceIds };
  };
  const strong = ranked.filter((judgment) => (judgment.level ?? 0) >= 3).slice(0, 3);
  const weak = ranked.filter((judgment) => (judgment.level ?? 4) <= 1).reverse().slice(0, 3);
  const edge = ranked.find((judgment) => judgment.dimension === "edge");
  const label = (id: string) => COMPANY_DIMENSIONS.find((item) => item.id === id)?.label ?? id;
  const strongest = ranked[0];
  const weakest = ranked[ranked.length - 1];
  return {
    judgments,
    summary: strongest
      ? input.company.name + " is strongest on " + label(strongest.dimension).toLowerCase() +
        (weakest && weakest.dimension !== strongest.dimension ? " and weakest on " + label(weakest.dimension).toLowerCase() + "." : ".")
      : "The evidence on file does not yet settle where " + input.company.name + " stands.",
    moat: edge && (edge.level ?? 0) >= 3 && edge.evidenceIds.length > 0
      ? { text: "The verified evidence points to a company edge that may be hard to copy: " + COMPANY_DIMENSIONS.find((item) => item.id === "edge")!.levels[edge.level as number], evidenceIds: edge.evidenceIds }
      : null,
    strengths: strong.map(point),
    risks: weak.map(point),
    openQuestions: judgments.filter((judgment) => judgment.level === null).slice(0, 4)
      .map((judgment) => COMPANY_DIMENSIONS.find((item) => item.id === judgment.dimension)!.question),
  };
}

export function plantControl(evidence: readonly EvidenceBrief[], rng: () => number, seed: string): { id: string; brief: EvidenceBrief } | null {
  if (!evidence.length) return null;
  const hosts = evidence[Math.min(evidence.length - 1, Math.floor(Math.max(0, rng()) * evidence.length))]!;
  const claims = [
    "The source states that this project has more than 48,000 paying customers.",
    "The source states that this project processed 731 billion daily requests.",
    "The source states that this project operates 2,483 offices worldwide.",
    "The source states that this project has 91,700 full-time employees.",
    "The source states that this project generated 6.8 billion dollars in annual revenue.",
    "The source states that this project has 34,619 enterprise subscribers.",
    "The source states that this project serves 12,407 hospitals.",
    "The source states that this project owns 5,321 patents.",
    "The source states that this project has 806 million monthly active users.",
    "The source states that this project received a 14.7 billion dollar government contract.",
  ];
  const claim = claims[Math.min(claims.length - 1, Math.floor(Math.max(0, rng()) * claims.length))]!;
  const { quote: _quote, ...withoutQuote } = hosts;
  const id = stableId("evd", "control:" + seed);
  return {
    id,
    brief: {
      ...withoutQuote,
      id,
      verification: "unverified",
      claim,
      sim: hosts.sim ? { truth: "unsupported", signals: [], planted: true } : null,
    },
  };
}
