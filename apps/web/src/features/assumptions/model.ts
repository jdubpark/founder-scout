import { ASSUMPTION_AREAS, enoughToJudge, type AssumptionRow, type AssumptionStatus, type SeparationStat } from "@agentswarm/shared";
import type { MarkState } from "../../components/ui/marks";

export const STATUS_LABEL: Record<AssumptionStatus, string> = {
  supported: "Supported",
  against: "Against",
  open: "Open",
  untested: "Untested",
};

/** Good is green, bad is red, attention is amber, and nothing judged is grey. */
export const STATUS_MARK: Record<AssumptionStatus, MarkState> = {
  supported: "ok",
  against: "error",
  open: "warn",
  untested: "idle",
};

export const STATUS_ORDER: readonly AssumptionStatus[] = ["supported", "against", "open", "untested"];

export function countByStatus(rows: readonly Pick<AssumptionRow, "status">[]): Record<AssumptionStatus, number> {
  const counts: Record<AssumptionStatus, number> = { supported: 0, against: 0, open: 0, untested: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** The five areas in their fixed order, with the rows in each. Areas with no rows are dropped. */
export function groupByArea(rows: readonly AssumptionRow[]): Array<{ id: string; label: string; rows: AssumptionRow[] }> {
  return ASSUMPTION_AREAS.map((area) => ({
    id: area.id,
    label: area.label,
    rows: rows.filter((row) => row.area === area.id),
  })).filter((group) => group.rows.length > 0);
}

/**
 * The partner's calls and the outcomes disagree: both sides have a verdict, and the verdicts
 * are not the same. An untested side never counts as a disagreement.
 */
export function differs(row: Pick<AssumptionRow, "status" | "calls">): boolean {
  return row.calls !== null && row.status !== "untested" && row.calls !== "untested" && row.calls !== row.status;
}

/* ------------------------------ Evidence bar ------------------------------ */

export const BAR_WIDTH = 160;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export interface BarGeometry {
  /** Where the dot sits, 0 to 1. null when there is no value. */
  value: number | null;
  /** The 95% band, low then high, both clamped to the track. null when unknown. */
  band: [number, number] | null;
  /**
   * Too few cases of one kind for the ledger to read the figure. It is drawn hollow and without
   * its band, so a row marked Untested does not look like a result.
   */
  thin: boolean;
}

export function barGeometry(stat: SeparationStat | null | undefined): BarGeometry {
  if (!stat || stat.value === null) return { value: null, band: null, thin: false };
  const value = clamp01(stat.value);
  if (!enoughToJudge(stat)) return { value, band: null, thin: true };
  if (stat.low === null || stat.high === null) return { value, band: null, thin: false };
  const low = clamp01(stat.low);
  const high = clamp01(stat.high);
  return { value, band: [Math.min(low, high), Math.max(low, high)], thin: false };
}

/** An x position on the track in pixels, clamped so nothing is drawn outside it. */
export function barX(fraction: number, width: number = BAR_WIDTH): number {
  return clamp01(fraction) * width;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The text a screen reader hears for one bar, for example "Past companies: 62%, range 48% to 75%, 69 cases". */
export function barLabel(name: string, stat: SeparationStat | null | undefined): string {
  if (!stat || stat.value === null) return `${name}: no evidence`;
  if (!enoughToJudge(stat)) return `${name}: ${percent(stat.value)} on ${stat.n} cases, too few to judge`;
  const range = stat.low !== null && stat.high !== null ? `, range ${percent(stat.low)} to ${percent(stat.high)}` : "";
  return `${name}: ${percent(stat.value)}${range}, ${stat.n} cases`;
}
