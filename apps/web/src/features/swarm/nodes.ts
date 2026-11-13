import { nodeToParam, paramToNode, type SwarmNodeRef } from "../../components/SwarmMap";
import {
  normalizeScope,
  type AgentNode,
  type ClassId,
  type ClassNode,
  type EffectiveSteeringQuery,
  type JobId,
  type JobNode,
  type ScopeSelector,
  type SwarmTreeDTO,
} from "@agentswarm/shared";

/** A selectable part of the swarm: the whole swarm, a class, a job or one agent. */
export type NodeRef =
  | { kind: "swarm" }
  | { kind: "class"; id: ClassId }
  | { kind: "job"; id: JobId }
  | { kind: "agent"; id: string };

export const SWARM_NODE: NodeRef = { kind: "swarm" };

/** The same node in the shape the shared SwarmMap uses. */
export function toMapRef(node: NodeRef): SwarmNodeRef {
  switch (node.kind) {
    case "swarm":
      return { kind: "swarm" };
    case "class":
      return { kind: "class", classId: node.id };
    case "job":
      return { kind: "job", jobId: node.id };
    case "agent":
      return { kind: "agent", agentId: node.id };
  }
}

export function fromMapRef(ref: SwarmNodeRef): NodeRef {
  switch (ref.kind) {
    case "swarm":
      return SWARM_NODE;
    case "class":
      return { kind: "class", id: ref.classId };
    case "job":
      return { kind: "job", id: ref.jobId };
    case "agent":
      return { kind: "agent", id: ref.agentId };
  }
}

/** Reads `?node=` from the URL, using the same format as the map. Unknown values fall back to the whole swarm. */
export function parseNode(raw: string | null): NodeRef {
  const ref = paramToNode(raw ?? "swarm");
  return ref ? fromMapRef(ref) : SWARM_NODE;
}

export function formatNode(node: NodeRef): string {
  return nodeToParam(toMapRef(node));
}

export function sameNode(a: NodeRef, b: NodeRef): boolean {
  return formatNode(a) === formatNode(b);
}

function sameScope(a: ScopeSelector, b: ScopeSelector): boolean {
  const x = normalizeScope(a);
  const y = normalizeScope(b);
  return x.swarmId === y.swarmId && x.classId === y.classId && x.jobId === y.jobId && x.agentId === y.agentId;
}

/** The scope a new directive takes when it is added from this node. */
export function nodeScope(node: NodeRef, swarmId: string): ScopeSelector {
  switch (node.kind) {
    case "swarm":
      return { swarmId };
    case "class":
      return { swarmId, classId: node.id };
    case "job":
      return { swarmId, jobId: node.id };
    case "agent":
      return { agentId: node.id };
  }
}

/** Whether a directive's scope is attached to exactly this node, not inherited from a broader one. */
export function attachedHere(scope: ScopeSelector, node: NodeRef, swarmId: string): boolean {
  switch (node.kind) {
    case "class":
      return sameScope(scope, { classId: node.id }) || sameScope(scope, { swarmId, classId: node.id });
    case "job":
      return sameScope(scope, { jobId: node.id }) || sameScope(scope, { swarmId, jobId: node.id });
    default:
      return sameScope(scope, nodeScope(node, swarmId));
  }
}

/** The question the Told and Settings tabs ask the server about this node. */
export function effectiveQuery(node: NodeRef, swarmId: string): EffectiveSteeringQuery {
  switch (node.kind) {
    case "swarm":
      return { swarmId };
    case "class":
      return { swarmId, classId: node.id };
    case "job":
      return { swarmId, jobId: node.id };
    case "agent":
      return { swarmId, agentId: node.id };
  }
}

/** What a selected node is, resolved against the tree. */
export interface NodeInfo {
  title: string;
  kindLabel: string;
  cls: ClassNode | null;
  job: JobNode | null;
  agent: AgentNode | null;
}

export function findNode(tree: SwarmTreeDTO, node: NodeRef): NodeInfo | null {
  if (node.kind === "swarm") {
    return { title: tree.swarm.name, kindLabel: "Swarm", cls: null, job: null, agent: null };
  }
  for (const cls of tree.classes) {
    if (node.kind === "class") {
      if (cls.cls.id === node.id) {
        return { title: cls.cls.label, kindLabel: "Class", cls, job: null, agent: null };
      }
      continue;
    }
    for (const job of cls.jobs) {
      if (node.kind === "job") {
        if (job.job.id === node.id) {
          return { title: job.job.label, kindLabel: "Job", cls, job, agent: null };
        }
        continue;
      }
      const agent = job.agents.find((a) => a.agent.id === node.id);
      if (agent) {
        return { title: agent.agent.name, kindLabel: "Agent", cls, job, agent };
      }
    }
  }
  return null;
}
