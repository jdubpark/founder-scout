import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  collectLaunchPosts,
  createApp,
  fetchUnicornNames,
  fetchYcDirectory,
  firstLaunchEach,
  importDealsCsv,
  labelPastCases,
  parseLabelsCsv,
  readPastCases,
  redactSensitive,
  runDoctor,
  summarisePastCases,
  writePastCases,
  type AppOptions,
  type CollectLaunchesOptions,
  type DoctorRow,
  type OutcomeLabel,
  type SwarmService,
} from "@agentswarm/core";
import {
  type ApiClient,
  type DemoSnapshot,
  type EvalFlowDTO,
  type FounderRow,
  type PastCase,
  type Run,
  runnerPools,
} from "@agentswarm/shared";
import { resolveConfig } from "./config";
import { createCronHelper } from "./cron";
import { serveMcp } from "./mcp";

export type OutputWriter = (line: string) => void;
type DoctorRunner = (options: { live: boolean; env?: NodeJS.ProcessEnv }) => Promise<DoctorRow[]>;
type PastCollector = (options: CollectLaunchesOptions) => Promise<PastCase[]>;
type UnicornFetcher = typeof fetchUnicornNames;
type DirectoryFetcher = typeof fetchYcDirectory;

/** A company still operating counts as a success at this many people, unless --min-team says otherwise. */
const DEFAULT_MIN_TEAM = 100;

const CLI_HELP = [
  "Usage: swarm <run|doctor|eval|past|demo-snapshot|seed|mcp> [options]",
  "  swarm mcp [--url http://127.0.0.1:4317] [--swarm <id>]",
  "  swarm eval rounds [--flow <id>] [--rounds <n>] [--budget <usd>]",
  "  swarm past collect --from <date> --to <date> [--yc] [--min-team <n>] [--unicorns] [--labels <file.csv>] [--controls <n>]",
  "  swarm past import --file <deals.csv> [--bar <text>]",
  "  swarm past show",
].join("\n");

