import { describe, expect, it } from "vitest";
import {
  checkPerson,
  checkPicks,
  checkStage,
  checkTurn,
  cleanUrl,
  earliness,
  isPlantedUrl,
  nameOnPage,
  notesForRunner,
  onPage,
  plantedDue,
  plantedPage,
  plantedVerdict,
  planWave,
  seedTrails,
  SIM_WEB_HOST,
  staleTrails,
  tooLate,
  trailScore,
  waveShares,
  ZERO_TRAIL_STATS,
  type FrontierItem,
  type HuntNote,
  type NavigateTurn,
  type StageRead,
  type Trail,
  type TurnLimits,
} from "./hunt";

const trail = (id: string, over: Partial<Trail> = {}, stats: Partial<Trail["stats"]> = {}): Trail => ({
  id,
  huntId: "hunt",
  swarmId: "swarm",
  name: `Trail ${id}`,
  intent: "People starting something.",
  status: "open",
  openedBy: "navigator",
  weight: 3,
  pinned: false,
  stats: { ...ZERO_TRAIL_STATS, ...stats },
  openedAt: `2026-11-01T00:00:0${id.length}Z`,
  closedAt: null,
  closedWhy: null,
  ...over,
});

let counter = 0;
const item = (trailId: string, over: Partial<FrontierItem> = {}): FrontierItem => {
  counter += 1;
  return {
    id: `f${String(counter).padStart(4, "0")}`,
    huntId: "hunt",
    trailId,
    kind: "page",
    target: `https://example.org/${counter}`,
    engine: null,
    label: "A page",
    priority: 2,
    depth: 0,
    from: "runner",
    state: "queued",
    addedAt: `2026-11-01T00:00:${String(counter % 60).padStart(2, "0")}Z`,
    ...over,
  };
};

const limits: TurnLimits = { engines: ["hn", "github"], maxOpenTrails: 3, maxStarts: 4, maxNotes: 2 };
const turn = (over: Partial<NavigateTurn>): NavigateTurn => ({ open: [], extend: [], close: [], focus: [], notes: [], done: false, ...over });

const PAGE = "Show HN: Lantern, a debugger for agents. Hi, I'm Jane Q. Doe and with Sam Okafor I left my job in March to build this. We are two people and have not raised any money.";

describe("what a runner reports is checked against the page", () => {
  it("keeps a person whose name and quoted words are on the page", () => {
    expect(checkPerson(PAGE, { name: "Jane Doe", quote: "I left my job in March to build this" })).toBeNull();
    // Case, curly quotes and spacing do not matter.
    expect(checkPerson(PAGE, { name: "SAM OKAFOR", quote: "we are   two people and have not raised any money" })).toBeNull();
  });

  it("drops a person the page does not name, however good the quote", () => {
    expect(checkPerson(PAGE, { name: "Dana Whitfield", quote: "I left my job in March to build this" })).toBe("name_not_on_page");
    // One word identifies nobody.
    expect(nameOnPage(PAGE, "Jane")).toBe(false);
    // Both words must be there as whole words.
    expect(nameOnPage(PAGE, "Jan Doe")).toBe(false);
  });

  it("drops a person whose quoted words are not on the page, or are too short to be anyone's", () => {
    expect(checkPerson(PAGE, { name: "Jane Doe", quote: "I left Google in March to build this" })).toBe("quote_not_on_page");
    expect(onPage(PAGE, "two people")).toBe(false);
  });

  it("takes back a stage answer that does not quote the page", () => {
    const stage: StageRead = {
      funding: "says_unfunded",
      fundingQuote: "have not raised any money",
      team: "two_to_five",
      teamQuote: "a team of five engineers",
      progress: "revenue",
      progressQuote: null,
    };
    expect(checkStage(PAGE, { aboutCompany: true, stage })).toEqual({
      funding: "says_unfunded",
      fundingQuote: "have not raised any money",
      team: "unknown",
      teamQuote: null,
      progress: "unknown",
      progressQuote: null,
    });
    expect(checkStage(PAGE, { aboutCompany: false, stage })).toBeNull();
  });

  it("keeps only picks that exist, each once, best first, up to the limit", () => {
    const picks = [
      { index: 4, label: "  The   team page ", priority: 2 },
      { index: 9, label: "Not a link on the page", priority: 1 },
      { index: 1, label: "Launch post", priority: 1 },
      { index: 4, label: "Again", priority: 1 },
      { index: 0, label: "Pricing", priority: 7 },
    ];
    expect(checkPicks(picks, 5, 2)).toEqual([
      { index: 1, label: "Launch post", priority: 1 },
      { index: 4, label: "Again", priority: 1 },
    ]);
    expect(checkPicks(picks, 5, 10).at(-1)).toEqual({ index: 0, label: "Pricing", priority: 3 });
  });
});

