import {
  BASE_CONFIG,
  JOBS,
  RUNNER_JOBS,
  ZERO_TRAIL_STATS,
  checkTurn,
  effectiveParam,
  effectiveRoute,
  newId,
  resolveSteering,
  trailScore,
  waveShares,
  type AddTrailInput,
  type AgentIdentity,
  type FrontierItem,
  type Hunt,
  type HuntDTO,
  type HuntNote,
  type LatestStage,
  type Lead,
  type Pools,
  type SwarmConfig,
  type Trail,
  type TrailStats,
  type UpdateTrailInput,
} from "@agentswarm/shared";
import { findSensitive } from "../jobs";
import type { Store, WebAccess } from "../contracts";
import { ServiceError } from "../contracts";
import { poolsView } from "./pools";

type HuntStore = Pick<Store,
  | "getSwarm"
  | "getConfig"
  | "getSettings"
  | "listAgents"
  | "listDirectives"
  | "activeRun"
  | "getHunt"
  | "saveHunt"
  | "listTrails"
  | "getTrail"
  | "saveTrail"
  | "addFrontier"
  | "listFrontier"
  | "insertHuntNote"
  | "listHuntNotes"
  | "removeHuntNote"
  | "listHuntCalls"
  | "listHuntLeads"
  | "keptByTrail"
  | "getFounder"
  | "transaction"
  | "memberStats"
  | "updateSwarm"
  | "saveConfig"
>;

export interface HuntServiceDeps {
  store: HuntStore;
  defaultPools?: () => Promise<Pools>;
  web?: { sim: WebAccess; live: WebAccess };
  now?: () => Date;
  audit(actor: string, action: string, target: string, detail?: Record<string, unknown>): unknown;
}

const trimmed = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const iso = (date: Date): string => date.toISOString();
const newHuntId = (): string => newId("hnt");
const newTrailId = (): string => newId("trl");
const newFrontierId = (): string => newId("frn");
const newNoteId = (): string => newId("hnn");

function fail(status: number, message: string, fields: Record<string, string> = {}): never {
  throw new ServiceError(status, message, fields);
}

function refusePersonal(text: string, field: string, what: string): void {
  const personal = findSensitive(text);
  if (personal.length) {
    fail(400, `${what} cannot refer to personal attributes (${personal.join(", ")}). Describe the work or the company instead.`, {
      [field]: `Remove the personal detail: ${personal.join(", ")}.`,
    });
  }
}

function requireSwarm(deps: HuntServiceDeps, swarmId: string) {
  const swarm = deps.store.getSwarm(swarmId);
  if (!swarm) fail(404, "Swarm not found.");
  return swarm;
}

function configFor(deps: HuntServiceDeps, swarmId: string): SwarmConfig {
  const swarm = requireSwarm(deps, swarmId);
  return deps.store.getConfig(swarm.configId) ?? BASE_CONFIG;
}

function identityFor(swarmId: string, jobId: "hunt.navigate" | "hunt.look", agentId: string | null): AgentIdentity {
  const job = JOBS.find((item) => item.id === jobId)!;
  return { swarmId, classId: job.classId, jobId, agentId };
}

function resolvedFor(deps: HuntServiceDeps, identity: AgentIdentity) {
  return resolveSteering(deps.store.listDirectives(), identity, (deps.now ?? (() => new Date()))());
}

function param<T>(key: string, resolved: ReturnType<typeof resolveSteering>, config: SwarmConfig, fallback: T): T {
  const value = effectiveParam(key, resolved, config).value;
  return (value === null ? fallback : value) as T;
}

function makeHunt(swarmId: string, at: string): Hunt {
  return { id: newHuntId(), swarmId, turn: 0, looks: 0, createdAt: at, updatedAt: at };
}

function sumStats(trails: readonly Trail[]): TrailStats {
  return trails.reduce<TrailStats>((sum, trail) => ({
    searches: sum.searches + trail.stats.searches,
    pages: sum.pages + trail.stats.pages,
    leads: sum.leads + trail.stats.leads,
    kept: sum.kept + trail.stats.kept,
    dropped: sum.dropped + trail.stats.dropped,
    tooLate: sum.tooLate + trail.stats.tooLate,
    blocked: sum.blocked + trail.stats.blocked,
    costUsd: sum.costUsd + trail.stats.costUsd,
  }), { ...ZERO_TRAIL_STATS });
}

function compareTrails(a: HuntDTO["trails"][number], b: HuntDTO["trails"][number]): number {
  const statusOrder = { open: 0, paused: 1, closed: 2 } as const;
  const byStatus = statusOrder[a.status] - statusOrder[b.status];
  if (byStatus !== 0) return byStatus;
  if (a.status === "open") return b.score - a.score || a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id);
  const atA = a.status === "closed" ? a.closedAt ?? a.openedAt : a.openedAt;
  const atB = b.status === "closed" ? b.closedAt ?? b.openedAt : b.openedAt;
  return atB.localeCompare(atA) || a.id.localeCompare(b.id);
}

