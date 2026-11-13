/**
 * Small helpers shared by the live source adapters: text cleaning, time
 * windows and the time-ordered cursor the feed-style sources use.
 */

export const MAX_TEXT_CHARS = 4000;
export const DEFAULT_WINDOW_MS = 36 * 60 * 60 * 1000;
const CURSOR_ID_LIMIT = 500;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decodes numeric and the common named entities in one pass, so `&amp;lt;` becomes `&lt;`. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = isHex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/**
 * Removes HTML tags, keeping paragraph and line breaks, then decodes entities.
 *
 * An opening paragraph tag is a break too. Hacker News writes "first.<p>Second" with no
 * closing tag, and dropping the tag glues the two sentences, and any link before it, together.
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*p(\s[^>]*)?>/gi, "\n\n")
    .replace(/<\/(p|div|li|h[1-6]|pre|blockquote)\s*>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, "");
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, ""));
}

/** Collapses whitespace on each line and trims the result to `max` characters. */
export function cleanPlain(input: string, max = MAX_TEXT_CHARS): string {
  const collapsed = input
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed;
}

/** For HTML input: strip tags, decode entities, then tidy and trim. */
export function cleanText(input: string, max = MAX_TEXT_CHARS): string {
  return cleanPlain(htmlToText(input), max);
}

/** A term safe to place inside a search query: no quotes, backslashes or control characters. */
export function cleanQueryTerm(term: string | null | undefined, maxLength = 100): string | null {
  if (!term) return null;
  const cleaned = term
    .replace(/["\\\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Start of the window: the request's `since` when it parses, else 36 hours before now. */
export function windowStartMs(since: string | null, nowMs: number): number {
  const parsed = since ? Date.parse(since) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : nowMs - DEFAULT_WINDOW_MS;
}

/**
 * Cursor for feeds ordered by time. `after` is the newest timestamp already
 * delivered (epoch milliseconds); `ids` are the keys delivered at exactly that
 * time, so an item sharing the timestamp is not returned twice.
 */
export interface TimeCursor {
  after: number;
  ids: string[];
}

export function parseTimeCursor(raw: unknown): TimeCursor | null {
  const record = asRecord(raw);
  if (
    !record ||
    typeof record.after !== "number" ||
    !Number.isFinite(record.after) ||
    !Array.isArray(record.ids) ||
    !record.ids.every((id) => typeof id === "string")
  ) {
    return null;
  }
  return { after: record.after, ids: [...(record.ids as string[])] };
}

export function isAfterCursor(cursor: TimeCursor | null, timeMs: number, key: string): boolean {
  if (!cursor) return true;
  if (timeMs !== cursor.after) return timeMs > cursor.after;
  return !cursor.ids.includes(key);
}

/** The cursor after delivering `delivered`. Returns `prev` unchanged when nothing was delivered. */
export function advanceCursor(
  prev: TimeCursor | null,
  delivered: Array<{ key: string; timeMs: number }>,
): TimeCursor | null {
  if (delivered.length === 0) return prev;
  const newest = Math.max(...delivered.map((item) => item.timeMs));
  const ids = delivered.filter((item) => item.timeMs === newest).map((item) => item.key);
  if (prev && prev.after === newest) ids.push(...prev.ids);
  return { after: newest, ids: [...new Set(ids)].slice(-CURSOR_ID_LIMIT) };
}
