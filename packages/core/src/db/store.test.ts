import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  DEFAULT_SETTINGS,
  type Assessment,
  type Company,
  type CompanyAssessment,
  type CompanyFeedback,
  type CompanyMember,
  type Directive,
  type Evidence,
  type Feedback,
  type Founder,
  type Run,
  type SwarmConfig,
  type TaskRun,
  type NetworkContact,
  ZERO_STATS,
} from "@agentswarm/shared";
import { normalizeLink, normalizeName, openStore } from "./index";

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function founder(id: string, overrides: Partial<Founder> = {}): Founder {
  return {
    id, swarmId: "swm_1", name: `Founder ${id}`, headline: "Engineer", location: "NYC",
    company: { name: `Company ${id}`, url: null, oneLiner: "Builds useful tools", stage: "seed" },
    links: { github: null, linkedin: null, x: null, site: null, scholar: null },
    status: "lead", fit: null, fitReasons: [], tags: ["infra"], identityConfidence: null,
    sources: ["github"], firstSeenAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    lastAssessedAt: null, nextRecheckAt: null, simId: null,
    ...overrides,
  };
}

function assessment(id: string, founderId: string, overrides: Partial<Assessment> = {}): Assessment {
  return {
    id, founderId, runId: null, configId: "cfg_base", composite: 0.5, cracked: 0.5, founderScore: 0.5,
    coverage: 0.7, potential: 0.6, fit: 0.5, decision: "watch", reasons: ["Review"],
    flags: [], breakdown: [], judgments: [], summary: "A sourced summary.", memo: null,
    createdAt: "2026-01-02T00:00:00.000Z", ...overrides,
  };
}

function evidence(id: string, founderId: string, hash: string, verification: Evidence["verification"] = "unverified"): Evidence {
  return {
    id, founderId, kind: "profile", source: "github", url: "https://example.com/profile", title: "Profile",
    excerpt: "A nested evidence excerpt.", claim: "The founder built a project.", publishedAt: null,
    capturedAt: "2026-01-03T00:00:00.000Z", collectedByTaskId: null, hash, verification,
    verificationNote: null, sim: { signals: [{ dimension: "technical_depth", value: 0.8 }], truth: "supported" },
  };
}

function company(id: string, overrides: Partial<Company> = {}): Company {
  return {
    id, swarmId: "swm_1", name: `Company ${id}`, domain: `${id}.test`, url: `https://${id}.test`,
    oneLiner: "Builds useful tools", mission: null, sector: "software", stage: "seed",
    links: { github: null, x: null, linkedin: null, docs: null, careers: null }, status: "tracked",
    firstSeenAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    lastResearchedAt: null, lastAssessedAt: null, nextRecheckAt: null, simId: null,
    ...overrides,
  };
}

function companyAssessment(id: string, companyId: string, overrides: Partial<CompanyAssessment> = {}): CompanyAssessment {
  return {
    id, companyId, runId: null, configId: "cfg_base", company: 0.6, companyCoverage: 0.7,
    companyPotential: 0.8, leadFounderId: null, team: 0.5, deal: 0.55, coverage: 0.7,
    potential: 0.8, decision: "watch", reasons: [], flags: [], breakdown: [], judgments: [],
    brief: { summary: "A sourced company summary.", strengths: [], risks: [], openQuestions: [] },
    createdAt: "2026-01-03T00:00:00.000Z", ...overrides,
  };
}

function companyFeedback(id: string, companyId: string, verdict: CompanyFeedback["verdict"], createdAt: string): CompanyFeedback {
  return { id, companyId, author: "Partner", verdict, reasonTags: ["real_pull"], note: null, createdAt };
}

function companyMember(id: string, companyId: string, overrides: Partial<CompanyMember> = {}): CompanyMember {
  return {
    id, companyId, name: `Person ${id}`, role: null, isFounder: false, founderId: null,
    links: { github: null, linkedin: null, x: null, site: null, scholar: null },
    background: null, source: "github", sourceUrl: null, addedAt: "2026-01-03T00:00:00.000Z", ...overrides,
  };
}