/** The Hunt page's view of one swarm's persistent notebook and the current source setup. */
export async function huntView(deps: HuntServiceDeps, swarmId: string): Promise<HuntDTO> {
  const swarm = requireSwarm(deps, swarmId);
  const settings = deps.store.getSettings();
  const mode = settings.schedule.sources;
  const web = deps.web?.[mode];
  const config = configFor(deps, swarmId);

  const swarmResolved = resolvedFor(deps, { swarmId, classId: null, jobId: null, agentId: null });
  const enabled = param("hunt.enabled", swarmResolved, config, true);
  const navigatorAgent = deps.store.listAgents(swarmId).find((agent) => agent.jobId === "hunt.navigate") ?? null;
  const navigatorIdentity = identityFor(swarmId, "hunt.navigate", navigatorAgent?.id ?? null);
  const navigatorResolved = resolvedFor(deps, navigatorIdentity);
  const runnerAgent = deps.store.listAgents(swarmId).find((agent) => agent.jobId === "hunt.look") ?? null;
  const runnerIdentity = identityFor(swarmId, "hunt.look", runnerAgent?.id ?? null);
  const runnerResolved = resolvedFor(deps, runnerIdentity);

  const engines = await Promise.all((web?.engines ?? []).map(async (engine) => {
    try {
      const status = await engine.status();
      return { id: engine.id, label: engine.label, searches: engine.searches, configured: status.configured, detail: status.detail };
    } catch {
      return { id: engine.id, label: engine.label, searches: engine.searches, configured: false, detail: "Status unavailable." };
    }
  }));

  const hunt = deps.store.getHunt(swarmId);
  const trails = hunt ? deps.store.listTrails(hunt.id) : [];
  const queued = hunt ? deps.store.listFrontier(hunt.id, { state: "queued" }) : [];
  const turns = param("hunt.turns", navigatorResolved, config, 4);
  const waveSize = param("hunt.wave_size", runnerResolved, config, 12);
  const maxDepth = param("hunt.max_depth", runnerResolved, config, 2);
  const waveOptions = { size: waveSize, maxDepth };
  const shares = waveShares(trails, queued, waveOptions);
  const trailViews = trails.map((trail) => ({
    ...trail,
    queued: queued.filter((item) => item.trailId === trail.id).length,
    score: trailScore(trail),
    share: shares.get(trail.id) ?? 0,
  })).sort(compareTrails);

  const allCalls = hunt ? deps.store.listHuntCalls(hunt.id) : [];
  const latestCalls = hunt ? deps.store.listHuntCalls(hunt.id, { limit: 100 }) : [];
  const waveGroups = new Map<number, typeof allCalls>();
  for (const call of allCalls) {
    const group = waveGroups.get(call.turn) ?? [];
    group.push(call);
    waveGroups.set(call.turn, group);
  }
  const waves = [...waveGroups.entries()].sort(([a], [b]) => a - b).slice(-30).map(([turn, calls]) => ({
    turn,
    at: calls.reduce((first, call) => call.at < first ? call.at : first, calls[0]!.at),
    calls: calls.length,
    leads: calls.reduce((sum, call) => sum + call.leads, 0),
    costUsd: calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0),
  }));
  // One row for a person, however many pages named them: the sighting that says how far
  // along the company is, else the newest. More are read than shown, so thirty are left.
  const sightings = hunt ? deps.store.listHuntLeads(swarmId, 120) : [];
  const byPerson = new Map<string, Lead>();
  for (const lead of sightings) {
    const key = lead.founderId ?? `${lead.personName.toLowerCase()}\u0000${(lead.companyName ?? "").toLowerCase()}`;
    const shown = byPerson.get(key);
    if (!shown || (!shown.stage && lead.stage)) byPerson.set(key, lead);
  }
  const leads = [...byPerson.values()].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt) || b.id.localeCompare(a.id)).slice(0, 30);
  const finds = leads.map((lead) => {
    const founder = lead.founderId ? deps.store.getFounder(lead.founderId) : null;
    return {
      leadId: lead.id,
      personName: lead.personName,
      companyName: lead.companyName,
      oneLiner: lead.oneLiner,
      sourceRef: lead.sourceRef,
      trailId: lead.trailId ?? null,
      stage: lead.stage ?? null,
      earliness: lead.earliness ?? null,
      founderId: lead.founderId,
      founderStatus: founder?.status ?? null,
      discoveredAt: lead.discoveredAt,
    };
  });
  const runnerPools = (await poolsView({ store: deps.store, now: deps.now ?? (() => new Date()), defaultPools: deps.defaultPools }, swarmId)).pools
    .filter((pool) => (RUNNER_JOBS as readonly string[]).includes(pool.jobId));
  const plantedCalls = allCalls.filter((call) => call.control !== null);

  return {
    swarmId,
    enabled: enabled === true,
    active: deps.store.activeRun(swarmId)?.stage === "hunt",
    turn: hunt?.turn ?? 0,
    navigator: {
      agentId: navigatorAgent?.id ?? null,
      paused: navigatorAgent?.status === "paused",
      route: effectiveRoute("hunt.navigate", navigatorResolved, config),
    },
    runners: runnerPools,
    engines,
    limits: {
      turns,
      waveSize,
      maxDepth,
      budgetShare: param("hunt.budget_share", swarmResolved, config, 0.25),
      latestStage: param<LatestStage>("hunt.latest_stage", swarmResolved, config, "seed"),
      plantedEvery: param("hunt.planted_every", runnerResolved, config, 12),
    },
    totals: sumStats(trails),
    planted: {
      read: plantedCalls.length,
      failed: plantedCalls.filter((call) => call.control === "failed").length,
    },
    trails: trailViews,
    notes: hunt ? deps.store.listHuntNotes(hunt.id, 50) : [],
    calls: latestCalls,
    waves,
    finds,
  };
}

