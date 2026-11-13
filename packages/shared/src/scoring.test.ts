import { describe, expect, it } from "vitest";
import { DIMENSIONS, type DimensionId } from "./rubric";
import { scoreFounder, type JudgmentInput, type Level } from "./scoring";
import type { Thresholds } from "./steering";

const THRESHOLDS: Thresholds = {
  minFit: 0.55,
  surface: 0.62,
  watch: 0.48,
  minCoverage: 0.45,
  unknownPrior: 0.35,
};

const DEFAULT_WEIGHTS = Object.fromEntries(DIMENSIONS.map((d) => [d.id, d.defaultWeight])) as Record<
  DimensionId,
  number
>;

function everyDimension(level: Level, confidence: number): JudgmentInput[] {
  return DIMENSIONS.map((d) => ({ dimension: d.id, level, confidence }));
}

function score(judgments: JudgmentInput[], overrides: Partial<Parameters<typeof scoreFounder>[0]> = {}) {
  return scoreFounder({ judgments, weights: DEFAULT_WEIGHTS, thresholds: THRESHOLDS, fit: 0.8, ...overrides });
}

describe("scoreFounder", () => {
  it("scores an unknown founder at the sceptical prior with zero coverage, and passes", () => {
    const r = score([]);
    expect(r.composite).toBeCloseTo(0.35, 3);
    expect(r.coverage).toBe(0);
    expect(r.potential).toBeNull();
    expect(r.decision).toBe("pass");
  });

  it("treats an explicit 'cannot tell' the same as no answer", () => {
    const unknowns: JudgmentInput[] = DIMENSIONS.map((d) => ({ dimension: d.id, level: null, confidence: 0.9 }));
    expect(score(unknowns).composite).toBeCloseTo(score([]).composite, 6);
    expect(score(unknowns).coverage).toBe(0);
  });

  it("surfaces a founder who is strong across a well-evidenced rubric", () => {
    const r = score(everyDimension(4, 0.9));
    // 0.9 * 1.0 + 0.1 * 0.35 = 0.935 on every dimension
    expect(r.composite).toBeCloseTo(0.935, 3);
    expect(r.coverage).toBeCloseTo(0.9, 3);
    expect(r.decision).toBe("surface");
  });

  it("shrinks an uncertain answer toward the prior", () => {
    const sure = score([{ dimension: "built_hard_things", level: 4, confidence: 1 }]);
    const unsure = score([{ dimension: "built_hard_things", level: 4, confidence: 0.2 }]);
    const sureValue = sure.breakdown.find((b) => b.dimension === "built_hard_things")!.value;
    const unsureValue = unsure.breakdown.find((b) => b.dimension === "built_hard_things")!.value;
    expect(sureValue).toBe(1);
    expect(unsureValue).toBeCloseTo(0.2 * 1 + 0.8 * 0.35, 3);
  });

  it("asks for more evidence when what is known is excellent but covers little of the rubric", () => {
    const thin: JudgmentInput[] = [
      { dimension: "built_hard_things", level: 4, confidence: 0.9 },
      { dimension: "technical_depth", level: 4, confidence: 0.9 },
    ];
    const r = score(thin);
    expect(r.coverage).toBeLessThan(THRESHOLDS.minCoverage);
    expect(r.potential).toBeCloseTo(1, 3);
    expect(r.composite).toBeLessThan(THRESHOLDS.surface);
    expect(r.decision).toBe("needs_evidence");
    expect(r.flags.map((f) => f.code)).toContain("thin_evidence");
  });

  it("asks for more evidence when the answers point above the bar but are not firm enough yet", () => {
    // Strong on every question, each held loosely: 0.6 * 0.75 + 0.4 * 0.35 = 0.59, under the bar of 0.62.
    const r = score(everyDimension(3, 0.6));
    expect(r.coverage).toBeGreaterThanOrEqual(THRESHOLDS.minCoverage);
    expect(r.composite).toBeCloseTo(0.59, 3);
    expect(r.potential).toBeCloseTo(0.75, 3);
    expect(r.decision).toBe("needs_evidence");
    expect(r.reasons[0]).toContain("not firm enough yet");

    // The same answers held firmly clear the bar.
    expect(score(everyDimension(3, 0.9)).decision).toBe("surface");
  });

  it("puts a middling founder on the watchlist and a weak one in pass", () => {
    expect(score(everyDimension(2, 0.9)).decision).toBe("watch"); // 0.9*0.5 + 0.1*0.35 = 0.485
    expect(score(everyDimension(1, 0.9)).decision).toBe("pass");
  });

  it("passes on a strong founder who is outside the thesis, and says why", () => {
    const r = score(everyDimension(4, 0.9), { fit: 0.3 });
    expect(r.decision).toBe("pass");
    expect(r.flags.map((f) => f.code)).toContain("outside_thesis");
  });

  it("does not apply the thesis gate when the founder has not been screened", () => {
    expect(score(everyDimension(4, 0.9), { fit: null }).decision).toBe("surface");
  });

  it("holds a possible material misrepresentation for a person instead of surfacing or dropping it", () => {
    const judgments = everyDimension(4, 0.9).map((j) =>
      j.dimension === "integrity" ? { ...j, level: 0 as Level, confidence: 0.8 } : j,
    );
    const r = score(judgments);
    expect(r.composite).toBeGreaterThan(THRESHOLDS.surface);
    expect(r.decision).toBe("watch");
    expect(r.flags).toContainEqual(expect.objectContaining({ code: "integrity_critical", severity: "critical" }));
  });

  it("holds a possible misrepresentation even when the founder is outside the thesis", () => {
    const judgments = everyDimension(2, 0.9).map((j) =>
      j.dimension === "integrity" ? { ...j, level: 0 as Level, confidence: 0.9 } : j,
    );
    // Fit 0.4 is under the minimum of 0.55. Without the hold this founder would be passed and never seen.
    const r = score(judgments, { fit: 0.4 });
    expect(r.decision).toBe("watch");
    expect(r.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["integrity_critical", "outside_thesis"]));
  });

  it("does not raise an integrity flag on a low-confidence concern", () => {
    const judgments = everyDimension(4, 0.9).map((j) =>
      j.dimension === "integrity" ? { ...j, level: 0 as Level, confidence: 0.3 } : j,
    );
    const r = score(judgments);
    expect(r.flags.map((f) => f.code)).not.toContain("integrity_critical");
    expect(r.decision).toBe("surface");
  });

  it("re-ranks two founders when the weights change, without new judgments", () => {
    const engineer: JudgmentInput[] = DIMENSIONS.map((d) => ({
      dimension: d.id,
      level: (d.group === "cracked" ? 4 : 1) as Level,
      confidence: 0.9,
    }));
    const storyteller: JudgmentInput[] = DIMENSIONS.map((d) => ({
      dimension: d.id,
      level: (d.group === "cracked" ? 1 : 4) as Level,
      confidence: 0.9,
    }));

    const engineeringHeavy = { ...DEFAULT_WEIGHTS };
    const founderHeavy = { ...DEFAULT_WEIGHTS };
    for (const d of DIMENSIONS) {
      engineeringHeavy[d.id] = d.group === "cracked" ? 5 : 0.25;
      founderHeavy[d.id] = d.group === "cracked" ? 0.25 : 5;
    }

    expect(score(engineer, { weights: engineeringHeavy }).composite).toBeGreaterThan(
      score(storyteller, { weights: engineeringHeavy }).composite,
    );
    expect(score(engineer, { weights: founderHeavy }).composite).toBeLessThan(
      score(storyteller, { weights: founderHeavy }).composite,
    );
  });

  it("gives a zero-weight dimension no influence on the overall score or coverage", () => {
    const weights = { ...DEFAULT_WEIGHTS, communication: 0 };
    const low = score([{ dimension: "communication", level: 0, confidence: 1 }], { weights });
    const high = score([{ dimension: "communication", level: 4, confidence: 1 }], { weights });
    expect(low.composite).toBe(high.composite);
    expect(low.coverage).toBe(0);
  });

  it("reports contributions that add up to the composite", () => {
    const r = score([
      { dimension: "built_hard_things", level: 3, confidence: 0.8 },
      { dimension: "insight", level: 4, confidence: 0.6 },
      { dimension: "grit", level: 1, confidence: 0.9 },
    ]);
    const sum = r.breakdown.reduce((s, b) => s + b.contribution, 0);
    expect(sum).toBeCloseTo(r.composite, 2);
  });

  it("uses the last judgment when a dimension is answered twice", () => {
    const r = score([
      { dimension: "velocity", level: 0, confidence: 1 },
      { dimension: "velocity", level: 4, confidence: 1 },
    ]);
    expect(r.breakdown.find((b) => b.dimension === "velocity")!.level).toBe(4);
  });

  it("separates the engineering score from the founder score", () => {
    const engineer: JudgmentInput[] = DIMENSIONS.map((d) => ({
      dimension: d.id,
      level: (d.group === "cracked" ? 4 : 1) as Level,
      confidence: 1,
    }));
    const r = score(engineer);
    expect(r.cracked).toBe(1);
    expect(r.founder).toBe(0.25);
  });
});
