import { createHash } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  booleanParam,
  DIMENSIONS,
  effectiveThresholds,
  effectiveWeights,
  getJob,
  groundJudgments,
  latestCalls,
  newId,
  numberParam,
  onPage,
  reasonLabel,
  scoreFounder,
  stableId,
  stringParam,
} from "@agentswarm/shared";
import { createRng, hashSeed } from "../sim";
import type {
  Agent,
  AssessInput,
  Assessment,
  DebriefInput,
  Evidence,
  EvidenceBrief,
  EvidenceDraft,
  Feedback,
  Founder,
  FounderBrief,
  GapQuestion,
  InvestigateInput,
  JobId,
  Lead,
  MediaReadInput,
  ModelJobId,
  ProfileLinks,
  ProfileUpdate,
  RawItem,
  RepoRef,
  Recording,
  ScoutInput,
  ScreenInput,
  SourceId,
  StageId,
  VerifyInput,
} from "@agentswarm/shared";
import { plantControl } from "../jobs";
import type { PersonRecord } from "../contracts";
import { runCompanyAssess, runCompanyResearch, runCompanyResolve } from "./company-stages";
import { forEachConcurrent, type EngineRuntime } from "./runtime";
import { runHunt } from "./hunt";
import { normalizeLink, normalizeName } from "../db";
import { findSensitive, redactSensitive } from "../jobs";

const SCOUT_JOBS = [
  "scout.hackernews",
  "scout.github",
  "scout.research",
  "scout.talent",
] as const satisfies readonly ModelJobId[];

const INVESTIGATOR_JOBS = [
  "investigate.background",
  "investigate.code",
  "investigate.company",
  "investigate.media",
  "investigate.redflags",
] as const satisfies readonly ModelJobId[];

type ScoutJobId = (typeof SCOUT_JOBS)[number];
type InvestigatorJobId = (typeof INVESTIGATOR_JOBS)[number];

const NO_MODEL_PROVIDER = "sim";
const NO_MODEL_NAME = "none";
/** Bits a second below which recorded speech is not encoded. Bounds a recording's length from its size. */
const LOWEST_SPEECH_BITRATE = 6_000;

function isScoutJob(jobId: JobId): jobId is ScoutJobId {
  return (SCOUT_JOBS as readonly JobId[]).includes(jobId);
}

function isInvestigatorJob(jobId: JobId): jobId is InvestigatorJobId {
  return (INVESTIGATOR_JOBS as readonly JobId[]).includes(jobId);
}

export function founderBrief(runtime: EngineRuntime, founder: Founder): FounderBrief {
  const sightings = runtime.deps.store.listLeads({ founderId: founder.id }).map((lead) => ({
    source: lead.source,
    title: lead.sourceTitle,
    why: lead.why,
    ref: lead.sourceRef,
  }));

  return {
    id: founder.id,
    name: founder.name,
    headline: founder.headline,
    location: founder.location,
    company: founder.company,
    links: founder.links,
    tags: founder.tags,
    sightings,
    simId: founder.simId,
  };
}

export function evidenceBrief(evidence: Evidence): EvidenceBrief {
  return {
    id: evidence.id,
    kind: evidence.kind,
    source: evidence.source,
    url: evidence.url,
    title: evidence.title,
    excerpt: evidence.excerpt,
    claim: evidence.claim,
    publishedAt: evidence.publishedAt,
    verification: evidence.verification,
    ...(evidence.facet ? { facet: evidence.facet } : {}),
    ...(evidence.quote ? { quote: evidence.quote } : {}),
    sim: evidence.sim,
  };
}

function allEvidenceBriefs(runtime: EngineRuntime, founderId: string): EvidenceBrief[] {
  return runtime.deps.store.listEvidence(founderId).map(evidenceBrief);
}

export function canonicalUrl(value: string | null): string {
  if (!value?.trim()) return "";
  return normalizeLink(value);
}

export function hashEvidence(source: SourceId, url: string | null, excerpt: string): string {
  const canonicalExcerpt = excerpt.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 1200).toLowerCase();
  const content = JSON.stringify([source.trim().toLowerCase(), canonicalUrl(url), canonicalExcerpt]);
  return createHash("sha256").update(content).digest("hex");
}

function addEvidence(
  runtime: EngineRuntime,
  founderId: string,
  taskId: string,
  source: SourceId,
  drafts: readonly EvidenceDraft[],
  verification: Evidence["verification"] = "unverified",
  verificationNote: string | null = null,
): number {
  let inserted = 0;
  for (const draft of drafts) {
    if (runtime.stopped()) break;
    const excerpt = draft.excerpt.trim().slice(0, 1200);
    const claim = draft.claim.trim();
    if (!excerpt || !claim) continue;
    // Research jobs require a citable URL. Call notes are attached to the call record instead,
    // and a data vendor's record has no page of its own.
    if (source !== "call" && source !== "people_data" && !draft.url?.trim()) continue;
    const hash = hashEvidence(source, draft.url, excerpt);
    const evidence: Evidence = {
      id: stableId("evd", `${runtime.run.id}:${taskId}:${hash}`),
      founderId,
      kind: draft.kind,
      source,
      url: draft.url?.trim() || null,
      title: draft.title.trim() || "Untitled evidence",
      excerpt,
      claim,
      publishedAt: draft.publishedAt,
      capturedAt: runtime.now().toISOString(),
      collectedByTaskId: taskId,
      hash,
      verification,
      verificationNote,
      sim: draft.sim ?? null,
    };
    if (runtime.deps.store.insertEvidence(evidence)) inserted += 1;
  }
  if (inserted > 0) runtime.addStats({ evidence: inserted });
  return inserted;
}

export function mergeLinks(current: ProfileLinks, incoming: ProfileLinks): ProfileLinks {
  return {
    github: current.github ?? incoming.github,
    linkedin: current.linkedin ?? incoming.linkedin,
    x: current.x ?? incoming.x,
    site: current.site ?? incoming.site,
    scholar: current.scholar ?? incoming.scholar,
  };
}

function applyProfileUpdate(runtime: EngineRuntime, founderId: string, profile: ProfileUpdate): void {
  const founder = runtime.deps.store.getFounder(founderId);
  if (!founder) return;
  const companyName = profile.companyName?.trim() || founder.company.name;
  const patch = {
    headline: profile.headline?.trim() || founder.headline,
    location: profile.location?.trim() || founder.location,
    company: {
      name: companyName,
      url: profile.companyUrl?.trim() || founder.company.url,
      oneLiner: profile.companyOneLiner?.trim() || founder.company.oneLiner,
      stage: profile.companyStage?.trim() || founder.company.stage,
    },
    links: mergeLinks(founder.links, profile.links),
    updatedAt: runtime.now().toISOString(),
  };
  runtime.deps.store.updateFounder(founderId, patch);
}

function recordNoModelTask(
  runtime: EngineRuntime,
  input: {
    agent: Agent;
    stage: StageId;
    jobId: JobId;
    inputSummary: string;
    outputSummary: string;
    founderId?: string | null;
    itemsOut?: number;
    output?: unknown;
  },
): void {
  runtime.recordPlainTask({
    ...input,
    status: "succeeded",
    provider: NO_MODEL_PROVIDER,
    model: NO_MODEL_NAME,
  });
}

