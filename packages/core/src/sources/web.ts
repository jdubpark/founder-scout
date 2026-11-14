import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { cleanUrl, hostOf, isProfessionalNetworkHost } from "@agentswarm/shared";
import type { PageLink } from "@agentswarm/shared";
import type { PageRead, WebReader } from "../contracts";
import { createPinnedLookup, isRestrictedIp, pinnedFetch, readableAddress } from "./quote-check";
import { defaultFetch, type FetchFn } from "./http";
import { linkedInSessionPoolFor, type LinkedInAccount } from "./sessions";
import { cleanPlain, decodeEntities, htmlToText } from "./util";

const DEFAULT_USER_AGENT = "web-reader/1.0";
/** The least time between two requests to one host. robots.txt is not read and not obeyed. */
export const DEFAULT_GAP_MS = 2_000;
const MAX_PAGE_BYTES = 1_500_000;
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// The professional network throttles with HTTP 999.
const REFUSALS = new Set([401, 403, 407, 429, 451, 999]);

export type WebAddressCheck =
  | { url: string; addresses: string[] }
  | { kind: "blocked" | "unreachable"; detail: string };

export interface WebSafetyReader {
  /** Apply the same named-public-host, DNS and restricted-address checks as page reads. */
  checkAddress(raw: string): Promise<WebAddressCheck>;
  /** Serialize requests to one host using the page reader's timing state. */
  withHostGap<T>(hostname: string, gapMs: number, run: () => Promise<T>): Promise<T>;
}

export interface WebReaderOptions {
  userAgent?: string;
  resolveHost?: (hostname: string) => Promise<string[]>;
  fetch?: FetchFn;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  /** Allows a resolver supplied by a test to route a named host to loopback. */
  allowLoopbackForTests?: boolean;
  /** Logged-in accounts for the professional network. No other host is sent a cookie or their agent. */
  accounts?: readonly LinkedInAccount[];
  /** A proxy every read may tunnel through, unless the professional network account carries its own. */
  proxyUrl?: string | null;
}

interface ReadResponse {
  kind: "response" | "blocked" | "unreachable";
  detail: string;
  response?: Response;
  body?: string;
  truncated?: boolean;
  finalUrl?: string;
  /** The pool account used on the final request, when one was, so a refusal can cool it. */
  sessionIndex?: number;
}

interface HostTail {
  tail: Promise<void>;
}

/** How a reader names itself to a site. */
export function readerIdentity(userAgent?: string): { userAgent: string; productToken: string } {
  const name = userAgent?.trim() || DEFAULT_USER_AGENT;
  return { userAgent: name, productToken: (name.split(/[\s/]/u)[0] || DEFAULT_USER_AGENT.split("/")[0]!).toLowerCase() };
}

