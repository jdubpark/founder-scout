import { afterEach, describe, expect, it } from "vitest";
import {
  BASE_CONFIG,
  COMPANY_DIMENSIONS,
  EMPTY_COMPANY_LINKS,
  getJob,
  type Agent,
  type Assessment,
  type Company,
  type CompanyAssessInput,
  type CompanyAssessOutput,
  type CompanyAssessment,
  type CompanyResearchOutput,
  type CompanyEvidenceDraft,
  type CompanyFeedback,
  type CompanyJudgment,
  type Evidence,
  type Founder,
  type JobInput,
  type ModelJobId,
  type JobOutput,
  type Run,
  type Swarm,
  type SwarmConfig,
} from "@agentswarm/shared";
import { ProviderError } from "../contracts";
import type { EngineDeps, ExecuteJob, JobContext, JobExecution, PersonRecord, ProviderRegistry, SimFounder, SimWorld } from "../contracts";
import { createExecuteJob, createJobRegistry } from "../jobs";
import { openStore } from "../db";
import { createSimRepoFinder, createSimSources, createSimWorld } from "../sim";
import { createRunController } from "./index";
import { hashEvidence as founderEvidenceHash } from "./pipeline";

const SWARM_ID = "swm_company_stages";
const CONFIG_ID = "cfg_company_stages";
const THESIS = {
  summary: "Back technical founders building useful software companies.",
  sectors: ["Developer tools", "Applied AI"],
  stages: ["pre-seed", "seed"],
  geos: ["Austin", "Portland"],
  avoid: [],
};
const baseTime = new Date("2026-11-12T18:00:00.000Z");
const scratchStores: Array<ReturnType<typeof openStore>> = [];

afterEach(() => {
  for (const store of scratchStores.splice(0)) store.close();
});

function makeSwarm(): Swarm {
  return {
    id: SWARM_ID,
    name: "Company stages test",
    status: "active",
    thesis: THESIS,
    configId: CONFIG_ID,
    createdAt: baseTime.toISOString(),
    updatedAt: baseTime.toISOString(),
  };
}

function makeAgent(jobId: Agent["jobId"]): Agent {
  const definition = getJob(jobId);
  return {
    id: `agt_${jobId.replaceAll(".", "_")}`,
    swarmId: SWARM_ID,
    jobId,
    classId: definition.classId,
    name: definition.label,
    status: "active",
    beat: null,
    state: {},
    createdAt: baseTime.toISOString(),
  };
}

function makeFounder(sim: SimFounder, id: string, options: Partial<Founder> = {}): Founder {
  return {
    id,
    swarmId: SWARM_ID,
    name: sim.name,
    headline: sim.headline,
    location: sim.location,
    company: { name: sim.companyName, url: sim.links.site, oneLiner: sim.companyOneLiner, stage: sim.stage },
    links: { ...sim.links },
    status: "queued",
    fit: 0.9,
    fitReasons: ["Matches the thesis."],
    tags: [sim.sector],
    identityConfidence: 1,
    sources: ["github"],
    firstSeenAt: baseTime.toISOString(),
    updatedAt: baseTime.toISOString(),
    lastAssessedAt: null,
    nextRecheckAt: null,
    simId: sim.simId,
    ...options,
  };
}

function makeCompany(id: string, name: string, overrides: Partial<Company> = {}): Company {
  return {
    id,
    swarmId: SWARM_ID,
    name,
    domain: null,
    url: null,
    oneLiner: null,
    mission: null,
    tagline: null,
    sector: null,
    stage: null,
    links: { ...EMPTY_COMPANY_LINKS },
    status: "tracked",
    firstSeenAt: baseTime.toISOString(),
    updatedAt: baseTime.toISOString(),
    lastResearchedAt: null,
    lastAssessedAt: null,
    nextRecheckAt: null,
    simId: null,
    ...overrides,
  };
}

function emptyCompanyJudgments(): CompanyJudgment[] {
  return ["mission", "market", "product", "edge", "traction", "momentum", "team", "plan", "claims"].map((dimension) => ({
    dimension,
    level: null,
    confidence: 0,
    rationale: "Not settled yet.",
    evidenceIds: [],
    counterEvidenceIds: [],
  })) as CompanyJudgment[];
}

