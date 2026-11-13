import type { CronHelper, Logger, SwarmService } from "@agentswarm/core";

const DEFAULT_POLL_MS = 30_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
/** How far back a start-up looks for a scheduled time that was missed while the server was off. */
const CATCH_UP_WINDOW_MS = 24 * 60 * 60 * 1000;
const CATCH_UP_MAX_STEPS = 2_000;

export interface SchedulerOptions {
  service: SwarmService;
  cron: CronHelper;
  pollMs?: number;
  logger?: Pick<Logger, "error">;
  /**
   * At start-up, if a scheduled time passed in the last day and an active swarm has not run
   * since, start the scheduled runs once. Covers a machine that was asleep or a server that
   * was restarted after the daily time. Off unless asked for.
   */
  catchUp?: boolean;
}

export interface SchedulerHandle {
  stop(): void;
  /** Resolves after scheduled dispatch and settings reads already in progress have returned. */
  waitForIdle(): Promise<void>;
}

/** Starts a scheduler that refreshes persisted settings and arms the next run. */
export function startScheduler(options: SchedulerOptions): SchedulerHandle {
  const { service, cron, logger } = options;
  const pollMs = Math.max(1, options.pollMs ?? DEFAULT_POLL_MS);
  const settings = service.as("Scheduler");
  let scheduleTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let settingsPoll: Promise<void> | undefined;
  let stopped = false;
  let revision = 0;
  let previousKey: string | undefined;
  let scheduledDispatch: Promise<void> | undefined;

  const reportFailure = (message: string, error: unknown): void => {
    const detail = { error: error instanceof Error ? error.message : String(error) };
    if (logger) logger.error(message, detail);
    else console.error(message, detail);
  };

  const coachAfterRun = (runs: Awaited<ReturnType<SwarmService["runScheduled"]>>): void => {
    for (const run of runs) {
      void (async () => {
        try {
          await service.runs.wait(run.id);
        } catch (error) {
          reportFailure("Scheduled run completion wait failed", error);
          return;
        }
        if (stopped) return;
        try {
          await service.coach(run.swarmId);
        } catch (error) {
          reportFailure("Scheduled run coaching failed", error);
        }
      })();
    }
  };

  const syncDispatchedCalls = async (): Promise<void> => {
    if (typeof settings.listSwarms !== "function" || typeof settings.listOutreach !== "function" || typeof settings.syncCalls !== "function") return;
    for (const swarm of await settings.listSwarms()) {
      if (stopped) return;
      const dispatched = await settings.listOutreach({ swarmId: swarm.id, status: "dispatched" });
      if (dispatched.length === 0) continue;
      await settings.syncCalls(swarm.id);
    }
  };

  const clearScheduleTimer = (): void => {
    if (scheduleTimer !== undefined) clearTimeout(scheduleTimer);
    scheduleTimer = undefined;
  };

  const arm = (enabled: boolean, expression: string, timezone: string, currentRevision: number): void => {
    clearScheduleTimer();
    if (!enabled || stopped) return;

    const next = cron.next(expression, timezone, new Date());
    if (next === null) return;
    const dueAt = Date.parse(next);
    if (!Number.isFinite(dueAt)) return;
    const delay = Math.max(0, dueAt - Date.now());

    scheduleTimer = setTimeout(() => {
      scheduleTimer = undefined;
      if (stopped || currentRevision !== revision) return;
      if (Date.now() < dueAt) {
        arm(enabled, expression, timezone, currentRevision);
        return;
      }
      const dispatch = (async () => {
        try {
          const runs = await service.runScheduled();
          coachAfterRun(runs);
        } catch (error) {
          reportFailure("Scheduled run failed", error);
        } finally {
          if (!stopped && currentRevision === revision) {
            arm(enabled, expression, timezone, currentRevision);
          }
        }
      })();
      scheduledDispatch = dispatch;
      void dispatch.then(
        () => { if (scheduledDispatch === dispatch) scheduledDispatch = undefined; },
        () => { if (scheduledDispatch === dispatch) scheduledDispatch = undefined; },
      );
    }, Math.min(delay, MAX_TIMEOUT_MS));
  };

  /** The most recent scheduled time in the last day, or null when there was none. */
  const latestDue = (expression: string, timezone: string): number | null => {
    const now = Date.now();
    let due: number | null = null;
    let cursor = new Date(now - CATCH_UP_WINDOW_MS);
    for (let step = 0; step < CATCH_UP_MAX_STEPS; step += 1) {
      const next = cron.next(expression, timezone, cursor);
      const at = next === null ? Number.NaN : Date.parse(next);
      if (!Number.isFinite(at) || at > now || at <= cursor.getTime()) break;
      due = at;
      cursor = new Date(at);
    }
    return due;
  };

  const catchUp = async (expression: string, timezone: string): Promise<void> => {
    const due = latestDue(expression, timezone);
    if (due === null || stopped) return;
    const swarms = (await settings.listSwarms()).filter((swarm) => swarm.status === "active");
    const overdue: string[] = [];
    for (const swarm of swarms) {
      const [latest] = await settings.listRuns(swarm.id, 1);
      if (stopped) return;
      if (!latest || Date.parse(latest.startedAt) < due) overdue.push(swarm.id);
    }
    // Only the swarms that missed their run: one that already ran today is not run again.
    if (overdue.length > 0) coachAfterRun(await service.runScheduled(overdue));
  };

  const poll = async (): Promise<void> => {
    if (stopped) return;
    try {
      const response = await settings.getSettings();
      if (stopped) return;
      await syncDispatchedCalls();
      if (stopped) return;
      const schedule = response.settings.schedule;
      const key = JSON.stringify([schedule.enabled, schedule.cron, schedule.timezone]);
      if (key !== previousKey) {
        const firstRead = previousKey === undefined;
        previousKey = key;
        revision += 1;
        arm(schedule.enabled, schedule.cron, schedule.timezone, revision);
        if (firstRead && options.catchUp && schedule.enabled) {
          const dispatch = catchUp(schedule.cron, schedule.timezone).catch((error: unknown) => {
            reportFailure("Scheduled catch-up failed", error);
          });
          scheduledDispatch = dispatch;
          void dispatch.then(() => { if (scheduledDispatch === dispatch) scheduledDispatch = undefined; });
        }
      }
    } catch (error) {
      reportFailure("Scheduler settings poll failed", error);
    } finally {
      if (!stopped) pollTimer = setTimeout(runPoll, pollMs);
    }
  };

  const runPoll = (): void => {
    const current = poll();
    settingsPoll = current;
    void current.then(
      () => { if (settingsPoll === current) settingsPoll = undefined; },
      () => { if (settingsPoll === current) settingsPoll = undefined; },
    );
  };

  runPoll();

  return {
    stop() {
      stopped = true;
      revision += 1;
      clearScheduleTimer();
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      pollTimer = undefined;
    },
    async waitForIdle() {
      await Promise.all([scheduledDispatch, settingsPoll]);
    },
  };
}