function positiveInteger(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be a positive whole number.`);
  return value;
}

function usd(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error("--budget must be a positive dollar amount.");
  return value;
}

function outputRun(run: Run, write: OutputWriter): void {
  const stats = run.stats;
  write(
    `${run.id} ${run.status} leads=${stats.leads} screened=${stats.screenedIn} investigated=${stats.investigated} surfaced=${stats.surfaced} cost=$${run.costUsd.toFixed(2)}`,
  );
}

async function selectedSwarm(api: ApiClient, requestedId?: string) {
  const swarms = await api.listSwarms();
  const swarm = requestedId ? swarms.find((candidate) => candidate.id === requestedId) : swarms[0];
  if (!swarm) throw new Error(requestedId ? `Swarm not found: ${requestedId}` : "No swarm is available.");
  return swarm;
}

export async function runCommand(
  service: SwarmService,
  options: { swarm?: string; brain?: "sim" | "live"; sources?: "sim" | "live"; days?: number; budget?: number },
  write: OutputWriter,
): Promise<void> {
  await service.ensureSeeded();
  const api = service.as("Partner");
  const swarm = await selectedSwarm(api, options.swarm);
  const days = options.days ?? 1;
  for (let day = 0; day < days; day += 1) {
    const huntBefore = await api.getHunt(swarm.id);
    const started = await api.startRun({
      swarmId: swarm.id,
      ...(options.brain ? { brain: options.brain } : {}),
      ...(options.sources ? { sources: options.sources } : {}),
      ...(options.budget ? { budgetUsd: options.budget } : {}),
    });
    const run = await service.runs.wait(started.id);
    outputRun(run, write);
    const detail = await api.getRun(run.id);
    if (detail.stages.some((stage) => stage.stage === "hunt" && stage.tasks > 0)) {
      const hunt = await api.getHunt(swarm.id);
      const pagesRead = hunt.totals.pages - huntBefore.totals.pages;
      const leadsFound = hunt.totals.leads - huntBefore.totals.leads;
      write(`hunt pages=${pagesRead} leads=${leadsFound} trails_open=${hunt.trails.filter((trail) => trail.status === "open").length}`);
    }
  }
}

export async function doctorCommand(
  service: SwarmService,
  options: { live: boolean },
  write: OutputWriter,
  doctor: DoctorRunner = runDoctor,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  if (options.live) write("Live provider probes make one tiny real call per configured provider and spend a little money.");
  const [providers, settings] = await Promise.all([doctor({ live: options.live, env }), service.as("Partner").getSettings()]);
  for (const row of providers) {
    const ready = row.configured ? "ready" : "not configured";
    const live = row.live ? `; live ${row.live.ok ? "ok" : "failed"}${row.live.costUsd === null ? "" : ` $${row.live.costUsd.toFixed(4)}`}` : "";
    write(`provider ${row.provider}: ${ready} — ${row.detail}${live}`);
  }
  for (const source of settings.sources) {
    write(`source ${source.id}: ${source.configured ? "ready" : "not configured"} — ${source.detail}`);
  }
}

function score(flow: EvalFlowDTO, values: Record<string, number> | undefined): string {
  const metric = values?.[flow.headlineMetric];
  return metric === undefined ? "—" : metric.toFixed(3);
}

export async function evalShowCommand(service: SwarmService, flowId: string | undefined, write: OutputWriter): Promise<void> {
  const api = service.as("Partner");
  const summaries = await api.listEvalFlows();
  const summary = flowId ? summaries.find((flow) => flow.id === flowId) : summaries[0];
  if (!summary) throw new Error(flowId ? `Eval flow not found: ${flowId}` : "No eval flows are available.");
  const flow = await api.getEvalFlow(summary.id);
  write(`round | change | test | train | status`);
  for (const variant of flow.variants) {
    const change = variant.changes.join(", ") || variant.description || "Baseline";
    write(`${variant.round} | ${change} | ${score(flow, variant.test)} | ${score(flow, variant.train)} | ${variant.status}`);
  }
}

export async function evalRoundsCommand(
  service: SwarmService,
  flowId: string | undefined,
  rounds: number,
  write: OutputWriter,
  budgetUsd?: number,
): Promise<void> {
  const api = service.as("Partner");
  const summaries = await api.listEvalFlows();
  const summary = flowId ? summaries.find((flow) => flow.id === flowId) : summaries[0];
  if (!summary) throw new Error(flowId ? `Eval flow not found: ${flowId}` : "No eval flows are available.");
  const before = await api.getEvalFlow(summary.id);
  if (before.ready === false) {
    write(`${before.id}: not ready. ${before.dataNote}`);
    return;
  }
  // A flow that reads real text cannot run in simulation, and one that calls models is given a ceiling.
  const flow = await api.runEvalRounds(summary.id, before.callsModels
    ? { rounds, brain: "live", budgetUsd: budgetUsd ?? 5 }
    : { rounds, brain: "sim" });
  const newest = flow.variants[flow.variants.length - 1];
  const spent = typeof flow.spentUsd === "number" && flow.spentUsd > 0 ? `; spent $${flow.spentUsd.toFixed(2)}` : "";
  write(`${flow.id}: ${rounds} round${rounds === 1 ? "" : "s"} complete${newest ? `; ${newest.status}, test=${score(flow, newest.test)}` : ""}${spent}`);
  if (flow.narrative) write(flow.narrative);
}

function stableShuffle<T>(values: readonly T[], seedText: string): T[] {
  let seed = 2166136261;
  for (const char of seedText) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const next = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [result[index], result[swap]] = [result[swap] as T, result[index] as T];
  }
  return result;
}

function applyControls(cases: readonly PastCase[], perSuccess: number): PastCase[] {
  const keep = new Set(cases.filter((pastCase) => pastCase.outcome === 1).map((pastCase) => pastCase.id));
  const cohorts = new Map<string, PastCase[]>();
  for (const pastCase of cases.filter((item) => item.outcome === 0)) {
    const controls = cohorts.get(pastCase.cohort) ?? [];
    controls.push(pastCase);
    cohorts.set(pastCase.cohort, controls);
  }
  const successes = cases.filter((pastCase) => pastCase.outcome === 1).sort((a, b) => a.id.localeCompare(b.id));
  for (const success of successes) {
    const candidates = (cohorts.get(success.cohort) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    for (const control of stableShuffle(candidates, success.id).slice(0, perSuccess)) keep.add(control.id);
  }
  return cases.filter((pastCase) => keep.has(pastCase.id));
}

function datasetsDirectory(env: NodeJS.ProcessEnv): string {
  return resolveConfig(env).datasetsDir;
}

/**
 * A file a person names on the command line. `pnpm swarm` starts this file inside apps/server,
 * so a relative path is read against the directory the person typed the command in, which pnpm
 * passes as INIT_CWD, and not against the directory this process happens to run in.
 */
function typedPath(path: string, env: NodeJS.ProcessEnv): string {
  return isAbsolute(path) ? path : resolve(env.INIT_CWD?.trim() || process.cwd(), path);
}

export async function pastShowCommand(datasetsDir: string, write: OutputWriter): Promise<void> {
  const cases = await readPastCases(datasetsDir);
  const summary = summarisePastCases(cases);
  write(`Dataset: ${resolve(datasetsDir, "past-founders", "cases.jsonl")}`);
  write(`Cases: ${summary.cases}; successes: ${summary.positives}; periods: ${summary.cohorts.length}`);
  for (const cohort of summary.cohorts) write(`${cohort.cohort}: ${cohort.cases} cases; ${cohort.positives} successes`);
}

export async function pastCollectCommand(
  options: { from: string; to: string; labels?: string; unicorns: boolean; yc?: boolean; minTeam?: number; controls?: number },
  datasetsDir: string,
  write: OutputWriter,
  dependencies: { collectLaunchPosts?: PastCollector; fetchUnicornNames?: UnicornFetcher; fetchYcDirectory?: DirectoryFetcher } = {},
): Promise<void> {
  // A case is only worth keeping with an outcome, and an outcome nobody can state is left out
  // instead of being called a failure. So something must be able to state outcomes.
  if (!options.labels && !options.unicorns && !options.yc) {
    throw new Error("past collect needs a source of outcomes: --yc, --labels <file.csv>, or --unicorns together with one of those.");
  }
  const collect = dependencies.collectLaunchPosts ?? collectLaunchPosts;
  // The dataset is stored, so it passes the same boundary as everything else stored: a sentence
  // in which a founder states their age, nationality or the like is removed before it is written.
  const fetched = (await collect({ from: options.from, to: options.to })).map((pastCase) => ({
    ...pastCase,
    evidence: pastCase.evidence.map((item) => ({ ...item, title: redactSensitive(item.title), text: redactSensitive(item.text) })),
  }));
  // A reviewed file goes first, so it corrects the public sources: a launch that shares its name
  // with a listed company can be marked 0 there, and a success they miss or spell differently, 1.
  const reviewed: OutcomeLabel[] = options.labels ? parseLabelsCsv(await readFile(options.labels, "utf8")) : [];
  let listed: OutcomeLabel[] = [];
  if (options.unicorns) {
    const result = await (dependencies.fetchUnicornNames ?? fetchUnicornNames)();
    listed = result.names.map((company) => ({ company, outcome: 1 as const, source: result.source }));
  }
  const minTeam = options.minTeam ?? DEFAULT_MIN_TEAM;
  const directory = options.yc
    ? { ...(await (dependencies.fetchYcDirectory ?? fetchYcDirectory)()), minTeam }
    : undefined;
  const labeled = labelPastCases(fetched, { reviewed, listed, directory });

  const merged = new Map((await readPastCases(datasetsDir)).map((pastCase) => [pastCase.id, pastCase]));
  // A launch read again and now left out for an unknown outcome must not keep an older label.
  for (const pastCase of fetched) merged.delete(pastCase.id);
  for (const pastCase of labeled.cases) merged.set(pastCase.id, pastCase);
  // Two collections over different dates can each hold a launch of the same company.
  let allCases = firstLaunchEach([...merged.values()]);
  if (options.controls !== undefined) allCases = applyControls(allCases, options.controls);
  const path = await writePastCases(datasetsDir, allCases);
  const summary = summarisePastCases(allCases);
  const successes = allCases.filter((pastCase) => pastCase.outcome === 1).map((pastCase) => pastCase.subject.company).sort((a, b) => a.localeCompare(b));
  write(`Dataset: ${path}`);
  write(`Cases: ${summary.cases}; successes: ${summary.positives}; periods: ${summary.cohorts.length}${summary.cohorts.length ? ` (${summary.cohorts.map((cohort) => cohort.cohort).join(", ")})` : ""}`);
  write(`Successes: ${successes.join(", ") || "none"}`);
  if (directory) {
    write(`Success bar: publicly listed, on the programme's list of top companies, or operating with at least ${minTeam} people${options.unicorns ? ", or on the public list of unicorns" : ""}.`);
  }
  write(`Left out, outcome unknown: ${labeled.unknown.length}${labeled.unknown.length ? ` (${labeled.unknown.map((item) => `${item.company}: ${item.reason}`).join("; ")})` : ""}`);
  if (options.labels) write(`Successes in the labels file with no matching launch: ${labeled.reviewedMisses.join(", ") || "none"}`);
  if (summary.positives === summary.cases && summary.cases > 0) {
    write("Every case kept is a success. Add --yc, or companies marked 0 in a labels file, so there is something to compare them with.");
  }
  write("Review the labels before trusting the eval.");
}

