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

  if (outsideThesis) {
    decision = "pass";
    flags.push({
      code: "outside_thesis",
      severity: "info",
      message: "Thesis fit is below the minimum for this swarm.",
    });
    reasons.push(
      `Thesis fit ${pct(input.fit as number)} is below the minimum of ${pct(thresholds.minFit)}.`,
    );
  } else if (integrityCritical) {
    // Never surfaced automatically and never silently dropped: a person decides.
    decision = "watch";
    reasons.push("Held for human review because of a possible material misrepresentation.");
  } else if (composite >= thresholds.surface && coverage >= thresholds.minCoverage) {
    decision = "surface";
    reasons.push(
      `Overall score ${pct(composite)} is at or above the bar of ${pct(thresholds.surface)}, with ${pct(coverage)} of the rubric backed by evidence.`,
    );
  } else if (
    potential !== null &&
    potential >= thresholds.surface &&
    coverage < thresholds.minCoverage
  ) {
    decision = "needs_evidence";
    flags.push({
      code: "thin_evidence",
      severity: "info",
      message: "What is known looks strong, but too little of the rubric is backed by evidence.",
    });
    reasons.push(
      `The evidence so far points to ${pct(potential)}, but only ${pct(coverage)} of the rubric is covered (minimum ${pct(thresholds.minCoverage)}). More evidence is needed.`,
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
