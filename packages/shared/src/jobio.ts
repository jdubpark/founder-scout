/**
 * Inputs and outputs of every model-backed job.
 *
 * Output schemas are sent to model providers as JSON Schema for structured
 * output, so they stay inside the subset every provider accepts: objects with
 * every property present, `null` instead of optional, arrays, strings, numbers,
 * booleans and enums. Ranges are not expressed in the schema; code clamps and
 * checks them after the model answers.
 *
 * Everything a model reads from the outside world (posts, pages, transcripts,
 * repository contents) is untrusted data. Prompts must fence it off and tell
 * the model never to follow instructions found inside it.
 */

import { z } from "zod";
import { COMPANY_DIMENSION_IDS, EVIDENCE_FACETS, type CompanyDimensionId, type EvidenceFacet } from "./company";
import { DIMENSION_IDS, type DimensionId } from "./rubric";
import type {
  CompanyInfo,
  CompanyLinks,
  EvidenceKind,
  Judgment,
  Memo,
  OutreachKind,
  ProfileLinks,
  QuoteStatus,
  SimMeta,
  SourcedText,
  Thesis,
  Verification,
} from "./domain";
import type { JobId, SourceId } from "./registry";
import type { Decision, DimensionScore } from "./scoring";
import {
  FUNDING_LEVELS,
  PAGE_KINDS,
  PROGRESS_LEVELS,
  TEAM_LEVELS,
  type HitText,
  type HuntBrief,
  type HuntNote,
  type LatestStage,
  type LookResult,
  type NavigateTurn,
  type PageText,
  type SiftResult,
  type TrailDigest,
  type WaveDigest,
} from "./hunt";

const nullableString = z.string().nullable();

export const ProfileLinksSchema = z.object({
  github: nullableString,
  linkedin: nullableString,
  x: nullableString,
  site: nullableString,
  scholar: nullableString,
});

export const EVIDENCE_KINDS = [
  "profile",
  "repo",
  "code_review",
  "paper",
  "post",
  "launch",
  "talk",
  "interview",
  "article",
  "funding",
  "reference",
  "call_transcript",
  "filing",
  "other",
] as const satisfies readonly EvidenceKind[];

/* ------------------------- Shared inputs --------------------------- */

/** One raw item a source adapter hands to a scout. */
export interface RawItem {
  /** Canonical URL of the item. */
  ref: string;
  source: SourceId;
  title: string;
  /** Main text, already trimmed to a reasonable length. */
  text: string;
  /** Author handle or name as the source shows it. */
  author: string | null;
  authorUrl: string | null;
  publishedAt: string | null;
  /** Source-specific numbers such as points, stars or citations. */
  metrics: Record<string, number>;
  /** Simulator only: which synthetic founder this item belongs to. */
  simFounderId: string | null;
}

/** What a model is told about a founder. */
export interface FounderBrief {
  id: string;
  name: string;
  headline: string | null;
  location: string | null;
  company: CompanyInfo;
  links: ProfileLinks;
  tags: string[];
  sightings: Array<{ source: SourceId; title: string; why: string; ref: string }>;
  /** Simulator only. Prompt builders must not include it. */
  simId: string | null;
}

/** What a model is told about one piece of evidence. */
export interface EvidenceBrief {
  id: string;
  kind: EvidenceKind;
  source: SourceId;
  url: string | null;
  title: string;
  excerpt: string;
  claim: string;
  publishedAt: string | null;
  verification: Verification;
  /** What a company fact is about. Absent for facts about a person. */
  facet?: EvidenceFacet | null;
  /** Whether code found the quoted words at the source. Absent when no check ran. */
  quote?: QuoteStatus | null;
  /** Simulator only. Prompt builders must not include it. */
  sim: SimMeta | null;
}

/**
 * A rubric question the evidence has not settled yet. Code works these out from the last
 * assessment and hands them to the researchers on a follow-up, so a second look goes where
 * the first one came up short.
 */
export interface GapQuestion {
  /** A founder or company rubric dimension id. */
  dimension: string;
  label: string;
  question: string;
}

