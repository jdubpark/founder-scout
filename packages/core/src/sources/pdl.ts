/**
 * People Data Labs profile adapter. This implementation is unverified against
 * the live service on this machine. It uses only the vendor API and never
 * fetches a professional-network profile link.
 */

import type { RawItem } from "@agentswarm/shared";
import type {
  PeopleLookup,
  PersonKey,
  PersonRecord,
  SourceFetchRequest,
  SourceFetchResult,
} from "../contracts";
import type { ProfileDataVendor } from "./people_data";
import {
  assertSuccessful,
  defaultFetch,
  httpGet,
  parseJson,
  type FetchFn,
} from "./http";
import { asRecord, normalizeLimit } from "./util";

const VENDOR = "People Data Labs";
const BASE_URL = "https://api.peopledatalabs.com/v5";
const SEEN_LIMIT = 2_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const DATA_INCLUDE = [
  "id",
  "full_name",
  "linkedin_url",
  "job_title",
  "job_company_name",
  "job_company_website",
  "job_start_date",
  "job_last_changed",
  "job_last_verified",
  "location_name",
  "experience",
  "education",
].join(",");

export interface PdlOptions {
  apiKey: string;
  fetchFn?: FetchFn;
  now?: () => Date;
  /** A ceiling on records per day, shared by everything that uses this key. Without one there is no ceiling. */
  allowance?: RecordAllowance;
}

/**
 * The vendor charges one credit for every record it returns, and that spend is outside the
 * run's own spend cap, which counts model calls. This is the ceiling for it: so many records
 * per day (UTC), counted in memory, across the talent scout, work-history lookups and team
 * lookups. It starts again when the server restarts, so it is a guard, not an account.
 */
export interface RecordAllowance {
  /** Reserve how many of `wanted` records may still be asked for today. Throws when none are left. */
  take(wanted: number): number;
  /** Settle a reservation with the number of records the vendor actually charged. */
  used(charged: number, granted: number): void;
  /** Records neither spent nor reserved today. */
  left(): number;
}

export function createRecordAllowance(perDay: number, now: () => Date = () => new Date()): RecordAllowance {
  let day = "";
  let spent = 0;
  let reserved = 0;
  const roll = () => {
    const today = now().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      spent = 0;
      reserved = 0;
    }
  };
  return {
    take(wanted) {
      roll();
      const left = Math.max(0, perDay - spent - reserved);
      if (left === 0) {
        throw new Error(
          `${VENDOR}: today's allowance of ${perDay} records is used up. Raise PDL_RECORDS_PER_DAY to spend more.`,
        );
      }
      const granted = Math.max(0, Math.min(wanted, left));
      reserved += granted;
      return granted;
    },
    used(charged, granted) {
      roll();
      reserved = Math.max(0, reserved - Math.max(0, granted));
      spent += Math.max(0, charged);
    },
    left() {
      roll();
      return Math.max(0, perDay - spent - reserved);
    },
  };
}

interface SeenCursor {
  seen: string[];
}

interface PdlExperience {
  title: string | null;
  company: string | null;
  startDate: string | null;
  endDate: string | null;
}

interface PdlEducation {
  school: string | null;
  degrees: string[];
  startDate: string | null;
  endDate: string | null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nestedText(value: unknown, key: string): string | null {
  return text(asRecord(value)?.[key]);
}

function partialDate(value: unknown): string | null {
  const date = text(value);
  if (!date || !/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(date)) return null;
  const month = date.length >= 7 ? Number(date.slice(5, 7)) : 1;
  const day = date.length === 10 ? Number(date.slice(8, 10)) : 1;
  const year = Number(date.slice(0, 4));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 || month > 12 || day < 1 || day > 31 ||
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day
  ) return null;
  return date;
}

function dateSortKey(value: string | null): string {
  return value ?? "0000";
}

function parseExperience(value: unknown): PdlExperience[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): PdlExperience | null => {
      const item = asRecord(entry);
      if (!item) return null;
      return {
        title: nestedText(item.title, "name"),
        company: nestedText(item.company, "name"),
        startDate: partialDate(item.start_date),
        endDate: partialDate(item.end_date),
      };
    })
    .filter((item): item is PdlExperience => item !== null)
    .sort((a, b) => dateSortKey(b.startDate).localeCompare(dateSortKey(a.startDate)))
    .slice(0, 10);
}

function parseEducation(value: unknown): PdlEducation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): PdlEducation | null => {
      const item = asRecord(entry);
      if (!item) return null;
      const degrees = Array.isArray(item.degrees)
        ? item.degrees.map(text).filter((degree): degree is string => degree !== null)
        : [];
      return {
        school: nestedText(item.school, "name"),
        degrees,
        startDate: partialDate(item.start_date),
        endDate: partialDate(item.end_date),
      };
    })
    .filter((item): item is PdlEducation => item !== null)
    .sort((a, b) => dateSortKey(b.startDate).localeCompare(dateSortKey(a.startDate)))
    .slice(0, 4);
}