async function currentEngines(deps: HuntServiceDeps): Promise<string[]> {
  const mode = deps.store.getSettings().schedule.sources;
  const configured = await Promise.all((deps.web?.[mode]?.engines ?? []).map(async (engine) => {
    try {
      return (await engine.status()).configured ? engine.id : null;
    } catch {
      return null;
    }
  }));
  return configured.filter((id): id is string => id !== null);
}

function addStarts(deps: HuntServiceDeps, hunt: Hunt, trail: Trail, starts: ReturnType<typeof checkTurn>["open"][number]["starts"], at: string): void {
  const items: FrontierItem[] = starts.map((start) => ({
    id: newFrontierId(),
    huntId: hunt.id,
    trailId: trail.id,
    kind: start.kind,
    target: start.kind === "search" ? start.query : start.url,
    engine: start.kind === "search" ? start.engine : null,
    label: trail.name,
    priority: 1,
    depth: 0,
    from: "person",
    state: "queued",
    addedAt: at,
  }));
  if (items.length) deps.store.addFrontier(items);
}

/** Add a person-authored trail after the same checks the navigator's turn uses. */
export async function addHuntTrail(deps: HuntServiceDeps, actor: string, swarmId: string, input: AddTrailInput): Promise<HuntDTO> {
  requireSwarm(deps, swarmId);
  const name = trimmed(input?.name);
  if (name.length < 1 || name.length > 60) fail(400, "Enter a trail name from 1 to 60 characters.", { name: "Enter a trail name from 1 to 60 characters." });
  const intent = trimmed(input?.intent) || name;
  if (intent.length > 200) fail(400, "Keep the trail intent to 200 characters or fewer.", { intent: "Keep the trail intent to 200 characters or fewer." });
  refusePersonal(name, "name", "A trail name");
  refusePersonal(intent, "intent", "A trail intent");
  for (const search of input?.searches ?? []) {
    if (typeof search?.query === "string") refusePersonal(search.query, "searches", "A trail search");
  }

  const engines = await currentEngines(deps);
  const existingHunt = deps.store.getHunt(swarmId);
  const trails = existingHunt ? deps.store.listTrails(existingHunt.id) : [];
  const plan = checkTurn({
    open: [{ name, intent, searches: input.searches ?? [], pages: input.pages ?? [] }],
    extend: [],
    close: [],
    focus: [],
    notes: [],
    done: false,
  }, trails, {
    engines,
    maxOpenTrails: 8,
    maxStarts: 6,
    maxNotes: 0,
  });
  if (plan.refused.length) {
    const reason = plan.refused.join(" ");
    const field = reason.startsWith("No search engine called")
      ? "searches"
      : reason.startsWith("An address")
        ? "pages"
        : reason.includes("starting points beyond")
          ? (input.searches?.length ?? 0) >= (input.pages?.length ?? 0) ? "searches" : "pages"
          : reason.includes("nowhere to start")
            ? "pages"
            : "name";
    fail(400, reason, { [field]: reason });
  }
  const opened = plan.open[0];
  if (!opened) {
    const reason = "A trail with this name already exists or could not be opened.";
    fail(400, reason, { name: reason });
  }
  if (opened.starts.length === 0) {
    const reason = plan.refused[0] ?? "Choose at least one search or public page to start the trail.";
    fail(400, reason, { searches: reason });
  }

  const at = iso((deps.now ?? (() => new Date()))());
  const hunt = existingHunt ?? makeHunt(swarmId, at);
  const trail: Trail = {
    id: newTrailId(),
    huntId: hunt.id,
    swarmId,
    name: opened.name,
    intent: opened.intent,
    status: "open",
    openedBy: "person",
    weight: 3,
    pinned: false,
    stats: { ...ZERO_TRAIL_STATS },
    openedAt: at,
    closedAt: null,
    closedWhy: null,
  };
  deps.store.transaction(() => {
    if (!existingHunt) deps.store.saveHunt(hunt);
    deps.store.saveTrail(trail);
    addStarts(deps, hunt, trail, opened.starts, at);
  });
  deps.audit(actor, "hunt.trail.add", trail.id, { swarmId, name: trail.name, starts: opened.starts.length });
  return huntView(deps, swarmId);
}

