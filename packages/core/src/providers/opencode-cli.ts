import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderError, type ModelProvider, type ProviderRequest } from "../contracts";
import {
  DEFAULT_TIMEOUT_MS,
  cancelledIfAborted,
  parseJsonText,
  requireKind,
  resultOf,
  truncate,
  validateOutput,
} from "./common";
import { scrubEnv } from "./env";
import { toProviderJsonSchema } from "./schema";
import { findOnPath, runProcess, type ProcessRunner } from "./subprocess";

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}
function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function buildOpenCodeArgs(model: string, variant: string | null, message: string): string[] {
  const args = ["run", "--pure", "--agent", "plain", "--model", model, "--format", "json"];
  if (variant) args.push("--variant", variant);
  args.push(message);
  return args;
}

function callPrompt<T>(req: ProviderRequest<T>): string {
  const schema = JSON.stringify(toProviderJsonSchema(req.schema));
  return `${req.prompt}\n\nReturn exactly one JSON object matching this JSON Schema. Do not include other text.\n${schema}`;
}

/** Where opencode keeps the vendor logins a person saved with `opencode auth login`. */
function loginFile(env: NodeJS.ProcessEnv): string {
  const dataHome = env.XDG_DATA_HOME?.trim() || join(env.HOME?.trim() || homedir(), ".local", "share");
  return join(dataHome, "opencode", "auth.json");
}

export interface OpenCodeCliOptions {
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
}

export class OpenCodeCliProvider implements ModelProvider {
  readonly id = "opencode-cli" as const;
  private readonly env: NodeJS.ProcessEnv;
  private readonly runner: ProcessRunner;

  constructor(options: OpenCodeCliOptions = {}) {
    this.env = options.env ?? process.env;
    this.runner = options.runner ?? runProcess;
  }

  async status(): Promise<{ configured: boolean; detail: string }> {
    const path = await findOnPath("opencode", this.env);
    if (!path) return { configured: false, detail: "opencode is not on PATH. Install opencode to use its saved vendor logins." };
    // Keys in the environment are removed before a call, so the saved login is the only way in.
    const loggedIn = await access(loginFile(this.env)).then(() => true, () => false);
    return loggedIn
      ? { configured: true, detail: "Found opencode on PATH with a saved login. Calls keep no session in your opencode history." }
      : { configured: false, detail: "opencode has no saved login. Run opencode auth login for DeepSeek or Meta." };
  }

  async run<T>(req: ProviderRequest<T>) {
    requireKind(this.id, req.kind, ["structured"]);
    const aborted = cancelledIfAborted(req.signal);
    if (aborted) throw aborted;

    const started = Date.now();
    const workdir = await mkdtemp(join(tmpdir(), "agentswarm-opencode-"));
    const xdg = await mkdtemp(join(tmpdir(), "agentswarm-opencode-config-"));
    // opencode writes every call into its data folder as a session. The call gets a folder of
    // its own that holds nothing but a link to the saved login, and the folder is deleted
    // afterwards: a page a runner read is not left in the person's opencode history, and the
    // call cannot read their earlier sessions. Checked by running it on 2026-11-13.
    const data = await mkdtemp(join(tmpdir(), "agentswarm-opencode-data-"));
    try {
      await mkdir(join(data, "opencode"));
      await symlink(loginFile(this.env), join(data, "opencode", "auth.json"));
      const config = {
        $schema: "https://opencode.ai/config.json",
        agent: {
          plain: {
            description: "Answers in JSON. No tools.",
            mode: "primary",
            prompt: req.system,
            tools: { "*": false },
          },
        },
      };
      await writeFile(join(workdir, "opencode.json"), JSON.stringify(config), { mode: 0o600 });
      let message: string;
      try {
        message = callPrompt(req);
      } catch (err) {
        throw new ProviderError("unsupported", `Schema ${req.schemaName} cannot be sent: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      }
      const model = req.route.model;
      const meta = model.startsWith("meta/");
      const variant = meta ? req.route.effort ?? "minimal" : null;
      const env = scrubEnv(this.env, []);
      env.XDG_CONFIG_HOME = xdg;
      env.XDG_DATA_HOME = data;
      env.XDG_STATE_HOME = join(data, "state");
      const outcome = await this.runner({
        command: "opencode",
        args: buildOpenCodeArgs(model, variant, message),
        cwd: workdir,
        env,
        stdin: "",
        timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS.structured,
        signal: req.signal,
      });
      return interpret(req, outcome, Date.now() - started);
    } finally {
      await Promise.all([
        rm(workdir, { recursive: true, force: true }),
        rm(xdg, { recursive: true, force: true }),
        // Removes the link, never the login file it points at.
        rm(data, { recursive: true, force: true }),
      ]);
    }
  }
}

function interpret<T>(req: ProviderRequest<T>, outcome: Awaited<ReturnType<ProcessRunner>>, latencyMs: number) {
  if (outcome.spawnError) {
    throw new ProviderError(/ENOENT/.test(outcome.spawnError) ? "not_configured" : "transport", `opencode could not start: ${outcome.spawnError}`);
  }
  if (outcome.timedOut) throw new ProviderError("timeout", `opencode did not finish within ${req.timeoutMs ?? DEFAULT_TIMEOUT_MS.structured} ms`);
  if (outcome.cancelled) throw new ProviderError("cancelled", "opencode call was cancelled");

  let answer = "";
  let finish: JsonObject | null = null;
  let failure: string | null = null;
  for (const line of outcome.stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: JsonObject | null;
    try { event = object(JSON.parse(line)); } catch { continue; }
    if (!event) continue;
    if (event.type === "text") {
      const part = object(event.part);
      if (typeof part?.text === "string") answer += part.text;
    } else if (event.type === "step_finish") {
      finish = object(event.part);
    } else if (event.type === "error") {
      const err = object(event.error);
      const data = object(err?.data);
      failure = typeof data?.message === "string" ? data.message : typeof err?.name === "string" ? err.name : "OpenCode returned an error event";
    }
  }
  if (failure) throw new ProviderError("transport", `opencode failed: ${truncate(failure, 500)}`);
  if (!finish || outcome.exitCode !== 0) {
    throw new ProviderError("transport", `opencode exited with code ${outcome.exitCode ?? "none"} and printed no completed result: ${truncate(outcome.stderr.trim(), 500)}`);
  }
  const tokens = object(finish.tokens) ?? {};
  const cache = object(tokens.cache) ?? {};
  const usage = {
    inputTokens: number(tokens.input),
    outputTokens: number(tokens.output),
    cachedInputTokens: number(cache.read),
    cacheWriteTokens: number(cache.write),
    webSearches: 0,
  };
  const costUsd = typeof finish.cost === "number" && Number.isFinite(finish.cost) ? finish.cost : null;
  const parsed = parseJsonText(answer);
  if (!parsed.ok) throw new ProviderError("invalid_output", `Output was not JSON: ${truncate(parsed.error, 300)}`, { usage, costUsd });
  const checked = validateOutput(req.schema, parsed.value);
  if (!checked.ok) throw new ProviderError("invalid_output", `Output failed ${req.schemaName}: ${checked.issues}`, { usage, costUsd });
  return resultOf({ output: checked.output, provider: "opencode-cli", model: req.route.model, usage, costUsd, latencyMs, trace: [] });
}
