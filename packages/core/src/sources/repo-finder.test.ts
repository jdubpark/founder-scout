import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoRef } from "@agentswarm/shared";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLiveRepoFinder, parseGitHubLogin, parseRepoUrl } from "./repo-finder";
import { jsonResponse, readJsonFixture, scriptedFetch } from "./test-support";

/**
 * A stand-in for git. Its behaviour is chosen by FAKE_GIT_MODE:
 *   ok   creates a checkout that contains agent files, a .git directory and source
 *   fail exits 128 with a git-style message
 *   sleep never finishes
 *   big  writes 5000 bytes
 * Every invocation's arguments are appended to FAKE_GIT_LOG.
 */
const FAKE_GIT = `#!/bin/sh
echo "$@" >> "$FAKE_GIT_LOG"
for last in "$@"; do :; done
case "$FAKE_GIT_MODE" in
  fail) echo "fatal: repository not found" >&2; exit 128 ;;
  sleep) sleep 30 ;;
  big) mkdir -p "$last"; head -c 5000 /dev/zero > "$last/big.bin"; exit 0 ;;
  *) mkdir -p "$last/.git" "$last/.claude" "$last/src"
     echo "console.log(1)" > "$last/src/main.ts"
     echo "rules" > "$last/CLAUDE.md"
     echo "{}" > "$last/.claude/settings.json"
     echo "ref: refs/heads/main" > "$last/.git/HEAD"
     exit 0 ;;
esac
`;

const REPO: RepoRef = {
  url: "https://github.com/acme-labs/widget",
  name: "acme-labs/widget",
  description: null,
  stars: null,
  language: null,
  localPath: null,
};

let base: string;
let fakeGit: string;
let workDir: string;
let logPath: string;
const savedEnv = { mode: process.env.FAKE_GIT_MODE, log: process.env.FAKE_GIT_LOG };

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "repo-finder-test-"));
  fakeGit = join(base, "fake-git");
  writeFileSync(fakeGit, FAKE_GIT);
  chmodSync(fakeGit, 0o755);
});

beforeEach(() => {
  workDir = join(base, `work-${Math.random().toString(36).slice(2)}`);
  logPath = join(base, `log-${Math.random().toString(36).slice(2)}.txt`);
  process.env.FAKE_GIT_LOG = logPath;
});

