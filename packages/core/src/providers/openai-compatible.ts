import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
} from "openai";
import { estimateCostUsd, type ProviderId, type TraceTurn, type Usage } from "@agentswarm/shared";
import { ProviderError, type ModelProvider, type ProviderRequest, type ProviderResult } from "../contracts";
import {
  DEFAULT_TIMEOUT_MS,
  cancelledIfAborted,
  errorText,
  parseJsonText,
  requireKind,
  resultOf,
  validateOutput,
  type Validated,
} from "./common";
import { toProviderJsonSchema } from "./schema";

export type StructuredMode = "json_schema" | "json_object";
export type CompatibleProviderId = Extract<ProviderId, "openai-api" | "deepseek-api" | "meta-api">;

export interface CompatibleSpec {
  id: CompatibleProviderId;
  apiKeyEnv: string;
  baseUrlEnv: string;
  /** Used when the base URL variable is unset. Null means the SDK default, or no default at all. */
  defaultBaseUrl: string | null;
  /** A base URL must be set before the provider is configured. */
  requiresBaseUrl: boolean;
  modeEnv: string;
  defaultMode: StructuredMode;
  /**
   * Sent with a request whose route names no effort, which is how a job says "answer fast".
   * Both of these models reason by default, and a runner call that reasons takes tens of
   * seconds to start answering (docs/research/rapid-runner-models.md). A route that names an
   * effort sends that instead.
   */
  fastParams: Record<string, unknown>;
  /** A JSON object that replaces `fastParams`, for a host that spells the switch differently. "{}" sends nothing. */
  fastParamsEnv: string;
}

export const COMPATIBLE_SPECS: Record<CompatibleProviderId, CompatibleSpec> = {
  "openai-api": {
    id: "openai-api",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    defaultBaseUrl: null,
    requiresBaseUrl: false,
    modeEnv: "OPENAI_STRUCTURED_MODE",
    defaultMode: "json_schema",
    fastParams: {},
    fastParamsEnv: "OPENAI_FAST_PARAMS",
  },
  "deepseek-api": {
    id: "deepseek-api",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    // No default on purpose. Founder dossiers are personal data, and the design calls for a
    // hosting provider chosen for it, not the first-party endpoint, so the operator must name one.
    defaultBaseUrl: null,
    requiresBaseUrl: true,
    modeEnv: "DEEPSEEK_STRUCTURED_MODE",
    // DeepSeek documents valid JSON, not JSON that matches a schema, and says the answer can
    // come back blank. The schema goes in the prompt and one repair covers both.
    defaultMode: "json_object",
    // Thinking is on unless it is switched off, in DeepSeek's own spelling.
    fastParams: { thinking: { type: "disabled" } },
    fastParamsEnv: "DEEPSEEK_FAST_PARAMS",
  },
  "meta-api": {
    id: "meta-api",
    apiKeyEnv: "META_API_KEY",
    baseUrlEnv: "META_BASE_URL",
    defaultBaseUrl: null,
    requiresBaseUrl: true,
    modeEnv: "META_STRUCTURED_MODE",
    // Meta documents a strict schema mode with constrained decoding.
    defaultMode: "json_schema",
    // Reasoning cannot be switched off on these models ("none" is refused); this is the floor.
    fastParams: { reasoning_effort: "minimal" },
    fastParamsEnv: "META_FAST_PARAMS",
  },
};

export interface ChatCompletionLike {
  model?: string;
  choices: ReadonlyArray<{
    finish_reason?: string | null;
    message: { content?: string | null; refusal?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    prompt_tokens_details?: { cached_tokens?: number | null } | null;
  } | null;
}

/** The subset of the chat completions API this provider uses. Lets tests inject a fake. */
export interface ChatClientLike {
  chat: {
    completions: {
      create(
        params: Record<string, unknown>,
        options?: { signal?: AbortSignal; timeout?: number },
      ): Promise<ChatCompletionLike>;
    };
  };
}

export interface ResolvedConfig {
  configured: boolean;
  detail: string;
  apiKey: string | null;
  baseURL: string | undefined;
  mode: StructuredMode;
  fastParams: Record<string, unknown>;
}

export function resolveConfig(spec: CompatibleSpec, env: NodeJS.ProcessEnv): ResolvedConfig {
  const apiKey = env[spec.apiKeyEnv] || null;
  const rawMode = env[spec.modeEnv];
  const mode: StructuredMode = rawMode === "json_schema" || rawMode === "json_object" ? rawMode : spec.defaultMode;
  const baseURL = env[spec.baseUrlEnv] || spec.defaultBaseUrl || undefined;
  const rawFast = env[spec.fastParamsEnv];
  let fastParams = spec.fastParams;
  let fastProblem: string | null = null;
  if (rawFast !== undefined && rawFast.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(rawFast);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      fastParams = parsed as Record<string, unknown>;
    } catch {
      fastProblem = `${spec.fastParamsEnv} must be a JSON object, for example {} to send nothing extra`;
    }
  }
  const base = { apiKey, baseURL, mode, fastParams };

