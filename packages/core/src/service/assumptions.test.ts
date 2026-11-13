import { describe, expect, it } from "vitest";
import type { Company, CompanyAssessment, CompanyFeedback, Feedback, Founder, Assessment, Swarm, SwarmConfig } from "@agentswarm/shared";
import { assumptionsFor, callCases } from "./assumptions";
import type { LedgerDeps } from "./assumptions";
import { ServiceError } from "../contracts";

const swarm: Swarm = {
  id: "swarm-1", name: "Swarm", status: "active", thesis: { summary: "", sectors: [], stages: [], geos: [], avoid: [] },
  configId: "cfg-1", createdAt: "", updatedAt: "",
};

const founder = (id: string): Founder => ({
  id, swarmId: swarm.id, name: id, headline: null, location: null,
  company: { name: null, url: null, oneLiner: null, stage: null },
  links: { github: null, linkedin: null, x: null, site: null, scholar: null },
  status: "surfaced", fit: 0.8, fitReasons: [], tags: [], identityConfidence: null, sources: [],
  firstSeenAt: "2026-01-01T00:00:00.000Z", updatedAt: "", lastAssessedAt: null, nextRecheckAt: null, simId: null,
});

const company = (id: string): Company => ({
  id, swarmId: swarm.id, name: id, domain: null, url: null, oneLiner: null, mission: null, sector: null, stage: null,
  links: { github: null, x: null, linkedin: null, docs: null, careers: null }, status: "tracked",
  firstSeenAt: "", updatedAt: "", lastResearchedAt: null, lastAssessedAt: null, nextRecheckAt: null, simId: null,
});

const founderAssessment = (id: string): Assessment => ({
  id: `assessment-${id}`, founderId: id, runId: null, configId: "cfg-1", composite: 0.72, cracked: 0.7, founderScore: 0.8,
  coverage: 1, potential: 0.72, fit: 0.8, decision: "surface", reasons: [], flags: [], breakdown: [],
  judgments: [
    { dimension: "built_hard_things", level: 3, confidence: 1, rationale: "", evidenceIds: [], counterEvidenceIds: [] },
    { dimension: "insight", level: null, confidence: 0, rationale: "", evidenceIds: [], counterEvidenceIds: [] },
  ], summary: "", memo: null, createdAt: "",
});

const companyAssessment = (id: string): CompanyAssessment => ({
  id: `assessment-${id}`, companyId: id, runId: null, configId: "cfg-1", company: 0.6, companyCoverage: 0.8,
  companyPotential: 0.75, leadFounderId: null, team: null, deal: 0.66, coverage: 0.7, potential: 0.72,
  decision: "watch", reasons: [], flags: [], breakdown: [],
  judgments: [{ dimension: "mission", level: 2, confidence: 1, rationale: "", evidenceIds: [], counterEvidenceIds: [] }],
  brief: { summary: "", strengths: [], risks: [], openQuestions: [] }, createdAt: "",
});

const founderCall = (id: string, verdict: string, at: string): Feedback => ({
  id: `call-${id}-${at}`, founderId: id, author: "partner", verdict: verdict as Feedback["verdict"], reasonTags: [], note: null, createdAt: at,
});

const companyCall = (id: string, verdict: string, at: string): CompanyFeedback => ({
  id: `call-${id}-${at}`, companyId: id, author: "partner", verdict: verdict as CompanyFeedback["verdict"], reasonTags: [], note: null, createdAt: at,
});

function fakeStore(options: { calls?: Feedback[]; companyCalls?: CompanyFeedback[]; assessments?: Map<string, Assessment>; companyAssessments?: Map<string, CompanyAssessment>; config?: SwarmConfig } = {}) {
  const founders = [founder("f-called"), founder("f-skipped"), founder("f-unknown")];
  const companies = [company("c-called"), company("c-unknown")];
  const calls = options.calls ?? [
    founderCall("f-called", "no", "2026-01-01"),
    founderCall("f-called", "yes", "2026-01-02"),
    founderCall("f-skipped", "yes", "2026-01-03"),
    founderCall("f-unknown", "maybe", "2026-01-03"),
  ];
  const companyCalls = options.companyCalls ?? [
    companyCall("c-called", "no", "2026-01-01"),
    companyCall("c-called", "yes", "2026-01-02"),
    companyCall("c-unknown", "unknown", "2026-01-03"),
  ];
  const store = {
    getSwarm: (id: string) => id === swarm.id ? swarm : null,
    getConfig: () => options.config ?? { id: "cfg-1", label: "Current", params: { "weights.built_hard_things": 4 }, routes: {}, promptVariants: {} },
    listFounders: () => founders,
    latestAssessment: (id: string) => options.assessments?.get(id) ?? (id === "f-called" ? founderAssessment(id) : null),
    listFeedback: (id: string) => calls.filter((call) => call.founderId === id),
    listCompanies: () => companies,
    latestCompanyAssessment: (id: string) => options.companyAssessments?.get(id) ?? (id === "c-called" ? companyAssessment(id) : null),
    listCompanyFeedback: (id: string) => companyCalls.filter((call) => call.companyId === id),
  };
  return { store: store as LedgerDeps["store"], founders, companies };
}

describe("callCases", () => {
  it("uses each latest yes or no, divides levels by four, preserves nulls, and skips missing or other verdicts", () => {
    const { store } = fakeStore();
    expect(callCases(store, swarm.id)).toEqual([
      {
        group: "calls", outcome: 1, founder: 0.72, company: null, deal: null,
        founderLevels: { built_hard_things: 0.75, insight: null }, companyLevels: {},
      },
      {
        group: "calls", outcome: 1, founder: null, company: 0.6, deal: 0.66,
        founderLevels: {}, companyLevels: { mission: 0.5 },
      },
    ]);
  });
});

describe("assumptionsFor", () => {
  it("returns evidence, effective current config values, and call basis counts", async () => {
    const { store } = fakeStore();
    const result = await assumptionsFor({ store, evals: { outcomeEvidence: async () => ({ cases: [], basis: "5 past cases", recognised: 0, probed: 0 }) } }, swarm.id);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.find((row) => row.id === "founder.built_hard_things")?.current).toBe("4");
    // The basis says how many statements were tested at once, so nobody reads one verdict alone.
    expect(result.outcomesBasis).toBe("5 past cases With about thirty statements tested at once, expect one or two to look settled by chance.");
    expect(result.callsBasis).toBe("1 call on founders and 1 on companies.");
  });

  it.each([
    ["rejects a failed evidence read", async () => { throw new Error("offline"); }],
    ["works without the optional evidence method", undefined],
  ])("%s and still returns rows", async (_label, outcomeEvidence) => {
    const { store } = fakeStore();
    const result = await assumptionsFor({ store, evals: { outcomeEvidence } }, swarm.id);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.outcomesBasis).toBeNull();
  });

  it("returns null call basis when there are no called assessments and 404 for an unknown swarm", async () => {
    const { store } = fakeStore({ calls: [], companyCalls: [] });
    expect((await assumptionsFor({ store, evals: {} }, swarm.id)).callsBasis).toBeNull();
    await expect(assumptionsFor({ store, evals: {} }, "missing")).rejects.toBeInstanceOf(ServiceError);
  });
});
