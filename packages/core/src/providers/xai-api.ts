/*
 * Request and response shapes come from xAI docs read on 2026-11-13
 * (docs/research/grok-x-search.md); they remain unverified against the live service.
 */
import { estimateCostUsd, type TraceTurn, type Usage, xPostAuthors, xPostId, xPostIds, xPostUrl, cleanXHandle } from "@agentswarm/shared";
import { z } from "zod";
import { ProviderError, type ModelProvider, type ProviderRequest, type ProviderResult } from "../contracts";
import {
  DEFAULT_TIMEOUT_MS,
  cancelledIfAborted,
  errorText,
  parseJsonText,
  resultOf,
  validateOutput,
} from "./common";
import { toProviderJsonSchema } from "./schema";

const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const TICKS_PER_USD = 10_000_000_000;

const XSearchAnswerSchema = z.object({
  posts: z.array(
    z.object({
      url: z.string().describe("The post's own address"),
      handle: z.string().describe("The account handle without the @"),
      name: z.string().describe("The account's display name"),
      followers: z.number().nullable().describe("The follower count as the account shows it, or null"),
      postedAt: z.string().nullable().describe("The post date as an ISO date, or null"),
      text: z.string().describe("The post's exact words"),
    }),
  ),
});

export interface XaiProviderOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
}

interface JsonObject {
  [key: string]: unknown;
}