async function allFounderRows(api: ApiClient, swarmId: string): Promise<FounderRow[]> {
  const rows: FounderRow[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const page = await api.listFounders({ swarmId, status: "all", limit: 100, offset });
    rows.push(...page.rows);
    total = page.total;
    if (page.rows.length === 0) break;
    offset += page.rows.length;
  }
  return rows;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The demo's clock. Each simulated day starts at six in the morning on its own date and
 * time moves a little on every read, so the snapshot has a believable history instead of
 * two weeks of runs stamped with the same minute.
 */
export interface DemoClock {
  now: () => Date;
  startDay: (daysAgo: number) => void;
}

export function createDemoClock(today: Date = new Date()): DemoClock {
  const morning = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 6, 0, 0, 0).getTime();
  let current = morning;
  return {
    now: () => new Date((current += 200)),
    startDay: (daysAgo) => {
      current = morning - Math.max(0, daysAgo) * DAY_MS;
    },
  };
}

async function runSimulationDay(api: ApiClient, service: SwarmService, swarmId: string): Promise<Run> {
  const started = await api.startRun({ swarmId, brain: "sim", sources: "sim" });
  return service.runs.wait(started.id);
}

/** Steering at every level, so the demo shows how a partner directs the swarm. */
async function addDemoSteering(api: ApiClient, swarmId: string): Promise<void> {
  await api.createDirective({ scope: { swarmId }, kind: "param", key: "weights.built_hard_things", value: 4 });
  await api.createDirective({ scope: { swarmId }, kind: "param", key: "investigate.max_founders", value: 12 });
  await api.createDirective({
    scope: { swarmId, classId: "investigator" },
    kind: "context",
    text: "Check whether the founder wrote the hard part themselves or managed the people who did.",
  });
  await api.createDirective({
    scope: { swarmId, jobId: "scout.github" },
    kind: "opinion",
    text: "Systems projects with fast, organic star growth are our sweet spot.",
  });
  const scout = await api.addAgent(swarmId, { jobId: "scout.github", name: "GitHub scout 2", beat: "Databases and storage engines" });
  await api.createDirective({
    scope: { agentId: scout.id },
    kind: "context",
    text: "Skip forks, awesome-lists and course repositories.",
  });
}

