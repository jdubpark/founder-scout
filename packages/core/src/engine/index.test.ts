import { afterEach, describe, expect, it } from "vitest";
import {
  BASE_CONFIG,
  DEFAULT_SETTINGS,
  JOBS,
  ZERO_STATS,
  getJob,
  renderCallsBlock,
  type Agent,
  type Assessment,
  type Directive,
  type Evidence,
  type JobInput,
  type Feedback,
  type Founder,
  type Memo,
  type ModelJobId,
  type JobOutput,
  type OutreachAction,
  type Run,
  type Swarm,
  type SwarmConfig,
  type TaskRun,
  type Thesis,
  type Usage,
} from "@agentswarm/shared";
import { createExecuteJob, createJobRegistry } from "../jobs";
import { openStore } from "../db";
import { createSimRepoFinder, createSimSources, createSimWorld } from "../sim";
import { ProviderError } from "../contracts";
import type { ExecuteJob, JobContext, ProviderRegistry, SimFounder, SimWorld, SourceRegistry } from "../contracts";
import { createRunController } from "./index";

const NOW = new Date("2026-11-12T18:00:00.000Z");
const SWARM_ID = "swm_engine_test";
const CONFIG_ID = "cfg_engine_test";
const THESIS: Thesis = {
  summary: "Back technical founders building useful software companies.",
  sectors: ["Developer tools", "Applied AI", "Climate software", "Robotics", "Healthcare software", "Financial infrastructure", "Industrial automation", "Education technology"],
  stages: ["pre-seed", "seed", "series A"],
  geos: ["Portland", "Madison", "Austin", "Raleigh", "Toronto", "Dublin", "Helsinki", "Melbourne"],
  avoid: [],
};

const scratchStores: Array<ReturnType<typeof openStore>> = [];
afterEach(() => {
  for (const store of scratchStores.splice(0)) store.close();
});

