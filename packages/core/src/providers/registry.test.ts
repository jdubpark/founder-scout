import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROVIDERS, ScreenOutputSchema } from "@agentswarm/shared";
import { ProviderError } from "../contracts";
import { createProviderRegistry } from "./registry";
import { runDoctor } from "./doctor";

/** A PATH with no executables, so the command-line providers report missing binaries. */
let emptyBin: string;
beforeEach(async () => {
  emptyBin = await mkdtemp(join(tmpdir(), "agentswarm-empty-bin-"));
});
afterEach(async () => {
  await rm(emptyBin, { recursive: true, force: true });
});

const KEYLESS = (): NodeJS.ProcessEnv => ({ PATH: emptyBin });

describe("createProviderRegistry statuses", () => {
  it("returns one status per provider in PROVIDERS order", async () => {
    const registry = createProviderRegistry(KEYLESS());
    const statuses = await registry.statuses();
    expect(statuses.map((s) => s.id)).toEqual(PROVIDERS.map((p) => p.id));
    expect(statuses.every((s) => s.label.length > 0 && s.detail.length > 0)).toBe(true);
    for (const status of statuses) expect(registry.get(status.id).id).toBe(status.id);
  });

  it("reports the command-line providers unconfigured when their binaries are not on PATH", async () => {
    const statuses = await createProviderRegistry(KEYLESS()).statuses();
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s]));
    expect(byId["claude-cli"]?.configured).toBe(false);
    expect(byId["codex-cli"]?.configured).toBe(false);
    expect(byId["sim"]?.configured).toBe(true);
  });

  it("reports the API providers unconfigured without keys, and configured with them", async () => {
    const without = Object.fromEntries((await createProviderRegistry(KEYLESS()).statuses()).map((s) => [s.id, s]));
    expect(without["anthropic-api"]?.configured).toBe(false);
    expect(without["openai-api"]?.configured).toBe(false);
    expect(without["deepseek-api"]?.configured).toBe(false);
    expect(without["meta-api"]?.configured).toBe(false);

    const withKeys = Object.fromEntries(
      (
        await createProviderRegistry({
          PATH: emptyBin,
          ANTHROPIC_API_KEY: "a",
          OPENAI_API_KEY: "o",
          DEEPSEEK_API_KEY: "d",
          DEEPSEEK_BASE_URL: "https://deepseek-host.example.test/v1",
          META_API_KEY: "l",
          META_BASE_URL: "https://llama.example.test/v1",
        }).statuses()
      ).map((s) => [s.id, s]),
    );
    expect(withKeys["anthropic-api"]?.configured).toBe(true);
    expect(withKeys["openai-api"]?.configured).toBe(true);
    expect(withKeys["deepseek-api"]?.configured).toBe(true);
    expect(withKeys["meta-api"]?.configured).toBe(true);
  });

  it("never puts a key value into a status detail", async () => {
    const secret = "sk-test-SECRET-VALUE-123";
    const statuses = await createProviderRegistry({
      PATH: emptyBin,
      ANTHROPIC_API_KEY: secret,
      OPENAI_API_KEY: secret,
      DEEPSEEK_API_KEY: secret,
      META_API_KEY: secret,
      META_BASE_URL: "https://llama.example.test/v1",
    }).statuses();
    expect(JSON.stringify(statuses)).not.toContain(secret);
  });
});

describe("createProviderRegistry.get", () => {
  it("the simulation provider refuses to run", async () => {
    const registry = createProviderRegistry(KEYLESS());

    const sim = registry.get("sim");
    await expect(
      sim.run({
        jobId: "screen.fit",
        kind: "structured",
        route: { provider: "sim", model: "sim" },
        system: "s",
        prompt: "p",
        schema: ScreenOutputSchema,
        schemaName: "ScreenOutput",
      }),
    ).rejects.toMatchObject({ kind: "unsupported" });
    await expect(sim.run({} as never)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("runDoctor", () => {
  it("reports every provider without calling a model when live is false", async () => {
    const rows = await runDoctor({ live: false, env: KEYLESS() });
    expect(rows.map((r) => r.provider)).toEqual(PROVIDERS.map((p) => p.id));
    expect(rows.every((r) => r.live === null)).toBe(true);
  });

  it("makes no live call for an unconfigured provider, even with live true", async () => {
    const rows = await runDoctor({ live: true, env: KEYLESS() });
    expect(rows.find((r) => r.provider === "anthropic-api")?.live).toBeNull();
    expect(rows.find((r) => r.provider === "sim")?.live).toBeNull();
  });
});
