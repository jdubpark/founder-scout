/**
 * Y Combinator: walks the public company directory through an open mirror of it
 * (yc-oss.github.io, no key) and each company's own public page, and emits one
 * raw item per founder named there, with the founder's own public links. Company
 * pages are read through the injected web reader, so robots.txt and per-host
 * spacing govern these reads like the hunt's; the mirror carries no founders,
 * only the list of companies, and is asked for at most once a day.
 */

import type { RawItem } from "@agentswarm/shared";
import type { SourceAdapter, SourceFetchRequest, SourceFetchResult, WebReader } from "../contracts";
import { batchTag } from "./past";
import { assertSuccessful, defaultFetch, httpGet, parseJson, type FetchFn } from "./http";
import { asRecord, cleanPlain, decodeEntities, normalizeLimit } from "./util";
import { createWebReader } from "./web";

const SOURCE = "Y Combinator";
const INDEX_URL = "https://yc-oss.github.io/api/companies/all.json";
const COMPANY_URL = "https://www.ycombinator.com/companies/";
const DAY_MS = 24 * 60 * 60 * 1_000;
/**
 * The mirror's whole-directory file is large and gzip is a fifth of it, and on a
 * slow route even that can take minutes. It is read at most once a day and a
 * failed read is retried by the next run, so the fetch is allowed to be patient.
 */
const INDEX_TIMEOUT_MS = 600_000;
/** A page that keeps failing is tried this many times, then never again. */
const MAX_FAILED_ATTEMPTS = 3;
const DESCRIPTION_CHARS = 800;
/** A founder's own bio, kept short: it is the page's strongest trajectory signal. */
const BIO_CHARS = 400;

export interface YcOptions {
  fetch?: FetchFn;
  reader?: WebReader;
  now?: () => number;
}

/** One company of the directory, reduced to what a founder item needs. */
interface YcCompany {
  slug: string;
  name: string;
  /** The intake as a launch title writes it, for example "W26". */
  tag: string;
  batch: string | null;
  oneLiner: string | null;
  longDescription: string | null;
  locations: string | null;
  teamSize: number | null;
  industry: string | null;
  launchedAt: number | null;
}

interface YcCursor {
  /** Company slugs never to read again. */
  done: string[];
  /** Failed read attempts per slug, for pages not yet given up on. */
  failed: Record<string, number>;
}

