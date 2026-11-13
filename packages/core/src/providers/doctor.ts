import { z } from "zod";
import { PROVIDERS, type ProviderId } from "@agentswarm/shared";
import { ProviderError, type ModelProvider } from "../contracts";
import { createProviderRegistry } from "./registry";

export interface DoctorLive {
  ok: boolean;
  model: string;
  latencyMs: number;
  costUsd: number | null;
  error: string | null;
}

export interface DoctorRow {
  provider: ProviderId;
  configured: boolean;
  detail: string;
  live: DoctorLive | null;
}

export interface DoctorOptions {
  live: boolean;
  env?: NodeJS.ProcessEnv;
}

/** The cheapest model each provider has, for the one-call live probe. */
export const PROBE_MODEL: Partial<Record<ProviderId, string>> = {
  "claude-cli": "claude-haiku-5-5",
  "codex-cli": "gpt-6-luna",
  "anthropic-api": "claude-haiku-5-5",
  "openai-api": "gpt-6-luna",
  "deepseek-api": "deepseek-flash",
  "meta-api": "muse-ember-1.0",
};

/** Providers that accept a low reasoning-effort value. The others get none. */
const PROBE_EFFORT: Partial<Record<ProviderId, "low">> = {
  "claude-cli": "low",
  "codex-cli": "low",
  "anthropic-api": "low",
};

const ProbeSchema = z.object({ answer: z.string() });
const PROBE_TIMEOUT_MS = 60_000;
const PROBE_BUDGET_USD = 0.05;

async function probe(provider: ModelProvider, id: ProviderId): Promise<DoctorLive> {
  const model = PROBE_MODEL[id] ?? "";
  const effort = PROBE_EFFORT[id];
  const started = Date.now();
  try {
    const result = await provider.run({
      jobId: "screen.fit",
      kind: "structured",
      route: { provider: id, model, ...(effort ? { effort } : {}) },
      system: "You are a connectivity check. Reply exactly as the schema asks.",
      prompt: "Reply with the word ready in the answer field.",
      schema: ProbeSchema,
      schemaName: "ProbeOutput",
      maxBudgetUsd: PROBE_BUDGET_USD,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    return {
      ok: true,
      model: result.model,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof ProviderError ? `${err.kind}: ${err.message}` : err instanceof Error ? err.message : String(err);
    return { ok: false, model, latencyMs: Date.now() - started, costUsd: null, error: message };
  }
}

/**
 * Reports which providers are configured. With `live`, sends one tiny
 * structured call to each configured model provider. Simulation makes no call.
 */
export async function runDoctor(options: DoctorOptions): Promise<DoctorRow[]> {
  const registry = createProviderRegistry(options.env ?? process.env);
  const rows: DoctorRow[] = [];
  for (const meta of PROVIDERS) {
    const provider = registry.get(meta.id);
    const status = await provider.status();
    const live =
      options.live && status.configured && meta.id !== "sim" ? await probe(provider, meta.id) : null;
    rows.push({ provider: meta.id, configured: status.configured, detail: status.detail, live });
  }
  return rows;
}
