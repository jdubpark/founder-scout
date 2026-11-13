import { describe, expect, it } from "vitest";
import { createGitHubAdapter, buildGitHubSearchQuery, GITHUB_MIN_STARS, parseGitHubRepo } from "./github";
import { SourceRateLimitError } from "./http";
import { FIXED_NOW_MS, jsonResponse, readJsonFixture, request, scriptedFetch, textResponse } from "./test-support";

interface GhSearch {
  total_count: number;
  items: Array<Record<string, unknown>>;
}

const searchFixture = readJsonFixture<GhSearch>("github-search.json");
const TOKEN = "test-token-not-real";
const RESET_SEC = Math.floor(FIXED_NOW_MS / 1000) + 60;

function searchRoute(items: Array<Record<string, unknown>> = searchFixture.items, headers: Record<string, string> = {}) {
  return () =>
    jsonResponse(
      { total_count: items.length, incomplete_results: false, items },
      {
        headers: {
          "x-ratelimit-resource": "search",
          "x-ratelimit-limit": "10",
          "x-ratelimit-remaining": "9",
          "x-ratelimit-reset": String(RESET_SEC),
          ...headers,
        },
      },
    );
}

const SINCE_OLD = "2026-10-25T00:00:00Z";

describe("github adapter", () => {
  it("builds a creation-date, star-threshold, no-fork, no-archive query over the default window", async () => {
    const recorder = scriptedFetch(searchRoute());
    const adapter = createGitHubAdapter({ env: {}, fetch: recorder.fetch, now: () => FIXED_NOW_MS });
    await adapter.fetch(request({ limit: 5 }));

    const url = new URL(recorder.urls[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://api.github.com/search/repositories");
    expect(url.searchParams.get("q")).toBe(
      `created:>=2026-11-11T17:00:00+00:00 stars:>=${GITHUB_MIN_STARS} fork:false archived:false`,
    );
    expect(url.searchParams.get("sort")).toBe("stars");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("per_page")).toBe("5");
  });

  it("uses req.since as the window start when given", () => {
    expect(buildGitHubSearchQuery({ createdAfterMs: Date.parse(SINCE_OLD), beat: null })).toBe(
      `created:>=2026-10-25T00:00:00+00:00 stars:>=${GITHUB_MIN_STARS} fork:false archived:false`,
    );
  });

  it("adds the beat as a quoted search term, with quotes removed", async () => {
    const recorder = scriptedFetch(searchRoute());
    await createGitHubAdapter({ env: {}, fetch: recorder.fetch, now: () => FIXED_NOW_MS }).fetch(
      request({ beat: 'vector "database"' }),
    );
    expect(new URL(recorder.urls[0] ?? "").searchParams.get("q")).toContain('"vector database"');
  });

  it("maps search results to raw items with stars, age and stars per day", async () => {
    const adapter = createGitHubAdapter({ env: {}, fetch: scriptedFetch(searchRoute()).fetch, now: () => FIXED_NOW_MS });
    const result = await adapter.fetch(request({ since: SINCE_OLD, limit: 10 }));

    expect(result.items).toHaveLength(3);
    const first = result.items[0];
    expect(first).toMatchObject({
      ref: "https://github.com/example-org/craft-anything",
      source: "github",
      title: "example-org/craft-anything",
      author: "example-org",
      authorUrl: "https://github.com/example-org",
      publishedAt: "2026-10-31T14:50:00Z",
      simFounderId: null,
    });
    expect(first?.text).toContain("Description: Craft Anything: understand how any software works, and craft your own.");
    expect(first?.text).toContain("Topics: none");
    expect(first?.text).toContain("Primary language: Rust");
    expect(first?.text).toContain("Owner type: Organization");

    const metrics = first?.metrics ?? {};
    expect(metrics.stars).toBe(30232);
    expect(metrics.forks).toBe(6177);
    expect(metrics.ageDays).toBeGreaterThan(12);
    expect(metrics.ageDays).toBeLessThan(13);
    expect(metrics.starsPerDay).toBeCloseTo(30232 / (metrics.ageDays ?? 1), 0);
  });

  it("returns at most req.limit items", async () => {
    const adapter = createGitHubAdapter({ env: {}, fetch: scriptedFetch(searchRoute()).fetch, now: () => FIXED_NOW_MS });
    const result = await adapter.fetch(request({ since: SINCE_OLD, limit: 2 }));
    expect(result.items.map((item) => item.title)).toEqual([
      "example-org/craft-anything",
      "deepseek-ai/dsh-superagent-prototype",
    ]);
  });

  it("drops forks, archived repositories and repositories older than the window", async () => {
    const items = [
      { ...searchFixture.items[0], fork: true },
      { ...searchFixture.items[1], archived: true },
      { ...searchFixture.items[2], created_at: "2026-01-01T00:00:00Z" },
    ];
    const adapter = createGitHubAdapter({ env: {}, fetch: scriptedFetch(searchRoute(items)).fetch, now: () => FIXED_NOW_MS });
    const result = await adapter.fetch(request({ since: SINCE_OLD, limit: 10 }));
    expect(result.items).toEqual([]);
  });

  it("returns nothing new on a second call with the cursor from the first", async () => {
    const now = () => FIXED_NOW_MS;
    const first = await createGitHubAdapter({ env: {}, fetch: scriptedFetch(searchRoute()).fetch, now }).fetch(
      request({ since: SINCE_OLD, limit: 10 }),
    );
    expect(first.items).toHaveLength(3);

    const recorder = scriptedFetch(searchRoute());
    const second = await createGitHubAdapter({ env: {}, fetch: recorder.fetch, now }).fetch(
      request({ since: SINCE_OLD, limit: 10, cursor: first.cursor }),
    );
    expect(second.items).toEqual([]);
    // Asks for enough results to get past the ones already seen.
    expect(new URL(recorder.urls[0] ?? "").searchParams.get("per_page")).toBe("13");
  });

  it("treats a malformed cursor as no cursor", async () => {
    const adapter = createGitHubAdapter({ env: {}, fetch: scriptedFetch(searchRoute()).fetch, now: () => FIXED_NOW_MS });
    const result = await adapter.fetch(request({ since: SINCE_OLD, limit: 10, cursor: { seen: 4 } }));
    expect(result.items).toHaveLength(3);
  });

  it("sends the token when GITHUB_TOKEN is set, and reports it in status", async () => {
    const recorder = scriptedFetch(searchRoute());
    const adapter = createGitHubAdapter({
      env: { GITHUB_TOKEN: `  ${TOKEN}  ` },
      fetch: recorder.fetch,
      now: () => FIXED_NOW_MS,
    });
    await adapter.fetch(request({ since: SINCE_OLD }));
    expect(recorder.headers[0]?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(recorder.headers[0]?.Accept).toBe("application/vnd.github+json");
    expect(recorder.headers[0]?.["User-Agent"]).toBe("agentswarm/0.1");

    const status = await adapter.status();
    expect(status.configured).toBe(true);
    expect(status.detail).toContain("GITHUB_TOKEN is in use");
  });

  it("sends no token when GITHUB_TOKEN is absent, and says the lower limits apply", async () => {
    const recorder = scriptedFetch(searchRoute());
    const adapter = createGitHubAdapter({ env: {}, fetch: recorder.fetch, now: () => FIXED_NOW_MS });
    await adapter.fetch(request({ since: SINCE_OLD }));
    expect(recorder.headers[0]?.Authorization).toBeUndefined();

    const status = await adapter.status();
    expect(status.configured).toBe(true);
    expect(status.detail).toContain("No GITHUB_TOKEN set");
  });

  it("reports the last search quota seen in the status detail, without a network call", async () => {
    const adapter = createGitHubAdapter({ env: {}, fetch: scriptedFetch(searchRoute()).fetch, now: () => FIXED_NOW_MS });
    await adapter.fetch(request({ since: SINCE_OLD }));
    const status = await adapter.status();
    expect(status.detail).toContain("Last search response: 9 of 10 requests left");
  });

  it("throws a rate-limit error with the reset time on a rate-limited 403", async () => {
    const adapter = createGitHubAdapter({
      env: {},
      fetch: scriptedFetch(() =>
        jsonResponse(
          { message: "API rate limit exceeded" },
          { status: 403, headers: { "x-ratelimit-resource": "search", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(RESET_SEC) } },
        ),
      ).fetch,
      now: () => FIXED_NOW_MS,
    });
    const error = await adapter.fetch(request({ since: SINCE_OLD })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceRateLimitError);
    expect((error as Error).message).toContain("GitHub is rate limited");
    expect((error as Error).message).toContain(new Date(RESET_SEC * 1000).toISOString());
  });

  it("throws a rate-limit error with the Retry-After delay on a 429", async () => {
    const adapter = createGitHubAdapter({
      env: {},
      fetch: scriptedFetch(() => textResponse("slow", { status: 429, headers: { "retry-after": "30" } })).fetch,
      now: () => FIXED_NOW_MS,
    });
    await expect(adapter.fetch(request({ since: SINCE_OLD }))).rejects.toThrow(
      `GitHub is rate limited (HTTP 429). Retry after ${new Date(FIXED_NOW_MS + 30_000).toISOString()}.`,
    );
  });

  it("does not call the network while the last known search quota is exhausted", async () => {
    let calls = 0;
    const adapter = createGitHubAdapter({
      env: {},
      fetch: async () => {
        calls += 1;
        return jsonResponse(
          { total_count: 0, items: [] },
          { headers: { "x-ratelimit-resource": "search", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(RESET_SEC) } },
        );
      },
      now: () => FIXED_NOW_MS,
    });
    await adapter.fetch(request({ since: SINCE_OLD }));
    await expect(adapter.fetch(request({ since: SINCE_OLD }))).rejects.toBeInstanceOf(SourceRateLimitError);
    expect(calls).toBe(1);
  });

  it("throws on other HTTP failures, naming the source and status", async () => {
    const adapter = createGitHubAdapter({
      env: {},
      fetch: scriptedFetch(() => textResponse("Forbidden", { status: 403 })).fetch,
      now: () => FIXED_NOW_MS,
    });
    await expect(adapter.fetch(request({ since: SINCE_OLD }))).rejects.toThrow("GitHub request failed with HTTP 403.");
  });

  it("throws rather than returning a partial result when a repository is malformed", async () => {
    const broken = [{ ...searchFixture.items[0], full_name: undefined }];
    const adapter = createGitHubAdapter({ env: {}, fetch: scriptedFetch(searchRoute(broken)).fetch, now: () => FIXED_NOW_MS });
    await expect(adapter.fetch(request({ since: SINCE_OLD }))).rejects.toThrow("without full_name");
  });

  it("parses a repository's owner and optional topics", () => {
    const repo = parseGitHubRepo({
      ...searchFixture.items[0],
      topics: ["agents", 7, "rust"],
    });
    expect(repo.topics).toEqual(["agents", "rust"]);
    expect(repo.ownerLogin).toBe("example-org");
  });
});