function networkContact(id: string, name: string, overrides: Partial<NetworkContact> = {}): NetworkContact {
  return {
    id, owner: "partner@example.test", name, company: null, position: null, profileUrl: null,
    connectedOn: null, importedAt: "2026-01-03T00:00:00.000Z", previous: null, ...overrides,
  };
}

function feedback(
  id: string,
  founderId: string,
  verdict: Feedback["verdict"],
  createdAt: string,
  reasonTags: string[] = [],
): Feedback {
  return { id, founderId, author: "Partner", verdict, reasonTags, note: null, createdAt };
}

function run(id: string, swarmId: string, status: Run["status"], startedAt: string): Run {
  return {
    id, swarmId, trigger: "manual", brain: "sim", sources: "sim", status, stage: "scout", configId: "cfg_base",
    budgetUsd: 10, costUsd: 0, stats: { ...ZERO_STATS }, error: null, simDay: null, startedAt, finishedAt: null,
  };
}

function task(id: string, overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id, runId: "run_1", swarmId: "swm_1", agentId: "agt_1", jobId: "scout.github", classId: "scout",
    stage: "scout", founderId: null, status: "succeeded", skipReason: null, attempt: 1, provider: "openai",
    model: "test-model", effort: null, inputSummary: "input", outputSummary: `output ${id}`, output: { nested: [1, { ok: true }] },
    steering: { directiveIds: [], params: { maxItems: 5 }, block: "guidance" },
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, costUsd: 0.1, latencyMs: 100, itemsOut: 2,
    error: null, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z", ...overrides,
  } as TaskRun;
}

function directive(id: string, createdAt: string): Directive {
  return {
    id, scope: { swarmId: "swm_1" }, kind: "rule", key: null, value: null, text: `Rule ${id}`,
    priority: 0, status: "active", author: "Partner", note: null, createdAt, updatedAt: createdAt, expiresAt: null,
  };
}