function secureProfileUrl(value: unknown): string | null {
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

function mapPerson(raw: unknown, likelihood?: unknown): PersonRecord | null {
  const item = asRecord(raw);
  const vendorId = text(item?.id);
  const name = text(item?.full_name);
  if (!vendorId || !name || !item) return null;

  const title = text(item.job_title);
  const company = text(item.job_company_name);
  const companyUrl = text(item.job_company_website);
  const startDate = partialDate(item.job_start_date);
  const current = title || company || companyUrl || startDate
    ? { title, company, companyUrl, startDate }
    : null;
  const confidence = typeof likelihood === "number" && Number.isFinite(likelihood)
    ? Math.max(1, Math.min(10, likelihood)) / 10
    : null;

  return {
    vendorId,
    vendor: VENDOR,
    name,
    headline: title,
    location: text(item.location_name),
    profileUrl: secureProfileUrl(item.linkedin_url),
    current,
    experience: parseExperience(item.experience),
    education: parseEducation(item.education),
    lastVerifiedAt: text(item.job_last_verified),
    matchConfidence: confidence,
  };
}

function cursorSeen(raw: unknown): string[] {
  const cursor = asRecord(raw);
  if (!Array.isArray(cursor?.seen)) return [];
  return cursor.seen.filter((id): id is string => typeof id === "string").slice(-SEEN_LIMIT);
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function monthFromDate(value: string | null, now: Date): string {
  if (value) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 7);
  }
  return new Date(now.getTime() - 90 * DAY_MS).toISOString().slice(0, 7);
}

function firstOfMonth(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})(?:-(\d{2}))?/.exec(value);
  if (!match) return null;
  const month = match[2] ?? "01";
  if (Number(month) < 1 || Number(month) > 12) return null;
  return `${match[1]}-${month}-01T00:00:00.000Z`;
}

function buildRawItem(person: PersonRecord): RawItem {
  const profileUrl = person.profileUrl;
  const role = [person.current?.title, person.current?.company ? `at ${person.current.company}` : null]
    .filter((part): part is string => part !== null)
    .join(" ");
  const lines: string[] = [];
  if (person.current) {
    const currentRole = [person.current.title, person.current.company ? `at ${person.current.company}` : null]
      .filter((part): part is string => part !== null)
      .join(" ") || "Current role";
    lines.push(`Current role: ${currentRole}${person.current.startDate ? ` (since ${person.current.startDate})` : ""}`);
  }
  const earlier = person.experience.filter((entry) => {
    const sameTitle = entry.title?.toLowerCase() === person.current?.title?.toLowerCase();
    const sameCompany = entry.company?.toLowerCase() === person.current?.company?.toLowerCase();
    return !(sameTitle && sameCompany);
  }).slice(0, 3);
  for (const entry of earlier) {
    const position = [entry.title, entry.company ? `at ${entry.company}` : null]
      .filter((part): part is string => part !== null)
      .join(" ");
    if (position) {
      const dates = [entry.startDate, entry.endDate].filter((date): date is string => date !== null).join(" to ");
      lines.push(`${position}${dates ? ` (${dates})` : ""}`);
    }
  }
  for (const entry of person.education.slice(0, 2)) {
    if (entry.school) lines.push(`${entry.school}${entry.degrees.length ? `: ${entry.degrees.join(", ")}` : ""}`);
  }
  const currentStart = firstOfMonth(person.current?.startDate ?? null);

  return {
    ref: profileUrl ?? `urn:pdl:person:${person.vendorId}`,
    source: "people_data",
    title: `${person.name}: ${role || "Professional profile"}`,
    text: lines.join("\n"),
    author: person.name,
    authorUrl: profileUrl,
    publishedAt: currentStart,
    metrics: {},
    simFounderId: null,
  };
}

function responseData(raw: unknown): unknown[] {
  const body = asRecord(raw);
  return Array.isArray(body?.data) ? body.data : [];
}

