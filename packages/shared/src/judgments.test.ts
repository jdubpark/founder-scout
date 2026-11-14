import { describe, expect, it } from "vitest";
import type { JudgmentDraft } from "./jobio";
import { groundJudgments } from "./judgments";
import { DIMENSIONS } from "./rubric";

describe("groundJudgments", () => {
  it("returns rubric order and grounds the last answer with verified evidence", () => {
    const drafts: JudgmentDraft[] = [
      {
        dimension: "built_hard_things",
        level: 1,
        confidence: 0.25,
        rationale: "Earlier answer.",
        evidenceIds: ["evd_1"],
        counterEvidenceIds: [],
      },
      {
        dimension: "built_hard_things",
        level: 7.6,
        confidence: 3,
        rationale: "Latest answer.",
        evidenceIds: ["evd_missing"],
        counterEvidenceIds: ["evd_2", "evd_also_missing"],
      },
    ];

    const judgments = groundJudgments(drafts, new Set(["evd_1", "evd_2"]));
    const judgment = judgments[0];

    expect(judgments.map((item) => item.dimension)).toEqual(DIMENSIONS.map((item) => item.id));
    expect(judgment).toMatchObject({
      level: 4,
      confidence: 1,
      rationale: "Latest answer.",
      evidenceIds: [],
      counterEvidenceIds: ["evd_2"],
    });
    expect(judgments.slice(1).every((item) => item.level === null && item.confidence === 0)).toBe(true);
  });
});
