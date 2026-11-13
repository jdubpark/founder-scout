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
import { DIMENSION_IDS, type DimensionId } from "./rubric";
import type {
  CompanyInfo,
  EvidenceKind,
  Judgment,
  Memo,
  OutreachKind,
  ProfileLinks,
  SimMeta,
  Thesis,
  Verification,
} from "./domain";
import type { JobId, SourceId } from "./registry";
import type { Decision, DimensionScore } from "./scoring";

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
  /** Simulator only. Prompt builders must not include it. */
  sim: SimMeta | null;
}

export interface RepoRef {
  url: string;
  name: string;
  description: string | null;
  stars: number | null;
  language: string | null;
  /** Local checkout for the reviewing agent, when one exists. */
  localPath: string | null;
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
}

export const EvidenceDraftSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  url: nullableString,
  title: z.string(),
  /** A quote or close paraphrase of the source. */
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

/** An evidence draft, plus the simulator's hidden truth when simulated. */
export type EvidenceDraft = z.infer<typeof EvidenceDraftSchema> & { sim?: SimMeta | null };
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
export type InvestigateOutput = Omit<z.infer<typeof InvestigateOutputSchema>, "evidence"> & {
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

/* --------------------------- Job I/O map --------------------------- */

/** Input and output types per model-backed job. */
export interface JobIO {
  "scout.hackernews": { input: ScoutInput; output: ScoutOutput };
  "scout.github": { input: ScoutInput; output: ScoutOutput };
  "scout.research": { input: ScoutInput; output: ScoutOutput };
  "scout.talent": { input: ScoutInput; output: ScoutOutput };
  "screen.fit": { input: ScreenInput; output: ScreenOutput };
  "investigate.background": { input: InvestigateInput; output: InvestigateOutput };
  "investigate.code": { input: InvestigateInput; output: InvestigateOutput };
  "investigate.company": { input: InvestigateInput; output: InvestigateOutput };
  "investigate.media": { input: InvestigateInput; output: InvestigateOutput };
  "investigate.redflags": { input: InvestigateInput; output: InvestigateOutput };
  "verify.claims": { input: VerifyInput; output: VerifyOutput };
  "assess.judgments": { input: AssessInput; output: AssessOutput };
  "assess.memo": { input: MemoInput; output: MemoOutput };
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
  "screen.fit",
  "investigate.background",
  "investigate.code",
  "investigate.company",
  "investigate.media",
  "investigate.redflags",
  "verify.claims",
  "assess.judgments",
  "assess.memo",
  "outreach.plan",
  "call.debrief",
] as const satisfies readonly ModelJobId[];

/** The schema a provider must satisfy for each model-backed job. */
export const JOB_OUTPUT_SCHEMAS = {
  "scout.hackernews": ScoutOutputSchema,
  "scout.github": ScoutOutputSchema,
  "scout.research": ScoutOutputSchema,
  "scout.talent": ScoutOutputSchema,
  "screen.fit": ScreenOutputSchema,
  "investigate.background": InvestigateOutputSchema,
  "investigate.code": InvestigateOutputSchema,
  "investigate.company": InvestigateOutputSchema,
  "investigate.media": InvestigateOutputSchema,
  "investigate.redflags": InvestigateOutputSchema,
  "verify.claims": VerifyOutputSchema,
  "assess.judgments": AssessOutputSchema,
  "assess.memo": MemoOutputSchema,
  "outreach.plan": OutreachPlanOutputSchema,
  "call.debrief": DebriefOutputSchema,
} as const satisfies Record<ModelJobId, z.ZodType>;
