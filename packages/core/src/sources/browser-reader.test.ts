import { describe, expect, it } from "vitest";
import { createBrowserLinkedInReader, createRoutingWebReader, type BrowserConnection, type BrowserPage } from "./browser-reader";
import { OctoProfileAlreadyStarted, type OctoLocalClient } from "./octo";
import { personaFor, type LinkedInAccount } from "./sessions";
import type { PageRead, WebReader } from "../contracts";

/** 2026-11-10 is a Tuesday, 09:00 local. */
const AT_WORK = new Date(2026, 10, 10, 9, 0).getTime();

function networkCookie(label: string): string {
  for (let index = 0; index < 500; index += 1) {
    const cookie = `li_at=${label}-${index}`;
    const persona = personaFor(cookie);
    if (persona.workdayStartMinute <= 9 * 60 && persona.workdayStartMinute + persona.workdayMinutes > 9 * 60 + 30) return cookie;
  }
  throw new Error(`No cookie for ${label} is at work at the test time.`);
}

const profileHtml = `<html><head><title>A Founder</title></head><body><main>
  <p>A public page describes how the founders started building a useful product for small teams and what they learned from early customers over several years of work.</p>
  <a href="/in/other">Other founder</a><a href="https://example.com/item">Outside</a>
</main></body></html>`;

interface ScriptedPage {
  page: BrowserPage;
  scrolledBy: number[];
}

/** A page whose visible text length is fixed, so the reader's own stops decide. */
function scriptedPage(html: string, options: { finalUrl?: string; textLength?: number } = {}): ScriptedPage {
  const scrolledBy: number[] = [];
  const textLength = options.textLength ?? 5_000;
  return {
    scrolledBy,
    page: {
      async goto() { /* the page opens */ },
      url: () => options.finalUrl ?? "https://www.linkedin.com/in/founder",
      content: async () => html,
      async scrollBy(pixel) { scrolledBy.push(pixel); },
      async measure() { return { textLength }; },
    },
  };
}

function fakeClient(options: { failFirstStart?: boolean } = {}): OctoLocalClient & { started: string[]; stopped: string[] } {
  const started: string[] = [];
  const stopped: string[] = [];
  let startCalls = 0;
  return {
    started,
    stopped,
    async activeProfiles() { return []; },
    async startProfile(uuid) {
      startCalls += 1;
      started.push(uuid);
      if (options.failFirstStart && startCalls === 1) throw new OctoProfileAlreadyStarted(uuid);
      return { uuid, wsEndpoint: `ws://octo.test/${uuid}` };
    },
    async stopProfile(uuid) { stopped.push(uuid); },
  };
}

function fakeConnect(pages: Map<string, ScriptedPage>): { connect: (wsEndpoint: string) => Promise<BrowserConnection>; cookies: Array<Array<{ name: string; value: string; domain: string; path: string; secure: boolean }>> } {
  const cookies: Array<Array<{ name: string; value: string; domain: string; path: string; secure: boolean }>> = [];
  return {
    cookies,
    connect: async (wsEndpoint) => ({
      async newPage() {
        const scripted = pages.get(wsEndpoint);
        if (!scripted) throw new Error(`No page scripted for ${wsEndpoint}`);
        return scripted.page;
      },
      async seedCookies(seeded) { cookies.push(seeded.map((cookie) => ({ ...cookie }))); },
      async close() { /* disconnect only */ },
    }),
  };
}

function reader(
  accounts: readonly LinkedInAccount[],
  options: { pages?: Map<string, ScriptedPage>; client?: OctoLocalClient & { started: string[]; stopped: string[] }; now?: () => number } = {},
) {
  const client = options.client ?? fakeClient();
  const pages = options.pages ?? new Map<string, ScriptedPage>([["ws://octo.test/profile-1", scriptedPage(profileHtml)]]);
  const wired = fakeConnect(pages);
  return {
    client,
    cookies: wired.cookies,
    reader: createBrowserLinkedInReader({
      accounts,
      profileUuids: accounts.map((_account, index) => `profile-${index + 1}`),
      client,
      connect: wired.connect,
      now: options.now ?? (() => AT_WORK),
      sleep: async () => undefined,
      random: () => 0.5,
    }),
  };
}

