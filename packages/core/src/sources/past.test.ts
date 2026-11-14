import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { maskText, type PastCase } from "@agentswarm/shared";
import type { FetchFn } from "./http";
import {
  collectLaunchPosts,
  fetchUnicornNames,
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
  it("paginates the encoded search and keeps only supported YC launch-title forms", async () => {
    const pages = [
      [
        hit("1", "Launch HN: Acme (YC W18) - Builds tools"),
        hit("2", "Launch HN: Beta (YC S19) – Builds tools"),
        hit("3", "Launch HN: Gamma (YC F20) — Builds tools"),
        hit("bad1", "Launch HN: Heroku for AWS Lambda"),
      ],
      [
        hit("4", "Launch HN: Delta (YC X21)"),
        hit("5", "Launch HN: Numer (YC.S18) – Models"),
        hit("6", "Launch HN: Tarj (YC W18 Nonprofit) – Translators"),
        hit("7", "Launch HN: TrapFi (YC W18) pays freelance developers"),
        hit("bad2", 'Ask HN: What are the rules for posting to "Launch HN"'),
      ],
    ];
    const searches: URL[] = [];
    const threads: string[] = [];
    const fetchFn: FetchFn = async (address) => {
      const url = new URL(address);
      if (url.pathname.endsWith("search_by_date")) {
        searches.push(url);
        return response({ hits: pages[Number(url.searchParams.get("page"))] ?? [], nbPages: 2 });
      }
      threads.push(url.pathname);
      return response({ id: url.pathname.split("/").at(-1), children: [] });
    };
    const cases = await collectLaunchPosts({ from: "2018-01-01", to: "2018-12-31", fetchFn, pauseMs: 0 });

    expect(searches.map((url) => url.searchParams.get("page"))).toEqual(["0", "1"]);
    expect(searches.map((url) => url.searchParams.get("query"))).toEqual(['"Launch HN"', '"Launch HN"']);
    expect(searches.map((url) => url.searchParams.get("tags"))).toEqual(["story", "story"]);
    expect(searches.map((url) => url.searchParams.get("numericFilters"))).toEqual([
      "created_at_i>=1514764800,created_at_i<1546214400",
      "created_at_i>=1514764800,created_at_i<1546214400",
    ]);
    expect(searches[0]?.search).toContain("%22");
    expect(searches[0]?.search).toContain("%3E%3D");
    expect(threads).toHaveLength(7);
    expect(cases.map(({ subject, batch }) => [subject.company, batch])).toEqual([
      ["Acme", "W18"], ["Beta", "S19"], ["Gamma", "F20"], ["Delta", "X21"],
      ["Numer", "S18"], ["Tarj", "W18"], ["TrapFi", "W18"],
    ]);
  });

  it("builds dated evidence from the post and only the author's nested replies in range", async () => {
    const postAt = Date.parse("2018-02-03T10:00:00.000Z") / 1000;
    const longReply = `<p>${"r".repeat(2100)} &amp; done</p>`;
    const urls: string[] = [];
    const fetchFn: FetchFn = async (address) => {
      const url = new URL(address);
      urls.push(url.toString());
      if (url.pathname.endsWith("search_by_date")) {
        return response({ hits: [hit("42", "Launch HN: Acme Tools (YC W18) - The thing", {
          story_text: "<p>I'm Alice Smith. I am Bob. My name is Cara Jones. Dan here. We're Eve and Frank. We are Grace, Henry and Iris. I'm Monday. I'm Hi. I'm Hey. I'm HN. I'm YC. I'm Acme Tools.</p><p>So here is the thing. Founder here. Example here shows it. Happy to answer questions, and Maya here will too. James, Tim and Aaron here. Later: Dana here again.</p><p>See https://www.acmetools.com/start and https://outside.example/info &amp; more.</p>",
          url: "https://www.acme-tools.example/",
        })], nbPages: 1 });
      }
      return response({
        id: "42",
        children: [
          { id: "late", author: "founder1", created_at: new Date((postAt + 73 * 3600) * 1000).toISOString(), text: "outside window", children: [] },
          { id: "other", author: "someone", created_at: new Date((postAt + 3600) * 1000).toISOString(), text: "other author", children: [] },
          { id: "reply1", author: "founder1", created_at: new Date((postAt + 2 * 3600) * 1000).toISOString(), text: "<p>first &amp; reply. I'm Jane Smith, one of the founders.</p>", children: [
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
        domains: ["acme-tools.example", "acmetools.com"],
        handles: ["founder1"],
      },
    });
    expect(pastCase?.subject.people).toEqual(expect.arrayContaining([
      "Alice Smith", "Bob", "Cara Jones", "Dan", "Eve", "Frank", "Grace", "Henry", "Iris",
      "Maya", "James", "Tim", "Aaron", "Dana", "Jane Smith",
    ]));
    expect(pastCase?.subject.people).toHaveLength(15);
    expect(pastCase?.evidence.map((item) => item.kind)).toEqual(["launch", "post", "post"]);
    expect(pastCase?.evidence.map((item) => item.date)).toEqual([
      "2018-02-03T10:00:00.000Z", "2018-02-03T12:00:00.000Z", "2018-02-03T13:00:00.000Z",
    ]);
    expect(pastCase?.evidence[0]?.text).toContain("I'm Alice Smith.");
    expect(pastCase?.evidence[0]?.text).toContain("See https://www.acmetools.com/start and https://outside.example/info & more.");
    expect(pastCase?.evidence[1]?.text).toBe("first & reply. I'm Jane Smith, one of the founders.");
    const maskedReply = maskText(pastCase?.evidence[1]?.text ?? "", pastCase!.subject);
    expect(maskedReply).toContain("I'm Founder");
    expect(maskedReply).not.toContain("Jane Smith");
    expect(pastCase?.evidence[2]?.text).toHaveLength(2000);
    expect(pastCase?.evidence[2]?.text).toMatch(/^r+$/);
  });

  it("skips a story with no post text and no qualifying replies", async () => {
    const fetchFn: FetchFn = async (address) => new URL(address).pathname.endsWith("search_by_date")
      ? response({ hits: [hit("empty", "Launch HN: Empty (YC W18)", { story_text: "" })], nbPages: 1 })
      : response({ id: "empty", children: [{ author: "other", created_at: "2018-02-03T11:00:00.000Z", text: "not the author", children: [] }] });
    expect(await collectLaunchPosts({ from: "2018-01-01", to: "2018-12-31", fetchFn, pauseMs: 0 })).toEqual([]);
  });
  it("keeps one dated launch per company and intake", async () => {
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

  it("keeps company sites from first-party links and ignores hosts shared by other companies", async () => {
    const launch = (title: string, extra: Record<string, unknown>): FetchFn => async (address) => {
      const url = new URL(address);
      if (url.pathname.endsWith("search_by_date")) return response({ hits: [hit("7", title, extra)], nbPages: 1 });
      return response({ id: "7", children: [] });
    };
    const [shared] = await collectLaunchPosts({
      from: "2018-01-01", to: "2018-12-31", pauseMs: 0,
      fetchFn: launch("Launch HN: Hubble (YC W18) - Telescopes", {
        story_text: "<p>Code is at https://github.com/hubble/scope and a demo at https://www.youtube.com/watch?v=1</p>",
        url: "https://github.com/hubble/scope",
      }),
    });
    expect(shared?.subject.domains).toEqual([]);
    expect(shared?.subject.aliases).toEqual([]);

    const [own] = await collectLaunchPosts({
      from: "2018-01-01", to: "2018-12-31", pauseMs: 0,
      fetchFn: launch("Launch HN: SafeWing (YC W18) - A safety net", {
        story_text: "Get it here: <a href=\"https:&#x2F;&#x2F;www.safewing.com\">https:&#x2F;&#x2F;www.safewing.com</a><p>When we quit our jobs, we were on our own.<p>See https://docs.safewing.com, and more.",
        url: "",
      }),
    });
    expect(own?.evidence[0]?.text).toBe("Get it here: https://www.safewing.com\n\nWhen we quit our jobs, we were on our own.\n\nSee https://docs.safewing.com, and more.");
    expect(own?.subject.domains).toEqual(["safewing.com", "docs.safewing.com"]);
  });

  it("adds short spellings of the company's own name so masking removes them", async () => {
    const collectOne = async (title: string, storyText: string) => (await collectLaunchPosts({
      from: "2018-01-01", to: "2018-12-31", pauseMs: 0,
      fetchFn: async (address) => new URL(address).pathname.endsWith("search_by_date")
        ? response({ hits: [hit("9", title, { story_text: storyText })], nbPages: 1 })
        : response({ id: "9", children: [] }),
    }))[0];
    const cases = await Promise.all([
      collectOne("Launch HN: Fintual Inc. (YC S18) – Investing", "Fintual invests your savings. Try Fintual today."),
      collectOne("Launch HN: The Buttermilk Company (YC S18) – Meals", "Post."),
      collectOne("Launch HN: Snark AI (YC S18) – GPUs", "Post."),
      collectOne("Launch HN: Synthetic Minds (YC S18) – Proofs", "Post."),
      collectOne("Launch HN: Brex (YC W17) – Cards", "Post."),
    ]);
    expect(cases.map((pastCase) => pastCase?.subject.aliases)).toEqual([
      ["FintualInc.", "Fintual"],
      ["TheButtermilkCompany", "Buttermilk Company", "Buttermilk"],
      ["SnarkAI", "Snark"],
      ["SyntheticMinds"],
      [],
    ]);
    expect(maskText(cases[0]?.evidence[0]?.text ?? "", cases[0]!.subject))
      .toBe("the company invests your savings. Try the company today.");
  });
});

describe("past outcome labels", () => {
  it("parses reviewed CSV and extracts only company columns from a company table", () => {
    expect(parseLabelsCsv('SOURCE,Company,Outcome\n"Partner, verified","Acme, Inc.",1\nlist,Unknown,2\nlist,,0\nlist,Nope,0')).toEqual([
      { company: "Acme, Inc.", outcome: 1, source: "Partner, verified" },
      { company: "Nope", outcome: 0, source: "list" },
    ]);
    expect(() => parseLabelsCsv("company,name\nAcme,Acme")).toThrow(/company, outcome, source/);

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

  it("fetches only Wikipedia's wikitext endpoint and dates its source label", async () => {
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

  it("matches a reviewed label by the company's name and leaves unnamed companies unknown", () => {
    const cases = [historicalCase("1", "Acme", 0), historicalCase("2", "Nope", 0), historicalCase("3", "Negative Co", 0)];
    const result = labelPastCases(cases, { reviewed: [
      { company: "ACME", outcome: 1, source: "reviewed CSV" },
      { company: "Unknown Winner", outcome: 1, source: "reviewed CSV" },
      { company: "Negative Co", outcome: 0, source: "reviewed CSV" },
    ] });
    expect(result.positives).toBe(1);
    expect(result.reviewedMisses).toEqual(["Unknown Winner"]);
    expect(result.cases.map(({ subject, outcome, outcomeSource }) => [subject.company, outcome, outcomeSource])).toEqual([
      ["Acme", 1, "reviewed CSV"], ["Negative Co", 0, "reviewed CSV"],
    ]);
    expect(result.unknown).toEqual([{ company: "Nope", reason: "no label names it" }]);
  });

  it("requires the company's own name with its intake or site and never matches from a link alone", () => {
    const makeCase = (id: string, company: string, batch: string, domains: string[] = [], aliases: string[] = []) => ({
      ...historicalCase(id, company, 0),
      batch,
      subject: { ...historicalCase(id, company, 0).subject, domains, aliases },
    });
    const directory = (entries: ReturnType<typeof parseYcDirectory>, minTeam = 100) => ({ entries, source: "directory", minTeam });
    const entry = (name: string, extra: Partial<ReturnType<typeof parseYcDirectory>[number]> = {}) => ({
      name, formerNames: [], batch: "W18", status: "Active", topCompany: false, teamSize: 10, domain: null, ...extra,
    });
    const cases = [
      makeCase("1", "Bolt", "W18", ["bolt.dev"]),
      makeCase("2", "Pathway", "W18", ["pathway.com"]),
      makeCase("3", "Snark AI", "S18"),
      makeCase("4", "Mystery", "S18", ["newname.com"]),
      makeCase("5", "Small Tool", "W18", [], ["airbnb"]),
    ];
    const result = labelPastCases(cases, {
      directory: directory([
        entry("Bolt", { batch: "S14", teamSize: 900 }),
        entry("Bolt", { batch: "W18", status: "Inactive" }),
        entry("Pathway", { batch: "S17", status: "Inactive", domain: "pathway.com" }),
        entry("Activeloop", { batch: "S18", formerNames: ["Snark.ai", "Snark AI"], teamSize: 150 }),
        entry("New Name", { batch: "S18", teamSize: 400, domain: "newname.com" }),
      ]),
      listed: [{ company: "Airbnb", outcome: 1, source: "public list" }],
    });
    expect(result.cases.map(({ subject, outcome }) => [subject.company, outcome])).toEqual([
      ["Bolt", 0], ["Pathway", 0], ["Snark AI", 1],
    ]);
    expect(result.unknown.map(({ company }) => company)).toEqual(["Mystery", "Small Tool"]);
  });

  it("applies the stated directory bar, trusts public-list positives only for active companies, and leaves unknowns out", () => {
    const entry = (name: string, extra: Partial<ReturnType<typeof parseYcDirectory>[number]> = {}) => ({
      name, formerNames: [], batch: "W18", status: "Active", topCompany: false, teamSize: 10, domain: null, ...extra,
    });
    const cases = [
      historicalCase("1", "Public Co", 0), historicalCase("2", "Top Co", 0), historicalCase("3", "Team At", 0),
      historicalCase("4", "Team Below", 0), historicalCase("5", "Dead Co", 0), historicalCase("6", "Bought Co", 0),
      historicalCase("7", "Missing Size", 0), historicalCase("8", "Ghost Co", 0), historicalCase("9", "Lean Co", 0),
      historicalCase("10", "Bought Listed", 0), historicalCase("11", "Dead Listed", 0), historicalCase("12", "Reviewed Co", 0),
    ].map((pastCase) => ({ ...pastCase, batch: "W18" }));
    const entries = [
      entry("Public Co", { status: "Public" }),
      entry("Top Co", { topCompany: true }),
      entry("Team At", { teamSize: 100 }),
      entry("Team Below", { teamSize: 99 }),
      entry("Dead Co", { status: "Inactive", teamSize: 500 }),
      entry("Bought Co", { status: "Acquired" }),
      entry("Missing Size", { teamSize: null }),
      entry("Lean Co", { teamSize: 60 }),
      entry("Bought Listed", { status: "Acquired" }),
      entry("Dead Listed", { status: "Inactive" }),
      entry("Reviewed Co", { status: "Inactive" }),
    ];
    const result = labelPastCases(cases, {
      reviewed: [{ company: "Reviewed Co", outcome: 1, source: "reviewed sale" }],
      directory: { entries, source: "directory", minTeam: 100 },
      listed: [
        { company: "Lean Co", outcome: 1, source: "public list" },
        { company: "Bought Listed", outcome: 1, source: "public list" },
        { company: "Dead Listed", outcome: 1, source: "public list" },
      ],
    });
    expect(result.cases.map(({ subject, outcome, outcomeSource }) => [subject.company, outcome, outcomeSource])).toEqual([
      ["Public Co", 1, "directory: publicly listed"],
      ["Top Co", 1, "directory: on the programme's list of top companies"],
      ["Team At", 1, "directory: operating with 100 people"],
      ["Team Below", 0, "directory: operating with 99 people, under the bar of 100"],
      ["Dead Co", 0, "directory: no longer operating"],
      ["Lean Co", 1, "public list"],
      ["Dead Listed", 0, "directory: no longer operating"],
      ["Reviewed Co", 1, "reviewed sale"],
    ]);
    expect(result.unknown).toEqual([
      { company: "Bought Co", reason: "acquired, terms not public" },
      { company: "Missing Size", reason: "operating, headcount not published" },
      { company: "Ghost Co", reason: "not found in the directory" },
      { company: "Bought Listed", reason: "acquired, terms not public" },
    ]);
  });

  it("maps the directory's fields and intake tags before outcome matching", () => {
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
});

describe("past dataset files", () => {
  it("atomically writes and reads JSONL, returns empty when missing, and summarizes cohorts", async () => {
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
