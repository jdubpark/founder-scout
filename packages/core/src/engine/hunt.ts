import {
  booleanParam,
  checkPicks,
  checkPerson,
  checkStage,
  checkTurn,
  cleanUrl,
  earliness,
  getJob,
  hostOf,
  isPlantedUrl,
  notesForRunner,
  numberParam,
  planWave,
  plantedDue,
  plantedPage,
  plantedVerdict,
  seedTrails,
  stableId,
  staleTrails,
  stringParam,
  tooLate,
  trailDigest,
  type FrontierItem,
  type Hunt,
  type HuntCall,
  type HuntNote,
  type LatestStage,
  type LookInput,
  type NavigateInput,
  type SiftInput,
  type Trail,
  type TrailStats,
  type WaveDigest,
} from "@agentswarm/shared";
import type { Agent, Lead, ProfileLinks } from "@agentswarm/shared";
import { normalizeName } from "../db";
import { redactSensitive } from "../jobs/common";
import type { PageRead, SearchEngine, SearchHit } from "../contracts";
import { forEachConcurrent, type EngineRuntime } from "./runtime";

/** Pages of one live site read in one wave. The rest of that site's pages wait for a later wave. */
const PAGES_PER_HOST_PER_WAVE = 3;

const ZERO_STATS: TrailStats = { searches: 0, pages: 0, leads: 0, kept: 0, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0 };

function makeNote(runtime: EngineRuntime, hunt: Hunt, by: HuntNote["by"], text: string, turn: number): void {
  const safe = redactSensitive(text).replace(/\s+/g, " ").trim().slice(0, 240);
  if (!safe) return;
  runtime.deps.store.insertHuntNote({
    id: stableId("hnn", `${hunt.id}:${runtime.run.id}:${turn}:${by}:${safe}`),
    huntId: hunt.id,
    swarmId: hunt.swarmId,
    by,
    text: safe,
    turn,
    createdAt: runtime.now().toISOString(),
  });
}

function queueStarts(runtime: EngineRuntime, hunt: Hunt, trailId: string, starts: ReturnType<typeof checkTurn>["open"][number]["starts"], from: FrontierItem["from"]): void {
  const at = runtime.now().toISOString();
  runtime.deps.store.addFrontier(starts.map((start, index) => ({
    id: stableId("frn", `${hunt.id}:${trailId}:${from}:${at}:${index}:${start.kind}:${start.kind === "page" ? start.url : `${start.engine}:${start.query}`}`),
    huntId: hunt.id,
    trailId,
    kind: start.kind,
    target: start.kind === "page" ? start.url : start.query,
    engine: start.kind === "search" ? start.engine : null,
    label: start.kind === "page" ? "Starting page" : "Starting search",
    priority: 1,
    depth: 0,
    from,
    state: "queued",
    addedAt: at,
    runId: runtime.run.id,
  })));
}

function resolvedLatestStage(runtime: EngineRuntime): LatestStage {
  const value = stringParam("hunt.latest_stage", runtime.resolve(null, "hunt.latest_stage"), runtime.config);
  return value === "pre_seed" || value === "seed" || value === "series_a" ? value : "seed";
}

/** One person at one company, as a key. The hunt keeps a person once in a run. */
function personKey(name: string, company: string | null): string {
  return `${normalizeName(name)}\u0000${normalizeName(company ?? "")}`;
}

/** An address in a form two spellings of it share: lower-case host, no fragment, no trailing slash. */
function comparableAddress(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return null;
  }
}

