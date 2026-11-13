import { join } from "node:path";
import {
  AGENT_CLASSES, BASE_CONFIG, JOBS, SOURCES, STAGES, runnerPools,
  buildEffectiveSteering, coerceParam, effectiveRoute, getParamDef, isClassId, isCompanyReasonFor, isJobId,
  isNeverFetchUrl, isReasonFor, newId, normalizeCompanyName, normalizeRoundLabel, normalizeScope, overlayConfig, paramsFor, scopeLabel, stageLabel,
  scopeLevel, stableId, suggestSteering, suggestionTextKey, summarizeCalls, swarmIdentity,
  type Agent, type AgentIdentity, type ApiClient, type AddTrailInput, type UpdateTrailInput, type Pools,
  type AddFounderInput, type CallExample, type ClassId, type CoachReport, type CompanyFeedback, type CompanyQuery, type Directive, type DirectiveFilter,
  type DirectiveRow, type EffectiveSteeringQuery, type Evidence, type Feedback,
  type Founder, type FounderRow, type NetworkContact, type NodeHealth, type NodeStats, type ProfileLinks, type CompanyRow,
  type OutreachRow, type Run, type SettingsPatch,
  type StageId, type Swarm, type SwarmConfig, type TaskRun, type Thesis,
} from "@agentswarm/shared";
import type {
  App, AppOptions, ServiceDeps, Store, SwarmService,
} from "../contracts";
import { ServiceError } from "../contracts";
import { openStore } from "../db";
import { createSimRepoFinder, createSimSources, createSimWorld } from "../sim";
import { createLivePeopleLookup, createLiveRepoFinder, createLiveSources, createQuoteChecker, createLiveWebAccess, createModelSearchEngine, createSimWebAccess, looksLikeFounder, parseConnectionsCsv } from "../sources";
import { createProviderRegistry } from "../providers";
import { createJobRegistry, createExecuteJob, findSensitive, redactSensitive } from "../jobs";
import { createRunController } from "../engine";
import { createEvalService } from "../eval";
import { poolsView, rebalancePools, setPool } from "./pools";
import { addHuntNote, addHuntTrail, huntView, removeHuntNote, updateHuntTrail } from "./hunt";
import { getHuntSeat as readHuntSeat, runHuntWave as startHuntWave, takeHuntTurn as applyHuntTurn } from "./seat";
import { assumptionsFor } from "./assumptions";
import { previewConfig } from "./preview";
import { createHuntTrial } from "./hunt-trial";

const iso = (date: Date): string => date.toISOString();
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
function fail(status: number, message: string, fields: Record<string, string> = {}): never {
  throw new ServiceError(status, message, fields);
}
const trimmed = (value: unknown): string => typeof value === "string" ? value.trim() : "";
/**
 * Text that tells the swarm what to look for (a thesis, a focus area, steering) is refused when
 * it states a personal attribute, because the swarm must never select on one.
 */
function refusePersonal(text: string, field: string, what: string): void {
  const personal = findSensitive(text);
  if (personal.length) fail(400, `${what} cannot refer to personal attributes (${personal.join(", ")}). Describe the work or the company instead.`, { [field]: `Remove the personal detail: ${personal.join(", ")}.` });
}
const uniqueText = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
};
const HEALTH_ORDER: Record<NodeHealth, number> = { error: 5, warn: 4, ok: 3, idle: 2, paused: 1, planned: 0 };

function normalizedThesis(thesis: Thesis): Thesis {
  return {
    summary: trimmed(thesis?.summary),
    sectors: uniqueText(thesis?.sectors),
    stages: uniqueText(thesis?.stages),
    geos: uniqueText(thesis?.geos),
    avoid: uniqueText(thesis?.avoid),
  };
}

/** A thesis is what every scout and screener selects on, so it may not state a personal attribute. */
function checkedThesis(input: Thesis): Thesis {
  const thesis = normalizedThesis(input);
  refusePersonal([thesis.summary, ...thesis.sectors, ...thesis.stages, ...thesis.geos, ...thesis.avoid].join(". "), "thesis", "A thesis");
  return thesis;
}

/** Another process (the command line, say) holding an eval is something to retry, not a server fault. */
async function busyAsConflict<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Error && error.name === "EvalBusyError") fail(409, error.message);
    throw error;
  }
}

function sumStats(rows: readonly NodeStats[]): NodeStats {
  return rows.reduce<NodeStats>((sum, row) => ({
    tasks: sum.tasks + row.tasks,
    failures: sum.failures + row.failures,
    costUsd: sum.costUsd + row.costUsd,
    itemsOut: sum.itemsOut + row.itemsOut,
    lastRunAt: !sum.lastRunAt || (row.lastRunAt && row.lastRunAt > sum.lastRunAt) ? row.lastRunAt : sum.lastRunAt,
  }), { tasks: 0, failures: 0, costUsd: 0, itemsOut: 0, lastRunAt: null });
}

function worstHealth(health: readonly NodeHealth[]): NodeHealth {
  return [...health].sort((a, b) => HEALTH_ORDER[b] - HEALTH_ORDER[a])[0] ?? "idle";
}

function emptyStats(): NodeStats {
  return { tasks: 0, failures: 0, costUsd: 0, itemsOut: 0, lastRunAt: null };
}

function statsFromAgent(agent: Agent, byAgent: Map<string, ReturnType<Store["nodeStats"]>[number]>): NodeStats {
  const stat = byAgent.get(agent.id);
  return stat ? { tasks: stat.tasks, failures: stat.failures, costUsd: stat.costUsd, itemsOut: stat.itemsOut, lastRunAt: stat.lastRunAt } : emptyStats();
}

function healthForAgent(agent: Agent, stats: NodeStats): NodeHealth {
  if (agent.status === "paused") return "paused";
  if (stats.tasks > 0 && stats.failures / stats.tasks >= 0.5) return "error";
  if (stats.failures > 0) return "warn";
  return stats.tasks === 0 ? "idle" : "ok";
}

function exactScope(a: Directive["scope"], b: Directive["scope"]): boolean {
  const aa = normalizeScope(a);
  const bb = normalizeScope(b);
  return aa.swarmId === bb.swarmId && aa.classId === bb.classId && aa.jobId === bb.jobId && aa.agentId === bb.agentId;
}

