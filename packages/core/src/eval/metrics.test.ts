import { describe, expect, it } from "vitest";
import { ndcg5, pedigreeLeak, precision5, rankMatch, recall5 } from "./metrics";

describe("rankMatch", () => {
  it("scores perfect and reversed rankings", () => {
    expect(rankMatch([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])).toBe(1);
    expect(rankMatch([5, 4, 3, 2, 1], [1, 2, 3, 4, 5])).toBe(-1);
  });

  it("uses average ranks for ties and zero for constant scores", () => {
    expect(rankMatch([1, 1, 3, 4], [1, 2, 3, 4])).toBeCloseTo(3 / Math.sqrt(10), 12);
    expect(rankMatch([7, 7, 7, 7], [1, 2, 3, 4])).toBe(0);
  });
});

describe("top-five ranking metrics", () => {
  it("scores an ideal ranking as perfect and a reverse ranking below it", () => {
    expect(ndcg5([1, 1, 1, 0, 0])).toBe(1);
    expect(ndcg5([0, 0, 1, 1, 1])).toBeCloseTo(0.618, 3);
  });

  it("gives repeated positive outcomes the same binary gain", () => {
    const expected = (1 + 1 / Math.log2(4)) / (1 + 1 / Math.log2(3));
    expect(ndcg5([1, 0, 1, 0, 0])).toBeCloseTo(expected, 12);
  });

  it("uses a fixed precision cutoff and counts all positives for recall", () => {
    const outcomes = [1, 0, 1, 0, 0, 1] as const;
    expect(precision5(outcomes)).toBe(2 / 5);
    expect(recall5(outcomes)).toBe(2 / 3);
  });

  it("keeps the precision denominator at five for fewer than five retrieved outcomes", () => {
    expect(precision5([1, 1])).toBe(2 / 5);
  });

  it("returns zero when there are no positive outcomes", () => {
    expect(ndcg5([0, 0, 0])).toBe(0);
    expect(recall5([0, 0, 0])).toBe(0);
  });
});

describe("pedigreeLeak", () => {
  it("matches the hand-computed absolute correlation of score residuals and raw pedigree", () => {
    // OLS(score ~ intercept + quality) has slope 0.8 and residuals
    // [-0.3, 0.9, -0.9, 0.3]. Their covariance with centered pedigree is -1.2;
    // the two sums of squared deviations are 1.8 and 5, so |r| = 1.2 / 3.
    expect(pedigreeLeak([0, 2, 1, 3], [0, 1, 2, 3], [1, 2, 4, 3])).toBeCloseTo(0.4, 12);
  });

  it("returns zero when either the residual scores or pedigree has no variation", () => {
    expect(pedigreeLeak([1, 2, 3], [0, 1, 2], [4, 4, 4])).toBe(0);
    expect(pedigreeLeak([1, 1, 1], [0, 1, 2], [1, 2, 3])).toBe(0);
  });

  it("rejects vectors that do not describe the same observations", () => {
    expect(() => pedigreeLeak([1], [1, 2], [1])).toThrow(RangeError);
  });
});
