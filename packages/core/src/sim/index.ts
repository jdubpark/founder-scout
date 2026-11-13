import {
  COMPANY_DIMENSIONS,
  DIMENSIONS,
  type CompanyDimensionId,
  type CompanyEvidenceDraft,
  type DimensionId,
  type EvidenceDraft,
  type EvidenceKind,
  type InvestigationDepth,
  type JobId,
  type OutreachKind,
  type ProfileLinks,
  type RawItem,
  type RepoRef,
  type SimMeta,
  type SimSignal,
  type SourceId,
  type SourceStatus,
} from "@agentswarm/shared";
import type {
  RepoFinder,
  SimCompany,
  SimFounder,
  SimWorld,
  SourceAdapter,
  SourceFetchRequest,
  SourceRegistry,
} from "../contracts";
import { createSimWeb } from "./web";
export { createSimDialler } from "./dialler";

const DEFAULT_SEED = 7;
const DEFAULT_FOUNDERS = 600;
const DEFAULT_DAYS = 60;
const SOURCE_IDS = ["hackernews", "github", "arxiv", "people_data"] as const satisfies readonly SourceId[];
const BASE_DATE_UTC = Date.UTC(2025, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

export const SIM_SECTORS = [
  "Developer tools",
  "Applied AI",
  "Climate software",
  "Robotics",
  "Healthcare software",
  "Financial infrastructure",
  "Industrial automation",
  "Education technology",
] as const;

export const SIM_STAGES = ["pre-seed", "seed", "series A"] as const;

export const SIM_REGIONS = [
  "Portland, Oregon",
  "Madison, Wisconsin",
  "Austin, Texas",
  "Raleigh, North Carolina",
  "Toronto, Ontario",
  "Dublin, Ireland",
  "Helsinki, Finland",
  "Melbourne, Australia",
] as const;

export const SIM_PRESTIGIOUS_SCHOOLS = [
  "Meridian Institute of Technology",
  "Crown Harbor University",
  "Northstar Polytechnic",
  "Aster Vale Institute",
] as const;

export const SIM_ORDINARY_SCHOOLS = [
  "Pinebridge Technical College",
  "Westlake State University",
  "Redwood Applied Sciences College",
  "Clearwater Polytechnic",
] as const;

export const SIM_PRESTIGIOUS_EMPLOYERS = [
  "Meridian Systems Lab",
  "Crown Harbor Research",
  "Northstar Computing Group",
  "Aster Vale Instruments",
] as const;

export const SIM_ORDINARY_EMPLOYERS = [
  "Pinebridge Software Works",
  "Westlake Data Cooperative",
  "Redwood Devices",
  "Clearwater Product Studio",
] as const;

const SYLLABLES = [
  "ael", "ari", "bel", "bri", "cal", "cen", "dai", "del", "eli", "fen", "gai", "hal",
  "ira", "jen", "kai", "kel", "lan", "len", "mira", "nel", "ori", "per", "quin", "ren",
  "sai", "sel", "tavi", "tor", "uma", "val", "wen", "xan", "yori", "zen",
] as const;

const QUALITY_WEIGHTS: Readonly<Record<DimensionId, number>> = {
  built_hard_things: 0.19,
  technical_depth: 0.17,
  velocity: 0.13,
  slope: 0.13,
  insight: 0.16,
  ambition: 0.06,
  communication: 0.05,
  magnetism: 0.04,
  grit: 0.04,
  integrity: 0.03,
};

const INVESTIGATION_DIMENSIONS = {
  "investigate.background": ["slope", "grit", "magnetism"],
  "investigate.code": ["built_hard_things", "technical_depth", "velocity"],
  "investigate.company": ["insight", "ambition", "velocity"],
  "investigate.media": ["communication", "insight", "ambition"],
  "investigate.redflags": ["integrity"],
} as const satisfies Record<string, readonly DimensionId[]>;

type InvestigationJob = keyof typeof INVESTIGATION_DIMENSIONS;

const EVIDENCE_DETAILS = {
  built_hard_things: [
    "no personally built artifact is visible in the public record",
    "the visible work is mostly standard projects and thin wrappers",
    "the record includes a complete product with ordinary engineering tradeoffs",
    "the person led work on a technically demanding system",
    "the person built a rare system that other engineers rely on",
  ],
  technical_depth: [
    "the available technical output does not explain how the system works",
    "the explanations repeat familiar patterns without discussing tradeoffs",
    "the work follows sound standard practice",
    "the explanations address tradeoffs and known failure modes",
    "the work contributes an original technique used by specialists",
  ],
  velocity: [
    "visible activity has not yet produced a shipped result",
    "the record shows long gaps and unfinished projects",
    "the person ships complete work at a steady pace",
    "the person releases meaningful improvements every few weeks",
    "the person repeatedly takes a product from idea to use in a few weeks",
  ],
  slope: [
    "the public work history shows little change in scope",
    "the work has stayed at a similar scope across several years of experience",
    "the responsibilities have grown at a steady pace",
    "the person took on substantially larger scope early in their work history",
    "the person repeatedly achieved unusually broad scope for their experience",
  ],
  insight: [
    "the public description names the problem without a specific point of view",
    "the market description is similar to common accounts in the field",
    "the person draws on relevant experience to explain the problem",
    "the person describes a specific insight grounded in doing the work",
    "the person has an evidence-backed view that challenges a common assumption",
  ],
  ambition: [
    "the stated goal is a personal tool rather than a company",
    "the stated goal is a small tool or focused business",
    "the plan describes a sustainable company in an established category",
    "the plan aims to become the default product in a large market",
    "the plan sets out concrete steps toward changing how an industry works",
  ],
  communication: [
    "the available explanation is difficult to follow",
    "the explanation relies on jargon without enough detail",
    "the explanation makes the product understandable",
    "the person explains complex ideas simply and answers direct questions",
    "the explanation is memorable and has changed how others discuss the topic",
  ],
  magnetism: [
    "the public collaboration record includes departures after disagreements",
    "the work appears to have been done alone so far",
    "the person has ordinary project collaborators",
    "strong contributors have joined or publicly supported the work",
    "exceptional collaborators have made a clear choice to join the work",
  ],
  grit: [
    "the visible history shows projects ending when they became difficult",
    "the public record shows efforts being dropped at early setbacks",
    "the person completed efforts that lasted several months",
    "the person persisted for years through visible setbacks",
    "the person finished several long efforts despite repeated setbacks",
  ],
  integrity: [
    "a material claim about a title or result conflicts with a reliable record",
    "several public claims go beyond what the available record supports",
    "the public description includes minor promotional overstatement",
    "the claims that can be checked match the available record",
    "the claims match the record and clearly state limits and failures",
  ],
} as const satisfies Record<DimensionId, readonly [string, string, string, string, string]>;

const EVIDENCE_ALTERNATES = {
  built_hard_things: [
    "the profile provides no link to a software, hardware, or research artifact built by the person",
    "the available repositories are mostly tutorial work and narrow adapters",
    "a finished product is available with some nontrivial engineering work",
    "the linked record shows primary work on a system with demanding technical constraints",
    "other engineers use a difficult system for which the person was the main builder",
  ],
  technical_depth: [
    "the published material gives no account of the system's underlying mechanics",
    "the notes describe familiar tools without explaining their limits",
    "the implementation uses established methods correctly",
    "the person explains design choices and the cases where they fail",
    "specialists have learned a new technique from the person's technical work",
  ],
  velocity: [
    "the work log has activity notes but no release to users",
    "completed work is separated by long pauses",
    "the changelog records finished work at a consistent pace",
    "the public changelog has short cycles of useful improvements",
    "several products went from a first idea to active use within weeks",
  ],
  slope: [
    "the timeline shows similar responsibility and scope throughout",
    "the timeline shows little change in the size of the work",
    "responsibilities grew in line with the person's work experience",
    "the person was trusted with broader scope early in their work history",
    "the record shows rare scope at each step of the person's experience",
  ],
  insight: [
    "the public explanation identifies a problem but offers no particular view of it",
    "the market summary follows the standard description used in the field",
    "the person connects the problem to relevant work they have done",
    "the person points to a specific problem others in the field often miss",
    "evidence is emerging for the person's view that challenges a common assumption",
  ],
  ambition: [
    "the stated goal is a personal project rather than an organization",
    "the plan focuses on a narrow tool or local business",
    "the plan targets a durable company in an existing category",
    "the team is pursuing a default product for a large market",
    "concrete steps point toward a major change in how an industry operates",
  ],
  communication: [
    "the recorded explanation is hard to follow and leaves key terms unclear",
    "the presentation uses technical language without enough explanation",
    "the person gives a workable explanation of what the product does",
    "the person makes a complex idea clear and responds directly to questions",
    "the explanation is widely repeated and has changed how people discuss the topic",
  ],
  magnetism: [
    "the collaboration history records people leaving after disagreements",
    "the public record shows independent work without collaborators",
    "the project lists routine contributions from collaborators",
    "experienced contributors chose to join or endorse the project",
    "exceptional people left other options to join this work",
  ],
  grit: [
    "the history shows efforts ending as soon as they became difficult",
    "the visible work stops soon after early setbacks",
    "the person finished work that took several months",
    "the person worked through visible setbacks over several years",
    "several long efforts were completed despite repeated setbacks",
  ],
  integrity: [
    "a reliable record directly conflicts with a material public claim",
    "multiple claims are broader than the supporting records",
    "promotional wording occasionally stretches beyond the detail available",
    "the checkable public statements match the records",
    "public claims match records and state limits and failures plainly",
  ],
} as const satisfies Record<DimensionId, readonly [string, string, string, string, string]>;

const CLAIM_VERBS: Readonly<Record<DimensionId, string>> = {
  built_hard_things: "built",
  technical_depth: "understands the technical tradeoffs in",
  velocity: "ships",
  slope: "has taken on growing scope while working on",
  insight: "has a specific view of the problem behind",
  ambition: "is aiming to build",
  communication: "explains the ideas behind",
  magnetism: "has brought collaborators into",
  grit: "persisted through setbacks while building",
  integrity: "describes the limits and results of",
};

interface FounderDetails {
  eventDays: number[];
  hasTalks: boolean;
  school: string;
  employer: string;
}

interface NoiseItem extends RawItem {
  simFounderId: null;
}

/** Stable integer hash for structured seed parts. */
export function hashSeed(...parts: Array<string | number>): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const value = typeof part === "number" ? `n:${Number.isFinite(part) ? part : 0}` : `s:${part}`;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A small deterministic PRNG; each returned value is in [0, 1). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function choose<T>(items: readonly T[], rng: () => number): T {
  const index = Math.floor(rng() * items.length);
  return items[index] ?? items[0]!;
}

function chooseDate(day: number): string {
  const safeDay = Number.isFinite(day) ? Math.trunc(day) : 0;
  return new Date(BASE_DATE_UTC + safeDay * DAY_MS).toISOString().slice(0, 10);
}

function cloneFounder(founder: SimFounder): SimFounder {
  return {
    ...founder,
    links: { ...founder.links },
    latent: { ...founder.latent },
    visibleIn: [...founder.visibleIn],
  };
}

function uniqueWord(rng: () => number): string {
  const first = choose(SYLLABLES, rng);
  const second = choose(SYLLABLES, rng);
  return `${first}${second}`.replace(/^./, (letter) => letter.toUpperCase());
}

function uniqueName(rng: () => number, existing: Set<string>): string {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const name = `${uniqueWord(rng)} ${uniqueWord(rng)}`;
    if (!existing.has(name)) {
      existing.add(name);
      return name;
    }
  }
  const fallback = `${uniqueWord(rng)} ${uniqueWord(rng)} ${existing.size + 1}`;
  existing.add(fallback);
  return fallback;
}

