import { lookup } from "node:dns/promises";
import { connect as netConnect, isIP, type LookupFunction, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { isProfessionalNetworkHost, isProfessionalNetworkUrl, quoteForm, quoteInText, type QuoteStatus } from "@agentswarm/shared";
import type { PageRead, QuoteChecker } from "../contracts";
import { USER_AGENT, type FetchFn } from "./http";
import { linkedInSessionPoolFor, type LinkedInAccount } from "./sessions";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const MAX_PROXY_HEADER_BYTES = 64 * 1024;
const ACCEPT = "text/html, application/xhtml+xml, text/plain, text/markdown, application/json;q=0.9, */*;q=0.1";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Statuses that rest an account; the professional network throttles with HTTP 999. The same
// set the web reader uses, so one refusal rests an account whichever path saw it.
const REFUSALS = new Set([401, 403, 407, 429, 451, 999]);
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
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Logged-in accounts for the professional network. No other host is sent a cookie or their agent. */
  accounts?: readonly LinkedInAccount[];
  /** A proxy every read may tunnel through, unless the professional network account carries its own. */
  proxyUrl?: string | null;
  /**
   * Reads professional-network pages instead of the built-in fetch, when the partner reads
   * them through a browser. Its rhythm gate, dwell and daily cap apply as for any read.
   */
  networkReader?: { read(url: string, options?: { simDay?: number | null; signal?: AbortSignal; maxTextChars?: number }): Promise<PageRead> };
}

type CheckResult = { status: QuoteStatus; detail: string };
type ReadableAddress = { url: string; completeness: "complete" | "partial" };
type ReadableAddressRule = (url: URL) => ReadableAddress | null;

const READABLE_ADDRESS_RULES: ReadableAddressRule[] = [
  // Complete stand-in: Algolia returns the item and comments for a Hacker News item.
  (url) => {
    if (url.hostname.toLowerCase().replace(/\.$/u, "") !== "news.ycombinator.com" || url.pathname !== "/item") return null;
    const id = url.searchParams.get("id");
    return id && /^\d+$/u.test(id) ? { url: `https://hn.algolia.com/api/v1/items/${id}`, completeness: "complete" } : null;
  },
  // Complete stand-in: the raw host serves the same file text as the rendered GitHub blob.
  (url) => {
    if (url.hostname.toLowerCase().replace(/\.$/u, "") !== "github.com") return null;
    const parts = url.pathname.split("/");
    if (!(parts.length >= 6 && parts[1] && parts[2] && parts[3] === "blob" && parts[4] && parts.slice(5).some(Boolean))) {
      return null;
    }
    const rawPath = [parts[1], parts[2], parts[4], ...parts.slice(5)].join("/");
    return { url: `https://raw.githubusercontent.com/${rawPath}`, completeness: "complete" };
  },
  // Partial stand-in: the abstract page does not include the full paper body.
  (url) => {
    if (url.hostname.toLowerCase().replace(/\.$/u, "") !== "arxiv.org" || !url.pathname.startsWith("/pdf/")) return null;
    const id = url.pathname.slice("/pdf/".length).replace(/\.pdf$/iu, "");
    return id && !id.endsWith("/") ? { url: `https://arxiv.org/abs/${id}`, completeness: "partial" } : null;
  },
];

