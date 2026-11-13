import { cleanUrl, isOffLimitsHost, NEVER_FETCH_HOSTS, TERMS_BARRED_HOSTS } from "@agentswarm/shared";
import type { SearchEngine, SearchHit } from "../contracts";
import { createRecordAllowance, type RecordAllowance } from "./pdl";
import { defaultFetch, type FetchFn } from "./http";
import { asRecord, cleanPlain, normalizeLimit } from "./util";
import { boundedJson, type SearchOptions } from "./search";

export const LINKUP_SEARCH_API = "https://api.linkup.so/v1/search";
export const DEFAULT_LINKUP_SEARCHES_PER_DAY = 200;
const MAX_RESULTS = 100;

interface LinkupAllowance {
  allowance: RecordAllowance;
  perDay: number;
}

const allowances = new Map<string, LinkupAllowance>();
const EXCLUDED_DOMAINS = [...NEVER_FETCH_HOSTS, ...TERMS_BARRED_HOSTS.map(({ host }) => host)];

function allowanceFor(env: NodeJS.ProcessEnv, apiKey: string): LinkupAllowance {
  const existing = allowances.get(apiKey);
  if (existing) return existing;

  const setting = env.LINKUP_SEARCHES_PER_DAY?.trim();
  const configured = setting ? Number(setting) : DEFAULT_LINKUP_SEARCHES_PER_DAY;
  const perDay = Number.isFinite(configured) && configured >= 0
    ? Math.floor(configured)
    : DEFAULT_LINKUP_SEARCHES_PER_DAY;
  const result = { allowance: createRecordAllowance(perDay), perDay };
  allowances.set(apiKey, result);
  return result;
}

/** Keep off-limits results as safe pointers, while the reader continues to refuse them. */
function resultUrl(raw: string): string | null {
  const cleaned = cleanUrl(raw);
  if (cleaned) return cleaned;
  try {
    const url = new URL(raw.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    if (!isOffLimitsHost(url.hostname)) return null;
    url.hash = "";
    return url.href.length <= 500 ? url.href : null;
  } catch {
    return null;
  }
}

export function createLinkupSearchEngine(options: SearchOptions = {}): SearchEngine {
  const fetchFn: FetchFn = options.fetch ?? defaultFetch;
  const env = options.env ?? process.env;
  const apiKey = env.LINKUP_API_KEY?.trim() ?? "";
  const quota = apiKey ? allowanceFor(env, apiKey) : null;

  return {
    id: "web",
    label: "Web search (Linkup)",
    searches: "Takes plain words and quoted phrases; returns pages from the open web.",
    async status() {
      if (!apiKey || !quota) return { configured: false, detail: "LINKUP_API_KEY is not set." };
      if (quota.allowance.left() === 0) {
        return {
          configured: true,
          detail: "Today's LINKUP_SEARCHES_PER_DAY ceiling has been reached.",
        };
      }
      return {
        configured: true,
        detail: `LINKUP_API_KEY is set; ${quota.allowance.left()} of ${quota.perDay} searches remain today. Live service behavior is unverified.`,
      };
    },
    async search(query, limit, searchOptions) {
      const maxResults = Math.min(MAX_RESULTS, normalizeLimit(limit));
      if (!apiKey || !quota || maxResults === 0) return [];

      let granted: number;
      try {
        granted = quota.allowance.take(1);
      } catch {
        return [];
      }

      try {
        const body = await boundedJson(
          fetchFn,
          LINKUP_SEARCH_API,
          { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          {
            method: "POST",
            body: JSON.stringify({
              q: query,
              depth: "fast",
              outputType: "searchResults",
              maxResults,
              excludeDomains: EXCLUDED_DOMAINS,
            }),
            timeoutMs: options.timeoutMs,
            signal: searchOptions?.signal,
          },
        );
        const data = asRecord(body);
        if (!data || !Array.isArray(data.results)) return [];

        const hits: SearchHit[] = [];
        for (const raw of data.results) {
          const result = asRecord(raw);
          if (!result || typeof result.name !== "string" || typeof result.url !== "string") continue;
          const url = resultUrl(result.url);
          const title = cleanPlain(result.name, 300);
          if (!url || !title) continue;
          const snippet = typeof result.content === "string" ? cleanPlain(result.content, 300) : "";
          hits.push({ url, title, snippet });
          if (hits.length >= maxResults) break;
        }
        return hits;
      } catch {
        return [];
      } finally {
        // The ceiling protects the number of search attempts; unsuccessful calls return no hits.
        quota.allowance.used(1, granted);
      }
    },
  };
}
