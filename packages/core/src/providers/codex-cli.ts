import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EFFORTS, estimateCostUsd, type TraceTurn, type Usage } from "@agentswarm/shared";
import { ProviderError, type ModelProvider, type ProviderRequest, type ProviderResult } from "../contracts";
import {
  DEFAULT_TIMEOUT_MS,
  cancelledIfAborted,
  errorText,
  parseJsonText,
  requireKind,
  resultOf,
  truncate,
  validateOutput,
  zeroUsage,
  type JobKindName,
} from "./common";
import { scrubEnv } from "./env";
import { toProviderJsonSchema } from "./schema";
import { findOnPath, runProcess, type ProcessOutcome, type ProcessRunner } from "./subprocess";

type JsonObject = Record<string, unknown>;

export interface CodexInvocation {
  model: string;
  effort: string | null;
  schemaPath: string;
  lastMessagePath: string;
  /** Absolute checkout path for repo_review. Null for structured calls. */
  repoDir: string | null;
}

/**
 * The argument list for one headless Codex run. The prompt arrives on stdin
 * (the trailing `-`). Hooks, plugins and memories are switched off so no
 * user or repository hook can run during the call.
 */
export function buildCodexArgs(inv: CodexInvocation): string[] {
  const args = [
    "exec",
    "--json",
    "--output-schema",
    inv.schemaPath,
    "-o",
    inv.lastMessagePath,
    "-m",
    inv.model,
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--disable",
    "hooks",
    "--disable",
    "plugins",
    "--disable",
    "memories",
  ];
  if (inv.effort) args.push("-c", `model_reasoning_effort="${inv.effort}"`);
  if (inv.repoDir) args.push("-C", inv.repoDir);
  args.push("-");
  return args;
}