function makeSwarm(overrides: Partial<Swarm> = {}): Swarm {
  return {
    id: SWARM_ID,
    name: "Engine test swarm",
    status: "active",
    thesis: THESIS,
    configId: CONFIG_ID,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeAgent(jobId: Agent["jobId"], options: { id?: string; status?: Agent["status"]; beat?: string | null } = {}): Agent {
  const meta = getJob(jobId);
  return {
    id: options.id ?? `agt_${jobId.replace(/[^a-z0-9]/gi, "_")}`,
    swarmId: SWARM_ID,
    jobId,
    classId: meta.classId,
    name: meta.label,
    status: options.status ?? "active",
    beat: options.beat ?? null,
    state: {},
    createdAt: NOW.toISOString(),
  };
}

function makeDirective(input: Partial<Directive> & Pick<Directive, "id" | "scope" | "kind">): Directive {
  return {
    id: input.id,
    scope: input.scope,
    kind: input.kind,
    key: input.key ?? null,
    value: input.value ?? null,
    text: input.text ?? null,
    priority: input.priority ?? 0,
    status: input.status ?? "active",
    author: input.author ?? "Partner",
    note: input.note ?? null,
    createdAt: input.createdAt ?? NOW.toISOString(),
    updatedAt: input.updatedAt ?? NOW.toISOString(),
    expiresAt: input.expiresAt ?? null,
  };
}

function makeFounder(sim: SimFounder, id: string, overrides: Partial<Founder> = {}): Founder {
  return {
    id,
    swarmId: SWARM_ID,
    name: sim.name,
    headline: sim.headline,
    location: sim.location,
    company: { name: sim.companyName, url: sim.links.site, oneLiner: sim.companyOneLiner, stage: sim.stage },
    links: sim.links,
    status: "queued",
    fit: 0.9,
    fitReasons: ["Matches the thesis."],
    tags: [sim.sector],
    identityConfidence: 1,
    sources: ["github"],
    firstSeenAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    lastAssessedAt: null,
    nextRecheckAt: null,
    simId: sim.simId,
    ...overrides,
  };
}

const memo: Memo = {
  headline: "A strong technical founder",
  body: "Evidence supports a partner conversation.",
  strengths: ["Built and shipped a useful system."],
  risks: [],
  openQuestions: ["What do customers need next?"],
  nextStep: "Discuss the company with the founder.",
};

function makeAssessment(founderId: string, overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: `asm_${founderId}`,
    founderId,
    runId: "run_previous",
    configId: CONFIG_ID,
    composite: 0.8,
    cracked: 0.8,
    founderScore: 0.8,
    coverage: 0.8,
    potential: 0.8,
    fit: 0.8,
    decision: "surface",
    reasons: ["The founder has a strong professional record."],
    flags: [],
    breakdown: [],
    judgments: [],
    summary: "Existing evidence supports a partner conversation.",
    memo,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeFeedback(
  id: string,
  founderId: string,
  verdict: Feedback["verdict"],
  createdAt: string,
  options: { reasonTags?: string[]; note?: string | null } = {},
): Feedback {
  return {
    id,
    founderId,
    author: "Partner",
    verdict,
    reasonTags: options.reasonTags ?? [],
    note: options.note ?? null,
    createdAt,
  };
}

function makeRun(id: string, status: Run["status"]): Run {
  return {
    id,
    swarmId: SWARM_ID,
    trigger: "manual",
    brain: "sim",
    sources: "sim",
    status,
    stage: "scout",
    configId: CONFIG_ID,
    budgetUsd: 10,
    costUsd: 0,
    stats: { ...ZERO_STATS },
    error: null,
    simDay: null,
    startedAt: NOW.toISOString(),
    finishedAt: null,
  };
}

function makeTask(id: string, runId: string, status: TaskRun["status"]): TaskRun {
  return {
    id,
    runId,
    swarmId: SWARM_ID,
    agentId: "agt_scout_github",
    jobId: "scout.github",
    classId: "scout",
    stage: "scout",
    founderId: null,
    status,
    skipReason: null,
    attempt: 1,
    provider: "sim",
    model: "test-model",
    effort: null,
    inputSummary: "A public source item.",
    outputSummary: null,
    output: null,
    steering: { directiveIds: [], params: {}, block: "" },
    usage: null,
    costUsd: null,
    latencyMs: null,
    itemsOut: 0,
    error: null,
    startedAt: NOW.toISOString(),
    finishedAt: null,
  };
}

function makeProviderRegistry(onGet: () => never): ProviderRegistry {
  return {
    get: () => onGet(),
    statuses: async () => [],
  };
}

interface HarnessOptions {
  agentJobs?: Array<Agent | Agent["jobId"]>;
  config?: Partial<SwarmConfig>;
  simWorld?: SimWorld;
  simSources?: SourceRegistry;
  providerError?: () => never;
  wrapExecuteJob?: (delegate: ExecuteJob) => ExecuteJob;
}

function makeHarness(options: HarnessOptions = {}) {
  const store = openStore(":memory:");
  scratchStores.push(store);
  const world = options.simWorld ?? createSimWorld({ seed: 917, founders: 5, days: 4 });
  const jobs = createJobRegistry();
  const providerError = options.providerError ?? (() => {
    throw new ProviderError("not_configured", "No live provider is configured.");
  });
  let providerCalls = 0;
  const onProviderGet = () => {
    providerCalls += 1;
    return providerError();
  };
  const providers = makeProviderRegistry(onProviderGet);
  const realExecuteJob = createExecuteJob({ jobs, providers });
  const executeJob = options.wrapExecuteJob ? options.wrapExecuteJob(realExecuteJob) : realExecuteJob;
  const config: SwarmConfig = {
    ...BASE_CONFIG,
    id: CONFIG_ID,
    label: "Test configuration",
    ...options.config,
  };
  const swarm = makeSwarm();
  store.saveConfig(config);
  store.insertSwarm(swarm);
  for (const value of options.agentJobs ?? []) {
    store.insertAgent(typeof value === "string" ? makeAgent(value) : value);
  }
  const simSources = options.simSources ?? createSimSources(world);
  const noLiveSources: SourceRegistry = { get: () => null, statuses: async () => [] };
  const controller = createRunController({
    store,
    jobs,
    executeJob,
    sources: { sim: simSources, live: noLiveSources },
    repos: { sim: createSimRepoFinder(world), live: createSimRepoFinder(world) },
    simWorld: world,
    fundName: "Northstar Ventures",
    now: () => new Date(NOW),
    sleep: async () => undefined,
  });
  return { store, world, jobs, providers, controller, swarm, config, providerCallCount: () => providerCalls };
}

function makeOutreachAction(
  id: string,
  founderId: string,
  status: OutreachAction["status"],
  resultSummary: string | null = null,
): OutreachAction {
  return {
    id,
    swarmId: SWARM_ID,
    founderId,
    kind: "call_founder",
    target: { name: "Founder", role: "Founder", relationship: null, channelHint: null },
    rationale: "A partner-approved professional conversation.",
    draft: { subject: null, body: null, agenda: [], questions: [], disclosure: "With your consent, I may take notes." },
    consentBasis: "Partner approval.",
    status,
    decidedBy: status === "proposed" ? null : "Partner",
    decidedAt: status === "proposed" ? null : NOW.toISOString(),
    decisionNote: null,
    resultSummary,
    transcriptEvidenceId: null,
    createdByTaskId: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function makeTranscriptEvidence(id: string, founderId: string, excerpt: string): Evidence {
  return {
    id,
    founderId,
    kind: "call_transcript",
    source: "call",
    url: null,
    title: "Completed call transcript",
    excerpt,
    claim: "Call transcript awaiting debrief",
    publishedAt: null,
    capturedAt: NOW.toISOString(),
    collectedByTaskId: null,
    hash: `hash_${id}`,
    verification: "unverified",
    verificationNote: null,
    sim: null,
  };
}

function makeSupportedEvidence(id: string, founderId: string): Evidence {
  return {
    id,
    founderId,
    kind: "repo",
    source: "github",
    url: `https://github.com/example/${id}`,
    title: "A completed engineering project",
    excerpt: "The founder designed and shipped a technically demanding working system.",
    claim: "The founder personally built a technically demanding system.",
    publishedAt: null,
    capturedAt: NOW.toISOString(),
    collectedByTaskId: null,
    hash: `hash_${id}`,
    verification: "supported",
    verificationNote: null,
    sim: null,
  };
}

function item(sim: SimFounder, source: "hackernews" | "github", day: number, suffix: string): import("@agentswarm/shared").RawItem {
  return {
    ref: `https://sim.invalid/${source}/${day}/${suffix}`,
    source,
    title: `${sim.companyName} shares a new technical product`,
    text: `${sim.name} is building ${sim.companyName}, a new product for technical teams.`,
    author: sim.name,
    authorUrl: source === "github" ? sim.links.github : sim.links.site,
    publishedAt: new Date(Date.UTC(2025, 0, day + 1)).toISOString(),
    metrics: { stars: 80 },
    simFounderId: sim.simId,
  };
}

/** Keep the real simulator's profiles and outcomes, while controlling only the source timeline. */
function timelineWorld(): SimWorld {
  const base = createSimWorld({ seed: 608, founders: 3, days: 4 });
  const [first, second] = base.founders();
  if (!first || !second) throw new Error("The fixture needs two simulated founders.");
  const homonyms = [
    { ...first, name: "Alex Kim" },
    { ...second, name: "Alex Kim" },
  ];
  const byId = new Map(homonyms.map((founder) => [founder.simId, founder]));
  const timeline: Record<number, Partial<Record<"hackernews" | "github", import("@agentswarm/shared").RawItem[]>>> = {
    0: { hackernews: [item(homonyms[0]!, "hackernews", 0, "first"), item(homonyms[1]!, "hackernews", 0, "second")], github: [item(homonyms[0]!, "github", 0, "first")] },
    1: { hackernews: [item(homonyms[1]!, "hackernews", 1, "second")], github: [item(homonyms[0]!, "github", 1, "first")] },
    2: { hackernews: [item(homonyms[0]!, "hackernews", 2, "first")], github: [item(homonyms[1]!, "github", 2, "second")] },
  };
  return {
    seed: base.seed,
    founders: () => homonyms.map((founder) => ({ ...founder, links: { ...founder.links }, latent: { ...founder.latent } })),
    founder: (simId) => {
      const found = byId.get(simId);
      return found ? { ...found, links: { ...found.links }, latent: { ...found.latent } } : base.founder(simId);
    },
    itemsFor: (source, day, limit) => (timeline[day]?.[source as "hackernews" | "github"] ?? [])
      .slice(0, limit)
      .map((raw) => ({ ...raw, metrics: { ...raw.metrics } })),
    evidenceFor: (simId, jobId, depth) => {
      const original = base.founder(simId);
      const renamed = byId.get(simId);
      const evidence = base.evidenceFor(simId, jobId, depth);
      if (!original || !renamed) return evidence;
      const rename = (value: string) => value.replaceAll(original.name, renamed.name);
      return evidence.map((draft) => ({
        ...draft,
        title: rename(draft.title),
        excerpt: rename(draft.excerpt),
        claim: rename(draft.claim),
        sim: draft.sim ? {
          ...draft.sim,
          truth: "supported" as const,
          signals: draft.sim.signals.map((signal) => ({ ...signal, value: 0.98 })),
        } : draft.sim,
      }));
    },
    repos: (simId) => base.repos(simId),
    transcript: (simId, kind, targetName) => base.transcript(simId, kind, targetName),
  };
}

async function runThreeDays() {
  const world = timelineWorld();
  const harness = makeHarness({
    simWorld: world,
    agentJobs: JOBS.filter((job) => job.enabled).map((job) => job.id),
    config: {
      params: {
        "screen.min_fit": 0,
        "assess.surface_threshold": 0,
        "assess.min_coverage": 0,
        "assess.watch_threshold": 0,
      },
      routes: {
        "scout.hackernews": { provider: "openai-api", model: "gpt-6-astra", effort: "medium" },
        "scout.github": { provider: "openai-api", model: "gpt-6-astra", effort: "medium" },
        "screen.fit": { provider: "openai-api", model: "gpt-6-astra", effort: "medium" },
        "investigate.background": { provider: "openai-api", model: "gpt-6-astra", effort: "medium" },
        "verify.claims": { provider: "openai-api", model: "gpt-6-astra", effort: "medium" },
        "assess.judgments": { provider: "openai-api", model: "gpt-6-astra", effort: "medium" },
      },
    },
  });
  const runs: Run[] = [];
  for (let day = 0; day < 3; day += 1) {
    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim" });
    runs.push(await harness.controller.wait(started.id));
  }
  const founders = harness.store.listFounders({ swarmId: SWARM_ID });
  const tasks = runs.flatMap((run) => harness.store.listTasks({ runId: run.id }));
  const evidence = founders.flatMap((founder) => harness.store.listEvidence(founder.id));
  const surfacedIds = founders.filter((founder) => founder.status === "surfaced").map((founder) => founder.id).sort();
  const assessments = founders.map((founder) => harness.store.latestAssessment(founder.id))
    .filter((assessment): assessment is Assessment => assessment !== null);
  return { ...harness, runs, founders, tasks, evidence, assessments, surfacedIds };
}

describe("run engine", () => {
  it("advances a deterministic simulated timeline and matches cross-source identities without merging homonyms", async () => {
    const first = await runThreeDays();
    const second = await runThreeDays();

    expect(first.runs[0]!.simDay).not.toBeNull();
    expect(first.runs.map((run) => run.simDay)).toEqual([first.runs[0]!.simDay, first.runs[0]!.simDay! + 1, first.runs[0]!.simDay! + 2]);
    expect(first.runs.map((run) => run.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(first.runs.map((run) => run.stats.tasks)).toEqual(second.runs.map((run) => run.stats.tasks));
    expect(first.runs.map((run) => run.stats)).toEqual(second.runs.map((run) => run.stats));

    expect(first.founders).toHaveLength(2);
    expect(first.founders.map((founder) => founder.name)).toEqual(["Alex Kim", "Alex Kim"]);
    expect(new Set(first.founders.map((founder) => founder.id)).size).toBe(2);
    expect(first.founders.some((founder) => founder.sources.includes("hackernews") && founder.sources.includes("github"))).toBe(true);
    expect(first.founders.flatMap((founder) => founder.sources)).toContain("hackernews");
    expect(first.founders.flatMap((founder) => founder.sources)).toContain("github");
    expect(first.providerCallCount()).toBe(0);
    expect(first.surfacedIds.length).toBeGreaterThan(0);
    expect(first.surfacedIds).toEqual(second.surfacedIds);

    for (const run of first.runs) {
      const runTasks = first.tasks.filter((task) => task.runId === run.id);
      expect(run.stats.tasks).toBe(runTasks.length);
      expect(run.stats.failures).toBe(runTasks.filter((task) => task.status === "failed").length);
      const runTaskIds = new Set(runTasks.map((task) => task.id));
      expect(run.stats.evidence).toBe(first.evidence.filter((evidence) => runTaskIds.has(evidence.collectedByTaskId ?? "")).length);
    }
    expect(first.runs[0]!.stats.screened).toBeGreaterThan(0);
    expect(first.runs[0]!.stats.investigated).toBeGreaterThan(0);
    expect(first.runs[0]!.stats.evidence).toBeGreaterThan(0);
    expect(first.runs[0]!.stats.assessed).toBeGreaterThan(0);
    const taskById = new Map(first.tasks.map((task) => [task.id, task]));
    expect(first.evidence.length).toBeGreaterThan(0);
    for (const evidence of first.evidence) {
      const collectedBy = taskById.get(evidence.collectedByTaskId!);
      expect(collectedBy?.stage).toBe("investigate");
      expect(collectedBy?.founderId).toBe(evidence.founderId);
    }
    for (const assessment of first.assessments) {
      const founderEvidence = new Set(first.evidence.filter((evidence) => evidence.founderId === assessment.founderId).map((evidence) => evidence.id));
      const judgmentEvidence = assessment.judgments.flatMap((judgment) => [...judgment.evidenceIds, ...judgment.counterEvidenceIds]);
      expect(judgmentEvidence.every((id) => founderEvidence.has(id))).toBe(true);
      expect(assessment.runId).not.toBeNull();
      expect(first.tasks.some((task) => task.runId === assessment.runId && task.jobId === "assess.judgments" && task.founderId === assessment.founderId && task.status === "succeeded")).toBe(true);
    }
    expect(first.assessments.some((assessment) => assessment.judgments.some((judgment) => judgment.evidenceIds.length > 0))).toBe(true);

    const stableTasks = (tasks: TaskRun[]) => tasks.map((task) => ({
      jobId: task.jobId,
      stage: task.stage,
      founderId: task.founderId,
      status: task.status,
      attempt: task.attempt,
      output: task.output,
      itemsOut: task.itemsOut,
      steering: task.steering,
    }));
    expect(stableTasks(first.tasks)).toEqual(stableTasks(second.tasks));
    expect(first.runs.map((run) => run.simDay)).toEqual(second.runs.map((run) => run.simDay));
    expect(first.evidence).toEqual(second.evidence);
    expect(first.assessments).toEqual(second.assessments);
  });

  it("applies scoped steering, caps distinct founders investigated, and does not run paused agents", async () => {
    const world = createSimWorld({ seed: 612, founders: 4, days: 4 });
    const worldSources = createSimSources(world);
    const simSources: SourceRegistry = {
      get(id) {
        const adapter = worldSources.get(id);
        if (!adapter || (id !== "github" && id !== "hackernews")) return adapter;
        return {
          ...adapter,
          async fetch(request) {
            const founder = world.founders()[id === "github" ? 0 : 1]!;
            return { items: [item(founder, id, request.simDay ?? 0, `scoped-${id}`)], cursor: request.simDay };
          },
        };
      },
      statuses: () => worldSources.statuses(),
    };
    const agents = [
      makeAgent("scout.github"),
      makeAgent("scout.hackernews"),
      makeAgent("investigate.background", { id: "agt_background" }),
      makeAgent("investigate.company", { id: "agt_company_paused", status: "paused" }),
    ];
    const harness = makeHarness({
      simWorld: world,
      simSources,
      agentJobs: agents,
    });
    const founders = world.founders().slice(0, 3).map((sim, index) => makeFounder(sim, `fnd_queued_${index}`, { status: "queued" }));
    for (const founder of founders) harness.store.insertFounder(founder);
    harness.store.insertDirective(makeDirective({
      id: "dir_investigation_cap",
      scope: { swarmId: SWARM_ID },
      kind: "param",
      key: "investigate.max_founders",
      value: 3,
    }));
    harness.store.insertDirective(makeDirective({
      id: "dir_github_only",
      scope: { swarmId: SWARM_ID, jobId: "scout.github" },
      kind: "rule",
      text: "Prioritize repositories with an active product.",
    }));
    harness.store.insertDirective(makeDirective({
      id: "dir_investigator_rule",
      scope: { swarmId: SWARM_ID, classId: "investigator" },
      kind: "rule",
      text: "Cite the primary source for each professional claim.",
    }));
    harness.store.insertDirective(makeDirective({
      id: "dir_scout_only",
      scope: { swarmId: SWARM_ID, classId: "scout" },
      kind: "rule",
      text: "Look for open-source builders.",
    }));
    harness.store.insertDirective(makeDirective({
      id: "dir_other_swarm",
      scope: { swarmId: "swm_other" },
      kind: "rule",
      text: "Only for a different swarm.",
    }));

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim" });
    const run = await harness.controller.wait(started.id);
    const tasks = harness.store.listTasks({ runId: run.id });
    const investigation = tasks.filter((task) => task.stage === "investigate");

    expect(run.status).toBe("succeeded");
    expect(new Set(investigation.filter((task) => task.status === "succeeded").map((task) => task.founderId)).size).toBe(3);
    expect(investigation.some((task) => task.status === "succeeded")).toBe(true);
    const pausedTasks = investigation.filter((task) => task.agentId === "agt_company_paused");
    expect(pausedTasks.length).toBeGreaterThan(0);
    expect(pausedTasks.every((task) => task.status === "skipped" && task.skipReason === "Agent is paused.")).toBe(true);
    const task = investigation.find((candidate) => candidate.status === "succeeded")!;
    expect(task.steering.params["investigate.max_founders"]).toBe(3);
    expect(task.steering.directiveIds).toContain("dir_investigator_rule");
    expect(task.steering.directiveIds).toContain("dir_investigation_cap");
    expect(task.steering.directiveIds).not.toContain("dir_scout_only");
    expect(task.steering.directiveIds).not.toContain("dir_other_swarm");
    expect(task.steering.block).toContain("Cite the primary source");
    expect(task.steering.block).not.toContain("open-source builders");
    const githubScout = tasks.find((candidate) => candidate.jobId === "scout.github" && candidate.status === "succeeded");
    const hnScout = tasks.find((candidate) => candidate.jobId === "scout.hackernews" && candidate.status === "succeeded");
    expect(githubScout?.steering.directiveIds).toContain("dir_github_only");
    expect(githubScout?.steering.block).toContain("Prioritize repositories with an active product.");
    expect(hnScout?.steering.directiveIds).not.toContain("dir_github_only");
    expect(hnScout?.steering.block).not.toContain("Prioritize repositories with an active product.");
  });

  it("rejects starts while the kill switch, swarm pause, or another run blocks execution", async () => {
    const harness = makeHarness();
    const start = () => harness.controller.start({ swarmId: SWARM_ID, trigger: "manual" });

    await expect(harness.controller.start({ swarmId: "swm_missing", trigger: "manual" }))
      .rejects.toMatchObject({ status: 404, message: "This swarm does not exist." });

    harness.store.saveSettings({ ...DEFAULT_SETTINGS, killSwitch: true });
    await expect(start()).rejects.toMatchObject({ status: 409 });
    expect(harness.store.listRuns(SWARM_ID, 10)).toHaveLength(0);

    harness.store.saveSettings(DEFAULT_SETTINGS);
    harness.store.updateSwarm(SWARM_ID, { status: "paused" });
    await expect(start()).rejects.toMatchObject({ status: 409 });
    expect(harness.store.listRuns(SWARM_ID, 10)).toHaveLength(0);

    harness.store.updateSwarm(SWARM_ID, { status: "active" });
    harness.store.insertRun(makeRun("run_already_active", "running"));
    await expect(start()).rejects.toMatchObject({ status: 409 });
    expect(harness.store.listRuns(SWARM_ID, 10)).toHaveLength(1);
  });

  it("cancels a run in flight before it starts a task", async () => {
    const world = createSimWorld({ seed: 18, founders: 2, days: 2 });
    const normal = createSimSources(world);
    let announceFetch!: () => void;
    let unblockFetch!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { announceFetch = resolve; });
    const fetchGate = new Promise<void>((resolve) => { unblockFetch = resolve; });
    const simSources: SourceRegistry = {
      get(id) {
        const adapter = normal.get(id);
        if (!adapter) return null;
        if (id !== "github") return adapter;
        return {
          ...adapter,
          async fetch(request) {
            announceFetch();
            await fetchGate;
            return adapter.fetch(request);
          },
        };
      },
      statuses: () => normal.statuses(),
    };
    const harness = makeHarness({ simWorld: world, simSources, agentJobs: ["scout.github"] });
    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim" });
    await fetchStarted;
    const cancelled = await harness.controller.cancel(started.id);
    unblockFetch();
    const finished = await harness.controller.wait(started.id);

    expect(cancelled.status).toBe("cancelled");
    expect(finished.status).toBe("cancelled");
    expect(harness.store.listTasks({ runId: started.id })).toEqual([]);
  });

  it("stops starting tasks at the run spend cap after recording the task that crossed it", async () => {
    const world = createSimWorld({ seed: 411, founders: 2, days: 2 });
    const baseSources = createSimSources(world);
    const simSources: SourceRegistry = {
      get(id) {
        const adapter = baseSources.get(id);
        if (!adapter || id !== "github") return adapter;
        return {
          ...adapter,
          async fetch(request) {
            return {
              items: [item(world.founders()[0]!, "github", request.simDay ?? 0, "budget-cap")],
              cursor: request.simDay,
            };
          },
        };
      },
      statuses: () => baseSources.statuses(),
    };
    const startedHarness = makeHarness({
      simWorld: world,
      simSources,
      agentJobs: [
        makeAgent("scout.github", { id: "agt_scout_one" }),
        makeAgent("scout.github", { id: "agt_scout_two" }),
      ],
    });
    const started = await startedHarness.controller.start({
      swarmId: SWARM_ID,
      trigger: "manual",
      brain: "sim",
      sources: "sim",
      budgetUsd: 0.0000001,
    });
    const run = await startedHarness.controller.wait(started.id);
    const tasks = startedHarness.store.listTasks({ runId: run.id });
    const modelTasks = tasks.filter((task) => task.jobId === "scout.github");

    expect(run.status).toBe("budget_stopped");
    expect(run.costUsd).toBeGreaterThan(run.budgetUsd);
    expect(modelTasks).toHaveLength(2);
    expect(modelTasks[0]?.status).toBe("succeeded");
    expect(modelTasks.slice(1).every((task) => task.status === "skipped" && task.skipReason === "spend cap reached")).toBe(true);
    expect(modelTasks.filter((task) => task.status !== "skipped")).toHaveLength(1);
    expect(run.stats.skippedBudget).toBe(modelTasks.slice(1).length);
  });

  it("retries a billed retryable error, succeeds through the simulated executor, and sums both attempts", async () => {
    const failedUsage: Usage = { inputTokens: 8, outputTokens: 3, cachedInputTokens: 1, cacheWriteTokens: 2, webSearches: 0 };
    let attempts = 0;
    let successfulUsage: Usage | null = null;
    let successfulCost: number | null = null;
    const world = createSimWorld({ seed: 17, founders: 2, days: 2 });
    const harness = makeHarness({
      simWorld: world,
      agentJobs: ["screen.fit"],
      wrapExecuteJob: (delegate) => async <J extends ModelJobId>(
        jobId: J,
        input: JobInput<J>,
        context: JobContext,
        options: Parameters<ExecuteJob>[3],
      ) => {
        attempts += 1;
        if (attempts === 1) {
          throw new ProviderError("transport", "Temporary provider outage.", { retryable: true, usage: failedUsage, costUsd: 0.25 });
        }
        const result = await delegate(jobId, input, context, options);
        successfulUsage = result.usage;
        successfulCost = result.costUsd;
        return result;
      },
    });
    const founder = makeFounder(world.founders()[0]!, "fnd_live_screen", { status: "lead" });
    harness.store.insertFounder(founder);

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live" });
    const run = await harness.controller.wait(started.id);
    const task = harness.store.listTasks({ runId: run.id }).find((candidate) => candidate.jobId === "screen.fit");

    expect(task).toBeDefined();
    expect(task!.status).toBe("succeeded");
    expect(task!.attempt).toBe(2);
    expect(attempts).toBe(2);
    expect(successfulUsage).not.toBeNull();
    expect(successfulCost).not.toBeNull();
    expect(task!.usage).toEqual({
      inputTokens: failedUsage.inputTokens + successfulUsage!.inputTokens,
      outputTokens: failedUsage.outputTokens + successfulUsage!.outputTokens,
      cachedInputTokens: failedUsage.cachedInputTokens + successfulUsage!.cachedInputTokens,
      cacheWriteTokens: failedUsage.cacheWriteTokens + successfulUsage!.cacheWriteTokens,
      webSearches: failedUsage.webSearches + successfulUsage!.webSearches,
    });
    expect(task!.costUsd).toBe(0.25 + successfulCost!);
    expect(run.costUsd).toBe(0.25 + successfulCost!);
    expect(run.stats.failures).toBe(0);
    expect(harness.providerCallCount()).toBe(0);
  });

  it("fails the run durably when a source registry throws during a stage", async () => {
    const world = createSimWorld({ seed: 27, founders: 2, days: 2 });
    const sourceFailure = new Error("source registry unavailable");
    const simSources: SourceRegistry = {
      get: () => { throw sourceFailure; },
      statuses: async () => [],
    };
    const harness = makeHarness({ simWorld: world, simSources, agentJobs: ["scout.github"] });
    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim" });
    const run = await harness.controller.wait(started.id);

    expect(run.status).toBe("failed");
    expect(run.error).toBe("source registry unavailable");
    expect(run.finishedAt).toBe(NOW.toISOString());
  });

  it("recovers orphaned runs and leaves already terminal work alone", async () => {
    const harness = makeHarness();
    harness.store.insertRun(makeRun("run_orphan_running", "running"));
    harness.store.insertRun(makeRun("run_orphan_queued", "queued"));
    harness.store.insertRun(makeRun("run_done", "succeeded"));
    harness.store.insertTask({ ...makeTask("tsk_orphan_running", "run_orphan_running", "running"), costUsd: 0.25 });
    harness.store.insertTask(makeTask("tsk_orphan_queued", "run_orphan_queued", "queued"));
    harness.store.insertTask(makeTask("tsk_done", "run_done", "succeeded"));

    expect(await harness.controller.recover()).toBe(2);
    expect(await harness.controller.recover()).toBe(0);
    expect(harness.store.getRun("run_orphan_running")).toMatchObject({
      status: "failed",
      error: "The server stopped while this run was in progress.",
      finishedAt: NOW.toISOString(),
      costUsd: 0.25,
    });
    expect(harness.store.getRun("run_orphan_queued")?.status).toBe("failed");
    expect(harness.store.getRun("run_done")?.status).toBe("succeeded");
    expect(harness.store.getTask("tsk_orphan_running", { withTrace: false })?.status).toBe("failed");
    expect(harness.store.getTask("tsk_orphan_queued", { withTrace: false })?.status).toBe("failed");
    expect(harness.store.getTask("tsk_done", { withTrace: false })?.status).toBe("succeeded");
  });

  it("drafts simulated outreach only for the latest yes call and never dispatches it", async () => {
    const world = createSimWorld({ seed: 719, founders: 4, days: 3 });
    let proposedEmailBody: string | null | undefined;
    const harness = makeHarness({
      simWorld: world,
      agentJobs: ["outreach.plan"],
      wrapExecuteJob: (delegate) => async <J extends ModelJobId>(
        jobId: J,
        input: JobInput<J>,
        context: JobContext,
        options: Parameters<ExecuteJob>[3],
      ) => {
        const result = await delegate(jobId, input, context, options);
        if (jobId === "outreach.plan") {
          const proposals = (result.output as unknown as { actions: Array<{ kind: string; body: string | null }> }).actions;
          proposedEmailBody = proposals.find((proposal) => proposal.kind === "email_founder")?.body;
        }
        return result;
      },
    });
    const [yesSim, noSim, waitingSim, changedMindSim] = world.founders();
    const yes = makeFounder(yesSim!, "fnd_called_yes", { status: "passed" });
    const no = makeFounder(noSim!, "fnd_called_no", { status: "passed" });
    const waiting = makeFounder(waitingSim!, "fnd_not_called", { status: "surfaced" });
    const changedMind = makeFounder(changedMindSim!, "fnd_changed_mind", { status: "passed" });
    for (const founder of [yes, no, waiting, changedMind]) {
      harness.store.insertFounder(founder);
      harness.store.insertAssessment(makeAssessment(founder.id, { decision: "watch", runId: "run_previous", memo: null }));
    }
    harness.store.insertFeedback(makeFeedback("fbk_yes", yes.id, "yes", "2026-11-10T10:00:00.000Z", { reasonTags: ["builder"], note: "Clear technical ownership." }));
    harness.store.insertFeedback(makeFeedback("fbk_no", no.id, "no", "2026-11-10T10:00:00.000Z", { reasonTags: ["outside_thesis"] }));
    harness.store.insertFeedback(makeFeedback("fbk_old_yes", changedMind.id, "yes", "2026-11-09T10:00:00.000Z", { reasonTags: ["insight"] }));
    harness.store.insertFeedback(makeFeedback("fbk_latest_no", changedMind.id, "no", "2026-11-11T10:00:00.000Z", { reasonTags: ["too_late"] }));

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live" });
    const run = await harness.controller.wait(started.id);
    const actions = harness.store.listOutreach({ swarmId: SWARM_ID });

    expect(run.status).toBe("succeeded");
    expect(actions.length).toBeGreaterThan(0);
    expect(new Set(actions.map((action) => action.founderId))).toEqual(new Set([yes.id]));
    expect(actions.every((action) => action.status === "proposed")).toBe(true);
    expect(actions.every((action) => action.decidedAt === null && action.transcriptEvidenceId === null)).toBe(true);
    const email = actions.find((action) => action.kind === "email_founder");
    expect(email).toBeDefined();
    expect(email?.draft.disclosure).toBe("This message was drafted with the help of an AI assistant working for Northstar Ventures and was reviewed by a partner before it was sent.");
    expect(email!.draft.body).toBe(proposedEmailBody);
    expect(email!.draft.body).not.toContain(email!.draft.disclosure);
    expect(harness.store.getFounder(no.id)?.status).toBe("passed");
    expect(harness.store.getFounder(changedMind.id)?.status).toBe("passed");
    expect(harness.providerCallCount()).toBe(0);
  });

  it("continues the pipeline after every screen job attempt throws a non-retryable provider error", async () => {
    const world = createSimWorld({ seed: 72, founders: 3, days: 3 });
    const harness = makeHarness({
      simWorld: world,
      agentJobs: ["screen.fit"],
      providerError: () => { throw new ProviderError("not_configured", "The test provider is unavailable."); },
    });
    for (const [index, sim] of world.founders().slice(0, 2).entries()) {
      harness.store.insertFounder(makeFounder(sim, `fnd_always_throw_${index}`, { status: "lead" }));
    }

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "live", sources: "live" });
    const run = await harness.controller.wait(started.id);
    const screenTasks = harness.store.listTasks({ runId: run.id }).filter((task) => task.jobId === "screen.fit");

    expect(run.status).toBe("succeeded");
    expect(screenTasks).toHaveLength(2);
    expect(screenTasks.every((task) => task.status === "failed" && task.attempt === 1)).toBe(true);
    expect(harness.providerCallCount()).toBe(2);
    expect(run.stats.failures).toBe(2);
  });

  it("does not dispatch a live approved call action", async () => {
    const world = createSimWorld({ seed: 706, founders: 2, days: 2 });
    const harness = makeHarness({ simWorld: world, agentJobs: ["outreach.plan"] });
    const founder = makeFounder(world.founders()[0]!, "fnd_approved_live", { status: "surfaced" });
    harness.store.insertFounder(founder);
    harness.store.insertAssessment(makeAssessment(founder.id, { runId: "run_previous" }));
    harness.store.insertFeedback(makeFeedback("fbk_approved_live", founder.id, "yes", "2026-11-11T10:00:00.000Z", { reasonTags: ["builder"] }));
    harness.store.insertOutreach(makeOutreachAction("out_approved_live", founder.id, "approved"));

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "live", sources: "live" });
    const run = await harness.controller.wait(started.id);

    expect(run.status).toBe("succeeded");
    expect(harness.store.getOutreach("out_approved_live")?.status).toBe("approved");
    expect(harness.store.listOutreach({ swarmId: SWARM_ID, statuses: ["dispatched"] })).toEqual([]);
    expect(harness.store.listTasks({ runId: run.id }).filter((task) => task.jobId === "outreach.plan")).toEqual([]);
    expect(harness.providerCallCount()).toBe(0);
  });

  it("completes an approved simulated call first, then debriefs, verifies, and reassesses it on the next run", async () => {
    const world = createSimWorld({ seed: 802, founders: 2, days: 3 });
    const harness = makeHarness({
      simWorld: world,
      agentJobs: ["call.debrief", "verify.claims", "assess.judgments"],
      config: {
        routes: {
          "call.debrief": { provider: "openai-api", model: "gpt-6-astra", effort: "medium" },
          "verify.claims": { provider: "openai-api", model: "gpt-6-astra", effort: "medium" },
          "assess.judgments": { provider: "openai-api", model: "gpt-6-astra", effort: "medium" },
        },
      },
    });
    const founder = makeFounder(world.founders()[0]!, "fnd_simulated_approved_call", { status: "meeting" });
    harness.store.insertFounder(founder);
    harness.store.insertAssessment(makeAssessment(founder.id, { decision: "surface", runId: "run_previous" }));
    harness.store.insertOutreach(makeOutreachAction("out_simulated_approved_call", founder.id, "approved"));

    const firstStarted = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim" });
    const firstRun = await harness.controller.wait(firstStarted.id);
    const completedAction = harness.store.getOutreach("out_simulated_approved_call");
    const transcript = harness.store.listEvidence(founder.id).find((evidence) => evidence.id === completedAction?.transcriptEvidenceId);

    expect(firstRun.status).toBe("succeeded");
    expect(completedAction?.status).toBe("completed");
    expect(transcript).toMatchObject({ source: "call", verification: "unverified" });
    expect(harness.store.listTasks({ runId: firstRun.id }).some((task) => task.jobId === "call.debrief")).toBe(false);
    expect(harness.providerCallCount()).toBe(0);

    const secondStarted = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim" });
    const secondRun = await harness.controller.wait(secondStarted.id);
    const secondTasks = harness.store.listTasks({ runId: secondRun.id });
    const supportedCallEvidence = harness.store.listEvidence(founder.id).filter((evidence) =>
      evidence.source === "call" && evidence.verification === "supported" && evidence.id !== transcript?.id,
    );

    expect(secondRun.status).toBe("succeeded");
    expect(secondRun.stats.evidence).toBeGreaterThan(0);
    expect(secondRun.stats.assessed).toBe(1);
    expect(harness.store.getOutreach("out_simulated_approved_call")?.status).toBe("completed");
    expect(transcript && harness.store.listEvidence(founder.id).find((evidence) => evidence.id === transcript.id)?.verification).toBe("supported");
    expect(supportedCallEvidence.length).toBeGreaterThan(0);
    expect(supportedCallEvidence.every((evidence) => secondTasks.some((task) =>
      task.id === evidence.collectedByTaskId && task.stage === "debrief" && task.founderId === founder.id,
    ))).toBe(true);
    expect(harness.store.latestAssessment(founder.id)?.runId).toBe(secondRun.id);
    expect(harness.store.getFounder(founder.id)?.status).toBe("meeting");
    expect(harness.providerCallCount()).toBe(0);
  });

  it("debriefs completed simulated calls, reassesses from supported evidence, and preserves no and meeting decisions", async () => {
    const world = createSimWorld({ seed: 817, founders: 3, days: 3 });
    const harness = makeHarness({
      simWorld: world,
      agentJobs: ["call.debrief", "verify.claims", "assess.judgments"],
      config: {
        routes: {
          "verify.claims": { provider: "openai-api", model: "gpt-6-astra", effort: "medium" },
          "assess.judgments": { provider: "openai-api", model: "gpt-6-astra", effort: "medium" },
        },
      },
    });
    const [passedSim, meetingSim] = world.founders();
    const passed = makeFounder(passedSim!, "fnd_called_no_reassessed", { status: "passed" });
    const meeting = makeFounder(meetingSim!, "fnd_meeting_reassessed", { status: "meeting" });
    harness.store.insertFounder(passed);
    harness.store.insertFounder(meeting);
    harness.store.insertFeedback(makeFeedback("fbk_old_yes", passed.id, "yes", "2026-11-09T10:00:00.000Z", { reasonTags: ["builder"] }));
    harness.store.insertFeedback(makeFeedback("fbk_latest_no", passed.id, "no", "2026-11-11T10:00:00.000Z", { reasonTags: ["outside_thesis"] }));
    const noTranscript = makeTranscriptEvidence("evd_completed_no", passed.id, "Founder: I built and shipped the first version with a small team.");
    const meetingTranscript = makeTranscriptEvidence("evd_completed_meeting", meeting.id, "Founder: The team is meeting with the investment partners.");
    harness.store.insertEvidence(noTranscript);
    harness.store.insertEvidence(meetingTranscript);
    harness.store.insertOutreach({
      ...makeOutreachAction("out_completed_no", passed.id, "completed", noTranscript.excerpt),
      transcriptEvidenceId: noTranscript.id,
    });
    harness.store.insertOutreach({
      ...makeOutreachAction("out_completed_meeting", meeting.id, "completed", meetingTranscript.excerpt),
      transcriptEvidenceId: meetingTranscript.id,
    });

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live" });
    const run = await harness.controller.wait(started.id);
    const noAssessment = harness.store.latestAssessment(passed.id);
    const meetingAssessment = harness.store.latestAssessment(meeting.id);
    const noEvidence = harness.store.listEvidence(passed.id);
    const meetingEvidence = harness.store.listEvidence(meeting.id);
    const debriefTasks = harness.store.listTasks({ runId: run.id }).filter((task) => task.jobId === "call.debrief");

    expect(run.status).toBe("succeeded");
    expect(run.stats.assessed).toBe(2);
    expect(noAssessment?.runId).toBe(run.id);
    expect(meetingAssessment?.runId).toBe(run.id);
    expect(harness.store.getFounder(passed.id)?.status).toBe("passed");
    expect(harness.store.getFounder(meeting.id)?.status).toBe("meeting");
    expect(debriefTasks).toHaveLength(2);
    expect(noEvidence.some((evidence) => evidence.source === "call" && evidence.verification === "supported")).toBe(true);
    expect(meetingEvidence.some((evidence) => evidence.source === "call" && evidence.verification === "supported")).toBe(true);
    expect(noEvidence.find((evidence) => evidence.id === noTranscript.id)).toMatchObject({ verification: "supported", verificationNote: "Debriefed" });
    expect(meetingEvidence.find((evidence) => evidence.id === meetingTranscript.id)).toMatchObject({ verification: "supported", verificationNote: "Debriefed" });
    expect(noEvidence.filter((evidence) => evidence.id !== noTranscript.id).every((evidence) => debriefTasks.some((task) => task.id === evidence.collectedByTaskId && task.founderId === passed.id))).toBe(true);
    expect(meetingEvidence.filter((evidence) => evidence.id !== meetingTranscript.id).every((evidence) => debriefTasks.some((task) => task.id === evidence.collectedByTaskId && task.founderId === meeting.id))).toBe(true);
    expect(harness.store.listOutreach({ swarmId: SWARM_ID }).every((action) => action.status === "completed")).toBe(true);
    expect(harness.providerCallCount()).toBe(0);
  });

  it("does not overwrite a No recorded while the analyst task is in flight", async () => {
    const world = createSimWorld({ seed: 824, founders: 2, days: 2 });
    let insertedNo = false;
    let insertNo = (_founderId: string) => {};
    const harness = makeHarness({
      simWorld: world,
      // The fact-checker is part of the run: the analyst only sees evidence it supported.
      agentJobs: ["investigate.background", "verify.claims", "assess.judgments"],
      config: { params: { "assess.surface_threshold": 0, "assess.min_coverage": 0, "assess.watch_threshold": 0 } },
      wrapExecuteJob: (delegate) => async <J extends ModelJobId>(
        jobId: J,
        input: JobInput<J>,
        context: JobContext,
        options: Parameters<ExecuteJob>[3],
      ) => {
        const result = await delegate(jobId, input, context, options);
        if (jobId === "assess.judgments" && !insertedNo) {
          insertedNo = true;
          const id = (input as { founder: { id: string } }).founder.id;
          insertNo(id);
        }
        return result;
      },
    });
    const founder = makeFounder(world.founders()[0]!, "fnd_no_during_assess", { status: "queued" });
    harness.store.insertFounder(founder);
    insertNo = (id) => {
      harness.store.insertFeedback(makeFeedback("fbk_no_during_assess", id, "no", "2026-11-12T18:00:01.000Z", { reasonTags: ["outside_thesis"] }));
      harness.store.updateFounder(id, { status: "passed", nextRecheckAt: null });
    };

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live" });
    const run = await harness.controller.wait(started.id);

    expect(run.status).toBe("succeeded");
    expect(harness.store.latestAssessment(founder.id)?.runId).toBe(run.id);
    expect(harness.store.getFounder(founder.id)).toMatchObject({ status: "passed", nextRecheckAt: null });
    expect(harness.store.allFeedback(SWARM_ID).find((call) => call.founderId === founder.id)?.verdict).toBe("no");
  });

  it("schedules a one-time deep follow-up for a founder's first needs-evidence assessment", async () => {
    const world = createSimWorld({ seed: 825, founders: 4, days: 3 });
    const investigatorDepths: Array<{ founderId: string; depth: string }> = [];
    const harness = makeHarness({
      simWorld: world,
      agentJobs: ["investigate.background", "investigate.company", "assess.judgments"],
      config: {
        params: {
          "investigate.max_founders": 1,
          "investigate.depth": "quick",
          "recheck.days": 3,
          "assess.surface_threshold": 0.6,
          "assess.min_coverage": 0.5,
          "assess.watch_threshold": 0.2,
        },
      },
      wrapExecuteJob: (delegate) => async <J extends ModelJobId>(
        jobId: J,
        input: JobInput<J>,
        context: JobContext,
        options: Parameters<ExecuteJob>[3],
      ) => {
        const result = await delegate(jobId, input, context, options);
        if (jobId.startsWith("investigate.")) {
          const investigation = input as { founder: { id: string }; depth: string };
          investigatorDepths.push({ founderId: investigation.founder.id, depth: investigation.depth });
        }
        if (jobId === "assess.judgments") {
          const evidenceIds = (input as { evidence: Array<{ id: string }> }).evidence.map((item) => item.id);
          const output = {
            judgments: [{
              dimension: "built_hard_things" as const,
              level: 4,
              confidence: 1,
              rationale: "A sourced, technically demanding system shows strong building ability.",
              evidenceIds: evidenceIds.slice(0, 1),
              counterEvidenceIds: [],
            }],
            summary: "One rubric dimension is strong while most remain unanswered.",
          };
          return { ...result, output: output as unknown as JobOutput<J> };
        }
        return result;
      },
    });
    const firstFounder = makeFounder(world.founders()[0]!, "fnd_01_followup_a", { status: "queued" });
    harness.store.insertFounder(firstFounder);
    harness.store.insertEvidence(makeSupportedEvidence("evd_followup_seed", firstFounder.id));

    const firstStarted = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live" });
    const firstRun = await harness.controller.wait(firstStarted.id);

    expect(firstRun.status).toBe("succeeded");
    expect(harness.store.latestAssessment(firstFounder.id)?.decision).toBe("needs_evidence");
    expect(harness.store.assessmentHistory(firstFounder.id)).toHaveLength(1);
    expect(harness.store.getFounder(firstFounder.id)?.nextRecheckAt).toBe(NOW.toISOString());
    expect(investigatorDepths.filter((item) => item.founderId === firstFounder.id).map((item) => item.depth)).toEqual(["quick", "quick"]);

    const limitedFounder = makeFounder(world.founders()[1]!, "fnd_02_followup_b", {
      status: "needs_evidence",
      nextRecheckAt: NOW.toISOString(),
    });
    const noFounder = makeFounder(world.founders()[2]!, "fnd_00_followup_no", {
      status: "needs_evidence",
      nextRecheckAt: NOW.toISOString(),
    });
    harness.store.insertFounder(noFounder);
    harness.store.insertAssessment(makeAssessment(noFounder.id, { decision: "needs_evidence", runId: "run_previous" }));
    harness.store.insertFeedback(makeFeedback("fbk_followup_no", noFounder.id, "no", "2026-11-12T18:00:01.000Z", { reasonTags: ["outside_thesis"] }));
    harness.store.insertFounder(limitedFounder);
    harness.store.insertAssessment(makeAssessment(limitedFounder.id, { decision: "needs_evidence", runId: "run_previous" }));

    const secondStarted = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live" });
    const secondRun = await harness.controller.wait(secondStarted.id);
    const secondTasks = harness.store.listTasks({ runId: secondRun.id });
    const secondInvestigations = secondTasks.filter((task) => task.stage === "investigate");
    const afterSecond = harness.store.getFounder(firstFounder.id);
    const threeDaysLater = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

    expect(secondRun.status).toBe("succeeded");
    expect(investigatorDepths.filter((item) => item.founderId === firstFounder.id).map((item) => item.depth)).toEqual(["quick", "quick", "deep", "deep"]);
    expect(secondInvestigations.filter((task) => task.founderId === firstFounder.id)).toHaveLength(2);
    expect(secondInvestigations.some((task) => task.founderId === limitedFounder.id)).toBe(false);
    expect(secondInvestigations.some((task) => task.founderId === noFounder.id)).toBe(false);
    expect(secondRun.stats.investigated).toBe(1);
    expect(harness.store.assessmentHistory(firstFounder.id)).toHaveLength(2);
    expect(harness.store.latestAssessment(firstFounder.id)?.decision).toBe("needs_evidence");
    expect(afterSecond?.nextRecheckAt).toBe(threeDaysLater);
    expect(harness.store.assessmentHistory(limitedFounder.id)).toHaveLength(1);
    expect(harness.store.latestAssessment(noFounder.id)?.runId).toBe(secondRun.id);
    expect(harness.store.getFounder(noFounder.id)?.status).toBe("needs_evidence");
  });

  it("uses partner calls for scout guidance but keeps investigator prompts free of call examples", async () => {
    const world = createSimWorld({ seed: 91, founders: 3, days: 3 });
    const base = createSimSources(world);
    const simSources: SourceRegistry = {
      get(id) {
        const adapter = base.get(id);
        if (!adapter) return null;
        return {
          ...adapter,
          async fetch(request) {
            if (id === "github") {
              const sourceFounder = world.founders()[0]!;
              return { items: [item(sourceFounder, "github", request.simDay ?? 0, "call-guidance")], cursor: request.simDay };
            }
            return { items: [], cursor: request.simDay };
          },
        };
      },
      statuses: () => base.statuses(),
    };
    const harness = makeHarness({
      simWorld: world,
      simSources,
      agentJobs: ["scout.github", "investigate.background"],
    });
    const simFounder = world.founders()[0]!;
    const founder = makeFounder(simFounder, "fnd_feedback_context", { status: "queued" });
    harness.store.insertFounder(founder);
    harness.store.insertFeedback(makeFeedback("fbk_old_context", founder.id, "no", "2026-11-10T10:00:00.000Z", { reasonTags: ["outside_thesis"] }));
    harness.store.insertFeedback(makeFeedback("fbk_latest_context", founder.id, "yes", "2026-11-11T10:00:00.000Z", { reasonTags: ["builder", "speed"], note: "Strong personal contribution." }));

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim" });
    const run = await harness.controller.wait(started.id);
    const tasks = harness.store.listTasks({ runId: run.id });
    const scout = tasks.find((task) => task.jobId === "scout.github" && task.status === "succeeded");
    const investigator = tasks.find((task) => task.jobId === "investigate.background" && task.status === "succeeded");
    const calls = renderCallsBlock([{
      verdict: "yes",
      about: `${founder.company.name}: ${founder.company.oneLiner}`,
      reasonTags: ["builder", "speed"],
      note: "Strong personal contribution.",
      at: "2026-11-11T10:00:00.000Z",
    }]);

    expect(scout).toBeDefined();
    expect(investigator).toBeDefined();
    expect(scout!.steering.block).toContain(calls);
    expect(scout!.steering.block).not.toContain("NO: ");
    expect(investigator!.steering.block).not.toContain("Recent calls by the partners");
    expect(harness.providerCallCount()).toBe(0);
  });

  it("does not score a founder whose evidence was never fact-checked", async () => {
    const world = createSimWorld({ seed: 826, founders: 2, days: 2 });
    // No fact-checker in this swarm, so everything the investigator finds stays unverified.
    const harness = makeHarness({ simWorld: world, agentJobs: ["investigate.background", "assess.judgments"] });
    const founder = makeFounder(world.founders()[0]!, "fnd_unchecked", { status: "queued" });
    harness.store.insertFounder(founder);

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live" });
    const run = await harness.controller.wait(started.id);

    expect(run.status).toBe("succeeded");
    expect(harness.store.listEvidence(founder.id).length).toBeGreaterThan(0);
    expect(harness.store.listEvidence(founder.id).every((item) => item.verification === "unverified")).toBe(true);
    // Not assessed on nothing, and not passed: the founder waits for a run where the check happens.
    expect(harness.store.latestAssessment(founder.id)).toBeNull();
    expect(harness.store.getFounder(founder.id)?.status).toBe("queued");
  });

  it("treats an answer that cites no verified evidence as unsettled, so it cannot surface a founder", async () => {
    const world = createSimWorld({ seed: 827, founders: 2, days: 2 });
    const harness = makeHarness({
      simWorld: world,
      agentJobs: ["assess.judgments"],
      wrapExecuteJob: (delegate) => async <J extends ModelJobId>(
        jobId: J,
        input: JobInput<J>,
        context: JobContext,
        options: Parameters<ExecuteJob>[3],
      ) => {
        const result = await delegate(jobId, input, context, options);
        if (jobId !== "assess.judgments") return result;
        // A model that answers top marks on everything and cites ids that do not exist.
        const judgments = (result.output as { judgments: Array<{ dimension: string }> }).judgments.map((judgment) => ({
          ...judgment,
          level: 4,
          confidence: 1,
          rationale: "Clearly exceptional.",
          evidenceIds: ["evd_does_not_exist"],
          counterEvidenceIds: [],
        }));
        return { ...result, output: { judgments, summary: "Exceptional on every count." } as unknown as JobOutput<J> };
      },
    });
    const founder = makeFounder(world.founders()[0]!, "fnd_uncited", { status: "watch", nextRecheckAt: NOW.toISOString() });
    harness.store.insertFounder(founder);
    harness.store.insertEvidence(makeSupportedEvidence("evd_uncited_seed", founder.id));
    harness.store.insertFeedback(makeFeedback("fbk_uncited", founder.id, "no", "2026-11-12T18:00:01.000Z", { reasonTags: ["thin_evidence"] }));

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live" });
    const run = await harness.controller.wait(started.id);
    const assessment = harness.store.latestAssessment(founder.id);

    expect(run.status).toBe("succeeded");
    expect(assessment?.runId).toBe(run.id);
    expect(assessment?.judgments.every((judgment) => judgment.level === null && judgment.confidence === 0)).toBe(true);
    expect(assessment?.judgments[0]?.rationale).toContain("no verified evidence was cited");
    expect(assessment?.coverage).toBe(0);
    expect(assessment?.decision).toBe("pass");
  });

  it("leaves a real founder's approved outreach alone in a simulated run", async () => {
    const world = createSimWorld({ seed: 828, founders: 2, days: 2 });
    const harness = makeHarness({ simWorld: world, agentJobs: ["call.debrief"] });
    // Found by an earlier live run: no simulator id.
    const real = makeFounder(world.founders()[0]!, "fnd_real_person", { status: "surfaced", simId: null });
    harness.store.insertFounder(real);
    const email: OutreachAction = { ...makeOutreachAction("out_real_email", real.id, "approved"), kind: "email_founder" };
    const call = makeOutreachAction("out_real_call", real.id, "approved");
    harness.store.insertOutreach(email);
    harness.store.insertOutreach(call);

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "sim" });
    const run = await harness.controller.wait(started.id);

    expect(run.status).toBe("succeeded");
    expect(harness.store.getOutreach(email.id)).toMatchObject({ status: "approved", resultSummary: null });
    expect(harness.store.getOutreach(call.id)).toMatchObject({ status: "approved", transcriptEvidenceId: null });
    expect(harness.store.getFounder(real.id)?.status).toBe("surfaced");
    expect(harness.store.listEvidence(real.id)).toEqual([]);
  });

  it("investigates an owed deep follow-up before new founders when slots are short", async () => {
    const world = createSimWorld({ seed: 829, founders: 4, days: 2 });
    const harness = makeHarness({
      simWorld: world,
      agentJobs: ["investigate.background", "verify.claims", "assess.judgments"],
      config: { params: { "investigate.max_founders": 1 } },
    });
    const owed = makeFounder(world.founders()[0]!, "fnd_owed_follow_up", { status: "needs_evidence", nextRecheckAt: NOW.toISOString(), fit: 0.6 });
    harness.store.insertFounder(owed);
    harness.store.insertAssessment(makeAssessment(owed.id, { decision: "needs_evidence", runId: "run_previous" }));
    // Two new founders with a better thesis fit, who would otherwise take the only slot.
    for (const [index, id] of ["fnd_new_a", "fnd_new_b"].entries()) {
      harness.store.insertFounder(makeFounder(world.founders()[index + 1]!, id, { status: "queued", fit: 0.95 }));
    }

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live" });
    const run = await harness.controller.wait(started.id);
    const investigated = new Set(
      harness.store.listTasks({ runId: run.id }).filter((task) => task.stage === "investigate").map((task) => task.founderId),
    );

    expect(run.status).toBe("succeeded");
    expect([...investigated]).toEqual([owed.id]);
    expect(harness.store.getFounder("fnd_new_a")?.status).toBe("queued");
  });

  it("treats the task and run spend caps as ceilings across retries", async () => {
    const world = createSimWorld({ seed: 830, founders: 2, days: 2 });
    const allowances: number[] = [];
    const harness = makeHarness({
      simWorld: world,
      agentJobs: ["assess.judgments"],
      config: { params: { "budget.task_usd": 1 } },
      wrapExecuteJob: () => async (_jobId, _input, _context, options) => {
        allowances.push(options.maxBudgetUsd ?? Number.NaN);
        // Every attempt is billed 60 cents and then fails in a way that would normally be retried.
        throw new ProviderError("transport", "The connection dropped.", { retryable: true, costUsd: 0.6 });
      },
    });
    const founder = makeFounder(world.founders()[0]!, "fnd_budget", { status: "watch", nextRecheckAt: NOW.toISOString() });
    harness.store.insertFounder(founder);
    harness.store.insertEvidence(makeSupportedEvidence("evd_budget_seed", founder.id));
    harness.store.insertFeedback(makeFeedback("fbk_budget", founder.id, "no", "2026-11-12T18:00:01.000Z", { reasonTags: ["thin_evidence"] }));

    const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live", budgetUsd: 5 });
    const run = await harness.controller.wait(started.id);
    const [task] = harness.store.listTasks({ runId: run.id }).filter((item) => item.jobId === "assess.judgments");

    // First attempt may spend the whole dollar, the second only the 40 cents left, and there is no third.
    expect(allowances).toHaveLength(2);
    expect(allowances[0]).toBeCloseTo(1, 6);
    expect(allowances[1]).toBeCloseTo(0.4, 6);
    expect(task).toMatchObject({ status: "failed", attempt: 2 });
    expect(task?.costUsd).toBeCloseTo(1.2, 6);
    expect(task?.error).toContain("spend cap");
  });

  it("gives a single slot to whichever has waited longer, a due re-check or a new founder", async () => {
    const world = createSimWorld({ seed: 831, founders: 4, days: 2 });
    const investigatedIn = async (dueSince: string, queuedSince: string) => {
      const harness = makeHarness({
        simWorld: world,
        agentJobs: ["investigate.background", "verify.claims", "assess.judgments"],
        config: { params: { "investigate.max_founders": 1 } },
      });
      // A watch-list founder with two earlier assessments: an ordinary re-check, not the one deep follow-up.
      const watched = makeFounder(world.founders()[0]!, "fnd_watch_due", { status: "watch", nextRecheckAt: dueSince, fit: 0.6 });
      harness.store.insertFounder(watched);
      harness.store.insertAssessment(makeAssessment(watched.id, { id: "asm_watch_1", decision: "watch", runId: "run_a", createdAt: "2026-10-01T00:00:00.000Z" }));
      harness.store.insertAssessment(makeAssessment(watched.id, { id: "asm_watch_2", decision: "watch", runId: "run_b", createdAt: "2026-10-20T00:00:00.000Z" }));
      harness.store.insertFounder(makeFounder(world.founders()[1]!, "fnd_queued_new", { status: "queued", fit: 0.95, firstSeenAt: queuedSince }));
      const started = await harness.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources: "live" });
      const run = await harness.controller.wait(started.id);
      return [...new Set(harness.store.listTasks({ runId: run.id }).filter((task) => task.stage === "investigate").map((task) => task.founderId))];
    };

    // The re-check has been due for two days; the new founder appeared today.
    expect(await investigatedIn("2026-11-10T18:00:00.000Z", NOW.toISOString())).toEqual(["fnd_watch_due"]);
    // The new founder has been waiting for a week; the re-check only came due now.
    expect(await investigatedIn(NOW.toISOString(), "2026-11-05T18:00:00.000Z")).toEqual(["fnd_queued_new"]);
  });
});
