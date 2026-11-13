import {
  BASE_CONFIG,
  JOBS,
  SEAT_ASKER,
  effectiveParam,
  resolveSteering,
  seatHolder,
  stableId,
  type Hunt,
  type HuntSeatDTO,
  type HuntTurnResult,
  type HuntWaveResult,
  type NavigateTurn,
  type SeatHolder,
  type SwarmConfig,
} from "@agentswarm/shared";
import { findSensitive } from "../jobs";
import type { RunController, ServiceDeps, Store } from "../contracts";
import { ServiceError } from "../contracts";
import { applyNavigatorTurn, buildNavigateInput } from "../engine/hunt";

type SeatStore = Pick<Store,
  | "getSwarm" | "getConfig" | "getSettings" | "listDirectives" | "listAgents" | "activeRun"
  | "getHunt" | "saveHunt" | "listTrails" | "getTrail" | "listFrontier" | "listHuntNotes"
  | "saveTrail" | "addFrontier" | "insertHuntNote" | "transaction"
>;

export interface HuntSeatServiceDeps {
  store: SeatStore;
  runs: RunController;
  web?: ServiceDeps["web"];
  now?: () => Date;
  audit(actor: string, action: string, target: string, detail?: Record<string, unknown>): unknown;
}

function fail(status: number, message: string): never {
  throw new ServiceError(status, message);
}

function identity(swarmId: string, jobId: "hunt.navigate" | "hunt.look", agentId: string | null) {
  const job = JOBS.find((item) => item.id === jobId)!;
  return { swarmId, classId: job.classId, jobId, agentId };
}

function value<T>(deps: HuntSeatServiceDeps, swarmId: string, config: SwarmConfig, jobId: "hunt.navigate" | "hunt.look", key: string, fallback: T): T {
  const agent = deps.store.listAgents(swarmId).find((item) => item.jobId === jobId) ?? null;
  const resolved = resolveSteering(deps.store.listDirectives(), identity(swarmId, jobId, agent?.id ?? null), (deps.now ?? (() => new Date()))());
  const result = effectiveParam(key, resolved, config).value;
  return (result === null ? fallback : result) as T;
}

async function viewFor(deps: HuntSeatServiceDeps, swarmId: string) {
  const swarm = deps.store.getSwarm(swarmId);
  if (!swarm) fail(404, "Swarm not found.");
  const config = deps.store.getConfig(swarm.configId) ?? BASE_CONFIG;
  const hunt = deps.store.getHunt(swarmId);
  const trails = hunt ? deps.store.listTrails(hunt.id) : [];
  const queued = hunt ? deps.store.listFrontier(hunt.id, { state: "queued" }) : [];
  const notes = hunt ? deps.store.listHuntNotes(hunt.id, 12) : [];
  const settings = deps.store.getSettings();
  const mode = settings.schedule.sources;
  const engines = await Promise.all((deps.web?.[mode]?.engines ?? []).map(async (engine) => {
    try {
      if (!(await engine.status()).configured) return null;
      return { id: engine.id, label: engine.label, searches: engine.searches };
    } catch {
      return null;
    }
  }));
  const availableEngines = engines.filter((engine): engine is NonNullable<typeof engine> => engine !== null);
  const turns = value(deps, swarmId, config, "hunt.navigate", "hunt.turns", 4);
  const waveSize = value(deps, swarmId, config, "hunt.look", "hunt.wave_size", 12);
  const latestStage = value(deps, swarmId, config, "hunt.navigate", "hunt.latest_stage", "seed" as const);
  return buildNavigateInput({
    thesis: swarm.thesis,
    latestStage,
    engines: availableEngines,
    waveSize,
    turn: (hunt?.turn ?? 0) + 1,
    trails,
    queued,
    notes,
    lastWave: hunt?.lastWave ?? null,
    turnsLeft: turns,
    callsLeft: turns * waveSize,
  });
}

async function seatState(deps: HuntSeatServiceDeps, swarmId: string): Promise<HuntSeatDTO> {
  const swarm = deps.store.getSwarm(swarmId);
  if (!swarm) fail(404, "Swarm not found.");
  const hunt = deps.store.getHunt(swarmId);
  const configuredHolder = value(deps, swarmId, deps.store.getConfig(swarm.configId) ?? BASE_CONFIG, "hunt.navigate", "hunt.navigator", "built_in") as SeatHolder;
  const idleDays = value(deps, swarmId, deps.store.getConfig(swarm.configId) ?? BASE_CONFIG, "hunt.navigate", "hunt.outside_idle_days", 2);
  const active = deps.store.activeRun(swarmId);
  return {
    swarmId,
    configuredHolder,
    holder: seatHolder(configuredHolder, hunt?.seatAt, (deps.now ?? (() => new Date()))().toISOString(), idleDays),
    seatAt: hunt?.seatAt ?? null,
    activeRun: active ? { id: active.id, status: active.status, stage: active.stage } : null,
    view: await viewFor(deps, swarmId),
  };
}

