import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ScreenOutputSchema, SearchOutputSchema, type ScreenOutput, type SearchOutput } from "@agentswarm/shared";
import { ProviderError, type ProviderRequest } from "../contracts";
import {
  ClaudeCliProvider,
  buildClaudeArgs,
  claudeUsage,
} from "./claude-cli";
import type { ProcessOutcome, ProcessRequest, ProcessRunner } from "./subprocess";

const FIT = { fit: 0.8, reasons: ["builds tools"], sectors: ["devtools"], stage: "seed", tags: ["rust"] };

function outcome(partial: Partial<ProcessOutcome> = {}): ProcessOutcome {
  return { exitCode: 0, stdout: "", stderr: "", timedOut: false, cancelled: false, spawnError: null, ...partial };
}

function successJson(structured: unknown, model = "claude-haiku-5-5"): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    stop_reason: "tool_use",
    total_cost_usd: 0.0002627,
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 1130,
      cache_read_input_tokens: 400,
      output_tokens: 73,
      server_tool_use: { web_search_requests: 0 },
    },
    modelUsage: {
      [model]: {
        inputTokens: 2,
        outputTokens: 73,
        cacheReadInputTokens: 400,
        cacheCreationInputTokens: 1130,
        webSearchRequests: 0,
        costUSD: 0.0002627,
      },
    },
    permission_denials: [],
    num_turns: 2,
    result: JSON.stringify(structured),
    structured_output: structured,
  });
}

function fakeRunner(result: Partial<ProcessOutcome>, calls: ProcessRequest[] = []): ProcessRunner {
  return async (req) => {
    calls.push(req);
    return outcome(result);
  };
}

