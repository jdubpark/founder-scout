import { describe, expect, it } from "vitest";
import {
  createLinkedInSessionPool,
  huntProxyFromEnv,
  linkedInSessionPoolFor,
  linkedinAccountsFromEnv,
  personaFor,
  type AccountPersona,
  type LinkedInAccount,
} from "./sessions";

const account = (cookie: string): LinkedInAccount => ({ cookie, proxyUrl: null, userAgent: null });

/** A cookie whose persona passes the check, so tests do not depend on one lucky hash. */
function cookieWith(want: (persona: AccountPersona) => boolean): string {
  for (let index = 0; index < 500; index += 1) {
    const cookie = `li_at=find-${index}`;
    if (want(personaFor(cookie))) return cookie;
  }
  throw new Error("No cookie with that persona was found.");
}

/**
 * 2026-11-10 is a Tuesday; 2026-11-14 is the Saturday after it. A schedule time is written as
 * `new Date(2026, 10, day, 0, minuteOfTheDay)`: the constructor carries minutes past an hour
 * over into the hours, so any minute of the day can be passed in one number.
 */
const at = (day: number, hour: number, minute: number): number => new Date(2026, 10, day, hour, minute).getTime();
const MINUTE = 60_000;

describe("linkedinAccountsFromEnv", () => {
  it("aligns proxies and user agents to cookies by index and leaves missing entries null", () => {
    const accounts = linkedinAccountsFromEnv({
      LINKEDIN_COOKIES: " li_at=one \n\nli_at=two\nli_at=three",
      LINKEDIN_PROXIES: "http://proxy-one.test:8080\nhttp://proxy-two.test:8080",
      LINKEDIN_USER_AGENTS: "agent-one/1.0",
    });
    expect(accounts).toEqual([
      { cookie: "li_at=one", proxyUrl: "http://proxy-one.test:8080", userAgent: "agent-one/1.0" },
      { cookie: "li_at=two", proxyUrl: "http://proxy-two.test:8080", userAgent: null },
      { cookie: "li_at=three", proxyUrl: null, userAgent: null },
    ]);
  });

  it("treats empty variables as no accounts or no proxy", () => {
    expect(linkedinAccountsFromEnv({ LINKEDIN_COOKIES: "  \n", LINKEDIN_PROXIES: "", LINKEDIN_USER_AGENTS: "" })).toEqual([]);
    expect(huntProxyFromEnv({ HUNT_PROXY_URL: "  " })).toBeNull();
    expect(huntProxyFromEnv({ HUNT_PROXY_URL: " http://hunt-proxy.test:8080 " })).toBe("http://hunt-proxy.test:8080");
  });
});

describe("personaFor", () => {
  it("draws the same persona for the same cookie, and every field stays in its range", () => {
    expect(personaFor("li_at=same")).toEqual(personaFor("li_at=same"));
    for (const cookie of ["li_at=a", "li_at=b", "li_at=c"]) {
      const persona = personaFor(cookie);
      expect(persona.workdayStartMinute).toBeGreaterThanOrEqual(480);
      expect(persona.workdayStartMinute).toBeLessThanOrEqual(600);
      expect(persona.workdayMinutes).toBeGreaterThanOrEqual(480);
      expect(persona.workdayMinutes).toBeLessThanOrEqual(600);
      expect(persona.lunchStartMinute).toBeGreaterThanOrEqual(705);
      expect(persona.lunchStartMinute).toBeLessThanOrEqual(810);
      expect(persona.lunchMinutes).toBeGreaterThanOrEqual(30);
      expect(persona.lunchMinutes).toBeLessThanOrEqual(60);
      expect([0, 0.15, 0.3]).toContain(persona.weekendFactor);
      expect(persona.weekdayReadCap).toBeGreaterThanOrEqual(60);
      expect(persona.weekdayReadCap).toBeLessThanOrEqual(100);
      expect(persona.burstReads).toBeGreaterThanOrEqual(8);
      expect(persona.burstReads).toBeLessThanOrEqual(25);
      expect(persona.burstMinutes).toBeGreaterThanOrEqual(10);
      expect(persona.burstMinutes).toBeLessThanOrEqual(30);
    }
  });
});