export function createQuoteChecker(options: QuoteCheckOptions = {}): QuoteChecker {
  const fetchFn = options.fetchFn;
  const resolveHost = options.resolveHost ?? (async (hostname: string) =>
    (await lookup(hostname, { all: true })).map((entry) => entry.address));
  // An account dwells up to 75 seconds before its fetch on the professional network, so
  // its checks need more room than a plain page: the timeout starts before the dwell.
  const timeoutMs = options.timeoutMs ?? (options.accounts && options.accounts.length > 0 ? 120_000 : DEFAULT_TIMEOUT_MS);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const networkReader = options.networkReader;
  const accountPool = options.accounts && options.accounts.length > 0 ? linkedInSessionPoolFor(options.accounts, options.now) : null;

  return {
    async check(urlText, excerpt, callerSignal) {
      throwIfAborted(callerSignal);
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;

      try {
        // The professional network is read through the browser the partner supplies when
        // there is one, with the account's rhythm deciding whether the page is opened now.
        if (networkReader && isProfessionalNetworkUrl(urlText)) {
          const page = await networkReader.read(urlText, { signal: callerSignal, maxTextChars: NETWORK_MAX_TEXT_CHARS });
          if (page.status !== "ok") return unreachable(page.detail);
          return judgeQuote([page.text], excerpt, { truncated: page.truncated === true });
        }
        let currentUrl = urlText;
        let redirects = 0;
        let partialStandInDetail: string | null = null;
        let accountIndex: number | null = null;
        let dwelled = false;
        let response: Response;
        // One account for the whole chain, picked when it first reaches the professional
        // network: a person following a redirect keeps one session. No other host is ever
        // sent a cookie. When every account rests, the check does not judge the quote and the
        // host is not asked.
        let chainAccount: { index: number; account: LinkedInAccount } | null = null;

        while (true) {
          const validation = await validateAddress(currentUrl, resolveHost);
          throwIfAborted(callerSignal);
          if (validation.problem) return unreachable(validation.problem);

          const readable = readableAddress(currentUrl);
          if (readable && readable.url !== currentUrl) {
            if (readable.completeness === "partial") {
              partialStandInDetail = "Only the abstract of this paper could be read.";
            }
            currentUrl = readable.url;
            continue;
          }

          const pool = accountPool !== null && isProfessionalNetworkHost(new URL(currentUrl).hostname) ? accountPool : null;
          if (pool && !chainAccount) {
            chainAccount = pool.pick();
            if (!chainAccount) {
              return unreachable(pool.restingDetail() ?? "Every account asked for a pause.");
            }
          }
          const account = chainAccount && isProfessionalNetworkHost(new URL(currentUrl).hostname) ? chainAccount : null;
          accountIndex = account ? account.index : null;
          // One human dwell before the first professional-network fetch of this check.
          if (account && pool && !dwelled) {
            await sleep(pool.dwellMs());
            dwelled = true;
          }
          const init: RequestInit = {
            method: "GET",
            redirect: "manual",
            headers: {
              "User-Agent": account?.account.userAgent ?? USER_AGENT,
              Accept: ACCEPT,
              ...(account ? { Cookie: account.account.cookie } : {}),
            },
            signal,
          };
          const proxyUrl = account ? account.account.proxyUrl ?? options.proxyUrl : options.proxyUrl;
          response = fetchFn
            ? await fetchFn(currentUrl, init)
            : await pinnedFetch(currentUrl, init, validation.addresses, proxyUrl ?? undefined);

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

        // A page an account opened counts against its day. A network refusal rests the account
        // until its next workday, so later checks rotate to another one.
        if (accountIndex !== null) {
          if (REFUSALS.has(response.status)) accountPool?.cool(accountIndex);
          else accountPool?.noteRead(accountIndex);
        }
        throwIfAborted(callerSignal);
        if (response.status !== 200) return unreachable(`The page returned HTTP ${response.status}.`);

        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (!READABLE_TYPES.has(contentType)) return unreachable("The page is not in a readable text format.");

        const { text: body, truncated } = await readLimitedBody(response, maxBytes);
        throwIfAborted(callerSignal);
        const pageTexts = pageTextsForBody(contentType, body);
        return judgeQuote(pageTexts, excerpt, { truncated, partialStandInDetail });
      } catch (error) {
        if (callerSignal?.aborted) throw error;
        if (timeout.aborted) return unreachable("The page request timed out.");
        return unreachable("The page could not be reached.");
      }
    },
  };
}

/** How much page text a browser read may bring back for a quote to be checked against. */
const NETWORK_MAX_TEXT_CHARS = 300_000;

/** Judges the quote's fragments against the page's text forms. */
function judgeQuote(pages: string[], excerpt: string, notes: { truncated?: boolean; partialStandInDetail?: string | null } = {}): CheckResult {
  const match = quoteInText(pages, excerpt);
  if (match.status === "too_short") return unreachable("The quote is too short to check.");
  if (match.status === "found") return { status: "found", detail: "The quoted text appears on the page." };
  if (notes.truncated) return unreachable("The page is too long to check in full.");
  if (notes.partialStandInDetail) return unreachable(notes.partialStandInDetail);
  const readableLength = pages.reduce((total, text) => total + quoteForm(text).length, 0);
  if (readableLength < 1_500) return unreachable("The page has too little readable text to check a quote against.");
  return {
    status: "not_found",
    detail: `${match.missing} of ${match.fragments} quoted fragments were not found on the page.`,
  };
}

export function readableAddress(text: string): ReadableAddress | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  for (const rule of READABLE_ADDRESS_RULES) {
    const readable = rule(url);
    if (readable) return readable;
  }
  return null;
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

/** Makes an HTTP request using only addresses that have already passed validation. */
export function pinnedFetch(
  urlText: string,
  init: RequestInit | undefined,
  addresses: readonly string[],
  proxyUrl?: string | null,
): Promise<Response> {
  const url = new URL(urlText);
  if (url.protocol !== "http:" && url.protocol !== "https:") return Promise.reject(new Error("Unsupported request protocol."));
  if (addresses.length === 0) return Promise.reject(new Error("No validated addresses were provided."));

  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  const requestOptions = {
    method: init?.method ?? "GET",
    headers,
    ...(init?.signal ? { signal: init.signal } : {}),
  };
  if (!proxyUrl) {
    return sendRequest(url, { ...requestOptions, lookup: createPinnedLookup(addresses) });
  }
  return sendThroughProxy(url, requestOptions, proxyUrl, init?.signal ?? undefined);
}

function sendRequest(url: URL, options: RequestOptions): Promise<Response> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(url, options, (incoming) => {
      const status = incoming.statusCode ?? 502;
      if (status === 101) {
        incoming.destroy();
        reject(new Error("Protocol upgrades are not supported."));
        return;
      }
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((entry) => responseHeaders.append(name, entry));
        else if (value !== undefined) responseHeaders.set(name, value);
      }
      if (status === 204 || status === 205 || status === 304) {
        incoming.resume();
        resolve(new Response(null, { status, headers: responseHeaders }));
        return;
      }
      // Unlike fetch, this client does not undo compression. A server may compress without
      // being asked, and searching compressed bytes would report a real quote as missing.
      const decoded = decodedBody(incoming, responseHeaders.get("content-encoding"));
      if (!decoded) {
        incoming.destroy();
        reject(new Error("The page is compressed in a form this check cannot read."));
        return;
      }
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      resolve(new Response(Readable.toWeb(decoded) as ReadableStream<Uint8Array>, { status, headers: responseHeaders }));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

/**
 * Opens a CONNECT tunnel to the proxy for the target and issues the request over it. The
 * request's own address lookup is skipped: the proxy resolves the target. An https target is
 * wrapped in TLS for its own host name before the request goes out; an http target is plain.
 */
async function sendThroughProxy(url: URL, options: RequestOptions, proxyUrl: string, signal?: AbortSignal): Promise<Response> {
  let proxy: URL;
  try {
    proxy = new URL(proxyUrl);
  } catch {
    throw new Error("The proxy address is invalid.");
  }
  if (proxy.protocol !== "http:") throw new Error("Only HTTP proxies are supported.");
  if (proxy.pathname !== "/" || proxy.search || proxy.hash) throw new Error("The proxy address must not include a path.");

  const targetHost = url.hostname;
  const targetPort = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const tunnel = await openProxyTunnel(proxy, targetHost, targetPort, signal);
  try {
    const connection = url.protocol === "https:" ? await secureTunnel(tunnel, targetHost, signal) : tunnel;
    // No agent is set, so Node uses this already-connected socket directly.
    return await sendRequest(url, { ...options, createConnection: () => connection });
  } catch (error) {
    tunnel.destroy();
    throw error;
  }
}

function openProxyTunnel(proxy: URL, targetHost: string, targetPort: number, signal?: AbortSignal): Promise<Socket> {
  const tunnel = netConnect({ host: proxy.hostname, port: Number(proxy.port) || 80 });
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let settled = false;

    const cleanup = () => {
      tunnel.off("data", onData);
      tunnel.off("error", fail);
      tunnel.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      tunnel.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buffer.length > MAX_PROXY_HEADER_BYTES) fail(new Error("The proxy sent an oversized response."));
        return;
      }
      const status = Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/u.exec(buffer.subarray(0, end).toString("latin1"))?.[1]);
      if (!(status >= 200 && status < 300)) {
        fail(new Error(`The proxy refused the CONNECT tunnel with HTTP ${Number.isFinite(status) ? status : "unknown"}.`));
        return;
      }
      settled = true;
      cleanup();
      // Any bytes after the CONNECT response belong to the target and are put back.
      const rest = buffer.subarray(end + 4);
      if (rest.length > 0) tunnel.unshift(rest);
      resolve(tunnel);
    };
    const onClose = () => fail(new Error("The proxy closed the connection before accepting the tunnel."));
    const onAbort = () => fail(signal?.reason instanceof Error ? signal.reason : new Error("The proxy tunnel was aborted."));

    tunnel.on("data", onData);
    tunnel.once("error", fail);
    tunnel.once("close", onClose);
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const auth = proxy.username || proxy.password
      ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}\r\n`
      : "";
    tunnel.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}\r\n`);
  });
}

