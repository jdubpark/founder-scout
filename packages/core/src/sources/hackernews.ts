/**
 * Hacker News: new Show HN and Launch HN posts through the Algolia search API
 * documented at https://hn.algolia.com/api. Unauthenticated, no key.
 */

import type { RawItem } from "@agentswarm/shared";
import type { SourceAdapter, SourceFetchRequest, SourceFetchResult } from "../contracts";
import { assertSuccessful, defaultFetch, httpGet, parseJson, type FetchFn } from "./http";
import {
  advanceCursor,
  asRecord,
  cleanPlain,
  cleanQueryTerm,
  cleanText,
  isAfterCursor,
  normalizeLimit,
  parseTimeCursor,
  windowStartMs,
} from "./util";

const SOURCE = "Hacker News";
export const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date";
/** Tags of the two post types. Each is queried on its own, because the OR syntax is not reliable in the URL. */
export const HN_TAGS = ["show_hn", "launch_hn"] as const;
const MAX_HITS_PER_PAGE = 100;

export interface HackerNewsOptions {
  fetch?: FetchFn;
  now?: () => number;
}

interface HnHit {
  objectID: string;
  timeMs: number;
  createdAt: string | null;
  title: string;
  url: string | null;
  author: string | null;
  points: number;
  comments: number;
  storyText: string;
}

export function buildHnSearchUrl(
  tag: string,
  options: { sinceSec: number; beat: string | null; hitsPerPage: number },
): string {
  const params = new URLSearchParams({
    tags: tag,
    numericFilters: `created_at_i>=${options.sinceSec}`,
    hitsPerPage: String(options.hitsPerPage),
  });
  if (options.beat) params.set("query", options.beat);
  return `${HN_SEARCH_URL}?${params.toString()}`;
}

function parseHits(body: string): HnHit[] {
  const data = asRecord(parseJson(SOURCE, body));
  if (!data || !Array.isArray(data.hits)) {
    throw new Error("Hacker News returned an unexpected response.");
  }
  const hits: HnHit[] = [];
  for (const raw of data.hits) {
    const hit = asRecord(raw);
    if (!hit || typeof hit.objectID !== "string" || typeof hit.created_at_i !== "number") continue;
    hits.push({
      objectID: hit.objectID,
      timeMs: hit.created_at_i * 1000,
      createdAt: typeof hit.created_at === "string" ? hit.created_at : null,
      title: typeof hit.title === "string" ? hit.title : "",
      url: typeof hit.url === "string" && hit.url.length > 0 ? hit.url : null,
      author: typeof hit.author === "string" && hit.author.length > 0 ? hit.author : null,
      points: typeof hit.points === "number" ? hit.points : 0,
      comments: typeof hit.num_comments === "number" ? hit.num_comments : 0,
      storyText: typeof hit.story_text === "string" ? hit.story_text : "",
    });
  }
  return hits;
}

function toRawItem(hit: HnHit): RawItem {
  const title = cleanPlain(hit.title, 300);
  const body = cleanText(hit.storyText);
  const parts = [body, hit.url ? `Link: ${hit.url.trim()}` : null].filter(
    (part): part is string => part !== null && part.length > 0,
  );
  return {
    ref: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    source: "hackernews",
    title,
    text: parts.length > 0 ? parts.join("\n\n") : title,
    author: hit.author,
    authorUrl: hit.author ? `https://news.ycombinator.com/user?id=${encodeURIComponent(hit.author)}` : null,
    publishedAt: hit.createdAt,
    metrics: { points: hit.points, comments: hit.comments },
    simFounderId: null,
  };
}

export function createHackerNewsAdapter(options: HackerNewsOptions = {}): SourceAdapter {
  const fetchFn = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;

  return {
    id: "hackernews",

    async status() {
      return {
        configured: true,
        detail: "Public Algolia search API for Show HN and Launch HN posts. No key needed.",
      };
    },

    async fetch(req: SourceFetchRequest): Promise<SourceFetchResult> {
      const limit = normalizeLimit(req.limit);
      const cursor = parseTimeCursor(req.cursor);
      const nowMs = now();
      const startMs = cursor ? cursor.after : windowStartMs(req.since, nowMs);
      if (limit === 0) return { items: [], cursor };

      const beat = cleanQueryTerm(req.beat);
      const hitsPerPage = Math.min(MAX_HITS_PER_PAGE, limit + (cursor?.ids.length ?? 0));
      const byId = new Map<string, HnHit>();
      for (const tag of HN_TAGS) {
        const url = buildHnSearchUrl(tag, {
          sinceSec: Math.floor(startMs / 1000),
          beat,
          hitsPerPage,
        });
        const res = await httpGet(fetchFn, SOURCE, url, { signal: req.signal });
        assertSuccessful(SOURCE, res, nowMs);
        for (const hit of parseHits(res.body)) byId.set(hit.objectID, hit);
      }

      const fresh = [...byId.values()]
        .filter((hit) => (cursor ? true : hit.timeMs >= startMs) && isAfterCursor(cursor, hit.timeMs, hit.objectID))
        .sort((a, b) => b.timeMs - a.timeMs || b.objectID.localeCompare(a.objectID))
        .slice(0, limit);

      return {
        items: fresh.map(toRawItem),
        cursor: advanceCursor(
          cursor,
          fresh.map((hit) => ({ key: hit.objectID, timeMs: hit.timeMs })),
        ),
      };
    },
  };
}