/** Every whole address written out in a page's text, in comparable form. */
function addressesInText(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`)\]}]+/giu)) {
    const address = comparableAddress(match[0].replace(/[.,;:!?]+$/u, ""));
    if (address) found.add(address);
  }
  return found;
}

/**
 * An address a runner reported, if the page really has it: as one of its links, or written
 * out whole in its text. It must be the same address, not the beginning of another: with
 * "https://acme.company/" on the page, "https://acme.com" is not on the page. A runner may not
 * hand the pipeline an address of its own.
 */
function addressOnPage(candidate: string | null, page: PageRead): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  const wanted = comparableAddress(trimmed);
  if (!wanted) return null;
  if (page.links.some((link) => comparableAddress(link.url) === wanted)) return trimmed;
  return addressesInText(page.text).has(wanted) ? trimmed : null;
}

function profileLinksFromPage(links: ProfileLinks, page: PageRead): ProfileLinks {
  const keep = (candidate: string | null): string | null => addressOnPage(candidate, page);
  return {
    github: keep(links.github),
    linkedin: keep(links.linkedin),
    x: keep(links.x),
    site: keep(links.site),
    scholar: keep(links.scholar),
  };
}

function callRecord(
  runtime: EngineRuntime,
  hunt: Hunt,
  input: Omit<HuntCall, "id" | "huntId" | "swarmId" | "runId" | "at">,
): HuntCall {
  const call: HuntCall = {
    id: stableId("hcl", `${runtime.run.id}:${hunt.id}:${input.turn}:${input.tool}:${input.target}:${runtime.now().toISOString()}`),
    huntId: hunt.id,
    swarmId: runtime.swarm.id,
    runId: runtime.run.id,
    at: runtime.now().toISOString(),
    ...input,
  };
  runtime.deps.store.insertHuntCall(call);
  return call;
}

function enqueuePickedPages(
  runtime: EngineRuntime,
  hunt: Hunt,
  trail: Trail,
  picks: ReturnType<typeof checkPicks>,
  urls: readonly string[],
  depth: number,
  from: FrontierItem["from"],
  maxDepth = Number.POSITIVE_INFINITY,
): number {
  if (depth > maxDepth) return 0;
  const at = runtime.now().toISOString();
  const items: FrontierItem[] = [];
  for (const pick of picks) {
    const target = cleanUrl(urls[pick.index] ?? "");
    if (!target) continue;
    items.push({
      id: stableId("frn", `${hunt.id}:${trail.id}:${from}:${target}:${depth}`),
      huntId: hunt.id,
      trailId: trail.id,
      kind: "page",
      target,
      engine: null,
      label: redactSensitive(pick.label).slice(0, 80),
      priority: pick.priority,
      depth,
      from,
      state: "queued",
      addedAt: at,
      runId: runtime.run.id,
    });
  }
  return runtime.deps.store.addFrontier(items).length;
}

function safeHits(hits: readonly SearchHit[]): Array<SearchHit & { cleanUrl: string }> {
  const seen = new Set<string>();
  const result: Array<SearchHit & { cleanUrl: string }> = [];
  for (const hit of hits) {
    const url = cleanUrl(hit.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({ ...hit, cleanUrl: url });
  }
  return result;
}

function shortFound(lead: Lead): string {
  const value = redactSensitive(lead.oneLiner || [lead.role, lead.companyName].filter(Boolean).join(" at ") || lead.personName)
    .replace(/\s+/g, " ").trim();
  return value.length > 100 ? `${value.slice(0, 99)}…` : value;
}

/** Run one persistent hunt notebook between scouting and matching. */
export async function runHunt(runtime: EngineRuntime, simIdsByLead: Map<string, string>): Promise<void> {
  const webAccess = runtime.deps.web?.[runtime.run.sources];
  if (!webAccess || !booleanParam("hunt.enabled", runtime.resolve(null, "hunt.enabled"), runtime.config)) return;

  const navigator = runtime.agents.find((agent) => agent.jobId === "hunt.navigate");
  const looker = runtime.agents.find((agent) => agent.jobId === "hunt.look");
  const sifter = runtime.agents.find((agent) => agent.jobId === "hunt.sift");
  if (!navigator || !looker || !sifter) return;
  const selectedAgents = [navigator, looker, sifter] as const;
  const disabled = selectedAgents.filter((agent) => agent.status === "paused" || !getJob(agent.jobId).enabled);
  if (disabled.length) {
    for (const agent of disabled) {
      if (agent.jobId === "hunt.navigate") {
        const input: NavigateInput = { thesis: runtime.swarm.thesis, brief: { latestStage: "seed", engines: [], waveSize: 0, maxOpenTrails: 8 }, turn: 0, trails: [], notes: [], lastWave: null, budget: { turnsLeft: 0, callsLeft: 0 } };
        await runtime.runJob({ agent, stage: "hunt", jobId: "hunt.navigate", input });
      } else if (agent.jobId === "hunt.look") {
        const input: LookInput = { thesis: runtime.swarm.thesis, intent: "", notes: [], page: { url: "https://invalid.example/", title: "", text: "", links: [] }, latestStage: "seed" };
        await runtime.runJob({ agent, stage: "hunt", jobId: "hunt.look", input });
      } else {
        const input: SiftInput = { thesis: runtime.swarm.thesis, intent: "", notes: [], query: "", hits: [], latestStage: "seed" };
        await runtime.runJob({ agent, stage: "hunt", jobId: "hunt.sift", input });
      }
    }
    return;
  }

  runtime.setStage("hunt");
  const settings = runtime.resolve(null, "hunt.enabled");
  const turnsMax = Math.max(0, Math.floor(numberParam("hunt.turns", runtime.resolve(navigator, "hunt.turns"), runtime.config)));
  const waveSize = Math.max(0, Math.floor(numberParam("hunt.wave_size", runtime.resolve(looker, "hunt.wave_size"), runtime.config)));
  const maxDepth = Math.max(0, Math.floor(numberParam("hunt.max_depth", runtime.resolve(looker, "hunt.max_depth"), runtime.config)));
  const plantedEvery = Math.max(1, Math.floor(numberParam("hunt.planted_every", runtime.resolve(looker, "hunt.planted_every"), runtime.config)));
  const budgetShare = Math.max(0, numberParam("hunt.budget_share", settings, runtime.config));
  const maxSpend = runtime.run.budgetUsd * budgetShare;
  const latestStage = resolvedLatestStage(runtime);
  const engineStatuses = await Promise.all(webAccess.engines.map(async (engine) => {
    try {
      return { engine, status: await engine.status() };
    } catch {
      return { engine, status: { configured: false, detail: "Search engine is unavailable." } };
    }
  }));
  const usable = engineStatuses.filter(({ status }) => status.configured).map(({ engine }) => engine);
  const engineById = new Map<string, SearchEngine>(webAccess.engines.map((engine) => [engine.id, engine]));

  const now = runtime.now().toISOString();
  const storedHunt = runtime.deps.store.getHunt(runtime.swarm.id);
  let hunt: Hunt = storedHunt ?? { id: stableId("hnt", runtime.swarm.id), swarmId: runtime.swarm.id, turn: 0, looks: 0, createdAt: now, updatedAt: now };
  if (!storedHunt) {
    runtime.deps.store.saveHunt(hunt);
  }
  const kept = runtime.deps.store.keptByTrail(hunt.id);
  let trails = runtime.deps.store.listTrails(hunt.id).map((trail) => ({
    ...trail,
    stats: { ...trail.stats, kept: kept.get(trail.id) ?? 0 },
  }));
  for (const trail of trails) runtime.deps.store.saveTrail(trail);
  if (!trails.some((trail) => trail.status === "open")) {
    const seeds = seedTrails(runtime.swarm.thesis, usable.map((engine) => engine.id), now.slice(0, 10));
    for (const [index, seed] of seeds.entries()) {
      const trailId = stableId("trl", `${hunt.id}:seed:${index}:${seed.name}:${runtime.run.id}`);
      const trail: Trail = {
        id: trailId,
        huntId: hunt.id,
        swarmId: hunt.swarmId,
        name: redactSensitive(seed.name).slice(0, 60),
        intent: redactSensitive(seed.intent).slice(0, 200),
        status: "open",
        openedBy: "code",
        weight: 3,
        pinned: false,
        stats: { ...ZERO_STATS },
        openedAt: now,
        closedAt: null,
        closedWhy: null,
      };
      runtime.deps.store.saveTrail(trail);
      queueStarts(runtime, hunt, trail.id, seed.starts, "code");
      trails.push(trail);
    }
  }

  let ownSpend = 0;
  let failedTurns = 0;
  let lastWave: WaveDigest | null = null;
  // People kept in this run, so the same person on two pages is one lead.
  const keptThisRun = new Set<string>();
  // Hosts that asked for a pause. They are left alone for the rest of the run, not just the wave.
  const pausedHosts = new Set<string>();

  /*
   * The stage may spend its share of the run's cap. A call's cost is known only when it
   * returns, so each call is given an allowance before it starts and held to it: the navigator,
   * which runs alone, may take what is free; a runner takes an equal part of what is free for
   * each call that could still start beside it. Allowances in flight never add up to more than
   * what is left, and each is passed to the call as its own cap, so the share cannot be
   * overspent where the provider enforces a cap. A call is not started with less room than a
   * call of its kind has needed so far: it would only be cut off.
   */
  const taskCap = {
    navigator: numberParam("budget.task_usd", runtime.resolve(navigator, "budget.task_usd"), runtime.config),
    runner: numberParam("budget.task_usd", runtime.resolve(looker, "budget.task_usd"), runtime.config),
  };
  const seenCost = { navigator: 0, runner: 0 };
  let held = 0;
  let inFlight = 0;
  const typical = (kind: "navigator" | "runner") => Math.max(seenCost[kind], kind === "navigator" ? 0.01 : 0.0005);
  const canStart = () => !runtime.stopped() && ownSpend + held < maxSpend;
  const reserve = (kind: "navigator" | "runner"): number | null => {
    if (!canStart()) return null;
    const free = maxSpend - ownSpend - held;
    const need = typical(kind);
    if (free < need) return null;
    // As many calls beside this one as could really start: no more than the money allows.
    const beside = kind === "navigator" ? 1 : Math.max(1, Math.min(runtime.concurrency - inFlight, Math.floor(free / need)));
    const allowance = Math.min(taskCap[kind], free / beside);
    held += allowance;
    inFlight += 1;
    return allowance;
  };
  const waiting: Array<() => void> = [];
  const release = (kind: "navigator" | "runner", allowance: number, taskCost: number | null): void => {
    held = Math.max(0, held - allowance);
    inFlight = Math.max(0, inFlight - 1);
    ownSpend += taskCost ?? 0;
    if (taskCost !== null && taskCost > seenCost[kind]) seenCost[kind] = taskCost;
    for (const wake of waiting.splice(0)) wake();
  };
  /**
   * One model call inside its allowance. When there is no room because other calls are
   * holding it, this waits for one of them to finish: only when nothing is in flight and there
   * is still no room is the money really gone, and then it returns "spent". The allowance is
   * given back whatever happens, including a call that throws.
   */
  const withinBudget = async <T extends { task: { costUsd: number | null } }>(
    kind: "navigator" | "runner",
    call: (allowance: number) => Promise<T | null>,
  ): Promise<T | null | "spent"> => {
    let allowance = reserve(kind);
    while (allowance === null) {
      if (inFlight === 0 || runtime.stopped()) return "spent";
      await new Promise<void>((resolve) => waiting.push(resolve));
      allowance = reserve(kind);
    }
    let cost: number | null = null;
    try {
      const result = await call(allowance);
      cost = result?.task.costUsd ?? null;
      return result;
    } finally {
      release(kind, allowance, cost);
    }
  };

  for (let turnIndex = 0; turnIndex < turnsMax && canStart(); turnIndex += 1) {
    if (runtime.stopped()) break;
    const frontier = runtime.deps.store.listFrontier(hunt.id);
    trails = runtime.deps.store.listTrails(hunt.id);
    const notes = runtime.deps.store.listHuntNotes(hunt.id, 12);
    const input: NavigateInput = {
      thesis: runtime.swarm.thesis,
      brief: { latestStage, engines: usable.map((engine) => ({ id: engine.id, label: engine.label, searches: engine.searches })), waveSize, maxOpenTrails: 8 },
      turn: hunt.turn + 1,
      trails: [...trails.filter((trail) => trail.status === "open" || trail.status === "paused"), ...trails.filter((trail) => trail.status === "closed").sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")).slice(0, 5)]
        .map((trail) => trailDigest(trail, frontier.filter((item) => item.trailId === trail.id && item.state === "queued").length)),
      notes: notes.map(({ by, text }) => ({ by, text })),
      lastWave,
      budget: {
        turnsLeft: Math.max(0, turnsMax - turnIndex),
        // Waves left times their size, or what the money left would buy at what a runner call has cost.
        callsLeft: Math.max(0, Math.min((turnsMax - turnIndex) * waveSize, Math.floor(Math.max(0, maxSpend - ownSpend) / typical("runner")))),
      },
    };
    const navResult = await withinBudget("navigator", (allowance) =>
      runtime.runJob({ agent: navigator, stage: "hunt", jobId: "hunt.navigate", input, maxBudgetUsd: allowance }));
    if (navResult === "spent" || !navResult) break;
    const failed = navResult.task.status !== "succeeded" || !navResult.output;
    let plan: ReturnType<typeof checkTurn> = { open: [], extend: [], close: [], focus: [], notes: [], done: false, refused: [] };
    let openedOrExtended = false;
    if (failed) {
      failedTurns += 1;
    } else {
      failedTurns = 0;
      // The call took seconds, and a person may have pinned, paused or closed a trail meanwhile.
      // The request is checked against the trails as they are now, and each change is made to
      // the record as it is now, so the navigator never undoes what a person did.
      const current = () => runtime.deps.store.listTrails(hunt.id);
      plan = checkTurn(navResult.output!, current(), { engines: usable.map((engine) => engine.id), maxOpenTrails: 8, maxStarts: 6, maxNotes: 3 });
      for (const item of plan.close) {
        const trail = runtime.deps.store.getTrail(item.trailId);
        if (!trail || trail.pinned || trail.status !== "open") continue;
        runtime.deps.store.saveTrail({ ...trail, status: "closed", closedAt: runtime.now().toISOString(), closedWhy: redactSensitive(item.why) });
      }
      for (const item of plan.open) {
        const trailId = stableId("trl", `${hunt.id}:nav:${hunt.turn + 1}:${item.name}`);
        const trail: Trail = {
          id: trailId,
          huntId: hunt.id,
          swarmId: hunt.swarmId,
          name: redactSensitive(item.name).slice(0, 60),
          intent: redactSensitive(item.intent).slice(0, 200),
          status: "open",
          openedBy: "navigator",
          weight: 3,
          pinned: false,
          stats: { ...ZERO_STATS },
          openedAt: runtime.now().toISOString(),
          closedAt: null,
          closedWhy: null,
        };
        runtime.deps.store.saveTrail(trail);
        queueStarts(runtime, hunt, trail.id, item.starts, "navigator");
        openedOrExtended = true;
      }
      for (const item of plan.extend) {
        if (runtime.deps.store.getTrail(item.trailId)?.status !== "open") continue;
        queueStarts(runtime, hunt, item.trailId, item.starts, "navigator");
        openedOrExtended = true;
      }
      for (const item of plan.focus) {
        const trail = runtime.deps.store.getTrail(item.trailId);
        if (trail && trail.status === "open") runtime.deps.store.saveTrail({ ...trail, weight: item.weight });
      }
      for (const text of plan.notes) makeNote(runtime, hunt, "navigator", text, hunt.turn + 1);
      hunt = { ...hunt, turn: hunt.turn + 1, updatedAt: runtime.now().toISOString() };
    }

    for (const stale of staleTrails(runtime.deps.store.listTrails(hunt.id))) {
      const why = `Read ${stale.stats.pages} pages and found nobody.`;
      runtime.deps.store.saveTrail({ ...stale, status: "closed", closedAt: runtime.now().toISOString(), closedWhy: why });
      makeNote(runtime, hunt, "code", `${stale.name}: ${why}`, hunt.turn);
    }
    runtime.deps.store.saveHunt(hunt);

    if (failedTurns >= 2) break;
    const currentTrails = runtime.deps.store.listTrails(hunt.id);
    const queued = runtime.deps.store.listFrontier(hunt.id, { state: "queued" });
    // No more than a few pages of one real site in a wave, however good its trail is. The
    // simulated web is one made-up host, with nobody to be considerate of.
    const perHost = runtime.run.sources === "live" ? PAGES_PER_HOST_PER_WAVE : Number.POSITIVE_INFINITY;
    // Pages of a host that asked for a pause, and pages beyond a host's limit, are left out
    // before the wave is chosen, so what is eligible behind them fills the wave. Choosing first
    // and removing after would leave a wave empty while there was work to do.
    const setAside = new Set<string>();
    for (const item of queued) {
      if (item.kind === "page" && pausedHosts.has(hostOf(item.target) ?? "")) setAside.add(item.id);
    }
    let wave: FrontierItem[] = [];
    for (let pass = 0; pass < 6; pass += 1) {
      wave = planWave(currentTrails, queued.filter((item) => !setAside.has(item.id)), { size: waveSize, maxDepth });
      const hostCounts = new Map<string, number>();
      const over = wave.filter((item) => {
        if (item.kind !== "page") return false;
        const host = hostOf(item.target) ?? "";
        const count = hostCounts.get(host) ?? 0;
        hostCounts.set(host, count + 1);
        return count >= perHost;
      });
      if (!over.length) break;
      for (const item of over) setAside.add(item.id);
      // After the last pass whatever is still over the limit is dropped from this wave.
      if (pass === 5) wave = wave.filter((item) => !setAside.has(item.id));
    }
    let pagesRead = 0;
    let leadsKept = 0;
    let waveCalls = 0;
    let waveTooLate = 0;
    let waveBlocked = 0;
    const byTrail = new Map<string, { calls: number; leads: number; found: string[] }>();
    const newRefused: string[] = [];
    let stopWave = false;
    const hostTails = new Map<string, Promise<void>>();
    let nextLookOrdinal = hunt.looks;

    const recordTrailCall = (trailId: string, tool: HuntCall["tool"], target: string, taskId: string | null, result: HuntCall["result"], detail: string | null, values: Partial<Pick<HuntCall, "leads" | "dropped" | "tooLate" | "queued" | "control" | "model" | "costUsd" | "latencyMs">> = {}) => {
      const host = tool === "look" ? hostOf(target) : null;
      callRecord(runtime, hunt, { taskId, trailId, turn: hunt.turn, tool, target, host, result, detail, leads: 0, dropped: 0, tooLate: 0, queued: 0, control: null, model: null, costUsd: null, latencyMs: null, ...values });
      waveCalls += 1;
      const summary = trailId ? (byTrail.get(trailId) ?? { calls: 0, leads: 0, found: [] }) : null;
      if (summary && trailId) { summary.calls += 1; summary.leads += values.leads ?? 0; byTrail.set(trailId, summary); }
    };

    const lockHost = async (host: string): Promise<(() => void) | null> => {
      const previous = hostTails.get(host) ?? Promise.resolve();
      let unlock!: () => void;
      const current = new Promise<void>((resolve) => { unlock = resolve; });
      hostTails.set(host, previous.then(() => current));
      await previous;
      if (pausedHosts.has(host)) { unlock(); return null; }
      return unlock;
    };

    const readPage = async (url: string, host: string): Promise<PageRead> => {
      let response: PageRead;
      try {
        response = await webAccess.reader.read(url, { simDay: runtime.run.simDay, signal: runtime.signal });
      } catch (error) {
        response = { status: "unreachable", detail: error instanceof Error ? redactSensitive(error.message) : "The page could not be read.", url, title: "", text: "", links: [] };
      }
      if (response.status !== "ok" && /pause|slow down|try again later|rate limit/i.test(response.detail)) pausedHosts.add(host);
      return response;
    };

    await forEachConcurrent(wave, runtime.concurrency, () => runtime.stopped() || stopWave, async (planned) => {
      if (stopWave || runtime.stopped() || !canStart()) return;
      // The wave was chosen a moment ago. Since then the item may have been done, or moved to
      // another trail because that trail asked for it and its first trail was closed. It is
      // worked on as it is stored now. One whose trail is not open is left waiting, not marked:
      // the trail may be reopened, or another trail may ask for it.
      const item = runtime.deps.store.getFrontierItem(planned.id);
      if (!item || item.state !== "queued") return;
      const trail = runtime.deps.store.getTrail(item.trailId);
      if (!trail || trail.status !== "open") return;
      const trailNow = runtime.deps.store.getTrail(trail.id) ?? trail;
      if (item.kind === "search") {
        const engine = item.engine ? engineById.get(item.engine) : undefined;
        const engineStatus = engine ? engineStatuses.find((entry) => entry.engine.id === engine.id)?.status : null;
        if (!engine || !engineStatus?.configured) {
          runtime.deps.store.setFrontierState(item.id, "skipped");
          runtime.deps.store.saveTrail({ ...trailNow, stats: { ...trailNow.stats, searches: trailNow.stats.searches + 1, blocked: trailNow.stats.blocked + 1 } });
          recordTrailCall(trail.id, "search", item.target, null, "blocked", "No such search engine.");
          waveBlocked += 1;
          return;
        }
        let hits: SearchHit[];
        try {
          hits = await engine.search(item.target, 10, { simDay: runtime.run.simDay, signal: runtime.signal });
        } catch (error) {
          runtime.deps.store.setFrontierState(item.id, "done", { at: runtime.now().toISOString(), runId: runtime.run.id });
          const detail = error instanceof Error ? redactSensitive(error.message) : "Search failed.";
          const afterSearch = runtime.deps.store.getTrail(trail.id) ?? trailNow;
          runtime.deps.store.saveTrail({ ...afterSearch, stats: { ...afterSearch.stats, searches: afterSearch.stats.searches + 1, blocked: afterSearch.stats.blocked + 1 } });
          recordTrailCall(trail.id, "search", item.target, null, "blocked", detail);
          waveBlocked += 1;
          return;
        }
        runtime.deps.store.setFrontierState(item.id, "done", { at: runtime.now().toISOString(), runId: runtime.run.id });
        const safe = safeHits(hits);
        let added = 0;
        let taskId: string | null = null;
        let result: HuntCall["result"] = "empty";
        let taskFields: Partial<Pick<HuntCall, "model" | "costUsd" | "latencyMs">> = {};
        let detail: string | null = null;
        if (safe.length) {
          const siftInput = {
            thesis: runtime.swarm.thesis,
            intent: trail.intent,
            notes: notesForRunner(runtime.deps.store.listHuntNotes(hunt.id, 10000)),
            query: item.target,
            hits: safe.map((hit, index) => ({ index, url: hit.cleanUrl, title: hit.title, snippet: hit.snippet })),
            latestStage,
          };
          const siftResult = await withinBudget("runner", (allowance) =>
            runtime.runJob({ agent: sifter, stage: "hunt", jobId: "hunt.sift", input: siftInput, routeKey: item.target, maxBudgetUsd: allowance }));
          if (siftResult === "spent" || !siftResult) { runtime.deps.store.setFrontierState(item.id, "queued"); stopWave = true; return; }
          taskId = siftResult.task.id;
          taskFields = { model: siftResult.task.model, costUsd: siftResult.task.costUsd, latencyMs: siftResult.task.latencyMs };
          if (siftResult.task.status !== "succeeded" || !siftResult.output) {
            result = "failed";
            detail = siftResult.task.error;
          } else {
            const picks = checkPicks(siftResult.output.open, safe.length, 6);
            added = enqueuePickedPages(runtime, hunt, trailNow, picks, safe.map((hit) => hit.cleanUrl), 0, "runner");
            result = added > 0 ? "ok" : "empty";
          }
        }
        const cost = taskFields.costUsd ?? 0;
        const latest = runtime.deps.store.getTrail(trail.id) ?? trailNow;
        runtime.deps.store.saveTrail({ ...latest, stats: { ...latest.stats, searches: latest.stats.searches + 1, costUsd: latest.stats.costUsd + cost } });
        recordTrailCall(trail.id, "search", item.target, taskId, result, detail, { queued: added, ...taskFields });
        return;
      }

      const target = cleanUrl(item.target);
      if (!target) {
        runtime.deps.store.setFrontierState(item.id, "skipped");
        newRefused.push("An address that is not a public web page.");
        return;
      }
      let trailDropped = 0;
      let trailTooLate = 0;
      let queuedCount = 0;
      let itemLeads = 0;
      let detail: string | null = null;
      let taskId: string | null = null;
      let taskMeta: Partial<Pick<HuntCall, "model" | "costUsd" | "latencyMs">> = {};
      let result: HuntCall["result"] = "empty";
      const host = hostOf(target);
      if (!host) { runtime.deps.store.setFrontierState(item.id, "skipped"); return; }
      const unlockHost = await lockHost(host);
      if (!unlockHost) { runtime.deps.store.setFrontierState(item.id, "queued"); return; }
      let page: PageRead;
      try {
        const lookOrdinal = nextLookOrdinal++;
        if (plantedDue(lookOrdinal, plantedEvery)) {
          const plant = plantedPage(`${hunt.id}:${lookOrdinal}:${runtime.run.id}:${item.id}`);
          const plantInput: LookInput = { thesis: runtime.swarm.thesis, intent: trail.intent, notes: notesForRunner(runtime.deps.store.listHuntNotes(hunt.id, 10000)), page: plant.page, latestStage };
          const planted = await withinBudget("runner", (allowance) =>
            runtime.runJob({ agent: looker, stage: "hunt", jobId: "hunt.look", input: plantInput, routeKey: plant.page.url, maxBudgetUsd: allowance }));
          if (planted === "spent" || !planted) { stopWave = true; return; }
          hunt = { ...hunt, looks: hunt.looks + 1, updatedAt: runtime.now().toISOString() };
          const control = planted.task.status === "succeeded" && planted.output ? plantedVerdict(planted.output) : null;
          runtime.deps.store.updateTask(planted.task.id, { control });
          callRecord(runtime, hunt, {
            taskId: planted.task.id,
            trailId: null,
            turn: hunt.turn,
            tool: "look",
            target: plant.page.url,
            host: hostOf(plant.page.url),
            result: planted.task.status !== "succeeded" || !planted.output ? "failed" : planted.output.people.length ? "ok" : "empty",
            detail: planted.task.error,
            leads: 0,
            dropped: 0,
            tooLate: 0,
            queued: 0,
            control,
            model: planted.task.model,
            costUsd: planted.task.costUsd,
            latencyMs: planted.task.latencyMs,
          });
          waveCalls += 1;
        }
        page = await readPage(target, host);
      } finally {
        unlockHost();
      }
      if (page.status !== "ok") {
        detail = redactSensitive(page.detail);
        // A site that asked for a pause is asked again in a later run. Any other refusal is final.
        runtime.deps.store.setFrontierState(item.id, pausedHosts.has(host) ? "queued" : "done");
        const latest = runtime.deps.store.getTrail(trail.id) ?? trailNow;
        runtime.deps.store.saveTrail({ ...latest, stats: { ...latest.stats, blocked: latest.stats.blocked + 1 } });
        recordTrailCall(trail.id, "look", target, null, "blocked", detail);
        waveBlocked += 1;
        return;
      }
      pagesRead += 1;
      if (!isPlantedUrl(page.url)) {
        const safePage = { url: page.url, title: page.title, text: page.text, links: page.links };
        const lookInput: LookInput = { thesis: runtime.swarm.thesis, intent: trail.intent, notes: notesForRunner(runtime.deps.store.listHuntNotes(hunt.id, 10000)), page: safePage, latestStage };
        const looked = await withinBudget("runner", (allowance) =>
          runtime.runJob({ agent: looker, stage: "hunt", jobId: "hunt.look", input: lookInput, routeKey: page.url, maxBudgetUsd: allowance }));
        if (looked === "spent" || !looked) { stopWave = true; return; }
        taskId = looked.task.id;
        taskMeta = { model: looked.task.model, costUsd: looked.task.costUsd, latencyMs: looked.task.latencyMs };
        if (looked.task.status !== "succeeded" || !looked.output) {
          result = "failed";
          detail = looked.task.error;
        } else {
          const output = looked.output;
          const stage = checkStage(page.text, output);
          const pageTooLate = tooLate(stage, latestStage);
          const people = output.people.slice(0, 8);
          const found: string[] = [];
          for (const person of people) {
            if (checkPerson(page.text, person)) { trailDropped += 1; continue; }
            if (pageTooLate) { trailTooLate += 1; continue; }
            const personName = redactSensitive(person.name).trim();
            const companyName = person.companyName ? redactSensitive(person.companyName).trim() || null : null;
            if (!personName || keptThisRun.has(personKey(personName, companyName))) continue;
            keptThisRun.add(personKey(personName, companyName));
            const links = profileLinksFromPage(person.links, page);
            const lead: Lead = {
              id: stableId("led", `${runtime.run.id}:${looked.task.id}:${page.url}:${normalizeName(personName)}:${normalizeName(companyName ?? "")}`),
              swarmId: runtime.swarm.id,
              founderId: null,
              source: "web",
              sourceRef: page.url,
              sourceTitle: redactSensitive(page.title),
              personName,
              role: person.role ? redactSensitive(person.role).trim() || null : null,
              companyName,
              companyUrl: addressOnPage(person.companyUrl, page) ? cleanUrl(person.companyUrl ?? "") : null,
              oneLiner: person.oneLiner ? redactSensitive(person.oneLiner).trim() || null : null,
              links,
              why: redactSensitive(person.why).trim(),
              discoveredByTaskId: looked.task.id,
              discoveredAt: runtime.now().toISOString(),
              trailId: trail.id,
              quote: redactSensitive(person.quote),
              stage,
              earliness: earliness(stage),
            };
            runtime.deps.store.insertLead(lead);
            if (found.length < 3) found.push(shortFound(lead));
            itemLeads += 1;
            leadsKept += 1;
            const simId = (page.simFounderIds ?? []).find((id) => {
              const founder = runtime.deps.simWorld.founder(id);
              return founder && normalizeName(founder.name) === normalizeName(person.name);
            });
            if (simId) simIdsByLead.set(lead.id, simId);
          }
          const follows = checkPicks(output.follow, page.links.length, 5);
          queuedCount = enqueuePickedPages(runtime, hunt, trail, follows, page.links.map((link) => link.url), item.depth + 1, "runner", maxDepth);
          result = itemLeads || queuedCount ? "ok" : "empty";
          if (pageTooLate) waveTooLate += trailTooLate;
          if (byTrail.has(trail.id)) byTrail.get(trail.id)!.found.push(...found);
          else byTrail.set(trail.id, { calls: 0, leads: 0, found });
        }
      }
      runtime.deps.store.setFrontierState(item.id, "done");
      hunt = { ...hunt, looks: hunt.looks + 1, updatedAt: runtime.now().toISOString() };
      const latest = runtime.deps.store.getTrail(trail.id) ?? trailNow;
      runtime.deps.store.saveTrail({ ...latest, stats: { ...latest.stats, pages: latest.stats.pages + 1, leads: latest.stats.leads + itemLeads, dropped: latest.stats.dropped + trailDropped, tooLate: latest.stats.tooLate + trailTooLate, costUsd: latest.stats.costUsd + (taskMeta.costUsd ?? 0) } });
      recordTrailCall(trail.id, "look", target, taskId, result, detail, { leads: itemLeads, dropped: trailDropped, tooLate: trailTooLate, queued: queuedCount, ...taskMeta });
    });

    for (const stale of staleTrails(runtime.deps.store.listTrails(hunt.id))) {
      const why = `Read ${stale.stats.pages} pages and found nobody.`;
      runtime.deps.store.saveTrail({ ...stale, status: "closed", closedAt: runtime.now().toISOString(), closedWhy: why });
      makeNote(runtime, hunt, "code", `${stale.name}: ${why}`, hunt.turn);
    }
    runtime.deps.store.saveHunt({ ...hunt, updatedAt: runtime.now().toISOString() });
    runtime.addStats({ rawItems: pagesRead, leads: leadsKept });
    lastWave = {
      turn: hunt.turn,
      calls: waveCalls,
      leads: leadsKept,
      tooLate: waveTooLate,
      blocked: waveBlocked,
      byTrail: [...byTrail.entries()].map(([trailId, values]) => ({ trailId, calls: values.calls, leads: values.leads, found: values.found.slice(0, 3) })),
      refused: [...newRefused, ...plan.refused].slice(0, 30),
    };
    runtime.deps.store.saveHunt({ ...hunt, updatedAt: runtime.now().toISOString() });
    if (plan.done || (!wave.length && !openedOrExtended) || !canStart() || stopWave || runtime.stopped()) break;
  }
  runtime.deps.store.saveHunt({ ...hunt, updatedAt: runtime.now().toISOString() });
}
