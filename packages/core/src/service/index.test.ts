import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BASE_CONFIG, DEFAULT_SETTINGS, JOBS, PROVIDERS, ZERO_STATS, newId, stableId, runnerPools,
  type Agent, type Assessment, type Company, type CompanyAssessment, type CompanyMember, type EvalFlowDTO,
  type Evidence, type Feedback, type Founder, type NetworkContact, type OutreachAction, type Run,
  type Swarm, type SwarmConfig, type TaskRun, type Pools, type NavigateTurn,
} from "@agentswarm/shared";
import type { Dialler, EvalService, ProviderRegistry, RunController, SourceRegistry, ServiceDeps, Store } from "../contracts";
import { openStore } from "../db";
import { ServiceError } from "../contracts";
import { createSimDialler, createSimWorld } from "../sim";
import { createApp, createSwarmService } from "./index";
import { createRecordingService } from "./recordings";
import { createMediaFetcher } from "../sources/media";

const fixedAt = new Date("2026-11-12T18:00:00.000Z");
const stamp = fixedAt.toISOString();
const cron = { isValid: (value: string) => value === "0 6 * * *", next: () => "2026-11-13T06:00:00.000Z" };

function harness(defaultPools?: () => Promise<Pools>, existingSwarm = false, dialler?: ServiceDeps["dialler"], callbackNumber: string | null = "+14155550100", fundName: string | null = "Northstar Ventures") {
  const store = openStore(":memory:");
  const refused = new Set<string>();
  let sourceConfigured = true;
  const providers: ProviderRegistry = { get: () => { throw new Error("unused"); }, statuses: async () => PROVIDERS.map((item) => ({ id: item.id, label: item.label, configured: true, detail: "ready" })) };
  const liveSources: SourceRegistry = { get: () => null, statuses: async () => [
    { id: "hackernews", label: "Hacker News", configured: sourceConfigured, detail: sourceConfigured ? "ready" : "missing credentials" },
    { id: "github", label: "GitHub", configured: sourceConfigured, detail: sourceConfigured ? "ready" : "missing credentials" },
    { id: "arxiv", label: "arXiv", configured: sourceConfigured, detail: sourceConfigured ? "ready" : "missing credentials" },
    { id: "people_data", label: "Professional profiles", configured: sourceConfigured, detail: sourceConfigured ? "ready" : "missing credentials" },
  ] };
  const runs: RunController = {
    async start(input) {
      if (refused.has(input.swarmId)) throw new Error("Already running");
      const run: Run = { id: newId("run"), swarmId: input.swarmId, trigger: input.trigger, brain: input.brain ?? "sim", sources: input.sources ?? "sim", status: "queued", stage: null, configId: store.getSwarm(input.swarmId)?.configId ?? BASE_CONFIG.id, budgetUsd: input.budgetUsd ?? 25, costUsd: 0, stats: { ...ZERO_STATS }, error: null, simDay: null, startedAt: stamp, finishedAt: null };
      store.insertRun(run);
      return run;
    },
    async cancel(id) { return store.updateRun(id, { status: "cancelled" }); },
    async wait(id) { return store.getRun(id)!; },
    async recover() { return 0; },
  };
  let evalFlows: EvalFlowDTO[] = [];
  let promotedConfig: SwarmConfig = { ...BASE_CONFIG, id: "cfg_variant", label: "Variant" };
  type RoundInput = Parameters<EvalService["runRounds"]>[1];
  type RoundRunner = (flow: EvalFlowDTO, input: RoundInput) => EvalFlowDTO;
  type AsyncRoundRunner = (flow: EvalFlowDTO, input: RoundInput) => Promise<EvalFlowDTO>;
  let roundRunner: RoundRunner = (flow) => flow;
  let asyncRoundRunner: AsyncRoundRunner | null = null;
  const flowRunners = new Map<string, RoundRunner>();
  const roundErrors = new Map<string, Error>();
  const variantConfigs = new Map<string, SwarmConfig>();
  const roundCalls: Array<{ flowId: string; input: RoundInput }> = [];
  let listFlowsCalls = 0;
  let lastRoundInput: Parameters<EvalService["runRounds"]>[1];
  const evals: EvalService = {
    listFlows: async () => {
      listFlowsCalls += 1;
      return evalFlows.map((flow) => ({ id: flow.id, label: flow.label, description: flow.description, headlineMetric: flow.headlineMetric, baseline: flow.baseline, best: flow.best, rounds: flow.rounds, updatedAt: flow.updatedAt, contamination: flow.contamination, realData: flow.realData }));
    },
    getFlow: async (id) => { const flow = evalFlows.find((candidate) => candidate.id === id); if (!flow) throw new Error("No flow"); return flow; },
    runRounds: async (id, input) => {
      const flow = evalFlows.find((candidate) => candidate.id === id);
      if (!flow) throw new Error("No flow");
      lastRoundInput = input;
      roundCalls.push({ flowId: id, input });
      const error = roundErrors.get(id);
      if (error) throw error;
      const updated = asyncRoundRunner ? await asyncRoundRunner(flow, input) : (flowRunners.get(id) ?? roundRunner)(flow, input);
      evalFlows = evalFlows.map((candidate) => candidate.id === id ? updated : candidate);
      return updated;
    },
    variantConfig: async (id) => variantConfigs.get(id) ?? promotedConfig,
  };
  let clock = fixedAt;
  if (existingSwarm) {
    const swarm: Swarm = { id: "swm_legacy", name: "Legacy", status: "active", thesis, configId: BASE_CONFIG.id, createdAt: stamp, updatedAt: stamp };
    store.insertSwarm(swarm);
    store.insertAgent({ id: "agt_legacy_scout", swarmId: swarm.id, jobId: "scout.github", classId: "scout", name: "GitHub", status: "active", beat: null, state: {}, createdAt: stamp });
  }
  const recordings = createRecordingService({
    store,
    dataDir: "/tmp/agentswarm-service-tests",
    maxBytes: 150 * 1024 * 1024,
    checkAddress: async (url) => ({ url, addresses: ["93.184.216.34"] }),
  });
  const service = createSwarmService({ store, runs, evals, providers, liveSources, recordings, ...(dialler ? { dialler } : {}), fundName, callbackNumber, ...(defaultPools ? { defaultPools } : {}), cron, now: () => clock });
  return {
    store, service, refused,
    setNow: (at: Date) => { clock = at; },
    setFlow: (flow: EvalFlowDTO) => { evalFlows = [flow]; },
    setFlows: (flows: EvalFlowDTO[]) => { evalFlows = [...flows]; },
    setVariant: (config: SwarmConfig) => { promotedConfig = config; },
    setVariantForFlow: (flowId: string, config: SwarmConfig) => { variantConfigs.set(flowId, config); },
    setRoundRunner: (runner: RoundRunner) => { roundRunner = runner; },
    setRoundRunnerAsync: (runner: AsyncRoundRunner) => { asyncRoundRunner = runner; },
    setRoundRunnerForFlow: (flowId: string, runner: RoundRunner) => { flowRunners.set(flowId, runner); },
    setRoundError: (flowId: string, error: Error) => { roundErrors.set(flowId, error); },
    lastRoundInput: () => lastRoundInput,
    roundCalls: () => roundCalls,
    evalActivity: () => ({ listFlowsCalls, roundCalls: [...roundCalls] }),
    setSourceConfigured: (configured: boolean) => { sourceConfigured = configured; },
  };
}

const thesis = { summary: "AI tools", sectors: [" AI ", "AI", "Tools"], stages: ["Pre-seed"], geos: [], avoid: [] };
const founderRecord = (swarmId: string, id = newId("fnd"), status: Founder["status"] = "surfaced"): Founder => ({
  id, swarmId, name: "Ari Founder", headline: "Builds AI systems", location: null,
  company: { name: "Vector Works", url: null, oneLiner: "a vector index for robot logs", stage: "Pre-seed" },
  links: { github: null, linkedin: null, x: null, site: null, scholar: null }, status, fit: 0.8, fitReasons: [], tags: [], identityConfidence: 1, sources: ["github"], firstSeenAt: stamp, updatedAt: stamp, lastAssessedAt: null, nextRecheckAt: null, simId: null,
});
function assessment(founderId: string, decision: Assessment["decision"] = "surface"): Assessment {
  return { id: newId("asm"), founderId, runId: null, configId: BASE_CONFIG.id, composite: 0.8, cracked: 0.75, founderScore: 0.8, coverage: 0.9, potential: 0.8, fit: 0.8, decision, reasons: [], flags: [], breakdown: [], judgments: [], summary: "Strong technical founder", memo: null, createdAt: stamp };
}
function runRecord(swarmId: string, overrides: Partial<Run> = {}): Run {
  return { id: newId("run"), swarmId, trigger: "manual", brain: "sim", sources: "sim", status: "running", stage: "scout", configId: BASE_CONFIG.id, budgetUsd: 25, costUsd: 0.2, stats: { ...ZERO_STATS }, error: null, simDay: null, startedAt: stamp, finishedAt: null, ...overrides };
}
function taskRecord(run: Run, agent: Agent, status: TaskRun["status"], stage: TaskRun["stage"] = "scout"): TaskRun {
  return { id: newId("tsk"), runId: run.id, swarmId: run.swarmId, agentId: agent.id, jobId: agent.jobId, classId: agent.classId, stage, founderId: null, status, skipReason: null, attempt: 1, provider: "sim", model: "sim", effort: null, inputSummary: "input", outputSummary: status === "succeeded" ? "found a lead" : null, output: null, steering: { directiveIds: [], params: {}, block: "" }, usage: null, costUsd: status === "failed" ? 0.1 : 0.05, latencyMs: 1, itemsOut: status === "succeeded" ? 1 : 0, error: status === "failed" ? "provider error" : null, startedAt: stamp, finishedAt: stamp };
}
function companyRecord(swarmId: string, id = newId("cmp"), status: Company["status"] = "tracked", name = "Vector Works"): Company {
  return { id, swarmId, name, domain: "vector.example", url: "https://vector.example", oneLiner: "A vector index", mission: null, tagline: null, sector: "AI infrastructure", stage: "Pre-seed", links: { github: null, x: null, linkedin: null, docs: null, careers: null }, status, firstSeenAt: stamp, updatedAt: stamp, lastResearchedAt: null, lastAssessedAt: null, nextRecheckAt: null, simId: null };
}
function companyAssessment(companyId: string, leadFounderId: string | null, deal: number, decision: CompanyAssessment["decision"] = "surface"): CompanyAssessment {
  return { id: newId("cas"), companyId, runId: null, configId: BASE_CONFIG.id, company: deal, companyCoverage: 0.8, companyPotential: deal, leadFounderId, team: 0.7, deal, coverage: 0.8, potential: deal, decision, reasons: [], flags: [], breakdown: [], judgments: [], brief: { summary: "A promising company", moat: null, strengths: [], risks: [], openQuestions: [] }, createdAt: stamp };
}
function companyMember(companyId: string, name: string): CompanyMember {
  return { id: newId("mem"), companyId, name, role: "Founder", isFounder: true, founderId: null, links: { github: null, linkedin: null, x: null, site: null, scholar: null }, background: null, source: "web", sourceUrl: "https://vector.example/team", addedAt: stamp };
}
function companyEvidence(founderId: string, companyId: string, id: string, capturedAt: string): Evidence {
  return { id, founderId, companyId, facet: "product", kind: "launch", source: "web", url: "https://vector.example", title: id, excerpt: "A product launch", claim: "The company launched a product.", publishedAt: null, capturedAt, collectedByTaskId: null, hash: id, verification: "supported", verificationNote: null, sim: null };
}
function evalFlowRecord(id: string, options: { realData?: boolean; latestCostUsd?: number; callsModels?: boolean } = {}): EvalFlowDTO {
  const realData = options.realData ?? false;
  const baseline = { id: "baseline", round: 0, description: "Baseline", rationale: "Starting point", status: "baseline" as const, train: {}, test: {}, testInterval: null, costUsd: options.latestCostUsd ?? 0, config: BASE_CONFIG, changes: [], createdAt: stamp };
  return {
    id, label: id, description: `${id} eval`, headlineMetric: "agreement", baseline: 0.5, best: 0.5, rounds: 0, updatedAt: stamp,
    metrics: [], goal: { target: "agreement", direction: "higher", hold: [] }, cases: { train: 8, test: 8, reps: 1 }, noiseFloor: null,
    dataNote: realData ? "Replays real partner calls." : "Synthetic founders with known outcomes.", realData,
    callsModels: options.callsModels ?? false,
    variants: [baseline], bestVariant: "baseline", promotedVariant: null, narrative: "",
  };
}
function keptWinner(flow: EvalFlowDTO, costUsd = 0): EvalFlowDTO {
  const baseline = flow.variants.at(-1)!;
  const winner = { ...baseline, id: "v1", round: flow.rounds + 1, description: "Raise the fit threshold", rationale: "Held-out score improved", status: "champion" as const, costUsd, changes: ["Raise the fit threshold"] };
  return { ...flow, rounds: flow.rounds + 1, variants: [...flow.variants, winner], bestVariant: winner.id };
}
function contactCsv(rows: string[][]): string {
  return ["First Name,Last Name,URL,Company,Position,Connected On,Email", ...rows.map((row) => [...row, row[6] ?? ""].map((value) => `"${value.replaceAll('"', '""')}"`).join(","))].join("\n");
}
function expectServiceError(promise: Promise<unknown>, status: number, field?: string) {
  return promise.then(() => { throw new Error("Expected ServiceError"); }, (error: unknown) => {
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(status);
    if (field) expect((error as ServiceError).fields).toHaveProperty(field);
  });
}

