import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { cleanUrl, hostOf, isNeverFetchHost, isOffLimitsHost, termsBar } from "@agentswarm/shared";
import type { PageLink } from "@agentswarm/shared";
import type { PageRead, WebReader } from "../contracts";
import { createPinnedLookup, isRestrictedIp, pinnedFetch, readableAddress } from "./quote-check";
import { defaultFetch, type FetchFn } from "./http";
import { cleanPlain, decodeEntities, htmlToText } from "./util";

export const DEFAULT_USER_AGENT = "web-reader/1.0";
const DEFAULT_GAP_MS = 2_000;
const MAX_GAP_MS = 60_000;
const MAX_PAGE_BYTES = 1_500_000;
const MAX_ROBOTS_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;
const ROBOTS_TTL_MS = 60 * 60 * 1000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const REFUSALS = new Set([401, 403, 407, 429, 451]);

export type WebAddressCheck =
  | { url: string; addresses: string[] }
  | { kind: "blocked" | "unreachable"; detail: string };

export interface WebSafetyReader {
  /** Apply the same named-public-host, deny-list, DNS and restricted-address checks as page reads. */
  checkAddress(raw: string): Promise<WebAddressCheck>;
  /** Apply the cached RFC 9309 policy and return the request spacing it requires. */
  robotsDecision(url: string, signal?: AbortSignal): Promise<{ allowed: boolean; detail: string; gapMs: number }>;
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
}

interface RobotsRule {
  allow: boolean;
  path: string;
}

interface RobotsPolicy {
  allowed: boolean;
  blockedDetail: string;
  rules: RobotsRule[];
  crawlDelayMs: number;
}

interface ReadResponse {
  kind: "response" | "blocked" | "unreachable";
  detail: string;
  response?: Response;
  body?: string;
  truncated?: boolean;
  finalUrl?: string;
}

interface HostTail {
  tail: Promise<void>;
}