function recordFailedPlainTask(
  runtime: EngineRuntime,
  input: {
    agent: Agent;
    stage: StageId;
    jobId: JobId;
    inputSummary: string;
    error: unknown;
    founderId?: string | null;
  },
): void {
  runtime.recordPlainTask({
    agent: input.agent,
    stage: input.stage,
    jobId: input.jobId,
    status: "failed",
    provider: NO_MODEL_PROVIDER,
    model: NO_MODEL_NAME,
    inputSummary: input.inputSummary,
    founderId: input.founderId,
    error: input.error instanceof Error ? input.error.message : String(input.error),
  });
}

function saveScoutCursor(runtime: EngineRuntime, agent: Agent, cursor: unknown, at: string): void {
  const state = { ...agent.state, cursor, lastFetchedAt: at };
  runtime.deps.store.updateAgent(agent.id, { state });
  agent.state = state;
}

function lookbackSince(runtime: EngineRuntime, agent: Agent): string {
  const hours = numberParam("scout.lookback_hours", runtime.resolve(agent, "scout.lookback_hours"), runtime.config);
  return new Date(runtime.now().getTime() - hours * 60 * 60 * 1000).toISOString();
}

function simIdForLead(runtime: EngineRuntime, item: RawItem, lead: Pick<Lead, "personName" | "companyName">): string | null {
  if (!item.simFounderId) return null;
  const synthetic = runtime.deps.simWorld.founder(item.simFounderId);
  if (!synthetic) return null;
  return normalizeName(synthetic.name) === normalizeName(lead.personName) &&
    normalizeName(synthetic.companyName) !== "" &&
    normalizeName(synthetic.companyName) === normalizeName(lead.companyName ?? "")
    ? synthetic.simId
    : null;
}

function makeFounder(runtime: EngineRuntime, lead: Lead, simId: string | null): Founder {
  const timestamp = lead.discoveredAt;
  return {
    id: stableId("fnd", `${runtime.swarm.id}:${runtime.run.id}:${lead.source}:${lead.sourceRef}:${normalizeName(lead.personName)}:${normalizeName(lead.companyName ?? "")}`),
    swarmId: runtime.swarm.id,
    name: lead.personName,
    headline: lead.role,
    location: null,
    company: {
      name: lead.companyName,
      url: lead.companyUrl,
      oneLiner: lead.oneLiner,
      stage: null,
    },
    links: lead.links,
    status: "lead",
    fit: null,
    fitReasons: [],
    tags: [],
    identityConfidence: null,
    sources: [lead.source],
    firstSeenAt: timestamp,
    updatedAt: timestamp,
    lastAssessedAt: null,
    nextRecheckAt: null,
    simId,
  };
}

function mergeLead(runtime: EngineRuntime, lead: Lead, simId: string | null, founder: Founder): void {
  if (founder.status !== "archived") {
    runtime.deps.store.updateFounder(founder.id, {
      headline: founder.headline ?? lead.role,
      company: {
        name: founder.company.name ?? lead.companyName,
        url: founder.company.url ?? lead.companyUrl,
        oneLiner: founder.company.oneLiner ?? lead.oneLiner,
        stage: founder.company.stage,
      },
      links: mergeLinks(founder.links, lead.links),
      sources: founder.sources.includes(lead.source) ? founder.sources : [...founder.sources, lead.source],
      simId: founder.simId ?? simId,
      updatedAt: runtime.now().toISOString(),
    });
  }
  runtime.deps.store.attachLead(lead.id, founder.id);
}

async function runDebrief(runtime: EngineRuntime, assessmentCandidates: Set<string>): Promise<boolean> {
  runtime.setStage("debrief");
  const completedBeforeSimulation = runtime.deps.store.listOutreach({ swarmId: runtime.swarm.id, statuses: ["completed"] });
  if (runtime.run.sources === "sim") {
    const approved = runtime.deps.store.listOutreach({ swarmId: runtime.swarm.id, statuses: ["approved"] });
    for (const action of approved) {
      if (runtime.stopped()) return false;
      const founder = runtime.deps.store.getFounder(action.founderId);
      // Only a simulated founder can be "contacted" by the simulator. A real founder found in an
      // earlier live run keeps their approved outreach untouched, with nothing invented for them.
      if (!founder || !founder.simId) continue;
      if (action.kind === "email_founder") {
        runtime.deps.store.updateOutreach(action.id, {
          status: "dispatched",
          resultSummary: "Simulated send completed; no email was sent.",
          updatedAt: runtime.now().toISOString(),
        });
        runtime.deps.store.updateFounder(founder.id, { status: "contacted", updatedAt: runtime.now().toISOString() });
        runtime.persist();
        continue;
      }
      // Approved calls wait for a person's explicit service action, even in simulation.
    }
  }

  const agent = runtime.agents.find((candidate) => candidate.jobId === "call.debrief");
  if (!agent) return !runtime.stopped();
  for (const action of completedBeforeSimulation) {
    if (runtime.stopped()) return false;
    const founder = runtime.deps.store.getFounder(action.founderId);
    if (!founder || founder.swarmId !== runtime.swarm.id) continue;
    const transcriptEvidence = action.transcriptEvidenceId
      ? runtime.deps.store.listEvidence(founder.id).find((evidence) => evidence.id === action.transcriptEvidenceId)
      : undefined;
    if (!transcriptEvidence || transcriptEvidence.verification !== "unverified") continue;
    if (transcriptEvidence.kind !== "call_transcript" && transcriptEvidence.kind !== "reference") continue;

    const input: DebriefInput = {
      founder: founderBrief(runtime, founder),
      kind: action.kind,
      targetName: action.target.name,
      transcript: transcriptEvidence.excerpt,
    };
    const result = await runtime.runJob({
      agent,
      stage: "debrief",
      jobId: "call.debrief",
      input,
      founderId: founder.id,
    });
    if (!result) return false;
    if (result.task.status !== "succeeded" || !result.output) continue;

    addEvidence(runtime, founder.id, result.task.id, "call", result.output.evidence, "supported");
    runtime.deps.store.setVerification(transcriptEvidence.id, "supported", "Debriefed");
    const recheckAt = runtime.now().toISOString();
    runtime.deps.store.updateFounder(founder.id, {
      nextRecheckAt: recheckAt,
      updatedAt: recheckAt,
    });
    assessmentCandidates.add(founder.id);
    runtime.persist();
  }
  return !runtime.stopped();
}

