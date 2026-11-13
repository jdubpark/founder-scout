/**
 * The "what will this agent actually be told" view, shared by the server and
 * the dashboard's demo client so both show exactly the same answer.
 */

import type { EffectiveSteeringDTO } from "./api";
import { CLASSES_SHOWN_CALLS, renderCallsBlock, type CallExample } from "./feedback";
import { PARAM_DEFS, paramAppliesTo, type ParamDef } from "./params";
import { getJob, type JobKind } from "./registry";
import { skillsForScope, type Skill } from "./skills";
import {
  effectiveParam,
  effectiveRoute,
  renderSteeringBlock,
  resolveSteering,
  scopeLabel,
  type AgentIdentity,
  type Directive,
  type ScopeNames,
  type SwarmConfig,
} from "./steering";

const MODEL_KINDS: readonly JobKind[] = ["structured", "research", "search", "repo_review"];

/** Parameters that are meaningful at this point in the swarm → class → job → agent tree. */
export function paramsFor(identity: AgentIdentity): ParamDef[] {
  if (identity.jobId && identity.classId) {
    const { classId, jobId } = identity;
    return PARAM_DEFS.filter(
      (def) => !def.appliesTo.includes("swarm") && paramAppliesTo(def, classId, jobId),
    );
  }
  if (identity.classId) {
    const { classId } = identity;
    return PARAM_DEFS.filter((def) => def.appliesTo.includes(classId));
  }
  return PARAM_DEFS.filter((def) => def.appliesTo.includes("swarm"));
}

export function buildEffectiveSteering(args: {
  directives: readonly Directive[];
  identity: AgentIdentity;
  config: SwarmConfig;
  names: ScopeNames;
  /** Human label for what is being resolved, for example "GitHub scout 1". */
  label: string;
  /** Recent partner calls for this swarm. Shown only to the classes that receive them. */
  calls?: readonly CallExample[];
  now?: Date;
  skillLibrary?: readonly Skill[];
}): EffectiveSteeringDTO {
  const { directives, identity, config, names, label } = args;
  const resolved = resolveSteering(directives, identity, args.now ?? new Date());

  const params = paramsFor(identity).map((def) => {
    const eff = effectiveParam(def.key, resolved, config);
    return {
      ...eff,
      label: def.label,
      scopeLabel: eff.scope ? scopeLabel(eff.scope, names) : null,
    };
  });

  const jobIsModelBacked =
    identity.jobId !== null && MODEL_KINDS.includes(getJob(identity.jobId).kind);

  return {
    label,
    resolved,
    block: renderSteeringBlock(resolved, names),
    callsBlock:
      identity.classId && CLASSES_SHOWN_CALLS.includes(identity.classId)
        ? renderCallsBlock(args.calls ?? [])
        : "",
    params,
    route: identity.jobId && jobIsModelBacked ? effectiveRoute(identity.jobId, resolved, config) : null,
    guidance: resolved.guidance.map((g) => ({
      kind: g.kind,
      text: g.text,
      directiveId: g.directiveId,
      scopeLabel: scopeLabel(g.scope, names),
    })),
    skills: skillsForScope(args.skillLibrary ?? [], identity.jobId, identity.classId).map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      off: String(effectiveParam("skills.off", resolved, config).value ?? "").split(",").map((id) => id.trim()).includes(skill.id),
    })),
  };
}
