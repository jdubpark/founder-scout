import { SIM_WEB_HOST } from "@agentswarm/shared";
import { describe, expect, it } from "vitest";
import { createSimWorld } from "./index";
import { createSimWeb } from "./web";

const SEED = 47;
const WORLD = createSimWorld({ seed: SEED, founders: 96, days: 18 });
const FOUNDERS = WORLD.founders();
const LAST_DAY = Math.max(...FOUNDERS.map((founder) => founder.appearsOnDay));

function makeWeb(seed = SEED) {
  return createSimWeb({ seed, founders: FOUNDERS, company: (simId) => WORLD.company(simId) });
}

function pageAt(path: string): string {
  return `https://${SIM_WEB_HOST}${path}`;
}

function listedPage(web: ReturnType<typeof makeWeb>, ground: string, page = 1, day = LAST_DAY) {
  const result = web.page(pageAt(`/g/${ground}/${page}`), day);
  expect(result?.status).toBe("ok");
  return result!;
}

function listedGroundIds(web: ReturnType<typeof makeWeb>, ground: string): string[] {
  const result: string[] = [];
  for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
    const page = listedPage(web, ground, pageNumber);
    result.push(...(page.simFounderIds ?? []));
    if (!page.links.some((entry) => entry.text === "Next page")) break;
  }
  return result;
}

