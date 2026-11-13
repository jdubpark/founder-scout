/**
 * The static shape of a swarm: which classes of agents exist, which jobs each
 * class contains, and which model providers can run them.
 *
 * Everything that addresses agents (steering scopes, the dashboard tree, the
 * architecture diagram) is keyed off these ids, so they are stable strings.
 */

export const AGENT_CLASSES = [
  {
    id: "scout",
    label: "Scouts",
    verb: "Find",
    description:
      "Watch public and licensed sources every day and flag people who are starting, or about to start, a company.",
  },
  {
    id: "resolver",
    label: "Matchers",
    verb: "Merge",
    description:
      "Recognise when several sightings are the same person and keep one profile per founder.",
  },
  {
    id: "screener",
    label: "Screeners",
    verb: "Filter",
    description:
      "Check each new founder against the investment thesis before any expensive work is spent on them.",
  },
  {
    id: "investigator",
    label: "Investigators",
    verb: "Dig",
    description:
      "Collect evidence about background, technical work, company, public talks and risks, each with a source link.",
  },
  {
    id: "verifier",
    label: "Fact-checkers",
    verb: "Check",
    description:
      "A different AI model re-reads every source and removes any claim the source does not support.",
  },
  {
    id: "analyst",
    label: "Analysts",
    verb: "Judge",
    description:
      "Answer the scoring rubric from verified evidence only, then write the memo for the founders worth meeting.",
  },
  {
    id: "outreach",
    label: "Outreach",
    verb: "Talk",
    description:
      "Draft emails and call plans. Nothing is sent or dialled until a person approves that specific action.",
  },
] as const;

export type ClassId = (typeof AGENT_CLASSES)[number]["id"];
export type ClassMeta = (typeof AGENT_CLASSES)[number];

/**
 * How a job is executed.
 * - code:        deterministic code, no model call.
 * - structured:  one model call that returns schema-validated JSON, no tools.
 * - research:    a model call with web search and page fetch, returning JSON.
 * - repo_review: an agent harness reading a cloned repository in a read-only sandbox.
 * - voice:       a realtime phone conversation (not enabled in v0).
 */
export type JobKind = "code" | "structured" | "research" | "repo_review" | "voice";

export type SourceId =
  | "hackernews"
  | "github"
  | "arxiv"
  | "people_data"
  | "web"
  | "call"
  | "manual";

export const SOURCES = [
  {
    id: "hackernews",
    label: "Hacker News",
    access: "Official public API",
    compliance: "open",
  },
  {
    id: "github",
    label: "GitHub",
    access: "Official REST API",
    compliance: "open",
  },
  {
    id: "arxiv",
    label: "arXiv",
    access: "Official public API",
    compliance: "open",
  },
  {
    id: "people_data",
    label: "Professional profiles (LinkedIn-derived)",
    access: "Licensed data vendor only. The system never logs in to or scrapes LinkedIn.",
    compliance: "licensed",
  },
  {
    id: "web",
    label: "Open web",
    access: "Web search and page fetch through the model provider",
    compliance: "open",
  },
  {
    id: "call",
    label: "Conversations",
    access: "Approved calls and emails only",
    compliance: "consent",
  },
  {
    id: "manual",
    label: "Added by a person",
    access: "Notes and context typed into the dashboard",
    compliance: "open",
  },
] as const satisfies ReadonlyArray<{
  id: SourceId;
  label: string;
  access: string;
  compliance: "open" | "licensed" | "consent";
}>;

