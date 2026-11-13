/**
 * Turning a model's rubric answers into the judgments that are scored and stored.
 *
 * One rule, used by the pipeline and by the evals so they cannot drift apart: an answer
 * counts only if it rests on verified evidence that was actually supplied. An answer that
 * cites nothing, or only ids that do not exist, is unsettled, however confident it sounds.
 */

import { COMPANY_DIMENSIONS, type CompanyDimensionId } from "./company";
import type { CitedPoint, CompanyJudgment, Judgment } from "./domain";
import type { CompanyJudgmentDraft, JudgmentDraft } from "./jobio";
import { DIMENSIONS, type DimensionId } from "./rubric";
import type { Level } from "./scoring";

const UNSETTLED = "The available verified evidence does not settle this dimension.";

/**
 * One judgment per rubric dimension, in rubric order. The last answer for a dimension wins.
 * `supplied` is the set of evidence ids the model was given.
 */
export function groundJudgments(drafts: readonly JudgmentDraft[], supplied: ReadonlySet<string>): Judgment[] {
  const latest = new Map<DimensionId, JudgmentDraft>();
  for (const draft of drafts) latest.set(draft.dimension, draft);

  return DIMENSIONS.map((dimension) => {
    const draft = latest.get(dimension.id);
    const level =
      draft?.level === null || draft?.level === undefined || !Number.isFinite(draft.level)
        ? null
        : (Math.max(0, Math.min(4, Math.round(draft.level))) as Level);
    const confidence = draft && Number.isFinite(draft.confidence) ? Math.max(0, Math.min(1, draft.confidence)) : 0;
    const cited = (draft?.evidenceIds ?? []).filter((id) => supplied.has(id));
    const against = (draft?.counterEvidenceIds ?? []).filter((id) => supplied.has(id));
    const grounded = level !== null && cited.length + against.length > 0;
    const rationale = draft?.rationale ?? UNSETTLED;
    return {
      dimension: dimension.id,
      level: grounded ? level : null,
      confidence: grounded ? confidence : 0,
      rationale: level !== null && !grounded ? `Not counted, because no verified evidence was cited. ${rationale}` : rationale,
      evidenceIds: cited,
      counterEvidenceIds: against,
    };
  });
}

/** The same rule for the company rubric: one judgment per company dimension, counted only when it cites supplied evidence. */
export function groundCompanyJudgments(
  drafts: readonly CompanyJudgmentDraft[],
  supplied: ReadonlySet<string>,
): CompanyJudgment[] {
  const latest = new Map<CompanyDimensionId, CompanyJudgmentDraft>();
  for (const draft of drafts) latest.set(draft.dimension, draft);

  return COMPANY_DIMENSIONS.map((dimension) => {
    const draft = latest.get(dimension.id);
    const level =
      draft?.level === null || draft?.level === undefined || !Number.isFinite(draft.level)
        ? null
        : (Math.max(0, Math.min(4, Math.round(draft.level))) as Level);
    const confidence = draft && Number.isFinite(draft.confidence) ? Math.max(0, Math.min(1, draft.confidence)) : 0;
    const cited = (draft?.evidenceIds ?? []).filter((id) => supplied.has(id));
    const against = (draft?.counterEvidenceIds ?? []).filter((id) => supplied.has(id));
    const grounded = level !== null && cited.length + against.length > 0;
    const rationale = draft?.rationale ?? UNSETTLED;
    return {
      dimension: dimension.id,
      level: grounded ? level : null,
      confidence: grounded ? confidence : 0,
      rationale: level !== null && !grounded ? `Not counted, because no verified evidence was cited. ${rationale}` : rationale,
      evidenceIds: cited,
      counterEvidenceIds: against,
    };
  });
}

/**
 * Points for a brief. A point that cites no supplied evidence is dropped, so a brief cannot
 * say more than its sources do. Citations to unknown ids are removed from the points kept.
 */
export function groundPoints(points: readonly CitedPoint[], supplied: ReadonlySet<string>): CitedPoint[] {
  const out: CitedPoint[] = [];
  for (const point of points) {
    const text = point.text.trim();
    const evidenceIds = [...new Set(point.evidenceIds.filter((id) => supplied.has(id)))];
    if (text && evidenceIds.length > 0) out.push({ text, evidenceIds });
  }
  return out;
}
