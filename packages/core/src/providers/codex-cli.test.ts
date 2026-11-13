import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ScreenOutputSchema, type ScreenOutput } from "@agentswarm/shared";
import { ProviderError, type ProviderRequest } from "../contracts";
import { CodexCliProvider, buildCodexArgs, codexPrompt, codexUsage, parseCodexEvents } from "./codex-cli";
import type { ProcessOutcome, ProcessRequest, ProcessRunner } from "./subprocess";

const FIT = { fit: 0.6, reasons: ["sells to developers"], sectors: ["devtools"], stage: null, tags: [] };

function turnCompleted(input: number, cached: number, output: number): Record<string, unknown> {
  return {
    type: "turn.completed",
    usage: {
      input_tokens: input,
      cached_input_tokens: cached,
      cache_write_input_tokens: 0,
      output_tokens: output,
      reasoning_output_tokens: 0,
    },
  };
}

function agentMessage(text: string): Record<string, unknown> {
  return { type: "item.completed", item: { id: "item_1", type: "agent_message", text } };
}

interface FakeOptions {
  /** Written to the -o file. Omit to simulate a missing file. */
  finalText?: string;
  events?: Array<Record<string, unknown>>;
  partial?: Partial<ProcessOutcome>;
}

/** Imitates `codex exec`: writes the -o file the way Codex does, and prints JSONL events. */
function fakeCodex(options: FakeOptions, calls: ProcessRequest[] = []): ProcessRunner {
  return async (req) => {
    calls.push(req);
    const o = req.args.indexOf("-o");
    const target = o >= 0 ? req.args[o + 1] : undefined;
    if (options.finalText !== undefined && target) await writeFile(target, options.finalText, "utf8");
    const stdout = (options.events ?? [turnCompleted(1000, 200, 40)]).map((e) => JSON.stringify(e)).join("\n");
    return {
      exitCode: 0,
      stdout,
      stderr: "",
      timedOut: false,
      cancelled: false,
      spawnError: null,
      ...options.partial,
    };
  };
}