/**
 * A simulated partner with a consistent taste, so the demo shows the whole feedback loop:
 * calls with reasons, suggested steering, outreach drafts and the eval built from the calls.
 * The partner works down the top of the list, says Yes to strong engineers inside the thesis
 * and No to the rest with the reason that fits, and leaves two surfaced founders uncalled.
 */
async function addDemoCalls(api: ApiClient, swarmId: string): Promise<void> {
  // Everyone the swarm scored, including those it passed on: a partner disagreeing with a pass
  // is as useful a signal as agreeing with a surface.
  const rows = (await allFounderRows(api, swarmId))
    .filter((row) => row.composite !== null && ["surfaced", "needs_evidence", "watch", "passed"].includes(row.status))
    .sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0))
    .slice(0, 60);
  const surfaced = rows.filter((row) => row.status === "surfaced");
  const leaveWaiting = new Set(surfaced.length >= 3 ? surfaced.slice(-2).map((row) => row.id) : []);

  for (const row of rows) {
    if (leaveWaiting.has(row.id)) continue;
    const engineering = row.cracked ?? 0;
    const fit = row.fit ?? 0;
    if (engineering >= 0.45 && fit >= 0.55) {
      const reasons = [engineering >= (row.founderScore ?? 0) ? "builder" : "insight"];
      if (fit >= 0.75) reasons.push("in_thesis");
      await api.addFeedback(row.id, { verdict: "yes", reasonTags: reasons });
    } else {
      const reason = fit < 0.55 ? "outside_thesis" : engineering < 0.4 ? "not_technical" : (row.coverage ?? 0) < 0.5 ? "thin_evidence" : "weak_insight";
      await api.addFeedback(row.id, { verdict: "no", reasonTags: [reason] });
    }
  }
}