export function createSwarmService(deps: ServiceDeps): SwarmService {
  const store = deps.store;
  const now = deps.now ?? (() => new Date());
  const audit = (actor: string, action: string, target: string, detail: Record<string, unknown> = {}) =>
    store.audit({ actor: trimmed(actor) || "Partner", action, target, detail });
  const poolDeps = { store, now, ...(deps.defaultPools ? { defaultPools: deps.defaultPools } : {}) };
  const huntDeps = {
    store,
    now,
    ...(deps.defaultPools ? { defaultPools: deps.defaultPools } : {}),
    ...(deps.web ? { web: deps.web } : {}),
    audit,
  };
  const seatDeps = { store, runs: deps.runs, ...(deps.web ? { web: deps.web } : {}), now, audit };
  const getSwarm = (id: string): Swarm => {
    const found = store.getSwarm(id);
    if (!found) fail(404, "Swarm not found. Choose a swarm that exists.");
    return found;
  };
  const getAgent = (id: string): Agent => {
    const found = store.getAgent(id);
    if (!found) fail(404, "Agent not found. Choose an agent that exists.");
    return found;
  };
  const getFounder = (id: string): Founder => {
    const found = store.getFounder(id);
    if (!found) fail(404, "Founder not found. Choose a founder that exists.");
    return found;
  };
  const getDirective = (id: string): Directive => {
    const found = store.getDirective(id);
    if (!found) fail(404, "Directive not found. Choose a directive that exists.");
    return found;
  };
  const getRun = (id: string): Run => {
    const found = store.getRun(id);
    if (!found) fail(404, "Run not found. Choose a run that exists.");
    return found;
  };
  const getTask = (id: string, withTrace: boolean): TaskRun => {
    const found = store.getTask(id, { withTrace });
    if (!found) fail(404, "Task not found. Choose a task that exists.");
    return found;
  };
  const ensureEnabledJobAgents = (swarmId: string): void => {
    const existing = new Set(store.listAgents(swarmId).map((agent) => agent.jobId));
    const at = iso(now());
    for (const job of JOBS) {
      if (!job.enabled || existing.has(job.id)) continue;
      store.insertAgent({ id: newId("agt"), swarmId, jobId: job.id, classId: job.classId, name: job.label, status: "active", beat: null, state: {}, createdAt: at });
      existing.add(job.id);
    }
  };
  const founderRow = (founder: Founder): FounderRow => {
    const assessment = store.latestAssessment(founder.id);
    const feedback = store.listFeedback(founder.id).at(-1);
    const evidence = store.listEvidence(founder.id);
    const company = founder.companyId ? store.getCompany(founder.companyId) : null;
    const companyAssessment = company ? store.latestCompanyAssessment(company.id) : null;
    const leadStage = store.listLeads({ founderId: founder.id }).sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt)).find((lead) => lead.stage)?.stage ?? null;
    return {
      id: founder.id, name: founder.name, headline: founder.headline, companyName: company?.name ?? founder.company.name,
      companyOneLiner: company?.oneLiner ?? founder.company.oneLiner,
      sector: company?.sector ?? null,
      stage: normalizeRoundLabel(company?.stage ?? null) ?? normalizeRoundLabel(founder.company.stage) ?? stageLabel(leadStage),
      tagline: company?.tagline?.text ?? null,
      moat: companyAssessment?.brief.moat?.text ?? null,
      status: founder.status, decision: assessment?.decision ?? null, composite: assessment?.composite ?? null,
      cracked: assessment?.cracked ?? null, founderScore: assessment?.founderScore ?? null,
      fit: assessment?.fit ?? founder.fit, coverage: assessment?.coverage ?? null, sources: founder.sources,
      evidenceCount: evidence.filter((item) => item.verification === "unverified" || item.verification === "supported").length,
      flagCount: assessment?.flags.filter((flag) => flag.severity === "warning" || flag.severity === "critical").length ?? 0,
      feedback: feedback?.verdict ?? null, feedbackReasons: feedback?.reasonTags ?? [],
      companyId: founder.companyId ?? null, firstSeenAt: founder.firstSeenAt, updatedAt: founder.updatedAt,
    };
  };
  const withCompanyIds = (rows: FounderRow[]): FounderRow[] => rows.map((row) => {
    const founder = store.getFounder(row.id);
    const company = founder?.companyId ? store.getCompany(founder.companyId) : null;
    const companyAssessment = company ? store.latestCompanyAssessment(company.id) : null;
    const leadStage = founder ? store.listLeads({ founderId: founder.id }).sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt)).find((lead) => lead.stage)?.stage ?? null : null;
    return {
      ...row,
      companyName: company?.name ?? founder?.company.name ?? row.companyName,
      companyId: founder?.companyId ?? null,
      companyOneLiner: company?.oneLiner ?? founder?.company.oneLiner ?? null,
      sector: company?.sector ?? null,
      stage: normalizeRoundLabel(company?.stage ?? null) ?? normalizeRoundLabel(founder?.company.stage ?? null) ?? stageLabel(leadStage),
      tagline: company?.tagline?.text ?? null,
      moat: companyAssessment?.brief.moat?.text ?? null,
    };
  });
  const validateName = (name: unknown, field = "name"): string => {
    const value = trimmed(name);
    if (value.length < 1 || value.length > 80) fail(400, "Enter a name from 1 to 80 characters.", { [field]: "Enter a name from 1 to 80 characters." });
    return value;
  };
  const swarmNames = () => Object.fromEntries(store.listSwarms().map((swarm) => [swarm.id, swarm.name]));
  const agentNames = () => Object.fromEntries(store.listSwarms().flatMap((swarm) => store.listAgents(swarm.id).map((agent) => [agent.id, agent.name] as const)));
  const countScope = (scope: Directive["scope"]) => store.listDirectives().filter((directive) => {
    const candidate = normalizeScope(directive.scope);
    const target = normalizeScope(scope);
    if (target.agentId) return candidate.agentId === target.agentId;
    if (target.jobId) return candidate.jobId === target.jobId && !candidate.agentId;
    if (target.classId) return candidate.classId === target.classId && !candidate.jobId && !candidate.agentId;
    return exactScope(candidate, target);
  }).length;
  const directivesForSwarm = (swarmId: string) => {
    const agentIds = new Set(store.listAgents(swarmId).map((agent) => agent.id));
    return store.listDirectives().filter((directive) => {
      const scope = directive.scope;
      if (scope.agentId) return agentIds.has(scope.agentId);
      if (!scope.swarmId) return true;
      return scope.swarmId === swarmId;
    });
  };
  const latestFeedback = (swarmId: string): Feedback[] => {
    const latest = new Map<string, Feedback>();
    for (const feedback of store.allFeedback(swarmId)) {
      const current = latest.get(feedback.founderId);
      // Store order is oldest first, including insertion order for equal timestamps.
      if (!current || feedback.createdAt >= current.createdAt) latest.set(feedback.founderId, feedback);
    }
    return [...latest.values()];
  };
  const feedbackExamples = (swarmId: string): CallExample[] => {
    const latest = latestFeedback(swarmId);
    return latest.map((feedback) => {
      const founder = store.getFounder(feedback.founderId);
      const secondary = founder?.company.oneLiner ?? founder?.headline;
      const about = founder?.company.name && secondary
        ? `${founder.company.name}: ${secondary}`
        : founder?.company.name ?? secondary ?? founder?.name ?? "Candidate";
      return { verdict: feedback.verdict, about, reasonTags: feedback.reasonTags, note: feedback.note, at: feedback.createdAt };
    });
  };
  const effective = (query: EffectiveSteeringQuery) => {
    const swarm = getSwarm(query.swarmId);
    let identity: AgentIdentity;
    let label = swarm.name;
    if (query.agentId) {
      const agent = getAgent(query.agentId);
      if (agent.swarmId !== swarm.id) fail(404, "That agent is not in this swarm. Choose an agent from this swarm.");
      identity = { swarmId: swarm.id, classId: agent.classId, jobId: agent.jobId, agentId: agent.id };
      label = agent.name;
    } else if (query.jobId) {
      if (!isJobId(query.jobId)) fail(400, "Choose a known job.", { jobId: "Choose a known job." });
      const job = JOBS.find((item) => item.id === query.jobId)!;
      identity = { swarmId: swarm.id, classId: job.classId, jobId: job.id, agentId: null };
      label = job.label;
    } else if (query.classId) {
      if (!isClassId(query.classId)) fail(400, "Choose a known agent class.", { classId: "Choose a known agent class." });
      identity = { swarmId: swarm.id, classId: query.classId, jobId: null, agentId: null };
      label = AGENT_CLASSES.find((item) => item.id === query.classId)!.label;
    } else {
      identity = swarmIdentity(swarm.id);
    }
    const config = store.getConfig(swarm.configId) ?? BASE_CONFIG;
    const names = { swarms: swarmNames(), agents: agentNames() };
    const resolved = buildEffectiveSteering({
      directives: store.listDirectives(), identity, config, names, label,
      calls: feedbackExamples(swarm.id), now: now(),
    });
    return { ...resolved, lessons: identity.jobId ? config.lessons?.[identity.jobId] ?? [] : [] };
  };

  const coachAudits = (swarmId?: string) => store.recentAudit(100_000).filter((entry) =>
    entry.actor === "Swarm" && entry.action === "coach.run" && (swarmId === undefined || entry.target === swarmId),
  );
  const coachReportFrom = (entry: ReturnType<Store["recentAudit"]>[number]): CoachReport | null => {
    const report = entry.detail.report;
    if (!report || typeof report !== "object") return null;
    const candidate = report as CoachReport;
    return typeof candidate.at === "string" && Array.isArray(candidate.flows) ? candidate : null;
  };
  // The overview asks for this on every refresh. The audit log is scanned once per swarm after a
  // restart and the answer is kept; coach() replaces it when it writes a new report.
  const coachReports = new Map<string, CoachReport | null>();
  const latestCoachReport = (swarmId: string): CoachReport | null => {
    if (coachReports.has(swarmId)) return coachReports.get(swarmId) ?? null;
    let latest: CoachReport | null = null;
    for (const entry of coachAudits(swarmId)) {
      latest = coachReportFrom(entry);
      if (latest) break;
    }
    coachReports.set(swarmId, latest);
    return latest;
  };
  /**
   * The swarm's config with one eval variant put into use. Only what the variant changed is
   * carried across: the swarm's config also holds what other evals changed, its pools of agents
   * and its learned lines, and replacing it with the variant's own config would drop them. The
   * starting point is the variant of this flow already in use, or the flow's baseline, so
   * choosing the baseline again takes this flow's changes back out.
   */
  const variantInUse = (flow: Awaited<ReturnType<ServiceDeps["evals"]["getFlow"]>>, swarm: Swarm, variantId: string): SwarmConfig => {
    const target = flow.variants.find((variant) => variant.id === variantId);
    if (!target) fail(404, `Unknown eval variant: ${variantId}`);
    if (target.status === "reverted") fail(409, "This round was reverted. Only a round the eval kept can be put into use.");
    const current = store.getConfig(swarm.configId) ?? BASE_CONFIG;
    const startId = current.applied?.[flow.id];
    const start = flow.variants.find((variant) => variant.id === startId)?.config
      ?? flow.variants.find((variant) => variant.id === "baseline")?.config
      ?? BASE_CONFIG;
    const applied = { ...(current.applied ?? {}) };
    if (target.id === "baseline") delete applied[flow.id];
    else applied[flow.id] = target.id;
    const next: SwarmConfig = {
      ...overlayConfig(start, target.config, current),
      id: stableId("cfg", `${swarm.id}:${flow.id}:${target.id}:${current.id}`),
      label: `${flow.label}, ${target.id}`,
      applied,
    };
    if (Object.keys(applied).length === 0) delete next.applied;
    return next;
  };
  const promoteVariant = async (id: string, input: { variant: string; swarmId: string }, actor: string, action: "eval.promote" | "coach.apply"): Promise<SwarmConfig> => {
    const swarm = getSwarm(input.swarmId);
    const flow = await busyAsConflict(() => deps.evals.getFlow(id));
    const config = variantInUse(flow, swarm, input.variant);
    const at = iso(now());
    store.transaction(() => {
      store.saveConfig(config);
      store.updateSwarm(swarm.id, { configId: config.id, updatedAt: at } as never);
    });
    audit(actor, action, swarm.id, { flowId: id, variant: input.variant, configId: config.id });
    return config;
  };
  const buildTree = (swarmId: string) => {
    const swarm = getSwarm(swarmId);
    ensureEnabledJobAgents(swarm.id);
    const config = store.getConfig(swarm.configId) ?? BASE_CONFIG;
    const statsByAgent = new Map(store.nodeStats(swarm.id, iso(new Date(now().getTime() - 24 * 60 * 60 * 1000))).map((row) => [row.agentId, row]));
    const directives = store.listDirectives();
    const globalDirectiveCount = directives.filter((item) => scopeLevel(item.scope) === "global").length;
    const swarmDirectiveCount = directives.filter((item) => scopeLevel(item.scope) === "swarm" && item.scope.swarmId === swarm.id).length;
    const classes = AGENT_CLASSES.map((cls) => {
      const classJobs = JOBS.filter((job) => job.classId === cls.id).map((job) => {
        const agents = store.listAgents(swarm.id).filter((agent) => agent.jobId === job.id);
        const agentNodes = agents.map((agent) => {
          const stats = statsFromAgent(agent, statsByAgent);
          return { agent, stats, health: healthForAgent(agent, stats), directiveCount: countScope({ swarmId: swarm.id, jobId: job.id, agentId: agent.id }), lastOutput: statsByAgent.get(agent.id)?.lastOutput ?? null };
        });
        const stats = sumStats(agentNodes.map((node) => node.stats));
        const health: NodeHealth = !job.enabled ? "planned" : worstHealth(agentNodes.map((node) => node.health));
        const steering = buildEffectiveSteering({
          directives: directivesForSwarm(swarm.id),
          identity: { swarmId: swarm.id, classId: cls.id, jobId: job.id, agentId: null },
          config, names: { swarms: swarmNames(), agents: agentNames() }, label: job.label, now: now(),
        });
        return {
          job, health, directiveCount: countScope({ jobId: job.id }),
          route: effectiveRoute(job.id, steering.resolved, config), stats, agents: agentNodes,
        };
      });
      const enabledJobs = classJobs.filter((node) => node.job.enabled);
      const stats = sumStats(classJobs.map((node) => node.stats));
      if (cls.id === "company") stats.itemsOut = store.listCompanies({ swarmId: swarm.id }).filter((company) => company.status !== "archived").length;
      return {
        cls, health: worstHealth(enabledJobs.map((node) => node.health)),
        directiveCount: countScope({ classId: cls.id }),
        stats, jobs: classJobs,
      };
    });
    return { swarm, config, swarmDirectiveCount, globalDirectiveCount, classes };
  };

  async function getOverview(swarmId: string) {
    const swarm = getSwarm(swarmId);
    ensureEnabledJobAgents(swarm.id);
    const settings = store.getSettings();
    const allRuns = store.listRuns(swarm.id, 10000).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const latestRun = allRuns.at(-1) ?? null;
    const lastFinishedRun = [...allRuns].reverse().find((run) => run.status !== "queued" && run.status !== "running") ?? null;
    const activeRun = store.activeRun(swarm.id);
    const nextRunAt = settings.schedule.enabled ? deps.cron.next(settings.schedule.cron, settings.schedule.timezone, now()) : null;
    const outreach = store.listOutreach({ swarmId: swarm.id });
    const founderRows = store.founderRows({ swarmId: swarm.id, status: "all", sort: "composite", limit: 500 });
    const founders = founderRows.rows;
    const totalFounderCounts = founderRows.counts;
    const waitingCompanyIds = new Set(store.listCompanies({ swarmId: swarm.id, statuses: ["surfaced"] })
      .filter((company) => store.listCompanyFeedback(company.id).length === 0).map((company) => company.id));
    const waitingCompanies: CompanyRow[] = [];
    let companyOffset = 0;
    let companyTotal = 0;
    do {
      const page = store.companyRows({ swarmId: swarm.id, status: "surfaced", sort: "deal", limit: 500, offset: companyOffset });
      companyTotal = page.total;
      waitingCompanies.push(...page.rows.filter((row) => waitingCompanyIds.has(row.id)));
      companyOffset += page.rows.length;
    } while (waitingCompanies.length < 5 && companyOffset < companyTotal && companyOffset > 0);
    const totals = allRuns.reduce((acc, run) => ({
      leads: acc.leads + run.stats.leads, screenedIn: acc.screenedIn + run.stats.screenedIn,
      investigated: acc.investigated + run.stats.investigated, surfaced: acc.surfaced + run.stats.surfaced,
    }), { leads: 0, screenedIn: 0, investigated: 0, surfaced: 0 });
    const daily = new Map<string, typeof allRuns>();
    for (const run of allRuns) {
      const day = run.startedAt.slice(0, 10);
      const rows = daily.get(day) ?? [];
      rows.push(run); daily.set(day, rows);
    }
    const funnel = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([date, rows]) => rows.reduce((day, run) => ({
      date, leads: day.leads + run.stats.leads, screenedIn: day.screenedIn + run.stats.screenedIn,
      investigated: day.investigated + run.stats.investigated, surfaced: day.surfaced + run.stats.surfaced,
      costUsd: day.costUsd + run.costUsd,
    }), { date, leads: 0, screenedIn: 0, investigated: 0, surfaced: 0, costUsd: 0 }));
    const feedback = latestFeedback(swarm.id);
    const latestByFounder = new Map(feedback.map((item) => [item.founderId, item]));
    const surfacedFounders = store.listFounders({ swarmId: swarm.id }).filter((founder) => store.latestAssessment(founder.id)?.decision === "surface");
    const surfacedLatest = surfacedFounders.map((founder) => latestByFounder.get(founder.id)).filter((value): value is Feedback => Boolean(value));
    const calls = summarizeCalls(feedback, {
      called: surfacedLatest.length,
      yes: surfacedLatest.filter((item) => item.verdict === "yes").length,
      waiting: surfacedFounders.length - surfacedLatest.length,
    });
    const rowsBySource = SOURCES.filter((source) => JOBS.some((job) => job.classId === "scout" && job.source === source.id));
    const leads = store.listLeads({ swarmId: swarm.id });
    const sourceYield = rowsBySource.map((source) => {
      const sourceLeads = leads.filter((lead) => lead.source === source.id);
      const firstSourceByFounder = new Map<string, { at: string; source: string }>();
      for (const lead of leads) if (lead.founderId) {
        const current = firstSourceByFounder.get(lead.founderId);
        if (!current || lead.discoveredAt < current.at) firstSourceByFounder.set(lead.founderId, { at: lead.discoveredAt, source: lead.source });
      }
      const surfaced = new Set(sourceLeads.flatMap((lead) => {
        const founder = lead.founderId ? store.getFounder(lead.founderId) : null;
        return founder?.status === "surfaced" && firstSourceByFounder.get(founder.id)?.source === source.id ? [founder.id] : [];
      }));
      return { source: source.id, label: source.label, leads: sourceLeads.length, surfaced: surfaced.size };
    });
    const spendSince = iso(new Date(now().getTime() - 7 * 24 * 60 * 60 * 1000));
    const taskRows = store.listTasks({ limit: 100000 });
    const classCosts = new Map<ClassId, number>(AGENT_CLASSES.map((cls) => [cls.id, 0]));
    for (const task of taskRows) if (task.swarmId === swarm.id && task.finishedAt && task.finishedAt >= spendSince) {
      classCosts.set(task.classId, (classCosts.get(task.classId) ?? 0) + (task.costUsd ?? 0));
    }
    const alerts: Array<{ id: string; level: "info" | "warning" | "error"; title: string; detail: string; at: string; link: string | null }> = [];
    const alertAt = latestRun?.finishedAt ?? latestRun?.startedAt ?? iso(now());
    const coach = latestCoachReport(swarm.id);
    if (settings.killSwitch) alerts.push({ id: "kill-switch", level: "error", title: "Emergency stop is on", detail: "No new run, task or eval round starts. Turn it off in Settings when it is safe to resume.", at: iso(now()), link: "/settings" });
    const appliedCoachChange = coach?.flows.find((flow) => flow.applied !== null)?.applied;
    const coachAgeMs = coach ? now().getTime() - Date.parse(coach.at) : Number.NaN;
    if (appliedCoachChange && coachAgeMs >= 0 && coachAgeMs <= 48 * 60 * 60 * 1000) {
      alerts.push({ id: "coach-applied", level: "info", title: "The swarm changed its own settings", detail: `${appliedCoachChange}. You can undo it on the Improve page.`, at: coach!.at, link: "/improve" });
    }
    if (latestRun?.status === "failed") alerts.push({ id: `run-failed-${latestRun.id}`, level: "error", title: "Latest run failed", detail: latestRun.error ?? "Review the run details and retry when ready.", at: alertAt, link: `/activity/${latestRun.id}` });
    if (latestRun?.status === "budget_stopped") alerts.push({ id: `run-budget-${latestRun.id}`, level: "warning", title: "Latest run reached its spend cap", detail: "Review the run's spend and raise the cap only if the remaining work is worth it.", at: alertAt, link: `/activity/${latestRun.id}` });
    if (latestRun && latestRun.stats.failures > 0) alerts.push({ id: `run-tasks-${latestRun.id}`, level: "warning", title: "Latest run had failed tasks", detail: `${latestRun.stats.failures} task${latestRun.stats.failures === 1 ? "" : "s"} failed. Review the run details.`, at: alertAt, link: `/activity/${latestRun.id}` });
    if (lastFinishedRun && lastFinishedRun.stats.controlsFailed > 0) {
      const count = lastFinishedRun.stats.controlsFailed;
      alerts.push({ id: "control-failed", level: "warning", title: "The fact-checker failed a planted check", detail: `${count} fact-check call${count === 1 ? "" : "s"} in the last run accepted a made-up claim, so those verdicts were thrown away. Consider using another model for the fact-checker.`, at: lastFinishedRun.finishedAt ?? lastFinishedRun.startedAt, link: "/swarm?node=job:verify.claims" });
    }
    if (settings.schedule.enabled && settings.schedule.sources === "live") {
      const statuses = await deps.liveSources.statuses();
      for (const job of JOBS.filter((item) => item.classId === "scout" && item.enabled && item.source)) {
        const status = statuses.find((item) => item.id === job.source);
        if (!status?.configured) alerts.push({ id: `source-${job.source}`, level: "warning", title: `${status?.label ?? job.source} is not configured`, detail: `The live schedule uses this source, but ${job.label} cannot read it yet. Configure the source before relying on scheduled coverage.`, at: iso(now()), link: "/settings" });
      }
    }
    for (const row of await apiFor("System").listDirectives({ swarmId: swarm.id })) if (row.problem) alerts.push({ id: `directive-${row.id}`, level: "warning", title: "A steering setting is invalid", detail: `${row.scopeLabel}: ${row.problem}`, at: row.updatedAt, link: "/steering" });
    const suggestions = await apiFor("System").listSuggestions(swarm.id);
    if (suggestions.length) alerts.push({ id: "suggestions", level: "info", title: "Steering suggestions are waiting", detail: `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} from partner calls are ready to review.`, at: iso(now()), link: "/steering" });
    for (const action of outreach.filter((item) => item.status === "proposed" && now().getTime() - new Date(item.createdAt).getTime() > 3 * 24 * 60 * 60 * 1000)) alerts.push({ id: `outreach-${action.id}`, level: "warning", title: "Outreach approval is waiting", detail: "This draft has been waiting for more than three days. Approve or reject it from the outreach queue.", at: action.createdAt, link: "/approvals" });
    let evalTrend: Array<{ variant: string; test: number }> = [];
    try {
      const flows = await deps.evals.listFlows();
      if (flows[0]) {
        const flow = await deps.evals.getFlow(flows[0].id);
        // The eval reports its current winner as "champion", so the trend must count it as kept.
        evalTrend = flow.variants.filter((variant) => variant.status !== "reverted")
          .flatMap((variant) => typeof variant.test[flow.headlineMetric] === "number" ? [{ variant: variant.id, test: variant.test[flow.headlineMetric]! }] : []);
      }
    } catch { evalTrend = []; }
    const tree = buildTree(swarm.id);
    return {
      swarm,
      today: {
        leads: latestRun?.stats.leads ?? 0, screenedIn: latestRun?.stats.screenedIn ?? 0,
        investigated: latestRun?.stats.investigated ?? 0, surfaced: latestRun?.stats.surfaced ?? 0,
        pendingApprovals: outreach.filter((item) => item.status === "proposed").length,
        costUsd: latestRun?.costUsd ?? 0, budgetUsd: latestRun?.budgetUsd ?? 0,
      },
      funnel,
      totals: { ...totals, founders: Object.values(totalFounderCounts).reduce((sum, count) => sum + (count ?? 0), 0) },
      topFounders: withCompanyIds(founders).filter((row) => row.status === "surfaced").sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1)).slice(0, 12),
      companiesWaiting: waitingCompanyIds.size,
      topCompanies: waitingCompanies.slice(0, 5),
      alerts: alerts.sort((a, b) => b.at.localeCompare(a.at)), lastRun: latestRun, activeRun,
      nextRunAt: settings.schedule.enabled ? deps.cron.next(settings.schedule.cron, settings.schedule.timezone, now()) : null,
      classHealth: tree.classes.map((node) => ({ classId: node.cls.id, label: node.cls.label, health: node.health, note: node.health === "planned" ? "No enabled jobs in this class." : node.health === "error" ? "At least one agent is failing repeatedly." : node.health === "warn" ? "Some agent tasks have failed." : node.health === "idle" ? "No recent task activity." : node.health === "paused" ? "Agents in this class are paused." : "Agents are operating normally." })),
      sourceYield,
      spendByClass: AGENT_CLASSES.map((cls) => ({ classId: cls.id, label: cls.label, costUsd: classCosts.get(cls.id) ?? 0 })),
      evalTrend, calls, recentAudit: store.recentAudit(8),
      coach,
    };
  }

  function apiFor(actorInput: string): ApiClient {
    const actor = trimmed(actorInput) || "Partner";
    const api: ApiClient = {
      async getSettings() {
        const settings = store.getSettings();
        return { settings, providers: await deps.providers.statuses(), sources: await deps.liveSources.statuses(), nextRunAt: settings.schedule.enabled ? deps.cron.next(settings.schedule.cron, settings.schedule.timezone, now()) : null };
      },
      async updateSettings(patch: SettingsPatch) {
        if (!patch || typeof patch !== "object") fail(400, "Enter settings to update.");
        if (patch.schedule !== undefined && (!patch.schedule || typeof patch.schedule !== "object")) fail(400, "Enter valid schedule settings.", { schedule: "Enter valid schedule settings." });
        if (patch.autopilot !== undefined && (!patch.autopilot || typeof patch.autopilot !== "object" || Array.isArray(patch.autopilot))) fail(400, "Enter valid autopilot settings.", { autopilot: "Enter valid autopilot settings." });
        if (patch.dismissedSuggestions !== undefined && !Array.isArray(patch.dismissedSuggestions)) fail(400, "Choose valid dismissed suggestions.", { dismissedSuggestions: "Choose valid suggestion keys." });
        const current = store.getSettings();
        const next = { ...current, ...patch, schedule: { ...current.schedule, ...patch.schedule }, autopilot: { ...current.autopilot, ...patch.autopilot }, dismissedSuggestions: patch.dismissedSuggestions ? uniqueText(patch.dismissedSuggestions) : current.dismissedSuggestions };
        if (patch.killSwitch !== undefined && typeof patch.killSwitch !== "boolean") fail(400, "Choose whether emergency stop is on or off.", { killSwitch: "Choose on or off." });
        if (patch.operatorName !== undefined) {
          next.operatorName = trimmed(patch.operatorName);
          if (next.operatorName.length < 1 || next.operatorName.length > 60) fail(400, "Enter an operator name from 1 to 60 characters.", { operatorName: "Enter an operator name from 1 to 60 characters." });
        }
        if (patch.autopilot?.mode !== undefined && patch.autopilot.mode !== "off" && patch.autopilot.mode !== "suggest" && patch.autopilot.mode !== "apply") fail(400, "Choose off, suggest or apply for autopilot.", { "autopilot.mode": "Choose off, suggest or apply." });
        if (patch.autopilot?.budgetUsd !== undefined && (!Number.isFinite(patch.autopilot.budgetUsd) || patch.autopilot.budgetUsd < 0 || patch.autopilot.budgetUsd > 1000)) fail(400, "Enter a daily eval budget from 0 to 1000 USD.", { "autopilot.budgetUsd": "Enter 0 to 1000." });
        if (patch.schedule?.enabled !== undefined && typeof patch.schedule.enabled !== "boolean") fail(400, "Choose whether the schedule is enabled.", { "schedule.enabled": "Choose enabled or disabled." });
        if (patch.schedule?.brain !== undefined && patch.schedule.brain !== "sim" && patch.schedule.brain !== "live") fail(400, "Choose a supported run brain.", { "schedule.brain": "Choose simulation or live." });
        if (patch.schedule?.sources !== undefined && patch.schedule.sources !== "sim" && patch.schedule.sources !== "live") fail(400, "Choose a supported source mode.", { "schedule.sources": "Choose simulated or live sources." });
        if (patch.schedule?.cron !== undefined) {
          next.schedule.cron = trimmed(patch.schedule.cron);
          if (!deps.cron.isValid(next.schedule.cron)) fail(400, "Enter a valid five-field cron schedule.", { "schedule.cron": "Enter a valid five-field cron schedule." });
        }
        if (patch.schedule?.timezone !== undefined) {
          next.schedule.timezone = trimmed(patch.schedule.timezone);
          if (!next.schedule.timezone) fail(400, "Enter a time zone for the schedule.", { "schedule.timezone": "Enter a time zone." });
        }
        store.saveSettings(next);
        audit(actor, "settings.update", "settings", { changed: Object.keys(patch) });
        return api.getSettings();
      },
      async listSwarms() { return store.listSwarms(); },
      async createSwarm(input) {
        const name = validateName(input?.name);
        const thesis = checkedThesis(input.thesis);
        refusePersonal(name, "name", "A swarm's name");
        const at = iso(now());
        const swarm: Swarm = { id: newId("swm"), name, status: "active", thesis, configId: BASE_CONFIG.id, createdAt: at, updatedAt: at };
        store.insertSwarm(swarm);
        for (const job of JOBS) store.insertAgent({ id: newId("agt"), swarmId: swarm.id, jobId: job.id, classId: job.classId, name: job.label, status: "active", beat: null, state: {}, createdAt: at });
        audit(actor, "swarm.create", swarm.id, { name });
        return swarm;
      },
      async updateSwarm(id, patch) {
        const swarm = getSwarm(id);
        const change: Partial<Pick<Swarm, "name" | "status" | "thesis">> = {};
        if (patch.name !== undefined) { change.name = validateName(patch.name); refusePersonal(change.name, "name", "A swarm's name"); }
        if (patch.status !== undefined) {
          if (patch.status !== "active" && patch.status !== "paused") fail(400, "Choose active or paused for the swarm status.", { status: "Choose active or paused." });
          change.status = patch.status;
        }
        if (patch.thesis !== undefined) change.thesis = checkedThesis(patch.thesis);
        const updated = store.updateSwarm(swarm.id, { ...change, updatedAt: iso(now()) } as never);
        audit(actor, "swarm.update", id, { fields: Object.keys(change) });
        return updated;
      },
      async getOverview(swarmId) { return getOverview(swarmId); },
      async getTree(swarmId) { return buildTree(swarmId); },
      async addAgent(swarmId, input) {
        const swarm = getSwarm(swarmId);
        if (!isJobId(input?.jobId)) fail(400, "Choose a known job.", { jobId: "Choose a known job." });
        const job = JOBS.find((item) => item.id === input.jobId)!;
        if (job.classId !== "scout") fail(400, "Only scout jobs can be added manually.", { jobId: "Choose a scout job." });
        const existing = store.listAgents(swarm.id).filter((agent) => agent.jobId === job.id);
        const name = input.name === undefined || !trimmed(input.name) ? `${job.label} ${existing.length + 1}` : validateName(input.name);
        const beat = input.beat === undefined || input.beat === null ? null : trimmed(input.beat) || null;
        refusePersonal(name, "name", "An agent's name");
        if (beat) refusePersonal(beat, "beat", "A focus area");
        const agent: Agent = { id: newId("agt"), swarmId: swarm.id, jobId: job.id, classId: job.classId, name, status: "active", beat, state: {}, createdAt: iso(now()) };
        store.insertAgent(agent); audit(actor, "agent.create", agent.id, { swarmId, jobId: job.id }); return agent;
      },
      async updateAgent(agentId, patch) {
        const agent = getAgent(agentId);
        const change: Partial<Pick<Agent, "name" | "status" | "beat">> = {};
        if (patch.name !== undefined) { change.name = validateName(patch.name); refusePersonal(change.name, "name", "An agent's name"); }
        if (patch.status !== undefined) {
          if (patch.status !== "active" && patch.status !== "paused") fail(400, "Choose active or paused for the agent status.", { status: "Choose active or paused." });
          change.status = patch.status;
        }
        if (patch.beat !== undefined) {
          change.beat = patch.beat === null ? null : trimmed(patch.beat) || null;
          if (change.beat) refusePersonal(change.beat, "beat", "A focus area");
        }
        const updated = store.updateAgent(agent.id, change);
        audit(actor, "agent.update", agent.id, { fields: Object.keys(change) }); return updated;
      },
      async listDirectives(filter: DirectiveFilter = {}) {
        const names = { swarms: swarmNames(), agents: agentNames() };
        const usage = store.directiveUsage();
        let rows = store.listDirectives({ includeArchived: filter.status === "archived" });
        if (filter.status) rows = rows.filter((row) => row.status === filter.status);
        if (filter.level) rows = rows.filter((row) => scopeLevel(row.scope) === filter.level);
        if (filter.kind) rows = rows.filter((row) => row.kind === filter.kind);
        if (filter.scope) rows = rows.filter((row) => exactScope(row.scope, filter.scope!));
        if (filter.swarmId) rows = rows.filter((row) => {
          if (row.scope.agentId) return store.getAgent(row.scope.agentId)?.swarmId === filter.swarmId;
          return !row.scope.swarmId || row.scope.swarmId === filter.swarmId;
        });
        return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((row): DirectiveRow => {
          const checked = row.kind === "param" ? coerceParam(row.key ?? "", row.value) : null;
          return { ...row, level: scopeLevel(row.scope), scopeLabel: scopeLabel(row.scope, names), appliedCount: usage.get(row.id)?.appliedCount ?? 0, lastAppliedAt: usage.get(row.id)?.lastAppliedAt ?? null, problem: checked && !checked.ok ? checked.error : null };
        });
      },
      async createDirective(input) {
        if (!input || !input.scope || typeof input.scope !== "object") fail(400, "Choose a valid directive scope.", { scope: "Choose a valid directive scope." });
        const rawScope = input.scope;
        for (const field of ["swarmId", "agentId", "jobId", "classId"] as const) {
          if (rawScope[field] !== undefined && typeof rawScope[field] !== "string") fail(400, "Choose valid identifiers for the directive scope.", { [`scope.${field}`]: "Choose a valid identifier." });
        }
        if (rawScope.swarmId && !store.getSwarm(rawScope.swarmId)) fail(404, "Swarm not found. Choose a swarm that exists.", { "scope.swarmId": "Choose a swarm that exists." });
        if (rawScope.agentId) {
          const agent = store.getAgent(rawScope.agentId);
          if (!agent) fail(404, "Agent not found. Choose an agent that exists.", { "scope.agentId": "Choose an agent that exists." });
          if (rawScope.swarmId && agent.swarmId !== rawScope.swarmId) fail(400, "The agent is not in the selected swarm.", { "scope.agentId": "Choose an agent from the selected swarm." });
        }
        if (rawScope.jobId && !isJobId(rawScope.jobId)) fail(400, "Choose a known job.", { "scope.jobId": "Choose a known job." });
        if (rawScope.classId && !isClassId(rawScope.classId)) fail(400, "Choose a known agent class.", { "scope.classId": "Choose a known agent class." });
        const scope = normalizeScope(rawScope);
        if (!("param" === input.kind || "rule" === input.kind || "opinion" === input.kind || "context" === input.kind)) fail(400, "Choose a valid directive type.", { kind: "Choose a valid directive type." });
        let key: string | null = null; let value: Directive["value"] = null; let text: string | null = null;
        if (input.kind === "param") {
          key = trimmed(input.key);
          if (!key) fail(400, "Choose a setting to change.", { key: "Choose a setting to change." });
          if (!getParamDef(key)) fail(400, "Choose a setting that exists.", { key: "Choose a setting that exists." });
          const identity = identityForScope(scope);
          if (!paramsFor(identity).some((def) => def.key === key)) fail(400, "That setting has no effect at this scope. Choose a setting used by this scope.", { key: "That setting has no effect at this scope." });
          const checked = coerceParam(key, input.value);
          if (!checked.ok) fail(400, checked.error, { value: checked.error });
          value = checked.value;
        } else {
          text = trimmed(input.text);
          if (!text || text.length > 2000) fail(400, "Enter directive text from 1 to 2,000 characters.", { text: "Enter directive text from 1 to 2,000 characters." });
          refusePersonal(text, "text", "Steering");
        }
        if (input.expiresAt != null && trimmed(input.expiresAt) && !Number.isFinite(Date.parse(trimmed(input.expiresAt)))) fail(400, "Enter an expiry date and time.", { expiresAt: "Enter an expiry date and time." });
        if (input.priority !== undefined && !Number.isFinite(input.priority)) fail(400, "Enter a numeric priority.", { priority: "Enter a numeric priority." });
        const at = iso(now());
        const directive: Directive = { id: newId("dir"), scope, kind: input.kind, key, value, text, priority: Number.isFinite(input.priority) ? input.priority! : 0, status: "active", author: actor, note: input.note == null ? null : redactSensitive(trimmed(input.note)) || null, createdAt: at, updatedAt: at, expiresAt: cleanExpiry(input.expiresAt) };
        store.insertDirective(directive); audit(actor, "directive.create", directive.id, { scope, kind: directive.kind, key: directive.key }); return directive;
      },
      async updateDirective(id, patch) {
        const current = getDirective(id);
        const change: Partial<Pick<Directive, "status" | "value" | "text" | "priority" | "note" | "expiresAt">> = {};
        if (patch.status !== undefined) {
          if (!(["active", "paused", "archived"] as string[]).includes(patch.status)) fail(400, "Choose active, paused or archived.", { status: "Choose active, paused or archived." });
          change.status = patch.status;
        }
        if (patch.value !== undefined) {
          if (current.kind !== "param" || !current.key) fail(400, "Only parameter directives have a value.", { value: "This directive has no parameter value." });
          const checked = coerceParam(current.key, patch.value);
          if (!checked.ok) fail(400, checked.error, { value: checked.error });
          change.value = checked.value;
        }
        if (patch.text !== undefined) {
          const text = trimmed(patch.text);
          if (current.kind === "param" || !text || text.length > 2000) fail(400, "Enter directive text from 1 to 2,000 characters.", { text: "Enter directive text from 1 to 2,000 characters." });
          refusePersonal(text, "text", "Steering");
          change.text = text;
        }
        if (patch.priority !== undefined) {
          if (!Number.isFinite(patch.priority)) fail(400, "Enter a numeric priority.", { priority: "Enter a numeric priority." });
          change.priority = patch.priority;
        }
        if (patch.note !== undefined) change.note = patch.note == null ? null : redactSensitive(trimmed(patch.note)) || null;
        if (patch.expiresAt !== undefined) change.expiresAt = cleanExpiry(patch.expiresAt);
        const updated = store.updateDirective(id, { ...change, updatedAt: iso(now()) } as never);
        audit(actor, "directive.update", id, { fields: Object.keys(change) }); return updated;
      },
      async getEffectiveSteering(query) { return effective(query); },
      async listSuggestions(swarmId) {
        getSwarm(swarmId);
        const resolved = effective({ swarmId });
        const current: Record<string, number> = {};
        for (const item of resolved.params) if (typeof item.value === "number") current[item.key] = item.value;
        // Calls made before the partner last changed a setting do not argue for changing it again.
        const settledAt: Record<string, string> = {};
        const agentIds = new Set(store.listAgents(swarmId).map((agent) => agent.id));
        for (const directive of store.listDirectives({ includeArchived: true })) {
          const inSwarm = directive.scope.swarmId === swarmId || (directive.scope.agentId !== undefined && agentIds.has(directive.scope.agentId));
          if (!inSwarm) continue;
          const key = directive.kind === "param" ? directive.key : directive.text ? suggestionTextKey(directive.text) : null;
          if (key && (settledAt[key] === undefined || directive.updatedAt > settledAt[key])) settledAt[key] = directive.updatedAt;
        }
        return suggestSteering(latestFeedback(swarmId), { swarmId, current, dismissed: store.getSettings().dismissedSuggestions, settledAt });
      },
      async dismissSuggestion(swarmId, key) {
        getSwarm(swarmId);
        const cleanKey = trimmed(key);
        if (!cleanKey) fail(400, "Choose a suggestion to dismiss.", { key: "Choose a suggestion to dismiss." });
        const settings = store.getSettings();
        const dismissed = uniqueText([...settings.dismissedSuggestions, cleanKey]);
        store.saveSettings({ ...settings, dismissedSuggestions: dismissed });
        audit(actor, "suggestion.dismiss", cleanKey, { swarmId });
        return api.listSuggestions(swarmId);
      },
      async listFounders(query) {
        if (!query || typeof query.swarmId !== "string") fail(400, "Choose a swarm to list founders.", { swarmId: "Choose a swarm." });
        getSwarm(query.swarmId);
        const statuses = ["all", "lead", "screened_out", "queued", "surfaced", "needs_evidence", "watch", "passed", "contacted", "meeting", "archived"];
        if (query.status !== undefined && !statuses.includes(query.status)) fail(400, "Choose a valid founder status.", { status: "Choose a valid founder status." });
        const result = store.founderRows({ ...query, q: query.q?.trim() });
        return { ...result, rows: withCompanyIds(result.rows) };
      },
      async getFounder(id) {
        const founder = getFounder(id);
        const evidence = store.listEvidence(id).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
        const tasks = store.listTasks({ founderId: id }).sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")).map(({ trace: _trace, ...task }) => task);
        const knownPeople = founder.company.name ? store.networkAtCompany(normalizeCompanyName(founder.company.name)) : [];
        return { founder, company: founder.companyId ? store.getCompany(founder.companyId) : null, assessment: store.latestAssessment(id), history: store.assessmentHistory(id), evidence, leads: store.listLeads({ founderId: id }), outreach: store.listOutreach({ founderId: id }), feedback: store.listFeedback(id), tasks, knownPeople };
      },
      async addFeedback(founderId, input) {
        const founder = getFounder(founderId);
        if (input.verdict !== "yes" && input.verdict !== "no") fail(400, "Choose yes or no.", { verdict: "Choose yes or no." });
        const reasonTags = Array.isArray(input.reasonTags) ? [...new Set(input.reasonTags.filter((tag): tag is string => typeof tag === "string" && isReasonFor(input.verdict, tag)))] : [];
        // A note is shown to the agents as an example, so personal details are taken out of it.
        const note = input.note == null ? null : redactSensitive(trimmed(input.note));
        if (note && note.length > 400) fail(400, "Keep the note to 400 characters or fewer.", { note: "Keep the note to 400 characters or fewer." });
        if (reasonTags.length === 0 && !note) fail(400, "Pick a reason or write one, so the swarm can learn from it.", { reasonTags: "Pick a reason or write one, so the swarm can learn from it." });
        const timestamp = new Date(now().getTime());
        const prior = store.listFeedback(founderId).at(-1);
        if (prior && Date.parse(prior.createdAt) >= timestamp.getTime()) timestamp.setTime(Date.parse(prior.createdAt) + 1);
        const feedback: Feedback = { id: newId("fbk"), founderId, author: actor, verdict: input.verdict, reasonTags, note: note || null, createdAt: iso(timestamp) };
        store.insertFeedback(feedback);
        const status = input.verdict === "no" ? "passed" : founder.status === "surfaced" ? "surfaced" : ["passed", "watch", "needs_evidence"].includes(founder.status) ? "surfaced" : founder.status;
        if (status !== founder.status) store.updateFounder(founderId, { status, updatedAt: iso(now()) });
        audit(actor, "feedback.create", founderId, { verdict: feedback.verdict, reasonTags: feedback.reasonTags }); return feedback;
      },
      async listCompanies(query) {
        if (!query || typeof query.swarmId !== "string") fail(400, "Choose a swarm to list companies.", { swarmId: "Choose a swarm." });
        getSwarm(query.swarmId);
        const statuses = ["all", "tracked", "surfaced", "needs_evidence", "watch", "passed", "archived"];
        if (query.status !== undefined && !statuses.includes(query.status)) fail(400, "Choose a valid company status.", { status: "Choose a valid company status." });
        return store.companyRows({ ...query, q: query.q?.trim() });
      },
      async getCompany(id) {
        const company = store.getCompany(id);
        if (!company) fail(404, "Company not found. Choose a company that exists.");
        const assessment = store.latestCompanyAssessment(id);
        const founders = store.foundersOfCompany(id)
          .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
        if (assessment?.leadFounderId) founders.sort((a, b) => Number(b.id === assessment.leadFounderId) - Number(a.id === assessment.leadFounderId)
          || a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
        const evidence = store.listCompanyEvidence(id).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
        const tasks = store.listTasks({ companyId: id })
          .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))
          .map(({ trace: _trace, ...task }) => task);
        return {
          company, members: store.listCompanyMembers(id), founders: founders.map(founderRow), assessment,
          history: store.companyAssessmentHistory(id), evidence, feedback: store.listCompanyFeedback(id), tasks,
          knownPeople: store.networkAtCompany(normalizeCompanyName(company.name)),
        };
      },
      async addCompanyFeedback(companyId, input) {
        const company = store.getCompany(companyId);
        if (!company) fail(404, "Company not found. Choose a company that exists.");
        if (input.verdict !== "yes" && input.verdict !== "no") fail(400, "Choose yes or no.", { verdict: "Choose yes or no." });
        if (input.reasonTags !== undefined && !Array.isArray(input.reasonTags)) fail(400, "Choose valid reasons for this company.", { reasonTags: "Choose valid reasons for this company." });
        const suppliedTags = input.reasonTags ?? [];
        if (suppliedTags.some((tag) => typeof tag !== "string" || !isCompanyReasonFor(input.verdict, tag))) {
          fail(400, "Choose reasons that match your yes or no call.", { reasonTags: "Choose reasons that match your yes or no call." });
        }
        const reasonTags = [...new Set(suppliedTags)];
        const note = input.note == null ? null : redactSensitive(trimmed(input.note));
        if (note && note.length > 400) fail(400, "Keep the note to 400 characters or fewer.", { note: "Keep the note to 400 characters or fewer." });
        const previous = store.listCompanyFeedback(companyId)[0];
        const timestamp = new Date(now().getTime());
        if (previous && Date.parse(previous.createdAt) >= timestamp.getTime()) timestamp.setTime(Date.parse(previous.createdAt) + 1);
        const feedback: CompanyFeedback = { id: newId("cfb"), companyId, author: actor, verdict: input.verdict, reasonTags, note: note || null, createdAt: iso(timestamp) };
        store.insertCompanyFeedback(feedback);
        store.updateCompany(company.id, { status: input.verdict === "no" ? "passed" : "surfaced", updatedAt: iso(now()) });
        audit(actor, "company_feedback.create", companyId, { verdict: feedback.verdict, reasonTags: feedback.reasonTags });
        return feedback;
      },
      async addFounder(input: AddFounderInput) {
        const swarm = getSwarm(input?.swarmId);
        const name = trimmed(input?.name);
        if (name.length < 1 || name.length > 200) fail(400, "Enter a name from 1 to 200 characters.", { name: "Enter a name from 1 to 200 characters." });
        const checkedAddress = (value: string | null | undefined, field: string): string | null => {
          if (value == null || !trimmed(value)) return null;
          const address = trimmed(value);
          try {
            const parsed = new URL(address);
            if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) throw new Error("invalid address");
          } catch {
            fail(400, "Enter an http or https address.", { [field]: "Enter an http or https address." });
          }
          return address;
        };
        const companyUrl = checkedAddress(input.companyUrl, "companyUrl");
        const link = checkedAddress(input.link, "link");
        const companyName = trimmed(input.companyName) || null;
        const why = trimmed(input.why);
        if (why) refusePersonal(why, "why", "The reason");
        const links: ProfileLinks = { github: null, linkedin: null, x: null, site: null, scholar: null };
        if (link) {
          const host = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
          if (["github.com", "gitlab.com", "codeberg.org", "bitbucket.org"].some((site) => host === site || host.endsWith(`.${site}`))) links.github = link;
          else if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) links.x = link;
          else if (host === "scholar.google.com") links.scholar = link;
          else if (isNeverFetchUrl(link)) links.linkedin = link;
          else links.site = link;
        }
        const id = newId("led");
        const lead = {
          id, swarmId: swarm.id, founderId: null, source: "manual" as const,
          sourceRef: link ?? companyUrl ?? `manual:${id}`, sourceTitle: `Added by ${actor}`,
          personName: name, role: null, companyName, companyUrl, oneLiner: null, links,
          why: why || `Added by ${actor}.`, discoveredByTaskId: null, discoveredAt: iso(now()),
        };
        store.insertLead(lead);
        audit(actor, "founder.add", lead.id, { swarmId: swarm.id, source: "manual" });
        return lead;
      },
      async getNetwork() {
        // These contacts are personal data about people who are not founders; they are shown to the partner who uploaded them and are never placed in a prompt.
        const contacts = store.listNetwork();
        const owners = new Map<string, { owner: string; contacts: number; importedAt: string }>();
        for (const contact of contacts) {
          const row = owners.get(contact.owner);
          if (row) {
            row.contacts++;
            if (contact.importedAt > row.importedAt) row.importedAt = contact.importedAt;
          } else owners.set(contact.owner, { owner: contact.owner, contacts: 1, importedAt: contact.importedAt });
        }
        return { owners: [...owners.values()].sort((a, b) => a.owner.localeCompare(b.owner)), total: contacts.length };
      },
      async importNetwork(input) {
        if (typeof input?.csv !== "string") fail(400, "Choose a connections export to import.", { csv: "Choose a connections export." });
        if (input.csv.length > 8_000_000) fail(400, "The connections export must be 8,000,000 characters or fewer.", { csv: "Choose an export under 8,000,000 characters." });
        let parsed: ReturnType<typeof parseConnectionsCsv>;
        try { parsed = parseConnectionsCsv(input.csv); }
        catch (error) {
          const message = messageOf(error);
          fail(400, message, { csv: message });
        }
        const importedAt = iso(now());
        const contacts: NetworkContact[] = parsed.contacts.map((contact) => {
          const identity = contact.profileUrl?.trim().toLowerCase() || contact.name.trim().toLowerCase();
          const id = stableId("net", `${actor}\0${identity}`);
          // A title or company field is free text someone typed. It passes the same boundary as
          // everything else stored, so a personal detail written there is not kept.
          return {
            ...contact,
            position: contact.position === null ? null : redactSensitive(contact.position),
            company: contact.company === null ? null : redactSensitive(contact.company),
            id, owner: actor, importedAt, previous: null,
          };
        });
        const fresh = store.replaceNetwork(actor, contacts);
        let leadContacts = 0;
        const activeSwarms = store.listSwarms().filter((swarm) => swarm.status === "active");
        for (const contact of fresh) {
          const previous = contact.previous;
          if (!previous || !looksLikeFounder(contact.position)) continue;
          const becameFounder = !looksLikeFounder(previous.position);
          const companyChanged = normalizeCompanyName(previous.company) !== normalizeCompanyName(contact.company);
          if (!becameFounder && !companyChanged) continue;
          let createdForContact = false;
          for (const swarm of activeSwarms) {
            const sourceRef = contact.profileUrl ?? `network:${contact.id}`;
            const duplicate = store.listLeads({ swarmId: swarm.id }).some((lead) => lead.sourceRef === sourceRef && lead.personName === contact.name);
            if (duplicate) continue;
            const links = { github: null, linkedin: contact.profileUrl, x: null, site: null, scholar: null };
            const fromPosition = previous.position || "an unlisted role";
            const fromCompany = previous.company || "an unlisted company";
            const toPosition = contact.position || "an unlisted role";
            const toCompany = contact.company || "an unlisted company";
            const lead = {
              id: newId("led"), swarmId: swarm.id, founderId: null, source: "network" as const,
              // The contact was redacted when it was stored, so these fields are already clean.
              sourceRef, sourceTitle: `Contact list of ${actor}`, personName: contact.name,
              role: contact.position,
              companyName: contact.company, companyUrl: null, oneLiner: null, links,
              why: redactSensitive(`Changed from ${fromPosition} at ${fromCompany} to ${toPosition} at ${toCompany}.`),
              discoveredByTaskId: null, discoveredAt: importedAt,
            };
            store.insertLead(lead);
            createdForContact = true;
          }
          if (createdForContact) leadContacts++;
        }
        const changed = fresh.filter((contact) => contact.previous !== null).length;
        const network = await api.getNetwork();
        audit(actor, "network.import", actor, { imported: fresh.length, changed, leads: leadContacts });
        return { owner: actor, imported: fresh.length, changed, leads: leadContacts, network };
      },
      async removeNetwork(owner) {
        const normalizedOwner = trimmed(owner);
        const removed = store.removeNetwork(normalizedOwner);
        audit(actor, "network.remove", normalizedOwner, { removed });
        return api.getNetwork();
      },
      async listOutreach(query) {
        if (!query || typeof query.swarmId !== "string") fail(400, "Choose a swarm to list outreach.", { swarmId: "Choose a swarm." });
        getSwarm(query.swarmId);
        if (query.status !== undefined && query.status !== "all" && !["proposed", "approved", "rejected", "dispatched", "completed", "failed", "cancelled"].includes(query.status)) fail(400, "Choose a valid outreach status.", { status: "Choose a valid outreach status." });
        const actions = store.listOutreach({ swarmId: query.swarmId, statuses: query.status && query.status !== "all" ? [query.status] : undefined });
        return actions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).flatMap((action): OutreachRow[] => {
          const founder = store.getFounder(action.founderId);
          if (!founder) return [];
          return [{ ...action, founderName: founder.name, founderHeadline: founder.headline, composite: store.latestAssessment(founder.id)?.composite ?? null }];
        });
      },
      async decideOutreach(id, input) {
        const action = store.getOutreach(id);
        if (!action) fail(404, "Outreach action not found. Choose an action that exists.");
        if (action.status !== "proposed") fail(409, "This outreach action has already been decided. Open a proposed action to approve or reject it.");
        if (input.decision !== "approve" && input.decision !== "reject") fail(400, "Choose approve or reject.", { decision: "Choose approve or reject." });
        const at = iso(now());
        // An edited draft and a decision note are stored like any other text, so they pass the same boundary.
        const cleanText = (value: string | null | undefined): string | null => (value == null ? null : redactSensitive(value.trim()));
        const draft = input.decision === "approve" && input.draft ? { ...input.draft, disclosure: action.draft.disclosure, subject: cleanText(input.draft.subject), body: cleanText(input.draft.body), agenda: uniqueText(input.draft.agenda).map(redactSensitive), questions: uniqueText(input.draft.questions).map(redactSensitive) } : action.draft;
        const updated = store.updateOutreach(id, { status: input.decision === "approve" ? "approved" : "rejected", draft, decidedBy: actor, decidedAt: at, decisionNote: input.note == null ? null : redactSensitive(trimmed(input.note)) || null, updatedAt: at });
        audit(actor, "outreach.decide", id, { decision: input.decision, founderId: action.founderId }); return updated;
      },
      async completeOutreach(id, input) {
        const action = store.getOutreach(id);
        if (!action) fail(404, "Outreach action not found. Choose an action that exists.");
        if (action.status !== "approved" && action.status !== "dispatched") fail(409, "Only approved or dispatched outreach can be completed.");
        // Notes from a conversation often carry personal details. They are taken out before anything is stored.
        const summary = redactSensitive(trimmed(input.summary));
        if (!summary) fail(400, "Write a short summary of the outreach.", { summary: "Write a short summary of the outreach." });
        const transcript = input.transcript == null ? "" : redactSensitive(trimmed(input.transcript));
        let evidenceId = action.transcriptEvidenceId;
        if (transcript) {
          const evidenceIdNew = newId("evd");
          const evidence: Evidence = { id: evidenceIdNew, founderId: action.founderId, kind: "call_transcript", source: "call", url: null, title: `Conversation with ${action.target.name}`, excerpt: transcript, claim: "Notes a partner wrote after this conversation.", publishedAt: null, capturedAt: iso(now()), collectedByTaskId: null, hash: `transcript:${evidenceIdNew}`, verification: "unverified", verificationNote: null, sim: null };
          store.insertEvidence(evidence); evidenceId = evidence.id;
        }
        const updated = store.updateOutreach(id, { status: "completed", resultSummary: summary, transcriptEvidenceId: evidenceId, updatedAt: iso(now()) });
        audit(actor, "outreach.complete", id, { founderId: action.founderId, transcriptStored: Boolean(transcript) }); return updated;
      },
      async listRuns(swarmId, limit = 100) {
        getSwarm(swarmId);
        if (!Number.isFinite(limit) || limit < 0) fail(400, "Enter a non-negative run limit.", { limit: "Enter a non-negative run limit." });
        return store.listRuns(swarmId, limit);
      },
      async getRun(id) {
        const run = getRun(id);
        const tasks = store.listTasks({ runId: id });
        const finished = !["queued", "running"].includes(run.status);
        const stageRows = STAGES.map((stage, index) => {
          const stageTasks = tasks.filter((task) => task.stage === stage.id);
          const failures = stageTasks.filter((task) => task.status === "failed").length;
          let state: "pending" | "running" | "done" | "skipped" = "pending";
          if (finished) state = stageTasks.length || stage.id === "plan" || stage.id === "digest" ? "done" : "skipped";
          else if (run.status === "running" && run.stage === stage.id) state = "running";
          else if (run.stage && STAGES.findIndex((item) => item.id === run.stage) > index) state = "done";
          return { stage: stage.id as StageId, label: stage.label, state, tasks: stageTasks.length, failures, costUsd: stageTasks.reduce((sum, task) => sum + (task.costUsd ?? 0), 0) };
        });
        return { run, stages: stageRows, tasks };
      },
      async getTask(id) { return getTask(id, true); },
      async startRun(input) {
        const swarm = getSwarm(input.swarmId);
        if (input.budgetUsd !== undefined && (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0)) fail(400, "Enter a positive spend cap.", { budgetUsd: "Enter a positive spend cap." });
        if (input.brain !== undefined && input.brain !== "sim" && input.brain !== "live") fail(400, "Choose simulation or live for the run brain.", { brain: "Choose simulation or live." });
        if (input.sources !== undefined && input.sources !== "sim" && input.sources !== "live") fail(400, "Choose simulated or live sources.", { sources: "Choose simulated or live sources." });
        ensureEnabledJobAgents(swarm.id);
        try {
          const run = await deps.runs.start({ ...input, trigger: "manual" });
          audit(actor, "run.start", run.id, { swarmId: run.swarmId, trigger: "manual" }); return run;
        } catch (error) {
          if (error instanceof ServiceError) throw error;
          fail(409, `The run could not start: ${messageOf(error)} Check the swarm state and try again.`);
        }
      },
      async cancelRun(id) {
        const current = getRun(id);
        if (current.status !== "queued" && current.status !== "running") fail(409, "This run is already finished and cannot be cancelled.");
        try { const run = await deps.runs.cancel(id); audit(actor, "run.cancel", id, { swarmId: run.swarmId }); return run; }
        catch (error) { if (error instanceof ServiceError) throw error; fail(409, `The run could not be cancelled: ${messageOf(error)} Refresh the run and try again.`); }
      },
      async listEvalFlows() { return busyAsConflict(() => deps.evals.listFlows()); },
      async getEvalFlow(id, swarmId) {
        const flow = await busyAsConflict(() => deps.evals.getFlow(id));
        // A swarm's config records which variant of each flow it carries. Its id says nothing:
        // the config has since gathered pool changes and other evals' changes. The answer is
        // for one swarm: another swarm running a variant does not put it in use here.
        const swarms = store.listSwarms();
        const asked = swarmId ? getSwarm(swarmId) : swarms.length === 1 ? swarms[0] : undefined;
        const carried = asked ? (store.getConfig(asked.configId) ?? BASE_CONFIG).applied?.[flow.id] : undefined;
        const promoted = flow.variants.find((variant) => variant.id === carried);
        return { ...flow, promotedVariant: promoted?.id ?? null, variants: flow.variants.map((variant) => variant.id === promoted?.id ? { ...variant, status: "champion" } : variant) };
      },
      async runEvalRounds(id, input) {
        // Emergency stop promises that nothing new starts, and a live eval round spends money like a run does.
        if (store.getSettings().killSwitch) fail(409, "Emergency stop is on. Turn it off in Settings before running an eval round.");
        return busyAsConflict(() => deps.evals.runRounds(id, input));
      },
      async promoteEvalVariant(id, input) {
        // The eval keep rule is the only way a change earns a place, so a reverted round cannot be put into use by hand.
        return promoteVariant(id, input, actor, "eval.promote");
      },

      async previewEvalVariant(id, input) {
        // The same config a promotion would save, scored against the answers on file. Nothing is saved.
        const swarm = getSwarm(input.swarmId);
        const flow = await busyAsConflict(() => deps.evals.getFlow(id));
        return previewConfig({ store, now }, swarm.id, variantInUse(flow, swarm, input.variant));
      },

      async getAssumptions(swarmId) {
        return assumptionsFor({ store, evals: deps.evals }, swarmId);
      },

      async getHunt(swarmId) {
        return huntView(huntDeps, swarmId);
      },
      async getHuntSeat(swarmId) {
        return readHuntSeat(seatDeps, swarmId);
      },
      async takeHuntTurn(swarmId, turn) {
        return applyHuntTurn(seatDeps, actor, swarmId, turn);
      },
      async runHuntWave(swarmId, input) {
        return startHuntWave(seatDeps, actor, swarmId, input);
      },
      async addHuntTrail(swarmId, input: AddTrailInput) {
        return addHuntTrail(huntDeps, actor, swarmId, input);
      },
      async updateHuntTrail(swarmId, trailId: string, input: UpdateTrailInput) {
        return updateHuntTrail(huntDeps, actor, swarmId, trailId, input);
      },
      async addHuntNote(swarmId, input: { text: string }) {
        return addHuntNote(huntDeps, actor, swarmId, input);
      },
      async removeHuntNote(swarmId, noteId: string) {
        return removeHuntNote(huntDeps, actor, swarmId, noteId);
      },

      async getPools(swarmId) {
        return poolsView(poolDeps, swarmId);
      },
      async setPool(swarmId, jobId, input) {
        const config = setPool({ store, now }, swarmId, jobId, input);
        audit(actor, "pool.set", swarmId, {
          jobId,
          configId: config.id,
          members: input.members.map((member) => ({ id: member.id, model: member.route.model, share: member.share })),
        });
        return poolsView(poolDeps, swarmId);
      },
      async rebalancePools(swarmId, input) {
        const { report, config } = await rebalancePools(poolDeps, swarmId, { apply: input?.apply === true });
        if (config) audit(actor, "pool.rebalance", swarmId, { configId: config.id, pools: report.pools.filter((pool) => pool.changes.length > 0) });
        return report;
      },
    };
    return api;
  }

  function identityForScope(scope: Directive["scope"]): AgentIdentity {
    if (scope.agentId) {
      const agent = getAgent(scope.agentId);
      return { swarmId: agent.swarmId, classId: agent.classId, jobId: agent.jobId, agentId: agent.id };
    }
    if (scope.jobId) {
      const job = JOBS.find((item) => item.id === scope.jobId)!;
      return { swarmId: scope.swarmId ?? "scope", classId: job.classId, jobId: job.id, agentId: null };
    }
    if (scope.classId) return { swarmId: scope.swarmId ?? "scope", classId: scope.classId, jobId: null, agentId: null };
    return swarmIdentity(scope.swarmId ?? "scope");
  }

  function cleanExpiry(value: string | null | undefined): string | null {
    if (value == null || trimmed(value) === "") return null;
    const clean = trimmed(value);
    if (!Number.isFinite(Date.parse(clean))) fail(400, "Enter an expiry date and time.", { expiresAt: "Enter an expiry date and time." });
    return clean;
  }

  // One coaching pass at a time. Each pass reads what has been spent today, runs rounds, and
  // records its own spend at the end; two passes side by side (two swarms finishing a scheduled
  // run together) would both read the same remainder and could each spend all of it.
  let coachTail: Promise<void> = Promise.resolve();
  const service = {
    as: apiFor,
    runs: deps.runs,
    evals: deps.evals,
    async runScheduled(only?: readonly string[]) {
      const settings = store.getSettings();
      if (!settings.schedule.enabled) return [];
      const started: Run[] = [];
      const wanted = only ? new Set(only) : null;
      for (const swarm of store.listSwarms().filter((item) => item.status === "active" && !store.activeRun(item.id) && (wanted === null || wanted.has(item.id)))) {
        try {
          ensureEnabledJobAgents(swarm.id);
          const run = await deps.runs.start({ swarmId: swarm.id, brain: settings.schedule.brain, sources: settings.schedule.sources, trigger: "schedule" });
          audit("Scheduler", "run.start", run.id, { swarmId: swarm.id, trigger: "schedule" });
          started.push(run);
        } catch (error) {
          audit("Scheduler", "run.start_refused", swarm.id, { reason: messageOf(error) });
          deps.logger?.warn("Scheduled swarm run was refused", { swarmId: swarm.id, error: messageOf(error) });
        }
      }
      return started;
    },
    coach(swarmId: string): Promise<CoachReport> {
      const pass = coachTail.then(() => service.coachOnce(swarmId));
      coachTail = pass.then(() => undefined, () => undefined);
      return pass;
    },
    async coachOnce(swarmId: string): Promise<CoachReport> {
      const swarm = getSwarm(swarmId);
      const settings = store.getSettings();
      const at = iso(now());
      const report: CoachReport = { at, mode: settings.autopilot.mode, spentUsd: 0, flows: [] };
      if (settings.killSwitch) {
        report.flows.push({ flowId: "autopilot", label: "Autopilot", rounds: 0, kept: [], applied: null, note: "Emergency stop is on; no eval round was started." });
      } else if (settings.autopilot.mode === "off") {
        report.flows.push({ flowId: "autopilot", label: "Autopilot", rounds: 0, kept: [], applied: null, note: "Autopilot is off." });
      } else {
        const day = at.slice(0, 10);
        const spentToday = coachAudits().reduce((sum, entry) => {
          const previous = coachReportFrom(entry);
          return previous?.at.slice(0, 10) === day && Number.isFinite(previous.spentUsd) && previous.spentUsd >= 0
            ? sum + previous.spentUsd
            : sum;
        }, 0);
        let remainingBudget = Math.max(0, settings.autopilot.budgetUsd - spentToday);
        let appliedThisRun = false;
        let summaries: Awaited<ReturnType<ServiceDeps["evals"]["listFlows"]>> = [];
        try {
          summaries = await deps.evals.listFlows();
        } catch (error) {
          report.flows.push({ flowId: "evals", label: "Evaluations", rounds: 0, kept: [], applied: null, note: messageOf(error) });
          summaries = [];
        }
        for (const summary of summaries) {
          let before;
          try {
            // The service API adds the current promotion state, which raw eval DTOs do not know.
            before = await apiFor("Swarm").getEvalFlow(summary.id, swarm.id);
          } catch (error) {
            report.flows.push({ flowId: summary.id, label: summary.label, rounds: 0, kept: [], applied: null, note: messageOf(error) });
            continue;
          }
          // The flow says for itself whether it has the cases it needs; its note says what is missing.
          if (before.ready === false) {
            report.flows.push({ flowId: summary.id, label: summary.label, rounds: 0, kept: [], applied: null, note: before.dataNote });
            continue;
          }
          // The flow says for itself whether a round calls a model. One that does needs budget left.
          if (remainingBudget <= 0 && before.callsModels === true) {
            report.flows.push({ flowId: summary.id, label: summary.label, rounds: 0, kept: [], applied: null, note: "Today's eval budget is used. Raise it in Settings." });
            continue;
          }
          let after;
          try {
            after = await deps.evals.runRounds(summary.id, { rounds: 1, brain: before.realData ? "live" : "sim", budgetUsd: remainingBudget });
          } catch (error) {
            report.flows.push({ flowId: summary.id, label: summary.label, rounds: 0, kept: [], applied: null, note: messageOf(error) });
            continue;
          }
          const priorStatus = new Map(before.variants.map((variant) => [variant.id, variant.status]));
          const newVariants = after.variants.filter((variant) => !priorStatus.has(variant.id));
          const keptVariants = after.variants.filter((variant) => {
            const newlyKept = variant.status === "kept" || variant.status === "champion";
            const wasKept = priorStatus.get(variant.id) === "kept" || priorStatus.get(variant.id) === "champion";
            return newlyKept && !wasKept;
          });
          // What the round spent, as the flow reports it. A variant's own cost figure is the mean
          // cost of one case, and a baseline that stops part-way has no variant at all.
          const spentOnFlow = typeof after.spentUsd === "number" && Number.isFinite(after.spentUsd) && after.spentUsd > 0 ? after.spentUsd : 0;
          report.spentUsd += spentOnFlow;
          remainingBudget = Math.max(0, remainingBudget - spentOnFlow);
          const flowReport: CoachReport["flows"][number] = {
            flowId: summary.id,
            label: summary.label,
            rounds: Math.max(0, after.rounds - before.rounds),
            kept: keptVariants.flatMap((variant) => variant.changes.length ? variant.changes : [variant.description]),
            applied: null,
            note: null,
          };
          if (settings.autopilot.mode === "suggest") {
            flowReport.note = keptVariants.length
              ? "A partner can promote this change from Improve."
              : flowReport.rounds === 0 ? "No eval round ran within the remaining daily budget." : "No new change was kept by the eval.";
          } else if (after.realData !== true) {
            flowReport.note = keptVariants.length
              ? "Changes measured on simulated data wait for a partner to promote them."
              : flowReport.rounds === 0 ? "No eval round ran within the remaining daily budget." : "No new change was kept by the eval.";
          } else if (!appliedThisRun && after.bestVariant && after.bestVariant !== "baseline" && after.bestVariant !== before.promotedVariant) {
            const bestKept = after.variants.find((variant) => variant.id === after.bestVariant);
            if (!bestKept || (bestKept.status !== "kept" && bestKept.status !== "champion")) {
              flowReport.note = keptVariants.length ? "No newly kept real-data change is ready for automatic promotion." : "No new change was kept by the eval.";
            } else {
              try {
                await promoteVariant(summary.id, { variant: bestKept.id, swarmId: swarm.id }, "Swarm", "coach.apply");
                flowReport.applied = bestKept.changes.join("; ") || bestKept.description;
                flowReport.note = null;
                appliedThisRun = true;
              } catch (error) {
                flowReport.note = messageOf(error);
              }
            }
          } else if (keptVariants.length === 0) {
            flowReport.note = flowReport.rounds === 0
              ? "No eval round ran within the remaining daily budget."
              : "No new change was kept by the eval.";
          } else {
            flowReport.note = appliedThisRun
              ? "A different real-data change was applied this time; this one can be promoted from Improve."
              : "No newly kept real-data change is ready for automatic promotion.";
          }
          report.flows.push(flowReport);
        }
      }
      // Pools of agents: after a run there is new evidence about which member's work held up.
      // In "apply" the shares are moved; in "suggest" the report says what would move.
      if (!settings.killSwitch && settings.autopilot.mode !== "off") {
        try {
          const moved = await rebalancePools(poolDeps, swarm.id, { apply: settings.autopilot.mode === "apply" });
          const changed = moved.report.pools.filter((pool) => pool.changes.length > 0);
          if (changed.length > 0) report.pools = changed;
          if (moved.config) audit("Swarm", "pool.rebalance", swarm.id, { configId: moved.config.id, pools: changed });
        } catch (error) {
          deps.logger?.warn?.("Rebalancing the pools failed", { error: messageOf(error) });
        }
      }
      audit("Swarm", "coach.run", swarm.id, { report });
      coachReports.set(swarm.id, report);
      return report;
    },
    async ensureSeeded() {
      if (store.listSwarms().length) return;
      const system = apiFor("System");
      const swarm = await system.createSwarm({
        name: "AI infrastructure, pre-seed",
        thesis: { summary: "Technical founders building infrastructure and developer tools for AI systems, before or at their first round.", sectors: ["AI infrastructure", "Developer tools", "Applied AI"], stages: ["Pre-seed", "Seed"], geos: [], avoid: [] },
      });
      await system.createDirective({ scope: {}, kind: "rule", text: "Never contact a founder or a reference without an approved outreach item." });
      await system.createDirective({ scope: {}, kind: "rule", text: "Use public, professional information only. Never record age, family, health, or other personal attributes." });
      await system.createDirective({ scope: { swarmId: swarm.id }, kind: "opinion", text: "We care more about what someone has shipped than where they studied or worked." });
    },
    close() { store.close(); },
  };
  // Existing databases may predate newly enabled jobs such as the hunt navigator and runners.
  for (const swarm of store.listSwarms()) ensureEnabledJobAgents(swarm.id);
  return service;
}

