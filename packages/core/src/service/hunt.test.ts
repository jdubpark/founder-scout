import { afterEach, describe, expect, it } from "vitest";
import {
  BASE_CONFIG,
  DEFAULT_SETTINGS,
  ZERO_STATS,
  ZERO_TRAIL_STATS,
  type Agent,
  type FrontierItem,
  type Founder,
  type Hunt,
  type HuntCall,
  type HuntNote,
  type Lead,
  type Run,
  type Swarm,
  type Trail,
} from "@agentswarm/shared";
import type { Store, WebAccess } from "../contracts";
import { openStore } from "../db";
import { ServiceError } from "../contracts";
import { addHuntNote, addHuntTrail, huntView, removeHuntNote, updateHuntTrail, type HuntServiceDeps } from "./hunt";

const fixedAt = new Date("2026-11-13T12:00:00.000Z");
const stamp = fixedAt.toISOString();
const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function swarmRecord(id = "swm_hunt", configId = BASE_CONFIG.id): Swarm {
  return {
    id,
    name: "Hunt test",
    status: "active",
    thesis: { summary: "AI tools", sectors: ["AI"], stages: ["Pre-seed"], geos: [], avoid: [] },
    configId,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function huntRecord(swarmId = "swm_hunt", id = "hnt_test", overrides: Partial<Hunt> = {}): Hunt {
  return { id, swarmId, turn: 2, looks: 5, createdAt: stamp, updatedAt: stamp, ...overrides };
}

function trailRecord(id: string, huntId = "hnt_test", overrides: Partial<Trail> = {}): Trail {
  return {
    id,
    huntId,
    swarmId: "swm_hunt",
    name: id,
    intent: "Find founders building useful tools",
    status: "open",
    openedBy: "person",
    weight: 3,
    pinned: false,
    stats: { ...ZERO_TRAIL_STATS },
    openedAt: stamp,
    closedAt: null,
    closedWhy: null,
    ...overrides,
  };
}

function callRecord(id: string, huntId = "hnt_test", overrides: Partial<HuntCall> = {}): HuntCall {
  return {
    id,
    huntId,
    swarmId: "swm_hunt",
    runId: "run_hunt",
    taskId: null,
    trailId: "trl_open",
    turn: 1,
    tool: "look",
    target: "https://example.test/project",
    host: "example.test",
    result: "ok",
    detail: null,
    leads: 1,
    dropped: 0,
    tooLate: 0,
    queued: 0,
    control: null,
    model: "model-a",
    costUsd: 0.25,
    latencyMs: 100,
    at: stamp,
    ...overrides,
  };
}

function leadRecord(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "led_hunt",
    swarmId: "swm_hunt",
    founderId: "fnd_hunt",
    source: "web",
    sourceRef: "https://example.test/project",
    sourceTitle: "Project launch",
    personName: "Ari Founder",
    role: "Founder",
    companyName: "Vector Tools",
    companyUrl: "https://vector.test",
    oneLiner: "Builds a vector index",
    links: { github: null, linkedin: null, x: null, site: null, scholar: null },
    why: "A public launch post names the founder.",
    discoveredByTaskId: null,
    discoveredAt: stamp,
    trailId: "trl_open",
    quote: "I started Vector Tools",
    stage: null,
    earliness: 0.9,
    ...overrides,
  };
}

function founderRecord(id = "fnd_hunt", status: Founder["status"] = "surfaced"): Founder {
  return {
    id,
    swarmId: "swm_hunt",
    name: "Ari Founder",
    headline: "Builds a vector index",
    location: null,
    company: { name: "Vector Tools", url: "https://vector.test", oneLiner: "Builds a vector index", stage: "Pre-seed" },
    links: { github: null, linkedin: null, x: null, site: null, scholar: null },
    status,
    fit: 0.8,
    fitReasons: [],
    tags: [],
    identityConfidence: 1,
    sources: ["web"],
    firstSeenAt: stamp,
    updatedAt: stamp,
    lastAssessedAt: null,
    nextRecheckAt: null,
    simId: null,
  };
}

function agentRecord(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agt_navigator",
    swarmId: "swm_hunt",
    jobId: "hunt.navigate",
    classId: "navigator",
    name: "Navigator",
    status: "active",
    beat: null,
    state: {},
    createdAt: stamp,
    ...overrides,
  };
}

