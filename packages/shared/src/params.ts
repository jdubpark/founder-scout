/**
 * The registry of tunable parameters.
 *
 * One flat key space is shared by three layers, weakest first:
 *   1. the default in this file,
 *   2. the swarm's current config (changed by promoting an eval winner),
 *   3. a `param` steering directive (set by a person in the dashboard).
 * A person's directive always beats the config, and a narrower scope beats a
 * broader one. See steering.ts for the resolution rules.
 */

import { DIMENSIONS, type DimensionId } from "./rubric";
import { EFFORTS, PROVIDER_IDS, type ClassId, type JobId } from "./registry";

export type ParamType = "int" | "number" | "boolean" | "string" | "enum";
export type ParamValue = number | boolean | string;

export type ParamGroup =
  | "volume"
  | "thresholds"
  | "weights"
  | "routing"
  | "budget"
  | "outreach";

/** Where a parameter is meaningful. "swarm" means it is read once per run. */
export type ParamTarget = "swarm" | ClassId | JobId;

export interface ParamDef {
  key: string;
  label: string;
  help: string;
  type: ParamType;
  default: ParamValue | null;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  group: ParamGroup;
  appliesTo: readonly ParamTarget[];
  /** true = the automatic improvement loop may change it in a config. */
  tunable: boolean;
}

const weightParams: ParamDef[] = DIMENSIONS.map((d) => ({
  key: `weights.${d.id}`,
  label: `Weight: ${d.label}`,
  help: `How much "${d.label}" counts toward the overall score. 0 ignores it.`,
  type: "number",
  default: d.defaultWeight,
  min: 0,
  max: 5,
  step: 0.25,
  group: "weights",
  appliesTo: ["swarm"],
  tunable: true,
}));

export const PARAM_DEFS: readonly ParamDef[] = [
  {
    key: "scout.max_items",
    label: "Items scanned per scout",
    help: "The most raw items (posts, repositories, papers, profiles) one scout reads in a run.",
    type: "int",
    default: 40,
    min: 5,
    max: 500,
    step: 5,
    group: "volume",
    appliesTo: ["scout"],
    tunable: false,
  },
  {
    key: "scout.lookback_hours",
    label: "Scout lookback window (hours)",
    help: "How far back a scout looks for new items when it has no saved position.",
    type: "int",
    default: 36,
    min: 6,
    max: 720,
    step: 6,
    group: "volume",
    appliesTo: ["scout"],
    tunable: false,
  },
  {
    key: "screen.min_fit",
    label: "Minimum thesis fit",
    help: "Founders below this fit score (0 to 1) are set aside without a deep dive.",
    type: "number",
    default: 0.55,
    min: 0,
    max: 1,
    step: 0.05,
    group: "thresholds",
    appliesTo: ["swarm"],
    tunable: true,
  },
  {
    key: "investigate.max_founders",
    label: "Deep dives per run",
    help: "The most founders that get a full investigation in one run. This is the main cost lever.",
    type: "int",
    default: 10,
    min: 1,
    max: 200,
    step: 1,
    group: "volume",
    appliesTo: ["swarm"],
    tunable: false,
  },
  {
    key: "investigate.depth",
    label: "Investigation depth",
    help: "quick = a few sources, standard = a normal dossier, deep = exhaustive.",
    type: "enum",
    default: "standard",
    options: ["quick", "standard", "deep"],
    group: "volume",
    appliesTo: ["investigator"],
    tunable: false,
  },
  {
    key: "assess.surface_threshold",
    label: "Bar to surface a founder",
    help: "Overall score (0 to 1) at or above which a founder is put in front of the partners.",
    type: "number",
    default: 0.62,
    min: 0,
    max: 1,
    step: 0.01,
    group: "thresholds",
    appliesTo: ["swarm"],
    tunable: true,
  },
  {
    key: "assess.watch_threshold",
    label: "Bar to keep watching",
    help: "Founders between this score and the surface bar stay on the watchlist and are re-checked later.",
    type: "number",
    default: 0.48,
    min: 0,
    max: 1,
    step: 0.01,
    group: "thresholds",
    appliesTo: ["swarm"],
    tunable: true,
  },
  {
    key: "assess.min_coverage",
    label: "Minimum evidence coverage",
    help: "Share of the rubric (0 to 1) that must be backed by confident evidence before a founder can be surfaced.",
    type: "number",
    default: 0.45,
    min: 0,
    max: 1,
    step: 0.05,
    group: "thresholds",
    appliesTo: ["swarm"],
    tunable: true,
  },
  {
    key: "assess.unknown_prior",
    label: "Score assumed when evidence is missing",
    help: "The value (0 to 1) a rubric question contributes when nothing settles it. Lower is more sceptical of thin profiles.",
    type: "number",
    default: 0.35,
    min: 0,
    max: 1,
    step: 0.05,
    group: "thresholds",
    appliesTo: ["swarm"],
    tunable: true,
  },
  ...weightParams,
  {
    key: "route.provider",
    label: "Model provider",
    help: "Which provider runs this job.",
    type: "enum",
    default: null,
    options: PROVIDER_IDS,
    group: "routing",
    appliesTo: ["scout", "screener", "investigator", "verifier", "analyst", "outreach"],
    tunable: true,
  },
  {
    key: "route.model",
    label: "Model",
    help: "The exact model id the provider should use for this job.",
    type: "string",
    default: null,
    group: "routing",
    appliesTo: ["scout", "screener", "investigator", "verifier", "analyst", "outreach"],
    tunable: true,
  },
  {
    key: "route.effort",
    label: "Reasoning effort",
    help: "How hard the model thinks. Higher is slower and costs more.",
    type: "enum",
    default: null,
    options: EFFORTS,
    group: "routing",
    appliesTo: ["scout", "screener", "investigator", "verifier", "analyst", "outreach"],
    tunable: true,
  },
  {
    key: "budget.run_usd",
    label: "Spend cap per run (USD)",
    help: "A run stops starting new work once it has spent this much.",
    type: "number",
    default: 25,
    min: 0,
    max: 5000,
    step: 1,
    group: "budget",
    appliesTo: ["swarm"],
    tunable: false,
  },
  {
    key: "budget.task_usd",
    label: "Spend cap per task (USD)",
    help: "The most one agent task may spend before it is cut off.",
    type: "number",
    default: 2,
    min: 0,
    max: 100,
    step: 0.25,
    group: "budget",
    appliesTo: ["scout", "screener", "investigator", "verifier", "analyst", "outreach"],
    tunable: false,
  },
  {
    key: "run.concurrency",
    label: "Tasks in parallel",
    help: "How many agent tasks run at the same time.",
    type: "int",
    default: 4,
    min: 1,
    max: 32,
    step: 1,
    group: "budget",
    appliesTo: ["swarm"],
    tunable: false,
  },
  {
    key: "outreach.enabled",
    label: "Propose outreach",
    help: "When on, the swarm drafts emails and call plans for surfaced founders. They still wait for approval.",
    type: "boolean",
    default: true,
    group: "outreach",
    appliesTo: ["swarm"],
    tunable: false,
  },
  {
    key: "outreach.max_proposals",
    label: "Outreach proposals per run",
    help: "The most founders the swarm drafts outreach for in one run.",
    type: "int",
    default: 5,
    min: 0,
    max: 50,
    step: 1,
    group: "outreach",
    appliesTo: ["swarm"],
    tunable: false,
  },
  {
    key: "recheck.days",
    label: "Watchlist re-check interval (days)",
    help: "How often a watched founder is investigated again for new evidence.",
    type: "int",
    default: 21,
    min: 1,
    max: 365,
    step: 1,
    group: "volume",
    appliesTo: ["swarm"],
    tunable: false,
  },
];

