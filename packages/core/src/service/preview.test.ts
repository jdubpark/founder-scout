import { describe, expect, it } from "vitest";
import { COMPANY_DIMENSIONS, DIMENSIONS, type Assessment, type Company, type CompanyAssessment, type CompanyJudgment, type Directive, type Founder, type Judgment, type Swarm, type SwarmConfig } from "@agentswarm/shared";
import { previewConfig } from "./preview";
import type { PreviewDeps } from "./preview";

const swarm: Swarm = {
  id: "swarm-1", name: "Swarm", status: "active", thesis: { summary: "", sectors: [], stages: [], geos: [], avoid: [] },
  configId: "cfg-current", createdAt: "", updatedAt: "",
};
const noAgents = [] as const;

const founder = (id: string, companyId: string | null = null): Founder => ({
  id, swarmId: swarm.id, name: id, headline: null, location: null,
  company: { name: null, url: null, oneLiner: null, stage: null }, companyId,
  links: { github: null, linkedin: null, x: null, site: null, scholar: null }, status: "surfaced", fit: 0.9,
  fitReasons: [], tags: [], identityConfidence: null, sources: [], firstSeenAt: `2026-01-0${id.length}T00:00:00.000Z`,
  updatedAt: "", lastAssessedAt: null, nextRecheckAt: null, simId: null,
});

const company = (id: string): Company => ({
  id, swarmId: swarm.id, name: id, domain: null, url: null, oneLiner: null, mission: null, sector: null, stage: null,
  links: { github: null, x: null, linkedin: null, docs: null, careers: null }, status: "tracked",
  firstSeenAt: "", updatedAt: "", lastResearchedAt: null, lastAssessedAt: null, nextRecheckAt: null, simId: null,
});

function founderAssessment(id: string, answers: Array<{ dimension: string; level: 0 | 1 | 2 | 3 | 4 | null }>): Assessment {
  return {
    id: `assessment-${id}`, founderId: id, runId: null, configId: "cfg-current", composite: 0.5, cracked: 0.5, founderScore: 0.5,
    coverage: 1, potential: 0.5, fit: 0.9, decision: "watch", reasons: [], flags: [], breakdown: [],
    judgments: answers.map(({ dimension, level }) => ({ dimension, level, confidence: 1, rationale: "", evidenceIds: [], counterEvidenceIds: [] } as Judgment)),
    summary: "", memo: null, createdAt: "",
  };
}

function companyAssessment(id: string, level: 1 | 2 | 3 | 4 = 1): CompanyAssessment {
  const judgment: CompanyJudgment = { dimension: "mission", level, confidence: 1, rationale: "", evidenceIds: [], counterEvidenceIds: [] };
  return {
    id: `assessment-${id}`, companyId: id, runId: null, configId: "cfg-current", company: 0.25, companyCoverage: 1,
    companyPotential: 0.25, leadFounderId: null, team: null, deal: 0.25, coverage: 1, potential: 0.25,
    decision: "watch", reasons: [], flags: [], breakdown: [], judgments: [judgment],
    brief: { summary: "", strengths: [], risks: [], openQuestions: [] }, createdAt: "",
  };
}

function config(id: string, params: Record<string, number> = {}): SwarmConfig {
  return { id, label: id, params, routes: {}, promptVariants: {} };
}

function founderWeights(built: number, insight: number): Record<string, number> {
  return Object.fromEntries(DIMENSIONS.map(({ id }) => [`weights.${id}`, id === "built_hard_things" ? built : id === "insight" ? insight : 0]));
}

function companyWeights(): Record<string, number> {
  return Object.fromEntries(COMPANY_DIMENSIONS.map(({ id }) => [`cweights.${id}`, id === "mission" ? 1 : 0]));
}

function fakeDeps(options: {
  founders?: Founder[];
  companies?: Company[];
  assessments?: Map<string, Assessment>;
  companyAssessments?: Map<string, CompanyAssessment>;
  current?: SwarmConfig;
  directives?: Directive[];
} = {}): PreviewDeps {
  const founders = options.founders ?? [];
  const companies = options.companies ?? [];
  const assessments = options.assessments ?? new Map();
  const companyAssessments = options.companyAssessments ?? new Map();
  const store = {
    getSwarm: (id: string) => id === swarm.id ? swarm : null,
    getConfig: () => options.current ?? config("cfg-current"),
    listAgents: () => noAgents,
    listDirectives: () => options.directives ?? [],
    listFounders: () => founders,
    latestAssessment: (id: string) => assessments.get(id) ?? null,
    listCompanies: () => companies,
    latestCompanyAssessment: (id: string) => companyAssessments.get(id) ?? null,
  };
  return { store: store as unknown as PreviewDeps["store"], now: () => new Date("2026-01-01T00:00:00.000Z") };
}

