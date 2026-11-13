import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { maskText, type PastCase } from "@agentswarm/shared";
import { httpGet, type FetchFn } from "./http";
import {
  collectLaunchPosts,
  fetchUnicornNames,
  directoryOutcome,
  labelPastCases,
  parseYcDirectory,
  parseLabelsCsv,
  parseUnicornWikitext,
  pastCasesFile,
  readPastCases,
  summarisePastCases,
  writePastCases,
} from "./past";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function hit(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    objectID: id,
    title,
    author: "founder1",
    created_at: "2018-02-03T10:00:00.000Z",
    created_at_i: 1517652000,
    story_text: "A company post.",
    url: null,
    points: 900,
    num_comments: 80,
    ...extra,
  };
}

function historicalCase(id: string, company: string, outcome: 0 | 1, cohort = "2018-Q1"): PastCase {
  return {
    id,
    cohort,
    asOf: "2018-04-01T00:00:00.000Z",
    subject: { company, aliases: [], people: [], domains: [], handles: [] },
    evidence: [{ kind: "launch", source: "hackernews", title: company, text: "post", date: "2018-01-01T00:00:00.000Z" }],
    outcome,
    outcomeSource: outcome ? "label" : "unlabelled",
  };
}

describe("past launch collection", () => {
  it("uses encoded search parameters and fetches every search page", async () => {
    const urls: URL[] = [];
    const fetchFn: FetchFn = async (address) => {
      const url = new URL(address);
      urls.push(url);
      return response({ hits: [], nbPages: 2 });
    };
    await collectLaunchPosts({ from: "2018-01-01", to: "2018-12-31", fetchFn, pauseMs: 0 });

    expect(urls).toHaveLength(2);
    expect(urls.map((url) => url.pathname)).toEqual(["/api/v1/search_by_date", "/api/v1/search_by_date"]);
    expect(urls.map((url) => url.searchParams.get("query"))).toEqual(['"Launch HN"', '"Launch HN"']);
    expect(urls.map((url) => url.searchParams.get("tags"))).toEqual(["story", "story"]);
    expect(urls.map((url) => url.searchParams.get("numericFilters"))).toEqual([
      "created_at_i>=1514764800,created_at_i<1546214400",
      "created_at_i>=1514764800,created_at_i<1546214400",
    ]);
    expect(urls.map((url) => url.searchParams.get("page"))).toEqual(["0", "1"]);
    expect(urls[0]?.search).toContain("%22");
    expect(urls[0]?.search).toContain("%3E%3D");
    expect(urls[0]?.search).toContain("%2C");
    expect(urls[0]?.search).toContain("%3C");
  });

  it("keeps YC launch titles with each dash or no tagline and drops other title forms", async () => {
    const kept = [
      hit("1", "Launch HN: Acme (YC W18) - Builds tools"),
      hit("2", "Launch HN: Beta (YC S19) – Builds tools"),
      hit("3", "Launch HN: Gamma (YC F20) — Builds tools"),
      hit("4", "Launch HN: Delta (YC X21)"),
      hit("5", "Launch HN: TrapFi (YC W18) pays freelance developers"),
    ];
    const calls: string[] = [];
    const fetchFn: FetchFn = async (address) => {
      const url = new URL(address);
      calls.push(url.pathname);
      if (url.pathname.endsWith("search_by_date")) {
        return response({ hits: [...kept, hit("6", "Launch HN: Heroku for AWS Lambda"), hit("7", 'Ask HN: What are the rules for posting to "Launch HN"')], nbPages: 1 });
      }
      return response({ id: url.pathname.split("/").at(-1), children: [] });
    };
    const cases = await collectLaunchPosts({ from: "2018-01-01", to: "2018-12-31", fetchFn, pauseMs: 0 });
    expect(cases.map((pastCase) => pastCase.subject.company)).toEqual(["Acme", "Beta", "Gamma", "Delta", "TrapFi"]);
    expect(calls.filter((path) => path.includes("/items/")).length).toBe(5);
  });

  it("builds dated evidence from the post and only the author's replies in the nested time window", async () => {
    const postAt = Date.parse("2018-02-03T10:00:00.000Z") / 1000;
    const longReply = `<p>${"r".repeat(2100)} &amp; done</p>`;
    const urls: string[] = [];
    const fetchFn: FetchFn = async (address) => {
      const url = new URL(address);
      urls.push(url.toString());
      if (url.pathname.endsWith("search_by_date")) {
        return response({ hits: [hit("42", "Launch HN: Acme Tools (YC W18) - The thing", {
          story_text: "<p>I'm Alice Smith. I am Bob. My name is Cara Jones. Dan here. We're Eve and Frank. We are Grace, Henry and Iris. I'm Monday. I'm Hi. I'm Hey. I'm HN. I'm YC. I'm Acme Tools.</p><p>See https://www.acmetools.com/start and https://outside.example/info &amp; more.</p>",
          url: "https://www.acme-tools.example/",
        })], nbPages: 1 });
      }
      return response({
        id: "42",
        children: [
          { id: "late", author: "founder1", created_at: new Date((postAt + 73 * 3600) * 1000).toISOString(), text: "outside window", children: [] },
          { id: "other", author: "someone", created_at: new Date((postAt + 3600) * 1000).toISOString(), text: "other author", children: [] },
          { id: "reply1", author: "founder1", created_at: new Date((postAt + 2 * 3600) * 1000).toISOString(), text: "<p>first &amp; reply</p>", children: [
            { id: "reply2", author: "founder1", created_at: new Date((postAt + 3 * 3600) * 1000).toISOString(), text: longReply, children: [] },
          ] },
          { id: "early", author: "founder1", created_at: new Date((postAt - 1) * 1000).toISOString(), text: "before post", children: [] },
          { id: "reply3", author: "founder1", created_at: new Date((postAt + 4 * 3600) * 1000).toISOString(), text: "third", children: [] },
        ],
      });
    };
    const [pastCase] = await collectLaunchPosts({ from: "2018-01-01", to: "2018-12-31", fetchFn, pauseMs: 0, maxReplies: 2 });
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("/items/42");
    expect(pastCase).toMatchObject({
      id: "past_hn_42",
      cohort: "2018-Q1",
      asOf: "2018-02-06T10:00:00.000Z",
      outcome: 0,
      outcomeSource: "unlabelled",
      subject: {
        company: "Acme Tools",
        aliases: expect.arrayContaining(["AcmeTools", "acme-tools"]),
        people: ["Alice Smith", "Bob", "Cara Jones", "Dan", "Eve", "Frank", "Grace", "Henry", "Iris"],
        domains: ["acme-tools.example", "acmetools.com"],
        handles: ["founder1"],
      },
    });
    expect(pastCase?.evidence.map((item) => item.kind)).toEqual(["launch", "post", "post"]);
    expect(pastCase?.evidence.map((item) => item.date)).toEqual([
      "2018-02-03T10:00:00.000Z",
      "2018-02-03T12:00:00.000Z",
      "2018-02-03T13:00:00.000Z",
    ]);
    expect(pastCase?.evidence[0]?.text).toContain("I'm Alice Smith.");
    expect(pastCase?.evidence[0]?.text).toContain("See https://www.acmetools.com/start and https://outside.example/info & more.");
    expect(pastCase?.evidence[1]?.text).toBe("first & reply");
    expect(pastCase?.evidence[2]?.text).toHaveLength(2000);
    expect(pastCase?.evidence[2]?.text).toMatch(/^r+$/);
  });

  it("skips a story with no post text and no qualifying replies", async () => {
    const fetchFn: FetchFn = async (address) => new URL(address).pathname.endsWith("search_by_date")
      ? response({ hits: [hit("empty", "Launch HN: Empty (YC W18)", { story_text: "" })], nbPages: 1 })
      : response({ id: "empty", children: [{ author: "other", created_at: "2018-02-03T11:00:00.000Z", text: "not the author", children: [] }] });
    expect(await collectLaunchPosts({ from: "2018-01-01", to: "2018-12-31", fetchFn, pauseMs: 0 })).toEqual([]);
  });

  it("lets the shared HTTP boundary reject never-fetch hosts", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => response({}));
    await expect(httpGet(fetchFn, "Hacker News", "https://www.linkedin.com/company/example")).rejects.toThrow(/never-fetch list/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("past outcome labels", () => {
  it("parses reordered CSV headers, quoted fields and skips incomplete outcomes", () => {
    expect(parseLabelsCsv('SOURCE,Company,Outcome\n"Partner, verified","Acme, Inc.",1\nlist,Unknown,2\nlist,,0\nlist,Nope,0')).toEqual([
      { company: "Acme, Inc.", outcome: 1, source: "Partner, verified" },
      { company: "Nope", outcome: 0, source: "list" },
    ]);
    expect(() => parseLabelsCsv("company,name\nAcme,Acme")).toThrow(/company, outcome, source/);
  });

  it("reads only company columns from tables whose header includes Company", () => {
    const fixture = `
{| class="wikitable"
! Year !! Count
|-
| 2020 || 10
|}
{| class="wikitable"
! Rank !! Company !! Valuation
|-
| 1 || [[Anthropic]] || $18B
|-
| 2 || [[Stripe, Inc.|Stripe]]<ref>note</ref> || $50B
|-
| 3 || Plain Company || $2B
|}
{| class="wikitable"
! Country !! Companies
|-
| US || [[Should Not Appear]]
|}
{| class="wikitable"
! Company !! Year
|-
| [[OpenAI|OpenAI]] || 2015
|}
`;
    expect(parseUnicornWikitext(fixture)).toEqual(["Anthropic", "Stripe", "Plain Company", "OpenAI"]);
  });

  it("fetches only the public Wikipedia wikitext endpoint and labels its read date", async () => {
    let requested = "";
    const fetchFn: FetchFn = async (address) => {
      requested = address;
      return response({ parse: { wikitext: "{|\n! Company\n|-\n| [[Example Co]]\n|}" } });
    };
    const result = await fetchUnicornNames({ fetchFn });
    const url = new URL(requested);
    expect(url.origin).toBe("https://en.wikipedia.org");
    expect(url.pathname).toBe("/w/api.php");
    expect(url.searchParams.get("action")).toBe("parse");
    expect(url.searchParams.get("page")).toBe("List_of_unicorn_startup_companies");
    expect(url.searchParams.get("prop")).toBe("wikitext");
    expect(result.names).toEqual(["Example Co"]);
    expect(result.source).toMatch(/^Wikipedia, List of unicorn startup companies, read \d{4}-\d{2}-\d{2}$/);
  });

  it("matches labels on the company's own name, leaves out a company no label names, and reports unmatched positives", () => {
    const cases = [
      { ...historicalCase("1", "Acme, Inc.", 0), subject: { ...historicalCase("1", "Acme, Inc.", 0).subject, aliases: ["acme"] } },
      historicalCase("2", "Nope", 0),
      historicalCase("3", "Negative Co", 0),
    ];
    const result = labelPastCases(cases, { reviewed: [
      { company: "ACME", outcome: 1, source: "unicorn list" },
      { company: "Unknown Winner", outcome: 1, source: "unicorn list" },
      { company: "Negative Co", outcome: 0, source: "reviewed CSV" },
    ] });
    expect(result.positives).toBe(1);
    expect(result.reviewedMisses).toEqual(["Unknown Winner"]);
    // The company no label names is left out, not counted as a failure.
    expect(result.cases.map(({ subject, outcome, outcomeSource }) => [subject.company, outcome, outcomeSource])).toEqual([
      ["Acme, Inc.", 1, "unicorn list"], ["Negative Co", 0, "reviewed CSV"],
    ]);
    expect(result.unknown).toEqual([{ company: "Nope", reason: "no label names it" }]);
  });
});

describe("reading a launch as it was written", () => {
  const launch = (title: string, extra: Record<string, unknown>): FetchFn => async (address) => {
    const url = new URL(address);
    if (url.pathname.endsWith("search_by_date")) return response({ hits: [hit("9", title, extra)], nbPages: 1 });
    return response({ id: "9", children: [] });
  };
  const collectOne = async (title: string, storyText: string) => (await collectLaunchPosts({
    from: "2018-01-01", to: "2018-12-31", pauseMs: 0, fetchFn: launch(title, { story_text: storyText }),
  }))[0];

  it("keeps paragraphs apart when the page marks them with an opening tag only", async () => {
    const pastCase = await collectOne(
      "Launch HN: SafeWing (YC W18) - A safety net",
      'Get it here: <a href="https:&#x2F;&#x2F;www.safewing.com" rel="nofollow">https:&#x2F;&#x2F;www.safewing.com</a><p>When we quit our jobs, we were on our own.<p>Second paragraph.',
    );
    expect(pastCase?.evidence[0]?.text).toBe("Get it here: https://www.safewing.com\n\nWhen we quit our jobs, we were on our own.\n\nSecond paragraph.");
    expect(pastCase?.subject.domains).toEqual(["safewing.com"]);
  });

  it("drops the full stop or comma a sentence leaves on a link", async () => {
    const pastCase = await collectOne(
      "Launch HN: Station (YC W18) - One app",
      "<p>See https://getstation.com. Docs at https://docs.getstation.com, and more.</p>",
    );
    expect(pastCase?.subject.domains).toEqual(["getstation.com", "docs.getstation.com"]);
  });

  it("tidies doubled spaces in a title, and reads the intake however it is punctuated", async () => {
    const doubled = await collectOne("Launch HN: Snark  AI (YC S18) – GPUs", "<p>Post.</p>");
    expect(doubled).toMatchObject({ batch: "S18", subject: { company: "Snark AI" } });
    expect(doubled?.evidence[0]?.title).toBe("Launch HN: Snark AI (YC S18) – GPUs");
    expect(await collectOne("Launch HN: Numer (YC.S18) – Models", "<p>Post.</p>")).toMatchObject({ batch: "S18", subject: { company: "Numer" } });
    expect(await collectOne("Launch HN: Tarj (YC W18 Nonprofit) – Translators", "<p>Post.</p>")).toMatchObject({ batch: "W18", subject: { company: "Tarj" } });
  });

  it("adds the shorter spellings a post uses for its own company, so the name does not survive masking", async () => {
    const aliasesOf = async (title: string) => (await collectOne(title, "<p>Post.</p>"))?.subject.aliases;
    expect(await aliasesOf("Launch HN: Fintual Inc. (YC S18) – Investing")).toEqual(["FintualInc.", "Fintual"]);
    expect(await aliasesOf("Launch HN: The Buttermilk Company (YC S18) – Meals")).toEqual(["TheButtermilkCompany", "Buttermilk Company", "Buttermilk"]);
    expect(await aliasesOf("Launch HN: Snark AI (YC S18) – GPUs")).toEqual(["SnarkAI", "Snark"]);
    expect(await aliasesOf("Launch HN: Synthetic Minds (YC S18) – Proofs")).toEqual(["SyntheticMinds"]);
    expect(await aliasesOf("Launch HN: Brex (YC W17) – Cards")).toEqual([]);

    const fintual = await collectOne("Launch HN: Fintual Inc. (YC S18) – Investing", "<p>Fintual invests your savings. Try Fintual today.</p>");
    expect(maskText(fintual?.evidence[0]?.text ?? "", fintual!.subject)).toBe("the company invests your savings. Try the company today.");
  });

  it("finds names with inner capitals and hyphens, and does not take a nationality or the site for a person", async () => {
    const pastCase = await collectOne(
      "Launch HN: Lettr (YC W18) - Newsletters",
      "<p>Hi Hacker News! I'm Hamish McKenzie. We're Brazilian founders. We are Leif, Erin, and Aidan. My name is Chen-Chen. Hacker News here we come.</p>",
    );
    expect(pastCase?.subject.people).toEqual(["Hamish McKenzie", "Chen-Chen", "Leif", "Erin", "Aidan"]);
  });

  it("masks a founder who is named only in a reply", async () => {
    const fetchFn: FetchFn = async (address) => {
      const url = new URL(address);
      if (url.pathname.endsWith("search_by_date")) return response({ hits: [hit("11", "Launch HN: Quiet (YC W18) - Notes", { story_text: "<p>We built a notes tool.</p>" })], nbPages: 1 });
      return response({ id: "11", children: [
        { id: "r1", author: "founder1", created_at: "2018-02-03T11:00:00.000Z", text: "<p>Thanks. I'm Jane Smith, one of the founders.</p>", children: [] },
      ] });
    };
    const [pastCase] = await collectLaunchPosts({ from: "2018-01-01", to: "2018-12-31", pauseMs: 0, fetchFn });
    expect(pastCase?.subject.people).toEqual(["Jane Smith"]);
    expect(maskText(pastCase?.evidence[1]?.text ?? "", pastCase!.subject)).toBe("Thanks. I'm Founder A, one of the founders.");
  });

  it("does not take a sentence opener or a role for a person", async () => {
    const pastCase = await collectOne(
      "Launch HN: Plain (YC W18) - Words",
      "<p>So here is the thing. Founder here. Example here shows it. Happy to answer questions, and Maya here will too.</p>",
    );
    expect(pastCase?.subject.people).toEqual(["Maya"]);
  });

  it("takes every name from a list that ends in 'here'", async () => {
    const pastCase = await collectOne(
      "Launch HN: Hogg (YC W20) - Analytics",
      "<p>James, Tim and Aaron here - we are building analytics. Later: Dana here again.</p>",
    );
    expect(pastCase?.subject.people).toEqual(["James", "Tim", "Aaron", "Dana"]);
  });
});

describe("one company, one case", () => {
  it("keeps only the first launch when a company posts twice", async () => {
    const fetchFn: FetchFn = async (address) => {
      const url = new URL(address);
      if (url.pathname.endsWith("search_by_date")) {
        return response({ hits: [
          hit("20", "Launch HN: Paint (YC S19) – Second go", { created_at: "2019-11-03T10:00:00.000Z", created_at_i: 1572775200 }),
          hit("10", "Launch HN: Paint (YC S19) – First go", { created_at: "2019-08-03T10:00:00.000Z", created_at_i: 1564826400 }),
          hit("30", "Launch HN: Paint (YC W21) – A namesake from another intake", { created_at: "2019-12-03T10:00:00.000Z", created_at_i: 1575367200 }),
        ], nbPages: 1 });
      }
      return response({ id: "x", children: [] });
    };
    const cases = await collectLaunchPosts({ from: "2019-01-01", to: "2020-01-01", fetchFn, pauseMs: 0 });
    expect(cases.map((item) => item.id)).toEqual(["past_hn_10", "past_hn_30"]);
  });
});

describe("names taken from links", () => {
  const launch = (title: string, extra: Record<string, unknown>): FetchFn => async (address) => {
    const url = new URL(address);
    if (url.pathname.endsWith("search_by_date")) return response({ hits: [hit("7", title, extra)], nbPages: 1 });
    return response({ id: "7", children: [] });
  };

  it("does not treat a host many companies share as the company's own site", async () => {
    const [pastCase] = await collectLaunchPosts({
      from: "2018-01-01", to: "2018-12-31", pauseMs: 0,
      fetchFn: launch("Launch HN: Hubble (YC W18) - Telescopes", {
        story_text: "<p>Code is at https://github.com/hubble/scope and a demo at https://www.youtube.com/watch?v=1</p>",
        url: "https://github.com/hubble/scope",
      }),
    });
    expect(pastCase?.subject.domains).toEqual([]);
    expect(pastCase?.subject.aliases).toEqual([]);
  });

  it("takes the label that names the company, not the first one, from its site's address", async () => {
    const [pastCase] = await collectLaunchPosts({
      from: "2018-01-01", to: "2018-12-31", pauseMs: 0,
      fetchFn: launch("Launch HN: Acme (YC W18) - Anvils", { story_text: "<p>Try it at https://app.getacme.io/start</p>", url: "" }),
    });
    expect(pastCase?.subject.domains).toEqual(["app.getacme.io"]);
    expect(pastCase?.subject.aliases).toEqual(["getacme"]);
  });

  it("never gives a case the outcome of a company it only links to", () => {
    const linked = { ...historicalCase("1", "Small Tool", 0), subject: { ...historicalCase("1", "Small Tool", 0).subject, aliases: ["airbnb"] } };
    const result = labelPastCases([linked], { listed: [{ company: "Airbnb", outcome: 1, source: "public list" }] });
    expect(result.cases).toEqual([]);
    expect(result.positives).toBe(0);
    expect(result.unknown).toEqual([{ company: "Small Tool", reason: "no label names it" }]);
  });

  it("lets the first matching label win, so a reviewed file can override a list", () => {
    const result = labelPastCases([historicalCase("1", "Bolt", 0)], {
      reviewed: [{ company: "Bolt", outcome: 0, source: "reviewed: a different Bolt" }],
      listed: [{ company: "Bolt", outcome: 1, source: "public list" }],
    });
    expect(result.cases[0]).toMatchObject({ outcome: 0, outcomeSource: "reviewed: a different Bolt" });
  });
});

describe("outcome labels from a company directory", () => {
  const entry = (name: string, extra: Partial<ReturnType<typeof parseYcDirectory>[number]> = {}) => ({
    name, formerNames: [], batch: "W18", status: "Active", topCompany: false, teamSize: 10, domain: null, ...extra,
  });
  const withBatch = (id: string, company: string, batch = "W18", domains: string[] = []) => ({
    ...historicalCase(id, company, 0), batch, subject: { ...historicalCase(id, company, 0).subject, domains },
  });
  const directory = (entries: ReturnType<typeof entry>[], minTeam = 100) => ({ entries, source: "directory", minTeam });

  it("reads the directory's own field names and turns an intake into the tag a launch title uses", () => {
    const entries = parseYcDirectory([
      { name: " Acme ", former_names: ["Old Acme", 7], batch: "Winter 2018", status: "Active", top_company: true, team_size: 40, website: "https://www.acme.com/about" },
      { name: "Spring Co", batch: "Spring 2025", status: "Inactive", website: "https://github.com/spring" },
      { name: "No Batch", batch: "Unspecified" },
      { batch: "Summer 2019" },
    ]);
    expect(entries).toEqual([
      { name: "Acme", formerNames: ["Old Acme"], batch: "W18", status: "Active", topCompany: true, teamSize: 40, domain: "acme.com" },
      { name: "Spring Co", formerNames: [], batch: "X25", status: "Inactive", topCompany: false, teamSize: null, domain: null },
    ]);
    expect(() => parseYcDirectory({ companies: [] })).toThrow(/unexpected/);
  });

  it("holds a company to the stated bar, and says it cannot tell for an acquisition", () => {
    expect(directoryOutcome(entry("A", { status: "Public", teamSize: null }), 100).outcome).toBe(1);
    expect(directoryOutcome(entry("A", { topCompany: true, status: "Acquired" }), 100).outcome).toBe(1);
    expect(directoryOutcome(entry("A", { teamSize: 100 }), 100).outcome).toBe(1);
    expect(directoryOutcome(entry("A", { teamSize: 99 }), 100)).toEqual({ outcome: 0, reason: "operating with 99 people, under the bar of 100" });
    expect(directoryOutcome(entry("A", { status: "Inactive", teamSize: 500 }), 100).outcome).toBe(0);
    expect(directoryOutcome(entry("A", { status: "Acquired" }), 100).outcome).toBeNull();
    expect(directoryOutcome(entry("A", { teamSize: null }), 100).outcome).toBeNull();
  });

  it("matches on name and intake together, so a namesake from another year is not the same company", () => {
    const result = labelPastCases([withBatch("1", "Bolt", "W18")], {
      directory: directory([entry("Bolt", { batch: "S14", teamSize: 900 }), entry("Bolt", { batch: "W18", status: "Inactive" })]),
    });
    expect(result.cases[0]).toMatchObject({ outcome: 0, outcomeSource: "directory: no longer operating" });
  });

  it("finds a renamed company by its former name, and never by a site alone", () => {
    const result = labelPastCases([withBatch("1", "Snark AI", "S18"), withBatch("2", "Mystery", "S18", ["newname.com"])], {
      directory: directory([
        entry("Activeloop", { batch: "S18", formerNames: ["Snark.ai", "Snark AI"], teamSize: 150 }),
        entry("New Name", { batch: "S18", domain: "newname.com", teamSize: 400 }),
      ]),
    });
    expect(result.cases.map((item) => [item.subject.company, item.outcome])).toEqual([["Snark AI", 1]]);
    expect(result.cases[0]?.outcomeSource).toBe("directory: operating with 150 people");
    // A post that links to another company's site in the same intake does not take its outcome.
    expect(result.unknown).toEqual([{ company: "Mystery", reason: "not found in the directory" }]);
  });

  it("accepts another intake only when the name and the site both match", () => {
    const result = labelPastCases([withBatch("1", "Pathway", "W18", ["pathway.com"]), withBatch("2", "Bolt", "W18", ["bolt.dev"])], {
      directory: directory([
        entry("Pathway", { batch: "S17", domain: "pathway.com", status: "Inactive" }),
        entry("Bolt", { batch: "S14", domain: "bolt.com", teamSize: 900 }),
      ]),
    });
    expect(result.cases.map((item) => [item.subject.company, item.outcome])).toEqual([["Pathway", 0]]);
    expect(result.unknown).toEqual([{ company: "Bolt", reason: "not found in the directory" }]);
  });

  it("leaves out a case whose outcome nobody can state, instead of calling it a failure", () => {
    const result = labelPastCases([withBatch("1", "Bought Co"), withBatch("2", "Ghost Co"), withBatch("3", "Small Co")], {
      directory: directory([entry("Bought Co", { status: "Acquired" }), entry("Small Co", { teamSize: 12 })]),
    });
    expect(result.cases.map((item) => item.subject.company)).toEqual(["Small Co"]);
    expect(result.unknown).toEqual([
      { company: "Bought Co", reason: "acquired, terms not public" },
      { company: "Ghost Co", reason: "not found in the directory" },
    ]);
  });

  it("believes the public list of successes only for a company the directory shows still operating", () => {
    const listed = ["Lean Co", "Bought Co", "Dead Co", "Ghost Co"].map((company) => ({ company, outcome: 1 as const, source: "public list" }));
    const result = labelPastCases([withBatch("1", "Lean Co"), withBatch("2", "Bought Co"), withBatch("3", "Dead Co"), withBatch("4", "Ghost Co")], {
      directory: directory([entry("Lean Co", { teamSize: 60 }), entry("Bought Co", { status: "Acquired" }), entry("Dead Co", { status: "Inactive" })]),
      listed,
    });
    // Small but operating and listed: a success. Shut down under that name: the listed one is a namesake.
    expect(result.cases.map((item) => [item.subject.company, item.outcome, item.outcomeSource])).toEqual([
      ["Lean Co", 1, "public list"],
      ["Dead Co", 0, "directory: no longer operating"],
    ]);
    // Bought, or absent from the directory: the name alone is not enough either way.
    expect(result.unknown.map((item) => item.company)).toEqual(["Bought Co", "Ghost Co"]);
  });

  it("lets a person's own label win over the directory", () => {
    const result = labelPastCases([withBatch("1", "Bought Co")], {
      reviewed: [{ company: "Bought Co", outcome: 1, source: "reviewed: sold for a known price" }],
      directory: directory([entry("Bought Co", { status: "Acquired" })]),
    });
    expect(result.cases[0]).toMatchObject({ outcome: 1, outcomeSource: "reviewed: sold for a known price" });
    expect(result.unknown).toEqual([]);
  });
});

describe("past dataset files", () => {
  it("atomically writes and reads JSONL, returns an empty list when missing, and summarizes cohorts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentswarm-past-"));
    temporary.push(directory);
    expect(await readPastCases(directory)).toEqual([]);
    const cases = [historicalCase("1", "Winner", 1), historicalCase("2", "Other", 0), historicalCase("3", "Later", 0, "2018-Q2")];
    expect(await writePastCases(directory, cases)).toBe(pastCasesFile(directory));
    expect(await readPastCases(directory)).toEqual(cases);
    expect(await readFile(pastCasesFile(directory), "utf8")).toContain("\n");
    expect(summarisePastCases(cases)).toEqual({
      cases: 3,
      positives: 1,
      cohorts: [{ cohort: "2018-Q1", cases: 2, positives: 1 }, { cohort: "2018-Q2", cases: 1, positives: 0 }],
    });
  });
});
