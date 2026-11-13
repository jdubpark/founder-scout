/**
 * Live source registry and repository finder. Each adapter lives in its own
 * file and takes an injectable fetch, so every one can be tested offline.
 */

import { SOURCES, type SourceId, type SourceStatus } from "@agentswarm/shared";
import type { RepoFinder, SourceAdapter, SourceRegistry } from "../contracts";
import { createArxivAdapter } from "./arxiv";
import { createGitHubAdapter } from "./github";
import { createHackerNewsAdapter } from "./hackernews";
import { createPeopleDataAdapter } from "./people_data";
import { createLiveRepoFinder as buildRepoFinder, type RepoFinderOptions } from "./repo-finder";

export { createArxivAdapter } from "./arxiv";
export { createGitHubAdapter } from "./github";
export { createHackerNewsAdapter } from "./hackernews";
export { createPeopleDataAdapter, type ProfileDataVendor } from "./people_data";
export { sanitizeCheckout, type SanitizeResult } from "./sanitize";
export { parseRepoUrl, parseGitHubLogin, type RepoFinderOptions } from "./repo-finder";
export { SourceRateLimitError } from "./http";

/** Adapters that fetch from the outside world. web, call and manual have none in live mode. */
const LIVE_IDS = ["hackernews", "github", "arxiv", "people_data"] as const satisfies readonly SourceId[];

export function createLiveSources(env: NodeJS.ProcessEnv = process.env): SourceRegistry {
  const adapters = new Map<SourceId, SourceAdapter>([
    ["hackernews", createHackerNewsAdapter()],
    ["github", createGitHubAdapter({ env })],
    ["arxiv", createArxivAdapter()],
    ["people_data", createPeopleDataAdapter()],
  ]);

  return {
    get(id: SourceId): SourceAdapter | null {
      return adapters.get(id) ?? null;
    },

    async statuses(): Promise<SourceStatus[]> {
      return Promise.all(
        LIVE_IDS.map(async (id) => {
          const adapter = adapters.get(id);
          if (!adapter) throw new Error(`No live adapter registered for ${id}.`);
          const status = await adapter.status();
          const label = SOURCES.find((source) => source.id === id)?.label ?? id;
          return { id, label, configured: status.configured, detail: status.detail };
        }),
      );
    },
  };
}

export function createLiveRepoFinder(options: { env?: NodeJS.ProcessEnv; workDir: string } & Partial<RepoFinderOptions>): RepoFinder {
  return buildRepoFinder({ ...options, env: options.env ?? process.env, workDir: options.workDir });
}
