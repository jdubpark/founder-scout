import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type TraceTurn, type Usage } from "@agentswarm/shared";
import { ProviderError, type ModelProvider, type ProviderRequest, type ProviderResult } from "../contracts";
import {
  DEFAULT_TIMEOUT_MS,
  cancelledIfAborted,
  errorText,
  requireKind,
  resultOf,
  truncate,
  validateOutput,
  type JobKindName,
} from "./common";
import { scrubEnv } from "./env";
import { toProviderJsonSchema } from "./schema";
import { findOnPath, runProcess, type ProcessOutcome, type ProcessRunner } from "./subprocess";

type JsonObject = Record<string, unknown>;

/** Tools a research call may use: web search and page fetch only. */
export const RESEARCH_TOOLS = ["WebSearch", "WebFetch"] as const;
/** Tools a repository review may use: read and search only. */
export const REVIEW_TOOLS = ["Read", "Grep", "Glob"] as const;
/** Named explicitly as a second line of defence against any tool the set above might grow. */
export const REVIEW_DENIED_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Agent"] as const;

/** Environment variables the headless Claude process keeps. Everything else that looks like a secret is dropped. */
export const CLAUDE_ENV_PREFIXES = ["ANTHROPIC_", "CLAUDE_"] as const;

/**
 * Claude Code can also sign in through a cloud provider, and then it needs that provider's
 * credentials. They are kept only when the environment says that route is in use.
 */
export function claudeEnvPrefixes(env: NodeJS.ProcessEnv): string[] {
  const prefixes: string[] = [...CLAUDE_ENV_PREFIXES];
  if (env.CLAUDE_CODE_USE_BEDROCK) prefixes.push("AWS_");
  if (env.CLAUDE_CODE_USE_VERTEX) prefixes.push("GOOGLE_", "GCLOUD_", "CLOUD_ML_", "VERTEX_");
  return prefixes;
}

export interface ClaudeInvocation {
  kind: JobKindName;
  model: string;
  effort: string | null;
  maxBudgetUsd: number | null;
  system: string;
  schemaJson: string;
  /** Absolute path of the checkout, for repo_review only. */
  repoDir: string | null;
  /** stream-json gives the trace its tool calls. Used for research and repo_review. */
  streaming: boolean;
}

/**
 * The exact argument list for one headless call. Stdin carries the user prompt.
 *
 * - `--setting-sources project` with an empty working directory drops the user's
 *   settings, hooks and memory. `--strict-mcp-config` with no `--mcp-config` drops MCP.
 * - `--restricted` ignores project and local settings files, including a checkout's
 *   `.claude/settings.json`, and confines file tools to the working directory and
 *   `--add-dir`.
 */
export function buildClaudeArgs(inv: ClaudeInvocation): string[] {
  const args = ["-p", "--model", inv.model, "--output-format", inv.streaming ? "stream-json" : "json"];
  if (inv.streaming) args.push("--verbose");
  if (inv.kind !== "search") args.push("--json-schema", inv.schemaJson);
  if (inv.effort) args.push("--effort", inv.effort);
  if (inv.maxBudgetUsd !== null) args.push("--max-budget-usd", String(inv.maxBudgetUsd));
  args.push(
    "--system-prompt",
    inv.system,
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
  );

  switch (inv.kind) {
    case "structured":
      args.push("--tools", "");
      break;
    case "research":
      args.push(
        "--tools",
        RESEARCH_TOOLS.join(","),
        "--allowedTools",
        RESEARCH_TOOLS.join(","),
      );
      break;
    case "search":
      args.push("--tools", "WebSearch", "--allowedTools", "WebSearch");
      break;
    case "repo_review":
      if (!inv.repoDir) throw new Error("repo_review needs a checkout directory");
      args.push(
        "--tools",
        REVIEW_TOOLS.join(","),
        "--allowedTools",
        REVIEW_TOOLS.join(","),
        "--disallowedTools",
        REVIEW_DENIED_TOOLS.join(","),
        "--restricted",
        // Variadic, so it stays last.
        "--add-dir",
        inv.repoDir,
      );
      break;
    default:
      throw new Error(`claude-cli does not run ${inv.kind} jobs`);
  }
  return args;
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const obj = asObject(part);
        return obj && typeof obj.text === "string" ? obj.text : JSON.stringify(part);
      })
      .join("\n");
  }
  return JSON.stringify(content) ?? "";
}

