import { Cron } from "croner";
import type { CronHelper } from "@agentswarm/core";

function hasFiveFields(expression: string): boolean {
  return typeof expression === "string" && expression.trim().split(/\s+/).length === 5;
}

function canParse(expression: string, timezone?: string): boolean {
  if (!hasFiveFields(expression)) return false;
  if (timezone !== undefined) {
    if (timezone.length === 0) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return false;
    }
  }

  try {
    const cron = new Cron(expression, { paused: true, ...(timezone === undefined ? {} : { timezone }) });
    cron.stop();
    return true;
  } catch {
    return false;
  }
}

/** Creates the server's five-field cron parser and next-fire calculator. */
export function createCronHelper(): CronHelper {
  return {
    isValid(expression) {
      return canParse(expression);
    },
    next(expression, timezone, from) {
      if (!Number.isFinite(from.getTime()) || !canParse(expression, timezone)) return null;

      try {
        const cron = new Cron(expression, { paused: true, timezone });
        const next = cron.nextRun(from);
        cron.stop();
        return next?.toISOString() ?? null;
      } catch {
        return null;
      }
    },
  };
}