describe("simulated web", () => {
  it("serves project and profile pages with numbered links and stage-grounded prose", () => {
    const web = makeWeb();
    const listing = listedPage(web, "mixed");
    expect(listing.url).toBe(pageAt("/g/mixed/1"));
    const projectLinks = listing.links.filter((entry) => new URL(entry.url).pathname.startsWith("/p/"));
    const nobodyLinks = listing.links.filter((entry) => new URL(entry.url).pathname.startsWith("/n/"));
    expect(projectLinks).toHaveLength(15);
    expect(nobodyLinks).toHaveLength(3);
    expect(listing.links.some((entry) => entry.text === "Next page" && entry.url === pageAt("/g/mixed/2"))).toBe(true);
    expect(listing.links.map(({ index }) => index)).toEqual(listing.links.map((_, index) => index));
    expect(listing.links.every(({ url }) => new URL(url).protocol === "https:" && new URL(url).hostname === SIM_WEB_HOST)).toBe(true);
    for (const entry of projectLinks) {
      const page = web.page(entry.url, LAST_DAY)!;
      const founderId = page.simFounderIds?.[0];
      const listedFounder = FOUNDERS.find((candidate) => candidate.simId === founderId)!;
      expect(page.text).toContain(listedFounder.name);
    }
    const listedFounder = FOUNDERS.find((candidate) => candidate.simId === listing.simFounderIds?.[0])!;
    expect(listing.text).toContain(`“${WORLD.company(listedFounder.simId)!.oneLiner}”`);

    const projectUrl = projectLinks[0]!.url;
    const project = web.page(projectUrl, LAST_DAY)!;
    const simId = project.simFounderIds?.[0];
    const founder = FOUNDERS.find((candidate) => candidate.simId === simId)!;
    const company = WORLD.company(founder.simId)!;
    expect(project).toMatchObject({ status: "ok", url: projectUrl, simFounderIds: [founder.simId] });
    expect(project.url).toBe(pageAt(`/p/${founder.simId}`));
    expect(project.text).toContain(`${company.name} was started by ${founder.name}`);
    const funding = company.stage === "pre-seed"
      ? "Funding: The company has not raised money yet."
      : company.stage === "seed"
        ? "Funding: Raised a seed round."
        : "Funding: Closed a Series A.";
    expect(project.text).toContain(funding);
    expect(project.text).toContain(`Team size: ${company.team.length + 1}`);
    expect(project.text).toContain("Progress:");
    expect(project.text).toContain(`“${company.oneLiner}”`);
    const profileLink = project.links.find((entry) => new URL(entry.url).pathname.startsWith("/u/"))!;
    const relatedLinks = project.links.filter((entry) => new URL(entry.url).pathname.startsWith("/p/"));
    const nobodyLink = project.links.find((entry) => new URL(entry.url).pathname.startsWith("/n/"));
    expect(project.links.map(({ index }) => index)).toEqual(project.links.map((_, index) => index));
    expect(new URL(profileLink.url).pathname).toBe(`/u/${founder.simId}`);
    expect(relatedLinks.length).toBeGreaterThanOrEqual(2);
    expect(relatedLinks.length).toBeLessThanOrEqual(3);
    expect(relatedLinks.every((entry) => {
      const relatedId = new URL(entry.url).pathname.split("/").at(-1);
      return FOUNDERS.find((candidate) => candidate.simId === relatedId)?.sector === founder.sector;
    })).toBe(true);
    expect(nobodyLink).toBeDefined();

    const profile = web.page(profileLink.url, LAST_DAY)!;
    expect(profile).toMatchObject({ status: "ok", simFounderIds: [founder.simId] });
    expect(profile.text).toContain(founder.headline);
    expect(profile.text).toContain(`“${company.oneLiner}”`);
    expect(profile.links).toEqual([{ index: 0, url: project.url, text: `${company.name}, project` }]);

    const repeatWorld = createSimWorld({ seed: SEED, founders: 96, days: 18 });
    const repeatWeb = createSimWeb({ seed: SEED, founders: repeatWorld.founders(), company: (id) => repeatWorld.company(id) });
    expect(repeatWeb.page(projectUrl, LAST_DAY)).toEqual(project);
    expect(web.page(pageAt("/unknown/path"), LAST_DAY)).toBeNull();
    expect(web.page("https://other.example/p/not-a-sim-founder", LAST_DAY)).toBeNull();

    for (const [stage, fundingPhrase, progressPhrase] of [
      ["pre-seed", "Funding: The company has not raised money yet.", "Building the first product"],
      ["seed", "Funding: Raised a seed round.", "Running an early product"],
      ["series A", "Funding: Closed a Series A.", "Scaling a product"],
    ] as const) {
      const stageFounder = FOUNDERS.find((candidate) => candidate.stage === stage)!;
      const stagePage = web.page(pageAt(`/p/${stageFounder.simId}`), LAST_DAY)!;
      expect(stagePage.text).toContain(fundingPhrase);
      expect(stagePage.text).toContain(progressPhrase);
    }
  });

  it("gates founder pages and results on each founder's first visible day", () => {
    const web = makeWeb();
    const founder = FOUNDERS.find((candidate) => candidate.appearsOnDay > 0 && candidate.appearsOnDay < LAST_DAY)!;
    const url = pageAt(`/p/${founder.simId}`);

    expect(web.page(url, founder.appearsOnDay - 1)).toBeNull();
    expect(web.page(url, founder.appearsOnDay)?.simFounderIds).toEqual([founder.simId]);
    const beforeSearch = web.search("web", founder.companyName, founder.appearsOnDay - 1, 100);
    expect(beforeSearch.every((hit) => !hit.simFounderIds?.includes(founder.simId))).toBe(true);
    expect(beforeSearch.every((hit) => {
      const id = hit.simFounderIds?.[0];
      return id === undefined || FOUNDERS.find((candidate) => candidate.simId === id)!.appearsOnDay < founder.appearsOnDay;
    })).toBe(true);
  });

  it("keeps a project's links the same on every day, and links only to pages that exist when it does", () => {
    const web = makeWeb();
    const founder = FOUNDERS.find((candidate) => candidate.appearsOnDay === 0
      && FOUNDERS.some((related) => related.simId !== candidate.simId
        && related.sector === candidate.sector && related.appearsOnDay > 0))!;
    const url = pageAt(`/p/${founder.simId}`);
    const earlyPage = web.page(url, 0)!;
    const laterPage = web.page(url, LAST_DAY)!;

    expect(laterPage.links).toEqual(earlyPage.links);
    // A reader that follows any link on the day the page appears finds a page there. A later
    // arrival in the same sector exists, and the page does not link to it.
    expect(earlyPage.links.length).toBeGreaterThan(1);
    for (const entry of earlyPage.links) expect(web.page(entry.url, 0), entry.url).not.toBeNull();
  });

  it("searches sector, company-name, and one-liner words, then orders project hits newest first", () => {
    const web = makeWeb();
    const founder = FOUNDERS.find((candidate) => candidate.appearsOnDay === LAST_DAY)!;
    const oneLinerWord = founder.companyOneLiner.split(/\s+/).find((word) => word.length > 4)!.toLowerCase();

    for (const query of [founder.sector, founder.companyName, oneLinerWord]) {
      const hits = web.search("web", query, LAST_DAY, 500);
      expect(hits.some((hit) => hit.simFounderIds?.includes(founder.simId))).toBe(true);
    }
    const namedFounder = FOUNDERS.find((candidate) => candidate.appearsOnDay < LAST_DAY)!;
    const nameFallback = web.search("web", namedFounder.name, LAST_DAY, 1);
    expect(nameFallback[0]?.simFounderIds?.[0]).not.toBe(namedFounder.simId);

    const projectHits = web.search("web", "teams", LAST_DAY, 500)
      .filter((hit) => new URL(hit.url).pathname.startsWith("/p/"));
    const appearanceDays = projectHits.map((hit) => {
      const id = hit.simFounderIds?.[0];
      return FOUNDERS.find((candidate) => candidate.simId === id)!.appearsOnDay;
    });
    expect(projectHits.length).toBeGreaterThan(10);
    expect(appearanceDays).toEqual([...appearanceDays].sort((left, right) => right - left));
    const fallback = web.search("web", "zzzxylophone", LAST_DAY, 5);
    expect(fallback.length).toBeGreaterThan(0);
    expect(FOUNDERS.find((candidate) => candidate.simId === fallback[0]?.simFounderIds?.[0])?.appearsOnDay).toBe(LAST_DAY);
    expect(web.search("missing-engine", "company", LAST_DAY, 10)).toEqual([]);
  });

  it("filters HN and GitHub to their visible project pages and includes directories and nobody pages on web", () => {
    const web = makeWeb();
    for (const [engine, source] of [["hn", "hackernews"], ["github", "github"]] as const) {
      const hits = web.search(engine, "teams", LAST_DAY, 500);
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(new URL(hit.url).pathname.startsWith("/p/")).toBe(true);
        expect(hit.simFounderIds?.length).toBe(1);
        const founder = FOUNDERS.find((candidate) => candidate.simId === hit.simFounderIds?.[0])!;
        expect(founder.visibleIn).toContain(source);
      }
      const fallback = web.search(engine, "zzzxylophone", LAST_DAY, 1);
      const latestVisibleDay = Math.max(...FOUNDERS.filter((founder) => founder.visibleIn.includes(source)).map((founder) => founder.appearsOnDay));
      const fallbackFounder = FOUNDERS.find((founder) => founder.simId === fallback[0]?.simFounderIds?.[0]);
      expect(fallbackFounder?.visibleIn).toContain(source);
      expect(fallbackFounder?.appearsOnDay).toBe(latestVisibleDay);
    }

    const directory = web.search("web", "mixed project directory", LAST_DAY, 50);
    expect(directory.some((hit) => new URL(hit.url).pathname === "/g/mixed/1")).toBe(true);
    const nobody = web.search("web", "market question", LAST_DAY, 50);
    const nobodyHit = nobody.find((hit) => new URL(hit.url).pathname === "/n/1");
    expect(nobodyHit).toBeDefined();
    expect(nobodyHit?.simFounderIds).toBeUndefined();
    expect(web.page(pageAt("/n/1"), LAST_DAY)?.simFounderIds).toBeUndefined();
  });

  it("keeps the six ground mixes distinct, stable, and sparse where expected", () => {
    const web = makeWeb();
    const ids = (ground: string) => listedGroundIds(web, ground);
    const byId = new Map(FOUNDERS.map((founder) => [founder.simId, founder]));
    const strongEarly = ids("strong-early").map((id) => byId.get(id)!);
    const decent = ids("decent").map((id) => byId.get(id)!);
    const later = ids("later-stage").map((id) => byId.get(id)!);
    const jobs = ids("job-board");
    const small = ids("small-team");
    const mixed = ids("mixed").map((id) => byId.get(id)!);
    const earlyPool = FOUNDERS.filter((founder) => founder.stage === "pre-seed" || founder.stage === "seed");

    expect(strongEarly.length).toBeGreaterThan(0);
    expect(strongEarly.every((founder) => earlyPool.includes(founder))).toBe(true);
    expect(strongEarly.reduce((total, founder) => total + founder.quality, 0) / strongEarly.length)
      .toBeGreaterThan(earlyPool.reduce((total, founder) => total + founder.quality, 0) / earlyPool.length);
    expect(decent.length).toBeGreaterThan(0);
    expect(decent.every((founder) => earlyPool.includes(founder))).toBe(true);
    expect(decent.reduce((total, founder) => total + founder.quality, 0) / decent.length)
      .toBeLessThan(strongEarly.reduce((total, founder) => total + founder.quality, 0) / strongEarly.length);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((founder) => founder.stage === "series A")).toBe(true);
    const earlyCount = (ground: string) => ids(ground).filter((id) => {
      const founder = byId.get(id)!;
      return founder.stage === "pre-seed" || founder.stage === "seed";
    }).length;
    expect(earlyCount("strong-early")).toBeGreaterThan(earlyCount("later-stage"));
    expect(earlyCount("decent")).toBeGreaterThan(earlyCount("later-stage"));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.length).toBeLessThanOrEqual(3);
    expect(small.length).toBeGreaterThan(0);
    expect(jobs.length).toBeLessThan(mixed.length);
    expect(small.length).toBeLessThan(mixed.length);
    expect(new Set(mixed.map((founder) => founder.stage)).size).toBe(3);
    expect(new Set(mixed.map((founder) => Math.round(founder.quality * 10))).size).toBeGreaterThan(3);

    const repeat = makeWeb();
    const otherSeed = makeWeb(SEED + 1);
    expect(repeat.search("web", "mixed project directory", LAST_DAY, 50)).toEqual(
      web.search("web", "mixed project directory", LAST_DAY, 50),
    );
    expect(repeat.page(pageAt("/g/mixed/1"), LAST_DAY)).toEqual(web.page(pageAt("/g/mixed/1"), LAST_DAY));
    expect(listedGroundIds(otherSeed, "job-board")).not.toEqual(jobs);
  });
});
