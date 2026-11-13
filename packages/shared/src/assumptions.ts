/**
 * The assumptions behind "find the best founders".
 *
 * The objective is loose, and a system that acts on it has to fill it in. Some of what it
 * fills in is written down where a person can change it: ten rubric questions and their
 * weights, the share given to the founder against the company, a bar. Some is not written
 * anywhere: that "best" means the later outcome and not a partner's Yes, that a launch post
 * holds enough to judge a company, that removing names stops a model recognising one.
 *
 * This file is the list of both kinds, each as a statement that could turn out false, with
 * how it is tested on the system's own data. Code computes the evidence and the status. A
 * model never marks an assumption supported.
 *
 * Two sources of evidence, kept apart on purpose:
 *   outcomes  past companies whose result is known (the past-founders eval), earlier periods
 *             only, so the later periods stay untouched for the headline;
 *   calls     the partner's own Yes and No.
 * When the two disagree, that is the finding: the partner's taste and what happened next are
 * different things, and the page shows both.
 */

import { DIMENSIONS, type DimensionId } from "./rubric";
import { COMPANY_DIMENSIONS, type CompanyDimensionId } from "./company";
import { separationDifference, separationStat, shuffledBaseline, type PairedRow, type SeparationRow, type SeparationStat } from "./stats";

export type AssumptionArea = "founder" | "company" | "weighing" | "objective" | "method";

export const ASSUMPTION_AREAS: ReadonlyArray<{ id: AssumptionArea; label: string }> = [
  { id: "objective", label: "What \"best\" means" },
  { id: "weighing", label: "Founder against company" },
  { id: "founder", label: "What makes a great founder" },
  { id: "company", label: "What makes a company worth funding" },
  { id: "method", label: "How the swarm finds out" },
];

export type AssumptionTest =
  | { kind: "founder_question"; dimension: DimensionId }
  | { kind: "company_question"; dimension: CompanyDimensionId }
  | { kind: "score"; which: "founder" | "company" | "deal" }
  /** The combined score ranks better than the better of its two parts. */
  | { kind: "combination" }
  /** Shuffled outcomes give chance, and the real ones do better. */
  | { kind: "placebo" }
  /** Masked past cases are not recognised by the judging model. */
  | { kind: "recognition" }
  /** The evidence settles the rubric questions more often than not. */
  | { kind: "coverage" }
  /** Cannot be tested on the data held today. `how` says what would test it. */
  | { kind: "none"; how: string };

export interface AssumptionDef {
  id: string;
  area: AssumptionArea;
  /** A statement that could turn out false. */
  statement: string;
  /** true when it is written down where a person can change it. */
  stated: boolean;
  /** Where it lives, in words. */
  lives: string;
  /** The setting that carries it, when there is one. */
  paramKey: string | null;
  test: AssumptionTest;
  /** What published work says, when something relevant was found. Sources are in docs/research. */
  prior: { says: string; source: string } | null;
}

const founderQuestions: AssumptionDef[] = DIMENSIONS.map((dimension) => ({
  id: `founder.${dimension.id}`,
  area: "founder",
  statement: `Founders who rate higher on "${dimension.label}" go on to do better than their contemporaries.`,
  stated: true,
  lives: `Founder rubric, weight ${dimension.defaultWeight}`,
  paramKey: `weights.${dimension.id}`,
  test: { kind: "founder_question", dimension: dimension.id as DimensionId },
  prior: null,
}));

const companyQuestions: AssumptionDef[] = COMPANY_DIMENSIONS.map((dimension) => ({
  id: `company.${dimension.id}`,
  area: "company",
  statement: `Companies that rate higher on "${dimension.label}" go on to do better than their contemporaries.`,
  stated: true,
  lives: `Company rubric, weight ${dimension.defaultWeight}`,
  paramKey: `cweights.${dimension.id}`,
  test: { kind: "company_question", dimension: dimension.id as CompanyDimensionId },
  prior: null,
}));

