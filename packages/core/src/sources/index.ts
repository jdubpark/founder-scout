/**
 * Live source registry and repository finder. Each adapter lives in its own
 * file and takes an injectable fetch, so every one can be tested offline.
 */

import { SOURCES, type SourceId, type SourceStatus } from "@agentswarm/shared";
import type { RepoFinder, SearchEngine, SimWorld, SourceAdapter, SourceRegistry, WebAccess } from "../contracts";
import type { PeopleLookup } from "../contracts";
import { createArxivAdapter } from "./arxiv";
import { createGitHubAdapter } from "./github";
import { createHackerNewsAdapter } from "./hackernews";
import { createPeopleDataAdapter } from "./people_data";
import { createPdlVendor, createRecordAllowance, type RecordAllowance } from "./pdl";
import { createLiveRepoFinder as buildRepoFinder, type RepoFinderOptions } from "./repo-finder";
import { createWebReader } from "./web";
import { createGitHubSearchEngine, createHnSearchEngine, createHuggingFaceSearchEngine, createModelSearchEngine } from "./search";
import { createLiveTranscriber } from "./transcribe";
import { createMediaFetcher } from "./media";
import type { Dialler } from "../contracts";
import { createVapiDialler, type VapiDiallerOptions } from "./dialler-vapi";

export { createArxivAdapter } from "./arxiv";
export { createGitHubAdapter } from "./github";
export { createHackerNewsAdapter } from "./hackernews";
export { createPeopleDataAdapter, type ProfileDataVendor } from "./people_data";
export { createPdlVendor, createRecordAllowance, type PdlOptions, type RecordAllowance } from "./pdl";
export { createQuoteChecker } from "./quote-check";
export { createLiveTranscriber, createCommandTranscriber, createHttpTranscriber } from "./transcribe";
export { createMediaFetcher } from "./media";
export { createWebReader, type WebReaderOptions } from "./web";
export { createGitHubSearchEngine, createHnSearchEngine, createHuggingFaceSearchEngine, type SearchOptions } from "./search";
export { createModelSearchEngine } from "./search";
export { createLinkupSearchEngine } from "./search-linkup";
export { looksLikeFounder, parseConnectionsCsv, type ParsedContact } from "./connections";
export { sanitizeCheckout, type SanitizeResult } from "./sanitize";
export { parseRepoUrl, parseGitHubLogin, type RepoFinderOptions } from "./repo-finder";
export { SourceRateLimitError } from "./http";

/** Constructs Vapi only when the call key and imported outbound number are configured. */
export function createLiveDialler(env: NodeJS.ProcessEnv = process.env, options: Omit<VapiDiallerOptions, "env"> = {}): Dialler | null {
  if (!env.VAPI_API_KEY?.trim() || !env.VAPI_PHONE_NUMBER_ID?.trim()) return null;
  return createVapiDialler({ ...options, env });
}
export {
  collectLaunchPosts,
  directoryOutcome,
  fetchUnicornNames,
  fetchYcDirectory,
  firstLaunchEach,
  labelPastCases,
  parseLabelsCsv,
  parseUnicornWikitext,
  parseYcDirectory,
  pastCasesFile,
  readPastCases,
  summarisePastCases,
  writePastCases,
  type CollectLaunchesOptions,
  type DirectoryEntry,
  type LabelResult,
  type LabelSources,
  type OutcomeLabel,
} from "./past";

/** Records a day from the vendor when PDL_RECORDS_PER_DAY is not set. Each record costs a credit. */
export const DEFAULT_PDL_RECORDS_PER_DAY = 50;

/** Live web access used by the hunt. The reader keeps its own address and robots rules. */
export function createLiveWebAccess(options: { env?: NodeJS.ProcessEnv; extraEngines?: SearchEngine[] } = {}): WebAccess {
  const env = options.env ?? process.env;
  return {
    reader: createWebReader({ userAgent: env.HUNT_USER_AGENT }),
    engines: [createHnSearchEngine(), createGitHubSearchEngine({ env }), createHuggingFaceSearchEngine({ env }), ...(options.extraEngines ?? [])],
  };
}

/** Simulated web access delegates only to the supplied world and never opens a network request. */
export function createSimWebAccess(world: SimWorld): WebAccess {
  return {
    reader: {
      async read(url, options) {
        return world.page(url, options?.simDay ?? 0) ?? {
          status: "unreachable",
          detail: "No such page.",
          url,
          title: "",
          text: "",
          links: [],
        };
      },
    },
    engines: world.engines().map((info) => ({
      ...info,
      async status() {
        return { configured: true, detail: "Simulated search engine." };
      },
      async search(query, limit, options) {
        return world.search(info.id, query, options?.simDay ?? 0, limit);
      },
    })),
  };
}

// One allowance per key for the life of the process, so the scout and the lookups share it.
const allowances = new Map<string, RecordAllowance>();

function pdlAllowance(env: NodeJS.ProcessEnv, apiKey: string): RecordAllowance {
  const existing = allowances.get(apiKey);
  if (existing) return existing;
  const configured = Number(env.PDL_RECORDS_PER_DAY);
  const perDay = Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : DEFAULT_PDL_RECORDS_PER_DAY;
  const allowance = createRecordAllowance(perDay);
  allowances.set(apiKey, allowance);
  return allowance;
}

export function createLivePeopleLookup(env: NodeJS.ProcessEnv = process.env): PeopleLookup | null {
  const apiKey = env.PDL_API_KEY?.trim();
  return apiKey ? createPdlVendor({ apiKey, allowance: pdlAllowance(env, apiKey) }) : null;
}

/** Adapters that fetch from the outside world. web, call and manual have none in live mode. */
const LIVE_IDS = ["hackernews", "github", "arxiv", "people_data"] as const satisfies readonly SourceId[];

export function createLiveSources(env: NodeJS.ProcessEnv = process.env): SourceRegistry {
  const pdlApiKey = env.PDL_API_KEY?.trim();
  const adapters = new Map<SourceId, SourceAdapter>([
    ["hackernews", createHackerNewsAdapter()],
    ["github", createGitHubAdapter({ env })],
    ["arxiv", createArxivAdapter()],
    ["people_data", createPeopleDataAdapter(pdlApiKey ? createPdlVendor({ apiKey: pdlApiKey, allowance: pdlAllowance(env, pdlApiKey) }) : null)],
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
