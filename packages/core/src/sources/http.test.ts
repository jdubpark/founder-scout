import { describe, expect, it } from "vitest";
import { assertSuccessful, httpGet, REQUEST_TIMEOUT_MS, SourceRateLimitError, type HttpResult } from "./http";
import { scriptedFetch, textResponse } from "./test-support";

const NOW = Date.parse("2026-11-13T05:00:00Z");

function result(status: number, body = "", headers: Record<string, string> = {}): HttpResult {
  return { status, body, headers: new Headers(headers) };
}

describe("assertSuccessful", () => {
  it("accepts a 2xx response", () => {
    expect(() => assertSuccessful("Test", result(200, "{}"), NOW)).not.toThrow();
  });

  it("treats 429 as rate limited, with the Retry-After delay", () => {
    expect(() => assertSuccessful("Test", result(429, "", { "retry-after": "90" }), NOW)).toThrow(
      `Test is rate limited (HTTP 429). Retry after ${new Date(NOW + 90_000).toISOString()}.`,
    );
  });

  it("treats a 403 with an exhausted quota as rate limited, using the reset header", () => {
    const reset = Math.floor(NOW / 1000) + 300;
    const error = (() => {
      try {
        assertSuccessful("Test", result(403, "{}", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }), NOW);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(SourceRateLimitError);
    expect((error as SourceRateLimitError).retryAt?.getTime()).toBe(reset * 1000);
  });

  it("treats a 403 whose body says rate limit as rate limited, with no reset time", () => {
    const error = (() => {
      try {
        assertSuccessful("Test", result(403, "API rate limit exceeded for 1.2.3.4"), NOW);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(SourceRateLimitError);
    expect((error as SourceRateLimitError).message).toBe("Test is rate limited (HTTP 403). Retry later; the response gave no reset time.");
  });

  it("treats an ordinary 403 as a plain HTTP failure", () => {
    expect(() => assertSuccessful("Test", result(403, "Forbidden"), NOW)).toThrow("Test request failed with HTTP 403.");
  });

  it("names the status on other failures", () => {
    expect(() => assertSuccessful("Test", result(502), NOW)).toThrow("Test request failed with HTTP 502.");
  });
});

describe("httpGet", () => {
  it("sends the agentswarm User-Agent and the caller's headers", async () => {
    const recorder = scriptedFetch(() => textResponse("ok"));
    await httpGet(recorder.fetch, "Test", "https://example.test/x", { headers: { Accept: "application/json" } });
    expect(recorder.headers[0]).toMatchObject({ "User-Agent": "agentswarm/0.1", Accept: "application/json" });
  });

  it("follows redirects within an allowed host", async () => {
    const requested: string[] = [];
    const sentHeaders: Array<Record<string, string>> = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      requested.push(url);
      sentHeaders.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return requested.length === 1
        ? new Response(null, { status: 302, headers: { location: "/next" } })
        : textResponse("done");
    };

    await expect(
      httpGet(fetchFn, "Test", "https://example.test/start", { headers: { Authorization: "Bearer secret" } }),
    ).resolves.toMatchObject({ status: 200, body: "done" });
    expect(requested).toEqual(["https://example.test/start", "https://example.test/next"]);
    expect(sentHeaders.map((headers) => headers.authorization)).toEqual(["Bearer secret", "Bearer secret"]);
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

  it("fails when a sixth redirect would be followed", async () => {
    const requested: string[] = [];
    const fetchFn = async (url: string) => {
      requested.push(url);
      const index = Number(new URL(url).pathname.slice(1));
      return new Response(null, { status: 302, headers: { location: `/${index + 1}` } });
    };

    await expect(httpGet(fetchFn, "Test", "https://example.test/0")).rejects.toThrow("Test request failed: too many redirects.");
    expect(requested).toEqual(Array.from({ length: 6 }, (_, index) => `https://example.test/${index}`));
  });

  it("fails on a redirect loop", async () => {
    const fetchFn = async () => new Response(null, { status: 302, headers: { location: "/start" } });
    await expect(httpGet(fetchFn, "Test", "https://example.test/start")).rejects.toThrow("Test request failed: redirect loop.");
  });

  it("rethrows the caller's own abort rather than reporting a timeout", async () => {
    const controller = new AbortController();
    const fetchFn = () =>
      new Promise<Response>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new DOMException("caller aborted", "AbortError")));
      });
    const pending = httpGet(fetchFn, "Test", "https://example.test/x", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("caller aborted");
  });

  it(
    "gives up after the 20 second timeout and says so",
    async () => {
      expect(REQUEST_TIMEOUT_MS).toBe(20_000);
      const fetchFn = (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
        });
      await expect(httpGet(fetchFn, "Test", "https://example.test/slow")).rejects.toThrow(
        "Test request timed out after 20 seconds.",
      );
    },
    30_000,
  );

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