function request(overrides: Partial<ProviderRequest<ScreenOutput>> = {}): ProviderRequest<ScreenOutput> {
  return {
    jobId: "screen.fit",
    kind: "structured",
    route: { provider: "codex-cli", model: "gpt-6-luna", effort: "medium" },
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

describe("buildCodexArgs", () => {
  const inv = { model: "gpt-6-luna", effort: "medium", schemaPath: "/w/schema.json", lastMessagePath: "/w/last.json", repoDir: null };

  it("runs read-only, ephemeral, with no user config, rules, hooks, plugins or memories", () => {
    const args = buildCodexArgs(inv);
    expect(args.slice(0, 2)).toEqual(["exec", "--json"]);
    for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check"]) {
      expect(args).toContain(flag);
    }
    expect(args[args.indexOf("-s") + 1]).toBe("read-only");
    expect(args.join(" ")).toContain("--disable hooks --disable plugins --disable memories");
    expect(args.join(" ")).not.toContain("--dangerously");
  });

  it("reads the prompt from stdin and writes the final message to a file", () => {
    const args = buildCodexArgs(inv);
    expect(args[args.indexOf("--output-schema") + 1]).toBe("/w/schema.json");
    expect(args[args.indexOf("-o") + 1]).toBe("/w/last.json");
    expect(args.at(-1)).toBe("-");
  });

  it("sets the reasoning effort with a config override only when set", () => {
    expect(buildCodexArgs(inv)).toContain('model_reasoning_effort="medium"');
    expect(buildCodexArgs({ ...inv, effort: null })).not.toContain("-c");
  });

  it("points at the checkout with -C for repo reviews only", () => {
    expect(buildCodexArgs({ ...inv, repoDir: "/checkout" })).toEqual(expect.arrayContaining(["-C", "/checkout"]));
    expect(buildCodexArgs(inv)).not.toContain("-C");
  });

  it("puts the system text first under a heading, since Codex has no system flag", () => {
    const text = codexPrompt("RULES", "TASK");
    expect(text.indexOf("RULES")).toBeLessThan(text.indexOf("TASK"));
    expect(text).toContain("# System instructions");
  });
});

describe("codexUsage and parseCodexEvents", () => {
  it("counts uncached input by removing the cached part", () => {
    expect(codexUsage({ input_tokens: 1000, cached_input_tokens: 200, output_tokens: 40 })).toEqual({
      inputTokens: 800,
      outputTokens: 40,
      cachedInputTokens: 200,
      cacheWriteTokens: 0,
      webSearches: 0,
    });
  });

  it("sums usage across turns and reads command executions for the trace", () => {
    const stdout = [
      JSON.stringify(turnCompleted(100, 0, 10)),
      JSON.stringify({
        type: "item.completed",
        item: { id: "c1", type: "command_execution", command: "ls", aggregated_output: "main.py" },
      }),
      JSON.stringify(turnCompleted(50, 0, 5)),
    ].join("\n");
    const parsed = parseCodexEvents(stdout);
    expect(parsed.usage?.inputTokens).toBe(150);
    expect(parsed.usage?.outputTokens).toBe(15);
    expect(parsed.tools.map((t) => t.role)).toEqual(["tool_call", "tool_result"]);
  });
});

describe("CodexCliProvider.run", () => {
  it("returns the validated output with usage from the events and a list-price cost estimate", async () => {
    const calls: ProcessRequest[] = [];
    const provider = new CodexCliProvider({
      env: {},
      runner: fakeCodex({ finalText: JSON.stringify(FIT), events: [turnCompleted(1000, 200, 40)] }, calls),
    });
    const result = await provider.run(request());

    expect(result.output).toEqual(FIT);
    expect(result.provider).toBe("codex-cli");
    expect(result.model).toBe("gpt-6-luna");
    expect(result.usage).toMatchObject({ inputTokens: 800, cachedInputTokens: 200, outputTokens: 40 });
    // gpt-6-luna list price: $0.10 input, $0.01 cached input, $0.50 output per million tokens.
    expect(result.costUsd).toBeCloseTo((800 * 0.1 + 200 * 0.01 + 40 * 0.5) / 1_000_000, 9);
    expect(calls[0]?.stdin).toBe(codexPrompt("SYSTEM TEXT", "USER PROMPT"));
  });

  it("reports no cost, rather than a guess, for a model without a confirmed price", async () => {
    const provider = new CodexCliProvider({
      env: {},
      runner: fakeCodex({ finalText: JSON.stringify(FIT), events: [turnCompleted(1000, 200, 40)] }),
    });
    const unpriced = { ...request(), route: { provider: "codex-cli" as const, model: "a-model-with-no-listed-price" } };
    expect((await provider.run(unpriced)).costUsd).toBeNull();
  });

  it("takes the served model from the events when they name one", async () => {
    const provider = new CodexCliProvider({
      env: {},
      runner: fakeCodex({ finalText: JSON.stringify(FIT), events: [{ type: "turn.started", model: "gpt-6-luna-2026-11" }, turnCompleted(10, 0, 1)] }),
    });
    expect((await provider.run(request())).model).toBe("gpt-6-luna-2026-11");
  });

  it("runs structured calls in a fresh temporary directory and removes it", async () => {
    const calls: ProcessRequest[] = [];
    const provider = new CodexCliProvider({ env: {}, runner: fakeCodex({ finalText: JSON.stringify(FIT) }, calls) });
    await provider.run(request());
    const cwd = calls[0]?.cwd ?? "";
    expect(cwd).toContain("agentswarm-codex-");
    expect(args(calls)).not.toContain("-C");
    expect(existsSync(cwd)).toBe(false);
  });

  it("points repo reviews at the checkout with -C", async () => {
    const calls: ProcessRequest[] = [];
    const provider = new CodexCliProvider({ env: {}, runner: fakeCodex({ finalText: JSON.stringify(FIT) }, calls) });
    await provider.run(request({ kind: "repo_review", repoDir: "/tmp/fixture" }));
    expect(args(calls)[args(calls).indexOf("-C") + 1]).toBe("/tmp/fixture");
  });

  it("falls back to the last agent message when the -o file is missing", async () => {
    const provider = new CodexCliProvider({
      env: {},
      runner: fakeCodex({ events: [agentMessage(JSON.stringify(FIT)), turnCompleted(10, 0, 5)] }),
    });
    expect((await provider.run(request())).output).toEqual(FIT);
  });

  it("reports schema-invalid output as invalid_output with the billed usage", async () => {
    const provider = new CodexCliProvider({ env: {}, runner: fakeCodex({ finalText: '{"fit":"high"}' }) });
    const err = await errorOf(provider.run(request()));
    expect(err.kind).toBe("invalid_output");
    expect(err.usage?.outputTokens).toBe(40);
  });

  it("reports a non-JSON final message as invalid_output", async () => {
    const provider = new CodexCliProvider({ env: {}, runner: fakeCodex({ finalText: "not json" }) });
    expect((await errorOf(provider.run(request())))).toMatchObject({ kind: "invalid_output" });
  });

  it("reports a failed turn with a rate-limit message as rate_limited", async () => {
    const provider = new CodexCliProvider({
      env: {},
      runner: fakeCodex({ events: [{ type: "turn.failed", error: { message: "429 Too Many Requests: rate limit" } }] }),
    });
    expect((await errorOf(provider.run(request())))).toMatchObject({ kind: "rate_limited" });
  });

  it("does not fail a completed turn because an error event was emitted during it", async () => {
    const provider = new CodexCliProvider({
      env: {},
      runner: fakeCodex({
        finalText: JSON.stringify(FIT),
        events: [{ type: "error", message: "reconnecting to the model" }, turnCompleted(10, 0, 5)],
      }),
    });
    expect((await provider.run(request())).output).toEqual(FIT);
  });

  it("reports a failed turn without a final message as transport", async () => {
    const provider = new CodexCliProvider({
      env: {},
      runner: fakeCodex({ events: [{ type: "turn.failed", error: { message: "boom" } }] }),
    });
    expect((await errorOf(provider.run(request())))).toMatchObject({ kind: "transport" });
  });

  it("reports a timeout and a cancellation", async () => {
    const timeout = new CodexCliProvider({ env: {}, runner: fakeCodex({ partial: { timedOut: true, exitCode: null } }) });
    expect((await errorOf(timeout.run(request())))).toMatchObject({ kind: "timeout" });
    const cancelled = new CodexCliProvider({ env: {}, runner: fakeCodex({ partial: { cancelled: true, exitCode: null } }) });
    expect((await errorOf(cancelled.run(request())))).toMatchObject({ kind: "cancelled" });
  });

  it("maps a missing binary to not_configured", async () => {
    const provider = new CodexCliProvider({
      env: {},
      runner: fakeCodex({ partial: { exitCode: null, spawnError: "spawn codex ENOENT" } }),
    });
    expect((await errorOf(provider.run(request())))).toMatchObject({ kind: "not_configured" });
  });

  it("refuses research, which Codex does not run here, without spawning", async () => {
    const calls: ProcessRequest[] = [];
    const provider = new CodexCliProvider({ env: {}, runner: fakeCodex({ finalText: JSON.stringify(FIT) }, calls) });
    expect((await errorOf(provider.run(request({ kind: "research" })))).kind).toBe("unsupported");
    expect(calls).toHaveLength(0);
  });

  it("refuses an effort value it does not know, before spawning", async () => {
    const calls: ProcessRequest[] = [];
    const provider = new CodexCliProvider({ env: {}, runner: fakeCodex({ finalText: JSON.stringify(FIT) }, calls) });
    const bad = { ...request(), route: { provider: "codex-cli" as const, model: "gpt-6-luna", effort: "turbo" as never } };
    expect((await errorOf(provider.run(bad))).kind).toBe("unsupported");
    expect(calls).toHaveLength(0);
  });

  it("puts command executions from a repo review into the trace", async () => {
    const provider = new CodexCliProvider({
      env: {},
      runner: fakeCodex({
        finalText: JSON.stringify(FIT),
        events: [
          { type: "item.completed", item: { id: "c1", type: "command_execution", command: "cat main.py", aggregated_output: "def add" } },
          turnCompleted(10, 0, 5),
        ],
      }),
    });
    const result = await provider.run(request({ kind: "repo_review", repoDir: "/tmp/fixture" }));
    expect(result.trace.map((t) => t.role)).toEqual(["system", "user", "tool_call", "tool_result", "assistant"]);
  });
});

function args(calls: ProcessRequest[]): readonly string[] {
  return calls[0]?.args ?? [];
}

describe("CodexCliProvider environment", () => {
  it("passes the headless process only the environment it needs", async () => {
    const calls: ProcessRequest[] = [];
    const provider = new CodexCliProvider({
      env: {
        PATH: "/usr/bin",
        HOME: "/Users/test",
        OPENAI_API_KEY: "sk-own",
        CODEX_HOME: "/Users/test/.codex",
        ANTHROPIC_API_KEY: "sk-ant-other-vendor",
        GITHUB_TOKEN: "ghp_secret",
        SOME_DATA_VENDOR_SECRET: "vendor-secret",
      },
      runner: fakeCodex({ finalText: JSON.stringify(FIT) }, calls),
    });
    await provider.run(request());

    const env = calls[0]?.env ?? {};
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.SOME_DATA_VENDOR_SECRET).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBe("sk-own");
    expect(env.CODEX_HOME).toBe("/Users/test/.codex");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/Users/test");
  });
});

