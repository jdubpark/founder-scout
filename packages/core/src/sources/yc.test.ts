import { describe, expect, it } from "vitest";
import type { PageRead, WebReader } from "../contracts";
import { batchTag } from "./past";
import { createYcAdapter } from "./yc";
import { FIXED_NOW_MS, jsonResponse, readFixture, request, scriptedFetch, textResponse } from "./test-support";

const INDEX_URL = "https://yc-oss.github.io/api/companies/all.json";
const COMPANY_PAGE = "https://www.ycombinator.com/companies/nimbus";
const COMPANY_PAGE_HTML = readFixture("yc-company.html");
const OLDER_PAGE = "https://www.ycombinator.com/companies/older";
const OLDER_PAGE_HTML = '<div data-props="&quot;founders&quot;:[{&quot;full_name&quot;:&quot;Katherine Johnson&quot;,&quot;title&quot;:&quot;Founder&quot;}]"></div>';

const indexEntry = (overrides: Record<string, unknown> = {}) => ({
  name: "Nimbus",
  slug: "nimbus",
  batch: "Winter 2026",
  one_liner: "Weather intelligence for agriculture",
  long_description: "Nimbus sends farmers a forecast for rain, heat and disease pressure each morning, built on satellite and station data.",
  all_locations: "Ames, Iowa, United States",
  team_size: 9,
  industry: "Industrials",
  launched_at: 1764000000,
  url: "https://www.ycombinator.com/companies/nimbus",
  ...overrides,
});

/** Serves the directory index; company pages come from the scripted reader. */
function indexRoute(entries: Array<Record<string, unknown>>) {
  return (url: URL) =>
    url.hostname === "yc-oss.github.io" ? jsonResponse(entries) : textResponse("unexpected host", { status: 400 });
}

interface ScriptedPage {
  status?: PageRead["status"];
  html?: string;
  text?: string;
}

/** A reader that answers from a map of pages and records every address it was asked for. */
function scriptedReader(pages: Record<string, ScriptedPage>): { reader: WebReader; reads: string[] } {
  const reads: string[] = [];
  const reader: WebReader = {
    async read(url, options) {
      reads.push(url);
      const page = pages[url];
      const status = page?.status ?? (page ? "ok" : "unreachable");
      return {
        status,
        detail: status === "ok" ? "" : "Not reachable in the test.",
        url,
        title: "",
        text: page?.text ?? "",
        links: [],
        ...(options?.html !== undefined ? { html: page?.html ?? null } : {}),
      };
    },
  };
  return { reader, reads };
}

const okPage = (html: string, text = ""): ScriptedPage => ({ status: "ok", html, text });

function makeAdapter(entries: Array<Record<string, unknown>>, pages: Record<string, ScriptedPage>) {
  const recorder = scriptedFetch(indexRoute(entries));
  const scripted = scriptedReader(pages);
  const adapter = createYcAdapter({ fetch: recorder.fetch, reader: scripted.reader, now: () => FIXED_NOW_MS });
  return { recorder, scripted, adapter };
}