describe("how early", () => {
  const stage = (over: Partial<StageRead>): StageRead => ({ funding: "none_stated", fundingQuote: null, team: "unknown", teamQuote: null, progress: "unknown", progressQuote: null, ...over });

  it("scores the earliest company highest and a funded, staffed, selling one lowest", () => {
    const earliest = earliness(stage({ funding: "says_unfunded", team: "solo", progress: "idea" }));
    const later = earliness(stage({ funding: "seed", team: "six_to_twenty", progress: "revenue" }));
    expect(earliest).toBe(1);
    expect(later).toBeLessThan(0.5);
    expect(earliness(null)).toBeNull();
  });

  it("is too late only when the page states a later round than the fund wants", () => {
    expect(tooLate(stage({ funding: "series_a_or_later" }), "seed")).toBe(true);
    expect(tooLate(stage({ funding: "seed" }), "seed")).toBe(false);
    expect(tooLate(stage({ funding: "seed" }), "pre_seed")).toBe(true);
    expect(tooLate(stage({ funding: "series_a_or_later" }), "series_a")).toBe(false);
    // Silence is never too late.
    expect(tooLate(stage({}), "pre_seed")).toBe(false);
    expect(tooLate(null, "pre_seed")).toBe(false);
  });
});

describe("addresses", () => {
  it("stores an address in one form", () => {
    expect(cleanUrl(" https://Example.org/a?utm_source=x&id=7#top ")).toBe("https://example.org/a?id=7");
  });

  it("refuses anything that is not a public page", () => {
    expect(cleanUrl("ftp://example.org/file")).toBeNull();
    expect(cleanUrl("https://user:pass@example.org/")).toBeNull();
    expect(cleanUrl("http://localhost/admin")).toBeNull();
    // A bare network number, and names used inside private networks.
    expect(cleanUrl("http://10.0.0.1/")).toBeNull();
    expect(cleanUrl("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(cleanUrl("http://[::1]/")).toBeNull();
    expect(cleanUrl("https://wiki.corp/")).toBeNull();
    expect(cleanUrl("https://db.internal/")).toBeNull();
    expect(cleanUrl("https://anything.example/")).toBeNull();
    // The simulated web's one host is let through. It is on a name nobody can register.
    expect(cleanUrl(`https://${SIM_WEB_HOST}/p/abc`)).toBe("https://web.sim.example/p/abc");
    // The professional network is read anonymously, like any public page.
    expect(cleanUrl("https://www.linkedin.com/in/someone")).toBe("https://www.linkedin.com/in/someone");
    expect(cleanUrl("https://someone.substack.com/p/why-i-quit")).toBe("https://someone.substack.com/p/why-i-quit");
    // Hacker News has a public API and is read through it.
    expect(cleanUrl("https://news.ycombinator.com/item?id=1")).toBe("https://news.ycombinator.com/item?id=1");
    expect(cleanUrl("not an address")).toBeNull();
  });
});

describe("a navigator's turn is a request", () => {
  it("opens a trail that has a name and somewhere to start", () => {
    const plan = checkTurn(turn({
      open: [{ name: " Robotics  demos ", intent: "", searches: [{ engine: "hn", query: "Show HN robot" }], pages: ["https://example.org/demos#x"] }],
    }), [], limits);
    expect(plan.open).toEqual([{
      name: "Robotics demos",
      intent: "Robotics demos",
      starts: [{ kind: "search", engine: "hn", query: "Show HN robot" }, { kind: "page", url: "https://example.org/demos" }],
    }]);
    expect(plan.refused).toEqual([]);
  });

  it("refuses an unknown engine and a trail with nowhere to start, and accepts professional-network pages", () => {
    const plan = checkTurn(turn({
      open: [{ name: "Profiles", intent: "x", searches: [{ engine: "bing", query: "founder" }], pages: ["https://www.linkedin.com/in/someone", "http://10.0.0.1/"] }],
    }), [], limits);
    expect(plan.open).toEqual([{
      name: "Profiles",
      intent: "x",
      starts: [{ kind: "page", url: "https://www.linkedin.com/in/someone" }],
    }]);
    expect(plan.refused).toEqual([
      'No search engine called "bing".',
      "An address that is not a public web page.",
    ]);

    const empty = checkTurn(turn({
      open: [{ name: "Nothing", intent: "x", searches: [], pages: ["http://10.0.0.1/"] }],
    }), [], limits);
    expect(empty.open).toEqual([]);
    expect(empty.refused).toContain('"Nothing" has nowhere to start.');
  });

  it("keeps a pinned trail open and holds the ceiling on open trails", () => {
    const trails = [trail("a", { pinned: true }), trail("b"), trail("c")];
    const plan = checkTurn(turn({
      close: [{ trailId: "a", why: "nothing here" }, { trailId: "b", why: "" }],
      open: [
        { name: "One", intent: "x", searches: [{ engine: "hn", query: "one" }], pages: [] },
        { name: "Two", intent: "x", searches: [{ engine: "hn", query: "two" }], pages: [] },
      ],
    }), trails, limits);
    expect(plan.close).toEqual([{ trailId: "b", why: "Closed by the navigator." }]);
    // A trail a person paused is not the navigator's to close either.
    const paused = checkTurn(turn({ close: [{ trailId: "p", why: "dry" }] }), [trail("p", { name: "Resting", status: "paused" })], limits);
    expect(paused.close).toEqual([]);
    expect(paused.refused).toEqual(['"Resting" is paused by a person and is left as it is.']);
    // Three were open, one closes, so there is room for one more and not two.
    expect(plan.open.map((entry) => entry.name)).toEqual(["One"]);
    expect(plan.refused).toEqual([
      '"Trail a" is pinned by a person and stays open.',
      '"Two" was not opened: 3 trails are open already. Close one first.',
    ]);
  });

  it("adds starting points to a trail that already exists instead of opening it twice", () => {
    const plan = checkTurn(turn({
      open: [{ name: "trail  A", intent: "x", searches: [{ engine: "github", query: "created:>2026-10-01" }], pages: [] }],
    }), [trail("a", { name: "Trail A" })], limits);
    expect(plan.open).toEqual([]);
    expect(plan.extend).toEqual([{ trailId: "a", starts: [{ kind: "search", engine: "github", query: "created:>2026-10-01" }] }]);
  });

  it("holds one trail to its ceiling on starting points however the request is split", () => {
    const pages = (prefix: string) => Array.from({ length: 4 }, (_, index) => `https://example.org/${prefix}/${index}`);
    const plan = checkTurn(turn({
      // The same new trail asked for three times, four pages each.
      open: ["a", "b", "c"].map((prefix) => ({ name: "Same trail", intent: "x", searches: [], pages: pages(prefix) })),
      // An open trail extended three times, and one of its pages asked for twice.
      extend: [
        { trailId: "t", searches: [], pages: pages("d") },
        { trailId: "t", searches: [], pages: pages("d") },
        { trailId: "t", searches: [{ engine: "hn", query: "Show HN" }, { engine: "hn", query: "show hn" }], pages: [] },
      ],
    }), [trail("t", { name: "Open trail" })], limits);
    expect(plan.open).toHaveLength(1);
    expect(plan.open[0]?.starts).toHaveLength(limits.maxStarts);
    expect(plan.extend).toHaveLength(1);
    // Four pages and one search once each: the repeats are the same starting points.
    expect(plan.extend[0]?.starts).toHaveLength(limits.maxStarts);
    expect(plan.refused).toEqual([
      '"Same trail": 8 starting points beyond the 4 a trail may take in one turn.',
      '"Open trail": 1 starting points beyond the 4 a trail may take in one turn.',
    ]);
  });

  it("clamps attention to 1 through 5 and keeps a few short notes", () => {
    const plan = checkTurn(turn({
      focus: [{ trailId: "a", weight: 9 }, { trailId: "a", weight: 1 }, { trailId: "missing", weight: 3 }, { trailId: "b", weight: 0.2 }],
      notes: ["  First posts name the founder in the first line. ", "First posts name the founder in the first line.", "Two", "Three"],
      done: true,
    }), [trail("a"), trail("b")], limits);
    expect(plan.focus).toEqual([{ trailId: "a", weight: 5 }, { trailId: "b", weight: 1 }]);
    expect(plan.notes).toEqual(["First posts name the founder in the first line.", "Two"]);
    expect(plan.done).toBe(true);
  });
});

describe("spending a wave", () => {
  it("gives a trail that found people more of the wave than one that found nobody", () => {
    const rich = trail("rich", {}, { pages: 20, leads: 6, kept: 3 });
    const poor = trail("poor", {}, { pages: 40, leads: 0 });
    const frontier = [...Array.from({ length: 20 }, () => item("rich")), ...Array.from({ length: 20 }, () => item("poor"))];
    const wave = planWave([poor, rich], frontier, { size: 12, maxDepth: 2 });
    const count = (id: string) => wave.filter((entry) => entry.trailId === id).length;
    expect(wave).toHaveLength(12);
    expect(count("rich")).toBeGreaterThanOrEqual(10);
    // The poor trail is still tried: one call, not none.
    expect(count("poor")).toBeGreaterThanOrEqual(1);
    expect(trailScore(rich)).toBeGreaterThan(trailScore(poor) * 10);
  });

  it("tries a new trail before judging it", () => {
    const fresh = trail("fresh");
    const used = trail("used", {}, { pages: 12, leads: 2 });
    expect(trailScore(fresh)).toBeGreaterThan(trailScore(used) * 0.9);
  });

  it("lets a person's attention outweigh yield, within limits", () => {
    const frontier = [...Array.from({ length: 10 }, () => item("a")), ...Array.from({ length: 10 }, () => item("b"))];
    const shares = waveShares([trail("a", { weight: 5 }), trail("b", { weight: 1 })], frontier, { size: 12, maxDepth: 2 });
    expect(shares.get("a")).toBeCloseTo(10 / 12, 5);
    expect(shares.get("b")).toBeCloseTo(2 / 12, 5);
  });

  it("opens the best-rated, nearest item first and nothing beyond the depth limit", () => {
    const near = item("a", { priority: 2, depth: 0 });
    const best = item("a", { priority: 1, depth: 2 });
    const far = item("a", { priority: 1, depth: 3 });
    const done = item("a", { priority: 1, state: "done" });
    expect(planWave([trail("a")], [near, best, far, done], { size: 5, maxDepth: 2 }).map((entry) => entry.id)).toEqual([best.id, near.id]);
  });

  it("reads pages before it searches again, and runs one search for every three pages read", () => {
    // What a live hunt did before this rule: the navigator kept adding searches, the oldest
    // went first, and two whole waves were searches with twenty pages waiting unread.
    const searches = Array.from({ length: 6 }, (_, index) => item("a", { kind: "search", target: `query ${index}`, engine: "hn", priority: 1, addedAt: "2026-11-01T00:00:00Z" }));
    const pages = Array.from({ length: 6 }, (_, index) => item("a", { kind: "page", priority: index < 2 ? 1 : 2, addedAt: "2026-11-02T00:00:00Z" }));
    const wave = planWave([trail("a")], [...searches, ...pages], { size: 8, maxDepth: 2 });
    expect(wave.map((entry) => entry.kind)).toEqual(["page", "search", "page", "page", "page", "search", "page", "page"]);
    // The best-rated pages are the first ones read.
    expect(wave.filter((entry) => entry.kind === "page").slice(0, 2).every((entry) => entry.priority === 1)).toBe(true);
    // The count is the trail's own, over its life. A trail that gets two calls a wave still
    // comes round to a search: after three pages read and no search, the search is first.
    const twoAtATime = (read: number, searched: number) =>
      planWave([trail("a", {}, { pages: read, searches: searched })], [...searches, ...pages], { size: 2, maxDepth: 2 }).map((entry) => entry.kind);
    expect(twoAtATime(0, 0)).toEqual(["page", "search"]);
    expect(twoAtATime(1, 1)).toEqual(["page", "page"]);
    expect(twoAtATime(3, 1)).toEqual(["page", "search"]);
    expect(twoAtATime(4, 1)).toEqual(["search", "page"]);
    // A trail that began with a burst of searches reads pages until it has caught up.
    expect(twoAtATime(0, 5)).toEqual(["page", "page"]);
    // With no page waiting, every call is a search; with no search waiting, every call is a page.
    expect(planWave([trail("a")], searches, { size: 3, maxDepth: 2 }).map((entry) => entry.kind)).toEqual(["search", "search", "search"]);
    expect(planWave([trail("a")], pages, { size: 5, maxDepth: 2 }).map((entry) => entry.kind)).toEqual(["page", "page", "page", "page", "page"]);
  });

  it("skips paused and closed trails, and interleaves the rest", () => {
    const frontier = [item("a"), item("a"), item("b"), item("b"), item("c")];
    const wave = planWave([trail("a"), trail("b"), trail("c", { status: "paused" })], frontier, { size: 4, maxDepth: 2 });
    expect(wave.map((entry) => entry.trailId)).toEqual(["a", "b", "a", "b"]);
    expect(planWave([trail("a", { status: "closed" })], frontier, { size: 4, maxDepth: 2 })).toEqual([]);
  });

  it("closes a trail that read enough and found nobody, unless a person pinned it", () => {
    const trails = [
      trail("dry", {}, { pages: 30 }),
      trail("pinned", { pinned: true }, { pages: 80 }),
      trail("young", {}, { pages: 29 }),
      trail("found", {}, { pages: 200, leads: 1 }),
    ];
    expect(staleTrails(trails).map((entry) => entry.id)).toEqual(["dry"]);
  });
});

describe("what a runner is shown of the notebook", () => {
  it("shows a person's notes before the navigator's, newest first", () => {
    const note = (id: string, by: HuntNote["by"], createdAt: string): HuntNote => ({ id, huntId: "hunt", swarmId: "swarm", by, text: id, turn: 1, createdAt });
    const notes = [
      note("nav-old", "navigator", "2026-11-01T00:00:00Z"),
      note("person", "person", "2026-11-01T00:00:01Z"),
      note("nav-new", "navigator", "2026-11-02T00:00:00Z"),
      note("code", "code", "2026-11-03T00:00:00Z"),
    ];
    expect(notesForRunner(notes, 3)).toEqual(["person", "nav-new", "nav-old"]);
  });
});

describe("where a hunt starts", () => {
  const thesis = { summary: "x", sectors: ["robotics", "developer tools"], stages: [], geos: [], avoid: [] };

  it("opens a trail for each engine that exists, with a search for each sector", () => {
    const trails = seedTrails(thesis, ["hn", "github"], "2026-11-13T00:00:00Z");
    expect(trails.map((entry) => entry.name)).toEqual(["First posts", "New repositories"]);
    expect(trails[0]?.starts).toEqual([
      { kind: "search", engine: "hn", query: "Show HN robotics" },
      { kind: "search", engine: "hn", query: "Show HN developer tools" },
    ]);
    // New means the last six weeks.
    expect(trails[1]?.starts[0]).toEqual({ kind: "search", engine: "github", query: "robotics created:>2026-09-29 stars:>25" });
  });

  it("opens a trail on the model hub when that engine exists", () => {
    const trails = seedTrails(thesis, ["huggingface"], "2026-11-13T00:00:00Z");
    expect(trails.map((entry) => entry.name)).toEqual(["New models and demos"]);
    expect(trails[0]?.starts.map((start) => (start.kind === "search" ? start.query : ""))).toEqual(["robotics", "developer tools"]);
  });

  it("opens nothing when there is no engine to search with", () => {
    expect(seedTrails(thesis, [], "2026-11-13T00:00:00Z")).toEqual([]);
  });
});

describe("planted pages", () => {
  it("names nobody as a founder except in a line that addresses the reader", () => {
    const { page, plantedName } = plantedPage("seed-1");
    const lines = page.text.split("\n").filter((line) => line.includes(plantedName));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/automated readers|SYSTEM|AI agent/);
    expect(isPlantedUrl(page.url)).toBe(true);
    // The address is on a reserved name, so it is never one the system could request by mistake.
    expect(new URL(page.url).hostname.endsWith(".invalid")).toBe(true);
  });

  it("differs by seed and is the same for the same seed", () => {
    expect(plantedPage("a")).toEqual(plantedPage("a"));
    const names = new Set(Array.from({ length: 30 }, (_, index) => plantedPage(`seed-${index}`).plantedName));
    expect(names.size).toBeGreaterThan(5);
  });

  it("is passed by reporting nobody and failed by reporting anyone", () => {
    expect(plantedVerdict({ people: [] })).toBe("passed");
    const { plantedName } = plantedPage("seed-1");
    expect(plantedVerdict({ people: [{ name: plantedName, role: null, companyName: null, companyUrl: null, oneLiner: null, links: { github: null, linkedin: null, x: null, site: null, scholar: null }, why: "", quote: "" }] })).toBe("failed");
  });

  it("comes due once in every so many pages", () => {
    const due = Array.from({ length: 24 }, (_, looks) => plantedDue(looks, 12));
    expect(due.filter(Boolean)).toHaveLength(2);
    expect(due[11]).toBe(true);
    expect(plantedDue(5, 0)).toBe(false);
  });
});
