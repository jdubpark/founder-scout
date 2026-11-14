import { describe, expect, it } from "vitest";
import type { DecisionFlip } from "@agentswarm/shared";
import { FLIP_LIMIT, cutFlips, decisionName, hasChanges, reScoredLine } from "./preview";

const flips = (count: number): DecisionFlip[] =>
  Array.from({ length: count }, (_, i) => ({ id: `f${i}`, name: `Founder ${i}`, from: "watch", to: "surface", scoreFrom: 0.5, scoreTo: 0.6 }));

describe("preview flips", () => {
  it("shows at most eight flips and counts the rest", () => {
    const { shown, more } = cutFlips(flips(11));
    expect(shown).toHaveLength(FLIP_LIMIT);
    expect(more).toBe(3);
    expect(cutFlips(flips(8))).toEqual({ shown: flips(8), more: 0 });
    expect(cutFlips([])).toEqual({ shown: [], more: 0 });
  });

  it("names decisions as the Founders page does, and passes unknown values through", () => {
    expect(decisionName("needs_evidence")).toBe("Needs evidence");
    expect(decisionName("pass")).toBe("Pass");
    expect(decisionName("mystery")).toBe("mystery");
  });

  it("reports whether anything changes", () => {
    expect(hasChanges({ founders: [], companies: [] })).toBe(false);
    expect(hasChanges({ founders: flips(1), companies: [] })).toBe(true);
  });

  it("says how much was re-scored", () => {
    expect(reScoredLine({ founders: 1, companies: 2 })).toBe("Re-scored 1 founder and 2 companies");
    expect(reScoredLine({ founders: 0, companies: 0 })).toBe("Re-scored 0 founders and 0 companies");
  });
});