function uniqueCompany(rng: () => number, existing: Set<string>): string {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const company = `${uniqueWord(rng)} ${choose(["Labs", "Systems", "Works", "Studio"] as const, rng)}`;
    if (!existing.has(company)) {
      existing.add(company);
      return company;
    }
  }
  const fallback = `${uniqueWord(rng)} ${existing.size + 1} Labs`;
  existing.add(fallback);
  return fallback;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function gaussian(rng: () => number): number {
  const first = Math.max(Number.EPSILON, rng());
  const second = rng();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function founderLinks(name: string, company: string, rng: () => number): ProfileLinks {
  const person = slug(name);
  const project = slug(company);
  return {
    github: rng() < 0.15 ? null : `https://sim.invalid/${person}`,
    linkedin: `https://sim.invalid/pro/${person}`,
    x: `https://sim.invalid/@${person}`,
    site: `https://sim.invalid/${project}`,
    scholar: rng() < 0.38 ? `https://sim.invalid/papers/${person}` : null,
  };
}

function weightedQuality(latent: Record<DimensionId, number>): number {
  return DIMENSIONS.reduce((total, dimension) => {
    const id = dimension.id as DimensionId;
    return total + latent[id] * QUALITY_WEIGHTS[id];
  }, 0);
}

function makeLatent(rng: () => number): Record<DimensionId, number> {
  const sharedFactor = rng();
  const latent = {} as Record<DimensionId, number>;
  for (const dimension of DIMENSIONS) {
    const id = dimension.id as DimensionId;
    latent[id] = clamp(0.48 * sharedFactor + 0.52 * rng());
  }
  return latent;
}

function makeFounder(index: number, seed: number, days: number, usedNames: Set<string>, usedCompanies: Set<string>): {
  founder: SimFounder;
  details: FounderDetails;
} {
  const rng = createRng(hashSeed(seed, "founder", index));
  const name = uniqueName(rng, usedNames);
  const companyName = uniqueCompany(rng, usedCompanies);
  const latent = makeLatent(rng);
  const quality = weightedQuality(latent);
  const pedigree = clamp(0.5 + (quality - 0.5) * 0.3 + (rng() - 0.5) * 0.8);
  const integrityFactor = 0.12 + 0.88 * latent.integrity;
  const outcomeProbability = clamp(0.032 + 0.53 * quality ** 2.4 * integrityFactor, 0.005, 0.75);
  const outcome = rng() < outcomeProbability ? 1 : 0;
  const appearsOnDay = Math.floor(rng() * days);
  const visibleCount = 1 + Math.floor(rng() * 3);
  const shuffledSources = [...SOURCE_IDS];
  for (let index = shuffledSources.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [shuffledSources[index], shuffledSources[swap]] = [shuffledSources[swap]!, shuffledSources[index]!];
  }
  const visibleIn = shuffledSources.slice(0, visibleCount);
  const eventDays = [appearsOnDay];
  const eventCount = 1 + Math.floor(rng() * 3);
  const laterDays = Array.from({ length: Math.max(0, days - appearsOnDay - 1) }, (_, offset) => appearsOnDay + offset + 1);
  for (let index = laterDays.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [laterDays[index], laterDays[swap]] = [laterDays[swap]!, laterDays[index]!];
  }
  eventDays.push(...laterDays.slice(0, eventCount - 1));
  eventDays.sort((left, right) => left - right);
  const region = choose(SIM_REGIONS, rng);
  const sector = choose(SIM_SECTORS, rng);
  const stage = choose(SIM_STAGES, rng);
  const links = founderLinks(name, companyName, rng);
  const headline = `${stage} founder building ${companyName} in ${sector.toLowerCase()}`;
  const oneLiner = choose([
    "tools that help small engineering teams ship reliable systems",
    "software that makes complex field work easier to coordinate",
    "a practical platform for turning research into useful products",
    "infrastructure for teams working with difficult data",
    "a simpler way to automate slow, repetitive business workflows",
  ] as const, rng);
  const founder: SimFounder = {
    simId: `sim-founder-${String(index + 1).padStart(4, "0")}`,
    name,
    headline,
    location: region,
    sector,
    stage,
    companyName,
    companyOneLiner: oneLiner,
    links,
    latent,
    quality,
    pedigree,
    outcome,
    appearsOnDay,
    visibleIn,
  };
  const prestigious = pedigree >= 0.5;
  const schoolSet = prestigious ? SIM_PRESTIGIOUS_SCHOOLS : SIM_ORDINARY_SCHOOLS;
  const employerSet = prestigious ? SIM_PRESTIGIOUS_EMPLOYERS : SIM_ORDINARY_EMPLOYERS;
  const details: FounderDetails = {
    eventDays,
    hasTalks: rng() >= 0.4,
    school: choose(schoolSet, rng),
    employer: choose(employerSet, rng),
  };
  return { founder, details };
}

function publicLinks(links: ProfileLinks): string {
  return Object.values(links).filter((link): link is string => link !== null).join("; ");
}

function founderItem(founder: SimFounder, source: (typeof SOURCE_IDS)[number], day: number, sequence: number): RawItem {
  const date = chooseDate(day);
  const links = publicLinks(founder.links);
  let title: string;
  let text: string;
  let metrics: Record<string, number>;
  switch (source) {
    case "hackernews": {
      title = `Show HN: ${founder.companyName} — ${founder.companyOneLiner}`;
      text = `I'm ${founder.name}, founder of ${founder.companyName}. We're building ${founder.companyOneLiner}. The current release is in ${founder.stage}. More: ${links}`;
      metrics = {
        points: Math.round(4 + 88 * founder.latent.communication * founder.latent.velocity),
        comments: Math.round(2 + 24 * founder.latent.communication),
      };
      break;
    }
    case "github": {
      const repoName = `${slug(founder.companyName)}-core`;
      title = `${repoName}: ${founder.companyOneLiner}`;
      text = `${founder.name} is building ${repoName} at ${founder.companyName}. The project focuses on ${founder.companyOneLiner}. Profile and project links: ${links}`;
      metrics = {
        stars: Math.round(2 + 1_500 * founder.latent.built_hard_things ** 2 * founder.latent.velocity),
        forks: Math.round(1 + 95 * founder.latent.technical_depth * founder.latent.magnetism),
      };
      break;
    }
    case "arxiv": {
      title = `${founder.companyName}: notes on ${founder.sector.toLowerCase()} systems`;
      text = `${founder.name} describes work connected to ${founder.companyName}, where the team studies ${founder.companyOneLiner}. Author profile: ${links}`;
      metrics = {
        citations: Math.round(1 + 210 * founder.latent.technical_depth * founder.latent.insight),
        versions: 1 + Math.floor(founder.latent.velocity * 4),
      };
      break;
    }
    case "people_data": {
      title = `${founder.name}, ${founder.headline}`;
      text = `${founder.name} is a ${founder.stage} founder at ${founder.companyName} in ${founder.location}. ${founder.companyOneLiner}. Public profile links: ${links}`;
      metrics = {
        connections: Math.round(8 + 520 * founder.latent.magnetism),
        role_changes: 1 + Math.round(4 * founder.latent.slope),
      };
      break;
    }
  }
  return {
    ref: `https://sim.invalid/${source}/${day}/${sequence}-${slug(founder.simId)}`,
    source,
    title,
    text,
    author: founder.name,
    authorUrl: founder.links.linkedin,
    publishedAt: date,
    metrics,
    simFounderId: founder.simId,
  };
}

function noiseItem(source: SourceId, day: number, index: number, rng: () => number): NoiseItem {
  const kind = Math.floor(rng() * 3);
  const date = chooseDate(day);
  let title: string;
  let text: string;
  let metrics: Record<string, number>;
  if (kind === 0) {
    const library = `${uniqueWord(rng)}-${uniqueWord(rng).toLowerCase()}`;
    title = `Release: ${library} 1.${Math.floor(rng() * 9)}.${Math.floor(rng() * 20)}`;
    text = `${library} published a small library release with a migration note and a compatibility fix. The release page includes a changelog and package metadata.`;
    metrics = { downloads: Math.round(20 + 9_000 * rng()), stars: Math.round(1 + 120 * rng()) };
  } else if (kind === 1) {
    const subject = choose(["retrieval systems", "battery control", "public transit", "robot perception"] as const, rng);
    title = `Survey: recent methods for ${subject}`;
    text = `This survey paper compares published approaches to ${subject}, summarizes common evaluation methods, and lists open research questions.`;
    metrics = { citations: Math.round(1 + 180 * rng()), versions: 1 + Math.floor(rng() * 3) };
  } else {
    const role = choose(["platform engineer", "research scientist", "product lead", "systems developer"] as const, rng);
    title = `Role update: ${role}`;
    text = `A public work history records a move into a ${role} role at ${uniqueWord(rng)} ${choose(["Labs", "Group", "Works"] as const, rng)}. The update contains no founder or product launch details.`;
    metrics = { profile_views: Math.round(3 + 65 * rng()), role_changes: 1 };
  }
  return {
    ref: `https://sim.invalid/${source}/${day}/noise-${index}`,
    source,
    title,
    text,
    author: null,
    authorUrl: null,
    publishedAt: date,
    metrics,
    simFounderId: null,
  };
}

function evidenceKind(job: InvestigationJob): EvidenceKind {
  switch (job) {
    case "investigate.background":
      return "profile";
    case "investigate.code":
      return "repo";
    case "investigate.company":
      return "launch";
    case "investigate.media":
      return "talk";
    case "investigate.redflags":
      return "article";
  }
}

function evidenceSource(job: InvestigationJob): SourceId {
  switch (job) {
    case "investigate.background":
    case "investigate.redflags":
      return "people_data";
    case "investigate.code":
      return "github";
    case "investigate.company":
      return "hackernews";
    case "investigate.media":
      return "arxiv";
  }
}

function evidenceTemplates(
  founder: SimFounder,
  details: FounderDetails,
  dimension: DimensionId,
  trueBand: number,
  variant: number,
  excerptText: string,
  url: string,
): string {
  const schoolContext = `A professional profile lists education at ${details.school} and a prior role at ${details.employer}; those entries are not described as work results. `;
  const context = dimension === "slope" || dimension === "grit" || dimension === "magnetism" ? schoolContext : "";
  const slots = createRng(hashSeed(founder.simId, dimension, trueBand, variant, url));
  const technology = choose(["TypeScript services", "a Rust data path", "Python evaluation tools", "a distributed queue", "robot control software"] as const, slots);
  const months = 2 + trueBand * 5 + (variant === 0 ? 3 : 7);
  const activityCount = 1 + trueBand * 3 + (variant === 0 ? 2 : 5);
  let activity: string;
  switch (dimension) {
    case "built_hard_things":
      activity = trueBand === 0
        ? `The profile lists ${activityCount} activity notes across ${months} months but links no personally built artifact.`
        : trueBand === 1
          ? `The linked ${technology} repository records ${activityCount} tutorial-sized changes over ${months} months.`
          : `The ${technology} system has ${activityCount} documented build milestones across ${months} months.`;
      break;
    case "technical_depth":
      activity = `The source contains ${activityCount} notes about ${technology} across ${months} months, including detail consistent with this record.`;
      break;
    case "velocity":
      activity = trueBand === 0
        ? `A work log shows ${activityCount} activity notes across ${months} months and no release.`
        : trueBand === 1
          ? `The changelog has ${activityCount} completed changes to ${technology} across ${months} months, with long pauses between them.`
          : `The release history records ${activityCount} improvements to ${technology} over ${months} months.`;
      break;
    case "slope":
      activity = trueBand < 2
        ? `A work timeline spans ${months} months and records ${activityCount} projects at a similar scope.`
        : `A work timeline spans ${months} months and records ${activityCount} projects with growing scope.`;
      break;
    case "insight":
      activity = `The project notes cite ${activityCount} observations about how teams use ${technology} over ${months} months.`;
      break;
    case "ambition":
      activity = `A company plan lists ${activityCount} milestones for a ${months}-month period in the target market.`;
      break;
    case "communication":
      activity = `The public archive includes ${activityCount} explanations of ${technology} across ${months} months.`;
      break;
    case "magnetism":
      activity = trueBand < 2
        ? `The collaboration record spans ${months} months and includes ${activityCount} contributor changes.`
        : `The collaboration record spans ${months} months and names ${activityCount} project contributors.`;
      break;
    case "grit":
      activity = `The work history covers ${months} months and logs ${activityCount} milestones through the effort.`;
      break;
    case "integrity":
      activity = `The comparison checks ${activityCount} public statements against records collected over ${months} months.`;
      break;
  }
  if (variant === 0) {
    return `${context}${founder.name}'s public record for ${founder.companyName} says ${excerptText}. ${activity} The source links to ${url}.`;
  }
  return `${context}In the record connected to ${url}, ${founder.name} of ${founder.companyName} is described this way: ${excerptText}. ${activity}`;
}

function signalValue(rng: () => number, truth: SimMeta["truth"], latent: number): number {
  if (truth === "supported") return clamp(latent + gaussian(rng) * 0.12);
  if (truth === "unsupported") return clamp(Math.max(latent + 0.1, latent + 0.25 + gaussian(rng) * 0.12));
  return rng();
}

const COMPANY_FOUNDER_ROLES = ["Co-founder and CTO", "Co-founder and COO", "Co-founder and head of product"] as const;
const COMPANY_ROLES = ["Founding engineer", "Head of design", "Product lead", "Research lead", "Operations lead", "Customer engineer"] as const;
const TEAM_BACKGROUNDS = [
  "Built workflow software for regional operators and maintained its release process.",
  "Designed data tools used by small product teams to review operational work.",
  "Led integrations between internal systems and customer-facing applications.",
  "Developed evaluation methods for software used in production environments.",
  "Worked on product delivery across engineering, research and customer teams.",
] as const;
const NULL_PROFILE_LINKS: ProfileLinks = { github: null, linkedin: null, x: null, site: null, scholar: null };

function companyCustomerAndProblem(sector: string): { customer: string; problem: string } {
  switch (sector) {
    case "Developer tools": return { customer: "small platform teams", problem: "reduce repeated deployment work" };
    case "Applied AI": return { customer: "applied research teams", problem: "move models into dependable daily workflows" };
    case "Climate software": return { customer: "energy operators", problem: "coordinate projects across changing grid conditions" };
    case "Robotics": return { customer: "robotics teams", problem: "make field deployments easier to monitor and improve" };
    case "Healthcare software": return { customer: "care operations teams", problem: "close gaps between clinical handoffs" };
    case "Financial infrastructure": return { customer: "payments teams", problem: "reconcile complex transactions with fewer manual steps" };
    case "Industrial automation": return { customer: "plant operators", problem: "spot production delays before they spread" };
    default: return { customer: "school operations teams", problem: "coordinate work across busy learning environments" };
  }
}

function makeCompany(founder: SimFounder, seed: number): SimCompany {
  const rng = createRng(hashSeed(seed, founder.simId, "company"));
  const quality = clamp(0.5 * founder.quality + 0.5 * clamp(0.45 + gaussian(rng) * 0.25));
  const latent = {} as Record<CompanyDimensionId, number>;
  for (const dimension of COMPANY_DIMENSIONS) {
    if (dimension.id === "claims") {
      latent.claims = rng() < 0.05 ? 0.08 + rng() * 0.1 : clamp(0.75 + gaussian(rng) * 0.12);
    } else {
      latent[dimension.id] = clamp(quality + gaussian(rng) * 0.15);
    }
  }
  const site = `https://${slug(founder.companyName)}.example`;
  const { customer, problem } = companyCustomerAndProblem(founder.sector);
  const mission = latent.mission >= 0.62
    ? `We help ${customer} ${problem} with ${founder.companyOneLiner}.`
    : `We use ${founder.companyOneLiner} to make ${founder.sector.toLowerCase()} better for everyone.`;
  const maximumTeamSize = Math.min(4, Math.floor(latent.team * 4) + 1);
  const teamCount = Math.floor(rng() * (maximumTeamSize + 1));
  const usedNames = new Set<string>();
  const team = Array.from({ length: teamCount }, (_, index) => {
    const isFounder = index === 0 && rng() < 0.65;
    const role = isFounder ? choose(COMPANY_FOUNDER_ROLES, rng) : choose(COMPANY_ROLES, rng);
    return {
      name: uniqueName(rng, usedNames),
      role,
      isFounder,
      background: choose(TEAM_BACKGROUNDS, rng),
      sourceUrl: `${site}/team`,
      links: { ...NULL_PROFILE_LINKS },
    };
  });
  return {
    simId: founder.simId,
    name: founder.companyName,
    url: site,
    oneLiner: founder.companyOneLiner,
    mission,
    tagline: founder.companyOneLiner,
    sector: founder.sector,
    stage: founder.stage,
    latent,
    quality,
    team,
  };
}

type CompanyJob = "company.product" | "company.traction" | "company.team";
type CompanyEvidenceSpec = {
  facet: CompanyEvidenceDraft["facet"];
  kind: CompanyEvidenceDraft["kind"];
  title: string;
  excerpt: string;
  claim: string;
  dimensions: readonly CompanyDimensionId[];
  itemIndex: number;
};

function companyBand(value: number): number {
  return Math.min(4, Math.floor(value * 5));
}

function companyEvidenceSpecs(
  company: SimCompany,
  founder: SimFounder,
  jobId: CompanyJob,
  depth: InvestigationDepth,
): CompanyEvidenceSpec[] {
  const quick = depth === "quick";
  const deep = depth === "deep";
  const specs: CompanyEvidenceSpec[] = [];
  const add = (
    facet: CompanyEvidenceDraft["facet"], kind: CompanyEvidenceDraft["kind"], title: string,
    excerpt: string, claim: string, dimensions: readonly CompanyDimensionId[], itemIndex: number,
  ) => specs.push({ facet, kind, title, excerpt, claim, dimensions, itemIndex });
  const productText = [
    "The public preview has no documented path for a customer to use the product yet.",
    "A small demo is available, though it does not yet support an outside team's full workflow.",
    "The release notes describe a working product that outside teams can use for routine tasks.",
    "The changelog shows regular fixes and customers using the product in daily operations.",
    "Independent operators describe relying on the product for work that competing tools do not cover.",
  ];
  const marketText = [
    "The page identifies a narrow buyer group with few current purchases in this category.",
    "The initial audience is a small group of buyers with limited budgets for this workflow.",
    "Several established buyers already pay for products addressing this operational need.",
    "The customer notes describe a growing buyer group and a clear first segment for the product.",
    "The market brief points to a large category in transition, with no settled approach among buyers.",
  ];
  const productBand = companyBand(company.latent.product);
  const marketBand = companyBand(company.latent.market);
  if (jobId === "company.product") {
    add("mission", "launch", `${company.name}: mission`, company.mission,
      `${company.name} describes the customer problem it is working to solve.`, ["mission"], 0);
    const productCount = deep ? 2 : 1;
    for (let index = 0; index < productCount; index += 1) {
      add("product", index === 0 ? "launch" : "article", `${company.name}: product release ${index + 1}`,
        `${productText[productBand]} ${index === 0 ? `The release page also describes ${company.oneLiner}.` : "A later product note outlines the next workflow improvements."}`,
        `${company.name} has a product record describing its current release.`, ["product", "edge"], index);
    }
    const roadmapCount = quick ? 0 : deep ? 2 : 1;
    for (let index = 0; index < roadmapCount; index += 1) {
      add("roadmap", "article", `${company.name}: product notes ${index + 1}`,
        company.latent.plan > 0.6
          ? `The product notes put ${index === 0 ? "customer onboarding" : "usage reporting"} before broader expansion and connect it to the current release.`
          : `The product notes describe broad goals for ${company.sector.toLowerCase()} without dates or a clear order.`,
        `${company.name} has published a note about its next product steps.`, ["plan"], index);
    }
    const marketCount = quick || !deep ? 1 : 2;
    for (let index = 0; index < marketCount; index += 1) {
      add("market", "article", `${company.name}: customer market note ${index + 1}`,
        `${marketText[marketBand]} The brief connects this opportunity to ${company.oneLiner}.`,
        `${company.name} has published a description of its target market.`, ["market", "edge"], index);
    }
    if (company.latent.claims < 0.2) {
      add("risk", "article", `${company.name}: claim comparison`,
        `The launch page says ${company.name} has active use across dozens of teams, while a separate usage note records no outside workspaces for the same period.`,
        `A public usage claim by ${company.name} conflicts with a second company source.`, ["claims"], 0);
    }
  } else if (jobId === "company.traction") {
    const tractionCount = quick ? 1 : deep ? 3 : 2;
    const tractionText = [
      "The dated update records early conversations but no outside use of the product.",
      "The release note reports sign-ups and trial interest, without a record of regular use.",
      "A customer note describes a small set of teams using the product in a pilot.",
      "The update reports paying customers and higher monthly use than the prior quarter.",
      "An outside customer report describes demand growing faster than the team can onboard it.",
    ];
    for (let index = 0; index < tractionCount; index += 1) {
      add("traction", index === 0 ? "launch" : "article", `${company.name}: progress update ${index + 1}`,
        `${tractionText[companyBand(company.latent.traction)]} The update also notes ${company.oneLiner}.`,
        `${company.name} has published a dated update about customer use.`, ["traction", "momentum"], index);
    }
    if (founder.stage !== "pre-seed") {
      const fundingCount = deep ? 2 : 1;
      for (let index = 0; index < fundingCount; index += 1) {
        add("funding", "funding", `${company.name}: funding update ${index + 1}`,
          `The company announced a ${founder.stage === "series A" ? "series A" : "seed"} round to expand work on ${company.oneLiner}.`,
          `${company.name} has announced a funding milestone.`, ["momentum"], index);
      }
    }
  } else {
    const teamCount = quick ? 1 : deep ? 3 : 2;
    for (let index = 0; index < teamCount; index += 1) {
      const excerpt = company.team.length === 0
        ? "The team page lists the lead founder and no additional operating members. The company is still covering product and customer work with a small founding group."
        : `The team page lists ${company.team.slice(0, Math.min(company.team.length, index + 1)).map((member) => `${member.name}, ${member.role}`).join("; ")}. ${index === 0 ? "Their backgrounds include product delivery and software operations." : "The listed roles add product and customer coverage alongside engineering."}`;
      add("team", "article", `${company.name}: team page ${index + 1}`, excerpt,
        `${company.name} has published a team listing with professional roles.`, ["team"], index);
    }
  }
  return specs;
}

function companyEvidenceDate(founder: SimFounder, facet: CompanyEvidenceDraft["facet"], index: number): string {
  const tractionOffsets = [520, 330, 145, 45];
  const fundingOffsets = [430, 160];
  const offset = facet === "traction" ? tractionOffsets[index] ?? 30
    : facet === "funding" ? fundingOffsets[index] ?? 30 : 0;
  return chooseDate(founder.appearsOnDay - offset);
}

function makeCompanyEvidence(
  seed: number,
  company: SimCompany,
  founder: SimFounder,
  jobId: CompanyJob,
  depth: InvestigationDepth,
): CompanyEvidenceDraft[] {
  const rng = createRng(hashSeed(seed, founder.simId, jobId, depth, "company-evidence"));
  const specs = companyEvidenceSpecs(company, founder, jobId, depth);
  return specs.map((spec) => {
    const bands = spec.dimensions.map((dimension) => companyBand(company.latent[dimension]));
    const highestBand = Math.max(...bands);
    const truthRoll = rng();
    const supportCutoff = highestBand < 4 ? 0.8625 : 0.95;
    const truth: SimMeta["truth"] = truthRoll < supportCutoff
      ? "supported"
      : highestBand < 4 && truthRoll < 0.95 ? "unsupported" : "wrong_person";
    const signals = spec.dimensions.map((dimension): SimSignal => ({
      dimension,
      value: clamp(company.latent[dimension] + gaussian(rng) * 0.12),
    }));
    let excerpt = spec.excerpt;
    let finalTruth: SimMeta["truth"] = truth;
    if (spec.facet === "risk") {
      finalTruth = "contradicted";
    } else if (truth === "wrong_person") {
      const suffixes = ["Labs", "Systems", "Works", "Studio"] as const;
      const originalSuffix = company.name.split(" ").at(-1);
      const alternatives = suffixes.filter((suffix) => suffix !== originalSuffix);
      const similarName = `${company.name.split(" ")[0]} ${choose(alternatives, rng)}`;
      excerpt = `This listing describes ${similarName}, a separate company with a similar name, rather than ${company.name}. Its page covers ${company.oneLiner}.`;
    }
    const sourcePath = spec.facet === "risk" ? `${company.url}/research/second-source` : company.url;
    return {
      kind: spec.kind,
      facet: spec.facet,
      url: `${sourcePath}/research/${spec.facet}/${spec.itemIndex + 1}`,
      title: spec.title,
      excerpt,
      claim: spec.claim,
      publishedAt: companyEvidenceDate(founder, spec.facet, spec.itemIndex),
      sim: { truth: finalTruth, signals },
    };
  });
}

function claimFor(name: string, company: string, dimension: DimensionId, band: number): string {
  return `${name} ${CLAIM_VERBS[dimension]} ${company}; the available evidence is consistent with level ${band + 1} for ${DIMENSIONS.find((item) => item.id === dimension)?.label.toLowerCase() ?? dimension}.`;
}

function depthRange(depth: InvestigationDepth): readonly [number, number] {
  switch (depth) {
    case "quick":
      return [1, 2];
    case "standard":
      return [2, 4];
    case "deep":
      return [4, 6];
  }
}

function safeLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
}

