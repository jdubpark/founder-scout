import { join } from "node:path";
import {
  AGENT_CLASSES, BASE_CONFIG, JOBS, SOURCES, STAGES,
  buildEffectiveSteering, coerceParam, effectiveRoute, getParamDef, isClassId, isJobId,
  isReasonFor, newId, normalizeScope, paramsFor, scopeLabel,
  scopeLevel, suggestSteering, suggestionTextKey, summarizeCalls, swarmIdentity,
  type Agent, type AgentIdentity, type ApiClient,
  type CallExample, type ClassId, type Directive, type DirectiveFilter,
  type DirectiveRow, type EffectiveSteeringQuery, type Evidence, type Feedback,
  type Founder, type NodeHealth, type NodeStats,
  type OutreachRow, type Run, type SettingsPatch,
  type StageId, type Swarm, type TaskRun, type Thesis,
} from "@agentswarm/shared";
import type {
  App, AppOptions, ServiceDeps, Store, SwarmService,
} from "../contracts";
import { ServiceError } from "../contracts";
import { openStore } from "../db";
import { createSimRepoFinder, createSimSources, createSimWorld } from "../sim";
import { createLiveRepoFinder, createLiveSources } from "../sources";
import { createProviderRegistry } from "../providers";
import { createJobRegistry, createExecuteJob, findSensitive, redactSensitive } from "../jobs";
import { createRunController } from "../engine";
import { createEvalService } from "../eval";

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
    return buildEffectiveSteering({
      directives: store.listDirectives(), identity, config, names, label,
      calls: feedbackExamples(swarm.id), now: now(),
    });
  };
  const buildTree = (swarmId: string) => {
    const swarm = getSwarm(swarmId);
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
      return {
        cls, health: worstHealth(enabledJobs.map((node) => node.health)),
        directiveCount: countScope({ classId: cls.id }),
        stats: sumStats(classJobs.map((node) => node.stats)), jobs: classJobs,
      };
    });
    return { swarm, config, swarmDirectiveCount, globalDirectiveCount, classes };
  };

  async function getOverview(swarmId: string) {
    const swarm = getSwarm(swarmId);
    const settings = store.getSettings();
    const allRuns = store.listRuns(swarm.id, 10000).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const latestRun = allRuns.at(-1) ?? null;
    const activeRun = store.activeRun(swarm.id);
    const nextRunAt = settings.schedule.enabled ? deps.cron.next(settings.schedule.cron, settings.schedule.timezone, now()) : null;
    const outreach = store.listOutreach({ swarmId: swarm.id });
    const founderRows = store.founderRows({ swarmId: swarm.id, status: "all", sort: "composite", limit: 500 });
    const founders = founderRows.rows;
    const totalFounderCounts = founderRows.counts;
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
    if (settings.killSwitch) alerts.push({ id: "kill-switch", level: "error", title: "Emergency stop is on", detail: "No new run, task or eval round starts. Turn it off in Settings when it is safe to resume.", at: iso(now()), link: "/settings" });
    if (latestRun?.status === "failed") alerts.push({ id: `run-failed-${latestRun.id}`, level: "error", title: "Latest run failed", detail: latestRun.error ?? "Review the run details and retry when ready.", at: alertAt, link: `/activity/${latestRun.id}` });
    if (latestRun?.status === "budget_stopped") alerts.push({ id: `run-budget-${latestRun.id}`, level: "warning", title: "Latest run reached its spend cap", detail: "Review the run's spend and raise the cap only if the remaining work is worth it.", at: alertAt, link: `/activity/${latestRun.id}` });
    if (latestRun && latestRun.stats.failures > 0) alerts.push({ id: `run-tasks-${latestRun.id}`, level: "warning", title: "Latest run had failed tasks", detail: `${latestRun.stats.failures} task${latestRun.stats.failures === 1 ? "" : "s"} failed. Review the run details.`, at: alertAt, link: `/activity/${latestRun.id}` });
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
      topFounders: founders.filter((row) => row.status === "surfaced").sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1)).slice(0, 12),
      alerts: alerts.sort((a, b) => b.at.localeCompare(a.at)), lastRun: latestRun, activeRun,
      nextRunAt: settings.schedule.enabled ? deps.cron.next(settings.schedule.cron, settings.schedule.timezone, now()) : null,
      classHealth: tree.classes.map((node) => ({ classId: node.cls.id, label: node.cls.label, health: node.health, note: node.health === "planned" ? "No enabled jobs in this class." : node.health === "error" ? "At least one agent is failing repeatedly." : node.health === "warn" ? "Some agent tasks have failed." : node.health === "idle" ? "No recent task activity." : node.health === "paused" ? "Agents in this class are paused." : "Agents are operating normally." })),
      sourceYield,
      spendByClass: AGENT_CLASSES.map((cls) => ({ classId: cls.id, label: cls.label, costUsd: classCosts.get(cls.id) ?? 0 })),
      evalTrend, calls, recentAudit: store.recentAudit(8),
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
        if (patch.dismissedSuggestions !== undefined && !Array.isArray(patch.dismissedSuggestions)) fail(400, "Choose valid dismissed suggestions.", { dismissedSuggestions: "Choose valid suggestion keys." });
        const current = store.getSettings();
        const next = { ...current, ...patch, schedule: { ...current.schedule, ...patch.schedule }, dismissedSuggestions: patch.dismissedSuggestions ? uniqueText(patch.dismissedSuggestions) : current.dismissedSuggestions };
        if (patch.killSwitch !== undefined && typeof patch.killSwitch !== "boolean") fail(400, "Choose whether emergency stop is on or off.", { killSwitch: "Choose on or off." });
        if (patch.operatorName !== undefined) {
          next.operatorName = trimmed(patch.operatorName);
          if (next.operatorName.length < 1 || next.operatorName.length > 60) fail(400, "Enter an operator name from 1 to 60 characters.", { operatorName: "Enter an operator name from 1 to 60 characters." });
        }
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
        return store.founderRows({ ...query, q: query.q?.trim() });
      },
      async getFounder(id) {
        const founder = getFounder(id);
        const evidence = store.listEvidence(id).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
        const tasks = store.listTasks({ founderId: id }).sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")).map(({ trace: _trace, ...task }) => task);
        return { founder, assessment: store.latestAssessment(id), history: store.assessmentHistory(id), evidence, leads: store.listLeads({ founderId: id }), outreach: store.listOutreach({ founderId: id }), feedback: store.listFeedback(id), tasks };
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
        getSwarm(input.swarmId);
        if (input.budgetUsd !== undefined && (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0)) fail(400, "Enter a positive spend cap.", { budgetUsd: "Enter a positive spend cap." });
        if (input.brain !== undefined && input.brain !== "sim" && input.brain !== "live") fail(400, "Choose simulation or live for the run brain.", { brain: "Choose simulation or live." });
        if (input.sources !== undefined && input.sources !== "sim" && input.sources !== "live") fail(400, "Choose simulated or live sources.", { sources: "Choose simulated or live sources." });
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
      async getEvalFlow(id) {
        const flow = await busyAsConflict(() => deps.evals.getFlow(id));
        const swarms = store.listSwarms();
        const used = new Set(swarms.map((swarm) => swarm.configId));
        const promoted = flow.variants.find((variant) => used.has(variant.config.id));
        return { ...flow, promotedVariant: promoted?.id ?? null, variants: flow.variants.map((variant) => variant.id === promoted?.id ? { ...variant, status: "champion" } : variant) };
      },
      async runEvalRounds(id, input) {
        // Emergency stop promises that nothing new starts, and a live eval round spends money like a run does.
        if (store.getSettings().killSwitch) fail(409, "Emergency stop is on. Turn it off in Settings before running an eval round.");
        return busyAsConflict(() => deps.evals.runRounds(id, input));
      },
      async promoteEvalVariant(id, input) {
        const swarm = getSwarm(input.swarmId);
        // The keep rule is the only way a change earns a place, so a reverted round cannot be put into use by hand.
        const flow = await busyAsConflict(() => deps.evals.getFlow(id));
        if (flow.variants.find((variant) => variant.id === input.variant)?.status === "reverted") fail(409, "This round was reverted. Only a round the eval kept can be put into use.");
        const config = await busyAsConflict(() => deps.evals.variantConfig(id, input));
        store.saveConfig(config);
        store.updateSwarm(swarm.id, { configId: config.id, updatedAt: iso(now()) } as never);
        audit(actor, "eval.promote", swarm.id, { flowId: id, variant: input.variant, configId: config.id });
        return config;
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
  const jobs = createJobRegistry();
  const executeJob = createExecuteJob({ jobs, providers });
  const runs = createRunController({ store, jobs, executeJob, sources: { sim: simSources, live: liveSources }, repos: { sim: simRepos, live: liveRepos }, simWorld: world, fundName: options.fundName ?? "the fund", now: options.now, logger: options.logger });
  const evals = createEvalService({ store, jobs, executeJob, flowsDir: options.flowsDir, now: options.now, logger: options.logger });
  const service = createSwarmService({ store, runs, evals, providers, liveSources, cron: options.cron, now: options.now, logger: options.logger });
  return { service, store, providers, close: () => store.close() };
}
