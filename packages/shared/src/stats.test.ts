import { describe, expect, it } from "vitest";
import { separation, separationDifference, separationStat, shuffledBaseline, type SeparationRow } from "./stats";

const row = (group: string, outcome: 0 | 1, score: number): SeparationRow => ({ group, outcome, score });

describe("separation", () => {
  it("is the share of winner-over-other pairs the right way round, inside one group", () => {
    // Pairs: 0.9 over 0.5, 0.9 over 0.1, 0.4 under 0.5, 0.4 over 0.1. Three of four.
    expect(separation([row("a", 1, 0.9), row("a", 1, 0.4), row("a", 0, 0.5), row("a", 0, 0.1)])).toBe(0.75);
  });

  it("counts a tie as half and never pairs across groups", () => {
    expect(separation([row("a", 1, 0.5), row("a", 0, 0.5)])).toBe(0.5);
    // The only winner is in a, the only other is in b: there is no pair to count.
    expect(separation([row("a", 1, 0.9), row("b", 0, 0.1)])).toBeNull();
    // One good pair in a, one bad pair in b.
    expect(separation([row("a", 1, 0.9), row("a", 0, 0.1), row("b", 1, 0.1), row("b", 0, 0.9)])).toBe(0.5);
  });
});

describe("separationStat", () => {
  const perfect = Array.from({ length: 12 }, (_, index) => row(index < 6 ? "a" : "b", index % 2 === 0 ? 1 : 0, index % 2 === 0 ? 0.9 : 0.1));

  it("gives [1, 1] when every winner outranks every other case", () => {
    expect(separationStat(perfect, "seed")).toEqual({ n: 12, positives: 6, value: 1, low: 1, high: 1 });
  });

  it("is the same every time for the same seed, and brackets the value", () => {
    const mixed = [0.9, 0.2, 0.7, 0.6, 0.4, 0.8, 0.3, 0.5, 0.65, 0.35].map((score, index) => row("a", index % 2 === 0 ? 1 : 0, score));
    const first = separationStat(mixed, "seed");
    expect(separationStat(mixed, "seed")).toEqual(first);
    expect(first.low).not.toBeNull();
    expect(first.low as number).toBeLessThanOrEqual(first.value as number);
    expect(first.high as number).toBeGreaterThanOrEqual(first.value as number);
    expect((first.high as number) - (first.low as number)).toBeGreaterThan(0.1);
  });

  it("claims no interval when there is nothing to compare", () => {
    expect(separationStat([row("a", 1, 0.9)], "seed")).toEqual({ n: 0, positives: 0, value: null, low: null, high: null });
  });

  it("counts only the rows that form a pair, so one-sided groups cannot pad the evidence", () => {
    // One real pair, then four winners alone in one group and four others alone in another.
    const rows = [
      row("mixed", 1, 0.9), row("mixed", 0, 0.1),
      ...[0.5, 0.6, 0.7, 0.8].map((score) => row("winners-only", 1, score)),
      ...[0.5, 0.6, 0.7, 0.8].map((score) => row("others-only", 0, score)),
    ];
    expect(separationStat(rows, "seed")).toMatchObject({ n: 2, positives: 1, value: 1 });
  });
});

describe("shuffledBaseline", () => {
  it("sits at one half when outcomes are shuffled, and says how rare the real score is", () => {
    const rows = Array.from({ length: 24 }, (_, index) => row(index < 12 ? "a" : "b", index % 2 === 0 ? 1 : 0, index % 2 === 0 ? 0.6 + index / 100 : 0.2 + index / 100));
    const real = separation(rows);
    expect(real).toBe(1);
    const shuffled = shuffledBaseline(rows, real, "seed");
    expect(shuffled).not.toBeNull();
    expect(Math.abs((shuffled?.mean ?? 0) - 0.5)).toBeLessThan(0.03);
    expect(shuffled?.p95 ?? 1).toBeLessThan(0.8);
    expect(shuffled?.atLeastObserved ?? 1).toBeLessThan(0.01);
  });

  it("has nothing to say when no group holds both kinds", () => {
    expect(shuffledBaseline([row("a", 1, 0.9), row("b", 0, 0.1)], null, "seed")).toBeNull();
  });
});

describe("separationDifference", () => {
  it("measures one score against another on the same cases", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      group: index < 10 ? "a" : "b",
      outcome: (index % 2) as 0 | 1,
      a: index % 2 ? 0.8 + index / 1000 : 0.2 + index / 1000,
      b: 0.5,
    }));
    // The first score separates every pair, the second none (all ties): 1 against 0.5.
    expect(separationDifference(rows, "seed")).toEqual({ value: 0.5, low: 0.5, high: 0.5 });
    expect(separationDifference(rows.map((row) => ({ ...row, b: row.a })), "seed")).toEqual({ value: 0, low: 0, high: 0 });
  });

  it("has nothing to say when the cases cannot be compared", () => {
    expect(separationDifference([{ group: "a", outcome: 1, a: 1, b: 0 }], "seed")).toEqual({ value: null, low: null, high: null });
  });
});