const opened: ReturnType<typeof harness>[] = [];
function createHarness(defaultPools?: () => Promise<Pools>, existingSwarm = false, dialler?: ServiceDeps["dialler"], callbackNumber?: string | null, fundName?: string | null) { const item = harness(defaultPools, existingSwarm, dialler, callbackNumber, fundName); opened.push(item); return item; }
afterEach(() => { for (const item of opened.splice(0)) item.service.close(); });

describe("createSwarmService", () => {
  it("refuses unsafe links and stores uploads under generated names in the founder's recording list", async () => {
    const { service, store } = createHarness();
    await service.ensureSeeded();
    const swarm = store.listSwarms()[0]!;
    const founder = founderRecord(swarm.id, "fnd_recording_intake");
    store.insertFounder(founder);
    const dataDir = await mkdtemp(join(tmpdir(), "agentswarm-recordings-"));
    try {
      const media = createMediaFetcher({
        resolveHost: async () => ["93.184.216.34"],
        sleep: async () => undefined,
      });
      const recordings = createRecordingService({
        store,
        dataDir,
        maxBytes: 1024,
        checkAddress: media.checkAddress,
        now: () => fixedAt,
      });

      await expectServiceError(recordings.addLink("Partner", founder.id, { title: "Founder talk", kind: "talk", url: "http://127.0.0.1/private.mp3" }), 400, "url");
      await expectServiceError(recordings.addLink("Partner", founder.id, { title: "I was born in 1984", kind: "talk", url: "https://media.example.com/talk.mp3" }), 400, "title");
      expect(recordings.list("Partner", founder.id)).toEqual([]);
      const linked = await recordings.addLink("Partner", founder.id, { title: "Founder interview", kind: "interview", url: "https://media.example.com/interview.mp3" });
      await expectServiceError(recordings.upload("Partner", founder.id, { title: "Too large", kind: "talk", contentType: "audio/mpeg", data: new Uint8Array(1025) }), 413, "file");
      const data = new Uint8Array([1, 2, 3, 4]);
      const uploaded = await recordings.upload("Partner", founder.id, { title: "Founder talk", kind: "talk", contentType: "audio/mpeg", data });
      const generatedPath = join(dataDir, "recordings", `${uploaded.id}.media`);

      expect(uploaded.sourceUrl).toBeNull();
      expect(uploaded.id).toMatch(/^rcd_[0-9a-z]{12}$/);
      expect(await readFile(generatedPath)).toEqual(Buffer.from(data));
      expect(recordings.list("Partner", founder.id).map((recording) => recording.id).sort()).toEqual([linked.id, uploaded.id].sort());

      await recordings.remove("Partner", uploaded.id);
      expect(recordings.list("Partner", founder.id).map((recording) => recording.id)).toEqual([linked.id]);
      await expect(readFile(generatedPath)).rejects.toThrow();
      expect(store.recentAudit(8).map((entry) => entry.action)).toContain("recording.remove");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("backfills enabled jobs for both legacy and partially upgraded swarms", async () => {
    const { service, store } = createHarness(undefined, true);
    const agents = store.listAgents("swm_legacy");

    expect(agents.map((agent) => agent.jobId).sort()).toEqual(JOBS.filter((job) => job.enabled).map((job) => job.id).sort());
    expect(agents.find((agent) => agent.id === "agt_legacy_scout")).toBeDefined();
    expect(agents.filter((agent) => agent.jobId === "hunt.navigate")).toHaveLength(1);
    expect(agents.filter((agent) => agent.jobId === "hunt.look")).toHaveLength(1);
    expect(agents.filter((agent) => agent.jobId === "hunt.sift")).toHaveLength(1);

    const api = service.as("Partner");
    const older: Swarm = { id: newId("swm"), name: "Partially upgraded", status: "active", thesis, configId: BASE_CONFIG.id, createdAt: stamp, updatedAt: stamp };
    store.insertSwarm(older);
    const newJobs = new Set(["company.product", "company.traction", "company.team", "assess.company"]);
    for (const job of JOBS.filter((item) => !newJobs.has(item.id))) {
      store.insertAgent({ id: newId("agt"), swarmId: older.id, jobId: job.id, classId: job.classId, name: job.label, status: "active", beat: null, state: {}, createdAt: stamp });
    }
    await api.getTree(older.id);
    const upgradedIds = store.listAgents(older.id).map((agent) => agent.jobId);
    expect([...upgradedIds].filter((id) => newJobs.has(id))).toEqual(["company.product", "company.traction", "company.team", "assess.company"]);
    await api.getOverview(older.id);
    expect(store.listAgents(older.id).filter((agent) => newJobs.has(agent.jobId))).toHaveLength(4);
  });

  it("keeps outside turns in the navigator seat and applies only checked requests", async () => {
    const { service, store } = createHarness();
    await service.ensureSeeded();
    const api = service.as("Seat agent");
    const swarm = (await api.listSwarms())[0]!;
    await api.addHuntTrail(swarm.id, { name: "Pinned path", pages: ["https://founders-example.com/start"] });
    const pageBody = "Private page body: founder shipped a database engine from scratch.";
    const hiddenFounder = founderRecord(swarm.id, "fnd_hidden_page_text");
    store.insertFounder(hiddenFounder);
    store.insertEvidence({
      id: "evidence-hidden-page-text", founderId: hiddenFounder.id, companyId: null, facet: "team", kind: "profile", source: "web",
      url: "https://founders-example.com/profile", title: "Founder profile", excerpt: pageBody, claim: "Founder built a database engine.",
      publishedAt: null, capturedAt: stamp, collectedByTaskId: null, hash: "hidden-page-text", verification: "supported", verificationNote: null, sim: null,
    });
    const hunt = store.getHunt(swarm.id)!;
    const pinned = store.listTrails(hunt.id)[0]!;
    store.saveTrail({ ...pinned, pinned: true });
    const turn: NavigateTurn = {
      open: [{ name: "New direction", intent: "Find early technical teams", searches: [], pages: ["http://127.0.0.1/private", "https://teams-example.com/launch"] }],
      extend: [], close: [{ trailId: pinned.id, why: "Close this trail" }], focus: [], notes: ["Keep looking for first product launches."], done: false,
    };

    await expect(api.takeHuntTurn(swarm.id, turn)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Set hunt.navigator to outside") });
    await expect(api.runHuntWave(swarm.id)).rejects.toMatchObject({ status: 409 });
    await api.createDirective({ scope: { swarmId: swarm.id }, kind: "param", key: "hunt.navigator", value: "outside" });
    await expect(api.takeHuntTurn(swarm.id, {
      ...turn,
      open: [{ name: "Founder is 42 years old", intent: "Find a technical team", searches: [], pages: [] }],
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("personal attributes") });

    const seat = await api.getHuntSeat(swarm.id);
    const result = await api.takeHuntTurn(swarm.id, turn);
    expect(result.opened).toEqual(["New direction"]);
    expect(result.closed).toEqual([]);
    expect(result.noted).toEqual(["Keep looking for first product launches."]);
    expect(result.refused.join(" ")).toMatch(/pinned by a person/);
    expect(result.refused.join(" ")).toMatch(/address/i);
    expect(store.getHunt(swarm.id)?.seatAt).toBe(stamp);
    const opened = store.listTrails(hunt.id).find((trail) => trail.name === "New direction")!;
    expect(store.listFrontier(hunt.id).filter((item) => item.trailId === opened.id).map((item) => item.target)).toEqual(["https://teams-example.com/launch"]);
    const viewText = JSON.stringify(result.view);
    expect(JSON.stringify(seat.view)).not.toContain(pageBody);
    expect(viewText).not.toContain(pageBody);
    expect(viewText).not.toContain("Ari Founder");
    expect(viewText).not.toContain("founders-example.com/start");
    expect(viewText).not.toContain("teams-example.com/launch");
  });

  it("resolves both configured runner providers into default pools and lets saved pools replace them", async () => {
    const app = createApp({
      dbPath: ":memory:",
      dataDir: ".",
      flowsDir: ".",
      cron,
      env: {
        DEEPSEEK_API_KEY: "test-key",
        DEEPSEEK_BASE_URL: "https://deepseek.example.test/v1",
        META_API_KEY: "test-key",
        META_BASE_URL: "https://meta.example.test/v1",
      },
    });
    try {
      await app.service.ensureSeeded();
      const api = app.service.as("Partner");
      const swarm = (await api.listSwarms())[0]!;
      const defaults = await api.getPools(swarm.id);
      expect(defaults.pools.find((pool) => pool.jobId === "hunt.look")?.members.map((member) => member.id)).toEqual(["deepseek-flash", "muse-ember"]);
      expect(defaults.pools.find((pool) => pool.jobId === "hunt.sift")?.members.map((member) => member.id)).toEqual(["deepseek-flash", "muse-ember"]);

      const saved = await api.setPool(swarm.id, "hunt.look", { members: [{ id: "local-runner", route: { provider: "sim", model: "local" }, share: 1 }] });
      expect(saved.pools.find((pool) => pool.jobId === "hunt.look")?.members.map((member) => member.id)).toEqual(["local-runner"]);
      expect(saved.pools.find((pool) => pool.jobId === "hunt.sift")?.members.map((member) => member.id)).toEqual(["deepseek-flash", "muse-ember"]);

      const reset = await api.setPool(swarm.id, "hunt.look", { members: [] });
      expect(reset.pools.find((pool) => pool.jobId === "hunt.look")?.members).toEqual([]);
      expect(reset.pools.find((pool) => pool.jobId === "hunt.look")?.route).not.toBeNull();
    } finally {
      app.close();
    }
  });

  it("runs the hunt through the assembled simulation app", async () => {
    const app = createApp({ dbPath: ":memory:", dataDir: ".", flowsDir: ".", cron, simSeed: 13 });
    try {
      await app.service.ensureSeeded();
      await app.service.ensureSeeded();
      const api = app.service.as("Partner");
      const [swarm] = await api.listSwarms();
      expect(await api.listSwarms()).toHaveLength(1);
      // Ordinary scouts run before the hunt and would deduplicate the same simulated founders.
      for (const agent of app.store.listAgents(swarm!.id).filter((item) => item.jobId.startsWith("scout."))) {
        app.store.updateAgent(agent.id, { status: "paused" });
      }
      await api.addHuntTrail(swarm!.id, {
        name: "Simulated founder pages",
        pages: [
          "https://web.sim.example/g/strong-early/1",
          "https://web.sim.example/g/decent/1",
          "https://web.sim.example/g/small-team/1",
          "https://web.sim.example/g/mixed/1",
          "https://web.sim.example/g/later-stage/1",
          "https://web.sim.example/g/job-board/1",
        ],
      });
      const started = await api.startRun({ swarmId: swarm!.id, brain: "sim", sources: "sim" });
      await app.service.runs.wait(started.id);

      const hunt = await api.getHunt(swarm!.id);
      expect(hunt.trails.length).toBeGreaterThan(0);
      expect(hunt.calls.length).toBeGreaterThan(0);
      expect(hunt.finds.length).toBeGreaterThan(0);
    } finally {
      app.close();
    }
  });

  it("validates directive scope, effect, value and text, then stores and audits a valid directive", async () => {
    const { service, store } = createHarness();
    const api = service.as("  Jamie Partner  ");
    const swarm = await api.createSwarm({ name: "AI infra", thesis });
    await expectServiceError(api.createDirective({ scope: { swarmId: "missing" }, kind: "rule", text: "Check it" }), 404, "scope.swarmId");
    await expectServiceError(api.createDirective({ scope: { classId: "scout" }, kind: "param", key: "screen.min_fit", value: 0.7 }), 400, "key");
    await expectServiceError(api.createDirective({ scope: { swarmId: swarm.id }, kind: "param", key: "screen.min_fit", value: 2 }), 400, "value");
    await expectServiceError(api.createDirective({ scope: {}, kind: "rule", text: "   " }), 400, "text");
    const directive = await api.createDirective({ scope: { swarmId: swarm.id }, kind: "param", key: "screen.min_fit", value: 0.7 });
    expect(directive.author).toBe("Jamie Partner");
    expect(store.getDirective(directive.id)?.value).toBe(0.7);
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Jamie Partner", action: "directive.create", target: directive.id });
    await expectServiceError(api.createDirective({ scope: { classId: "screener" }, kind: "param", key: "route.model", value: "muse-spark-1.3-contributor" }), 400, "value");
    await api.createDirective({ scope: { jobId: "scout.github" }, kind: "param", key: "route.model", value: "muse-spark-1.3-contributor" });
  });

  it("merges schedule and autopilot settings, trims inputs and validates their limits", async () => {
    const { service } = createHarness(); const api = service.as("Partner");
    const updated = await api.updateSettings({ operatorName: "  Alex  ", schedule: { enabled: true, cron: " 0 6 * * * " }, autopilot: { mode: "apply", budgetUsd: 4 } });
    expect(updated.settings.operatorName).toBe("Alex");
    expect(updated.settings.schedule).toEqual({ ...DEFAULT_SETTINGS.schedule, enabled: true, cron: "0 6 * * *" });
    expect(updated.settings.autopilot).toEqual({ mode: "apply", budgetUsd: 4 });
    expect(updated.nextRunAt).toBe("2026-11-13T06:00:00.000Z");
    expect((await api.updateSettings({ autopilot: { mode: "off" } })).settings.autopilot).toEqual({ mode: "off", budgetUsd: 4 });
    await expectServiceError(api.updateSettings({ schedule: { cron: "invalid" } }), 400, "schedule.cron");
    await expectServiceError(api.updateSettings({ operatorName: "x".repeat(61) }), 400, "operatorName");
    await expectServiceError(api.updateSettings({ autopilot: { mode: "automatic" as never } }), 400, "autopilot.mode");
    await expectServiceError(api.updateSettings({ autopilot: { budgetUsd: -0.01 } }), 400, "autopilot.budgetUsd");
    await expectServiceError(api.updateSettings({ autopilot: { budgetUsd: 1000.01 } }), 400, "autopilot.budgetUsd");
    await expectServiceError(api.updateSettings({ autopilot: null as never }), 400, "autopilot");
  });

  it("returns learned steering for the requested job and its agents", async () => {
    const { service, store } = createHarness(); const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Learned steering", thesis });
    const config: SwarmConfig = { ...BASE_CONFIG, id: "cfg_learned", lessons: { "scout.github": ["Prefer repositories with a shipped product."] } };
    store.saveConfig(config);
    store.updateSwarm(swarm.id, { configId: config.id });
    const agent = store.listAgents(swarm.id).find((item) => item.jobId === "scout.github")!;
    expect((await api.getEffectiveSteering({ swarmId: swarm.id, jobId: "scout.github" })).lessons).toEqual(config.lessons?.["scout.github"]);
    expect((await api.getEffectiveSteering({ swarmId: swarm.id, agentId: agent.id })).lessons).toEqual(config.lessons?.["scout.github"]);
    expect((await api.getEffectiveSteering({ swarmId: swarm.id, classId: "scout" })).lessons).toEqual([]);
  });

  it("runs a free baseline, and passes on a flow's own reason when it says it is not ready", async () => {
    const { service, store, setFlow, setRoundRunner, lastRoundInput } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Baseline readiness", thesis });
    let runs = 0;
    const emptyFlow = {
      id: "ranking", label: "Ranking", description: "test", headlineMetric: "rank", baseline: null, best: null, rounds: 0, updatedAt: null,
      metrics: [], goal: { target: "rank", direction: "higher" as const, hold: [] }, cases: { train: 2, test: 2, reps: 1 }, noiseFloor: null,
      dataNote: "Needs 4 Yes and 4 No calls in each half. So far: 4 Yes and 4 No among real founders; at least 0 more are needed.", variants: [], bestVariant: null, promotedVariant: null, narrative: "",
    } satisfies EvalFlowDTO;
    setFlow(emptyFlow);
    setRoundRunner((flow) => { runs += 1; return { ...flow, baseline: 0.5 }; });
    await service.coach(swarm.id);
    expect(lastRoundInput()).toMatchObject({ rounds: 1, brain: "sim", budgetUsd: 0 });
    expect(runs).toBe(1);

    const costly: EvalFlowDTO = {
      ...emptyFlow,
      baseline: 0.5,
      callsModels: true,
      variants: [{ id: "baseline", round: 0, description: "Baseline", rationale: "Starting point", status: "baseline", train: {}, test: {}, testInterval: null, costUsd: 1, config: BASE_CONFIG, changes: [], createdAt: stamp }],
    };
    setFlow(costly);
    const capped = await service.coach(swarm.id);
    expect(capped.flows[0]?.note).toContain("Today's eval budget is used");
    expect(capped.flows[0]?.note).toContain("Settings");
    expect(runs).toBe(1);

    const unavailable = { ...emptyFlow, ready: false, dataNote: "No past cases yet. Build them with the collect command." };
    setFlow(unavailable);
    const report = await service.coach(swarm.id);
    expect(report.flows[0]).toMatchObject({ rounds: 0, note: unavailable.dataNote });
    expect(runs).toBe(1);
  });

  it("counts what a round reports it spent, including a round that stopped before recording anything", async () => {
    const { service, setFlow, setRoundRunner, lastRoundInput } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Spend", thesis });
    // A past-cases flow: its variants carry the mean cost of one case, which is not what a round costs.
    const flow = { ...evalFlowRecord("past", { realData: true, latestCostUsd: 0.2, callsModels: true }), contamination: { cases: 40, recognised: 2, itemsCutOff: 0, cleanScore: 0.6, recognisedScore: null } };
    setFlow(flow);
    await api.updateSettings({ autopilot: { mode: "suggest", budgetUsd: 10 } });
    // The baseline ran out of budget part-way: money was spent and no variant was recorded.
    setRoundRunner((current) => ({ ...current, spentUsd: 7.5 }));
    const first = await service.coach(swarm.id);
    expect(lastRoundInput()).toMatchObject({ budgetUsd: 10 });
    expect(first).toMatchObject({ spentUsd: 7.5, flows: [{ rounds: 0 }] });

    // The same day, only what is left may be spent.
    setRoundRunner((current) => ({ ...keptWinner(current, 0.2), spentUsd: 2.5 }));
    const second = await service.coach(swarm.id);
    expect(lastRoundInput()).toMatchObject({ budgetUsd: 2.5 });
    expect(second.spentUsd).toBe(2.5);

    const third = await service.coach(swarm.id);
    expect(third.flows[0]?.note).toContain("Today's eval budget is used");
    expect(third.spentUsd).toBe(0);
  });

  it("records zero-round reports when autopilot is off or the emergency stop is on", async () => {
    const { service, store, setFlow, lastRoundInput, evalActivity } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Autopilot stops", thesis });
    setFlow(evalFlowRecord("ranking"));
    await api.updateSettings({ autopilot: { mode: "off" } });
    const off = await service.coach(swarm.id);
    expect(off).toMatchObject({ mode: "off", spentUsd: 0, flows: [{ flowId: "autopilot", rounds: 0, note: "Autopilot is off." }] });
    expect(lastRoundInput()).toBeUndefined();
    expect(evalActivity().listFlowsCalls).toBe(0);
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Swarm", action: "coach.run", target: swarm.id, detail: { report: off } });

    await api.updateSettings({ autopilot: { mode: "suggest" }, killSwitch: true });
    const stopped = await service.coach(swarm.id);
    expect(stopped.flows).toEqual([{ flowId: "autopilot", label: "Autopilot", rounds: 0, kept: [], applied: null, note: "Emergency stop is on; no eval round was started." }]);
    expect(evalActivity()).toEqual({ listFlowsCalls: 0, roundCalls: [] });
    expect(store.recentAudit(1)[0]).toMatchObject({ action: "coach.run", detail: { report: stopped } });
  });

  it("runs one round for each ready flow in suggest mode without applying kept changes", async () => {
    const { service, store, setFlows, setRoundRunner, evalActivity } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Suggest flows", thesis });
    setFlows([evalFlowRecord("partner-a", { realData: true }), evalFlowRecord("partner-b", { realData: true })]);
    setRoundRunner((flow) => keptWinner(flow));
    await api.updateSettings({ autopilot: { mode: "suggest", budgetUsd: 0 } });

    const report = await service.coach(swarm.id);
    expect(report.flows.map((flow) => [flow.flowId, flow.rounds, flow.kept.length, flow.applied])).toEqual([
      ["partner-a", 1, 1, null], ["partner-b", 1, 1, null],
    ]);
    expect(evalActivity().roundCalls.map((call) => call.flowId)).toEqual(["partner-a", "partner-b"]);
    expect(store.getSwarm(swarm.id)?.configId).toBe(BASE_CONFIG.id);
    expect(store.recentAudit(10).some((entry) => entry.action === "coach.apply")).toBe(false);
  });

  it("applies at most one real-data winner and leaves synthetic winners for review", async () => {
    const { service, store, setFlows, setVariantForFlow, setRoundRunner, evalActivity } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Single apply", thesis });
    const firstConfig = { ...BASE_CONFIG, id: "cfg_first_winner", label: "First winner" };
    const secondConfig = { ...BASE_CONFIG, id: "cfg_second_winner", label: "Second winner" };
    setVariantForFlow("partner-a", firstConfig);
    setVariantForFlow("partner-b", secondConfig);
    setFlows([evalFlowRecord("partner-a", { realData: true }), evalFlowRecord("partner-b", { realData: true }), evalFlowRecord("simulated")]);
    setRoundRunner((flow) => keptWinner(flow));
    await api.updateSettings({ autopilot: { mode: "apply", budgetUsd: 0 } });

    const report = await service.coach(swarm.id);
    expect(report.flows.map((flow) => flow.applied)).toEqual(["Raise the fit threshold", null, null]);
    expect(report.flows[1]?.note).toContain("A different real-data change was applied");
    expect(report.flows[2]?.note).toContain("measured on simulated data wait for a partner");
    expect(store.getConfig(store.getSwarm(swarm.id)!.configId)?.applied).toEqual({ "partner-a": "v1" });
    expect(store.recentAudit(10).filter((entry) => entry.action === "coach.apply")).toHaveLength(1);
    expect(evalActivity().roundCalls.map((call) => call.flowId)).toEqual(["partner-a", "partner-b", "simulated"]);
  });

  it("runs free flows at zero budget, skips a costly flow, and continues after another flow is busy", async () => {
    const { service, setFlows, setRoundRunner, setRoundError, evalActivity } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Flow failures", thesis });
    setFlows([
      evalFlowRecord("free"),
      evalFlowRecord("costly", { callsModels: true }),
      evalFlowRecord("busy"),
      evalFlowRecord("ready"),
    ]);
    setRoundRunner((flow) => keptWinner(flow));
    setRoundError("busy", new Error("Eval busy: another process owns this flow"));
    await api.updateSettings({ autopilot: { mode: "suggest", budgetUsd: 0 } });

    const report = await service.coach(swarm.id);
    expect(report.flows.map((flow) => [flow.flowId, flow.rounds])).toEqual([["free", 1], ["costly", 0], ["busy", 0], ["ready", 1]]);
    expect(report.flows[1]?.note).toContain("Today's eval budget is used");
    expect(report.flows[2]?.note).toBe("Eval busy: another process owns this flow");
    expect(evalActivity().roundCalls.map((call) => call.flowId)).toEqual(["free", "busy", "ready"]);
  });

  it("applies only a newly kept real-data winner, charges the remaining daily budget, and surfaces the report for 48 hours", async () => {
    const { service, store, setFlow, setVariant, setRoundRunner, lastRoundInput, setNow } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Autopilot", thesis });
    const appliedConfig: SwarmConfig = { ...BASE_CONFIG, id: "cfg_applied", label: "Applied", params: { "screen.min_fit": 0.7 } };
    setVariant(appliedConfig);
    const baseline = { id: "baseline", round: 0, description: "Baseline", rationale: "Starting point", status: "baseline" as const, train: {}, test: { rank: 0.5 }, testInterval: null, costUsd: 0, config: BASE_CONFIG, changes: [], createdAt: stamp };
    const before: EvalFlowDTO = {
      id: "partner", label: "Partner calls", description: "calls", headlineMetric: "agreement", baseline: 0.5, best: 0.5, rounds: 0, updatedAt: stamp,
      metrics: [], goal: { target: "agreement", direction: "higher", hold: [] }, cases: { train: 8, test: 8, reps: 1 }, noiseFloor: null,
      dataNote: "Replays partner calls.", realData: true, variants: [baseline], bestVariant: "baseline", promotedVariant: null, narrative: "",
    };
    setFlow(before);
    store.audit({ actor: "Swarm", action: "coach.run", target: "another-swarm", detail: { report: { at: stamp, mode: "suggest", spentUsd: 2, flows: [] } } });
    await api.updateSettings({ autopilot: { mode: "apply", budgetUsd: 10 } });
    const kept = { ...baseline, id: "v1", round: 1, description: "raise the fit threshold", rationale: "Held-out agreement improved", status: "champion" as const, costUsd: 1, changes: ["raise the fit threshold"], config: appliedConfig };
    setRoundRunner((flow) => ({ ...flow, rounds: 1, variants: [...flow.variants, kept], bestVariant: "v1", realData: true, spentUsd: 1 }));

    const report = await service.coach(swarm.id);
    expect(lastRoundInput()).toMatchObject({ rounds: 1, brain: "live", budgetUsd: 8 });
    expect(report).toMatchObject({ mode: "apply", spentUsd: 1, flows: [{ rounds: 1, kept: ["raise the fit threshold"], applied: "raise the fit threshold", note: null }] });
    expect(store.getConfig(store.getSwarm(swarm.id)!.configId)).toMatchObject({ params: { "screen.min_fit": 0.7 }, applied: { partner: "v1" } });
    expect(store.recentAudit(4).filter((entry) => entry.target === swarm.id).map((entry) => entry.action)).toContain("coach.apply");
    expect(store.recentAudit(4).find((entry) => entry.action === "coach.run")?.detail.report).toEqual(report);
    const overview = await api.getOverview(swarm.id);
    expect(overview.coach).toEqual(report);
    expect(overview.alerts.find((alert) => alert.id === "coach-applied")).toMatchObject({
      level: "info", title: "The swarm changed its own settings", detail: "raise the fit threshold. You can undo it on the Improve page.", link: "/improve",
    });

    setNow(new Date(fixedAt.getTime() + 49 * 60 * 60 * 1000));
    const staleOverview = await api.getOverview(swarm.id);
    expect(staleOverview.coach).toEqual(report);
    expect(staleOverview.alerts.some((alert) => alert.id === "coach-applied")).toBe(false);

    // A second look the same day finds the winner already in use and applies nothing again.
    setRoundRunner((flow) => flow);
    const again = await service.coach(swarm.id);
    expect(again.flows[0]?.applied).toBeNull();
    expect(store.recentAudit(20).filter((entry) => entry.action === "coach.apply")).toHaveLength(1);
  });

  it("reads the latest coaching report for this swarm from the audit log", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Restarted", thesis });
    const earlier = { at: stamp, mode: "suggest" as const, spentUsd: 0, flows: [] };
    store.audit({ actor: "Swarm", action: "coach.run", target: "another-swarm", detail: { report: { ...earlier, spentUsd: 9 } } });
    store.audit({ actor: "Swarm", action: "coach.run", target: swarm.id, detail: { report: earlier } });
    const latest = { ...earlier, at: "2026-11-13T18:00:00.000Z", spentUsd: 2 };
    store.audit({ actor: "Swarm", action: "coach.run", target: swarm.id, detail: { report: latest } });
    expect((await api.getOverview(swarm.id)).coach).toEqual(latest);
  });

  it("puts a variant into use without dropping other changes and reports which swarm carries it", async () => {
    const { service, store, setFlow } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Layered", thesis });
    const otherSwarm = await api.createSwarm({ name: "Still at the start", thesis });
    const held: SwarmConfig = {
      ...BASE_CONFIG,
      id: "cfg_held",
      params: { "screen.min_fit": 0.6 },
      lessons: { "assess.judgments": ["Keep this line."] },
      pools: { "investigate.background": [{ id: "haiku", route: { provider: "claude-cli", model: "claude-haiku-5-5" }, share: 1, status: "active", note: null }] },
      applied: { "partner-calls": "v2" },
    };
    store.saveConfig(held);
    store.updateSwarm(swarm.id, { configId: held.id });
    const variant = (id: string, status: "baseline" | "champion", params: SwarmConfig["params"]) => ({
      id, round: id === "baseline" ? 0 : 1, description: id, rationale: "", status, train: {}, test: { rank: id === "baseline" ? 0.5 : 0.6 }, testInterval: null, costUsd: 0,
      config: { ...BASE_CONFIG, id: `cfg_${id}`, params }, changes: [], createdAt: stamp,
    });
    setFlow({
      ...evalFlowRecord("ranking"),
      variants: [variant("baseline", "baseline", {}), variant("v1", "champion", { "weights.velocity": 3 })],
      bestVariant: "v1",
    });

    const promoted = await api.promoteEvalVariant("ranking", { variant: "v1", swarmId: swarm.id });
    expect(promoted).toMatchObject({
      params: { "screen.min_fit": 0.6, "weights.velocity": 3 },
      lessons: held.lessons,
      pools: held.pools,
      applied: { "partner-calls": "v2", ranking: "v1" },
    });
    expect((await api.getEvalFlow("ranking")).promotedVariant).toBeNull();
    expect((await api.getEvalFlow("ranking", swarm.id)).promotedVariant).toBe("v1");
    expect((await api.getEvalFlow("ranking", otherSwarm.id)).promotedVariant).toBeNull();
    expect((await api.getEvalFlow("ranking")).promotedVariant).toBeNull();
    await expectServiceError(api.getEvalFlow("ranking", "missing"), 404);
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Partner", action: "eval.promote", target: swarm.id });

    // Choosing the baseline again takes this flow's change back out and leaves the rest.
    const undone = await api.promoteEvalVariant("ranking", { variant: "baseline", swarmId: swarm.id });
    expect(undone.params).toEqual({ "screen.min_fit": 0.6 });
    expect(undone.applied).toEqual({ "partner-calls": "v2" });
    expect(undone.pools).toEqual(held.pools);
    expect((await api.getEvalFlow("ranking")).promotedVariant).toBeNull();
    await expectServiceError(api.promoteEvalVariant("ranking", { variant: "v9", swarmId: swarm.id }), 404);
  });

  it("runs one coaching pass at a time, so two swarms cannot both spend the same day's budget", async () => {
    const { service, setFlow, setRoundRunnerAsync, roundCalls } = createHarness();
    const api = service.as("Partner");
    const first = await api.createSwarm({ name: "First", thesis });
    const second = await api.createSwarm({ name: "Second", thesis });
    setFlow({ ...evalFlowRecord("past", { realData: true, callsModels: true }) });
    await api.updateSettings({ autopilot: { mode: "suggest", budgetUsd: 5 } });
    // Each round spends all it is allowed, and takes a moment, as a real one does.
    setRoundRunnerAsync(async (flow, input) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ...flow, spentUsd: input?.budgetUsd ?? 0 };
    });

    const [one, two] = await Promise.all([service.coach(first.id), service.coach(second.id)]);
    expect(roundCalls().map((call) => call.input?.budgetUsd)).toEqual([5]);
    expect(one.spentUsd + two.spentUsd).toBe(5);
    expect(two.flows[0]?.note).toContain("Today's eval budget is used");
  });

  it("shows what a variant would change without saving anything", async () => {
    const { service, store, setFlow } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Preview", thesis });
    const before = store.getSwarm(swarm.id)?.configId;
    const config = { ...BASE_CONFIG, id: "cfg_v1", lessons: { "assess.judgments": ["A new line."] } };
    setFlow({
      ...evalFlowRecord("ranking"),
      variants: [
        { id: "baseline", round: 0, description: "", rationale: "", status: "baseline", train: {}, test: {}, testInterval: null, costUsd: 0, config: BASE_CONFIG, changes: [], createdAt: stamp },
        { id: "v1", round: 1, description: "", rationale: "", status: "champion", train: {}, test: {}, testInterval: null, costUsd: 0, config, changes: [], createdAt: stamp },
      ],
    });
    const preview = await api.previewEvalVariant("ranking", { variant: "v1", swarmId: swarm.id });
    expect(preview).toEqual({
      founders: [], companies: [], considered: { founders: 0, companies: 0 },
      unseen: ["New guidance for an analyst takes effect when founders or companies are assessed again."],
    });
    expect(store.getSwarm(swarm.id)?.configId).toBe(before);
    expect(store.recentAudit(5).some((entry) => entry.action === "eval.promote")).toBe(false);
  });

  it("sets a pool for a job, shows it, rebalances it and records each change", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Pooled", thesis });
    const members = [
      { id: "sonnet", route: { provider: "claude-cli" as const, model: "claude-sonnet-5-5" }, share: 0.5 },
      { id: "haiku", route: { provider: "claude-cli" as const, model: "claude-haiku-5-5" }, share: 0.5 },
    ];
    const view = await api.setPool(swarm.id, "investigate.background", { members });
    const pooled = view.pools.find((pool) => pool.jobId === "investigate.background");
    expect(pooled?.members.map((member) => [member.id, member.share, member.status, member.stats.tasks])).toEqual([["sonnet", 0.5, "active", 0], ["haiku", 0.5, "active", 0]]);
    expect(view.pools.find((pool) => pool.jobId === "screen.fit")).toMatchObject({ members: [], route: { provider: "claude-cli" } });
    expect(store.getConfig(store.getSwarm(swarm.id)!.configId)?.pools?.["investigate.background"]).toHaveLength(2);
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Partner", action: "pool.set", target: swarm.id, detail: { jobId: "investigate.background" } });

    // No member has done any work yet, so nothing moves and nothing is saved or recorded.
    const report = await api.rebalancePools(swarm.id, { apply: true });
    expect(report.applied).toBe(false);
    expect(report.pools[0]?.note).toContain("Shares move once every member has done 20 tasks");
    expect(store.recentAudit(1)[0]?.action).toBe("pool.set");

    await expectServiceError(api.setPool(swarm.id, "investigate.background", { members: [{ ...members[0]!, share: 0.2 }] }), 400, "members");
    await expectServiceError(api.setPool("missing", "investigate.background", { members }), 404);
    const cleared = await api.setPool(swarm.id, "investigate.background", { members: [] });
    expect(cleared.pools.find((pool) => pool.jobId === "investigate.background")?.members).toEqual([]);
  });

  it("serves the assumption ledger through the swarm API", async () => {
    const { service } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Ledger", thesis });
    const ledger = await api.getAssumptions(swarm.id);
    expect(ledger).toMatchObject({ outcomesBasis: null, callsBasis: null });
    expect(ledger.rows.find((row) => row.id === "weighing.together")).toMatchObject({ status: "untested", current: "0.6" });
    await expectServiceError(api.getAssumptions("missing"), 404);
  });

  it("builds node health, planned jobs, aggregate figures and scoped directive counts", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Tree", thesis });
    const agents = store.listAgents(swarm.id);
    const byJob = (jobId: Agent["jobId"]) => agents.find((agent) => agent.jobId === jobId)!;
    const paused = byJob("scout.hackernews");
    await api.updateAgent(paused.id, { status: "paused" });
    const idleAgent = await api.addAgent(swarm.id, { jobId: "scout.hackernews" });
    const run = runRecord(swarm.id, { status: "succeeded", stage: null }); store.insertRun(run);
    store.insertTask(taskRecord(run, byJob("scout.github"), "succeeded"));
    store.insertTask(taskRecord(run, byJob("scout.research"), "succeeded"));
    store.insertTask(taskRecord(run, byJob("scout.research"), "succeeded"));
    store.insertTask(taskRecord(run, byJob("scout.research"), "failed"));
    store.insertTask(taskRecord(run, byJob("scout.talent"), "failed"));
    store.insertTask(taskRecord(run, byJob("scout.talent"), "failed"));
    store.insertTask(taskRecord(run, byJob("scout.talent"), "succeeded"));
    const cls = await api.createDirective({ scope: { swarmId: swarm.id, classId: "scout" }, kind: "rule", text: "Class rule" });
    const job = await api.createDirective({ scope: { jobId: "scout.github" }, kind: "rule", text: "Job rule" });
    const agent = await api.createDirective({ scope: { agentId: idleAgent.id }, kind: "rule", text: "Agent rule" });
    await api.createDirective({ scope: {}, kind: "rule", text: "Global rule" });
    await api.createDirective({ scope: { swarmId: swarm.id }, kind: "rule", text: "Swarm rule" });
    const tree = await api.getTree(swarm.id);
    const scout = tree.classes.find((node) => node.cls.id === "scout")!;
    const node = (jobId: string) => scout.jobs.find((item) => item.job.id === jobId)!;
    expect(node("scout.hackernews").health).toBe("idle");
    expect(node("scout.hackernews").agents.find((item) => item.agent.id === paused.id)?.health).toBe("paused");
    expect(node("scout.github").health).toBe("ok");
    expect(node("scout.research").health).toBe("warn");
    expect(node("scout.talent").health).toBe("error");
    expect(tree.classes.find((item) => item.cls.id === "outreach")?.jobs.find((item) => item.job.id === "call.founder")?.health).toBe("planned");
    expect(scout.directiveCount).toBe(1);
    expect(node("scout.github").directiveCount).toBe(1);
    expect(node("scout.hackernews").agents.find((item) => item.agent.id === idleAgent.id)?.directiveCount).toBe(1);
    expect(tree.swarmDirectiveCount).toBe(1);
    expect(tree.globalDirectiveCount).toBe(1);
    expect([cls.id, job.id, agent.id]).toHaveLength(3);
  });

  it("includes partner call examples only for classes that may read them", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Steering", thesis });
    const scout = store.listAgents(swarm.id).find((agent) => agent.jobId === "scout.github")!;
    const founder = founderRecord(swarm.id); store.insertFounder(founder);
    store.insertFeedback({ id: newId("fbk"), founderId: founder.id, author: "Partner", verdict: "yes", reasonTags: ["builder"], note: null, createdAt: stamp });
    expect((await api.getEffectiveSteering({ swarmId: swarm.id, agentId: scout.id })).callsBlock).toBe("");
    const analyst = await api.getEffectiveSteering({ swarmId: swarm.id, classId: "analyst" });
    expect(analyst.callsBlock).toContain("examples, not rules");
    expect(analyst.callsBlock).toContain("Vector Works: a vector index for robot logs");
  });

  it("records partner calls, filters reason tags, and moves founders according to the latest verdict", async () => {
    const { service, store } = createHarness();
    const swarm = await service.as("Partner").createSwarm({ name: "Calls", thesis });
    const founder = founderRecord(swarm.id, newId("fnd"), "watch"); store.insertFounder(founder);
    const api = service.as("Decision Maker");
    await expectServiceError(api.addFeedback(founder.id, { verdict: "no" }), 400, "reasonTags");
    const no = await api.addFeedback(founder.id, { verdict: "no", reasonTags: ["builder", "outside_thesis"] });
    expect(no.reasonTags).toEqual(["outside_thesis"]);
    expect(store.getFounder(founder.id)?.status).toBe("passed");
    await api.addFeedback(founder.id, { verdict: "yes", reasonTags: ["builder"] });
    expect(store.getFounder(founder.id)?.status).toBe("surfaced");
    expect(Date.parse(store.listFeedback(founder.id)[1]?.createdAt ?? "")).toBeGreaterThan(Date.parse(store.listFeedback(founder.id)[0]?.createdAt ?? ""));
    const scout = store.listAgents(swarm.id).find((agent) => agent.jobId === "scout.github")!;
    expect((await api.getEffectiveSteering({ swarmId: swarm.id, agentId: scout.id })).callsBlock).toBe("");
    expect(store.recentAudit(1)[0]?.actor).toBe("Decision Maker");
  });

  it("offers repeated-call suggestions, applies accepted steering, and remembers dismissals", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Suggestions", thesis });
    const founders = Array.from({ length: 3 }, () => founderRecord(swarm.id));
    for (const founder of founders) {
      store.insertFounder(founder);
      store.insertFeedback({ id: newId("fbk"), founderId: founder.id, author: "Partner", verdict: "no", reasonTags: ["outside_thesis"], note: null, createdAt: stamp });
    }
    const suggestions = await api.listSuggestions(swarm.id);
    const suggestion = suggestions.find((item) => item.key === "screen.min_fit=0.65")!;
    expect(suggestion.support).toBe(3);
    await api.createDirective(suggestion.directive);
    expect((await api.getEffectiveSteering({ swarmId: swarm.id })).params.find((item) => item.key === "screen.min_fit")?.value).toBe(0.65);
    const remaining = await api.listSuggestions(swarm.id);
    expect(remaining.some((item) => item.key === "screen.min_fit=0.65")).toBe(false);
    const key = remaining[0]?.key ?? "text:skip_priced_rounds";
    const afterDismiss = await api.dismissSuggestion(swarm.id, key);
    expect(afterDismiss.some((item) => item.key === key)).toBe(false);
  });

  it("protects the disclosure during approval and links transcript evidence on completion", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Outreach", thesis });
    const founder = founderRecord(swarm.id); store.insertFounder(founder);
    const action: OutreachAction = { id: newId("out"), swarmId: swarm.id, founderId: founder.id, kind: "email_founder", target: { name: founder.name, role: null, relationship: null, channelHint: null }, rationale: "Founder is in thesis", draft: { subject: "Hello", body: "Draft", agenda: [], questions: [], disclosure: "I am an AI assistant calling for the fund." }, consentBasis: "Founder requested contact", status: "proposed", decidedBy: null, decidedAt: null, decisionNote: null, resultSummary: null, transcriptEvidenceId: null, createdByTaskId: null, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" };
    store.insertOutreach(action);
    const approved = await api.decideOutreach(action.id, { decision: "approve", draft: { ...action.draft, body: "Edited", disclosure: "Removed" } });
    expect(approved.status).toBe("approved");
    expect(approved.draft.body).toBe("Edited");
    expect(approved.draft.disclosure).toBe(action.draft.disclosure);
    await expectServiceError(api.decideOutreach(action.id, { decision: "approve" }), 409);
    const completed = await api.completeOutreach(action.id, { summary: "Intro call complete", transcript: "Founder described the prototype." });
    expect(completed.status).toBe("completed");
    const evidence = store.listEvidence(founder.id)[0];
    // The action here is an email, so the stored notes must not be called a call transcript.
    expect(evidence).toMatchObject({ kind: "call_transcript", source: "call", verification: "unverified", title: `Conversation with ${founder.name}`, claim: "Notes a partner wrote after this conversation.", excerpt: "Founder described the prototype." });
    expect(completed.transcriptEvidenceId).toBe(evidence?.id);
  });

  it("refuses unsafe call placements and never stores the full number", async () => {
    const consent = { how: "They agreed by email at +14155550123 to an AI call.", recording: false };
    const validInput = { to: "+14155550123", timezone: "America/Chicago", consent };
    let placedRequest: Parameters<Dialler["place"]>[0] | undefined;
    let throwAfterAccept = false;
    let providerAccepts = 0;
    let currentStore: Store | undefined;
    let currentActionId = "";
    let placementIntentWasStored = false;
    const dialler: Dialler = {
      vendor: "Test dialler",
      status: async () => ({ configured: true, detail: "Ready" }),
      place: async (request) => {
        placedRequest = request;
        providerAccepts += 1;
        const intent = currentStore?.getOutreach(currentActionId);
        placementIntentWasStored = intent?.status === "dispatched" && intent.call?.state === "placing" && intent.call.callId === null;
        if (throwAfterAccept) throw new Error(`Provider accepted ${validInput.to} before the response was lost.`);
        return { callId: "call-1" };
      },
      fetch: async () => ({ state: "queued", transcript: null, durationSec: null, costUsd: null, detail: null }),
    };
    const refusals = [
      { name: "not approved", status: 409, action: { status: "proposed" as const } },
      { name: "not a call", status: 409, action: { kind: "email_founder" as const } },
      { name: "already placed", status: 409, alreadyPlaced: true },
      { name: "no consent text", status: 400, input: { ...validInput, consent: { ...consent, how: "" } } },
      { name: "bad number", status: 400, input: { ...validInput, to: "4155550123" } },
      { name: "missing callback number", status: 503, noCallback: true },
      { name: "callback number is not E.164", status: 503, callbackNumber: "4155550100" },
      { name: "missing registered fund name", status: 503, noFundName: true },
      { name: "prohibited personal attributes", status: 400, personalAttributes: true },
      { name: "provider accepted before placement response was lost", status: 409, throwAfterAccept: true },
      { name: "outside hours", status: 400, input: { ...validInput, timezone: "Pacific/Kiritimati" } },
      { name: "daily ceiling", status: 409, ceiling: true },
      { name: "emergency stop", status: 409, emergency: true },
      { name: "no calling service", status: 503, noService: true },
    ];
    for (const refusal of refusals) {
      const { service, store } = createHarness(undefined, false, refusal.noService ? undefined : { sim: dialler, live: dialler }, refusal.callbackNumber ?? (refusal.noCallback ? null : undefined), refusal.noFundName ? null : undefined);
      const api = service.as("Partner");
      const swarm = await api.createSwarm({ name: "Call limits", thesis });
      const founder = founderRecord(swarm.id); store.insertFounder(founder);
      throwAfterAccept = Boolean(refusal.throwAfterAccept);
      providerAccepts = 0;
      const action: OutreachAction = {
        id: newId("out"), swarmId: swarm.id, founderId: founder.id,
        kind: "call_founder", target: { name: founder.name, role: null, relationship: null, channelHint: null },
        rationale: "Approved call", draft: { subject: null, body: null, agenda: ["Discuss the product"], questions: refusal.personalAttributes ? ["Is the founder married?"] : ["What shipped?"], disclosure: "This is an AI assistant calling for the fund." },
        consentBasis: "They agreed to a call", status: "approved", decidedBy: "Partner", decidedAt: stamp, decisionNote: null,
        resultSummary: null, transcriptEvidenceId: null, createdByTaskId: null, createdAt: stamp, updatedAt: stamp,
        ...refusal.action,
      };
      currentStore = store;
      currentActionId = action.id;
      store.insertOutreach(action);
      if (refusal.alreadyPlaced) store.updateOutreach(action.id, { call: { vendor: "Test dialler", callId: "prior", placedBy: "Partner", placedAt: stamp, consent: { how: consent.how, recording: false, recordedBy: "Partner", at: stamp }, numberTail: "23", state: "completed", endedAt: stamp, durationSec: 20, costUsd: 0, detail: null } });
      if (refusal.ceiling) {
        for (let i = 0; i < 5; i += 1) store.insertOutreach({ ...action, id: newId("out"), call: { vendor: "Test dialler", callId: `prior-${i}`, placedBy: "Partner", placedAt: stamp, consent: { how: consent.how, recording: false, recordedBy: "Partner", at: stamp }, numberTail: "23", state: "completed", endedAt: stamp, durationSec: 20, costUsd: 0, detail: null } });
      }
      if (refusal.emergency) store.saveSettings({ ...store.getSettings(), killSwitch: true });
      if (refusal.throwAfterAccept) {
        const failed = await api.placeCall(action.id, refusal.input ?? validInput);
        expect(failed).toMatchObject({ status: "failed", call: { callId: null, state: "failed" } });
        expect(JSON.stringify(failed)).not.toContain(validInput.to);
        await expectServiceError(api.placeCall(action.id, refusal.input ?? validInput), refusal.status);
        expect(providerAccepts).toBe(1);
        expect(placementIntentWasStored).toBe(true);
      } else {
        await expectServiceError(api.placeCall(action.id, refusal.input ?? validInput), refusal.status);
        expect(store.getOutreach(action.id)?.call?.callId).toBe(refusal.alreadyPlaced ? "prior" : undefined);
      }
    }

    const { service, store } = createHarness(undefined, false, { sim: dialler, live: dialler });
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "No phone persistence", thesis });
    const founder = founderRecord(swarm.id); store.insertFounder(founder);
    const action: OutreachAction = { id: newId("out"), swarmId: swarm.id, founderId: founder.id, kind: "call_founder", target: { name: founder.name, role: null, relationship: null, channelHint: null }, rationale: "Approved", draft: { subject: null, body: null, agenda: ["Discuss product"], questions: ["What shipped?"], disclosure: "AI assistant calling for the fund." }, consentBasis: "Agreed", status: "approved", decidedBy: "Partner", decidedAt: stamp, decisionNote: null, resultSummary: null, transcriptEvidenceId: null, createdByTaskId: null, createdAt: stamp, updatedAt: stamp };
    store.insertOutreach(action);
    const placed = await api.placeCall(action.id, validInput);
    const persisted = JSON.stringify({ action: placed, audit: store.recentAudit(10) });
    expect(placed).toMatchObject({ status: "dispatched", call: { numberTail: "23", placedBy: "Partner" } });
    expect(placedRequest?.opening).toContain("Hello. This is an AI assistant, not a person, calling for Northstar Ventures.");
    expect(placedRequest?.closing).toBe("This call was made for Northstar Ventures. You can reach us at +14155550100. Goodbye.");
    expect(placedRequest?.reference).toBe(action.id);
    expect(persisted).not.toContain(validInput.to);
  });

  it("places and syncs a simulated call into ordinary call transcript evidence", async () => {
    const world = createSimWorld({ founders: 1 });
    let store: Store | undefined;
    let transcriptWasStoredBeforeForget = false;
    let providerFetches = 0;
    let providerPlaces = 0;
    const simulated = createSimDialler(world);
    const dialler: Dialler = {
      ...simulated,
      async place(request, signal) { providerPlaces += 1; return simulated.place(request, signal); },
      async fetch(callId) {
        providerFetches += 1;
        const result = await simulated.fetch(callId);
        return { ...result, transcript: `${result.transcript}\nFounder: call me at +1 (415) 555-0123.`, detail: "Call ended at 415-555-9876." };
      },
      async forget() { transcriptWasStoredBeforeForget = Boolean(store?.listEvidence(founder.id).some((item) => item.kind === "call_transcript")); },
    };
    const fixture = createHarness(undefined, false, { sim: dialler, live: null });
    const { service } = fixture;
    store = fixture.store;
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Simulated calls", thesis });
    const founder = { ...founderRecord(swarm.id), simId: world.founders()[0]!.simId }; store.insertFounder(founder);
    const action: OutreachAction = { id: newId("out"), swarmId: swarm.id, founderId: founder.id, kind: "call_founder", target: { name: founder.name, role: null, relationship: null, channelHint: null }, rationale: "Approved", draft: { subject: null, body: null, agenda: ["Discuss product"], questions: ["What shipped?"], disclosure: "AI assistant calling for the fund." }, consentBasis: "Agreed", status: "approved", decidedBy: "Partner", decidedAt: stamp, decisionNote: null, resultSummary: null, transcriptEvidenceId: null, createdByTaskId: null, createdAt: stamp, updatedAt: stamp };
    store.insertOutreach(action);
    const placed = await api.placeCall(action.id, { to: "+14155550123", timezone: "America/Chicago", consent: { how: "They agreed by email at +14155550123 to an AI call.", recording: true } });
    expect(placed.status).toBe("dispatched");
    const [synced] = await api.syncCalls(swarm.id);
    expect(synced).toMatchObject({ status: "completed", call: { state: "completed", vendor: "Simulated" } });
    const evidence = store.listEvidence(founder.id).find((item) => item.id === synced?.transcriptEvidenceId);
    expect(evidence).toMatchObject({ kind: "call_transcript", source: "call", verification: "unverified", claim: "Notes a partner wrote after this conversation.", sim: { truth: "supported" }, excerpt: expect.any(String) });
    expect(transcriptWasStoredBeforeForget).toBe(true);
    expect(evidence?.excerpt).not.toContain("415");
    expect(evidence?.excerpt).not.toContain("555-0123");
    expect(synced?.call?.detail).not.toContain("9876");
    expect(synced?.call?.consent.how).not.toContain("14155550123");
    expect(evidence?.excerpt).not.toContain("1984");

    const orphaned: OutreachAction = { ...action, id: newId("out"), status: "dispatched", call: { vendor: "Simulated", callId: null, placedBy: "Partner", placedAt: stamp, consent: { how: "They agreed by email to an AI call.", recording: false, recordedBy: "Partner", at: stamp }, numberTail: "23", state: "placing", endedAt: null, durationSec: null, costUsd: null, detail: null } };
    store.insertOutreach(orphaned);
    const fetchesBeforeOrphan = providerFetches;
    const placesBeforeOrphan = providerPlaces;
    await expectServiceError(api.placeCall(orphaned.id, { to: "+14155550123", timezone: "America/Chicago", consent: { how: "They agreed by email to an AI call.", recording: false } }), 409);
    expect(providerPlaces).toBe(placesBeforeOrphan);
    await api.syncCalls(swarm.id);
    expect(store.getOutreach(orphaned.id)).toMatchObject({ status: "failed", call: { callId: null, state: "failed", detail: "The process stopped before saving a call id. Check with the calling service before trying again." } });
    expect(providerFetches).toBe(fetchesBeforeOrphan);
    await expectServiceError(api.placeCall(orphaned.id, { to: "+14155550123", timezone: "America/Chicago", consent: { how: "They agreed by email to an AI call.", recording: false } }), 409);
  });

  it("keeps personal attributes out of what a person types in", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Privacy", thesis });
    const founder = founderRecord(swarm.id); store.insertFounder(founder);

    // Steering on a personal attribute is refused outright.
    await expectServiceError(api.createDirective({ scope: { swarmId: swarm.id }, kind: "opinion", text: "Prefer a founder who is 25 years old." }), 400, "text");
    const ok = await api.createDirective({ scope: { swarmId: swarm.id }, kind: "opinion", text: "Prefer founders who shipped something in the last year." });
    await expectServiceError(api.updateDirective(ok.id, { text: "Skip anyone who is married." }), 400, "text");

    // The same goes for the other places a person tells the swarm what to look for.
    await expectServiceError(api.createSwarm({ name: "Young founders", thesis: { ...thesis, summary: "Back a founder who is 22 years old." } }), 400, "thesis");
    await expectServiceError(api.updateSwarm(swarm.id, { thesis: { ...thesis, avoid: ["anyone who is married"] } }), 400, "thesis");
    await expectServiceError(api.addAgent(swarm.id, { jobId: "scout.github", beat: "Projects by someone who is 19 years old" }), 400, "beat");
    const scout = await api.addAgent(swarm.id, { jobId: "scout.github", beat: "Databases" });
    await expectServiceError(api.updateAgent(scout.id, { beat: "Founders whose religion: unknown" }), 400, "beat");
    // A note on a directive is a comment, not an instruction: the personal sentence is removed.
    const noted = await api.createDirective({ scope: { swarmId: swarm.id }, kind: "context", text: "We know this team.", note: "Met at a dinner. His wife was there." });
    expect(noted.note).toBe("Met at a dinner. [removed: personal detail]");

    // A call note is stored without the personal sentence.
    const call = await api.addFeedback(founder.id, { verdict: "yes", reasonTags: ["builder"], note: "Wrote the storage engine alone. He is 42 years old." });
    expect(call.note).toBe("Wrote the storage engine alone. [removed: personal detail]");

    // So are pasted conversation notes, before they become evidence.
    const action: OutreachAction = { id: newId("out"), swarmId: swarm.id, founderId: founder.id, kind: "call_founder", target: { name: founder.name, role: null, relationship: null, channelHint: null }, rationale: "Partner said yes", draft: { subject: null, body: null, agenda: [], questions: [], disclosure: "I am an AI assistant calling for the fund." }, consentBasis: "Founder agreed to a call", status: "approved", decidedBy: "Partner", decidedAt: stamp, decisionNote: null, resultSummary: null, transcriptEvidenceId: null, createdByTaskId: null, createdAt: stamp, updatedAt: stamp };
    store.insertOutreach(action);
    // Edits to a draft and the note on a decision pass the same boundary. The disclosure is untouched.
    const emailAction: OutreachAction = { ...action, id: newId("out"), kind: "email_founder", status: "proposed", decidedBy: null, decidedAt: null, draft: { subject: "Hello", body: "Draft", agenda: [], questions: [], disclosure: "Written by code." } };
    store.insertOutreach(emailAction);
    const edited = await api.decideOutreach(emailAction.id, { decision: "approve", note: "Fine. He is 42 years old.", draft: { ...emailAction.draft, body: "I liked the merge path. I hear you are married now." } });
    expect(edited.draft.body).toBe("I liked the merge path. [removed: personal detail]");
    expect(edited.draft.disclosure).toBe("Written by code.");
    expect(edited.decisionNote).toBe("Fine. [removed: personal detail]");

    const done = await api.completeOutreach(action.id, { summary: "Good call at +14155550123. His wife joined for a minute.", transcript: "Founder: call me at +1 (415) 555-0123.\nFounder: I rebuilt the index three times.\nFounder: I was born in 1984 and started coding early." });
    expect(done.resultSummary).toBe("Good call at [removed: phone number]. [removed: personal detail]");
    const transcript = store.listEvidence(founder.id).find((item) => item.kind === "call_transcript");
    expect(transcript?.excerpt).toBe("Founder: call me at [removed: phone number].\nFounder: I rebuilt the index three times.\n[removed: personal detail]");
  });

  it("reports stage progress for active and finished runs", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Runs", thesis });
    const agent = store.listAgents(swarm.id).find((item) => item.jobId === "scout.hackernews")!;
    const running = runRecord(swarm.id, { stage: "investigate" }); store.insertRun(running);
    store.insertTask(taskRecord(running, agent, "succeeded", "scout"));
    const detail = await api.getRun(running.id);
    expect(detail.stages.find((stage) => stage.stage === "plan")?.state).toBe("done");
    expect(detail.stages.find((stage) => stage.stage === "scout")?.state).toBe("done");
    expect(detail.stages.find((stage) => stage.stage === "investigate")?.state).toBe("running");
    expect(detail.stages.find((stage) => stage.stage === "verify")?.state).toBe("pending");
    const finished = runRecord(swarm.id, { status: "succeeded", stage: null, finishedAt: stamp }); store.insertRun(finished);
    store.insertTask(taskRecord(finished, agent, "succeeded", "scout"));
    const done = await api.getRun(finished.id);
    expect(done.stages.find((stage) => stage.stage === "scout")?.state).toBe("done");
    expect(done.stages.find((stage) => stage.stage === "investigate")?.state).toBe("skipped");
    expect(done.stages.find((stage) => stage.stage === "digest")?.state).toBe("done");
  });

  it("groups overview runs by UTC day and summarizes only each founder's latest call", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Overview", thesis });
    const first = runRecord(swarm.id, { status: "succeeded", stage: null, startedAt: "2026-11-11T23:55:00.000Z", finishedAt: "2026-11-11T23:56:00.000Z", stats: { ...ZERO_STATS, leads: 2, surfaced: 1 }, costUsd: 1 });
    const second = runRecord(swarm.id, { status: "succeeded", stage: null, startedAt: "2026-11-12T00:05:00.000Z", finishedAt: "2026-11-12T00:06:00.000Z", stats: { ...ZERO_STATS, leads: 3, surfaced: 2 }, costUsd: 2 });
    store.insertRun(first); store.insertRun(second);
    const founder = founderRecord(swarm.id); store.insertFounder(founder); store.insertAssessment(assessment(founder.id));
    store.insertFeedback({ id: newId("fbk"), founderId: founder.id, author: "Partner", verdict: "yes", reasonTags: ["builder"], note: null, createdAt: "2026-11-11T00:00:00.000Z" });
    store.insertFeedback({ id: newId("fbk"), founderId: founder.id, author: "Partner", verdict: "no", reasonTags: ["outside_thesis"], note: null, createdAt: "2026-11-12T00:00:00.000Z" });
    const overview = await api.getOverview(swarm.id);
    expect(overview.funnel.map((day) => [day.date, day.leads, day.surfaced, day.costUsd])).toEqual([["2026-11-11", 2, 1, 1], ["2026-11-12", 3, 2, 2]]);
    expect(overview.calls.yes).toBe(0);
    expect(overview.calls.no).toBe(1);
    expect(overview.calls.waiting).toBe(0);
    expect(overview.totals).toMatchObject({ leads: 5, surfaced: 3, founders: 1 });
  });

  it("counts the eval's winner in the trend and refuses to put a reverted round into use", async () => {
    const { service, store, setFlow, setVariant } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Eval", thesis });
    const round = (id: string, status: "baseline" | "champion" | "reverted", score: number) => ({ id, round: id === "baseline" ? 0 : Number(id.slice(1)), description: id, rationale: "", status, train: {}, test: { rank: score }, testInterval: null, costUsd: 1, config: { ...BASE_CONFIG, id: `cfg_${id}`, label: id }, changes: [], createdAt: stamp });
    // The real eval reports its current winner as "champion", never as "kept".
    setFlow({ id: "ranking", label: "Ranking", description: "test", headlineMetric: "rank", baseline: 0.5, best: 0.6, rounds: 2, updatedAt: stamp, metrics: [], goal: { target: "rank", direction: "higher", hold: [] }, cases: { train: 2, test: 2, reps: 1 }, noiseFloor: null, dataNote: "sim", variants: [round("baseline", "baseline", 0.5), round("v1", "reverted", 0.4), round("v2", "champion", 0.6)], bestVariant: "v2", promotedVariant: null, narrative: "" } satisfies EvalFlowDTO);
    expect((await api.getOverview(swarm.id)).evalTrend).toEqual([{ variant: "baseline", test: 0.5 }, { variant: "v2", test: 0.6 }]);
    setVariant({ ...BASE_CONFIG, id: "cfg_v1", label: "v1" });
    await expectServiceError(api.promoteEvalVariant("ranking", { variant: "v1", swarmId: swarm.id }), 409);
    expect(store.getSwarm(swarm.id)?.configId).toBe(BASE_CONFIG.id);
  });

  it("continues scheduled runs after a refusal and limits catch-up to named swarms", async () => {
    const { service, store, refused } = createHarness(); const api = service.as("Partner");
    const first = await api.createSwarm({ name: "First", thesis });
    const second = await api.createSwarm({ name: "Second", thesis });
    const paused = await api.createSwarm({ name: "Paused", thesis }); await api.updateSwarm(paused.id, { status: "paused" });
    const ranToday = await api.createSwarm({ name: "Ran today", thesis }); await api.updateSwarm(ranToday.id, { status: "paused" });
    const missed = await api.createSwarm({ name: "Missed", thesis }); await api.updateSwarm(missed.id, { status: "paused" });
    refused.add(first.id);
    store.saveSettings({ ...DEFAULT_SETTINGS, schedule: { ...DEFAULT_SETTINGS.schedule, enabled: true, brain: "live", sources: "live" } });
    const started = await service.runScheduled();
    expect(started).toHaveLength(1);
    expect(started[0]?.swarmId).toBe(second.id);
    expect(started[0]?.trigger).toBe("schedule");
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Scheduler", action: "run.start", target: started[0]?.id });
    expect(store.recentAudit(3).some((entry) => entry.action === "run.start_refused" && entry.target === first.id)).toBe(true);

    await api.updateSwarm(ranToday.id, { status: "active" });
    await api.updateSwarm(missed.id, { status: "active" });
    const catchUp = await service.runScheduled([missed.id]);
    expect(catchUp.map((run) => run.swarmId)).toEqual([missed.id]);
    expect(store.listRuns(ranToday.id, 10)).toEqual([]);
  });

  it("audits manual run start and cancellation under the requesting actor", async () => {
    const { service, store } = createHarness(); const api = service.as("Morgan");
    const swarm = await api.createSwarm({ name: "Manual run", thesis });
    const run = await api.startRun({ swarmId: swarm.id, brain: "sim", sources: "sim" });
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Morgan", action: "run.start", target: run.id });
    await api.cancelRun(run.id);
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Morgan", action: "run.cancel", target: run.id });
    await expectServiceError(api.cancelRun(run.id), 409);
  });

  it("shows each operational alert only after its condition is present", async () => {
    const { service, store, setSourceConfigured } = createHarness(); const api = service.as("Casey");
    const swarm = await api.createSwarm({ name: "Alerts", thesis });
    store.saveSettings({ ...DEFAULT_SETTINGS, schedule: { ...DEFAULT_SETTINGS.schedule, enabled: true, sources: "live" } });
    let ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.size).toBe(0);
    await api.updateSettings({ killSwitch: true, operatorName: " Casey " });
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.has("kill-switch")).toBe(true);
    // The stop covers eval rounds too: a live round spends money just as a run does.
    await expectServiceError(api.runEvalRounds("ranking", { rounds: 1 }), 409);
    await api.updateSettings({ killSwitch: false });

    setSourceConfigured(false);
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(["source-hackernews", "source-github", "source-arxiv", "source-people_data"].every((id) => ids.has(id))).toBe(true);
    setSourceConfigured(true);

    const run = runRecord(swarm.id, { status: "failed", error: "Provider unavailable", finishedAt: stamp, stats: { ...ZERO_STATS, failures: 1 } });
    store.insertRun(run);
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.has(`run-failed-${run.id}`)).toBe(true);
    expect(ids.has(`run-tasks-${run.id}`)).toBe(true);
    store.updateRun(run.id, { status: "budget_stopped" });
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.has(`run-budget-${run.id}`)).toBe(true);
    store.updateRun(run.id, { status: "succeeded", stats: { ...ZERO_STATS } });
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.has(`run-failed-${run.id}`)).toBe(false);
    expect(ids.has(`run-budget-${run.id}`)).toBe(false);
    expect(ids.has(`run-tasks-${run.id}`)).toBe(false);

    const badDirective = { id: newId("dir"), scope: { swarmId: swarm.id }, kind: "param" as const, key: "screen.min_fit", value: 2, text: null, priority: 0, status: "active" as const, author: "Partner", note: null, createdAt: stamp, updatedAt: stamp, expiresAt: null };
    store.insertDirective(badDirective);
    const callFounders = Array.from({ length: 3 }, () => founderRecord(swarm.id));
    for (const [index, founder] of callFounders.entries()) {
      store.insertFounder(founder);
      store.insertAssessment(assessment(founder.id));
      store.insertFeedback({ id: newId("fbk"), founderId: founder.id, author: "Partner", verdict: "no", reasonTags: ["outside_thesis"], note: null, createdAt: new Date(fixedAt.getTime() + 1000 + index).toISOString() });
    }
    const founder = callFounders[0]!;
    const oldAction: OutreachAction = { id: newId("out"), swarmId: swarm.id, founderId: founder.id, kind: "email_founder", target: { name: founder.name, role: null, relationship: null, channelHint: null }, rationale: "Review needed", draft: { subject: "Intro", body: "Draft", agenda: [], questions: [], disclosure: "AI assistant for the fund" }, consentBasis: "Founder requested contact", status: "proposed", decidedBy: null, decidedAt: null, decisionNote: null, resultSummary: null, transcriptEvidenceId: null, createdByTaskId: null, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" };
    store.insertOutreach(oldAction);
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.has(`directive-${badDirective.id}`)).toBe(true);
    expect(ids.has("suggestions")).toBe(true);
    expect(ids.has(`outreach-${oldAction.id}`)).toBe(true);
    expect((await api.getOverview(swarm.id)).alerts.find((alert) => alert.id === "kill-switch")).toBeUndefined();
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Casey", action: "settings.update" });
  });

  it("lists companies and assembles a detail with the assessed lead founder first", async () => {
    const { service, store } = createHarness(); const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Companies", thesis });
    const company = companyRecord(swarm.id); store.insertCompany(company);
    const early = { ...founderRecord(swarm.id), id: newId("fnd"), companyId: company.id, firstSeenAt: "2026-01-01T00:00:00.000Z" };
    const lead = { ...founderRecord(swarm.id), id: newId("fnd"), companyId: company.id, firstSeenAt: "2026-02-01T00:00:00.000Z" };
    store.insertFounder(early); store.insertFounder(lead);
    store.insertAssessment(assessment(early.id)); store.insertAssessment(assessment(lead.id));
    const companyScore = companyAssessment(company.id, lead.id, 0.91);
    store.insertCompanyAssessment(companyScore);
    store.upsertCompanyMember(companyMember(company.id, "Lead Founder"));
    store.insertEvidence(companyEvidence(lead.id, company.id, "company-older", "2026-11-10T00:00:00.000Z"));
    store.insertEvidence(companyEvidence(lead.id, company.id, "company-newer", "2026-11-11T00:00:00.000Z"));
    const contact: NetworkContact = { id: stableId("net", "Partner:person"), owner: "Partner", name: "Known Operator", company: "Vector Works, Inc.", position: "Founder", profileUrl: "https://www.linkedin.com/in/known", connectedOn: null, importedAt: stamp, previous: null };
    store.replaceNetwork("Partner", [contact]);
    const run = runRecord(swarm.id, { status: "succeeded", stage: null }); store.insertRun(run);
    const companyAgent = store.listAgents(swarm.id).find((agent) => agent.jobId === "company.product")!;
    store.insertTask({ ...taskRecord(run, companyAgent, "succeeded"), id: "company-task-older", companyId: company.id, startedAt: "2026-11-10T00:00:00.000Z", trace: [{ role: "assistant", content: "private trace" }] });
    store.insertTask({ ...taskRecord(run, companyAgent, "succeeded"), id: "company-task-newer", companyId: company.id, startedAt: "2026-11-11T00:00:00.000Z", trace: [{ role: "assistant", content: "private trace" }] });
    const listed = await api.listCompanies({ swarmId: swarm.id, sort: "deal" });
    expect(listed.rows.map((row) => row.id)).toEqual([company.id]);
    expect(listed.rows[0]).toMatchObject({ deal: 0.91, knownPeople: 1, founders: [{ id: lead.id }, { id: early.id }] });
    const detail = await api.getCompany(company.id);
    expect(detail.founders.map((row) => row.id)).toEqual([lead.id, early.id]);
    expect(detail.founders[0]).toMatchObject({ companyId: company.id, decision: "surface", composite: 0.8 });
    expect(detail.members).toHaveLength(1);
    expect(detail.assessment).toEqual(companyScore);
    expect(detail.history).toEqual([{ at: stamp, deal: 0.91, decision: "surface" }]);
    expect(detail.evidence.map((item) => item.id)).toEqual(["company-newer", "company-older"]);
    expect(detail.knownPeople).toEqual([contact]);
    expect(detail.tasks.map((task) => task.id)).toEqual(["company-task-newer", "company-task-older"]);
    expect(detail.tasks[0]).not.toHaveProperty("trace");
    expect((await api.getFounder(lead.id)).knownPeople).toEqual([contact]);
    await expectServiceError(api.listCompanies({ swarmId: "missing" }), 404);
    await expectServiceError(api.getCompany("missing"), 404);
  });

  it("validates company reason tags, redacts notes, and applies company call status", async () => {
    const { service, store } = createHarness(); const api = service.as("Taylor");
    const swarm = await api.createSwarm({ name: "Company calls", thesis });
    const company = companyRecord(swarm.id); store.insertCompany(company);
    await expectServiceError(api.addCompanyFeedback(company.id, { verdict: "yes", reasonTags: ["small_market"] }), 400, "reasonTags");
    const no = await api.addCompanyFeedback(company.id, { verdict: "no", reasonTags: ["wrong_stage"], note: "The market is early. The CEO is 42 years old." });
    expect(no).toMatchObject({ author: "Taylor", verdict: "no", note: "The market is early. [removed: personal detail]" });
    expect(store.getCompany(company.id)?.status).toBe("passed");
    const yes = await api.addCompanyFeedback(company.id, { verdict: "yes", reasonTags: ["strong_product"] });
    expect(yes.author).toBe("Taylor");
    expect(store.getCompany(company.id)?.status).toBe("surfaced");
    expect(store.recentAudit(1)[0]).toMatchObject({ action: "company_feedback.create", target: company.id });
  });

  it("adds manual founder leads with link classification and refuses invalid or personal details", async () => {
    const { service, store } = createHarness(); const api = service.as("Alex");
    const swarm = await api.createSwarm({ name: "Manual leads", thesis });
    const cases = [
      ["https://github.com/example", "github"],
      ["https://twitter.com/example", "x"],
      ["https://scholar.google.com/citations?user=example", "scholar"],
      ["https://www.linkedin.com/in/example", "linkedin"],
      ["https://example.com/profile", "site"],
    ] as const;
    for (const [link, field] of cases) {
      const lead = await api.addFounder({ swarmId: swarm.id, name: "Manual Founder", companyName: "Vector Works", companyUrl: "https://vector.example", link });
      expect(lead.source).toBe("manual");
      expect(lead.sourceTitle).toBe("Added by Alex");
      expect(lead.sourceRef).toBe(link);
      expect(lead.links[field]).toBe(link);
      expect(lead.founderId).toBeNull();
    }
    const fallback = await api.addFounder({ swarmId: swarm.id, name: "No Link" });
    expect(fallback.sourceRef).toBe(`manual:${fallback.id}`);
    expect(fallback.why).toBe("Added by Alex.");
    await expectServiceError(api.addFounder({ swarmId: swarm.id, name: "  " }), 400, "name");
    await expectServiceError(api.addFounder({ swarmId: swarm.id, name: "x".repeat(201) }), 400, "name");
    await expectServiceError(api.addFounder({ swarmId: swarm.id, name: "Bad company URL", companyUrl: "ftp://vector.example" }), 400, "companyUrl");
    await expectServiceError(api.addFounder({ swarmId: swarm.id, name: "Bad profile link", link: "/relative" }), 400, "link");
    await expectServiceError(api.addFounder({ swarmId: swarm.id, name: "Sensitive", why: "She is 42 years old." }), 400, "why");
    expect(store.listLeads({ swarmId: swarm.id, unmatchedOnly: true })).toHaveLength(6);
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Alex", action: "founder.add" });
  });

  it("imports contact lists, creates only new founder leads in every active swarm, and removes an owner", async () => {
    const { service, store } = createHarness(); const api = service.as("Morgan");
    const firstSwarm = await api.createSwarm({ name: "First network swarm", thesis });
    const secondSwarm = await api.createSwarm({ name: "Second network swarm", thesis });
    const paused = await api.createSwarm({ name: "Paused network swarm", thesis }); await api.updateSwarm(paused.id, { status: "paused" });
    const contacts = [
      ["Alice", "New", "https://www.linkedin.com/in/alice", "Acme", "Staff Engineer", "2024-01-01", "alice-private@example.com"],
      ["Bob", "Same", "https://www.linkedin.com/in/bob", "Startup", "Founder", "2024-01-02"],
      ["Carol", "Staff", "https://www.linkedin.com/in/carol", "Factory", "Staff Engineer", "2024-01-03"],
      ["Dana", "Still", "https://www.linkedin.com/in/dana", "Studio", "Founder", "2024-01-04"],
    ];
    const first = await api.importNetwork({ csv: contactCsv(contacts) });
    expect(first).toMatchObject({ owner: "Morgan", imported: 4, changed: 0, leads: 0, network: { total: 4, owners: [{ owner: "Morgan", contacts: 4 }] } });
    const second = await api.importNetwork({ csv: contactCsv([
      ["Alice", "New", "https://www.linkedin.com/in/alice", "Stealth", "Founder", "2024-01-01", "updated-private@example.com"],
      contacts[1]!,
      ["Carol", "Staff", "https://www.linkedin.com/in/carol", "Factory", "Engineering Manager", "2024-01-03"],
      ["Dana", "Still", "https://www.linkedin.com/in/dana", "Studio", "Co-Founder", "2024-01-04"],
    ]) });
    expect(second).toMatchObject({ imported: 4, changed: 3, leads: 1, network: { total: 4 } });
    expect(JSON.stringify({ first, second, stored: store.listNetwork(), audit: store.recentAudit(8) })).not.toMatch(/alice-private@example\.com|updated-private@example\.com/);
    for (const swarm of [firstSwarm, secondSwarm]) {
      const leads = store.listLeads({ swarmId: swarm.id, unmatchedOnly: true });
      expect(leads).toHaveLength(1);
      expect(leads[0]).toMatchObject({ source: "network", sourceRef: "https://www.linkedin.com/in/alice", sourceTitle: "Contact list of Morgan", personName: "Alice New", role: "Founder", companyName: "Stealth", links: { linkedin: "https://www.linkedin.com/in/alice" }, why: "Changed from Staff Engineer at Acme to Founder at Stealth." });
    }
    expect(store.listLeads({ swarmId: paused.id })).toHaveLength(0);
    expect(store.recentAudit(1)[0]?.detail).toEqual({ imported: 4, changed: 3, leads: 1 });

    // A title is free text. A personal detail typed there is removed before the contact is stored.
    await api.importNetwork({ csv: contactCsv([
      ["Erin", "Typed", "https://www.linkedin.com/in/erin", "Lab. She is married.", "Engineer. He is 42 years old.", "2024-01-05"],
    ]) });
    const stored = store.listNetwork().find((contact) => contact.name === "Erin Typed");
    expect(stored?.position).not.toMatch(/42|years old/);
    expect(stored?.position).toContain("Engineer");
    expect(stored?.company).not.toMatch(/married/);
    expect(stored?.company).toContain("Lab");
    await api.importNetwork({ csv: contactCsv([
      ["Erin", "Typed", "https://www.linkedin.com/in/erin", "Newco. She is married.", "Founder. He is 42 years old.", "2024-01-05"],
    ]) });
    const typedLead = store.listLeads({ swarmId: firstSwarm.id, unmatchedOnly: true }).find((lead) => lead.personName === "Erin Typed");
    expect(typedLead).toBeDefined();
    expect([typedLead?.personName, typedLead?.role, typedLead?.companyName, typedLead?.why].join(" ")).not.toMatch(/42 years old|married/);
    await expectServiceError(api.importNetwork({ csv: "bad csv" }), 400, "csv");
    await expectServiceError(api.importNetwork({ csv: "x".repeat(8_000_001) }), 400, "csv");
    const network = await api.removeNetwork("Morgan");
    expect(network).toEqual({ owners: [], total: 0 });
    expect(store.listNetwork()).toHaveLength(0);
    expect(store.recentAudit(1)[0]).toMatchObject({ action: "network.remove", target: "Morgan" });
  });

  it("counts surfaced companies waiting for calls and alerts only for the last finished planted-check failure", async () => {
    const { service, store } = createHarness(); const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Company overview", thesis });
    const waiting: Company[] = [];
    for (let index = 0; index < 6; index++) {
      const company = companyRecord(swarm.id, newId("cmp"), "surfaced", `Company ${index}`);
      waiting.push(company); store.insertCompany(company);
      store.insertCompanyAssessment(companyAssessment(company.id, null, 0.3 + index / 10));
    }
    const called = companyRecord(swarm.id, newId("cmp"), "surfaced", "Already called"); store.insertCompany(called);
    store.insertCompanyAssessment(companyAssessment(called.id, null, 1));
    store.insertCompanyFeedback({ id: newId("cfb"), companyId: called.id, author: "Partner", verdict: "yes", reasonTags: ["right_time"], note: null, createdAt: stamp });
    for (let index = 0; index < 499; index++) {
      const alreadyCalled = companyRecord(swarm.id, newId("cmp"), "surfaced", `Called ${index}`);
      store.insertCompany(alreadyCalled);
      store.insertCompanyAssessment(companyAssessment(alreadyCalled.id, null, 0.99));
      store.insertCompanyFeedback({ id: newId("cfb"), companyId: alreadyCalled.id, author: "Partner", verdict: "yes", reasonTags: ["right_time"], note: null, createdAt: stamp });
    }
    let overview = await api.getOverview(swarm.id);
    expect(overview.companiesWaiting).toBe(6);
    expect(overview.topCompanies?.map((row) => row.id)).toEqual(waiting.slice().reverse().slice(0, 5).map((company) => company.id));
    const failed = runRecord(swarm.id, { status: "succeeded", stage: null, finishedAt: stamp, stats: { ...ZERO_STATS, controlsFailed: 2 } }); store.insertRun(failed);
    overview = await api.getOverview(swarm.id);
    const controlAlert = overview.alerts.find((alert) => alert.id === "control-failed");
    expect(controlAlert).toMatchObject({ level: "warning", title: "The fact-checker failed a planted check", link: "/swarm?node=job:verify.claims" });
    expect(controlAlert?.detail).toContain("2 fact-check calls in the last run accepted a made-up claim");
    expect(controlAlert?.detail).toContain("verdicts were thrown away");
    expect(controlAlert?.detail).toContain("another model for the fact-checker");
    store.insertRun(runRecord(swarm.id, { startedAt: "2026-11-13T00:00:00.000Z", status: "running", finishedAt: null }));
    expect((await api.getOverview(swarm.id)).alerts.some((alert) => alert.id === "control-failed")).toBe(true);
    store.insertRun(runRecord(swarm.id, { startedAt: "2026-11-14T00:00:00.000Z", status: "succeeded", finishedAt: "2026-11-14T00:01:00.000Z", stats: { ...ZERO_STATS } }));
    expect((await api.getOverview(swarm.id)).alerts.some((alert) => alert.id === "control-failed")).toBe(false);
  });

});