/**
 * A simulated partner's calls on companies. The rule is simple and fixed so the demo is the same
 * every time: yes when both the company and its founders score well, no otherwise. One surfaced
 * company is left without a call so the demo shows what "waiting" looks like.
 */
async function addDemoCompanyCalls(api: ApiClient, swarmId: string): Promise<void> {
  const rows = (await api.listCompanies({ swarmId, status: "all", sort: "deal", limit: 200 })).rows
    .filter((row) => row.deal !== null)
    .slice(0, 30);
  const surfaced = rows.filter((row) => row.status === "surfaced");
  const leaveWaiting = new Set(surfaced.length >= 2 ? surfaced.slice(-1).map((row) => row.id) : []);
  for (const row of rows) {
    if (leaveWaiting.has(row.id)) continue;
    const company = row.company ?? 0;
    const team = row.team ?? 0;
    if (company >= 0.55 && team >= 0.5) {
      await api.addCompanyFeedback(row.id, { verdict: "yes", reasonTags: [company >= team ? "strong_product" : "complete_team"] });
    } else {
      await api.addCompanyFeedback(row.id, { verdict: "no", reasonTags: [company < 0.45 ? "no_pull" : "team_gap"] });
    }
  }
}

async function collectSnapshot(service: SwarmService, days: number, clock: DemoClock | null): Promise<DemoSnapshot> {
  clock?.startDay(days);
  await service.ensureSeeded();
  const api = service.as("Partner");
  const swarm = await selectedSwarm(api);
  await addDemoSteering(api, swarm.id);
  // Two jobs are shared between two models each, so the Pools tab has members to compare.
  await api.setPool(swarm.id, "investigate.background", { members: [
    { id: "sonnet", route: { provider: "claude-cli", model: "claude-sonnet-5-5" }, share: 0.5 },
    { id: "haiku", route: { provider: "claude-cli", model: "claude-haiku-5-5" }, share: 0.5 },
  ] });
  await api.setPool(swarm.id, "verify.claims", { members: [
    { id: "sol", route: { provider: "openai-api", model: "gpt-6.1-sol" }, share: 0.5 },
    { id: "luna", route: { provider: "codex-cli", model: "gpt-6-luna" }, share: 0.5 },
  ] });
  const huntRunnerDefaults = runnerPools(() => true);
  for (const jobId of ["hunt.look", "hunt.sift"] as const) {
    await api.setPool(swarm.id, jobId, {
      members: (huntRunnerDefaults[jobId] ?? []).map(({ id, route, share, status }) => ({ id, route, share, status })),
    });
  }

  // One run per day, the last one this morning. The partner's calls come two days before
  // the end, so the next run drafts outreach for the Yes calls and the last one acts on
  // the one draft that was approved.
  const runDay = async (index: number) => {
    clock?.startDay(days - 1 - index);
    await runSimulationDay(api, service, swarm.id);
  };
  const before = Math.max(1, days - 2);
  for (let day = 0; day < before; day += 1) await runDay(day);
  await addDemoCalls(api, swarm.id);
  await addDemoCompanyCalls(api, swarm.id);
  if (days >= 2) await runDay(before);
  const proposed = await api.listOutreach({ swarmId: swarm.id, status: "proposed" });
  const firstEmail = proposed.find((item) => item.kind === "email_founder");
  if (firstEmail) await api.decideOutreach(firstEmail.id, { decision: "approve", note: null });
  if (days >= 3) await runDay(before + 1);
  await api.updateSettings({ schedule: { enabled: true } });

  // Five rounds: on the synthetic benchmark the first three proposals fall inside the noise and
  // are reverted, and the fourth (hiding school and employer names from the analyst) is kept.
  // A flow built on real past companies is left as it is: it has no cases here, it cannot run
  // in simulation, and a demo must not call a model.
  for (const flow of await api.listEvalFlows()) {
    const detail = await api.getEvalFlow(flow.id);
    if (detail.ready === false || detail.callsModels) continue;
    await api.runEvalRounds(flow.id, { rounds: 5, brain: "sim" });
  }
  // What the swarm does by itself after a scheduled run, so the home page has its report.
  await service.coach(swarm.id);

  // A snapshot is made to be shared, so it says nothing about this machine: which tools are
  // installed, which keys are set, or which endpoints are configured.
  const localSettings = await api.getSettings();
  const settings: DemoSnapshot["settings"] = {
    ...localSettings,
    providers: localSettings.providers.map((provider) => {
      const configured = provider.id === "sim" || provider.id === "claude-cli" || provider.id === "codex-cli";
      return { id: provider.id, label: provider.label, configured, detail: configured ? "Set up in this demo." : "Not set up in this demo." };
    }),
    sources: localSettings.sources.map((source) => {
      const configured = source.id !== "people_data";
      return { id: source.id, label: source.label, configured, detail: configured ? "Set up in this demo." : "Not connected." };
    }),
  };
  const swarms = await api.listSwarms();
  const overview: DemoSnapshot["overview"] = {};
  const tree: DemoSnapshot["tree"] = {};
  const founders: DemoSnapshot["founders"] = {};
  const outreach: DemoSnapshot["outreach"] = {};
  const runs: DemoSnapshot["runs"] = {};
  const runDetails: DemoSnapshot["runDetails"] = {};
  const tasks: DemoSnapshot["tasks"] = {};
  const founderDetails: DemoSnapshot["founderDetails"] = {};
  const companies: NonNullable<DemoSnapshot["companies"]> = {};
  const companyDetails: NonNullable<DemoSnapshot["companyDetails"]> = {};
  const hunts: NonNullable<DemoSnapshot["hunts"]> = {};
  const directiveGroups = await Promise.all(
    (["active", "paused", "archived"] as const).map((status) => api.listDirectives({ status })),
  );
  const directiveRows = [...new Map(directiveGroups.flat().map((directive) => [directive.id, directive])).values()];

  for (const current of swarms) {
    overview[current.id] = await api.getOverview(current.id);
    tree[current.id] = await api.getTree(current.id);
    hunts[current.id] = await api.getHunt(current.id);
    const rows = await allFounderRows(api, current.id);
    founders[current.id] = rows;
    outreach[current.id] = await api.listOutreach({ swarmId: current.id, status: "all" });
    const top = [...rows].sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1)).slice(0, 40);
    for (const row of top) founderDetails[row.id] = await api.getFounder(row.id);
    const companyRows = (await api.listCompanies({ swarmId: current.id, status: "all", sort: "deal", limit: 500 })).rows;
    companies[current.id] = companyRows;
    for (const row of companyRows.slice(0, 30)) companyDetails[row.id] = await api.getCompany(row.id);
    const recentRuns = await api.listRuns(current.id, 10);
    runs[current.id] = recentRuns;
    for (const run of recentRuns.slice(0, 3)) runDetails[run.id] = await api.getRun(run.id);
    const latest = recentRuns[0];
    if (latest) {
      const detail = runDetails[latest.id] ?? (runDetails[latest.id] = await api.getRun(latest.id));
      for (const task of detail.tasks.slice(0, 60)) tasks[task.id] = await api.getTask(task.id);
    }
  }

  const evalFlows: EvalFlowDTO[] = [];
  for (const flow of await api.listEvalFlows()) evalFlows.push(await api.getEvalFlow(flow.id));
  // The demo's swarm switcher shows one swarm, so these three are that swarm's.
  const assumptions = await api.getAssumptions(swarm.id);
  const pools = await api.getPools(swarm.id);
  const winner = evalFlows.find((flow) => flow.bestVariant && flow.bestVariant !== "baseline" && flow.bestVariant !== flow.promotedVariant);
  const preview = winner?.bestVariant
    ? await api.previewEvalVariant(winner.id, { variant: winner.bestVariant, swarmId: swarm.id })
    : undefined;
  return {
    generatedAt: new Date().toISOString(),
    note: "Simulated founders. No real people or companies.",
    settings,
    swarms,
    overview,
    tree,
    directives: directiveRows,
    founders,
    founderDetails,
    companies,
    companyDetails,
    outreach,
    runs,
    runDetails,
    tasks,
    evalFlows,
    assumptions,
    pools,
    hunts,
    ...(preview ? { preview } : {}),
  };
}

