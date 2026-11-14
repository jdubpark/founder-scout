/**
 * arXiv: recent submissions in startup-relevant computer-science categories,
 * from the arXiv API (https://info.arxiv.org/help/api/user-manual.html).
 *
 * The API returns Atom XML. The parser below handles only the elements this
 * adapter reads. Requests follow the arXiv terms of use
 * (https://info.arxiv.org/help/api/tou.html): one request every three seconds,
 * over a single connection at a time.
 */

import type { RawItem } from "@agentswarm/shared";
import type { SourceAdapter, SourceFetchRequest, SourceFetchResult } from "../contracts";
import { assertSuccessful, defaultFetch, httpGet, type FetchFn } from "./http";
import {
  advanceCursor,
  cleanPlain,
  cleanQueryTerm,
  decodeEntities,
  isAfterCursor,
  normalizeLimit,
  parseTimeCursor,
  windowStartMs,
} from "./util";

const SOURCE = "arXiv";
export const ARXIV_API_URL = "https://export.arxiv.org/api/query";
const ARXIV_CATEGORIES = ["cs.AI", "cs.LG", "cs.CL", "cs.RO", "cs.DC", "cs.CR", "cs.SE"] as const;
const ARXIV_MIN_INTERVAL_MS = 3000;
const MAX_RESULTS = 100;

export interface ArxivOptions {
  fetch?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  authors: string[];
  categories: string[];
  pdfUrl: string | null;
}

/** arXiv date filters use GMT, in the form YYYYMMDDHHMM. */
function formatArxivDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  );
}

function buildArxivQuery(options: { fromMs: number; toMs: number; beat: string | null }): string {
  const categories = ARXIV_CATEGORIES.map((c) => `cat:${c}`).join(" OR ");
  let query = `(${categories}) AND submittedDate:[${formatArxivDate(options.fromMs)} TO ${formatArxivDate(options.toMs)}]`;
  if (options.beat) query += ` AND all:"${options.beat}"`;
  return query;
}

/** Strips CDATA wrappers, decodes entities and collapses whitespace, including across line breaks. */
function plainXmlText(raw: string): string {
  const unwrapped = raw.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return decodeEntities(unwrapped).replace(/\s+/g, " ").trim();
}

function elementText(block: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  return match ? plainXmlText(match[1] ?? "") : "";
}

function attribute(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`).exec(attrs);
  return match ? decodeEntities(match[2] ?? "") : null;
}

/**
 * Parses an arXiv Atom feed into entries, in document order. Throws on a
 * non-feed body or an arXiv error entry, so the caller never sees a partial result.
 */
function parseArxivFeed(xml: string): ArxivEntry[] {
  if (!/<feed[\s>]/.test(xml)) {
    throw new Error("arXiv returned a response that is not an Atom feed.");
  }
  const entries: ArxivEntry[] = [];
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const block = match[1] ?? "";
    const id = elementText(block, "id");
    if (!id) throw new Error("arXiv returned an entry without an id.");
    if (id.includes("/api/errors")) {
      throw new Error(`arXiv API error: ${elementText(block, "summary") || "unknown error"}`);
    }

    const authors: string[] = [];
    for (const author of block.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/g)) {
      const name = elementText(author[1] ?? "", "name");
      if (name) authors.push(name);
    }

    const categories: string[] = [];
    for (const category of block.matchAll(/<category\b([^>]*)\/?>/g)) {
      const term = attribute(category[1] ?? "", "term");
      if (term) categories.push(term);
    }

    let pdfUrl: string | null = null;
    for (const link of block.matchAll(/<link\b([^>]*)\/?>/g)) {
      const attrs = link[1] ?? "";
      if (attribute(attrs, "title") === "pdf" || attribute(attrs, "type") === "application/pdf") {
        pdfUrl = attribute(attrs, "href");
        break;
      }
    }

    entries.push({
      id,
      title: elementText(block, "title"),
      summary: elementText(block, "summary"),
      published: elementText(block, "published"),
      authors,
      categories,
      pdfUrl,
    });
  }
  return entries;
}

/** The arXiv identifier without its version suffix, so v2 of a paper is recognised as the same paper. */
function baseId(id: string): string {
  return id.replace(/v\d+$/, "");
}

/** The API returns entry ids as http:// links to arxiv.org. The site serves them over https. */
function secureLink(id: string): string {
  return id.replace(/^http:\/\/(?=(?:export\.)?arxiv\.org\/)/i, "https://");
}

export function toRawItem(entry: ArxivEntry): RawItem {
  // Authors come first so a long abstract cannot push them out of the trimmed text.
  const text = [
    `Authors: ${entry.authors.join(", ") || "unknown"}`,
    `Categories: ${entry.categories.join(", ") || "unknown"}`,
    "",
    entry.summary,
  ].join("\n");
  return {
    ref: secureLink(entry.id),
    source: "arxiv",
    title: cleanPlain(entry.title, 300),
    text: cleanPlain(text),
    author: entry.authors[0] ?? null,
    authorUrl: null,
    publishedAt: entry.published || null,
    metrics: { authors: entry.authors.length },
    simFounderId: null,
  };
}

/** Runs tasks one at a time, starting each at least `minGapMs` after the previous start. */
export function createSerialGate(
  minGapMs: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): <T>(task: () => Promise<T>) => Promise<T> {
  let chain: Promise<void> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = lastStart + minGapMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      return task();
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createArxivAdapter(options: ArxivOptions = {}): SourceAdapter {
  const fetchFn = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  const gate = createSerialGate(ARXIV_MIN_INTERVAL_MS, now, options.sleep ?? defaultSleep);

  return {
    id: "arxiv",

    async status() {
      return {
        configured: true,
        detail: `Public arXiv API, categories ${ARXIV_CATEGORIES.join(", ")}. One request every three seconds on one connection.`,
      };
    },

    async fetch(req: SourceFetchRequest): Promise<SourceFetchResult> {
      const limit = normalizeLimit(req.limit);
      const cursor = parseTimeCursor(req.cursor);
      const nowMs = now();
      const startMs = cursor ? cursor.after : windowStartMs(req.since, nowMs);
      if (limit === 0) return { items: [], cursor };

      const params = new URLSearchParams({
        search_query: buildArxivQuery({ fromMs: startMs, toMs: nowMs, beat: cleanQueryTerm(req.beat) }),
        sortBy: "submittedDate",
        sortOrder: "descending",
        start: "0",
        max_results: String(Math.min(MAX_RESULTS, limit + (cursor?.ids.length ?? 0))),
      });
      const res = await gate(() =>
        httpGet(fetchFn, SOURCE, `${ARXIV_API_URL}?${params.toString()}`, { signal: req.signal }),
      );
      assertSuccessful(SOURCE, res, nowMs);

      const fresh = parseArxivFeed(res.body)
        .map((entry) => ({ entry, key: baseId(entry.id), timeMs: Date.parse(entry.published) }))
        .filter((item) => Number.isFinite(item.timeMs))
        .filter((item) => (cursor ? true : item.timeMs >= startMs) && isAfterCursor(cursor, item.timeMs, item.key))
        .sort((a, b) => b.timeMs - a.timeMs || a.key.localeCompare(b.key))
        .slice(0, limit);

      return {
        items: fresh.map((item) => toRawItem(item.entry)),
        cursor: advanceCursor(
          cursor,
          fresh.map((item) => ({ key: item.key, timeMs: item.timeMs })),
        ),
      };
    },
  };
}