/** Reads a stream-json transcript: tool calls and results for the trace, and the final result event. */
export function parseClaudeStream(stdout: string): { result: JsonObject | null; tools: TraceTurn[] } {
  let result: JsonObject | null = null;
  const tools: TraceTurn[] = [];
  const nameById = new Map<string, string>();

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: JsonObject | null;
    try {
      event = asObject(JSON.parse(trimmed));
    } catch {
      continue;
    }
    if (!event) continue;

    if (event.type === "result") {
      result = event;
      continue;
    }
    const message = asObject(event.message);
    const blocks = Array.isArray(message?.content) ? message.content : [];
    if (event.type === "assistant") {
      for (const raw of blocks) {
        const block = asObject(raw);
        if (block?.type !== "tool_use" || typeof block.name !== "string") continue;
        if (typeof block.id === "string") nameById.set(block.id, block.name);
        if (block.name === "StructuredOutput") continue;
        tools.push({ role: "tool_call", name: block.name, content: truncate(JSON.stringify(block.input ?? {})) });
      }
    } else if (event.type === "user") {
      for (const raw of blocks) {
        const block = asObject(raw);
        if (block?.type !== "tool_result") continue;
        const name = typeof block.tool_use_id === "string" ? nameById.get(block.tool_use_id) : undefined;
        if (name === "StructuredOutput") continue;
        tools.push({
          role: "tool_result",
          ...(name ? { name } : {}),
          content: truncate(contentText(block.content)),
        });
      }
    }
  }
  return { result, tools };
}

function linksFromText(value: string): Array<{ url: string; title: string; snippet: string }> {
  const marker = value.indexOf("Links:");
  if (marker < 0) return [];
  const start = value.indexOf("[", marker + "Links:".length);
  if (start < 0) return [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < value.length; i += 1) {
    const char = value[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) {
      try {
        return hitsFromLinks(JSON.parse(value.slice(start, i + 1)));
      } catch {
        return [];
      }
    }
  }
  return [];
}

function hitsFromLinks(value: unknown): Array<{ url: string; title: string; snippet: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const link = asObject(entry);
    return link && typeof link.url === "string" && typeof link.title === "string"
      ? [{ url: link.url, title: link.title, snippet: "" }]
      : [];
  });
}

/** Only URLs inside a WebSearch tool result can become hits. Assistant prose is never parsed. */
function searchHitsFromStream(stdout: string): Array<{ url: string; title: string; snippet: string }> {
  const hits: Array<{ url: string; title: string; snippet: string }> = [];
  for (const line of stdout.split("\n")) {
    let event: JsonObject | null;
    try { event = asObject(JSON.parse(line.trim())); } catch { continue; }
    if (!event || event.type !== "user") continue;
    const toolUse = asObject(event.tool_use_result);
    if (toolUse && Array.isArray(toolUse.results)) {
      for (const result of toolUse.results) {
        const item = asObject(result);
        if (item && Array.isArray(item.content)) hits.push(...hitsFromLinks(item.content));
        else if (typeof result === "string") hits.push(...linksFromText(result));
      }
    }
    const message = asObject(event.message);
    if (message && Array.isArray(message.content)) {
      for (const part of message.content) {
        const item = asObject(part);
        if (item?.type === "tool_result" && typeof item.content === "string") hits.push(...linksFromText(item.content));
      }
    }
  }
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.url)) return false;
    seen.add(hit.url);
    return true;
  });
}