function runRecord(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_active_hunt",
    swarmId: "swm_hunt",
    trigger: "manual",
    brain: "sim",
    sources: "sim",
    status: "running",
    stage: "hunt",
    configId: BASE_CONFIG.id,
    budgetUsd: 25,
    costUsd: 0,
    stats: { ...ZERO_STATS },
    error: null,
    simDay: null,
    startedAt: stamp,
    finishedAt: null,
    ...overrides,
  };
}

function engine(id: string, configured: boolean, detail = "ready"): WebAccess["engines"][number] {
  return {
    id,
    label: id.toUpperCase(),
    searches: `Searches ${id}`,
    async status() { return { configured, detail }; },
    async search() { return []; },
  };
}

function harness() {
  const store = openStore(":memory:");
  stores.push(store);
  store.insertSwarm(swarmRecord());
  store.saveSettings({ ...DEFAULT_SETTINGS, schedule: { ...DEFAULT_SETTINGS.schedule, sources: "sim" } });
  const audits: Array<{ actor: string; action: string; target: string; detail: Record<string, unknown> }> = [];
  const web: { sim: WebAccess; live: WebAccess } = {
    sim: { reader: { async read(url) { return { status: "ok" as const, detail: "", url, title: "", text: "", links: [] }; } }, engines: [engine("hn", true), engine("github", false, "missing credentials")] },
    live: { reader: { async read(url) { return { status: "ok" as const, detail: "", url, title: "", text: "", links: [] }; } }, engines: [engine("web", true)] },
  };
  const deps: HuntServiceDeps = {
    store,
    web,
    now: () => fixedAt,
    audit(actor, action, target, detail = {}) {
      audits.push({ actor, action, target, detail });
      return store.audit({ actor, action, target, detail });
    },
  };
  return { store, deps, audits };
}

function expectServiceError(work: () => unknown | Promise<unknown>, status: number): Promise<ServiceError> {
  return Promise.resolve().then(work).then(
    () => { throw new Error("Expected ServiceError"); },
    (error: unknown) => {
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).status).toBe(status);
      return error as ServiceError;
    },
  );
}