function copyRepo(repo: RepoRef): RepoRef {
  return { ...repo };
}

/** Build a deterministic synthetic environment for simulations and evals. */
export function createSimWorld(options: { seed?: number; founders?: number; days?: number } = {}): SimWorld {
  const seed = options.seed ?? DEFAULT_SEED;
  const founderCount = Number.isFinite(options.founders) ? Math.max(0, Math.floor(options.founders!)) : DEFAULT_FOUNDERS;
  const days = Number.isFinite(options.days) ? Math.max(1, Math.floor(options.days!)) : DEFAULT_DAYS;
  const usedNames = new Set<string>();
  const usedCompanies = new Set<string>();
  const generated = Array.from({ length: founderCount }, (_, index) =>
    makeFounder(index, seed, days, usedNames, usedCompanies),
  );
  const founderList = generated.map(({ founder }) => founder);
  const detailById = new Map(generated.map(({ founder, details }) => [founder.simId, details] as const));
  const founderById = new Map(founderList.map((founder) => [founder.simId, founder] as const));

  const repos = (simId: string): RepoRef[] => {
    const founder = founderById.get(simId);
    if (!founder?.links.github) return [];
    const rng = createRng(hashSeed(seed, simId, "repos"));
    const count = Math.floor(rng() * 4);
    const languages = ["TypeScript", "Python", "Rust", "Go", "C++"] as const;
    return Array.from({ length: count }, (_, index) => {
      const name = `${slug(founder.companyName)}-${["core", "engine", "tools"][index] ?? `module-${index + 1}`}`;
      const baseStars = 2 + Math.round(1_100 * founder.latent.built_hard_things ** 2 * founder.latent.velocity);
      return {
        url: `${founder.links.github}/${name}`,
        name,
        description: `${founder.companyName} component for ${founder.companyOneLiner}`,
        stars: Math.max(0, Math.round(baseStars * (0.62 + rng() * 0.76))),
        language: choose(languages, rng),
        localPath: null,
      };
    }).sort((first, second) => (second.stars ?? 0) - (first.stars ?? 0));
  };

  const companyFor = (simId: string): SimCompany | undefined => {
    const founder = founderById.get(simId);
    return founder ? makeCompany(founder, seed) : undefined;
  };

  const web = createSimWeb({ seed, founders: founderList, company: companyFor });

  const companyEvidenceFor = (simId: string, jobId: JobId, depth: InvestigationDepth): CompanyEvidenceDraft[] => {
    const founder = founderById.get(simId);
    if (!founder) return [];
    if (jobId !== "company.product" && jobId !== "company.traction" && jobId !== "company.team") return [];
    const company = makeCompany(founder, seed);
    return makeCompanyEvidence(seed, company, founder, jobId, depth);
  };

  return {
    seed,
    founders: () => founderList.map(cloneFounder),
    founder: (simId) => {
      const founder = founderById.get(simId);
      return founder ? cloneFounder(founder) : undefined;
    },
    itemsFor: (source, day, limit) => {
      if (!SOURCE_IDS.includes(source as (typeof SOURCE_IDS)[number])) return [];
      const sourceId = source as (typeof SOURCE_IDS)[number];
      const visible = founderList.filter((founder) =>
        founder.visibleIn.includes(sourceId) && (detailById.get(founder.simId)?.eventDays.includes(day) ?? false),
      );
      const rng = createRng(hashSeed(seed, sourceId, day, "items"));
      const noiseCount = Math.round(visible.length * (0.3 / 0.7));
      const items = visible.map((founder, index) => founderItem(founder, sourceId, day, index));
      for (let index = 0; index < noiseCount; index += 1) items.push(noiseItem(sourceId, day, index, rng));
      for (let index = items.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(rng() * (index + 1));
        [items[index], items[swap]] = [items[swap]!, items[index]!];
      }
      return items.slice(0, safeLimit(limit)).map((item) => ({ ...item, metrics: { ...item.metrics } }));
    },
    evidenceFor: (simId: string, jobId: JobId, depth: InvestigationDepth): EvidenceDraft[] => {
      const founder = founderById.get(simId);
      const details = detailById.get(simId);
      if (!founder || !details) return [];
      const dimensions = INVESTIGATION_DIMENSIONS[jobId as InvestigationJob];
      if (!dimensions) return [];
      if (jobId === "investigate.code" && !founder.links.github) return [];
      if (jobId === "investigate.media" && !details.hasTalks) return [];
      const rng = createRng(hashSeed(seed, simId, jobId, depth, "evidence"));
      const [minimum, maximum] = depthRange(depth);
      const count = minimum + Math.floor(rng() * (maximum - minimum + 1));
      const source = evidenceSource(jobId as InvestigationJob);
      const kind = evidenceKind(jobId as InvestigationJob);
      const url = `https://sim.invalid/evidence/${slug(founder.simId)}/${jobId}`;
      const result: EvidenceDraft[] = [];
      for (let index = 0; index < count; index += 1) {
        const dimension = dimensions[index % dimensions.length]!;
        const latent = founder.latent[dimension];
        const trueBand = Math.min(4, Math.floor(latent * 5));
        const truthRoll = rng();
        // Reserve the top band for supported or wrong-person items so every
        // unsupported claim can truthfully overstate its excerpt by a level.
        const supportCutoff = trueBand < 4 ? 0.8625 : 0.95;
        const truth: SimMeta["truth"] = truthRoll < supportCutoff
          ? "supported"
          : trueBand < 4 && truthRoll < 0.95
            ? "unsupported"
            : "wrong_person";
        const value = signalValue(rng, truth, latent);
        const signal: SimSignal = { dimension, value };
        const signalBand = truth === "unsupported"
          ? Math.min(4, Math.max(trueBand + 1, Math.floor(value * 5)))
          : Math.min(4, Math.floor(value * 5));
        const claimBand = truth === "unsupported" ? signalBand : trueBand;
        const evidenceUrl = `${url}/${index + 1}`;
        const detailVariant = Math.floor(rng() * 2);
        let excerptText: string = detailVariant === 0
          ? EVIDENCE_DETAILS[dimension][trueBand]!
          : EVIDENCE_ALTERNATES[dimension][trueBand]!;
        if (truth === "wrong_person") {
          const namesake = founderList.find((candidate) => candidate.simId !== founder.simId);
          const fallbackRng = createRng(hashSeed(seed, simId, jobId, index, "wrong-person"));
          const conflictCompany = namesake?.companyName ?? `${uniqueWord(fallbackRng)} ${choose(["Research Collective", "Field Studio", "Signal Group"] as const, fallbackRng)}`;
          const candidateLocation = namesake?.location;
          const conflictLocation = candidateLocation && candidateLocation !== founder.location
            ? candidateLocation
            : choose(SIM_REGIONS.filter((region) => region !== founder.location), fallbackRng);
          excerptText = `This source appears to describe the namesake ${founder.name} at a different company, ${conflictCompany}, in ${conflictLocation}, rather than ${founder.name}'s public profile for ${founder.companyName} in ${founder.location}.`;
        }
        const variant = Math.floor(rng() * 2);
        const excerpt = evidenceTemplates(founder, details, dimension, trueBand, variant, excerptText, evidenceUrl);
        result.push({
          kind,
          url: evidenceUrl,
          title: `${founder.companyName}: ${DIMENSIONS.find((item) => item.id === dimension)?.label ?? dimension} record ${index + 1}`,
          excerpt,
          claim: claimFor(founder.name, founder.companyName, dimension, claimBand),
          publishedAt: chooseDate(founder.appearsOnDay + index),
          sim: { signals: [signal], truth },
        });
      }
      return result;
    },
    company: companyFor,
    page: web.page,
    search: web.search,
    engines: web.engines,
    strongEarlyFounders: web.strongEarlyFounders,
    companyEvidenceFor,
    repos: (simId) => repos(simId).map(copyRepo),
    transcript: (simId: string, kind: OutreachKind, targetName: string) => {
      const founder = founderById.get(simId);
      if (!founder) return "";
      const rng = createRng(hashSeed(seed, simId, kind, targetName, "transcript"));
      const isReference = kind === "call_reference";
      const respondent = isReference ? "Colleague" : "Founder";
      const name = targetName || (isReference ? "a colleague" : founder.name);
      const firstLine = `Caller: I'm an AI assistant calling on behalf of the fund. With your consent, may I take notes while we talk about ${isReference ? founder.name : founder.companyName}?`;
      const lines = [
        firstLine,
        `${respondent}: Yes, that's fine. I'm ${name}, and I can speak about ${founder.companyName}.`,
        `Caller: What is the hardest part of ${founder.companyName} that ${isReference ? "they" : "you"} built?`,
        `${respondent}: ${founder.latent.built_hard_things > 0.65 ? "The core system had difficult reliability and scaling constraints, and I worked through the design and implementation." : "We assembled a useful first version from proven components and learned where the difficult parts are."}`,
        "Caller: What happened when the work met a serious setback?",
        `${respondent}: ${founder.latent.grit > 0.6 ? "We kept returning to the problem, changed our approach, and stayed with it until the result worked." : "We paused, re-scoped the work, and focused on a smaller result we could finish."}`,
        `Caller: What did working on ${founder.companyName} teach ${isReference ? "them" : "you"} about the problem?`,
        `${respondent}: ${founder.latent.insight > 0.65 ? `After working directly with users, I saw that the overlooked constraint is how teams coordinate around ${founder.companyOneLiner}.` : `Our current view comes from early conversations and watching how teams use ${founder.companyOneLiner}; we are still testing which part matters most.`}`,
        "Caller: How would you explain the product to a team seeing it for the first time?",
        `${respondent}: ${founder.latent.communication > 0.62 ? `${founder.companyName} helps teams ${founder.companyOneLiner}; the main benefit is a shorter path from a problem to a dependable result.` : `We are working on a clearer explanation. In short, ${founder.companyName} helps teams ${founder.companyOneLiner}.`}`,
        "Caller: Which result do you describe with the most care?",
        `${respondent}: ${founder.latent.integrity > 0.55 ? "We separate what is measured from what we still hope to prove, and we call out the limits directly." : "We are still tightening our measurements, so I avoid presenting early numbers as settled results."}`,
      ];
      const topics = ["hard", "persistence", "insight", "clarity", "honesty", "team", "release"] as const;
      const targetLineCount = 10 + Math.floor(rng() * 4);
      while (lines.length < targetLineCount) {
        const topic = choose(topics, rng);
        switch (topic) {
          case "hard":
            lines.push(`Caller: What is the hardest part of ${founder.companyName} that ${isReference ? "they" : "you"} built?`);
            lines.push(`${respondent}: ${founder.latent.built_hard_things > 0.65 ? "The core system had difficult reliability and scaling constraints, and I worked through the design and implementation." : "We assembled a useful first version from proven components and learned where the difficult parts are."}`);
            break;
          case "persistence":
            lines.push("Caller: What happened when the work met a serious setback?");
            lines.push(`${respondent}: ${founder.latent.grit > 0.6 ? "We kept returning to the problem, changed our approach, and stayed with it until the result worked." : "We paused, re-scoped the work, and focused on a smaller result we could finish."}`);
            break;
          case "insight":
            lines.push(`Caller: What did working on ${founder.companyName} teach ${isReference ? "them" : "you"} about the problem?`);
            lines.push(`${respondent}: ${founder.latent.insight > 0.65 ? `After working directly with users, I saw that the overlooked constraint is how teams coordinate around ${founder.companyOneLiner}.` : `Our current view comes from early conversations and watching how teams use ${founder.companyOneLiner}; we are still testing which part matters most.`}`);
            break;
          case "clarity":
            lines.push("Caller: How would you explain the product to a team seeing it for the first time?");
            lines.push(`${respondent}: ${founder.latent.communication > 0.62 ? `${founder.companyName} helps teams ${founder.companyOneLiner}; the main benefit is a shorter path from a problem to a dependable result.` : `We are working on a clearer explanation. In short, ${founder.companyName} helps teams ${founder.companyOneLiner}.`}`);
            break;
          case "honesty":
            lines.push("Caller: Which result do you describe with the most care?");
            lines.push(`${respondent}: ${founder.latent.integrity > 0.55 ? "We separate what is measured from what we still hope to prove, and we call out the limits directly." : "We are still tightening our measurements, so I avoid presenting early numbers as settled results."}`);
            break;
          case "team":
            lines.push("Caller: Who has chosen to work on this with you?");
            lines.push(`${respondent}: ${founder.latent.magnetism > 0.6 ? "A few very capable people joined because they care about the technical challenge and the customer problem." : "We have a small group of collaborators and are still learning which roles we need next."}`);
            break;
          case "release":
            lines.push("Caller: How do you decide when a release is ready?");
            lines.push(`${respondent}: ${founder.latent.velocity > 0.6 ? "We ship a narrow working change, listen to users, and keep improving it in short cycles." : "We prefer to finish a small set of dependable features before opening them up."}`);
            break;
        }
      }
      return lines.slice(0, 14).join("\n");
    },
  };
}

