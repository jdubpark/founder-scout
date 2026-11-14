import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { SimWorld } from "../contracts";
import { createSimWebAccess } from "./index";
import { personaFor, type LinkedInAccount } from "./sessions";
import { createWebReader } from "./web";

const PUBLIC_IP = "93.184.216.34";
const longText = "A public page describes how the founders started building a useful product for small teams and what they learned from early customers. ".repeat(2);

function html(body: string, status = 200, contentType = "text/html; charset=utf-8"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

/** 2026-11-10 is a Tuesday, 09:00 local. */
const AT_WORK = new Date(2026, 10, 10, 9, 0).getTime();

/** A cookie whose persona is at work at 09:00 that Tuesday, so account reads are eligible. */
function networkCookie(label: string): string {
  for (let index = 0; index < 500; index += 1) {
    const cookie = `li_at=${label}-${index}`;
    const persona = personaFor(cookie);
    if (persona.workdayStartMinute <= 9 * 60 && persona.workdayStartMinute + persona.workdayMinutes > 9 * 60 + 30) return cookie;
  }
  throw new Error(`No cookie for ${label} is at work at the test time.`);
}

function makeReader(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  options: { resolveHost?: (hostname: string) => Promise<string[]>; now?: () => number; sleep?: (milliseconds: number) => Promise<void>; accounts?: readonly LinkedInAccount[] } = {},
) {
  return createWebReader({
    fetch,
    resolveHost: options.resolveHost ?? (async () => [PUBLIC_IP]),
    now: options.now,
    sleep: options.sleep ?? (async () => undefined),
    accounts: options.accounts,
  });
}

describe("createWebReader", () => {
  it("blocks resolved private addresses before requesting them", async () => {
    const requested: string[] = [];
    const fetch = async (url: string) => {
      requested.push(url);
      return html(longText);
    };
    const reader = createWebReader({ fetch, resolveHost: async () => ["10.2.3.4"], sleep: async () => undefined });

    await expect(reader.read("https://private.example.com/" )).resolves.toMatchObject({ status: "blocked" });
    expect(requested).toEqual([]);
  });

  it("follows a redirect onto another host and asks that host for its own robots.txt", async () => {
    const requested: string[] = [];
    const reader = makeReader(async (url) => {
      requested.push(url);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      return url === "https://start.example.com/redirect"
        ? new Response(null, { status: 302, headers: { location: "https://other.example.com/account" } })
        : html(longText);
    });
    await expect(reader.read("https://start.example.com/redirect")).resolves.toMatchObject({
      status: "ok",
      url: "https://other.example.com/account",
    });
    expect(requested).toEqual([
      "https://start.example.com/robots.txt",
      "https://start.example.com/redirect",
      "https://other.example.com/robots.txt",
      "https://other.example.com/account",
    ]);
  });

  it("refuses loopback by default without a request", async () => {
    let requested = false;
    const reader = createWebReader({ fetch: async () => { requested = true; return html(longText); } });
    await expect(reader.read("http://127.0.0.1:4317/")).resolves.toMatchObject({ status: "blocked" });
    expect(requested).toBe(false);
  });

  it("obeys robots.txt, caches it per origin, and applies the most specific rules with allow winning ties", async () => {
    const requested: string[] = [];
    const body = [
      "User-agent: *",
      "Disallow: /blocked",
      "Disallow: /wild/*",
      "Allow: /wild/*/end$",
      "User-agent: web-reader",
      "Allow: /",
      "Disallow: /long",
      "Allow: /long/path",
      "Disallow: /tie",
      "Allow: /tie",
    ].join("\n");
    const reader = makeReader(async (url) => {
      requested.push(url);
      if (url.endsWith("/robots.txt")) return new Response(body, { headers: { "content-type": "text/plain" } });
      return html(longText);
    });

    await expect(reader.read("https://rules.example.com/blocked")).resolves.toMatchObject({ status: "ok" });
    await expect(reader.read("https://rules.example.com/long/path")).resolves.toMatchObject({ status: "ok" });
    await expect(reader.read("https://rules.example.com/long/other")).resolves.toMatchObject({ status: "blocked" });
    await expect(reader.read("https://rules.example.com/tie")).resolves.toMatchObject({ status: "ok" });
    expect(requested.filter((url) => url.endsWith("/robots.txt"))).toHaveLength(1);
    expect(requested).toContain("https://rules.example.com/blocked");
    expect(requested).not.toContain("https://rules.example.com/long/other");
  });

  it("supports wildcard and end-anchor rules when the wildcard group is selected", async () => {
    const requested: string[] = [];
    const reader = makeReader(async (url) => {
      requested.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /wild/*\nAllow: /wild/*/end$", { headers: { "content-type": "text/plain" } });
      return html(longText);
    });
    await expect(reader.read("https://wild.example.com/wild/a/end")).resolves.toMatchObject({ status: "ok" });
    await expect(reader.read("https://wild.example.com/wild/a/end/more")).resolves.toMatchObject({ status: "blocked" });
    expect(requested).toContain("https://wild.example.com/wild/a/end");
    expect(requested).not.toContain("https://wild.example.com/wild/a/end/more");
  });

  it("matches robots paths case-sensitively and encodes non-ASCII rule paths", async () => {
    const requested: string[] = [];
    const reader = makeReader(async (url) => {
      requested.push(url);
      return url.endsWith("/robots.txt")
        ? new Response("User-agent: web-reader\nDisallow: /Case\nDisallow: /café", { headers: { "content-type": "text/plain" } })
        : html(longText);
    });
    await expect(reader.read("https://octets.example.com/Case")).resolves.toMatchObject({ status: "blocked" });
    await expect(reader.read("https://octets.example.com/case")).resolves.toMatchObject({ status: "ok" });
    await expect(reader.read("https://octets.example.com/caf%C3%A9")).resolves.toMatchObject({ status: "blocked" });
    expect(requested).not.toContain("https://octets.example.com/Case");
    expect(requested).not.toContain("https://octets.example.com/caf%C3%A9");
  });

  it("is not slowed by a robots rule built to make matching explode", async () => {
    // Twenty-five stars in a row of letters, then a letter the path does not end in. As a
    // regular expression this takes longer than the age of the server; by hand it is instant.
    const hostile = `/${"*a".repeat(25)}b`;
    const reader = makeReader(async (url) => {
      if (url.endsWith("/robots.txt")) return new Response(`User-agent: *\nDisallow: ${hostile}\n`, { status: 200, headers: { "content-type": "text/plain" } });
      return html(`<html><body><p>${longText}</p></body></html>`);
    });
    const started = Date.now();
    const result = await reader.read(`https://hostile.example.com/${"a".repeat(80)}`);
    expect(Date.now() - started).toBeLessThan(1_000);
    // The rule ends in "b" and the path does not contain one, so the page may be read.
    expect(result.status).toBe("ok");
  });

  it("refuses a whole site whose robots.txt has a rule it will not work on, instead of ignoring the rule", async () => {
    const reader = makeReader(async (url) => {
      if (url.endsWith("/robots.txt")) {
        const host = new URL(url).hostname;
        const body = host.startsWith("long.")
          // A refusal of /private dressed up to be too long to keep.
          ? `User-agent: *\nDisallow: /private${"*".repeat(2_001)}\n`
          : host.startsWith("many.")
            // A refusal of /private placed after more rules than are kept.
            ? `User-agent: *\n${Array.from({ length: 5_000 }, (_, index) => `Allow: /ok/${index}`).join("\n")}\nDisallow: /private\n`
            : "User-agent: *\nDisallow: /private\n";
        return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
      }
      return html(`<html><body><p>${longText}</p></body></html>`);
    });
    for (const host of ["long.example.com", "many.example.com"]) {
      const refused = await reader.read(`https://${host}/private`);
      expect(refused.status, host).toBe("blocked");
      expect(refused.detail, host).toContain("too long or too many");
      // Nothing on such a site is read, because what was left out is not known.
      expect((await reader.read(`https://${host}/public`)).status, host).toBe("blocked");
    }
    expect((await reader.read("https://plain.example.com/public")).status).toBe("ok");
  });

  it("matches star and end rules by hand the way a pattern would", async () => {
    const robots = ["User-agent: *", "Disallow: /*.pdf$", "Disallow: /a*b*c", "Disallow: /exact$", "Allow: /a/public*b/keep/c"].join("\n");
    const reader = makeReader(async (url) => {
      if (url.endsWith("/robots.txt")) return new Response(robots, { status: 200, headers: { "content-type": "text/plain" } });
      return html(`<html><body><p>${longText}</p></body></html>`);
    });
    const status = async (path: string) => (await reader.read(`https://glob.example.com${path}`)).status;
    expect(await status("/files/report.pdf")).toBe("blocked");
    expect(await status("/files/report.pdf.html")).toBe("ok");
    expect(await status("/a/x/b/y/c/z")).toBe("blocked");
    expect(await status("/a/x/c/y/b")).toBe("ok");
    expect(await status("/exact")).toBe("blocked");
    expect(await status("/exact/more")).toBe("ok");
    // The longer rule wins, and it is an Allow.
    expect(await status("/a/public/b/keep/c")).toBe("ok");
  });

  it("is not walked around by an escaped letter in the path or by a bare carriage return in the file", async () => {
    const reader = makeReader(async (url) => {
      if (url.endsWith("/robots.txt")) {
        const body = new URL(url).hostname.startsWith("cr.")
          ? "User-agent: *\rDisallow: /private\rAllow: /public"
          : "User-agent: *\nDisallow: /private\nDisallow: /caf%c3%a9\n";
        return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
      }
      return html(`<html><body><p>${longText}</p></body></html>`);
    });
    // "%70" is the letter p.
    expect((await reader.read("https://enc.example.com/%70rivate/page")).status).toBe("blocked");
    expect((await reader.read("https://enc.example.com/private/page")).status).toBe("blocked");
    // The same accented letter, escaped in lower case in the file and typed plainly in the address.
    expect((await reader.read("https://enc.example.com/caf\u00e9")).status).toBe("blocked");
    expect((await reader.read("https://enc.example.com/public")).status).toBe("ok");
    // A file whose lines end in a carriage return alone.
    expect((await reader.read("https://cr.example.com/private")).status).toBe("blocked");
    expect((await reader.read("https://cr.example.com/public")).status).toBe("ok");
  });

  it("merges matching robots groups, ignores rules before user-agent, and always allows robots.txt", async () => {
    const requested: string[] = [];
    const robots = [
      "Disallow: /before-agent",
      "User-agent: WEB-READER",
      "Sitemap: https://groups.example.com/sitemap.xml",
      "User-agent: another-token",
      "Disallow: /second-group",
      "User-agent: web-reader",
      "Disallow: /first-group",
      "Disallow: /robots.txt",
      "User-agent: *",
      "Disallow: /",
    ].join("\n");
    const reader = makeReader(async (url) => {
      requested.push(url);
      return url.endsWith("/robots.txt") && requested.filter((value) => value.endsWith("/robots.txt")).length === 1
        ? new Response(robots, { headers: { "content-type": "text/plain" } })
        : url.endsWith("/robots.txt")
          ? new Response(longText, { headers: { "content-type": "text/plain" } })
          : html(longText);
    });
    await expect(reader.read("https://groups.example.com/before-agent")).resolves.toMatchObject({ status: "ok" });
    await expect(reader.read("https://groups.example.com/first-group")).resolves.toMatchObject({ status: "blocked" });
    await expect(reader.read("https://groups.example.com/second-group")).resolves.toMatchObject({ status: "blocked" });
    await expect(reader.read("https://groups.example.com/robots.txt")).resolves.toMatchObject({ status: "ok" });
    expect(requested).not.toContain("https://groups.example.com/first-group");
    expect(requested).not.toContain("https://groups.example.com/second-group");
    expect(requested).toContain("https://groups.example.com/robots.txt");
  });

  it("reads at least 500 KiB of robots rules", async () => {
    const lateRule = `#${"x".repeat(512_100)}\nUser-agent: web-reader\nDisallow: /late`;
    const requested: string[] = [];
    const reader = makeReader(async (url) => {
      requested.push(url);
      return url.endsWith("/robots.txt")
        ? new Response(lateRule, { headers: { "content-type": "text/plain" } })
        : html(longText);
    });
    await expect(reader.read("https://large-robots.example.com/late")).resolves.toMatchObject({ status: "blocked" });
    expect(requested).not.toContain("https://large-robots.example.com/late");
  });

  it("follows five robots redirects and applies the final rules to the original host", async () => {
    const requested: string[] = [];
    const reader = makeReader(async (url) => {
      requested.push(url);
      const match = /rules-(\d)\.example\.com/u.exec(url);
      if (url === "https://redirected.example.com/robots.txt") {
        return new Response(null, { status: 302, headers: { location: "https://rules-1.example.com/robots.txt" } });
      }
      if (match && Number(match[1]) < 5) {
        const next = Number(match[1]) + 1;
        return new Response(null, { status: 302, headers: { location: `https://rules-${next}.example.com/robots.txt` } });
      }
      if (match) return new Response("User-agent: web-reader\nDisallow: /page", { headers: { "content-type": "text/plain" } });
      return html(longText);
    });
    await expect(reader.read("https://redirected.example.com/page")).resolves.toMatchObject({ status: "blocked" });
    expect(requested.filter((url) => url.endsWith("/robots.txt"))).toHaveLength(6);
    expect(requested).not.toContain("https://redirected.example.com/page");
  });

  it("allows a robots 404 and blocks a robots 503", async () => {
    const requested: string[] = [];
    const reader = makeReader(async (url) => {
      requested.push(url);
      if (url.startsWith("https://not-found.example.com/robots.txt")) return new Response("missing", { status: 404 });
      if (url.startsWith("https://unavailable.example.com/robots.txt")) return new Response("unavailable", { status: 503 });
      return html(longText);
    });
    await expect(reader.read("https://not-found.example.com/page")).resolves.toMatchObject({ status: "ok" });
    await expect(reader.read("https://unavailable.example.com/page")).resolves.toMatchObject({
      status: "blocked",
      detail: "robots.txt does not allow it.",
    });
    expect(requested).not.toContain("https://unavailable.example.com/page");
  });

  it("spaces requests by the default gap and raises it for Crawl-delay", async () => {
    let now = 0;
    const starts: Array<{ url: string; at: number }> = [];
    const reader = makeReader(async (url) => {
      starts.push({ url, at: now });
      if (url.endsWith("/robots.txt")) return new Response("User-agent: web-reader\nCrawl-delay: 4", { headers: { "content-type": "text/plain" } });
      return html(longText);
    }, { now: () => now, sleep: async (ms) => { now += ms; } });

    await reader.read("https://polite.example.com/one");
    await reader.read("https://polite.example.com/two");
    const pages = starts.filter(({ url }) => !url.endsWith("/robots.txt"));
    expect(pages[1]!.at - pages[0]!.at).toBe(4_000);
    expect(starts.filter(({ url }) => url.endsWith("/robots.txt"))).toHaveLength(1);

    let defaultNow = 0;
    const defaultStarts: Array<{ url: string; at: number }> = [];
    const defaultReader = makeReader(async (url) => {
      defaultStarts.push({ url, at: defaultNow });
      return url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : html(longText);
    }, { now: () => defaultNow, sleep: async (ms) => { defaultNow += ms; } });
    await defaultReader.read("https://default-gap.example.com/one");
    await defaultReader.read("https://default-gap.example.com/two");
    const defaultPages = defaultStarts.filter(({ url }) => !url.endsWith("/robots.txt"));
    expect(defaultPages[1]!.at - defaultPages[0]!.at).toBe(2_000);

    let cappedNow = 0;
    const cappedStarts: Array<{ url: string; at: number }> = [];
    const cappedReader = makeReader(async (url) => {
      cappedStarts.push({ url, at: cappedNow });
      return url.endsWith("/robots.txt")
        ? new Response("User-agent: web-reader\nCrawl-delay: 120", { headers: { "content-type": "text/plain" } })
        : html(longText);
    }, { now: () => cappedNow, sleep: async (ms) => { cappedNow += ms; } });
    await cappedReader.read("https://capped.example.com/one");
    await cappedReader.read("https://capped.example.com/two");
    const cappedPages = cappedStarts.filter(({ url }) => !url.endsWith("/robots.txt"));
    expect(cappedPages[1]!.at - cappedPages[0]!.at).toBe(60_000);
  });

  it.each([403, 429])("classifies HTTP %i as a refusal", async (status) => {
    const reader = makeReader(async (url) => url.endsWith("/robots.txt")
      ? new Response("", { status: 404 })
      : html("", status));
    await expect(reader.read("https://status.example.com/page")).resolves.toMatchObject({ status: "blocked", detail: `The site answered HTTP ${status}.` });
  });

  it.each([429, 503])("returns a Retry-After pause for HTTP %i without retrying", async (status) => {
    const requested: string[] = [];
    const reader = makeReader(async (url) => {
      requested.push(url);
      return url.endsWith("/robots.txt")
        ? new Response("", { status: 404 })
        : new Response("", { status, headers: { "retry-after": "120" } });
    });
    await expect(reader.read("https://retry.example.com/page")).resolves.toMatchObject({
      status: "blocked",
      detail: "The site asked for a pause of 120 seconds.",
    });
    expect(requested.filter((url) => url.endsWith("/page"))).toHaveLength(1);
  });

  it("classifies server errors as unreachable and non-text content as not_text", async () => {
    const reader = makeReader(async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url.endsWith("/server-error")) return html("error", 500);
      return html("image", 200, "image/png");
    });
    await expect(reader.read("https://types.example.com/server-error")).resolves.toMatchObject({ status: "unreachable" });
    await expect(reader.read("https://types.example.com/image")).resolves.toMatchObject({ status: "not_text" });
  });

  it("sends a generic user agent without cookies, authorization, or a referer", async () => {
    const sent: Headers[] = [];
    const reader = makeReader(async (url, init) => {
      sent.push(new Headers(init?.headers));
      return url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : html(longText);
    });
    await reader.read("https://headers.example.com/page");
    const pageHeaders = sent.at(-1)!;
    expect(pageHeaders.get("user-agent")).toBe("web-reader/1.0");
    expect(pageHeaders.get("accept")).toBe("text/html, text/plain;q=0.9");
    expect(pageHeaders.has("cookie")).toBe(false);
    expect(pageHeaders.has("authorization")).toBe(false);
    expect(pageHeaders.has("referer")).toBe(false);
  });

  it("sends a supplied session cookie to professional-network pages only", async () => {
    const cookie = networkCookie("session");
    const sent: Array<{ url: string; cookie: string | null }> = [];
    const reader = makeReader(async (url, init) => {
      sent.push({ url, cookie: new Headers(init?.headers).get("cookie") });
      return url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : html(longText);
    }, { accounts: [{ cookie, proxyUrl: null, userAgent: null }], now: () => AT_WORK });

    await expect(reader.read("https://www.linkedin.com/in/founder")).resolves.toMatchObject({ status: "ok" });
    await expect(reader.read("https://ordinary.example.com/profile")).resolves.toMatchObject({ status: "ok" });
    expect(sent).toEqual([
      { url: "https://www.linkedin.com/in/founder", cookie },
      { url: "https://ordinary.example.com/robots.txt", cookie: null },
      { url: "https://ordinary.example.com/profile", cookie: null },
    ]);
  });

  it("holds a professional-network read back while every account rests, without asking the host", async () => {
    let requested = 0;
    const beforeWork = new Date(2026, 10, 10, 6, 30).getTime();
    const reader = makeReader(async () => {
      requested += 1;
      return html(longText);
    }, { accounts: [{ cookie: networkCookie("resting"), proxyUrl: null, userAgent: null }], now: () => beforeWork });

    const result = await reader.read("https://www.linkedin.com/in/founder");
    expect(result.status).toBe("blocked");
    expect(result.detail).toMatch(/pause until \d{2}:\d{2}/);
    expect(requested).toBe(0);
  });

  it("holds a shortener page back while every account rests, without asking for robots.txt", async () => {
    let requested = 0;
    const beforeWork = new Date(2026, 10, 10, 6, 30).getTime();
    const reader = makeReader(async () => {
      requested += 1;
      return html(longText);
    }, { accounts: [{ cookie: networkCookie("shortener-resting"), proxyUrl: null, userAgent: null }], now: () => beforeWork });

    const result = await reader.read("https://lnkd.in/xyz");
    expect(result.status).toBe("blocked");
    expect(result.detail).toMatch(/pause until \d{2}:\d{2}/);
    expect(requested).toBe(0);
  });

  it("reads a shortener page with the account, and its robots.txt without one", async () => {
    const cookie = networkCookie("shortener");
    const sent: Array<{ url: string; cookie: string | null }> = [];
    const reader = makeReader(async (url, init) => {
      sent.push({ url, cookie: new Headers(init?.headers).get("cookie") });
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      return html(longText);
    }, { accounts: [{ cookie, proxyUrl: null, userAgent: null }], now: () => AT_WORK });

    await expect(reader.read("https://lnkd.in/xyz")).resolves.toMatchObject({ status: "ok" });
    expect(sent).toEqual([
      { url: "https://lnkd.in/robots.txt", cookie: null },
      { url: "https://lnkd.in/xyz", cookie },
    ]);
  });

  it("dwells like a person between professional-network reads", async () => {
    let now = AT_WORK;
    const starts: number[] = [];
    const reader = makeReader(async () => {
      starts.push(now);
      return html(longText);
    }, { accounts: [{ cookie: networkCookie("dwell"), proxyUrl: null, userAgent: null }], now: () => now, sleep: async (ms) => { now += ms; } });

    await reader.read("https://www.linkedin.com/in/one");
    await reader.read("https://www.linkedin.com/in/two");
    const gap = starts[1]! - starts[0]!;
    expect(gap).toBeGreaterThanOrEqual(20_000);
    expect(gap).toBeLessThanOrEqual(75_000);
  });

  it("rests a session the professional network refuses and rotates to the next one", async () => {
    const first = networkCookie("refused-one");
    const second = networkCookie("refused-two");
    const cookies: string[] = [];
    const reader = makeReader(async (url, init) => {
      cookies.push(new Headers(init?.headers).get("cookie") ?? "");
      if (url.endsWith("/refused")) {
        // The Response constructor refuses status 999, which the network uses to throttle.
        return { status: 999, headers: new Headers() } as unknown as Response;
      }
      return html(longText);
    }, {
      accounts: [
        { cookie: first, proxyUrl: null, userAgent: null },
        { cookie: second, proxyUrl: null, userAgent: null },
      ],
      now: () => AT_WORK,
    });

    await expect(reader.read("https://www.linkedin.com/in/refused")).resolves.toMatchObject({
      status: "blocked",
      detail: "The site answered HTTP 999.",
    });
    await expect(reader.read("https://www.linkedin.com/in/next")).resolves.toMatchObject({ status: "ok" });
    expect(cookies).toEqual([first, second]);
  });

  it("sends each account's own cookie and user agent in rotation to the professional network", async () => {
    const first = networkCookie("rotate-one");
    const second = networkCookie("rotate-two");
    const sent: Array<{ url: string; cookie: string | null; agent: string | null }> = [];
    const reader = makeReader(async (url, init) => {
      const headers = new Headers(init?.headers);
      sent.push({ url, cookie: headers.get("cookie"), agent: headers.get("user-agent") });
      return url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : html(longText);
    }, {
      accounts: [
        { cookie: first, proxyUrl: "http://proxy-one.test:8080", userAgent: "agent-one/1.0" },
        { cookie: second, proxyUrl: "http://proxy-two.test:8080", userAgent: "agent-two/1.0" },
      ],
      now: () => AT_WORK,
    });

    await expect(reader.read("https://www.linkedin.com/in/first")).resolves.toMatchObject({ status: "ok" });
    await expect(reader.read("https://www.linkedin.com/in/second")).resolves.toMatchObject({ status: "ok" });
    expect(sent).toEqual([
      { url: "https://www.linkedin.com/in/first", cookie: first, agent: "agent-one/1.0" },
      { url: "https://www.linkedin.com/in/second", cookie: second, agent: "agent-two/1.0" },
    ]);
  });

  it("reports a read that lands on the login wall as blocked instead of reading the wall page", async () => {
    const reader = makeReader(async (url) => {
      if (url.endsWith("/in/founder")) return new Response(null, { status: 302, headers: { location: "https://www.linkedin.com/authwall?trk=gar" } });
      return html(longText);
    });

    await expect(reader.read("https://www.linkedin.com/in/founder")).resolves.toMatchObject({
      status: "blocked",
      detail: "The page is behind a login wall.",
    });
  });

  it("extracts a decoded title and text, resolves and cleans links, drops duplicates and numbers them", async () => {
    const reader = makeReader(async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url.endsWith("/start")) return new Response(null, { status: 302, headers: { location: "/dir/final" } });
      return html(`<html><head><title>A &amp; B</title></head><body><p>${longText}</p>
        <a href="../next?utm_source=x"> <b>Next</b> page </a><a href="https://other.example.com/item">Other</a>
        <a href="https://other.example.com/item">Duplicate</a><a href="/dir/final#self">Self</a>
        <a href="https://www.linkedin.com/in/person">Founder profile</a>
        <a href="https://devpost.com/project">Project page</a></body></html>`);
    });
    const result = await reader.read("https://links.example.com/start");
    expect(result.status).toBe("ok");
    expect(result.url).toBe("https://links.example.com/dir/final");
    expect(result.title).toBe("A & B");
    expect(result.text).toContain("public page describes");
    expect(result.links).toEqual([
      { index: 0, url: "https://links.example.com/next", text: "Next page" },
      { index: 1, url: "https://other.example.com/item", text: "Other" },
      { index: 2, url: "https://www.linkedin.com/in/person", text: "Founder profile" },
      { index: 3, url: "https://devpost.com/project", text: "Project page" },
    ]);
  });

  it("numbers the links of the page's own content before a site's menus", async () => {
    const menu = Array.from({ length: 70 }, (_, index) => `<a href="/section/${index}">Section ${index}</a>`).join("");
    const body = Array.from({ length: 6 }, (_, index) => `<a href="/project/${index}">Project ${index}</a>`).join("");
    const reader = makeReader(async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url.endsWith("/sparse")) {
        // A page that is nothing but a menu: its links are all there is, so they are kept.
        return html(`<html><body><nav>${menu}</nav><main><p>${longText}</p><a href="/only">Only</a></main></body></html>`);
      }
      return html(`<html><body><header><nav>${menu}</nav></header><main><p>${longText}</p>${body}</main>
        <aside><a href="/related">Related</a></aside><footer><a href="/terms">Terms</a></footer></body></html>`);
    });
    const page = await reader.read("https://menus.example.com/list");
    // Seventy menu links come first on the page. Without this the runner would be shown only the menu.
    expect(page.links.map((link) => link.text)).toEqual(["Project 0", "Project 1", "Project 2", "Project 3", "Project 4", "Project 5"]);
    expect(page.links[0]).toEqual({ index: 0, url: "https://menus.example.com/project/0", text: "Project 0" });

    const sparse = await reader.read("https://menus.example.com/sparse");
    expect(sparse.links.length).toBe(60);
    expect(sparse.links[0]?.text).toBe("Section 0");
  });

  it("returns the page's raw body when the caller asks for HTML, with text and links unchanged", async () => {
    const body = `<html><head><title>Raw</title></head><body><main><p>${longText}</p>
      <a href="/next">Next page</a><a href="/other">Other page</a></main></body></html>`;
    const reader = makeReader(async (url) => url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : html(body));

    const plain = await reader.read("https://raw.example.com/page");
    const asked = await reader.read("https://raw.example.com/page", { html: true });

    expect(asked.status).toBe("ok");
    expect(asked.html).toBe(body);
    expect(asked.title).toBe("Raw");
    expect(asked.text).toBe(plain.text);
    expect(asked.links).toEqual(plain.links);
  });

  it("returns no raw body when the caller does not ask for HTML", async () => {
    const reader = makeReader(async (url) => url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : html(longText));

    const result = await reader.read("https://plain.example.com/page");
    expect(result.status).toBe("ok");
    expect(result.html).toBeNull();
  });

  it("returns blocked for a page robots.txt refuses even when the caller asks for HTML", async () => {
    let requested = false;
    const reader = makeReader(async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private", { headers: { "content-type": "text/plain" } });
      requested = true;
      return html(longText);
    });

    const result = await reader.read("https://refused.example.com/private", { html: true });
    expect(result.status).toBe("blocked");
    expect(result.detail).toBe("robots.txt does not allow it.");
    expect(result.html).toBeUndefined();
    expect(requested).toBe(false);
  });

  it("stops reading an oversized body at the byte limit", async () => {
    let pulls = 0;
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("x".repeat(1_500_001)));
      },
    }, { highWaterMark: 0 });
    const reader = makeReader(async (url) => url.endsWith("/robots.txt")
      ? new Response("", { status: 404 })
      : new Response(oversized, { headers: { "content-type": "text/plain" } }));
    const result = await reader.read("https://large.example.com/page");
    expect(pulls).toBe(1);
    expect(result.text.length).toBeLessThanOrEqual(12_000);
  });

  it("renders a Hacker News item stand-in as plain text at the item's own address", async () => {
    const requested: string[] = [];
    const reader = makeReader(async (url) => {
      requested.push(url);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      return new Response(JSON.stringify({
        title: "A founder story",
        author: "founder1",
        url: "https://product.example.com/launch?utm_source=hn",
        text: `<p>${longText}</p><p>Code is at <a href="https://github.com/founder1/product">github.com/founder1/product</a></p>`,
        children: [{ text: "A top-level comment with enough detail about how the product started.", children: [{ text: "Nested comment is omitted." }] }],
      }), { headers: { "content-type": "application/json" } });
    });
    const result = await reader.read("https://news.ycombinator.com/item?id=12345678");
    expect(result).toMatchObject({ status: "ok", url: "https://news.ycombinator.com/item?id=12345678", title: "A founder story" });
    expect(result.text).toContain("Author: founder1");
    expect(result.text).toContain("top-level comment");
    expect(result.text).not.toContain("Nested comment");
    expect(requested).toContain("https://hn.algolia.com/api/v1/items/12345678");
    // The post's own link and the links its author wrote are where a runner can go next.
    expect(result.links).toEqual([
      { index: 0, url: "https://product.example.com/launch", text: "A founder story" },
      { index: 1, url: "https://github.com/founder1/product", text: "github.com/founder1/product" },
    ]);
  });

  it("can read a local server only when the explicit loopback test option is enabled", async (context) => {
    const server = createServer((request, response) => {
      if (request.url === "/robots.txt") {
        response.writeHead(404).end();
      } else {
        response.writeHead(200, { "content-type": "text/plain" }).end(longText);
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
    } catch (error) {
      await closeServer(server);
      if ((error as NodeJS.ErrnoException).code === "EPERM") context.skip();
      throw error;
    }
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Local server did not expose its port.");
    const port = address.port;
    try {
      const reader = createWebReader({
        resolveHost: async () => ["127.0.0.1"],
        allowLoopbackForTests: true,
        sleep: async () => undefined,
      });
      await expect(reader.read(`http://example.com:${port}/page`)).resolves.toMatchObject({ status: "ok" });
    } finally {
      await closeServer(server);
    }
  });

  it("returns simulated pages and an explicit missing-page result without network access", async () => {
    const fetch = vi.fn(async () => { throw new Error("simulated access must not use fetch"); });
    vi.stubGlobal("fetch", fetch);
    const fakeWorld = {
      page(url: string, day: number) {
        return url.endsWith("/known") ? { status: "ok" as const, detail: "Page read.", url, title: "Known", text: String(day), links: [] } : null;
      },
      search(engine: string, query: string, day: number, limit: number) {
        return [{ url: `https://sim.example/${engine}`, title: query, snippet: String(day) }].slice(0, limit);
      },
      engines() { return [{ id: "hn", label: "Sim HN", searches: "Simulated stories." }]; },
    } as unknown as SimWorld;
    const access = createSimWebAccess(fakeWorld);
    try {
      await expect(access.reader.read("https://sim.example/missing")).resolves.toMatchObject({ status: "unreachable", detail: "No such page." });
      await expect(access.reader.read("https://sim.example/known", { simDay: 3 })).resolves.toMatchObject({ status: "ok", text: "3" });
      await expect(access.engines[0]!.search("query", 1, { simDay: 4 })).resolves.toEqual([
        { url: "https://sim.example/hn", title: "query", snippet: "4" },
      ]);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
