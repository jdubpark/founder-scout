import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ScreenOutputSchema, type ScreenOutput } from "@agentswarm/shared";
import { ProviderError, type ProviderRequest } from "../contracts";
import {
  AnthropicApiProvider,
  FALLBACK_BETA,
  FALLBACK_MODELS,
  mapAnthropicError,
  type AnthropicClientLike,
  type AnthropicMessageLike,
} from "./anthropic-api";

const FIT = { fit: 0.9, reasons: ["strong"], sectors: ["ai"], stage: "seed", tags: [] };

interface Recorded {
  path: "messages" | "beta";
  params: Record<string, unknown>;
  options: { signal?: AbortSignal; timeout?: number } | undefined;
}

function message(overrides: Partial<AnthropicMessageLike> = {}): AnthropicMessageLike {
  return {
    model: "claude-sonnet-5-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(FIT) }],
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
    ...overrides,
  };
}

function fakeClient(options: { message?: AnthropicMessageLike; error?: unknown; recorded?: Recorded[] }): AnthropicClientLike {
  const recorded = options.recorded ?? [];
  const stream = (path: Recorded["path"]) =>
    (params: Record<string, unknown>, opts?: { signal?: AbortSignal; timeout?: number }) => {
      recorded.push({ path, params, options: opts });
      return {
        finalMessage: async () => {
          if (options.error !== undefined) throw options.error;
          return options.message ?? message();
        },
      };
    };
  return {
    messages: { stream: stream("messages") },
    beta: { messages: { stream: stream("beta") } },
  };
}

function request(overrides: Partial<ProviderRequest<ScreenOutput>> = {}): ProviderRequest<ScreenOutput> {
  return {
    jobId: "screen.fit",
    kind: "structured",
    route: { provider: "anthropic-api", model: "claude-sonnet-5-5", effort: "medium" },
    system: "SYSTEM TEXT",
    prompt: "USER PROMPT",
    schema: ScreenOutputSchema,
    schemaName: "ScreenOutput",
    ...overrides,
  };
}

async function errorOf(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ProviderError) return err;
    throw err;
  }
  throw new Error("expected the call to reject");
}

