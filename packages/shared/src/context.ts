/**
 * Pools of context.
 *
 * Every piece of text an agent can be shown belongs to one named pool. A pool is isolated by
 * default: an agent sees a pool only when its job declares that it reads it, and text moves
 * from one pool to another only through a crossing listed here. Each crossing names who
 * carries the text across (code, or one job), in what form, and what is left behind.
 *
 * Why it is written down: the published evidence on systems of several agents is consistent
 * that shared context spreads one agent's mistake to all of them, and that what should cross
 * is a short structured record, never a transcript (docs/research/multi-agent-methods.md).
 * This system already worked that way in places. A rule that lives only in the shape of the
 * code is easy to break by adding one field to one prompt, so the rule is data, and
 * packages/core/src/rules.test.ts fails when a job is given a field with no declared pool.
 */

import { getJob } from "./registry";
import { CLASSES_SHOWN_CALLS } from "./feedback";
import type { JobInput, ModelJobId } from "./jobio";

export interface ContextPool {
  id: string;
  label: string;
  /** What the pool holds, in one line. */
  holds: string;
  /** What one instance of the pool is about. "One founder" means each founder has their own. */
  per: string;
  /** true when nothing from this pool may ever be placed in a prompt. */
  sealed: boolean;
}

export const CONTEXT_POOLS = [
  { id: "objective", label: "Objective", holds: "The thesis: what the fund is looking for and what it avoids.", per: "One swarm", sealed: false },
  { id: "steering", label: "Steering", holds: "Rules, preferences, context and settings people attached to a scope.", per: "One scope", sealed: false },
  { id: "calls", label: "Partner calls", holds: "Recent Yes and No calls with their reasons, shown as examples of taste.", per: "One swarm", sealed: false },
  { id: "lessons", label: "Learned lines", holds: "One-line guidance that an eval round kept, for one job.", per: "One job", sealed: false },
  { id: "skills", label: "Project skills", holds: "Reviewed playbooks selected by code for the task material.", per: "One task", sealed: false },
  { id: "sources", label: "Source items", holds: "New items from one source since the last run.", per: "One scout", sealed: false },
  { id: "hunt", label: "Hunt notebook", holds: "The navigator's trails and notes, and what each wave found, as counts and short labels.", per: "One swarm", sealed: false },
  { id: "lead", label: "Lead", holds: "One person a scout or a runner proposed: name, role, company and why.", per: "One lead", sealed: false },
  { id: "founder", label: "Founder file", holds: "One founder's profile and the sourced evidence about them.", per: "One founder", sealed: false },
  { id: "company", label: "Company file", holds: "One company's profile, team listing and sourced evidence by facet.", per: "One company", sealed: false },
  { id: "repo", label: "Code checkout", holds: "A sanitised, size-capped copy of one repository.", per: "One task", sealed: false },
  { id: "questions", label: "Open questions", holds: "Rubric questions the last assessment could not settle.", per: "One founder or company", sealed: false },
  { id: "decision", label: "Scores", holds: "Numbers and decisions computed by code from rubric answers.", per: "One founder or company", sealed: false },
  { id: "network", label: "Contact lists", holds: "A partner's own exported contacts.", per: "One partner", sealed: true },
  { id: "truth", label: "Hidden truth", holds: "Simulator ground truth, eval outcome labels and the identities behind masked past cases.", per: "One case", sealed: true },
] as const satisfies readonly ContextPool[];

export type PoolId = (typeof CONTEXT_POOLS)[number]["id"];

export function getPool(id: PoolId): ContextPool {
  const pool = CONTEXT_POOLS.find((item) => item.id === id);
  if (!pool) throw new Error(`Unknown context pool: ${id}`);
  return pool;
}

type Reads = PoolId | readonly PoolId[];

/**
 * One entry for every input field of every job, and no others. The type is what enforces the
 * rule: give a job a new input field without saying which pool it comes from, and this file
 * stops compiling.
 */
