import { cleanUrl } from "@agentswarm/shared";
import type { SearchEngine, SearchHit } from "../contracts";
import { defaultFetch, type FetchFn } from "./http";
import { asRecord, cleanPlain, normalizeLimit } from "./util";
import { DEFAULT_GAP_MS, readerIdentity } from "./web";

const REQUEST_TIMEOUT_MS = 20_000;

const YC_META_URL = "https://yc-oss.github.io/api/meta.json";
const SPEEDRUN_URL = "https://speedrun.a16z.com/companies";
const FIVE_HUNDRED_URL = "https://500.co/api/startups";
const SKYDECK_URL = "https://skydeck.berkeley.edu/wp-admin/admin-ajax.php";
const SKYDECK_BODY = "action=company_filtration_query&meta[0][]=main_industry&meta[0][]=all&meta[1][]=classes&meta[1][]=all&meta[2][]=industry&meta[2][]=all&search=";
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FIVE_HUNDRED_WINDOW_MS = 540 * 24 * 60 * 60 * 1000;
const SEARCH_LIMIT = 100;

type Programme = "yc" | "speedrun" | "fiveHundred" | "skydeck";

interface AcceleratorHit extends SearchHit {
  programme: Programme;
  searchable: string[];
}

interface CacheEntry {
  expiresAt: number;
  promise: Promise<AcceleratorHit[]>;
  requestSignal: AbortSignal;
}

export interface AcceleratorSearchOptions {
  fetch?: FetchFn;
  /** How the engine names itself to a directory; the page reader's own name when unset. */
  userAgent?: string;
  /** The longest one search may take, start to finish. */
  timeoutMs?: number;
  /** Injectable clock in epoch milliseconds. */
  now?: () => number;
  /** Injectable wait between two requests to one host. */
  sleep?: (milliseconds: number) => Promise<void>;
}

interface BatchInfo {
  name: string;
  api: string;
  count: number;
  year: number;
  season: number;
}

const PROGRAMME_ORDER: readonly Programme[] = ["yc", "speedrun", "fiveHundred", "skydeck"];
const PROGRAMME_NAMES: Record<Programme, string> = {
  yc: "Y Combinator",
  speedrun: "a16z speedrun",
  fiveHundred: "500 Global",
  skydeck: "Berkeley SkyDeck",
};
const SEASON_ORDER: Record<string, number> = { winter: 0, spring: 1, summer: 2, fall: 3 };

/**
 * Public accelerator directories. Listings are cached in this engine instance for six hours, so
 * a directory is asked at most a few times a day. robots.txt is not read. Requests to one host
 * are spaced by the page reader's own gap.
 */
