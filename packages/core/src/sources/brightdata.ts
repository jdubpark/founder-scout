/**
 * Bright Data LinkedIn Scraper adapter (dataset v3). Verified against the live
 * service on 2026-11-13 with one profile record delivered (and one dead page).
 * It uses only the vendor API and never fetches a professional-network profile
 * link.
 */

import { isProfessionalNetworkUrl } from "@agentswarm/shared";
import type { PeopleLookup, PersonKey, PersonRecord } from "../contracts";
import type { RecordAllowance } from "./pdl";
import {
  assertSuccessful,
  defaultFetch,
  httpGet,
  parseJson,
  USER_AGENT,
  type FetchFn,
  type HttpResult,
} from "./http";
import { asRecord } from "./util";

const VENDOR = "Bright Data";
const BASE_URL = "https://api.brightdata.com";
const PROFILE_DATASET = "gd_l1viktl72bvl7bjuj0";
const SEARCH_DATASET = "gd_m8d03he47z8nwb5xc";
const SEARCH_INPUT_URL = "https://www.linkedin.com";
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** The direct lookup was keyed by the profile's own address, so it is that person. */
const PROFILE_MATCH_CONFIDENCE = 1;

export interface BrightDataOptions {
  apiKey: string;
  /** Defaults to the profile dataset above. */
  datasetId?: string;
  /** The same per-day record ceiling PDL uses; records are counted when returned. */
  allowance: RecordAllowance;
  fetchFn?: FetchFn;
  /** Poll spacing and overall wait for a snapshot; defaults that suit a few profiles. */
  pollMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A string, or a `{ name }` object, as the datasets sometimes nest it. */
function valueText(value: unknown): string | null {
  const direct = text(value);
  if (direct) return direct;
  return text(asRecord(value)?.name);
}

function firstText(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = valueText(item[key]);
    if (value) return value;
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Keeps the vendor's date, rendering "Oct 2026" as "2026-10"; "Present" is not a date. */
function dateText(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^(present|current)$/i.test(raw)) return null;
  if (/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(raw)) return raw;
  const monthYear = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(raw);
  if (monthYear) {
    const month = MONTHS.indexOf(monthYear[1]!.slice(0, 3).toLowerCase());
    if (month >= 0) return `${monthYear[2]}-${String(month + 1).padStart(2, "0")}`;
  }
  return raw;
}

function secureUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

function parseExperience(value: unknown): PersonRecord["experience"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): PersonRecord["experience"][number] | null => {
      const item = asRecord(entry);
      if (!item) return null;
      return {
        title: firstText(item, ["title", "position"]),
        company: valueText(item.company),
        startDate: dateText(item.start_date ?? item.startDate),
        endDate: dateText(item.end_date ?? item.endDate),
      };
    })
    .filter((entry): entry is PersonRecord["experience"][number] => entry !== null);
}

function parseEducation(value: unknown): PersonRecord["education"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): PersonRecord["education"][number] | null => {
      const item = asRecord(entry);
      if (!item) return null;
      const degrees = Array.isArray(item.degrees)
        ? item.degrees.map(text).filter((degree): degree is string => degree !== null)
        : [];
      const degree = text(item.degree);
      return {
        school: firstText(item, ["school", "title", "name", "institution"]),
        degrees: degree && degrees.length === 0 ? [degree] : degrees,
        startDate: dateText(item.start_date ?? item.startDate),
        endDate: dateText(item.end_date ?? item.endDate),
      };
    })
    .filter((entry): entry is PersonRecord["education"][number] => entry !== null);
}

function currentFrom(experience: PersonRecord["experience"]): PersonRecord["current"] {
  const entry = experience.find((candidate) => candidate.endDate === null) ?? experience[0];
  if (!entry || (!entry.title && !entry.company && !entry.startDate)) return null;
  return { title: entry.title, company: entry.company, companyUrl: null, startDate: entry.startDate };
}

function locationOf(item: Record<string, unknown>, source: "profile" | "search"): string | null {
  if (source === "search") return firstText(item, ["location", "location_name"]);
  const city = firstText(item, ["city"]);
  const country = firstText(item, ["country_code", "country"]);
  const renderedCountry = country && country.length <= 3 ? country.toUpperCase() : country;
  if (city && renderedCountry) return `${city}, ${renderedCountry}`;
  return city ?? renderedCountry ?? firstText(item, ["location"]);
}

function mapPerson(
  raw: unknown,
  source: "profile" | "search",
  fallbackProfileUrl: string | null = null,
): PersonRecord | null {
  const item = asRecord(raw);
  if (!item) return null;
  const name = firstText(item, ["name", "full_name"]);
  const profileUrl = secureUrl(firstText(item, ["url", "profile_url", "profileUrl", "linkedin_url"])) ?? fallbackProfileUrl;
  const vendorId = firstText(item, ["id", "profile_id"]) ?? profileUrl ?? name;
  if (!name || !vendorId) return null;

  const experience = parseExperience(item.experience);
  return {
    vendorId,
    vendor: VENDOR,
    name,
    headline: source === "profile"
      ? firstText(item, ["position", "headline"])
      : firstText(item, ["subtitle", "headline", "position"]),
    location: locationOf(item, source),
    profileUrl,
    current: currentFrom(experience),
    experience,
    education: parseEducation(item.education),
    lastVerifiedAt: firstText(item, ["last_verified", "last_updated", "updated_at"]),
    matchConfidence: source === "search" ? null : PROFILE_MATCH_CONFIDENCE,
  };
}