export function createApp(options: AppOptions): App {
  const store = openStore(options.dbPath);
  const world = createSimWorld({ seed: options.simSeed });
  const simSources = createSimSources(world);
  const liveSources = createLiveSources(options.env);
  const simRepos = createSimRepoFinder(world);
  const liveRepos = createLiveRepoFinder({ env: options.env, workDir: join(options.dataDir, "repos") });
  const providers = createProviderRegistry(options.env);
  const web = {
    sim: createSimWebAccess(world),
    live: createLiveWebAccess({
      env: options.env,
      extraEngines: (options.env ?? process.env).HUNT_WEB_SEARCH === "off"
        ? []
        : [createModelSearchEngine({ status: () => providers.get("claude-cli").status() })],
    }),
  };
  let defaultPoolsPromise: Promise<Pools> | null = null;
  const defaultPools = (): Promise<Pools> => {
    defaultPoolsPromise ??= providers.statuses().then((statuses) => {
      const configured = new Set(statuses.filter((provider) => provider.configured).map((provider) => provider.id));
      return runnerPools((provider) => configured.has(provider));
    });
    return defaultPoolsPromise;
  };
  const jobs = createJobRegistry();
  const executeJob = createExecuteJob({ jobs, providers });
  const runs = createRunController({ store, jobs, executeJob, quotes: createQuoteChecker(), people: createLivePeopleLookup(options.env ?? process.env), sources: { sim: simSources, live: liveSources }, repos: { sim: simRepos, live: liveRepos }, web, defaultPools, simWorld: world, fundName: options.fundName ?? "the fund", now: options.now, logger: options.logger });
  const evals = createEvalService({
    store,
    jobs,
    executeJob,
    flowsDir: options.flowsDir,
    datasetsDir: options.datasetsDir ?? join(options.flowsDir, "..", "datasets"),
    providers,
    huntTrial: createHuntTrial(options.env),
    sensitive: findSensitive,
    now: options.now,
    logger: options.logger,
  }, { pastJudge: options.evalJudge ?? null });
  const service = createSwarmService({ store, runs, evals, providers, liveSources, web, defaultPools, cron: options.cron, now: options.now, logger: options.logger });
  return { service, store, providers, close: () => store.close() };
}