async function runScout(runtime: EngineRuntime): Promise<Map<string, string>> {
  runtime.setStage("scout");
  const simIdsByLead = new Map<string, string>();
  const sources = runtime.deps.sources[runtime.run.sources];
  const scoutAgents = runtime.agents.filter((agent): agent is Agent & { jobId: ScoutJobId } => isScoutJob(agent.jobId));
  await forEachConcurrent(scoutAgents, runtime.concurrency, runtime.stopped, async (agent) => {
    if (runtime.stopped()) return;
    const jobId = agent.jobId;
    const source = getJob(jobId).source;
    if (!source) return;
    const emptyInput: ScoutInput = { items: [], beat: agent.beat, thesis: runtime.swarm.thesis };

    // Let the normal job boundary create the expected skipped task without touching a source.
    if (agent.status === "paused" || !getJob(jobId).enabled) {
      const skipped = await runtime.runJob({ agent, stage: "scout", jobId, input: emptyInput });
      if (!skipped) return;
      return;
    }

    const adapter = sources.get(source);
    if (!adapter) {
      runtime.recordPlainTask({
        agent,
        stage: "scout",
        jobId,
        status: "skipped",
        provider: NO_MODEL_PROVIDER,
        model: NO_MODEL_NAME,
        inputSummary: `Fetch ${source} for new founder leads.`,
        skipReason: "No source adapter is available in this mode.",
      });
      return;
    }

    try {
      const status = await adapter.status();
      if (!status.configured) {
        runtime.recordPlainTask({
          agent,
          stage: "scout",
          jobId,
          status: "skipped",
          provider: NO_MODEL_PROVIDER,
          model: NO_MODEL_NAME,
          inputSummary: `Fetch ${source} for new founder leads.`,
          skipReason: status.detail || "Source is not configured.",
        });
        return;
      }
      const limit = numberParam("scout.max_items", runtime.resolve(agent, "scout.max_items"), runtime.config);
      const fetched = await adapter.fetch({
        limit,
        since: lookbackSince(runtime, agent),
        cursor: agent.state.cursor ?? null,
        beat: agent.beat,
        thesis: runtime.swarm.thesis,
        simDay: runtime.run.simDay,
      });
      if (runtime.stopped()) return;
      runtime.addStats({ rawItems: fetched.items.length });
      if (fetched.items.length === 0) {
        recordNoModelTask(runtime, {
          agent,
          stage: "scout",
          jobId,
          inputSummary: `Fetch ${source} for new founder leads.`,
          outputSummary: "The source returned no new items.",
          output: { itemCount: 0 },
        });
        saveScoutCursor(runtime, agent, fetched.cursor, runtime.now().toISOString());
        runtime.persist();
        return;
      }

      const result = await runtime.runJob({
        agent,
        stage: "scout",
        jobId,
        input: { items: fetched.items, beat: agent.beat, thesis: runtime.swarm.thesis },
      });
      if (!result) return;
      if (result.task.status !== "succeeded" || !result.output) return;

      const itemByRef = new Map(fetched.items.map((item) => [item.ref, item]));
      const seen = new Set<string>();
      let accepted = 0;
      for (const draft of result.output.leads) {
        const item = itemByRef.get(draft.itemRef);
        const personName = draft.personName.trim();
        if (!item || !personName) continue;
        const key = `${draft.itemRef}\0${normalizeName(personName)}\0${normalizeName(draft.companyName ?? "")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const lead: Lead = {
          id: stableId("led", `${runtime.run.id}:${result.task.id}:${item.ref}:${normalizeName(personName)}:${normalizeName(draft.companyName ?? "")}`),
          swarmId: runtime.swarm.id,
          founderId: null,
          source: item.source,
          sourceRef: item.ref,
          // The title is the source's own words, stored as they are except for personal details.
          sourceTitle: redactSensitive(item.title),
          personName,
          role: draft.role,
          companyName: draft.companyName?.trim() || null,
          companyUrl: draft.companyUrl?.trim() || null,
          oneLiner: draft.oneLiner?.trim() || null,
          links: draft.links,
          why: draft.why.trim(),
          discoveredByTaskId: result.task.id,
          discoveredAt: runtime.now().toISOString(),
        };
        runtime.deps.store.insertLead(lead);
        const simId = simIdForLead(runtime, item, lead);
        if (simId) simIdsByLead.set(lead.id, simId);
        accepted += 1;
      }
      if (accepted > 0) runtime.addStats({ leads: accepted });
      saveScoutCursor(runtime, agent, fetched.cursor, runtime.now().toISOString());
      runtime.persist();
    } catch (error) {
      recordFailedPlainTask(runtime, {
        agent,
        stage: "scout",
        jobId,
        inputSummary: `Fetch ${source} for new founder leads.`,
        error,
      });
    }
  });
  return simIdsByLead;
}

async function runResolve(runtime: EngineRuntime, simIdsByLead: ReadonlyMap<string, string>): Promise<void> {
  runtime.setStage("resolve");
  const resolver = runtime.agents.find((agent) => agent.jobId === "resolve.identity");
  if ((resolver && resolver.status === "paused") || !getJob("resolve.identity").enabled) {
    if (resolver) {
      runtime.recordPlainTask({
        agent: resolver,
        stage: "resolve",
        jobId: "resolve.identity",
        status: "skipped",
        provider: NO_MODEL_PROVIDER,
        model: NO_MODEL_NAME,
        inputSummary: "Match unmatched founder sightings by normalized name and company.",
        skipReason: resolver.status === "paused" ? "Agent is paused." : "Job is not enabled.",
      });
    }
    return;
  }

  const sourceOrder = (source: SourceId) => SCOUT_JOBS.findIndex((jobId) => getJob(jobId).source === source);
  const unmatched = runtime.deps.store.listLeads({ swarmId: runtime.swarm.id, unmatchedOnly: true })
    .sort((a, b) => sourceOrder(a.source) - sourceOrder(b.source)
      || a.sourceRef.localeCompare(b.sourceRef)
      || normalizeName(a.personName).localeCompare(normalizeName(b.personName))
      || normalizeName(a.companyName ?? "").localeCompare(normalizeName(b.companyName ?? ""))
      || a.id.localeCompare(b.id));
  let created = 0;
  let merged = 0;
  for (const lead of unmatched) {
    if (runtime.stopped()) return;
    const normalizedName = normalizeName(lead.personName);
    const normalizedCompany = normalizeName(lead.companyName ?? "");
    const linked = runtime.deps.store.findFounderByLinks(runtime.swarm.id, lead.links);
    const existing = linked ?? (normalizedName && normalizedCompany
      ? runtime.deps.store.findFoundersByName(runtime.swarm.id, normalizedName)
        .filter((founder) => normalizeName(founder.company.name ?? "") === normalizedCompany)
        .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id))[0]
      : undefined);
    const simId = simIdsByLead.get(lead.id) ?? null;

    if (existing) {
      mergeLead(runtime, lead, simId, existing);
      merged += 1;
    } else {
      const founder = makeFounder(runtime, lead, simId);
      runtime.deps.store.insertFounder(founder);
      runtime.deps.store.attachLead(lead.id, founder.id);
      created += 1;
    }
  }
  if (created > 0 || merged > 0) runtime.addStats({ newFounders: created, mergedLeads: merged });
  if (resolver) {
    recordNoModelTask(runtime, {
      agent: resolver,
      stage: "resolve",
      jobId: "resolve.identity",
      inputSummary: `Match ${unmatched.length} unmatched founder sighting(s) by normalized name and company.`,
      outputSummary: `Created ${created} founder(s) and merged ${merged} lead(s).`,
      output: { created, merged },
      itemsOut: created + merged,
    });
  }
  runtime.persist();
}

async function runScreen(runtime: EngineRuntime): Promise<void> {
  runtime.setStage("screen");
  const agent = runtime.agents.find((candidate) => candidate.jobId === "screen.fit");
  if (!agent) return;
  const threshold = effectiveThresholds(runtime.resolve(null, "screen.min_fit"), runtime.config).minFit;
  const founders = runtime.deps.store.listFounders({ swarmId: runtime.swarm.id, statuses: ["lead"] })
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));

  await forEachConcurrent(founders, runtime.concurrency, runtime.stopped, async (founder) => {
    if (runtime.stopped()) return;
    const input: ScreenInput = { founder: founderBrief(runtime, founder), thesis: runtime.swarm.thesis };
    const result = await runtime.runJob({ agent, stage: "screen", jobId: "screen.fit", input, founderId: founder.id });
    if (!result) return;
    if (result.task.status !== "succeeded" || !result.output) return;
    const fit = Math.min(1, Math.max(0, Number.isFinite(result.output.fit) ? result.output.fit : 0));
    const nextStatus = fit >= threshold ? "queued" : "screened_out";
    const current = runtime.deps.store.getFounder(founder.id);
    if (!current) return;
    const preserveStatus = current.status !== "lead" || latestFeedback(runtime).get(founder.id)?.verdict === "no";
    runtime.deps.store.updateFounder(founder.id, {
      fit,
      fitReasons: result.output.reasons,
      tags: result.output.tags,
      status: preserveStatus ? current.status : nextStatus,
      updatedAt: runtime.now().toISOString(),
    });
    runtime.addStats({ screened: 1, screenedIn: nextStatus === "queued" ? 1 : 0 });
  });
}

/** How many of a founder's repositories are considered before one is chosen for review. */
const REPO_CANDIDATES = 5;

/**
 * The repository to review: the one named after the founder's company or project when there
 * is one, because that is the work being assessed; otherwise their most significant one.
 */
export function pickRepo(repos: readonly RepoRef[], founder: Pick<Founder, "company">): RepoRef | null {
  const wanted = normalizeName(founder.company.name ?? "").replace(/\s+/g, "");
  if (wanted.length >= 3) {
    const named = repos.find((repo) => {
      const name = normalizeName(repo.name).replace(/\s+/g, "");
      return name.length >= 3 && (name.includes(wanted) || wanted.includes(name));
    });
    if (named) return named;
  }
  return repos[0] ?? null;
}

/** The share of a run's deep dives kept for founders that are due a second look. */
const RECHECK_SHARE = 0.2;

/**
 * Who is investigated this run, in order. New founders must not crowd out the ones the swarm
 * already promised to come back to, so the order is: first deep follow-ups (promised for the
 * next run), then a reserved share of due re-checks, then new founders by thesis fit, then
 * any re-checks still due.
 */
function recheckCandidates(runtime: EngineRuntime, limit: number): Founder[] {
  const dueAt = runtime.now().toISOString();
  const queued = runtime.deps.store.listFounders({ swarmId: runtime.swarm.id, statuses: ["queued"] })
    .sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
  const due = runtime.deps.store.listFounders({
    swarmId: runtime.swarm.id,
    statuses: ["needs_evidence", "watch"],
    recheckDueBefore: dueAt,
  }).sort((a, b) => (a.nextRecheckAt ?? "").localeCompare(b.nextRecheckAt ?? "") || a.id.localeCompare(b.id));
  const followUps = due.filter((founder) => isFirstFollowUp(runtime, founder));
  const otherDue = due.filter((founder) => !followUps.includes(founder));
  // With a single slot there is no share to reserve, so it goes to whichever has waited longer:
  // the re-check that has been due the longest, or the new founder first seen the earliest.
  const oldestDue = otherDue[0]?.nextRecheckAt ?? null;
  const oldestQueued = queued.reduce<string | null>((oldest, founder) => (oldest === null || founder.firstSeenAt < oldest ? founder.firstSeenAt : oldest), null);
  const reserved = limit > 1
    ? Math.max(1, Math.floor(limit * RECHECK_SHARE))
    : oldestDue !== null && (oldestQueued === null || oldestDue <= oldestQueued) ? 1 : 0;
  const byId = new Set<string>();
  return [...followUps, ...otherDue.slice(0, reserved), ...queued, ...otherDue.slice(reserved)].filter((founder) => {
    if (byId.has(founder.id)) return false;
    byId.add(founder.id);
    return true;
  });
}

/** True for a founder whose only assessment so far said "needs evidence": the one deep follow-up is owed. */
function isFirstFollowUp(runtime: EngineRuntime, founder: Founder): boolean {
  return founder.status === "needs_evidence" && runtime.deps.store.assessmentHistory(founder.id).length === 1;
}

function latestFeedback(runtime: EngineRuntime): Map<string, Feedback> {
  return latestCalls(runtime.deps.store.allFeedback(runtime.swarm.id));
}

function noCall(founderId: string, calls: ReadonlyMap<string, Feedback>): boolean {
  return calls.get(founderId)?.verdict === "no";
}

/** Below this the vendor is not sure enough that its record is the person asked for. */
const VENDOR_MATCH_FLOOR = 0.6;

function vendorExcerpt(record: PersonRecord): string {
  const span = (start: string | null, end: string | null) => (start || end ? ` (${start ?? "?"} to ${end ?? "now"})` : "");
  const lines: string[] = [];
  if (record.current?.title || record.current?.company) {
    lines.push(`Current: ${record.current.title ?? "role not given"} at ${record.current.company ?? "company not given"}${record.current.startDate ? ` since ${record.current.startDate}` : ""}.`);
  }
  for (const role of record.experience.slice(0, 6)) {
    if (!role.title && !role.company) continue;
    lines.push(`${role.title ?? "Role not given"} at ${role.company ?? "company not given"}${span(role.startDate, role.endDate)}.`);
  }
  for (const school of record.education.slice(0, 3)) {
    if (!school.school) continue;
    lines.push(`Studied at ${school.school}${school.degrees.length ? `, ${school.degrees.join(", ")}` : ""}${span(school.startDate, school.endDate)}.`);
  }
  return lines.join(" ");
}

/**
 * A data vendor's record of a founder's work history, when a vendor is connected. Asked for once
 * per founder, because each record costs a vendor credit. The record is filed as unverified
 * evidence and goes through the fact-check like anything else: a vendor can match the wrong
 * person, and its record can be out of date.
 */
async function enrichFromVendor(runtime: EngineRuntime, founder: Founder): Promise<void> {
  const people = runtime.deps.people;
  if (!people || runtime.run.sources !== "live" || founder.simId) return;
  if (runtime.deps.store.listEvidence(founder.id).some((item) => item.source === "people_data")) return;
  const agent = runtime.agents.find((candidate) => candidate.jobId === "investigate.background");
  if (!agent || agent.status === "paused") return;
  const inputSummary = `Look up ${founder.name}'s work history with ${people.vendor}.`;
  try {
    const record = await people.enrich({ name: founder.name, company: founder.company.name });
    const confident = record !== null && (record.matchConfidence ?? 0) >= VENDOR_MATCH_FLOOR;
    const excerpt = confident ? redactSensitive(vendorExcerpt(record)) : "";
    if (!confident || !excerpt) {
      runtime.recordPlainTask({
        agent, stage: "investigate", jobId: "investigate.background", status: "skipped",
        provider: NO_MODEL_PROVIDER, model: NO_MODEL_NAME, founderId: founder.id, inputSummary,
        skipReason: record ? "The vendor's match was not confident enough to use." : "The vendor has no record for this person.",
      });
      return;
    }
    const task = runtime.recordPlainTask({
      agent, stage: "investigate", jobId: "investigate.background", status: "succeeded",
      provider: NO_MODEL_PROVIDER, model: NO_MODEL_NAME, founderId: founder.id, inputSummary,
      outputSummary: `Found a record, last verified ${record.lastVerifiedAt ?? "at an unknown date"}.`, itemsOut: 1,
    });
    addEvidence(runtime, founder.id, task.id, "people_data", [{
      kind: "profile",
      // A pointer a person can open. Nothing here requests it.
      url: record.profileUrl,
      title: `Work history from ${record.vendor}`,
      excerpt,
      claim: `${record.vendor} records this work history and education for ${founder.name}${record.lastVerifiedAt ? `, last verified ${record.lastVerifiedAt}` : ""}.`,
      publishedAt: null,
    }]);
  } catch (error) {
    // A vendor being down or out of allowance must not cost the founder their investigation.
    recordFailedPlainTask(runtime, { agent, stage: "investigate", jobId: "investigate.background", founderId: founder.id, inputSummary, error });
  }
}

async function runInvestigate(runtime: EngineRuntime, assessmentCandidates: Set<string>): Promise<void> {
  runtime.setStage("investigate");
  const limit = numberParam("investigate.max_founders", runtime.resolve(null, "investigate.max_founders"), runtime.config);
  const candidates = recheckCandidates(runtime, Math.max(0, limit));
  const agents = runtime.agents.filter((agent) => isInvestigatorJob(agent.jobId));
  const selected: Founder[] = [];
  for (const founder of candidates) {
    if (noCall(founder.id, latestFeedback(runtime))) {
      assessmentCandidates.add(founder.id);
      continue;
    }
    if (selected.length >= Math.max(0, limit)) break;
    selected.push(founder);
  }

  await forEachConcurrent(selected, runtime.concurrency, runtime.stopped, async (founder) => {
    if (runtime.stopped()) return;
    const current = runtime.deps.store.getFounder(founder.id);
    if (!current) return;
    const history = runtime.deps.store.assessmentHistory(current.id);
    const previousAssessment = runtime.deps.store.latestAssessment(current.id);
    const previousJudgments = new Map(previousAssessment?.judgments.map((judgment) => [judgment.dimension, judgment]));
    const gaps: GapQuestion[] = previousAssessment
      ? DIMENSIONS.flatMap((dimension) => {
          const judgment = previousJudgments.get(dimension.id);
          return judgment && (judgment.level === null || judgment.confidence < 0.5)
            ? [{ dimension: dimension.id, label: dimension.label, question: dimension.question }]
            : [];
        })
      : [];
    const depthFor = (agent: Agent): InvestigateInput["depth"] => current.status === "needs_evidence" && history.length === 1
      ? "deep"
      : stringParam("investigate.depth", runtime.resolve(agent, "investigate.depth"), runtime.config) as InvestigateInput["depth"];
    await enrichFromVendor(runtime, current);
    const known = allEvidenceBriefs(runtime, current.id);
    const work = await Promise.all(agents.map(async (agent) => {
      if (runtime.stopped() || noCall(founder.id, latestFeedback(runtime))) return null;
      const jobId = agent.jobId as InvestigatorJobId;
      const depth = depthFor(agent);
      if (agent.status === "paused" || !getJob(jobId).enabled) {
        const result = await runtime.runJob({
          agent,
          stage: "investigate",
          jobId,
          input: {
            founder: founderBrief(runtime, current),
            thesis: runtime.swarm.thesis,
            known,
            depth,
            repo: null,
            gaps,
          },
          founderId: current.id,
        });
        return result ? { agent, jobId, current, result } : null;
      }

      let repo: RepoRef | null = null;
      let repoDir: string | null = null;
      let cleanup: (() => Promise<void>) | null = null;
      try {
        if (jobId === "investigate.code") {
          const repos = await runtime.deps.repos[runtime.run.sources].topRepos(current.links, current.simId, REPO_CANDIDATES);
          if (runtime.stopped()) return null;
          repo = pickRepo(repos, current);
          if (!repo) {
            runtime.recordPlainTask({
              agent,
              stage: "investigate",
              jobId,
              status: "skipped",
              provider: NO_MODEL_PROVIDER,
              model: NO_MODEL_NAME,
              founderId: current.id,
              inputSummary: `Find a public repository to review for ${current.name}.`,
              skipReason: "No public repository found",
            });
            return null;
          }
          if (runtime.run.sources === "live") {
            const checkout = await runtime.deps.repos.live.checkout(repo);
            cleanup = checkout.cleanup;
            // The checkout has no history, so authorship comes from the host's commit counts.
            // A failed lookup must not cost the review.
            const contributors = await runtime.deps.repos.live.contributors?.(checkout.repo).catch(() => null) ?? null;
            repo = { ...checkout.repo, contributors };
            repoDir = repo.localPath;
            if (!repoDir) {
              runtime.recordPlainTask({
                agent,
                stage: "investigate",
                jobId,
                status: "skipped",
                provider: NO_MODEL_PROVIDER,
                model: NO_MODEL_NAME,
                founderId: current.id,
                inputSummary: `Prepare ${repo.name} for read-only review by ${current.name}.`,
                skipReason: "The public repository could not be checked out for review.",
              });
              return null;
            }
          }
        }

        if (runtime.stopped() || noCall(founder.id, latestFeedback(runtime))) return null;

        const input: InvestigateInput = {
          founder: founderBrief(runtime, current),
          thesis: runtime.swarm.thesis,
          known,
          depth,
          repo,
          gaps,
        };
        const result = await runtime.runJob({
          agent,
          stage: "investigate",
          jobId,
          input,
          founderId: current.id,
          repoDir,
        });
        if (!result) return null;
        return { agent, jobId, current, result };
      } catch (error) {
        recordFailedPlainTask(runtime, {
          agent,
          stage: "investigate",
          jobId,
          founderId: current.id,
          inputSummary: jobId === "investigate.code"
            ? `Prepare a public repository for review by ${current.name}.`
            : `Investigate ${current.name} with ${jobId}.`,
          error,
        });
        return null;
      } finally {
        if (cleanup) {
          try {
            await cleanup();
          } catch (error) {
            runtime.deps.logger?.warn("Repository cleanup failed.", {
              founderId: current.id,
              jobId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }));
    let didWork = false;
    for (const entry of work) {
      if (!entry || entry.result.task.status !== "succeeded" || !entry.result.output) continue;
      didWork = true;
      applyProfileUpdate(runtime, current.id, entry.result.output.profile);
      const source = getJob(entry.jobId).source ?? "web";
      addEvidence(runtime, current.id, entry.result.task.id, source, entry.result.output.evidence);
      if (entry.jobId === "investigate.media" && "recordings" in entry.result.output) {
        await queueResearcherRecordings(runtime, current, entry.result.output.recordings);
      }
      runtime.persist();
    }
    if (didWork) {
      assessmentCandidates.add(founder.id);
      runtime.addStats({ investigated: 1 });
    }
  });
}

async function queueResearcherRecordings(
  runtime: EngineRuntime,
  founder: Founder,
  proposed: ReadonlyArray<{ url: string; title: string; kind: Recording["kind"] }>,
): Promise<void> {
  const checkAddress = runtime.deps.media?.checkAddress;
  if (!checkAddress) return;
  const existing = new Set(runtime.deps.store.listRecordingsByFounder(founder.id)
    .flatMap((recording) => recording.sourceUrl ? [recording.sourceUrl] : []));
  let added = 0;
  const at = runtime.now().toISOString();
  for (const item of proposed) {
    if (added >= 3) break;
    const title = item.title.trim();
    if (!title || title.length > 200 || findSensitive(title).length > 0) continue;
    let checked;
    try {
      checked = await checkAddress(item.url);
    } catch {
      continue;
    }
    if ("kind" in checked || existing.has(checked.url)) continue;
    existing.add(checked.url);
    runtime.deps.store.insertRecording({
      id: newId("rcd"),
      swarmId: founder.swarmId,
      founderId: founder.id,
      kind: item.kind,
      title,
      sourceUrl: checked.url,
      addedBy: "researcher",
      status: "queued",
      detail: "",
      durationSec: null,
      transcript: null,
      createdAt: at,
      updatedAt: at,
    });
    added += 1;
  }
}

async function runMedia(runtime: EngineRuntime, assessmentCandidates: Set<string>): Promise<void> {
  if (!booleanParam("media.enabled", runtime.resolve(null, "media.enabled"), runtime.config)) return;
  const transcriber = runtime.brain === "sim" ? runtime.deps.transcriber?.sim : runtime.deps.transcriber?.live;
  const maxSeconds = numberParam("media.max_minutes_per_run", runtime.resolve(null, "media.max_minutes_per_run"), runtime.config) * 60;
  let usedSeconds = 0;
  const readAgent = runtime.agents.find((agent) => agent.jobId === "media.read");
  if (!readAgent || readAgent.status === "paused") return;
  const queued = runtime.deps.store.listRecordingsByStatus(runtime.swarm.id, "queued");
  for (const recording of queued) {
    if (runtime.stopped() || usedSeconds >= maxSeconds) break;
    if (!recording.transcript && !transcriber) return;
    let filePath: string | null = null;
    let removeFetchedFile = false;
    try {
      const founder = runtime.deps.store.getFounder(recording.founderId);
      if (!founder || founder.swarmId !== runtime.swarm.id) throw new Error("The recording founder is unavailable.");
      const at = runtime.now().toISOString();
      const remainingSeconds = Math.max(0, maxSeconds - usedSeconds);
      const simulated = runtime.brain === "sim" && founder.simId !== null;
      let transcript: { text: string; segments: Array<{ startSec: number; endSec: number; text: string }>; durationSec: number; model: string; costUsd: number | null };
      let plannedSeconds: number;
      const refuse = (detail: string, extra: { durationSec?: number; transcript?: Recording["transcript"] } = {}) => {
        runtime.deps.store.updateRecording(recording.id, {
          status: "refused",
          detail: detail.replace(/\s+/gu, " ").slice(0, 240),
          ...extra,
          updatedAt: runtime.now().toISOString(),
        });
      };

      if (recording.transcript) {
        plannedSeconds = recording.durationSec ?? Math.max(0, ...recording.transcript.segments.map((segment) => segment.endSec));
        if (!Number.isFinite(plannedSeconds) || plannedSeconds <= 0) {
          refuse("The recording length is unknown.");
          continue;
        }
        if (plannedSeconds > remainingSeconds) {
          refuse("The recording is longer than the remaining run allowance.", { durationSec: plannedSeconds });
          continue;
        }
        usedSeconds += plannedSeconds;
        transcript = { ...recording.transcript, durationSec: plannedSeconds, costUsd: null };
      } else if (simulated) {
        plannedSeconds = 180;
        if (plannedSeconds > remainingSeconds) {
          refuse("The recording is longer than the remaining run allowance.", { durationSec: plannedSeconds });
          continue;
        }
        usedSeconds += plannedSeconds;
        runtime.deps.store.updateRecording(recording.id, { status: "transcribing", detail: "", durationSec: plannedSeconds, updatedAt: at });
        transcript = await transcriber!.transcribe(`sim:${recording.id}`, {
          signal: runtime.signal,
          simulatedFounder: { simId: founder.simId!, name: founder.name },
        });
      } else {
        if (recording.sourceUrl) {
          if (!runtime.deps.media) throw new Error("This recording has no media reader.");
          const fetched = await runtime.deps.media.fetch(recording.sourceUrl, runtime.deps.dataDir ?? "data", { signal: runtime.signal });
          if ("refused" in fetched) {
            refuse(fetched.refused);
            continue;
          }
          filePath = fetched.path;
          removeFetchedFile = true;
        } else {
          filePath = join(runtime.deps.dataDir ?? "data", "recordings", `${recording.id}.media`);
        }
        const fileInfo = await stat(filePath);
        const probed = await runtime.deps.media?.probeDuration?.(filePath, { signal: runtime.signal }) ?? null;
        if (probed === null) {
          // The length could not be measured, so it is bounded from the file's size: speech is not
          // encoded below about 6 kbit/s, so a file of this size cannot run longer than this. A
          // higher figure here would let a long, heavily compressed recording through.
          plannedSeconds = Math.ceil((fileInfo.size * 8) / LOWEST_SPEECH_BITRATE);
          if (!Number.isFinite(plannedSeconds) || plannedSeconds <= 0 || plannedSeconds > remainingSeconds) {
            refuse("The recording length is unknown and it may exceed the run allowance.");
            continue;
          }
        } else {
          plannedSeconds = probed;
          if (plannedSeconds > remainingSeconds) {
            refuse("The recording is longer than the remaining run allowance.", { durationSec: plannedSeconds });
            continue;
          }
        }
        usedSeconds += plannedSeconds;
        runtime.deps.store.updateRecording(recording.id, { status: "transcribing", detail: "", durationSec: plannedSeconds, updatedAt: at });
        transcript = await transcriber!.transcribe(filePath, { signal: runtime.signal });
      }

      const durationSec = Number.isFinite(transcript.durationSec) && transcript.durationSec > 0 ? transcript.durationSec : plannedSeconds;
      if (durationSec !== plannedSeconds) usedSeconds = Math.max(0, usedSeconds - plannedSeconds + durationSec);
      const safeTranscript = {
        text: redactSensitive(transcript.text),
        segments: transcript.segments.map((segment) => ({ ...segment, text: redactSensitive(segment.text) })),
        model: transcript.model,
      };
      if (usedSeconds > maxSeconds) {
        refuse("The recording is longer than the remaining run allowance.", { durationSec, transcript: safeTranscript });
        continue;
      }
      runtime.deps.store.updateRecording(recording.id, {
        status: "transcribing", detail: "", durationSec,
        transcript: safeTranscript, updatedAt: runtime.now().toISOString(),
      });
      if (transcript.costUsd !== null && Number.isFinite(transcript.costUsd) && transcript.costUsd >= 0) {
        runtime.recordPlainTask({
          agent: readAgent,
          stage: "investigate",
          jobId: "media.read",
          status: "succeeded",
          provider: runtime.brain === "sim" ? "sim" : "openai-api",
          model: transcript.model,
          inputSummary: `Transcribe ${recording.title}`,
          outputSummary: `Transcribed ${Math.ceil(durationSec / 60)} minute(s).`,
          founderId: founder.id,
          output: { durationSec, model: transcript.model },
          costUsd: transcript.costUsd,
        });
      }
      const spans: Array<Array<{ startSec: number; endSec: number; text: string }>> = [];
      let span: Array<{ startSec: number; endSec: number; text: string }> = [];
      let spanLength = 0;
      for (const segment of safeTranscript.segments) {
        if (span.length && spanLength + segment.text.length > 4000) { spans.push(span); span = []; spanLength = 0; }
        span.push(segment);
        spanLength += segment.text.length;
      }
      if (span.length) spans.push(span);
      for (let index = 0; index < spans.length; index++) {
        if (runtime.stopped()) break;
        const stretch = spans[index]!;
        const input: MediaReadInput = { founder: founderBrief(runtime, founder), title: recording.title, kind: recording.kind, stretch };
        const task = await runtime.runJob({ agent: readAgent, stage: "investigate", jobId: "media.read", input, founderId: founder.id, routeKey: `${recording.id}:${index}` });
        if (!task?.output) continue;
        const fullText = stretch.map((segment) => segment.text).join(" ");
        const drafts = task.output.evidence.filter((item) => onPage(fullText, item.excerpt));
        const evidenceDrafts: EvidenceDraft[] = drafts.map((item) => ({
          kind: item.kind,
          url: `${recording.sourceUrl ?? `recording:${recording.id}`}#t=${Math.floor(stretch.find((segment) => onPage(segment.text, item.excerpt))?.startSec ?? stretch[0]?.startSec ?? 0)}`,
          title: recording.title,
          excerpt: item.excerpt,
          claim: item.claim,
          publishedAt: null,
        }));
        addEvidence(runtime, founder.id, task.task.id, "web", evidenceDrafts);
        for (const draft of evidenceDrafts) {
          const hash = hashEvidence("web", draft.url, draft.excerpt);
          const item = runtime.deps.store.listEvidence(founder.id).find((evidence) => evidence.hash === hash);
          if (item) runtime.deps.store.setQuote(item.id, "found");
        }
      }
      if (runtime.stopped()) break;
      runtime.deps.store.updateRecording(recording.id, { status: "ready", detail: "", updatedAt: runtime.now().toISOString() });
      assessmentCandidates.add(founder.id);
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, " ").slice(0, 240) || "Transcription failed.";
      runtime.deps.store.updateRecording(recording.id, { status: "failed", detail, updatedAt: runtime.now().toISOString() });
    } finally {
      if (removeFetchedFile && filePath) await rm(filePath, { force: true }).catch(() => undefined);
    }
  }
}

async function runVerify(runtime: EngineRuntime, assessmentCandidates: Set<string>): Promise<void> {
  runtime.setStage("verify");
  const agent = runtime.agents.find((candidate) => candidate.jobId === "verify.claims");
  if (!agent) return;
  const founders = runtime.deps.store.listFounders({ swarmId: runtime.swarm.id })
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
  const quoteCheckEnabled = booleanParam("verify.quote_check", runtime.resolve(agent, "verify.quote_check"), runtime.config);
  const controlEnabled = booleanParam("verify.control", runtime.resolve(agent, "verify.control"), runtime.config);

  await forEachConcurrent(founders, runtime.concurrency, runtime.stopped, async (founder) => {
    if (runtime.stopped()) return;
    let evidence = runtime.deps.store.listEvidence(founder.id, { verifications: ["unverified"] })
      .filter((item) => item.kind !== "call_transcript" || item.url?.includes("#t=") === true);
    if (evidence.length === 0) return;

    if (runtime.deps.quotes && runtime.run.sources === "live" && quoteCheckEnabled) {
      const eligible = evidence.filter((item) => {
        if (item.source !== "web" || item.kind === "code_review" || !item.url || item.url.includes("#t=")) return false;
        try {
          const protocol = new URL(item.url).protocol;
          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      });
      let rejectedByQuote = 0;
      await forEachConcurrent(eligible, Math.min(runtime.concurrency, 3), runtime.stopped, async (item) => {
        if (runtime.stopped()) return;
        let status: "found" | "not_found" | "unreachable";
        try {
          ({ status } = await runtime.deps.quotes!.check(item.url!, item.excerpt, runtime.signal));
        } catch {
          status = "unreachable";
        }
        runtime.deps.store.setQuote(item.id, status);
        item.quote = status;
        if (status === "not_found") {
          runtime.deps.store.setVerification(item.id, "unsupported", "The quoted words are not on the page it cites.");
          rejectedByQuote += 1;
        }
      });
      if (rejectedByQuote > 0) {
        runtime.addStats({ evidenceRejected: rejectedByQuote, quotesRejected: rejectedByQuote });
        assessmentCandidates.add(founder.id);
      }
      evidence = evidence.filter((item) => item.quote !== "not_found");
    }
    if (evidence.length === 0 || runtime.stopped()) return;

    const batchBriefs = evidence.map(evidenceBrief);
    let controlId: string | null = null;
    if (controlEnabled) {
      const rng = createRng(hashSeed(runtime.run.id, agent.id, founder.id, 1));
      const control = plantControl(batchBriefs, rng, `${runtime.run.id}:${founder.id}`);
      if (control) {
        const insertAt = Math.floor(rng() * (batchBriefs.length + 1));
        controlId = control.id;
        batchBriefs.splice(insertAt, 0, control.brief);
      }
    }

    const input: VerifyInput = { founder: founderBrief(runtime, founder), evidence: batchBriefs };
    const result = await runtime.runJob({ agent, stage: "verify", jobId: "verify.claims", input, founderId: founder.id });
    if (!result || result.task.status !== "succeeded" || !result.output) return;

    const controlVerdict = controlId
      ? result.output.verdicts.find((verdict) => verdict.evidenceId === controlId)?.verdict
      : undefined;
    const controlFailed = controlId !== null && controlVerdict === "supported";
    if (controlId !== null) {
      const safeOutput = {
        ...result.output,
        verdicts: result.output.verdicts.filter((verdict) => verdict.evidenceId !== controlId),
      };
      runtime.deps.store.updateTask(result.task.id, {
        control: controlFailed ? "failed" : "passed",
        output: safeOutput,
        outputSummary: runtime.deps.jobs.get("verify.claims").summarizeOutput(safeOutput),
      });
      if (controlFailed) runtime.addStats({ controlsFailed: 1 });
    }
    if (controlFailed) {
      runtime.persist();
      return;
    }

    const evidenceIds = new Set(evidence.map((item) => item.id));
    const verdicts = new Map(result.output.verdicts
      .filter((verdict) => evidenceIds.has(verdict.evidenceId))
      .map((verdict) => [verdict.evidenceId, verdict] as const));
    let rejected = 0;
    for (const [evidenceId, verdict] of verdicts) {
      runtime.deps.store.setVerification(evidenceId, verdict.verdict, verdict.note);
      if (verdict.verdict !== "supported") rejected += 1;
    }
    runtime.deps.store.updateFounder(founder.id, {
      identityConfidence: Math.min(1, Math.max(0, result.output.identityConfidence)),
      updatedAt: runtime.now().toISOString(),
    });
    if (rejected > 0) runtime.addStats({ evidenceRejected: rejected });
    if (verdicts.size > 0) assessmentCandidates.add(founder.id);
    runtime.persist();
  });
}

function partnerNotes(runtime: EngineRuntime, founderId: string): string[] {
  return runtime.deps.store.allFeedback(runtime.swarm.id)
    .filter((call) => call.founderId === founderId)
    .map((call) => {
      const reasons = call.reasonTags.map(reasonLabel).filter(Boolean);
      const note = call.note?.trim() ?? "";
      const reasonText = reasons.length > 0 ? ` (${reasons.join("; ")})` : "";
      return `${call.verdict === "yes" ? "Yes" : "No"}${reasonText}${note ? `: ${note}` : ""}`;
    });
}

function assessmentStatus(decision: Assessment["decision"]): Founder["status"] {
  switch (decision) {
    case "surface": return "surfaced";
    case "needs_evidence": return "needs_evidence";
    case "watch": return "watch";
    case "pass": return "passed";
  }
}

async function runAssess(runtime: EngineRuntime, candidateIds: Set<string>): Promise<void> {
  runtime.setStage("assess");
  const agent = runtime.agents.find((candidate) => candidate.jobId === "assess.judgments");
  if (!agent) return;
  const thresholds = effectiveThresholds(runtime.resolve(null, "assess.surface_threshold"), runtime.config);
  const weights = effectiveWeights(runtime.resolve(null, "weights.built_hard_things"), runtime.config);
  const recheckDays = numberParam("recheck.days", runtime.resolve(null, "recheck.days"), runtime.config);
  const evidenceIds = new Set(candidateIds);

  const founderIds = [...evidenceIds].sort();
  await forEachConcurrent(founderIds, runtime.concurrency, runtime.stopped, async (founderId) => {
    if (runtime.stopped()) return;
    const founder = runtime.deps.store.getFounder(founderId);
    if (!founder || founder.swarmId !== runtime.swarm.id) return;
    // The analyst sees only what the fact-checker supported. If nothing has been checked yet
    // (the fact-check failed or was paused), the founder waits for a later run instead of being
    // scored on nothing and passed.
    const founderEvidence = (verifications: Evidence["verification"][]) => runtime.deps.store
      .listEvidence(founder.id, { verifications })
      .filter((item) => !item.facet && !(item.kind === "call_transcript" && item.collectedByTaskId === null));
    const evidence = founderEvidence(["supported"]);
    if (evidence.length === 0 && founderEvidence(["unverified"]).length > 0) return;
    const input: AssessInput = {
      founder: founderBrief(runtime, founder),
      thesis: runtime.swarm.thesis,
      evidence: evidence.map(evidenceBrief),
      partnerNotes: partnerNotes(runtime, founder.id),
    };
    const result = await runtime.runJob({ agent, stage: "assess", jobId: "assess.judgments", input, founderId: founder.id });
    if (!result) return;
    if (result.task.status !== "succeeded" || !result.output) return;

    // An answer counts only if it rests on verified evidence that was actually supplied.
    const judgments = groundJudgments(result.output.judgments, new Set(input.evidence.map((item) => item.id)));
    const score = scoreFounder({
      judgments,
      weights,
      thresholds,
      fit: founder.fit,
    });
    const createdAt = runtime.now().toISOString();
    const assessment: Assessment = {
      id: stableId("asm", `${runtime.run.id}:${founder.id}`),
      founderId: founder.id,
      runId: runtime.run.id,
      configId: runtime.config.id,
      composite: score.composite,
      cracked: score.cracked,
      founderScore: score.founder,
      coverage: score.coverage,
      potential: score.potential,
      fit: founder.fit,
      decision: score.decision,
      reasons: score.reasons,
      flags: score.flags,
      breakdown: score.breakdown,
      judgments,
      summary: result.output.summary.trim(),
      memo: null,
      createdAt,
    };
    runtime.deps.store.insertAssessment(assessment);
    const history = runtime.deps.store.assessmentHistory(founder.id);
    const currentFounder = runtime.deps.store.getFounder(founder.id) ?? founder;
    const isNo = noCall(founder.id, latestFeedback(runtime));
    const preserveStatus = isNo || currentFounder.status === "contacted" || currentFounder.status === "meeting" || currentFounder.status === "archived";
    const immediateDeepFollowUp = score.decision === "needs_evidence" && history.length === 1;
    const nextRecheckAt = preserveStatus
      ? (isNo ? null : currentFounder.nextRecheckAt)
      : immediateDeepFollowUp
        ? createdAt
      : score.decision === "watch" || score.decision === "needs_evidence"
        ? new Date(runtime.now().getTime() + recheckDays * 24 * 60 * 60 * 1000).toISOString()
        : null;
    runtime.deps.store.updateFounder(founder.id, {
      status: preserveStatus ? currentFounder.status : assessmentStatus(score.decision),
      lastAssessedAt: createdAt,
      nextRecheckAt,
      updatedAt: createdAt,
    });
    runtime.addStats({
      assessed: 1,
      surfaced: score.decision === "surface" ? 1 : 0,
      needsEvidence: score.decision === "needs_evidence" ? 1 : 0,
      watch: score.decision === "watch" ? 1 : 0,
      passed: score.decision === "pass" ? 1 : 0,
    });
  });
}

/** Execute the core lifecycle stages in their contract order. */
export async function runPipelineStages(runtime: EngineRuntime): Promise<void> {
  const assessmentCandidates = new Set<string>();

  if (runtime.run.scope === "hunt") {
    // The hunt alone: what an outside agent's wave and an eval's trial ask for. The people found
    // are matched and screened so the trails learn who was kept. Everything that costs real
    // money (research, fact-checking, assessment, outreach) waits for a full run.
    const found = new Map<string, string>();
    await runHunt(runtime, found);
    if (runtime.stopped()) return;
    await runResolve(runtime, found);
    if (runtime.stopped()) return;
    await runScreen(runtime);
    return;
  }

  if (!(await runDebrief(runtime, assessmentCandidates))) return;
  if (runtime.stopped()) return;
  const simIdsByLead = await runScout(runtime);
  if (runtime.stopped()) return;
  await runHunt(runtime, simIdsByLead);
  if (runtime.stopped()) return;
  await runResolve(runtime, simIdsByLead);
  if (runtime.stopped()) return;
  await runScreen(runtime);
  if (runtime.stopped()) return;
  await runInvestigate(runtime, assessmentCandidates);
  if (runtime.stopped()) return;
  await runMedia(runtime, assessmentCandidates);
  if (runtime.stopped()) return;
  // Companies: match them to founders, then research the ones worth a look. Their evidence is
  // filed under a founder, so the fact-check below covers it with everything else.
  const companyCandidates = new Set<string>();
  await runCompanyResolve(runtime);
  if (runtime.stopped()) return;
  await runCompanyResearch(runtime, companyCandidates);
  if (runtime.stopped()) return;
  await runVerify(runtime, assessmentCandidates);
  if (runtime.stopped()) return;
  await runAssess(runtime, assessmentCandidates);
  if (runtime.stopped()) return;
  // After the founders, because a company's decision uses its lead founder's fresh score.
  await runCompanyAssess(runtime, companyCandidates);
}