/** Reads the usage fields of a result event into the shared Usage type. */
export function claudeUsage(result: JsonObject): Usage {
  const usage = asObject(result.usage) ?? {};
  const modelUsage = asObject(result.modelUsage) ?? {};
  let webSearches = 0;
  for (const entry of Object.values(modelUsage)) {
    webSearches += numberOr(asObject(entry)?.webSearchRequests, 0);
  }
  if (webSearches === 0) {
    webSearches = numberOr(asObject(usage.server_tool_use)?.web_search_requests, 0);
  }
  return {
    // input_tokens is uncached input. Cache reads and writes are separate fields.
    inputTokens: numberOr(usage.input_tokens, 0),
    outputTokens: numberOr(usage.output_tokens, 0),
    cachedInputTokens: numberOr(usage.cache_read_input_tokens, 0),
    cacheWriteTokens: numberOr(usage.cache_creation_input_tokens, 0),
    webSearches,
  };
}

/** The served model is the modelUsage key with the largest cost. Never the requested id. */
function servedModel(result: JsonObject): string | null {
  const modelUsage = asObject(result.modelUsage) ?? {};
  let best: { model: string; cost: number } | null = null;
  for (const [model, entry] of Object.entries(modelUsage)) {
    const cost = numberOr(asObject(entry)?.costUSD, 0);
    if (best === null || cost > best.cost) best = { model, cost };
  }
  return best?.model ?? null;
}

interface Billed {
  usage: Usage;
  costUsd: number | null;
}

function billedOf(result: JsonObject): Billed {
  return {
    usage: claudeUsage(result),
    costUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
  };
}

export interface ClaudeCliOptions {
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
}

export class ClaudeCliProvider implements ModelProvider {
  readonly id = "claude-cli" as const;
  private readonly env: NodeJS.ProcessEnv;
  private readonly runner: ProcessRunner;

  constructor(options: ClaudeCliOptions = {}) {
    this.env = options.env ?? process.env;
    this.runner = options.runner ?? runProcess;
  }

  async status(): Promise<{ configured: boolean; detail: string }> {
    const path = await findOnPath("claude", this.env);
    if (!path) {
      return {
        configured: false,
        detail: "claude is not on PATH. Install Claude Code, or set ANTHROPIC_API_KEY and use the Claude API provider.",
      };
    }
    return {
      configured: true,
      detail: "Found claude on PATH. Uses the existing Claude Code login, or ANTHROPIC_API_KEY when that is set.",
    };
  }

