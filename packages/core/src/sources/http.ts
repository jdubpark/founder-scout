/**
 * One GET helper for every live adapter: identifies the client, enforces the
 * 20 second timeout, honours the caller's abort signal, and turns rate limits
 * and HTTP failures into errors that name the source.
 */

export const USER_AGENT = "agentswarm/0.1";
export const REQUEST_TIMEOUT_MS = 20_000;

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Resolves `fetch` at call time, so a replaced global is still honoured. */
export const defaultFetch: FetchFn = (url, init) => fetch(url, init);

export class SourceRateLimitError extends Error {
  readonly source: string;
  /** When the source says the limit resets, or null when it does not say. */
  readonly retryAt: Date | null;
  /** The HTTP status that signalled the limit, or null when it was known from earlier headers. */
  readonly status: number | null;

  constructor(source: string, retryAt: Date | null, status: number | null = null) {
    const which = status === null ? "" : ` (HTTP ${status})`;
    super(
      retryAt
        ? `${source} is rate limited${which}. Retry after ${retryAt.toISOString()}.`
        : `${source} is rate limited${which}. Retry later; the response gave no reset time.`,
    );
    this.name = "SourceRateLimitError";
    this.source = source;
    this.retryAt = retryAt;
    this.status = status;
  }
}

export interface HttpResult {
  status: number;
  headers: Headers;
  body: string;
}

export async function httpGet(
  fetchFn: FetchFn,
  source: string,
  url: string,
  options: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<HttpResult> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, ...options.headers },
      signal,
    });
    const body = await res.text();
    return { status: res.status, headers: res.headers, body };
  } catch (err) {
    if (options.signal?.aborted) throw err;
    if (timeout.aborted) {
      throw new Error(`${source} request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`, { cause: err });
    }
    throw new Error(`${source} request failed: ${errorMessage(err)}`, { cause: err });
  }
}

/** Throws SourceRateLimitError on 429 or rate-limited 403, and a plain Error on other non-2xx. */
export function assertSuccessful(source: string, res: HttpResult, nowMs: number): void {
  const remainingZero = res.headers.get("x-ratelimit-remaining") === "0";
  const hasRetryAfter = res.headers.get("retry-after") !== null;
  const limited =
    res.status === 429 ||
    (res.status === 403 && (remainingZero || hasRetryAfter || /rate limit/i.test(res.body)));
  if (limited) throw new SourceRateLimitError(source, retryTime(res.headers, nowMs), res.status);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${source} request failed with HTTP ${res.status}.`);
  }
}

export function parseJson(source: string, body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (err) {
    throw new Error(`${source} returned a body that is not valid JSON.`, { cause: err });
  }
}

export function numericHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw);
}

function retryTime(headers: Headers, nowMs: number): Date | null {
  const retryAfter = numericHeader(headers, "retry-after");
  if (retryAfter !== null) return new Date(nowMs + retryAfter * 1000);
  const reset = numericHeader(headers, "x-ratelimit-reset");
  if (reset !== null) return new Date(reset * 1000);
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