export async function demoSnapshotCommand(
  service: SwarmService,
  options: { days: number; out: string; repoRoot: string; clock?: DemoClock | null },
  write: OutputWriter,
): Promise<void> {
  const snapshot = await collectSnapshot(service, options.days, options.clock ?? null);
  const outputPath = isAbsolute(options.out) ? options.out : resolve(options.repoRoot, options.out);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  write(`Wrote ${basename(outputPath)} (${snapshot.swarms.length} swarms, ${Object.keys(snapshot.founderDetails).length} dossiers).`);
}

export async function seedCommand(service: SwarmService, write: OutputWriter): Promise<void> {
  await service.ensureSeeded();
  write("Default swarm is ready.");
}

export async function runCliCommand(
  service: SwarmService,
  argv: string[],
  write: OutputWriter,
  dependencies: {
    doctor?: DoctorRunner;
    clock?: DemoClock | null;
    env?: NodeJS.ProcessEnv;
    collectLaunchPosts?: PastCollector;
    fetchUnicornNames?: UnicornFetcher;
    fetchYcDirectory?: DirectoryFetcher;
  } = {},
): Promise<number> {
  try {
    const command = argv[0];
    if (command === "help" || command === "--help" || command === "-h") {
      for (const line of CLI_HELP.split("\n")) write(line);
      return 0;
    }
    if (!command) throw new Error(CLI_HELP);
    if (command === "mcp") {
      const { values } = parseArgs({ args: argv.slice(1), options: { url: { type: "string" }, swarm: { type: "string" } }, strict: true });
      await serveMcp({ url: values.url, swarmId: values.swarm });
      return 0;
    }
    if (command === "seed") {
      if (argv.length > 1) throw new Error("seed takes no options.");
      await seedCommand(service, write);
      return 0;
    }
    if (command === "run") {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: {
          swarm: { type: "string" }, brain: { type: "string" }, sources: { type: "string" },
          days: { type: "string" }, budget: { type: "string" },
        },
        strict: true,
      });
      if (values.brain && values.brain !== "sim" && values.brain !== "live") throw new Error("--brain must be sim or live.");
      if (values.sources && values.sources !== "sim" && values.sources !== "live") throw new Error("--sources must be sim or live.");
      await runCommand(service, {
        swarm: values.swarm,
        brain: values.brain as "sim" | "live" | undefined,
        sources: values.sources as "sim" | "live" | undefined,
        days: positiveInteger(values.days, "days", 1),
        budget: usd(values.budget),
      }, write);
      return 0;
    }
    if (command === "doctor") {
      const { values } = parseArgs({ args: argv.slice(1), options: { live: { type: "boolean" } }, strict: true });
      await doctorCommand(service, { live: values.live ?? false }, write, dependencies.doctor ?? runDoctor);
      return 0;
    }
    if (command === "eval") {
      const subcommand = argv[1];
      if (subcommand !== "show" && subcommand !== "rounds") throw new Error("Usage: swarm eval <show|rounds> [--flow <id>] [--rounds <n>] [--budget <usd>].");
      const { values } = parseArgs({
        args: argv.slice(2),
        options: { flow: { type: "string" }, rounds: { type: "string" }, budget: { type: "string" } },
        strict: true,
      });
      if (subcommand === "show") await evalShowCommand(service, values.flow, write);
      else {
        // Zero rounds measures the baseline and tries no change.
        const rounds = values.rounds === undefined ? 1 : Number(values.rounds);
        if (!Number.isSafeInteger(rounds) || rounds < 0 || rounds > 20) throw new Error("--rounds must be a whole number from 0 to 20.");
        let budget: number | undefined;
        if (values.budget !== undefined) {
          budget = Number(values.budget);
          if (!Number.isFinite(budget) || budget < 0 || budget > 1000) throw new Error("--budget must be a number of dollars from 0 to 1000.");
        }
        await evalRoundsCommand(service, values.flow, rounds, write, budget);
      }
      return 0;
    }
    if (command === "past") {
      const subcommand = argv[1];
      const env = dependencies.env ?? process.env;
      const datasetsDir = datasetsDirectory(env);
      if (subcommand === "show") {
        if (argv.length > 2) throw new Error("Usage: swarm past show.");
        await pastShowCommand(datasetsDir, write);
        return 0;
      }
      if (subcommand === "import") {
        const { values } = parseArgs({ args: argv.slice(2), options: { file: { type: "string" }, bar: { type: "string" } }, strict: true });
        if (!values.file) throw new Error("past import requires --file <deals.csv>.");
        const existing = await readPastCases(datasetsDir);
        const result = importDealsCsv(await readFile(typedPath(values.file, env), "utf8"), { existing, bar: values.bar, redact: redactSensitive });
        await writePastCases(datasetsDir, result.cases);
        write(`Imported: ${result.imported}; updated: ${result.updated}; left out for no outcome: ${result.leftOutNoOutcome}; refused: ${result.refused.length}`);
        for (const row of result.refused) write(`Refused line ${row.line}: ${row.reason}`);
        await pastShowCommand(datasetsDir, write);
        return 0;
      }
      if (subcommand !== "collect") throw new Error("Usage: swarm past <collect|import|show>.");
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          from: { type: "string" }, to: { type: "string" }, labels: { type: "string" },
          unicorns: { type: "boolean" }, controls: { type: "string" },
          yc: { type: "boolean" }, "min-team": { type: "string" },
        },
        strict: true,
      });
      if (!values.from || !values.to) throw new Error("past collect requires --from and --to.");
      let controls: number | undefined;
      if (values.controls !== undefined) {
        controls = Number(values.controls);
        if (!Number.isSafeInteger(controls) || controls < 0) throw new Error("--controls must be a non-negative whole number.");
      }
      await pastCollectCommand({
        from: values.from,
        to: values.to,
        labels: values.labels === undefined ? undefined : typedPath(values.labels, env),
        unicorns: values.unicorns ?? false,
        yc: values.yc ?? false,
        minTeam: values["min-team"] === undefined ? undefined : positiveInteger(values["min-team"], "min-team", DEFAULT_MIN_TEAM),
        controls,
      }, datasetsDir, write, dependencies);
      return 0;
    }
    if (command === "demo-snapshot") {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: { days: { type: "string" }, out: { type: "string" } },
        strict: true,
      });
      const config = resolveConfig(process.env);
      await demoSnapshotCommand(service, {
        days: positiveInteger(values.days, "days", 21),
        out: values.out ?? "apps/web/src/lib/api/demo-snapshot.json",
        repoRoot: config.repositoryRoot,
        clock: dependencies.clock ?? null,
      }, write);
      return 0;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const message = `Error: ${error instanceof Error ? error.message : String(error)}`;
    if (argv[0] === "mcp") process.stderr.write(`${message}\n`);
    else write(message);
    return 1;
  }
}