export interface RepoRef {
  url: string;
  name: string;
  description: string | null;
  stars: number | null;
  language: string | null;
  /** Local checkout for the reviewing agent, when one exists. */
  localPath: string | null;
  /**
   * Commit counts by contributor from the host's API, most commits first. A checkout has no
   * history, so this is the only authorship signal the reviewer gets. Absent when not known.
   */
  contributors?: RepoContributor[] | null;
}

export interface RepoContributor {
  login: string;
  commits: number;
}

export type InvestigationDepth = "quick" | "standard" | "deep";

/* ------------------------------ Scout ------------------------------ */

export interface ScoutInput {
  items: RawItem[];
  beat: string | null;
  thesis: Thesis;
}

export const LeadDraftSchema = z.object({
  /** Must equal the `ref` of one of the input items. */
  itemRef: z.string(),
  personName: z.string(),
  role: nullableString,
  companyName: nullableString,
  companyUrl: nullableString,
  oneLiner: nullableString,
  links: ProfileLinksSchema,
  why: z.string(),
});
export const ScoutOutputSchema = z.object({ leads: z.array(LeadDraftSchema) });
export type LeadDraft = z.infer<typeof LeadDraftSchema>;
export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;

/* ------------------------------ Screen ----------------------------- */

export interface ScreenInput {
  founder: FounderBrief;
  thesis: Thesis;
}

export const ScreenOutputSchema = z.object({
  /** 0..1 */
  fit: z.number(),
  reasons: z.array(z.string()),
  sectors: z.array(z.string()),
  stage: nullableString,
  tags: z.array(z.string()),
});
export type ScreenOutput = z.infer<typeof ScreenOutputSchema>;

/* ---------------------------- Investigate -------------------------- */

export interface InvestigateInput {
  founder: FounderBrief;
  thesis: Thesis;
  /** Evidence already on file, so the agent does not collect it again. */
  known: EvidenceBrief[];
  depth: InvestigationDepth;
  /** Set for the code reviewer only. */
  repo: RepoRef | null;
  /** Rubric questions still open after the last assessment. Empty on a first look. */
  gaps: GapQuestion[];
}

export interface MediaReadInput {
  founder: FounderBrief;
  title: string;
  kind: "talk" | "interview" | "call";
  stretch: Array<{ startSec: number; endSec: number; text: string }>;
}
export const MediaEvidenceDraftSchema = z.object({
  kind: z.enum(["talk", "interview", "call_transcript"]),
  startSec: z.number(),
  excerpt: z.string(),
  claim: z.string(),
});
export const MediaReadOutputSchema = z.object({ evidence: z.array(MediaEvidenceDraftSchema), summary: z.string() });
export type MediaReadOutput = z.infer<typeof MediaReadOutputSchema>;

export const EvidenceDraftSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  url: nullableString,
  title: z.string(),
  /** The exact words from the source. Code looks for them at the address the item cites. */
  excerpt: z.string(),
  /** One sentence: what this shows about the founder. */
  claim: z.string(),
  /** ISO date if the source states one. */
  publishedAt: nullableString,
});

export const ProfileUpdateSchema = z.object({
  headline: nullableString,
  location: nullableString,
  companyName: nullableString,
  companyUrl: nullableString,
  companyOneLiner: nullableString,
  companyStage: nullableString,
  links: ProfileLinksSchema,
});

export const InvestigateOutputSchema = z.object({
  evidence: z.array(EvidenceDraftSchema),
  profile: ProfileUpdateSchema,
  /** What was looked for and not found. */
  notes: z.string(),
});

export const InvestigateMediaOutputSchema = InvestigateOutputSchema.extend({
  recordings: z.array(z.object({
    url: z.string(),
    title: z.string(),
    kind: z.enum(["talk", "interview", "call"]),
  }).strict()),
});

/** An evidence draft, plus the simulator's hidden truth when simulated. */
export type EvidenceDraft = z.infer<typeof EvidenceDraftSchema> & { sim?: SimMeta | null };
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
export type InvestigateOutput = Omit<z.infer<typeof InvestigateOutputSchema>, "evidence"> & {
  evidence: EvidenceDraft[];
};
export type InvestigateMediaOutput = Omit<z.infer<typeof InvestigateMediaOutputSchema>, "evidence"> & {
  evidence: EvidenceDraft[];
};