/** One founder as the company page names them. */
interface YcFounder {
  name: string | null;
  title: string | null;
  bio: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Winter, spring, summer and fall follow one another in a programme year, so a
// tag sorts chronologically as year * 4 + season.
const SEASON_RANK: Record<string, number> = { W: 0, X: 1, S: 2, F: 3 };

function batchSortKey(company: YcCompany): number {
  const year = Number(`20${company.tag.slice(1)}`);
  const rank = SEASON_RANK[company.tag[0] ?? ""] ?? 0;
  return (Number.isFinite(year) ? year : 0) * 4 + rank;
}

function parseIndex(data: unknown): YcCompany[] {
  if (!Array.isArray(data)) throw new Error("The Y Combinator company directory returned an unexpected response.");
  const companies: YcCompany[] = [];
  for (const raw of data) {
    const item = asRecord(raw);
    const slug = text(item?.slug);
    const tag = batchTag(item?.batch);
    if (!item || !slug || !tag) continue;
    companies.push({
      slug,
      name: text(item.name) ?? slug,
      tag,
      batch: text(item.batch),
      oneLiner: text(item.one_liner),
      longDescription: text(item.long_description),
      locations: text(item.all_locations),
      teamSize: typeof item.team_size === "number" && Number.isFinite(item.team_size) ? item.team_size : null,
      industry: text(item.industry),
      launchedAt: typeof item.launched_at === "number" && Number.isFinite(item.launched_at) ? item.launched_at : null,
    });
  }
  // Newest intake first, then slug, so the walk reaches recent companies early and
  // always in the same order.
  return companies.sort(
    (left, right) => batchSortKey(right) - batchSortKey(left) || left.slug.localeCompare(right.slug),
  );
}

function parseCursor(raw: unknown): YcCursor {
  const record = asRecord(raw);
  if (!record) return { done: [], failed: {} };
  const done = Array.isArray(record.done)
    ? record.done.filter((slug): slug is string => typeof slug === "string")
    : [];
  const failed: Record<string, number> = {};
  const failedRaw = asRecord(record.failed);
  if (failedRaw) {
    for (const [slug, count] of Object.entries(failedRaw)) {
      if (typeof count === "number" && Number.isFinite(count) && count > 0) failed[slug] = Math.floor(count);
    }
  }
  return { done, failed };
}

function founderName(item: Record<string, unknown>): string | null {
  const full = text(item.full_name) ?? text(item.name);
  if (full) return full;
  const parts = [text(item.first_name), text(item.last_name)].filter((part): part is string => part !== null);
  const joined = parts.join(" ").trim();
  return joined.length > 0 ? joined : null;
}

/**
 * A profile link the directory publishes with tracking parameters on it. A
 * profile address needs no query at all, so everything after the path goes.
 */
function profileLink(raw: string | null): string | null {
  if (raw === null) return null;
  const stripped = raw.split(/[?#]/u)[0] ?? raw;
  return stripped.length > 0 ? stripped : null;
}

function mapFounder(item: Record<string, unknown>): YcFounder {
  return {
    name: founderName(item),
    title: text(item.title),
    bio: text(item.founder_bio),
    linkedinUrl: profileLink(text(item.linkedin_url)),
    twitterUrl: profileLink(text(item.twitter_url)),
  };
}

/**
 * The founders sit inside a data blob the page embeds as HTML-escaped JSON. After
 * decoding, the slice from `"founders":[` to its matching `]` is valid JSON.
 * Returns the founders and where the array ends, or null when the blob moved or
 * does not parse, so the caller can fall back to the visible text.
 */
function parseFounders(decoded: string): { founders: YcFounder[]; end: number } | null {
  const anchor = /"founders":\s*\[/.exec(decoded);
  if (!anchor) return null;
  const open = anchor.index + anchor[0].length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < decoded.length; i += 1) {
    const char = decoded[i] ?? "";
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          const value: unknown = JSON.parse(decoded.slice(open, i + 1));
          if (!Array.isArray(value)) return null;
          return { founders: value.map((entry) => mapFounder(asRecord(entry) ?? {})), end: i + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * The page sometimes carries a contact email as a mailto: link. The founders' own
 * bios can hold personal ones, so the search starts after the founders array, and
 * only then takes the page's first.
 */
function contactEmail(decoded: string, after: number | null): string | null {
  const scope = after !== null ? decoded.slice(after) : decoded;
  const search = (text: string) => {
    const match = /mailto:([^\s"'<>)]+)/.exec(text);
    if (!match) return null;
    const email = (match[1] ?? "").replace(/[.,;:!?]+$/, "").trim();
    return email.length > 0 ? email : null;
  };
  return (after !== null ? search(scope) : null) ?? search(decoded);
}

function publishedAt(company: YcCompany): string | null {
  if (company.launchedAt === null) return null;
  const at = new Date(company.launchedAt * 1000);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

function itemTitle(company: YcCompany): string {
  return cleanPlain(
    `${company.name} (YC ${company.tag})${company.oneLiner ? ` — ${company.oneLiner}` : ""}`,
    300,
  );
}

function buildItem(
  company: YcCompany,
  pageUrl: string,
  founder: YcFounder,
  position: number,
  email: string | null,
): RawItem | null {
  if (!founder.name) return null;
  const lines = [
    founder.title ? `${founder.name} — ${founder.title} of ${company.name}` : `${founder.name} of ${company.name}`,
    founder.bio ? cleanPlain(founder.bio, BIO_CHARS) : null,
    company.oneLiner ? `One-liner: ${company.oneLiner}` : null,
    company.longDescription ? cleanPlain(company.longDescription, DESCRIPTION_CHARS) : null,
    company.locations ? `Location: ${company.locations}` : null,
    company.teamSize !== null ? `Team size: ${company.teamSize}` : null,
    company.industry ? `Industry: ${company.industry}` : null,
    founder.linkedinUrl ? `LinkedIn: ${founder.linkedinUrl}` : null,
    founder.twitterUrl ? `Twitter: ${founder.twitterUrl}` : null,
    email ? `Contact: ${email}` : null,
    company.batch ? `YC batch: ${company.batch}` : null,
  ].filter((line): line is string => line !== null && line.length > 0);
  return {
    ref: `${pageUrl}#founder-${position}`,
    source: "yc",
    title: itemTitle(company),
    text: lines.join("\n"),
    author: founder.name,
    authorUrl: founder.linkedinUrl ?? founder.twitterUrl ?? null,
    publishedAt: publishedAt(company),
    metrics: company.teamSize !== null ? { teamSize: company.teamSize } : {},
    simFounderId: null,
  };
}

/** When the founders blob cannot be read, the page's own text is still worth one item. */
function buildFallbackItem(company: YcCompany, pageUrl: string, pageText: string): RawItem {
  return {
    ref: pageUrl,
    source: "yc",
    title: itemTitle(company),
    text: cleanPlain(pageText),
    author: null,
    authorUrl: null,
    publishedAt: publishedAt(company),
    metrics: company.teamSize !== null ? { teamSize: company.teamSize } : {},
    simFounderId: null,
  };
}

export function createYcAdapter(options: YcOptions = {}): SourceAdapter {
  const fetchFn = options.fetch ?? defaultFetch;
  const reader = options.reader ?? createWebReader();
  const now = options.now ?? Date.now;
  let indexCache: { at: number; companies: YcCompany[] } | null = null;

  async function loadIndex(signal?: AbortSignal): Promise<YcCompany[]> {
    const nowMs = now();
    if (indexCache && nowMs - indexCache.at < DAY_MS) return indexCache.companies;
    const result = await httpGet(fetchFn, SOURCE, INDEX_URL, { signal, timeoutMs: INDEX_TIMEOUT_MS, headers: { "Accept-Encoding": "gzip" } });
    assertSuccessful(SOURCE, result, nowMs);
    const companies = parseIndex(parseJson(SOURCE, result.body));
    indexCache = { at: nowMs, companies };
    return companies;
  }

  return {
    id: "yc",

    async status() {
      return {
        configured: true,
        detail: "Public company directory and pages; no key needed.",
      };
    },

    async fetch(req: SourceFetchRequest): Promise<SourceFetchResult> {
      const limit = normalizeLimit(req.limit);
      const cursor = parseCursor(req.cursor);
      if (limit === 0) return { items: [], cursor };
      const companies = await loadIndex(req.signal);
      const done = new Set(cursor.done);
      const doneSlugs = [...cursor.done];
      const failed: Record<string, number> = { ...cursor.failed };
      const items: RawItem[] = [];
      for (const company of companies) {
        // A page's founders all arrive together, so the walk stops between pages.
        if (items.length >= limit) break;
        if (done.has(company.slug)) continue;
        const pageUrl = COMPANY_URL + company.slug;
        const page = await reader.read(pageUrl, { html: true, signal: req.signal });
        if (page.status !== "ok") {
          const attempts = (failed[company.slug] ?? 0) + 1;
          if (attempts >= MAX_FAILED_ATTEMPTS) {
            done.add(company.slug);
            doneSlugs.push(company.slug);
            delete failed[company.slug];
          } else {
            failed[company.slug] = attempts;
          }
          continue;
        }
        done.add(company.slug);
        doneSlugs.push(company.slug);
        delete failed[company.slug];
        const decoded = decodeEntities(page.html ?? "");
        const parsed = parseFounders(decoded);
        // A parsed array that names nobody is as useless as no array at all, so both
        // cases fall back to the page's own text.
        const founders = parsed?.founders.filter((founder) => founder.name !== null) ?? [];
        if (parsed === null || founders.length === 0) {
          items.push(buildFallbackItem(company, pageUrl, page.text));
          continue;
        }
        const email = contactEmail(decoded, parsed.end);
        for (const [index, founder] of founders.entries()) {
          const item = buildItem(company, pageUrl, founder, index + 1, email);
          if (item) items.push(item);
        }
      }
      return { items, cursor: { done: doneSlugs, failed } satisfies YcCursor };
    },
  };
}