const OTHER_ASSUMPTIONS: AssumptionDef[] = [
  {
    id: "objective.outcome",
    area: "objective",
    statement: "\"Best\" means how the company turned out, not whether a partner said Yes.",
    stated: false,
    lives: "Nowhere. The two evals answer different questions and nothing says which one leads.",
    paramKey: null,
    test: { kind: "none", how: "Once partner calls exist on companies whose outcome is known, compare how the Yes calls fared." },
    prior: { says: "Investors respond strongly to information about the team and not to traction, which is evidence about investors, not about outcomes.", source: "Bernstein, Korteweg and Laws, Journal of Finance 2017" },
  },
  {
    id: "objective.label",
    area: "objective",
    statement: "A company that is publicly listed, on its programme's list of top companies, or still operating with at least 100 people has succeeded.",
    stated: true,
    lives: "The past-founders dataset. Set when it is collected (--min-team).",
    paramKey: null,
    test: { kind: "none", how: "Label the same companies a second way, for example by later funding, and compare." },
    prior: null,
  },
  {
    id: "objective.stable",
    area: "objective",
    statement: "What the partner wants stays the same while they grade.",
    stated: false,
    lives: "Nowhere. Every call is counted the same whenever it was made.",
    paramKey: null,
    test: { kind: "none", how: "Record the rubric version on each call and compare calls made under different versions." },
    prior: { says: "People's criteria shift as they grade outputs: grading changes what they are grading for.", source: "Shankar et al., arXiv 2404.12272" },
  },
  {
    id: "weighing.founder",
    area: "weighing",
    statement: "The founder score alone ranks later winners above their contemporaries.",
    stated: false,
    lives: "The founder rubric as a whole.",
    paramKey: null,
    test: { kind: "score", which: "founder" },
    prior: null,
  },
  {
    id: "weighing.company",
    area: "weighing",
    statement: "The company score alone ranks later winners above their contemporaries.",
    stated: false,
    lives: "The company rubric as a whole.",
    paramKey: null,
    test: { kind: "score", which: "company" },
    prior: { says: "From business plan to public offering, the line of business stayed stable while management turned over.", source: "Kaplan, Sensoy and Stromberg, Journal of Finance 2009" },
  },
  {
    id: "weighing.together",
    area: "weighing",
    statement: "Founder and company together rank better than either alone.",
    stated: true,
    lives: "Founders' share of the decision.",
    paramKey: "deal.team_share",
    test: { kind: "combination" },
    prior: { says: "The published work does not settle how much weight belongs on the people against the business.", source: "docs/research/objectives-and-founder-evidence.md" },
  },
  {
    id: "method.launch",
    area: "method",
    statement: "What a company publishes is enough to answer most rubric questions about it.",
    stated: false,
    lives: "Nowhere. An unanswered question falls back to a neutral value.",
    paramKey: "assess.unknown_prior",
    test: { kind: "coverage" },
    prior: null,
  },
  {
    id: "method.signal",
    area: "method",
    statement: "The score on past companies reflects the companies, not chance.",
    stated: false,
    lives: "The past-founders eval.",
    paramKey: null,
    test: { kind: "placebo" },
    prior: null,
  },
  {
    id: "method.masking",
    area: "method",
    statement: "Removing names and dates stops a model recognising a past company.",
    stated: true,
    lives: "The past-founders eval masks every case and then asks the model to name it.",
    paramKey: null,
    test: { kind: "recognition" },
    prior: { says: "A model named the company in every masked earnings call from three large firms, and in over 85% for seven.", source: "Lopez-Lira, Tang and Zhu, arXiv 2504.14765" },
  },
  {
    id: "method.memory",
    area: "method",
    statement: "A judge trained after these outcomes does not already know how the companies turned out.",
    stated: false,
    lives: "Nowhere. It cannot be made true for cases older than the judge.",
    paramKey: null,
    test: { kind: "none", how: "Score companies that launch after the judging model was trained, and wait for their outcomes. Today's assessments are that record." },
    prior: { says: "Models recalled exact values from before their training cut-off and none from after it.", source: "Lopez-Lira, Tang and Zhu, arXiv 2504.14765" },
  },
  {
    id: "method.bar",
    area: "method",
    statement: "The bar surfaces about a tenth of the founders investigated.",
    stated: true,
    lives: "Bar to surface. Set on simulated founders.",
    paramKey: "assess.surface_threshold",
    test: { kind: "none", how: "Count what real runs surface in their first week and move the bar." },
    prior: null,
  },
  {
    id: "method.agents",
    area: "method",
    statement: "Several agents working apart find more than one agent working alone.",
    stated: false,
    lives: "The shape of the pipeline: scouts and investigators run side by side.",
    paramKey: "run.concurrency",
    test: { kind: "none", how: "Run one founder through one investigator with every tool, and compare the supported evidence and the cost." },
    prior: { says: "Several agents gained up to 81% on work that splits into independent parts and lost up to 70% on work that must be done in order.", source: "Kim et al., arXiv 2512.08296" },
  },
];

