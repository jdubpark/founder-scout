import { mkdir, open, rm } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { join } from "node:path";
import { SIM_WEB_HOST } from "@agentswarm/shared";
import { pinnedFetch } from "./quote-check";
import type { FetchFn } from "./http";
import { createWebReader, type WebAddressCheck } from "./web";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_MB = 150;
const AUDIO_VIDEO = /^(audio|video)\//iu;

export interface MediaFetchOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: FetchFn;
  resolveHost?: (host: string) => Promise<string[]>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export function mediaMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const maxMbValue = Number(env.MEDIA_MAX_MB);
  const maxMb = Number.isFinite(maxMbValue) && maxMbValue > 0 ? maxMbValue : DEFAULT_MAX_MB;
  return Math.floor(maxMb * 1024 * 1024);
}

function addressRefusal(check: Extract<WebAddressCheck, { kind: "blocked" | "unreachable" }>): string {
  if (check.detail === "This address is never requested.") return "This host is never requested.";
  if (check.detail === "This address resolves to a restricted network address.") return "The recording address resolves to a restricted network address.";
  if (check.detail === "The address could not be resolved.") return "The recording address could not be resolved.";
  return check.detail;
}

export function createMediaFetcher(options: MediaFetchOptions = {}) {
  const env = options.env ?? process.env;
  const fetchFn = options.fetch;
  const safety = createWebReader({
    fetch: fetchFn,
    resolveHost: options.resolveHost ?? (async (host) => host === SIM_WEB_HOST
      ? ["93.184.216.34"]
      : (await lookup(host, { all: true })).map((entry) => entry.address)),
    now: options.now,
    sleep: options.sleep,
  });
  const maxBytes = mediaMaxBytes(env);

  return {
    checkAddress(raw: string): Promise<WebAddressCheck> {
      return safety.checkAddress(raw);
    },
    async fetch(sourceUrl: string, dataDir: string, fetchOptions: { signal?: AbortSignal } = {}): Promise<{ path: string; detail: string } | { refused: string }> {
      let current = sourceUrl;
      for (let redirects = 0; redirects <= 5; redirects++) {
        const checked = await safety.checkAddress(current);
        if ("kind" in checked) return { refused: addressRefusal(checked) };

        const decision = await safety.robotsDecision(checked.url, fetchOptions.signal);
        if (!decision.allowed) return { refused: "robots.txt does not allow this recording." };

        const url = new URL(checked.url);
        let response: Response;
        try {
          response = await safety.withHostGap(url.hostname, decision.gapMs, () =>
            (fetchFn ?? ((address, init) => pinnedFetch(address, init, checked.addresses)))(checked.url, {
              method: "GET",
              redirect: "manual",
              headers: { "User-Agent": "web-reader/1.0", Accept: "audio/*, video/*" },
              signal: fetchOptions.signal,
            }),
          );
        } catch {
          return { refused: "The recording could not be fetched." };
        }
        if (REDIRECTS.has(response.status)) {
          const location = response.headers.get("location");
          await response.body?.cancel().catch(() => undefined);
          if (!location) return { refused: "The recording returned a redirect without a destination." };
          try { current = new URL(location, url).href; } catch { return { refused: "The recording returned an invalid redirect address." }; }
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          return { refused: `The recording returned HTTP ${response.status}.` };
        }
        const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (!AUDIO_VIDEO.test(type)) {
          await response.body?.cancel().catch(() => undefined);
          return { refused: "The address is not a direct audio or video file." };
        }
        const length = Number(response.headers.get("content-length"));
        if (Number.isFinite(length) && length > maxBytes) {
          await response.body?.cancel().catch(() => undefined);
          return { refused: "The recording is larger than the configured size limit." };
        }
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
            if (total > maxBytes) {
              await reader.cancel();
              throw new Error("The recording is larger than the configured size limit.");
            }
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