function makeCompanyAssessment(companyId: string, id: string, createdAt: string, overrides: Partial<CompanyAssessment> = {}): CompanyAssessment {
  return {
    id,
    companyId,
    runId: "run_previous",
    configId: CONFIG_ID,
    company: 0.35,
    companyCoverage: 0,
    companyPotential: null,
    leadFounderId: null,
    team: null,
    deal: 0.35,
    coverage: 0,
    potential: null,
    decision: "needs_evidence",
    reasons: [],
    flags: [],
    breakdown: [],
    judgments: emptyCompanyJudgments(),
    brief: { summary: "The company needs a closer look.", moat: null, strengths: [], risks: [], openQuestions: ["What has shipped?"] },
    createdAt,
    ...overrides,
  };
}

function makeFounderAssessment(founderId: string, createdAt: string, composite = 0.7, flags: Assessment["flags"] = []): Assessment {
  return {
    id: `asm_${founderId}_${createdAt.slice(0, 10)}`,
    founderId,
    runId: "run_previous",
    configId: CONFIG_ID,
    composite,
    cracked: composite,
    founderScore: composite,
    coverage: 0.6,
    potential: composite,
    fit: 0.9,
    decision: "surface",
    reasons: [],
    flags,
    breakdown: [],
    judgments: [],
    summary: "Prior founder assessment.",
    memo: null,
    createdAt,
  };
}

function harness(options: {
  jobs?: Agent["jobId"][];
  founders?: Founder[];
  configParams?: SwarmConfig["params"];
  now?: () => Date;
  people?: EngineDeps["people"];
  quotes?: EngineDeps["quotes"];
  world?: SimWorld;
  wrapExecuteJob?: (delegate: ExecuteJob) => ExecuteJob;
} = {}) {
  const store = openStore(":memory:");
  scratchStores.push(store);
  const world = options.world ?? createSimWorld({ seed: 481, founders: 5, days: 3 });
  const jobs = createJobRegistry();
  const config: SwarmConfig = {
    ...BASE_CONFIG,
    id: CONFIG_ID,
    label: "Company stages test configuration",
    params: { ...BASE_CONFIG.params, ...options.configParams },
  };
  store.saveConfig(config);
  store.insertSwarm(makeSwarm());
  for (const jobId of options.jobs ?? []) store.insertAgent(makeAgent(jobId));
  for (const founder of options.founders ?? []) store.insertFounder(founder);

  const providers: ProviderRegistry = {
    get: () => { throw new ProviderError("not_configured", "No provider configured in this simulation."); },
    statuses: async () => [],
  };
  const realExecute = createExecuteJob({ jobs, providers });
  const executeJob = options.wrapExecuteJob ? options.wrapExecuteJob(realExecute) : realExecute;
  const noLiveSources = { get: () => null, statuses: async () => [] };
  const controller = createRunController({
    store,
    jobs,
    executeJob,
    sources: { sim: createSimSources(world), live: noLiveSources },
    repos: { sim: createSimRepoFinder(world), live: createSimRepoFinder(world) },
    simWorld: world,
    fundName: "Northstar Ventures",
    now: options.now ?? (() => new Date(baseTime)),
    sleep: async () => undefined,
    people: options.people,
    quotes: options.quotes,
  });
  return { store, world, controller, config };
}

async function run(
  h: ReturnType<typeof harness>,
  sources: Run["sources"] = "sim",
): Promise<Run> {
  const started = await h.controller.start({ swarmId: SWARM_ID, trigger: "manual", brain: "sim", sources });
  return h.controller.wait(started.id);
}

function sourceEvidence(founderId: string, companyId: string, evidenceId: string): Evidence {
  return {
    id: evidenceId,
    founderId,
    companyId,
    facet: "product",
    kind: "article",
    source: "web",
    url: "https://example.test/product",
    title: "Product page",
    excerpt: "A working product is available to customers.",
    claim: "The company has shipped a working product.",
    publishedAt: null,
    capturedAt: baseTime.toISOString(),
    collectedByTaskId: null,
    hash: `hash_${evidenceId}`,
    verification: "supported",
    verificationNote: null,
    sim: null,
  };
}

function strongCompanyOutput(input: CompanyAssessInput): CompanyAssessOutput {
  const evidenceId = input.evidence[0]?.id;
  if (!evidenceId) throw new Error("The test assessment needs verified company evidence.");
  return {
    judgments: COMPANY_DIMENSIONS.map((dimension) => ({
      dimension: dimension.id,
      level: 4,
      confidence: 1,
      rationale: "The verified source supports a strong answer.",
      evidenceIds: [evidenceId],
      counterEvidenceIds: [],
    })),
    summary: "A strong company with a shipped product.",
    moat: { text: "The system is hard to copy.", evidenceIds: [evidenceId] },
    strengths: [{ text: "A usable product is available.", evidenceIds: [evidenceId] }],
    risks: [],
    openQuestions: [],
  };
}

