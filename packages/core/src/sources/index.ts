/**
 * Live source registry and repository finder. Each adapter lives in its own
 * file and takes an injectable fetch, so every one can be tested offline.
 */

import { SOURCES, type SourceId, type SourceStatus } from "@agentswarm/shared";
import type { RepoFinder, SearchEngine, SimWorld, SourceAdapter, SourceRegistry, WebAccess, WebReader } from "../contracts";
import type { PeopleLookup } from "../contracts";
import { createArxivAdapter } from "./arxiv";
import { createBrowserLinkedInReader, createRoutingWebReader } from "./browser-reader";
import { createBrightDataVendor } from "./brightdata";
import { createGitHubAdapter } from "./github";
import { createHackerNewsAdapter } from "./hackernews";
import { createOctoLocalClient, octoProfileUuidsFromEnv } from "./octo";
import { createPeopleDataAdapter } from "./people_data";
import { createPdlVendor, createRecordAllowance, type RecordAllowance } from "./pdl";
import { createLiveRepoFinder as buildRepoFinder, type RepoFinderOptions } from "./repo-finder";
import { huntProxyFromEnv, linkedinAccountsFromEnv } from "./sessions";
import { createWebReader } from "./web";
import { createGitHubSearchEngine, createHnSearchEngine, createHuggingFaceSearchEngine } from "./search";

export { createArxivAdapter } from "./arxiv";
export { createBrowserLinkedInReader, createRoutingWebReader, type BrowserLinkedInReaderOptions } from "./browser-reader";
export { createBrightDataVendor, type BrightDataOptions } from "./brightdata";
export { createGitHubAdapter } from "./github";
export { createHackerNewsAdapter } from "./hackernews";
export { createOctoLocalClient, octoProfileUuidsFromEnv, DEFAULT_OCTO_LOCAL_URL, type OctoLocalClient } from "./octo";
export { createPeopleDataAdapter, type ProfileDataVendor } from "./people_data";
export { createPdlVendor, createRecordAllowance, type PdlOptions, type RecordAllowance } from "./pdl";
export { createQuoteChecker } from "./quote-check";
export {
  createLinkedInSessionPool,
  huntProxyFromEnv,
  linkedInSessionPoolFor,
  linkedinAccountsFromEnv,
  type LinkedInAccount,
  type LinkedInSessionPool,
} from "./sessions";
export { createWebReader, type WebReaderOptions } from "./web";
export { createGitHubSearchEngine, createHnSearchEngine, createHuggingFaceSearchEngine, type SearchOptions } from "./search";
export { looksLikeFounder, parseConnectionsCsv, type ParsedContact } from "./connections";
export { sanitizeCheckout, type SanitizeResult } from "./sanitize";
export { parseRepoUrl, parseGitHubLogin, type RepoFinderOptions } from "./repo-finder";
export { SourceRateLimitError } from "./http";
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

/** Records a day from Bright Data when BRIGHTDATA_RECORDS_PER_DAY is not set. Each record is billed. */
export const DEFAULT_BRIGHTDATA_RECORDS_PER_DAY = 50;

/**
 * Live web access used by the hunt. The reader keeps its own address and robots rules.
 * When Octo profiles are configured, the professional network is read through a real
 * browser and the fetch reader never carries an account; the browser reader is also
 * returned for anything else that reads those pages, so one rhythm covers them all.
 */
export function createLiveWebAccess(options: { env?: NodeJS.ProcessEnv; extraEngines?: SearchEngine[] } = {}): WebAccess & { networkReader?: WebReader } {
  const env = options.env ?? process.env;
  const accounts = linkedinAccountsFromEnv(env);
  const proxyUrl = huntProxyFromEnv(env);
  const profileUuids = octoProfileUuidsFromEnv(env);
  if (profileUuids.length > 0 && profileUuids.length !== accounts.length) {
    throw new Error("OCTO_PROFILE_UUIDS needs one UUID per account in LINKEDIN_COOKIES, aligned by index.");
  }
  const browserReader = profileUuids.length > 0 && accounts.length > 0
    ? createBrowserLinkedInReader({
        accounts,
        profileUuids,
        client: createOctoLocalClient({ ...(env.OCTO_LOCAL_URL ? { baseUrl: env.OCTO_LOCAL_URL } : {}) }),
      })
    : null;
  const fetchReader = createWebReader({
    userAgent: env.HUNT_USER_AGENT,
    ...(accounts.length > 0 && browserReader === null ? { accounts } : {}),
    ...(proxyUrl ? { proxyUrl } : {}),
  });
  return {
    reader: browserReader ? createRoutingWebReader(browserReader, fetchReader) : fetchReader,
    engines: [createHnSearchEngine(), createGitHubSearchEngine({ env }), createHuggingFaceSearchEngine({ env }), ...(options.extraEngines ?? [])],
    ...(browserReader ? { networkReader: browserReader } : {}),
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

function brightDataAllowance(env: NodeJS.ProcessEnv, apiKey: string): RecordAllowance {
  // A separate key so the two vendors never share a ceiling: each bills its own records.
  const key = `brightdata:${apiKey}`;
  const existing = allowances.get(key);
  if (existing) return existing;
  const configured = Number(env.BRIGHTDATA_RECORDS_PER_DAY);
  const perDay = Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : DEFAULT_BRIGHTDATA_RECORDS_PER_DAY;
  const allowance = createRecordAllowance(perDay);
  allowances.set(key, allowance);
  return allowance;
}

function pdlLookup(env: NodeJS.ProcessEnv): PeopleLookup | null {
  const apiKey = env.PDL_API_KEY?.trim();
  return apiKey ? createPdlVendor({ apiKey, allowance: pdlAllowance(env, apiKey) }) : null;
}

/**
 * Profile lookups. Bright Data's LinkedIn Scraper API enriches a known profile, so it is
 * preferred when its key is set; People Data Labs remains the fallback and the discovery feed.
 */
export function createLivePeopleLookup(env: NodeJS.ProcessEnv = process.env): PeopleLookup | null {
  const brightDataKey = env.BRIGHTDATA_API_KEY?.trim();
  if (brightDataKey) {
    return createBrightDataVendor({
      apiKey: brightDataKey,
      allowance: brightDataAllowance(env, brightDataKey),
      ...(env.BRIGHTDATA_LINKEDIN_DATASET_ID?.trim() ? { datasetId: env.BRIGHTDATA_LINKEDIN_DATASET_ID.trim() } : {}),
    });
  }
  return pdlLookup(env);
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