const account = (cookie: string): LinkedInAccount => ({ cookie, proxyUrl: null, userAgent: null });

/** A multi-cookie account whose persona is at work at 09:00 that Tuesday. */
function networkAccount(label: string): LinkedInAccount {
  for (let index = 0; index < 500; index += 1) {
    const cookie = `li_at=${label}-${index}; bcookie=crumb-${index}; JSESSIONID="ajax:${index}"`;
    const persona = personaFor(cookie);
    if (persona.workdayStartMinute <= 9 * 60 && persona.workdayStartMinute + persona.workdayMinutes > 9 * 60 + 30) return account(cookie);
  }
  throw new Error(`No account for ${label} is at work at the test time.`);
}

describe("createBrowserLinkedInReader", () => {
  it("starts the profile, seeds the session cookie, scrolls like a reader and returns the page", async () => {
    const scripted = scriptedPage(profileHtml, { textLength: 100 });
    const built = reader([account(networkCookie("browser"))], { pages: new Map([["ws://octo.test/profile-1", scripted]]) });

    const result = await built.reader.read("https://www.linkedin.com/in/founder");
    expect(result).toMatchObject({ status: "ok", url: "https://www.linkedin.com/in/founder", title: "A Founder" });
    expect(result.text).toContain("founders started building");
    expect(result.links).toEqual([
      { index: 0, url: "https://www.linkedin.com/in/other", text: "Other founder" },
      { index: 1, url: "https://example.com/item", text: "Outside" },
    ]);
    expect(built.client.started).toEqual(["profile-1"]);
    expect(built.cookies).toEqual([[{ name: "li_at", value: expect.stringContaining("browser-"), domain: ".linkedin.com", path: "/", secure: true }]]);
    // A short page still gets the few screens a person scrolls before stopping.
    expect(scripted.scrolledBy.length).toBe(4);
    expect(scripted.scrolledBy.every((pixel) => pixel >= 300 && pixel <= 700)).toBe(true);
  });

  it("seeds every cookie in the account's header, secure, on the network's own domain", async () => {
    const one = networkAccount("browser-cookies");
    const built = reader([one]);
    await built.reader.read("https://www.linkedin.com/in/founder");
    expect(built.cookies).toEqual([[
      { name: "li_at", value: expect.stringContaining("browser-cookies-"), domain: ".linkedin.com", path: "/", secure: true },
      { name: "bcookie", value: expect.stringContaining("crumb-"), domain: ".linkedin.com", path: "/", secure: true },
      { name: "JSESSIONID", value: expect.stringContaining("ajax:"), domain: ".linkedin.com", path: "/", secure: true },
    ]]);
  });

  it("scrolls a few screens, then more only while the page keeps giving text", async () => {
    const enough = scriptedPage(profileHtml, { textLength: 20_000 });
    const stuck = scriptedPage(profileHtml, { textLength: 100 });
    const built = reader(
      [account(networkCookie("browser-scroll")), account(networkCookie("browser-stuck"))],
      { pages: new Map([["ws://octo.test/profile-1", enough], ["ws://octo.test/profile-2", stuck]]) },
    );

    await expect(built.reader.read("https://www.linkedin.com/in/founder")).resolves.toMatchObject({ status: "ok" });
    await expect(built.reader.read("https://www.linkedin.com/in/other")).resolves.toMatchObject({ status: "ok" });
    expect(enough.scrolledBy.length).toBe(3);
    expect(stuck.scrolledBy.length).toBe(4);
  });

  it("reports a cut page as truncated", async () => {
    const longHtml = `<html><head><title>Long</title></head><body><main><p>${"founders building a useful product ".repeat(60)}</p></main></body></html>`;
    const built = reader([account(networkCookie("browser-cut"))], { pages: new Map([["ws://octo.test/profile-1", scriptedPage(longHtml, { textLength: 100 })]]) });

    const result = await built.reader.read("https://www.linkedin.com/in/founder", { maxTextChars: 200 });
    expect(result.status).toBe("ok");
    expect(result.text.length).toBeLessThanOrEqual(200);
    expect(result.truncated).toBe(true);
  });

  it("holds a read back while every account rests, asking the app nothing", async () => {
    const beforeWork = new Date(2026, 10, 10, 6, 30).getTime();
    const built = reader([account(networkCookie("browser-resting"))], { now: () => beforeWork });

    const result = await built.reader.read("https://www.linkedin.com/in/founder");
    expect(result.status).toBe("blocked");
    expect(result.detail).toMatch(/pause until \d{2}:\d{2}/);
    expect(built.client.started).toEqual([]);
    expect(built.cookies).toEqual([]);
  });

  it("rests an account the network parks on a login wall and rotates to the next one", async () => {
    const first = networkCookie("wall-one");
    const second = networkCookie("wall-two");
    const pages = new Map<string, ScriptedPage>([
      ["ws://octo.test/profile-1", scriptedPage(profileHtml, { finalUrl: "https://www.linkedin.com/authwall?trk=gar" })],
      ["ws://octo.test/profile-2", scriptedPage(profileHtml)],
    ]);
    const built = reader([account(first), account(second)], { pages });

    await expect(built.reader.read("https://www.linkedin.com/in/founder")).resolves.toMatchObject({
      status: "blocked",
      detail: "The page is behind a login wall.",
    });
    await expect(built.reader.read("https://www.linkedin.com/in/other")).resolves.toMatchObject({ status: "ok" });
    expect(built.client.started).toEqual(["profile-1", "profile-2"]);
  });

  it("restarts a profile left running by an earlier process", async () => {
    const client = fakeClient({ failFirstStart: true });
    const built = reader([account(networkCookie("browser-restart"))], { client });

    await expect(built.reader.read("https://www.linkedin.com/in/founder")).resolves.toMatchObject({ status: "ok" });
    expect(client.stopped).toEqual(["profile-1"]);
    expect(client.started).toEqual(["profile-1", "profile-1"]);
  });

  it("treats an app that cannot be reached as a pause, not a dead page", async () => {
    const failing = fakeClient();
    failing.startProfile = async () => { throw new Error("The Octo Browser app could not be reached on http://localhost:58888."); };
    const built = reader([account(networkCookie("browser-down"))], { client: failing });

    const result = await built.reader.read("https://www.linkedin.com/in/founder");
    expect(result.status).toBe("blocked");
    expect(result.detail).toMatch(/asked for a pause/);
  });

  it("refuses an address outside the professional network instead of opening a browser for it", async () => {
    const built = reader([account(networkCookie("browser-guard"))]);
    await expect(built.reader.read("https://example.com/page")).resolves.toMatchObject({
      status: "unreachable",
      detail: "The browser reads only the professional network.",
    });
    expect(built.client.started).toEqual([]);
  });

  it("requires a profile UUID for every account", () => {
    expect(() => createBrowserLinkedInReader({ accounts: [account("li_at=one"), account("li_at=two")], profileUuids: ["profile-1"], sleep: async () => undefined, random: () => 0.5, now: () => AT_WORK }))
      .toThrow("OCTO_PROFILE_UUIDS");
  });
});

describe("createRoutingWebReader", () => {
  it("sends professional-network reads to the browser and every other read to the fallback", async () => {
    const readBy: string[] = [];
    const browser: WebReader = {
      async read(url): Promise<PageRead> { readBy.push(`browser ${url}`); return { status: "ok", detail: "", url, title: "", text: "x".repeat(100), links: [] }; },
    };
    const fallback: WebReader = {
      async read(url): Promise<PageRead> { readBy.push(`fallback ${url}`); return { status: "ok", detail: "", url, title: "", text: "x".repeat(100), links: [] }; },
    };
    const routed = createRoutingWebReader(browser, fallback);
    await routed.read("https://www.linkedin.com/in/founder");
    await routed.read("https://lnkd.in/xyz");
    await routed.read("https://example.com/page");
    expect(readBy).toEqual([
      "browser https://www.linkedin.com/in/founder",
      "browser https://lnkd.in/xyz",
      "fallback https://example.com/page",
    ]);
  });
});
