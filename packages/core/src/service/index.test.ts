import { afterEach, describe, expect, it } from "vitest";
import {
  BASE_CONFIG, DEFAULT_SETTINGS, JOBS, PROVIDERS, ZERO_STATS, newId, stableId,
  type Agent, type Assessment, type Company, type CompanyAssessment, type CompanyMember, type EvalFlowDTO,
  type Evidence, type Feedback, type Founder, type NetworkContact, type OutreachAction, type Run,
  type Swarm, type SwarmConfig, type TaskRun,
} from "@agentswarm/shared";
import type { EvalService, ProviderRegistry, RunController, SourceRegistry, Store } from "../contracts";
import { openStore } from "../db";
import { ServiceError } from "../contracts";
import { createApp, createSwarmService } from "./index";

const fixedAt = new Date("2026-11-12T18:00:00.000Z");
const stamp = fixedAt.toISOString();
const cron = { isValid: (value: string) => value === "0 6 * * *", next: () => "2026-11-13T06:00:00.000Z" };

function harness() {
  const store = openStore(":memory:");
  const refused = new Set<string>();
  let sourceConfigured = true;
  const providers: ProviderRegistry = { get: () => { throw new Error("unused"); }, statuses: async () => PROVIDERS.map((item) => ({ id: item.id, label: item.label, configured: true, detail: "ready" })) };
  const liveSources: SourceRegistry = { get: () => null, statuses: async () => [
    { id: "hackernews", label: "Hacker News", configured: sourceConfigured, detail: sourceConfigured ? "ready" : "missing credentials" },
    { id: "github", label: "GitHub", configured: sourceConfigured, detail: sourceConfigured ? "ready" : "missing credentials" },
    { id: "arxiv", label: "arXiv", configured: sourceConfigured, detail: sourceConfigured ? "ready" : "missing credentials" },
    { id: "people_data", label: "Professional profiles", configured: sourceConfigured, detail: sourceConfigured ? "ready" : "missing credentials" },
  ] };
  const runs: RunController = {
    async start(input) {
      if (refused.has(input.swarmId)) throw new Error("Already running");
      const run: Run = { id: newId("run"), swarmId: input.swarmId, trigger: input.trigger, brain: input.brain ?? "sim", sources: input.sources ?? "sim", status: "queued", stage: null, configId: store.getSwarm(input.swarmId)?.configId ?? BASE_CONFIG.id, budgetUsd: input.budgetUsd ?? 25, costUsd: 0, stats: { ...ZERO_STATS }, error: null, simDay: null, startedAt: stamp, finishedAt: null };
      store.insertRun(run);
      return run;
    },
    async cancel(id) { return store.updateRun(id, { status: "cancelled" }); },
    async wait(id) { return store.getRun(id)!; },
    async recover() { return 0; },
  };
  let evalFlow: EvalFlowDTO | null = null;
  let promotedConfig: SwarmConfig = { ...BASE_CONFIG, id: "cfg_variant", label: "Variant" };
  const evals: EvalService = {
    listFlows: async () => evalFlow ? [{ id: evalFlow.id, label: evalFlow.label, description: evalFlow.description, headlineMetric: evalFlow.headlineMetric, baseline: evalFlow.baseline, best: evalFlow.best, rounds: evalFlow.rounds, updatedAt: evalFlow.updatedAt }] : [],
    getFlow: async () => { if (!evalFlow) throw new Error("No flow"); return evalFlow; },
    runRounds: async () => { if (!evalFlow) throw new Error("No flow"); return evalFlow; },
    variantConfig: async () => promotedConfig,
  };
  const service = createSwarmService({ store, runs, evals, providers, liveSources, cron, now: () => fixedAt });
  return { store, service, refused, setFlow: (flow: EvalFlowDTO) => { evalFlow = flow; }, setVariant: (config: SwarmConfig) => { promotedConfig = config; }, setSourceConfigured: (configured: boolean) => { sourceConfigured = configured; } };
}

const thesis = { summary: "AI tools", sectors: [" AI ", "AI", "Tools"], stages: ["Pre-seed"], geos: [], avoid: [] };
const founderRecord = (swarmId: string, id = newId("fnd"), status: Founder["status"] = "surfaced"): Founder => ({
  id, swarmId, name: "Ari Founder", headline: "Builds AI systems", location: null,
  company: { name: "Vector Works", url: null, oneLiner: "a vector index for robot logs", stage: "Pre-seed" },
  links: { github: null, linkedin: null, x: null, site: null, scholar: null }, status, fit: 0.8, fitReasons: [], tags: [], identityConfidence: 1, sources: ["github"], firstSeenAt: stamp, updatedAt: stamp, lastAssessedAt: null, nextRecheckAt: null, simId: null,
});
function assessment(founderId: string, decision: Assessment["decision"] = "surface"): Assessment {
  return { id: newId("asm"), founderId, runId: null, configId: BASE_CONFIG.id, composite: 0.8, cracked: 0.75, founderScore: 0.8, coverage: 0.9, potential: 0.8, fit: 0.8, decision, reasons: [], flags: [], breakdown: [], judgments: [], summary: "Strong technical founder", memo: null, createdAt: stamp };
}
function runRecord(swarmId: string, overrides: Partial<Run> = {}): Run {
  return { id: newId("run"), swarmId, trigger: "manual", brain: "sim", sources: "sim", status: "running", stage: "scout", configId: BASE_CONFIG.id, budgetUsd: 25, costUsd: 0.2, stats: { ...ZERO_STATS }, error: null, simDay: null, startedAt: stamp, finishedAt: null, ...overrides };
}
function taskRecord(run: Run, agent: Agent, status: TaskRun["status"], stage: TaskRun["stage"] = "scout"): TaskRun {
  return { id: newId("tsk"), runId: run.id, swarmId: run.swarmId, agentId: agent.id, jobId: agent.jobId, classId: agent.classId, stage, founderId: null, status, skipReason: null, attempt: 1, provider: "sim", model: "sim", effort: null, inputSummary: "input", outputSummary: status === "succeeded" ? "found a lead" : null, output: null, steering: { directiveIds: [], params: {}, block: "" }, usage: null, costUsd: status === "failed" ? 0.1 : 0.05, latencyMs: 1, itemsOut: status === "succeeded" ? 1 : 0, error: status === "failed" ? "provider error" : null, startedAt: stamp, finishedAt: stamp };
}
function companyRecord(swarmId: string, id = newId("cmp"), status: Company["status"] = "tracked", name = "Vector Works"): Company {
  return { id, swarmId, name, domain: "vector.example", url: "https://vector.example", oneLiner: "A vector index", mission: null, sector: "AI infrastructure", stage: "Pre-seed", links: { github: null, x: null, linkedin: null, docs: null, careers: null }, status, firstSeenAt: stamp, updatedAt: stamp, lastResearchedAt: null, lastAssessedAt: null, nextRecheckAt: null, simId: null };
}
function companyAssessment(companyId: string, leadFounderId: string | null, deal: number, decision: CompanyAssessment["decision"] = "surface"): CompanyAssessment {
  return { id: newId("cas"), companyId, runId: null, configId: BASE_CONFIG.id, company: deal, companyCoverage: 0.8, companyPotential: deal, leadFounderId, team: 0.7, deal, coverage: 0.8, potential: deal, decision, reasons: [], flags: [], breakdown: [], judgments: [], brief: { summary: "A promising company", strengths: [], risks: [], openQuestions: [] }, createdAt: stamp };
}
function companyMember(companyId: string, name: string): CompanyMember {
  return { id: newId("mem"), companyId, name, role: "Founder", isFounder: true, founderId: null, links: { github: null, linkedin: null, x: null, site: null, scholar: null }, background: null, source: "web", sourceUrl: "https://vector.example/team", addedAt: stamp };
}
function companyEvidence(founderId: string, companyId: string, id: string, capturedAt: string): Evidence {
  return { id, founderId, companyId, facet: "product", kind: "launch", source: "web", url: "https://vector.example", title: id, excerpt: "A product launch", claim: "The company launched a product.", publishedAt: null, capturedAt, collectedByTaskId: null, hash: id, verification: "supported", verificationNote: null, sim: null };
}
function contactCsv(rows: string[][]): string {
  return ["First Name,Last Name,URL,Company,Position,Connected On", ...rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))].join("\n");
}
function expectServiceError(promise: Promise<unknown>, status: number, field?: string) {
  return promise.then(() => { throw new Error("Expected ServiceError"); }, (error: unknown) => {
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(status);
    if (field) expect((error as ServiceError).fields).toHaveProperty(field);
  });
}

