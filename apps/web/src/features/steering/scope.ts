import {
  getJob,
  isClassId,
  isJobId,
  scopeLevel,
  scopeMatches,
  swarmIdentity,
  type AgentIdentity,
  type ClassId,
  type JobId,
  type ParamDef,
  type ScopeLevel,
  type ScopeSelector,
  type SwarmTreeDTO,
} from "@agentswarm/shared";
import { plural } from "../../lib/format";

/** One agent in this swarm, with the identity steering matches against. */
export interface AgentRef {
  id: string;
  name: string;
  identity: AgentIdentity;
}

export function agentRefs(tree: SwarmTreeDTO): AgentRef[] {
  const out: AgentRef[] = [];
  for (const c of tree.classes) {
    for (const j of c.jobs) {
      for (const a of j.agents) {
        out.push({
          id: a.agent.id,
          name: a.agent.name,
          identity: {
            swarmId: tree.swarm.id,
            classId: c.cls.id,
            jobId: j.job.id,
            agentId: a.agent.id,
          },
        });
      }
    }
  }
  return out;
}

/** Splits a scope into the fields the composer edits. */
export function scopeFields(scope: ScopeSelector): {
  level: ScopeLevel;
  target: string;
  thisSwarmOnly: boolean;
} {
  return {
    level: scopeLevel(scope),
    target: scope.agentId ?? scope.jobId ?? scope.classId ?? "",
    thisSwarmOnly: Boolean(scope.swarmId),
  };
}

/** The scope the composer's fields describe, or null when a target is still missing. */
export function buildScope(
  level: ScopeLevel,
  target: string,
  thisSwarmOnly: boolean,
  swarmId: string,
): ScopeSelector | null {
  switch (level) {
    case "global":
      return {};
    case "swarm":
      return { swarmId };
    case "class":
      if (!target) return null;
      return thisSwarmOnly ? { swarmId, classId: target as ClassId } : { classId: target as ClassId };
    case "job":
      if (!target) return null;
      return thisSwarmOnly ? { swarmId, jobId: target as JobId } : { jobId: target as JobId };
    case "agent":
      return target ? { agentId: target } : null;
  }
}

export interface TargetOption {
  value: string;
  label: string;
}

/** The classes, jobs or agents a scope level can point at, in this swarm. */
export function targetOptions(level: ScopeLevel, tree: SwarmTreeDTO): TargetOption[] {
  switch (level) {
    case "class":
      return tree.classes.map((c) => ({ value: c.cls.id, label: c.cls.label }));
    case "job":
      return tree.classes.flatMap((c) => c.jobs.map((j) => ({ value: j.job.id, label: j.job.label })));
    case "agent":
      return agentRefs(tree).map((r) => ({ value: r.id, label: r.name }));
    default:
      return [];
  }
}

/** The identity a scope previews against, so the composer can list the parameters that apply. */
export function identityFor(
  level: ScopeLevel,
  target: string,
  swarmId: string,
  agents: AgentRef[],
): AgentIdentity {
  if (level === "class" && isClassId(target)) {
    return { swarmId, classId: target, jobId: null, agentId: null };
  }
  if (level === "job" && isJobId(target)) {
    const job = getJob(target);
    return { swarmId, classId: job.classId, jobId: job.id, agentId: null };
  }
  if (level === "agent") {
    const found = agents.find((a) => a.id === target);
    if (found) return found.identity;
  }
  return swarmIdentity(swarmId);
}

export interface Reach {
  /** A setting read once per run applies to the whole swarm, not to each agent. */
  wholeSwarmOnce: boolean;
  names: string[];
  /** The scope also reaches agents in other swarms. */
  elsewhere: boolean;
}

/** Which agents in this swarm a scope reaches, for the composer's preview. */
export function reachOf(scope: ScopeSelector, def: ParamDef | null, tree: SwarmTreeDTO): Reach {
  const elsewhere = !scope.swarmId && !scope.agentId;
  if (def?.appliesTo.includes("swarm")) {
    return { wholeSwarmOnce: true, names: [], elsewhere: false };
  }
  const names = agentRefs(tree)
    .filter((r) => scopeMatches(scope, r.identity))
    .map((r) => r.name);
  return { wholeSwarmOnce: false, names, elsewhere };
}

const SHOWN = 6;

/** One sentence saying who a directive will reach. */
export function describeReach(reach: Reach): string {
  if (reach.wholeSwarmOnce) return "This will reach the whole swarm, once per run.";
  const n = reach.names.length;
  if (n === 0) {
    return reach.elsewhere
      ? "This will reach no agents in this swarm right now."
      : "This will reach no agents in this swarm.";
  }
  const shown = reach.names.slice(0, SHOWN).join(", ");
  const more = n - SHOWN;
  const list = more > 0 ? `${shown}, and ${more} more` : shown;
  if (reach.elsewhere) {
    return `This will reach ${plural(n, "agent")} in this swarm, and matching agents in other swarms: ${list}.`;
  }
  return `This will reach ${plural(n, "agent")}: ${list}.`;
}