  if (fastProblem) return { ...base, configured: false, detail: fastProblem };

  if (rawMode !== undefined && rawMode !== "" && rawMode !== "json_schema" && rawMode !== "json_object") {
    return { ...base, configured: false, detail: `${spec.modeEnv} must be json_schema or json_object` };
  }
  if (!apiKey) {
    return { ...base, configured: false, detail: `Set ${spec.apiKeyEnv} to call this endpoint.` };
  }
  if (spec.requiresBaseUrl && !baseURL) {
    return {
      ...base,
      configured: false,
      detail: `${spec.apiKeyEnv} is set, but ${spec.baseUrlEnv} is not. Set it to the endpoint's base URL.`,
    };
  }
  const where = baseURL ?? "the default OpenAI endpoint";
  return {
    ...base,
    configured: true,
    detail: `${spec.apiKeyEnv} is set. Calls ${where} with ${mode} structured output.`,
  };
}

export function usageFromCompletion(raw: ChatCompletionLike["usage"]): Usage {
  const prompt = raw?.prompt_tokens ?? 0;
  const cached = raw?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: raw?.completion_tokens ?? 0,
    cachedInputTokens: cached,
    cacheWriteTokens: 0,
    webSearches: 0,
  };
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearches: a.webSearches + b.webSearches,
  };
}

export function mapOpenAIError(err: unknown, signal: AbortSignal | undefined): ProviderError {
  if (err instanceof ProviderError) return err;
  if (signal?.aborted || err instanceof APIUserAbortError) {
    return new ProviderError("cancelled", "The model call was cancelled", { cause: err });
  }
  if (err instanceof RateLimitError) {
    return new ProviderError("rate_limited", `Rate limited: ${errorText(err)}`, { retryable: true, cause: err });
  }
  if (err instanceof APIConnectionTimeoutError) {
    return new ProviderError("timeout", "The model call timed out", { retryable: true, cause: err });
  }
  if (err instanceof APIConnectionError) {
    return new ProviderError("transport", `Connection failed: ${errorText(err)}`, { retryable: true, cause: err });
  }
  if (err instanceof AuthenticationError) {
    return new ProviderError("not_configured", "The endpoint rejected its API key", { retryable: false, cause: err });
  }
  if (err instanceof APIError) {
    const status = typeof err.status === "number" ? err.status : 0;
    return new ProviderError("transport", `Endpoint returned ${status}: ${errorText(err)}`, {
      retryable: status >= 500,
      cause: err,
    });
  }
  return new ProviderError("transport", `Model call failed: ${errorText(err)}`, { retryable: false, cause: err });
}

export interface OpenAICompatibleOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected in tests. Defaults to an OpenAI SDK client built from the environment. */
  client?: ChatClientLike;
}

