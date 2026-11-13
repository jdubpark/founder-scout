import { BASE_CONFIG, type EvalFlowDTO, type EvalVariant } from "@agentswarm/shared";
import type { MarkState } from "../../components/ui/marks";

export type Flow = EvalFlowDTO;

/** "baseline" reads as "Start", "v2" as "Round 2". */
export function roundLabel(variant: Pick<EvalVariant, "id" | "round">): string {
  if (variant.id === "baseline") return "Start";
  return `Round ${variant.round}`;
}

/** The round that is running in the swarm now. Promotion wins; otherwise the config the swarm holds. */
export function inUseVariant(flow: Flow, swarmConfigId: string | null): string | null {
  if (flow.promotedVariant) return flow.promotedVariant;
  const held = flow.variants.find((v) => swarmConfigId !== null && v.config.id === swarmConfigId)?.id;
  if (held) return held;
  // A swarm nobody has changed still runs the starting configuration.
  return swarmConfigId === BASE_CONFIG.id && flow.variants.some((v) => v.id === "baseline") ? "baseline" : null;
}

/** Any round the eval did not revert can be put into use, the winner and the start included. */
export function canUseVariant(v: Pick<EvalVariant, "status">, inUse: boolean): boolean {
  return v.status !== "reverted" && !inUse;
}

export function statusView(v: EvalVariant, inUse: boolean): { label: string; mark: MarkState } {
  if (inUse) return { label: "In use", mark: "ok" };
  if (v.status === "baseline") return { label: "Baseline", mark: "idle" };
  if (v.status === "reverted") return { label: "Reverted", mark: "idle" };
  return { label: "Kept", mark: "ok" };
}

export function metricLabel(flow: Flow, id: string): string {
  return flow.metrics.find((m) => m.id === id)?.label ?? id;
}

export function score(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

export function interval(range: [number, number] | null): string {
  return range ? `${score(range[0])} to ${score(range[1])}` : "not computed";
}

const PLAIN_CHANGES: ReadonlyArray<[RegExp, string]> = [
  [/^Rubric analyst prompt: .*→ blind-pedigree$/, "Hide school and employer names from the analyst"],
  [/^Rubric analyst prompt: .*→ strict-evidence$/, "Ask the analyst for two sources before a top mark"],
  [/^Rubric analyst prompt: .*→ base$/, "Return the analyst to its standard instructions"],
  [/^Claim checker model: /, "Fact-checker model: "],
  [/^Rubric analyst model: /, "Analyst model: "],
];

/** What a round changed, in the words a partner would use. Falls back to the eval's own wording. */
export function changeLabel(variant: Pick<EvalVariant, "id" | "changes" | "description">): string {
  if (variant.id === "baseline") return "Starting configuration";
  const raw = variant.changes[0] ?? variant.description;
  for (const [pattern, plain] of PLAIN_CHANGES) {
    if (pattern.test(raw)) return plain.endsWith(": ") ? raw.replace(pattern, plain) : plain;
  }
  return raw;
}

/** Why a round was kept or reverted: the eval's closing sentence, without the working behind it. */
export function decisionReason(variant: Pick<EvalVariant, "rationale">): string | null {
  const match = /(Kept|Reverted): [^]*$/.exec(variant.rationale);
  return match ? match[0].trim() : null;
}