  async run<T>(req: ProviderRequest<T>): Promise<ProviderResult<T>> {
    requireKind(this.id, req.kind, ["structured", "research", "search", "repo_review"]);
    const repoDir = req.kind === "repo_review" ? req.repoDir : null;
    if (req.kind === "repo_review" && !repoDir) {
      throw new ProviderError("unsupported", "repo_review needs a checkout directory");
    }
    const aborted = cancelledIfAborted(req.signal);
    if (aborted) throw aborted;

    const started = Date.now();
    const workdir = await mkdtemp(join(tmpdir(), "agentswarm-claude-"));
    try {
      let schemaJson = "{}";
      if (req.kind !== "search") {
        try {
          schemaJson = JSON.stringify(toProviderJsonSchema(req.schema));
        } catch (err) {
          throw new ProviderError("unsupported", `Schema ${req.schemaName} cannot be sent: ${errorText(err)}`, { cause: err });
        }
      }

      const args = buildClaudeArgs({
        kind: req.kind,
        model: req.route.model,
        effort: req.route.effort ?? null,
        maxBudgetUsd: req.maxBudgetUsd ?? null,
        system: req.system,
        schemaJson,
        repoDir: repoDir ? resolve(repoDir) : null,
        streaming: req.kind !== "structured",
      });

      const outcome = await this.runner({
        command: "claude",
        args,
        cwd: workdir,
        env: scrubEnv(this.env, claudeEnvPrefixes(this.env)),
        stdin: req.prompt,
        timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS[req.kind],
        signal: req.signal,
      });
      return interpret(req, outcome, Date.now() - started);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
}

function interpret<T>(req: ProviderRequest<T>, outcome: ProcessOutcome, latencyMs: number): ProviderResult<T> {
  if (outcome.spawnError) {
    const notFound = /ENOENT/.test(outcome.spawnError);
    throw new ProviderError(
      notFound ? "not_configured" : "transport",
      notFound ? "claude is not on PATH" : `claude could not start: ${outcome.spawnError}`,
    );
  }
  if (outcome.timedOut) throw new ProviderError("timeout", `claude did not finish within ${req.timeoutMs ?? DEFAULT_TIMEOUT_MS[req.kind]} ms`);
  if (outcome.cancelled) throw new ProviderError("cancelled", "claude call was cancelled");

  // Structured calls print one JSON document. Streamed calls print one JSON event per line.
  let result: JsonObject | null = null;
  let tools: TraceTurn[] = [];
  if (req.kind === "structured") {
    const whole = outcome.stdout.trim();
    const lastLine = whole.split("\n").at(-1) ?? "";
    for (const candidate of [whole, lastLine]) {
      try {
        const parsed = asObject(JSON.parse(candidate));
        if (parsed) {
          result = parsed;
          break;
        }
      } catch {
        // Try the next candidate.
      }
    }
  } else {
    const parsedStream = parseClaudeStream(outcome.stdout);
    result = parsedStream.result;
    tools = parsedStream.tools;
  }

  if (!result) {
    throw new ProviderError(
      "transport",
      `claude exited with code ${outcome.exitCode ?? "none"} and printed no result: ${truncate(outcome.stderr.trim(), 500)}`,
    );
  }

  const billed = billedOf(result);
  const billing = { usage: billed.usage, costUsd: billed.costUsd };
  const reason = typeof result.result === "string" ? truncate(result.result, 500) : "";

  if (result.stop_reason === "refusal") {
    throw new ProviderError("refused", "The model refused this request", billing);
  }
  if (result.is_error === true || result.subtype !== "success") {
    const subtype = typeof result.subtype === "string" ? result.subtype : "unknown";
    if (subtype.includes("budget")) throw new ProviderError("budget", `claude stopped at its budget (${subtype})`, billing);
    if (result.api_error_status === 429) throw new ProviderError("rate_limited", "claude was rate limited", billing);
    throw new ProviderError("transport", `claude returned ${subtype}: ${reason}`, billing);
  }

  const model = servedModel(result);
  if (model === null) {
    throw new ProviderError("invalid_output", "claude reported no served model", billing);
  }
  if (req.kind === "search") {
    const requestedLimit = /<result_limit>\s*(\d+)\s*<\/result_limit>/u.exec(req.prompt)?.[1];
    const limit = requestedLimit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Number(requestedLimit));
    const output = { hits: searchHitsFromStream(outcome.stdout).slice(0, limit) };
    const validatedSearch = validateOutput(req.schema, output);
    if (!validatedSearch.ok) {
      throw new ProviderError("invalid_output", `Output failed ${req.schemaName}: ${validatedSearch.issues}`, billing);
    }
    const trace: TraceTurn[] = [
      { role: "system", content: req.system },
      { role: "user", content: req.prompt },
      ...tools,
      { role: "assistant", content: JSON.stringify(validatedSearch.output) },
    ];
    return resultOf({ output: validatedSearch.output, provider: "claude-cli", model, usage: billed.usage, costUsd: billed.costUsd, latencyMs, trace });
  }
  if (result.structured_output === undefined || result.structured_output === null) {
    throw new ProviderError("invalid_output", "claude returned no structured output", billing);
  }
  const validated = validateOutput(req.schema, result.structured_output);
  if (!validated.ok) {
    throw new ProviderError("invalid_output", `Output failed ${req.schemaName}: ${validated.issues}`, billing);
  }

  const trace: TraceTurn[] = [
    { role: "system", content: req.system },
    { role: "user", content: req.prompt },
    ...tools,
    { role: "assistant", content: JSON.stringify(validated.output) },
  ];
  return resultOf({
    output: validated.output,
    provider: "claude-cli",
    model,
    usage: billed.usage,
    costUsd: billed.costUsd,
    latencyMs,
    trace,
  });
}

