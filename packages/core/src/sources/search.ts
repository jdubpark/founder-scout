import { cleanUrl } from "@agentswarm/shared";
import type { SearchEngine, SearchHit } from "../contracts";
import { defaultFetch, type FetchFn } from "./http";
import { asRecord, cleanPlain, cleanText, normalizeLimit } from "./util";

export const HN_SEARCH_API = "https://hn.algolia.com/api/v1/search_by_date";
export const GITHUB_REPOSITORY_SEARCH_API = "https://api.github.com/search/repositories";
export const HUGGING_FACE_API = "https://huggingface.co/api";
const DEFAULT_USER_AGENT = "web-reader/1.0";
const SEARCH_LIMIT = 100;

export interface SearchOptions {
  fetch?: FetchFn;
  env?: NodeJS.ProcessEnv;
  /** The longest one search may take, start to finish. */
  timeoutMs?: number;
}

const SEARCH_TIMEOUT_MS = 15_000;
const MAX_SEARCH_BYTES = 2_000_000;

/**
 * One search request with an end: a deadline for the whole answer and a ceiling on its size.
 * A search engine is someone else's server; one that drips its answer, or sends a huge one,
 * would otherwise hold a wave open for as long as it liked. null for anything but a complete
 * JSON answer within both limits.
 */
async function boundedJson(fetchFn: FetchFn, url: string, headers: Record<string, string>, options: { timeoutMs?: number; signal?: AbortSignal }): Promise<unknown | null> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? SEARCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  const response = await fetchFn(url, { method: "GET", headers, signal });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // The deadline must end a read that is waiting, not only the next one to start: a body that
  // has gone quiet never returns from read() by itself.
  const stopped = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(new Error("stopped"));
    else signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
  });
  stopped.catch(() => undefined);
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SEARCH_BYTES) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

export function createHnSearchEngine(options: SearchOptions = {}): SearchEngine {
  const fetchFn = options.fetch ?? defaultFetch;
  return {
    id: "hn",
    label: "Hacker News",
    searches: "Newest Hacker News stories, including Show HN and Launch HN.",
    async status() {
      return { configured: true, detail: "Public Algolia search API. No key needed." };
    },
    async search(query, limit, searchOptions) {
      const count = clampLimit(limit);
      if (count === 0) return [];
      const params = new URLSearchParams({ query, tags: "story", hitsPerPage: String(count) });
      try {
        const body = await boundedJson(fetchFn, `${HN_SEARCH_API}?${params.toString()}`, { Accept: "application/json" }, { timeoutMs: options.timeoutMs, signal: searchOptions?.signal });
        const data = asRecord(body);
        if (!data || !Array.isArray(data.hits)) return [];
        const hits: SearchHit[] = [];
        for (const raw of data.hits) {
          const hit = asRecord(raw);
          if (!hit || typeof hit.objectID !== "string" || !/^\d+$/u.test(hit.objectID)) continue;
          const title = typeof hit.title === "string" ? cleanPlain(hit.title, 300) : "";
          if (!title) continue;
          const itemUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
          const url = typeof hit.url === "string" && hit.url.trim() ? hit.url.trim() : itemUrl;
          const storyText = typeof hit.story_text === "string" ? cleanText(hit.story_text, 300) : "";
          const author = typeof hit.author === "string" ? hit.author.trim() : "";
          const points = typeof hit.points === "number" && Number.isFinite(hit.points) ? hit.points : 0;
          hits.push({ url, title, snippet: storyText || [author, `${points} points`].filter(Boolean).join(" · ").slice(0, 300) });
          if (hits.length >= count) break;
        }
        return hits;
      } catch {
        return [];
      }
    },
  };
}