/** The text sent on stdin. Codex has no system-prompt flag, so the system text goes first under a heading. */
export function codexPrompt(system: string, prompt: string): string {
  return `# System instructions\n\n${system}\n\n# Task\n\n${prompt}`;
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Codex reports input_tokens including the cached part, so the uncached input
 * is the difference. Usage is summed across turns.
 */
export function codexUsage(raw: JsonObject): Usage {
  const input = num(raw.input_tokens);
  const cached = num(raw.cached_input_tokens);
  return {
    inputTokens: Math.max(0, input - cached),
    outputTokens: num(raw.output_tokens),
    cachedInputTokens: cached,
    cacheWriteTokens: num(raw.cache_write_input_tokens),
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

export interface CodexEvents {
  usage: Usage | null;
  /** The last agent message text, used only when the -o file is missing. */
  lastMessage: string | null;
  /** A `model` field if any event carries one. Codex output did not carry one in testing. */
  model: string | null;
  /** Set by `turn.failed`. This ends the call. */
  turnFailure: string | null;
  /** Set by a top-level `error` event. Codex can emit these during a turn that still completes. */
  errorEvent: string | null;
  tools: TraceTurn[];
}

/** Reads the JSONL event stream. Unknown events are skipped. */
export function parseCodexEvents(stdout: string): CodexEvents {
  const out: CodexEvents = {
    usage: null,
    lastMessage: null,
    model: null,
    turnFailure: null,
    errorEvent: null,
    tools: [],
  };
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

    if (out.model === null) {
      const item = asObject(event.item);
      const candidate = typeof event.model === "string" ? event.model : typeof item?.model === "string" ? item.model : null;
      if (candidate) out.model = candidate;
    }

    if (event.type === "turn.completed") {
      const usage = codexUsage(asObject(event.usage) ?? {});
      out.usage = out.usage ? addUsage(out.usage, usage) : usage;
    } else if (event.type === "turn.failed") {
      const error = asObject(event.error);
      out.turnFailure = typeof error?.message === "string" ? error.message : "turn failed";
    } else if (event.type === "error" && typeof event.message === "string") {
      out.errorEvent = out.errorEvent ?? event.message;
    } else if (event.type === "item.completed") {
      const item = asObject(event.item);
      if (!item) continue;
      if (item.type === "agent_message" && typeof item.text === "string") {
        out.lastMessage = item.text;
      } else if (item.type === "command_execution") {
        const command = typeof item.command === "string" ? item.command : "";
        const output = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
        out.tools.push({ role: "tool_call", name: "shell", content: truncate(command) });
        out.tools.push({ role: "tool_result", name: "shell", content: truncate(output) });
      }
    }
  }
  return out;
}

export interface CodexCliOptions {
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
}

const SUPPORTED: readonly JobKindName[] = ["structured", "repo_review"];

/** Environment variables the headless Codex process keeps. Everything else that looks like a secret is dropped. */
export const CODEX_ENV_PREFIXES = ["OPENAI_", "CODEX_"] as const;

export class CodexCliProvider implements ModelProvider {
  readonly id = "codex-cli" as const;
  private readonly env: NodeJS.ProcessEnv;
  private readonly runner: ProcessRunner;

  constructor(options: CodexCliOptions = {}) {
    this.env = options.env ?? process.env;
    this.runner = options.runner ?? runProcess;
  }

  async status(): Promise<{ configured: boolean; detail: string }> {
    const path = await findOnPath("codex", this.env);
    if (!path) {
      return {
        configured: false,
        detail: "codex is not on PATH. Install Codex, or set OPENAI_API_KEY and use the OpenAI API provider.",
      };
    }
    return {
      configured: true,
      detail: "Found codex on PATH. Uses the existing Codex login, or OPENAI_API_KEY when that is set.",
    };
  }

  async run<T>(req: ProviderRequest<T>): Promise<ProviderResult<T>> {
    requireKind(this.id, req.kind, SUPPORTED);
    const repoDir = req.kind === "repo_review" ? req.repoDir : null;
    if (req.kind === "repo_review" && !repoDir) {
      throw new ProviderError("unsupported", "repo_review needs a checkout directory");
    }
    const effort = req.route.effort ?? null;
    if (effort !== null && !(EFFORTS as readonly string[]).includes(effort)) {
      throw new ProviderError("unsupported", `Unknown effort ${effort}`);
    }
    const aborted = cancelledIfAborted(req.signal);
    if (aborted) throw aborted;

    const started = Date.now();
    const workdir = await mkdtemp(join(tmpdir(), "agentswarm-codex-"));
    try {
      const schemaPath = join(workdir, "schema.json");
      const lastMessagePath = join(workdir, "last-message.json");
      let schemaJson: string;
      try {
        schemaJson = JSON.stringify(toProviderJsonSchema(req.schema));
      } catch (err) {
        throw new ProviderError("unsupported", `Schema ${req.schemaName} cannot be sent: ${errorText(err)}`, { cause: err });
      }
      await writeFile(schemaPath, schemaJson, "utf8");

      const args = buildCodexArgs({
        model: req.route.model,
        effort,
        schemaPath,
        lastMessagePath,
        repoDir: repoDir ? resolve(repoDir) : null,
      });
      const outcome = await this.runner({
        command: "codex",
        args,
        cwd: workdir,
        env: scrubEnv(this.env, CODEX_ENV_PREFIXES),
        stdin: codexPrompt(req.system, req.prompt),
        timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS[req.kind],
        signal: req.signal,
      });
      const finalText = await readFinalMessage(lastMessagePath);
      return interpret(req, outcome, finalText, Date.now() - started);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
}

async function readFinalMessage(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, "utf8");
    return text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}

function failure(message: string, billing: { usage: Usage | null; costUsd: number | null }): ProviderError {
  const rateLimited = /rate.?limit|429/i.test(message);
  return new ProviderError(rateLimited ? "rate_limited" : "transport", `codex failed: ${truncate(message, 500)}`, billing);
}

function interpret<T>(
  req: ProviderRequest<T>,
  outcome: ProcessOutcome,
  finalText: string | null,
  latencyMs: number,
): ProviderResult<T> {
  if (outcome.spawnError) {
    const notFound = /ENOENT/.test(outcome.spawnError);
    throw new ProviderError(
      notFound ? "not_configured" : "transport",
      notFound ? "codex is not on PATH" : `codex could not start: ${outcome.spawnError}`,
    );
  }
  if (outcome.timedOut) throw new ProviderError("timeout", `codex did not finish within ${req.timeoutMs ?? DEFAULT_TIMEOUT_MS[req.kind]} ms`);
  if (outcome.cancelled) throw new ProviderError("cancelled", "codex call was cancelled");

  const events = parseCodexEvents(outcome.stdout);
  const billing = { usage: events.usage, costUsd: null };
  if (events.turnFailure !== null) {
    throw failure(events.turnFailure, billing);
  }
  const text = finalText ?? events.lastMessage;
  if (text === null) {
    if (events.errorEvent !== null) throw failure(events.errorEvent, billing);
    throw new ProviderError(
      "transport",
      `codex exited with code ${outcome.exitCode ?? "none"} and gave no final message: ${truncate(outcome.stderr.trim(), 500)}`,
      billing,
    );
  }
  const usage = events.usage ?? zeroUsage();

  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new ProviderError("invalid_output", `Final message is not JSON: ${parsed.error}`, billing);
  }
  const validated = validateOutput(req.schema, parsed.value);
  if (!validated.ok) {
    throw new ProviderError("invalid_output", `Output failed ${req.schemaName}: ${validated.issues}`, billing);
  }

  // Codex events did not name the served model in testing. The requested id is
  // used then, and the report says so.
  const model = events.model ?? req.route.model;
  const costUsd = estimateCostUsd(model, usage);

  const trace: TraceTurn[] = [
    { role: "system", content: req.system },
    { role: "user", content: req.prompt },
    ...events.tools,
    { role: "assistant", content: JSON.stringify(validated.output) },
  ];
  return resultOf({
    output: validated.output,
    provider: "codex-cli",
    model,
    usage,
    costUsd,
    latencyMs,
    trace,
  });
}
