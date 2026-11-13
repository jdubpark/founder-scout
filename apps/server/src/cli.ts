import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createApp, runDoctor, type AppOptions, type DoctorRow, type SwarmService } from "@agentswarm/core";
import {
  type ApiClient,
  type DemoSnapshot,
  type EvalFlowDTO,
  type FounderRow,
  type Run,
} from "@agentswarm/shared";
import { resolveConfig } from "./config";
import { createCronHelper } from "./cron";

export type OutputWriter = (line: string) => void;
type DoctorRunner = (options: { live: boolean; env?: NodeJS.ProcessEnv }) => Promise<DoctorRow[]>;

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
    const started = await api.startRun({
      swarmId: swarm.id,
      ...(options.brain ? { brain: options.brain } : {}),
      ...(options.sources ? { sources: options.sources } : {}),
      ...(options.budget ? { budgetUsd: options.budget } : {}),
    });
    outputRun(await service.runs.wait(started.id), write);
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
): Promise<void> {
  const api = service.as("Partner");
  const summaries = await api.listEvalFlows();
  const summary = flowId ? summaries.find((flow) => flow.id === flowId) : summaries[0];
  if (!summary) throw new Error(flowId ? `Eval flow not found: ${flowId}` : "No eval flows are available.");
  const flow = await api.runEvalRounds(summary.id, { rounds, brain: "sim" });
  const newest = flow.variants[flow.variants.length - 1];
  write(`${flow.id}: ${rounds} round${rounds === 1 ? "" : "s"} complete${newest ? `; ${newest.status}, test=${score(flow, newest.test)}` : ""}`);
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
  for (const flow of await api.listEvalFlows()) await api.runEvalRounds(flow.id, { rounds: 5, brain: "sim" });

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
  const directiveGroups = await Promise.all(
    (["active", "paused", "archived"] as const).map((status) => api.listDirectives({ status })),
  );
  const directiveRows = [...new Map(directiveGroups.flat().map((directive) => [directive.id, directive])).values()];

  for (const current of swarms) {
    overview[current.id] = await api.getOverview(current.id);
    tree[current.id] = await api.getTree(current.id);
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
  dependencies: { doctor?: DoctorRunner; clock?: DemoClock | null } = {},
): Promise<number> {
  try {
    const command = argv[0];
    if (!command) throw new Error("Usage: swarm <run|doctor|eval|demo-snapshot|seed> [options].");
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
      if (subcommand !== "show" && subcommand !== "rounds") throw new Error("Usage: swarm eval <show|rounds> [--flow <id>] [--rounds <n>].");
      const { values } = parseArgs({
        args: argv.slice(2),
        options: { flow: { type: "string" }, rounds: { type: "string" } },
        strict: true,
      });
      if (subcommand === "show") await evalShowCommand(service, values.flow, write);
      else await evalRoundsCommand(service, values.flow, positiveInteger(values.rounds, "rounds", 1), write);
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
    write(`Error: ${error instanceof Error ? error.message : String(error)}`);
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