/** Strict-mode schema instruction for endpoints without json_schema support. */
function jsonObjectSystem(system: string, schema: Record<string, unknown>): string {
  return `${system}\n\nRespond with one JSON object that matches this JSON Schema. Output the JSON object only, with no prose and no Markdown.\n\n${JSON.stringify(schema)}`;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: CompatibleProviderId;
  private readonly spec: CompatibleSpec;
  private readonly env: NodeJS.ProcessEnv;
  private client: ChatClientLike | null;

  constructor(id: CompatibleProviderId, options: OpenAICompatibleOptions = {}) {
    this.id = id;
    this.spec = COMPATIBLE_SPECS[id];
    this.env = options.env ?? process.env;
    this.client = options.client ?? null;
  }

  async status(): Promise<{ configured: boolean; detail: string }> {
    const config = resolveConfig(this.spec, this.env);
    return { configured: config.configured, detail: config.detail };
  }

  private getClient(config: ResolvedConfig): ChatClientLike {
    if (this.client) return this.client;
    this.client = new OpenAI({ apiKey: config.apiKey ?? "", baseURL: config.baseURL }) as unknown as ChatClientLike;
    return this.client;
  }

  async run<T>(req: ProviderRequest<T>): Promise<ProviderResult<T>> {
    requireKind(this.id, req.kind, ["structured"]);
    const config = resolveConfig(this.spec, this.env);
    if (!config.configured) throw new ProviderError("not_configured", config.detail, { retryable: false });
    const aborted = cancelledIfAborted(req.signal);
    if (aborted) throw aborted;

    let schema: Record<string, unknown>;
    try {
      schema = toProviderJsonSchema(req.schema);
    } catch (err) {
      throw new ProviderError("unsupported", `Schema ${req.schemaName} cannot be sent: ${errorText(err)}`, { cause: err });
    }
    const client = this.getClient(config);
    const started = Date.now();
    const timeout = req.timeoutMs ?? DEFAULT_TIMEOUT_MS.structured;
    const options = { timeout, ...(req.signal ? { signal: req.signal } : {}) };

    const system = config.mode === "json_object" ? jsonObjectSystem(req.system, schema) : req.system;
    const responseFormat =
      config.mode === "json_schema"
        ? { type: "json_schema", json_schema: { name: req.schemaName, schema, strict: true } }
        : { type: "json_object" };
    const baseMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: system },
      { role: "user", content: req.prompt },
    ];
    const effortParams = req.route.effort ? { reasoning_effort: req.route.effort } : config.fastParams;

    const trace: TraceTurn[] = [
      { role: "system", content: system },
      { role: "user", content: req.prompt },
    ];
    let usage: Usage | null = null;
    let model = req.route.model;

    const call = async (messages: typeof baseMessages): Promise<{ text: string | null; raw: string }> => {
      let response: ChatCompletionLike;
      try {
        response = await client.chat.completions.create(
          { model: req.route.model, messages, response_format: responseFormat, ...effortParams },
          options,
        );
      } catch (err) {
        throw withBilling(mapOpenAIError(err, req.signal), usage, model);
      }
      usage = usage ? addUsage(usage, usageFromCompletion(response.usage)) : usageFromCompletion(response.usage);
      model = response.model ?? model;
      const choice = response.choices[0];
      if (!choice) throw withBilling(new ProviderError("invalid_output", "The endpoint returned no choices"), usage, model);
      if (choice.message.refusal) {
        throw withBilling(new ProviderError("refused", `The model refused: ${choice.message.refusal}`), usage, model);
      }
      if (choice.finish_reason === "length") {
        throw withBilling(new ProviderError("invalid_output", "The output was cut off at the token limit"), usage, model);
      }
      const text = choice.message.content ?? null;
      return { text, raw: text ?? "" };
    };

    const checkText = (text: string | null): Validated<T> => {
      if (text === null) return { ok: false, issues: "the response had no content" };
      const parsed = parseJsonText(text);
      if (!parsed.ok) return { ok: false, issues: `the response is not valid JSON (${parsed.error})` };
      return validateOutput(req.schema, parsed.value);
    };

    const first = await call(baseMessages);
    trace.push({ role: "assistant", content: first.raw });
    let check = checkText(first.text);

    if (!check.ok) {
      const repairPrompt = `Your previous answer did not validate: ${check.issues}. Reply again with only the corrected JSON object that matches the schema.`;
      const repairMessages = [
        ...baseMessages,
        { role: "assistant" as const, content: first.raw },
        { role: "user" as const, content: repairPrompt },
      ];
      trace.push({ role: "user", content: repairPrompt });
      const second = await call(repairMessages);
      trace.push({ role: "assistant", content: second.raw });
      check = checkText(second.text);
      if (!check.ok) {
        throw withBilling(
          new ProviderError("invalid_output", `Output failed ${req.schemaName} after one repair: ${check.issues}`),
          usage,
          model,
        );
      }
    }

    const billedUsage: Usage = usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      webSearches: 0,
    };
    return resultOf({
      output: check.output,
      provider: this.id,
      model,
      usage: billedUsage,
      costUsd: estimateCostUsd(model, billedUsage),
      latencyMs: Date.now() - started,
      trace,
    });
  }
}

/** Attaches the spend billed before a failure. Cost is estimated for the model that was billed. */
function withBilling(error: ProviderError, usage: Usage | null, model: string): ProviderError {
  if (!usage) return error;
  return new ProviderError(error.kind, error.message, {
    retryable: error.retryable,
    usage,
    costUsd: estimateCostUsd(model, usage),
    cause: error.cause,
  });
}