export function createWebReader(options: WebReaderOptions = {}): WebReader & WebSafetyReader {
  const { userAgent } = readerIdentity(options.userAgent);
  const resolveHost = options.resolveHost ?? (async (hostname: string) => (await lookup(hostname, { all: true })).map((entry) => entry.address));
  const fetchFn = options.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = options.timeoutMs ?? 15_000;
  const hostTails = new Map<string, HostTail>();
  const hostStartedAt = new Map<string, number>();
  const accountPool = options.accounts && options.accounts.length > 0 ? linkedInSessionPoolFor(options.accounts, options.now) : null;

  async function checkAddress(raw: string): Promise<WebAddressCheck> {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { kind: "blocked", detail: "This address is not a readable public web address." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { kind: "blocked", detail: "This address must use HTTP or HTTPS." };
    }
    if (parsed.username || parsed.password) {
      return { kind: "blocked", detail: "This address must not include a user name or password." };
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/gu, "").toLowerCase().replace(/\.$/u, "");
    const cleaned = cleanUrl(raw);
    if (!cleaned) return { kind: "blocked", detail: "This address is not a readable public web address." };

    let addresses: string[];
    try {
      addresses = isIP(hostname) === 0 ? await resolveHost(hostname) : [hostname];
    } catch {
      return { kind: "unreachable", detail: "The address could not be resolved." };
    }
    if (addresses.length === 0) return { kind: "unreachable", detail: "The address did not resolve." };
    const onlyTestLoopback = options.allowLoopbackForTests === true && addresses.every(isLoopback);
    if (!onlyTestLoopback && addresses.some(isRestrictedIp)) {
      return { kind: "blocked", detail: "This address resolves to a restricted network address." };
    }
    return { url: cleaned, addresses };
  }

  async function validate(raw: string): Promise<{ url: string; addresses: string[] } | ReadResponse> {
    const checked = await checkAddress(raw);
    return "kind" in checked ? { kind: checked.kind, detail: checked.detail } : checked;
  }

  async function withHost<T>(hostname: string, gapMs: number, run: () => Promise<T>): Promise<T> {
    const previous = hostTails.get(hostname)?.tail ?? Promise.resolve();
    let release!: () => void;
    const own = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => own);
    hostTails.set(hostname, { tail });
    await previous;
    try {
      const startedAt = hostStartedAt.get(hostname);
      if (startedAt !== undefined) {
        const remaining = startedAt + gapMs - now();
        if (remaining > 0) await sleep(remaining);
      }
      hostStartedAt.set(hostname, now());
      return await run();
    } finally {
      release();
      if (hostTails.get(hostname)?.tail === tail) hostTails.delete(hostname);
    }
  }

  async function fetchText(
    rawUrl: string,
    maxBytes: number,
    callerSignal?: AbortSignal,
    allowJson = false,
  ): Promise<ReadResponse> {
    let current = rawUrl;
    let redirects = 0;
    const visited = new Set<string>();
    // One account for the whole chain, picked when it first reaches the professional network: a
    // person following a redirect keeps one session.
    let chainAccount: { index: number; account: LinkedInAccount } | null = null;
    while (true) {
      const checked = await validate(current);
      if ("kind" in checked) return checked;
      current = checked.url;
      if (visited.has(current)) return { kind: "unreachable", detail: "The address redirected in a loop." };
      visited.add(current);

      const host = hostOf(current);
      if (!host) return { kind: "blocked", detail: "This address is not a readable public web address." };
      // A resting account defers the read, and no host other than the network's own is ever sent a cookie.
      const pool = accountPool !== null && isProfessionalNetworkHost(host) ? accountPool : null;
      if (pool && !chainAccount) {
        chainAccount = pool.pick();
        if (!chainAccount) {
          return { kind: "blocked", detail: pool.restingDetail() ?? "Every account asked for a pause." };
        }
      }
      const account = chainAccount && isProfessionalNetworkHost(host) ? chainAccount : null;

      const proxyUrl = account ? account.account.proxyUrl ?? options.proxyUrl : options.proxyUrl;
      try {
        // A professional-network read waits out a human dwell first, on top of the reader's own gap.
        const gapMs = account && pool ? Math.max(DEFAULT_GAP_MS, pool.dwellMs()) : DEFAULT_GAP_MS;
        const outcome = await withHost(host, gapMs, async () => {
          const timeout = AbortSignal.timeout(timeoutMs);
          const signal = callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;
          const request = fetchFn ?? ((url, init) => pinnedFetch(url, init, checked.addresses, proxyUrl ?? undefined));
          const response = await request(current, {
            method: "GET",
            headers: {
              "User-Agent": account?.account.userAgent ?? userAgent,
              Accept: "text/html, text/plain;q=0.9",
              ...(account ? { Cookie: account.account.cookie } : {}),
            },
            redirect: "manual",
            signal,
          });
          if (REDIRECTS.has(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel().catch(() => undefined);
            return { redirect: location } as const;
          }
          const contentType = response.headers.get("content-type") ?? "";
          if (response.status < 200 || response.status >= 300) {
            await response.body?.cancel().catch(() => undefined);
            return { response, body: "", truncated: false } as const;
          }
          if (!isReadableContentType(contentType) && !(allowJson && contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json")) {
            await response.body?.cancel().catch(() => undefined);
            return { response, body: "", truncated: false } as const;
          }
          const body = await readLimitedBody(response, maxBytes);
          return { response, ...body } as const;
        });
        if ("redirect" in outcome) {
          if (!outcome.redirect) return { kind: "response", detail: "", response: new Response(null, { status: 302 }), body: "", finalUrl: current };
          if (redirects >= MAX_REDIRECTS) return { kind: "unreachable", detail: "The page redirected too many times." };
          let next: URL;
          try {
            next = new URL(outcome.redirect, current);
          } catch {
            return { kind: "unreachable", detail: "The page returned an invalid redirect address." };
          }
          current = next.href;
          redirects += 1;
          continue;
        }
        return { kind: "response", detail: "", response: outcome.response, body: outcome.body, truncated: outcome.truncated, finalUrl: current, ...(account ? { sessionIndex: account.index } : {}) };
      } catch (error) {
        return { kind: "unreachable", detail: timeoutDetail(error) };
      }
    }
  }

  return {
    checkAddress,
    withHostGap: withHost,
    async read(rawUrl, readOptions): Promise<PageRead> {
      const input = cleanUrl(rawUrl);
      const baseUrl = input ?? rawUrl;
      if (!input) {
        return pageResult("blocked", "This address is not a readable public web address.", baseUrl);
      }
      if (readOptions?.signal?.aborted) return pageResult("unreachable", "The page request was cancelled.", baseUrl);

      const standIn = readableAddress(input);
      const requestUrl = standIn?.url ?? input;
      const isHnStandIn = standIn?.url.includes("hn.algolia.com/api/v1/items/") ?? false;
      const result = await fetchText(requestUrl, MAX_PAGE_BYTES, readOptions?.signal, isHnStandIn);
      if (result.kind !== "response") return pageResult(result.kind, result.detail, baseUrl);
      if (!result.response) return pageResult("unreachable", "The page could not be reached.", baseUrl);

      const status = result.response.status;
      // A page an account opened counts against its day. A network refusal rests the account
      // until its next workday, so later reads rotate to another one.
      if (result.sessionIndex !== undefined) {
        if (REFUSALS.has(status)) accountPool?.cool(result.sessionIndex);
        else accountPool?.noteRead(result.sessionIndex);
      }
      if ((status === 429 || status === 503) && result.response.headers.has("retry-after")) {
        return pageResult("blocked", retryAfterDetail(result.response, now()) ?? `The site answered HTTP ${status}.`, baseUrl);
      }
      if (REFUSALS.has(status)) return pageResult("blocked", `The site answered HTTP ${status}.`, baseUrl);
      if (status < 200 || status >= 300) return pageResult("unreachable", `The site answered HTTP ${status}.`, baseUrl);
      const contentType = result.response.headers.get("content-type") ?? "";
      if (isHnStandIn) {
        return renderHackerNewsItem(result.body ?? "", baseUrl);
      }
      if (!isReadableContentType(contentType)) return pageResult("not_text", "The site answered with a non-text content type.", baseUrl);

      const finalUrl = standIn ? baseUrl : result.finalUrl ?? baseUrl;
      // The professional network serves its login wall here, usually via redirect. The page
      // served on it is the wall, not the page asked for.
      if (finalUrl.includes("/authwall")) return pageResult("blocked", "The page is behind a login wall.", baseUrl);
      const body = result.body ?? "";
      const html = isHtml(contentType);
      const safeHtml = html ? stripUnsafeBlocks(body) : "";
      const text = cleanPlain(html ? htmlToText(safeHtml) : body, 12_000);
      if (text.length < 80) return pageResult("unreachable", "Too little text to read.", finalUrl);
      return {
        status: "ok",
        detail: "Page read.",
        url: finalUrl,
        title: html ? extractTitle(safeHtml) : "",
        text,
        links: html ? extractLinks(safeHtml, finalUrl, input) : [],
        html: readOptions?.html === true ? body : null,
      };
    },
  };
}

function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isHtml(contentType: string): boolean {
  const value = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return value === "text/html" || value === "application/xhtml+xml";
}

function isReadableContentType(contentType: string): boolean {
  const value = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return value === "text/html" || value === "application/xhtml+xml" || value === "text/plain";
}

function pageResult(status: PageRead["status"], detail: string, url: string): PageRead {
  return { status, detail, url, title: "", text: "", links: [] };
}

function timeoutDetail(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "The page request timed out.";
  return "The page could not be reached.";
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  if (!response.body) return { body: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const keep = value.subarray(0, Math.min(value.byteLength, maxBytes - total));
      if (keep.byteLength) chunks.push(keep);
      total += keep.byteLength;
      if (keep.byteLength < value.byteLength || total === maxBytes) {
        truncated = true;
        break;
      }
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
  return { body: new TextDecoder().decode(bytes), truncated };
}

function retryAfterDetail(response: Response, nowMs: number): string | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const numeric = Number(header.trim());
  const waitSeconds = Number.isFinite(numeric) && numeric >= 0
    ? Math.ceil(numeric)
    : Math.max(0, Math.ceil((Date.parse(header) - nowMs) / 1000));
  if (!Number.isFinite(waitSeconds)) return null;
  return `The site asked for a pause of ${waitSeconds} seconds.`;
}

export function stripUnsafeBlocks(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu, " ");
}

