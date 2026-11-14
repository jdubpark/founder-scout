import { describe, expect, it } from "vitest";
import { createLivePeopleLookup, createLiveRepoFinder, createLiveSources } from "./index";
import { NOT_CONFIGURED_ERROR } from "./people_data";
import { request, scriptedFetch } from "./test-support";

describe("createLiveSources", () => {
  it("registers live adapters, labels, and GitHub token status", async () => {
    const registry = createLiveSources({});
    const statuses = await registry.statuses();
    expect(statuses.map(({ id, label }) => [id, label])).toEqual([
      ["hackernews", "Hacker News"],
      ["github", "GitHub"],
      ["arxiv", "arXiv"],
      ["people_data", "Professional profiles (data vendor)"],
    ]);
    expect(statuses.map(({ id }) => registry.get(id)?.id)).toEqual(statuses.map(({ id }) => id));
    const github = statuses.find(({ id }) => id === "github");
    expect(github?.configured).toBe(true);
    expect(github?.detail).toMatch(/No GITHUB_TOKEN set/u);
    const authenticated = await createLiveSources({ GITHUB_TOKEN: "test-token-not-real" }).statuses();
    expect(authenticated.find(({ id }) => id === "github")?.detail).toMatch(/GITHUB_TOKEN is in use/u);
    expect(registry.get("web")).toBeNull();
    expect(registry.get("call")).toBeNull();
    expect(registry.get("manual")).toBeNull();
  });

  it("connects the licensed people lookup only when a non-empty vendor key is configured", async () => {
    const missing = createLiveSources({ PDL_API_KEY: "  " });
    expect((await missing.statuses()).find(({ id }) => id === "people_data")?.configured).toBe(false);
    expect(createLivePeopleLookup({})).toBeNull();
    expect(createLivePeopleLookup({ PDL_API_KEY: "  " })).toBeNull();

    const configured = createLiveSources({ PDL_API_KEY: "test-pdl-key" });
    expect((await configured.statuses()).find(({ id }) => id === "people_data")?.configured).toBe(true);
    expect(createLivePeopleLookup({ PDL_API_KEY: "test-pdl-key" })?.vendor).toBe("People Data Labs");
  });

  it("fails closed when the people-data vendor is not configured", async () => {
    const adapter = createLiveSources({}).get("people_data");
    await expect(adapter?.fetch(request())).rejects.toThrow(NOT_CONFIGURED_ERROR);
  });

  it("does not contact GitHub while the repository finder is only constructed", () => {
    const recorder = scriptedFetch(() => { throw new Error("construction must not make a request"); });
    createLiveRepoFinder({ env: {}, workDir: "/nonexistent-work-dir-for-test", fetch: recorder.fetch });
    expect(recorder.urls).toEqual([]);
  });
});