function secureTunnel(tunnel: Socket, targetHost: string, signal?: AbortSignal): Promise<Socket> {
  const servername = isIP(targetHost.replace(/^\[|\]$/gu, "")) === 0 ? targetHost : undefined;
  const secure = tlsConnect({ socket: tunnel, servername });
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      secure.off("secureConnect", onConnect);
      secure.off("error", fail);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      secure.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onConnect = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(secure);
    };
    const onAbort = () => fail(signal?.reason instanceof Error ? signal.reason : new Error("The proxy tunnel was aborted."));

    secure.once("secureConnect", onConnect);
    secure.once("error", fail);
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** The body with any compression the server applied removed, or null when the scheme is not one we read. */
function decodedBody(incoming: Readable, encoding: string | null): Readable | null {
  const steps = (encoding ?? "").split(",").map((step) => step.trim().toLowerCase()).filter((step) => step && step !== "identity");
  let stream: Readable = incoming;
  // Encodings are listed in the order they were applied, so they are undone last to first.
  for (const step of steps.reverse()) {
    const decoder = step === "gzip" || step === "x-gzip" ? createGunzip()
      : step === "deflate" ? createInflate()
      : step === "br" ? createBrotliDecompress()
      : null;
    if (!decoder) return null;
    stream.once("error", (error) => decoder.destroy(error));
    stream = stream.pipe(decoder);
  }
  return stream;
}