describe("Y Combinator adapter", () => {
  it("reports itself configured without a network call", async () => {
    const recorder = scriptedFetch(() => {
      throw new Error("status must not call the network");
    });
    const status = await createYcAdapter({ fetch: recorder.fetch }).status();
    expect(status.configured).toBe(true);
    expect(status.detail).toContain("no key needed");
    expect(recorder.urls).toHaveLength(0);
  });

  it("reuses the shared batch tag", () => {
    expect(batchTag("Winter 2026")).toBe("W26");
    expect(batchTag("Spring 2027")).toBe("X27");
    expect(batchTag("late 2026")).toBeNull();
  });

  it("emits one item per founder, newest batch first, with the founder's own links", async () => {
    const { scripted, adapter } = makeAdapter(
      [indexEntry({ slug: "older", name: "Older Co", batch: "Fall 2025" }), indexEntry()],
      {
        [COMPANY_PAGE]: okPage(COMPANY_PAGE_HTML, "Nimbus sends farmers a forecast."),
        [OLDER_PAGE]: okPage(OLDER_PAGE_HTML),
      },
    );
    const result = await adapter.fetch(request({ limit: 10 }));

    expect(scripted.reads).toEqual([COMPANY_PAGE, OLDER_PAGE]);
    expect(result.items.map((item) => item.ref)).toEqual([
      `${COMPANY_PAGE}#founder-1`,
      `${COMPANY_PAGE}#founder-2`,
      `${COMPANY_PAGE}#founder-3`,
      `${OLDER_PAGE}#founder-1`,
    ]);

    const ada = result.items[0]!;
    expect(ada).toMatchObject({
      source: "yc",
      title: "Nimbus (YC W26) — Weather intelligence for agriculture",
      author: "Ada Lovelace",
      authorUrl: "https://linkedin.com/in/ada-lovelace",
      publishedAt: "2025-11-24T16:00:00.000Z",
      metrics: { teamSize: 9 },
      simFounderId: null,
    });
    expect(ada.text).toContain("Ada Lovelace — Co-founder and CEO of Nimbus");
    expect(ada.text).toContain("prev founder @ Cirrus (acquired by Stratus)");
    expect(ada.text).toContain("One-liner: Weather intelligence for agriculture");
    expect(ada.text).toContain("Nimbus sends farmers a forecast for rain, heat and disease pressure each morning");
    expect(ada.text).toContain("Location: Ames, Iowa, United States");
    expect(ada.text).toContain("Team size: 9");
    expect(ada.text).toContain("Industry: Industrials");
    expect(ada.text).toContain("LinkedIn: https://linkedin.com/in/ada-lovelace");
    expect(ada.text).toContain("Twitter: https://twitter.com/ada_lovelace");
    expect(ada.text).toContain("Contact: founders@nimbus.example");
    expect(ada.text).toContain("YC batch: Winter 2026");
    expect(ada.text.length).toBeLessThanOrEqual(4000);

    const grace = result.items[1]!;
    expect(grace.authorUrl).toBe("https://www.linkedin.com/in/grace-hopper/");
    // A founder with no links at all still arrives, with no authorUrl.
    const mary = result.items[2]!;
    expect(mary.author).toBe("Mary Jackson");
    expect(mary.authorUrl).toBeNull();

    const katherine = result.items[3]!;
    expect(katherine.author).toBe("Katherine Johnson");
    expect(katherine.text).toContain("Katherine Johnson — Founder of Older Co");
  });

  it("strips tracking parameters a founder's published links carry", async () => {
    const noisy = `<div data-props="&quot;founders&quot;:[{&quot;full_name&quot;:&quot;Ada Lovelace&quot;,&quot;title&quot;:&quot;CEO&quot;,&quot;linkedin_url&quot;:&quot;https://www.linkedin.com/in/ada-lovelace?utm_source=share&amp;utm_campaign=profile&quot;,&quot;twitter_url&quot;:&quot;https://x.com/ada?skipRedirect=true&quot;}]"></div>`;
    const { adapter } = makeAdapter([indexEntry()], { [COMPANY_PAGE]: okPage(noisy) });
    const result = await adapter.fetch(request({ limit: 10 }));
    const item = result.items[0]!;
    expect(item.authorUrl).toBe("https://www.linkedin.com/in/ada-lovelace");
    expect(item.text).toContain("LinkedIn: https://www.linkedin.com/in/ada-lovelace\n");
    expect(item.text).toContain("Twitter: https://x.com/ada");
  });

  it("stops the walk at the limit and resumes from the cursor on the next fetch", async () => {
    const { adapter } = makeAdapter([indexEntry()], { [COMPANY_PAGE]: okPage(COMPANY_PAGE_HTML) });
    const first = await adapter.fetch(request({ limit: 2 }));
    // The page that reaches the limit is finished, so all three founders arrive.
    expect(first.items).toHaveLength(3);
    expect((first.cursor as { done: string[] }).done).toEqual(["nimbus"]);

    const second = await adapter.fetch(request({ limit: 2, cursor: first.cursor }));
    expect(second.items).toEqual([]);
    expect(second.cursor).toEqual(first.cursor);
  });

  it("skips slugs the cursor marks done", async () => {
    const { scripted, adapter } = makeAdapter([indexEntry()], { [COMPANY_PAGE]: okPage(COMPANY_PAGE_HTML) });
    const result = await adapter.fetch(request({ limit: 10, cursor: { done: ["nimbus"], failed: {} } }));
    expect(scripted.reads).toEqual([]);
    expect(result.items).toEqual([]);
    expect(result.cursor).toEqual({ done: ["nimbus"], failed: {} });
  });

  it("retries a failing page on later fetches and gives it up after three attempts", async () => {
    const { scripted, adapter } = makeAdapter([indexEntry()], { [COMPANY_PAGE]: { status: "unreachable" } });

    const first = await adapter.fetch(request({ limit: 10 }));
    expect(first.items).toEqual([]);
    expect(first.cursor).toEqual({ done: [], failed: { nimbus: 1 } });

    const second = await adapter.fetch(request({ limit: 10, cursor: first.cursor }));
    expect(second.cursor).toEqual({ done: [], failed: { nimbus: 2 } });

    const third = await adapter.fetch(request({ limit: 10, cursor: second.cursor }));
    expect(third.cursor).toEqual({ done: ["nimbus"], failed: {} });

    // Permanently done: a fourth fetch no longer asks for the page.
    const fourth = await adapter.fetch(request({ limit: 10, cursor: third.cursor }));
    expect(fourth.items).toEqual([]);
    expect(fourth.cursor).toEqual(third.cursor);
    expect(scripted.reads).toEqual([COMPANY_PAGE, COMPANY_PAGE, COMPANY_PAGE]);
  });

  it("clears the failure count once a page reads", async () => {
    const { scripted, adapter } = makeAdapter([indexEntry()], { [COMPANY_PAGE]: okPage(COMPANY_PAGE_HTML) });
    const result = await adapter.fetch(request({ limit: 10, cursor: { done: [], failed: { nimbus: 2 } } }));
    expect(result.items.map((item) => item.author)).toEqual(["Ada Lovelace", "Grace Hopper", "Mary Jackson"]);
    expect(result.cursor).toEqual({ done: ["nimbus"], failed: {} });
    expect(scripted.reads).toEqual([COMPANY_PAGE]);
  });

  it("memoizes the index for a day, so two fetches make one index request", async () => {
    let nowMs = FIXED_NOW_MS;
    const recorder = scriptedFetch(indexRoute([indexEntry()]));
    const adapter = createYcAdapter({ fetch: recorder.fetch, now: () => nowMs });

    await adapter.fetch(request({ limit: 10 }));
    await adapter.fetch(request({ limit: 10 }));
    expect(recorder.urls).toEqual([INDEX_URL]);

    nowMs += 24 * 60 * 60 * 1000;
    await adapter.fetch(request({ limit: 10 }));
    expect(recorder.urls).toEqual([INDEX_URL, INDEX_URL]);
  });

  it("falls back to one text item when the founders blob cannot be read", async () => {
    const drifting = "<html><body><div>The founders are Ada Lovelace and Grace Hopper.</div></body></html>";
    const { adapter } = makeAdapter(
      [indexEntry()],
      { [COMPANY_PAGE]: okPage(drifting, "Nimbus sends farmers a forecast for rain, heat and disease pressure each morning.") },
    );
    const result = await adapter.fetch(request({ limit: 10 }));
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item).toMatchObject({
      ref: COMPANY_PAGE,
      source: "yc",
      author: null,
      authorUrl: null,
      metrics: { teamSize: 9 },
      simFounderId: null,
    });
    expect(item.text).toBe("Nimbus sends farmers a forecast for rain, heat and disease pressure each morning.");
    expect(result.cursor).toEqual({ done: ["nimbus"], failed: {} });
  });

  it("falls back the same way when the founders array parses but names nobody", async () => {
    const nameless = '<div data-props="&quot;founders&quot;:[{&quot;title&quot;:&quot;CEO&quot;},{&quot;linkedin_url&quot;:&quot;https://linkedin.com/in/nobody&quot;}]"></div>';
    const { adapter } = makeAdapter(
      [indexEntry()],
      { [COMPANY_PAGE]: okPage(nameless, "Nimbus sends farmers a forecast for rain, heat and disease pressure each morning.") },
    );
    const result = await adapter.fetch(request({ limit: 10 }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.author).toBeNull();
    expect(result.items[0]!.text).toBe("Nimbus sends farmers a forecast for rain, heat and disease pressure each morning.");
  });

  it("takes the company's contact email from after the founders, not a founder's own link", async () => {
    const personalFirst = `<a href="mailto:ada@example.test">Ada</a><div data-props="&quot;founders&quot;:[{&quot;full_name&quot;:&quot;Ada Lovelace&quot;,&quot;title&quot;:&quot;CEO&quot;}]"></div><a href="mailto:founders@nimbus.example">us</a>`;
    const { adapter } = makeAdapter([indexEntry()], { [COMPANY_PAGE]: okPage(personalFirst) });
    const result = await adapter.fetch(request({ limit: 10 }));
    expect(result.items[0]!.text).toContain("Contact: founders@nimbus.example");
    expect(result.items[0]!.text).not.toContain("ada@example.test");
  });

  it("throws a clear error when the index is not a list", async () => {
    const recorder = scriptedFetch(() => jsonResponse({ companies: [] }));
    const adapter = createYcAdapter({ fetch: recorder.fetch });
    await expect(adapter.fetch(request({ limit: 5 }))).rejects.toThrow(
      "The Y Combinator company directory returned an unexpected response.",
    );
  });

  it("skips index entries without a usable slug or batch", async () => {
    const { scripted, adapter } = makeAdapter(
      [
        { name: "No slug", batch: "Winter 2026" },
        { name: "No batch", slug: "no-batch" },
        indexEntry({ slug: "zeta" }),
      ],
      { "https://www.ycombinator.com/companies/zeta": okPage(COMPANY_PAGE_HTML) },
    );
    const result = await adapter.fetch(request({ limit: 10 }));
    expect(scripted.reads).toEqual(["https://www.ycombinator.com/companies/zeta"]);
    expect(result.items).toHaveLength(3);
  });
});
