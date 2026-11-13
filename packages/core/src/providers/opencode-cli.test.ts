import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ProviderError, type ProviderRequest } from "../contracts";
import { OpenCodeCliProvider } from "./opencode-cli";
import type { ProcessRequest } from "./subprocess";

const Output = z.object({ ok: z.boolean() });
const fixture = (name: string) => readFile(join(__dirname, "__fixtures__", name), "utf8");
function request(model: string, effort?: "low" | "high"): ProviderRequest<z.infer<typeof Output>> {
  return {
    jobId: "screen.fit", kind: "structured", route: { provider: "opencode-cli", model, ...(effort ? { effort } : {}) },
    system: "Answer only from the supplied text.", prompt: "Return ok true.", schema: Output, schemaName: "Output",
  };
}

describe("OpenCode CLI provider", () => {
  it("runs a locked structured call and maps success and error events", async () => {
    const calls: ProcessRequest[] = [];
    const streams = [
      await fixture("opencode-deepseek.jsonl"),
      await fixture("opencode-meta.jsonl"),
      await fixture("opencode-isolated.jsonl"),
      await fixture("opencode-badmodel.jsonl"),
    ];
    const provider = new OpenCodeCliProvider({
      env: { PATH: "/bin", HOME: "/users/owner", XDG_CONFIG_HOME: "/users/owner/.config", DEEPSEEK_API_KEY: "no-leak", OTHER_SECRET: "no-leak" },
      runner: async (call) => {
        calls.push(call);
        const config = JSON.parse(await readFile(join(call.cwd, "opencode.json"), "utf8")) as { agent: { plain: { prompt: string; tools: Record<string, boolean> } } };
        expect(config.agent.plain.prompt).toBe("Answer only from the supplied text.");
        expect(config.agent.plain.tools).toEqual({ "*": false });
        expect(call.stdin).toBe("");
        expect(call.env.HOME).toBe("/users/owner");
        expect(call.env.XDG_CONFIG_HOME).not.toBe("/users/owner/.config");
        expect(await readdir(call.env.XDG_CONFIG_HOME as string)).toEqual([]);
        expect(call.env.DEEPSEEK_API_KEY).toBeUndefined();
        expect(call.env.OTHER_SECRET).toBeUndefined();
        expect(call.env.PATH).toBe("/bin");
        const bad = calls.length === 4;
        return { exitCode: bad ? 1 : 0, stdout: streams[calls.length - 1] as string, stderr: "", timedOut: false, cancelled: false, spawnError: null };
      },
    });

    const deepseek = await provider.run(request("deepseek/deepseek-flash"));
    expect(deepseek).toMatchObject({ output: { ok: true }, model: "deepseek/deepseek-flash", costUsd: 0.000483, usage: { inputTokens: 2816, outputTokens: 17, cachedInputTokens: 0, cacheWriteTokens: 0 } });
    expect(calls[0]?.command).toBe("opencode");
    expect(calls[0]?.args.slice(0, 8)).toEqual(["run", "--pure", "--agent", "plain", "--model", "deepseek/deepseek-flash", "--format", "json"]);
    expect(calls[0]?.args.at(-1)).toContain('"type":"object"');

    await provider.run(request("meta/muse-ember-1.0"));
    expect(calls[1]?.args).toContain("--variant");
    expect(calls[1]?.args[calls[1]?.args.indexOf("--variant") + 1]).toBe("minimal");
    await provider.run(request("meta/muse-spark-1.3", "high"));
    expect(calls[2]?.args[calls[2]?.args.indexOf("--variant") + 1]).toBe("high");
    const error = await provider.run(request("meta/muse-ember-1.0")).then(() => null, (err: unknown) => err);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: "transport", message: expect.stringContaining("Unexpected server error") });
  });
});