describe("previewConfig", () => {
  it("reports only a founder whose candidate weight change crosses the bar, with scores from the stored answers", () => {
    const first = founder("f-flip");
    const steady = founder("f-steady");
    const current = config("cfg-current", { ...founderWeights(1, 0), "assess.surface_threshold": 0.6, "assess.watch_threshold": 0.4, "assess.min_coverage": 0 });
    const candidate = config("cfg-next", { ...founderWeights(0, 1), "assess.surface_threshold": 0.6, "assess.watch_threshold": 0.4, "assess.min_coverage": 0 });
    const result = previewConfig(fakeDeps({
      founders: [first, steady], current,
      assessments: new Map([
        [first.id, founderAssessment(first.id, [{ dimension: "built_hard_things", level: 4 }, { dimension: "insight", level: 0 }])],
        [steady.id, founderAssessment(steady.id, [{ dimension: "built_hard_things", level: 2 }, { dimension: "insight", level: 2 }])],
      ]),
    }), swarm.id, candidate);

    expect(result.founders).toEqual([{ id: first.id, name: first.name, from: "surface", to: "pass", scoreFrom: 1, scoreTo: 0 }]);
    expect(result.companies).toEqual([]);
    expect(result.considered).toEqual({ founders: 2, companies: 0 });
  });

  it("reports a company share flip while the founder decision stays the same", () => {
    const lead = founder("f-company", "c-company");
    const startup = company("c-company");
    const baseParams = { ...founderWeights(1, 0), ...companyWeights(), "assess.surface_threshold": 0.6, "assess.watch_threshold": 0.4, "assess.min_coverage": 0 };
    const current = config("cfg-current", { ...baseParams, "deal.team_share": 0.25 });
    const candidate = config("cfg-next", { ...baseParams, "deal.team_share": 0.5 });
    const result = previewConfig(fakeDeps({
      founders: [lead], companies: [startup], current,
      assessments: new Map([[lead.id, founderAssessment(lead.id, [{ dimension: "built_hard_things", level: 4 }])]]),
      companyAssessments: new Map([[startup.id, companyAssessment(startup.id, 1)]]),
    }), swarm.id, candidate);

    expect(result.founders).toEqual([]);
    expect(result.companies).toEqual([{ id: startup.id, name: startup.name, from: "watch", to: "surface", scoreFrom: 0.438, scoreTo: 0.625 }]);
    expect(result.considered).toEqual({ founders: 1, companies: 1 });
  });

  it("returns no flips for an identical config", () => {
    const person = founder("f-one");
    const same = config("cfg-current", { ...founderWeights(1, 0) });
    const result = previewConfig(fakeDeps({
      founders: [person], current: same,
      assessments: new Map([[person.id, founderAssessment(person.id, [{ dimension: "built_hard_things", level: 3 }])]]),
    }), swarm.id, { ...same, id: "cfg-next" });
    expect(result.founders).toEqual([]);
    expect(result.companies).toEqual([]);
    expect(result.unseen).toEqual([]);
  });

  it("reports analyst guidance as unseen without claiming a score change", () => {
    const person = founder("f-one");
    const current = config("cfg-current", { ...founderWeights(1, 0) });
    const candidate = { ...current, id: "cfg-next", lessons: { "assess.judgments": ["Prefer directly shipped work."] } };
    const result = previewConfig(fakeDeps({
      founders: [person], current,
      assessments: new Map([[person.id, founderAssessment(person.id, [{ dimension: "built_hard_things", level: 3 }])]]),
    }), swarm.id, candidate);
    expect(result.founders).toEqual([]);
    expect(result.unseen).toEqual(["New guidance for an analyst takes effect when founders or companies are assessed again."]);
  });

  it("uses the same steering bar for the current and candidate score", () => {
    const person = founder("f-one");
    const current = config("cfg-current", { ...founderWeights(1, 0), "assess.surface_threshold": 0.6, "assess.watch_threshold": 0.4, "assess.min_coverage": 0 });
    const candidate = config("cfg-next", { ...founderWeights(1, 0), "assess.surface_threshold": 0.8, "assess.watch_threshold": 0.4, "assess.min_coverage": 0 });
    const directive: Directive = {
      id: "bar", scope: { swarmId: swarm.id }, kind: "param", key: "assess.surface_threshold", value: 0.9, text: null,
      priority: 0, status: "active", author: "partner", note: null, createdAt: "", updatedAt: "", expiresAt: null,
    };
    const result = previewConfig(fakeDeps({
      founders: [person], current, directives: [directive],
      assessments: new Map([[person.id, founderAssessment(person.id, [{ dimension: "built_hard_things", level: 3 }])]]),
    }), swarm.id, candidate);
    expect(result.founders).toEqual([]);
    expect(result.considered.founders).toBe(1);
  });
});