function request(overrides: Partial<ProviderRequest<ScreenOutput>> = {}): ProviderRequest<ScreenOutput> {
  return {
    jobId: "screen.fit",
    kind: "structured",
    route: { provider: "claude-cli", model: "claude-haiku-5-5", effort: "low" },
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

function argValue(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe("buildClaudeArgs", () => {
  const base = {
    model: "claude-haiku-5-5",
    effort: "low",
    maxBudgetUsd: 0.5,
    system: "SYS",
    schemaJson: "{}",
    repoDir: null,
  };

  it("gives structured calls no tools at all", () => {
    const args = buildClaudeArgs({ ...base, kind: "structured", streaming: false });
    expect(argValue(args, "--tools")).toBe("");
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--disallowedTools");
    expect(args).not.toContain("--add-dir");
  });

  it("gives research calls only web tools and denies every protected page host", () => {
    const args = buildClaudeArgs({ ...base, kind: "research", streaming: true });
    expect(argValue(args, "--tools")).toBe("WebSearch,WebFetch");
    expect(argValue(args, "--allowedTools")).toBe("WebSearch,WebFetch");
    expect(args).toContain("stream-json");
    expect(args).not.toContain("--add-dir");
    expect(args).not.toContain("--disallowedTools");
  });

  it("gives search calls WebSearch only, with no page-fetch tool", () => {
    const args = buildClaudeArgs({ ...base, kind: "search", streaming: true });
    expect(argValue(args, "--tools")).toBe("WebSearch");
    expect(argValue(args, "--allowedTools")).toBe("WebSearch");
    expect(args).not.toContain("--disallowedTools");
    expect(args.some((arg) => arg.includes("WebFetch"))).toBe(false);
  });

  it("gives repo reviews read and search tools only, with shell, write and network denied", () => {
    const args = buildClaudeArgs({ ...base, kind: "repo_review", streaming: true, repoDir: "/checkout" });
    const tools = argValue(args, "--tools")?.split(",") ?? [];
    expect(tools).toEqual(["Read", "Grep", "Glob"]);
    const denied = argValue(args, "--disallowedTools")?.split(",") ?? [];
    for (const name of ["Bash", "Edit", "Write", "WebFetch", "WebSearch"]) {
      expect(denied).toContain(name);
      expect(tools).not.toContain(name);
    }
    expect(denied).toEqual(["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Agent"]);
    expect(args).toContain("--restricted");
    expect(args.slice(-2)).toEqual(["--add-dir", "/checkout"]);
  });

  it("loads no user or project settings, MCP servers or slash commands", () => {
    const args = buildClaudeArgs({ ...base, kind: "structured", streaming: false });
    expect(argValue(args, "--setting-sources")).toBe("project");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
    expect(args).toContain("--no-session-persistence");
    expect(args).not.toContain("--bare");
  });

  it("maps effort and budget only when set", () => {
    const withEffort = buildClaudeArgs({ ...base, kind: "structured", streaming: false });
    expect(argValue(withEffort, "--effort")).toBe("low");
    expect(argValue(withEffort, "--max-budget-usd")).toBe("0.5");
    const bare = buildClaudeArgs({ ...base, effort: null, maxBudgetUsd: null, kind: "structured", streaming: false });
    expect(bare).not.toContain("--effort");
    expect(bare).not.toContain("--max-budget-usd");
  });

});

describe("Claude native web search", () => {
  it("returns only links from the WebSearch tool result and ignores an address in model prose", async () => {
    const fixture = readFileSync(new URL("./__fixtures__/claude-websearch.stream.jsonl", import.meta.url), "utf8");
    const stream = fixture.split("\n").map((line) => {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === "result") event.result = "I found https://invented-by-the-model.example/";
        return JSON.stringify(event);
      } catch {
        return line;
      }
    }).join("\n");
    const calls: ProcessRequest[] = [];
    const provider = new ClaudeCliProvider({ runner: fakeRunner({ stdout: stream }, calls) });
    const req: ProviderRequest<SearchOutput> = {
      jobId: "hunt.search",
      kind: "search",
      route: { provider: "claude-cli", model: "claude-haiku-5-5", effort: "low" },
      system: "Search once.",
      prompt: "open source vector database launched this month",
      schema: SearchOutputSchema,
      schemaName: "SearchOutput",
    };
    const result = await provider.run(req);
    expect(result.output.hits.map(({ title, url }) => ({ title, url }))).toEqual([
      { title: "THE LINUX FOUNDATION PROJECTS", url: "https://opensearch.org/platform/vector-engine/" },
      { title: "blocksandfiles.com", url: "https://blocksandfiles.com/ai-ml/2026/07/16/zilliz-launches-milvus-vector-lakebase/5273617" },
      { title: "Endee.io Launches Open Source Vector Database", url: "https://letsdatascience.com/news/endeeio-launches-open-source-vector-database-f566b7a8" },
      { title: "Zilliz Releases Milvus 30 Making its Open Source Vector Database Lake Native 176040", url: "https://dbta.com/Editorial/News-Flashes/Zilliz-Releases-Milvus-30-Making-its-Open-Source-Vector-Database-Lake-Native-176040.aspx" },
    ]);
    expect(result.output.hits.some((hit) => hit.url.includes("invented-by-the-model"))).toBe(false);
    expect(argValue(calls[0]!.args, "--tools")).toBe("WebSearch");
    expect(argValue(calls[0]!.args, "--allowedTools")).toBe("WebSearch");
    expect(calls[0]!.args).not.toContain("--json-schema");

    const limitedProvider = new ClaudeCliProvider({ runner: fakeRunner({ stdout: stream }) });
    expect((await limitedProvider.run({ ...req, prompt: "query\n<result_limit>2</result_limit>" })).output.hits).toHaveLength(2);

    const withoutToolResult = fixture.split("\n").filter((line) => !line.includes('"type": "user"')).join("\n");
    const noResultsProvider = new ClaudeCliProvider({ runner: fakeRunner({ stdout: withoutToolResult }) });
    expect((await noResultsProvider.run(req)).output.hits).toEqual([]);
  });
});

describe("ClaudeCliProvider.run", () => {
  it("returns the validated structured output with the served model and mapped usage", async () => {
    const calls: ProcessRequest[] = [];
    const response = JSON.parse(successJson(FIT, "claude-sonnet-5-5")) as { modelUsage: Record<string, unknown> };
    response.modelUsage["claude-opus-4-8"] = { costUSD: 0.0005 };
    const provider = new ClaudeCliProvider({ env: {}, runner: fakeRunner({ stdout: JSON.stringify(response) }, calls) });
    const result = await provider.run(request());

    expect(result.output).toEqual(FIT);
    expect(result.provider).toBe("claude-cli");
    expect(result.model).toBe("claude-opus-4-8");
    expect(result.costUsd).toBe(0.0002627);
    expect(result.usage).toEqual({
      inputTokens: 2,
      outputTokens: 73,
      cachedInputTokens: 400,
      cacheWriteTokens: 1130,
      webSearches: 0,
    });
    expect(calls[0]?.command).toBe("claude");
    expect(calls[0]?.stdin).toBe("USER PROMPT");
  });

  it("runs every call in a fresh temporary directory and removes it afterwards", async () => {
    const calls: ProcessRequest[] = [];
    const provider = new ClaudeCliProvider({ env: {}, runner: fakeRunner({ stdout: successJson(FIT) }, calls) });
    await provider.run(request());
    const cwd = calls[0]?.cwd ?? "";
    expect(cwd).toContain("agentswarm-claude-");
    expect(existsSync(cwd)).toBe(false);
  });

  it("keeps the repository out of the working directory and passes it with --add-dir", async () => {
    const calls: ProcessRequest[] = [];
    const provider = new ClaudeCliProvider({ env: {}, runner: fakeRunner({ stdout: streamResultLine(FIT) }, calls) });
    await provider.run(
      request({ kind: "repo_review", repoDir: "/tmp/fixture-checkout", route: { provider: "claude-cli", model: "claude-haiku-5-5" } }),
    );
    expect(calls[0]?.cwd).not.toBe("/tmp/fixture-checkout");
    expect(argValue(calls[0]?.args ?? [], "--add-dir")).toBe("/tmp/fixture-checkout");
  });

  it("rejects a repo review with no checkout as unsupported, before spawning", async () => {
    const calls: ProcessRequest[] = [];
    const provider = new ClaudeCliProvider({ env: {}, runner: fakeRunner({ stdout: successJson(FIT) }, calls) });
    const err = await errorOf(provider.run(request({ kind: "repo_review", repoDir: null })));
    expect(err.kind).toBe("unsupported");
    expect(calls).toHaveLength(0);
  });

  it("reports schema-invalid output as invalid_output and keeps the billed usage", async () => {
    const provider = new ClaudeCliProvider({
      env: {},
      runner: fakeRunner({ stdout: successJson({ fit: "high" }) }),
    });
    const err = await errorOf(provider.run(request()));
    expect(err.kind).toBe("invalid_output");
    expect(err.costUsd).toBe(0.0002627);
    expect(err.usage?.outputTokens).toBe(73);
  });

  it("reports a refusal as refused", async () => {
    const stdout = JSON.stringify({ type: "result", subtype: "success", is_error: false, stop_reason: "refusal", modelUsage: {} });
    const provider = new ClaudeCliProvider({ env: {}, runner: fakeRunner({ stdout }) });
    expect((await errorOf(provider.run(request())))).toMatchObject({ kind: "refused" });
  });

  it("reports a budget stop as budget", async () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "error_max_budget_usd",
      is_error: true,
      total_cost_usd: 0.5,
      modelUsage: {},
      usage: {},
      result: "",
    });
    const provider = new ClaudeCliProvider({ env: {}, runner: fakeRunner({ stdout }) });
    const err = await errorOf(provider.run(request()));
    expect(err.kind).toBe("budget");
    expect(err.costUsd).toBe(0.5);
  });

  it("reports a non-zero exit with no result as transport", async () => {
    const provider = new ClaudeCliProvider({
      env: {},
      runner: fakeRunner({ exitCode: 1, stdout: "", stderr: "Not logged in" }),
    });
    const err = await errorOf(provider.run(request()));
    expect(err.kind).toBe("transport");
    expect(err.message).toContain("Not logged in");
  });

  it("reports a timeout as timeout", async () => {
    const provider = new ClaudeCliProvider({ env: {}, runner: fakeRunner({ timedOut: true, exitCode: null }) });
    expect(await errorOf(provider.run(request()))).toMatchObject({ kind: "timeout", retryable: true });
  });

  it("reports cancellation from the runner as cancelled", async () => {
    const provider = new ClaudeCliProvider({ env: {}, runner: fakeRunner({ cancelled: true, exitCode: null }) });
    expect(await errorOf(provider.run(request()))).toMatchObject({ kind: "cancelled", retryable: false });
  });

  it("does not spawn when the signal is already aborted", async () => {
    const calls: ProcessRequest[] = [];
    const controller = new AbortController();
    controller.abort();
    const provider = new ClaudeCliProvider({ env: {}, runner: fakeRunner({ stdout: successJson(FIT) }, calls) });
    expect(await errorOf(provider.run(request({ signal: controller.signal })))).toMatchObject({ kind: "cancelled" });
    expect(calls).toHaveLength(0);
  });

  it("passes a cloud provider's credentials to the process only when that sign-in route is in use", async () => {
    const calls: ProcessRequest[] = [];
    const secrets = { AWS_SECRET_ACCESS_KEY: "aws", GITHUB_TOKEN: "gh", PATH: "/usr/bin" };
    await new ClaudeCliProvider({ env: secrets, runner: fakeRunner({ stdout: successJson(FIT) }, calls) }).run(request());
    expect(calls[0]?.env).toEqual({ PATH: "/usr/bin" });
    await new ClaudeCliProvider({
      env: { ...secrets, CLAUDE_CODE_USE_BEDROCK: "1" },
      runner: fakeRunner({ stdout: successJson(FIT) }, calls),
    }).run(request());
    expect(calls[1]?.env).toEqual({ AWS_SECRET_ACCESS_KEY: "aws", CLAUDE_CODE_USE_BEDROCK: "1", PATH: "/usr/bin" });
  });

  it("maps a missing binary to not_configured", async () => {
    const provider = new ClaudeCliProvider({
      env: {},
      runner: fakeRunner({ exitCode: null, spawnError: "spawn claude ENOENT" }),
    });
    expect(await errorOf(provider.run(request()))).toMatchObject({ kind: "not_configured" });
  });

  it("reads a research result from the stream even when no tool was called", async () => {
    const provider = new ClaudeCliProvider({ env: {}, runner: fakeRunner({ stdout: streamResultLine(FIT) }) });
    const result = await provider.run(request({ kind: "research" }));
    expect(result.output).toEqual(FIT);
    expect(result.trace.map((t) => t.role)).toEqual(["system", "user", "assistant"]);
  });

  it("builds a research trace with tool calls, truncated results, and the final answer", async () => {
    const big = "x".repeat(5000);
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init" }),
      "warning: non-JSON CLI output is ignored",
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t1", name: "WebFetch", input: { url: "https://example.com" } }] },
      }),
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", content: big }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t2", name: "StructuredOutput", input: FIT }] },
      }),
      streamResultLine(FIT),
    ].join("\n");
    const provider = new ClaudeCliProvider({ env: {}, runner: fakeRunner({ stdout }) });
    const result = await provider.run(request({ kind: "research" }));

    expect(result.trace.map((t) => t.role)).toEqual(["system", "user", "tool_call", "tool_result", "assistant"]);
    expect(result.trace[2]).toMatchObject({ role: "tool_call", name: "WebFetch" });
    const toolResult = result.trace[3];
    expect(toolResult?.content.length).toBeLessThan(2_100);
    expect(toolResult?.content).toContain("[truncated");
    expect(result.trace.at(-1)?.content).toBe(JSON.stringify(FIT));
  });
});

