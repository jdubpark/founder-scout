import { describe, expect, it } from "vitest";
import { createAcceleratorEngine } from "./accelerators";

const NOW = Date.parse("2026-11-13T00:00:00.000Z");

function nextData(companies: unknown[]): string {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { companies: { results: companies } } },
  })}</script></html>`;
}

function ycCompany(name: string, website: string, oneLiner: string, batch: string) {
  return {
    name,
    slug: name.toLowerCase().replace(/\s+/gu, "-"),
    website,
    one_liner: oneLiner,
    long_description: "A platform for early teams.",
    batch,
    industry: "Technology",
    tags: ["Founder tools"],
    team_size: 2,
    launched_at: Math.floor(NOW / 1000),
    status: "Active",
  };
}

const noRobots = () => new Response("", { status: 404 });
const noWait = async () => undefined;

describe("accelerator search engine", () => {
  it("ranks public company sites across all four programmes, keeps newest listings first, and caches them", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      if (url.endsWith("/robots.txt")) return noRobots();
      if (url === "https://yc-oss.github.io/api/meta.json") {
        return Response.json({ batches: [
          { name: "Winter 2027", count: 6, api: "https://yc-oss.github.io/api/batches/winter-2027.json" },
          { name: "Fall 2026", count: 8, api: "https://yc-oss.github.io/api/batches/fall-2026.json" },
          { name: "Summer 2027", count: 1, api: "https://yc-oss.github.io/api/batches/summer-2027.json" },
          { name: "unspecified", count: 90, api: "https://www.ycombinator.com/companies" },
        ] });
      }
      if (url === "https://yc-oss.github.io/api/batches/winter-2027.json") {
        return Response.json([
          // The newest companies leave fields blank; one with no site of its own has nothing to read.
          { ...ycCompany("Latest YC", "https://latestyc.com", "Developer tools for teams", "Winter 2027"), team_size: null, long_description: null },
          ycCompany("Siteless YC", "", "Developer tools", "Winter 2027"),
        ]);
      }
      if (url === "https://yc-oss.github.io/api/batches/fall-2026.json") {
        return Response.json([ycCompany("Older YC", "https://olderyc.com", "AI founder tools", "Fall 2026")]);
      }
      if (url === "https://speedrun.a16z.com/companies") {
        return new Response(nextData([{
          slug: "speedrun-ai",
          name: "Speedrun AI",
          cohort: "SR007",
          preamble: "Founder workflows",
          industries: ["AI"],
        }]), { headers: { "content-type": "text/html" } });
      }
      if (url === "https://500.co/api/startups") {
        return Response.json({ res: [
          {
            organization: {
              name: "500 AI Inc.",
              companyUrl: "www.fivehundredai.com",
              positions: [{ person: { firstName: "Private", lastName: "FounderName" } }],
            },
            oneLiner: "Founder workflows",
            stage: { name: "Pre-Seed" },
            industries: [{ name: "AI" }],
            batches: [{ brandName: "SF 37" }],
            investments: [{ initialInvestDate: "2026-10-02T00:00:00.000Z" }],
          },
          {
            organization: { name: "Old placeholder", companyUrl: "https://oldplaceholder.com" },
            batches: [{ brandName: "Old" }],
            investments: [{ initialInvestDate: "1970-01-01T00:00:00.000Z" }],
          },
        ] });
      }
      if (url === "https://skydeck.berkeley.edu/wp-admin/admin-ajax.php") {
        return Response.json({ posts: [
          { title: "SkyDeck AI", url: "https://skydeckai.com", class: "Batch 21" },
          { title: "Second SkyDeck", url: "https://secondskydeck.com", class: "Batch 20" },
          { title: "Old SkyDeck", url: "https://oldskydeck.com", class: "Batch 19" },
        ] });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const engine = createAcceleratorEngine({ fetch, now: () => NOW, sleep: noWait, userAgent: "fund-reader/1.0 (+https://example.com/reader)" });

    await expect(engine.status()).resolves.toMatchObject({ configured: true });
    const [hits, concurrentHits] = await Promise.all([
      engine.search("developer", 20),
      engine.search("developer", 20),
    ]);
    expect(concurrentHits).toEqual(hits);
    expect(hits.map((hit) => hit.title)).toEqual([
      "Latest YC (Y Combinator, Winter 2027)",
      "Older YC (Y Combinator, Fall 2026)",
      "Speedrun AI (a16z speedrun, SR007)",
      "500 AI Inc. (500 Global, SF 37)",
      "SkyDeck AI (Berkeley SkyDeck, Batch 21)",
      "Second SkyDeck (Berkeley SkyDeck, Batch 20)",
    ]);
    expect(hits.map((hit) => hit.url)).toEqual([
      "https://latestyc.com/",
      "https://olderyc.com/",
      "https://speedrun.a16z.com/companies/speedrun-ai",
      "https://www.fivehundredai.com/",
      "https://skydeckai.com/",
      "https://secondskydeck.com/",
    ]);
    expect(hits.some((hit) => hit.title.includes("Siteless YC"))).toBe(false);
    expect(JSON.stringify(hits)).not.toContain("FounderName");
    expect(calls.some(({ url }) => url.includes("ycombinator.com"))).toBe(false);
    expect(calls.some(({ url }) => url.endsWith("/robots.txt"))).toBe(false);
    expect(calls).toHaveLength(6);
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get("user-agent")).toBe("fund-reader/1.0 (+https://example.com/reader)");
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("cookie")).toBe(false);
      expect(call.init?.credentials).toBe("omit");
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    }
    const skydeck = calls.find(({ url }) => url === "https://skydeck.berkeley.edu/wp-admin/admin-ajax.php");
    expect(skydeck?.init?.method).toBe("POST");
    expect(new Headers(skydeck?.init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(skydeck?.init?.body).toBe("action=company_filtration_query&meta[0][]=main_industry&meta[0][]=all&meta[1][]=classes&meta[1][]=all&meta[2][]=industry&meta[2][]=all&search=");

    await expect(engine.search("developer", 20)).resolves.toEqual(hits);
    expect(calls).toHaveLength(6);
  });

  it("requests a listing a robots.txt would refuse, spaces a host by its own gap, and names every programme when all fail", async () => {
    const requested: string[] = [];
    const waits: number[] = [];
    const partial = createAcceleratorEngine({
      now: () => NOW,
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      fetch: async (url) => {
        requested.push(url);
        if (url === "https://500.co/api/startups") return Response.json({ res: [] });
        if (url === "https://yc-oss.github.io/api/meta.json") {
          return Response.json({ batches: [{ name: "Fall 2026", count: 5, api: "https://yc-oss.github.io/api/batches/fall-2026.json" }] });
        }
        if (url === "https://yc-oss.github.io/api/batches/fall-2026.json") {
          return Response.json([ycCompany("Partial YC", "https://partialyc.com", "Early tools", "Fall 2026")]);
        }
        if (url === "https://speedrun.a16z.com/companies") return new Response(nextData([]));
        if (url === "https://skydeck.berkeley.edu/wp-admin/admin-ajax.php") return Response.json({ posts: [] });
        throw new Error(`Unexpected request: ${url}`);
      },
    });
    await expect(partial.search("early", 10)).resolves.toMatchObject([
      { title: "Partial YC (Y Combinator, Fall 2026)", url: "https://partialyc.com/" },
    ]);
    expect(requested).toContain("https://500.co/api/startups");
    expect(requested.some((url) => url.endsWith("/robots.txt"))).toBe(false);
    // The mirror's second file is the only request that follows another to the same host.
    expect(waits).toEqual([2_000]);

    const retryWaits: number[] = [];
    const unavailable = createAcceleratorEngine({
      now: () => NOW,
      sleep: async (milliseconds) => { retryWaits.push(milliseconds); },
      fetch: async () => new Response("unavailable", { status: 503 }),
    });
    await expect(unavailable.search("anything", 10)).rejects.toThrow(
      "Accelerator directory search failed for Y Combinator, a16z speedrun, 500 Global, Berkeley SkyDeck.",
    );
    // Trying again straight away still waits before asking each host a second time.
    expect(retryWaits).toEqual([]);
    await expect(unavailable.search("anything", 10)).rejects.toThrow("Accelerator directory search failed");
    expect(retryWaits).toEqual([2_000, 2_000, 2_000, 2_000]);
  });

  it("honours abort and waits for the in-flight fetch to settle before retrying", async () => {
    const controller = new AbortController();
    let started = 0;
    let overlappedHost = false;
    const activeByHost = new Map<string, number>();
    let resolveStarted: () => void = () => undefined;
    const allStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const engine = createAcceleratorEngine({
      timeoutMs: 2_000,
      sleep: noWait,
      fetch: async (url, init) => {
        started += 1;
        if (started === 4) resolveStarted();
        const host = new URL(url).hostname;
        const active = (activeByHost.get(host) ?? 0) + 1;
        if (active > 1) overlappedHost = true;
        activeByHost.set(host, active);
        const finish = () => activeByHost.set(host, (activeByHost.get(host) ?? 1) - 1);
        if (started <= 4) return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const stop = () => setTimeout(() => {
            finish();
            reject(signal?.reason ?? new Error("aborted"));
          }, 40);
          if (signal?.aborted) stop();
          else signal?.addEventListener("abort", stop, { once: true });
        });

        finish();
        if (url.endsWith("/robots.txt")) return noRobots();
        if (url === "https://yc-oss.github.io/api/meta.json") return Response.json({ batches: [] });
        if (url === "https://speedrun.a16z.com/companies") return new Response(nextData([]));
        if (url === "https://500.co/api/startups") return Response.json({ res: [] });
        if (url === "https://skydeck.berkeley.edu/wp-admin/admin-ajax.php") return Response.json({ posts: [] });
        throw new Error(`Unexpected retry request: ${url}`);
      },
    });
    const pending = engine.search("founders", 5, { signal: controller.signal });
    await allStarted;
    controller.abort();
    await expect(pending).resolves.toEqual([]);

    const retry = engine.search("founders", 5);
    expect(started).toBe(4);
    await expect(retry).resolves.toEqual([]);
    expect(started).toBe(8);
    expect(overlappedHost).toBe(false);
  });
});