type InputPools = { [J in ModelJobId]: Readonly<Record<keyof JobInput<J> & string, Reads>> };

const SCOUT = { items: "sources", beat: "steering", thesis: "objective" } as const;
// A runner reads one page or one list of results from the web, and a few lines of the notebook.
const RUNNER = { thesis: "objective", intent: "hunt", notes: "hunt", latestStage: "steering" } as const;
const INVESTIGATE = { founder: "founder", thesis: "objective", known: "founder", depth: "steering", repo: "repo", gaps: "questions" } as const;
const COMPANY_RESEARCH = { company: "company", founders: "company", thesis: "objective", known: "company", depth: "steering", gaps: "questions" } as const;

/**
 * The pool behind every input field of every job that calls a model. A job has no other way
 * to be handed text about a subject, so this table is the whole of what it can be shown.
 *
 * Things to notice, because they are deliberate:
 *  - the founder analyst has no field from the company file, and the company analyst none from
 *    the founder file. `founders` on a company researcher is each founder's name, headline and
 *    public profile links, which crossed into the company file as its record of who founded it;
 *  - the fact-checker reads the items under check, about a founder or a company, and nothing a
 *    researcher thought about them;
 *  - the memo writer is the only agent handed a score, and it is handed one that code computed;
 *  - no job has a field from the contact lists or from the hidden truth.
 */
export const JOB_INPUT_POOLS: InputPools = {
  "scout.hackernews": SCOUT,
  "scout.github": SCOUT,
  "scout.research": SCOUT,
  "scout.talent": SCOUT,
  // The navigator is shown the notebook and nothing a page said: `lastWave` is counts and
  // labels of a few words that runners wrote.
  "hunt.navigate": { thesis: "objective", brief: "steering", turn: "hunt", trails: "hunt", notes: "hunt", lastWave: "hunt", budget: "steering" },
  "hunt.search": { query: "hunt", limit: "steering" },
  "hunt.look": { ...RUNNER, page: "sources" },
  "hunt.sift": { ...RUNNER, query: "hunt", hits: "sources" },
  "screen.fit": { founder: "lead", thesis: "objective" },
  "investigate.background": INVESTIGATE,
  "investigate.code": INVESTIGATE,
  "investigate.company": INVESTIGATE,
  "investigate.media": INVESTIGATE,
  "media.read": { founder: "founder", title: "sources", kind: "sources", stretch: "sources" },
  "investigate.redflags": INVESTIGATE,
  "company.product": COMPANY_RESEARCH,
  "company.traction": COMPANY_RESEARCH,
  "company.team": COMPANY_RESEARCH,
  "verify.claims": { founder: "founder", evidence: ["founder", "company"] },
  "assess.judgments": { founder: "founder", thesis: "objective", evidence: "founder", partnerNotes: "calls" },
  "assess.memo": { founder: "founder", thesis: "objective", evidence: "founder", judgments: "founder", summary: "founder", score: "decision" },
  "assess.company": { company: "company", thesis: "objective", evidence: "company", partnerNotes: "calls" },
  "outreach.plan": { founder: "founder", thesis: "objective", memo: "founder", evidence: "founder", fundName: "objective" },
  "call.debrief": { founder: "founder", kind: "founder", targetName: "founder", transcript: "founder" },
};

/**
 * Every pool a job reads: the pools behind its input fields, the steering for its scope, the
 * lines learned for it, and the partner's calls when its class is shown them.
 */
export function poolsReadBy(jobId: ModelJobId): PoolId[] {
  const read = new Set<PoolId>((Object.values(JOB_INPUT_POOLS[jobId]) as Reads[]).flat());
  read.add("steering");
  read.add("skills");
  read.add("lessons");
  if (CLASSES_SHOWN_CALLS.includes(getJob(jobId).classId)) read.add("calls");
  return CONTEXT_POOLS.map((pool) => pool.id).filter((id) => read.has(id));
}