describe("hunt service", () => {
  it("shows an empty hunt with resolved limits, navigator state, runner pools, and scheduled engines", async () => {
    const h = harness();
    h.store.insertAgent(agentRecord({ status: "paused" }));
    const config = { ...BASE_CONFIG, id: "cfg_hunt_view", routes: { ...BASE_CONFIG.routes, "hunt.navigate": { provider: "sim" as const, model: "nav-model" } } };
    h.store.saveConfig(config);
    h.store.updateSwarm("swm_hunt", { configId: config.id });
    h.deps.defaultPools = async () => ({ "hunt.look": [{ id: "fast-reader", route: { provider: "sim", model: "fast" }, share: 1, status: "active", note: null }] });
    h.store.insertRun(runRecord());

    const view = await huntView(h.deps, "swm_hunt");

    expect(view.enabled).toBe(true);
    expect(view.active).toBe(true);
    expect(view.turn).toBe(0);
    expect(view.navigator.agentId).toBe("agt_navigator");
    expect(view.navigator.paused).toBe(true);
    expect(view.navigator.route).toMatchObject({ provider: "sim", model: "nav-model" });
    expect(view.runners.map((pool) => pool.jobId)).toEqual(["hunt.look", "hunt.sift"]);
    expect(view.runners.find((pool) => pool.jobId === "hunt.look")?.members[0]).toMatchObject({ id: "fast-reader", modelLabel: "fast" });
    expect(view.engines.map((item) => [item.id, item.configured, item.detail])).toEqual([
      ["hn", true, "ready"], ["github", false, "missing credentials"],
    ]);
    expect(view.limits).toMatchObject({ turns: 4, waveSize: 12, maxDepth: 2, budgetShare: 0.25, latestStage: "seed", plantedEvery: 12 });
    expect(view.totals).toEqual(ZERO_TRAIL_STATS);
    expect(view.planted).toEqual({ read: 0, failed: 0 });
    expect(view.trails).toHaveLength(0);
    expect(view.notes).toHaveLength(0);
    expect(view.calls).toHaveLength(0);
    expect(view.waves).toHaveLength(0);
    expect(view.finds).toHaveLength(0);
  });

  it("combines trail, call, wave, and lead data from persisted hunt state", async () => {
    const h = harness();
    const hunt = huntRecord("swm_hunt", "hnt_view", { turn: 6, looks: 9 });
    h.store.saveHunt(hunt);
    const open = trailRecord("trl_open", hunt.id, {
      name: "Good yield",
      stats: { searches: 2, pages: 4, leads: 3, kept: 1, dropped: 1, tooLate: 1, blocked: 2, costUsd: 1.25 },
    });
    const second = trailRecord("trl_open2", hunt.id, { name: "Lower yield", weight: 1, openedAt: "2026-11-12T12:00:00.000Z" });
    const paused = trailRecord("trl_paused", hunt.id, { status: "paused", openedAt: "2026-11-11T12:00:00.000Z" });
    const closedOld = trailRecord("trl_closed_old", hunt.id, { status: "closed", closedAt: "2026-11-12T10:00:00.000Z" });
    const closedNew = trailRecord("trl_closed_new", hunt.id, { status: "closed", closedAt: "2026-11-12T11:00:00.000Z" });
    for (const trail of [open, second, paused, closedOld, closedNew]) h.store.saveTrail(trail);
    const queued: FrontierItem = {
      id: "frt_queued",
      huntId: hunt.id,
      trailId: open.id,
      kind: "page",
      target: "https://example.test/next",
      engine: null,
      label: "Good yield",
      priority: 1,
      depth: 1,
      from: "person",
      state: "queued",
      addedAt: stamp,
    };
    h.store.addFrontier([queued]);
    h.store.insertHuntCall(callRecord("hcall_regular", hunt.id, { turn: 4, at: "2026-11-13T11:00:00.000Z", leads: 2, costUsd: 0.5 }));
    h.store.insertHuntCall(callRecord("hcall_plant", hunt.id, { turn: 4, trailId: null, control: "failed", at: "2026-11-13T10:00:00.000Z", leads: 0 }));
    h.store.insertHuntCall(callRecord("hcall_search", hunt.id, { turn: 5, tool: "search", result: "empty", costUsd: null, at: "2026-11-13T11:30:00.000Z", leads: 0 }));
    h.store.insertFounder(founderRecord());
    h.store.insertLead(leadRecord());

    const view = await huntView(h.deps, "swm_hunt");

    expect(view.turn).toBe(6);
    expect(view.totals).toEqual({ searches: 2, pages: 4, leads: 3, kept: 1, dropped: 1, tooLate: 1, blocked: 2, costUsd: 1.25 });
    expect(view.planted).toEqual({ read: 1, failed: 1 });
    expect(view.trails.map((trail) => trail.id)).toEqual([open.id, second.id, paused.id, closedNew.id, closedOld.id]);
    expect(view.trails[0]).toMatchObject({ queued: 1, share: 1 });
    expect(view.trails[0]!.score).toBeCloseTo(1.8);
    expect(view.waves).toEqual([
      { turn: 4, at: "2026-11-13T10:00:00.000Z", calls: 2, leads: 2, costUsd: 0.75 },
      { turn: 5, at: "2026-11-13T11:30:00.000Z", calls: 1, leads: 0, costUsd: 0 },
    ]);
    expect(view.finds[0]).toMatchObject({ leadId: "led_hunt", sourceRef: "https://example.test/project", founderId: "fnd_hunt", founderStatus: "surfaced" });
  });

  it("limits notes, calls, waves, and finds to the newest rows", async () => {
    const h = harness();
    const hunt = huntRecord("swm_hunt", "hnt_limits");
    h.store.saveHunt(hunt);
    const trail = trailRecord("trl_limits", hunt.id);
    h.store.saveTrail(trail);

    for (let index = 0; index < 51; index += 1) {
      h.store.insertHuntNote({
        id: `hntn_${index}`,
        huntId: hunt.id,
        swarmId: hunt.swarmId,
        by: "person",
        text: `Note ${index}`,
        turn: index,
        createdAt: new Date(fixedAt.getTime() + index * 1000).toISOString(),
      });
    }
    for (let index = 0; index < 101; index += 1) {
      h.store.insertHuntCall(callRecord(`hcall_${index}`, hunt.id, {
        turn: index,
        at: new Date(fixedAt.getTime() + index * 1000).toISOString(),
      }));
    }
    for (let index = 0; index < 31; index += 1) {
      h.store.insertLead(leadRecord({
        id: `led_${index}`,
        founderId: null,
        trailId: trail.id,
        personName: `Founder ${index}`,
        discoveredAt: new Date(fixedAt.getTime() + index * 1000).toISOString(),
      }));
    }

    const view = await huntView(h.deps, hunt.swarmId);

    expect(view.notes).toHaveLength(50);
    expect(view.notes[0]?.id).toBe("hntn_50");
    expect(view.notes.at(-1)?.id).toBe("hntn_1");
    expect(view.calls).toHaveLength(100);
    expect(view.calls[0]?.id).toBe("hcall_100");
    expect(view.calls.at(-1)?.id).toBe("hcall_1");
    expect(view.waves).toHaveLength(30);
    expect(view.waves[0]?.turn).toBe(71);
    expect(view.waves.at(-1)?.turn).toBe(100);
    expect(view.finds).toHaveLength(30);
    expect(view.finds[0]?.leadId).toBe("led_30");
    expect(view.finds.at(-1)?.leadId).toBe("led_1");
  });

  it("shows a person once, by the sighting that says how far along the company is", async () => {
    const h = harness();
    const hunt = huntRecord("swm_hunt", "hnt_person");
    h.store.saveHunt(hunt);
    const trail = trailRecord("trl_person", hunt.id);
    h.store.saveTrail(trail);
    const at = (seconds: number) => new Date(fixedAt.getTime() + seconds * 1000).toISOString();
    const stage = { funding: "says_unfunded" as const, fundingQuote: "We have not raised money.", team: "solo" as const, teamQuote: "It is just me.", progress: "building" as const, progressQuote: "I am building it now." };
    // The same person named on three pages: a list, then their own project page, then a profile.
    h.store.insertLead(leadRecord({ id: "led_list", founderId: null, trailId: trail.id, personName: "Ari Founder", companyName: "Vector Tools", sourceRef: "https://example.test/list", discoveredAt: at(1) }));
    h.store.insertLead(leadRecord({ id: "led_project", founderId: null, trailId: trail.id, personName: "Ari Founder", companyName: "Vector Tools", sourceRef: "https://example.test/project", stage, earliness: 0.967, discoveredAt: at(2) }));
    h.store.insertLead(leadRecord({ id: "led_profile", founderId: null, trailId: trail.id, personName: "ari founder", companyName: "Vector Tools", sourceRef: "https://example.test/ari", discoveredAt: at(3) }));
    h.store.insertLead(leadRecord({ id: "led_other", founderId: null, trailId: trail.id, personName: "Bo Builder", companyName: "Other Works", sourceRef: "https://example.test/other", discoveredAt: at(4) }));

    const view = await huntView(h.deps, hunt.swarmId);

    expect(view.finds.map((find) => find.leadId)).toEqual(["led_other", "led_project"]);
    expect(view.finds[1]).toMatchObject({ earliness: 0.967, sourceRef: "https://example.test/project" });
  });

  it("checks and persists a person trail with safe starts and an audit entry", async () => {
    const h = harness();
    const noStart = await expectServiceError(() => addHuntTrail(h.deps, "Partner", "swm_hunt", { name: "No starts" }), 400);
    expect(noStart.fields).toHaveProperty("pages");
    expect(noStart.message).toContain("nowhere to start");
    expect(h.store.getHunt("swm_hunt")).toBeNull();

    const view = await addHuntTrail(h.deps, "Partner", "swm_hunt", {
      name: "  New package makers  ",
      intent: "Find teams releasing new packages",
      searches: [{ engine: "hn", query: "  first package launch  " }],
      pages: ["https://example.com/start"],
    });

    const trail = view.trails[0]!;
    const starts = h.store.listFrontier(view.trails[0]!.huntId);
    expect(trail).toMatchObject({ name: "New package makers", intent: "Find teams releasing new packages", status: "open", openedBy: "person", weight: 3, pinned: false });
    expect(starts).toHaveLength(2);
    expect(starts.map((item) => [item.kind, item.target, item.engine, item.depth, item.priority, item.from])).toEqual(expect.arrayContaining([
      ["search", "first package launch", "hn", 0, 1, "person"],
      ["page", "https://example.com/start", null, 0, 1, "person"],
    ]));
    expect(h.store.getHunt("swm_hunt")).toMatchObject({ turn: 0, looks: 0 });
    expect(h.audits[0]).toMatchObject({ actor: "Partner", action: "hunt.trail.add", target: trail.id, detail: { swarmId: "swm_hunt", starts: 2 } });

    const personal = await expectServiceError(() => addHuntTrail(h.deps, "Partner", "swm_hunt", {
      name: "21-year-old founders", pages: ["https://example.test/start"],
    }), 400);
    expect(personal.fields).toHaveProperty("name");
    const unsupportedSearch = await expectServiceError(() => addHuntTrail(h.deps, "Partner", "swm_hunt", {
      name: "Unsupported source", searches: [{ engine: "unknown", query: "new teams" }],
    }), 400);
    expect(unsupportedSearch.message).toContain("No search engine called");
    expect(unsupportedSearch.fields).toHaveProperty("searches");
    const unconfiguredSearch = await expectServiceError(() => addHuntTrail(h.deps, "Partner", "swm_hunt", {
      name: "Unconfigured source", searches: [{ engine: "github", query: "new teams" }],
    }), 400);
    expect(unconfiguredSearch.message).toContain("No search engine called");
    expect(unconfiguredSearch.fields).toHaveProperty("searches");
    const invalidPage = await expectServiceError(() => addHuntTrail(h.deps, "Partner", "swm_hunt", {
      name: "One good start is not enough", pages: ["https://example.com/start", "https://127.0.0.1/private"],
    }), 400);
    expect(invalidPage.fields).toHaveProperty("pages");
    const tooManyStarts = await expectServiceError(() => addHuntTrail(h.deps, "Partner", "swm_hunt", {
      name: "Too many starts", pages: Array.from({ length: 7 }, (_, index) => `https://example.com/start-${index}`),
    }), 400);
    expect(tooManyStarts.fields).toHaveProperty("pages");
    const personalIntent = await expectServiceError(() => addHuntTrail(h.deps, "Partner", "swm_hunt", {
      name: "New launch posts", intent: "Find founders who are 21-year-old", pages: ["https://example.com/start"],
    }), 400);
    expect(personalIntent.fields).toHaveProperty("intent");
  });

  it("updates pin, attention, pause, close, and reopen with changed-field audits", async () => {
    const h = harness();
    const hunt = huntRecord();
    h.store.saveHunt(hunt);
    const trail = trailRecord("trl_lifecycle", hunt.id);
    h.store.saveTrail(trail);

    const closed = await updateHuntTrail(h.deps, "Partner", "swm_hunt", trail.id, { status: "closed", pinned: true, weight: 5 });
    expect(h.store.getTrail(trail.id)).toMatchObject({ status: "closed", pinned: true, weight: 5, closedAt: stamp, closedWhy: "Closed by a person." });
    expect(h.audits[0]).toMatchObject({ action: "hunt.trail.update", target: trail.id, detail: { fields: ["status", "closedAt", "closedWhy", "pinned", "weight"] } });
    expect(closed.trails[0]).toMatchObject({ status: "closed", pinned: true, weight: 5 });

    await updateHuntTrail(h.deps, "Partner", "swm_hunt", trail.id, { status: "paused" });
    expect(h.store.getTrail(trail.id)).toMatchObject({ status: "paused", closedAt: null, closedWhy: null });
    await updateHuntTrail(h.deps, "Partner", "swm_hunt", trail.id, { status: "open" });
    expect(h.store.getTrail(trail.id)).toMatchObject({ status: "open", closedAt: null, closedWhy: null });
    await updateHuntTrail(h.deps, "Partner", "swm_hunt", trail.id, { weight: 2 });
    expect(h.store.getTrail(trail.id)?.weight).toBe(2);
    expect(h.audits).toHaveLength(4);
    await expectServiceError(() => updateHuntTrail(h.deps, "Partner", "swm_hunt", trail.id, { weight: 1.5 }), 400);
    await expectServiceError(() => updateHuntTrail(h.deps, "Partner", "swm_hunt", "missing", { pinned: true }), 404);
  });

  it("starts the notebook when the first person note arrives", async () => {
    const h = harness();

    const view = await addHuntNote(h.deps, "Partner", "swm_hunt", { text: "Prioritize product launch pages." });

    expect(h.store.getHunt("swm_hunt")).toMatchObject({ turn: 0, looks: 0 });
    expect(view.notes[0]).toMatchObject({ by: "person", text: "Prioritize product launch pages.", turn: 0 });
    expect(h.audits[0]).toMatchObject({ action: "hunt.note.add", target: view.notes[0]?.id });
  });

  it("keeps the open trail ceiling when two person trails arrive together", async () => {
    const h = harness();
    const hunt = huntRecord();
    h.store.saveHunt(hunt);
    for (let index = 0; index < 7; index += 1) h.store.saveTrail(trailRecord(`trl_open_${index}`, hunt.id));

    const results = await Promise.allSettled([
      addHuntTrail(h.deps, "Partner", "swm_hunt", { name: "New trail A", pages: ["https://example.com/a"] }),
      addHuntTrail(h.deps, "Partner", "swm_hunt", { name: "New trail B", pages: ["https://example.com/b"] }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(ServiceError);
      expect(rejected.reason.status).toBe(400);
      expect(rejected.reason.message).toContain("trails are open already");
    }
    expect(h.store.listTrails(hunt.id).filter((trail) => trail.status === "open")).toHaveLength(8);
  });

  it("enforces the open trail ceiling and keeps note operations scoped to the hunt", async () => {
    const h = harness();
    const hunt = huntRecord();
    h.store.saveHunt(hunt);
    for (let index = 0; index < 8; index += 1) h.store.saveTrail(trailRecord(`trl_open_${index}`, hunt.id));
    const paused = trailRecord("trl_to_reopen", hunt.id, { status: "paused" });
    h.store.saveTrail(paused);
    await expectServiceError(() => updateHuntTrail(h.deps, "Partner", "swm_hunt", paused.id, { status: "open" }), 400);

    const noteView = await addHuntNote(h.deps, "Partner", "swm_hunt", { text: "  Look for launch posts on new package registries.  " });
    const note = noteView.notes[0]!;
    expect(note).toMatchObject({ by: "person", text: "Look for launch posts on new package registries.", turn: 2 });
    expect(h.audits.at(-1)).toMatchObject({ action: "hunt.note.add", target: note.id, detail: { swarmId: "swm_hunt", turn: 2 } });
    const personalNote = await expectServiceError(() => addHuntNote(h.deps, "Partner", "swm_hunt", { text: "I was born in 1985" }), 400);
    expect(personalNote.fields).toHaveProperty("text");
    await expectServiceError(() => addHuntNote(h.deps, "Partner", "swm_hunt", { text: "   " }), 400);

    h.store.insertSwarm(swarmRecord("swm_other"));
    const otherHunt = huntRecord("swm_other", "hnt_other");
    h.store.saveHunt(otherHunt);
    const otherNote: HuntNote = { ...note, id: "nte_other", huntId: otherHunt.id, swarmId: otherHunt.swarmId };
    h.store.insertHuntNote(otherNote);
    await expectServiceError(() => removeHuntNote(h.deps, "Partner", "swm_hunt", otherNote.id), 404);
    expect(h.store.listHuntNotes(otherHunt.id, 10).map((item) => item.id)).toContain(otherNote.id);

    const afterRemove = await removeHuntNote(h.deps, "Partner", "swm_hunt", note.id);
    expect(afterRemove.notes.some((item) => item.id === note.id)).toBe(false);
    expect(h.audits.at(-1)).toMatchObject({ action: "hunt.note.remove", target: note.id, detail: { swarmId: "swm_hunt" } });
  });
});