describe("SQLite store", () => {
  it("round-trips nested records and initializes the base config and default settings", () => {
    const store = openStore(":memory:");
    expect(store.getConfig("cfg_base")).toEqual({ id: "cfg_base", label: "Base configuration", params: {}, routes: {}, promptVariants: {} });
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    const value = founder("fnd_nested", {
      name: "Zoë O'Neil",
      company: { name: "Acme Labs", url: "https://acme.test", oneLiner: "Builds things", stage: "seed" },
      links: { github: "https://www.github.com/zoe?tab=repos", linkedin: null, x: null, site: null, scholar: null },
      fitReasons: ["Strong systems background", "Founder led"], tags: ["infra", "ai"],
    });
    store.insertFounder(value);
    expect(store.getFounder(value.id)).toEqual(value);
    store.close();
  });

  it("normalizes links and names and maintains indexed matches after founder updates", () => {
    const store = openStore(":memory:");
    expect(normalizeLink("HTTPS://WWW.GitHub.com/Zo%C3%AB/?tab=1#bio///")).toBe("github.com/zo%c3%ab");
    expect(normalizeName("  Zoë O'Neil, Ph.D.  ")).toBe("zoe o neil ph d");
    const person = founder("fnd_links", { links: { github: "https://www.GitHub.com/Founder/", linkedin: null, x: null, site: null, scholar: null } });
    store.insertFounder(person);
    expect(store.findFounderByLinks("swm_1", { ...person.links, github: "http://github.com/founder///?ref=x" })).toEqual(person);
    expect(store.findFoundersByName("swm_1", "zoe o neil")).toEqual([]);
    const renamed = store.updateFounder(person.id, { name: "Zoë O'Neil", links: { ...person.links, github: null, site: "https://www.example.com/zoe/" } });
    expect(store.findFounderByLinks("swm_1", person.links)).toBeNull();
    expect(store.findFounderByLinks("swm_1", { ...person.links, site: "http://example.com/zoe" })).toEqual(renamed);
    expect(store.findFoundersByName("swm_1", "zoe o neil")).toEqual([renamed]);
    store.close();
  });

  it("sets an evidence quote without changing verification", () => {
    const store = openStore(":memory:");
    const item = evidence("evd_quote", "fnd_1", "quote-hash", "supported");
    store.insertEvidence(item);
    store.setQuote(item.id, "found");
    expect(store.listEvidence(item.founderId)).toEqual([{ ...item, quote: "found" }]);
    store.close();
  });

  it("deduplicates evidence by founder and hash", () => {
    const store = openStore(":memory:");
    expect(store.insertEvidence(evidence("evd_1", "fnd_1", "same-hash"))).toBe(true);
    expect(store.insertEvidence(evidence("evd_2", "fnd_1", "same-hash", "supported"))).toBe(false);
    expect(store.listEvidence("fnd_1")).toHaveLength(1);
    expect(store.insertEvidence(evidence("evd_3", "fnd_2", "same-hash"))).toBe(true);
    store.close();
  });

  it("stores companies and builds filtered rows from assessments, founders, members, evidence, feedback and contacts", () => {
    const store = openStore(":memory:");
    const acme = company("co_acme", { name: "Acme Inc", domain: "old.test", status: "tracked" });
    const north = company("co_north", { name: "Acme North", status: "tracked", updatedAt: "2026-01-08T00:00:00.000Z" });
    const noScore = company("co_null", { name: "Acme Null", status: "tracked", updatedAt: "2026-01-07T00:00:00.000Z" });
    const archived = company("co_archived", { name: "Archived Acme", status: "archived" });
    for (const item of [acme, north, noScore, archived]) store.insertCompany(item);
    expect(store.getCompany(acme.id)).toEqual(acme);
    expect(store.findCompanyByDomain("swm_1", "old.test")).toEqual(acme);
    expect(store.findCompanyByDomain("swm_1", "")).toBeNull();
    expect(store.findCompaniesByName("swm_1", "acme")).toEqual([acme]);
    expect(store.findCompaniesByName("swm_1", "")).toEqual([]);
    const renamed = store.updateCompany(acme.id, { name: "Acme Labs", domain: "acme-labs.test", status: "surfaced", updatedAt: "2026-01-09T00:00:00.000Z" });
    expect(store.findCompanyByDomain("swm_1", "old.test")).toBeNull();
    expect(store.findCompanyByDomain("swm_1", "acme-labs.test")).toEqual(renamed);
    expect(store.findCompaniesByName("swm_1", "acme labs")).toEqual([renamed]);
    expect(store.listCompanies({ swarmId: "swm_1", statuses: ["tracked"] }).map((item) => item.id)).toEqual([north.id, noScore.id]);

    const earlier = founder("fnd_earlier", { companyId: acme.id, firstSeenAt: "2026-01-01T00:00:00.000Z" });
    const lead = founder("fnd_lead", { name: "Lead Founder", companyId: acme.id, firstSeenAt: "2026-01-02T00:00:00.000Z" });
    store.insertFounder(lead);
    store.insertFounder(earlier);
    expect(store.foundersOfCompany(acme.id).map((person) => person.id)).toEqual([earlier.id, lead.id]);

    const originalMember = companyMember("mem_alice", acme.id, {
      name: "Alice Example", role: "CEO", isFounder: true, founderId: lead.id, background: "Built systems",
      sourceUrl: "https://example.test/team", addedAt: "2026-01-02T00:00:00.000Z",
      links: { github: "https://github.com/alice", linkedin: null, x: null, site: null, scholar: null },
    });
    store.upsertCompanyMember(originalMember);
    store.upsertCompanyMember(companyMember("mem_alice_new", acme.id, {
      name: "ALICE EXAMPLE", role: null, isFounder: false, founderId: null, background: null, sourceUrl: null,
      addedAt: "2026-01-09T00:00:00.000Z",
    }));
    store.upsertCompanyMember(companyMember("mem_bob", acme.id, { name: "Bob Example", addedAt: "2026-01-01T00:00:00.000Z" }));
    expect(store.listCompanyMembers(acme.id)).toEqual([
      { ...originalMember, name: "ALICE EXAMPLE" },
      companyMember("mem_bob", acme.id, { name: "Bob Example", addedAt: "2026-01-01T00:00:00.000Z" }),
    ]);

    store.insertEvidence({ ...evidence("evd_company_1", lead.id, "company-one"), companyId: acme.id, capturedAt: "2026-01-02T00:00:00.000Z" });
    store.insertEvidence({ ...evidence("evd_company_2", earlier.id, "company-two", "supported"), companyId: acme.id, capturedAt: "2026-01-03T00:00:00.000Z" });
    store.insertEvidence({ ...evidence("evd_company_other", lead.id, "company-other"), companyId: north.id });
    expect(store.listCompanyEvidence(acme.id).map((item) => item.id)).toEqual(["evd_company_1", "evd_company_2"]);
    expect(store.listCompanyEvidence(acme.id, { verifications: ["supported"] }).map((item) => item.id)).toEqual(["evd_company_2"]);
    expect(store.listCompanyEvidence(acme.id, { verifications: [] })).toEqual([]);

    store.insertTask(task("tsk_company", { companyId: acme.id }));
    store.insertTask(task("tsk_company_other", { companyId: north.id }));
    expect(store.listTasks({ companyId: acme.id }).map((item) => item.id)).toEqual(["tsk_company"]);

    store.insertCompanyAssessment(companyAssessment("casm_acme", acme.id, {
      company: 0.8, team: 0.7, deal: 0.9, decision: "surface", leadFounderId: lead.id,
      flags: [
        { code: "outside_thesis", severity: "info", message: "First" },
        { code: "integrity_concern", severity: "warning", message: "Second" },
      ],
    }));
    store.insertCompanyAssessment(companyAssessment("casm_north", north.id, { company: 0.5, team: 0.4, deal: 0.4 }));
    store.insertCompanyFeedback(companyFeedback("cfb_old", acme.id, "no", "2026-01-04T00:00:00.000Z"));
    store.insertCompanyFeedback(companyFeedback("cfb_new", acme.id, "yes", "2026-01-05T00:00:00.000Z"));
    expect(store.listCompanyFeedback(acme.id).map((item) => item.id)).toEqual(["cfb_new", "cfb_old"]);
    expect(store.latestCompanyAssessment(acme.id)?.id).toBe("casm_acme");
    expect(store.companyAssessmentHistory(acme.id)).toEqual([{ at: "2026-01-03T00:00:00.000Z", deal: 0.9, decision: "surface" }]);
    expect(store.allCompanyFeedback("swm_1").map((item) => item.id)).toEqual(["cfb_old", "cfb_new"]);

    const contact = networkContact("net_acme", "Known Person", { company: "Acme Labs", position: "Engineer" });
    store.replaceNetwork(contact.owner, [contact]);
    const rows = store.companyRows({ swarmId: "swm_1" });
    expect(rows.rows.map((row) => row.id)).toEqual([acme.id, north.id, noScore.id]);
    expect(rows.rows[0]).toMatchObject({
      id: acme.id, decision: "surface", deal: 0.9, company: 0.8, team: 0.7, coverage: 0.7,
      founders: [{ id: lead.id, name: "Lead Founder" }, { id: earlier.id, name: earlier.name }],
      teamSize: 2, evidenceCount: 2, flagCount: 2, feedback: "yes", feedbackReasons: ["real_pull"], knownPeople: 1,
    });
    expect(rows.rows[2]?.deal).toBeNull();
    expect(rows.counts).toEqual({ tracked: 2, surfaced: 1, needs_evidence: 0, watch: 0, passed: 0, archived: 1 });
    const filtered = store.companyRows({ swarmId: "swm_1", status: "surfaced", q: "ACME" });
    expect(filtered.rows.map((row) => row.id)).toEqual([acme.id]);
    expect(filtered.total).toBe(1);
    expect(filtered.counts).toEqual(rows.counts);
    expect(store.companyRows({ swarmId: "swm_1", status: "all", q: "builds", sort: "recent" }).rows.map((row) => row.id))
      .toEqual([acme.id, north.id, noScore.id]);
    store.close();
  });

  it("reconciles network changes by profile link or normalized name", () => {
    const store = openStore(":memory:");
    const owner = "partner@example.test";
    store.replaceNetwork(owner, [
      networkContact("old_link", "Taylor Old", {
        company: "Acme", position: "CEO", profileUrl: "HTTPS://Example.test/taylor///",
      }),
      networkContact("old_name", "Alex One", { company: "Old Co", position: "Engineer" }),
      networkContact("old_steady", "Steady Person", { company: " Same ", position: "Analyst" }),
      networkContact("old_renamed", "Old Contact Name", {
        company: "OldCo", position: "Builder", profileUrl: "https://example.test/profile/",
      }),
    ]);
    const refreshed = store.replaceNetwork(owner, [
      networkContact("new_link", "Taylor Current", {
        company: "Nova Inc", position: "CEO", profileUrl: "https://example.test/taylor",
      }),
      networkContact("new_name", "Alex One", { company: "New Co", position: "Engineer" }),
      networkContact("new_steady", "Steady Person", { company: "same", position: "ANALYST" }),
      networkContact("new_renamed", "Different Name", {
        company: "NewCo", position: "Builder", profileUrl: "HTTPS://EXAMPLE.TEST/profile///",
      }),
      networkContact("new_person", "Brand New", { company: "Nova", position: "Designer" }),
    ]);
    expect(refreshed.map(({ id, previous }) => ({ id, previous }))).toEqual([
      { id: "new_link", previous: { company: "Acme", position: "CEO" } },
      { id: "new_name", previous: { company: "Old Co", position: "Engineer" } },
      { id: "new_steady", previous: null },
      { id: "new_renamed", previous: { company: "OldCo", position: "Builder" } },
      { id: "new_person", previous: null },
    ]);
    expect(store.networkAtCompany("nova").map((item) => item.id).sort()).toEqual(["new_link", "new_person"]);
    expect(store.networkAtCompany("")).toEqual([]);
    expect(store.listNetwork(owner).map((item) => item.name)).toEqual([
      "Alex One", "Brand New", "Different Name", "Steady Person", "Taylor Current",
    ]);
    expect(store.removeNetwork(owner)).toBe(5);
    expect(store.listNetwork(owner)).toEqual([]);
    store.close();
  });

  it("stores a person listed twice in one upload once, instead of failing the upload", () => {
    const store = openStore(":memory:");
    const stored = store.replaceNetwork("partner@example.test", [
      networkContact("same", "Jordan Twice", { company: "Acme", position: "Engineer" }),
      networkContact("same", "Jordan Twice", { company: "Acme", position: "Engineer" }),
      networkContact("other", "Someone Else", { company: "Acme", position: "Designer" }),
    ]);
    expect(stored.map((item) => item.id)).toEqual(["same", "other"]);
    expect(store.listNetwork("partner@example.test")).toHaveLength(2);
    store.close();
  });

  it("builds filtered dashboard rows with all status counts, evidence, flags, sorts and pagination", () => {
    const store = openStore(":memory:");
    const people = [
      founder("fnd_a", { name: "Ada", headline: "Systems founder", company: { name: "Acme", url: null, oneLiner: null, stage: null }, status: "surfaced", updatedAt: "2026-01-01T00:00:00.000Z", fit: 0.2 }),
      founder("fnd_b", { name: "Ben", headline: "Designer", company: { name: "Acme North", url: null, oneLiner: null, stage: null }, status: "watch", updatedAt: "2026-01-04T00:00:00.000Z", fit: 0.9 }),
      founder("fnd_c", { name: "Cy", headline: "Engineer", company: { name: "Other", url: null, oneLiner: null, stage: null }, status: "lead", updatedAt: "2026-01-02T00:00:00.000Z" }),
      founder("fnd_d", { name: "Dee", headline: "Archived", status: "archived", updatedAt: "2026-01-05T00:00:00.000Z" }),
    ];
    for (const person of people) store.insertFounder(person);
    store.insertAssessment(assessment("asm_a", "fnd_a", { composite: 0.8, cracked: 0.1, fit: 0.2, decision: "surface", flags: [
      { code: "integrity_concern", severity: "warning", message: "Review" },
      { code: "outside_thesis", severity: "info", message: "Info does not count" },
    ] }));
    store.insertAssessment(assessment("asm_b", "fnd_b", { composite: 0.4, cracked: 0.9, fit: 0.9, decision: "watch", createdAt: "2026-01-05T00:00:00.000Z", flags: [
      { code: "integrity_critical", severity: "critical", message: "Review" },
    ] }));
    store.insertAssessment(assessment("asm_d", "fnd_d", { composite: 0.99, cracked: 0.99, fit: 0.99, decision: "surface" }));
    store.insertFeedback(feedback("fbk_old", "fnd_a", "no", "2026-01-01T00:00:00.000Z", ["too_early"]));
    store.insertFeedback(feedback("fbk_new", "fnd_a", "yes", "2026-01-03T00:00:00.000Z", ["builder", "speed"]));
    store.insertEvidence(evidence("evd_a1", "fnd_a", "a1", "supported"));
    store.insertEvidence(evidence("evd_a2", "fnd_a", "a2", "unverified"));
    store.insertEvidence(evidence("evd_a3", "fnd_a", "a3", "unsupported"));

    expect(store.founderRows({ swarmId: "swm_1" }).rows.map((row) => row.id)).toEqual(["fnd_a", "fnd_b", "fnd_c"]);
    expect(store.founderRows({ swarmId: "swm_1" }).counts).toMatchObject({ surfaced: 1, watch: 1, lead: 1, archived: 1 });
    expect(store.founderRows({ swarmId: "swm_1", sort: "cracked" }).rows.map((row) => row.id)).toEqual(["fnd_b", "fnd_a", "fnd_c"]);
    expect(store.founderRows({ swarmId: "swm_1", sort: "fit" }).rows.map((row) => row.id)).toEqual(["fnd_b", "fnd_a", "fnd_c"]);
    expect(store.founderRows({ swarmId: "swm_1", sort: "recent" }).rows.map((row) => row.id)).toEqual(["fnd_b", "fnd_c", "fnd_a"]);
    expect(store.founderRows({ swarmId: "swm_1", status: "surfaced", decision: "surface", q: "SYSTEMS", sort: "recent" }).rows.map((row) => row.id)).toEqual(["fnd_a"]);
    const page = store.founderRows({ swarmId: "swm_1", q: "acme", sort: "recent", limit: 1, offset: 1 });
    expect(page.rows.map((row) => row.id)).toEqual(["fnd_a"]);
    expect(page.total).toBe(2);
    const ada = store.founderRows({ swarmId: "swm_1", q: "acme", status: "all", limit: 500 }).rows.find((row) => row.id === "fnd_a");
    // The most recent call wins, and its reasons come with it.
    expect(ada).toMatchObject({ evidenceCount: 2, flagCount: 1, feedback: "yes", feedbackReasons: ["builder", "speed"] });
    expect(store.founderRows({ swarmId: "swm_1", status: "archived" }).rows.map((row) => row.id)).toEqual(["fnd_d"]);
    store.close();
  });

  it("stores directive use, separates traces and lists only the newest limited tasks in original order", () => {
    const store = openStore(":memory:");
    const older = directive("dir_old", "2026-01-01T00:00:00.000Z");
    const archived = { ...directive("dir_archived", "2026-01-02T00:00:00.000Z"), status: "archived" as const };
    const newer = directive("dir_new", "2026-01-03T00:00:00.000Z");
    for (const item of [newer, archived, older]) store.insertDirective(item);
    expect(store.listDirectives().map((item) => item.id)).toEqual(["dir_old", "dir_new"]);
    expect(store.listDirectives({ includeArchived: true }).map((item) => item.id)).toEqual(["dir_old", "dir_archived", "dir_new"]);
    const first = task("tsk_1", { startedAt: null, steering: { directiveIds: ["dir_a", "dir_a", "dir_b"], params: {}, block: "one" }, trace: [{ role: "user", content: "private trace" }] });
    const second = task("tsk_2", { startedAt: "2026-01-02T00:00:00.000Z", steering: { directiveIds: ["dir_a"], params: {}, block: "two" } });
    const third = task("tsk_3", { startedAt: "2026-01-03T00:00:00.000Z" });
    const fourth = task("tsk_4", { startedAt: "2026-01-04T00:00:00.000Z" });
    for (const t of [first, second, third, fourth]) store.insertTask(t);
    expect(store.getTask("tsk_1", { withTrace: true })).toEqual(first);
    expect(store.getTask("tsk_2", { withTrace: true })?.trace).toEqual([]);
    expect(store.listTasks({}).every((t) => !Object.hasOwn(t, "trace"))).toBe(true);
    expect(store.listTasks({ limit: 2 }).map((t) => t.id)).toEqual(["tsk_3", "tsk_4"]);
    expect(store.directiveUsage()).toEqual(new Map([
      ["dir_a", { appliedCount: 2, lastAppliedAt: "2026-01-02T00:00:00.000Z" }],
      ["dir_b", { appliedCount: 1, lastAppliedAt: null }],
    ]));
    store.updateTask("tsk_2", { trace: [{ role: "assistant", content: "saved later" }] });
    expect(store.getTask("tsk_2", { withTrace: true })?.trace).toEqual([{ role: "assistant", content: "saved later" }]);
    store.close();
  });

  it("selects active and interrupted runs, totals nullable costs and computes task windows separately from all-time fields", () => {
    const store = openStore(":memory:");
    store.insertRun(run("run_old", "swm_1", "queued", "2026-01-01T00:00:00.000Z"));
    store.insertRun(run("run_new", "swm_1", "running", "2026-01-03T00:00:00.000Z"));
    store.insertRun(run("run_other", "swm_2", "queued", "2026-01-02T00:00:00.000Z"));
    store.insertRun(run("run_done", "swm_1", "succeeded", "2026-01-04T00:00:00.000Z"));
    expect(store.activeRun("swm_1")?.id).toBe("run_new");
    expect(store.interruptedRuns()).toHaveLength(3);
    expect(store.interruptedRuns().map((r) => r.id)).toEqual(expect.arrayContaining(["run_new", "run_other", "run_old"]));

    store.insertTask(task("tsk_old", { runId: "run_new", status: "succeeded", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T01:00:00.000Z", costUsd: 0.4, outputSummary: "older success", itemsOut: 3 }));
    store.insertTask(task("tsk_fail", { runId: "run_new", status: "failed", startedAt: "2026-01-04T00:00:00.000Z", finishedAt: "2026-01-04T01:00:00.000Z", costUsd: null, itemsOut: 5 }));
    store.insertTask(task("tsk_success", { runId: "run_new", status: "succeeded", startedAt: "2026-01-05T00:00:00.000Z", finishedAt: "2026-01-05T01:00:00.000Z", costUsd: 0.6, outputSummary: "newest success", itemsOut: 7 }));
    store.insertTask(task("tsk_skip", { runId: "run_new", status: "skipped", finishedAt: "2026-01-06T00:00:00.000Z", costUsd: 5, itemsOut: 99 }));
    expect(store.runCost("run_new")).toBe(6);
    expect(store.nodeStats("swm_1", "2026-01-04T00:00:00.000Z")).toEqual([{
      agentId: "agt_1", tasks: 2, failures: 1, costUsd: 0.6, itemsOut: 12,
      lastRunAt: "2026-01-06T00:00:00.000Z", lastOutput: "newest success",
    }]);
    store.close();
  });

  it("rolls back nested transactions and names missing ids in update errors", () => {
    const store = openStore(":memory:");
    expect(() => store.transaction(() => {
      store.insertFounder(founder("fnd_rollback"));
      store.transaction(() => { store.insertEvidence(evidence("evd_rollback", "fnd_rollback", "rollback")); });
      throw new Error("abort outer transaction");
    })).toThrow("abort outer transaction");
    expect(store.getFounder("fnd_rollback")).toBeNull();
    expect(store.listEvidence("fnd_rollback")).toEqual([]);
    expect(() => store.updateFounder("missing-founder", { name: "Nobody" })).toThrow("missing-founder");
    expect(() => store.updateTask("missing-task", { status: "failed" })).toThrow("missing-task");
    store.close();
  });

  it("migrates a populated version-1 database without changing its records and fills old run counters", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentswarm-v1-db-"));
    scratchDirs.push(dir);
    const path = join(dir, "legacy.sqlite");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE configs (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE founders (
        id TEXT PRIMARY KEY, swarm_id TEXT NOT NULL, normalized_name TEXT NOT NULL,
        updated_at TEXT NOT NULL, next_recheck_at TEXT, status TEXT NOT NULL, record TEXT NOT NULL
      );
      CREATE TABLE evidence (
        id TEXT PRIMARY KEY, founder_id TEXT NOT NULL, hash TEXT NOT NULL,
        captured_at TEXT NOT NULL, verification TEXT NOT NULL, record TEXT NOT NULL,
        UNIQUE (founder_id, hash)
      );
      CREATE TABLE tasks (
        insertion_order INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL, swarm_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        founder_id TEXT, status TEXT NOT NULL, started_at TEXT, finished_at TEXT,
        cost_usd REAL, items_out INTEGER NOT NULL, output_summary TEXT, record TEXT NOT NULL
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY, swarm_id TEXT NOT NULL, status TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, record TEXT NOT NULL
      );
    `);
    const oldFounder = founder("fnd_legacy");
    const oldEvidence = evidence("evd_legacy", oldFounder.id, "legacy-hash");
    const oldTask = task("tsk_legacy");
    const oldRun = run("run_legacy", "swm_1", "succeeded", "2026-01-01T00:00:00.000Z");
    const omittedCounters = new Set(["companiesResearched", "companiesAssessed", "companiesSurfaced", "quotesRejected", "controlsFailed"]);
    const legacyStats = Object.fromEntries(Object.entries(oldRun.stats).filter(([key]) => !omittedCounters.has(key)));
    const oldRunRecord = { ...oldRun, stats: legacyStats };
    legacy.prepare(`INSERT INTO founders (id, swarm_id, normalized_name, updated_at, next_recheck_at, status, record)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(oldFounder.id, oldFounder.swarmId, normalizeName(oldFounder.name), oldFounder.updatedAt,
      oldFounder.nextRecheckAt, oldFounder.status, JSON.stringify(oldFounder));
    legacy.prepare(`INSERT INTO evidence (id, founder_id, hash, captured_at, verification, record) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(oldEvidence.id, oldEvidence.founderId, oldEvidence.hash, oldEvidence.capturedAt, oldEvidence.verification, JSON.stringify(oldEvidence));
    const oldTaskRecord = { ...oldTask };
    delete oldTaskRecord.trace;
    legacy.prepare(`INSERT INTO tasks (id, run_id, swarm_id, agent_id, founder_id, status, started_at, finished_at,
      cost_usd, items_out, output_summary, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(oldTask.id, oldTask.runId, oldTask.swarmId, oldTask.agentId, oldTask.founderId, oldTask.status, oldTask.startedAt,
        oldTask.finishedAt, oldTask.costUsd, oldTask.itemsOut, oldTask.outputSummary, JSON.stringify(oldTaskRecord));
    legacy.prepare("INSERT INTO runs (id, swarm_id, status, started_at, finished_at, record) VALUES (?, ?, ?, ?, ?, ?)")
      .run(oldRun.id, oldRun.swarmId, oldRun.status, oldRun.startedAt, oldRun.finishedAt, JSON.stringify(oldRunRecord));
    legacy.pragma("user_version = 1");
    legacy.close();

    const store = openStore(path);
    expect(store.getFounder(oldFounder.id)).toEqual(oldFounder);
    expect(store.listEvidence(oldFounder.id)).toEqual([oldEvidence]);
    expect(store.getTask(oldTask.id, { withTrace: false })).toEqual(oldTaskRecord);
    expect(store.getRun(oldRun.id)).toEqual(oldRun);
    store.close();
    const migrated = new Database(path, { readonly: true });
    expect(migrated.pragma("user_version", { simple: true })).toBe(2);
    migrated.close();
  });

  it("keeps file-backed data and saved configs across reopen without destructive migration reruns", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentswarm-db-"));
    scratchDirs.push(dir);
    const path = join(dir, "nested", "store.sqlite");
    const store = openStore(path);
    const person = founder("fnd_file", { name: "Persistent founder" });
    store.insertFounder(person);
    const config: SwarmConfig = { id: "cfg_base", label: "Preserved custom base", params: { maxItems: 7 }, routes: {}, promptVariants: {} };
    store.saveConfig(config);
    store.close();

    const reopened = openStore(path);
    expect(reopened.getFounder(person.id)).toEqual(person);
    expect(reopened.getConfig("cfg_base")).toEqual(config);
    reopened.close();
    const db = new Database(path, { readonly: true });
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    db.close();
  });
});
