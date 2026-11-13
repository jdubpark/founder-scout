/**
 * Steering: how a person's parameters, opinions, context and rules reach the
 * agents.
 *
 * A directive is attached to a scope. Scopes nest from broad to narrow:
 *
 *   global  >  swarm  >  class of agents  >  job  >  one agent
 *
 * A class or job scope may also be limited to one swarm. When an agent runs,
 * every active directive whose scope contains that agent applies:
 *   - param:   the narrowest scope wins for each key;
 *   - rule, opinion, context: all of them apply, ordered broad to narrow, and
 *     the agent is told that later lines win conflicts.
 *
 * These functions are pure so the server, the tests and the dashboard preview
 * all compute exactly the same answer.
 */

import { COMPANY_DIMENSIONS, type CompanyDimensionId } from "./company";
import { coerceParam, getParamDef, type ParamValue } from "./params";
import { DIMENSIONS, type DimensionId } from "./rubric";
import {
  getClass,
  getJob,
  type ClassId,
  type Effort,
  type JobId,
  type ModelRoute,
  type ProviderId,
} from "./registry";
import { DEFAULT_MODEL_BY_PROVIDER, DEFAULT_ROUTES } from "./models";

export type DirectiveKind = "param" | "rule" | "opinion" | "context";
export type DirectiveStatus = "active" | "paused" | "archived";
export type ScopeLevel = "global" | "swarm" | "class" | "job" | "agent";

/**
 * Which agents a directive applies to. An empty selector is global.
 * `agentId` addresses one agent and makes the other fields irrelevant.
 * `jobId` implies its class, so `classId` is ignored when `jobId` is set.
 */
export interface ScopeSelector {
  swarmId?: string;
  classId?: ClassId;
  jobId?: JobId;
  agentId?: string;
}

export interface Directive {
  id: string;
  scope: ScopeSelector;
  kind: DirectiveKind;
  /** Parameter key. Set only when kind is "param". */
  key: string | null;
  /** Parameter value. Set only when kind is "param". */
  value: ParamValue | null;
  /** The instruction, preference or fact. Set for rule, opinion and context. */
  text: string | null;
  /** Tie-breaker within the same scope level. Higher wins. Default 0. */
  priority: number;
  status: DirectiveStatus;
  author: string;
  /** Optional reason shown in the audit trail. */
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp after which the directive stops applying, or null. */
  expiresAt: string | null;
}

/**
 * The agent a steering lookup is for. Use `swarmIdentity` for values that are
 * read once per run rather than by one agent.
 */
export interface AgentIdentity {
  swarmId: string;
  classId: ClassId | null;
  jobId: JobId | null;
  agentId: string | null;
}

export function swarmIdentity(swarmId: string): AgentIdentity {
  return { swarmId, classId: null, jobId: null, agentId: null };
}

/** Drop redundant fields so equal scopes compare equal. */
export function normalizeScope(scope: ScopeSelector): ScopeSelector {
  if (scope.agentId) return { agentId: scope.agentId };
  const out: ScopeSelector = {};
  if (scope.swarmId) out.swarmId = scope.swarmId;
  if (scope.jobId) out.jobId = scope.jobId;
  else if (scope.classId) out.classId = scope.classId;
  return out;
}

export function scopeLevel(scope: ScopeSelector): ScopeLevel {
  if (scope.agentId) return "agent";
  if (scope.jobId) return "job";
  if (scope.classId) return "class";
  if (scope.swarmId) return "swarm";
  return "global";
}

/**
 * Larger is narrower. A class or job scope limited to one swarm is narrower
 * than the same scope across all swarms.
 */
export function scopeSpecificity(scope: ScopeSelector): number {
  switch (scopeLevel(scope)) {
    case "global":
      return 0;
    case "swarm":
      return 2;
    case "class":
      return scope.swarmId ? 5 : 4;
    case "job":
      return scope.swarmId ? 7 : 6;
    case "agent":
      return 8;
  }
}

export function scopeMatches(scope: ScopeSelector, agent: AgentIdentity): boolean {
  if (scope.agentId) return agent.agentId !== null && scope.agentId === agent.agentId;
  if (scope.swarmId && scope.swarmId !== agent.swarmId) return false;
  if (scope.jobId) return agent.jobId !== null && scope.jobId === agent.jobId;
  if (scope.classId) return agent.classId !== null && scope.classId === agent.classId;
  return true;
}

export interface ScopeNames {
  swarms?: Record<string, string>;
  agents?: Record<string, string>;
}

