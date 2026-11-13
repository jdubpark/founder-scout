import { describe, expect, it } from "vitest";
import { createCronHelper } from "./cron";

describe("createCronHelper", () => {
  const cron = createCronHelper();

  it("accepts valid five-field cron expressions and rejects other field counts", () => {
    expect(cron.isValid("0 6 * * 1-5")).toBe(true);
    expect(cron.isValid("*/15 9-17 * * 1,3,5")).toBe(true);
    expect(cron.isValid("0 6 * * * *")).toBe(false);
    expect(cron.isValid("@daily")).toBe(false);
    expect(cron.isValid("60 6 * * *")).toBe(false);
  });

  it("returns the next firing strictly after the reference in the requested timezone", () => {
    expect(cron.next("0 9 * * *", "America/Los_Angeles", new Date("2026-01-10T16:00:00.000Z")))
      .toBe("2026-01-10T17:00:00.000Z");
    expect(cron.next("0 9 * * *", "America/Los_Angeles", new Date("2026-01-10T17:00:00.000Z")))
      .toBe("2026-01-11T17:00:00.000Z");
  });

  it("returns null for an invalid expression, timezone, or reference date", () => {
    expect(cron.next("0 9 * * * *", "UTC", new Date("2026-01-10T16:00:00.000Z"))).toBeNull();
    expect(cron.next("0 9 * * *", "Mars/Olympus", new Date("2026-01-10T16:00:00.000Z"))).toBeNull();
    expect(cron.next("0 9 * * *", "UTC", new Date(Number.NaN))).toBeNull();
  });
});