export function createAcceleratorEngine(options: AcceleratorSearchOptions = {}): SearchEngine {
  const send = options.fetch ?? defaultFetch;
  const identity = readerIdentity(options.userAgent);
  const now = options.now ?? Date.now;
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const cache = new Map<Programme, CacheEntry>();
  const lastRequestAt = new Map<string, number>();

  /** Holds a request back until the host's gap has passed since the last one to it. */
  async function spaced(origin: string, gapMs: number, signal: AbortSignal): Promise<void> {
    const last = lastRequestAt.get(origin);
    const wait = last === undefined ? 0 : last + gapMs - now();
    if (wait > 0) await waitForSignal(sleep(wait), signal);
    lastRequestAt.set(origin, now());
  }

  /** Every request a listing makes goes through here: the wait, then the request, named. */
  const fetchFn: FetchFn = async (url, init) => {
    const signal = init?.signal ?? AbortSignal.timeout(timeoutMs);
    const origin = new URL(url).origin;
    await spaced(origin, DEFAULT_GAP_MS, signal);
    return send(url, { ...init, signal, headers: { ...toHeaderRecord(init?.headers), "User-Agent": identity.userAgent } });
  };

  async function loadCached(
    programme: Programme,
    signal: AbortSignal,
    callerSignal?: AbortSignal,
  ): Promise<AcceleratorHit[]> {
    const cached = cache.get(programme);
    const currentTime = now();
    if (cached && currentTime < cached.expiresAt) {
      try {
        return await waitForSignal(cached.promise, signal);
      } catch (error) {
        if (!signal.aborted && cached.requestSignal.aborted && cache.get(programme) !== cached) {
          return loadCached(programme, signal, callerSignal);
        }
        throw error;
      }
    }

    const entry = {} as CacheEntry;
    const promise = (async () => {
      try {
        const hits = await loadProgramme(programme, fetchFn, signal, currentTime);
        entry.expiresAt = now() + CACHE_TTL_MS;
        return hits;
      } catch (error) {
        if (cache.get(programme) === entry) cache.delete(programme);
        throw error;
      }
    })();
    Object.assign(entry, { expiresAt: Number.POSITIVE_INFINITY, promise, requestSignal: signal });
    cache.set(programme, entry);
    return waitForSignal(promise, signal);
  }

  return {
    id: "accelerators",
    label: "Accelerators",
    searches: "The newest batches of Y Combinator, a16z speedrun, 500 Global and Berkeley SkyDeck. Write a sector or a few plain words; an empty query lists the newest.",
    async status() {
      return { configured: true, detail: "Public accelerator directories; no credentials needed." };
    },
    async search(query, limit, searchOptions) {
      const count = Math.min(SEARCH_LIMIT, normalizeLimit(limit));
      if (count === 0 || searchOptions?.signal?.aborted) return [];

      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = searchOptions?.signal ? AbortSignal.any([timeout, searchOptions.signal]) : timeout;
      const results = await Promise.allSettled(
        PROGRAMME_ORDER.map((programme) => loadCached(programme, signal, searchOptions?.signal)),
      );
      if (searchOptions?.signal?.aborted) return [];

      const listings = new Map<Programme, AcceleratorHit[]>();
      const failed: Programme[] = [];
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const programme = PROGRAMME_ORDER[index];
        if (!result || !programme) continue;
        if (result.status === "fulfilled") listings.set(programme, result.value);
        else failed.push(programme);
      }
      if (failed.length === PROGRAMME_ORDER.length) {
        throw new Error(`Accelerator directory search failed for ${failed.map((programme) => PROGRAMME_NAMES[programme]).join(", ")}.`);
      }

      return rankAndInterleave(listings, query, count);
    },
  };
}

function normalizedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return REQUEST_TIMEOUT_MS;
  return Math.max(0, Math.min(Math.floor(timeoutMs), 2_147_483_647));
}

async function loadProgramme(
  programme: Programme,
  fetchFn: FetchFn,
  signal: AbortSignal,
  nowMs: number,
): Promise<AcceleratorHit[]> {
  switch (programme) {
    case "yc":
      return loadYc(fetchFn, signal);
    case "speedrun":
      return loadSpeedrun(fetchFn, signal);
    case "fiveHundred":
      return loadFiveHundred(fetchFn, signal, nowMs);
    case "skydeck":
      return loadSkyDeck(fetchFn, signal);
  }
}

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("request aborted"));
  return new Promise<T>((resolve, reject) => {
    const stop = () => {
      signal.removeEventListener("abort", stop);
      reject(signal.reason ?? new Error("request aborted"));
    };
    signal.addEventListener("abort", stop, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", stop);
        reject(error);
      },
    );
  });
}

function sourceUrl(raw: string, expectedHost: string): string | null {
  const cleaned = cleanUrl(raw);
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== expectedHost || parsed.port) return null;
    return cleaned;
  } catch {
    return null;
  }
}

function hitUrl(raw: string): string | null {
  return cleanUrl(raw);
}

async function readBody(fetchFn: FetchFn, url: string, init: RequestInit, signal: AbortSignal): Promise<string> {
  const headers = { Accept: "application/json, text/html;q=0.9", ...toHeaderRecord(init.headers) };
  const response = await fetchFn(url, { ...init, headers, signal, redirect: "error", credentials: "omit" });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`HTTP ${response.status}`);
  }
  if (!response.body) throw new Error("response has no body");

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body.cancel().catch(() => undefined);
    throw new Error("response exceeds size limit");
  }
  return limitedText(response.body, signal, MAX_RESPONSE_BYTES);
}