export function extractTitle(html: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html);
  return cleanPlain(decodeEntities((match?.[1] ?? "").replace(/<[^>]*>/gu, " ")), 200);
}

/** Menus, mastheads and footers: the links there are the site's, not the page's. */
const CHROME = /<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
/** Fewer content links than this and the page is read whole: it may be nothing but a menu of what matters. */
const MIN_CONTENT_LINKS = 5;

/**
 * The page's links, numbered. A runner sees at most sixty, in page order, so on a site with a
 * long menu the first sixty would all be the menu. Links inside the page's own content are
 * taken first: the menu, masthead, footer and sidebars are left out unless the content has
 * almost no links of its own.
 */
export function extractLinks(html: string, baseUrl: string, inputUrl: string): PageLink[] {
  const content = linksIn(html.replace(CHROME, " "), baseUrl, inputUrl);
  return content.length >= MIN_CONTENT_LINKS ? content : linksIn(html, baseUrl, inputUrl);
}

function linksIn(html: string, baseUrl: string, inputUrl: string): PageLink[] {
  const self = new Set([cleanUrl(baseUrl), cleanUrl(inputUrl)].filter((url): url is string => url !== null));
  const seen = new Set<string>(self);
  const links: PageLink[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)) {
    const attrs = match[1] ?? "";
    const hrefMatch = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(attrs);
    const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3];
    if (!href) continue;
    let resolved: string;
    try { resolved = new URL(decodeEntities(href), baseUrl).href; } catch { continue; }
    const url = cleanUrl(resolved);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const text = cleanPlain(htmlToText(match[2] ?? ""), 120);
    links.push({ index: links.length, url, text });
    if (links.length >= 60) break;
  }
  return links;
}

