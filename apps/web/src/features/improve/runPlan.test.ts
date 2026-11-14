import { describe, expect, it } from "vitest";
import type { EvalVariant } from "@agentswarm/shared";
import { BUDGET_DEFAULT, baselineOf, canRun, isBudgetValid, rangeLabel, roundDoneTitle, runInput, runLabel } from "./runPlan";

const variant = (id: string, status: EvalVariant["status"]) => ({ id, status }) as EvalVariant;

describe("Improve run button", () => {
  it("is disabled only when the flow says it is not ready", () => {
    expect(canRun({ ready: false })).toBe(false);
    expect(canRun({ ready: true })).toBe(true);
    expect(canRun({})).toBe(true);
  });

  it("says Measure for an unmeasured flow and Run another round after", () => {
    expect(runLabel({ variants: [] })).toBe("Measure");
    expect(runLabel({ variants: [variant("baseline", "baseline")] })).toBe("Run another round");
  });

  it("finds the baseline by id, even once it is the champion", () => {
    const variants = [variant("baseline", "champion"), variant("v1", "reverted")];
    expect(baselineOf(variants)?.id).toBe("baseline");
    expect(baselineOf([])).toBeNull();
  });
});

describe("Improve run budget", () => {
  it("sends budgetUsd only for a flow that calls models", () => {
    expect(runInput({ callsModels: true }, 7.5)).toEqual({ budgetUsd: 7.5 });
    expect(runInput({ callsModels: false }, 7.5)).toBeUndefined();
    expect(runInput({}, 7.5)).toBeUndefined();
  });

  it("accepts 0.5 to 200 and defaults to 5", () => {
    expect(isBudgetValid(0.5)).toBe(true);
    expect(isBudgetValid(200)).toBe(true);
    expect(isBudgetValid(0.4)).toBe(false);
    expect(isBudgetValid(200.5)).toBe(false);
    expect(isBudgetValid(Number.NaN)).toBe(false);
    expect(BUDGET_DEFAULT).toBe(5);
  });

  it("names what was spent, two decimals, or nothing when unknown", () => {
    expect(roundDoneTitle(1.8449)).toBe("Round finished · $1.84 spent");
    expect(roundDoneTitle(undefined)).toBe("Round finished");
  });
});

describe("Improve range fact", () => {
  it("formats known intervals and leaves unknown ones blank", () => {
    expect(rangeLabel([0.47, 0.74])).toBe("0.47–0.74");
    expect(rangeLabel(null)).toBe("—");
    expect(rangeLabel(undefined)).toBe("—");
  });
});
