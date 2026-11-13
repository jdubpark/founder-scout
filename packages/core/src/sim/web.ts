import { SIM_WEB_HOST, type PageLink } from "@agentswarm/shared";
import type { PageRead, SearchHit, SimCompany, SimFounder, SimWorld } from "../contracts";

const BASE_URL = `https://${SIM_WEB_HOST}`;
const PAGE_SIZE = 15;
const MIXED_LIMIT = 60;
const NOBODY_LINK_COUNT = 3;
const STOP_WORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with"]);

type GroundId = "strong-early" | "decent" | "later-stage" | "job-board" | "small-team" | "mixed";
type SimWeb = Pick<SimWorld, "page" | "search" | "engines" | "strongEarlyFounders">;

interface CreateSimWebOptions {
  seed: number;
  founders: readonly SimFounder[];
  company(simId: string): SimCompany | undefined;
}

interface Ground {
  id: GroundId;
  title: string;
  introduction: string;
  founders: readonly SimFounder[];
}

interface NobodyPage {
  id: string;
  title: string;
  text: string;
}

interface SearchDocument {
  url: string;
  title: string;
  snippet: string;
  founderIds?: string[];
  searchableWords: Set<string>;
  day: number;
}

const GROUND_META: ReadonlyArray<Pick<Ground, "id" | "title" | "introduction">> = [
  { id: "strong-early", title: "Strong early builders", introduction: "A selective list of pre-seed and seed teams with strong public work." },
  { id: "decent", title: "Decent early projects", introduction: "Early projects with a clear product and room to grow." },
  { id: "later-stage", title: "Later-stage companies", introduction: "Companies that have reached Series A and are further along." },
  { id: "job-board", title: "Small job board", introduction: "A sparse board where a few teams are looking for builders." },
  { id: "small-team", title: "Small teams", introduction: "A sparse collection of teams with very few people listed." },
  { id: "mixed", title: "Mixed project directory", introduction: "A cross-section of teams at different stages and with different kinds of work." },
];

const NOBODY_PAGES: readonly NobodyPage[] = [
  {
    id: "1",
    title: "A market question with no named founder",
    text: "This field note asks a general market question. It names no founder and describes no company: what changes when teams have to coordinate difficult work?",
  },
  {
    id: "2",
    title: "Roles at established teams",
    text: "A general board of open engineering roles at established teams. These listings are not about a startup founder or a new company.",
  },
  {
    id: "3",
    title: "A discussion about research tools",
    text: "People compare research tools and share notes about useful software. No founder or startup is identified in this discussion.",
  },
  {
    id: "4",
    title: "A general guide to product interviews",
    text: "A guide to asking clear questions in product interviews. It is not about a specific founder or company.",
  },
];