/* ------------------------------ Verify ----------------------------- */

export interface VerifyInput {
  founder: FounderBrief;
  evidence: EvidenceBrief[];
}

export const VERDICTS = ["supported", "unsupported", "contradicted", "wrong_person"] as const;

export const VerifyOutputSchema = z.object({
  verdicts: z.array(
    z.object({
      evidenceId: z.string(),
      verdict: z.enum(VERDICTS),
      note: z.string(),
    }),
  ),
  /** 0..1 confidence that all the evidence is about this one person. */
  identityConfidence: z.number(),
});
export type VerifyOutput = z.infer<typeof VerifyOutputSchema>;

/* ------------------------------ Assess ----------------------------- */

export interface AssessInput {
  founder: FounderBrief;
  thesis: Thesis;
  /** Verified evidence only. */
  evidence: EvidenceBrief[];
  /** Notes partners have left on this founder. */
  partnerNotes: string[];
}

export const JudgmentDraftSchema = z.object({
  dimension: z.enum(DIMENSION_IDS as [DimensionId, ...DimensionId[]]),
  /** 0..4, or null when the evidence does not settle the question. */
  level: z.number().nullable(),
  /** 0..1 */
  confidence: z.number(),
  rationale: z.string(),
  evidenceIds: z.array(z.string()),
  counterEvidenceIds: z.array(z.string()),
});
export const AssessOutputSchema = z.object({
  judgments: z.array(JudgmentDraftSchema),
  summary: z.string(),
});
export type JudgmentDraft = z.infer<typeof JudgmentDraftSchema>;
export type AssessOutput = z.infer<typeof AssessOutputSchema>;

/* ------------------------------- Memo ------------------------------ */

export interface MemoInput {
  founder: FounderBrief;
  thesis: Thesis;
  evidence: EvidenceBrief[];
  judgments: Judgment[];
  summary: string;
  score: {
    composite: number;
    cracked: number;
    founder: number;
    coverage: number;
    decision: Decision;
    breakdown: DimensionScore[];
  };
}

export const MemoOutputSchema = z.object({
  headline: z.string(),
  /** Markdown. */
  body: z.string(),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),
  openQuestions: z.array(z.string()),
  nextStep: z.string(),
});
export type MemoOutput = z.infer<typeof MemoOutputSchema>;

/* ----------------------------- Outreach ---------------------------- */

export interface OutreachPlanInput {
  founder: FounderBrief;
  thesis: Thesis;
  memo: Memo;
  evidence: EvidenceBrief[];
  /** How the fund should be named in drafts. */
  fundName: string;
}

export const OUTREACH_KINDS = ["email_founder", "call_founder", "call_reference"] as const satisfies
  readonly OutreachKind[];

export const OutreachProposalSchema = z.object({
  kind: z.enum(OUTREACH_KINDS),
  target: z.object({
    name: z.string(),
    role: nullableString,
    relationship: nullableString,
    channelHint: nullableString,
  }),
  rationale: z.string(),
  subject: nullableString,
  body: nullableString,
  agenda: z.array(z.string()),
  questions: z.array(z.string()),
  consentBasis: z.string(),
});
export const OutreachPlanOutputSchema = z.object({ actions: z.array(OutreachProposalSchema) });
export type OutreachProposal = z.infer<typeof OutreachProposalSchema>;
export type OutreachPlanOutput = z.infer<typeof OutreachPlanOutputSchema>;

/* ------------------------------ Debrief ---------------------------- */

export interface DebriefInput {
  founder: FounderBrief;
  kind: OutreachKind;
  targetName: string;
  /** Call transcript or meeting notes. Untrusted data. */
  transcript: string;
}

export const DebriefOutputSchema = z.object({
  evidence: z.array(EvidenceDraftSchema),
  summary: z.string(),
});
export type DebriefOutput = Omit<z.infer<typeof DebriefOutputSchema>, "evidence"> & {
  evidence: EvidenceDraft[];
};

