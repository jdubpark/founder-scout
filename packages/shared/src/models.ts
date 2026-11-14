/**
 * Model catalogue, list prices and default routing.
 *
 * Prices are USD per million tokens and are only used to estimate cost when a
 * provider does not report it. `null` means the price has not been confirmed
 * from the vendor's own pricing page; cost is then reported as unknown rather
 * than guessed. Sources and dates are in docs/research/models-2026-11.md.
 */

import type { JobId, ModelRoute, ProviderId, Vendor } from "./registry";

export interface ModelInfo {
  id: string;
  vendor: Vendor;
  label: string;
  tier: "small" | "mid" | "large" | "frontier";
  inputPerMTok: number | null;
  outputPerMTok: number | null;
  cachedInputPerMTok: number | null;
  note?: string;
}

export const MODELS: readonly ModelInfo[] = [
  {
    id: "claude-haiku-5-5",
    vendor: "anthropic",
    label: "Claude Haiku 5.5",
    tier: "small",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cachedInputPerMTok: 0.01,
    note: "Price applies to prompts up to 100K tokens.",
  },
  {
    id: "claude-sonnet-5-5",
    vendor: "anthropic",
    label: "Claude Sonnet 5.5",
    tier: "mid",
    inputPerMTok: 2,
    outputPerMTok: 10,
    cachedInputPerMTok: 0.1,
  },
  {
    id: "claude-opus-5-5",
    vendor: "anthropic",
    label: "Claude Opus 5.5",
    tier: "large",
    inputPerMTok: 4,
    outputPerMTok: 20,
    cachedInputPerMTok: 0.2,
  },
  {
    id: "claude-fable-5-2",
    vendor: "anthropic",
    label: "Claude Fable 5.2",
    tier: "frontier",
    inputPerMTok: 8,
    outputPerMTok: 40,
    cachedInputPerMTok: 0.2,
  },
  {
    id: "gpt-6-luna",
    vendor: "openai",
    label: "GPT-6 Luna",
    tier: "small",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cachedInputPerMTok: 0.01,
  },
  {
    id: "gpt-6.1-terra",
    vendor: "openai",
    label: "GPT-6.1 Terra",
    tier: "mid",
    inputPerMTok: 1,
    outputPerMTok: 5,
    cachedInputPerMTok: 0.05,
  },
  {
    id: "gpt-6.1-sol",
    vendor: "openai",
    label: "GPT-6.1 Sol",
    tier: "mid",
    inputPerMTok: 2,
    outputPerMTok: 10,
    cachedInputPerMTok: 0.1,
  },
  {
    id: "gpt-6-astra",
    vendor: "openai",
    label: "GPT-6 Astra",
    tier: "large",
    inputPerMTok: 10,
    outputPerMTok: 50,
    cachedInputPerMTok: 1,
    note: "Prompts over 272K input tokens cost more.",
  },
  {
    id: "deepseek-flash",
    vendor: "deepseek",
    label: "DeepSeek V4.1 Flash",
    tier: "small",
    inputPerMTok: 0.3,
    outputPerMTok: 1.2,
    cachedInputPerMTok: 0.006,
    note: "Peak-hour list price. Off-peak is half.",
  },
  {
    id: "deepseek-v4-pro",
    vendor: "deepseek",
    label: "DeepSeek V4 Pro",
    tier: "large",
    inputPerMTok: 1.32,
    outputPerMTok: 3.96,
    cachedInputPerMTok: 0.044,
    note: "Peak-hour list price. Off-peak is half.",
  },
  {
    id: "muse-ember-1.0",
    vendor: "meta",
    label: "Muse Ember",
    tier: "small",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cachedInputPerMTok: 0.004,
    note: "Price applies to prompts up to 200K tokens.",
  },
  {
    id: "muse-spark-1.3",
    vendor: "meta",
    label: "Muse Spark 1.3",
    tier: "mid",
    inputPerMTok: 1.25,
    outputPerMTok: 4.25,
    cachedInputPerMTok: 0.15,
    note: "Standard tier. Never use the cheaper contributor tier, which lets Meta use the data.",
  },
  {
    id: "muse-wonder-1.0",
    vendor: "meta",
    label: "Muse Wonder",
    tier: "large",
    inputPerMTok: 4,
    outputPerMTok: 20,
    cachedInputPerMTok: 0.2,
  },
];

const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelInfo | undefined {
  return MODEL_BY_ID.get(id);
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the provider's prompt cache. */
  cachedInputTokens: number;
  /** Input tokens written to the provider's prompt cache. */
  cacheWriteTokens: number;
  webSearches: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  webSearches: 0,
};

/**
 * List-price estimate for one call. Returns null when the model's price is
 * not confirmed, so callers never present a guess as a cost.
 * `inputTokens` is the uncached input; cached reads are priced separately.
 */
