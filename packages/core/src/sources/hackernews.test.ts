import { describe, expect, it } from "vitest";
import { createHackerNewsAdapter } from "./hackernews";
import { FIXED_NOW_MS, jsonResponse, readJsonFixture, request, scriptedFetch, textResponse } from "./test-support";

interface HnFixture {
  hits: Array<Record<string, unknown>>;
}

const showHits = readJsonFixture<HnFixture>("hn-show.json").hits;
const launchHits = readJsonFixture<HnFixture>("hn-launch.json").hits;
const WINDOW_START_SEC = Math.floor((FIXED_NOW_MS - 36 * 60 * 60 * 1000) / 1000);

/** The fake ignores numericFilters so the adapter must apply its own date window. */
function hnRoute(extra: Array<Record<string, unknown>> = []) {
  return (url: URL) => {
    const tag = url.searchParams.get("tags");
    if (tag === "show_hn") return jsonResponse({ hits: [...showHits, ...extra] });
    if (tag === "launch_hn") return jsonResponse({ hits: launchHits });
    return textResponse("unexpected tag", { status: 400 });
  };
}

describe("Hacker News adapter", () => {
  it("sends bounded Show HN and Launch HN searches and maps their fields", async () => {
    const recorder = scriptedFetch(hnRoute());
    const adapter = createHackerNewsAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS });
    const result = await adapter.fetch(request({ limit: 150, beat: 'open "agent" tools' }));

    expect(recorder.urls).toHaveLength(2);
    for (const rawUrl of recorder.urls) {
      const url = new URL(rawUrl);
      expect(url.searchParams.get("numericFilters")).toBe(`created_at_i>=${WINDOW_START_SEC}`);
      expect(url.searchParams.get("query")).toBe("open agent tools");
      expect(url.searchParams.get("hitsPerPage")).toBe("100");
    }
    expect(recorder.urls.map((rawUrl) => new URL(rawUrl).searchParams.get("tags"))).toEqual(["show_hn", "launch_hn"]);
    expect(result.items.map((item) => item.ref)).toEqual([
      "https://news.ycombinator.com/item?id=50478329",
      "https://news.ycombinator.com/item?id=50478114",
      "https://news.ycombinator.com/item?id=50477993",
      "https://news.ycombinator.com/item?id=50455811",
    ]);

    const first = result.items[0];
    expect(first).toMatchObject({
      source: "hackernews",
      title: "Show HN: I built a numbers game for my kids, with no tracking in the app",
      author: "maker-one",
      authorUrl: "https://news.ycombinator.com/user?id=maker-one",
      publishedAt: "2026-11-13T04:27:40Z",
      metrics: { points: 1, comments: 0 },
      simFounderId: null,
    });
    expect(first?.text).toBe("Link: https://example.test/product");
    const launch = result.items[3];
    expect(launch?.title).toBe("Launch HN: Pomerado (YC F26) – Turn any website into an MCP for agents");
    expect(launch?.text).toContain("the link & tell us what breaks");
    expect(launch?.text).toContain("we're building");
    expect(launch?.text).not.toContain("<a");
    expect(launch?.metrics).toEqual({ points: 61, comments: 47 });
    const plainText = result.items.find((item) => item.title.includes("Real-time inventory"))?.text;
    expect(plainText).toContain("We're building a real-time inventory");
    expect(plainText).not.toContain("&#x27;");
    expect(result.items.some((item) => item.title.startsWith("Launch HN: Rivet"))).toBe(false);

    const limited = await adapter.fetch(request({ limit: 2 }));
    expect(limited.items.map((item) => item.ref)).toEqual([
      "https://news.ycombinator.com/item?id=50478329",
      "https://news.ycombinator.com/item?id=50478114",
    ]);
    const noRequest = scriptedFetch(hnRoute());
    await expect(createHackerNewsAdapter({ fetch: noRequest.fetch }).fetch(request({ limit: 0 })))
      .resolves.toMatchObject({ items: [], cursor: null });
    expect(noRequest.urls).toHaveLength(0);

    const sinceRequest = scriptedFetch(hnRoute());
    await createHackerNewsAdapter({ fetch: sinceRequest.fetch, now: () => FIXED_NOW_MS })
      .fetch(request({ since: "2026-11-12T00:00:00Z", limit: 10 }));
    expect(sinceRequest.urls.map((rawUrl) => new URL(rawUrl).searchParams.get("numericFilters")))
      .toEqual(Array(2).fill(`created_at_i>=${Math.floor(Date.parse("2026-11-12T00:00:00Z") / 1000)}`));
  });

  it("advances the cursor without replaying old items and admits a newer one", async () => {
    const first = await createHackerNewsAdapter({ fetch: scriptedFetch(hnRoute()).fetch, now: () => FIXED_NOW_MS })
      .fetch(request({ limit: 10 }));
    expect(first.items).toHaveLength(4);
    expect(first.cursor).toEqual({ after: Number(showHits[0]?.created_at_i) * 1000, ids: ["50478329"] });

    const same = await createHackerNewsAdapter({ fetch: scriptedFetch(hnRoute()).fetch, now: () => FIXED_NOW_MS })
      .fetch(request({ limit: 10, cursor: first.cursor }));
    expect(same.items).toEqual([]);

    const newer = { ...showHits[0], objectID: "50479000", created_at_i: 1794550000, created_at: "2026-11-13T06:00:00Z", title: "Show HN: Newer" };
    const next = await createHackerNewsAdapter({ fetch: scriptedFetch(hnRoute([newer])).fetch, now: () => FIXED_NOW_MS })
      .fetch(request({ limit: 10, cursor: first.cursor }));
    expect(next.items.map((item) => item.title)).toEqual(["Show HN: Newer"]);
  });

  it("rejects a response without the service's hits array", async () => {
    const adapter = createHackerNewsAdapter({ fetch: scriptedFetch(() => jsonResponse({ error: "x" })).fetch });
    await expect(adapter.fetch(request())).rejects.toThrow("unexpected response");
  });
});
