/**
 * Finds a founder's own public repositories through the GitHub REST API, and
 * prepares a read-only, sanitised shallow checkout of one for a code reviewer.
 *
 * Repositories are untrusted input. The clone runs with hooks and LFS
 * smudging disabled, is bounded in time and size, and is sanitised before it
 * is returned (see sanitize.ts).
 */

import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProfileLinks, RepoContributor, RepoRef } from "@agentswarm/shared";
import type { RepoFinder } from "../contracts";
import {
  assertSuccessful,
  defaultFetch,
  httpGet,
  parseJson,
  type FetchFn,
} from "./http";
import {
  githubHeaders,
  GITHUB_API_ORIGIN,
  parseGitHubRepo,
  readGitHubToken,
} from "./github";
import { sanitizeCheckout } from "./sanitize";
import { normalizeLimit } from "./util";

const SOURCE = "GitHub";
export const CLONE_TIMEOUT_MS = 120_000;
export const MAX_CHECKOUT_BYTES = 200 * 1024 * 1024;
const SIZE_CHECK_INTERVAL_MS = 1000;
/** Enough to show whether one person wrote the repository or many did. */
const MAX_CONTRIBUTORS = 5;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;

export interface RepoFinderOptions {
  env?: NodeJS.ProcessEnv;
  /** Directory the checkouts are created in. Created when missing. */
  workDir: string;
  fetch?: FetchFn;
  /** The git executable. Defaults to "git" on PATH. */
  git?: string;
  cloneTimeoutMs?: number;
  maxCheckoutBytes?: number;
}

export interface ParsedRepoUrl {
  owner: string;
  name: string;
  canonical: string;
}

/**
 * Accepts only https://github.com/<owner>/<name>. Anything else, including SSH
 * forms, extra path segments, query strings, credentials and anything that
 * starts with a dash, is rejected before git is started.
 */
export function parseRepoUrl(url: string): ParsedRepoUrl | null {
  const match = REPO_URL_RE.exec(url);
  if (!match) return null;
  const owner = match[1] ?? "";
  const name = match[2] ?? "";
  if (name === "." || name === ".." || name.startsWith("-") || name.endsWith(".git")) return null;
  return { owner, name, canonical: `https://github.com/${owner}/${name}` };
}

/** Reads a GitHub login from a profile URL (any path after the login is ignored) or a bare handle. */
export function parseGitHubLogin(link: string | null): string | null {
  if (!link) return null;
  const value = link.trim();
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)(?:[/?#].*)?$/i.exec(value);
  const candidate = fromUrl ? (fromUrl[1] ?? null) : /^[A-Za-z0-9-]+$/.test(value) ? value : null;
  return candidate !== null && LOGIN_RE.test(candidate) ? candidate : null;
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Cleanup never throws. A leftover directory is reported by the next sweep, not here.
  }
}

/** Sum of file sizes under a path. Symbolic links are measured, not followed. */
async function directorySize(path: string): Promise<number> {
  let total = 0;
  const pending = [path];
  for (;;) {
    const dir = pending.pop();
    if (dir === undefined) break;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else {
        try {
          total += (await lstat(full)).size;
        } catch {
          // The file vanished during the walk. Nothing to count.
        }
      }
    }
  }
  return total;
}

function sizeError(maxBytes: number): Error {
  const mb = 1024 * 1024;
  const limit = maxBytes % mb === 0 ? `${maxBytes / mb} MB` : `${maxBytes} bytes`;
  return new Error(`Repository exceeds the ${limit} checkout limit.`);
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group has already exited.
  }
}

function runShallowClone(
  git: string,
  url: string,
  dest: string,
  measureRoot: string,
  limits: { timeoutMs: number; maxBytes: number },
): Promise<void> {
  const args = [
    "-c",
    "http.userAgent=agentswarm/0.1",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "filter.lfs.process=",
    "-c",
    "filter.lfs.smudge=",
    "-c",
    "filter.lfs.required=false",
    "clone",
    "--depth",
    "1",
    "--single-branch",
    "--no-tags",
    "--no-recurse-submodules",
    "--",
    url,
    dest,
  ];

  return new Promise<void>((resolvePromise, reject) => {
    // detached: git and its helpers get their own process group, so a timeout can kill all of them.
    const child = spawn(git, args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
      detached: true,
    });

    let stderr = "";
    let settled = false;
    let failure: Error | null = null;

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(sizer);
      if (error) reject(error);
      else resolvePromise();
    };
    const abort = (error: Error) => {
      if (failure) return;
      failure = error;
      killGroup(child.pid);
      // Settle now rather than waiting for stdio to close, which a surviving helper could delay.
      finish(error);
    };

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(
      () => abort(new Error(`git clone timed out after ${limits.timeoutMs / 1000} seconds.`)),
      limits.timeoutMs,
    );

    let measuring = false;
    const sizer = setInterval(() => {
      if (measuring) return;
      measuring = true;
      void directorySize(measureRoot)
        .then((bytes) => {
          if (bytes > limits.maxBytes) abort(sizeError(limits.maxBytes));
        })
        .finally(() => {
          measuring = false;
        });
    }, SIZE_CHECK_INTERVAL_MS);

    child.on("error", (err) => {
      finish(new Error(`Could not start git: ${err.message}`));
    });

    child.on("close", (code) => {
      if (failure) return finish(failure);
      if (code !== 0) {
        return finish(new Error(`git clone failed with exit code ${code}: ${stderr.trim().slice(0, 500)}`));
      }
      void directorySize(measureRoot).then((bytes) => {
        finish(bytes > limits.maxBytes ? sizeError(limits.maxBytes) : null);
      });
    });
  });
}