export const ASSUMPTIONS: readonly AssumptionDef[] = [...OTHER_ASSUMPTIONS, ...founderQuestions, ...companyQuestions];

/* ----------------------------- Evidence ----------------------------- */

/** One judged case, reduced to what the tests need. Carries no name and no text. */
export interface JudgedCase {
  /** Cases are compared only inside a group: a period for past companies, one group for calls. */
  group: string;
  /** 1 for a later winner or a partner's Yes. */
  outcome: 0 | 1;
  founder: number | null;
  company: number | null;
  deal: number | null;
  /** Level over 4 for each question the evidence settled; null where it did not. */
  founderLevels: Partial<Record<DimensionId, number | null>>;
  companyLevels: Partial<Record<CompanyDimensionId, number | null>>;
}

export interface OutcomeEvidence {
  cases: JudgedCase[];
  /** Which cases these are, for the reader: how many, from which periods, judged by what. */
  basis: string;
  /** How many of all the past cases the judging model recognised, and out of how many. */
  recognised: number;
  probed: number;
}

export interface AssumptionEvidence {
  outcomes: SeparationStat | null;
  calls: SeparationStat | null;
  /** Share of cases where the evidence did not settle the question. */
  unknownShare: number | null;
  /** A plain fact for a test that is not a comparison of two kinds. */
  detail: string | null;
}

/**
 * supported  the evidence is on the statement's side and chance is an unlikely explanation
 * against    the evidence points the other way, beyond chance
 * open       there is evidence and it does not settle it
 * untested   nothing bears on it yet
 */
export type AssumptionStatus = "supported" | "against" | "open" | "untested";

export interface AssumptionRow extends AssumptionDef {
  evidence: AssumptionEvidence;
  status: AssumptionStatus;
  /** Whether the partner's own calls lean the same way. null without enough calls. */
  calls: AssumptionStatus | null;
  /** The setting's current value, as text, when the assumption has one. */
  current: string | null;
}

export interface AssumptionsDTO {
  rows: AssumptionRow[];
  outcomesBasis: string | null;
  callsBasis: string | null;
}

/** The fewest cases of each kind before a comparison is read at all. */
export const MIN_EACH_KIND = 5;

/**
 * Whether a comparison holds enough cases of both kinds to be read at all. The page draws a
 * figure that fails this as a hollow mark, so a bar never says more than the status beside it.
 */
export function enoughToJudge(stat: Pick<SeparationStat, "n" | "positives" | "value"> | null | undefined): boolean {
  return !!stat && stat.value !== null && stat.positives >= MIN_EACH_KIND && stat.n - stat.positives >= MIN_EACH_KIND;
}

function verdict(stat: SeparationStat | null): AssumptionStatus {
  if (!stat || !enoughToJudge(stat)) return "untested";
  if (stat.low === null || stat.high === null) return "open";
  if (stat.low > 0.5) return "supported";
  if (stat.high < 0.5) return "against";
  return "open";
}

function rowsFor(cases: readonly JudgedCase[], pick: (item: JudgedCase) => number | null | undefined): SeparationRow[] {
  const rows: SeparationRow[] = [];
  for (const item of cases) {
    const score = pick(item);
    if (typeof score === "number" && Number.isFinite(score)) rows.push({ group: item.group, outcome: item.outcome, score });
  }
  return rows;
}

function unknownShare(cases: readonly JudgedCase[], pick: (item: JudgedCase) => number | null | undefined): number | null {
  if (cases.length === 0) return null;
  return cases.filter((item) => typeof pick(item) !== "number").length / cases.length;
}

function picker(test: AssumptionTest): ((item: JudgedCase) => number | null | undefined) | null {
  if (test.kind === "founder_question") return (item) => item.founderLevels[test.dimension];
  if (test.kind === "company_question") return (item) => item.companyLevels[test.dimension];
  if (test.kind === "score") return (item) => item[test.which];
  return null;
}

const share = (value: number) => `${Math.round(value * 100)}%`;

/**
 * Evidence and status for every assumption, from judged past cases and from the partner's
 * calls. Pure: the same inputs always give the same rows.
 */