export function createWebReader(options: WebReaderOptions = {}): WebReader & WebSafetyReader {
  const userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT;
  const productToken = (userAgent.split(/[\s/]/u)[0] || DEFAULT_USER_AGENT.split("/")[0]!).toLowerCase();
  const resolveHost = options.resolveHost ?? (async (hostname: string) => (await lookup(hostname, { all: true })).map((entry) => entry.address));
  const fetchFn = options.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = options.timeoutMs ?? 15_000;
  const robots = new Map<string, { expiresAt: number; promise: Promise<RobotsPolicy> }>();
  const hostTails = new Map<string, HostTail>();
  const hostStartedAt = new Map<string, number>();

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
    if (isNeverFetchHost(hostname)) return { kind: "blocked", detail: "This address is never requested." };
    const barred = termsBar(hostname);
    if (isOffLimitsHost(hostname)) return { kind: "blocked", detail: `${barred?.host ?? hostname} does not allow automated reading.` };
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
    followRobots: boolean,
    maxBytes: number,
    callerSignal?: AbortSignal,
    allowJson = false,
  ): Promise<ReadResponse> {
    let current = rawUrl;
    let redirects = 0;
    const visited = new Set<string>();
    while (true) {
      const checked = await validate(current);
      if ("kind" in checked) return checked;
      current = checked.url;
      if (visited.has(current)) return { kind: "unreachable", detail: "The address redirected in a loop." };
      visited.add(current);

      let crawlDelayMs = DEFAULT_GAP_MS;
      if (followRobots) {
        const decision = await robotsDecision(current, callerSignal);
        if (!decision.allowed) return { kind: "blocked", detail: decision.detail };
        crawlDelayMs = decision.gapMs;
      }

      const host = hostOf(current);
      if (!host) return { kind: "blocked", detail: "This address is not a readable public web address." };
      try {
        const outcome = await withHost(host, crawlDelayMs, async () => {
          const timeout = AbortSignal.timeout(timeoutMs);
          const signal = callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;
          const request = fetchFn ?? ((url, init) => pinnedFetch(url, init, checked.addresses));
          const response = await request(current, {
            method: "GET",
            headers: { "User-Agent": userAgent, Accept: "text/html, text/plain;q=0.9" },
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
        return { kind: "response", detail: "", response: outcome.response, body: outcome.body, truncated: outcome.truncated, finalUrl: current };
      } catch (error) {
        return { kind: "unreachable", detail: timeoutDetail(error) };
      }
    }
  }

  async function robotsPolicy(rawUrl: string, callerSignal?: AbortSignal): Promise<RobotsPolicy> {
    const url = new URL(rawUrl);
    const origin = url.origin;
    const cached = robots.get(origin);
    if (cached && cached.expiresAt > now()) return cached.promise;
    const promise = loadRobots(origin, callerSignal);
    robots.set(origin, { expiresAt: now() + ROBOTS_TTL_MS, promise });
    return promise;
  }

  async function loadRobots(origin: string, callerSignal?: AbortSignal): Promise<RobotsPolicy> {
    const result = await fetchText(`${origin}/robots.txt`, false, MAX_ROBOTS_BYTES, callerSignal);
    if (result.kind !== "response" || !result.response) {
      return { allowed: false, blockedDetail: "robots.txt does not allow it.", rules: [], crawlDelayMs: 0 };
    }
    const status = result.response.status;
    // A site that answers its robots.txt with "not allowed" or "slow down" has not said yes.
    // RFC 9309 lets a reader take any 4xx as "no rules". That is right for a missing file and
    // too generous for a refusal, so those three are read as a no.
    if (status === 401 || status === 403 || status === 429) {
      return {
        allowed: false,
        blockedDetail: (status === 429 ? retryAfterDetail(result.response, now()) : null) ?? "This site refused its robots.txt, so nothing on it is read.",
        rules: [],
        crawlDelayMs: 0,
      };
    }
    if (status >= 400 && status < 500) {
      return { allowed: true, blockedDetail: "robots.txt does not allow it.", rules: [], crawlDelayMs: 0 };
    }
    if (status >= 500 || status < 200 || status >= 300) {
      return {
        allowed: false,
        blockedDetail: (status === 503 ? retryAfterDetail(result.response, now()) : null) ?? "robots.txt does not allow it.",
        rules: [],
        crawlDelayMs: 0,
      };
    }
    // Rules past the size limit were not read, and one of them may be the rule that says no.
    if (result.truncated) {
      return { allowed: false, blockedDetail: "This site's robots.txt is too large to read in full, so nothing on it is read.", rules: [], crawlDelayMs: 0 };
    }
    return parseRobots(result.body ?? "", productToken);
  }

  async function robotsDecision(rawUrl: string, callerSignal?: AbortSignal): Promise<{ allowed: boolean; detail: string; gapMs: number }> {
    const policy = await robotsPolicy(rawUrl, callerSignal);
    const allowed = policy.allowed && robotsAllows(policy, rawUrl);
    return {
      allowed,
      detail: allowed ? "" : policy.blockedDetail,
      gapMs: Math.max(DEFAULT_GAP_MS, policy.crawlDelayMs),
    };
  }

  return {
    checkAddress,
    robotsDecision,
    withHostGap: withHost,
    async read(rawUrl, readOptions): Promise<PageRead> {
      const input = cleanUrl(rawUrl);
      const baseUrl = input ?? rawUrl;
      if (!input) {
        let parsed: URL | null = null;
        try { parsed = new URL(rawUrl); } catch { /* invalid address */ }
        const hostname = parsed?.hostname ?? "";
        const barred = termsBar(hostname);
        const detail = isNeverFetchHost(hostname)
          ? "This address is never requested."
          : isOffLimitsHost(hostname)
            ? `${barred?.host ?? hostname} does not allow automated reading.`
            : "This address is not a readable public web address.";
        return pageResult("blocked", detail, baseUrl);
      }
      if (readOptions?.signal?.aborted) return pageResult("unreachable", "The page request was cancelled.", baseUrl);

      const standIn = readableAddress(input);
      const requestUrl = standIn?.url ?? input;
      const isHnStandIn = standIn?.url.includes("hn.algolia.com/api/v1/items/") ?? false;
      const result = await fetchText(requestUrl, true, MAX_PAGE_BYTES, readOptions?.signal, isHnStandIn);
      if (result.kind !== "response") return pageResult(result.kind, result.detail, baseUrl);
      if (!result.response) return pageResult("unreachable", "The page could not be reached.", baseUrl);

      const status = result.response.status;
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

function parseRobots(body: string, productToken: string): RobotsPolicy {
  const groups: Array<{ agents: string[]; rules: RobotsRule[]; delays: number[]; overflow: boolean }> = [];
  let group: { agents: string[]; rules: RobotsRule[]; delays: number[]; overflow: boolean } | null = null;
  let hasDirective = false;
  // A line ends in CR LF, LF, or CR alone. Missing the last form would let a file hide a rule.
  for (const rawLine of body.split(/\r\n|\n|\r/u)) {
    const line = rawLine.split("#", 1)[0]?.trim() ?? "";
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "sitemap") continue;
    if (key === "user-agent") {
      if (!group || hasDirective) {
        group = { agents: [], rules: [], delays: [], overflow: false };
        groups.push(group);
        hasDirective = false;
      }
      if (value) group.agents.push(value.toLowerCase());
      continue;
    }
    if (!group) continue;
    hasDirective = true;
    if ((key === "allow" || key === "disallow") && value.startsWith("/")) {
      // A file is someone else's text: a rule longer than any real path, or more rules than
      // any real site has, is not worked on. It is not ignored either: a rule that was left out
      // might have been a refusal, so a group that has one refuses everything (below).
      if (value.length <= MAX_RULE_LENGTH && group.rules.length < MAX_RULES_PER_GROUP) {
        group.rules.push({ allow: key === "allow", path: comparablePath(value) });
      } else {
        group.overflow = true;
      }
    } else if (key === "crawl-delay") {
      const delay = Number(value);
      if (Number.isFinite(delay) && delay >= 0) group.delays.push(Math.min(MAX_GAP_MS, delay * 1000));
    }
  }

  const matching = groups.filter((candidate) => candidate.agents.some((agent) => agent !== "*" && productToken.includes(agent)));
  const selected = matching.length > 0 ? matching : groups.filter((candidate) => candidate.agents.includes("*"));
  const rules = selected.flatMap((selectedGroup) => selectedGroup.rules);
  const crawlDelayMs = Math.min(MAX_GAP_MS, Math.max(0, ...selected.flatMap((selectedGroup) => selectedGroup.delays)));
  if (selected.some((selectedGroup) => selectedGroup.overflow)) {
    return { allowed: false, blockedDetail: "This site's robots.txt has rules too long or too many to apply, so nothing on it is read.", rules: [], crawlDelayMs };
  }
  return { allowed: true, blockedDetail: "robots.txt does not allow it.", rules, crawlDelayMs };
}

const MAX_RULE_LENGTH = 2_000;
const MAX_RULES_PER_GROUP = 5_000;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/u;

/**
 * A path in the one form RFC 9309 compares in, for a rule and for an address alike: an
 * escaped letter, digit, hyphen, dot, underscore or tilde is unescaped, every other escape is
 * kept with its hex in capitals, and anything outside ASCII is escaped. Without it
 * "/%70rivate" would walk past "Disallow: /private".
 */
function comparablePath(path: string): string {
  return path
    .replace(/%([0-9a-fA-F]{2})/gu, (_match, hex: string) => {
      const character = String.fromCharCode(Number.parseInt(hex, 16));
      return UNRESERVED.test(character) ? character : `%${hex.toUpperCase()}`;
    })
    .replace(/[^\x00-\x7F]/gu, (character) =>
      [...new TextEncoder().encode(character)].map((byte) => `%${byte.toString(16).padStart(2, "0").toUpperCase()}`).join(""),
    );
}

function robotsAllows(policy: RobotsPolicy, urlText: string): boolean {
  let url: URL;
  try { url = new URL(urlText); } catch { return false; }
  if (url.pathname.toLowerCase() === "/robots.txt") return true;
  const target = comparablePath(`${url.pathname}${url.search}`);
  const matching = policy.rules
    .filter((rule) => robotsPatternMatches(rule.path, target))
    .sort((a, b) => ruleSpecificity(b.path) - ruleSpecificity(a.path) || Number(b.allow) - Number(a.allow));
  return matching[0]?.allow ?? true;
}

function ruleSpecificity(path: string): number {
  return path.replace(/[\*$]/gu, "").replace(/%[\da-f]{2}/giu, "x").length;
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

/**
 * Whether a robots.txt rule matches a path: "*" stands for any run of characters and a final
 * "$" for the end. Matched by hand, taking each piece between stars at the first place it
 * fits. A rule is text from a stranger, and turning its stars into a regular expression lets
 * a rule such as "/*a*a*a ... b" hold the whole server for minutes on one path.
 */
function robotsPatternMatches(pattern: string, target: string): boolean {
  const anchored = pattern.endsWith("$");
  const pieces = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  const first = pieces[0] as string;
  if (!target.startsWith(first)) return false;
  if (pieces.length === 1) return anchored ? target.length === first.length : true;
  let position = first.length;
  for (let index = 1; index < pieces.length; index += 1) {
    const piece = pieces[index] as string;
    if (index === pieces.length - 1 && anchored) {
      // The last piece must be the end of the path, and must not reach back over what is matched.
      return target.length - piece.length >= position && target.endsWith(piece);
    }
    const found = target.indexOf(piece, position);
    if (found === -1) return false;
    position = found + piece.length;
  }
  return true;
}

function stripUnsafeBlocks(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu, " ");
}

function extractTitle(html: string): string {
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
function extractLinks(html: string, baseUrl: string, inputUrl: string): PageLink[] {
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