export function createLiveRepoFinder(options: RepoFinderOptions): RepoFinder {
  const env = options.env ?? process.env;
  const token = readGitHubToken(env);
  const fetchFn = options.fetch ?? defaultFetch;
  const git = options.git ?? "git";
  const limits = {
    timeoutMs: options.cloneTimeoutMs ?? CLONE_TIMEOUT_MS,
    maxBytes: options.maxCheckoutBytes ?? MAX_CHECKOUT_BYTES,
  };
  const workDir = resolve(options.workDir);

  return {
    async topRepos(links: ProfileLinks, _simId: string | null, limit: number): Promise<RepoRef[]> {
      const max = normalizeLimit(limit);
      const login = parseGitHubLogin(links.github);
      if (max === 0 || login === null) return [];

      const params = new URLSearchParams({ type: "owner", sort: "pushed", per_page: "100" });
      const res = await httpGet(fetchFn, SOURCE, `${GITHUB_API_ORIGIN}/users/${login}/repos?${params.toString()}`, {
        headers: githubHeaders(token),
      });
      if (res.status === 404) return [];
      assertSuccessful(SOURCE, res, Date.now());

      const data = parseJson(SOURCE, res.body);
      if (!Array.isArray(data)) throw new Error("GitHub returned an unexpected repository list.");
      const pushedMs = (value: string | null) => (value ? Date.parse(value) || 0 : 0);

      return data
        .map(parseGitHubRepo)
        .filter((repo) => !repo.fork && !repo.archived && !repo.disabled && !repo.isPrivate)
        .sort((a, b) => b.stars - a.stars || pushedMs(b.pushedAt) - pushedMs(a.pushedAt))
        .slice(0, max)
        .map((repo) => ({
          url: repo.htmlUrl,
          name: repo.fullName,
          description: repo.description,
          stars: repo.stars,
          language: repo.language,
          localPath: null,
        }));
    },

    async checkout(repo: RepoRef) {
      const parsed = parseRepoUrl(repo.url);
      if (!parsed) {
        throw new Error("Refusing to check out: only https://github.com/<owner>/<name> URLs are accepted.");
      }

      await mkdir(workDir, { recursive: true });
      const root = await mkdtemp(join(workDir, "checkout-"));
      const dir = join(root, "repo");
      try {
        await runShallowClone(git, parsed.canonical, dir, root, limits);
        await sanitizeCheckout(dir);
      } catch (err) {
        await removeQuietly(root);
        throw err;
      }

      return {
        repo: { ...repo, url: parsed.canonical, localPath: dir },
        cleanup: () => removeQuietly(root),
      };
    },

    async contributors(repo: RepoRef): Promise<RepoContributor[] | null> {
      const parsed = parseRepoUrl(repo.url);
      if (!parsed) return null;
      const res = await httpGet(
        fetchFn,
        SOURCE,
        `${GITHUB_API_ORIGIN}/repos/${parsed.owner}/${parsed.name}/contributors?per_page=${MAX_CONTRIBUTORS}`,
        { headers: githubHeaders(token) },
      );
      // 204 is an empty repository; 403 is a history too large for GitHub to count.
      if (res.status !== 200) return null;
      const data = parseJson(SOURCE, res.body);
      if (!Array.isArray(data)) return null;
      const people = data
        .flatMap((row: unknown) => {
          const entry = row as { login?: unknown; contributions?: unknown; type?: unknown } | null;
          return entry && typeof entry.login === "string" && typeof entry.contributions === "number" && entry.type !== "Bot"
            ? [{ login: entry.login, commits: entry.contributions }]
            : [];
        })
        .slice(0, MAX_CONTRIBUTORS);
      // A mirror whose committers have no account on the host lists nobody: that is "not known".
      return people.length > 0 ? people : null;
    },
  };
}