describe("AnthropicApiProvider.run", () => {
  it("sends a JSON-schema output format, the effort, and the prompt through the streaming helper", async () => {
    const recorded: Recorded[] = [];
    const provider = new AnthropicApiProvider({ env: {}, client: fakeClient({ recorded }) });
    await provider.run(request());

    const call = recorded[0];
    expect(call?.params.model).toBe("claude-sonnet-5-5");
    expect(call?.params.max_tokens).toBe(16_000);
    expect(call?.params.system).toBe("SYSTEM TEXT");
    expect(call?.params.messages).toEqual([{ role: "user", content: "USER PROMPT" }]);
    const outputConfig = call?.params.output_config as { format: { type: string }; effort: string };
    expect(outputConfig.format.type).toBe("json_schema");
    expect(outputConfig.effort).toBe("medium");
  });

  it("raises the output budget at xhigh and max, and omits effort when the route has none", async () => {
    const recorded: Recorded[] = [];
    const provider = new AnthropicApiProvider({ env: {}, client: fakeClient({ recorded }) });
    await provider.run(request({ route: { provider: "anthropic-api", model: "claude-sonnet-5-5", effort: "max" } }));
    expect(recorded[0]?.params.max_tokens).toBe(64_000);
    await provider.run(request({ route: { provider: "anthropic-api", model: "claude-sonnet-5-5" } }));
    expect(recorded[1]?.params.output_config).toEqual({ format: expect.any(Object) });
  });

  it("opts in to server-side fallback, routed by refusal category, on every model that can refuse", async () => {
    const models = ["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"];
    expect([...FALLBACK_MODELS].sort()).toEqual([...models].sort());
    for (const model of models) {
      const recorded: Recorded[] = [];
      const provider = new AnthropicApiProvider({
        env: {},
        client: fakeClient({ recorded, message: message({ model }) }),
      });
      await provider.run(request({ route: { provider: "anthropic-api", model, effort: "high" } }));
      expect(recorded[0]?.path, model).toBe("beta");
      expect(recorded[0]?.params.betas, model).toEqual([FALLBACK_BETA]);
      expect(recorded[0]?.params.fallbacks, model).toBe("default");
    }
  });

  it("sends no fallback option for a model that has none", async () => {
    const recorded: Recorded[] = [];
    const provider = new AnthropicApiProvider({
      env: {},
      client: fakeClient({ recorded, message: message({ model: "claude-haiku-5-5" }) }),
    });
    await provider.run(request({ route: { provider: "anthropic-api", model: "claude-haiku-5-5" } }));
    expect(recorded[0]?.path).toBe("messages");
    expect(recorded[0]?.params.fallbacks).toBeUndefined();
    expect(recorded[0]?.params.betas).toBeUndefined();
  });

  it("maps the served model, the usage and the estimated cost", async () => {
    const provider = new AnthropicApiProvider({ env: {}, client: fakeClient({}) });
    const result = await provider.run(request());
    expect(result.output).toEqual(FIT);
    expect(result.model).toBe("claude-sonnet-5-5");
    expect(result.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 100,
      cachedInputTokens: 50,
      cacheWriteTokens: 0,
      webSearches: 0,
    });
    // 1000 * $2 + 100 * $10 per million, plus 50 cached tokens at $0.10.
    expect(result.costUsd).toBeCloseTo((1000 * 2 + 100 * 10 + 50 * 0.1) / 1_000_000, 9);
  });

  it("reports no cost when a fallback served the call, because it bills at other rates", async () => {
    const provider = new AnthropicApiProvider({
      env: {},
      client: fakeClient({ message: message({ model: "claude-opus-5-5" }) }),
    });
    const result = await provider.run(request({ route: { provider: "anthropic-api", model: "claude-fable-5-2" } }));
    expect(result.model).toBe("claude-opus-5-5");
    expect(result.costUsd).toBeNull();
  });

  it("maps a refusal to refused, keeping the usage", async () => {
    const provider = new AnthropicApiProvider({
      env: {},
      client: fakeClient({ message: message({ stop_reason: "refusal", content: [] }) }),
    });
    const err = await errorOf(provider.run(request()));
    expect(err.kind).toBe("refused");
    expect(err.usage?.inputTokens).toBe(1000);
  });

  it("maps a cut-off output to invalid_output", async () => {
    const provider = new AnthropicApiProvider({ env: {}, client: fakeClient({ message: message({ stop_reason: "max_tokens" }) }) });
    expect(await errorOf(provider.run(request()))).toMatchObject({ kind: "invalid_output" });
  });

  it("reports text that is not JSON, and JSON that fails the schema, as invalid_output", async () => {
    const notJson = new AnthropicApiProvider({
      env: {},
      client: fakeClient({ message: message({ content: [{ type: "text", text: "sure, here you go" }] }) }),
    });
    expect((await errorOf(notJson.run(request())))).toMatchObject({ kind: "invalid_output" });

    const wrongShape = new AnthropicApiProvider({
      env: {},
      client: fakeClient({ message: message({ content: [{ type: "text", text: '{"fit":"high"}' }] }) }),
    });
    const err = await errorOf(wrongShape.run(request()));
    expect(err.kind).toBe("invalid_output");
    expect(err.costUsd).not.toBeNull();
  });

  it("refuses to run without a key or an injected client", async () => {
    const provider = new AnthropicApiProvider({ env: {} });
    expect(await errorOf(provider.run(request()))).toMatchObject({ kind: "not_configured" });
  });

  it("refuses repo reviews as unsupported", async () => {
    const provider = new AnthropicApiProvider({ env: {}, client: fakeClient({}) });
    expect(await errorOf(provider.run(request({ kind: "repo_review", repoDir: "/x" })))).toMatchObject({ kind: "unsupported" });
  });

  it("does not call the API when the signal is already aborted", async () => {
    const recorded: Recorded[] = [];
    const controller = new AbortController();
    controller.abort();
    const provider = new AnthropicApiProvider({ env: {}, client: fakeClient({ recorded }) });
    expect(await errorOf(provider.run(request({ signal: controller.signal })))).toMatchObject({ kind: "cancelled" });
    expect(recorded).toHaveLength(0);
  });

  it("passes the signal and timeout to the SDK request", async () => {
    const recorded: Recorded[] = [];
    const controller = new AbortController();
    const provider = new AnthropicApiProvider({ env: {}, client: fakeClient({ recorded }) });
    await provider.run(request({ signal: controller.signal, timeoutMs: 12_345 }));
    expect(recorded[0]?.options?.signal).toBe(controller.signal);
    expect(recorded[0]?.options?.timeout).toBe(12_345);
  });
});

describe("mapAnthropicError", () => {
  const headers = new Headers();

  it("maps rate limits, timeouts and connection failures, most specific class first", () => {
    expect(mapAnthropicError(new RateLimitError(429, undefined, "slow down", headers), undefined)).toMatchObject({
      kind: "rate_limited",
      retryable: true,
    });
    expect(mapAnthropicError(new APIConnectionTimeoutError({ message: "timed out" }), undefined)).toMatchObject({
      kind: "timeout",
      retryable: true,
    });
    expect(mapAnthropicError(new APIConnectionError({ message: "reset" }), undefined)).toMatchObject({
      kind: "transport",
      retryable: true,
    });
  });

  it("maps an authentication failure to not_configured and does not retry it", () => {
    expect(mapAnthropicError(new AuthenticationError(401, undefined, "bad key", headers), undefined)).toMatchObject({
      kind: "not_configured",
      retryable: false,
    });
  });

  it("retries a 5xx and not a 4xx", () => {
    expect(mapAnthropicError(new APIError(500, undefined, "boom", headers), undefined)).toMatchObject({ retryable: true });
    expect(mapAnthropicError(new APIError(400, undefined, "bad", headers), undefined)).toMatchObject({ retryable: false });
  });

  it("reports cancellation when the caller's signal fired", () => {
    const controller = new AbortController();
    controller.abort();
    expect(mapAnthropicError(new Error("aborted"), controller.signal)).toMatchObject({ kind: "cancelled" });
  });
});