export function judgeAssumptions(input: {
  outcomes: OutcomeEvidence | null;
  calls: readonly JudgedCase[];
  /** The current value of a setting, as text, by parameter key. */
  current: (paramKey: string) => string | null;
}): AssumptionRow[] {
  const past = input.outcomes?.cases ?? [];
  return ASSUMPTIONS.map((def): AssumptionRow => {
    const evidence: AssumptionEvidence = { outcomes: null, calls: null, unknownShare: null, detail: null };
    let status: AssumptionStatus = "untested";
    let calls: AssumptionStatus | null = null;
    const pick = picker(def.test);

    if (pick) {
      if (past.length) {
        evidence.outcomes = separationStat(rowsFor(past, pick), `outcomes:${def.id}`);
        evidence.unknownShare = unknownShare(past, pick);
      }
      if (input.calls.length) evidence.calls = separationStat(rowsFor(input.calls, pick), `calls:${def.id}`);
      status = verdict(evidence.outcomes);
      const fromCalls = verdict(evidence.calls);
      calls = fromCalls === "untested" ? null : fromCalls;
    } else if (def.test.kind === "combination" && past.length) {
      const deal = separationStat(rowsFor(past, (item) => item.deal), `outcomes:${def.id}:deal`);
      const founder = separationStat(rowsFor(past, (item) => item.founder), `outcomes:${def.id}:founder`);
      const company = separationStat(rowsFor(past, (item) => item.company), `outcomes:${def.id}:company`);
      evidence.outcomes = deal;
      if (deal.value !== null && founder.value !== null && company.value !== null) {
        // "Either alone" means the better of the two parts, compared on the same cases.
        const part = company.value >= founder.value ? "company" : "founder";
        const paired: PairedRow[] = [];
        for (const item of past) {
          const other = item[part];
          if (typeof item.deal === "number" && typeof other === "number") paired.push({ group: item.group, outcome: item.outcome, a: item.deal, b: other });
        }
        const gap = separationDifference(paired, `outcomes:${def.id}:gap`);
        const points = (value: number) => `${value > 0 ? "+" : ""}${Math.round(value * 100)}`;
        evidence.detail = `Together ${share(deal.value)}, founder alone ${share(founder.value)}, company alone ${share(company.value)}.`
          + (gap.value !== null && gap.low !== null && gap.high !== null
            ? ` Together against the ${part} alone: ${points(gap.value)} points, range ${points(gap.low)} to ${points(gap.high)}.`
            : "");
        if (verdict(deal) === "untested") status = "untested";
        else if (gap.low === null || gap.high === null) status = "open";
        else if (gap.low > 0) status = "supported";
        else if (gap.high < 0) status = "against";
        else status = "open";
      }
    } else if (def.test.kind === "placebo" && past.length) {
      const rows = rowsFor(past, (item) => item.deal);
      const real = separationStat(rows, `outcomes:${def.id}`);
      const shuffled = shuffledBaseline(rows, real.value, `shuffle:${def.id}`);
      evidence.outcomes = real;
      if (real.value !== null && shuffled) {
        evidence.detail = `Real outcomes ${share(real.value)}. Shuffled outcomes ${share(shuffled.mean)} on average, and 95% of shuffles fall below ${share(shuffled.p95)}.`;
        if (verdict(real) === "untested") status = "untested";
        else status = real.value > shuffled.p95 ? "supported" : "open";
      }
    } else if (def.test.kind === "recognition" && input.outcomes && input.outcomes.probed > 0) {
      const { recognised, probed } = input.outcomes;
      evidence.detail = `The judging model named ${recognised} of ${probed} masked companies. Those are left out of the headline.`;
      // Naming any at all shows masking does not hide a company from a model that knows it.
      status = recognised === 0 ? "open" : "against";
    } else if (def.test.kind === "coverage" && past.length) {
      const settled: number[] = [];
      for (const item of past) {
        const answers = [...Object.values(item.founderLevels), ...Object.values(item.companyLevels)];
        if (answers.length) settled.push(answers.filter((value) => typeof value === "number").length / answers.length);
      }
      if (settled.length) {
        const mean = settled.reduce((sum, value) => sum + value, 0) / settled.length;
        evidence.unknownShare = 1 - mean;
        evidence.detail = `A launch post settled ${share(mean)} of the rubric questions on average.`;
        status = mean > 0.5 ? "supported" : "against";
      }
    } else if (def.test.kind === "none") {
      evidence.detail = def.test.how;
    }

    return { ...def, evidence, status, calls, current: def.paramKey ? input.current(def.paramKey) : null };
  });
}