function requireOutside(deps: HuntSeatServiceDeps, swarmId: string): void {
  const swarm = deps.store.getSwarm(swarmId);
  if (!swarm) fail(404, "Swarm not found.");
  const config = deps.store.getConfig(swarm.configId) ?? BASE_CONFIG;
  const configured = value<string>(deps, swarmId, config, "hunt.navigate", "hunt.navigator", "built_in");
  if (configured !== "outside") fail(409, "The outside agent does not hold this swarm's seat. Set hunt.navigator to outside in the swarm's Hunt settings to hand it over.");
  if (deps.store.activeRun(swarmId)?.stage === "hunt") fail(409, "A run is in its hunt stage. Wait for that stage to finish before taking a turn.");
}

function refusePersonal(turn: NavigateTurn): void {
  const texts = [
    ...turn.open.flatMap((item) => [item.name, item.intent, ...item.searches.map((search) => search.query)]),
    ...turn.extend.flatMap((item) => item.searches.map((search) => search.query)),
    ...turn.close.map((item) => item.why),
    ...turn.notes,
  ];
  const personal = [...new Set(texts.flatMap((text) => findSensitive(text)))];
  if (personal.length) fail(400, `Hunt steering cannot refer to personal attributes (${personal.join(", ")}). Describe the work or the company instead.`);
}

export async function getHuntSeat(deps: HuntSeatServiceDeps, swarmId: string): Promise<HuntSeatDTO> {
  return seatState(deps, swarmId);
}

export async function takeHuntTurn(deps: HuntSeatServiceDeps, actor: string, swarmId: string, turn: NavigateTurn): Promise<HuntTurnResult> {
  requireOutside(deps, swarmId);
  refusePersonal(turn);
  const at = (deps.now ?? (() => new Date()))().toISOString();
  if (!deps.store.getSwarm(swarmId)) fail(404, "Swarm not found.");
  const settings = deps.store.getSettings();
  const engines = await Promise.all((deps.web?.[settings.schedule.sources]?.engines ?? []).map(async (engine) => (await engine.status().catch(() => ({ configured: false }))).configured ? engine.id : null));
  let applied!: ReturnType<typeof applyNavigatorTurn>;
  deps.store.transaction(() => {
    requireOutside(deps, swarmId);
    const stored = deps.store.getHunt(swarmId);
    const hunt: Hunt = stored ?? { id: stableId("hnt", swarmId), swarmId, turn: 0, looks: 0, lastWave: null, seatAt: null, createdAt: at, updatedAt: at };
    const writer = { store: deps.store, now: deps.now ?? (() => new Date()), asker: SEAT_ASKER };
    applied = applyNavigatorTurn(writer, hunt, turn, engines.filter((id): id is string => id !== null));
    deps.store.saveHunt({ ...applied.hunt, seatAt: at });
  });
  deps.audit(actor, "hunt.seat.turn", swarmId, { turn: applied.hunt.turn, opened: applied.plan.open.length, extended: applied.plan.extend.length, closed: applied.plan.close.length, refused: applied.plan.refused.length });
  return {
    opened: applied.plan.open.map((item) => item.name),
    extended: applied.plan.extend.map((item) => item.trailId),
    closed: applied.plan.close.map((item) => item.trailId),
    focused: applied.plan.focus.map(({ trailId, weight }) => ({ trailId, weight })),
    noted: applied.plan.notes,
    refused: applied.plan.refused,
    view: await viewFor(deps, swarmId),
  };
}

export async function runHuntWave(deps: HuntSeatServiceDeps, actor: string, swarmId: string, input: { waves?: number } = {}): Promise<HuntWaveResult> {
  requireOutside(deps, swarmId);
  const waves = input.waves ?? 1;
  if (!Number.isInteger(waves) || waves < 1 || waves > 3) fail(400, "Choose from 1 to 3 waves.");
  if (deps.store.activeRun(swarmId)) fail(409, "A run is already active for this swarm. Wait for it to finish before starting a hunt wave.");
  const settings = deps.store.getSettings();
  let run;
  try {
    const started = await deps.runs.start({ swarmId, scope: "hunt", trigger: "agent", waves, brain: settings.schedule.brain, sources: settings.schedule.sources });
    run = await deps.runs.wait(started.id);
  } catch (error) {
    fail(409, `The hunt wave could not run: ${error instanceof Error ? error.message : String(error)}`);
  }
  const hunt = deps.store.getHunt(swarmId);
  deps.audit(actor, "hunt.seat.wave", swarmId, { runId: run.id, status: run.status, waves, costUsd: run.costUsd });
  return { run: { id: run.id, status: run.status, costUsd: run.costUsd }, lastWave: hunt?.lastWave ?? null, view: await viewFor(deps, swarmId) };
}
