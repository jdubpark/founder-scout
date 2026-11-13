import { describe, expect, it } from "vitest";
import {
  COMPANY_DIMENSIONS,
  DIMENSIONS,
  EVIDENCE_FACETS,
  EMPTY_LINKS,
  type DimensionId,
  type JobId,
  type SourceId,
  PROHIBITED_ATTRIBUTES,
} from "@agentswarm/shared";
import {
  createRng,
  createSimRepoFinder,
  createSimSources,
  createSimWorld,
  hashSeed,
  SIM_ORDINARY_EMPLOYERS,
  SIM_ORDINARY_SCHOOLS,
  SIM_PRESTIGIOUS_EMPLOYERS,
  SIM_PRESTIGIOUS_SCHOOLS,
  SIM_REGIONS,
  SIM_SECTORS,
  SIM_STAGES,
} from "./index";

const INVESTIGATION_JOBS = [
  "investigate.background",
  "investigate.code",
  "investigate.company",
  "investigate.media",
  "investigate.redflags",
] as const satisfies readonly JobId[];

const COMPANY_JOBS = ["company.product", "company.traction", "company.team"] as const satisfies readonly JobId[];

const EXPECTED_DIMENSIONS: Readonly<Record<(typeof INVESTIGATION_JOBS)[number], readonly string[]>> = {
  "investigate.background": ["slope", "grit", "magnetism"],
  "investigate.code": ["built_hard_things", "technical_depth", "velocity"],
  "investigate.company": ["insight", "ambition", "velocity"],
  "investigate.media": ["communication", "insight", "ambition"],
  "investigate.redflags": ["integrity"],
};

const WORLD = createSimWorld();
const SOURCE_IDS = ["hackernews", "github", "arxiv", "people_data"] as const satisfies readonly SourceId[];