const BY_KEY = new Map(PARAM_DEFS.map((p) => [p.key, p]));

export function getParamDef(key: string): ParamDef | undefined {
  return BY_KEY.get(key);
}

export function isParamKey(key: string): boolean {
  return BY_KEY.has(key);
}

export function weightKey(dimension: DimensionId): string {
  return `weights.${dimension}`;
}

export type ParamCheck =
  | { ok: true; value: ParamValue }
  | { ok: false; error: string };

/**
 * Validate and normalise a value for a parameter. Accepts strings for numeric
 * and boolean parameters because form inputs produce strings.
 */
export function coerceParam(key: string, raw: unknown): ParamCheck {
  const def = BY_KEY.get(key);
  if (!def) return { ok: false, error: `Unknown parameter "${key}".` };

  if (def.type === "boolean") {
    if (typeof raw === "boolean") return { ok: true, value: raw };
    if (raw === "true") return { ok: true, value: true };
    if (raw === "false") return { ok: true, value: false };
    return { ok: false, error: `${def.label} must be on or off.` };
  }

  if (def.type === "int" || def.type === "number") {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a number.` };
    if (def.type === "int" && !Number.isInteger(n)) {
      return { ok: false, error: `${def.label} must be a whole number.` };
    }
    if (def.min !== undefined && n < def.min) {
      return { ok: false, error: `${def.label} must be at least ${def.min}.` };
    }
    if (def.max !== undefined && n > def.max) {
      return { ok: false, error: `${def.label} must be at most ${def.max}.` };
    }
    return { ok: true, value: n };
  }

  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: `${def.label} must be text.` };
  }
  const text = raw.trim();
  if (def.type === "enum" && def.options && !def.options.includes(text)) {
    return { ok: false, error: `${def.label} must be one of: ${def.options.join(", ")}.` };
  }
  return { ok: true, value: text };
}

/** Whether a parameter is meaningful for an agent of this class and job. */
export function paramAppliesTo(def: ParamDef, classId: ClassId, jobId: JobId): boolean {
  return (
    def.appliesTo.includes("swarm") ||
    def.appliesTo.includes(classId) ||
    def.appliesTo.includes(jobId)
  );
}
