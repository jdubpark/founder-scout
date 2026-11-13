/**
 * Test helpers for the source adapters: a scripted fetch that records every
 * URL it is asked for, and fixture loaders. Used only by *.test.ts files.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceFetchRequest } from "../contracts";
import type { FetchFn } from "./http";

const here = dirname(fileURLToPath(import.meta.url));

export function readFixture(name: string): string {
  return readFileSync(join(here, "__fixtures__", name), "utf8");
}

export function readJsonFixture<T = unknown>(name: string): T {
  return JSON.parse(readFixture(name)) as T;
}

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

export function textResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "application/xml", ...init.headers },
  });
}

export interface RecordedFetch {
  fetch: FetchFn;
  /** Every requested URL, in order. */
  urls: string[];
  /** Every request's headers, in order. */
  headers: Array<Record<string, string>>;
}

/** Calls `route` for each request. The route sees the parsed URL and returns the response. */
export function scriptedFetch(route: (url: URL) => Response | Promise<Response>): RecordedFetch {
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const fetch: FetchFn = async (url, init) => {
    urls.push(url);
    const h = init?.headers;
    headers.push(h && !(h instanceof Headers) && !Array.isArray(h) ? (h as Record<string, string>) : {});
    return route(new URL(url));
  };
  return { fetch, urls, headers };
}

export function request(overrides: Partial<SourceFetchRequest> = {}): SourceFetchRequest {
  return {
    limit: 10,
    since: null,
    cursor: null,
    beat: null,
    thesis: {
      summary: "Seed-stage software companies with technical founders.",
      sectors: [],
      stages: [],
      geos: [],
      avoid: [],
    },
    simDay: null,
    ...overrides,
  };
}

/** A fixed clock for window arithmetic: 2026-11-13T05:00:00Z. */
export const FIXED_NOW_MS = Date.parse("2026-11-13T05:00:00Z");
