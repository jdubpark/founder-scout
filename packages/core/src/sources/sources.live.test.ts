/**
 * Live checks against the real public APIs. Skipped unless LIVE_SOURCES=1.
 * Each makes one small request (limit 5) and asserts the items are well formed.
 */
import { describe, expect, it } from "vitest";
import type { RawItem } from "@agentswarm/shared";
import { createLiveSources } from "./index";
import { request } from "./test-support";

const live = process.env.LIVE_SOURCES === "1";

function assertWellFormed(items: RawItem[], source: RawItem["source"]): void {
  expect(items.length).toBeGreaterThan(0);
  expect(items.length).toBeLessThanOrEqual(5);
  for (const item of items) {
    expect(item.source).toBe(source);
    expect(item.ref).toMatch(/^https:\/\//);
    expect(item.title.length).toBeGreaterThan(0);
    expect(item.text.length).toBeGreaterThan(0);
    expect(item.text.length).toBeLessThanOrEqual(4000);
    expect(item.simFounderId).toBeNull();
    expect(Object.values(item.metrics).every((v) => Number.isFinite(v))).toBe(true);
  }
}

describe.skipIf(!live)("live public sources", () => {
  const registry = createLiveSources(process.env);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  it("hackernews returns well-formed Show HN and Launch HN items", async () => {
    const adapter = registry.get("hackernews");
    expect(adapter).not.toBeNull();
    const result = await adapter!.fetch(request({ limit: 5, since: threeDaysAgo }));
    assertWellFormed(result.items, "hackernews");
    console.log(
      `[live] hackernews: ${result.items.length} items; example: ${JSON.stringify(result.items[0]?.title)}`,
    );
  }, 60_000);

  it("github returns well-formed repository items", async () => {
    const adapter = registry.get("github");
    expect(adapter).not.toBeNull();
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const result = await adapter!.fetch(request({ limit: 5, since }));
    assertWellFormed(result.items, "github");
    console.log(
      `[live] github: ${result.items.length} items; example: ${JSON.stringify(result.items[0]?.title)}; status: ${(await adapter!.status()).detail}`,
    );
  }, 60_000);

  it("arxiv returns well-formed paper items", async () => {
    const adapter = registry.get("arxiv");
    expect(adapter).not.toBeNull();
    const result = await adapter!.fetch(request({ limit: 5, since: threeDaysAgo }));
    assertWellFormed(result.items, "arxiv");
    console.log(
      `[live] arxiv: ${result.items.length} items; example: ${JSON.stringify(result.items[0]?.title)}`,
    );
  }, 60_000);

  it("people_data stays unconfigured and fetches nothing", async () => {
    const adapter = registry.get("people_data");
    expect((await adapter!.status()).configured).toBe(false);
    await expect(adapter!.fetch(request({ limit: 5 }))).rejects.toThrow("not configured");
  });

  it("yc returns founder items with their own public links", async () => {
    const adapter = registry.get("yc");
    expect(adapter).not.toBeNull();
    const result = await adapter!.fetch(request({ limit: 5 }));
    // One company page can carry several founders, so the last page may pass the limit.
    assertWellFormed(result.items.slice(0, 5), "yc");
    expect(result.items.some((item) => item.authorUrl?.includes("linkedin.com"))).toBe(true);
    console.log(
      `[live] yc: ${result.items.length} items; example: ${JSON.stringify(result.items[0]?.title)}; ${JSON.stringify(result.items[0]?.authorUrl)}`,
    );
  }, 60_000);
});