describe("createLinkedInSessionPool", () => {
  it("picks inside the workday, and holds the account back before it, at lunch and after it", () => {
    const cookie = cookieWith((persona) => persona.workdayStartMinute <= 540);
    const persona = personaFor(cookie);
    let now = at(10, 6, 30);
    const pool = createLinkedInSessionPool([account(cookie)], () => now);
    expect(pool.pick()).toBeNull();
    expect(pool.restingDetail()).toMatch(/pause until \d{2}:\d{2}\.?$/);
    now = new Date(2026, 10, 10, 0, persona.workdayStartMinute + 1).getTime();
    expect(pool.pick()).toMatchObject({ index: 0, account: { cookie } });
    now = new Date(2026, 10, 10, 0, persona.lunchStartMinute + 1).getTime();
    expect(pool.pick()).toBeNull();
    expect(pool.restingDetail()).toContain("pause");
    now = new Date(2026, 10, 10, 21, 0).getTime();
    expect(pool.pick()).toBeNull();
    expect(pool.restingDetail()).toMatch(/pause until \d{2}:\d{2} tomorrow/);
  });

  it("holds a weekend-off account back all Saturday, and reads a weekend-light one at its scaled cap", () => {
    const off = cookieWith((persona) => persona.weekendFactor === 0);
    let now = at(14, 10, 0);
    const offPool = createLinkedInSessionPool([account(off)], () => now);
    expect(offPool.pick()).toBeNull();
    expect(offPool.restingDetail()).toMatch(/pause until \d{2}:\d{2} on Monday/);

    const light = cookieWith((persona) => persona.weekendFactor > 0);
    const persona = personaFor(light);
    const lightPool = createLinkedInSessionPool([account(light)], () => now);
    const saturday = new Date(2026, 10, 14, 0, persona.workdayStartMinute + 1).getTime();
    now = saturday;
    expect(lightPool.pick()).toMatchObject({ index: 0 });
    const weekendCap = Math.floor(persona.weekdayReadCap * persona.weekendFactor);
    for (let read = 0; read < weekendCap; read += 1) {
      lightPool.noteRead(0);
      now += 1000;
    }
    // Past any burst break, still inside the workday and before lunch.
    now += 16 * MINUTE;
    expect(lightPool.pick()).toBeNull();
  });

  it("holds the account back once its read cap for the day is reached, and a new day starts a new budget", () => {
    const cookie = cookieWith(() => true);
    const persona = personaFor(cookie);
    let now = new Date(2026, 10, 10, 0, persona.workdayStartMinute + 1).getTime();
    const pool = createLinkedInSessionPool([account(cookie)], () => now);
    for (let read = 0; read < persona.weekdayReadCap; read += 1) {
      pool.noteRead(0);
      now += 1000;
    }
    // Past any burst break, still inside the workday and before lunch.
    now += 16 * MINUTE;
    expect(pool.pick()).toBeNull();
    expect(pool.restingDetail()).toMatch(/pause until \d{2}:\d{2} tomorrow/);
    now = new Date(2026, 10, 11, 0, persona.workdayStartMinute + 1).getTime();
    expect(pool.pick()).toMatchObject({ index: 0 });
  });

  it("takes a break after the persona's burst, and reads again once the break is over", () => {
    const cookie = cookieWith(() => true);
    const persona = personaFor(cookie);
    let now = new Date(2026, 10, 10, 0, persona.workdayStartMinute + 1).getTime();
    const pool = createLinkedInSessionPool([account(cookie)], () => now);
    for (let read = 0; read < persona.burstReads; read += 1) {
      pool.noteRead(0);
      now += 1000;
    }
    expect(pool.pick()).toBeNull();
    expect(pool.restingDetail()).toContain("pause");
    // The longest break is fifteen minutes.
    now += 16 * MINUTE;
    expect(pool.pick()).toMatchObject({ index: 0 });
  });

  it("rests a refused account until its next workday, and for three days on a repeat within a week", () => {
    const cookie = cookieWith((persona) => persona.weekendFactor === 0);
    const persona = personaFor(cookie);
    let now = new Date(2026, 10, 10, 0, persona.workdayStartMinute + 1).getTime();
    const pool = createLinkedInSessionPool([account(cookie)], () => now);
    pool.cool(0);
    expect(pool.pick()).toBeNull();
    expect(pool.restingDetail()).toMatch(/pause until \d{2}:\d{2} tomorrow/);
    now = new Date(2026, 10, 11, 0, persona.workdayStartMinute + 1).getTime();
    expect(pool.pick()).toMatchObject({ index: 0 });
    // A second refusal inside the week: three days of rest from now, Wednesday to Saturday.
    pool.cool(0);
    now = new Date(2026, 10, 12, 0, persona.workdayStartMinute + 1).getTime();
    expect(pool.pick()).toBeNull();
    expect(pool.restingDetail()).toMatch(/pause until \d{2}:\d{2}/);
    // Saturday is inside the three days, so the account is back on Monday at the latest.
    now = new Date(2026, 10, 16, 0, persona.workdayStartMinute + 1).getTime();
    expect(pool.pick()).toMatchObject({ index: 0 });
  });

  it("dwells between twenty and seventy-five seconds, the same for the same accounts", () => {
    const accounts = [account("li_at=dwell-one"), account("li_at=dwell-two")];
    const first = createLinkedInSessionPool(accounts, () => 0);
    const second = createLinkedInSessionPool(accounts, () => 0);
    const left = Array.from({ length: 5 }, () => first.dwellMs());
    const right = Array.from({ length: 5 }, () => second.dwellMs());
    expect(left).toEqual(right);
    for (const dwell of left) {
      expect(dwell).toBeGreaterThanOrEqual(20_000);
      expect(dwell).toBeLessThanOrEqual(75_000);
    }
  });

  it("picks each eligible account in rotation and skips one that rests", () => {
    // Two accounts with one persona between them, so both are eligible at the same times.
    const accounts = [account("li_at=same"), account("li_at=same")];
    const persona = personaFor("li_at=same");
    const now = new Date(2026, 10, 10, 0, persona.workdayStartMinute + 1).getTime();
    const pool = createLinkedInSessionPool(accounts, () => now);
    expect(pool.pick()).toMatchObject({ index: 0 });
    expect(pool.pick()).toMatchObject({ index: 1 });
    pool.cool(0);
    expect(pool.restingDetail()).toBeNull();
    expect(pool.pick()).toMatchObject({ index: 1 });
  });

  it("picks nothing and rests nothing when there are no accounts", () => {
    const pool = createLinkedInSessionPool([], () => at(10, 9, 0));
    expect(pool.pick()).toBeNull();
    expect(pool.restingDetail()).toBeNull();
  });

  it("shares one pool for the same accounts, and gives a test clock its own", () => {
    const accounts = [account("li_at=shared-rhythm")];
    expect(linkedInSessionPoolFor(accounts)).toBe(linkedInSessionPoolFor(accounts));
    expect(linkedInSessionPoolFor(accounts, () => at(10, 9, 0))).not.toBe(linkedInSessionPoolFor(accounts, () => at(10, 9, 0)));
  });
});
