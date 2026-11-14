import { describe, expect, it } from "vitest";
import {
  COMPANY_DIMENSIONS,
  type CompanyDimensionId,
} from "./company";
import { groundCompanyJudgments, groundPoints } from "./judgments";
import { decideDeal, scoreCompany, type CompanyJudgmentInput, type TeamScore } from "./scoring";
import type { Thresholds } from "./steering";

const thresholds: Thresholds = { minFit: 0.55, surface: 0.58, watch: 0.48, minCoverage: 0.45, unknownPrior: 0.35 };
const weights = Object.fromEntries(COMPANY_DIMENSIONS.map((d) => [d.id, d.defaultWeight])) as Record<CompanyDimensionId, number>;
const all = (level: 0 | 1 | 2 | 3 | 4, confidence: number): CompanyJudgmentInput[] =>
  COMPANY_DIMENSIONS.map((d) => ({ dimension: d.id, level, confidence }));
const score = (judgments: CompanyJudgmentInput[]) => scoreCompany({ judgments, weights, unknownPrior: thresholds.unknownPrior });
const team = (composite: number, extra: Partial<TeamScore> = {}): TeamScore => ({ composite, coverage: 1, potential: composite, integrityCritical: false, ...extra });

describe("company scoring", () => {
  it("gives a company with nothing known the prior, no coverage and no potential", () => {
    const result = score([]);
    expect(result.composite).toBe(0.35);
    expect(result.coverage).toBe(0);
    expect(result.potential).toBeNull();
    expect(result.claimsCritical).toBe(false);
  });

  it("shrinks one confident answer toward the prior by hand-worked amounts", () => {
    // Product (weight 2.5) at level 4 with confidence 0.9: value 0.9 * 1 + 0.1 * 0.35 = 0.935.
    // Composite (2.5 * 0.935 + 14 * 0.35) / 16.5 = 0.43864. Coverage 2.5 * 0.9 / 16.5 = 0.13636.
    const result = score([{ dimension: "product", level: 4, confidence: 0.9 }]);
    expect(result.composite).toBe(0.439);
    expect(result.coverage).toBe(0.136);
    expect(result.potential).toBe(1);
  });

  it("flags a contradicted company claim only when the answer is confident", () => {
    expect(score([{ dimension: "claims", level: 0, confidence: 0.8 }]).claimsCritical).toBe(true);
    expect(score([{ dimension: "claims", level: 0, confidence: 0.4 }]).claimsCritical).toBe(false);
    expect(score([{ dimension: "claims", level: 1, confidence: 0.8 }]).flags.map((f) => f.code)).toEqual(["integrity_concern"]);
  });
});

describe("deal decision", () => {
  it("blends the lead founder and the company by the team share", () => {
    // 0.6 * 0.5 + 0.4 * 1 = 0.7, above the bar of 0.58 with full coverage.
    const deal = decideDeal({ company: score(all(4, 1)), team: team(0.5), fit: 0.8, thresholds, teamShare: 0.6 });
    expect(deal.score).toBe(0.7);
    expect(deal.decision).toBe("surface");
  });

  it("lets a strong founder lift a middling company over the bar, and a weak one hold it under", () => {
    const middling = score(all(2, 1)); // 0.5
    expect(decideDeal({ company: middling, team: team(0.8), fit: 0.8, thresholds, teamShare: 0.6 }).decision).toBe("surface"); // 0.68
    expect(decideDeal({ company: middling, team: team(0.5), fit: 0.8, thresholds, teamShare: 0.6 }).decision).toBe("watch"); // 0.5
    expect(decideDeal({ company: middling, team: team(0.3), fit: 0.8, thresholds, teamShare: 0.6 }).decision).toBe("pass"); // 0.38
  });

  it("scores the company alone, and says so, when no founder has been assessed", () => {
    const deal = decideDeal({ company: score(all(3, 1)), team: null, fit: null, thresholds, teamShare: 0.6 });
    expect(deal.score).toBe(0.75);
    expect(deal.decision).toBe("surface");
    expect(deal.reasons[0]).toMatch(/No founder/);
  });

  it("asks for more evidence when the little that is known points above the bar", () => {
    const deal = decideDeal({
      company: score([{ dimension: "product", level: 4, confidence: 0.9 }]),
      team: null,
      fit: 0.8,
      thresholds,
      teamShare: 0.6,
    });
    expect(deal.decision).toBe("needs_evidence");
    expect(deal.flags.map((f) => f.code)).toContain("thin_evidence");
  });

  it("holds for a person, before the thesis gate, when the company or a founder may have misrepresented something", () => {
    const strong = score(all(4, 1));
    const contradicted = score([...all(4, 1), { dimension: "claims", level: 0, confidence: 0.9 }]);
    const byCompany = decideDeal({ company: contradicted, team: team(0.9), fit: 0.1, thresholds, teamShare: 0.6 });
    expect(byCompany.decision).toBe("watch");
    expect(byCompany.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["integrity_critical", "outside_thesis"]));
    const byFounder = decideDeal({ company: strong, team: team(0.9, { integrityCritical: true }), fit: 0.9, thresholds, teamShare: 0.6 });
    expect(byFounder.decision).toBe("watch");
    expect(byFounder.flags.map((f) => f.code)).toContain("integrity_critical");
  });

  it("passes a company outside the thesis however good it is", () => {
    const deal = decideDeal({ company: score(all(4, 1)), team: team(0.9), fit: 0.3, thresholds, teamShare: 0.6 });
    expect(deal.decision).toBe("pass");
  });
});

describe("grounding for companies", () => {
  it("does not score company judgments that cite no supplied evidence", () => {
    const judgments = groundCompanyJudgments(
      [
        { dimension: "traction", level: 4, confidence: 0.9, rationale: "Customers.", evidenceIds: ["evd_1"], counterEvidenceIds: [] },
        { dimension: "market", level: 4, confidence: 0.9, rationale: "Huge.", evidenceIds: ["evd_missing"], counterEvidenceIds: [] },
      ],
      new Set(["evd_1"]),
    );

    expect(judgments.find((judgment) => judgment.dimension === "traction")).toMatchObject({ level: 4, confidence: 0.9, evidenceIds: ["evd_1"] });
    expect(judgments.find((judgment) => judgment.dimension === "market")).toMatchObject({ level: null, confidence: 0, evidenceIds: [] });
  });

  it("drops a brief point with no supplied source and removes unknown ids from the rest", () => {
    expect(
      groundPoints(
        [
          { text: "Paying customers in three industries.", evidenceIds: ["evd_1", "evd_1", "evd_x"] },
          { text: "Certain to dominate the market.", evidenceIds: [] },
          { text: "  ", evidenceIds: ["evd_1"] },
        ],
        new Set(["evd_1"]),
      ),
    ).toEqual([{ text: "Paying customers in three industries.", evidenceIds: ["evd_1"] }]);
  });
});
