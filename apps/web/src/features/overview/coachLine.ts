import type { CoachReport } from "@agentswarm/shared";

/**
 * The one line the Needs you panel shows about the swarm's own improvement:
 * a change put into use without a person, otherwise the count of kept
 * improvements. Null when there is nothing to say.
 */
export function coachLine(coach: CoachReport | null | undefined): string | null {
  if (!coach) return null;
  const applied = coach.flows.find((f) => f.applied !== null)?.applied;
  if (applied) return `Swarm changed: ${applied}`;
  const kept = coach.flows.reduce((sum, f) => sum + f.kept.length, 0);
  if (kept > 0) return `${kept.toLocaleString("en-US")} ${kept === 1 ? "improvement" : "improvements"} found`;
  return null;
}
