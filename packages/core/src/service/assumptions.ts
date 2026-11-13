import {
  effectiveParam,
  EMPTY_STEERING,
  judgeAssumptions,
  latestCalls,
  type AssumptionsDTO,
  type CompanyFeedback,
  type JudgedCase,
  type OutcomeEvidence,
  type SwarmConfig,
} from "@agentswarm/shared";
import type { EvalService, Store } from "../contracts";
import { ServiceError } from "../contracts";

export interface LedgerDeps {
  store: Pick<Store,
    | "getSwarm"
    | "getConfig"
    | "listFounders"
    | "latestAssessment"
    | "listFeedback"
    | "listCompanies"
    | "latestCompanyAssessment"
    | "listCompanyFeedback"
  >;
  evals: Pick<EvalService, "outcomeEvidence">;
}

function founderLevels(assessment: NonNullable<ReturnType<LedgerDeps["store"]["latestAssessment"]>>): JudgedCase["founderLevels"] {
  return Object.fromEntries(assessment.judgments.map(({ dimension, level }) => [dimension, level === null ? null : level / 4]));
}

function companyLevels(assessment: NonNullable<ReturnType<LedgerDeps["store"]["latestCompanyAssessment"]>>): JudgedCase["companyLevels"] {
  return Object.fromEntries(assessment.judgments.map(({ dimension, level }) => [dimension, level === null ? null : level / 4]));
}

/** The partner's latest Yes or No as a judged case for each assessed founder and company. */
export function callCases(store: LedgerDeps["store"], swarmId: string): JudgedCase[] {
  const founders = store.listFounders({ swarmId });
  const latestFounderCalls = latestCalls(founders.flatMap((founder) => store.listFeedback(founder.id)));
  const cases: JudgedCase[] = [];

  for (const founder of founders) {
    const call = latestFounderCalls.get(founder.id);
    if (!call || (call.verdict !== "yes" && call.verdict !== "no")) continue;
    const assessment = store.latestAssessment(founder.id);
    if (!assessment) continue;
    cases.push({
      group: "calls",
      outcome: call.verdict === "yes" ? 1 : 0,
      founder: assessment.composite,
      company: null,
      deal: null,
      founderLevels: founderLevels(assessment),
      companyLevels: {},
    });
  }

  for (const company of store.listCompanies({ swarmId })) {
    const call = store.listCompanyFeedback(company.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
    if (!call || (call.verdict !== "yes" && call.verdict !== "no")) continue;
    const assessment = store.latestCompanyAssessment(company.id);
    if (!assessment) continue;
    cases.push({
      group: "calls",
      outcome: call.verdict === "yes" ? 1 : 0,
      founder: null,
      company: assessment.company,
      deal: assessment.deal,
      founderLevels: {},
      companyLevels: companyLevels(assessment),
    });
  }

  return cases;
}

export async function assumptionsFor(deps: LedgerDeps, swarmId: string): Promise<AssumptionsDTO> {
  const swarm = deps.store.getSwarm(swarmId);
  if (!swarm) throw new ServiceError(404, "Swarm not found.");

  const config: SwarmConfig = deps.store.getConfig(swarm.configId) ?? {
    id: swarm.configId,
    label: "",
    params: {},
    routes: {},
    promptVariants: {},
  };
  const calls = callCases(deps.store, swarmId);
  let outcomes: OutcomeEvidence | null = null;
  try {
    outcomes = await deps.evals.outcomeEvidence?.() ?? null;
  } catch {
    outcomes = null;
  }

  const founderCalls = calls.filter((item) => item.founder !== null).length;
  const companyCalls = calls.filter((item) => item.company !== null).length;
  return {
    rows: judgeAssumptions({
      outcomes,
      calls,
      current: (key) => {
        const value = effectiveParam(key, EMPTY_STEERING, config).value;
        return value === null ? null : String(value);
      },
    }),
    // Thirty statements tested at a 95% range will throw up one or two false verdicts between them.
    outcomesBasis: outcomes ? `${outcomes.basis} With about thirty statements tested at once, expect one or two to look settled by chance.` : null,
    callsBasis: calls.length === 0 ? null : `${founderCalls} ${founderCalls === 1 ? "call" : "calls"} on founders and ${companyCalls} on companies.`,
  };
}