export async function main(): Promise<void> {
  const command = process.argv[2];
  const config = resolveConfig(process.env);
  const out: OutputWriter = (line) => process.stdout.write(`${line}\n`);
  let temporary: string | undefined;
  let app: ReturnType<typeof createApp> | undefined;
  try {
    const isDemo = command === "demo-snapshot";
    const clock = isDemo ? createDemoClock() : null;
    if (isDemo) temporary = await mkdtemp(join(tmpdir(), "agentswarm-demo-"));
    const appOptions: AppOptions = isDemo
      ? {
          dbPath: join(temporary!, "swarm.db"),
          dataDir: join(temporary!, "data"),
          flowsDir: join(temporary!, "evals", "flows"),
          cron: createCronHelper(),
          env: { ...process.env, SWARM_BRAIN: "sim", SWARM_SOURCES: "sim" },
          simSeed: config.simSeed,
          fundName: config.fundName,
          now: clock!.now,
        }
      : {
          dbPath: config.dbPath,
          dataDir: config.dataDir,
          flowsDir: config.flowsDir,
          datasetsDir: config.datasetsDir,
          evalJudge: config.evalJudge,
          cron: createCronHelper(),
          env: process.env,
          simSeed: config.simSeed,
          fundName: config.fundName,
        };
    app = createApp(appOptions);
    const status = await runCliCommand(app.service, process.argv.slice(2), out, { clock });
    if (status !== 0) process.exitCode = status;
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    app?.close();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main();
