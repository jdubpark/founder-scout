/**
 * Live check of the repository finder against GitHub. Skipped unless LIVE_SOURCES=1.
 * Uses github/gitignore, a small public repository owned by an organisation.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLiveRepoFinder } from "./repo-finder";

const live = process.env.LIVE_SOURCES === "1";

describe.skipIf(!live)("live repository finder", () => {
  it("lists an organisation's repositories and checks one out, sanitised", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "live-repo-finder-"));
    try {
      const finder = createLiveRepoFinder({ env: process.env, workDir });

      const repos = await finder.topRepos(
        { github: "https://github.com/github", linkedin: null, x: null, site: null, scholar: null },
        null,
        3,
      );
      expect(repos.length).toBeGreaterThan(0);
      expect(repos.length).toBeLessThanOrEqual(3);
      for (const repo of repos) {
        expect(repo.url).toMatch(/^https:\/\/github\.com\/github\//);
        expect(repo.localPath).toBeNull();
      }
      console.log(
        `[live] topRepos(github): ${repos.length} repos; first: ${JSON.stringify(repos[0]?.name)} (${repos[0]?.stars} stars)`,
      );

      const { repo, cleanup } = await finder.checkout({
        url: "https://github.com/github/gitignore",
        name: "github/gitignore",
        description: null,
        stars: null,
        language: null,
        localPath: null,
      });
      try {
        const dir = repo.localPath ?? "";
        expect(existsSync(join(dir, "README.md"))).toBe(true);
        expect(existsSync(join(dir, ".git"))).toBe(false);
        expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
        expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
        expect(existsSync(join(dir, ".claude"))).toBe(false);
        console.log(`[live] checkout: ${dir} contains README.md; .git and agent files absent`);
      } finally {
        await cleanup();
      }
      expect(existsSync(repo.localPath ?? "")).toBe(false);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 180_000);
});