/** Adapters that expose the synthetic world through the normal source seam. */
export function createSimSources(world: SimWorld): SourceRegistry {
  const sourceLabels: Record<(typeof SOURCE_IDS)[number], string> = {
    hackernews: "Hacker News (simulated)",
    github: "GitHub (simulated)",
    arxiv: "arXiv (simulated)",
    people_data: "Professional profiles (simulated)",
  };
  const adapters = new Map<SourceId, SourceAdapter>();
  for (const id of SOURCE_IDS) {
    adapters.set(id, {
      id,
      status: async () => ({ configured: true, detail: "Simulated" }),
      fetch: async (request: SourceFetchRequest) => {
        const day = request.simDay ?? 0;
        return { items: world.itemsFor(id, day, request.limit), cursor: day };
      },
    });
  }
  const registry: SourceRegistry = {
    get: (id) => adapters.get(id) ?? null,
    statuses: async (): Promise<SourceStatus[]> => SOURCE_IDS.map((id) => ({
      id,
      label: sourceLabels[id],
      configured: true,
      detail: "Simulated",
    })),
  };
  return registry;
}

/** Repository seam for simulations; no repository is downloaded or written. */
export function createSimRepoFinder(world: SimWorld): RepoFinder {
  return {
    topRepos: async (_links, simId, limit) => simId === null
      ? []
      : world.repos(simId).slice(0, safeLimit(limit)).map(copyRepo),
    checkout: async (repo) => ({ repo: copyRepo(repo), cleanup: async () => undefined }),
  };
}