function renderHackerNewsItem(body: string, url: string): PageRead {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    data = parsed as Record<string, unknown>;
  } catch {
    return pageResult("unreachable", "The Hacker News page could not be read.", url);
  }
  const title = typeof data.title === "string" ? cleanPlain(data.title, 200) : "";
  const author = typeof data.author === "string" ? cleanPlain(data.author, 200) : "";
  const story = typeof data.text === "string" ? cleanPlain(htmlToText(data.text)) : "";
  const children = Array.isArray(data.children) ? data.children : [];
  const comments = children.flatMap((child) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) return [];
    const text = (child as Record<string, unknown>).text;
    return typeof text === "string" && text.trim() ? [cleanPlain(htmlToText(text))] : [];
  });
  const rendered = cleanPlain([title, author ? `Author: ${author}` : "", story, ...comments.map((comment) => `Comment: ${comment}`)].filter(Boolean).join("\n\n"), 12_000);
  if (rendered.length < 80) return pageResult("unreachable", "Too little text to read.", url);
  // What the post links to is where its author's work is: the story's own link, then the
  // links in the post's text. Links in other people's comments are left out.
  const storyLink = typeof data.url === "string" && data.url.trim() ? `<a href="${data.url.trim().replace(/"/gu, "%22")}">${title}</a>` : "";
  const links = linksIn(`${storyLink} ${typeof data.text === "string" ? data.text : ""}`, url, url);
  return { status: "ok", detail: "Page read.", url, title, text: rendered, links };
}
