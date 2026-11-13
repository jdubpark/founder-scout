import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "openai";
import { describe, expect, it } from "vitest";
import { ScreenOutputSchema, type ScreenOutput } from "@agentswarm/shared";
import { ProviderError, type ProviderRequest } from "../contracts";
import {
  COMPATIBLE_SPECS,
  OpenAICompatibleProvider,
  mapOpenAIError,
  resolveConfig,
  type ChatClientLike,
  type ChatCompletionLike,
} from "./openai-compatible";

const FIT = { fit: 0.4, reasons: ["early"], sectors: ["health"], stage: null, tags: ["biotech"] };

interface Call {
  params: Record<string, unknown>;
  options: { signal?: AbortSignal; timeout?: number } | undefined;
}

function completion(content: string | null, overrides: Partial<ChatCompletionLike["choices"][number]> & { model?: string; usage?: ChatCompletionLike["usage"] } = {}): ChatCompletionLike {
  const { model = "gpt-6-luna", usage, ...choice } = overrides;
  return {
    model,
    choices: [{ finish_reason: "stop", message: { content, refusal: null }, ...choice }],
    usage: usage ?? { prompt_tokens: 500, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 100 } },
  };
}

/** Returns the scripted responses in order, repeating the last one. Errors are thrown. */
function fakeChat(script: Array<ChatCompletionLike | Error>, calls: Call[] = []): ChatClientLike {
  let i = 0;
  return {
    chat: {
      completions: {
        create: async (params, options) => {
          calls.push({ params, options });
          const next = script[Math.min(i, script.length - 1)];
          i += 1;
          if (next instanceof Error) throw next;
          if (!next) throw new Error("no scripted response");
          return next;
        },
      },
    },
  };
}

function request(overrides: Partial<ProviderRequest<ScreenOutput>> = {}): ProviderRequest<ScreenOutput> {
  return {
    jobId: "screen.fit",
    kind: "structured",
    route: { provider: "openai-api", model: "gpt-6-luna" },
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

const OPENAI_ENV = { OPENAI_API_KEY: "test-openai-key" };
const DEEPSEEK_ENV = { DEEPSEEK_API_KEY: "test-deepseek-key", DEEPSEEK_BASE_URL: "https://deepseek-host.example.test/v1" };
const META_ENV = { META_API_KEY: "test-llama-key", META_BASE_URL: "https://llama.example.test/v1" };

describe("structured modes", () => {
  it("uses strict json_schema for OpenAI by default", async () => {
    const calls: Call[] = [];
    const provider = new OpenAICompatibleProvider("openai-api", { env: OPENAI_ENV, client: fakeChat([completion(JSON.stringify(FIT))], calls) });
    await provider.run(request());

    const format = calls[0]?.params.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: { additionalProperties: boolean } } };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.name).toBe("ScreenOutput");
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.additionalProperties).toBe(false);
    expect(calls[0]?.params.messages).toEqual([
      { role: "system", content: "SYSTEM TEXT" },
      { role: "user", content: "USER PROMPT" },
    ]);
  });

  it("uses json_object with the schema in the system message for DeepSeek by default", async () => {
    const calls: Call[] = [];
    const provider = new OpenAICompatibleProvider("deepseek-api", { env: DEEPSEEK_ENV, client: fakeChat([completion(JSON.stringify(FIT))], calls) });
    await provider.run(request({ route: { provider: "deepseek-api", model: "deepseek-chat" } }));

    expect(calls[0]?.params.response_format).toEqual({ type: "json_object" });
    const system = (calls[0]?.params.messages as Array<{ content: string }>)[0]?.content ?? "";
    expect(system).toContain("SYSTEM TEXT");
    expect(system).toContain('"additionalProperties":false');
    expect(system).toContain("JSON Schema");
  });

  it("uses strict json_schema for Meta by default, and json_object when told to", async () => {
    const calls: Call[] = [];
    const provider = new OpenAICompatibleProvider("meta-api", { env: META_ENV, client: fakeChat([completion(JSON.stringify(FIT))], calls) });
    await provider.run(request({ route: { provider: "meta-api", model: "muse-ember-1.0" } }));
    const format = calls[0]?.params.response_format as { type: string; json_schema: { strict: boolean } };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.strict).toBe(true);

    const older = new OpenAICompatibleProvider("meta-api", {
      env: { ...META_ENV, META_STRUCTURED_MODE: "json_object" },
      client: fakeChat([completion(JSON.stringify(FIT))], calls),
    });
    await older.run(request({ route: { provider: "meta-api", model: "muse-ember-1.0" } }));
    expect(calls[1]?.params.response_format).toEqual({ type: "json_object" });
  });

  it("honours the structured-mode overrides", async () => {
    const calls: Call[] = [];
    const deepseek = new OpenAICompatibleProvider("deepseek-api", {
      env: { ...DEEPSEEK_ENV, DEEPSEEK_STRUCTURED_MODE: "json_schema" },
      client: fakeChat([completion(JSON.stringify(FIT))], calls),
    });
    await deepseek.run(request({ route: { provider: "deepseek-api", model: "deepseek-chat" } }));
    expect((calls[0]?.params.response_format as { type: string }).type).toBe("json_schema");

    const openai = new OpenAICompatibleProvider("openai-api", {
      env: { ...OPENAI_ENV, OPENAI_STRUCTURED_MODE: "json_object" },
      client: fakeChat([completion(JSON.stringify(FIT))], calls),
    });
    await openai.run(request());
    expect(calls[1]?.params.response_format).toEqual({ type: "json_object" });
  });

  it("is not configured when the structured mode is not one of the two modes", async () => {
    const provider = new OpenAICompatibleProvider("openai-api", { env: { ...OPENAI_ENV, OPENAI_STRUCTURED_MODE: "text" } });
    const status = await provider.status();
    expect(status.configured).toBe(false);
    expect(status.detail).toContain("OPENAI_STRUCTURED_MODE");
  });
});