export function createPdlVendor(options: PdlOptions): ProfileDataVendor & PeopleLookup {
  const apiKey = options.apiKey.trim();
  const fetchFn = options.fetchFn ?? defaultFetch;
  const now = options.now ?? (() => new Date());
  const allowance = options.allowance ?? null;

  const makeUrl = (path: string, params: Record<string, string>): string => {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  };

  const request = (url: string, signal?: AbortSignal) =>
    httpGet(fetchFn, VENDOR, url, { headers: { "X-Api-Key": apiKey }, signal });

  const checkStatus = (result: Awaited<ReturnType<typeof request>>): void => {
    if (result.status === 401) throw new Error(`${VENDOR} rejected the API key.`);
    if (result.status === 402) throw new Error(`${VENDOR} is out of credits.`);
    assertSuccessful(VENDOR, result, now().getTime());
  };

  const parseBody = (body: string): unknown | null => {
    try {
      return parseJson(VENDOR, body);
    } catch {
      return null;
    }
  };

  return {
    name: VENDOR,
    vendor: VENDOR,

    async status() {
      return {
        configured: apiKey.length > 0,
        detail: apiKey.length > 0
          ? `${VENDOR} API key is configured; unverified against the live service on this machine.`
          : `${VENDOR} is not configured; unverified against the live service on this machine.`,
      };
    },

    async fetch(req: SourceFetchRequest): Promise<SourceFetchResult> {
      const wanted = Math.min(normalizeLimit(req.limit), 100);
      const seen = cursorSeen(req.cursor);
      if (wanted === 0) return { items: [], cursor: { seen } satisfies SeenCursor };
      const limit = allowance ? allowance.take(wanted) : wanted;
      let settled = !allowance;
      try {
        const month = monthFromDate(req.since, now());
        const sql = `SELECT * FROM person WHERE job_title LIKE '%founder%' AND job_start_date >= '${escapeSql(month)}'`;
        const result = await request(makeUrl("/person/search", {
          sql,
          size: String(limit),
          data_include: DATA_INCLUDE,
        }), req.signal);
        if (result.status === 404) {
          allowance?.used(0, limit);
          settled = true;
          return { items: [], cursor: { seen } satisfies SeenCursor };
        }
        checkStatus(result);

        const body = parseBody(result.body);
        const records = responseData(body);
        // Every record in the answer was charged for, including ones already seen.
        allowance?.used(records.length, limit);
        settled = true;
        const previous = new Set(seen);
        const newIds: string[] = [];
        const items: RawItem[] = [];
        for (const record of records) {
          const person = mapPerson(record);
          if (!person || previous.has(person.vendorId) || newIds.includes(person.vendorId)) continue;
          newIds.push(person.vendorId);
          items.push(buildRawItem(person));
          if (items.length >= limit) break;
        }
        return { items, cursor: { seen: [...seen, ...newIds].slice(-SEEN_LIMIT) } satisfies SeenCursor };
      } finally {
        if (!settled) allowance?.used(0, limit);
      }
    },

    async enrich(key: PersonKey, signal?: AbortSignal): Promise<PersonRecord | null> {
      const params: Record<string, string> = { min_likelihood: "6", data_include: DATA_INCLUDE };
      if ("name" in key) {
        params.name = key.name;
        if (key.company) params.company = key.company;
      } else if ("profileUrl" in key) {
        params.profile = key.profileUrl;
      } else {
        params.pdl_id = key.vendorId;
      }
      const granted = allowance ? allowance.take(1) : 0;
      let settled = !allowance;
      try {
        const result = await request(makeUrl("/person/enrich", params), signal);
        // No match is not charged for.
        if (result.status === 404) {
          allowance?.used(0, granted);
          settled = true;
          return null;
        }
        checkStatus(result);
        allowance?.used(1, granted);
        settled = true;
        const body = asRecord(parseBody(result.body));
        return body ? mapPerson(body.data, body.likelihood) : null;
      } finally {
        if (!settled) allowance?.used(0, granted);
      }
    },

    async team(company, limit, signal): Promise<PersonRecord[]> {
      const wanted = Math.min(normalizeLimit(limit), 25);
      if (wanted === 0) return [];
      const boundedLimit = allowance ? allowance.take(wanted) : wanted;
      let settled = !allowance;
      try {
        const sql = company.domain?.trim()
          ? `SELECT * FROM person WHERE job_company_website = '${escapeSql(company.domain.trim().toLowerCase())}'`
          : `SELECT * FROM person WHERE job_company_name = '${escapeSql(company.name.trim().toLowerCase())}'`;
        const result = await request(makeUrl("/person/search", {
          sql,
          size: String(boundedLimit),
          data_include: DATA_INCLUDE,
        }), signal);
        if (result.status === 404) {
          allowance?.used(0, boundedLimit);
          settled = true;
          return [];
        }
        checkStatus(result);
        const records = responseData(parseBody(result.body));
        allowance?.used(records.length, boundedLimit);
        settled = true;
        return records
          .map((record) => mapPerson(record))
          .filter((person): person is PersonRecord => person !== null);
      } finally {
        if (!settled) allowance?.used(0, boundedLimit);
      }
    },
  };
}