afterEach(() => {
  restoreEnv("FAKE_GIT_MODE", savedEnv.mode);
  restoreEnv("FAKE_GIT_LOG", savedEnv.log);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function invocations(): string[] {
  return existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n") : [];
}

describe("parseRepoUrl", () => {
  it.each([
    "https://github.com/acme-labs/widget",
    "https://github.com/acme-labs/widget.js",
    "https://github.com/a/b_c-d.e",
  ])("accepts %s", (url) => {
    expect(parseRepoUrl(url)?.canonical).toBe(url);
  });

  it.each([
    ["SSH form", "git@github.com:acme-labs/widget.git"],
    ["extra path", "https://github.com/acme-labs/widget/tree/main"],
    ["non-GitHub host", "https://gitlab.com/acme-labs/widget"],
    ["credentials", "https://user:pass@github.com/acme-labs/widget"],
    ["traversal", "https://github.com/acme-labs/.."],
    ["option argument", "--upload-pack=touch /tmp/pwned"],
    ["newline argument", "https://github.com/acme-labs/widget\n--upload-pack=x"],
  ])("rejects unsafe repository URL form: %s", (_label, url) => {
    expect(parseRepoUrl(url)).toBeNull();
  });
});

describe("parseGitHubLogin", () => {
  it("reads a profile URL, a URL with extra path, or a bare handle", () => {
    expect(parseGitHubLogin("https://github.com/octocat")).toBe("octocat");
    expect(parseGitHubLogin("github.com/octocat/")).toBe("octocat");
    expect(parseGitHubLogin("https://www.github.com/octocat/some-repo")).toBe("octocat");
    expect(parseGitHubLogin("octocat")).toBe("octocat");
  });

  it("returns null for missing, invalid or non-GitHub links", () => {
    expect(parseGitHubLogin(null)).toBeNull();
    expect(parseGitHubLogin("https://gitlab.com/octocat")).toBeNull();
    expect(parseGitHubLogin("https://github.com/")).toBeNull();
    expect(parseGitHubLogin("-bad")).toBeNull();
    expect(parseGitHubLogin("has space")).toBeNull();
  });
});

describe("topRepos", () => {
  const userRepos = readJsonFixture<Array<Record<string, unknown>>>("github-user-repos.json");

  it("drops forks, ranks by stars and keeps the top N with localPath null", async () => {
    const recorder = scriptedFetch(() => jsonResponse(userRepos));
    const finder = createLiveRepoFinder({ env: {}, workDir, fetch: recorder.fetch });
    const repos = await finder.topRepos({ github: "https://github.com/octocat", linkedin: null, x: null, site: null, scholar: null }, null, 2);

    expect(repos).toEqual([
      {
        url: "https://github.com/octocat/Spoon-Knife",
        name: "octocat/Spoon-Knife",
        description: "This repo is for demonstration purposes only.",
        stars: 14201,
        language: "HTML",
        localPath: null,
      },
      {
        url: "https://github.com/octocat/Hello-World",
        name: "octocat/Hello-World",
        description: "My first repository on GitHub!",
        stars: 3926,
        language: null,
        localPath: null,
      },
    ]);
    const url = new URL(recorder.urls[0] ?? "");
    expect(url.pathname).toBe("/users/octocat/repos");
    expect(url.searchParams.get("type")).toBe("owner");
    expect(url.searchParams.get("sort")).toBe("pushed");
    expect(recorder.headers[0]?.Authorization).toBeUndefined();
  });

  it("sends the token when GITHUB_TOKEN is set", async () => {
    const recorder = scriptedFetch(() => jsonResponse(userRepos));
    const finder = createLiveRepoFinder({ env: { GITHUB_TOKEN: "test-token-not-real" }, workDir, fetch: recorder.fetch });
    await finder.topRepos({ github: "octocat", linkedin: null, x: null, site: null, scholar: null }, null, 5);
    expect(recorder.headers[0]?.Authorization).toBe("Bearer test-token-not-real");
  });

  it("returns an empty list with no GitHub link, without a network call", async () => {
    const recorder = scriptedFetch(() => jsonResponse(userRepos));
    const finder = createLiveRepoFinder({ env: {}, workDir, fetch: recorder.fetch });
    const repos = await finder.topRepos({ github: null, linkedin: null, x: null, site: "https://example.test", scholar: null }, null, 5);
    expect(repos).toEqual([]);
    expect(recorder.urls).toHaveLength(0);
  });

  it("returns an empty list for an unknown account", async () => {
    const finder = createLiveRepoFinder({
      env: {},
      workDir,
      fetch: scriptedFetch(() => jsonResponse({ message: "Not Found" }, { status: 404 })).fetch,
    });
    const repos = await finder.topRepos({ github: "octocat", linkedin: null, x: null, site: null, scholar: null }, null, 5);
    expect(repos).toEqual([]);
  });

});

describe("checkout", () => {
  it.each([
    "git@github.com:acme-labs/widget.git",
    "https://gitlab.com/acme-labs/widget",
    "https://github.com/acme-labs/widget/tree/main",
    "https://github.com/acme-labs/..",
    "--upload-pack=touch /tmp/pwned",
  ])("refuses unsafe URL %s before starting git or creating the work directory", async (url) => {
    process.env.FAKE_GIT_MODE = "ok";
    const finder = createLiveRepoFinder({ env: {}, workDir, git: fakeGit });
    await expect(finder.checkout({ ...REPO, url })).rejects.toThrow(
      "only https://github.com/<owner>/<name> URLs are accepted",
    );
    expect(invocations()).toEqual([]);
    expect(existsSync(workDir)).toBe(false);
  });

  it("clones shallowly with hooks disabled and returns a sanitised checkout", async () => {
    process.env.FAKE_GIT_MODE = "ok";
    const finder = createLiveRepoFinder({ env: {}, workDir, git: fakeGit });
    const { repo, cleanup } = await finder.checkout(REPO);

    expect(repo.localPath).not.toBeNull();
    const dir = repo.localPath ?? "";
    expect(existsSync(join(dir, "src", "main.ts"))).toBe(true);
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    expect(existsSync(join(dir, ".git"))).toBe(false);

    const [args] = invocations();
    expect(args).toBe(
      [
        "-c http.userAgent=agentswarm/0.1",
        "-c core.hooksPath=/dev/null",
        "-c filter.lfs.process=",
        "-c filter.lfs.smudge=",
        "-c filter.lfs.required=false",
        "clone --depth 1 --single-branch --no-tags --no-recurse-submodules -- https://github.com/acme-labs/widget",
      ].join(" ") + ` ${join(dir)}`,
    );

    await cleanup();
    expect(existsSync(dir)).toBe(false);
    await expect(cleanup()).resolves.toBeUndefined();
  });

  it("kills a clone that exceeds the timeout, removes the directory and throws", async () => {
    process.env.FAKE_GIT_MODE = "sleep";
    const finder = createLiveRepoFinder({ env: {}, workDir, git: fakeGit, cloneTimeoutMs: 400 });
    const started = Date.now();
    await expect(finder.checkout(REPO)).rejects.toThrow("git clone timed out after 0.4 seconds.");
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(readdirSync(workDir)).toEqual([]);
  });

  it("removes the directory and throws when the checkout exceeds the size cap", async () => {
    process.env.FAKE_GIT_MODE = "big";
    const finder = createLiveRepoFinder({ env: {}, workDir, git: fakeGit, maxCheckoutBytes: 1000 });
    await expect(finder.checkout(REPO)).rejects.toThrow("exceeds the");
    expect(readdirSync(workDir)).toEqual([]);
  });

  it("reports git execution failures clearly and leaves nothing behind", async () => {
    process.env.FAKE_GIT_MODE = "fail";
    const failed = createLiveRepoFinder({ env: {}, workDir, git: fakeGit });
    await expect(failed.checkout(REPO)).rejects.toThrow("git clone failed with exit code 128: fatal: repository not found");
    expect(readdirSync(workDir)).toEqual([]);

    const missing = createLiveRepoFinder({ env: {}, workDir, git: join(base, "no-such-git") });
    await expect(missing.checkout(REPO)).rejects.toThrow("Could not start git");
    expect(readdirSync(workDir)).toEqual([]);
  });

});

describe("contributors", () => {
  it("returns commit counts by person, most first, without bots", async () => {
    const recorder = scriptedFetch(() =>
      jsonResponse([
        { login: "ada-example", contributions: 412, type: "User" },
        { login: "dependabot[bot]", contributions: 60, type: "Bot" },
        { login: "sam-example", contributions: 9, type: "User" },
        { contributions: 3 },
      ]),
    );
    const finder = createLiveRepoFinder({ env: {}, workDir, fetch: recorder.fetch });
    await expect(finder.contributors?.(REPO)).resolves.toEqual([
      { login: "ada-example", commits: 412 },
      { login: "sam-example", commits: 9 },
    ]);
    expect(new URL(recorder.urls[0] ?? "").pathname).toBe("/repos/acme-labs/widget/contributors");
  });

  it("says nothing when the host cannot count, and never asks about a non-GitHub URL", async () => {
    const tooLarge = createLiveRepoFinder({
      env: {},
      workDir,
      fetch: scriptedFetch(() => jsonResponse({ message: "too large to list contributors" }, { status: 403 })).fetch,
    });
    await expect(tooLarge.contributors?.(REPO)).resolves.toBeNull();

    const recorder = scriptedFetch(() => jsonResponse([]));
    const finder = createLiveRepoFinder({ env: {}, workDir, fetch: recorder.fetch });
    await expect(finder.contributors?.({ ...REPO, url: "https://gitlab.com/acme-labs/widget" })).resolves.toBeNull();
    expect(recorder.urls).toHaveLength(0);

    // A mirror whose committers have no account on the host lists nobody.
    await expect(finder.contributors?.(REPO)).resolves.toBeNull();
    expect(recorder.urls).toHaveLength(1);
  });
});