/* ----------------------------- Companies --------------------------- */

/** What a model is told about a company. */
export interface CompanyRef {
  id: string;
  name: string;
  url: string | null;
  oneLiner: string | null;
  mission: SourcedText | null;
  tagline: SourcedText | null;
  sector: string | null;
  stage: string | null;
  links: CompanyLinks;
  /** People already known to be on the team. */
  team: Array<{ name: string; role: string | null; isFounder: boolean }>;
  /** Simulator only. Prompt builders must not include it. */
  simId: string | null;
}

export interface CompanyResearchInput {
  company: CompanyRef;
  /** The founders of this company the swarm follows. */
  founders: FounderBrief[];
  thesis: Thesis;
  /** Company evidence already on file, so the agent does not collect it again. */
  known: EvidenceBrief[];
  depth: InvestigationDepth;
  /** Company rubric questions still open after the last assessment. Empty on a first look. */
  gaps: GapQuestion[];
}

export const CompanyEvidenceDraftSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  facet: z.enum(EVIDENCE_FACETS),
  url: nullableString,
  title: z.string(),
  /** The exact words from the source. */
  excerpt: z.string(),
  /** One sentence: what this shows about the company. */
  claim: z.string(),
  /** ISO date of the event or the page, if the source states one. */
  publishedAt: nullableString,
});

export const CompanyProfileUpdateSchema = z.object({
  url: nullableString,
  oneLiner: nullableString,
  /** The mission in the company's own words, copied exactly. */
  missionText: nullableString,
  /** The page the mission was copied from. */
  missionUrl: nullableString,
  /** Exact lead line from the company's own site, copied word for word. */
  taglineText: nullableString,
  /** Page where the tagline was copied from. */
  taglineUrl: nullableString,
  sector: nullableString,
  stage: nullableString,
  github: nullableString,
  x: nullableString,
  linkedin: nullableString,
  docs: nullableString,
  careers: nullableString,
});

export const TeamMemberDraftSchema = z.object({
  name: z.string(),
  role: nullableString,
  isFounder: z.boolean(),
  /** One line of relevant earlier work. Professional details only. */
  background: nullableString,
  /** The page that lists this person as part of the team. */
  sourceUrl: nullableString,
  links: ProfileLinksSchema,
});

export const CompanyResearchOutputSchema = z.object({
  evidence: z.array(CompanyEvidenceDraftSchema),
  profile: CompanyProfileUpdateSchema,
  team: z.array(TeamMemberDraftSchema),
  /** What was looked for and not found. */
  notes: z.string(),
});

export type CompanyEvidenceDraft = z.infer<typeof CompanyEvidenceDraftSchema> & { sim?: SimMeta | null };
export type CompanyProfileUpdate = z.infer<typeof CompanyProfileUpdateSchema>;
export type TeamMemberDraft = z.infer<typeof TeamMemberDraftSchema>;
export type CompanyResearchOutput = Omit<z.infer<typeof CompanyResearchOutputSchema>, "evidence"> & {
  evidence: CompanyEvidenceDraft[];
};

export interface CompanyAssessInput {
  company: CompanyRef;
  thesis: Thesis;
  /** Verified company evidence only. */
  evidence: EvidenceBrief[];
  /** Notes partners have left on this company. */
  partnerNotes: string[];
}

export const CompanyJudgmentDraftSchema = z.object({
  dimension: z.enum(COMPANY_DIMENSION_IDS as [CompanyDimensionId, ...CompanyDimensionId[]]),
  /** 0..4, or null when the evidence does not settle the question. */
  level: z.number().nullable(),
  /** 0..1 */
  confidence: z.number(),
  rationale: z.string(),
  evidenceIds: z.array(z.string()),
  counterEvidenceIds: z.array(z.string()),
});

export const CitedPointSchema = z.object({
  text: z.string(),
  evidenceIds: z.array(z.string()),
});