export function createGitHubSearchEngine(options: SearchOptions = {}): SearchEngine {
  const fetchFn = options.fetch ?? defaultFetch;
  const env = options.env ?? process.env;
  const token = env.GITHUB_TOKEN?.trim() || null;
  return {
    id: "github",
    label: "GitHub repositories",
    searches: "GitHub repositories matching search syntax, sorted by stars.",
    async status() {
      // It works either way, so it is usable either way. The token only raises the rate.
      return {
        configured: true,
        detail: token
          ? "GITHUB_TOKEN is set; repository search uses the authenticated rate limit."
          : "No GITHUB_TOKEN set; repository search works without one at about ten searches a minute.",
      };
    },
    async search(query, limit, searchOptions) {
      const count = clampLimit(limit);
      if (count === 0) return [];
      const params = new URLSearchParams({ q: query, sort: "stars", order: "desc", per_page: String(count) });
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": env.HUNT_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      try {
        const body = await boundedJson(fetchFn, `${GITHUB_REPOSITORY_SEARCH_API}?${params.toString()}`, headers, { timeoutMs: options.timeoutMs, signal: searchOptions?.signal });
        const data = asRecord(body);
        if (!data || !Array.isArray(data.items)) return [];
        const hits: SearchHit[] = [];
        for (const raw of data.items) {
          const repo = asRecord(raw);
          if (!repo || typeof repo.full_name !== "string" || typeof repo.html_url !== "string") continue;
          const stars = typeof repo.stargazers_count === "number" && Number.isFinite(repo.stargazers_count)
            ? repo.stargazers_count
            : 0;
          const createdAt = typeof repo.created_at === "string" ? repo.created_at.slice(0, 10) : "unknown date";
          const description = typeof repo.description === "string" && repo.description.trim()
            ? cleanPlain(repo.description, 240)
            : "No description";
          hits.push({
            url: cleanUrl(repo.html_url) ?? repo.html_url,
            title: repo.full_name,
            snippet: `${description} · ${stars} stars · Created ${createdAt}`,
          });
          if (hits.length >= count) break;
        }
        return hits;
      } catch {
        return [];
      }
    },
  };
}

/**
 * New models and demo spaces on the Hugging Face Hub, through its public API. No key. The
 * newest listings are mostly empty, so anything that has been liked or downloaded comes first
 * and the rest follow, newest first.
 */
export function createHuggingFaceSearchEngine(options: SearchOptions = {}): SearchEngine {
  const fetchFn = options.fetch ?? defaultFetch;
  const env = options.env ?? process.env;
  const list = async (kind: "models" | "spaces", query: string, count: number, signal?: AbortSignal): Promise<Array<SearchHit & { traction: number; createdAt: string }>> => {
    const params = new URLSearchParams({ search: query, sort: "createdAt", direction: "-1", limit: String(count) });
    const body = await boundedJson(
      fetchFn,
      `${HUGGING_FACE_API}/${kind}?${params.toString()}`,
      { Accept: "application/json", "User-Agent": env.HUNT_USER_AGENT?.trim() || DEFAULT_USER_AGENT },
      { timeoutMs: options.timeoutMs, signal },
    );
    if (!Array.isArray(body)) return [];
    const found: Array<SearchHit & { traction: number; createdAt: string }> = [];
    for (const raw of body) {
      const entry = asRecord(raw);
      if (!entry || typeof entry.id !== "string" || !/^[\w.-]+\/[\w.-]+$/u.test(entry.id) || entry.private === true) continue;
      const likes = typeof entry.likes === "number" && Number.isFinite(entry.likes) ? entry.likes : 0;
      const downloads = typeof entry.downloads === "number" && Number.isFinite(entry.downloads) ? entry.downloads : 0;
      const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : "";
      const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 6) : [];
      const url = cleanUrl(`https://huggingface.co/${kind === "spaces" ? "spaces/" : ""}${entry.id}`);
      if (!url) continue;
      const facts = [
        kind === "spaces" ? "Demo space" : "Model",
        `${likes} likes`,
        kind === "models" ? `${downloads} downloads` : null,
        createdAt ? `Created ${createdAt.slice(0, 10)}` : null,
        tags.length ? cleanPlain(tags.join(", "), 120) : null,
      ].filter(Boolean);
      found.push({ url, title: entry.id, snippet: facts.join(" · "), traction: likes * 10 + downloads, createdAt });
    }
    return found;
  };
  return {
    id: "huggingface",
    label: "Hugging Face Hub",
    searches: "New models and demo spaces on the Hugging Face Hub whose name matches the words, newest first.",
    async status() {
      return { configured: true, detail: "Public Hub API. No key needed." };
    },
    async search(query, limit, searchOptions) {
      const count = clampLimit(limit);
      if (count === 0) return [];
      try {
        const [models, spaces] = await Promise.all([
          list("models", query, Math.min(SEARCH_LIMIT, count * 3), searchOptions?.signal),
          list("spaces", query, Math.min(SEARCH_LIMIT, count * 3), searchOptions?.signal),
        ]);
        return [...models, ...spaces]
          .sort((a, b) => Number(b.traction > 0) - Number(a.traction > 0) || b.createdAt.localeCompare(a.createdAt))
          .slice(0, count)
          .map(({ url, title, snippet }) => ({ url, title, snippet }));
      } catch {
        return [];
      }
    },
  };
}

function clampLimit(limit: number): number {
  return Math.min(SEARCH_LIMIT, normalizeLimit(limit));
}
