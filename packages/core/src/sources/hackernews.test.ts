import { describe, expect, it } from "vitest";
import { createHackerNewsAdapter } from "./hackernews";
import { FIXED_NOW_MS, jsonResponse, readJsonFixture, request, scriptedFetch, textResponse } from "./test-support";

interface HnFixture {
  hits: Array<Record<string, unknown>>;
}

const showHits = readJsonFixture<HnFixture>("hn-show.json").hits;
const launchHits = readJsonFixture<HnFixture>("hn-launch.json").hits;

/** Serves the fixtures by tag. The adapter must do the window filtering itself, so the fake ignores numericFilters. */
function hnRoute(extra: Array<Record<string, unknown>> = []) {
  return (url: URL) => {
    const tag = url.searchParams.get("tags");
    if (tag === "show_hn") return jsonResponse({ hits: [...showHits, ...extra] });
    if (tag === "launch_hn") return jsonResponse({ hits: launchHits });
    return textResponse("unexpected tag", { status: 400 });
  };
}

const WINDOW_START_SEC = Math.floor((FIXED_NOW_MS - 36 * 60 * 60 * 1000) / 1000);

describe("hackernews adapter", () => {
  it("reports itself configured without a network call", async () => {
    const recorder = scriptedFetch(() => {
      throw new Error("status must not call the network");
    });
    const status = await createHackerNewsAdapter({ fetch: recorder.fetch }).status();
    expect(status.configured).toBe(true);
    expect(recorder.urls).toHaveLength(0);
  });

  it("maps Show HN and Launch HN payloads to raw items, newest first", async () => {
    const recorder = scriptedFetch(hnRoute());
    const adapter = createHackerNewsAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS });
    const result = await adapter.fetch(request({ limit: 10 }));

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
  });

  it("decodes entities and strips HTML from the post text", async () => {
    const adapter = createHackerNewsAdapter({ fetch: scriptedFetch(hnRoute()).fetch, now: () => FIXED_NOW_MS });
    const result = await adapter.fetch(request({ limit: 10 }));
    const withText = result.items.find((item) => item.title.includes("Real-time inventory"));
    expect(withText?.text).toContain("We're building a real-time inventory");
    expect(withText?.text).not.toContain("&#x27;");
  });

  it("returns at most req.limit items", async () => {
    const adapter = createHackerNewsAdapter({ fetch: scriptedFetch(hnRoute()).fetch, now: () => FIXED_NOW_MS });
    const result = await adapter.fetch(request({ limit: 2 }));
    expect(result.items.map((item) => item.ref)).toEqual([
      "https://news.ycombinator.com/item?id=50478329",
      "https://news.ycombinator.com/item?id=50478114",
    ]);
  });

  it("returns nothing for a limit of zero and makes no request", async () => {
    const recorder = scriptedFetch(hnRoute());
    const result = await createHackerNewsAdapter({ fetch: recorder.fetch }).fetch(request({ limit: 0 }));
    expect(result).toEqual({ items: [], cursor: null });
    expect(recorder.urls).toHaveLength(0);
  });

  it("applies the default 36 hour window when there is no cursor and no since", async () => {
    const recorder = scriptedFetch(hnRoute());
    const adapter = createHackerNewsAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS });
    const result = await adapter.fetch(request({ limit: 10 }));

    for (const url of recorder.urls) {
      expect(new URL(url).searchParams.get("numericFilters")).toBe(`created_at_i>=${WINDOW_START_SEC}`);
    }
    // The 2026-11-05 Rivet launch is outside the window even though the fake returned it.
    expect(result.items.some((item) => item.title.startsWith("Launch HN: Rivet"))).toBe(false);
  });

  it("uses req.since in the query when given", async () => {
    const recorder = scriptedFetch(hnRoute());
    const adapter = createHackerNewsAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS });
    const since = "2026-11-05T00:00:00Z";
    const result = await adapter.fetch(request({ since, limit: 10 }));

    const expectedSec = Math.floor(Date.parse(since) / 1000);
    expect(new URL(recorder.urls[0] ?? "").searchParams.get("numericFilters")).toBe(`created_at_i>=${expectedSec}`);
    expect(result.items.some((item) => item.title.startsWith("Launch HN: Rivet"))).toBe(true);
  });

  it("adds the beat as a search query, with quotes removed", async () => {
    const recorder = scriptedFetch(hnRoute());
    const adapter = createHackerNewsAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS });
    await adapter.fetch(request({ beat: 'open "agent" tools' }));

    for (const url of recorder.urls) {
      expect(new URL(url).searchParams.get("query")).toBe("open agent tools");
    }
  });

  it("returns nothing new on a second call with the cursor from the first", async () => {
    const adapter = createHackerNewsAdapter({ fetch: scriptedFetch(hnRoute()).fetch, now: () => FIXED_NOW_MS });
    const first = await adapter.fetch(request({ limit: 10 }));
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.cursor).toEqual({ after: Number(showHits[0]?.created_at_i) * 1000, ids: ["50478329"] });

    const second = await createHackerNewsAdapter({
      fetch: scriptedFetch(hnRoute()).fetch,
      now: () => FIXED_NOW_MS,
    }).fetch(request({ limit: 10, cursor: first.cursor }));
    expect(second.items).toEqual([]);
  });

  it("returns only the newer item when one arrives between calls", async () => {
    const newer = { ...showHits[0], objectID: "50479000", created_at_i: 1794550000, created_at: "2026-11-13T06:00:00Z", title: "Show HN: Newer" };
    const first = await createHackerNewsAdapter({ fetch: scriptedFetch(hnRoute()).fetch, now: () => FIXED_NOW_MS }).fetch(
      request({ limit: 10 }),
    );
    const second = await createHackerNewsAdapter({
      fetch: scriptedFetch(hnRoute([newer])).fetch,
      now: () => FIXED_NOW_MS,
    }).fetch(request({ limit: 10, cursor: first.cursor }));
    expect(second.items.map((item) => item.title)).toEqual(["Show HN: Newer"]);
  });

  it("treats a malformed cursor as no cursor", async () => {
    const recorder = scriptedFetch(hnRoute());
    const adapter = createHackerNewsAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS });
    const result = await adapter.fetch(request({ cursor: { after: "yesterday", ids: 7 } }));
    expect(result.items.length).toBe(4);
    expect(new URL(recorder.urls[0] ?? "").searchParams.get("numericFilters")).toBe(`created_at_i>=${WINDOW_START_SEC}`);
  });

  it("throws a rate-limit error that says when to retry", async () => {
    const adapter = createHackerNewsAdapter({
      fetch: scriptedFetch(() => textResponse("slow down", { status: 429, headers: { "retry-after": "120" } })).fetch,
      now: () => FIXED_NOW_MS,
    });
    const error = await adapter.fetch(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Hacker News is rate limited");
    expect((error as Error).message).toContain("2026-11-13T05:02:00.000Z");
  });

  it("throws on other HTTP failures, naming the source and status", async () => {
    const adapter = createHackerNewsAdapter({ fetch: scriptedFetch(() => textResponse("boom", { status: 500 })).fetch });
    await expect(adapter.fetch(request())).rejects.toThrow("Hacker News request failed with HTTP 500.");
  });

  it("throws on a body that is not JSON instead of returning partial data", async () => {
    const adapter = createHackerNewsAdapter({ fetch: scriptedFetch(() => textResponse("<html>")).fetch });
    await expect(adapter.fetch(request())).rejects.toThrow("not valid JSON");
  });

  it("throws on JSON without a hits array", async () => {
    const adapter = createHackerNewsAdapter({ fetch: scriptedFetch(() => jsonResponse({ error: "x" })).fetch });
    await expect(adapter.fetch(request())).rejects.toThrow("unexpected response");
  });

  it("honours the caller's abort signal", async () => {
    const controller = new AbortController();
    const hanging = scriptedFetch(
      () =>
        new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const adapter = createHackerNewsAdapter({ fetch: hanging.fetch });
    const pending = adapter.fetch(request({ signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });
});
