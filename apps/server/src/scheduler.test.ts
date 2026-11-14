import type { CronHelper, Logger, SwarmService } from "@agentswarm/core";
import type { ScheduleSettings, SettingsDTO } from "@agentswarm/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCronHelper } from "./cron";
import { startScheduler } from "./scheduler";

const schedule = (overrides: Partial<ScheduleSettings> = {}): ScheduleSettings => ({
  enabled: true,
  cron: "0 6 * * *",
  timezone: "UTC",
  brain: "sim",
  sources: "sim",
  ...overrides,
});

function makeService(initial: ScheduleSettings) {
  let current = initial;
  const getSettings = vi.fn(async () => ({ settings: { schedule: current } }) as SettingsDTO);
  const runScheduled = vi.fn(async () => []);
  const waitForRun = vi.fn(async (runId: string) => ({ id: runId, swarmId: "swarm-1" }));
  const coach = vi.fn(async () => ({}));
  const service = {
    as: vi.fn(() => ({ getSettings })),
    runScheduled,
    runs: { wait: waitForRun },
    coach,
  } as unknown as SwarmService;
  return {
    service,
    getSettings,
    runScheduled,
    waitForRun,
    coach,
    setSchedule(next: ScheduleSettings) { current = next; },
  };
}

function makeCron(): CronHelper {
  return {
    isValid: () => true,
    next: vi.fn((expression, _timezone, from) => {
      const delayMs = expression.startsWith("30 ") ? 90_000 : 60_000;
      return new Date(from.getTime() + delayMs).toISOString();
    }),
  };
}

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("startScheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("arms the enabled schedule, fires it, and rearms for the next occurrence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fixture = makeService(schedule());
    const cron = makeCron();
    const scheduler = startScheduler({ service: fixture.service, cron, pollMs: 300_000 });
    await flushPromises();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.runScheduled).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.runScheduled).toHaveBeenCalledTimes(2);

    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("syncs dispatched calls on a scheduler tick", async () => {
    const getSettings = vi.fn(async () => ({ settings: { schedule: schedule({ enabled: false }) } }) as SettingsDTO);
    const listSwarms = vi.fn(async () => [{ id: "swarm-1", status: "active" }]);
    const listOutreach = vi.fn(async () => [{ id: "out-1", status: "dispatched" }]);
    const syncCalls = vi.fn(async () => []);
    const service = { as: vi.fn(() => ({ getSettings, listSwarms, listOutreach, syncCalls })) } as unknown as SwarmService;
    const scheduler = startScheduler({ service, cron: makeCron(), pollMs: 300_000 });
    await flushPromises();
    expect(listOutreach).toHaveBeenCalledWith({ swarmId: "swarm-1", status: "dispatched" });
    expect(syncCalls).toHaveBeenCalledWith("swarm-1");
    scheduler.stop();
  });

  it("coaches each scheduled run only after it finishes, without waiting for coaching before later ticks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fixture = makeService(schedule());
    const run = { id: "run-1", swarmId: "swarm-1" };
    let finishRun!: () => void;
    let finishCoach!: () => void;
    fixture.runScheduled.mockResolvedValueOnce([run] as never);
    fixture.waitForRun.mockImplementation(() => new Promise((resolve) => {
      finishRun = () => resolve(run);
    }));
    fixture.coach.mockImplementation(() => new Promise((resolve) => {
      finishCoach = () => resolve({});
    }));
    const scheduler = startScheduler({ service: fixture.service, cron: makeCron(), pollMs: 300_000 });
    await flushPromises();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.waitForRun).toHaveBeenCalledWith(run.id);
    expect(fixture.coach).not.toHaveBeenCalled();

    finishRun();
    await flushPromises();
    expect(fixture.coach).toHaveBeenCalledWith(run.swarmId);

    // The coach promise is still pending, but that must not hold the scheduler's next tick.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.runScheduled).toHaveBeenCalledTimes(2);

    finishCoach();
    scheduler.stop();
  });

  it("logs coaching failures and continues scheduling later runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fixture = makeService(schedule());
    fixture.runScheduled.mockResolvedValueOnce([{ id: "run-1", swarmId: "swarm-1" }] as never);
    fixture.coach.mockRejectedValueOnce(new Error("eval storage is unavailable"));
    const logger = { error: vi.fn() } as unknown as Pick<Logger, "error">;
    const scheduler = startScheduler({ service: fixture.service, cron: makeCron(), pollMs: 300_000, logger });
    await flushPromises();

    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();
    expect(logger.error).toHaveBeenCalledWith("Scheduled run coaching failed", { error: "eval storage is unavailable" });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.runScheduled).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("replaces the pending firing when enabled, expression, or timezone settings change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fixture = makeService(schedule());
    const cron = makeCron();
    const scheduler = startScheduler({ service: fixture.service, cron, pollMs: 30_000 });
    await flushPromises();

    fixture.setSchedule(schedule({ cron: "30 6 * * *", timezone: "America/Chicago" }));
    await vi.advanceTimersByTimeAsync(30_000);
    await flushPromises();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fixture.runScheduled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fixture.runScheduled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.runScheduled).toHaveBeenCalledTimes(1);

    fixture.setSchedule(schedule({ enabled: false }));
    await vi.advanceTimersByTimeAsync(30_000);
    await flushPromises();
    expect(vi.getTimerCount()).toBe(1); // only the recurring settings poll remains

    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs run failures and still rearms", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fixture = makeService(schedule());
    fixture.runScheduled.mockRejectedValueOnce(new Error("service unavailable"));
    const logger = { error: vi.fn() } as unknown as Pick<Logger, "error">;
    const cron = makeCron();
    const scheduler = startScheduler({ service: fixture.service, cron, pollMs: 120_000, logger });
    await flushPromises();

    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();
    expect(logger.error).toHaveBeenCalledWith("Scheduled run failed", { error: "service unavailable" });
    expect(cron.next).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it("retries settings reads after failures and cancels all timers when stopped", async () => {
    vi.useFakeTimers();
    const fixture = makeService(schedule({ enabled: false }));
    fixture.getSettings.mockRejectedValueOnce(new Error("temporary read failure"));
    const logger = { error: vi.fn() } as unknown as Pick<Logger, "error">;
    const scheduler = startScheduler({ service: fixture.service, cron: makeCron(), pollMs: 1_000, logger });
    await flushPromises();
    expect(logger.error).toHaveBeenCalledWith("Scheduler settings poll failed", { error: "temporary read failure" });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.getSettings).toHaveBeenCalledTimes(2);
    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for an in-flight scheduled dispatch when draining", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fixture = makeService(schedule());
    let finishDispatch!: () => void;
    fixture.runScheduled.mockImplementation(() => new Promise((resolve) => {
      finishDispatch = () => resolve([]);
    }));
    const scheduler = startScheduler({ service: fixture.service, cron: makeCron(), pollMs: 300_000 });
    await flushPromises();

    await vi.advanceTimersByTimeAsync(60_000);
    scheduler.stop();
    let drained = false;
    const drain = scheduler.waitForIdle().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);

    finishDispatch();
    await drain;
    expect(drained).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for a settings read already in progress when draining", async () => {
    vi.useFakeTimers();
    const fixture = makeService(schedule({ enabled: false }));
    let finishSettings!: () => void;
    fixture.getSettings.mockImplementation(() => new Promise((resolve) => {
      finishSettings = () => resolve({ settings: { schedule: schedule({ enabled: false }) } } as SettingsDTO);
    }));
    const scheduler = startScheduler({ service: fixture.service, cron: makeCron(), pollMs: 300_000 });
    scheduler.stop();

    let drained = false;
    const drain = scheduler.waitForIdle().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);

    finishSettings();
    await drain;
    expect(drained).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("startScheduler catch-up", () => {
  afterEach(() => vi.useRealTimers());

  function makeCatchUpService(lastRunStartedAt: string | null, status: "active" | "paused" = "active") {
    const getSettings = vi.fn(async () => ({ settings: { schedule: schedule() } }) as SettingsDTO);
    const listSwarms = vi.fn(async () => [{ id: "swarm-1", status }]);
    const listRuns = vi.fn(async () => (lastRunStartedAt ? [{ id: "run-1", startedAt: lastRunStartedAt }] : []));
    const runScheduled = vi.fn(async () => []);
    const waitForRun = vi.fn(async (runId: string) => ({ id: runId, swarmId: "swarm-1" }));
    const coach = vi.fn(async () => ({}));
    const service = { as: vi.fn(() => ({ getSettings, listSwarms, listRuns })), runScheduled, runs: { wait: waitForRun }, coach } as unknown as SwarmService;
    return { service, runScheduled, listRuns, waitForRun, coach };
  }

  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  };

  it("runs once at start when the daily time passed and the swarm has not run since", async () => {
    vi.useFakeTimers();
    // Nine in the morning; the schedule is six. Yesterday's run is the latest one.
    vi.setSystemTime(new Date("2026-01-01T09:00:00.000Z"));
    const fixture = makeCatchUpService("2025-12-31T06:00:02.000Z");
    const scheduler = startScheduler({ service: fixture.service, cron: createCronHelper(), pollMs: 300_000, catchUp: true });
    await settle();
    expect(fixture.runScheduled).toHaveBeenCalledTimes(1);
    expect(fixture.runScheduled).toHaveBeenCalledWith(["swarm-1"]);

    // Later settings polls do not catch up again.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fixture.runScheduled).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("coaches a catch-up run only after its completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T09:00:00.000Z"));
    const fixture = makeCatchUpService("2025-12-31T06:00:02.000Z");
    const run = { id: "catch-up-run", swarmId: "swarm-1" };
    let finishRun!: () => void;
    fixture.runScheduled.mockResolvedValueOnce([run] as never);
    fixture.waitForRun.mockImplementation(() => new Promise((resolve) => {
      finishRun = () => resolve(run);
    }));
    const scheduler = startScheduler({ service: fixture.service, cron: createCronHelper(), pollMs: 300_000, catchUp: true });

    await settle();
    expect(fixture.waitForRun).toHaveBeenCalledWith(run.id);
    expect(fixture.coach).not.toHaveBeenCalled();
    finishRun();
    await settle();
    expect(fixture.coach).toHaveBeenCalledWith(run.swarmId);
    scheduler.stop();
  });

  it("catches up only active swarms that missed their run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T09:00:00.000Z"));
    const getSettings = vi.fn(async () => ({ settings: { schedule: schedule() } }) as SettingsDTO);
    const listSwarms = vi.fn(async () => [
      { id: "ran-today", status: "active" },
      { id: "missed", status: "active" },
      { id: "paused", status: "paused" },
    ]);
    const listRuns = vi.fn(async (swarmId: string) => [
      ...(swarmId === "paused" ? [] : [{ id: `run-${swarmId}`, startedAt: swarmId === "ran-today" ? "2026-01-01T06:00:01.000Z" : "2025-12-31T06:00:01.000Z" }]),
    ]);
    const runScheduled = vi.fn(async () => []);
    const service = { as: vi.fn(() => ({ getSettings, listSwarms, listRuns })), runScheduled } as unknown as SwarmService;
    const scheduler = startScheduler({ service, cron: createCronHelper(), pollMs: 300_000, catchUp: true });
    await settle();
    expect(runScheduled).toHaveBeenCalledTimes(1);
    expect(runScheduled).toHaveBeenCalledWith(["missed"]);
    expect(listRuns).toHaveBeenCalledWith("ran-today", 1);
    expect(listRuns).toHaveBeenCalledWith("missed", 1);
    expect(listRuns).not.toHaveBeenCalledWith("paused", 1);
    scheduler.stop();
  });

  it("stays off unless catch-up is enabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T09:00:00.000Z"));
    const neverRan = makeCatchUpService(null);
    const second = startScheduler({ service: neverRan.service, cron: createCronHelper(), pollMs: 300_000 });
    await settle();
    expect(neverRan.runScheduled).not.toHaveBeenCalled();
    second.stop();
  });
});
