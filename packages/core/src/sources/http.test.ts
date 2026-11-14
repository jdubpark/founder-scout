import { describe, expect, it } from "vitest";
import { assertSuccessful, httpGet, parseJson, SourceRateLimitError, type HttpResult } from "./http";
import { scriptedFetch, textResponse } from "./test-support";

const NOW = Date.parse("2026-11-13T05:00:00Z");

function result(status: number, body = "", headers: Record<string, string> = {}): HttpResult {
  return { status, body, headers: new Headers(headers) };
}

describe("shared HTTP contracts", () => {
  it("owns success, rate-limit and ordinary HTTP classification", () => {
    expect(() => assertSuccessful("Test", result(200, "{}"), NOW)).not.toThrow();

    const retryAt = Math.floor(NOW / 1000) + 300;
    let retry: unknown;
    try { assertSuccessful("Test", result(429, "", { "retry-after": "90" }), NOW); } catch (error) { retry = error; }
    expect(retry).toBeInstanceOf(SourceRateLimitError);
    expect((retry as SourceRateLimitError).retryAt?.getTime()).toBe(NOW + 90_000);

    let exhausted: unknown;
    try {
      assertSuccessful("Test", result(403, "{}", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(retryAt) }), NOW);
    } catch (error) { exhausted = error; }
    expect(exhausted).toBeInstanceOf(SourceRateLimitError);
    expect((exhausted as SourceRateLimitError).retryAt?.getTime()).toBe(retryAt * 1000);

    let bodyLimited: unknown;
    try { assertSuccessful("Test", result(403, "API rate limit exceeded"), NOW); } catch (error) { bodyLimited = error; }
    expect(bodyLimited).toBeInstanceOf(SourceRateLimitError);
    expect((bodyLimited as SourceRateLimitError).retryAt).toBeNull();
    expect(() => assertSuccessful("Test", result(403, "Forbidden"), NOW)).toThrow("Test request failed with HTTP 403.");
    expect(() => assertSuccessful("Test", result(502), NOW)).toThrow("Test request failed with HTTP 502.");
  });

  it("rejects malformed JSON at the shared parsing boundary", () => {
    expect(() => parseJson("Test", "<html>not JSON</html>")).toThrow("Test returned a body that is not valid JSON.");
  });
});

describe("httpGet", () => {
  it("sends the agentswarm User-Agent and the caller's headers", async () => {
    const recorder = scriptedFetch(() => textResponse("ok"));
    await httpGet(recorder.fetch, "Test", "https://example.test/x", { headers: { Accept: "application/json" } });
    expect(recorder.headers[0]).toMatchObject({ "User-Agent": "agentswarm/0.1", Accept: "application/json" });
  });

  it("identifies itself and keeps caller headers on same-host redirects", async () => {
    const requested: string[] = [];
    const sentHeaders: Array<Record<string, string>> = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      requested.push(url);
      sentHeaders.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return requested.length === 1
        ? new Response(null, { status: 302, headers: { location: "/next" } })
        : textResponse("done");
    };

    await expect(httpGet(fetchFn, "Test", "https://example.test/start", { headers: { Authorization: "Bearer secret" } }))
      .resolves.toMatchObject({ status: 200, body: "done" });
    expect(requested).toEqual(["https://example.test/start", "https://example.test/next"]);
    expect(sentHeaders.map((headers) => headers.authorization)).toEqual(["Bearer secret", "Bearer secret"]);
    expect(sentHeaders[0]?.["user-agent"]).toBe("agentswarm/0.1");
  });

  it("does not send caller headers after a redirect to another host", async () => {
    const headers: Array<Record<string, string>> = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      headers.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return url === "https://example.test/start"
        ? new Response(null, { status: 302, headers: { location: "https://other.test/next" } })
        : textResponse("done");
    };
    await httpGet(fetchFn, "Test", "https://example.test/start", { headers: { Authorization: "Bearer secret" } });
    expect(headers[0]).toMatchObject({ authorization: "Bearer secret", "user-agent": "agentswarm/0.1" });
    expect(headers[1]).toEqual({ "user-agent": "agentswarm/0.1" });
  });

  it("stops redirect chains at the shared limit and detects loops", async () => {
    const requested: string[] = [];
    const chain = async (url: string) => {
      requested.push(url);
      const index = Number(new URL(url).pathname.slice(1));
      return new Response(null, { status: 302, headers: { location: `/${index + 1}` } });
    };
    await expect(httpGet(chain, "Test", "https://example.test/0")).rejects.toThrow("Test request failed: too many redirects.");
    expect(requested).toEqual(Array.from({ length: 6 }, (_, index) => `https://example.test/${index}`));

    const loop = async () => new Response(null, { status: 302, headers: { location: "/start" } });
    await expect(httpGet(loop, "Test", "https://example.test/start")).rejects.toThrow("Test request failed: redirect loop.");
  });

  it("rethrows the caller's abort and applies the shared 20-second deadline", async () => {
    const controller = new AbortController();
    const aborted = httpGet(
      () => new Promise<Response>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new DOMException("caller aborted", "AbortError")));
      }),
      "Test",
      "https://example.test/x",
      { signal: controller.signal },
    );
    controller.abort();
    await expect(aborted).rejects.toThrow("caller aborted");

    const slow = httpGet(
      (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
      }),
      "Test",
      "https://example.test/slow",
    );
    await expect(slow).rejects.toThrow("Test request timed out after 20 seconds.");
  }, 30_000);

  it("honours a longer timeout an adapter asks for, and says which one", async () => {
    const fetchFn = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
      });
    await expect(httpGet(fetchFn, "Test", "https://example.test/slow.json", { timeoutMs: 80 })).rejects.toThrow(
      "Test request timed out after 0.08 seconds.",
    );
  });
});