/** Update a trail only when it belongs to this swarm's hunt. */
export async function updateHuntTrail(deps: HuntServiceDeps, actor: string, swarmId: string, trailId: string, input: UpdateTrailInput): Promise<HuntDTO> {
  requireSwarm(deps, swarmId);
  const hunt = deps.store.getHunt(swarmId);
  const trail = deps.store.getTrail(trailId);
  if (!hunt || !trail || trail.huntId !== hunt.id || trail.swarmId !== swarmId) fail(404, "Trail not found.");

  const change: Partial<Trail> = {};
  const at = iso((deps.now ?? (() => new Date()))());
  if (input.status !== undefined && input.status !== trail.status) {
    if (input.status === "open") {
      const openCount = deps.store.listTrails(hunt.id).filter((item) => item.status === "open" && item.id !== trail.id).length;
      if (openCount >= 8) fail(400, "Eight trails are already open. Close one before reopening this trail.", { status: "Eight trails are already open." });
      change.status = "open";
      change.closedAt = null;
      change.closedWhy = null;
    } else if (input.status === "closed") {
      change.status = "closed";
      change.closedAt = at;
      change.closedWhy = "Closed by a person.";
    } else if (input.status === "paused") {
      change.status = "paused";
      change.closedAt = null;
      change.closedWhy = null;
    } else {
      fail(400, "Choose open, paused, or closed.", { status: "Choose open, paused, or closed." });
    }
  }
  if (input.pinned !== undefined) {
    if (typeof input.pinned !== "boolean") fail(400, "Pin must be true or false.", { pinned: "Pin must be true or false." });
    if (input.pinned !== trail.pinned) change.pinned = input.pinned;
  }
  if (input.weight !== undefined) {
    if (!Number.isInteger(input.weight) || input.weight < 1 || input.weight > 5) fail(400, "Trail attention must be a whole number from 1 to 5.", { weight: "Trail attention must be a whole number from 1 to 5." });
    if (input.weight !== trail.weight) change.weight = input.weight;
  }

  const fields = Object.keys(change);
  if (fields.length) {
    deps.store.saveTrail({ ...trail, ...change });
    deps.audit(actor, "hunt.trail.update", trail.id, { swarmId, fields });
  }
  return huntView(deps, swarmId);
}

/** Add a partner's short note to the navigator's notebook. */
export async function addHuntNote(deps: HuntServiceDeps, actor: string, swarmId: string, input: { text: string }): Promise<HuntDTO> {
  requireSwarm(deps, swarmId);
  const text = trimmed(input?.text);
  if (text.length < 1 || text.length > 240) fail(400, "Keep a notebook note to 1 to 240 characters.", { text: "Keep a notebook note to 1 to 240 characters." });
  refusePersonal(text, "text", "A notebook note");
  const at = iso((deps.now ?? (() => new Date()))());
  const existing = deps.store.getHunt(swarmId);
  const hunt = existing ?? makeHunt(swarmId, at);
  const note: HuntNote = { id: newNoteId(), huntId: hunt.id, swarmId, by: "person", text, turn: hunt.turn, createdAt: at };
  deps.store.transaction(() => {
    deps.store.saveHunt({ ...hunt, updatedAt: at });
    deps.store.insertHuntNote(note);
  });
  deps.audit(actor, "hunt.note.add", note.id, { swarmId, turn: note.turn });
  return huntView(deps, swarmId);
}

/** Remove a notebook note only from the requested swarm's hunt. */
export async function removeHuntNote(deps: HuntServiceDeps, actor: string, swarmId: string, noteId: string): Promise<HuntDTO> {
  requireSwarm(deps, swarmId);
  const hunt = deps.store.getHunt(swarmId);
  if (!hunt || !deps.store.listHuntNotes(hunt.id, 1_000_000).some((note) => note.id === noteId && note.swarmId === swarmId)) {
    fail(404, "Notebook note not found.");
  }
  let removed = false;
  deps.store.transaction(() => { removed = deps.store.removeHuntNote(noteId); });
  if (!removed) fail(404, "Notebook note not found.");
  deps.audit(actor, "hunt.note.remove", noteId, { swarmId });
  return huntView(deps, swarmId);
}
