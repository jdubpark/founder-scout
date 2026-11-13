import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isNeverFetchHost, isOffLimitsHost, termsBar } from "@agentswarm/shared";
import { isRestrictedIp, pinnedFetch } from "./quote-check";
import type { FetchFn } from "./http";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_MB = 150;
const AUDIO_VIDEO = /^(audio|video)\//iu;

export interface MediaFetchOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: FetchFn;
  resolveHost?: (host: string) => Promise<string[]>;
}

export function createMediaFetcher(options: MediaFetchOptions = {}) {
  const env = options.env ?? process.env;
  const fetchFn = options.fetch;
  const resolveHost = options.resolveHost ?? (async (host: string) => (await lookup(host, { all: true })).map((entry) => entry.address));
  const maxMbValue = Number(env.MEDIA_MAX_MB);
  const maxBytes = Math.floor((Number.isFinite(maxMbValue) && maxMbValue > 0 ? maxMbValue : DEFAULT_MAX_MB) * 1024 * 1024);

  async function safeAddress(raw: string): Promise<{ url: URL; addresses: string[] } | { refused: string }> {
    let url: URL;
    try { url = new URL(raw); } catch { return { refused: "The recording address is invalid." }; }
    if (!(url.protocol === "http:" || url.protocol === "https:") || url.username || url.password) return { refused: "The recording address must be public HTTP or HTTPS." };
    const host = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase().replace(/\.$/u, "");
    if (isNeverFetchHost(host)) return { refused: "This host is never requested." };
    const barred = termsBar(host);
    if (isOffLimitsHost(host)) return { refused: `${barred?.host ?? host} does not allow automated reading.` };
    try {
      const addresses = isIP(host) ? [host] : await resolveHost(host);
      if (!addresses.length || addresses.some(isRestrictedIp)) return { refused: "The recording address resolves to a restricted network address." };
      return { url, addresses };
    } catch { return { refused: "The recording address could not be resolved." }; }
  }

  async function robotsAllowed(url: URL, signal?: AbortSignal): Promise<boolean> {
    const robotsUrl = new URL("/robots.txt", url).href;
    const checked = await safeAddress(robotsUrl);
    if ("refused" in checked) return false;
    try {
      const response = await (fetchFn ?? ((address, init) => pinnedFetch(address, init, checked.addresses)))(robotsUrl, {
        method: "GET", redirect: "manual", headers: { "User-Agent": "web-reader/1.0", Accept: "text/plain" }, signal,
      });
      if (response.status === 404 || response.status === 410) return true;
      if (response.status !== 200) return false;
      const text = await response.text();
      let applies = false;
      for (const line of text.split(/\r?\n/u)) {
        const [name, ...value] = line.split(":");
        if (name?.trim().toLowerCase() === "user-agent") applies = value.join(":").trim() === "*" || value.join(":").trim().toLowerCase() === "web-reader";
        if (applies && name?.trim().toLowerCase() === "disallow") {
          const path = value.join(":").trim();
          if (path && url.pathname.startsWith(path)) return false;
        }
      }
      return true;
    } catch { return false; }
  }

  return {
    async fetch(sourceUrl: string, dataDir: string, fetchOptions: { signal?: AbortSignal } = {}): Promise<{ path: string; detail: string } | { refused: string }> {
      let current = sourceUrl;
      for (let redirects = 0; redirects <= 5; redirects++) {
        const checked = await safeAddress(current);
        if ("refused" in checked) return checked;
        if (!(await robotsAllowed(checked.url, fetchOptions.signal))) return { refused: "robots.txt does not allow this recording." };
        let response: Response;
        try {
          response = await (fetchFn ?? ((address, init) => pinnedFetch(address, init, checked.addresses)))(checked.url.href, {
            method: "GET", redirect: "manual", headers: { "User-Agent": "web-reader/1.0", Accept: "audio/*, video/*" }, signal: fetchOptions.signal,
          });
        } catch { return { refused: "The recording could not be fetched." }; }
        if (REDIRECTS.has(response.status)) {
          const location = response.headers.get("location");
          await response.body?.cancel().catch(() => undefined);
          if (!location) return { refused: "The recording returned a redirect without a destination." };
          try { current = new URL(location, checked.url).href; } catch { return { refused: "The recording returned an invalid redirect address." }; }
          continue;
        }
        if (!response.ok) return { refused: `The recording returned HTTP ${response.status}.` };
        const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (!AUDIO_VIDEO.test(type)) { await response.body?.cancel().catch(() => undefined); return { refused: "The address is not a direct audio or video file." }; }
        const length = Number(response.headers.get("content-length"));
        if (Number.isFinite(length) && length > maxBytes) { await response.body?.cancel().catch(() => undefined); return { refused: "The recording is larger than the configured size limit." }; }
        if (!response.body) return { refused: "The recording response had no file body." };
        const directory = join(dataDir, "recordings");
        await mkdir(directory, { recursive: true });
        const path = join(directory, `${crypto.randomUUID()}.media`);
        const file = await open(path, "wx", 0o600);
        let total = 0;
        try {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) { await reader.cancel(); throw new Error("The recording is larger than the configured size limit."); }
            await file.write(value);
          }
          await file.close();
          return { path, detail: "" };
        } catch (error) {
          await file.close().catch(() => undefined);
          await rm(path, { force: true });
          return { refused: error instanceof Error ? error.message : "The recording could not be saved." };
        }
      }
      return { refused: "The recording redirected too many times." };
    },
  };
}