function withStrongCompanyAssessment(delegate: ExecuteJob): ExecuteJob {
  return async <J extends ModelJobId>(jobId: J, input: JobInput<J>, context: JobContext, options: Parameters<ExecuteJob>[3]): Promise<JobExecution<J>> => {
    const execution = await delegate(jobId, input, context, options);
    if (jobId !== "assess.company") return execution;
    return { ...execution, output: strongCompanyOutput(input as CompanyAssessInput) as JobOutput<J> };
  };
}

function withMoatEvidence(delegate: ExecuteJob, cite: "verified" | "missing"): ExecuteJob {
  return async <J extends ModelJobId>(jobId: J, input: JobInput<J>, context: JobContext, options: Parameters<ExecuteJob>[3]): Promise<JobExecution<J>> => {
    const execution = await delegate(jobId, input, context, options);
    if (jobId !== "assess.company") return execution;
    const assessmentInput = input as CompanyAssessInput;
    const evidenceId = cite === "verified" ? assessmentInput.evidence[0]?.id ?? "missing" : "missing-evidence";
    const output = strongCompanyOutput(assessmentInput);
    return { ...execution, output: { ...output, moat: { text: "A hard-to-copy system.", evidenceIds: [evidenceId] } } as JobOutput<J> };
  };
}

