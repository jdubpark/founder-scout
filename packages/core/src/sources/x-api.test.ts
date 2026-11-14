import { describe, expect, it } from "vitest";
import { createXPostReader } from "./x-api";

const NOW = new Date("2026-11-13T12:00:00.000Z");
const missingId = "99999999999999";

describe("X API post reader", () => {
  it("maps X's response and reads more than 100 requested ids in separate authenticated requests", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const requestedIds = ["20", missingId, "21", "22", ...Array.from({ length: 97 }, (_, index) => String(index + 100))];
    const ids = ["20", "not-an-id", ...requestedIds, "20"];
    const reader = createXPostReader({
      env: { X_BEARER_TOKEN: "  test-bearer  " },
      now: () => NOW,
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (calls.length === 1) {
          return new Response(JSON.stringify({
            data: [
              {
                author_id: "12",
                created_at: "2006-03-21T20:50:14.000Z",
                id: "20",
                public_metrics: {
                  bookmark_count: 25_584,
                  impression_count: 0,
                  like_count: 325_373,
                  quote_count: 8_027,
                  reply_count: 19_252,
                  retweet_count: 126_443,
                },
                text: "just setting up my twttr",
                note_tweet: { text: "just setting up my twttr, with the complete long text" },
              },
              { author_id: "missing-author", id: "21", text: "No author expansion" },
              {
                author_id: "13",
                id: "22",
                public_metrics: { impression_count: 42, like_count: 3, reply_count: 2, retweet_count: 1 },
                text: "A post with measured views &amp; R&amp;D &lt;3",
              },
            ],
            errors: [{
              detail: "Could not find post with ids: [99999999999999].",
              parameter: "ids",
              resource_id: missingId,
              resource_type: "tweet",
              title: "Not Found Error",
              type: "https://api.x.com/2/problems/resource-not-found",
              value: missingId,
            }],
            includes: {
              users: [{
                id: "12",
                name: "jack",
                public_metrics: { followers_count: 12_468_198, following_count: 3, listed_count: 33_148, tweet_count: 31_206 },
                username: "Jack",
              }, { id: "13", name: "Ada Lovelace", public_metrics: { followers_count: 2 }, username: "ADA" }],
            },
            meta: { result_count: 2 },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [], errors: [] }), { status: 200 });
      },
    });

    const result = await reader.read(ids);

    expect(result.posts.get("20")).toEqual({
      id: "20",
      text: "just setting up my twttr, with the complete long text",
      createdAt: "2006-03-21T20:50:14.000Z",
      handle: "jack",
      name: "jack",
      followers: 12_468_198,
      likes: 325_373,
      reposts: 126_443,
      replies: 19_252,
      views: null,
    });
    expect(result.posts.has("21")).toBe(false);
    expect(result.posts.get("22")).toEqual({
      id: "22",
      text: "A post with measured views & R&D <3",
      createdAt: null,
      handle: "ada",
      name: "Ada Lovelace",
      followers: 2,
      likes: 3,
      reposts: 1,
      replies: 2,
      views: 42,
    });
    expect(result.gone).toEqual(new Set([missingId]));
    expect(calls).toHaveLength(2);
    expect(calls.map(({ url }) => new URL(url).hostname)).toEqual(["api.x.com", "api.x.com"]);
    expect(calls.map(({ url }) => new URL(url).searchParams.get("ids")?.split(",").length)).toEqual([100, 1]);
    expect(new URL(calls[0]!.url).searchParams.get("ids")).toBe(requestedIds.slice(0, 100).join(","));
    expect(new URL(calls[0]!.url).searchParams.get("tweet.fields")).toBe("created_at,public_metrics,author_id,note_tweet");
    expect(new URL(calls[0]!.url).searchParams.get("expansions")).toBe("author_id");
    expect(new URL(calls[0]!.url).searchParams.get("user.fields")).toBe("username,name,public_metrics");
    for (const call of calls) {
      expect(call.init?.method).toBe("GET");
      expect(call.init?.redirect).toBe("error");
      expect(call.init?.credentials).toBe("omit");
      expect(call.init?.headers).toEqual({ Authorization: "Bearer test-bearer" });
      expect(call.init?.body).toBeUndefined();
    }
  });

  it("uses the daily ceiling in input order and reuses same-day answers without another request", async () => {
    const urls: string[] = [];
    const reader = createXPostReader({
      env: { X_BEARER_TOKEN: "test", X_POSTS_PER_DAY: "2" },
      now: () => NOW,
      fetch: async (url) => {
        urls.push(url);
        const ids = new URL(url).searchParams.get("ids")!.split(",");
        return new Response(JSON.stringify({
          data: ids.map((id) => ({ id, author_id: `author-${id}`, text: `post ${id}`, public_metrics: {} })),
          includes: { users: ids.map((id) => ({ id: `author-${id}`, username: `user${id}`, name: `User ${id}` })) },
        }), { status: 200 });
      },
    });

    const first = await reader.read(["8", "2", "4"]);
    const repeat = await reader.read(["2", "8"]);

    expect(new URL(urls[0]!).searchParams.get("ids")).toBe("8,2");
    expect(urls).toHaveLength(1);
    expect([...first.posts.keys()]).toEqual(["8", "2"]);
    expect(first.posts.has("4")).toBe(false);
    expect([...repeat.posts.keys()]).toEqual(["2", "8"]);

    // A request that never answered may still have been billed, so it counts against the day.
    let lost = 0;
    const unanswered = createXPostReader({
      env: { X_BEARER_TOKEN: "test", X_POSTS_PER_DAY: "2" },
      now: () => NOW,
      fetch: async () => {
        lost += 1;
        throw new Error("socket hang up");
      },
    });
    await unanswered.read(["8", "2"]);
    await unanswered.read(["4"]);
    expect(lost).toBe(1);
    expect((await unanswered.status()).detail).toContain("0 of 2 posts left today");
  });

  it("makes no request without a token and stops permanently after X refuses the credential", async () => {
    let noTokenRequests = 0;
    const unconfigured = createXPostReader({
      env: {},
      fetch: async () => {
        noTokenRequests += 1;
        return new Response("unexpected", { status: 200 });
      },
    });
    const empty = await unconfigured.read(["1"]);
    expect(empty).toEqual({ posts: new Map(), gone: new Set() });
    expect(noTokenRequests).toBe(0);
    expect((await unconfigured.status()).configured).toBe(false);

    const secret = "do-not-report-this-token";
    let refusedRequests = 0;
    const refused = createXPostReader({
      env: { X_BEARER_TOKEN: secret },
      fetch: async () => {
        refusedRequests += 1;
        return new Response("refused", { status: 401 });
      },
    });
    await refused.read(Array.from({ length: 101 }, (_, index) => String(index + 1)));
    await refused.read(["500"]);
    const status = await refused.status();

    expect(refusedRequests).toBe(1);
    expect(status.configured).toBe(true);
    expect(status.detail).toMatch(/X refused the API token/i);
    expect(status.detail).not.toContain(secret);
  });
});
