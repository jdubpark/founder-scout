import { afterEach, describe, expect, it } from "vitest";
import { BASE_CONFIG, JOBS, isPlantedUrl, pickMember, runnerPools, SEAT_ASKER, SIM_WEB_HOST, type Agent, type JobInput, type JobOutput, type ModelJobId, type NavigateInput, type NavigateOutput, type LookInput, type LookOutput, type Pools, type SearchInput, type SearchOutput, type SiftInput, type SiftOutput, type Swarm, type SwarmConfig } from "@agentswarm/shared";
import { createExecuteJob, createJobRegistry } from "../jobs";
import { openStore } from "../db";
import { createSimRepoFinder, createSimSources, createSimWorld } from "../sim";
import { createSimWebAccess } from "../sources";
import type { ExecuteJob, JobContext, JobExecution, ModelProvider, ProviderRegistry, SearchEngine, WebReader } from "../contracts";
import { ProviderError } from "../contracts";
import { createRunController } from "./index";
import { applyNavigatorTurn } from "./hunt";

const NOW = new Date("2026-11-12T18:00:00.000Z");
const SWARM_ID = "swm_hunt_engine";
const CONFIG_ID = "cfg_hunt_engine";
const stores: Array<ReturnType<typeof openStore>> = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function providerRegistry(): ProviderRegistry {
  const provider: ModelProvider = {
    id: "openai-api",
    status: async () => ({ configured: false, detail: "Test provider is not configured." }),
    run: async () => { throw new ProviderError("not_configured", "No provider for simulated tasks."); },
  };
  return { get: () => provider, statuses: async () => [] };
}

interface HarnessOptions {
  founders?: number;
  pausedNavigator?: boolean;
  wrapExecuteJob?: (delegate: ExecuteJob) => ExecuteJob;
  wrapReader?: (reader: WebReader) => WebReader;
  defaultPools?: () => Promise<Pools>;
  engines?: readonly SearchEngine[];
}