/** A short human label such as "Swarm: AI infrastructure" or "All scouts". */
export function scopeLabel(scope: ScopeSelector, names: ScopeNames = {}): string {
  const swarmName = scope.swarmId ? (names.swarms?.[scope.swarmId] ?? "this swarm") : null;
  switch (scopeLevel(scope)) {
    case "global":
      return "Everything";
    case "swarm":
      return `Swarm: ${swarmName}`;
    case "class": {
      const label = getClass(scope.classId!).label;
      return swarmName ? `${label} in ${swarmName}` : `All ${label.toLowerCase()}`;
    }
    case "job": {
      const label = getJob(scope.jobId!).label;
      return swarmName ? `${label} in ${swarmName}` : `Every ${label.toLowerCase()}`;
    }
    case "agent":
      return `Agent: ${names.agents?.[scope.agentId!] ?? scope.agentId}`;
  }
}

export function isDirectiveActive(d: Directive, now: Date): boolean {
  if (d.status !== "active") return false;
  if (d.expiresAt && new Date(d.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

export interface ResolvedParam {
  value: ParamValue;
  directiveId: string;
  scope: ScopeSelector;
}

export interface GuidanceLine {
  kind: "rule" | "opinion" | "context";
  text: string;
  directiveId: string;
  scope: ScopeSelector;
}

export interface ResolvedSteering {
  /** Winning parameter directive per key. */
  params: Record<string, ResolvedParam>;
  /** Rules, opinions and context, ordered broad to narrow. */
  guidance: GuidanceLine[];
  /** Every directive that applied, including overridden parameter directives. */
  directiveIds: string[];
  /** Parameter directives that were ignored because the value is invalid. */
  invalid: Array<{ directiveId: string; error: string }>;
}

export const EMPTY_STEERING: ResolvedSteering = {
  params: {},
  guidance: [],
  directiveIds: [],
  invalid: [],
};

/** Weakest first: broad scopes, then low priority, then older. */
function byStrength(a: Directive, b: Directive): number {
  return (
    scopeSpecificity(a.scope) - scopeSpecificity(b.scope) ||
    a.priority - b.priority ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

export function resolveSteering(
  directives: readonly Directive[],
  agent: AgentIdentity,
  now: Date = new Date(),
): ResolvedSteering {
  const applicable = directives
    .filter((d) => isDirectiveActive(d, now) && scopeMatches(d.scope, agent))
    .sort(byStrength);

  const out: ResolvedSteering = { params: {}, guidance: [], directiveIds: [], invalid: [] };

  for (const d of applicable) {
    if (d.kind === "param") {
      if (!d.key) {
        out.invalid.push({ directiveId: d.id, error: "Parameter directive has no key." });
        continue;
      }
      const checked = coerceParam(d.key, d.value);
      if (!checked.ok) {
        out.invalid.push({ directiveId: d.id, error: checked.error });
        continue;
      }
      // Sorted weakest first, so a later directive replaces an earlier one.
      out.params[d.key] = { value: checked.value, directiveId: d.id, scope: d.scope };
      out.directiveIds.push(d.id);
      continue;
    }
    const text = d.text?.trim();
    if (!text) continue;
    out.guidance.push({ kind: d.kind, text, directiveId: d.id, scope: d.scope });
    out.directiveIds.push(d.id);
  }

  return out;
}

/**
 * The text block placed in an agent's prompt. Operator steering is trusted
 * input, unlike web pages and other evidence, which prompts must fence off as
 * data. Returns an empty string when there is no guidance.
 */
export function renderSteeringBlock(
  resolved: ResolvedSteering,
  names: ScopeNames = {},
): string {
  const section = (kind: GuidanceLine["kind"]) =>
    resolved.guidance
      .filter((g) => g.kind === kind)
      .map((g) => `- [${scopeLabel(g.scope, names)}] ${g.text}`);

  const rules = section("rule");
  const opinions = section("opinion");
  const context = section("context");
  if (rules.length + opinions.length + context.length === 0) return "";

  const parts: string[] = [
    "## Steering from the investment team",
    "Lines are ordered from broad to specific. When two lines conflict, the later one wins.",
  ];
  if (rules.length) {
    parts.push("", "Rules. Always follow these. A rule beats a preference.", ...rules);
  }
  if (opinions.length) {
    parts.push("", "Preferences. Weigh these whenever you make a judgment call.", ...opinions);
  }
  if (context.length) {
    parts.push("", "Context. Facts you can rely on.", ...context);
  }
  return parts.join("\n");
}

/* ------------------------------------------------------------------ */
/* Config and effective values                                          */
/* ------------------------------------------------------------------ */

/**
 * A versioned set of tunable values for a swarm. The improvement loop proposes
 * new configs; a person promotes one to be the swarm's current config.
 */
export interface SwarmConfig {
  id: string;
  label: string;
  /** Flat parameter overrides, same key space as PARAM_DEFS. */
  params: Record<string, ParamValue>;
  /** Model route per job. Jobs not listed use DEFAULT_ROUTES. */
  routes: Partial<Record<JobId, ModelRoute>>;
  /** Named prompt variant per job. Jobs not listed use "base". */
  promptVariants: Partial<Record<JobId, string>>;
}

export const BASE_CONFIG: SwarmConfig = {
  id: "cfg_base",
  label: "Base configuration",
  params: {},
  routes: {},
  promptVariants: {},
};

export type ParamOrigin = "directive" | "config" | "default";

export interface EffectiveParam {
  key: string;
  value: ParamValue | null;
  origin: ParamOrigin;
  directiveId: string | null;
  scope: ScopeSelector | null;
}

/** A parameter's value after layering default < config < directive. */
export function effectiveParam(
  key: string,
  resolved: ResolvedSteering,
  config: SwarmConfig,
): EffectiveParam {
  const fromDirective = resolved.params[key];
  if (fromDirective) {
    return {
      key,
      value: fromDirective.value,
      origin: "directive",
      directiveId: fromDirective.directiveId,
      scope: fromDirective.scope,
    };
  }
  if (key in config.params) {
    const checked = coerceParam(key, config.params[key]);
    if (checked.ok) {
      return { key, value: checked.value, origin: "config", directiveId: null, scope: null };
    }
  }
  return {
    key,
    value: getParamDef(key)?.default ?? null,
    origin: "default",
    directiveId: null,
    scope: null,
  };
}

export function numberParam(key: string, resolved: ResolvedSteering, config: SwarmConfig): number {
  const v = effectiveParam(key, resolved, config).value;
  if (typeof v !== "number") throw new Error(`Parameter ${key} has no numeric value.`);
  return v;
}

export function booleanParam(key: string, resolved: ResolvedSteering, config: SwarmConfig): boolean {
  const v = effectiveParam(key, resolved, config).value;
  if (typeof v !== "boolean") throw new Error(`Parameter ${key} has no boolean value.`);
  return v;
}

export function stringParam(key: string, resolved: ResolvedSteering, config: SwarmConfig): string {
  const v = effectiveParam(key, resolved, config).value;
  if (typeof v !== "string") throw new Error(`Parameter ${key} has no text value.`);
  return v;
}

export function effectiveWeights(
  resolved: ResolvedSteering,
  config: SwarmConfig,
): Record<DimensionId, number> {
  const out = {} as Record<DimensionId, number>;
  for (const d of DIMENSIONS) out[d.id] = numberParam(`weights.${d.id}`, resolved, config);
  return out;
}

/** Company rubric weights. Read for the company analyst, the job they are attached to. */
export function effectiveCompanyWeights(
  resolved: ResolvedSteering,
  config: SwarmConfig,
): Record<CompanyDimensionId, number> {
  const out = {} as Record<CompanyDimensionId, number>;
  for (const d of COMPANY_DIMENSIONS) out[d.id] = numberParam(`cweights.${d.id}`, resolved, config);
  return out;
}

export interface Thresholds {
  minFit: number;
  surface: number;
  watch: number;
  minCoverage: number;
  unknownPrior: number;
}

export function effectiveThresholds(resolved: ResolvedSteering, config: SwarmConfig): Thresholds {
  return {
    minFit: numberParam("screen.min_fit", resolved, config),
    surface: numberParam("assess.surface_threshold", resolved, config),
    watch: numberParam("assess.watch_threshold", resolved, config),
    minCoverage: numberParam("assess.min_coverage", resolved, config),
    unknownPrior: numberParam("assess.unknown_prior", resolved, config),
  };
}

/**
 * The model route for a job: route.* directives for this agent, over the
 * config's route, over the built-in default. A directive that changes only the
 * provider gets that provider's default model.
 */
export function effectiveRoute(
  jobId: JobId,
  resolved: ResolvedSteering,
  config: SwarmConfig,
): ModelRoute {
  const base: ModelRoute = config.routes[jobId] ?? DEFAULT_ROUTES[jobId];
  const provider = resolved.params["route.provider"]?.value as ProviderId | undefined;
  const model = resolved.params["route.model"]?.value as string | undefined;
  const effort = resolved.params["route.effort"]?.value as Effort | undefined;

  const route: ModelRoute = { ...base };
  if (provider && provider !== base.provider) {
    route.provider = provider;
    route.model = DEFAULT_MODEL_BY_PROVIDER[provider];
  }
  if (model) route.model = model;
  if (effort) route.effort = effort;
  return route;
}
