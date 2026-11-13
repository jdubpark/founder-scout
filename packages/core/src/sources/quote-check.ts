import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isNeverFetchHost, type QuoteStatus } from "@agentswarm/shared";
import type { QuoteChecker } from "../contracts";
import { defaultFetch, USER_AGENT, type FetchFn } from "./http";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const ACCEPT = "text/html, application/xhtml+xml, text/plain, text/markdown, application/json;q=0.9, */*;q=0.1";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const READABLE_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown",
  "application/json",
]);

export interface QuoteCheckOptions {
  fetchFn?: FetchFn;
  resolveHost?: (hostname: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
}

type CheckResult = { status: QuoteStatus; detail: string };
type ReadableAddressRule = (url: URL) => string | null;

const READABLE_ADDRESS_RULES: ReadableAddressRule[] = [
  // Hacker News item pages are blocked to automated readers, so use Algolia's JSON copy of the item and comments.
  (url) => {
    if (url.hostname.toLowerCase().replace(/\.$/u, "") !== "news.ycombinator.com" || url.pathname !== "/item") return null;
    const id = url.searchParams.get("id");
    return id && /^\d+$/u.test(id) ? `https://hn.algolia.com/api/v1/items/${id}` : null;
  },
  // GitHub blob views are rendered by script, while the raw host serves the file text directly.
  (url) => {
    if (url.hostname.toLowerCase().replace(/\.$/u, "") !== "github.com") return null;
    const parts = url.pathname.split("/");
    if (!(parts.length >= 6 && parts[1] && parts[2] && parts[3] === "blob" && parts[4] && parts.slice(5).some(Boolean))) {
      return null;
    }
    const rawPath = [parts[1], parts[2], parts[4], ...parts.slice(5)].join("/");
    return `https://raw.githubusercontent.com/${rawPath}`;
  },
  // arXiv PDF requests are changed to the readable abstract page; paper-body quotes may not be present there.
  (url) => {
    if (url.hostname.toLowerCase().replace(/\.$/u, "") !== "arxiv.org" || !url.pathname.startsWith("/pdf/")) return null;
    const id = url.pathname.slice("/pdf/".length).replace(/\.pdf$/iu, "");
    return id && !id.endsWith("/") ? `https://arxiv.org/abs/${id}` : null;
  },
];

export function createQuoteChecker(options: QuoteCheckOptions = {}): QuoteChecker {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const resolveHost = options.resolveHost ?? (async (hostname: string) =>
    (await lookup(hostname, { all: true })).map((entry) => entry.address));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return {
    async check(urlText, excerpt, callerSignal) {
      throwIfAborted(callerSignal);
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;

      try {
        let currentUrl = urlText;
        let redirects = 0;
        let response: Response;

        while (true) {
          const addressProblem = await validateAddress(currentUrl, resolveHost);
          throwIfAborted(callerSignal);
          if (addressProblem) return unreachable(addressProblem);

          const readableUrl = readableAddress(currentUrl);
          if (readableUrl !== currentUrl) {
            currentUrl = readableUrl;
            continue;
          }

          response = await fetchFn(currentUrl, {
            method: "GET",
            redirect: "manual",
            headers: { "User-Agent": USER_AGENT, Accept: ACCEPT },
            signal,
          });

          if (!REDIRECT_STATUSES.has(response.status)) break;
          if (redirects >= 3) return unreachable("The page redirects too many times.");
          const location = response.headers.get("location");
          if (!location) return unreachable("The page returned a redirect without a destination.");

          try {
            currentUrl = new URL(location, currentUrl).href;
          } catch {
            return unreachable("The page returned an invalid redirect address.");
          }
          redirects += 1;
        }

        throwIfAborted(callerSignal);
        if (response.status !== 200) return unreachable(`The page returned HTTP ${response.status}.`);

        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (!READABLE_TYPES.has(contentType)) return unreachable("The page is not in a readable text format.");

        const body = await readLimitedBody(response, maxBytes);
        throwIfAborted(callerSignal);
        const pageTexts = pageTextsForBody(contentType, body);
        const pages = pageTexts.map(comparisonForm);
        const readableLength = pages.reduce((total, text) => total + text.length, 0);
        const fragments = excerpt
          .split(/\.\.\.|…|\[\.\.\.\]/u)
          .map(comparisonForm)
          .filter((fragment) => fragment.split(" ").filter(Boolean).length >= 4);

        if (fragments.length === 0) return unreachable("The quote is too short to check.");

        const missing = fragments.filter((fragment) => !pages.some((page) => fragmentMatches(page, fragment))).length;
        if (missing === 0) return { status: "found", detail: "The quoted text appears on the page." };
        if (readableLength < 1_500) {
          return unreachable("The page has too little readable text to check a quote against.");
        }
        return {
          status: "not_found",
          detail: `${missing} of ${fragments.length} quoted fragments were not found on the page.`,
        };
      } catch (error) {
        if (callerSignal?.aborted) throw error;
        if (timeout.aborted) return unreachable("The page request timed out.");
        return unreachable("The page could not be reached.");
      }
    },
  };
}

function readableAddress(text: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return text;
  }

