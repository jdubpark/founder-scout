import { describe, expect, it } from "vitest";
import { createLivePeopleLookup, createLiveRepoFinder, createLiveSources, sanitizeCheckout } from "./index";
import { createPeopleDataAdapter, NOT_CONFIGURED_ERROR, type ProfileDataVendor } from "./people_data";
import { request, scriptedFetch } from "./test-support";

describe("createLiveSources", () => {
  it("returns an adapter for each of the four live sources and null for the rest", () => {
    const registry = createLiveSources({});
    expect(registry.get("hackernews")?.id).toBe("hackernews");
    expect(registry.get("github")?.id).toBe("github");
    expect(registry.get("arxiv")?.id).toBe("arxiv");
    expect(registry.get("people_data")?.id).toBe("people_data");
    expect(registry.get("web")).toBeNull();
    expect(registry.get("call")).toBeNull();
    expect(registry.get("manual")).toBeNull();
  });

  it("reports one status per live adapter, in order, with labels from the shared registry", async () => {
    const statuses = await createLiveSources({}).statuses();
    expect(statuses.map((s) => s.id)).toEqual(["hackernews", "github", "arxiv", "people_data"]);
    expect(statuses.map((s) => s.label)).toEqual([
      "Hacker News",
      "GitHub",
      "arXiv",
      "Professional profiles (data vendor)",
    ]);
  });

  it("reports people data as not configured without a vendor key", async () => {
    const statuses = await createLiveSources({}).statuses();
    const people = statuses.find((s) => s.id === "people_data");
    expect(people?.configured).toBe(false);
    expect(people?.detail).toContain("data vendor under contract or not at all");
    expect(people?.detail).toContain("never requests the professional network's own site");
  });

  it("configures PDL from a non-empty key and exposes the same live lookup", async () => {
    const env = { PDL_API_KEY: "test-pdl-key" };
    const status = (await createLiveSources(env).statuses()).find((s) => s.id === "people_data");
    expect(status?.configured).toBe(true);
    expect(status?.detail).toContain("People Data Labs");
    expect(createLivePeopleLookup(env)?.vendor).toBe("People Data Labs");
    expect(createLivePeopleLookup({ PDL_API_KEY: "  " })).toBeNull();
  });

  it("says whether a GitHub token is in use", async () => {
    const without = (await createLiveSources({}).statuses()).find((s) => s.id === "github");
    const withToken = (await createLiveSources({ GITHUB_TOKEN: "test-token-not-real" }).statuses()).find(
      (s) => s.id === "github",
    );
    expect(without?.configured).toBe(true);
    expect(without?.detail).toContain("No GITHUB_TOKEN set");
    expect(withToken?.detail).toContain("GITHUB_TOKEN is in use");
  });

  it("makes the placeholder people-data source fail without any network call", async () => {
    const adapter = createLiveSources({}).get("people_data");
    await expect(adapter?.fetch(request())).rejects.toThrow(NOT_CONFIGURED_ERROR);
  });
});

describe("createPeopleDataAdapter", () => {
  it("delegates status and fetch to a licensed vendor when one is connected", async () => {
    const vendor: ProfileDataVendor = {
      name: "example-vendor",
      status: async () => ({ configured: true, detail: "Connected to example-vendor." }),
      fetch: async (req) => ({ items: [], cursor: { limit: req.limit } }),
    };
    const adapter = createPeopleDataAdapter(vendor);
    expect(await adapter.status()).toEqual({ configured: true, detail: "Connected to example-vendor." });
    expect(await adapter.fetch(request({ limit: 3 }))).toEqual({ items: [], cursor: { limit: 3 } });
  });
});

describe("exports", () => {
  it("exposes the repository finder, with the sanitiser exported on its own", async () => {
    const finder = createLiveRepoFinder({ env: {}, workDir: "/nonexistent-work-dir-for-test" });
    expect(typeof finder.topRepos).toBe("function");
    expect(typeof finder.checkout).toBe("function");
    expect(typeof sanitizeCheckout).toBe("function");
  });

  it("does not call the network when the finder is only constructed", () => {
    const recorder = scriptedFetch(() => {
      throw new Error("no network expected");
    });
    createLiveRepoFinder({ env: {}, workDir: "/nonexistent-work-dir-for-test", fetch: recorder.fetch });
    expect(recorder.urls).toHaveLength(0);
  });
});
