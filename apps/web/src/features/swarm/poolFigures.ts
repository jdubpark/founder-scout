import type { PoolMemberView } from "@agentswarm/shared";
import { count, usd } from "../../lib/format";

export interface MemberFigures {
  tasks: string;
  /** "41 / 60": supported items of items produced. A dash when none were produced. */
  supported: string;
  cost: string;
  /** "12.4 / $", or a dash when the job produces nothing the checks count. */
  yield: string;
  /** "29 / 30": planted checks passed of planted checks. null when there were none. */
  controls: string | null;
  benched: boolean;
}

/** Supported items for each dollar, in the form the pool list shows. */
export function yieldText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} / $`;
}

export function memberFigures(member: PoolMemberView): MemberFigures {
  const s = member.stats;
  return {
    tasks: count(s.tasks),
    supported: s.items > 0 ? `${count(s.supported)} / ${count(s.items)}` : "—",
    cost: usd(s.costUsd),
    yield: yieldText(member.yieldPerUsd),
    controls: s.controls > 0 ? `${count(s.controls - s.controlsFailed)} / ${count(s.controls)}` : null,
    benched: member.status === "benched",
  };
}

/** The share bar's width and label, as a whole percent. */
export function sharePercentText(share: number): string {
  return `${Math.round(share * 100)}%`;
}