function stableHash(seed: number, scope: string, value: string): number {
  let hash = 0x811c9dc5;
  const input = `${seed}|sim-web|${scope}|${value}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededOrder(founders: readonly SimFounder[], seed: number, scope: string): SimFounder[] {
  return [...founders].sort((left, right) =>
    stableHash(seed, scope, left.simId) - stableHash(seed, scope, right.simId)
    || left.simId.localeCompare(right.simId),
  );
}

function tokenize(value: string): string[] {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
}

function safeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function safeDay(value: number): number {
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

function isVisible(founder: SimFounder, day: number): boolean {
  return founder.appearsOnDay <= day;
}

function projectUrl(founder: SimFounder): string {
  return `${BASE_URL}/p/${encodeURIComponent(founder.simId)}`;
}

function profileUrl(founder: SimFounder): string {
  return `${BASE_URL}/u/${encodeURIComponent(founder.simId)}`;
}

function groundUrl(id: GroundId, page: number): string {
  return `${BASE_URL}/g/${id}/${page}`;
}

function link(index: number, url: string, text: string): PageLink {
  return { index, url, text };
}

function makeRead(url: string, title: string, text: string, links: PageLink[], founderIds?: readonly string[]): PageRead {
  return {
    status: "ok",
    detail: "",
    url,
    title,
    text,
    links,
    ...(founderIds && founderIds.length > 0 ? { simFounderIds: [...new Set(founderIds)] } : {}),
  };
}

function founderSearchWords(founder: SimFounder, company: SimCompany): string {
  return `${founder.sector} ${company.name} ${company.oneLiner}`;
}

function balancedMix(founders: readonly SimFounder[], seed: number): SimFounder[] {
  const stages = ["pre-seed", "seed", "series A"];
  const byStage = stages.map((stage) => seededOrder(founders.filter((founder) => founder.stage === stage), seed, `mixed-${stage}`));
  const result: SimFounder[] = [];
  while (result.length < MIXED_LIMIT && byStage.some((group) => group.length > 0)) {
    for (const group of byStage) {
      const founder = group.shift();
      if (founder) result.push(founder);
      if (result.length >= MIXED_LIMIT) break;
    }
  }
  return result;
}

function makeGrounds(
  seed: number,
  founders: readonly SimFounder[],
  companyFor: (simId: string) => SimCompany | undefined,
): Ground[] {
  const early = founders.filter((founder) => founder.stage === "pre-seed" || founder.stage === "seed");
  const rankedEarly = [...early].sort((left, right) => right.quality - left.quality
    || stableHash(seed, "strong-early", left.simId) - stableHash(seed, "strong-early", right.simId));
  const strongCount = early.length === 0 ? 0 : Math.max(1, Math.ceil(early.length * 0.18));
  const decentStart = Math.floor(rankedEarly.length * 0.2);
  const decentEnd = Math.max(decentStart + 1, Math.ceil(rankedEarly.length * 0.68));
  const decent = rankedEarly.slice(decentStart, decentEnd);
  const jobBoardCount = founders.length === 0 ? 0 : 1 + (stableHash(seed, "job-board-count", "board") % 3);
  const smallPool = founders.filter((founder) => (companyFor(founder.simId)?.team.length ?? 0) <= 1);
  const eligibleSmall = smallPool.length > 0 ? smallPool : founders;
  const smallCount = eligibleSmall.length === 0
    ? 0
    : Math.min(10, Math.max(4, Math.ceil(eligibleSmall.length * 0.05)));
  const selections: Record<GroundId, SimFounder[]> = {
    "strong-early": rankedEarly.slice(0, strongCount),
    decent,
    "later-stage": seededOrder(founders.filter((founder) => founder.stage === "series A"), seed, "later-stage"),
    "job-board": seededOrder(founders, seed, "job-board").slice(0, jobBoardCount),
    "small-team": seededOrder(eligibleSmall, seed, "small-team").slice(0, smallCount),
    mixed: balancedMix(founders, seed),
  };
  return GROUND_META.map((metadata) => ({ ...metadata, founders: selections[metadata.id] }));
}

function progressForStage(stage: string): string {
  switch (stage) {
    case "series A": return "Scaling a product that is already in the market.";
    case "seed": return "Running an early product with initial users or customers.";
    default: return "Building the first product and testing it with prospective users.";
  }
}

function fundingForStage(stage: string): string {
  switch (stage) {
    case "series A": return "Funding: Closed a Series A.";
    case "seed": return "Funding: Raised a seed round.";
    default: return "Funding: The company has not raised money yet.";
  }
}

function projectPage(founder: SimFounder, company: SimCompany, founders: readonly SimFounder[], seed: number): PageRead {
  const links: PageLink[] = [link(0, profileUrl(founder), `Founder profile: ${founder.name}`)];
  // A page links only to projects that were there when it was written: ones that appeared no
  // later than its own. Otherwise a reader would follow links to pages that do not exist yet.
  const sameSector = founders.filter((candidate) =>
    candidate.simId !== founder.simId
      && candidate.sector === founder.sector
      && candidate.appearsOnDay <= founder.appearsOnDay);
  const related = seededOrder(sameSector, seed, `related-${founder.simId}`).slice(0, 3);
  for (const candidate of related) {
    links.push(link(links.length, projectUrl(candidate), `${candidate.companyName}: ${candidate.sector}`));
  }
  links.push(link(links.length, `${BASE_URL}/n/1`, "General market note"));
  const text = [
    `${company.name} was started by ${founder.name}, the founder.`,
    `Sector: ${company.sector}. ${fundingForStage(company.stage)}`,
    `Team size: ${company.team.length + 1}, including the founder.`,
    `Progress: ${progressForStage(company.stage)}`,
    `“${company.oneLiner}”`,
    company.mission,
  ].join("\n\n");
  return makeRead(projectUrl(founder), company.name, text, links, [founder.simId]);
}

function founderPage(founder: SimFounder, company: SimCompany): PageRead {
  const project = link(0, projectUrl(founder), `${company.name}, project`);
  const text = [
    `${founder.name} is building ${company.name} in ${founder.sector}. ${founder.headline}`,
    `Current stage: ${founder.stage}.`,
    `“${company.oneLiner}”`,
  ].join("\n\n");
  return makeRead(profileUrl(founder), founder.name, text, [project], [founder.simId]);
}

function listingPage(ground: Ground, pageNumber: number, day: number, companyFor: (simId: string) => SimCompany | undefined): PageRead | null {
  const visible = ground.founders.filter((founder) => isVisible(founder, day));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) return null;
  const start = (pageNumber - 1) * PAGE_SIZE;
  const entries = visible.slice(start, start + PAGE_SIZE);
  const links: PageLink[] = entries.map((founder, index) =>
    link(index, projectUrl(founder), `${companyFor(founder.simId)?.name ?? founder.companyName}: ${founder.name}`),
  );
  const nobodyLinks = NOBODY_PAGES.slice(0, NOBODY_LINK_COUNT).map((nobody, index) =>
    link(links.length + index, `${BASE_URL}/n/${nobody.id}`, nobody.title),
  );
  links.push(...nobodyLinks);
  if (pageNumber < pageCount) links.push(link(links.length, groundUrl(ground.id, pageNumber + 1), "Next page"));

  const entryText = entries.map((founder, index) =>
    `${index + 1}. ${companyFor(founder.simId)?.name ?? founder.companyName}: ${founder.name}\n“${companyFor(founder.simId)?.oneLiner ?? founder.companyOneLiner}”\nFunding stage: ${founder.stage}. Sector: ${founder.sector}.`,
  );
  const text = [ground.introduction, `Page ${pageNumber} of ${pageCount}.`, ...entryText].join("\n\n");
  return makeRead(groundUrl(ground.id, pageNumber), `${ground.title}, page ${pageNumber}`, text, links, entries.map((founder) => founder.simId));
}

function parsePath(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== SIM_WEB_HOST || url.username || url.password) return null;
    return url.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

function searchWords(value: string): Set<string> {
  return new Set(tokenize(value));
}

function documentForPage(
  page: PageRead,
  day: number,
  matchableText: string,
): SearchDocument {
  return {
    url: page.url,
    title: page.title,
    snippet: page.text.replace(/\s+/g, " ").slice(0, 240),
    ...(page.simFounderIds ? { founderIds: [...page.simFounderIds] } : {}),
    searchableWords: searchWords(matchableText),
    day,
  };
}

export function createSimWeb(options: CreateSimWebOptions): SimWeb {
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed) : 0;
  const founders = [...options.founders];
  const founderById = new Map(founders.map((founder) => [founder.simId, founder] as const));
  const companyCache = new Map<string, SimCompany | undefined>();
  const companyFor = (simId: string): SimCompany | undefined => {
    if (companyCache.has(simId)) return companyCache.get(simId);
    const company = options.company(simId);
    companyCache.set(simId, company);
    return company;
  };
  const grounds = makeGrounds(seed, founders, companyFor);
  const groundById = new Map(grounds.map((ground) => [ground.id, ground] as const));

  const page = (rawUrl: string, requestedDay: number): PageRead | null => {
    const path = parsePath(rawUrl);
    if (path === null) return null;
    const day = safeDay(requestedDay);

    const projectMatch = /^\/p\/([^/]+)$/.exec(path);
    if (projectMatch) {
      let simId: string;
      try {
        simId = decodeURIComponent(projectMatch[1]!);
      } catch {
        return null;
      }
      const founder = founderById.get(simId);
      const company = founder && isVisible(founder, day) ? companyFor(founder.simId) : undefined;
      return founder && company ? projectPage(founder, company, founders, seed) : null;
    }

    const profileMatch = /^\/u\/([^/]+)$/.exec(path);
    if (profileMatch) {
      let simId: string;
      try {
        simId = decodeURIComponent(profileMatch[1]!);
      } catch {
        return null;
      }
      const founder = founderById.get(simId);
      const company = founder && isVisible(founder, day) ? companyFor(founder.simId) : undefined;
      return founder && company ? founderPage(founder, company) : null;
    }

    const groundMatch = /^\/g\/([a-z-]+)\/(\d+)$/.exec(path);
    if (groundMatch) {
      const ground = groundById.get(groundMatch[1] as GroundId);
      if (!ground) return null;
      return listingPage(ground, Number(groundMatch[2]), day, companyFor);
    }

    const nobodyMatch = /^\/n\/(\d+)$/.exec(path);
    if (nobodyMatch) {
      const nobody = NOBODY_PAGES.find((candidate) => candidate.id === nobodyMatch[1]);
      return nobody ? makeRead(`${BASE_URL}${path}`, nobody.title, nobody.text, []) : null;
    }

    return null;
  };

  const search = (engine: string, query: string, requestedDay: number, limit: number): SearchHit[] => {
    if (engine !== "web" && engine !== "hn" && engine !== "github") return [];
    const maxResults = safeLimit(limit);
    if (maxResults === 0) return [];
    const queryWords = [...new Set(tokenize(query).filter((word) => !STOP_WORDS.has(word)))];
    if (queryWords.length === 0) return [];
    const day = safeDay(requestedDay);
    const source = engine === "hn" ? "hackernews" : engine === "github" ? "github" : null;
    const documents: SearchDocument[] = [];
    const projectDocuments: SearchDocument[] = [];

    for (const founder of founders) {
      if (!isVisible(founder, day) || (source && !founder.visibleIn.includes(source))) continue;
      const company = companyFor(founder.simId);
      if (!company) continue;
      const result = projectPage(founder, company, founders, seed);
      const document = documentForPage(result, founder.appearsOnDay, founderSearchWords(founder, company));
      documents.push(document);
      projectDocuments.push(document);
    }

    if (engine === "web") {
      for (const ground of grounds) {
        const visible = ground.founders.filter((founder) => isVisible(founder, day));
        const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          const result = listingPage(ground, pageNumber, day, companyFor);
          if (!result) continue;
          const ids = result.simFounderIds ?? [];
          const newestDay = ids.reduce((newest, simId) => Math.max(newest, founderById.get(simId)?.appearsOnDay ?? 0), 0);
          const segment = visible.slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE);
          const matchable = `${ground.title} ${ground.introduction} ${segment.map((founder) => {
            const company = companyFor(founder.simId);
            return company ? founderSearchWords(founder, company) : "";
          }).join(" ")}`;
          documents.push(documentForPage(result, newestDay, matchable));
        }
      }
      for (const nobody of NOBODY_PAGES) {
        const result = makeRead(`${BASE_URL}/n/${nobody.id}`, nobody.title, nobody.text, []);
        documents.push(documentForPage(result, 0, `${nobody.title} ${nobody.text}`));
      }
    }

    const exactMatches = documents.filter((document) => queryWords.every((word) => document.searchableWords.has(word)));
    const fuzzyMatches = documents.filter((document) => queryWords.some((word) => document.searchableWords.has(word)));
    const candidates = exactMatches.length > 0 ? exactMatches : fuzzyMatches.length > 0 ? fuzzyMatches : projectDocuments;
    candidates.sort((left, right) => right.day - left.day || left.url.localeCompare(right.url));
    return candidates.slice(0, maxResults).map((document) => ({
      url: document.url,
      title: document.title,
      snippet: document.snippet,
      ...(document.founderIds ? { simFounderIds: [...document.founderIds] } : {}),
    }));
  };

  const engines = () => [
    { id: "web", label: "Open web", searches: "Project pages, directories, and general pages" },
    { id: "hn", label: "Hacker News", searches: "Projects visible on Hacker News" },
    { id: "github", label: "GitHub", searches: "Projects visible on GitHub" },
  ];

  const strongEarlyFounders = (requestedDay: number) => {
    const day = safeDay(requestedDay);
    return (groundById.get("strong-early")?.founders ?? []).filter((founder) => isVisible(founder, day));
  };

  return { page, search, engines, strongEarlyFounders };
}
