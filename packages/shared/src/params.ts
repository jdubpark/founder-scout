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

import { COMPANY_DIMENSIONS, type CompanyDimensionId } from "./company";
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
  | "outreach"
  | "checks";

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

const companyWeightParams: ParamDef[] = COMPANY_DIMENSIONS.map((d) => ({
  key: `cweights.${d.id}`,
  label: `Company weight: ${d.label}`,
  help: `How much "${d.label}" counts toward a company's score. 0 ignores it.`,
  type: "number",
  default: d.defaultWeight,
  min: 0,
  max: 5,
  step: 0.25,
  group: "weights",
  appliesTo: ["assess.company"],
  // The ranking eval measures founders only, so it must not spend rounds on these.
  tunable: false,
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
    key: "hunt.enabled",
    label: "Hunt the open web",
    help: "Whether a run includes the hunt: a navigator that sends runners to read public pages for people starting something.",
    type: "boolean",
    default: true,
    group: "volume",
    appliesTo: ["swarm"],
    tunable: false,
  },
  {
    key: "hunt.turns",
    label: "Navigator turns per run",
    help: "How many times in one run the navigator looks at its notebook and decides what the runners do next.",
    type: "int",
    default: 4,
    min: 1,
    max: 20,
    step: 1,
    group: "volume",
    appliesTo: ["navigator"],
    tunable: false,
  },
  {
    key: "hunt.wave_size",
    label: "Runner calls per wave",
    help: "How many pages and searches the runners take on after each navigator turn.",
    type: "int",
    default: 12,
    min: 2,
    max: 60,
    step: 2,
    group: "volume",
    appliesTo: ["runner"],
    tunable: false,
  },
  {
    key: "hunt.max_depth",
    label: "Links followed from a start",
    help: "How many links away from a starting page or search result a runner may go.",
    type: "int",
    default: 2,
    min: 0,
    max: 5,
    step: 1,
    group: "volume",
    appliesTo: ["runner"],
    tunable: true,
  },
  {
    key: "hunt.budget_share",
    label: "Share of a run's spend for the hunt",
    help: "The most of a run's spend cap the navigator and its runners may use. The rest is kept for looking closely at the people found.",
    type: "number",
    default: 0.25,
    min: 0.05,
    max: 0.9,
    step: 0.05,
    group: "budget",
    appliesTo: ["swarm"],
    tunable: false,
  },
  {
    key: "hunt.latest_stage",
    label: "Latest stage worth a look",
    help: "A company whose page states a later round than this is left out before any money is spent on it.",
    type: "enum",
    default: "seed",
    options: ["pre_seed", "seed", "series_a"],
    group: "thresholds",
    appliesTo: ["swarm"],
    tunable: false,
  },
  {
    key: "hunt.planted_every",
    label: "Planted page, one in",
    help: "One page in this many that a runner reads is written by code to test it: it names no founder and tells the reader to report one.",
    type: "int",
    default: 12,
    min: 4,
    max: 100,
    step: 1,
    group: "checks",
    appliesTo: ["runner"],
    tunable: false,
  },
  {
    key: "hunt.pages_per_search",
    label: "Pages read for each search",
    help: "While a trail has both waiting, it reads this many pages for each search it runs.",
    type: "int",
    default: 3,
    min: 1,
    max: 10,
    step: 1,
    group: "volume",
    appliesTo: ["runner"],
    tunable: true,
  },
  {
    key: "hunt.stale_after",
    label: "Pages before a dry trail closes",
    help: "A trail that has read this many pages and found nobody is closed by code.",
    type: "int",
    default: 30,
    min: 5,
    max: 200,
    step: 5,
    group: "volume",
    appliesTo: ["runner"],
    tunable: true,
  },
  {
    key: "hunt.navigator",
    label: "Who steers the hunt",
    help: "built_in is the navigator job. outside hands the navigator's seat to an agent of yours that connects to the swarm; what it asks for passes the same checks.",
    type: "enum",
    default: "built_in",
    options: ["built_in", "outside"],
    group: "routing",
    appliesTo: ["swarm"],
    tunable: false,
  },
  {
    key: "hunt.outside_idle_days",
    label: "Days before the built-in navigator steps back in",
    help: "When an outside agent holds the seat and takes no turn for this many days, the built-in navigator steers so the hunt does not stall.",
    type: "int",
    default: 2,
    min: 1,
    max: 30,
    step: 1,
    group: "routing",
    appliesTo: ["swarm"],
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
    // A starting point, not a finding: in simulation this surfaces about a tenth of the founders
    // investigated. Set it from the first week of real runs, with the slider on the Founders page.
    default: 0.58,
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
  ...companyWeightParams,
  {
    key: "deal.team_share",
    label: "Share of a company's score that comes from its founders",
    help: "0.6 means the founders count for 60% and the company for 40%. Early companies are mostly their people.",
    type: "number",
    default: 0.6,
    min: 0,
    max: 1,
    step: 0.05,
    group: "weights",
    appliesTo: ["assess.company"],
    tunable: false,
  },
  {
    key: "company.max_companies",
    label: "Companies researched per run",
    help: "The most companies that get a full look in one run. 0 turns company research off.",
    type: "int",
    default: 8,
    min: 0,
    max: 100,
    step: 1,
    group: "volume",
    appliesTo: ["company"],
    tunable: false,
  },
  {
    key: "verify.quote_check",
    label: "Check quotes against their sources",
    help: "Before the fact-checker runs, code opens each cited page and rejects an item whose quoted words are not there.",
    type: "boolean",
    default: true,
    group: "checks",
    appliesTo: ["verifier"],
    tunable: false,
  },
  {
    key: "verify.control",
    label: "Plant a known false claim in each fact-check",
    help: "One made-up claim is added to every fact-check. If the checker accepts it, that call's verdicts are thrown away.",
    type: "boolean",
    default: true,
    group: "checks",
    appliesTo: ["verifier"],
    tunable: false,
  },
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

export function companyWeightKey(dimension: CompanyDimensionId): string {
  return `cweights.${dimension}`;
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
