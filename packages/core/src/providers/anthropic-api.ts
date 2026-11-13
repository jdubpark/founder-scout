import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { estimateCostUsd, type TraceTurn, type Usage } from "@agentswarm/shared";
import { ProviderError, type ModelProvider, type ProviderRequest, type ProviderResult } from "../contracts";
import {
  DEFAULT_TIMEOUT_MS,
  cancelledIfAborted,
  errorText,
  parseJsonText,
  requireKind,
  resultOf,
  validateOutput,
} from "./common";
import { toProviderJsonSchema } from "./schema";

/**
 * Models whose safety classifiers can decline a request, for which Anthropic's
 * guidance is to opt in to server-side fallback on every call. With
 * `fallbacks: "default"` the API picks the fallback model by refusal category,
 * so there is no model list to maintain here.
 */
export const FALLBACK_MODELS: ReadonlySet<string> = new Set([
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The subset of a Message the provider reads. Lets tests inject a fake client. */
export interface AnthropicMessageLike {
  model: string;
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

export interface AnthropicStreamLike {
  finalMessage(): Promise<AnthropicMessageLike>;
}

export interface AnthropicClientLike {
  messages: {
    stream(params: Record<string, unknown>, options?: { signal?: AbortSignal; timeout?: number }): AnthropicStreamLike;
  };
  beta: {
    messages: {
      stream(params: Record<string, unknown>, options?: { signal?: AbortSignal; timeout?: number }): AnthropicStreamLike;
    };
  };
}

export interface AnthropicApiOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected in tests. Defaults to a client built from ANTHROPIC_API_KEY. */
  client?: AnthropicClientLike;
}

const SUPPORTED = ["structured"] as const;

/** Output budget per effort. The docs ask for at least 64000 at xhigh and max. */
function maxTokensFor(effort: string | undefined): number {
  return effort === "xhigh" || effort === "max" ? 64_000 : 16_000;
}

function usageOf(message: AnthropicMessageLike): Usage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cachedInputTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    webSearches: 0,
  };
}

/** Maps SDK errors to kinds, most specific class first. */
export function mapAnthropicError(err: unknown, signal: AbortSignal | undefined): ProviderError {
  if (err instanceof ProviderError) return err;
  if (signal?.aborted || err instanceof APIUserAbortError) {
    return new ProviderError("cancelled", "The Claude API call was cancelled", { cause: err });
  }
  if (err instanceof RateLimitError) {
    return new ProviderError("rate_limited", `Claude API rate limit: ${errorText(err)}`, { retryable: true, cause: err });
  }
  if (err instanceof APIConnectionTimeoutError) {
    return new ProviderError("timeout", "The Claude API call timed out", { retryable: true, cause: err });
  }
  if (err instanceof APIConnectionError) {
    return new ProviderError("transport", `Claude API connection failed: ${errorText(err)}`, { retryable: true, cause: err });
  }
  if (err instanceof AuthenticationError) {
    return new ProviderError("not_configured", "The Claude API rejected ANTHROPIC_API_KEY", { retryable: false, cause: err });
  }
  if (err instanceof APIError) {
    const status = typeof err.status === "number" ? err.status : 0;
    return new ProviderError("transport", `Claude API returned ${status}: ${errorText(err)}`, {
      retryable: status >= 500,
      cause: err,
    });
  }
  return new ProviderError("transport", `Claude API call failed: ${errorText(err)}`, { retryable: false, cause: err });
}

export class AnthropicApiProvider implements ModelProvider {
  readonly id = "anthropic-api" as const;
  private readonly env: NodeJS.ProcessEnv;
  private client: AnthropicClientLike | null;

  constructor(options: AnthropicApiOptions = {}) {
    this.env = options.env ?? process.env;
    this.client = options.client ?? null;
  }

  async status(): Promise<{ configured: boolean; detail: string }> {
    if (this.env.ANTHROPIC_API_KEY) {
      return { configured: true, detail: "ANTHROPIC_API_KEY is set. Calls the Claude API directly." };
    }
    return { configured: false, detail: "Set ANTHROPIC_API_KEY to call the Claude API directly." };
  }

  private getClient(): AnthropicClientLike {
    if (this.client) return this.client;
    const apiKey = this.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ProviderError("not_configured", "ANTHROPIC_API_KEY is not set", { retryable: false });
    // The SDK's stream type is wider than the subset this provider reads.
    this.client = new Anthropic({ apiKey }) as unknown as AnthropicClientLike;
    return this.client;
  }

  async run<T>(req: ProviderRequest<T>): Promise<ProviderResult<T>> {
    requireKind(this.id, req.kind, SUPPORTED);
    const aborted = cancelledIfAborted(req.signal);
    if (aborted) throw aborted;
    const client = this.getClient();
    const started = Date.now();

    let schema: Record<string, unknown>;
    try {
      schema = toProviderJsonSchema(req.schema);
    } catch (err) {
      throw new ProviderError("unsupported", `Schema ${req.schemaName} cannot be sent: ${errorText(err)}`, { cause: err });
    }

    const effort = req.route.effort;
    const params: Record<string, unknown> = {
      model: req.route.model,
      max_tokens: maxTokensFor(effort),
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      output_config: {
        format: { type: "json_schema", schema },
        ...(effort ? { effort } : {}),
      },
    };
    const options = {
      ...(req.signal ? { signal: req.signal } : {}),
      timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS.structured,
    };

    let message: AnthropicMessageLike;
    try {
      if (FALLBACK_MODELS.has(req.route.model)) {
        params.betas = [FALLBACK_BETA];
        params.fallbacks = "default";
        message = await client.beta.messages.stream(params, options).finalMessage();
      } else {
        message = await client.messages.stream(params, options).finalMessage();
      }
    } catch (err) {
      throw mapAnthropicError(err, req.signal);
    }

    const usage = usageOf(message);
    // Cost is estimated only for the model that was asked for. A fallback bills at other rates.
    const costUsd = message.model === req.route.model ? estimateCostUsd(message.model, usage) : null;
    const billing = { usage, costUsd };

    if (message.stop_reason === "refusal") {
      throw new ProviderError("refused", "The Claude API refused this request", billing);
    }
    if (message.stop_reason === "max_tokens") {
      throw new ProviderError("invalid_output", "The output was cut off at max_tokens", billing);
    }

    const text = message.content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("");
    const parsed = parseJsonText(text);
    if (!parsed.ok) {
      throw new ProviderError("invalid_output", `Output is not JSON: ${parsed.error}`, billing);
    }
    const validated = validateOutput(req.schema, parsed.value);
    if (!validated.ok) {
      throw new ProviderError("invalid_output", `Output failed ${req.schemaName}: ${validated.issues}`, billing);
    }

    const trace: TraceTurn[] = [
      { role: "system", content: req.system },
      { role: "user", content: req.prompt },
      { role: "assistant", content: text },
    ];
    return resultOf({
      output: validated.output,
      provider: "anthropic-api",
      model: message.model,
      usage,
      costUsd,
      latencyMs: Date.now() - started,
      trace,
    });
  }
}
