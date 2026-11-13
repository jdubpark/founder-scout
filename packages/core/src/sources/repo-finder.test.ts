import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoRef } from "@agentswarm/shared";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLiveRepoFinder, parseGitHubLogin, parseRepoUrl } from "./repo-finder";
import { jsonResponse, readJsonFixture, scriptedFetch, textResponse } from "./test-support";

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
    ["ssh scheme", "ssh://git@github.com/acme-labs/widget"],
    ["extra path segment", "https://github.com/acme-labs/widget/tree/main"],
    ["trailing slash", "https://github.com/acme-labs/widget/"],
    [".git suffix", "https://github.com/acme-labs/widget.git"],
    ["other host", "https://gitlab.com/acme-labs/widget"],
    ["plain http", "http://github.com/acme-labs/widget"],
    ["embedded credentials", "https://user:pass@github.com/acme-labs/widget"],
    ["query string", "https://github.com/acme-labs/widget?x=1"],
    ["fragment", "https://github.com/acme-labs/widget#readme"],
    ["owner only", "https://github.com/acme-labs"],
    ["dot-dot traversal", "https://github.com/acme-labs/.."],
    ["option-like name", "https://github.com/acme-labs/-widget"],
    ["option-like owner", "https://github.com/-acme/widget"],
    ["option in place of URL", "--upload-pack=touch /tmp/pwned"],
    ["dash-prefixed option", "-oProxyCommand=echo"],
    ["whitespace", " https://github.com/acme-labs/widget"],
    ["newline", "https://github.com/acme-labs/widget\n--upload-pack=x"],
  ])("rejects %s", (_label, url) => {
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

  it("throws on a rate-limited response", async () => {
    const finder = createLiveRepoFinder({
      env: {},
      workDir,
      fetch: scriptedFetch(() => textResponse("slow", { status: 429, headers: { "retry-after": "60" } })).fetch,
    });
    await expect(
      finder.topRepos({ github: "octocat", linkedin: null, x: null, site: null, scholar: null }, null, 5),
    ).rejects.toThrow("GitHub is rate limited");
  });
});

describe("checkout", () => {
  it("refuses a non-GitHub URL before starting git or creating the work directory", async () => {
    process.env.FAKE_GIT_MODE = "ok";
    const finder = createLiveRepoFinder({ env: {}, workDir, git: fakeGit });
    await expect(finder.checkout({ ...REPO, url: "git@github.com:acme-labs/widget.git" })).rejects.toThrow(
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

  it("removes the directory and throws when git exits with an error", async () => {
    process.env.FAKE_GIT_MODE = "fail";
    const finder = createLiveRepoFinder({ env: {}, workDir, git: fakeGit });
    await expect(finder.checkout(REPO)).rejects.toThrow("git clone failed with exit code 128: fatal: repository not found");
    expect(readdirSync(workDir)).toEqual([]);
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

  it("reports a missing git executable as a clear error and leaves nothing behind", async () => {
    const finder = createLiveRepoFinder({ env: {}, workDir, git: join(base, "no-such-git") });
    await expect(finder.checkout(REPO)).rejects.toThrow("Could not start git");
    expect(readdirSync(workDir)).toEqual([]);
  });
});
