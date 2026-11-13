import { describe, expect, it, vi } from "vitest";
import { createGitHubSearchEngine, createHnSearchEngine, createHuggingFaceSearchEngine } from "./search";

describe("hunt search engines", () => {
  it("maps Hacker News stories and uses author and points when a story has no text", async () => {
    let requestedUrl = "";
    const engine = createHnSearchEngine({
      fetch: async (url) => {
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

    await expect(engine.status()).resolves.toMatchObject({ configured: true });
    await expect(engine.search("open source launch", 2)).resolves.toEqual([
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
    expect(params.get("hitsPerPage")).toBe("2");
  });

  it("maps GitHub repositories, sends the raw search syntax, and reports token status", async () => {
    let requestedUrl = "";
    let requestHeaders = new Headers();
    const engine = createGitHubSearchEngine({
      env: { GITHUB_TOKEN: "test-token" },
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

    await expect(engine.status()).resolves.toMatchObject({ configured: true });
    await expect(engine.search("topic:founders stars:>100", 5)).resolves.toEqual([{
      url: "https://github.com/acme/early-tool",
      title: "acme/early-tool",
      snippet: "An early customer support tool · 456 stars · Created 2026-01-02",
    }]);
    const params = new URL(requestedUrl).searchParams;
    expect(new URL(requestedUrl).pathname).toBe("/search/repositories");
    expect(params.get("q")).toBe("topic:founders stars:>100");
    expect(params.get("sort")).toBe("stars");
    expect(params.get("order")).toBe("desc");
    expect(requestHeaders.get("authorization")).toBe("Bearer test-token");

    // It works without a token at a lower rate, so it is usable: the hunt must not lose the
    // engine on a machine with no token.
    const bare = await createGitHubSearchEngine({ env: {} }).status();
    expect(bare.configured).toBe(true);
    expect(bare.detail).toContain("without one");
  });

  it("names itself to GitHub as the owner chose", async () => {
    let agent: string | null = null;
    const engine = createGitHubSearchEngine({
      env: { HUNT_USER_AGENT: "fund-reader/1.0 (+https://reader.example.org)" },
      fetch: async (_url, init) => {
        agent = new Headers(init?.headers).get("user-agent");
        return Response.json({ items: [] });
      },
    });
    await engine.search("anything", 3);
    expect(agent).toBe("fund-reader/1.0 (+https://reader.example.org)");
  });

  it("searches new models and demo spaces on the Hugging Face Hub, with anything people have used first", async () => {
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

    await expect(engine.status()).resolves.toMatchObject({ configured: true });
    const hits = await engine.search("agent", 3);
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
    // Newest first is asked for, from both listings.
    expect(asked).toHaveLength(2);
    for (const url of asked) {
      const params = new URL(url).searchParams;
      expect(params.get("search")).toBe("agent");
      expect(params.get("sort")).toBe("createdAt");
      expect(params.get("direction")).toBe("-1");
    }
  });

  it("gives up on an answer that never ends or is too large, and returns nothing", async () => {
    // A server that sends a byte and then goes quiet. Only the deadline ends it.
    const dripping = () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
    }), { headers: { "content-type": "application/json" } });
    const started = Date.now();
    const slow = createHnSearchEngine({ timeoutMs: 80, fetch: async () => dripping() });
    await expect(slow.search("anything", 5)).resolves.toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);

    // An answer far larger than any page of results.
    const huge = createGitHubSearchEngine({ env: {}, fetch: async () => new Response(`{"items":[],"pad":"${"x".repeat(2_100_000)}"}`, { headers: { "content-type": "application/json" } }) });
    await expect(huge.search("anything", 5)).resolves.toEqual([]);
  });

  it("returns an empty list when the Hub fails", async () => {
    const engine = createHuggingFaceSearchEngine({ fetch: async () => new Response("no", { status: 503 }) });
    await expect(engine.search("agent", 5)).resolves.toEqual([]);
  });

  it.each(["rate-limit response", "network error"]) ("returns an empty list on a %s", async (failure) => {
    const engine = createGitHubSearchEngine({
      fetch: async () => {
        if (failure === "network error") throw new Error("offline");
        return new Response("rate limited", { status: 429 });
      },
    });
    await expect(engine.search("anything", 10)).resolves.toEqual([]);
  });

  it("returns an empty list when Hacker News answers with a rate limit", async () => {
    const engine = createHnSearchEngine({ fetch: async () => new Response("rate limited", { status: 429 }) });
    await expect(engine.search("anything", 10)).resolves.toEqual([]);
  });

  it("accepts additional engines in the live access factory", async () => {
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

  it("does not perform a request when the requested limit is zero", async () => {
    const fetch = vi.fn(async () => Response.json({ hits: [] }));
    await expect(createHnSearchEngine({ fetch }).search("query", 0)).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
