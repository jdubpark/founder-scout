/**
 * The local client of the Octo Browser desktop app, through which the swarm starts and
 * stops the profiles it reads the professional network with. The client listens on the
 * partner's own machine next to the app and needs no key: whoever can reach it can
 * drive it. Each profile carries its own fingerprint and sticky proxy, configured in
 * Octo by the partner, so one account never shares an exit address or a browser with
 * another. Starting and stopping a profile is charged against the partner's Octo plan,
 * so a profile is started once and left running for the life of the process.
 */

import type { FetchFn } from "./http";

/** Where the desktop app's client listens unless configured otherwise. */
export const DEFAULT_OCTO_LOCAL_URL = "http://localhost:58888";

/** A profile running on this machine. The endpoint is present only while it runs. */
export interface OctoActiveProfile {
  uuid: string;
  state: string;
  wsEndpoint: string | null;
}

/** A started profile, with the CDP endpoint a browser is driven through. */
export interface OctoStartedProfile {
  uuid: string;
  wsEndpoint: string;
}

export interface OctoLocalClient {
  /** The profiles currently running on this machine. */
  activeProfiles(signal?: AbortSignal): Promise<OctoActiveProfile[]>;
  /**
   * Starts a profile with a debug endpoint and returns it. A profile that is already
   * running is reported as `OctoProfileAlreadyStarted`, because only the start call
   * says where its endpoint is.
   */
  startProfile(uuid: string, signal?: AbortSignal): Promise<OctoStartedProfile>;
  /** Stops a profile. */
  stopProfile(uuid: string, signal?: AbortSignal): Promise<void>;
}

/** The one error the caller is expected to work around rather than report. */
export class OctoProfileAlreadyStarted extends Error {
  constructor(uuid: string) {
    super(`The Octo profile ${uuid} is already running.`);
  }
}

export function createOctoLocalClient(options: { baseUrl?: string; fetch?: FetchFn; timeoutMs?: number } = {}): OctoLocalClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_OCTO_LOCAL_URL).replace(/\/+$/u, "");
  const fetchFn = options.fetch;
  // Starting a profile boots a browser through a proxy, which can take a while.
  const timeoutMs = options.timeoutMs ?? 120_000;

  async function request(path: string, init: { method: "GET" | "POST"; body?: unknown; signal?: AbortSignal }): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
    const sent: RequestInit = {
      method: init.method,
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal,
    };
    let response: Response;
    try {
      response = fetchFn ? await fetchFn(`${baseUrl}${path}`, sent) : await fetch(`${baseUrl}${path}`, sent);
    } catch (error) {
      throw new Error(`The Octo Browser app could not be reached on ${baseUrl}: ${error instanceof Error ? error.message : "the request failed."}`);
    }
    const text = await response.text().catch(() => "");
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const fields = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
      if (fields.code === "profiles.already_started") throw new OctoProfileAlreadyStarted(String(fields.uuid ?? ""));
      const described = typeof fields.error === "string" ? fields.error : typeof fields.msg === "string" ? fields.msg : `HTTP ${response.status}.`;
      throw new Error(`Octo Browser answered: ${described}`);
    }
    return parsed;
  }

  return {
    async activeProfiles(signal) {
      const parsed = await request("/api/profiles/active", { method: "GET", signal });
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        const uuid = typeof record.uuid === "string" ? record.uuid : null;
        if (!uuid) return [];
        return [{
          uuid,
          state: typeof record.state === "string" ? record.state : "",
          wsEndpoint: typeof record.ws_endpoint === "string" && record.ws_endpoint ? record.ws_endpoint : null,
        }];
      });
    },
    async startProfile(uuid, signal) {
      let parsed: unknown;
      try {
        parsed = await request("/api/profiles/start", {
          method: "POST",
          // The profile is started as a person sees it: a window, not a headless browser.
          body: { uuid, headless: false, debug_port: true, only_local: true, timeout: 60 },
          signal,
        });
      } catch (error) {
        // The start call is the only one that says where the endpoint is, so it names the profile.
        if (error instanceof OctoProfileAlreadyStarted) throw new OctoProfileAlreadyStarted(uuid);
        throw error;
      }
      const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
      const endpoint = typeof record.ws_endpoint === "string" ? record.ws_endpoint : "";
      if (!endpoint) throw new Error(`Octo Browser started the profile without a debug endpoint.`);
      return { uuid, wsEndpoint: endpoint };
    },
    async stopProfile(uuid, signal) {
      await request("/api/profiles/stop", { method: "POST", body: { uuid }, signal });
    },
  };
}

/** The profile UUIDs the partner assigned to the accounts, aligned to LINKEDIN_COOKIES by index. */
export function octoProfileUuidsFromEnv(env: NodeJS.ProcessEnv): string[] {
  return (env.OCTO_PROFILE_UUIDS ?? "")
    .split(/\r\n|\n|\r/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
