import type { Decision, DecisionFlip, PreviewDTO } from "@agentswarm/shared";
import { plural } from "../../lib/format";
import { DECISION_LABEL } from "../../lib/stages";

/** The most decision changes listed per group; the rest are counted. */
export const FLIP_LIMIT = 8;

export function cutFlips(flips: readonly DecisionFlip[], limit: number = FLIP_LIMIT): { shown: DecisionFlip[]; more: number } {
  return { shown: flips.slice(0, limit), more: Math.max(0, flips.length - limit) };
}

/** A decision as partners see it. Unknown values pass through unchanged. */
export function decisionName(value: string): string {
  return DECISION_LABEL[value as Decision] ?? value;
}

export function hasChanges(preview: Pick<PreviewDTO, "founders" | "companies">): boolean {
  return preview.founders.length > 0 || preview.companies.length > 0;
}

export function reScoredLine(considered: PreviewDTO["considered"]): string {
  return `Re-scored ${plural(considered.founders, "founder")} and ${plural(considered.companies, "company", "companies")}`;
}
