import { describe, expect, it } from "vitest";
import type { RepoRef } from "@agentswarm/shared";
import { pickRepo } from "./pipeline";

const repo = (name: string, stars: number): RepoRef => ({
  url: `https://github.com/someone/${name}`,
  name,
  description: null,
  stars,
  language: "Rust",
  localPath: null,
});

const founder = (companyName: string | null) => ({ company: { name: companyName, url: null, oneLiner: null, stage: null } });

describe("pickRepo", () => {
  // Repositories arrive best first, as the finder ranks them.
  const repos = [repo("newsprint", 900), repo("kitty-browser", 40), repo("dotfiles", 3)];

  it("reviews the repository named after the founder's project, not their most starred one", () => {
    expect(pickRepo(repos, founder("KittyBrowser"))?.name).toBe("kitty-browser");
    expect(pickRepo(repos, founder("Kitty Browser, Inc."))?.name).toBe("kitty-browser");
    expect(pickRepo([repo("tessaly", 12), repo("old-thing", 500)], founder("Tessaly"))?.name).toBe("tessaly");
  });

  it("falls back to the most significant repository when none is named after the project", () => {
    expect(pickRepo(repos, founder("Quillmark"))?.name).toBe("newsprint");
    expect(pickRepo(repos, founder(null))?.name).toBe("newsprint");
    // A two-letter name matches too many things to be trusted.
    expect(pickRepo([repo("zig-tools", 9), repo("ai", 1)], founder("AI"))?.name).toBe("zig-tools");
  });

  it("returns nothing when the founder has no repositories", () => {
    expect(pickRepo([], founder("Tessaly"))).toBeNull();
  });
});
