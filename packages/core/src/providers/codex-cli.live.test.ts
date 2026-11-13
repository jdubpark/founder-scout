import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ScreenOutputSchema } from "@agentswarm/shared";
import { z } from "zod";
import { CodexCliProvider } from "./codex-cli";
import { makeFixtureRepo, SCREEN_PROMPT } from "./live-fixtures";

const LIVE = process.env.LIVE_PROVIDERS === "1";
const MODEL = "gpt-6-luna";
const CALL_TIMEOUT = 300_000;

describe.skipIf(!LIVE)("codex-cli live", () => {
  const provider = new CodexCliProvider();

  it(
    "returns a schema-valid structured screen",
    async () => {
      const result = await provider.run({
        jobId: "screen.fit",
        kind: "structured",
        route: { provider: "codex-cli", model: MODEL, effort: "low" },
        system: "You score founders against a thesis. Answer only in the schema.",
        prompt: SCREEN_PROMPT,
        schema: ScreenOutputSchema,
        schemaName: "ScreenOutput",
        timeoutMs: CALL_TIMEOUT,
      });
      console.log("codex-cli structured:", JSON.stringify({ output: result.output, model: result.model, usage: result.usage, costUsd: result.costUsd, latencyMs: result.latencyMs }));
      expect(result.output.fit).toBeGreaterThanOrEqual(0);
      expect(result.model).toBe(MODEL);
    },
    CALL_TIMEOUT,
  );

  it(
    "reviews a fixture repository in a read-only sandbox and answers in the schema",
    async () => {
      const repo = await makeFixtureRepo();
      try {
        const result = await provider.run({
          jobId: "investigate.code",
          kind: "repo_review",
          route: { provider: "codex-cli", model: MODEL, effort: "low" },
          system:
            "You review code in the checkout. Read files with your shell tool (for example cat or rg) before answering. Answer in the schema.",
          prompt: "Read main.py with your shell tool and say in summary what the function does.",
          schema: z.object({ summary: z.string() }),
          schemaName: "CodeSummary",
          repoDir: repo,
          timeoutMs: CALL_TIMEOUT,
        });
        console.log("codex-cli repo_review:", JSON.stringify({ output: result.output, model: result.model, usage: result.usage, trace: result.trace.map((t) => [t.role, t.name ?? null]) }));
        expect(result.output.summary.toLowerCase()).toContain("add");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
    CALL_TIMEOUT,
  );
});