function correlation(left: number[], right: number[]): number {
  const leftMean = left.reduce((total, value) => total + value, 0) / left.length;
  const rightMean = right.reduce((total, value) => total + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

describe("simulation primitives", () => {
  it("keeps hash and random streams deterministic and seed-sensitive", () => {
    const first = createRng(hashSeed("sim", 71));
    const repeat = createRng(hashSeed("sim", 71));
    const different = createRng(hashSeed("sim", 72));
    const firstValues = Array.from({ length: 8 }, () => first());
    expect(firstValues).toEqual(Array.from({ length: 8 }, () => repeat()));
    expect(firstValues).not.toEqual(Array.from({ length: 8 }, () => different()));
    expect(firstValues.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(hashSeed("same", 1)).toBe(hashSeed("same", 1));
    expect(hashSeed("same", 1)).not.toBe(hashSeed("same", "1"));
  });

  it("creates repeatable worlds with distinct seeds", () => {
    const sameSeed = createSimWorld();
    const otherSeed = createSimWorld({ seed: 8 });
    expect(sameSeed.founders()).toEqual(WORLD.founders());
    expect(sameSeed.itemsFor("hackernews", 15, 100)).toEqual(WORLD.itemsFor("hackernews", 15, 100));
    expect(sameSeed.evidenceFor("sim-founder-0001", "investigate.background", "deep")).toEqual(
      WORLD.evidenceFor("sim-founder-0001", "investigate.background", "deep"),
    );
    expect(otherSeed.founders()).not.toEqual(WORLD.founders());
    expect(otherSeed.itemsFor("github", 15, 100)).not.toEqual(WORLD.itemsFor("github", 15, 100));
  });
});

describe("synthetic founder population", () => {
  const founders = WORLD.founders();

  it("uses the default population and fixed synthetic categories", () => {
    expect(founders).toHaveLength(600);
    expect(new Set(founders.map((founder) => founder.name)).size).toBe(founders.length);
    expect(new Set(founders.map((founder) => founder.companyName)).size).toBe(founders.length);
    expect(SIM_SECTORS.length).toBeGreaterThan(3);
    expect(SIM_STAGES.length).toBeGreaterThan(1);
    expect(SIM_REGIONS.length).toBeGreaterThan(3);
    expect(SIM_PRESTIGIOUS_SCHOOLS.length).toBeGreaterThan(1);
    expect(SIM_ORDINARY_SCHOOLS.length).toBeGreaterThan(1);
    expect(SIM_PRESTIGIOUS_EMPLOYERS.length).toBeGreaterThan(1);
    expect(SIM_ORDINARY_EMPLOYERS.length).toBeGreaterThan(1);
    expect(founders.every((founder) => SIM_SECTORS.includes(founder.sector as (typeof SIM_SECTORS)[number]))).toBe(true);
    expect(founders.every((founder) => SIM_STAGES.includes(founder.stage as (typeof SIM_STAGES)[number]))).toBe(true);
    expect(founders.every((founder) => SIM_REGIONS.includes(founder.location as (typeof SIM_REGIONS)[number]))).toBe(true);
  });

  it("has varied, positively related traits and modest pedigree signal", () => {
    const quality = founders.map((founder) => founder.quality);
    for (const dimension of ["built_hard_things", "technical_depth", "insight", "velocity", "slope"] as const) {
      const relation = correlation(quality, founders.map((founder) => founder.latent[dimension]));
      expect(relation).toBeGreaterThan(0.18);
      expect(relation).toBeLessThan(0.85);
    }
    const pedigreeRelation = correlation(quality, founders.map((founder) => founder.pedigree));
    expect(pedigreeRelation).toBeGreaterThan(0.05);
    expect(pedigreeRelation).toBeLessThan(0.3);
    expect(new Set(founders.map((founder) => Math.round(founder.quality * 100))).size).toBeGreaterThan(35);
  });

  it("keeps favorable outcomes uncommon and quality-dependent, with integrity as a strong brake", () => {
    const outcomes = founders.filter((founder) => founder.outcome === 1);
    const rate = outcomes.length / founders.length;
    expect(rate).toBeGreaterThanOrEqual(0.06);
    expect(rate).toBeLessThanOrEqual(0.14);
    expect(average(outcomes.map((founder) => founder.quality))).toBeGreaterThan(
      average(founders.filter((founder) => founder.outcome === 0).map((founder) => founder.quality)),
    );
    const lowIntegrity = founders.filter((founder) => founder.latent.integrity < 0.2);
    const highIntegrity = founders.filter((founder) => founder.latent.integrity > 0.8);
    const lowRate = lowIntegrity.filter((founder) => founder.outcome === 1).length / lowIntegrity.length;
    const highRate = highIntegrity.filter((founder) => founder.outcome === 1).length / highIntegrity.length;
    expect(highRate).toBeGreaterThan(lowRate);
  });

  it("uses stable synthetic links and repeats identity details across source sightings", () => {
    const sightingText = new Map<string, string[]>();
    for (const source of SOURCE_IDS) {
      for (let day = 0; day < 60; day += 1) {
        for (const item of WORLD.itemsFor(source, day, 1_000)) {
          if (item.simFounderId === null) continue;
          const founder = WORLD.founder(item.simFounderId);
          expect(founder).toBeDefined();
          expect(item.text).toContain(founder!.name);
          expect(item.text).toContain(founder!.companyName);
          for (const link of Object.values(founder!.links).filter((value): value is string => value !== null)) {
            expect(item.text).toContain(link);
          }
          expect(item.ref.startsWith("https://sim.invalid/")).toBe(true);
          const seen = sightingText.get(item.simFounderId) ?? [];
          seen.push(item.text);
          sightingText.set(item.simFounderId, seen);
        }
      }
    }
    expect(founders.filter((founder) => founder.links.github === null).length / founders.length).toBeGreaterThan(0.1);
    expect(founders.filter((founder) => founder.links.github === null).length / founders.length).toBeLessThan(0.2);
    expect([...sightingText.values()].filter((sightings) => sightings.length > 1).length).toBeGreaterThan(150);
    expect(founders.every((founder) => Object.values(founder.links).every((link) => link === null || link.startsWith("https://sim.invalid/")))).toBe(true);
  });
});

describe("simulated source items", () => {
  it("mixes deterministic source-shaped founder and background items across days", () => {
    let total = 0;
    let noise = 0;
    const noiseKinds = new Set<string>();
    for (const source of SOURCE_IDS) {
      for (let day = 0; day < 60; day += 1) {
        const items = WORLD.itemsFor(source, day, 10_000);
        total += items.length;
        for (const item of items) {
          expect(item.source).toBe(source);
          expect(item.ref.startsWith("https://sim.invalid/")).toBe(true);
          if (item.simFounderId === null) {
            noise += 1;
            if (item.title.startsWith("Release:")) noiseKinds.add("release");
            else if (item.title.startsWith("Survey:")) noiseKinds.add("paper");
            else if (item.title.startsWith("Role update:")) noiseKinds.add("job change");
          } else {
            expect(item.author).toBe(WORLD.founder(item.simFounderId)?.name);
            expect(item.publishedAt).not.toBeNull();
          }
        }
      }
    }
    expect(noise / total).toBeGreaterThan(0.26);
    expect(noise / total).toBeLessThan(0.34);
    expect(noiseKinds).toEqual(new Set(["release", "paper", "job change"]));
    const allDayItems = WORLD.itemsFor("hackernews", 12, 10_000);
    expect(WORLD.itemsFor("hackernews", 12, 5)).toEqual(allDayItems.slice(0, 5));
    expect(WORLD.itemsFor("hackernews", 12, 0)).toEqual([]);
  });
});

describe("synthetic companies", () => {
  const founders = WORLD.founders();

  it("creates deterministic fictional companies linked to every founder", () => {
    const sameSeed = createSimWorld();
    const otherSeed = createSimWorld({ seed: 8 });
    for (const founder of founders) {
      const company = WORLD.company(founder.simId);
      expect(company).toBeDefined();
      expect(sameSeed.company(founder.simId)).toEqual(company);
      expect(otherSeed.company(founder.simId)).not.toEqual(company);
      expect(company).toMatchObject({
        simId: founder.simId,
        name: founder.companyName,
        oneLiner: founder.companyOneLiner,
        sector: founder.sector,
        stage: founder.stage,
      });
      expect(new URL(company!.url).hostname.endsWith(".example")).toBe(true);
      expect(company!.mission.trim()).toMatch(/\.$/);
      expect(company!.quality).toBeGreaterThanOrEqual(0);
      expect(company!.quality).toBeLessThanOrEqual(1);
      expect(Object.keys(company!.latent).sort()).toEqual(COMPANY_DIMENSIONS.map(({ id }) => id).sort());
      expect(Object.values(company!.latent).every((value) => value >= 0 && value <= 1)).toBe(true);
      expect(company!.team.length).toBeLessThanOrEqual(4);
      for (const member of company!.team) {
        expect(member.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+(?: [0-9]+)?$/);
        expect(member.role).toBeTruthy();
        expect(member.isFounder).toBe(/co-founder/i.test(member.role ?? ""));
        expect(member.background).toMatch(/\.$/);
        expect(new URL(member.sourceUrl!).hostname.endsWith(".example")).toBe(true);
        expect(Object.values(member.links)).toEqual([null, null, null, null, null]);
      }
    }
    expect(WORLD.company("missing-founder")).toBeUndefined();
  });

  it("keeps company generation isolated from all existing founder streams", () => {
    const exercised = createSimWorld();
    const fresh = createSimWorld();
    for (const founder of exercised.founders().slice(0, 180)) {
      for (let repeat = 0; repeat < 3; repeat += 1) {
        exercised.company(founder.simId);
        for (const job of COMPANY_JOBS) {
          exercised.companyEvidenceFor(founder.simId, job, ["quick", "standard", "deep"][repeat] as "quick" | "standard" | "deep");
        }
      }
    }
    expect(exercised.founders()).toEqual(fresh.founders());
    for (const founder of fresh.founders().slice(0, 120)) {
      expect(exercised.itemsFor("hackernews", founder.appearsOnDay, 1_000)).toEqual(
        fresh.itemsFor("hackernews", founder.appearsOnDay, 1_000),
      );
      expect(exercised.evidenceFor(founder.simId, "investigate.company", "deep")).toEqual(
        fresh.evidenceFor(founder.simId, "investigate.company", "deep"),
      );
    }
  });

  it("returns correctly faceted evidence that grows with depth", () => {
    const founder = founders[0]!;
    const company = WORLD.company(founder.simId)!;
    const sameSeed = createSimWorld();
    expect(sameSeed.companyEvidenceFor(founder.simId, "company.product", "deep")).toEqual(
      WORLD.companyEvidenceFor(founder.simId, "company.product", "deep"),
    );
    expect(createSimWorld({ seed: 8 }).companyEvidenceFor(founder.simId, "company.product", "deep"))
      .not.toEqual(WORLD.companyEvidenceFor(founder.simId, "company.product", "deep"));

    const product = WORLD.companyEvidenceFor(founder.simId, "company.product", "standard");
    const traction = WORLD.companyEvidenceFor(founder.simId, "company.traction", "standard");
    const team = WORLD.companyEvidenceFor(founder.simId, "company.team", "standard");
    const signalDimensions = {
      mission: ["mission"],
      product: ["product", "edge"],
      roadmap: ["plan"],
      market: ["market", "edge"],
      risk: ["claims"],
      traction: ["traction", "momentum"],
      funding: ["momentum"],
      team: ["team"],
    } as const;
    expect(product.map((item) => item.facet)).toEqual(expect.arrayContaining(["mission", "product", "roadmap", "market"]));
    expect(traction.map((item) => item.facet)).toContain("traction");
    expect(team.every((item) => item.facet === "team")).toBe(true);
    for (const job of COMPANY_JOBS) {
      const quick = WORLD.companyEvidenceFor(founder.simId, job, "quick");
      const deep = WORLD.companyEvidenceFor(founder.simId, job, "deep");
      expect(deep.length).toBeGreaterThan(quick.length);
      expect(quick.every((item) => EVIDENCE_FACETS.includes(item.facet))).toBe(true);
      expect(deep.every((item) => item.url && new URL(item.url).hostname.endsWith(".example"))).toBe(true);
      expect(deep.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt ?? ""))).toBe(true);
      expect(new Set(deep.map((item) => item.url)).size).toBe(deep.length);
      expect(deep.every((item) => item.sim?.signals.length && item.sim.signals.every((signal) =>
        (signalDimensions[item.facet] as readonly string[]).includes(signal.dimension),
      ))).toBe(true);
      expect(deep.every((item) => item.sim?.signals.every((signal) => signal.value >= 0 && signal.value <= 1))).toBe(true);
      if (job === "company.product") {
        const riskItems = WORLD.companyEvidenceFor(founder.simId, job, "standard").filter((item) => item.facet === "risk");
        expect(riskItems).toHaveLength(company.latent.claims < 0.2 ? 1 : 0);
        expect(riskItems.every((item) => item.sim?.truth === "contradicted" && /second company source/i.test(item.claim))).toBe(true);
      }
    }
    const missionItem = product.find((item) => item.facet === "mission")!;
    expect(missionItem.excerpt).toBe(company.mission);
    expect(missionItem.sim?.signals).toEqual([expect.objectContaining({ dimension: "mission" })]);
    const productItem = product.find((item) => item.facet === "product")!;
    expect(productItem.sim?.signals.map((signal) => signal.dimension)).toEqual(["product", "edge"]);
    expect(traction.find((item) => item.facet === "traction")?.sim?.signals.map((signal) => signal.dimension))
      .toEqual(["traction", "momentum"]);
    expect(traction.filter((item) => item.facet === "funding").every((item) => item.sim?.signals[0]?.dimension === "momentum")).toBe(true);
    expect(WORLD.companyEvidenceFor("missing-founder", "company.product", "quick")).toEqual([]);
    expect(WORLD.companyEvidenceFor(founder.simId, "investigate.company", "quick")).toEqual([]);
  });

  it("keeps company quality related to founders and company evidence signals tied to latent levels", () => {
    const companies = founders.map((founder) => WORLD.company(founder.simId)!);
    const qualityRelation = correlation(founders.map((founder) => founder.quality), companies.map((company) => company.quality));
    const tractionLatent: number[] = [];
    const tractionMeans: number[] = [];
    for (const company of companies) {
      const signals = ["quick", "standard", "deep"].flatMap((depth) =>
        WORLD.companyEvidenceFor(company.simId, "company.traction", depth as "quick" | "standard" | "deep")
          .flatMap((item) => item.sim?.signals.filter((signal) => signal.dimension === "traction").map((signal) => signal.value) ?? []),
      );
      tractionLatent.push(company.latent.traction);
      tractionMeans.push(average(signals));
    }
    const tractionRelation = correlation(tractionLatent, tractionMeans);
    expect(qualityRelation).toBeGreaterThan(0.3);
    expect(qualityRelation).toBeLessThan(0.9);
    expect(tractionRelation).toBeGreaterThan(0.6);
  });

  it("keeps generated company text clear of prohibited attributes and simulator fields", () => {
    const text: string[] = [];
    for (const founder of founders) {
      const company = WORLD.company(founder.simId)!;
      text.push(company.name, company.url, company.oneLiner, company.mission, company.sector, company.stage);
      for (const member of company.team) {
        text.push(member.name, member.role ?? "", member.background ?? "", member.sourceUrl ?? "");
      }
      for (const job of COMPANY_JOBS) {
        for (const item of WORLD.companyEvidenceFor(founder.simId, job, "standard")) {
          text.push(item.title, item.excerpt, item.claim, item.url ?? "");
        }
      }
    }
    const content = text.join("\n");
    expect(content).not.toMatch(/\b(?:age|aged|born|date of birth|year of birth|citizenship|national origin|religion|gender|pregnancy|disability|home address|personal phone|personal email)\b/i);
    expect(content).not.toMatch(/\b(?:simId|simFounderId|latent|signals|truth)\b/i);
    expect(PROHIBITED_ATTRIBUTES).toContain("age or date of birth");
  });
});

describe("simulated investigations", () => {
  it("returns only the specified dimensions at each requested evidence depth", () => {
    for (const founder of WORLD.founders().slice(0, 80)) {
      for (const job of INVESTIGATION_JOBS) {
        const evidence = WORLD.evidenceFor(founder.simId, job, "quick");
        const unavailable = (job === "investigate.code" && founder.links.github === null) || (job === "investigate.media" && evidence.length === 0);
        if (unavailable) {
          expect(evidence).toEqual([]);
          for (const depth of ["standard", "deep"] as const) expect(WORLD.evidenceFor(founder.simId, job, depth)).toEqual([]);
          continue;
        }
        expect(evidence.length).toBeGreaterThanOrEqual(1);
        expect(evidence.length).toBeLessThanOrEqual(2);
        expect(evidence.every((item) => item.sim?.signals.every((signal) => EXPECTED_DIMENSIONS[job].includes(signal.dimension)))).toBe(true);
        expect(evidence.every((item) => item.url?.startsWith("https://sim.invalid/") && item.sim !== undefined)).toBe(true);
        for (const depth of ["standard", "deep"] as const) {
          const deeper = WORLD.evidenceFor(founder.simId, job, depth);
          expect(deeper.length).toBeGreaterThanOrEqual(depth === "standard" ? 2 : 4);
          expect(deeper.length).toBeLessThanOrEqual(depth === "standard" ? 4 : 6);
        }
      }
    }
    expect(WORLD.evidenceFor("missing-founder", "investigate.code", "quick")).toEqual([]);
    expect(WORLD.evidenceFor("sim-founder-0001", "scout.github", "quick")).toEqual([]);
  });

  it("omits code evidence without a public repository and media evidence when no talk is available", () => {
    const noGithub = WORLD.founders().find((founder) => founder.links.github === null);
    expect(noGithub).toBeDefined();
    expect(WORLD.evidenceFor(noGithub!.simId, "investigate.code", "deep")).toEqual([]);
    let noMedia = 0;
    for (const founder of WORLD.founders()) {
      const media = WORLD.evidenceFor(founder.simId, "investigate.media", "quick");
      if (media.length === 0) noMedia += 1;
      else expect(media.length).toBeGreaterThanOrEqual(1);
    }
    expect(noMedia / WORLD.founders().length).toBeGreaterThan(0.35);
    expect(noMedia / WORLD.founders().length).toBeLessThan(0.45);
  });

  it("keeps supported signals near truth and unsupported claims inflated", () => {
    const errors: Record<"supported" | "unsupported" | "wrong_person", number[]> = { supported: [], unsupported: [], wrong_person: [] };
    const unsupportedDeltas: number[] = [];
    const supportedDeltas: number[] = [];
    for (const founder of WORLD.founders()) {
      for (const job of INVESTIGATION_JOBS) {
        for (const item of WORLD.evidenceFor(founder.simId, job, "standard")) {
          const sim = item.sim;
          if (!sim || sim.signals.length === 0) continue;
          if (sim.truth === "contradicted") throw new Error("The simulator only emits supported, unsupported, or wrong-person evidence.");
          const signal = sim.signals[0]!;
          const dimension = signal.dimension as DimensionId;
          expect(DIMENSIONS.some((item) => item.id === dimension)).toBe(true);
          const truth = founder.latent[dimension];
          errors[sim.truth]!.push(Math.abs(signal.value - truth));
          const excerptBand = Math.floor(truth * 5) + 1;
          const claimedLevel = Number(item.claim.match(/level (\d)/)?.[1] ?? 0);
          if (sim.truth === "supported") supportedDeltas.push(signal.value - truth);
          if (sim.truth === "unsupported") {
            unsupportedDeltas.push(signal.value - truth);
            expect(claimedLevel).toBeGreaterThan(excerptBand);
          } else {
            expect(claimedLevel).toBe(excerptBand);
          }
        }
      }
    }
    expect(errors.supported.length).toBeGreaterThan(1_000);
    expect(average(errors.supported)).toBeLessThan(0.14);
    expect(Math.abs(average(supportedDeltas))).toBeLessThan(0.03);
    expect(average(unsupportedDeltas)).toBeGreaterThan(0.14);
    expect(average(unsupportedDeltas)).toBeLessThan(0.34);
    expect(average(errors.wrong_person)).toBeGreaterThan(0.2);
    const truthCount = errors.supported.length + errors.unsupported.length + errors.wrong_person.length;
    expect(errors.supported.length / truthCount).toBeGreaterThan(0.84);
    expect(errors.supported.length / truthCount).toBeLessThan(0.92);
    expect(errors.unsupported.length / truthCount).toBeGreaterThan(0.04);
    expect(errors.unsupported.length / truthCount).toBeLessThan(0.1);
    expect(errors.wrong_person.length / truthCount).toBeGreaterThan(0.025);
    expect(errors.wrong_person.length / truthCount).toBeLessThan(0.075);
  });

  it("includes conflicting identity context for wrong-person excerpts without turning pedigree into an achievement", () => {
    const founders = WORLD.founders();
    const wrongPerson: Array<{ simId: string; name: string; company: string; excerpt: string }> = [];
    const background: string[] = [];
    for (const founder of WORLD.founders()) {
      for (const item of WORLD.evidenceFor(founder.simId, "investigate.background", "deep")) {
        if (item.sim?.truth === "wrong_person") wrongPerson.push({ simId: founder.simId, name: founder.name, company: founder.companyName, excerpt: item.excerpt });
        background.push(item.excerpt);
      }
    }
    expect(wrongPerson.length).toBeGreaterThan(20);
    for (const item of wrongPerson) {
      const namesake = founders.find((founder) => founder.simId !== item.simId)!;
      expect(item.excerpt).toContain(item.name);
      expect(item.excerpt).toContain("at a different company");
      expect(item.excerpt).toContain("rather than");
      expect(item.excerpt).toContain(item.company);
      const conflictingCompany = /at a different company, (.+?), in /.exec(item.excerpt)?.[1];
      expect(conflictingCompany).toBeDefined();
      expect(conflictingCompany).not.toBe(item.company);
      expect(conflictingCompany).toBe(namesake.companyName);
      const conflictingLocation = /at a different company, .+?, in (.+?), rather than/.exec(item.excerpt)?.[1];
      expect(conflictingLocation).toBeDefined();
      expect(conflictingLocation).not.toBe(founders.find((founder) => founder.simId === item.simId)?.location);
    }
    expect(background.some((excerpt) => SIM_PRESTIGIOUS_SCHOOLS.some((school) => excerpt.includes(school)))).toBe(true);
    expect(background.some((excerpt) => SIM_ORDINARY_SCHOOLS.some((school) => excerpt.includes(school)))).toBe(true);
    expect(background.some((excerpt) => SIM_PRESTIGIOUS_EMPLOYERS.some((employer) => excerpt.includes(employer)))).toBe(true);
    expect(background.some((excerpt) => SIM_ORDINARY_EMPLOYERS.some((employer) => excerpt.includes(employer)))).toBe(true);
    expect(background.every((excerpt) => !/school|employer.{0,30}(?:built|founded|created|achieved)/i.test(excerpt))).toBe(true);
  });

  it("uses a deterministic, distinct namesake identity when only one founder exists", () => {
    let chosen: ReturnType<typeof createSimWorld> | undefined;
    let excerpt: string | undefined;
    let founderId = "";
    for (let seed = 0; seed < 80 && !excerpt; seed += 1) {
      const candidate = createSimWorld({ seed, founders: 1, days: 1 });
      const founder = candidate.founders()[0]!;
      const wrongPerson = candidate.evidenceFor(founder.simId, "investigate.redflags", "deep").find((item) => item.sim?.truth === "wrong_person");
      if (wrongPerson) {
        chosen = candidate;
        excerpt = wrongPerson.excerpt;
        founderId = founder.simId;
      }
    }
    expect(chosen).toBeDefined();
    expect(excerpt).toBeDefined();
    const founder = chosen!.founder(founderId)!;
    expect(excerpt).toContain(founder.name);
    const conflictingCompany = /at a different company, (.+?), in /.exec(excerpt!)?.[1];
    const conflictingLocation = /at a different company, .+?, in (.+?), rather than/.exec(excerpt!)?.[1];
    expect(conflictingCompany).toBeDefined();
    expect(conflictingCompany).not.toBe(founder.companyName);
    expect(conflictingLocation).toBeDefined();
    expect(conflictingLocation).not.toBe(founder.location);
  });

  it("keeps synthetic content clear of prohibited personal attributes", () => {
    const text: string[] = [];
    for (const founder of WORLD.founders().slice(0, 120)) {
      text.push(founder.name, founder.headline, founder.location, founder.companyName, founder.companyOneLiner);
      for (const job of INVESTIGATION_JOBS) {
        for (const item of WORLD.evidenceFor(founder.simId, job, "standard")) text.push(item.title, item.claim, item.excerpt);
      }
      text.push(WORLD.transcript(founder.simId, "call_founder", founder.name));
    }
    const content = text.join("\n");
    expect(content).not.toMatch(/\b(?:age|aged|born|date of birth|year of birth|citizenship|national origin|religion|gender|pregnancy|disability|home address|personal phone|personal email)\b/i);
    expect(PROHIBITED_ATTRIBUTES).toContain("age or date of birth");
  });
});

describe("simulated transcripts and repository seam", () => {
  it("opens every call with a clear AI disclosure and note-taking consent request", () => {
    const founder = WORLD.founders()[0]!;
    const transcript = WORLD.transcript(founder.simId, "call_founder", founder.name);
    const lines = transcript.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(8);
    expect(lines.length).toBeLessThanOrEqual(14);
    expect(lines[0]).toMatch(/^Caller:.*AI assistant.*on behalf of.*consent.*take notes/i);
    expect(lines.slice(1).every((line) => /^(Caller|Founder):/.test(line))).toBe(true);
    expect(transcript).toMatch(/building|built/i);
    expect(transcript).toMatch(/persist|setback/i);
    expect(transcript).toMatch(/honest|limit|measur/i);
    expect(transcript).toMatch(/insight|overlooked|current view/i);
    expect(transcript).toMatch(/clear|explain/i);
    const reference = WORLD.transcript(founder.simId, "call_reference", "A colleague");
    expect(reference.split("\n").slice(1).some((line) => line.startsWith("Colleague:"))).toBe(true);
  });

  it("returns stable, GitHub-backed repositories with no local checkout", async () => {
    const finder = createSimRepoFinder(WORLD);
    expect(await finder.topRepos(EMPTY_LINKS, null, 3)).toEqual([]);
    const withGithub = WORLD.founders().find((founder) => founder.links.github !== null)!;
    const repos = await finder.topRepos(withGithub.links, withGithub.simId, 3);
    expect(repos.length).toBeLessThanOrEqual(3);
    expect(repos.every((repo) => repo.url.startsWith("https://sim.invalid/") && repo.localPath === null)).toBe(true);
    if (repos[0]) {
      const checkout = await finder.checkout(repos[0]);
      expect(checkout.repo).toEqual(repos[0]);
      expect(checkout.repo.localPath).toBeNull();
      await checkout.cleanup();
    }
  });
});

describe("simulated source registry", () => {
  it("exposes configured adapters and honors day, cursor, and item limits", async () => {
    const sources = createSimSources(WORLD);
    expect(await sources.statuses()).toHaveLength(4);
    for (const id of SOURCE_IDS) {
      const adapter = sources.get(id);
      expect(adapter).not.toBeNull();
      expect(await adapter!.status()).toEqual({ configured: true, detail: "Simulated" });
    }
    expect(sources.get("web")).toBeNull();
    const adapter = sources.get("hackernews")!;
    const thesis = { summary: "synthetic", sectors: [], stages: [], geos: [], avoid: [] };
    const dayZero = await adapter.fetch({ limit: 3, since: null, cursor: null, beat: null, thesis, simDay: null });
    expect(dayZero.cursor).toBe(0);
    expect(dayZero.items).toEqual(WORLD.itemsFor("hackernews", 0, 3));
    const chosenDay = 15;
    const dayResult = await adapter.fetch({ limit: 2, since: null, cursor: 0, beat: null, thesis, simDay: chosenDay });
    expect(dayResult.cursor).toBe(chosenDay);
    expect(dayResult.items).toHaveLength(2);
    expect(dayResult.items).toEqual(WORLD.itemsFor("hackernews", chosenDay, 2));
  });
});

describe("simulation content dimensions", () => {
  it("keeps investigation dimension coverage aligned with the agreed job contracts", () => {
    for (const job of INVESTIGATION_JOBS) {
      const expected = EXPECTED_DIMENSIONS[job];
      expect(expected.every((id) => DIMENSIONS.some((dimension) => dimension.id === id))).toBe(true);
      for (const founder of WORLD.founders().slice(0, 100)) {
        for (const item of WORLD.evidenceFor(founder.simId, job, "deep")) {
          expect(item.sim?.signals.every((signal) => expected.includes(signal.dimension))).toBe(true);
        }
      }
    }
  });
});