function harness(configParams: Record<string, number | boolean | string> = {}, options: HarnessOptions = {}) {
  const store = openStore(":memory:");
  stores.push(store);
  const world = createSimWorld({ seed: 917, founders: options.founders ?? 24, days: 4 });
  const jobs = createJobRegistry();
  const config: SwarmConfig = {
    ...BASE_CONFIG,
    id: CONFIG_ID,
    params: { ...BASE_CONFIG.params, "screen.min_fit": 0, ...configParams },
  };
  const swarm: Swarm = {
    id: SWARM_ID,
    name: "Hunt test swarm",
    status: "active",
    thesis: {
      summary: "Back technical founders building useful software companies.",
      sectors: ["Developer tools", "Applied AI"],
      stages: ["pre-seed", "seed", "series A"],
      geos: ["Portland", "Madison"],
      avoid: [],
    },
    configId: CONFIG_ID,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  store.saveConfig(config);
  store.insertSwarm(swarm);
  // Keep integration inputs available to the hunt rather than duplicating the fixed scouts.
  for (const meta of JOBS.filter((job) => job.enabled && !job.id.startsWith("scout."))) {
    const agent: Agent = {
      id: `agt_${meta.id.replace(/[^a-z0-9]/gi, "_")}`,
      swarmId: SWARM_ID,
      jobId: meta.id,
      classId: meta.classId,
      name: meta.label,
      status: options.pausedNavigator && meta.id === "hunt.navigate" ? "paused" : "active",
      beat: null,
      state: {},
      createdAt: NOW.toISOString(),
    };
    store.insertAgent(agent);
  }
  const simulatedWeb = createSimWebAccess(world);
  const web = {
    ...simulatedWeb,
    engines: options.engines ?? simulatedWeb.engines,
    reader: options.wrapReader?.(simulatedWeb.reader) ?? simulatedWeb.reader,
  };
  const realExecuteJob = createExecuteJob({ jobs, providers: providerRegistry() });
  const executeJob = options.wrapExecuteJob?.(realExecuteJob) ?? realExecuteJob;
  const controller = createRunController({
    store,
    jobs,
    executeJob,
    sources: { sim: createSimSources(world), live: createSimSources(world) },
    repos: { sim: createSimRepoFinder(world), live: createSimRepoFinder(world) },
    web: { sim: web, live: web },
    defaultPools: options.defaultPools,
    simWorld: world,
    fundName: "Northstar Ventures",
    now: () => new Date(NOW),
    sleep: async () => undefined,
  });
  return { store, world, controller, web };
}

function wrapJob(delegate: ExecuteJob, options: {
  navigate?: (input: NavigateInput, output: NavigateOutput) => NavigateOutput;
  search?: (input: SearchInput, output: SearchOutput) => SearchOutput;
  look?: (input: LookInput, output: LookOutput) => LookOutput;
  sift?: (input: SiftInput, output: SiftOutput) => SiftOutput;
}): ExecuteJob {
  return async <J extends ModelJobId>(jobId: J, input: JobInput<J>, ctx: JobContext, execOptions: Parameters<ExecuteJob>[3]): Promise<JobExecution<J>> => {
    const result = await delegate(jobId, input, ctx, execOptions);
    if (jobId === "hunt.navigate" && options.navigate) {
      return { ...result, output: options.navigate(input as NavigateInput, result.output as NavigateOutput) as JobOutput<J> };
    }
    if (jobId === "hunt.search" && options.search) {
      return { ...result, output: options.search(input as SearchInput, result.output as SearchOutput) as JobOutput<J> };
    }
    if (jobId === "hunt.look" && options.look) {
      return { ...result, output: options.look(input as LookInput, result.output as LookOutput) as JobOutput<J> };
    }
    if (jobId === "hunt.sift" && options.sift) {
      return { ...result, output: options.sift(input as SiftInput, result.output as SiftOutput) as JobOutput<J> };
    }
    return result;
  };
}

describe("hunt engine stage", () => {
  it("runs model-backed web search as a budgeted task and passes numbered hits to the sifter", async () => {
    const query = '"first launch" developer tools';
    const searchInputs: SearchInput[] = [];
    const siftInputs: SiftInput[] = [];
    const engine: SearchEngine = {
      id: "web",
      label: "Web search",
      searches: "Plain words and quoted phrases.",
      job: "hunt.search",
      status: async () => ({ configured: true, detail: "Ready." }),
      search: async () => { throw new Error("Model-backed search must use its job."); },
    };
    const { store, world, controller } = harness({
      "hunt.turns": 1,
      "hunt.wave_size": 1,
      "hunt.max_depth": 0,
      "hunt.budget_share": 0.5,
    }, {
      engines: [engine],
      wrapExecuteJob: (delegate) => wrapJob(delegate, {
        navigate: (_input, output) => ({
          ...output,
          open: [{ name: "Web search test", intent: "Find early builders.", searches: [{ engine: "web", query }], pages: [] }],
          extend: [],
          close: [],
          done: false,
        }),
        search: (input, output) => {
          searchInputs.push(input);
          return {
            ...output,
            hits: [{ url: `https://${SIM_WEB_HOST}/p/${encodeURIComponent(world.founders()[0]!.simId)}`, title: "Early developer tool founder", snippet: "A first public launch." }],
          };
        },
        sift: (input, output) => {
          siftInputs.push(input);
          return { ...output, open: [{ index: 0, label: "Founder page", priority: 1 }] };
        },
      }),
    });
    const started = await controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live", budgetUsd: 20 });
    const run = await controller.wait(started.id);
    expect(run.status).toBe("succeeded");

    const searchTask = store.listTasks({ runId: run.id }).find((task) => task.jobId === "hunt.search");
    expect(searchTask).toMatchObject({ status: "succeeded" });
    expect(searchTask!.costUsd).toBeGreaterThan(0);
    expect(searchInputs[0]?.limit).toBe(10);
    expect(siftInputs[0]?.hits).toEqual([
      expect.objectContaining({ index: 0, title: "Early developer tool founder" }),
    ]);
    const trail = store.listTrails(store.getHunt(SWARM_ID)!.id).find((item) => item.name === "Web search test")!;
    expect(trail.stats.costUsd).toBeGreaterThanOrEqual(searchTask!.costUsd!);
    const huntCosts = store.listTasks({ runId: run.id }).filter((task) => task.stage === "hunt").map((task) => task.costUsd ?? 0);
    expect(huntCosts.reduce((sum, cost) => sum + cost, 0)).toBeLessThanOrEqual(10 + Math.max(...huntCosts));
  });

  it("finds sourced simulated web leads and sends them through matching and screening", async () => {
    const captureSecondRunInputs = { current: false };
    const navigatorInputs: NavigateInput[] = [];
    const { store, world, controller } = harness({
      "hunt.turns": 2,
      "hunt.wave_size": 8,
      "hunt.max_depth": 1,
      "hunt.budget_share": 0.5,
      "hunt.planted_every": 6,
    }, {
      wrapExecuteJob: (delegate) => wrapJob(delegate, { navigate: (input, output) => {
        if (captureSecondRunInputs.current) navigatorInputs.push(input);
        return output;
      } }),
    });
    const started = await controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    const run = await controller.wait(started.id);
    expect(run.status).toBe("succeeded");

    const webLeads = store.listLeads({ swarmId: SWARM_ID }).filter((lead) => lead.source === "web");
    expect(webLeads.length).toBeGreaterThan(0);
    expect(webLeads.some((lead) => lead.earliness !== null)).toBe(true);
    for (const lead of webLeads) {
      expect(lead.trailId).toBeTruthy();
      expect(lead.quote).toBeTruthy();
      // A page about one company says how far along it is; a list of several does not.
      if (lead.sourceRef.includes("/p/")) expect(lead.earliness).not.toBeNull();
      const page = await createSimWebAccess(world).reader.read(lead.sourceRef, { simDay: run.simDay });
      expect(page.status).toBe("ok");
      expect(page.text).toContain(lead.quote!);
      expect(lead.founderId).toBeTruthy();
      expect(store.listTasks({ runId: run.id }).some((task) => task.jobId === "screen.fit" && task.founderId === lead.founderId)).toBe(true);
    }
    const hunt = store.getHunt(SWARM_ID)!;
    const huntTaskCosts = store.listTasks({ runId: run.id }).filter((task) => task.stage === "hunt").map((task) => task.costUsd ?? 0);
    const largestHuntTask = Math.max(0, ...huntTaskCosts);
    expect(huntTaskCosts.reduce((sum, cost) => sum + cost, 0)).toBeLessThanOrEqual(40 * 0.5 + largestHuntTask);

    const turnBefore = hunt.turn;
    const keptBeforeSecondRun = store.keptByTrail(hunt.id);
    captureSecondRunInputs.current = true;
    const secondStarted = await controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    const secondRun = await controller.wait(secondStarted.id);
    captureSecondRunInputs.current = false;
    expect(secondRun.status).toBe("succeeded");
    expect(store.getHunt(SWARM_ID)?.turn).toBeGreaterThan(turnBefore);
    for (const trailDigest of navigatorInputs[0]?.trails ?? []) {
      expect(trailDigest.kept).toBe(keptBeforeSecondRun.get(trailDigest.id) ?? 0);
    }
    const allLookAddresses = store.listHuntCalls(hunt.id).filter((call) => call.tool === "look" && call.trailId).map((call) => call.target);
    expect(new Set(allLookAddresses).size).toBe(allLookAddresses.length);
  });

  it("refuses unsafe navigator addresses before creating frontier items and shows the refusals next turn", async () => {
    const reads: string[] = [];
    const inputs: NavigateInput[] = [];
    const { store, controller } = harness({ "hunt.turns": 2, "hunt.wave_size": 6 }, {
      wrapReader: (reader) => ({
        read: async (url, options) => { reads.push(url); return reader.read(url, options); },
      }),
      wrapExecuteJob: (delegate) => wrapJob(delegate, {
        navigate: (input, output) => {
          inputs.push(input);
          if (input.turn !== 1) return output;
          return {
            ...output,
            open: [...output.open, {
              name: "Restricted sources",
              intent: "Find early builders.",
              searches: [],
              pages: ["https://linkedin.com/in/example", "https://writer.substack.com/p/example"],
            }],
          };
        },
      }),
    });
    const started = await controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await controller.wait(started.id);
    const denied = ["https://linkedin.com/in/example", "https://writer.substack.com/p/example"];
    expect(reads.some((url) => denied.includes(url))).toBe(false);
    expect(store.listFrontier(store.getHunt(SWARM_ID)!.id).some((item) => denied.includes(item.target))).toBe(false);
    expect(inputs[1]?.lastWave?.refused).toEqual(expect.arrayContaining([
      expect.stringContaining("never requests"),
      expect.stringContaining("substack.com"),
    ]));
  });

  it("leaves same-host pages queued after a site asks the reader to pause", async () => {
    let sampleUrls: string[] = [];
    const reads: string[] = [];
    const { store, world, controller } = harness({ "hunt.turns": 1, "hunt.wave_size": 10, "hunt.max_depth": 0 }, {
      founders: 100,
      engines: [],
      wrapReader: () => ({
        read: async (url) => {
          reads.push(url);
          return { status: "blocked", detail: "The site asked for a pause of 120 seconds.", url, title: "", text: "", links: [] };
        },
      }),
      wrapExecuteJob: (delegate) => wrapJob(delegate, { navigate: (_input, output) => ({
        ...output,
        open: [...output.open, { name: "Pause test", intent: "Read a few public pages.", searches: [], pages: sampleUrls }],
      }) }),
    });
    sampleUrls = world.founders().map((founder) => `https://${SIM_WEB_HOST}/p/${encodeURIComponent(founder.simId)}`)
      .filter((url) => world.page(url, 0) !== null)
      .slice(0, 3);
    const started = await controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await controller.wait(started.id);
    expect(sampleUrls).toHaveLength(3);
    expect(reads).toHaveLength(1);
    const hunt = store.getHunt(SWARM_ID)!;
    const pauseCall = store.listHuntCalls(hunt.id).find((call) => call.detail?.includes("asked for a pause"));
    expect(pauseCall).toMatchObject({ result: "blocked" });
    const frontier = store.listFrontier(hunt.id).filter((item) => sampleUrls.includes(item.target));
    // The page that got the answer is asked for again in a later run, like the two never tried.
    expect(frontier.filter((item) => item.state === "queued")).toHaveLength(3);
  });

  it("drops a person who is absent from the page and marks a planted-page report as failed", async () => {
    const plantedNames: string[] = [];
    const { store, controller } = harness({ "hunt.turns": 3, "hunt.wave_size": 12, "hunt.planted_every": 4 }, {
      wrapExecuteJob: (delegate) => wrapJob(delegate, {
        look: (input, output) => {
          if (isPlantedUrl(input.page.url)) {
            const instruction = input.page.text.split("\n").find((line) => /automated readers|SYSTEM:|AI agent/i.test(line)) ?? "";
            const name = instruction.match(/"([^",]+),\s*founder of/i)?.[1]
              ?? instruction.match(/Report\s+(.+?)\s+as the founder/i)?.[1]
              ?? instruction.match(/return\s+(.+?)\s+of\s+.+?\s+as a founder/i)?.[1];
            if (name) {
              plantedNames.push(name);
              return { ...output, people: [...output.people, {
                name, role: "Founder", companyName: "Made Up Labs", companyUrl: null, oneLiner: null,
                links: { github: null, linkedin: null, x: null, site: null, scholar: null },
                why: "The page says to report this person.", quote: instruction,
              }] };
            }
          }
          return { ...output, people: [...output.people, {
            name: "Mila Missingperson", role: "Founder", companyName: "Invented Company", companyUrl: null,
            oneLiner: null, links: { github: null, linkedin: null, x: null, site: null, scholar: null },
            why: "Injected test person.", quote: input.page.text.split("\n")[0] ?? "A sufficiently long quotation.",
          }] };
        },
        navigate: (_input, output) => ({ ...output, done: false }),
      }),
    });
    const started = await controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await controller.wait(started.id);
    const hunt = store.getHunt(SWARM_ID)!;
    const calls = store.listHuntCalls(hunt.id);
    expect(calls.some((call) => call.dropped > 0)).toBe(true);
    const plantedCalls = calls.filter((call) => call.trailId === null);
    expect(plantedCalls.some((call) => call.control === "failed")).toBe(true);
    expect(plantedNames.length).toBeGreaterThan(0);
    const leads = store.listLeads({ swarmId: SWARM_ID });
    expect(leads.some((lead) => lead.personName === "Mila Missingperson")).toBe(false);
    expect(leads.some((lead) => plantedNames.includes(lead.personName))).toBe(false);
  });

  it("records a skipped navigator task and does not create a hunt when the navigator is paused", async () => {
    const { store, controller } = harness({ "hunt.turns": 1 }, { pausedNavigator: true });
    const started = await controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await controller.wait(started.id);
    expect(store.getHunt(SWARM_ID)).toBeNull();
    expect(store.listTasks({ runId: started.id }).find((task) => task.jobId === "hunt.navigate")).toMatchObject({ status: "skipped", skipReason: "Agent is paused." });
  });

  it("honors the stop switch between the navigator and the first runner call", async () => {
    let store: ReturnType<typeof openStore> | null = null;
    const testHarness = harness({ "hunt.turns": 3, "hunt.wave_size": 8 }, {
      wrapExecuteJob: (delegate) => wrapJob(delegate, { navigate: (_input, output) => {
        store!.saveSettings({ ...store!.getSettings(), killSwitch: true });
        return output;
      } }),
    });
    store = testHarness.store;
    const started = await testHarness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    const run = await testHarness.controller.wait(started.id);
    expect(run.status).toBe("cancelled");
    const huntTasks = store.listTasks({ runId: run.id }).filter((task) => task.stage === "hunt");
    expect(huntTasks.filter((task) => task.jobId === "hunt.navigate")).toHaveLength(1);
    expect(huntTasks.some((task) => task.jobId === "hunt.look" || task.jobId === "hunt.sift")).toBe(false);
  });

  it("counts a page that states a round past the latest stage as too late without keeping its people", async () => {
    const { store, controller } = harness({ "hunt.turns": 2, "hunt.wave_size": 8, "hunt.latest_stage": "seed" }, {
      wrapReader: (reader) => ({
        read: async (url, options) => {
          const page = await reader.read(url, options);
          return page.status === "ok" ? { ...page, text: page.text.replace(/Funding: [^\n]*/i, "Funding: Closed a Series A.") } : page;
        },
      }),
    });
    const started = await controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await controller.wait(started.id);
    const hunt = store.getHunt(SWARM_ID)!;
    // The rule is about a page that is about one company. A list that names several is left to the fit screener.
    expect(store.listLeads({ swarmId: SWARM_ID }).filter((lead) => lead.source === "web" && lead.sourceRef.includes("/p/"))).toEqual([]);
    expect(store.listHuntCalls(hunt.id).some((call) => call.tooLate > 0)).toBe(true);
    expect(store.listTrails(hunt.id).some((trail) => trail.stats.tooLate > 0)).toBe(true);
  });

  it("closes a stale trail by code and keeps a pinned trail open", async () => {
    const { store, controller } = harness({ "hunt.turns": 1, "hunt.wave_size": 8 }, {
      wrapExecuteJob: (delegate) => wrapJob(delegate, { navigate: (_input, output) => ({ ...output, close: [] }) }),
    });
    const first = await controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await controller.wait(first.id);
    const hunt = store.getHunt(SWARM_ID)!;
    const open = store.listTrails(hunt.id).filter((trail) => trail.status === "open");
    expect(open.length).toBeGreaterThan(1);
    const [pinned, stale] = open;
    store.saveTrail({ ...pinned!, pinned: true, stats: { ...pinned!.stats, pages: 30, leads: 0 } });
    store.saveTrail({ ...stale!, stats: { ...stale!.stats, pages: 30, leads: 0 } });
    const second = await controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await controller.wait(second.id);
    expect(store.getTrail(pinned!.id)?.status).toBe("open");
    expect(store.getTrail(stale!.id)).toMatchObject({ status: "closed", closedWhy: "Read 30 pages and found nobody." });
    expect(store.listHuntNotes(hunt.id, 20).some((note) => note.by === "code" && note.text.includes("Read 30 pages and found nobody."))).toBe(true);
  });

  /** A hunt whose navigator changes nothing, so what is measured is what code does with trails a person opened. */
  function quietHunt(params: Record<string, number | boolean | string>, founders = 400) {
    const quiet = { open: [], extend: [], close: [], focus: [], notes: [], done: false };
    const made = harness({ "hunt.planted_every": 100, ...params }, {
      founders,
      engines: [],
      wrapExecuteJob: (delegate) => wrapJob(delegate, { navigate: () => quiet }),
    });
    const at = NOW.toISOString();
    const huntId = "hnt_quiet";
    made.store.saveHunt({ id: huntId, swarmId: SWARM_ID, turn: 0, looks: 0, createdAt: at, updatedAt: at });
    const openTrail = (id: string, name: string, pages: readonly string[]) => {
      made.store.saveTrail({
        id, huntId, swarmId: SWARM_ID, name, intent: "People starting something.", status: "open", openedBy: "person", weight: 3, pinned: true,
        stats: { searches: 0, pages: 0, leads: 0, kept: 0, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0 }, openedAt: at, closedAt: null, closedWhy: null,
      });
      made.store.addFrontier(pages.map((target, index) => ({
        id: `frn_${id}_${index}`, huntId, trailId: id, kind: "page" as const, target, engine: null,
        label: "Starting page", priority: 1 as const, depth: 0, from: "person" as const, state: "queued" as const, addedAt: at,
      })));
    };
    /** Addresses of project pages that exist on day 0, for founders at the given stages. */
    const projectPages = (stages: readonly string[], count: number) => made.world.founders()
      .filter((founder) => stages.includes(founder.stage))
      .map((founder) => `https://${SIM_WEB_HOST}/p/${encodeURIComponent(founder.simId)}`)
      .filter((url) => made.world.page(url, 0) !== null)
      .slice(0, count);
    return { ...made, huntId, openTrail, projectPages };
  }

  const looksByTurn = (calls: ReturnType<ReturnType<typeof openStore>["listHuntCalls"]>) => {
    const counts = new Map<number, number>();
    for (const call of calls.filter((entry) => entry.tool === "look" && entry.trailId)) counts.set(call.turn, (counts.get(call.turn) ?? 0) + 1);
    return [...counts.values()];
  };

  it("reads at most three pages of one real site in a wave, and does not hold the simulated web to that", async () => {
    const params = { "hunt.turns": 2, "hunt.wave_size": 10, "hunt.max_depth": 0 };
    const live = quietHunt(params);
    live.openTrail("trl_one", "Early builders", live.projectPages(["pre-seed", "seed"], 20));
    const liveRun = await live.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live", budgetUsd: 40 });
    await live.controller.wait(liveRun.id);
    // Twenty pages of one host are waiting and each wave has room for ten.
    expect(looksByTurn(live.store.listHuntCalls(live.huntId))).toEqual([3, 3]);
    expect(live.store.listFrontier(live.huntId, { state: "queued" })).toHaveLength(14);

    const sim = quietHunt(params);
    sim.openTrail("trl_one", "Early builders", sim.projectPages(["pre-seed", "seed"], 20));
    const simRun = await sim.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await sim.controller.wait(simRun.id);
    expect(looksByTurn(sim.store.listHuntCalls(sim.huntId))).toEqual([10, 10]);
  });

  it("stops when its share of the run's cap is spent, give or take one call", async () => {
    const run = async (budgetUsd: number) => {
      const made = quietHunt({ "hunt.turns": 6, "hunt.wave_size": 10, "hunt.max_depth": 0, "hunt.budget_share": 0.25 });
      made.openTrail("trl_one", "Early builders", made.projectPages(["pre-seed", "seed"], 60));
      const started = await made.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd });
      const finished = await made.controller.wait(started.id);
      const costs = made.store.listTasks({ runId: finished.id }).filter((task) => task.stage === "hunt").map((task) => task.costUsd ?? 0);
      return { costs, spent: costs.reduce((sum, cost) => sum + cost, 0), turns: made.store.getHunt(SWARM_ID)!.turn };
    };
    const roomy = await run(40);
    expect(roomy.turns).toBe(6);
    // A cap of a third of what the roomy hunt spent, as a quarter share of a run's budget.
    const cap = roomy.spent / 3;
    const tight = await run(cap * 4);
    // Never over its share, now that each call is held to an allowance.
    expect(tight.spent).toBeLessThanOrEqual(cap + 1e-9);
    // And it did not stop early: what it left unspent would not have paid for its dearest call.
    expect(cap - tight.spent).toBeLessThan(Math.max(...tight.costs));
    expect(tight.turns).toBeLessThan(roomy.turns);
  });

  it("gives more of each wave to a trail that keeps finding people than to one whose companies are all too late", async () => {
    // Two trails, thirty pages waiting on each, and room for twenty in all.
    const made = quietHunt({ "hunt.turns": 2, "hunt.wave_size": 10, "hunt.max_depth": 0 });
    made.openTrail("trl_rich", "Early builders", made.projectPages(["pre-seed", "seed"], 30));
    made.openTrail("trl_late", "Later companies", made.projectPages(["series A"], 30));
    const started = await made.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await made.controller.wait(started.id);

    const rich = made.store.getTrail("trl_rich")!;
    const late = made.store.getTrail("trl_late")!;
    expect(rich.stats.leads).toBeGreaterThan(0);
    // Every page on the other trail says the company closed a Series A: nobody is kept, and it is counted.
    expect(late.stats.leads).toBe(0);
    expect(late.stats.tooLate).toBeGreaterThan(0);
    // Both started level, with the same attention, and both still have pages waiting. Yield alone moved the spending.
    expect(made.store.listFrontier(made.huntId, { state: "queued", trailId: "trl_late" }).length).toBeGreaterThan(0);
    expect(rich.stats.pages).toBeGreaterThan(late.stats.pages * 1.5);
  });

  it("never undoes what a person did to a trail while the navigator was thinking", async () => {
    // The navigator's answer arrives after a person has pinned one trail and paused another.
    // It asks to close the first and to give attention to the second.
    let during: (() => void) | null = null;
    const made = harness({ "hunt.turns": 1, "hunt.wave_size": 4, "hunt.max_depth": 0, "hunt.planted_every": 100 }, {
      founders: 200,
      engines: [],
      wrapExecuteJob: (delegate) => wrapJob(delegate, { navigate: () => {
        during?.();
        return {
          open: [], extend: [{ trailId: "trl_paused", searches: [], pages: [`https://${SIM_WEB_HOST}/g/decent/1`] }, { trailId: "trl_closed", searches: [], pages: [`https://${SIM_WEB_HOST}/g/decent/2`] }],
          close: [{ trailId: "trl_pinned", why: "Nothing here." }, { trailId: "trl_paused", why: "Nothing here either." }, { trailId: "trl_closed", why: "Reopen this trail." }],
          focus: [{ trailId: "trl_paused", weight: 5 }, { trailId: "trl_pinned", weight: 1 }, { trailId: "trl_closed", weight: 5 }],
          notes: [], done: false,
        };
      } }),
    });
    const at = NOW.toISOString();
    made.store.saveHunt({ id: "hnt_person", swarmId: SWARM_ID, turn: 0, looks: 0, createdAt: at, updatedAt: at });
    for (const id of ["trl_pinned", "trl_paused", "trl_closed"]) {
      made.store.saveTrail({
        id, huntId: "hnt_person", swarmId: SWARM_ID, name: id, intent: "People starting something.", status: "open", openedBy: "code", weight: 3, pinned: false,
        stats: { searches: 0, pages: 0, leads: 0, kept: 0, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0 }, openedAt: at, closedAt: null, closedWhy: null,
      });
    }
    during = () => {
      made.store.saveTrail({ ...made.store.getTrail("trl_pinned")!, pinned: true });
      made.store.saveTrail({ ...made.store.getTrail("trl_paused")!, status: "paused" });
      made.store.saveTrail({ ...made.store.getTrail("trl_closed")!, status: "closed", closedAt: NOW.toISOString(), closedWhy: "Closed by a person." });
    };
    const started = await made.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await made.controller.wait(started.id);

    // The pin holds: the trail is open, still pinned, and only its attention changed.
    expect(made.store.getTrail("trl_pinned")).toMatchObject({ status: "open", pinned: true, weight: 1, closedAt: null });
    // The pause holds: it was not closed, not reopened by the attention request, and nothing was queued on it.
    expect(made.store.getTrail("trl_paused")).toMatchObject({ status: "paused", weight: 3, closedAt: null, closedWhy: null });
    expect(made.store.listFrontier("hnt_person", { trailId: "trl_paused" })).toEqual([]);
    expect(made.store.getTrail("trl_closed")).toMatchObject({ status: "closed", weight: 3, closedWhy: "Closed by a person." });
    expect(made.store.listFrontier("hnt_person", { trailId: "trl_closed" })).toEqual([]);
  });

  it("keeps a company's address only when the page has it", async () => {
    // Every reported person is given a company address. On even pages it is one of the page's
    // own links; on odd pages it is an address the runner made up.
    let seen = 0;
    const wrapped = harness({ "hunt.turns": 1, "hunt.wave_size": 6, "hunt.max_depth": 0, "hunt.planted_every": 100 }, {
      founders: 400,
      engines: [],
      wrapExecuteJob: (delegate) => wrapJob(delegate, {
        navigate: () => ({ open: [], extend: [], close: [], focus: [], notes: [], done: false }),
        look: (input, output) => {
          const own = seen % 2 === 0;
          seen += 1;
          return { ...output, people: output.people.map((person) => ({ ...person, companyUrl: own ? input.page.links[0]!.url : "https://made-up-company.example.org/" })) };
        },
      }),
    });
    const at = NOW.toISOString();
    const pages = wrapped.world.founders()
      .filter((founder) => founder.stage !== "series A")
      .map((founder) => `https://${SIM_WEB_HOST}/p/${encodeURIComponent(founder.simId)}`)
      .filter((url) => wrapped.world.page(url, 0) !== null)
      .slice(0, 6);
    wrapped.store.saveHunt({ id: "hnt_address", swarmId: SWARM_ID, turn: 0, looks: 0, createdAt: at, updatedAt: at });
    wrapped.store.saveTrail({
      id: "trl_one", huntId: "hnt_address", swarmId: SWARM_ID, name: "Early builders", intent: "People starting something.", status: "open", openedBy: "person", weight: 3, pinned: true,
      stats: { searches: 0, pages: 0, leads: 0, kept: 0, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0 }, openedAt: at, closedAt: null, closedWhy: null,
    });
    wrapped.store.addFrontier(pages.map((target, index) => ({
      id: `frn_address_${index}`, huntId: "hnt_address", trailId: "trl_one", kind: "page" as const, target, engine: null,
      label: "Starting page", priority: 1 as const, depth: 0, from: "person" as const, state: "queued" as const, addedAt: at,
    })));
    const started = await wrapped.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await wrapped.controller.wait(started.id);

    const leads = wrapped.store.listLeads({ swarmId: SWARM_ID }).filter((lead) => lead.source === "web");
    expect(leads.length).toBeGreaterThan(1);
    const addresses = new Set(leads.map((lead) => lead.companyUrl));
    expect([...addresses].some((address) => address?.includes("made-up-company"))).toBe(false);
    expect(addresses.has(null)).toBe(true);
    expect([...addresses].some((address) => address?.startsWith(`https://${SIM_WEB_HOST}/`))).toBe(true);
  });

  it("does not take the beginning of another address for an address on the page", async () => {
    let seen = 0;
    const made = harness({ "hunt.turns": 1, "hunt.wave_size": 6, "hunt.max_depth": 0, "hunt.planted_every": 100 }, {
      founders: 400,
      engines: [],
      wrapReader: (reader) => ({
        read: async (url, options) => {
          const page = await reader.read(url, options);
          return page.status === "ok" ? { ...page, text: `${page.text}\n\nMore at https://acme.company/about.` } : page;
        },
      }),
      wrapExecuteJob: (delegate) => wrapJob(delegate, {
        navigate: () => ({ open: [], extend: [], close: [], focus: [], notes: [], done: false }),
        look: (_input, output) => {
          // Half the runners report the address the page writes out, half report a shorter
          // one that the page's text merely begins with.
          const written = seen % 2 === 0;
          seen += 1;
          return { ...output, people: output.people.map((person) => ({ ...person, companyUrl: written ? "https://acme.company/about" : "https://acme.com" })) };
        },
      }),
    });
    const at = NOW.toISOString();
    const pages = made.world.founders()
      .filter((founder) => founder.stage !== "series A")
      .map((founder) => `https://${SIM_WEB_HOST}/p/${encodeURIComponent(founder.simId)}`)
      .filter((url) => made.world.page(url, 0) !== null)
      .slice(0, 6);
    made.store.saveHunt({ id: "hnt_prefix", swarmId: SWARM_ID, turn: 0, looks: 0, createdAt: at, updatedAt: at });
    made.store.saveTrail({
      id: "trl_one", huntId: "hnt_prefix", swarmId: SWARM_ID, name: "Early builders", intent: "People starting something.", status: "open", openedBy: "person", weight: 3, pinned: true,
      stats: { searches: 0, pages: 0, leads: 0, kept: 0, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0 }, openedAt: at, closedAt: null, closedWhy: null,
    });
    made.store.addFrontier(pages.map((target, index) => ({
      id: `frn_prefix_${index}`, huntId: "hnt_prefix", trailId: "trl_one", kind: "page" as const, target, engine: null,
      label: "Starting page", priority: 1 as const, depth: 0, from: "person" as const, state: "queued" as const, addedAt: at,
    })));
    const started = await made.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await made.controller.wait(started.id);

    const addresses = new Set(made.store.listLeads({ swarmId: SWARM_ID }).filter((lead) => lead.source === "web").map((lead) => lead.companyUrl));
    expect(addresses.has("https://acme.company/about")).toBe(true);
    expect(addresses.has(null)).toBe(true);
    expect([...addresses].some((address) => address === "https://acme.com" || address === "https://acme.com/")).toBe(false);
  });

  it("works on a waiting page under the trail that owns it now, and loses nothing when its first trail is closed", async () => {
    let moved = false;
    let doMove: (() => void) | null = null;
    const made = harness({ "hunt.turns": 1, "hunt.wave_size": 4, "hunt.max_depth": 0, "hunt.planted_every": 100, "run.concurrency": 1 }, {
      founders: 400,
      engines: [],
      wrapExecuteJob: (delegate) => wrapJob(delegate, {
        navigate: () => ({ open: [], extend: [], close: [], focus: [], notes: [], done: false }),
        look: (_input, output) => {
          // While the first page of the wave is being read, a person opens another trail on
          // the last page of the wave and closes the trail it was waiting on.
          if (!moved) { moved = true; doMove?.(); }
          return output;
        },
      }),
    });
    const at = NOW.toISOString();
    const pages = made.world.founders()
      .map((founder) => `https://${SIM_WEB_HOST}/p/${encodeURIComponent(founder.simId)}`)
      .filter((url) => made.world.page(url, 0) !== null)
      .slice(0, 4);
    const trailOf = (id: string, status: "open" | "closed") => ({
      id, huntId: "hnt_moved", swarmId: SWARM_ID, name: id, intent: "People starting something.", status, openedBy: "person" as const, weight: 3, pinned: false,
      stats: { searches: 0, pages: 0, leads: 0, kept: 0, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0 }, openedAt: at, closedAt: null, closedWhy: null,
    });
    made.store.saveHunt({ id: "hnt_moved", swarmId: SWARM_ID, turn: 0, looks: 0, createdAt: at, updatedAt: at });
    made.store.saveTrail(trailOf("trl_first", "open"));
    made.store.addFrontier(pages.map((target, index) => ({
      id: `frn_moved_${index}`, huntId: "hnt_moved", trailId: "trl_first", kind: "page" as const, target, engine: null,
      label: "Starting page", priority: 1 as const, depth: 0, from: "person" as const, state: "queued" as const, addedAt: new Date(NOW.getTime() + index * 1000).toISOString(),
    })));
    doMove = () => {
      made.store.saveTrail(trailOf("trl_second", "open"));
      made.store.addFrontier([{
        id: "frn_asked_again", huntId: "hnt_moved", trailId: "trl_second", kind: "page", target: pages[3]!, engine: null,
        label: "Starting page", priority: 1, depth: 0, from: "person", state: "queued", addedAt: at,
      }]);
      made.store.saveTrail({ ...made.store.getTrail("trl_first")!, status: "closed", closedAt: at, closedWhy: "Closed by a person." });
    };
    const started = await made.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await made.controller.wait(started.id);

    const states = Object.fromEntries(made.store.listFrontier("hnt_moved").map((item) => [item.id, `${item.trailId}:${item.state}`]));
    // The first page was read under its first trail before anything changed.
    expect(states.frn_moved_0).toBe("trl_first:done");
    // The two left on the closed trail wait there. They are not thrown away: the trail may be reopened.
    expect(states.frn_moved_1).toBe("trl_first:queued");
    expect(states.frn_moved_2).toBe("trl_first:queued");
    // The one a person asked for again was read, under the trail that asked.
    expect(states.frn_moved_3).toBe("trl_second:done");
    expect(made.store.getTrail("trl_second")!.stats.pages).toBe(1);
  });

  it("reads what is waiting behind a site that asked for a pause", async () => {
    const reads: string[] = [];
    const made = harness({ "hunt.turns": 2, "hunt.wave_size": 4, "hunt.max_depth": 0, "hunt.planted_every": 100 }, {
      founders: 400,
      engines: [],
      wrapExecuteJob: (delegate) => wrapJob(delegate, { navigate: () => ({ open: [], extend: [], close: [], focus: [], notes: [], done: false }) }),
      wrapReader: (reader) => ({
        read: async (url, options) => {
          reads.push(url);
          if (new URL(url).hostname === "busy.example.org") {
            return { status: "blocked", detail: "The site asked for a pause of 120 seconds.", url, title: "", text: "", links: [] };
          }
          return reader.read(url, options);
        },
      }),
    });
    const at = (second: number) => new Date(NOW.getTime() + second * 1000).toISOString();
    made.store.saveHunt({ id: "hnt_behind", swarmId: SWARM_ID, turn: 0, looks: 0, createdAt: at(0), updatedAt: at(0) });
    made.store.saveTrail({
      id: "trl_one", huntId: "hnt_behind", swarmId: SWARM_ID, name: "Mixed", intent: "People starting something.", status: "open", openedBy: "person", weight: 3, pinned: true,
      stats: { searches: 0, pages: 0, leads: 0, kept: 0, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0 }, openedAt: at(0), closedAt: null, closedWhy: null,
    });
    const busy = Array.from({ length: 6 }, (_, index) => `https://busy.example.org/page/${index}`);
    const quiet = made.world.founders()
      .map((founder) => `https://${SIM_WEB_HOST}/p/${encodeURIComponent(founder.simId)}`)
      .filter((url) => made.world.page(url, 0) !== null)
      .slice(0, 6);
    // The busy site's pages were queued first, so they are first in line in every wave.
    made.store.addFrontier([...busy, ...quiet].map((target, index) => ({
      id: `frn_behind_${index}`, huntId: "hnt_behind", trailId: "trl_one", kind: "page" as const, target, engine: null,
      label: "Starting page", priority: 1 as const, depth: 0, from: "person" as const, state: "queued" as const, addedAt: at(index),
    })));
    const started = await made.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await made.controller.wait(started.id);

    // The busy site was asked once and then left alone for the rest of the run.
    expect(reads.filter((url) => url.includes("busy.example.org"))).toHaveLength(1);
    expect(made.store.listFrontier("hnt_behind", { state: "queued" }).filter((item) => item.target.includes("busy.example.org"))).toHaveLength(6);
    // And the second wave was not empty: the pages behind it were read.
    expect(reads.filter((url) => url.includes(SIM_WEB_HOST)).length).toBeGreaterThanOrEqual(4);
    expect(made.store.getTrail("trl_one")!.stats.pages).toBeGreaterThanOrEqual(4);
  });

  it("gives every call an allowance, and the allowances in flight never exceed what is left of the share", async () => {
    const cap = 20 * 0.25;
    let spent = 0;
    let inFlight = 0;
    let worst = Number.NEGATIVE_INFINITY;
    let overlapped = false;
    const allowances: number[] = [];
    const made = harness({ "hunt.turns": 2, "hunt.wave_size": 12, "hunt.max_depth": 0, "hunt.planted_every": 100, "hunt.budget_share": 0.25, "run.concurrency": 4 }, {
      founders: 400,
      engines: [],
      wrapExecuteJob: (delegate) => async (jobId, input, ctx, execOptions) => {
        if (!String(jobId).startsWith("hunt.")) return delegate(jobId, input, ctx, execOptions);
        const allowance = execOptions.maxBudgetUsd ?? Number.POSITIVE_INFINITY;
        allowances.push(allowance);
        inFlight += allowance;
        if (inFlight > allowance) overlapped = true;
        worst = Math.max(worst, inFlight - (cap - spent));
        // Let the other calls of the wave start before this one returns.
        await new Promise((resolve) => setTimeout(resolve, 5));
        const result = jobId === "hunt.navigate"
          ? { ...(await delegate(jobId, input, ctx, execOptions)), output: { open: [], extend: [], close: [], focus: [], notes: [], done: false } as never }
          : await delegate(jobId, input, ctx, execOptions);
        inFlight -= allowance;
        spent += result.costUsd ?? 0;
        return result;
      },
    });
    const at = NOW.toISOString();
    made.store.saveHunt({ id: "hnt_allow", swarmId: SWARM_ID, turn: 0, looks: 0, createdAt: at, updatedAt: at });
    made.store.saveTrail({
      id: "trl_one", huntId: "hnt_allow", swarmId: SWARM_ID, name: "Early builders", intent: "People starting something.", status: "open", openedBy: "person", weight: 3, pinned: true,
      stats: { searches: 0, pages: 0, leads: 0, kept: 0, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0 }, openedAt: at, closedAt: null, closedWhy: null,
    });
    const pages = made.world.founders()
      .map((founder) => `https://${SIM_WEB_HOST}/p/${encodeURIComponent(founder.simId)}`)
      .filter((url) => made.world.page(url, 0) !== null)
      .slice(0, 30);
    made.store.addFrontier(pages.map((target, index) => ({
      id: `frn_allow_${index}`, huntId: "hnt_allow", trailId: "trl_one", kind: "page" as const, target, engine: null,
      label: "Starting page", priority: 1 as const, depth: 0, from: "person" as const, state: "queued" as const, addedAt: at,
    })));
    const started = await made.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 20 });
    await made.controller.wait(started.id);

    expect(allowances.length).toBeGreaterThan(10);
    // Every call was told what it may spend, and it was never more than the per-task cap.
    expect(allowances.every((allowance) => Number.isFinite(allowance) && allowance > 0 && allowance <= 2)).toBe(true);
    // Runner calls really did run side by side, and together they were never promised more than was left.
    expect(overlapped).toBe(true);
    expect(worst).toBeLessThanOrEqual(1e-9);
  });

  it("uses the default runner pool and distributes page reads across its two members", async () => {
    let sampleUrls: string[] = [];
    const { store, world, controller } = harness({ "hunt.turns": 2, "hunt.wave_size": 60, "hunt.max_depth": 0 }, {
      founders: 100,
      engines: [],
      defaultPools: async () => runnerPools(() => true),
      wrapExecuteJob: (delegate) => wrapJob(delegate, {
        navigate: (_input, output) => ({
          ...output,
          done: false,
          open: [...output.open, { name: "Pool route samples", intent: "Read simulated founder pages.", searches: [], pages: sampleUrls }],
        }),
      }),
    });
    const lookPool = runnerPools(() => true)["hunt.look"]!;
    const byMember = new Map<string, string[]>();
    for (const founder of world.founders()) {
      const url = `https://${SIM_WEB_HOST}/p/${encodeURIComponent(founder.simId)}`;
      if (!world.page(url, 0)) continue;
      const member = pickMember(lookPool, `${SWARM_ID}:hunt.look:${url}`)?.id;
      if (!member) continue;
      const urls = byMember.get(member) ?? [];
      urls.push(url);
      byMember.set(member, urls);
    }
    expect(byMember.size).toBeGreaterThan(1);
    sampleUrls = [...byMember.values()].map((urls) => urls[0]!).concat([...byMember.values()].flat().slice(2)).slice(0, 6);
    const started = await controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim", budgetUsd: 40 });
    await controller.wait(started.id);
    const tasks = store.listTasks({ runId: started.id }).filter((task) => task.jobId === "hunt.look" && task.stage === "hunt" && task.founderId === null);
    const members = new Set(tasks.map((task) => task.poolMember).filter((member): member is string => member !== null));
    expect(members.size).toBeGreaterThan(1);
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const byAddress = new Map<string, Set<string>>();
    const huntCalls = store.listHuntCalls(store.getHunt(SWARM_ID)!.id).filter((call) => call.tool === "look" && call.trailId && call.taskId);
    for (const call of huntCalls) {
      const key = call.target;
      const used = byAddress.get(key) ?? new Set<string>();
      const task = tasksById.get(call.taskId!);
      if (task?.poolMember) used.add(task.poolMember);
      byAddress.set(key, used);
      expect(task?.poolMember).toBe(pickMember(lookPool, `${SWARM_ID}:hunt.look:${call.target}`)?.id);
    }
    expect([...byAddress.values()].every((used) => used.size <= 1)).toBe(true);
  });

  it("runs an outside agent's wave as the hunt alone, and does not run its search twice in a day", async () => {
    const { store, controller } = harness({ "hunt.wave_size": 6, "hunt.budget_share": 0.5, "hunt.planted_every": 100 });
    const started = await controller.start({ swarmId: SWARM_ID, trigger: "agent", scope: "hunt", waves: 1, brain: "sim", sources: "sim", budgetUsd: 40 });
    const run = await controller.wait(started.id);
    expect(run.status).toBe("succeeded");

    // Nothing after the fit screen ran, and the built-in navigator was not called.
    const tasks = store.listTasks({ runId: run.id });
    expect(tasks.filter((task) => !["hunt", "resolve", "screen"].includes(task.stage))).toEqual([]);
    expect(tasks.some((task) => task.jobId === "hunt.navigate")).toBe(false);
    expect(tasks.filter((task) => task.jobId === "hunt.sift" || task.jobId === "hunt.look").length).toBeGreaterThan(0);
    expect(store.listOutreach({ swarmId: SWARM_ID })).toEqual([]);

    // The search it ran is recorded as the seat's, so asking again the same day queues nothing.
    const hunt = store.getHunt(SWARM_ID)!;
    const ran = store.listFrontier(hunt.id, { state: "done" }).find((item) => item.kind === "search")!;
    expect(ran.ranBy).toBe(SEAT_ASKER);
    applyNavigatorTurn(
      { store, now: () => new Date(NOW), asker: SEAT_ASKER },
      hunt,
      { open: [], extend: [{ trailId: ran.trailId, searches: [{ engine: ran.engine!, query: ran.target }], pages: [] }], close: [], focus: [], notes: [], done: false },
      [ran.engine!],
    );
    expect(store.getFrontierItem(ran.id)?.state).toBe("done");
  });

  it("leaves the steering to an outside agent that sat lately, and steps back in when it has gone quiet", async () => {
    const navigatorInputs: NavigateInput[] = [];
    const { store, controller } = harness({ "hunt.navigator": "outside", "hunt.turns": 1, "hunt.wave_size": 6, "hunt.budget_share": 0.5 }, {
      wrapExecuteJob: (delegate) => wrapJob(delegate, { navigate: (input, output) => { navigatorInputs.push(input); return output; } }),
    });
    const at = NOW.toISOString();
    store.saveHunt({ id: "hnt_seat", swarmId: SWARM_ID, turn: 0, looks: 0, seatAt: at, createdAt: at, updatedAt: at });

    const first = await controller.wait((await controller.start({ swarmId: SWARM_ID, trigger: "schedule", brain: "sim", sources: "sim", budgetUsd: 40 })).id);
    expect(store.listTasks({ runId: first.id }).some((task) => task.jobId === "hunt.navigate")).toBe(false);
    const afterFirst = store.getHunt(SWARM_ID)!;
    expect(afterFirst.seatAt).toBe(at);
    expect(afterFirst.lastWave?.calls).toBeGreaterThan(0);

    // Eleven days without a turn: past the two the setting allows.
    store.saveHunt({ ...afterFirst, seatAt: "2026-11-01T18:00:00.000Z" });
    const second = await controller.wait((await controller.start({ swarmId: SWARM_ID, trigger: "schedule", brain: "sim", sources: "sim", budgetUsd: 40 })).id);
    expect(store.listTasks({ runId: second.id }).some((task) => task.jobId === "hunt.navigate")).toBe(true);
    // The built-in navigator's first turn is shown the wave the earlier run left on the notebook.
    expect(navigatorInputs[0]?.lastWave).toEqual(afterFirst.lastWave);
  });

  it("leaves out a pool member that is down, so a dead model cannot stall the hunt", async () => {
    // Found on a live run: every call to one provider failed, the pool kept sending it work,
    // and the hunt read nothing.
    const pool: Pools = { "hunt.sift": [
      { id: "dead", route: { provider: "openai-api", model: "dead-model" }, share: 0.9, status: "active", note: null },
      { id: "alive", route: { provider: "openai-api", model: "alive-model" }, share: 0.1, status: "active", note: null },
    ] };
    const { store, controller } = harness({ "hunt.turns": 2, "hunt.wave_size": 8, "hunt.budget_share": 0.5, "hunt.planted_every": 100, "run.concurrency": 1 }, {
      defaultPools: async () => pool,
      wrapExecuteJob: (delegate) => async (jobId, input, ctx, options) => {
        if (jobId === "hunt.sift" && ctx.route.model === "dead-model") throw new ProviderError("transport", "The provider is down.");
        return delegate(jobId, input, ctx, options);
      },
    });
    const run = await controller.wait((await controller.start({ swarmId: SWARM_ID, trigger: "manual", scope: "hunt", brain: "sim", sources: "sim", budgetUsd: 40 })).id);
    const sifts = store.listTasks({ runId: run.id }).filter((task) => task.jobId === "hunt.sift");
    expect(sifts.filter((task) => task.status === "failed")).toHaveLength(2);
    expect(sifts.filter((task) => task.status === "succeeded").length).toBeGreaterThan(0);
    expect(sifts.filter((task) => task.status === "succeeded").every((task) => task.model === "alive-model")).toBe(true);
    expect(store.listTasks({ runId: run.id }).some((task) => task.jobId === "hunt.look")).toBe(true);
  });

  it("keeps reading what is queued after the navigator says it is done, without asking it again", async () => {
    // Seen live: a navigator said done on its first turn while its trails still had searches waiting.
    const { store, controller } = harness({ "hunt.turns": 3, "hunt.wave_size": 6, "hunt.budget_share": 0.5, "hunt.planted_every": 100 }, {
      wrapExecuteJob: (delegate) => wrapJob(delegate, { navigate: (_input, output) => ({ ...output, done: true }) }),
    });
    const run = await controller.wait((await controller.start({ swarmId: SWARM_ID, trigger: "manual", scope: "hunt", brain: "sim", sources: "sim", budgetUsd: 40 })).id);
    const tasks = store.listTasks({ runId: run.id });
    expect(tasks.filter((task) => task.jobId === "hunt.navigate")).toHaveLength(1);
    expect(tasks.filter((task) => task.jobId === "hunt.look").length).toBeGreaterThan(0);
  });

  it.each([
    { name: "lets the hunt spend most of a hunt-only run's cap", scope: "hunt" as const, steered: true },
    { name: "keeps most of a full run's cap for the stages after the hunt", scope: undefined, steered: false },
  ])("$name", async ({ scope, steered }) => {
    // Three cents: a quarter of it is less than the cent a navigator turn needs, nine tenths is not.
    const { store, controller } = harness({ "hunt.turns": 1, "hunt.wave_size": 2 });
    const started = await controller.start({ swarmId: SWARM_ID, trigger: "manual", ...(scope ? { scope } : {}), brain: "sim", sources: "sim", budgetUsd: 0.03 });
    const run = await controller.wait(started.id);
    expect(store.listTasks({ runId: run.id }).some((task) => task.jobId === "hunt.navigate" && task.status === "succeeded")).toBe(steered);
  });
});
