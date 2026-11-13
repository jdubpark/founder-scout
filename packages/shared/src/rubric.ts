/**
 * The scoring rubric.
 *
 * Models answer these questions one at a time from verified evidence. Code,
 * not a model, turns the answers into a score (see scoring.ts). That split is
 * deliberate: weights can change instantly without re-running a model, every
 * number is explainable, and the answers become features for a learned model
 * once real outcomes exist.
 *
 * Each level is written as a situation that can be read on its own. Level
 * `null` means "the evidence does not settle this" and is never treated as a
 * low score.
 *
 * There is intentionally no pedigree dimension. School and employer names are
 * context for the investigators, never something that is scored directly.
 */

export type DimensionGroup = "cracked" | "founder" | "integrity";

export interface Dimension {
  id: string;
  label: string;
  group: DimensionGroup;
  question: string;
  /** Index 0..4. */
  levels: readonly [string, string, string, string, string];
  defaultWeight: number;
}

export const DIMENSIONS = [
  {
    id: "built_hard_things",
    label: "Built hard things",
    group: "cracked",
    question: "Has this person personally built something technically hard?",
    levels: [
      "There is evidence about their work, and none of it shows them building software, hardware or research artifacts themselves.",
      "They built standard things: course projects, tutorials, simple apps, thin wrappers around existing tools.",
      "They built a complete, working product or system with some real engineering in it.",
      "They were a primary builder of a system that is hard to build: a novel algorithm, demanding performance or scale, deep infrastructure, or serious research with working code.",
      "They were the primary builder of something few engineers could build, and other strong engineers use it, cite it or build on it.",
    ],
    defaultWeight: 3,
  },
  {
    id: "technical_depth",
    label: "Technical depth",
    group: "cracked",
    question:
      "How deep is their understanding of the technology, judged from their own code, writing and answers?",
    levels: [
      "Their own technical output is available and shows no real understanding of how the technology works.",
      "Surface level: they repeat common knowledge and use tools without explaining why they work.",
      "Competent: their work is correct and follows standard practice.",
      "Deep: they explain trade-offs, know the failure modes, and correct common misconceptions.",
      "Frontier: they produce original techniques or insights that specialists learn from.",
    ],
    defaultWeight: 2.5,
  },
  {
    id: "velocity",
    label: "Shipping speed",
    group: "cracked",
    question: "How quickly do they ship real work?",
    levels: [
      "Their activity is visible and nothing has shipped.",
      "Long gaps, and most projects are left unfinished.",
      "Steady: they ship finished work a few times a year.",
      "Fast: they ship meaningful improvements every few weeks and visibly iterate on feedback.",
      "Exceptional: they have gone from idea to a working product that others use in a matter of weeks, more than once.",
    ],
    defaultWeight: 2,
  },
  {
    id: "slope",
    label: "Trajectory",
    group: "cracked",
    question:
      "How steep is their trajectory relative to how many years they have been working? Judge against years of experience, never age.",
    levels: [
      "Their history is visible and shows no growth in scope or difficulty.",
      "Flat: similar scope for many years.",
      "Normal progression for the years of experience.",
      "Steep: they took on much larger scope clearly earlier than peers with the same years of experience.",
      "Outlier: at each stage they achieved things that are rare for that level of experience.",
    ],
    defaultWeight: 2,
  },
  {
    id: "insight",
    label: "Earned insight",
    group: "founder",
    question:
      "Do they have an earned, non-obvious insight into the problem they are working on?",
    levels: [
      "They have described the problem publicly and show no particular understanding of it.",
      "Generic: they describe the market the way anyone would.",
      "Informed: they have relevant experience and a reasonable view.",
      "Earned: a specific insight that comes from having done the work or lived the problem, and that most people in the field miss.",
      "Contrarian and so far right: an insight experts dismissed that evidence is starting to prove.",
    ],
    defaultWeight: 2.5,
  },
  {
    id: "ambition",
    label: "Ambition",
    group: "founder",
    question: "How large is the outcome they are deliberately aiming for?",
    levels: [
      "They have stated their goals and are not trying to build a company.",
      "Small: a feature, a tool, or a small business.",
      "A solid company in an established category.",
      "Category-defining: they aim to be the default in a large market and have a credible path.",
      "Era-defining: they aim to change how an industry works and have taken concrete steps that only make sense at that scale.",
    ],
    defaultWeight: 1.5,
  },
  {
    id: "communication",
    label: "Clarity",
    group: "founder",
    question:
      "How clearly do they explain what they are doing and why it matters, in talks, interviews and writing?",
    levels: [
      "Their talks or writing are available and are confused or misleading.",
      "Hard to follow, or jargon without substance.",
      "Clear enough to understand what they do.",
      "Crisp: they explain complex ideas simply and answer hard questions directly.",
      "Magnetic: people quote and share their explanations, and they visibly change minds.",
    ],
    defaultWeight: 1.5,
  },
  {
    id: "magnetism",
    label: "Talent magnet",
    group: "founder",
    question: "Do strong people choose to work with them?",
    levels: [
      "Their collaborations are visible and strong people have avoided or left them.",
      "They work alone and have no notable collaborators.",
      "They have collaborators of ordinary calibre.",
      "Strong people have joined them, co-authored with them or contributed to their projects.",
      "Clearly exceptional people have left good positions to join them or publicly vouch for them.",
    ],
    defaultWeight: 1.5,
  },
  {
    id: "grit",
    label: "Persistence",
    group: "founder",
    question: "Have they pushed through something hard for a long time?",
    levels: [
      "Their history is visible and shows them abandoning efforts as soon as they became difficult.",
      "They tend to drop projects when they get hard.",
      "They have completed efforts lasting several months.",
      "They persisted for years through visible setbacks to a result.",
      "Repeated: several long, hard efforts finished despite visible setbacks.",
    ],
    defaultWeight: 1.5,
  },
  {
    id: "integrity",
    label: "Claims match record",
    group: "integrity",
    question: "Do their public claims match the record?",
    levels: [
      "Material misrepresentation: a significant claim about a degree, title, traction or authorship is contradicted by a reliable source.",
      "Several claims are inflated beyond what the record supports.",
      "Minor exaggeration of the kind common in marketing.",
      "The claims that could be checked are accurate.",
      "The claims that could be checked are accurate, and they are openly precise about limits and failures.",
    ],
    defaultWeight: 1,
  },
] as const satisfies ReadonlyArray<Dimension>;

export type DimensionId = (typeof DIMENSIONS)[number]["id"];
export const DIMENSION_IDS = DIMENSIONS.map((d) => d.id) as DimensionId[];

export function getDimension(id: DimensionId): Dimension {
  const d = DIMENSIONS.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown dimension: ${id}`);
  return d;
}

export function isDimensionId(value: string): value is DimensionId {
  return (DIMENSION_IDS as string[]).includes(value);
}

export const CRACKED_DIMENSIONS = DIMENSIONS.filter((d) => d.group === "cracked").map(
  (d) => d.id,
) as DimensionId[];

export const FOUNDER_DIMENSIONS = DIMENSIONS.filter((d) => d.group === "founder").map(
  (d) => d.id,
) as DimensionId[];

/**
 * Attributes the system must never extract, store, infer or score. Enforced
 * in prompts, by the absence of any field for them, and by a text scan on
 * model output before it is saved.
 */
export const PROHIBITED_ATTRIBUTES = [
  "age or date of birth",
  "race or ethnicity",
  "national origin or citizenship",
  "religion",
  "gender or sexual orientation",
  "health or disability",
  "marital, family or pregnancy status",
  "political views",
  "home address",
  "personal phone number or personal email that the person did not publish for business contact",
] as const;