  for (const rule of READABLE_ADDRESS_RULES) {
    const readable = rule(url);
    if (readable) return readable;
  }
  return text;
}

function pageTextsForBody(contentType: string, body: string): string[] {
  if (contentType === "text/html" || contentType === "application/xhtml+xml") return [htmlToText(body)];
  if (contentType !== "application/json") return [body];

  try {
    return collectStringValues(JSON.parse(body) as unknown).map(htmlToText);
  } catch {
    return [body];
  }
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(collectStringValues);
  return [];
}

async function validateAddress(
  text: string,
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<string | null> {
  if (!/^https?:\/\//iu.test(text)) return "The address must use HTTP or HTTPS.";

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "The address is invalid.";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return "The address must use HTTP or HTTPS.";
  if (url.username || url.password) return "The address must not include a user name or password.";
  if (url.port) return "The address must use the default port for its scheme.";

  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  if (isNeverFetchHost(hostname)) return "This address is never requested.";
  if (isLocalHostname(hostname)) return "The address points to a local network host.";

  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) {
    return isRestrictedIp(hostname) ? "The address points to a restricted network range." : null;
  }

  try {
    const addresses = await resolveHost(hostname);
    if (addresses.length === 0 || addresses.some(isRestrictedIp)) {
      return "The address does not resolve only to public network addresses.";
    }
  } catch {
    return "The address could not be verified as public.";
  }
  return null;
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  return host === "localhost" || [".localhost", ".local", ".internal"].some((suffix) => host.endsWith(suffix));
}

function isRestrictedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isRestrictedIpv4(address);
  if (version !== 6) return true;

  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const [byte0, byte1, byte2, byte3] = bytes as [number, number, number, number, ...number[]];
  if (bytes.every((byte) => byte === 0)) return true;
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true;
  if (byte0 === 0xfc || byte0 === 0xfd) return true;
  if (byte0 === 0xfe && (byte1 & 0xc0) === 0x80) return true;
  if (byte0 === 0xff) return true;
  if (byte0 === 0x20 && byte1 === 0x01 && byte2 === 0x0d && byte3 === 0xb8) return true;
  if (byte0 === 0x3f && byte1 === 0xff && (byte2 & 0xf0) === 0) return true;

  const isMapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  return isMapped && isRestrictedIpv4(bytes.slice(12).join("."));
}

function isRestrictedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function ipv6Bytes(address: string): number[] | null {
  const normalized = address.toLowerCase().split("%", 1)[0];
  if (!normalized) return null;
  let expanded = normalized;
  const ipv4Tail = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/u.exec(expanded)?.[1];
  if (ipv4Tail) {
    const parts = ipv4Tail.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const [first, second, third, fourth] = parts as [number, number, number, number];
    const tail = `${((first << 8) | second).toString(16)}:${((third << 8) | fourth).toString(16)}`;
    expanded = expanded.replace(ipv4Tail, tail);
  }

  const halves = expanded.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[\da-f]{1,4}$/u.test(part))) return null;
  return groups.flatMap((part) => {
    const value = Number.parseInt(part, 16);
    return [value >> 8, value & 0xff];
  });
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body || maxBytes <= 0) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const keep = value.subarray(0, Math.min(value.byteLength, maxBytes - total));
      chunks.push(keep);
      total += keep.byteLength;
      if (keep.byteLength < value.byteLength) break;
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

function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu, " ");
  return decodeEntities(withoutBlocks.replace(/<[^>]*>/gu, " "));
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    agrave: "à", aacute: "á", amp: "&", apos: "'", bull: "•", ccedil: "ç", copy: "©", eacute: "é",
    egrave: "è", euro: "€", gt: ">", hellip: "…", laquo: "«", ldquo: "“", lsquo: "‘", lt: "<",
    mdash: "—", middot: "·", nbsp: " ", ndash: "–", oacute: "ó", ouml: "ö", pound: "£", quot: '"',
    raquo: "»", reg: "®", rdquo: "”", rsquo: "’", trade: "™", uacute: "ú", uuml: "ü",
  };
  return text.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/giu, (entity, name: string) => {
    if (name[0] !== "#") return named[name.toLowerCase()] ?? entity;
    const hex = name[1]?.toLowerCase() === "x";
    const codePoint = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return "�";
    }
    return String.fromCodePoint(codePoint);
  });
}

function comparisonForm(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function fragmentMatches(page: string, fragment: string): boolean {
  if (page.includes(fragment)) return true;
  const words = fragment.split(" ");
  if (words.length < 5) return false;
  const shingles = Array.from({ length: words.length - 4 }, (_, index) => words.slice(index, index + 5).join(" "));
  const found = shingles.filter((shingle) => page.includes(shingle)).length;
  return found / shingles.length >= 0.85;
}

function unreachable(detail: string): CheckResult {
  return { status: "unreachable", detail };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    if (signal.reason !== undefined) throw signal.reason;
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}
