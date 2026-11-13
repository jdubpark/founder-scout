import {
  BASE_CONFIG,
  decideDeal,
  effectiveCompanyWeights,
  effectiveThresholds,
  effectiveWeights,
  getParamDef,
  numberParam,
  resolveSteering,
  scoreCompany,
  scoreFounder,
  swarmIdentity,
  type Agent,
  type Assessment,
  type CompanyAssessment,
  type DecisionFlip,
  type PreviewDTO,
  type SwarmConfig,
} from "@agentswarm/shared";
import type { Store } from "../contracts";
import { ServiceError } from "../contracts";

export interface PreviewDeps {
  store: Pick<Store,
    | "getSwarm"
    | "getConfig"
    | "listAgents"
    | "listDirectives"
    | "listFounders"
    | "latestAssessment"
    | "listCompanies"
    | "latestCompanyAssessment"
  >;
  now: () => Date;
}

const COMPANY_ANALYST_JOBS = ["assess.judgments", "assess.company"] as const;
const SCORE_PARAMS = new Set([
  "screen.min_fit",
  "assess.surface_threshold",
  "assess.watch_threshold",
  "assess.min_coverage",
  "assess.unknown_prior",
  "deal.team_share",
]);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function configFor(store: PreviewDeps["store"], swarmId: string): SwarmConfig {
  const swarm = store.getSwarm(swarmId);
  if (!swarm) throw new ServiceError(404, "Swarm not found.");
  return store.getConfig(swarm.configId) ?? BASE_CONFIG;
}

function steeringForCompany(agent: Agent | undefined, swarmId: string, directives: ReturnType<PreviewDeps["store"]["listDirectives"]>, at: Date) {
  return resolveSteering(directives, agent
    ? { swarmId, classId: agent.classId, jobId: agent.jobId, agentId: agent.id }
    : { swarmId, classId: "analyst", jobId: "assess.company", agentId: null }, at);
}

function rescoreFounder(assessment: Assessment, founder: ReturnType<PreviewDeps["store"]["listFounders"]>[number], config: SwarmConfig, steering: ReturnType<typeof resolveSteering>) {
  const thresholds = effectiveThresholds(steering, config);
  const weights = effectiveWeights(steering, config);
  return scoreFounder({ judgments: assessment.judgments, weights, thresholds, fit: founder.fit });
}

function asFlip(id: string, name: string, from: string, to: string, scoreFrom: number, scoreTo: number): DecisionFlip {
  return { id, name, from, to, scoreFrom, scoreTo };
}

function guidanceChanged(before: SwarmConfig, after: SwarmConfig): boolean {
  return COMPANY_ANALYST_JOBS.some((job) => stable(before.lessons?.[job] ?? []) !== stable(after.lessons?.[job] ?? []));
}

function unseenChanges(before: SwarmConfig, after: SwarmConfig): string[] {
  const unseen: string[] = [];
  if (guidanceChanged(before, after)) {
    unseen.push("New guidance for an analyst takes effect when founders or companies are assessed again.");
  }

  const routeKeys = new Set(["routes", "pools", "promptVariants"]);
  let routeChanged = [...routeKeys].some((key) => stable(before[key as keyof SwarmConfig]) !== stable(after[key as keyof SwarmConfig]));
  const settingLabels = new Set<string>();
  const keys = new Set([...Object.keys(before.params), ...Object.keys(after.params)]);
  for (const key of keys) {
    if (stable(before.params[key]) === stable(after.params[key])) continue;
    if (key.startsWith("route.")) {
      routeChanged = true;
    } else if (!key.startsWith("weights.") && !key.startsWith("cweights.") && key !== "deal.team_share" && !SCORE_PARAMS.has(key)) {
      settingLabels.add(getParamDef(key)?.label ?? key);
    }
  }
  if (routeChanged) unseen.push("A change of model or prompt takes effect on the next run.");
  if (settingLabels.size) unseen.push(`Settings changed that do not affect scores: ${[...settingLabels].sort().join(", ")}.`);
  return unseen;
}