interface RequestUsage {
  usage: Usage;
  costUsd: number | null;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function usageOf(raw: unknown): Usage {
  const value = isObject(raw) ? raw : {};
  const details = isObject(value.input_tokens_details) ? value.input_tokens_details : {};
  const serverDetails = isObject(value.server_side_tool_usage_details) ? value.server_side_tool_usage_details : {};
  const input = number(value.input_tokens) ?? 0;
  const cached = number(details.cached_tokens) ?? 0;
  const xSearchCalls = number(serverDetails.x_search_calls);
  const serverCalls = number(value.num_server_side_tools_used);
  return {
    inputTokens: Math.max(0, input - cached),
    outputTokens: number(value.output_tokens) ?? 0,
    cachedInputTokens: cached,
    cacheWriteTokens: 0,
    webSearches: xSearchCalls ?? serverCalls ?? 0,
  };
}

function costOf(response: unknown, model: string, usage: Usage, sentSearchTool: boolean, cap: number | null): number | null {
  const value = isObject(response) && isObject(response.usage) ? response.usage : {};
  const ticks = number(value.cost_in_usd_ticks);
  if (ticks !== null) return ticks / TICKS_PER_USD;

  const details = isObject(value.server_side_tool_usage_details) ? value.server_side_tool_usage_details : {};
  const posts = number(details.x_posts_fetched);
  const users = number(details.x_users_fetched);
  // xAI bills every post a search fetches, and this answer did not say how many. A run's spend
  // cap counts an unknown cost as nothing, so a call that cannot be priced is charged at the cap
  // it was given: too much, never nothing.
  if (sentSearchTool && (posts === null || users === null)) return cap;

  const tokenCost = estimateCostUsd(model, usage);
  if (tokenCost === null) return null;
  return tokenCost + (posts ?? 0) * 0.005 + (users ?? 0) * 0.01;
}

function billing(response: unknown, model: string, sentSearchTool: boolean, cap: number | null): RequestUsage {
  const usageRaw = isObject(response) ? response.usage : undefined;
  const usage = usageOf(usageRaw);
  return { usage, costUsd: costOf(response, model, usage, sentSearchTool, cap) };
}

function citationsOf(response: JsonObject): string[] {
  const cited = new Set<string>();
  if (Array.isArray(response.citations)) {
    for (const url of response.citations) if (typeof url === "string") cited.add(url);
  }
  if (!Array.isArray(response.output)) return [...cited];
  for (const item of response.output) {
    if (!isObject(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const block of item.content) {
      if (!isObject(block) || block.type !== "output_text" || !Array.isArray(block.annotations)) continue;
      for (const annotation of block.annotations) {
        if (isObject(annotation) && annotation.type === "url_citation" && typeof annotation.url === "string") {
          cited.add(annotation.url);
        }
      }
    }
  }
  return [...cited];
}

function answerText(response: JsonObject): string | null {
  if (!Array.isArray(response.output)) return null;
  const parts: string[] = [];
  for (const item of response.output) {
    if (!isObject(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const block of item.content) {
      if (isObject(block) && block.type === "output_text" && typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

function mapFetchError(err: unknown, signal: AbortSignal | undefined, timedOut: boolean): ProviderError {
  if (signal?.aborted) return new ProviderError("cancelled", "The model call was cancelled", { cause: err });
  if (timedOut) return new ProviderError("timeout", "The model call timed out", { retryable: true, cause: err });
  return new ProviderError("transport", `Connection failed: ${errorText(err)}`, { retryable: true, cause: err });
}

/**
 * A search that ran out of time may already have fetched posts, which xAI bills, and no price
 * comes back. It is charged at the cap it was given, which also ends the blind retry of a paid
 * call. A request xAI refused or failed outright, with no usage, is not taken as spend.
 */
function unpriced(error: ProviderError, sentSearchTool: boolean, cap: number | null): ProviderError {
  if (error.kind !== "timeout" || !sentSearchTool || cap === null) return error;
  return new ProviderError(error.kind, error.message, { retryable: error.retryable, costUsd: cap, cause: error.cause });
}

function withBilling(error: ProviderError, response: unknown, model: string, sentSearchTool: boolean, cap: number | null): ProviderError {
  if (!isObject(response) || !isObject(response.usage)) return error;
  const { usage, costUsd } = billing(response, model, sentSearchTool, cap);
  return new ProviderError(error.kind, error.message, {
    retryable: error.retryable,
    usage,
    costUsd,
    cause: error.cause,
  });
}

function schemaFor(req: ProviderRequest<unknown>): { name: string; schema: Record<string, unknown> } {
  const schema = req.kind === "search" ? XSearchAnswerSchema : req.schema;
  const name = req.kind === "search" ? "XSearchPosts" : req.schemaName;
  try {
    return { name, schema: toProviderJsonSchema(schema) };
  } catch (err) {
    throw new ProviderError("unsupported", `Schema ${name} cannot be sent: ${errorText(err)}`, { cause: err });
  }
}

function xSearchTool(req: ProviderRequest<unknown>): JsonObject | null {
  const scope = req.x;
  if (!scope) return null;
  return {
    type: "x_search",
    ...(scope.handles.length > 0 ? { allowed_x_handles: scope.handles.slice(0, 20) } : {}),
    ...(scope.fromDate !== null ? { from_date: scope.fromDate } : {}),
    ...(scope.toDate !== null ? { to_date: scope.toDate } : {}),
    enable_image_understanding: scope.media,
    enable_video_understanding: scope.media,
  };
}

function outputForSearch(
  value: unknown,
  cited: readonly string[],
  request: ProviderRequest<unknown>,
): { hits: Array<{ url: string; title: string; snippet: string }> } {
  const parsed = XSearchAnswerSchema.safeParse(value);
  if (!parsed.success) throw new ProviderError("invalid_output", `Output failed XSearchPosts: ${parsed.error.message}`);

  const scope = request.x;
  if (!scope) throw new ProviderError("unsupported", "xai-api search requires an X scope");
  if (scope.limit !== null && scope.limit <= 0) return { hits: [] };
  const citedIds = xPostIds(cited);
  const citedAuthors = xPostAuthors(cited);
  const seen = new Set<string>();
  const hits: Array<{ url: string; title: string; snippet: string }> = [];
  for (const post of parsed.data.posts) {
    const id = xPostId(post.url);
    const handle = cleanXHandle(post.handle);
    if (!id || !citedIds.has(id) || !handle || seen.has(id)) continue;
    // Where xAI's own address for the post names its account, that account wrote it. An answer
    // that gives the post to someone else is dropped.
    const author = citedAuthors.get(id);
    if (author && author !== handle) continue;
    if (scope.maxFollowers !== null && (post.followers === null || post.followers > scope.maxFollowers)) continue;
    seen.add(id);
    hits.push({
      url: xPostUrl(id, handle),
      title: `${post.name} (@${handle})`,
      snippet: `${post.postedAt ? `Posted ${post.postedAt}. ` : ""}${post.text}`,
    });
    if (scope.limit !== null && hits.length >= scope.limit) break;
  }
  return { hits };
}

export function createXaiProvider(options: XaiProviderOptions = {}): ModelProvider {
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? globalThis.fetch;
  const provider: ModelProvider = {
    id: "xai-api",

    async status() {
      if (!env.XAI_API_KEY) return { configured: false, detail: "Set XAI_API_KEY to call the xAI API." };
      return { configured: true, detail: "XAI_API_KEY is set. Calls the xAI Responses API." };
    },

    async run<T>(req: ProviderRequest<T>): Promise<ProviderResult<T>> {
      if (req.kind === "repo_review") {
        throw new ProviderError("unsupported", "xai-api does not run repo_review jobs");
      }
      if ((req.kind === "research" || req.kind === "search") && !req.x) {
        throw new ProviderError("unsupported", "xAI research and search require an X scope");
      }
      if (!env.XAI_API_KEY) throw new ProviderError("not_configured", "Set XAI_API_KEY to call the xAI API.");
      const alreadyAborted = cancelledIfAborted(req.signal);
      if (alreadyAborted) throw alreadyAborted;

      const { name, schema } = schemaFor(req as ProviderRequest<unknown>);
      const searchTool = xSearchTool(req as ProviderRequest<unknown>);
      const effort = req.route.effort === "max" ? "xhigh" : req.route.effort;
      const body: JsonObject = {
        model: req.route.model,
        input: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
        store: false,
        text: { format: { type: "json_schema", name, strict: true, schema } },
        ...(effort ? { reasoning: { effort } } : {}),
        ...(searchTool
          ? {
              tools: [searchTool],
              include: ["no_inline_citations"],
              // xAI exposes max_turns as the only bound on tool work; req.maxBudgetUsd cannot be enforced.
              max_turns: req.kind === "search" ? 4 : 6,
            }
          : {}),
      };

      const controller = new AbortController();
      let timedOut = false;
      const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS[req.kind];
      const onAbort = () => controller.abort(req.signal?.reason);
      req.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const started = Date.now();
      const endpoint = `${(env.XAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")}/responses`;
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.XAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", onAbort);
        throw unpriced(mapFetchError(err, req.signal, timedOut), !!searchTool, req.maxBudgetUsd ?? null);
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch (err) {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", onAbort);
        if (req.signal?.aborted || timedOut) throw unpriced(mapFetchError(err, req.signal, timedOut), !!searchTool, req.maxBudgetUsd ?? null);
        const failed = response.ok
          ? new ProviderError("invalid_output", `The endpoint did not return JSON: ${errorText(err)}`)
          : httpError(response.status, "");
        throw failed;
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", onAbort);
      }
      const responseObject = isObject(raw) ? raw : {};
      const model = typeof responseObject.model === "string" ? responseObject.model : req.route.model;
      if (!response.ok) {
        throw withBilling(httpError(response.status, httpErrorMessage(responseObject)), responseObject, model, !!searchTool, req.maxBudgetUsd ?? null);
      }

      const { usage, costUsd } = billing(responseObject, model, !!searchTool, req.maxBudgetUsd ?? null);
      const cited = citationsOf(responseObject);
      const text = answerText(responseObject);
      const trace: TraceTurn[] = [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ];
      if (text !== null) trace.push({ role: "assistant", content: text });
      const invalid = (message: string): ProviderError => new ProviderError("invalid_output", message, { usage, costUsd });
      if (text === null) throw invalid("The endpoint returned no output_text content");
      const parsed = parseJsonText(text);
      if (!parsed.ok) throw invalid(`Output is not JSON: ${parsed.error}`);

      let outputValue: unknown = parsed.value;
      if (req.kind === "search") {
        try {
          outputValue = outputForSearch(parsed.value, cited, req as ProviderRequest<unknown>);
        } catch (err) {
          if (err instanceof ProviderError) {
            throw new ProviderError(err.kind, err.message, { retryable: err.retryable, usage, costUsd, cause: err.cause });
          }
          throw invalid(`Output failed XSearchPosts: ${errorText(err)}`);
        }
      }
      const validated = validateOutput(req.schema, outputValue);
      if (!validated.ok) throw invalid(`Output failed ${req.schemaName}: ${validated.issues}`);

      return {
        ...resultOf({
          output: validated.output,
          provider: "xai-api",
          model,
          usage,
          costUsd,
          latencyMs: Date.now() - started,
          trace,
        }),
        cited,
      };
    },
  };
  return provider;
}

function httpError(status: number, message: string): ProviderError {
  if (status === 401) {
    return new ProviderError("not_configured", "The xAI endpoint rejected its API key", { retryable: false });
  }
  if (status === 429) return new ProviderError("rate_limited", `Rate limited: ${message || "request quota exceeded"}`, { retryable: true });
  return new ProviderError("transport", `Endpoint returned ${status}${message ? `: ${message}` : ""}`, {
    retryable: status >= 500,
  });
}

function httpErrorMessage(response: JsonObject): string {
  const error = response.error;
  if (typeof error === "string") return error;
  if (isObject(error) && typeof error.message === "string") return error.message;
  if (typeof response.message === "string") return response.message;
  return "";
}
