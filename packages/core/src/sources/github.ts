/**
 * GitHub: repositories created inside the window that are gaining stars
 * fastest. Uses the documented REST repository search endpoint.
 *
 * Search quotas (docs.github.com/en/rest/search/search): 10 requests per
 * minute unauthenticated, 30 per minute with a token. Core REST limits
 * (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
 * 60 per hour unauthenticated, 5,000 per hour with a token.
 */

import type { RawItem } from "@agentswarm/shared";
import type { SourceAdapter, SourceFetchRequest, SourceFetchResult } from "../contracts";
import {
  assertSuccessful,
  defaultFetch,
  httpGet,
  numericHeader,
  parseJson,
  SourceRateLimitError,
  type FetchFn,
} from "./http";
import { asRecord, cleanPlain, cleanQueryTerm, normalizeLimit, windowStartMs } from "./util";

const SOURCE = "GitHub";
export const GITHUB_SEARCH_URL = "https://api.github.com/search/repositories";
export const GITHUB_API_ORIGIN = "https://api.github.com";
/** A repository needs at least this many stars to be considered. */
export const GITHUB_MIN_STARS = 20;
const MAX_PER_PAGE = 100;
const SEEN_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface GitHubOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: FetchFn;
  now?: () => number;
}

export interface GitHubRepo {
  fullName: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  createdAt: string;
  pushedAt: string | null;
  archived: boolean;
  fork: boolean;
  disabled: boolean;
  isPrivate: boolean;
  ownerLogin: string;
  ownerUrl: string;
  ownerType: string;
}

interface SeenCursor {
  seen: string[];
}

export function readGitHubToken(env: NodeJS.ProcessEnv): string | null {
  const token = env.GITHUB_TOKEN?.trim();
  return token ? token : null;
}