export const CompanyAssessOutputSchema = z.object({
  judgments: z.array(CompanyJudgmentDraftSchema),
  /** What the company is and where it stands, in a short paragraph. */
  summary: z.string(),
  /** One sentence on what could make the company hard to copy, from verified evidence. Null when none is shown. */
  moat: CitedPointSchema.nullable(),
  strengths: z.array(CitedPointSchema),
  risks: z.array(CitedPointSchema),
  openQuestions: z.array(z.string()),
});
export type CompanyJudgmentDraft = z.infer<typeof CompanyJudgmentDraftSchema>;
export type CompanyAssessOutput = z.infer<typeof CompanyAssessOutputSchema>;

/* ------------------------------- Hunt ------------------------------ */

/** One turn of the navigator. Everything here is counts, names and short labels: no page text. */
export interface NavigateInput {
  thesis: Thesis;
  brief: HuntBrief;
  /** Which turn this is, counted since the hunt began. */
  turn: number;
  trails: TrailDigest[];
  /** The latest lines of the notebook, newest first. */
  notes: Array<{ by: HuntNote["by"]; text: string }>;
  lastWave: WaveDigest | null;
  budget: { turnsLeft: number; callsLeft: number };
}

const StartSearchSchema = z.object({ engine: z.string(), query: z.string() });

export const NavigateOutputSchema = z.object({
  open: z.array(z.object({ name: z.string(), intent: z.string(), searches: z.array(StartSearchSchema), pages: z.array(z.string()) })),
  extend: z.array(z.object({ trailId: z.string(), searches: z.array(StartSearchSchema), pages: z.array(z.string()) })),
  close: z.array(z.object({ trailId: z.string(), why: z.string() })),
  focus: z.array(z.object({ trailId: z.string(), weight: z.number() })),
  notes: z.array(z.string()),
  done: z.boolean(),
}) satisfies z.ZodType<NavigateTurn>;
export type NavigateOutput = z.infer<typeof NavigateOutputSchema>;

/** One page for a runner to read. `notes` is a few lines of the notebook that code picked. */
export interface LookInput {
  thesis: Thesis;
  /** What the trail is looking for, in the navigator's or a person's words. */
  intent: string;
  notes: string[];
  page: PageText;
  latestStage: LatestStage;
}

const PickSchema = z.object({ index: z.number(), label: z.string(), priority: z.number() });

const StageReadSchema = z.object({
  funding: z.enum(FUNDING_LEVELS),
  fundingQuote: nullableString,
  team: z.enum(TEAM_LEVELS),
  teamQuote: nullableString,
  progress: z.enum(PROGRESS_LEVELS),
  progressQuote: nullableString,
});

const PersonFoundSchema = z.object({
  name: z.string(),
  role: nullableString,
  companyName: nullableString,
  companyUrl: nullableString,
  oneLiner: nullableString,
  links: ProfileLinksSchema,
  why: z.string(),
  /** Words copied from the page. Code looks for them there. */
  quote: z.string(),
});

export const LookOutputSchema = z.object({
  kind: z.enum(PAGE_KINDS),
  people: z.array(PersonFoundSchema),
  aboutCompany: z.boolean(),
  stage: StageReadSchema,
  follow: z.array(PickSchema),
}) satisfies z.ZodType<LookResult>;
export type LookOutput = z.infer<typeof LookOutputSchema>;

/** One list of search results for a runner to sift. */
export interface SiftInput {
  thesis: Thesis;
  intent: string;
  notes: string[];
  query: string;
  hits: HitText[];
  latestStage: LatestStage;
}

export interface SearchInput {
  query: string;
  limit: number;
}

export interface SearchOutput {
  hits: Array<{ url: string; title: string; snippet: string }>;
}

export const SearchOutputSchema = z.object({
  hits: z.array(z.object({ url: z.string(), title: z.string(), snippet: z.string() })),
}) satisfies z.ZodType<SearchOutput>;

export const SiftOutputSchema = z.object({ open: z.array(PickSchema) }) satisfies z.ZodType<SiftResult>;
export type SiftOutput = z.infer<typeof SiftOutputSchema>;

/* --------------------------- Job I/O map --------------------------- */

