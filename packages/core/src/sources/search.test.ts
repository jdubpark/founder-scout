import { describe, expect, it } from "vitest";
import { createGitHubSearchEngine, createHnSearchEngine, createHuggingFaceSearchEngine } from "./search";

describe("hunt search engines", () => {
  it("maps Hacker News results, falls back to author metrics, and caps the request size", async () => {
    let requestedUrl = "";
    let requests = 0;
    const engine = createHnSearchEngine({
      fetch: async (url) => {
        requests += 1;
        requestedUrl = url;
        return Response.json({ hits: [
          {
            objectID: "101",
            title: "Launch HN: A small product",
            url: "https://product.example.com/launch",
            story_text: "<p>We built a tool for local shops and are looking for early users.</p>",
            author: "builder",
            points: 23,
          },
          { objectID: "102", title: "An early founder discussion", story_text: "", author: "another-builder", points: 9 },
        ] });
      },
    });

    await expect(engine.search("open source launch", 500)).resolves.toEqual([
      {
        url: "https://product.example.com/launch",
        title: "Launch HN: A small product",
        snippet: "We built a tool for local shops and are looking for early users.",
      },
      {
        url: "https://news.ycombinator.com/item?id=102",
        title: "An early founder discussion",
        snippet: "another-builder · 9 points",
      },
    ]);
    const params = new URL(requestedUrl).searchParams;
    expect(new URL(requestedUrl).pathname).toBe("/api/v1/search_by_date");
    expect(params.get("query")).toBe("open source launch");
    expect(params.get("tags")).toBe("story");
    expect(params.get("hitsPerPage")).toBe("100");
    await expect(engine.search("ignored", 0)).resolves.toEqual([]);
    expect(requests).toBe(1);
  });

  it("maps GitHub repositories, preserves search syntax and sends its configured headers", async () => {
    let requestedUrl = "";
    let requestHeaders = new Headers();
    const engine = createGitHubSearchEngine({
      env: { GITHUB_TOKEN: "test-token", HUNT_USER_AGENT: "fund-reader/1.0 (+https://reader.example.org)" },
      fetch: async (url, init) => {
        requestedUrl = url;
        requestHeaders = new Headers(init?.headers);
        return Response.json({ items: [{
          full_name: "acme/early-tool",
          html_url: "https://github.com/acme/early-tool",
          description: "An early customer support tool",
          stargazers_count: 456,
          created_at: "2026-01-02T03:04:05Z",
        }] });
      },
    });

    await expect(engine.search("topic:founders stars:>100", 500)).resolves.toEqual([{
      url: "https://github.com/acme/early-tool",
      title: "acme/early-tool",
      snippet: "An early customer support tool · 456 stars · Created 2026-01-02",
    }]);
    const params = new URL(requestedUrl).searchParams;
    expect(new URL(requestedUrl).pathname).toBe("/search/repositories");
    expect(params.get("q")).toBe("topic:founders stars:>100");
    expect(params.get("sort")).toBe("stars");
    expect(params.get("order")).toBe("desc");
    expect(params.get("per_page")).toBe("100");
    expect(requestHeaders.get("authorization")).toBe("Bearer test-token");
    expect(requestHeaders.get("user-agent")).toBe("fund-reader/1.0 (+https://reader.example.org)");
  });

  it("orders Hub models and demo spaces by traction then date, with a bounded page size", async () => {
    const asked: string[] = [];
    const engine = createHuggingFaceSearchEngine({
      env: {},
      fetch: async (url) => {
        asked.push(url);
        if (url.includes("/api/models")) {
          return Response.json([
            { id: "solo-builder/tiny-agent", likes: 0, downloads: 0, private: false, createdAt: "2026-11-13T09:00:00.000Z", tags: ["agent"] },
            { id: "two-person-lab/planner", likes: 4, downloads: 310, private: false, createdAt: "2026-11-10T09:00:00.000Z", tags: ["agent", "license:apache-2.0"] },
            { id: "hidden/model", likes: 9, downloads: 9, private: true, createdAt: "2026-11-12T09:00:00.000Z", tags: [] },
            { id: "not a repo id", likes: 1 },
          ]);
        }
        return Response.json([
          { id: "solo-builder/agent-demo", likes: 2, private: false, sdk: "gradio", createdAt: "2026-11-12T09:00:00.000Z", tags: ["gradio"] },
        ]);
      },
    });

    const hits = await engine.search("agent", 500);
    expect(hits.map((hit) => hit.url)).toEqual([
      "https://huggingface.co/spaces/solo-builder/agent-demo",
      "https://huggingface.co/two-person-lab/planner",
      "https://huggingface.co/solo-builder/tiny-agent",
    ]);
    expect(hits[1]).toEqual({
      url: "https://huggingface.co/two-person-lab/planner",
      title: "two-person-lab/planner",
      snippet: "Model · 4 likes · 310 downloads · Created 2026-11-10 · agent, license:apache-2.0",
    });
    expect(asked).toHaveLength(2);
    for (const rawUrl of asked) {
      const params = new URL(rawUrl).searchParams;
      expect(params.get("search")).toBe("agent");
      expect(params.get("sort")).toBe("createdAt");
      expect(params.get("direction")).toBe("-1");
      expect(params.get("limit")).toBe("100");
    }
  });

  it("ends a slow response at its deadline and discards a response above the byte ceiling", async () => {
    const dripping = () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
    }), { headers: { "content-type": "application/json" } });
    const started = Date.now();
    const slow = createHnSearchEngine({ timeoutMs: 80, fetch: async () => dripping() });
    await expect(slow.search("anything", 5)).resolves.toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);

    const oversized = new Response(
      JSON.stringify({ items: [{ full_name: "acme/too-large", html_url: "https://github.com/acme/too-large" }], pad: "x".repeat(2_100_000) }),
      { headers: { "content-type": "application/json" } },
    );
    const huge = createGitHubSearchEngine({ env: {}, fetch: async () => oversized });
    await expect(huge.search("anything", 5)).resolves.toEqual([]);
  });

  it("returns no hits for an HTTP refusal, malformed JSON or a network error", async () => {
    const failures = [
      async () => new Response("rate limited", { status: 429 }),
      async () => new Response("not JSON", { headers: { "content-type": "application/json" } }),
      async () => { throw new Error("offline"); },
    ];
    for (const fetch of failures) {
      await expect(createHnSearchEngine({ fetch }).search("anything", 5)).resolves.toEqual([]);
    }
  });

  it("keeps contracted extra engines in the live access factory", async () => {
    const extra = {
      id: "web",
      label: "General web",
      searches: "General public web pages.",
      async status() { return { configured: true, detail: "Ready." }; },
      async search() { return []; },
    };
    const { createLiveWebAccess } = await import("./index");
    const access = createLiveWebAccess({ env: { GITHUB_TOKEN: "token", HUNT_USER_AGENT: "web-reader-test/1.0" }, extraEngines: [extra] });
    expect(access.engines.map((engine) => engine.id)).toEqual(["hn", "github", "huggingface", "web"]);
    await expect(access.engines[1]!.status()).resolves.toMatchObject({ configured: true });
  });
});