/** A body as text, given up on when it runs past the limit or the caller stops waiting. */
async function limitedText(stream: ReadableStream<Uint8Array>, signal: AbortSignal, maxBytes: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stopped = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason ?? new Error("request aborted"));
    else signal.addEventListener("abort", () => reject(signal.reason ?? new Error("request aborted")), { once: true });
  });
  void stopped.catch(() => undefined);
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("response exceeds size limit");
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
  return new TextDecoder().decode(bytes);
}

function toHeaderRecord(headers: RequestInit["headers"]): Record<string, string> {
  if (!headers) return {};
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => { result[key] = value; });
  return result;
}

async function getJson(fetchFn: FetchFn, url: string, host: string, signal: AbortSignal): Promise<unknown> {
  const checked = sourceUrl(url, host);
  if (!checked) throw new Error("source address rejected");
  const text = await readBody(fetchFn, checked, { method: "GET" }, signal);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("invalid JSON response");
  }
}

async function getText(fetchFn: FetchFn, url: string, host: string, signal: AbortSignal): Promise<string> {
  const checked = sourceUrl(url, host);
  if (!checked) throw new Error("source address rejected");
  return readBody(fetchFn, checked, { method: "GET" }, signal);
}

async function loadYc(fetchFn: FetchFn, signal: AbortSignal): Promise<AcceleratorHit[]> {
  const metadata = asRecord(await getJson(fetchFn, YC_META_URL, "yc-oss.github.io", signal));
  const batchRows = metadata ? recordsFromCollection(metadata.batches) : null;
  if (!batchRows) throw new Error("invalid batch metadata");

  const batches = batchRows
    .map(parseBatchInfo)
    .filter((batch): batch is BatchInfo => batch !== null && batch.count >= 5)
    .sort((a, b) => b.year - a.year || b.season - a.season)
    .slice(0, 2);

  const hits: AcceleratorHit[] = [];
  // Keep all YC requests sequential because they share one host.
  for (const batch of batches) {
    const checkedApi = sourceUrl(batch.api, "yc-oss.github.io");
    if (!checkedApi) throw new Error("invalid batch source address");
    const body = await getJson(fetchFn, checkedApi, "yc-oss.github.io", signal);
    if (!Array.isArray(body)) throw new Error("invalid batch listing");
    for (const raw of body) {
      const company = asRecord(raw);
      if (!company) continue;
      // A hit needs a name and the company's own site. The newest companies leave other
      // fields blank (a team size, a description), and they are the ones this is for.
      const name = textField(company.name);
      const website = textField(company.website);
      const url = website ? hitUrl(website) : null;
      if (!name || !url) continue;
      hits.push({
        programme: "yc",
        url,
        title: `${cleanPlain(name, 200)} (Y Combinator, ${cleanPlain(batch.name, 80)})`,
        snippet: [cleanPlain(stringValue(company.one_liner) ?? ""), cleanPlain(stringValue(company.long_description) ?? "", 240)].filter(Boolean).join(" · "),
        searchable: [...(stringArray(company.tags) ?? []), cleanPlain(textField(company.industry) ?? "", 200)],
      });
    }
  }
  return hits;
}

function recordsFromCollection(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  return record ? Object.values(record) : null;
}

function parseBatchInfo(value: unknown): BatchInfo | null {
  const record = asRecord(value);
  if (!record) return null;
  const name = textField(record.name);
  const api = textField(record.api);
  const count = typeof record.count === "number" && Number.isInteger(record.count) ? record.count : Number.NaN;
  if (!name || !api || !Number.isFinite(count)) return null;
  const match = /^(winter|spring|summer|fall)\s+(\d{4})$/iu.exec(name);
  if (!match) return null;
  const seasonName = (match[1] ?? "").toLowerCase();
  const year = Number(match[2]);
  const season = SEASON_ORDER[seasonName];
  if (!Number.isFinite(year) || season === undefined) return null;
  return { name, api, count, year, season };
}

