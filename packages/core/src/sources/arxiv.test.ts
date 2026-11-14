import { describe, expect, it } from "vitest";
import { createArxivAdapter } from "./arxiv";
import { FIXED_NOW_MS, readFixture, request, scriptedFetch, textResponse } from "./test-support";

const feed = readFixture("arxiv-feed.xml");
const ALL_SINCE = "2026-11-01T00:00:00Z";

describe("arXiv adapter", () => {
  it("sends the startup categories in the default window and caps the API page size", async () => {
    const recorder = scriptedFetch(() => textResponse(feed));
    const adapter = createArxivAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS, sleep: async () => {} });
    await adapter.fetch(request({ limit: 150 }));

    const url = new URL(recorder.urls[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://export.arxiv.org/api/query");
    expect(url.searchParams.get("search_query")).toBe(
      "(cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.RO OR cat:cs.DC OR cat:cs.CR OR cat:cs.SE) AND submittedDate:[202611111700 TO 202611130500]",
    );
    expect(url.searchParams.get("sortBy")).toBe("submittedDate");
    expect(url.searchParams.get("sortOrder")).toBe("descending");
    expect(url.searchParams.get("max_results")).toBe("100");
    expect(recorder.headers[0]?.["User-Agent"]).toBe("agentswarm/0.1");
  });

  it("uses the requested date and beat, maps the Atom fields, and respects the caller's limit", async () => {
    const recorder = scriptedFetch(() => textResponse(feed));
    const adapter = createArxivAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS, sleep: async () => {} });
    const result = await adapter.fetch(request({ since: ALL_SINCE, beat: "robot planning", limit: 3 }));

    const query = new URL(recorder.urls[0] ?? "").searchParams.get("search_query") ?? "";
    expect(query).toContain("submittedDate:[202611010000 TO 202611130500]");
    expect(query).toContain('all:"robot planning"');
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      ref: "https://arxiv.org/abs/2611.15569v1",
      source: "arxiv",
      title: "TraceKV: Policy-Preserving Low-Rank KV Cache Compression for Reasoning Vision-Language Models",
      author: "Ada Example",
      publishedAt: "2026-11-11T14:54:19Z",
      metrics: { authors: 3 },
      simFounderId: null,
    });
    expect(result.items[0]?.text).toContain("Authors: Ada Example, Ben Sample, Chen Placeholder");
    expect(result.items[0]?.text).toContain("Categories: cs.CV, cs.AI, cs.LG");
    expect(result.items[1]).toMatchObject({
      title: "Retrieval & Routing for Multi-Agent Code Review: A Field Study",
      metrics: { authors: 1 },
    });
    expect(result.items[1]?.text).toContain('Café "quoted" text ’apostrophe.');
    expect(result.items[2]).toMatchObject({
      title: "Tool Use Benchmarks for Robot Planning",
      author: "Eli Mock",
      metrics: { authors: 2 },
    });

    const capped = await adapter.fetch(request({ since: ALL_SINCE, limit: 2 }));
    expect(capped.items).toHaveLength(2);
  });

  it("filters results to the requested window and resumes after the cursor", async () => {
    const adapter = createArxivAdapter({
      fetch: scriptedFetch(() => textResponse(feed)).fetch,
      now: () => FIXED_NOW_MS,
      sleep: async () => {},
    });
    const defaultWindow = await adapter.fetch(request({ limit: 10 }));
    expect(defaultWindow.items).toEqual([]);

    const first = await adapter.fetch(request({ since: ALL_SINCE, limit: 10 }));
    expect(first.items).toHaveLength(3);
    expect(first.cursor).toEqual({ after: Date.parse("2026-11-11T14:54:19Z"), ids: ["http://arxiv.org/abs/2611.15569"] });

    const second = await createArxivAdapter({
      fetch: scriptedFetch(() => textResponse(feed)).fetch,
      now: () => FIXED_NOW_MS,
      sleep: async () => {},
    }).fetch(request({ since: ALL_SINCE, limit: 10, cursor: first.cursor }));
    expect(second.items).toEqual([]);
  });

  it("serializes requests with the required three-second gap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const sleeps: number[] = [];
    const adapter = createArxivAdapter({
      fetch: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return textResponse(feed);
      },
      now: () => FIXED_NOW_MS,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await Promise.all([adapter.fetch(request({ since: ALL_SINCE })), adapter.fetch(request({ since: ALL_SINCE }))]);
    expect(sleeps).toEqual([3000]);
    expect(maxInFlight).toBe(1);
  });

  it.each([
    ["a non-feed body", "<html><body>Service unavailable</body></html>", /not an Atom feed/],
    ["an API error entry", '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/api/errors#incorrect_id</id><summary>incorrect id format for paper</summary></entry></feed>', /arXiv API error: incorrect id format for paper/],
  ])("rejects %s instead of returning partial results", async (_label, body, message) => {
    const adapter = createArxivAdapter({
      fetch: scriptedFetch(() => textResponse(body)).fetch,
      now: () => FIXED_NOW_MS,
      sleep: async () => {},
    });
    await expect(adapter.fetch(request({ since: ALL_SINCE }))).rejects.toThrow(message);
  });
});