/** Contributor models may see only public material and the fund's own instructions. */
export function mayUseContributorModel(jobId: ModelJobId): boolean {
  const allowed = new Set<PoolId>(["objective", "steering", "lessons", "sources", "hunt", "lead"]);
  return poolsReadBy(jobId).every((pool) => allowed.has(pool));
}

export interface Crossing {
  from: PoolId;
  to: PoolId;
  /** Who carries it across. */
  by: "code" | "person" | "scouts" | "runners" | "fact-checker" | "eval";
  /** What arrives on the other side. */
  form: string;
  /** What decides whether it crosses, and what stays behind. */
  rule: string;
}

/** The only ways text or numbers move from one pool to another. */
export const CROSSINGS: readonly Crossing[] = [
  { from: "sources", to: "lead", by: "scouts", form: "A named person with a source link and one line on why", rule: "Only people who look like founders inside the thesis. The source item itself stays behind." },
  { from: "sources", to: "lead", by: "runners", form: "A named person with the page's address and the page's own words", rule: "Code keeps a person only when the name and the quoted words are on the page, and leaves out a company the page says is past the stage the fund wants. The page itself stays behind." },
  { from: "sources", to: "hunt", by: "runners", form: "Links chosen by their number on the page, each with a label of a few words", rule: "A runner picks from the links that are there, so it cannot add an address of its own. No page text crosses, and the navigator is told the labels are data, not instructions." },
  { from: "lead", to: "hunt", by: "code", form: "How many of a trail's leads the fit screener kept", rule: "A count for each trail. It decides how much of the next wave the trail gets." },
  { from: "lead", to: "founder", by: "code", form: "One founder record", rule: "A lead that passes the fit screen. The same person seen twice is merged, not copied." },
  { from: "founder", to: "founder", by: "fact-checker", form: "A verdict on each item: supported, unsupported or unverified", rule: "Code first checks that the quoted words are on the cited page. Every check carries one planted false claim; a checker that accepts it has that call's verdicts thrown away. Only supported items reach an analyst." },
  { from: "founder", to: "questions", by: "code", form: "The rubric questions still open, as questions", rule: "A question the evidence did not settle, or settled loosely. Rubric answers and scores stay behind." },
  { from: "founder", to: "company", by: "code", form: "The company's name and site, and each founder's name, headline and public profile links", rule: "Profile only. No founder evidence and no rubric answer crosses, and no company evidence crosses back." },
  { from: "company", to: "questions", by: "code", form: "The company rubric questions still open, as questions", rule: "A question the evidence did not settle, or settled loosely. Rubric answers and scores stay behind." },
  { from: "company", to: "company", by: "fact-checker", form: "A verdict on each item", rule: "The same two checks as founder evidence." },
  { from: "founder", to: "decision", by: "code", form: "A score and a decision", rule: "Computed from rubric answers. A model never writes a number here." },
  { from: "company", to: "decision", by: "code", form: "A score, combined with the lead founder's into one decision", rule: "Two numbers are combined. Neither analyst sees the other's evidence or answers." },
  { from: "calls", to: "steering", by: "person", form: "A suggested rule or setting", rule: "Code proposes when three of the last twenty calls share a reason. A person accepts or dismisses it." },
  { from: "truth", to: "lessons", by: "eval", form: "One line of guidance for one job", rule: "Proposed from mistakes on the earliest cases only, with names removed, and kept only when cases held back from tuning improve beyond noise." },
  { from: "truth", to: "steering", by: "eval", form: "A change to a weight or a setting", rule: "The same keep rule. A person puts it into use, or autopilot does when the cases were real." },
  { from: "network", to: "lead", by: "code", form: "A lead for a contact who became a founder", rule: "Name, new title and company only, after personal details are removed. Email addresses are never read." },
];

/** Crossings into or out of a pool, for a view of one pool. */
export function crossingsOf(pool: PoolId): { into: Crossing[]; outOf: Crossing[] } {
  return {
    into: CROSSINGS.filter((crossing) => crossing.to === pool),
    outOf: CROSSINGS.filter((crossing) => crossing.from === pool),
  };
}