async function loadSpeedrun(fetchFn: FetchFn, signal: AbortSignal): Promise<AcceleratorHit[]> {
  const html = await getText(fetchFn, SPEEDRUN_URL, "speedrun.a16z.com", signal);
  const match = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/iu.exec(html);
  if (!match?.[1]) throw new Error("missing Next.js listing data");
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]) as unknown;
  } catch {
    throw new Error("invalid Next.js listing data");
  }
  const root = asRecord(parsed);
  const props = asRecord(asRecord(root?.props)?.pageProps);
  const companies = asRecord(props?.companies);
  if (!companies || !Array.isArray(companies.results)) throw new Error("invalid company listing");

  const rows: Array<{ hit: AcceleratorHit; cohortNumber: number; order: number }> = [];
  for (let order = 0; order < companies.results.length; order += 1) {
    const company = asRecord(companies.results[order]);
    if (!company) continue;
    const name = textField(company.name);
    const slug = textField(company.slug);
    const cohort = textField(company.cohort);
    const preamble = stringValue(company.preamble) ?? "";
    const industries = stringArray(company.industries) ?? [];
    if (!name || !slug || !cohort || slug.includes("/")) continue;
    const cohortNumber = cohortNumericPart(cohort);
    if (cohortNumber < 0) continue;
    const url = hitUrl(`https://speedrun.a16z.com/companies/${encodeURIComponent(slug)}`);
    if (!url) continue;
    rows.push({
      order,
      cohortNumber,
      hit: {
        programme: "speedrun",
        url,
        title: `${cleanPlain(name, 200)} (a16z speedrun, ${cleanPlain(cohort, 80)})`,
        snippet: [cleanPlain(preamble, 300), industries.join(", ")].filter(Boolean).join(" · "),
        searchable: industries,
      },
    });
  }
  return rows.sort((a, b) => b.cohortNumber - a.cohortNumber || a.order - b.order).map(({ hit }) => hit);
}

async function loadFiveHundred(fetchFn: FetchFn, signal: AbortSignal, nowMs: number): Promise<AcceleratorHit[]> {
  const root = asRecord(await getJson(fetchFn, FIVE_HUNDRED_URL, "500.co", signal));
  if (!root || !Array.isArray(root.res)) throw new Error("invalid startup listing");
  const items: Array<{ hit: AcceleratorHit; date: number; order: number }> = [];
  for (let order = 0; order < root.res.length; order += 1) {
    const startup = asRecord(root.res[order]);
    const organization = asRecord(startup?.organization);
    if (!startup || !organization) continue;
    const name = textField(organization.name);
    const rawCompanyUrl = textField(organization.companyUrl);
    const batchRecord = Array.isArray(startup.batches) ? asRecord(startup.batches[0]) : null;
    const batch = textField(batchRecord?.brandName);
    const latestDate = latestInvestmentDate(startup.investments);
    // Two in three of the newest records name no batch and give no one-line description.
    const oneLiner = stringValue(startup.oneLiner) ?? "";
    const stage = textField(asRecord(startup.stage)?.name) ?? "";
    const industries = namedStringArray(startup.industries) ?? [];
    if (!name || !rawCompanyUrl || latestDate === null || latestDate < nowMs - FIVE_HUNDRED_WINDOW_MS || latestDate > nowMs) continue;
    const companyUrl = /^[a-z][a-z0-9+.-]*:/iu.test(rawCompanyUrl) ? rawCompanyUrl : `https://${rawCompanyUrl}`;
    const url = hitUrl(companyUrl);
    if (!url) continue;
    items.push({
      order,
      date: latestDate,
      hit: {
        programme: "fiveHundred",
        url,
        title: `${cleanPlain(name, 200)} (${["500 Global", cleanPlain(batch ?? "", 80)].filter(Boolean).join(", ")})`,
        snippet: [cleanPlain(oneLiner, 300), cleanPlain(stage, 80), industries.join(", ")].filter(Boolean).join(" · "),
        searchable: industries,
      },
    });
  }
  return items.sort((a, b) => b.date - a.date || a.order - b.order).map(({ hit }) => hit);
}

function latestInvestmentDate(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  let latest: number | null = null;
  for (const raw of value) {
    const investment = asRecord(raw);
    const date = textField(investment?.initialInvestDate);
    if (!date) continue;
    const parsed = Date.parse(date);
    if (!Number.isFinite(parsed) || new Date(parsed).getUTCFullYear() === 1970) continue;
    if (latest === null || parsed > latest) latest = parsed;
  }
  return latest;
}

