import { describe, expect, it, vi } from "vitest";
import { createLinkupSearchEngine, LINKUP_SEARCH_API } from "./search-linkup";

describe("Linkup web search", () => {
  it("caps results, keeps public links, and enforces its daily ceiling", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      requestUrl = url;
      requestInit = init;
      return Response.json({ results: [
        {
          name: "An early founder",
          url: "https://acme.com/founder?utm_source=linkup#about",
          content: "x".repeat(320),
        },
        {
          name: "Video link",
          url: "https://www.youtube.com/watch?v=abc123",
          content: "A pointer for a person to open.",
        },
        {
          name: "Professional network profile",
          url: "https://www.linkedin.com/in/founder",
          content: "This is a pointer only.",
        },
      ] });
    });
    const engine = createLinkupSearchEngine({
      env: { LINKUP_API_KEY: "linkup-test-key-ceiling", LINKUP_SEARCHES_PER_DAY: "1" },
      fetch,
    });

    await expect(engine.status()).resolves.toMatchObject({ configured: true });
    await expect(engine.search('startup "seed stage" founder', 500)).resolves.toEqual([
      { url: "https://acme.com/founder", title: "An early founder", snippet: `${"x".repeat(299)}…` },
      { url: "https://www.youtube.com/watch?v=abc123", title: "Video link", snippet: "A pointer for a person to open." },
      { url: "https://www.linkedin.com/in/founder", title: "Professional network profile", snippet: "This is a pointer only." },
    ]);
    expect(requestUrl).toBe(LINKUP_SEARCH_API);
    expect(requestInit?.method).toBe("POST");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer linkup-test-key-ceiling");
    expect(JSON.parse(requestInit?.body as string)).toEqual({
      q: 'startup "seed stage" founder',
      depth: "fast",
      outputType: "searchResults",
      maxResults: 100,
    });

    await expect(engine.search("another query", 2)).resolves.toEqual([]);
    await expect(engine.status()).resolves.toMatchObject({
      configured: true,
      detail: "Today's LINKUP_SEARCHES_PER_DAY ceiling has been reached.",
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    const missingKey = createLinkupSearchEngine({ env: {}, fetch });
    await expect(missingKey.status()).resolves.toEqual({ configured: false, detail: "LINKUP_API_KEY is not set." });
    await expect(missingKey.search("anything", 1)).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