export function estimateCostUsd(modelId: string, usage: Usage): number | null {
  const m = MODEL_BY_ID.get(modelId);
  if (!m || m.inputPerMTok === null || m.outputPerMTok === null) return null;
  const cachedRate = m.cachedInputPerMTok ?? m.inputPerMTok * 0.1;
  const cost =
    (usage.inputTokens * m.inputPerMTok +
      usage.cacheWriteTokens * m.inputPerMTok * 1.25 +
      usage.cachedInputTokens * cachedRate +
      usage.outputTokens * m.outputPerMTok) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  sim: "sim",
  "claude-cli": "claude-sonnet-5-5",
  "codex-cli": "gpt-6-luna",
  "anthropic-api": "claude-sonnet-5-5",
  "openai-api": "gpt-6.1-sol",
  "deepseek-api": "deepseek-flash",
  "meta-api": "muse-spark-1.3",
};

const NOT_A_MODEL_JOB: ModelRoute = { provider: "sim", model: "none" };

/**
 * Default model per job. The reasoning:
 *  - high-volume reading (scouts, screener) goes to the cheapest capable model;
 *  - open-web research goes to a mid-tier model with its own search tools;
 *  - reading a founder's code goes to a coding agent in a sandbox;
 *  - fact-checking uses a different vendor from the one that did the research,
 *    so the two do not share the same blind spots;
 *  - the rubric judgment and the memo go to the strongest judgment model.
 * These are starting points. The eval loop is what should settle them.
 */
export const DEFAULT_ROUTES: Record<JobId, ModelRoute> = {
  "scout.hackernews": { provider: "claude-cli", model: "claude-haiku-5-5", effort: "low" },
  "scout.github": { provider: "claude-cli", model: "claude-haiku-5-5", effort: "low" },
  "scout.research": { provider: "claude-cli", model: "claude-haiku-5-5", effort: "low" },
  "scout.talent": { provider: "claude-cli", model: "claude-haiku-5-5", effort: "low" },
  "scout.yc": { provider: "claude-cli", model: "claude-haiku-5-5", effort: "low" },
  // The navigator plans over days: the strongest judgment model, on a login that needs no key.
  "hunt.navigate": { provider: "claude-cli", model: "claude-opus-5-5", effort: "high" },
  // Runners are tools: the smallest capable model. This route is what runs with no key set;
  // RUNNER_POOL below is what runs once a DeepSeek or Meta key is there.
  "hunt.look": { provider: "claude-cli", model: "claude-haiku-5-5", effort: "low" },
  "hunt.sift": { provider: "claude-cli", model: "claude-haiku-5-5", effort: "low" },
  "resolve.identity": NOT_A_MODEL_JOB,
  "screen.fit": { provider: "claude-cli", model: "claude-haiku-5-5", effort: "medium" },
  "investigate.background": { provider: "claude-cli", model: "claude-sonnet-5-5", effort: "medium" },
  "investigate.code": { provider: "codex-cli", model: "gpt-6-astra", effort: "medium" },
  "investigate.company": { provider: "claude-cli", model: "claude-sonnet-5-5", effort: "medium" },
  "investigate.media": { provider: "claude-cli", model: "claude-sonnet-5-5", effort: "medium" },
  "investigate.redflags": { provider: "claude-cli", model: "claude-sonnet-5-5", effort: "medium" },
  "company.product": { provider: "claude-cli", model: "claude-sonnet-5-5", effort: "medium" },
  "company.traction": { provider: "claude-cli", model: "claude-sonnet-5-5", effort: "medium" },
  "company.team": { provider: "claude-cli", model: "claude-sonnet-5-5", effort: "medium" },
  "verify.claims": { provider: "codex-cli", model: "gpt-6.1-sol", effort: "medium" },
  "assess.judgments": { provider: "claude-cli", model: "claude-opus-5-5", effort: "high" },
  "assess.memo": { provider: "claude-cli", model: "claude-opus-5-5", effort: "high" },
  "assess.company": { provider: "claude-cli", model: "claude-opus-5-5", effort: "high" },
  "outreach.plan": { provider: "claude-cli", model: "claude-sonnet-5-5", effort: "medium" },
  "call.founder": NOT_A_MODEL_JOB,
  "call.reference": NOT_A_MODEL_JOB,
  "call.debrief": { provider: "claude-cli", model: "claude-sonnet-5-5", effort: "medium" },
};

/**
 * The models a runner job is shared between when their keys are present: one small model
 * from DeepSeek and one from Meta, through their direct APIs, because a runner call has to
 * come back in a second or two and a headless agent takes several to start. Neither is
 * chosen here. Both are given the same share, and code then moves share toward the one whose
 * work holds up (see pools.ts). Only members whose provider is configured are used.
 */
export const RUNNER_POOL: ReadonlyArray<{ id: string; route: ModelRoute }> = [
  { id: "deepseek-flash", route: { provider: "deepseek-api", model: "deepseek-flash" } },
  { id: "muse-ember", route: { provider: "meta-api", model: "muse-ember-1.0" } },
];

/** The jobs runners do. */
export const RUNNER_JOBS = ["hunt.look", "hunt.sift"] as const satisfies readonly JobId[];
