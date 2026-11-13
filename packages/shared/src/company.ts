/**
 * The company rubric.
 *
 * A founder is judged as a person (rubric.ts). A company is judged as a
 * business: the problem it names, what it has shipped, whether anyone wants it,
 * who else is building it, and what it says comes next. The two scores are kept
 * apart and then combined by code into one "deal" score (scoring.ts), so a
 * partner can see a strong person at a weak company, or the reverse.
 *
 * The rules are the same as for founders. Models answer one question at a time
 * from verified evidence. Level `null` means "the evidence does not settle
 * this" and is never treated as a low score. Code computes every number.
 */

export type CompanyDimensionGroup = "problem" | "product" | "progress" | "team" | "risk";

export interface CompanyDimension {
  id: string;
  label: string;
  group: CompanyDimensionGroup;
  question: string;
  /** Index 0..4. */
  levels: readonly [string, string, string, string, string];
  defaultWeight: number;
}

export const COMPANY_DIMENSIONS = [
  {
    id: "mission",
    label: "Problem worth solving",
    group: "problem",
    question:
      "Does the company's own stated mission name a specific problem, for a specific customer, that matters to that customer?",
    levels: [
      "The company has stated what it is for, and the statement names no problem and no customer.",
      "Vague: a broad aspiration that could describe hundreds of companies.",
      "Clear: a recognisable problem and a customer, described the way others in the field describe it.",
      "Sharp: a specific, painful problem for a named kind of customer, with a reason it is unsolved today.",
      "Sharp and consequential: solving it would change how that customer's whole industry works, and the company explains why it can now be solved.",
    ],
    defaultWeight: 1.5,
  },
  {
    id: "market",
    label: "Market",
    group: "problem",
    question:
      "How large is the market this company can reach, judged from who pays for this kind of thing today and who could?",
    levels: [
      "The buyers are identified and there are too few of them, or they do not pay for this kind of thing.",
      "A niche: a small group of buyers with small budgets.",
      "A real market that supports a solid business, with established competitors.",
      "A large market, or a small one growing fast, where a new entrant has a visible way in.",
      "A very large market that is forming or shifting now, where the winner is not yet decided.",
    ],
    defaultWeight: 2,
  },
  {
    id: "product",
    label: "Product",
    group: "product",
    question: "What has the company actually shipped, and does it do what it says?",
    levels: [
      "The company has described a product and nothing usable exists.",
      "A demo, a waitlist or a prototype that outsiders cannot use.",
      "A working product that outsiders can use, with the basics in place.",
      "A product people use for real work, with documentation, releases and visible fixes.",
      "A product that does something competing products cannot, shown by independent users or measurements.",
    ],
    defaultWeight: 2.5,
  },
  {
    id: "edge",
    label: "Edge",
    group: "product",
    question:
      "What does this company have that others working on the same problem do not, and how hard is it to copy?",
    levels: [
      "Comparable products exist and this one is behind them on what it claims as its strength.",
      "Nothing distinct: the same approach as several others.",
      "A reasonable angle, such as a focus or a price, that a competitor could match quickly.",
      "A real advantage: technology, data, distribution or know-how that would take a competitor a long time to match.",
      "An advantage that compounds with use, or that rests on something the team alone has.",
    ],
    defaultWeight: 2,
  },
  {
    id: "traction",
    label: "Traction",
    group: "progress",
    question: "Do people outside the company want this, shown by use, payment or commitment?",
    levels: [
      "The product has been available for a while and there is no sign anyone uses it.",
      "Interest only: sign-ups, stars or praise, with no sign of real use.",
      "Early use: a small number of named users, pilots or design partners.",
      "Clear pull: paying customers or heavy use, growing month over month.",
      "Unusual pull for its age: demand the company visibly struggles to keep up with, confirmed by sources outside the company.",
    ],
    defaultWeight: 2.5,
  },
  {
    id: "momentum",
    label: "Momentum",
    group: "progress",
    question: "How fast is the company moving, judged from dated public milestones?",
    levels: [
      "Dated activity is visible and has stopped for many months.",
      "Slow: long gaps between releases or announcements.",
      "Steady: a meaningful milestone every few months.",
      "Fast: meaningful milestones every few weeks, each building on the last.",
      "Exceptional: within months of starting, the company reached milestones that usually take years.",
    ],
    defaultWeight: 2,
  },
  {
    id: "team",
    label: "Team",
    group: "team",
    question:
      "Beyond the lead founder, does the team cover what this company needs to build and to sell?",
    levels: [
      "The team is visible and has an obvious gap in a skill the company cannot work without, or key people have left.",
      "One person, or a team whose members all do the same thing.",
      "The core skills are covered by people of ordinary experience.",
      "The team covers building and selling, and at least one other member has done directly relevant work before.",
      "Several members have done directly relevant work at a high level, and have worked together before.",
    ],
    defaultWeight: 2,
  },
  {
    id: "plan",
    label: "Plan",
    group: "product",
    question:
      "Is what the company says it will do next specific, and does it follow from what it has already shipped?",
    levels: [
      "The company has published plans and has missed or abandoned them repeatedly.",
      "No stated plan, or a list of ambitions with no order and no dates.",
      "A plausible next step.",
      "A specific sequence of next steps that follows from what has shipped and from what users asked for.",
      "A specific sequence that leads to a much larger business, with the first steps already under way.",
    ],
    defaultWeight: 1,
  },
  {
    id: "claims",
    label: "Claims match record",
    group: "risk",
    question: "Do the company's public claims about customers, funding, results and people match the record?",
    levels: [
      "Material misrepresentation: a significant claim about customers, revenue, funding, results or team is contradicted by a reliable source.",
      "Several claims are inflated beyond what the record supports.",
      "Minor exaggeration of the kind common in marketing.",
      "The claims that could be checked are accurate.",
      "The claims that could be checked are accurate, and the company is openly precise about what does not work yet.",
    ],
    defaultWeight: 1,
  },
] as const satisfies ReadonlyArray<CompanyDimension>;