const opened: ReturnType<typeof harness>[] = [];
function createHarness() { const item = harness(); opened.push(item); return item; }
afterEach(() => { for (const item of opened.splice(0)) item.service.close(); });

describe("createSwarmService", () => {
  it("assembles the app from its options and closes the shared store", async () => {
    const app = createApp({ dbPath: ":memory:", dataDir: ".", flowsDir: ".", cron });
    await app.service.ensureSeeded();
    expect(app.store.listSwarms()).toHaveLength(1);
    expect(app.providers).toBeDefined();
    app.close();
  });

  it("seeds a complete swarm, two global rules and one swarm preference, once", async () => {
    const { service, store } = createHarness();
    await service.ensureSeeded();
    const [swarm] = store.listSwarms();
    expect(swarm?.name).toBe("AI infrastructure, pre-seed");
    expect(store.listAgents(swarm!.id)).toHaveLength(JOBS.length);
    expect(store.listAgents(swarm!.id).map((agent) => agent.jobId)).toEqual(JOBS.map((job) => job.id));
    const seeded = store.listDirectives();
    expect(seeded.every((directive) => directive.author === "System")).toBe(true);
    const rules = seeded.filter((directive) => directive.kind === "rule");
    expect(rules).toHaveLength(2);
    expect(rules.every((directive) => Object.keys(directive.scope).length === 0)).toBe(true);
    const preferences = seeded.filter((directive) => directive.kind === "opinion");
    expect(preferences).toHaveLength(1);
    expect(preferences[0]?.scope).toEqual({ swarmId: swarm!.id });
    await service.ensureSeeded();
    expect(store.listSwarms()).toHaveLength(1);
    expect(store.listDirectives()).toHaveLength(3);
  });

  it("validates directive scope, effect, value and text, then stores and audits a valid directive", async () => {
    const { service, store } = createHarness();
    const api = service.as("  Jamie Partner  ");
    const swarm = await api.createSwarm({ name: "AI infra", thesis });
    await expectServiceError(api.createDirective({ scope: { swarmId: "missing" }, kind: "rule", text: "Check it" }), 404, "scope.swarmId");
    await expectServiceError(api.createDirective({ scope: { classId: "scout" }, kind: "param", key: "screen.min_fit", value: 0.7 }), 400, "key");
    await expectServiceError(api.createDirective({ scope: { swarmId: swarm.id }, kind: "param", key: "screen.min_fit", value: 2 }), 400, "value");
    await expectServiceError(api.createDirective({ scope: {}, kind: "rule", text: "   " }), 400, "text");
    const directive = await api.createDirective({ scope: { swarmId: swarm.id }, kind: "param", key: "screen.min_fit", value: 0.7 });
    expect(directive.author).toBe("Jamie Partner");
    expect(store.getDirective(directive.id)?.value).toBe(0.7);
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Jamie Partner", action: "directive.create", target: directive.id });
  });

  it("merges schedule settings, trims inputs and validates the cron and operator name", async () => {
    const { service } = createHarness(); const api = service.as("Partner");
    const updated = await api.updateSettings({ operatorName: "  Alex  ", schedule: { enabled: true, cron: " 0 6 * * * " } });
    expect(updated.settings.operatorName).toBe("Alex");
    expect(updated.settings.schedule).toEqual({ ...DEFAULT_SETTINGS.schedule, enabled: true, cron: "0 6 * * *" });
    expect(updated.nextRunAt).toBe("2026-11-13T06:00:00.000Z");
    await expectServiceError(api.updateSettings({ schedule: { cron: "invalid" } }), 400, "schedule.cron");
    await expectServiceError(api.updateSettings({ operatorName: "x".repeat(61) }), 400, "operatorName");
  });

  it("builds node health, planned jobs, aggregate figures and scoped directive counts", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Tree", thesis });
    const agents = store.listAgents(swarm.id);
    const byJob = (jobId: Agent["jobId"]) => agents.find((agent) => agent.jobId === jobId)!;
    const paused = byJob("scout.hackernews");
    await api.updateAgent(paused.id, { status: "paused" });
    const idleAgent = await api.addAgent(swarm.id, { jobId: "scout.hackernews" });
    const run = runRecord(swarm.id, { status: "succeeded", stage: null }); store.insertRun(run);
    store.insertTask(taskRecord(run, byJob("scout.github"), "succeeded"));
    store.insertTask(taskRecord(run, byJob("scout.research"), "succeeded"));
    store.insertTask(taskRecord(run, byJob("scout.research"), "succeeded"));
    store.insertTask(taskRecord(run, byJob("scout.research"), "failed"));
    store.insertTask(taskRecord(run, byJob("scout.talent"), "failed"));
    store.insertTask(taskRecord(run, byJob("scout.talent"), "failed"));
    store.insertTask(taskRecord(run, byJob("scout.talent"), "succeeded"));
    const cls = await api.createDirective({ scope: { swarmId: swarm.id, classId: "scout" }, kind: "rule", text: "Class rule" });
    const job = await api.createDirective({ scope: { jobId: "scout.github" }, kind: "rule", text: "Job rule" });
    const agent = await api.createDirective({ scope: { agentId: idleAgent.id }, kind: "rule", text: "Agent rule" });
    await api.createDirective({ scope: {}, kind: "rule", text: "Global rule" });
    await api.createDirective({ scope: { swarmId: swarm.id }, kind: "rule", text: "Swarm rule" });
    const tree = await api.getTree(swarm.id);
    const scout = tree.classes.find((node) => node.cls.id === "scout")!;
    const node = (jobId: string) => scout.jobs.find((item) => item.job.id === jobId)!;
    expect(node("scout.hackernews").health).toBe("idle");
    expect(node("scout.hackernews").agents.find((item) => item.agent.id === paused.id)?.health).toBe("paused");
    expect(node("scout.github").health).toBe("ok");
    expect(node("scout.research").health).toBe("warn");
    expect(node("scout.talent").health).toBe("error");
    expect(tree.classes.find((item) => item.cls.id === "outreach")?.jobs.find((item) => item.job.id === "call.founder")?.health).toBe("planned");
    expect(scout.directiveCount).toBe(1);
    expect(node("scout.github").directiveCount).toBe(1);
    expect(node("scout.hackernews").agents.find((item) => item.agent.id === idleAgent.id)?.directiveCount).toBe(1);
    expect(tree.swarmDirectiveCount).toBe(1);
    expect(tree.globalDirectiveCount).toBe(1);
    expect([cls.id, job.id, agent.id]).toHaveLength(3);
  });

  it("resolves narrow parameters and broad-to-narrow guidance and only shows calls to supported classes", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Steering", thesis });
    const scout = store.listAgents(swarm.id).find((agent) => agent.jobId === "scout.github")!;
    await api.createDirective({ scope: {}, kind: "rule", text: "Global guidance" });
    await api.createDirective({ scope: { classId: "scout" }, kind: "rule", text: "Scout guidance" });
    await api.createDirective({ scope: { jobId: "scout.github" }, kind: "rule", text: "GitHub guidance" });
    await api.createDirective({ scope: { agentId: scout.id }, kind: "rule", text: "Agent guidance" });
    await api.createDirective({ scope: { classId: "investigator" }, kind: "param", key: "investigate.depth", value: "quick" });
    await api.createDirective({ scope: { jobId: "investigate.code" }, kind: "param", key: "investigate.depth", value: "standard" });
    await api.createDirective({ scope: { agentId: store.listAgents(swarm.id).find((agent) => agent.jobId === "investigate.code")!.id }, kind: "param", key: "investigate.depth", value: "deep" });
    const founder = founderRecord(swarm.id); store.insertFounder(founder);
    store.insertFeedback({ id: newId("fbk"), founderId: founder.id, author: "Partner", verdict: "yes", reasonTags: ["builder"], note: null, createdAt: stamp });
    const result = await api.getEffectiveSteering({ swarmId: swarm.id, agentId: scout.id });
    expect(result.guidance.map((line) => line.text)).toEqual(["Global guidance", "Scout guidance", "GitHub guidance", "Agent guidance"]);
    expect(result.callsBlock).toContain("YES: Vector Works: a vector index for robot logs");
    const investigator = store.listAgents(swarm.id).find((agent) => agent.jobId === "investigate.code")!;
    const detail = await api.getEffectiveSteering({ swarmId: swarm.id, agentId: investigator.id });
    expect(detail.params.find((param) => param.key === "investigate.depth")?.value).toBe("deep");
    expect(detail.callsBlock).toBe("");
  });

  it("records partner calls, filters reason tags, and moves founders according to the latest verdict", async () => {
    const { service, store } = createHarness();
    const swarm = await service.as("Partner").createSwarm({ name: "Calls", thesis });
    const founder = founderRecord(swarm.id, newId("fnd"), "watch"); store.insertFounder(founder);
    const api = service.as("Decision Maker");
    await expectServiceError(api.addFeedback(founder.id, { verdict: "no" }), 400, "reasonTags");
    const no = await api.addFeedback(founder.id, { verdict: "no", reasonTags: ["builder", "outside_thesis"] });
    expect(no.reasonTags).toEqual(["outside_thesis"]);
    expect(store.getFounder(founder.id)?.status).toBe("passed");
    await api.addFeedback(founder.id, { verdict: "yes", reasonTags: ["builder"] });
    expect(store.getFounder(founder.id)?.status).toBe("surfaced");
    expect(Date.parse(store.listFeedback(founder.id)[1]?.createdAt ?? "")).toBeGreaterThan(Date.parse(store.listFeedback(founder.id)[0]?.createdAt ?? ""));
    const scout = store.listAgents(swarm.id).find((agent) => agent.jobId === "scout.github")!;
    expect((await api.getEffectiveSteering({ swarmId: swarm.id, agentId: scout.id })).callsBlock).toContain("YES: Vector Works");
    expect(store.recentAudit(1)[0]?.actor).toBe("Decision Maker");
  });

  it("offers repeated-call suggestions, applies accepted steering, and remembers dismissals", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Suggestions", thesis });
    const founders = Array.from({ length: 3 }, () => founderRecord(swarm.id));
    for (const founder of founders) {
      store.insertFounder(founder);
      store.insertFeedback({ id: newId("fbk"), founderId: founder.id, author: "Partner", verdict: "no", reasonTags: ["outside_thesis"], note: null, createdAt: stamp });
    }
    const suggestions = await api.listSuggestions(swarm.id);
    const suggestion = suggestions.find((item) => item.key === "screen.min_fit=0.65")!;
    expect(suggestion.support).toBe(3);
    await api.createDirective(suggestion.directive);
    expect((await api.getEffectiveSteering({ swarmId: swarm.id })).params.find((item) => item.key === "screen.min_fit")?.value).toBe(0.65);
    const remaining = await api.listSuggestions(swarm.id);
    expect(remaining.some((item) => item.key === "screen.min_fit=0.65")).toBe(false);
    const key = remaining[0]?.key ?? "text:skip_priced_rounds";
    const afterDismiss = await api.dismissSuggestion(swarm.id, key);
    expect(afterDismiss.some((item) => item.key === key)).toBe(false);
  });

  it("protects the disclosure during approval and links transcript evidence on completion", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Outreach", thesis });
    const founder = founderRecord(swarm.id); store.insertFounder(founder);
    const action: OutreachAction = { id: newId("out"), swarmId: swarm.id, founderId: founder.id, kind: "email_founder", target: { name: founder.name, role: null, relationship: null, channelHint: null }, rationale: "Founder is in thesis", draft: { subject: "Hello", body: "Draft", agenda: [], questions: [], disclosure: "I am an AI assistant calling for the fund." }, consentBasis: "Founder requested contact", status: "proposed", decidedBy: null, decidedAt: null, decisionNote: null, resultSummary: null, transcriptEvidenceId: null, createdByTaskId: null, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" };
    store.insertOutreach(action);
    const approved = await api.decideOutreach(action.id, { decision: "approve", draft: { ...action.draft, body: "Edited", disclosure: "Removed" } });
    expect(approved.status).toBe("approved");
    expect(approved.draft.body).toBe("Edited");
    expect(approved.draft.disclosure).toBe(action.draft.disclosure);
    await expectServiceError(api.decideOutreach(action.id, { decision: "approve" }), 409);
    const completed = await api.completeOutreach(action.id, { summary: "Intro call complete", transcript: "Founder described the prototype." });
    expect(completed.status).toBe("completed");
    const evidence = store.listEvidence(founder.id)[0];
    // The action here is an email, so the stored notes must not be called a call transcript.
    expect(evidence).toMatchObject({ kind: "call_transcript", source: "call", verification: "unverified", title: `Conversation with ${founder.name}`, claim: "Notes a partner wrote after this conversation.", excerpt: "Founder described the prototype." });
    expect(completed.transcriptEvidenceId).toBe(evidence?.id);
  });

  it("keeps personal attributes out of what a person types in", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Privacy", thesis });
    const founder = founderRecord(swarm.id); store.insertFounder(founder);

    // Steering on a personal attribute is refused outright.
    await expectServiceError(api.createDirective({ scope: { swarmId: swarm.id }, kind: "opinion", text: "Prefer a founder who is 25 years old." }), 400, "text");
    const ok = await api.createDirective({ scope: { swarmId: swarm.id }, kind: "opinion", text: "Prefer founders who shipped something in the last year." });
    await expectServiceError(api.updateDirective(ok.id, { text: "Skip anyone who is married." }), 400, "text");

    // The same goes for the other places a person tells the swarm what to look for.
    await expectServiceError(api.createSwarm({ name: "Young founders", thesis: { ...thesis, summary: "Back a founder who is 22 years old." } }), 400, "thesis");
    await expectServiceError(api.updateSwarm(swarm.id, { thesis: { ...thesis, avoid: ["anyone who is married"] } }), 400, "thesis");
    await expectServiceError(api.addAgent(swarm.id, { jobId: "scout.github", beat: "Projects by someone who is 19 years old" }), 400, "beat");
    const scout = await api.addAgent(swarm.id, { jobId: "scout.github", beat: "Databases" });
    await expectServiceError(api.updateAgent(scout.id, { beat: "Founders whose religion: unknown" }), 400, "beat");
    // A note on a directive is a comment, not an instruction: the personal sentence is removed.
    const noted = await api.createDirective({ scope: { swarmId: swarm.id }, kind: "context", text: "We know this team.", note: "Met at a dinner. His wife was there." });
    expect(noted.note).toBe("Met at a dinner. [removed: personal detail]");

    // A call note is stored without the personal sentence.
    const call = await api.addFeedback(founder.id, { verdict: "yes", reasonTags: ["builder"], note: "Wrote the storage engine alone. He is 42 years old." });
    expect(call.note).toBe("Wrote the storage engine alone. [removed: personal detail]");

    // So are pasted conversation notes, before they become evidence.
    const action: OutreachAction = { id: newId("out"), swarmId: swarm.id, founderId: founder.id, kind: "call_founder", target: { name: founder.name, role: null, relationship: null, channelHint: null }, rationale: "Partner said yes", draft: { subject: null, body: null, agenda: [], questions: [], disclosure: "I am an AI assistant calling for the fund." }, consentBasis: "Founder agreed to a call", status: "approved", decidedBy: "Partner", decidedAt: stamp, decisionNote: null, resultSummary: null, transcriptEvidenceId: null, createdByTaskId: null, createdAt: stamp, updatedAt: stamp };
    store.insertOutreach(action);
    // Edits to a draft and the note on a decision pass the same boundary. The disclosure is untouched.
    const emailAction: OutreachAction = { ...action, id: newId("out"), kind: "email_founder", status: "proposed", decidedBy: null, decidedAt: null, draft: { subject: "Hello", body: "Draft", agenda: [], questions: [], disclosure: "Written by code." } };
    store.insertOutreach(emailAction);
    const edited = await api.decideOutreach(emailAction.id, { decision: "approve", note: "Fine. He is 42 years old.", draft: { ...emailAction.draft, body: "I liked the merge path. I hear you are married now." } });
    expect(edited.draft.body).toBe("I liked the merge path. [removed: personal detail]");
    expect(edited.draft.disclosure).toBe("Written by code.");
    expect(edited.decisionNote).toBe("Fine. [removed: personal detail]");

    const done = await api.completeOutreach(action.id, { summary: "Good call. His wife joined for a minute.", transcript: "Founder: I rebuilt the index three times.\nFounder: I was born in 1984 and started coding early." });
    expect(done.resultSummary).toBe("Good call. [removed: personal detail]");
    const transcript = store.listEvidence(founder.id).find((item) => item.kind === "call_transcript");
    expect(transcript?.excerpt).toBe("Founder: I rebuilt the index three times.\n[removed: personal detail]");
  });

  it("reports stage progress for active and finished runs", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Runs", thesis });
    const agent = store.listAgents(swarm.id).find((item) => item.jobId === "scout.hackernews")!;
    const running = runRecord(swarm.id, { stage: "investigate" }); store.insertRun(running);
    store.insertTask(taskRecord(running, agent, "succeeded", "scout"));
    const detail = await api.getRun(running.id);
    expect(detail.stages.find((stage) => stage.stage === "plan")?.state).toBe("done");
    expect(detail.stages.find((stage) => stage.stage === "scout")?.state).toBe("done");
    expect(detail.stages.find((stage) => stage.stage === "investigate")?.state).toBe("running");
    expect(detail.stages.find((stage) => stage.stage === "verify")?.state).toBe("pending");
    const finished = runRecord(swarm.id, { status: "succeeded", stage: null, finishedAt: stamp }); store.insertRun(finished);
    store.insertTask(taskRecord(finished, agent, "succeeded", "scout"));
    const done = await api.getRun(finished.id);
    expect(done.stages.find((stage) => stage.stage === "scout")?.state).toBe("done");
    expect(done.stages.find((stage) => stage.stage === "investigate")?.state).toBe("skipped");
    expect(done.stages.find((stage) => stage.stage === "digest")?.state).toBe("done");
  });

  it("groups overview runs by UTC day and summarizes only each founder's latest call", async () => {
    const { service, store } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Overview", thesis });
    const first = runRecord(swarm.id, { status: "succeeded", stage: null, startedAt: "2026-11-11T23:55:00.000Z", finishedAt: "2026-11-11T23:56:00.000Z", stats: { ...ZERO_STATS, leads: 2, surfaced: 1 }, costUsd: 1 });
    const second = runRecord(swarm.id, { status: "succeeded", stage: null, startedAt: "2026-11-12T00:05:00.000Z", finishedAt: "2026-11-12T00:06:00.000Z", stats: { ...ZERO_STATS, leads: 3, surfaced: 2 }, costUsd: 2 });
    store.insertRun(first); store.insertRun(second);
    const founder = founderRecord(swarm.id); store.insertFounder(founder); store.insertAssessment(assessment(founder.id));
    store.insertFeedback({ id: newId("fbk"), founderId: founder.id, author: "Partner", verdict: "yes", reasonTags: ["builder"], note: null, createdAt: "2026-11-11T00:00:00.000Z" });
    store.insertFeedback({ id: newId("fbk"), founderId: founder.id, author: "Partner", verdict: "no", reasonTags: ["outside_thesis"], note: null, createdAt: "2026-11-12T00:00:00.000Z" });
    const overview = await api.getOverview(swarm.id);
    expect(overview.funnel.map((day) => [day.date, day.leads, day.surfaced, day.costUsd])).toEqual([["2026-11-11", 2, 1, 1], ["2026-11-12", 3, 2, 2]]);
    expect(overview.calls.yes).toBe(0);
    expect(overview.calls.no).toBe(1);
    expect(overview.calls.waiting).toBe(0);
    expect(overview.totals).toMatchObject({ leads: 5, surfaced: 3, founders: 1 });
  });

  it("promotes a variant and identifies it as the config in use", async () => {
    const { service, store, setFlow, setVariant } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Eval", thesis });
    const variant: SwarmConfig = { ...BASE_CONFIG, id: "cfg_v1", label: "Improved", params: { "screen.min_fit": 0.7 } };
    setVariant(variant);
    const flow = { id: "ranking", label: "Ranking", description: "test", headlineMetric: "ndcg5", baseline: 0.5, best: 0.6, rounds: 1, updatedAt: stamp, metrics: [], goal: { target: "ndcg5", direction: "higher", hold: [] }, cases: { train: 2, test: 2, reps: 1 }, noiseFloor: null, dataNote: "sim", variants: [{ id: "v1", round: 1, description: "raise bar", rationale: "calls", status: "kept", train: {}, test: { ndcg5: 0.6 }, testInterval: null, costUsd: 1, config: variant, changes: [], createdAt: stamp }], bestVariant: "v1", promotedVariant: null, narrative: "Improved." } satisfies EvalFlowDTO;
    setFlow(flow);
    const config = await api.promoteEvalVariant("ranking", { variant: "v1", swarmId: swarm.id });
    expect(config.id).toBe("cfg_v1");
    expect(store.getSwarm(swarm.id)?.configId).toBe("cfg_v1");
    expect(store.getConfig("cfg_v1")?.params["screen.min_fit"]).toBe(0.7);
    const flowInUse = await api.getEvalFlow("ranking");
    expect(flowInUse.promotedVariant).toBe("v1");
    expect(flowInUse.variants[0]?.status).toBe("champion");
    expect((await api.getOverview(swarm.id)).evalTrend).toEqual([{ variant: "v1", test: 0.6 }]);
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Partner", action: "eval.promote", target: swarm.id });
  });

  it("counts the eval's winner in the trend and refuses to put a reverted round into use", async () => {
    const { service, store, setFlow, setVariant } = createHarness();
    const api = service.as("Partner"); const swarm = await api.createSwarm({ name: "Eval", thesis });
    const round = (id: string, status: "baseline" | "champion" | "reverted", score: number) => ({ id, round: id === "baseline" ? 0 : Number(id.slice(1)), description: id, rationale: "", status, train: {}, test: { rank: score }, testInterval: null, costUsd: 1, config: { ...BASE_CONFIG, id: `cfg_${id}`, label: id }, changes: [], createdAt: stamp });
    // The real eval reports its current winner as "champion", never as "kept".
    setFlow({ id: "ranking", label: "Ranking", description: "test", headlineMetric: "rank", baseline: 0.5, best: 0.6, rounds: 2, updatedAt: stamp, metrics: [], goal: { target: "rank", direction: "higher", hold: [] }, cases: { train: 2, test: 2, reps: 1 }, noiseFloor: null, dataNote: "sim", variants: [round("baseline", "baseline", 0.5), round("v1", "reverted", 0.4), round("v2", "champion", 0.6)], bestVariant: "v2", promotedVariant: null, narrative: "" } satisfies EvalFlowDTO);
    expect((await api.getOverview(swarm.id)).evalTrend).toEqual([{ variant: "baseline", test: 0.5 }, { variant: "v2", test: 0.6 }]);
    setVariant({ ...BASE_CONFIG, id: "cfg_v1", label: "v1" });
    await expectServiceError(api.promoteEvalVariant("ranking", { variant: "v1", swarmId: swarm.id }), 409);
    expect(store.getSwarm(swarm.id)?.configId).toBe(BASE_CONFIG.id);
  });

  it("starts scheduled runs for eligible swarms and continues after one refusal", async () => {
    const { service, store, refused } = createHarness(); const api = service.as("Partner");
    const first = await api.createSwarm({ name: "First", thesis });
    const second = await api.createSwarm({ name: "Second", thesis });
    const paused = await api.createSwarm({ name: "Paused", thesis }); await api.updateSwarm(paused.id, { status: "paused" });
    refused.add(first.id);
    store.saveSettings({ ...DEFAULT_SETTINGS, schedule: { ...DEFAULT_SETTINGS.schedule, enabled: true, brain: "live", sources: "live" } });
    const started = await service.runScheduled();
    expect(started).toHaveLength(1);
    expect(started[0]?.swarmId).toBe(second.id);
    expect(started[0]?.trigger).toBe("schedule");
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Scheduler", action: "run.start", target: started[0]?.id });
    expect(store.recentAudit(3).some((entry) => entry.action === "run.start_refused" && entry.target === first.id)).toBe(true);
  });

  it("starts scheduled runs only for the named swarms when a catch-up asks for some", async () => {
    const { service, store } = createHarness(); const api = service.as("Partner");
    const ranToday = await api.createSwarm({ name: "Ran today", thesis });
    const missed = await api.createSwarm({ name: "Missed", thesis });
    store.saveSettings({ ...DEFAULT_SETTINGS, schedule: { ...DEFAULT_SETTINGS.schedule, enabled: true } });
    const started = await service.runScheduled([missed.id]);
    expect(started.map((run) => run.swarmId)).toEqual([missed.id]);
    expect(store.listRuns(ranToday.id, 10)).toEqual([]);
  });

  it("audits manual run start and cancellation under the requesting actor", async () => {
    const { service, store } = createHarness(); const api = service.as("Morgan");
    const swarm = await api.createSwarm({ name: "Manual run", thesis });
    const run = await api.startRun({ swarmId: swarm.id, brain: "sim", sources: "sim" });
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Morgan", action: "run.start", target: run.id });
    await api.cancelRun(run.id);
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Morgan", action: "run.cancel", target: run.id });
    await expectServiceError(api.cancelRun(run.id), 409);
  });

  it("shows each operational alert only after its condition is present", async () => {
    const { service, store, setSourceConfigured } = createHarness(); const api = service.as("Casey");
    const swarm = await api.createSwarm({ name: "Alerts", thesis });
    store.saveSettings({ ...DEFAULT_SETTINGS, schedule: { ...DEFAULT_SETTINGS.schedule, enabled: true, sources: "live" } });
    let ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.size).toBe(0);
    await api.updateSettings({ killSwitch: true, operatorName: " Casey " });
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.has("kill-switch")).toBe(true);
    // The stop covers eval rounds too: a live round spends money just as a run does.
    await expectServiceError(api.runEvalRounds("ranking", { rounds: 1 }), 409);
    await api.updateSettings({ killSwitch: false });

    setSourceConfigured(false);
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(["source-hackernews", "source-github", "source-arxiv", "source-people_data"].every((id) => ids.has(id))).toBe(true);
    setSourceConfigured(true);

    const run = runRecord(swarm.id, { status: "failed", error: "Provider unavailable", finishedAt: stamp, stats: { ...ZERO_STATS, failures: 1 } });
    store.insertRun(run);
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.has(`run-failed-${run.id}`)).toBe(true);
    expect(ids.has(`run-tasks-${run.id}`)).toBe(true);
    store.updateRun(run.id, { status: "budget_stopped" });
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.has(`run-budget-${run.id}`)).toBe(true);
    store.updateRun(run.id, { status: "succeeded", stats: { ...ZERO_STATS } });
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.has(`run-failed-${run.id}`)).toBe(false);
    expect(ids.has(`run-budget-${run.id}`)).toBe(false);
    expect(ids.has(`run-tasks-${run.id}`)).toBe(false);

    const badDirective = { id: newId("dir"), scope: { swarmId: swarm.id }, kind: "param" as const, key: "screen.min_fit", value: 2, text: null, priority: 0, status: "active" as const, author: "Partner", note: null, createdAt: stamp, updatedAt: stamp, expiresAt: null };
    store.insertDirective(badDirective);
    const callFounders = Array.from({ length: 3 }, () => founderRecord(swarm.id));
    for (const [index, founder] of callFounders.entries()) {
      store.insertFounder(founder);
      store.insertAssessment(assessment(founder.id));
      store.insertFeedback({ id: newId("fbk"), founderId: founder.id, author: "Partner", verdict: "no", reasonTags: ["outside_thesis"], note: null, createdAt: new Date(fixedAt.getTime() + 1000 + index).toISOString() });
    }
    const founder = callFounders[0]!;
    const oldAction: OutreachAction = { id: newId("out"), swarmId: swarm.id, founderId: founder.id, kind: "email_founder", target: { name: founder.name, role: null, relationship: null, channelHint: null }, rationale: "Review needed", draft: { subject: "Intro", body: "Draft", agenda: [], questions: [], disclosure: "AI assistant for the fund" }, consentBasis: "Founder requested contact", status: "proposed", decidedBy: null, decidedAt: null, decisionNote: null, resultSummary: null, transcriptEvidenceId: null, createdByTaskId: null, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" };
    store.insertOutreach(oldAction);
    ids = new Set((await api.getOverview(swarm.id)).alerts.map((alert) => alert.id));
    expect(ids.has(`directive-${badDirective.id}`)).toBe(true);
    expect(ids.has("suggestions")).toBe(true);
    expect(ids.has(`outreach-${oldAction.id}`)).toBe(true);
    expect((await api.getOverview(swarm.id)).alerts.find((alert) => alert.id === "kill-switch")).toBeUndefined();
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Casey", action: "settings.update" });
  });

  it("lists companies and assembles a detail with the assessed lead founder first", async () => {
    const { service, store } = createHarness(); const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Companies", thesis });
    const company = companyRecord(swarm.id); store.insertCompany(company);
    const early = { ...founderRecord(swarm.id), id: newId("fnd"), companyId: company.id, firstSeenAt: "2026-01-01T00:00:00.000Z" };
    const lead = { ...founderRecord(swarm.id), id: newId("fnd"), companyId: company.id, firstSeenAt: "2026-02-01T00:00:00.000Z" };
    store.insertFounder(early); store.insertFounder(lead);
    store.insertAssessment(assessment(early.id)); store.insertAssessment(assessment(lead.id));
    const companyScore = companyAssessment(company.id, lead.id, 0.91);
    store.insertCompanyAssessment(companyScore);
    store.upsertCompanyMember(companyMember(company.id, "Lead Founder"));
    store.insertEvidence(companyEvidence(lead.id, company.id, "company-older", "2026-11-10T00:00:00.000Z"));
    store.insertEvidence(companyEvidence(lead.id, company.id, "company-newer", "2026-11-11T00:00:00.000Z"));
    const contact: NetworkContact = { id: stableId("net", "Partner:person"), owner: "Partner", name: "Known Operator", company: "Vector Works, Inc.", position: "Founder", profileUrl: "https://www.linkedin.com/in/known", connectedOn: null, importedAt: stamp, previous: null };
    store.replaceNetwork("Partner", [contact]);
    const run = runRecord(swarm.id, { status: "succeeded", stage: null }); store.insertRun(run);
    const companyAgent = store.listAgents(swarm.id).find((agent) => agent.jobId === "company.product")!;
    store.insertTask({ ...taskRecord(run, companyAgent, "succeeded"), id: "company-task-older", companyId: company.id, startedAt: "2026-11-10T00:00:00.000Z", trace: [{ role: "assistant", content: "private trace" }] });
    store.insertTask({ ...taskRecord(run, companyAgent, "succeeded"), id: "company-task-newer", companyId: company.id, startedAt: "2026-11-11T00:00:00.000Z", trace: [{ role: "assistant", content: "private trace" }] });
    const listed = await api.listCompanies({ swarmId: swarm.id, sort: "deal" });
    expect(listed.rows.map((row) => row.id)).toEqual([company.id]);
    expect(listed.rows[0]).toMatchObject({ deal: 0.91, knownPeople: 1, founders: [{ id: lead.id }, { id: early.id }] });
    const detail = await api.getCompany(company.id);
    expect(detail.founders.map((row) => row.id)).toEqual([lead.id, early.id]);
    expect(detail.founders[0]).toMatchObject({ companyId: company.id, decision: "surface", composite: 0.8 });
    expect(detail.members).toHaveLength(1);
    expect(detail.assessment).toEqual(companyScore);
    expect(detail.history).toEqual([{ at: stamp, deal: 0.91, decision: "surface" }]);
    expect(detail.evidence.map((item) => item.id)).toEqual(["company-newer", "company-older"]);
    expect(detail.knownPeople).toEqual([contact]);
    expect(detail.tasks.map((task) => task.id)).toEqual(["company-task-newer", "company-task-older"]);
    expect(detail.tasks[0]).not.toHaveProperty("trace");
    expect((await api.getFounder(lead.id)).knownPeople).toEqual([contact]);
    await expectServiceError(api.listCompanies({ swarmId: "missing" }), 404);
    await expectServiceError(api.getCompany("missing"), 404);
  });

  it("validates company reason tags, redacts notes, and applies company call status", async () => {
    const { service, store } = createHarness(); const api = service.as("Taylor");
    const swarm = await api.createSwarm({ name: "Company calls", thesis });
    const company = companyRecord(swarm.id); store.insertCompany(company);
    await expectServiceError(api.addCompanyFeedback(company.id, { verdict: "yes", reasonTags: ["small_market"] }), 400, "reasonTags");
    const no = await api.addCompanyFeedback(company.id, { verdict: "no", reasonTags: ["wrong_stage"], note: "The market is early. The CEO is 42 years old." });
    expect(no).toMatchObject({ author: "Taylor", verdict: "no", note: "The market is early. [removed: personal detail]" });
    expect(store.getCompany(company.id)?.status).toBe("passed");
    const yes = await api.addCompanyFeedback(company.id, { verdict: "yes", reasonTags: ["strong_product"] });
    expect(yes.author).toBe("Taylor");
    expect(store.getCompany(company.id)?.status).toBe("surfaced");
    expect(store.recentAudit(1)[0]).toMatchObject({ action: "company_feedback.create", target: company.id });
  });

  it("adds manual founder leads with link classification and refuses invalid or personal details", async () => {
    const { service, store } = createHarness(); const api = service.as("Alex");
    const swarm = await api.createSwarm({ name: "Manual leads", thesis });
    const cases = [
      ["https://github.com/example", "github"],
      ["https://twitter.com/example", "x"],
      ["https://scholar.google.com/citations?user=example", "scholar"],
      ["https://www.linkedin.com/in/example", "linkedin"],
      ["https://example.com/profile", "site"],
    ] as const;
    for (const [link, field] of cases) {
      const lead = await api.addFounder({ swarmId: swarm.id, name: "Manual Founder", companyName: "Vector Works", companyUrl: "https://vector.example", link });
      expect(lead.source).toBe("manual");
      expect(lead.sourceTitle).toBe("Added by Alex");
      expect(lead.sourceRef).toBe(link);
      expect(lead.links[field]).toBe(link);
      expect(lead.founderId).toBeNull();
    }
    const fallback = await api.addFounder({ swarmId: swarm.id, name: "No Link" });
    expect(fallback.sourceRef).toBe(`manual:${fallback.id}`);
    expect(fallback.why).toBe("Added by Alex.");
    await expectServiceError(api.addFounder({ swarmId: swarm.id, name: "  " }), 400, "name");
    await expectServiceError(api.addFounder({ swarmId: swarm.id, name: "x".repeat(201) }), 400, "name");
    await expectServiceError(api.addFounder({ swarmId: swarm.id, name: "Bad company URL", companyUrl: "ftp://vector.example" }), 400, "companyUrl");
    await expectServiceError(api.addFounder({ swarmId: swarm.id, name: "Bad profile link", link: "/relative" }), 400, "link");
    await expectServiceError(api.addFounder({ swarmId: swarm.id, name: "Sensitive", why: "She is 42 years old." }), 400, "why");
    expect(store.listLeads({ swarmId: swarm.id, unmatchedOnly: true })).toHaveLength(6);
    expect(store.recentAudit(1)[0]).toMatchObject({ actor: "Alex", action: "founder.add" });
  });

  it("imports contact lists, creates only new founder leads in every active swarm, and removes an owner", async () => {
    const { service, store } = createHarness(); const api = service.as("Morgan");
    const firstSwarm = await api.createSwarm({ name: "First network swarm", thesis });
    const secondSwarm = await api.createSwarm({ name: "Second network swarm", thesis });
    const paused = await api.createSwarm({ name: "Paused network swarm", thesis }); await api.updateSwarm(paused.id, { status: "paused" });
    const contacts = [
      ["Alice", "New", "https://www.linkedin.com/in/alice", "Acme", "Staff Engineer", "2024-01-01"],
      ["Bob", "Same", "https://www.linkedin.com/in/bob", "Startup", "Founder", "2024-01-02"],
      ["Carol", "Staff", "https://www.linkedin.com/in/carol", "Factory", "Staff Engineer", "2024-01-03"],
      ["Dana", "Still", "https://www.linkedin.com/in/dana", "Studio", "Founder", "2024-01-04"],
    ];
    const first = await api.importNetwork({ csv: contactCsv(contacts) });
    expect(first).toMatchObject({ owner: "Morgan", imported: 4, changed: 0, leads: 0, network: { total: 4, owners: [{ owner: "Morgan", contacts: 4 }] } });
    const second = await api.importNetwork({ csv: contactCsv([
      ["Alice", "New", "https://www.linkedin.com/in/alice", "Stealth", "Founder", "2024-01-01"],
      contacts[1]!,
      ["Carol", "Staff", "https://www.linkedin.com/in/carol", "Factory", "Engineering Manager", "2024-01-03"],
      ["Dana", "Still", "https://www.linkedin.com/in/dana", "Studio", "Co-Founder", "2024-01-04"],
    ]) });
    expect(second).toMatchObject({ imported: 4, changed: 3, leads: 1, network: { total: 4 } });
    for (const swarm of [firstSwarm, secondSwarm]) {
      const leads = store.listLeads({ swarmId: swarm.id, unmatchedOnly: true });
      expect(leads).toHaveLength(1);
      expect(leads[0]).toMatchObject({ source: "network", sourceRef: "https://www.linkedin.com/in/alice", sourceTitle: "Contact list of Morgan", personName: "Alice New", role: "Founder", companyName: "Stealth", links: { linkedin: "https://www.linkedin.com/in/alice" }, why: "Changed from Staff Engineer at Acme to Founder at Stealth." });
    }
    expect(store.listLeads({ swarmId: paused.id })).toHaveLength(0);
    expect(store.recentAudit(1)[0]?.detail).toEqual({ imported: 4, changed: 3, leads: 1 });
    await expectServiceError(api.importNetwork({ csv: "bad csv" }), 400, "csv");
    await expectServiceError(api.importNetwork({ csv: "x".repeat(8_000_001) }), 400, "csv");
    const network = await api.removeNetwork("Morgan");
    expect(network).toEqual({ owners: [], total: 0 });
    expect(store.listNetwork()).toHaveLength(0);
    expect(store.recentAudit(1)[0]).toMatchObject({ action: "network.remove", target: "Morgan" });
  });

  it("counts surfaced companies waiting for calls and alerts only for the last finished planted-check failure", async () => {
    const { service, store } = createHarness(); const api = service.as("Partner");
    const swarm = await api.createSwarm({ name: "Company overview", thesis });
    const waiting: Company[] = [];
    for (let index = 0; index < 6; index++) {
      const company = companyRecord(swarm.id, newId("cmp"), "surfaced", `Company ${index}`);
      waiting.push(company); store.insertCompany(company);
      store.insertCompanyAssessment(companyAssessment(company.id, null, 0.3 + index / 10));
    }
    const called = companyRecord(swarm.id, newId("cmp"), "surfaced", "Already called"); store.insertCompany(called);
    store.insertCompanyAssessment(companyAssessment(called.id, null, 1));
    store.insertCompanyFeedback({ id: newId("cfb"), companyId: called.id, author: "Partner", verdict: "yes", reasonTags: ["right_time"], note: null, createdAt: stamp });
    for (let index = 0; index < 499; index++) {
      const alreadyCalled = companyRecord(swarm.id, newId("cmp"), "surfaced", `Called ${index}`);
      store.insertCompany(alreadyCalled);
      store.insertCompanyAssessment(companyAssessment(alreadyCalled.id, null, 0.99));
      store.insertCompanyFeedback({ id: newId("cfb"), companyId: alreadyCalled.id, author: "Partner", verdict: "yes", reasonTags: ["right_time"], note: null, createdAt: stamp });
    }
    let overview = await api.getOverview(swarm.id);
    expect(overview.companiesWaiting).toBe(6);
    expect(overview.topCompanies?.map((row) => row.id)).toEqual(waiting.slice().reverse().slice(0, 5).map((company) => company.id));
    const failed = runRecord(swarm.id, { status: "succeeded", stage: null, finishedAt: stamp, stats: { ...ZERO_STATS, controlsFailed: 2 } }); store.insertRun(failed);
    overview = await api.getOverview(swarm.id);
    const controlAlert = overview.alerts.find((alert) => alert.id === "control-failed");
    expect(controlAlert).toMatchObject({ level: "warning", title: "The fact-checker failed a planted check", link: "/swarm?node=job:verify.claims" });
    expect(controlAlert?.detail).toContain("2 fact-check calls in the last run accepted a made-up claim");
    expect(controlAlert?.detail).toContain("verdicts were thrown away");
    expect(controlAlert?.detail).toContain("another model for the fact-checker");
    store.insertRun(runRecord(swarm.id, { startedAt: "2026-11-13T00:00:00.000Z", status: "running", finishedAt: null }));
    expect((await api.getOverview(swarm.id)).alerts.some((alert) => alert.id === "control-failed")).toBe(true);
    store.insertRun(runRecord(swarm.id, { startedAt: "2026-11-14T00:00:00.000Z", status: "succeeded", finishedAt: "2026-11-14T00:01:00.000Z", stats: { ...ZERO_STATS } }));
    expect((await api.getOverview(swarm.id)).alerts.some((alert) => alert.id === "control-failed")).toBe(false);
  });

  it("backfills the four enabled company and analyst agents once for an older swarm", async () => {
    const { service, store } = createHarness(); const api = service.as("Partner");
    const swarm: Swarm = { id: newId("swm"), name: "Older swarm", status: "active", thesis, configId: BASE_CONFIG.id, createdAt: stamp, updatedAt: stamp };
    store.insertSwarm(swarm);
    const newJobs = new Set(["company.product", "company.traction", "company.team", "assess.company"]);
    for (const job of JOBS.filter((item) => !newJobs.has(item.id))) {
      store.insertAgent({ id: newId("agt"), swarmId: swarm.id, jobId: job.id, classId: job.classId, name: job.label, status: "active", beat: null, state: {}, createdAt: stamp });
    }
    await api.getTree(swarm.id);
    const ids = store.listAgents(swarm.id).map((agent) => agent.jobId);
    expect([...ids].filter((id) => newJobs.has(id))).toEqual(["company.product", "company.traction", "company.team", "assess.company"]);
    await api.getOverview(swarm.id);
    expect(store.listAgents(swarm.id).filter((agent) => newJobs.has(agent.jobId))).toHaveLength(4);
  });
});