/** Input and output types per model-backed job. */
export interface JobIO {
  "scout.hackernews": { input: ScoutInput; output: ScoutOutput };
  "scout.github": { input: ScoutInput; output: ScoutOutput };
  "scout.research": { input: ScoutInput; output: ScoutOutput };
  "scout.talent": { input: ScoutInput; output: ScoutOutput };
  "hunt.navigate": { input: NavigateInput; output: NavigateOutput };
  "hunt.search": { input: SearchInput; output: SearchOutput };
  "hunt.look": { input: LookInput; output: LookOutput };
  "hunt.sift": { input: SiftInput; output: SiftOutput };
  "screen.fit": { input: ScreenInput; output: ScreenOutput };
  "investigate.background": { input: InvestigateInput; output: InvestigateOutput };
  "investigate.code": { input: InvestigateInput; output: InvestigateOutput };
  "investigate.company": { input: InvestigateInput; output: InvestigateOutput };
  "investigate.media": { input: InvestigateInput; output: InvestigateMediaOutput };
  "media.read": { input: MediaReadInput; output: MediaReadOutput };
  "investigate.redflags": { input: InvestigateInput; output: InvestigateOutput };
  "company.product": { input: CompanyResearchInput; output: CompanyResearchOutput };
  "company.traction": { input: CompanyResearchInput; output: CompanyResearchOutput };
  "company.team": { input: CompanyResearchInput; output: CompanyResearchOutput };
  "verify.claims": { input: VerifyInput; output: VerifyOutput };
  "assess.judgments": { input: AssessInput; output: AssessOutput };
  "assess.memo": { input: MemoInput; output: MemoOutput };
  "assess.company": { input: CompanyAssessInput; output: CompanyAssessOutput };
  "outreach.plan": { input: OutreachPlanInput; output: OutreachPlanOutput };
  "call.debrief": { input: DebriefInput; output: DebriefOutput };
}

/** Jobs that call a model. The rest are deterministic code or not yet enabled. */
export type ModelJobId = keyof JobIO & JobId;
export type JobInput<J extends ModelJobId> = JobIO[J]["input"];
export type JobOutput<J extends ModelJobId> = JobIO[J]["output"];

export const MODEL_JOB_IDS = [
  "scout.hackernews",
  "scout.github",
  "scout.research",
  "scout.talent",
  "hunt.navigate",
  "hunt.search",
  "hunt.look",
  "hunt.sift",
  "screen.fit",
  "investigate.background",
  "investigate.code",
  "investigate.company",
  "investigate.media",
  "media.read",
  "investigate.redflags",
  "company.product",
  "company.traction",
  "company.team",
  "verify.claims",
  "assess.judgments",
  "assess.memo",
  "assess.company",
  "outreach.plan",
  "call.debrief",
] as const satisfies readonly ModelJobId[];

/** The schema a provider must satisfy for each model-backed job. */
export const JOB_OUTPUT_SCHEMAS = {
  "scout.hackernews": ScoutOutputSchema,
  "scout.github": ScoutOutputSchema,
  "scout.research": ScoutOutputSchema,
  "scout.talent": ScoutOutputSchema,
  "hunt.navigate": NavigateOutputSchema,
  "hunt.search": SearchOutputSchema,
  "hunt.look": LookOutputSchema,
  "hunt.sift": SiftOutputSchema,
  "screen.fit": ScreenOutputSchema,
  "investigate.background": InvestigateOutputSchema,
  "investigate.code": InvestigateOutputSchema,
  "investigate.company": InvestigateOutputSchema,
  "investigate.media": InvestigateMediaOutputSchema,
  "media.read": MediaReadOutputSchema,
  "investigate.redflags": InvestigateOutputSchema,
  "company.product": CompanyResearchOutputSchema,
  "company.traction": CompanyResearchOutputSchema,
  "company.team": CompanyResearchOutputSchema,
  "verify.claims": VerifyOutputSchema,
  "assess.judgments": AssessOutputSchema,
  "assess.memo": MemoOutputSchema,
  "assess.company": CompanyAssessOutputSchema,
  "outreach.plan": OutreachPlanOutputSchema,
  "call.debrief": DebriefOutputSchema,
} as const satisfies Record<ModelJobId, z.ZodType>;