export type CompanyDimensionId = (typeof COMPANY_DIMENSIONS)[number]["id"];
export const COMPANY_DIMENSION_IDS = COMPANY_DIMENSIONS.map((d) => d.id) as CompanyDimensionId[];

export function getCompanyDimension(id: CompanyDimensionId): CompanyDimension {
  const d = COMPANY_DIMENSIONS.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown company dimension: ${id}`);
  return d;
}

export function isCompanyDimensionId(value: string): value is CompanyDimensionId {
  return (COMPANY_DIMENSION_IDS as string[]).includes(value);
}

/**
 * What a piece of company evidence is about. The company page groups verified
 * evidence by facet, so every line a partner reads there has a source behind it.
 */
export const EVIDENCE_FACETS = [
  "mission",
  "product",
  "traction",
  "funding",
  "team",
  "roadmap",
  "market",
  "risk",
] as const;

export type EvidenceFacet = (typeof EVIDENCE_FACETS)[number];

export const FACET_LABEL: Record<EvidenceFacet, string> = {
  mission: "Mission",
  product: "Product",
  traction: "Traction",
  funding: "Funding",
  team: "Team",
  roadmap: "Roadmap",
  market: "Market",
  risk: "Risk",
};

/** The rubric questions each facet mainly informs. Used to tell researchers what is still missing. */
export const FACET_DIMENSIONS: Record<EvidenceFacet, readonly CompanyDimensionId[]> = {
  mission: ["mission"],
  product: ["product", "edge"],
  traction: ["traction", "momentum"],
  funding: ["momentum"],
  team: ["team"],
  roadmap: ["plan"],
  market: ["market", "edge"],
  risk: ["claims"],
};

export interface CompanyReason {
  id: string;
  label: string;
  /** Company rubric dimensions this reason is about, if any. */
  dimensions: readonly CompanyDimensionId[];
}

/** Quick reasons for a yes or a no on a company. One tap beats a sentence. */
export const COMPANY_REASONS: Record<"yes" | "no", readonly CompanyReason[]> = {
  yes: [
    { id: "big_market", label: "Big market", dimensions: ["market"] },
    { id: "real_pull", label: "Real pull", dimensions: ["traction"] },
    { id: "strong_product", label: "Strong product", dimensions: ["product", "edge"] },
    { id: "moving_fast", label: "Moving fast", dimensions: ["momentum"] },
    { id: "complete_team", label: "Complete team", dimensions: ["team"] },
    { id: "right_time", label: "Right time", dimensions: [] },
  ],
  no: [
    { id: "small_market", label: "Small market", dimensions: ["market"] },
    { id: "no_pull", label: "No pull yet", dimensions: ["traction"] },
    { id: "crowded", label: "Crowded space", dimensions: ["edge"] },
    { id: "team_gap", label: "Team gap", dimensions: ["team"] },
    { id: "stalled", label: "Stalled", dimensions: ["momentum"] },
    { id: "wrong_stage", label: "Wrong stage", dimensions: [] },
    { id: "company_outside_thesis", label: "Outside thesis", dimensions: [] },
    { id: "company_doesnt_add_up", label: "Doesn't add up", dimensions: ["claims"] },
  ],
};

const COMPANY_REASON_BY_ID = new Map(
  [...COMPANY_REASONS.yes, ...COMPANY_REASONS.no].map((r) => [r.id, r] as const),
);

export function companyReasonLabel(id: string): string {
  return COMPANY_REASON_BY_ID.get(id)?.label ?? id;
}

export function isCompanyReasonFor(verdict: "yes" | "no", id: string): boolean {
  return COMPANY_REASONS[verdict].some((r) => r.id === id);
}

/** The host a company is known by: lower case, no "www.", no path. null when the text is not a web address. */
export function companyDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const text = url.trim();
  if (!text) return null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Hosts that many unrelated companies share, so a link there does not identify a company. */
const SHARED_HOSTS = new Set([
  "github.com",
  "gitlab.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "news.ycombinator.com",
  "arxiv.org",
  "medium.com",
  "substack.com",
  "notion.site",
  "youtube.com",
  "producthunt.com",
  "huggingface.co",
]);

/** A company's identity key from its site, or null when the link is on a host many companies share. */
export function companyIdentityDomain(url: string | null | undefined): string | null {
  const domain = companyDomain(url);
  if (!domain) return null;
  for (const host of SHARED_HOSTS) {
    if (domain === host || domain.endsWith(`.${host}`)) return null;
  }
  return domain;
}

/**
 * A company name reduced for matching: lower case, no punctuation, no legal suffix.
 *
 * Only legal suffixes are dropped. Words such as "Labs" or "AI" stay, because merging two
 * different companies puts one company's evidence on the other, which is worse than
 * keeping one company twice.
 */
export function normalizeCompanyName(name: string | null | undefined): string {
  if (!name) return "";
  const plain = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stripped = plain.replace(/\s+(inc|llc|ltd|limited|corp|corporation|gmbh)$/g, "").trim();
  return stripped || plain;
}
