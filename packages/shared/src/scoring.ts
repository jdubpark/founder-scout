/**
 * Turning rubric answers into a score and a decision.
 *
 * Models supply the judgments. This file is the decision logic, in code, so it
 * is visible, testable and instantly re-computable when weights change.
 *
 * Each answered rubric question contributes level/4, shrunk toward a sceptical
 * prior in proportion to how unsure the model was:
 *
 *     value = confidence * (level / 4) + (1 - confidence) * prior
 *
 * An unanswered question contributes the prior with zero confidence, so a thin
 * profile cannot rank above a well-evidenced one by being unknown.
 */

import { COMPANY_DIMENSIONS, type CompanyDimensionId } from "./company";
import { CRACKED_DIMENSIONS, DIMENSIONS, FOUNDER_DIMENSIONS, type DimensionId } from "./rubric";
import type { Thresholds } from "./steering";

export type Level = 0 | 1 | 2 | 3 | 4;

export interface JudgmentInput {
  dimension: DimensionId;
  /** null = the evidence does not settle this question. */
  level: Level | null;
  /** 0..1. How sure the model is that the level is right. */
  confidence: number;
}

export type Decision = "surface" | "needs_evidence" | "watch" | "pass";

export interface ScoreFlag {
  code: "integrity_concern" | "integrity_critical" | "outside_thesis" | "thin_evidence";
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface DimensionScore {
  dimension: DimensionId;
  level: Level | null;
  confidence: number;
  weight: number;
  /** 0..1 after shrinkage toward the prior. */
  value: number;
  /** This dimension's share of the composite, in composite points. */
  contribution: number;
}

export interface ScoreResult {
  /** 0..1 overall score across every weighted dimension. */
  composite: number;
  /** 0..1 over the engineering dimensions: "is this person cracked?" */
  cracked: number;
  /** 0..1 over the founder dimensions: "fit for a big bet?" */
  founder: number;
  /** 0..1 share of rubric weight backed by confident evidence. */
  coverage: number;
  /**
   * 0..1 what the evidence gathered so far suggests, ignoring unanswered
   * questions. null when nothing has been answered.
   */
  potential: number | null;
  decision: Decision;
  /** Plain-language explanation of the decision. */
  reasons: string[];
  flags: ScoreFlag[];
  breakdown: DimensionScore[];
}

export interface ScoreInput {
  judgments: readonly JudgmentInput[];
  weights: Record<DimensionId, number>;
  thresholds: Thresholds;
  /** Thesis fit 0..1 from the screener, or null if not screened. */
  fit: number | null;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round = (n: number) => Math.round(n * 1000) / 1000;

function weightedMean(scores: DimensionScore[], ids: readonly DimensionId[]): number {
  const subset = scores.filter((s) => ids.includes(s.dimension) && s.weight > 0);
  const total = subset.reduce((sum, s) => sum + s.weight, 0);
  if (total === 0) return 0;
  return subset.reduce((sum, s) => sum + s.weight * s.value, 0) / total;
}

export function scoreFounder(input: ScoreInput): ScoreResult {
  const { thresholds } = input;
  const prior = clamp01(thresholds.unknownPrior);

  // Last judgment per dimension wins, so a caller can append corrections.
  const byDimension = new Map<DimensionId, JudgmentInput>();
  for (const j of input.judgments) byDimension.set(j.dimension, j);

  const totalWeight = DIMENSIONS.reduce((sum, d) => sum + Math.max(0, input.weights[d.id] ?? 0), 0);

  const breakdown: DimensionScore[] = DIMENSIONS.map((d) => {
    const weight = Math.max(0, input.weights[d.id] ?? 0);
    const j = byDimension.get(d.id);
    const answered = j !== undefined && j.level !== null;
    const confidence = answered ? clamp01(j.confidence) : 0;
    const raw = answered ? (j.level as Level) / 4 : prior;
    const value = confidence * raw + (1 - confidence) * prior;
    return {
      dimension: d.id,
      level: answered ? (j.level as Level) : null,
      confidence: round(confidence),
      weight,
      value: round(value),
      contribution: totalWeight > 0 ? round((weight * value) / totalWeight) : 0,
    };
  });

  const allIds = DIMENSIONS.map((d) => d.id) as DimensionId[];
  const composite = weightedMean(breakdown, allIds);
  const cracked = weightedMean(breakdown, CRACKED_DIMENSIONS);
  const founder = weightedMean(breakdown, FOUNDER_DIMENSIONS);

  const coverage =
    totalWeight > 0
      ? breakdown.reduce((sum, s) => sum + s.weight * s.confidence, 0) / totalWeight
      : 0;

  const evidenceWeight = breakdown.reduce((sum, s) => sum + s.weight * s.confidence, 0);
  const potential =
    evidenceWeight > 0
      ? breakdown.reduce(
          (sum, s) => sum + s.weight * s.confidence * (s.level === null ? 0 : s.level / 4),
          0,
        ) / evidenceWeight
      : null;

  const flags: ScoreFlag[] = [];
  const reasons: string[] = [];

  const integrity = breakdown.find((s) => s.dimension === "integrity");
  const integrityCritical =
    integrity !== undefined &&
    integrity.level !== null &&
    integrity.level === 0 &&
    integrity.confidence >= 0.6;
  if (integrityCritical) {
    flags.push({
      code: "integrity_critical",
      severity: "critical",
      message:
        "A significant public claim appears to be contradicted by a reliable source. A person should review the evidence before any contact.",
    });
  } else if (
    integrity !== undefined &&
    integrity.level !== null &&
    integrity.level <= 1 &&
    integrity.confidence >= 0.6
  ) {
    flags.push({
      code: "integrity_concern",
      severity: "warning",
      message: "Several public claims look inflated compared with the record.",
    });
  }

  let decision: Decision;
  const outsideThesis = input.fit !== null && input.fit < thresholds.minFit;

  if (integrityCritical) {
    // Never surfaced automatically and never silently dropped: a person decides. This comes
    // before the thesis gate, so a founder outside the thesis is still held, not passed.
    decision = "watch";
    reasons.push("Held for human review because of a possible material misrepresentation.");
    if (outsideThesis) {
      flags.push({
        code: "outside_thesis",
        severity: "info",
        message: "Thesis fit is below the minimum for this swarm.",
      });
    }
  } else if (outsideThesis) {
    decision = "pass";
    flags.push({
      code: "outside_thesis",
      severity: "info",
      message: "Thesis fit is below the minimum for this swarm.",
    });
    reasons.push(
      `Thesis fit ${pct(input.fit as number)} is below the minimum of ${pct(thresholds.minFit)}.`,
    );
  } else if (composite >= thresholds.surface && coverage >= thresholds.minCoverage) {
    decision = "surface";
    reasons.push(
      `Overall score ${pct(composite)} is at or above the bar of ${pct(thresholds.surface)}, with ${pct(coverage)} of the rubric backed by evidence.`,
    );
  } else if (potential !== null && potential >= thresholds.surface) {
    // The answers given point above the bar. The overall score is short of it only because
    // too little is known, or known too loosely. That calls for a deeper look, not a wait.
    decision = "needs_evidence";
    const thinCoverage = coverage < thresholds.minCoverage;
    flags.push({
      code: "thin_evidence",
      severity: "info",
      message: thinCoverage
        ? "What is known looks strong, but too little of the rubric is backed by evidence."
        : "What is known looks strong, but the evidence is not yet firm enough to be sure.",
    });
    reasons.push(
      thinCoverage
        ? `The evidence so far points to ${pct(potential)}, but only ${pct(coverage)} of the rubric is covered (minimum ${pct(thresholds.minCoverage)}). More evidence is needed.`
        : `The evidence so far points to ${pct(potential)}, above the bar of ${pct(thresholds.surface)}, but it is not firm enough yet: the overall score is ${pct(composite)}. More evidence is needed.`,
    );
  } else if (composite >= thresholds.watch) {
    decision = "watch";
    reasons.push(
      `Overall score ${pct(composite)} is between the watch bar of ${pct(thresholds.watch)} and the surface bar of ${pct(thresholds.surface)}.`,
    );
  } else {
    decision = "pass";
    reasons.push(`Overall score ${pct(composite)} is below the watch bar of ${pct(thresholds.watch)}.`);
  }

  return {
    composite: round(composite),
    cracked: round(cracked),
    founder: round(founder),
    coverage: round(coverage),
    potential: potential === null ? null : round(potential),
    decision,
    reasons,
    flags,
    breakdown,
  };
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/* ------------------------------------------------------------------ */
/* Companies                                                            */
/* ------------------------------------------------------------------ */

export interface CompanyJudgmentInput {
  dimension: CompanyDimensionId;
  /** null = the evidence does not settle this question. */
  level: Level | null;
  /** 0..1 */
  confidence: number;
}

export interface CompanyDimensionScore {
  dimension: CompanyDimensionId;
  level: Level | null;
  confidence: number;
  weight: number;
  /** 0..1 after shrinkage toward the prior. */
  value: number;
  /** This dimension's share of the company score, in score points. */
  contribution: number;
}

export interface CompanyScoreInput {
  judgments: readonly CompanyJudgmentInput[];
  weights: Record<CompanyDimensionId, number>;
  /** The value an unanswered question contributes. Same prior as for founders. */
  unknownPrior: number;
}

export interface CompanyScoreResult {
  /** 0..1 across every weighted company dimension. */
  composite: number;
  /** 0..1 share of the company rubric backed by confident evidence. */
  coverage: number;
  /** 0..1 what the answers so far suggest, ignoring unanswered questions. null when nothing is answered. */
  potential: number | null;
  /** true when a significant company claim appears to be contradicted by a reliable source. */
  claimsCritical: boolean;
  flags: ScoreFlag[];
  breakdown: CompanyDimensionScore[];
}

/**
 * Score a company from its rubric answers. The arithmetic is the same as for a founder:
 * each answer counts level/4, shrunk toward the prior by how unsure the model was.
 */
export function scoreCompany(input: CompanyScoreInput): CompanyScoreResult {
  const prior = clamp01(input.unknownPrior);
  const byDimension = new Map<CompanyDimensionId, CompanyJudgmentInput>();
  for (const j of input.judgments) byDimension.set(j.dimension, j);

  const totalWeight = COMPANY_DIMENSIONS.reduce((sum, d) => sum + Math.max(0, input.weights[d.id] ?? 0), 0);
  const breakdown: CompanyDimensionScore[] = COMPANY_DIMENSIONS.map((d) => {
    const weight = Math.max(0, input.weights[d.id] ?? 0);
    const j = byDimension.get(d.id);
    const answered = j !== undefined && j.level !== null;
    const confidence = answered ? clamp01(j.confidence) : 0;
    const raw = answered ? (j.level as Level) / 4 : prior;
    const value = confidence * raw + (1 - confidence) * prior;
    return {
      dimension: d.id,
      level: answered ? (j.level as Level) : null,
      confidence: round(confidence),
      weight,
      value: round(value),
      contribution: totalWeight > 0 ? round((weight * value) / totalWeight) : 0,
    };
  });

  const composite =
    totalWeight > 0 ? breakdown.reduce((sum, s) => sum + s.weight * s.value, 0) / totalWeight : 0;
  const evidenceWeight = breakdown.reduce((sum, s) => sum + s.weight * s.confidence, 0);
  const coverage = totalWeight > 0 ? evidenceWeight / totalWeight : 0;
  const potential =
    evidenceWeight > 0
      ? breakdown.reduce(
          (sum, s) => sum + s.weight * s.confidence * (s.level === null ? 0 : s.level / 4),
          0,
        ) / evidenceWeight
      : null;

  const claims = breakdown.find((s) => s.dimension === "claims");
  const settled = claims !== undefined && claims.level !== null && claims.confidence >= 0.6;
  const claimsCritical = settled && claims.level === 0;
  const flags: ScoreFlag[] = [];
  if (claimsCritical) {
    flags.push({
      code: "integrity_critical",
      severity: "critical",
      message:
        "A significant company claim appears to be contradicted by a reliable source. A person should review the evidence before any contact.",
    });
  } else if (settled && (claims.level as Level) <= 1) {
    flags.push({
      code: "integrity_concern",
      severity: "warning",
      message: "Several company claims look inflated compared with the record.",
    });
  }

  return {
    composite: round(composite),
    coverage: round(coverage),
    potential: potential === null ? null : round(potential),
    claimsCritical,
    flags,
    breakdown,
  };
}

/** The lead founder's latest score, as far as a deal needs it. */
export interface TeamScore {
  composite: number;
  coverage: number;
  potential: number | null;
  /** true when the founder's own assessment is held for a possible misrepresentation. */
  integrityCritical: boolean;
}

export interface DealInput {
  company: CompanyScoreResult;
  /** null when no founder of this company has been assessed yet. */
  team: TeamScore | null;
  /** Thesis fit 0..1 of the lead founder, or null if not screened. */
  fit: number | null;
  thresholds: Thresholds;
  /** 0..1 share of the deal score that comes from the founders. The rest comes from the company. */
  teamShare: number;
}

export interface DealResult {
  /** 0..1 the founders and the company together. */
  score: number;
  coverage: number;
  potential: number | null;
  decision: Decision;
  reasons: string[];
  flags: ScoreFlag[];
}

/**
 * Combine the founders and the company into one decision.
 *
 * The same bars apply as for a founder. With no assessed founder the company stands alone,
 * and that is said in the reasons, because half of the picture is missing.
 */
export function decideDeal(input: DealInput): DealResult {
  const { company, team, thresholds } = input;
  const share = team === null ? 0 : clamp01(input.teamShare);
  const score = team === null ? company.composite : share * team.composite + (1 - share) * company.composite;
  const coverage = team === null ? company.coverage : share * team.coverage + (1 - share) * company.coverage;
  let potential: number | null;
  if (team === null || team.potential === null) potential = company.potential;
  else if (company.potential === null) potential = null;
  else potential = share * team.potential + (1 - share) * company.potential;

  const flags: ScoreFlag[] = [...company.flags];
  const reasons: string[] = [];
  if (team === null) reasons.push("No founder of this company has been assessed yet, so this is the company score alone.");

  const outsideThesis = input.fit !== null && input.fit < thresholds.minFit;
  const held = company.claimsCritical || team?.integrityCritical === true;
  let decision: Decision;

  if (held) {
    // Never surfaced automatically and never silently dropped: a person decides.
    decision = "watch";
    reasons.push("Held for human review because of a possible material misrepresentation.");
    if (team?.integrityCritical && !company.claimsCritical) {
      flags.push({
        code: "integrity_critical",
        severity: "critical",
        message: "A founder of this company is held for a possible misrepresentation.",
      });
    }
    if (outsideThesis) {
      flags.push({ code: "outside_thesis", severity: "info", message: "Thesis fit is below the minimum for this swarm." });
    }
  } else if (outsideThesis) {
    decision = "pass";
    flags.push({ code: "outside_thesis", severity: "info", message: "Thesis fit is below the minimum for this swarm." });
    reasons.push(`Thesis fit ${pct(input.fit as number)} is below the minimum of ${pct(thresholds.minFit)}.`);
  } else if (score >= thresholds.surface && coverage >= thresholds.minCoverage) {
    decision = "surface";
    reasons.push(
      `Founders and company together score ${pct(score)}, at or above the bar of ${pct(thresholds.surface)}, with ${pct(coverage)} backed by evidence.`,
    );
  } else if (potential !== null && potential >= thresholds.surface) {
    decision = "needs_evidence";
    const thin = coverage < thresholds.minCoverage;
    flags.push({
      code: "thin_evidence",
      severity: "info",
      message: thin
        ? "What is known looks strong, but too little of it is backed by evidence."
        : "What is known looks strong, but the evidence is not yet firm enough to be sure.",
    });
    reasons.push(
      thin
        ? `The evidence so far points to ${pct(potential)}, but only ${pct(coverage)} is covered (minimum ${pct(thresholds.minCoverage)}). More evidence is needed.`
        : `The evidence so far points to ${pct(potential)}, above the bar of ${pct(thresholds.surface)}, but it is not firm enough yet: the score is ${pct(score)}. More evidence is needed.`,
    );
  } else if (score >= thresholds.watch) {
    decision = "watch";
    reasons.push(
      `Founders and company together score ${pct(score)}, between the watch bar of ${pct(thresholds.watch)} and the surface bar of ${pct(thresholds.surface)}.`,
    );
  } else {
    decision = "pass";
    reasons.push(`Founders and company together score ${pct(score)}, below the watch bar of ${pct(thresholds.watch)}.`);
  }

  return {
    score: round(score),
    coverage: round(coverage),
    potential: potential === null ? null : round(potential),
    decision,
    reasons,
    flags,
  };
}
