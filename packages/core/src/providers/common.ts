import type { z } from "zod";
import {
  ProviderError,
  type ProviderRequest,
  type ProviderResult,
} from "../contracts";
import type { ProviderId, TraceTurn, Usage } from "@agentswarm/shared";
import { ZERO_USAGE } from "@agentswarm/shared";

export type JobKindName = ProviderRequest<unknown>["kind"];

/** Default wall-clock limits per kind. Requests may override with timeoutMs. */
export const DEFAULT_TIMEOUT_MS: Record<JobKindName, number> = {
  structured: 180_000,
  research: 600_000,
  search: 120_000,
  repo_review: 900_000,
};

/** Tool inputs and results in a trace are cut to this many characters. */
export const TRACE_TEXT_LIMIT = 2_000;

export function truncate(text: string, limit = TRACE_TEXT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… [truncated, ${text.length - limit} more characters]`;
}

export function zeroUsage(): Usage {
  return { ...ZERO_USAGE };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearches: a.webSearches + b.webSearches,
  };
}

/** Sums known costs. Any unknown cost makes the total unknown. */
export function sumCost(values: ReadonlyArray<number | null>): number | null {
  let total = 0;
  for (const v of values) {
    if (v === null) return null;
    total += v;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The engine retries only retryable kinds; a cancelled request is never retried. */
export function requireKind(
  provider: ProviderId,
  kind: JobKindName,
  supported: readonly JobKindName[],
): void {
  if (!supported.includes(kind)) {
    throw new ProviderError("unsupported", `${provider} does not run ${kind} jobs`);
  }
}

export function formatIssues(error: z.ZodError, limit = 20): string {
  return error.issues
    .slice(0, limit)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export type Validated<T> = { ok: true; output: T } | { ok: false; issues: string };

export function validateOutput<T>(schema: z.ZodType<T>, value: unknown): Validated<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, output: parsed.data };
  return { ok: false, issues: formatIssues(parsed.error) };
}

export type ParsedJson = { ok: true; value: unknown } | { ok: false; error: string };

export function parseJsonText(text: string): ParsedJson {
  const trimmed = text.trim();
  // Models sometimes wrap JSON in a Markdown fence. Strip one fence pair.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

export function resultOf<T>(args: {
  output: T;
  provider: ProviderId;
  model: string;
  usage: Usage;
  costUsd: number | null;
  latencyMs: number;
  trace: TraceTurn[];
}): ProviderResult<T> {
  return {
    output: args.output,
    provider: args.provider,
    model: args.model,
    usage: args.usage,
    costUsd: args.costUsd,
    latencyMs: args.latencyMs,
    trace: args.trace,
  };
}

/** Maps an abort signal that fired to the cancelled kind, else null. */
export function cancelledIfAborted(signal: AbortSignal | undefined): ProviderError | null {
  if (signal?.aborted) return new ProviderError("cancelled", "The call was cancelled");
  return null;
}
