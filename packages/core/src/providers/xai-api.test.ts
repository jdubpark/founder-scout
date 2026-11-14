import { describe, expect, it } from "vitest";
import { SearchOutputSchema, type SearchOutput } from "@agentswarm/shared";
import type { ProviderRequest } from "../contracts";
import { createXaiProvider } from "./xai-api";

interface RecordedCall {
  input: Parameters<typeof fetch>[0];
  init?: RequestInit;
}

function fakeFetch(script: unknown[], calls: RecordedCall[] = []): typeof fetch {
  let index = 0;
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ input, init });
    const body = script[Math.min(index, script.length - 1)];
    index += 1;
    if (body === undefined) throw new Error("no scripted response");
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

function request(overrides: Partial<ProviderRequest<SearchOutput>> = {}): ProviderRequest<SearchOutput> {
  return {
    jobId: "hunt.xsearch",
    kind: "search",
    route: { provider: "xai-api", model: "grok-4.3", effort: "max" },
    system: "SYSTEM TEXT",
    prompt: "Find the founder's launch posts.",
    schema: SearchOutputSchema,
    schemaName: "SearchOutput",
    x: {
      handles: ["founder", ...Array.from({ length: 20 }, (_, i) => `handle${i}`)],
      fromDate: "2026-11-01",
      toDate: "2026-11-13",
      media: true,
      maxFollowers: 1000,
      limit: 2,
    },
    ...overrides,
  };
}

function output(posts: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "grok-4.3",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ posts }) }] }],
    usage: { input_tokens: 100, output_tokens: 40, input_tokens_details: { cached_tokens: 10 } },
    ...overrides,
  };
}

function post(id: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: `https://x.com/founder/status/${id}`,
    handle: "@Founder",
    name: "Founder Name",
    followers: 500,
    postedAt: "2026-11-10",
    text: `Post ${id}`,
    ...fields,
  };
}

describe("xAI Responses API provider", () => {
  it("sends scoped X search settings and keeps only cited, eligible posts up to the limit", async () => {
    const calls: RecordedCall[] = [];
    const posts = [
      // xAI's own address for this post names another account than the answer does.
      post("100000000000000009"),
      post("100000000000000001"),
      post("100000000000000002", { followers: 5000 }),
      post("100000000000000003", { followers: null }),
      post("100000000000000004"),
      post("100000000000000005"),
      post("100000000000000006"),
    ];
    const response = output(posts, {
      citations: [
        "https://x.com/someone_else/status/100000000000000009",
        "https://x.com/i/status/100000000000000002",
        "https://x.com/i/status/100000000000000003",
        "https://x.com/i/status/100000000000000004",
      ],
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({ posts }),
              annotations: [
                { type: "url_citation", url: "https://x.com/i/status/100000000000000005" },
                { type: "url_citation", url: "https://x.com/i/status/100000000000000006" },
              ],
            },
          ],
        },
      ],
    });
    const provider = createXaiProvider({ env: { XAI_API_KEY: "xai-test-key", XAI_BASE_URL: "https://xai.example.test/v1/" }, fetch: fakeFetch([response], calls) });

    const result = await provider.run(request());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://xai.example.test/v1/responses");
    expect(calls[0]?.init?.headers).toEqual({ Authorization: "Bearer xai-test-key", "Content-Type": "application/json" });
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "grok-4.3",
      input: [{ role: "system", content: "SYSTEM TEXT" }, { role: "user", content: "Find the founder's launch posts." }],
      store: false,
      reasoning: { effort: "xhigh" },
      tools: [
        {
          type: "x_search",
          allowed_x_handles: ["founder", ...Array.from({ length: 19 }, (_, i) => `handle${i}`)],
          from_date: "2026-11-01",
          to_date: "2026-11-13",
          enable_image_understanding: true,
          enable_video_understanding: true,
        },
      ],
      include: ["no_inline_citations"],
      max_turns: 4,
    });
    expect(body.text).toMatchObject({ format: { type: "json_schema", name: "XSearchPosts", strict: true } });
    expect(result.output).toEqual({
      hits: [
        {
          url: "https://x.com/founder/status/100000000000000004",
          title: "Founder Name (@founder)",
          snippet: "Posted 2026-11-10. Post 100000000000000004",
        },
        {
          url: "https://x.com/founder/status/100000000000000005",
          title: "Founder Name (@founder)",
          snippet: "Posted 2026-11-10. Post 100000000000000005",
        },
      ],
    });
    expect(result.cited).toHaveLength(6);
    expect(result.trace.map((turn) => turn.role)).toEqual(["system", "user", "assistant"]);
  });

  it("refuses research and search without an X scope before fetching", async () => {
    const calls: RecordedCall[] = [];
    const provider = createXaiProvider({ env: { XAI_API_KEY: "private-key-value" }, fetch: fakeFetch([], calls) });

    const status = await provider.status();
    expect(status.configured).toBe(true);
    expect(status.detail).not.toContain("private-key-value");
    await expect(provider.run(request({ kind: "research", x: null }))).rejects.toMatchObject({ kind: "unsupported" });
    await expect(provider.run(request({ x: null }))).rejects.toMatchObject({ kind: "unsupported" });
    expect(calls).toHaveLength(0);
  });

  it("uses reported tick cost, and charges a search at its cap when xAI gives no price or the call times out", async () => {
    const calls: RecordedCall[] = [];
    const provider = createXaiProvider({
      env: { XAI_API_KEY: "xai-test-key" },
      fetch: fakeFetch(
        [
          output([], { usage: { input_tokens: 100, output_tokens: 40, input_tokens_details: { cached_tokens: 10 }, cost_in_usd_ticks: 55_000_000_000 } }),
          output([]),
        ],
        calls,
      ),
    });

    const withTicks = await provider.run(request());
    const withoutCounts = await provider.run(request({ maxBudgetUsd: 0.75 }));

    expect(withTicks.costUsd).toBe(5.5);
    expect(withTicks.usage).toMatchObject({ inputTokens: 90, outputTokens: 40, cachedInputTokens: 10 });
    expect(withoutCounts.costUsd).toBe(0.75);
    expect(calls).toHaveLength(2);

    // A search still running when time ran out may have fetched posts already.
    const hanging = createXaiProvider({
      env: { XAI_API_KEY: "xai-test-key" },
      fetch: ((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })) as typeof fetch,
    });
    await expect(hanging.run(request({ timeoutMs: 5, maxBudgetUsd: 0.5 }))).rejects.toMatchObject({ kind: "timeout", costUsd: 0.5 });
  });
});
