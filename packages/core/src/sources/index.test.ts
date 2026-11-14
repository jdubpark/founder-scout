import { describe, expect, it } from "vitest";
import { createLivePeopleLookup, createLiveRepoFinder, createLiveSources } from "./index";
import { NOT_CONFIGURED_ERROR } from "./people_data";
import { request, scriptedFetch } from "./test-support";

describe("createLiveSources", () => {
  it("registers the live adapters, including Y Combinator, and leaves the rest out", () => {
    const registry = createLiveSources({});
    expect(registry.get("hackernews")?.id).toBe("hackernews");
    expect(registry.get("github")?.id).toBe("github");
    expect(registry.get("arxiv")?.id).toBe("arxiv");
    expect(registry.get("people_data")?.id).toBe("people_data");
    expect(registry.get("yc")?.id).toBe("yc");
    expect(registry.get("web")).toBeNull();
    expect(registry.get("call")).toBeNull();
    expect(registry.get("manual")).toBeNull();
  });

  it("reports one status per live adapter, in order, with labels from the shared registry", async () => {
    const registry = createLiveSources({});
    const statuses = await registry.statuses();
    expect(statuses.map(({ id, label }) => [id, label])).toEqual([
      ["hackernews", "Hacker News"],
      ["github", "GitHub"],
      ["arxiv", "arXiv"],
      ["people_data", "Professional profiles (data vendor)"],
      ["yc", "Y Combinator"],
    ]);
    expect(statuses.map(({ id }) => registry.get(id)?.id)).toEqual(statuses.map(({ id }) => id));
    const github = statuses.find(({ id }) => id === "github");
    expect(github?.configured).toBe(true);
    expect(github?.detail).toMatch(/No GITHUB_TOKEN set/u);
    const authenticated = await createLiveSources({ GITHUB_TOKEN: "test-token-not-real" }).statuses();
    expect(authenticated.find(({ id }) => id === "github")?.detail).toMatch(/GITHUB_TOKEN is in use/u);
  });

  it("reports people data as not configured without a vendor key", async () => {
    const people = (await createLiveSources({}).statuses()).find((status) => status.id === "people_data");
    expect(people?.configured).toBe(false);
    expect(people?.detail).toContain("data vendor under contract or not at all");
    expect(createLivePeopleLookup({})).toBeNull();
    expect(createLivePeopleLookup({ PDL_API_KEY: "  " })).toBeNull();
  });

  it("configures PDL from a non-empty key and exposes the same live lookup", async () => {
    const env = { PDL_API_KEY: "test-pdl-key" };
    const status = (await createLiveSources(env).statuses()).find((item) => item.id === "people_data");
    expect(status?.configured).toBe(true);
    expect(status?.detail).toContain("People Data Labs");
    expect(createLivePeopleLookup(env)?.vendor).toBe("People Data Labs");
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
