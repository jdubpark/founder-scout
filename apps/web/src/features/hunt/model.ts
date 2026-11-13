import type { HuntCall, HuntFind, HuntNote, HuntTrailView } from "@agentswarm/shared";

export function splitTrails(trails: readonly HuntTrailView[]): { open: HuntTrailView[]; resting: HuntTrailView[] } {
  const order = (a: HuntTrailView, b: HuntTrailView) => b.score - a.score || a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id);
  return {
    open: trails.filter((trail) => trail.status === "open").sort(order),
    resting: trails.filter((trail) => trail.status !== "open").sort(order),
  };
}

export function sortNotes(notes: readonly HuntNote[]): HuntNote[] {
  return [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function sharePercent(share: number): string {
  return `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
}

export type FindMark = "kept" | "dropped" | "waiting";
export function findMark(find: Pick<HuntFind, "founderStatus">): FindMark {
  if (find.founderStatus === "screened_out") return "dropped";
  if (find.founderStatus && find.founderStatus !== "lead") return "kept";
  return "waiting";
}

export function earlinessSteps(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(5, Math.round(value * 5)));
}

export function waveHeights(waves: readonly { turn: number; leads: number }[], maxHeight = 48): Array<{ turn: number; leads: number; height: number }> {
  const maximum = Math.max(0, ...waves.map((wave) => wave.leads));
  return waves.map((wave) => ({ turn: wave.turn, leads: wave.leads, height: maximum === 0 ? 0 : (wave.leads / maximum) * maxHeight }));
}

export type CallResultLabel = { kind: "planted"; label: "Passed" | "Failed" } | { kind: "blocked"; label: "Blocked" } | { kind: "leads"; label: string } | { kind: "queued"; label: string } | { kind: "empty"; label: "Empty" } | { kind: "failed"; label: "Failed" };
export function callResult(call: Pick<HuntCall, "control" | "result" | "leads" | "queued">): CallResultLabel {
  if (call.control) return { kind: "planted", label: call.control === "passed" ? "Passed" : "Failed" };
  if (call.result === "blocked") return { kind: "blocked", label: "Blocked" };
  if (call.result === "failed") return { kind: "failed", label: "Failed" };
  if (call.leads > 0) {
    const leads = `${call.leads} ${call.leads === 1 ? "lead" : "leads"}`;
    return { kind: "leads", label: call.queued > 0 ? `${leads}, ${call.queued} queued` : leads };
  }
  if (call.queued > 0) return { kind: "queued", label: `${call.queued} queued` };
  return { kind: "empty", label: "Empty" };
}
