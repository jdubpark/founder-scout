import type { XPost, XPostReader } from "../contracts";
import { defaultFetch, type FetchFn } from "./http";

const BASE_URL = "https://api.x.com/2/tweets";
const MAX_IDS = 100;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_POSTS_PER_DAY = 200;
const GONE = Symbol("gone");

type Answer = XPost | typeof GONE;
type JsonRecord = Record<string, unknown>;

export interface XPostReaderOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: FetchFn;
  now?: () => Date;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** X's API writes &, < and > in a post's text and in a name as HTML entities, and nothing else. */
function unescapeText(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function metric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dailyLimit(value: string | undefined): number {
  const configured = Number(value);
  return Number.isFinite(configured) && configured >= 0
    ? Math.floor(configured)
    : DEFAULT_POSTS_PER_DAY;
}

async function readJsonBody(response: Response): Promise<unknown | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function expectedBody(value: unknown): { data: unknown[]; errors: unknown[]; users: unknown[] } | null {
  const body = asRecord(value);
  if (!body) return null;
  if (body.data !== undefined && !Array.isArray(body.data)) return null;
  if (body.errors !== undefined && !Array.isArray(body.errors)) return null;
  if (!Array.isArray(body.data) && !Array.isArray(body.errors)) return null;
  const includes = asRecord(body.includes);
  return {
    data: Array.isArray(body.data) ? body.data : [],
    errors: Array.isArray(body.errors) ? body.errors : [],
    users: Array.isArray(includes?.users) ? includes.users : [],
  };
}

function mapPosts(body: { data: unknown[]; errors: unknown[]; users: unknown[] }, requested: ReadonlySet<string>): Map<string, XPost> {
  const users = new Map<string, JsonRecord>();
  for (const rawUser of body.users) {
    const user = asRecord(rawUser);
    const id = stringValue(user?.id);
    if (id && user) users.set(id, user);
  }

  const posts = new Map<string, XPost>();
  for (const rawPost of body.data) {
    const post = asRecord(rawPost);
    const id = stringValue(post?.id);
    const authorId = stringValue(post?.author_id);
    if (!post || !id || !requested.has(id) || !authorId) continue;
    const author = users.get(authorId);
    const handle = typeof author?.username === "string" ? author.username : null;
    const name = typeof author?.name === "string" ? author.name : null;
    if (!author || !handle?.trim() || !name?.trim()) continue;

    // A long post's whole text. X's guides call the field note_tweet and its reference note_post.
    const noteText = (asRecord(post.note_tweet) ?? asRecord(post.note_post))?.text;
    const text = typeof noteText === "string" ? noteText : typeof post.text === "string" ? post.text : null;
    if (text === null) continue;

    const metrics = asRecord(post.public_metrics);
    const authorMetrics = asRecord(author.public_metrics);
    const impressions = metric(metrics?.impression_count);
    posts.set(id, {
      id,
      text: unescapeText(text),
      createdAt: typeof post.created_at === "string" ? post.created_at : null,
      handle: handle.toLowerCase(),
      name: unescapeText(name),
      followers: metric(authorMetrics?.followers_count),
      likes: metric(metrics?.like_count),
      reposts: metric(metrics?.retweet_count),
      replies: metric(metrics?.reply_count),
      views: impressions !== null && impressions > 0 ? impressions : null,
    });
  }
  return posts;
}

function goneIds(body: { data: unknown[]; errors: unknown[]; users: unknown[] }, requested: ReadonlySet<string>): Set<string> {
  const gone = new Set<string>();
  for (const rawError of body.errors) {
    const error = asRecord(rawError);
    if (error?.resource_type !== "tweet") continue;
    const id = stringValue(error.resource_id) ?? stringValue(error.value);
    if (id && requested.has(id)) gone.add(id);
  }
  return gone;
}

function requestUrl(ids: readonly string[]): string {
  return `${BASE_URL}?ids=${ids.join(",")}&tweet.fields=created_at,public_metrics,author_id,note_tweet&expansions=author_id&user.fields=username,name,public_metrics`;
}

function validIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !/^\d{1,25}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** Reads requested X post ids only; it never discovers posts or follows redirects. */
export function createXPostReader(options: XPostReaderOptions = {}): XPostReader {
  const env = options.env ?? process.env;
  const token = env.X_BEARER_TOKEN?.trim() ?? "";
  const fetchFn = options.fetch ?? defaultFetch;
  const now = options.now ?? (() => new Date());
  const allowance = dailyLimit(env.X_POSTS_PER_DAY);
  const answers = new Map<string, Answer>();
  let day = "";
  let spent = 0;
  let refused = false;
  let rateLimitedUntil = 0;
  let readTail: Promise<void> = Promise.resolve();

  const rollDay = (): void => {
    const today = now().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      spent = 0;
      answers.clear();
    }
  };
  const leftToday = (): number => {
    rollDay();
    return Math.max(0, allowance - spent);
  };

  async function read(ids: readonly string[], signal?: AbortSignal): Promise<{ posts: Map<string, XPost>; gone: Set<string> }> {
    const ordered = validIds(ids);
    const posts = new Map<string, XPost>();
    const gone = new Set<string>();
    if (!token || ordered.length === 0) return { posts, gone };

    const operation = readTail.then(async () => {
      rollDay();
      for (const id of ordered) {
        const answer = answers.get(id);
        if (answer === GONE) gone.add(id);
        else if (answer) posts.set(id, { ...answer });
      }

      const pending = ordered.filter((id) => !answers.has(id));
      let offset = 0;
      while (offset < pending.length && !refused && !signal?.aborted) {
        rollDay();
        if (now().getTime() < rateLimitedUntil) break;
        const count = Math.min(MAX_IDS, leftToday(), pending.length - offset);
        if (count === 0) break;
        const batch = pending.slice(offset, offset + count);
        offset += batch.length;
        // Counted before the request leaves. A request that times out or comes back unreadable
        // may still have been billed, so only an answer X itself says it did not serve is given back.
        const countedOn = day;
        spent += batch.length;
        const giveBack = (): void => {
          if (day === countedOn) spent = Math.max(0, spent - batch.length);
        };

        let response: Response;
        try {
          const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
          const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
          response = await fetchFn(requestUrl(batch), {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            credentials: "omit",
            redirect: "error",
            signal: requestSignal,
          });
        } catch {
          if (signal?.aborted) break;
          continue;
        }

        if (response.status === 401 || response.status === 403) {
          refused = true;
          giveBack();
          await response.body?.cancel().catch(() => undefined);
          break;
        }
        if (response.status === 429) {
          giveBack();
          const resetHeader = response.headers.get("x-rate-limit-reset");
          const reset = resetHeader === null || resetHeader.trim() === "" ? Number.NaN : Number(resetHeader);
          rateLimitedUntil = Number.isFinite(reset) ? reset * 1_000 : Number.POSITIVE_INFINITY;
          await response.body?.cancel().catch(() => undefined);
          break;
        }
        if (response.status !== 200) {
          await response.body?.cancel().catch(() => undefined);
          continue;
        }

        const parsed = expectedBody(await readJsonBody(response));
        if (!parsed) continue;

        const requested = new Set(batch);
        const returnedPosts = mapPosts(parsed, requested);
        const returnedGone = goneIds(parsed, requested);
        for (const [id, post] of returnedPosts) {
          if (returnedGone.has(id)) continue;
          answers.set(id, post);
          posts.set(id, { ...post });
        }
        for (const id of returnedGone) {
          answers.set(id, GONE);
          posts.delete(id);
          gone.add(id);
        }
      }

      return { posts, gone };
    });
    readTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return {
    async status() {
      const configured = token.length > 0;
      const detail = !configured
        ? "No X API token is set, so posts are not read through X's own API."
        : refused
          ? "X refused the API token, so no post is read until the server is restarted with one it accepts."
          : `X's API is connected. ${leftToday()} of ${allowance} posts left today (X_POSTS_PER_DAY).`;
      return { configured, detail };
    },
    read(ids, options) {
      return read(ids, options?.signal);
    },
  };
}