export function githubHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** GitHub accepts timestamps as `YYYY-MM-DDTHH:MM:SS+00:00` in qualifiers. */
function githubTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function buildGitHubSearchQuery(options: { createdAfterMs: number; beat: string | null }): string {
  const terms = [
    `created:>=${githubTimestamp(options.createdAfterMs)}`,
    `stars:>=${GITHUB_MIN_STARS}`,
    "fork:false",
    "archived:false",
  ];
  if (options.beat) terms.push(`"${options.beat}"`);
  return terms.join(" ");
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`GitHub returned a repository without ${key}.`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`GitHub returned a repository without a numeric ${key}.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

/** Validates one repository object from the REST API. Throws rather than guessing at core fields. */
export function parseGitHubRepo(raw: unknown): GitHubRepo {
  const repo = asRecord(raw);
  const owner = repo ? asRecord(repo.owner) : null;
  if (!repo || !owner) throw new Error("GitHub returned a malformed repository.");
  const topics = Array.isArray(repo.topics) ? repo.topics.filter((t): t is string => typeof t === "string") : [];
  return {
    fullName: requiredString(repo, "full_name"),
    htmlUrl: requiredString(repo, "html_url"),
    description: optionalString(repo, "description"),
    language: optionalString(repo, "language"),
    topics,
    stars: requiredNumber(repo, "stargazers_count"),
    forks: requiredNumber(repo, "forks_count"),
    createdAt: requiredString(repo, "created_at"),
    pushedAt: optionalString(repo, "pushed_at"),
    archived: repo.archived === true,
    fork: repo.fork === true,
    disabled: repo.disabled === true,
    isPrivate: repo.private === true,
    ownerLogin: requiredString(owner, "login"),
    ownerUrl: requiredString(owner, "html_url"),
    ownerType: typeof owner.type === "string" ? owner.type : "unknown",
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toRawItem(repo: GitHubRepo, nowMs: number): RawItem {
  const createdMs = Date.parse(repo.createdAt);
  const ageDays = Math.max(0, (nowMs - createdMs) / DAY_MS);
  const starsPerDay = repo.stars / Math.max(ageDays, 1);
  return {
    ref: repo.htmlUrl,
    source: "github",
    title: repo.fullName,
    text: [
      `Description: ${cleanPlain(repo.description ?? "", 1000) || "none"}`,
      `Topics: ${repo.topics.length > 0 ? repo.topics.join(", ") : "none"}`,
      `Primary language: ${repo.language ?? "unknown"}`,
      `Owner type: ${repo.ownerType}`,
    ].join("\n"),
    author: repo.ownerLogin,
    authorUrl: repo.ownerUrl,
    publishedAt: repo.createdAt,
    metrics: {
      stars: repo.stars,
      forks: repo.forks,
      ageDays: round2(ageDays),
      starsPerDay: round2(starsPerDay),
    },
    simFounderId: null,
  };
}

export function createGitHubAdapter(options: GitHubOptions = {}): SourceAdapter {
  const env = options.env ?? process.env;
  const token = readGitHubToken(env);
  const fetchFn = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  /** Last values seen on search responses, read from the rate-limit headers. */
  const lastSearch: { remaining: number | null; limit: number | null; resetAtMs: number | null } = {
    remaining: null,
    limit: null,
    resetAtMs: null,
  };

  return {
    id: "github",

    async status() {
      const base = token
        ? "GITHUB_TOKEN is in use: search allows 30 requests per minute and REST 5,000 per hour."
        : "No GITHUB_TOKEN set: unauthenticated search allows 10 requests per minute and REST 60 per hour. Set GITHUB_TOKEN for higher limits.";
      const last =
        lastSearch.remaining !== null && lastSearch.limit !== null
          ? ` Last search response: ${lastSearch.remaining} of ${lastSearch.limit} requests left in this minute.`
          : "";
      return { configured: true, detail: base + last };
    },

    async fetch(req: SourceFetchRequest): Promise<SourceFetchResult> {
      const limit = normalizeLimit(req.limit);
      const cursor = parseSeenCursor(req.cursor);
      const nowMs = now();
      if (limit === 0) return { items: [], cursor };

      if (
        lastSearch.remaining === 0 &&
        lastSearch.resetAtMs !== null &&
        lastSearch.resetAtMs > nowMs
      ) {
        throw new SourceRateLimitError(SOURCE, new Date(lastSearch.resetAtMs));
      }

      const startMs = windowStartMs(req.since, nowMs);
      const seen = new Set(cursor?.seen ?? []);
      // Sorted by stars, so skipped repositories push the new ones down the list. Ask for enough to cover them.
      const perPage = Math.min(MAX_PER_PAGE, limit + seen.size);
      const params = new URLSearchParams({
        q: buildGitHubSearchQuery({ createdAfterMs: startMs, beat: cleanQueryTerm(req.beat) }),
        sort: "stars",
        order: "desc",
        per_page: String(perPage),
      });
      const res = await httpGet(fetchFn, SOURCE, `${GITHUB_SEARCH_URL}?${params.toString()}`, {
        headers: githubHeaders(token),
        signal: req.signal,
      });
      recordSearchRate(res.headers, lastSearch);
      assertSuccessful(SOURCE, res, nowMs);

      const data = asRecord(parseJson(SOURCE, res.body));
      if (!data || !Array.isArray(data.items)) {
        throw new Error("GitHub returned an unexpected search response.");
      }
      const repos = data.items.map(parseGitHubRepo);
      const fresh = repos
        .filter(
          (repo) =>
            !repo.fork &&
            !repo.archived &&
            !repo.disabled &&
            !repo.isPrivate &&
            Date.parse(repo.createdAt) >= startMs &&
            !seen.has(repo.fullName),
        )
        .slice(0, limit);

      const nextSeen = [...seen, ...fresh.map((repo) => repo.fullName)].slice(-SEEN_LIMIT);
      return {
        items: fresh.map((repo) => toRawItem(repo, nowMs)),
        cursor: { seen: nextSeen } satisfies SeenCursor,
      };
    },
  };
}

function parseSeenCursor(raw: unknown): SeenCursor | null {
  const record = asRecord(raw);
  if (!record || !Array.isArray(record.seen) || !record.seen.every((n) => typeof n === "string")) return null;
  return { seen: [...(record.seen as string[])] };
}

function recordSearchRate(
  headers: Headers,
  state: { remaining: number | null; limit: number | null; resetAtMs: number | null },
): void {
  if (headers.get("x-ratelimit-resource") !== "search") return;
  const remaining = numericHeader(headers, "x-ratelimit-remaining");
  const limit = numericHeader(headers, "x-ratelimit-limit");
  const reset = numericHeader(headers, "x-ratelimit-reset");
  if (remaining !== null) state.remaining = remaining;
  if (limit !== null) state.limit = limit;
  if (reset !== null) state.resetAtMs = reset * 1000;
}
