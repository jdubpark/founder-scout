import type { EvalFlowDTO, EvalVariant, RunEvalRoundInput } from "@agentswarm/shared";
import { score } from "./variants";

export const BUDGET_DEFAULT = 5;
export const BUDGET_MIN = 0.5;
export const BUDGET_MAX = 200;
export const BUDGET_STEP = 0.5;

type FlowState = Pick<EvalFlowDTO, "ready" | "callsModels" | "variants">;

/** A flow is runnable unless it says it lacks the cases it needs. Only an explicit false blocks it. */
export function canRun(flow: Pick<FlowState, "ready">): boolean {
  return flow.ready !== false;
}

/** The first run creates the baseline, so an unmeasured flow says "Measure". */
export function runLabel(flow: Pick<FlowState, "variants">): string {
  return flow.variants.length === 0 ? "Measure" : "Run another round";
}

/** The starting configuration is always the variant with id "baseline"; its status changes as the flow goes on. */
export function baselineOf(variants: readonly EvalVariant[]): EvalVariant | null {
  return variants.find((v) => v.id === "baseline") ?? null;
}

export function isBudgetValid(value: number): boolean {
  return Number.isFinite(value) && value >= BUDGET_MIN && value <= BUDGET_MAX;
}

/** Only a flow that calls models sends a budget. A free flow sends no input at all. */
export function runInput(flow: Pick<FlowState, "callsModels">, budgetUsd: number): RunEvalRoundInput | undefined {
  return flow.callsModels ? { budgetUsd } : undefined;
}

/** The best variant's 95% interval on the headline, as "0.47–0.74", or a dash when none is known. */
export function rangeLabel(range: [number, number] | null | undefined): string {
  if (!range) return "—";
  return `${score(range[0])}–${score(range[1])}`;
}

export function roundDoneTitle(spentUsd: number | undefined): string {
  return spentUsd === undefined ? "Round finished" : `Round finished · $${spentUsd.toFixed(2)} spent`;
}