function streamResultLine(structured: unknown): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    stop_reason: "tool_use",
    total_cost_usd: 0.0007,
    usage: { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 2118, cache_creation_input_tokens: 2293 },
    modelUsage: {
      "claude-haiku-5-5": {
        inputTokens: 4,
        outputTokens: 300,
        cacheReadInputTokens: 2118,
        cacheCreationInputTokens: 2293,
        webSearchRequests: 2,
        costUSD: 0.0007,
      },
    },
    structured_output: structured,
    result: JSON.stringify(structured),
  });
}

describe("claude result helpers", () => {
  it("counts web searches from modelUsage and falls back to server_tool_use", () => {
    const withModelUsage = {
      usage: {},
      modelUsage: { a: { webSearchRequests: 2 }, b: { webSearchRequests: 1 } },
    };
    expect(claudeUsage(withModelUsage).webSearches).toBe(3);
    const fallback = { usage: { server_tool_use: { web_search_requests: 4 } }, modelUsage: {} };
    expect(claudeUsage(fallback).webSearches).toBe(4);
  });

});

describe("ClaudeCliProvider environment", () => {
  it("passes the headless process only the environment it needs", async () => {
    const calls: ProcessRequest[] = [];
    const provider = new ClaudeCliProvider({
      env: {
        PATH: "/usr/bin",
        HOME: "/Users/test",
        ANTHROPIC_API_KEY: "sk-ant-own",
        ANTHROPIC_AUTH_TOKEN: "own-auth-token",
        OPENAI_API_KEY: "sk-other-vendor",
        GITHUB_TOKEN: "ghp_secret",
        SOME_DATA_VENDOR_SECRET: "vendor-secret",
      },
      runner: fakeRunner({ stdout: successJson(FIT) }, calls),
    });
    await provider.run(request());

    const env = calls[0]?.env ?? {};
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.SOME_DATA_VENDOR_SECRET).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-own");
    // The keep prefix wins over the secret-looking suffix.
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("own-auth-token");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/Users/test");
  });
});

