import { describe, expect, it } from "vitest";
import {
  ARXIV_CATEGORIES,
  ARXIV_MIN_INTERVAL_MS,
  buildArxivQuery,
  createArxivAdapter,
  formatArxivDate,
  parseArxivFeed,
} from "./arxiv";
import { FIXED_NOW_MS, readFixture, request, scriptedFetch, textResponse } from "./test-support";

const feed = readFixture("arxiv-feed.xml");
const ALL_SINCE = "2026-11-01T00:00:00Z";

function feedRoute(body = feed) {
  return () => textResponse(body);
}

describe("arXiv Atom parser", () => {
  const entries = parseArxivFeed(feed);

  it("reads every entry, in document order", () => {
    expect(entries.map((e) => e.id)).toEqual([
      "http://arxiv.org/abs/2611.15569v1",
      "http://arxiv.org/abs/2611.14021v2",
      "http://arxiv.org/abs/2611.13310v1",
    ]);
  });

  it("reads the full author list and categories", () => {
    expect(entries[0]?.authors).toEqual(["Ada Example", "Ben Sample", "Chen Placeholder"]);
    expect(entries[0]?.categories).toEqual(["cs.CV", "cs.AI", "cs.LG"]);
    expect(entries[0]?.published).toBe("2026-11-11T14:54:19Z");
    expect(entries[0]?.pdfUrl).toBe("https://arxiv.org/pdf/2611.15569v1");
  });

  it("joins a title that spans several lines into one line", () => {
    expect(entries[1]?.title).toBe("Retrieval & Routing for Multi-Agent Code Review: A Field Study");
  });

  it("decodes named, decimal and hexadecimal entities and collapses whitespace in the abstract", () => {
    expect(entries[1]?.summary).toBe(
      'We compare <retrieval> and routing policies — measured as p < 0.05 & a 3× speedup. Café "quoted" text ’apostrophe.',
    );
  });

  it("unwraps CDATA sections", () => {
    expect(entries[2]?.title).toBe("Tool Use Benchmarks for Robot Planning");
  });

  it("keeps every author of a multi-author paper", () => {
    expect(entries[2]?.authors).toEqual(["Eli Mock", "Fox Dummy"]);
  });

  it("has no PDF link when the entry lists none", () => {
    expect(entries[1]?.pdfUrl).toBeNull();
  });

  it("throws on a body that is not an Atom feed", () => {
    expect(() => parseArxivFeed("<html><body>Service unavailable</body></html>")).toThrow("not an Atom feed");
  });

  it("throws on an arXiv error entry rather than returning it as a paper", () => {
    const errorFeed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <id>http://arxiv.org/api/errors#incorrect_id</id>
      <summary>incorrect id format for paper</summary>
    </entry></feed>`;
    expect(() => parseArxivFeed(errorFeed)).toThrow("arXiv API error: incorrect id format for paper");
  });
});

describe("arXiv query", () => {
  it("formats dates as GMT YYYYMMDDHHMM", () => {
    expect(formatArxivDate(FIXED_NOW_MS)).toBe("202611130500");
  });

  it("covers the seven startup-relevant categories", () => {
    expect([...ARXIV_CATEGORIES]).toEqual(["cs.AI", "cs.LG", "cs.CL", "cs.RO", "cs.DC", "cs.CR", "cs.SE"]);
  });

  it("builds the category and date-range query with an optional all-fields beat", () => {
    const query = buildArxivQuery({ fromMs: Date.parse(ALL_SINCE), toMs: FIXED_NOW_MS, beat: "robot planning" });
    expect(query).toBe(
      '(cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.RO OR cat:cs.DC OR cat:cs.CR OR cat:cs.SE) AND submittedDate:[202611010000 TO 202611130500] AND all:"robot planning"',
    );
  });
});

describe("arXiv adapter", () => {
  it("requests the default 36 hour window, newest first", async () => {
    const recorder = scriptedFetch(feedRoute());
    const adapter = createArxivAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS, sleep: async () => {} });
    await adapter.fetch(request({ limit: 5 }));

    const url = new URL(recorder.urls[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://export.arxiv.org/api/query");
    expect(url.searchParams.get("search_query")).toContain("submittedDate:[202611111700 TO 202611130500]");
    expect(url.searchParams.get("sortBy")).toBe("submittedDate");
    expect(url.searchParams.get("sortOrder")).toBe("descending");
    expect(url.searchParams.get("max_results")).toBe("5");
    expect(recorder.headers[0]?.["User-Agent"]).toBe("agentswarm/0.1");
  });

  it("uses req.since as the window start when given", async () => {
    const recorder = scriptedFetch(feedRoute());
    const adapter = createArxivAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS, sleep: async () => {} });
    await adapter.fetch(request({ since: "2026-11-10T00:00:00Z" }));
    expect(new URL(recorder.urls[0] ?? "").searchParams.get("search_query")).toContain(
      "submittedDate:[202611100000 TO",
    );
  });

  it("adds the beat as an all-fields term", async () => {
    const recorder = scriptedFetch(feedRoute());
    const adapter = createArxivAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS, sleep: async () => {} });
    await adapter.fetch(request({ beat: "robot planning" }));
    expect(new URL(recorder.urls[0] ?? "").searchParams.get("search_query")).toContain('all:"robot planning"');
  });

  it("maps entries to raw items with authors first in the text", async () => {
    const adapter = createArxivAdapter({
      fetch: scriptedFetch(feedRoute()).fetch,
      now: () => FIXED_NOW_MS,
      sleep: async () => {},
    });
    const result = await adapter.fetch(request({ since: ALL_SINCE, limit: 10 }));
    expect(result.items).toHaveLength(3);

    const first = result.items[0];
    expect(first).toMatchObject({
      ref: "http://arxiv.org/abs/2611.15569v1",
      source: "arxiv",
      title: "TraceKV: Policy-Preserving Low-Rank KV Cache Compression for Reasoning Vision-Language Models",
      author: "Ada Example",
      authorUrl: null,
      publishedAt: "2026-11-11T14:54:19Z",
      metrics: { authors: 3 },
      simFounderId: null,
    });
    expect(first?.text.startsWith("Authors: Ada Example, Ben Sample, Chen Placeholder\nCategories: cs.CV, cs.AI, cs.LG")).toBe(true);
    expect(first?.text).toContain("Reasoning vision-language models");

    const multi = result.items[2];
    expect(multi?.metrics).toEqual({ authors: 2 });
    expect(multi?.text).toContain("Authors: Eli Mock, Fox Dummy");
  });

  it("returns at most req.limit items", async () => {
    const adapter = createArxivAdapter({ fetch: scriptedFetch(feedRoute()).fetch, now: () => FIXED_NOW_MS, sleep: async () => {} });
    const result = await adapter.fetch(request({ since: ALL_SINCE, limit: 2 }));
    expect(result.items.map((item) => item.title)).toEqual([
      "TraceKV: Policy-Preserving Low-Rank KV Cache Compression for Reasoning Vision-Language Models",
      "Retrieval & Routing for Multi-Agent Code Review: A Field Study",
    ]);
  });

  it("drops entries published before the window, including ones the fake returned anyway", async () => {
    const adapter = createArxivAdapter({ fetch: scriptedFetch(feedRoute()).fetch, now: () => FIXED_NOW_MS, sleep: async () => {} });
    // The first entry was published 2026-11-11T14:54Z, before the 36 hour window starting 17:00Z.
    const defaultWindow = await adapter.fetch(request({ limit: 10 }));
    expect(defaultWindow.items).toEqual([]);

    const narrower = await adapter.fetch(request({ since: "2026-11-11T12:00:00Z", limit: 10 }));
    expect(narrower.items.map((item) => item.ref)).toEqual(["http://arxiv.org/abs/2611.15569v1"]);
  });

  it("returns nothing new on a second call with the cursor from the first", async () => {
    const first = await createArxivAdapter({
      fetch: scriptedFetch(feedRoute()).fetch,
      now: () => FIXED_NOW_MS,
      sleep: async () => {},
    }).fetch(request({ since: ALL_SINCE, limit: 10 }));
    expect(first.items).toHaveLength(3);
    expect(first.cursor).toEqual({ after: Date.parse("2026-11-11T14:54:19Z"), ids: ["http://arxiv.org/abs/2611.15569"] });

    const recorder = scriptedFetch(feedRoute());
    const second = await createArxivAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS, sleep: async () => {} }).fetch(
      request({ since: ALL_SINCE, limit: 10, cursor: first.cursor }),
    );
    expect(second.items).toEqual([]);
    // The query starts at the cursor's timestamp, minute precision.
    expect(new URL(recorder.urls[0] ?? "").searchParams.get("search_query")).toContain("submittedDate:[202611111454 TO");
  });

  it("treats a malformed cursor as no cursor", async () => {
    const recorder = scriptedFetch(feedRoute());
    const adapter = createArxivAdapter({ fetch: recorder.fetch, now: () => FIXED_NOW_MS, sleep: async () => {} });
    await adapter.fetch(request({ cursor: { after: "x" } }));
    expect(new URL(recorder.urls[0] ?? "").searchParams.get("search_query")).toContain("submittedDate:[202611111700 TO");
  });

  it("waits three seconds between requests, the arXiv terms of use minimum", async () => {
    const sleeps: number[] = [];
    const recorder = scriptedFetch(feedRoute());
    const adapter = createArxivAdapter({
      fetch: recorder.fetch,
      now: () => FIXED_NOW_MS,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await adapter.fetch(request({ since: ALL_SINCE }));
    await adapter.fetch(request({ since: ALL_SINCE }));
    expect(ARXIV_MIN_INTERVAL_MS).toBe(3000);
    expect(sleeps).toEqual([3000]);
  });

  it("keeps one request in flight at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const adapter = createArxivAdapter({
      fetch: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return textResponse(feed);
      },
      now: () => FIXED_NOW_MS,
      sleep: async () => {},
    });
    await Promise.all([adapter.fetch(request({ since: ALL_SINCE })), adapter.fetch(request({ since: ALL_SINCE }))]);
    expect(maxInFlight).toBe(1);
  });

  it("throws on other HTTP failures, naming the source and status", async () => {
    const adapter = createArxivAdapter({
      fetch: scriptedFetch(() => textResponse("down", { status: 503 })).fetch,
      now: () => FIXED_NOW_MS,
      sleep: async () => {},
    });
    await expect(adapter.fetch(request())).rejects.toThrow("arXiv request failed with HTTP 503.");
  });

  it("throws a rate-limit error on HTTP 429", async () => {
    const adapter = createArxivAdapter({
      fetch: scriptedFetch(() => textResponse("slow", { status: 429 })).fetch,
      now: () => FIXED_NOW_MS,
      sleep: async () => {},
    });
    await expect(adapter.fetch(request())).rejects.toThrow("arXiv is rate limited");
  });

  it("reports itself configured and states the request rate in status, without a network call", async () => {
    const recorder = scriptedFetch(feedRoute());
    const status = await createArxivAdapter({ fetch: recorder.fetch }).status();
    expect(status.configured).toBe(true);
    expect(status.detail).toContain("One request every three seconds");
    expect(recorder.urls).toHaveLength(0);
  });
});