function snapshotRecords(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const body = asRecord(raw);
  return Array.isArray(body?.data) ? body.data : [];
}

export function createBrightDataVendor(options: BrightDataOptions): PeopleLookup {
  const apiKey = options.apiKey.trim();
  const profileDatasetId = options.datasetId?.trim() || PROFILE_DATASET;
  const fetchFn = options.fetchFn ?? defaultFetch;
  const pollMs = Math.max(0, options.pollMs ?? DEFAULT_POLL_MS);
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const allowance = options.allowance;
  const authHeaders = { Authorization: `Bearer ${apiKey}` };

  const checkStatus = (result: HttpResult): void => {
    if (result.status === 401) throw new Error(`${VENDOR} rejected the API key.`);
    if (result.status === 402) throw new Error(`${VENDOR} is out of credits.`);
    assertSuccessful(VENDOR, result, now());
  };

  const post = async (url: string, payload: unknown, signal?: AbortSignal): Promise<HttpResult> => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
        signal: combined,
      });
      return { status: res.status, headers: res.headers, body: await res.text() };
    } catch (err) {
      if (signal?.aborted) throw err;
      if (timeout.aborted) {
        throw new Error(`${VENDOR} request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`, { cause: err });
      }
      throw new Error(`${VENDOR} request failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  };

  const waitForSnapshot = async (snapshotId: string, signal?: AbortSignal): Promise<boolean> => {
    const deadline = now() + timeoutMs;
    while (true) {
      signal?.throwIfAborted();
      const progress = await httpGet(
        fetchFn,
        VENDOR,
        `${BASE_URL}/datasets/v3/progress/${encodeURIComponent(snapshotId)}`,
        { headers: authHeaders, signal },
      );
      checkStatus(progress);
      const status = firstText(asRecord(parseJson(VENDOR, progress.body)) ?? {}, ["status"]);
      if (status === "ready") return true;
      if (status === "failed") return false;
      if (now() >= deadline) return false;
      await sleep(pollMs);
    }
  };

  const lookup = async (
    datasetId: string,
    inputs: Array<Record<string, string>>,
    source: "profile" | "search",
    fallbackProfileUrl: string | null,
    signal?: AbortSignal,
  ): Promise<PersonRecord | null> => {
    const trigger = new URL(`${BASE_URL}/datasets/v3/trigger`);
    trigger.searchParams.set("dataset_id", datasetId);
    trigger.searchParams.set("format", "json");
    const triggered = await post(trigger.toString(), inputs, signal);
    checkStatus(triggered);
    const snapshotId = firstText(asRecord(parseJson(VENDOR, triggered.body)) ?? {}, ["snapshot_id", "snapshotId"]);
    if (!snapshotId) return null;
    if (!(await waitForSnapshot(snapshotId, signal))) return null;

    const snapshot = await httpGet(
      fetchFn,
      VENDOR,
      `${BASE_URL}/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`,
      { headers: authHeaders, signal },
    );
    checkStatus(snapshot);
    const record = snapshotRecords(parseJson(VENDOR, snapshot.body))[0];
    return record === undefined ? null : mapPerson(record, source, fallbackProfileUrl);
  };

  return {
    vendor: VENDOR,

    async status() {
      return {
        configured: apiKey.length > 0,
        detail: apiKey.length > 0
          ? `${VENDOR} LinkedIn Scraper API is configured; pay per delivered record (5,000 free per month).`
          : `${VENDOR} LinkedIn Scraper API is not configured; set BRIGHTDATA_API_KEY.`,
      };
    },

    async enrich(key: PersonKey, signal?: AbortSignal): Promise<PersonRecord | null> {
      let datasetId: string;
      let inputs: Array<Record<string, string>>;
      let source: "profile" | "search";
      let fallbackProfileUrl: string | null = null;

      if ("profileUrl" in key) {
        if (!isProfessionalNetworkUrl(key.profileUrl)) return null;
        fallbackProfileUrl = secureUrl(key.profileUrl);
        if (!fallbackProfileUrl) return null;
        datasetId = profileDatasetId;
        inputs = [{ url: fallbackProfileUrl }];
        source = "profile";
      } else if ("name" in key) {
        const name = key.name.trim();
        const split = name.indexOf(" ");
        const first = split === -1 ? name : name.slice(0, split);
        const last = split === -1 ? "" : name.slice(split + 1).trim();
        datasetId = SEARCH_DATASET;
        inputs = [{ url: SEARCH_INPUT_URL, first_name: first, ...(last ? { last_name: last } : {}) }];
        source = "search";
      } else {
        // The vendor's id is not a profile address we can look up.
        return null;
      }

      // Like PDL, stop asking once the day's records are spent; a lookup has nothing to return.
      if (allowance.left() <= 0) return null;
      let granted: number;
      try {
        granted = allowance.take(1);
      } catch {
        return null;
      }
      let settled = false;
      try {
        const record = await lookup(datasetId, inputs, source, fallbackProfileUrl, signal);
        allowance.used(record ? 1 : 0, granted);
        settled = true;
        return record;
      } finally {
        if (!settled) allowance.used(0, granted);
      }
    },

    async team(): Promise<PersonRecord[]> {
      // The LinkedIn datasets expose the employee count, not the employee list.
      return [];
    },
  };
}