/** Returns only the prevalidated records to Node, for both lookup callback forms. */
export function createPinnedLookup(addresses: readonly string[]): LookupFunction {
  const records = addresses.map((address) => ({ address, family: isIP(address) }));
  return (_hostname, lookupOptions, callback) => {
    if (typeof lookupOptions === "object" && lookupOptions !== null && lookupOptions.all) {
      callback(null, records);
      return;
    }
    const first = records[0];
    if (!first) {
      callback(new Error("No validated addresses were provided."), "", 0);
      return;
    }
    callback(null, first.address, first.family);
  };
}

async function validateAddress(
  text: string,
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<{ problem: string; addresses: [] } | { problem: null; addresses: string[] }> {
  if (!/^https?:\/\//iu.test(text)) return { problem: "The address must use HTTP or HTTPS.", addresses: [] };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { problem: "The address is invalid.", addresses: [] };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return { problem: "The address must use HTTP or HTTPS.", addresses: [] };
  if (url.username || url.password) return { problem: "The address must not include a user name or password.", addresses: [] };
  if (url.port) return { problem: "The address must use the default port for its scheme.", addresses: [] };

  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  if (isLocalHostname(hostname)) return { problem: "The address points to a local network host.", addresses: [] };

  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) {
    return isRestrictedIp(hostname)
      ? { problem: "The address points to a restricted network range.", addresses: [] }
      : { problem: null, addresses: [hostname] };
  }

  try {
    const addresses = await resolveHost(hostname);
    if (addresses.length === 0 || addresses.some(isRestrictedIp)) {
      return { problem: "The address does not resolve only to public network addresses.", addresses: [] };
    }
    return { problem: null, addresses };
  } catch {
    return { problem: "The address could not be verified as public.", addresses: [] };
  }
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  return host === "localhost" || [".localhost", ".local", ".internal"].some((suffix) => host.endsWith(suffix));
}

export function isRestrictedIp(address: string): boolean {
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

async function readLimitedBody(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const keepSize = Math.max(0, Math.min(value.byteLength, maxBytes - total));
      const keep = value.subarray(0, keepSize);
      if (keep.byteLength > 0) chunks.push(keep);
      total += keep.byteLength;
      if (keep.byteLength < value.byteLength) {
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
  return { text: new TextDecoder().decode(bytes), truncated };
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

function unreachable(detail: string): CheckResult {
  return { status: "unreachable", detail };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    if (signal.reason !== undefined) throw signal.reason;
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}