describe("configuration", () => {
  it("is not configured without a key, and says which variable to set", async () => {
    const status = await new OpenAICompatibleProvider("openai-api", { env: {} }).status();
    expect(status).toEqual({ configured: false, detail: "Set OPENAI_API_KEY to call this endpoint." });
  });

  it("has no default DeepSeek endpoint: a key alone sends founder data nowhere", () => {
    const keyOnly = resolveConfig(COMPATIBLE_SPECS["deepseek-api"], { DEEPSEEK_API_KEY: "test-deepseek-key" });
    expect(keyOnly.configured).toBe(false);
    expect(keyOnly.baseURL).toBeUndefined();
    expect(keyOnly.detail).toContain("DEEPSEEK_BASE_URL");

    const chosen = resolveConfig(COMPATIBLE_SPECS["deepseek-api"], DEEPSEEK_ENV);
    expect(chosen.configured).toBe(true);
    expect(chosen.baseURL).toBe("https://deepseek-host.example.test/v1");
  });

  it("keeps Llama unconfigured until its base URL is set, even with a key", async () => {
    const provider = new OpenAICompatibleProvider("meta-api", { env: { META_API_KEY: "k" } });
    const status = await provider.status();
    expect(status.configured).toBe(false);
    expect(status.detail).toContain("META_BASE_URL");
  });

  it("does not call the endpoint when the provider is not configured", async () => {
    const calls: Call[] = [];
    const provider = new OpenAICompatibleProvider("meta-api", {
      env: { META_API_KEY: "k" },
      client: fakeChat([completion(JSON.stringify(FIT))], calls),
    });
    expect(await errorOf(provider.run(request({ route: { provider: "meta-api", model: "llama" } })))).toMatchObject({
      kind: "not_configured",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("OpenAICompatibleProvider.run", () => {
  it("returns the output with the served model, summed usage and no cost for an unpriced model", async () => {
    const provider = new OpenAICompatibleProvider("openai-api", { env: OPENAI_ENV, client: fakeChat([completion(JSON.stringify(FIT), { model: "gpt-6-luna-2026-11" })]) });
    const result = await provider.run(request());
    expect(result.output).toEqual(FIT);
    expect(result.model).toBe("gpt-6-luna-2026-11");
    expect(result.usage).toEqual({ inputTokens: 400, outputTokens: 50, cachedInputTokens: 100, cacheWriteTokens: 0, webSearches: 0 });
    expect(result.costUsd).toBeNull();
  });

  it("passes reasoning effort only when the route sets it", async () => {
    const calls: Call[] = [];
    const provider = new OpenAICompatibleProvider("openai-api", { env: OPENAI_ENV, client: fakeChat([completion(JSON.stringify(FIT))], calls) });
    await provider.run(request());
    expect(calls[0]?.params).not.toHaveProperty("reasoning_effort");
    await provider.run(request({ route: { provider: "openai-api", model: "gpt-6-luna", effort: "high" } }));
    expect(calls[1]?.params.reasoning_effort).toBe("high");
  });

  it("asks a model that reasons by default to answer fast when the route names no effort", async () => {
    const calls: Call[] = [];
    const deepseek = new OpenAICompatibleProvider("deepseek-api", { env: DEEPSEEK_ENV, client: fakeChat([completion(JSON.stringify(FIT))], calls) });
    await deepseek.run(request({ route: { provider: "deepseek-api", model: "deepseek-flash" } }));
    // Thinking is on unless it is switched off; a runner that thinks takes tens of seconds to start.
    expect(calls[0]?.params.thinking).toEqual({ type: "disabled" });
    expect(calls[0]?.params).not.toHaveProperty("reasoning_effort");

    const meta = new OpenAICompatibleProvider("meta-api", { env: META_ENV, client: fakeChat([completion(JSON.stringify(FIT))], calls) });
    await meta.run(request({ route: { provider: "meta-api", model: "muse-ember-1.0" } }));
    // These models refuse "none"; "minimal" is the least they accept.
    expect(calls[1]?.params.reasoning_effort).toBe("minimal");
  });

  it("sends the route's effort in place of the fast setting when the route names one", async () => {
    const calls: Call[] = [];
    const deepseek = new OpenAICompatibleProvider("deepseek-api", { env: DEEPSEEK_ENV, client: fakeChat([completion(JSON.stringify(FIT))], calls) });
    await deepseek.run(request({ route: { provider: "deepseek-api", model: "deepseek-v4-pro", effort: "high" } }));
    expect(calls[0]?.params.reasoning_effort).toBe("high");
    expect(calls[0]?.params).not.toHaveProperty("thinking");
  });

  it("lets a host that spells the switch differently replace the fast setting, or send nothing", async () => {
    const calls: Call[] = [];
    const nothing = new OpenAICompatibleProvider("deepseek-api", {
      env: { ...DEEPSEEK_ENV, DEEPSEEK_FAST_PARAMS: "{}" },
      client: fakeChat([completion(JSON.stringify(FIT))], calls),
    });
    await nothing.run(request({ route: { provider: "deepseek-api", model: "deepseek-flash" } }));
    expect(calls[0]?.params).not.toHaveProperty("thinking");

    const other = new OpenAICompatibleProvider("deepseek-api", {
      env: { ...DEEPSEEK_ENV, DEEPSEEK_FAST_PARAMS: '{"enable_thinking":false}' },
      client: fakeChat([completion(JSON.stringify(FIT))], calls),
    });
    await other.run(request({ route: { provider: "deepseek-api", model: "deepseek-flash" } }));
    expect(calls[1]?.params.enable_thinking).toBe(false);

    const broken = resolveConfig(COMPATIBLE_SPECS["deepseek-api"], { ...DEEPSEEK_ENV, DEEPSEEK_FAST_PARAMS: "off" });
    expect(broken.configured).toBe(false);
    expect(broken.detail).toContain("DEEPSEEK_FAST_PARAMS must be a JSON object");
  });

  it("gives the model one repair attempt that shows it the parse error", async () => {
    const calls: Call[] = [];
    const provider = new OpenAICompatibleProvider("deepseek-api", {
      env: DEEPSEEK_ENV,
      client: fakeChat([completion("Sure! Here it is."), completion(JSON.stringify(FIT))], calls),
    });
    const result = await provider.run(request({ route: { provider: "deepseek-api", model: "deepseek-chat" } }));

    expect(result.output).toEqual(FIT);
    expect(calls).toHaveLength(2);
    const repairMessages = calls[1]?.params.messages as Array<{ role: string; content: string }>;
    expect(repairMessages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(repairMessages[3]?.content).toContain("not valid JSON");
    expect(result.trace.map((t) => t.role)).toContain("user");
    // Usage is summed over both attempts.
    expect(result.usage.inputTokens).toBe(800);
  });

  it("names the schema failure in the repair message", async () => {
    const calls: Call[] = [];
    const provider = new OpenAICompatibleProvider("openai-api", {
      env: OPENAI_ENV,
      client: fakeChat([completion('{"fit":"high"}'), completion(JSON.stringify(FIT))], calls),
    });
    await provider.run(request());
    const repair = (calls[1]?.params.messages as Array<{ content: string }>)[3];
    expect(repair?.content).toContain("fit");
  });

  it("reports invalid_output after the repair also fails, with both calls billed", async () => {
    const provider = new OpenAICompatibleProvider("openai-api", {
      env: OPENAI_ENV,
      client: fakeChat([completion("nope"), completion("still nope")]),
    });
    const err = await errorOf(provider.run(request()));
    expect(err.kind).toBe("invalid_output");
    expect(err.usage?.outputTokens).toBe(100);
  });

  it("reports a model refusal as refused and a length stop as invalid_output", async () => {
    const refused = new OpenAICompatibleProvider("openai-api", {
      env: OPENAI_ENV,
      client: fakeChat([completion(null, { message: { content: null, refusal: "I cannot help" } } as never)]),
    });
    expect((await errorOf(refused.run(request())))).toMatchObject({ kind: "refused" });

    const cut = new OpenAICompatibleProvider("openai-api", {
      env: OPENAI_ENV,
      client: fakeChat([completion('{"fit":', { finish_reason: "length" })]),
    });
    expect((await errorOf(cut.run(request())))).toMatchObject({ kind: "invalid_output" });
  });

  it("refuses repo reviews as unsupported", async () => {
    const provider = new OpenAICompatibleProvider("openai-api", { env: OPENAI_ENV, client: fakeChat([completion(null)]) });
    expect((await errorOf(provider.run(request({ kind: "repo_review", repoDir: "/x" })))).kind).toBe("unsupported");
  });

  it("does not call the endpoint when the signal is already aborted", async () => {
    const calls: Call[] = [];
    const controller = new AbortController();
    controller.abort();
    const provider = new OpenAICompatibleProvider("openai-api", { env: OPENAI_ENV, client: fakeChat([completion(JSON.stringify(FIT))], calls) });
    expect((await errorOf(provider.run(request({ signal: controller.signal })))).kind).toBe("cancelled");
    expect(calls).toHaveLength(0);
  });

  it("passes the timeout and signal to the SDK", async () => {
    const calls: Call[] = [];
    const controller = new AbortController();
    const provider = new OpenAICompatibleProvider("openai-api", { env: OPENAI_ENV, client: fakeChat([completion(JSON.stringify(FIT))], calls) });
    await provider.run(request({ signal: controller.signal, timeoutMs: 4_321 }));
    expect(calls[0]?.options?.timeout).toBe(4_321);
    expect(calls[0]?.options?.signal).toBe(controller.signal);
  });
});

describe("mapOpenAIError", () => {
  const headers = new Headers();

  it("maps SDK errors to kinds, most specific first", () => {
    expect(mapOpenAIError(new RateLimitError(429, undefined, "slow", headers), undefined)).toMatchObject({ kind: "rate_limited", retryable: true });
    expect(mapOpenAIError(new APIConnectionTimeoutError({ message: "t" }), undefined)).toMatchObject({ kind: "timeout" });
    expect(mapOpenAIError(new APIConnectionError({ message: "c" }), undefined)).toMatchObject({ kind: "transport", retryable: true });
    expect(mapOpenAIError(new AuthenticationError(401, undefined, "bad", headers), undefined)).toMatchObject({ kind: "not_configured", retryable: false });
    expect(mapOpenAIError(new APIError(503, undefined, "busy", headers), undefined)).toMatchObject({ kind: "transport", retryable: true });
    expect(mapOpenAIError(new APIError(400, undefined, "bad", headers), undefined)).toMatchObject({ kind: "transport", retryable: false });
  });
});
