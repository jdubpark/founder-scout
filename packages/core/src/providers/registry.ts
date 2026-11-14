import { PROVIDERS, type ProviderId, type ProviderStatus } from "@agentswarm/shared";
import {
  ProviderError,
  type ModelProvider,
  type ProviderRegistry,
  type ProviderRequest,
  type ProviderResult,
} from "../contracts";
import { AnthropicApiProvider } from "./anthropic-api";
import { ClaudeCliProvider } from "./claude-cli";
import { CodexCliProvider } from "./codex-cli";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { OpenCodeCliProvider } from "./opencode-cli";
import { createXaiProvider } from "./xai-api";

/**
 * Simulation is handled before any provider is reached, so asking for it
 * here is a bug in the caller. The provider exists so `get("sim")` is total.
 */
class SimulationProvider implements ModelProvider {
  readonly id = "sim" as const;

  async status(): Promise<{ configured: boolean; detail: string }> {
    return { configured: true, detail: "Simulation needs no credentials and makes no network calls." };
  }

  async run<T>(_req: ProviderRequest<T>): Promise<ProviderResult<T>> {
    throw new ProviderError("unsupported", "Simulated jobs run before a provider is reached");
  }
}

/** One provider per id in PROVIDERS. Configuration is read from `env` once, at creation. */
export function createProviderRegistry(env: NodeJS.ProcessEnv = process.env): ProviderRegistry {
  const providers = new Map<ProviderId, ModelProvider>([
    ["sim", new SimulationProvider()],
    ["claude-cli", new ClaudeCliProvider({ env })],
    ["codex-cli", new CodexCliProvider({ env })],
    ["opencode-cli", new OpenCodeCliProvider({ env })],
    ["anthropic-api", new AnthropicApiProvider({ env })],
    ["openai-api", new OpenAICompatibleProvider("openai-api", { env })],
    ["deepseek-api", new OpenAICompatibleProvider("deepseek-api", { env })],
    ["meta-api", new OpenAICompatibleProvider("meta-api", { env })],
    ["xai-api", createXaiProvider({ env })],
  ]);

  const get = (id: ProviderId): ModelProvider => {
    const provider = providers.get(id);
    if (!provider) throw new Error(`No provider registered for ${id}`);
    return provider;
  };

  return {
    get,
    async statuses(): Promise<ProviderStatus[]> {
      const rows: ProviderStatus[] = [];
      for (const meta of PROVIDERS) {
        const status = await get(meta.id).status();
        rows.push({ id: meta.id, label: meta.label, configured: status.configured, detail: status.detail });
      }
      return rows;
    },
  };
}