describe("company pipeline stages", () => {
  it("keeps a moat only when it cites verified company evidence", async () => {
    const make = (cite: "verified" | "missing") => {
      const world = createSimWorld({ seed: 719, founders: 1, days: 1 });
      const h = harness({
        jobs: ["screen.fit", "investigate.background", "verify.claims", "assess.judgments", "company.product", "company.traction", "company.team", "assess.company"],
        founders: [makeFounder(world.founders()[0]!, `fnd_moat_${cite}`)],
        world,
        configParams: { "screen.min_fit": 0 },
        wrapExecuteJob: (delegate) => withMoatEvidence(delegate, cite),
      });
      return h;
    };
    const verified = make("verified");
    const missing = make("missing");
    await run(verified);
    await run(missing);
    const verifiedAssessment = verified.store.listCompanies({ swarmId: SWARM_ID }).map((company) => verified.store.latestCompanyAssessment(company.id)).find(Boolean);
    const missingAssessment = missing.store.listCompanies({ swarmId: SWARM_ID }).map((company) => missing.store.latestCompanyAssessment(company.id)).find(Boolean);
    expect(verifiedAssessment?.brief.moat).toEqual({ text: "A hard-to-copy system.", evidenceIds: expect.any(Array) });
    expect(verifiedAssessment?.brief.moat?.evidenceIds.length).toBeGreaterThan(0);
    expect(missingAssessment?.brief.moat).toBeNull();
  });

  it.each([
    { name: "keeps a tagline whose words are on the company's own site", own: true, found: true, kept: true },
    { name: "drops a tagline whose words are not on the page it cites", own: true, found: false, kept: false },
    { name: "drops a tagline read on someone else's site, even when the words are there", own: false, found: true, kept: false },
  ])("$name", async ({ own, found, kept }) => {
    const world = createSimWorld({ seed: 741, founders: 1, days: 1 });
    const founder = makeFounder(world.founders()[0]!, "fnd_tagline", { status: "surfaced", simId: null });
    const site = new URL(founder.company.url!);
    const cited = own ? `https://www.${site.hostname.replace(/^www\./, "")}/` : "https://example.test/about-them";
    const wrap: (delegate: ExecuteJob) => ExecuteJob = (delegate) => async <J extends ModelJobId>(jobId: J, input: JobInput<J>, context: JobContext, options: Parameters<ExecuteJob>[3]): Promise<JobExecution<J>> => {
      const execution = await delegate(jobId, input, context, options);
      if (jobId !== "company.product" || !execution.output) return execution;
      const output = execution.output as JobOutput<"company.product">;
      return { ...execution, output: { ...output, profile: { ...output.profile, taglineText: "The line the site leads with.", taglineUrl: cited } } as JobOutput<J> };
    };
    const h = harness({
      jobs: ["company.product"],
      founders: [founder],
      world,
      wrapExecuteJob: wrap,
      quotes: { check: async () => (found ? { status: "found", detail: "on page" } : { status: "not_found", detail: "not on page" }) },
    });
    await run(h, "live");
    const company = h.store.listCompanies({ swarmId: SWARM_ID })[0];
    expect(company?.tagline ?? null).toEqual(kept ? { text: "The line the site leads with.", url: cited } : null);
  });

  it("creates founder company records, researches and assesses them with company evidence", async () => {
    const world = createSimWorld({ seed: 911, founders: 3, days: 3 });
    const h = harness({
      jobs: ["screen.fit", "investigate.background", "verify.claims", "assess.judgments", "company.product", "company.traction", "company.team", "assess.company"],
      world,
      founders: world.founders().slice(0, 3).map((sim, index) => makeFounder(sim, `fnd_full_${index}`)),
      configParams: { "screen.min_fit": 0 },
    });

    const result = await run(h);
    expect(result.status).toBe("succeeded");
    const linked = h.store.listFounders({ swarmId: SWARM_ID }).filter((founder) => founder.fit !== null && founder.fit >= 0 && founder.status !== "screened_out");
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.every((founder) => Boolean(founder.companyId))).toBe(true);
    const companies = h.store.listCompanies({ swarmId: SWARM_ID });
    expect(companies.length).toBeGreaterThan(0);
    const companyEvidence = companies.flatMap((company) => h.store.listCompanyEvidence(company.id));
    expect(companyEvidence.length).toBeGreaterThan(0);
    expect(companyEvidence.every((item) => item.companyId && item.facet && item.founderId)).toBe(true);
    expect(companies.some((company) => h.store.listCompanyMembers(company.id).length > 0)).toBe(true);
    const assessments = companies.map((company) => h.store.latestCompanyAssessment(company.id)).filter(Boolean);
    expect(assessments.length).toBeGreaterThan(0);
    for (const assessment of assessments) {
      expect(assessment!.decision).toBeTruthy();
      expect(assessment!.brief).toBeTruthy();
      const verifiedIds = new Set(h.store.listCompanyEvidence(assessment!.companyId, { verifications: ["supported"] }).map((item) => item.id));
      for (const point of [...assessment!.brief.strengths, ...assessment!.brief.risks]) {
        expect(point.evidenceIds.length).toBeGreaterThan(0);
        expect(point.evidenceIds.every((id) => verifiedIds.has(id))).toBe(true);
      }
    }
    expect(result.stats.companiesResearched).toBeGreaterThan(0);
    expect(result.stats.companiesAssessed).toBeGreaterThan(0);
  });

  it("merges exact company identities and ignores shared hosting as a domain", async () => {
    const world = createSimWorld({ seed: 13, founders: 5, days: 1 });
    const source = world.founders();
    const fixtures = [
      makeFounder(source[0]!, "fnd_same_site_a", { name: "A", company: { name: "Acme", url: "https://www.acme.example", oneLiner: null, stage: null } }),
      makeFounder(source[1]!, "fnd_same_site_b", { name: "B", company: { name: "Acme Inc.", url: "https://acme.example/about", oneLiner: null, stage: null } }),
      makeFounder(source[2]!, "fnd_same_name_a", { name: "C", company: { name: "North Star LLC", url: null, oneLiner: null, stage: null } }),
      makeFounder(source[3]!, "fnd_same_name_b", { name: "D", company: { name: "North Star", url: null, oneLiner: null, stage: null } }),
      makeFounder(source[4]!, "fnd_similar_a", { name: "E", company: { name: "River Labs", url: null, oneLiner: null, stage: null } }),
      makeFounder(source[4]!, "fnd_similar_b", { name: "F", company: { name: "River AI", url: null, oneLiner: null, stage: null } }),
      makeFounder(source[0]!, "fnd_shared_host", { name: "G", company: { name: "CodeCo", url: "https://github.com/codeco/project", oneLiner: null, stage: null } }),
      // Two different companies on one site-builder host, and two different companies with one name.
      makeFounder(source[1]!, "fnd_builder_a", { name: "H", company: { name: "Alpha Tools", url: "https://builder.example/alpha", oneLiner: null, stage: null } }),
      makeFounder(source[2]!, "fnd_builder_b", { name: "I", company: { name: "Beta Tools", url: "https://builder.example/beta", oneLiner: null, stage: null } }),
      makeFounder(source[3]!, "fnd_atlas_a", { name: "J", company: { name: "Atlas", url: "https://atlas-one.example", oneLiner: null, stage: null } }),
      makeFounder(source[4]!, "fnd_atlas_b", { name: "K", company: { name: "Atlas", url: "https://atlas-two.example", oneLiner: null, stage: null } }),
    ];
    const h = harness({ world, founders: fixtures.map((founder) => ({ ...founder, status: "surfaced", simId: null })) });
    await run(h);
    const records = h.store.listCompanies({ swarmId: SWARM_ID });
    const id = (founderId: string) => h.store.getFounder(founderId)?.companyId;
    expect(id("fnd_same_site_a")).toBe(id("fnd_same_site_b"));
    expect(id("fnd_same_name_a")).toBe(id("fnd_same_name_b"));
    expect(id("fnd_similar_a")).not.toBe(id("fnd_similar_b"));
    expect(records.find((company) => company.id === id("fnd_shared_host"))?.domain).toBeNull();
    expect(records.find((company) => company.id === id("fnd_same_site_a"))?.domain).toBe("acme.example");
    // A shared host must never merge companies with different names: that would file one
    // company's evidence under another.
    expect(id("fnd_builder_a")).not.toBe(id("fnd_builder_b"));
    expect(id("fnd_atlas_a")).not.toBe(id("fnd_atlas_b"));
  });

  it("merges different names only when both links are the same site's front page", async () => {
    const world = createSimWorld({ seed: 18, founders: 6, days: 1 });
    const source = world.founders();
    const fixtures = [
      makeFounder(source[0]!, "fnd_front_acme", { name: "A", company: { name: "Acme", url: "https://acme.example", oneLiner: null, stage: null } }),
      makeFounder(source[1]!, "fnd_front_acme_labs", { name: "B", company: { name: "Acme Labs", url: "https://acme.example/", oneLiner: null, stage: null } }),
      makeFounder(source[2]!, "fnd_path_alpha", { name: "C", company: { name: "Alpha Tools", url: "https://builder.example/alpha", oneLiner: null, stage: null } }),
      makeFounder(source[3]!, "fnd_path_beta", { name: "D", company: { name: "Beta Tools", url: "https://builder.example/beta", oneLiner: null, stage: null } }),
      makeFounder(source[4]!, "fnd_other_atlas_a", { name: "E", company: { name: "Atlas", url: "https://atlas-one.example", oneLiner: null, stage: null } }),
      makeFounder(source[5]!, "fnd_other_atlas_b", { name: "F", company: { name: "Atlas", url: "https://atlas-two.example", oneLiner: null, stage: null } }),
    ].map((founder) => ({ ...founder, status: "surfaced" as const, simId: null }));
    const h = harness({ world, founders: fixtures });
    await run(h);
    const companyId = (founderId: string) => h.store.getFounder(founderId)?.companyId;
    expect(companyId("fnd_front_acme")).toBe(companyId("fnd_front_acme_labs"));
    expect(companyId("fnd_path_alpha")).not.toBe(companyId("fnd_path_beta"));
    expect(companyId("fnd_other_atlas_a")).not.toBe(companyId("fnd_other_atlas_b"));
  });

  it("gives every simulated company its own record, although their sites share one host", async () => {
    const world = createSimWorld({ seed: 911, founders: 6, days: 1 });
    const h = harness({ world, founders: world.founders().slice(0, 6).map((sim, index) => makeFounder(sim, `fnd_own_${index}`)) });
    await run(h);
    const founders = h.store.listFounders({ swarmId: SWARM_ID });
    const names = new Set(founders.map((founder) => founder.company.name));
    expect(new Set(founders.map((founder) => founder.companyId)).size).toBe(names.size);
    for (const founder of founders) {
      expect(h.store.getCompany(founder.companyId!)?.name).toBe(founder.company.name);
    }
  });

  it("obeys company.max_companies, including zero", async () => {
    const world = createSimWorld({ seed: 41, founders: 2, days: 1 });
    const makeHarnessForLimit = (limit: number) => harness({
      world,
      jobs: ["company.product", "company.traction", "company.team"],
      founders: world.founders().slice(0, 2).map((sim, index) => makeFounder(sim, `fnd_limit_${limit}_${index}`, { status: "surfaced" })),
      configParams: { "company.max_companies": limit },
    });
    const off = makeHarnessForLimit(0);
    const offRun = await run(off);
    expect(off.store.listTasks({ runId: offRun.id }).filter((task) => task.jobId.startsWith("company.")).length).toBe(0);
    expect(offRun.stats.companiesResearched).toBe(0);

    const limited = makeHarnessForLimit(1);
    const limitedRun = await run(limited);
    expect(limitedRun.stats.companiesResearched).toBe(1);
    expect(new Set(limited.store.listTasks({ runId: limitedRun.id }).filter((task) => task.jobId.startsWith("company.")).map((task) => task.companyId)).size).toBe(1);
  });

  it("uses one deep second look with unsettled rubric gaps", async () => {
    const world = createSimWorld({ seed: 66, founders: 1, days: 1 });
    const founder = makeFounder(world.founders()[0]!, "fnd_deep", { status: "surfaced", companyId: "cmp_deep" });
    const company = makeCompany("cmp_deep", founder.company.name!, { status: "needs_evidence", lastResearchedAt: "2026-11-10T00:00:00.000Z", simId: founder.simId });
    const inputs: Array<JobInput<"company.product">> = [];
    const wrap: (delegate: ExecuteJob) => ExecuteJob = (delegate) => async <J extends ModelJobId>(jobId: J, input: JobInput<J>, context: JobContext, executionOptions: Parameters<ExecuteJob>[3]) => {
      if (jobId === "company.product") inputs.push(input as JobInput<"company.product">);
      return delegate(jobId, input, context, executionOptions);
    };
    const h = harness({
      jobs: ["company.product", "company.traction", "company.team", "verify.claims", "assess.company"],
      founders: [founder],
      world,
      wrapExecuteJob: wrap,
    });
    h.store.insertCompany(company);
    h.store.insertCompanyAssessment(makeCompanyAssessment(company.id, "cas_first", "2026-11-10T00:00:00.000Z"));
    const firstRun = await run(h);
    expect(firstRun.status).toBe("succeeded");
    expect(inputs[0]?.depth).toBe("deep");
    expect(inputs[0]?.gaps.map((gap) => gap.dimension)).toContain("product");
    expect(inputs[0]?.gaps.every((gap) => gap.label.length > 0 && gap.question.length > 0)).toBe(true);
    expect(h.store.companyAssessmentHistory(company.id)).toHaveLength(2);

    h.store.updateCompany(company.id, { status: "needs_evidence", nextRecheckAt: null });
    const thirdRun = await run(h);
    expect(h.store.listTasks({ runId: thirdRun.id }).some((task) => task.jobId.startsWith("company."))).toBe(false);
  });

  it("honors company No and Yes calls, and adds live people data without failing on lookup errors", async () => {
    const world = createSimWorld({ seed: 88, founders: 1, days: 1 });
    const founder = makeFounder(world.founders()[0]!, "fnd_calls", { status: "surfaced" });
    const noCompany = makeCompany("cmp_no", "NoCo", { status: "passed" });
    const noFounder = { ...founder, id: "fnd_no", company: { ...founder.company, name: noCompany.name }, companyId: noCompany.id };
    const noHarness = harness({ jobs: ["company.product", "company.traction", "company.team"], founders: [noFounder], world });
    noHarness.store.insertCompany(noCompany);
    const no: CompanyFeedback = { id: "cfb_no", companyId: noCompany.id, author: "Partner", verdict: "no", reasonTags: [], note: "Outside thesis.", createdAt: baseTime.toISOString() };
    noHarness.store.insertCompanyFeedback(no);
    const noRun = await run(noHarness);
    expect(noHarness.store.listTasks({ runId: noRun.id }).some((task) => task.jobId.startsWith("company."))).toBe(false);
    expect(noHarness.store.getCompany(noCompany.id)?.status).toBe("passed");

    const yesFounder = { ...founder, id: "fnd_yes", companyId: null };
    const yesHarness = harness({
      jobs: ["company.product", "company.traction", "company.team", "verify.claims", "assess.company"],
      founders: [yesFounder],
      world,
    });
    const yesRun = await run(yesHarness);
    const yesCompanyId = yesHarness.store.getFounder(yesFounder.id)?.companyId;
    expect(yesCompanyId).toBeTruthy();
    yesHarness.store.insertCompanyFeedback({ id: "cfb_yes", companyId: yesCompanyId!, author: "Partner", verdict: "yes", reasonTags: [], note: null, createdAt: baseTime.toISOString() });
    // A second run with the same evidence candidates verifies the partner override on assessment.
    const yesCompany = yesHarness.store.getCompany(yesCompanyId!)!;
    yesHarness.store.updateCompany(yesCompany.id, { status: "tracked", lastResearchedAt: null });
    const followUp = await run(yesHarness);
    expect(followUp.status).toBe("succeeded");
    expect(yesHarness.store.getCompany(yesCompany.id)?.status).toBe("surfaced");

    const people: PersonRecord = {
      vendorId: "person_1", vendor: "test", name: "Research Hire", headline: null, location: null,
      profileUrl: "https://linkedin.com/in/research-hire", current: { title: "CTO", company: yesCompany.name, companyUrl: yesCompany.url, startDate: null },
      experience: [], education: [], lastVerifiedAt: null, matchConfidence: 0.9,
    };
    const liveHarness = harness({
      jobs: ["company.product", "company.traction", "company.team"],
      founders: [yesFounder],
      world,
      people: { vendor: "test", status: async () => ({ configured: true, detail: "test" }), enrich: async () => null, team: async () => [people] },
    });
    await run(liveHarness, "live");
    const liveCompanyId = liveHarness.store.getFounder(yesFounder.id)?.companyId;
    expect(liveHarness.store.listCompanyMembers(liveCompanyId!).some((member) => member.name === people.name && member.source === "people_data" && member.role === "CTO")).toBe(true);

    const failedLookup = harness({
      jobs: ["company.product", "company.traction", "company.team"],
      founders: [yesFounder],
      world,
      people: { vendor: "test", status: async () => ({ configured: true, detail: "test" }), enrich: async () => null, team: async () => { throw new Error("vendor unavailable"); } },
    });
    expect((await run(failedLookup, "live")).status).toBe("succeeded");
  });

  it("recomputes the deal from a newer founder score without creating an assess.company task", async () => {
    const world = createSimWorld({ seed: 120, founders: 1, days: 1 });
    const founder = makeFounder(world.founders()[0]!, "fnd_recompute", { status: "surfaced", companyId: "cmp_recompute" });
    const company = makeCompany("cmp_recompute", founder.company.name!, { status: "surfaced", lastResearchedAt: baseTime.toISOString() });
    const prior = makeCompanyAssessment(company.id, "cas_recompute_old", "2026-11-11T00:00:00.000Z", {
      company: 0.7,
      companyCoverage: 0.5,
      companyPotential: 0.75,
      deal: 0.68,
      judgments: emptyCompanyJudgments(),
      breakdown: [],
      brief: { summary: "Saved brief.", moat: null, strengths: [], risks: [], openQuestions: ["Saved question."] },
    });
    const h = harness({
      jobs: ["assess.company"],
      founders: [founder],
      world,
      configParams: { "screen.min_fit": 0 },
      now: () => new Date("2026-11-13T18:00:00.000Z"),
    });
    h.store.insertCompany(company);
    h.store.insertCompanyAssessment(prior);
    h.store.insertAssessment(makeFounderAssessment(founder.id, "2026-11-13T17:00:00.000Z", 0.8));
    const result = await run(h);
    expect(result.status).toBe("succeeded");
    expect(h.store.companyAssessmentHistory(company.id)).toHaveLength(2);
    const current = h.store.latestCompanyAssessment(company.id)!;
    expect(current.judgments).toEqual(prior.judgments);
    expect(current.breakdown).toEqual(prior.breakdown);
    expect(current.brief).toEqual(prior.brief);
    expect(h.store.listTasks({ runId: result.id }).some((task) => task.jobId === "assess.company")).toBe(false);
  });

  it("holds a company when any founder has an integrity-critical assessment", async () => {
    const world = createSimWorld({ seed: 201, founders: 2, days: 1 });
    const company = makeCompany("cmp_integrity_team", "Integrity Team", {
      status: "tracked",
      lastResearchedAt: "2026-11-11T00:00:00.000Z",
    });
    const founders = world.founders().slice(0, 2).map((sim, index) => makeFounder(sim, `fnd_integrity_${index}`, {
      status: "surfaced",
      company: { name: company.name, url: null, oneLiner: null, stage: null },
      companyId: company.id,
    }));
    const h = harness({
      jobs: ["assess.company"],
      founders,
      world,
      wrapExecuteJob: withStrongCompanyAssessment,
      now: () => new Date("2026-11-13T18:00:00.000Z"),
    });
    h.store.insertCompany(company);
    h.store.insertAssessment(makeFounderAssessment(founders[0]!.id, "2026-11-11T10:00:00.000Z", 0.9));
    h.store.insertAssessment(makeFounderAssessment(founders[1]!.id, "2026-11-11T11:00:00.000Z", 0.8, [
      { code: "integrity_critical", severity: "critical", message: "A material claim may be false." },
    ]));
    h.store.insertEvidence(sourceEvidence(founders[0]!.id, company.id, "evd_integrity_company"));

    const result = await run(h);
    expect(result.status).toBe("succeeded");
    const assessment = h.store.latestCompanyAssessment(company.id)!;
    expect(assessment.leadFounderId).toBe(founders[0]!.id);
    expect(assessment.team).toBe(0.9);
    expect(assessment.decision).toBe("watch");
  });

  it("recomputes when a founder reassessment changes the lead", async () => {
    const world = createSimWorld({ seed: 202, founders: 2, days: 1 });
    const company = makeCompany("cmp_lead_change", "Lead Change Co", { status: "surfaced" });
    const [a, b] = world.founders().slice(0, 2).map((sim, index) => makeFounder(sim, `fnd_lead_change_${index}`, {
      status: "surfaced",
      company: { name: company.name, url: null, oneLiner: null, stage: null },
      companyId: company.id,
    }));
    const prior = makeCompanyAssessment(company.id, "cas_before_lead_change", "2026-11-12T15:00:00.000Z", {
      leadFounderId: a!.id,
      team: 0.9,
      company: 0.7,
      companyCoverage: 0.5,
      companyPotential: 0.75,
      deal: 0.82,
      decision: "surface",
    });
    const h = harness({
      jobs: ["assess.company"],
      founders: [a!, b!],
      world,
      now: () => new Date("2026-11-13T18:00:00.000Z"),
    });
    h.store.insertCompany(company);
    h.store.insertAssessment(makeFounderAssessment(a!.id, "2026-11-12T10:00:00.000Z", 0.9));
    h.store.insertAssessment(makeFounderAssessment(b!.id, "2026-11-12T11:00:00.000Z", 0.8));
    h.store.insertCompanyAssessment(prior);
    h.store.insertAssessment(makeFounderAssessment(a!.id, "2026-11-13T17:00:00.000Z", 0.2));

    const result = await run(h);
    expect(result.status).toBe("succeeded");
    const updated = h.store.latestCompanyAssessment(company.id)!;
    expect(updated.leadFounderId).toBe(b!.id);
    expect(updated.team).toBe(0.8);
    expect(h.store.companyAssessmentHistory(company.id)).toHaveLength(2);
    expect(h.store.listTasks({ runId: result.id }).some((task) => task.jobId === "assess.company")).toBe(false);
  });

  it("keeps a company quote distinct from identical founder evidence and deduplicates company repeats", async () => {
    const world = createSimWorld({ seed: 203, founders: 1, days: 1 });
    const founder = makeFounder(world.founders()[0]!, "fnd_shared_quote", { status: "surfaced" });
    const url = "https://shared-quote.example/product";
    const excerpt = "The product is available to engineering teams.";
    const sharedDraft: CompanyEvidenceDraft = {
      kind: "article",
      facet: "product",
      url,
      title: "Product page",
      excerpt,
      claim: "The company has shipped its product.",
      publishedAt: null,
    };
    const wrap: (delegate: ExecuteJob) => ExecuteJob = (delegate) => async <J extends ModelJobId>(jobId: J, input: JobInput<J>, context: JobContext, options: Parameters<ExecuteJob>[3]): Promise<JobExecution<J>> => {
      const execution = await delegate(jobId, input, context, options);
      if (jobId !== "company.product") return execution;
      const output = execution.output as CompanyResearchOutput;
      return { ...execution, output: { ...output, evidence: [...output.evidence, sharedDraft, sharedDraft] } as JobOutput<J> };
    };
    const h = harness({
      jobs: ["company.product"],
      founders: [founder],
      world,
      wrapExecuteJob: wrap,
    });
    h.store.insertEvidence({
      ...sourceEvidence(founder.id, "", "evd_founder_shared_quote"),
      companyId: null,
      facet: null,
      url,
      excerpt,
      hash: founderEvidenceHash("web", url, excerpt),
    });

    const result = await run(h);
    expect(result.status).toBe("succeeded");
    const companyId = h.store.getFounder(founder.id)?.companyId;
    expect(companyId).toBeTruthy();
    const founderItems = h.store.listEvidence(founder.id).filter((item) => item.url === url && item.excerpt === excerpt);
    const companyItems = h.store.listCompanyEvidence(companyId!).filter((item) => item.url === url && item.excerpt === excerpt);
    expect(founderItems).toHaveLength(2);
    expect(companyItems).toHaveLength(1);
    expect(new Set(founderItems.map((item) => item.hash)).size).toBe(2);
  });
});
