import { describe, expect, it } from "vitest";
import type { JudgmentDraft } from "./jobio";
import { groundJudgments } from "./judgments";
import { DIMENSIONS } from "./rubric";

const draft = (overrides: Partial<JudgmentDraft> = {}): JudgmentDraft => ({
  dimension: "built_hard_things",
  level: 4,
  confidence: 0.9,
  rationale: "Wrote the storage engine.",
  evidenceIds: ["evd_1"],
  counterEvidenceIds: [],
  ...overrides,
});

describe("groundJudgments", () => {
  const supplied = new Set(["evd_1", "evd_2"]);

  it("returns one judgment per rubric dimension, in rubric order, with the unanswered ones unsettled", () => {
    const judgments = groundJudgments([draft()], supplied);
    expect(judgments.map((j) => j.dimension)).toEqual(DIMENSIONS.map((d) => d.id));
    expect(judgments[0]).toMatchObject({ dimension: "built_hard_things", level: 4, confidence: 0.9, evidenceIds: ["evd_1"] });
    expect(judgments.slice(1).every((j) => j.level === null && j.confidence === 0)).toBe(true);
  });

  it("does not count an answer that cites nothing, or only ids that were never supplied", () => {
    for (const evidenceIds of [[], ["evd_made_up"]]) {
      const [judgment] = groundJudgments([draft({ evidenceIds })], supplied);
      expect(judgment).toMatchObject({ level: null, confidence: 0, evidenceIds: [] });
      expect(judgment?.rationale).toBe("Not counted, because no verified evidence was cited. Wrote the storage engine.");
    }
  });

  it("counts an answer that rests on evidence against, keeps real ids and drops invented ones", () => {
    const [judgment] = groundJudgments(
      [draft({ level: 1, evidenceIds: ["evd_made_up"], counterEvidenceIds: ["evd_2", "evd_also_made_up"] })],
      supplied,
    );
    expect(judgment).toMatchObject({ level: 1, confidence: 0.9, evidenceIds: [], counterEvidenceIds: ["evd_2"] });
  });

  it("rounds and clamps levels and confidence, and lets the last answer for a dimension win", () => {
    const [judgment] = groundJudgments([draft({ level: 1 }), draft({ level: 7.6, confidence: 3 })], supplied);
    expect(judgment).toMatchObject({ level: 4, confidence: 1 });
    expect(groundJudgments([draft({ level: Number.NaN })], supplied)[0]?.level).toBeNull();
  });
});