async function loadSkyDeck(fetchFn: FetchFn, signal: AbortSignal): Promise<AcceleratorHit[]> {
  const url = sourceUrl(SKYDECK_URL, "skydeck.berkeley.edu");
  if (!url) throw new Error("source address rejected");
  const text = await readBody(fetchFn, url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: SKYDECK_BODY,
  }, signal);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("invalid JSON response");
  }
  const root = asRecord(parsed);
  if (!root || !Array.isArray(root.posts)) throw new Error("invalid company listing");

  const posts: Array<{ hit: AcceleratorHit; batch: number; order: number }> = [];
  for (let order = 0; order < root.posts.length; order += 1) {
    const post = asRecord(root.posts[order]);
    if (!post) continue;
    const title = textField(post.title);
    const address = textField(post.url);
    const className = textField(post.class);
    const classMatch = className ? /^Batch\s+(\d+)$/iu.exec(className) : null;
    const batch = classMatch ? Number(classMatch[1]) : Number.NaN;
    const hitAddress = address ? hitUrl(address) : null;
    if (!title || !className || !Number.isFinite(batch) || !hitAddress) continue;
    posts.push({
      order,
      batch,
      hit: {
        programme: "skydeck",
        url: hitAddress,
        title: `${cleanPlain(title, 200)} (Berkeley SkyDeck, ${cleanPlain(className, 80)})`,
        snippet: "",
        searchable: [],
      },
    });
  }
  const topClasses = [...new Set(posts.map((post) => post.batch))].sort((a, b) => b - a).slice(0, 2);
  const selected = new Set(topClasses);
  return posts.filter((post) => selected.has(post.batch)).sort((a, b) => b.batch - a.batch || a.order - b.order).map(({ hit }) => hit);
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value.map((item) => cleanPlain(item, 200));
}

function namedStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names: string[] = [];
  for (const item of value) {
    const name = textField(asRecord(item)?.name);
    if (!name) return null;
    names.push(cleanPlain(name, 200));
  }
  return names;
}

function cohortNumericPart(cohort: string): number {
  const match = /^SR(\d+)$/iu.exec(cohort.trim());
  return match ? Number(match[1]) : -1;
}

function wordSet(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function relevance(hit: AcceleratorHit, queryWords: readonly string[]): number {
  if (queryWords.length === 0) return 0;
  const searchable = wordSet([hit.title, hit.snippet, ...hit.searchable].join(" "));
  return queryWords.reduce((score, word) => score + Number(searchable.has(word)), 0);
}

function rankAndInterleave(listings: Map<Programme, AcceleratorHit[]>, query: string, limit: number): SearchHit[] {
  const queryWords = [...wordSet(query)].filter((word) => word.length >= 3);
  const scoreGroups = new Map<number, Map<Programme, AcceleratorHit[]>>();
  for (const programme of PROGRAMME_ORDER) {
    for (const hit of listings.get(programme) ?? []) {
      const score = relevance(hit, queryWords);
      let perProgramme = scoreGroups.get(score);
      if (!perProgramme) {
        perProgramme = new Map();
        scoreGroups.set(score, perProgramme);
      }
      const group = perProgramme.get(programme) ?? [];
      group.push(hit);
      perProgramme.set(programme, group);
    }
  }

  const result: SearchHit[] = [];
  const seen = new Set<string>();
  const scores = [...scoreGroups.keys()].sort((a, b) => b - a);
  for (const score of scores) {
    const perProgramme = scoreGroups.get(score);
    if (!perProgramme) continue;
    const queues = new Map<Programme, AcceleratorHit[]>(PROGRAMME_ORDER.map((programme) => [programme, [...(perProgramme.get(programme) ?? [])]]));
    while ([...queues.values()].some((queue) => queue.length > 0)) {
      for (const programme of PROGRAMME_ORDER) {
        const next = queues.get(programme)?.shift();
        if (!next || seen.has(next.url)) continue;
        seen.add(next.url);
        result.push({ url: next.url, title: next.title, snippet: next.snippet });
        if (result.length >= limit) return result;
      }
    }
  }
  return result;
}