export function previewConfig(deps: PreviewDeps, swarmId: string, candidate: SwarmConfig): PreviewDTO {
  const current = configFor(deps.store, swarmId);
  const founders = deps.store.listFounders({ swarmId });
  const companies = deps.store.listCompanies({ swarmId });
  const directives = deps.store.listDirectives();
  const now = deps.now();
  const founderSteering = resolveSteering(directives, swarmIdentity(swarmId), now);
  const companyAgent = deps.store.listAgents(swarmId).find((agent) => agent.status === "active" && agent.jobId === "assess.company");
  const companySteering = steeringForCompany(companyAgent, swarmId, directives, now);
  const assessments = new Map<string, Assessment>();
  for (const founder of founders) {
    const assessment = deps.store.latestAssessment(founder.id);
    if (assessment) assessments.set(founder.id, assessment);
  }

  const founderFlips: DecisionFlip[] = [];
  let consideredFounders = 0;
  for (const founder of founders) {
    const assessment = assessments.get(founder.id);
    if (!assessment || assessment.judgments.length === 0) continue;
    consideredFounders += 1;
    const from = rescoreFounder(assessment, founder, current, founderSteering);
    const to = rescoreFounder(assessment, founder, candidate, founderSteering);
    if (from.decision !== to.decision) {
      founderFlips.push(asFlip(founder.id, founder.name, from.decision, to.decision, from.composite, to.composite));
    }
  }

  const companyFlips: DecisionFlip[] = [];
  let consideredCompanies = 0;
  for (const company of companies) {
    const assessment = deps.store.latestCompanyAssessment(company.id);
    if (!assessment || assessment.judgments.length === 0) continue;
    consideredCompanies += 1;

    const companyFounders = founders.filter((founder) => founder.companyId === company.id && assessments.has(founder.id));
    const scoreCompanyDecision = (config: SwarmConfig) => {
      const thresholds = effectiveThresholds(companySteering, config);
      const companyScore = scoreCompany({
        judgments: assessment.judgments,
        weights: effectiveCompanyWeights(companySteering, config),
        unknownPrior: thresholds.unknownPrior,
      });
      const teamCandidates = companyFounders.map((founder) => {
        const founderAssessment = assessments.get(founder.id)!;
        return { founder, score: rescoreFounder(founderAssessment, founder, config, founderSteering) };
      }).sort((a, b) => b.score.composite - a.score.composite || a.founder.firstSeenAt.localeCompare(b.founder.firstSeenAt) || a.founder.id.localeCompare(b.founder.id));
      const lead = teamCandidates[0] ?? null;
      const team = lead ? {
        composite: lead.score.composite,
        coverage: lead.score.coverage,
        potential: lead.score.potential,
        integrityCritical: teamCandidates.some(({ score }) => score.flags.some((flag) => flag.code === "integrity_critical")),
      } : null;
      const fit = lead
        ? lead.founder.fit
        : companyFounders.reduce<number | null>((highest, founder) => founder.fit === null ? highest : highest === null ? founder.fit : Math.max(highest, founder.fit), null);
      const result = decideDeal({
        company: companyScore,
        team,
        fit,
        thresholds,
        teamShare: numberParam("deal.team_share", companySteering, config),
      });
      return result;
    };
    const from = scoreCompanyDecision(current);
    const to = scoreCompanyDecision(candidate);
    if (from.decision !== to.decision) {
      companyFlips.push(asFlip(company.id, company.name, from.decision, to.decision, from.score, to.score));
    }
  }

  const byScoreChange = (a: DecisionFlip, b: DecisionFlip) => Math.abs(b.scoreTo - b.scoreFrom) - Math.abs(a.scoreTo - a.scoreFrom) || a.id.localeCompare(b.id);
  return {
    founders: founderFlips.sort(byScoreChange),
    companies: companyFlips.sort(byScoreChange),
    considered: { founders: consideredFounders, companies: consideredCompanies },
    unseen: unseenChanges(current, candidate),
  };
}