export const JOBS = [
  {
    id: "scout.hackernews",
    classId: "scout",
    label: "Hacker News scout",
    kind: "structured",
    source: "hackernews",
    enabled: true,
    description:
      "Reads new Show HN and Launch HN posts and extracts the people behind them.",
  },
  {
    id: "scout.github",
    classId: "scout",
    label: "GitHub scout",
    kind: "structured",
    source: "github",
    enabled: true,
    description:
      "Finds new repositories gaining attention unusually fast and identifies who wrote them.",
  },
  {
    id: "scout.research",
    classId: "scout",
    label: "Research scout",
    kind: "structured",
    source: "arxiv",
    enabled: true,
    description:
      "Reads new papers and flags authors whose work is turning into a product or a company.",
  },
  {
    id: "scout.talent",
    classId: "scout",
    label: "Talent-move scout",
    kind: "structured",
    source: "people_data",
    enabled: true,
    description:
      "Uses licensed professional-profile data to spot strong people leaving a job to start something.",
  },
  {
    id: "resolve.identity",
    classId: "resolver",
    label: "Identity matcher",
    kind: "code",
    source: null,
    enabled: true,
    description:
      "Merges sightings that share a profile link, a handle, or a name and company into one founder record.",
  },
  {
    id: "screen.fit",
    classId: "screener",
    label: "Thesis screener",
    kind: "structured",
    source: null,
    enabled: true,
    description:
      "Scores how well a founder and company match the thesis, and says why, before a deep dive is spent.",
  },
  {
    id: "investigate.background",
    classId: "investigator",
    label: "Background investigator",
    kind: "research",
    source: "web",
    enabled: true,
    description:
      "Education, work history, what they built at each stop, and how fast their responsibilities grew.",
  },
  {
    id: "investigate.code",
    classId: "investigator",
    label: "Code reviewer",
    kind: "repo_review",
    source: "github",
    enabled: true,
    description:
      "Reads the founder's own code in a read-only sandbox and judges how hard the problems are and how well they are solved.",
  },
  {
    id: "investigate.company",
    classId: "investigator",
    label: "Company investigator",
    kind: "research",
    source: "web",
    enabled: true,
    description:
      "What the company does, who it is for, early traction, and whether it has already raised money.",
  },
  {
    id: "investigate.media",
    classId: "investigator",
    label: "Talks and interviews analyst",
    kind: "research",
    source: "web",
    enabled: true,
    description:
      "Finds talks, podcasts and interviews and reads the transcripts for clarity of thought and depth of insight.",
  },
  {
    id: "investigate.redflags",
    classId: "investigator",
    label: "Risk checker",
    kind: "research",
    source: "web",
    enabled: true,
    description:
      "Looks for inconsistencies between public claims and the record. Professional conduct only.",
  },
  {
    id: "verify.claims",
    classId: "verifier",
    label: "Claim checker",
    kind: "structured",
    source: null,
    enabled: true,
    description:
      "Re-reads each piece of evidence with a different model family and marks whether it supports the claim and is about the right person.",
  },
  {
    id: "assess.judgments",
    classId: "analyst",
    label: "Rubric analyst",
    kind: "structured",
    source: null,
    enabled: true,
    description:
      "Answers each rubric question from verified evidence, with a confidence and the evidence it relied on.",
  },
  {
    id: "assess.memo",
    classId: "analyst",
    label: "Memo writer",
    kind: "structured",
    source: null,
    enabled: true,
    description:
      "Writes a one-page memo for founders above the bar: why now, strengths, risks, open questions, next step.",
  },
  {
    id: "outreach.plan",
    classId: "outreach",
    label: "Outreach planner",
    kind: "structured",
    source: null,
    enabled: true,
    description:
      "Drafts the intro email and a call plan and suggests references. Every item waits for approval.",
  },
  {
    id: "call.founder",
    classId: "outreach",
    label: "Founder caller",
    kind: "voice",
    source: "call",
    enabled: false,
    description:
      "An AI voice call with the founder after they agree to it. Discloses that it is an AI in the first sentence.",
  },
  {
    id: "call.reference",
    classId: "outreach",
    label: "Reference caller",
    kind: "voice",
    source: "call",
    enabled: false,
    description:
      "An AI voice call with a reference the founder provided or a partner approved. Records only with consent.",
  },
  {
    id: "call.debrief",
    classId: "outreach",
    label: "Call debriefer",
    kind: "structured",
    source: "call",
    enabled: true,
    description:
      "Turns a call transcript or meeting notes into evidence the analysts can use.",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  classId: ClassId;
  label: string;
  kind: JobKind;
  source: SourceId | null;
  /** false = designed and visible, but not runnable in this version. */
  enabled: boolean;
  description: string;
}>;

export type JobId = (typeof JOBS)[number]["id"];
export type JobMeta = (typeof JOBS)[number];

export const JOB_IDS = JOBS.map((j) => j.id) as JobId[];
export const CLASS_IDS = AGENT_CLASSES.map((c) => c.id) as ClassId[];

export function getJob(id: JobId): JobMeta {
  const job = JOBS.find((j) => j.id === id);
  if (!job) throw new Error(`Unknown job: ${id}`);
  return job;
}

export function getClass(id: ClassId): ClassMeta {
  const cls = AGENT_CLASSES.find((c) => c.id === id);
  if (!cls) throw new Error(`Unknown agent class: ${id}`);
  return cls;
}

export function jobsOfClass(classId: ClassId): JobMeta[] {
  return JOBS.filter((j) => j.classId === classId);
}

export function isJobId(value: string): value is JobId {
  return (JOB_IDS as string[]).includes(value);
}

export function isClassId(value: string): value is ClassId {
  return (CLASS_IDS as string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Model providers                                                      */
/* ------------------------------------------------------------------ */

export type Vendor = "anthropic" | "openai" | "deepseek" | "meta" | "none";

export const PROVIDERS = [
  {
    id: "sim",
    vendor: "none",
    label: "Simulation",
    capabilities: { structured: true, research: true, repoReview: true },
    note: "Deterministic stand-in used for tests, demos and free eval rounds. Makes no network calls.",
  },
  {
    id: "claude-cli",
    vendor: "anthropic",
    label: "Claude (headless Claude Code)",
    capabilities: { structured: true, research: true, repoReview: true },
    note: "Uses the Claude Code login or ANTHROPIC_API_KEY. Brings its own web search and read-only file tools.",
  },
  {
    id: "codex-cli",
    vendor: "openai",
    label: "Codex (headless)",
    capabilities: { structured: true, research: false, repoReview: true },
    note: "Uses the Codex login or OPENAI_API_KEY. Reads repositories in a read-only sandbox.",
  },
  {
    id: "anthropic-api",
    vendor: "anthropic",
    label: "Claude API",
    capabilities: { structured: true, research: false, repoReview: false },
    note: "Direct Messages API calls with structured outputs. Needs ANTHROPIC_API_KEY.",
  },
  {
    id: "openai-api",
    vendor: "openai",
    label: "OpenAI API",
    capabilities: { structured: true, research: false, repoReview: false },
    note: "Direct API calls with structured outputs. Needs OPENAI_API_KEY.",
  },
  {
    id: "deepseek-api",
    vendor: "deepseek",
    label: "DeepSeek API",
    capabilities: { structured: true, research: false, repoReview: false },
    note: "OpenAI-compatible endpoint. Set DEEPSEEK_BASE_URL to a US-hosted endpoint for the open weights if required.",
  },
  {
    id: "meta-api",
    vendor: "meta",
    label: "Meta Llama API",
    capabilities: { structured: true, research: false, repoReview: false },
    note: "OpenAI-compatible endpoint, first-party or a hosted provider, set with LLAMA_BASE_URL.",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  vendor: Vendor;
  label: string;
  capabilities: { structured: boolean; research: boolean; repoReview: boolean };
  note: string;
}>;

export type ProviderId = (typeof PROVIDERS)[number]["id"];
export type ProviderMeta = (typeof PROVIDERS)[number];
export const PROVIDER_IDS = PROVIDERS.map((p) => p.id) as ProviderId[];

export function getProvider(id: ProviderId): ProviderMeta {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Which provider and model run a job. */
export interface ModelRoute {
  provider: ProviderId;
  model: string;
  effort?: Effort;
}

/** Whether a provider can run a job of the given kind. */
export function providerSupports(provider: ProviderId, kind: JobKind): boolean {
  const caps = getProvider(provider).capabilities;
  switch (kind) {
    case "code":
      return true;
    case "structured":
      return caps.structured;
    case "research":
      return caps.research;
    case "repo_review":
      return caps.repoReview;
    case "voice":
      return false;
  }
}
