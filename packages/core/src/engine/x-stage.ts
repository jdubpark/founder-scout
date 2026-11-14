import {
  booleanParam,
  getJob,
  latestCalls,
  numberParam,
  stableId,
  stringParam,
} from "@agentswarm/shared";
import type {
  Agent,
  Evidence,
  EvidenceDraft,
  Founder,
  ModelJobId,
  VerifyInput,
  StageId,
  XEvidenceDraft,
  XInvestigateInput,
} from "@agentswarm/shared";
import { cleanXHandle, quoteInPost, X_POST_REMOVED, xHandleOf, xPostId, xPostIds } from "@agentswarm/shared";
import type { XPost } from "../contracts";
import { plantControl, redactSensitive } from "../jobs";
import { createRng, hashSeed } from "../sim";
import type { EngineRuntime } from "./runtime";
import { addEvidence, evidenceBrief, founderBrief, hashEvidence, noCall, openInvestigationGaps } from "./pipeline";
import { forEachConcurrent } from "./runtime";
import { forgetPosts, readXPosts } from "./hunt";

const X_UNAVAILABLE_REASON = "xAI is not connected, so no X account was read.";
const unavailableRecorded = new WeakSet<EngineRuntime>();
const readinessByRuntime = new WeakMap<EngineRuntime, Promise<boolean>>();

/** Share one readiness check between the X read and verify stages in this run. */
export function xReadyForRun(runtime: EngineRuntime): Promise<boolean> {
  const existing = readinessByRuntime.get(runtime);
  if (existing) return existing;
  const ready = runtime.deps.xReady
    ? Promise.resolve().then(() => runtime.deps.xReady!()).then(Boolean).catch(() => false)
    : Promise.resolve(false);
  readinessByRuntime.set(runtime, ready);
  return ready;
}

function recordUnavailable(runtime: EngineRuntime, agent: Agent, stage: StageId, jobId: "investigate.x" | "verify.x"): void {
  if (unavailableRecorded.has(runtime)) return;
  unavailableRecorded.add(runtime);
  runtime.recordPlainTask({
    agent,
    stage,
    jobId,
    status: "skipped",
    provider: "sim",
    model: "none",
    inputSummary: "Read founders' X accounts for recent posts and evidence.",
    skipReason: X_UNAVAILABLE_REASON,
  });
}

function requestedHandle(founder: Founder, evidence: readonly Evidence[]): string | null {
  const fromProfile = xHandleOf(founder.links.x);
  if (fromProfile) return fromProfile;
  for (const item of evidence) {
    if (item.source !== "x" || item.verification !== "supported") continue;
    const fromSupportedPost = xHandleOf(item.url);
    if (fromSupportedPost) return fromSupportedPost;
  }
  return null;
}

function fromDate(runtime: EngineRuntime, agent: Agent): string {
  const days = numberParam("x.lookback_days", runtime.resolve(agent, "x.lookback_days"), runtime.config);
  const today = runtime.now();
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  from.setUTCDate(from.getUTCDate() - days);
  return from.toISOString().slice(0, 10);
}

function countTitle(handle: string, draft: Pick<XEvidenceDraft, "likes" | "reposts" | "replies" | "views">, reporter = "xAI"): string {
  const counts: string[] = [];
  if (draft.likes !== null) counts.push(`${new Intl.NumberFormat("en-US").format(draft.likes)} likes`);
  if (draft.reposts !== null) counts.push(`${new Intl.NumberFormat("en-US").format(draft.reposts)} reposts`);
  if (draft.replies !== null) counts.push(`${new Intl.NumberFormat("en-US").format(draft.replies)} replies`);
  if (draft.views !== null) counts.push(`${new Intl.NumberFormat("en-US").format(draft.views)} views`);
  return `Post by @${handle} on X${counts.length > 0 ? ` (${reporter} reports: ${counts.join(", ")})` : ""}`;
}

/** Stored posts re-read in one run. The reader's own ceiling on posts a day may allow fewer. */
const REFRESH_PER_RUN = 200;

/**
 * X requires stored posts to be removed when they are removed on X. Each run re-reads some of
 * the posts on file and takes out the words of any X no longer shows. Where it starts is drawn
 * afresh each run: the day's allowance may cover only the first few it asks for, and a fixed
 * order would then never reach the rest.
 */
async function refreshStoredPosts(
  runtime: EngineRuntime,
  founders: readonly Founder[],
  alreadyRead: ReadonlySet<string>,
  assessmentCandidates: Set<string>,
): Promise<void> {
  if (runtime.stopped()) return;
  const postIds = new Set<string>();
  const addPost = (address: string | null | undefined): void => {
    const postId = xPostId(address);
    if (postId && !alreadyRead.has(postId)) postIds.add(postId);
  };
  for (const founder of founders) {
    for (const item of runtime.deps.store.listEvidence(founder.id)) {
      if (item.source === "x" && item.title !== X_POST_REMOVED.title) addPost(item.url);
    }
  }
  for (const lead of runtime.deps.store.listLeads({ swarmId: runtime.swarm.id })) {
    if (lead.source === "x" && lead.quote?.trim()) addPost(lead.sourceRef);
  }
  const hunt = runtime.deps.store.getHunt(runtime.swarm.id);
  if (hunt) {
    for (const item of runtime.deps.store.listFrontier(hunt.id)) {
      if (item.held) addPost(item.target);
    }
  }
  const uniqueIds = [...postIds].sort((a, b) => a.localeCompare(b));
  if (uniqueIds.length === 0) return;

  const start = Math.floor(createRng(hashSeed(runtime.run.id, "x-refresh"))() * uniqueIds.length);
  const count = Math.min(REFRESH_PER_RUN, uniqueIds.length);
  const ids = Array.from({ length: count }, (_, index) => uniqueIds[(start + index) % uniqueIds.length]!);
  const { gone } = await readXPosts(runtime, ids);
  if (runtime.stopped()) return;
  if (gone.size === 0) return;
  const currentFounders = new Set(founders.map((founder) => founder.id));
  for (const founderId of forgetPosts(runtime, gone)) {
    if (currentFounders.has(founderId)) assessmentCandidates.add(founderId);
  }
}

/**
 * Reads each new post through X's own API and looks for the quoted words in it, as the quote
 * check does for a page. An item code has already looked at is not read again here; the
 * refresh comes round to it. Returns the ids it asked for.
 */
async function checkPostQuotes(
  runtime: EngineRuntime,
  founders: readonly Founder[],
  assessmentCandidates: Set<string>,
): Promise<Set<string>> {
  const pending = founders.flatMap((founder) => runtime.deps.store.listEvidence(founder.id, { verifications: ["unverified"] })
    .filter((item) => item.source === "x" && item.kind !== "profile" && !item.quote)
    .flatMap((item) => {
      const postId = xPostId(item.url);
      return postId ? [{ founderId: founder.id, item, postId }] : [];
    }));
  const ids = new Set(pending.map((entry) => entry.postId));
  if (pending.length === 0 || runtime.stopped()) return ids;
  const { posts, gone } = await readXPosts(runtime, [...ids]);
  if (runtime.stopped()) return ids;

  const currentFounders = new Set(founders.map((founder) => founder.id));
  if (gone.size > 0) {
    for (const founderId of forgetPosts(runtime, gone)) {
      if (currentFounders.has(founderId)) assessmentCandidates.add(founderId);
    }
  }

  let rejected = 0;
  for (const { founderId, item, postId } of pending) {
    if (runtime.stopped()) break;
    const post = posts.get(postId);
    if (gone.has(postId)) {
      rejected += 1;
      continue;
    }
    if (!post) continue;

    const addressedHandle = xHandleOf(item.url);
    if (addressedHandle && addressedHandle !== post.handle) {
      runtime.deps.store.setQuote(item.id, "not_found");
      runtime.deps.store.setVerification(item.id, "unsupported", "X gives this post to another account.");
      assessmentCandidates.add(founderId);
      rejected += 1;
      continue;
    }

    let quote: "found" | "not_found" | "unreachable";
    if (item.kind === "video") quote = "unreachable";
    else {
      const match = quoteInPost(post.text, item.excerpt);
      quote = match.status === "too_short" ? "unreachable" : match.status;
    }
    runtime.deps.store.setQuote(item.id, quote);
    item.quote = quote;
    if (quote === "not_found") {
      runtime.deps.store.setVerification(item.id, "unsupported", "The quoted words are not in the post.");
      assessmentCandidates.add(founderId);
      rejected += 1;
      continue;
    }

    const publishedAt = post.createdAt ? post.createdAt.slice(0, 10) : undefined;
    runtime.deps.store.updateEvidence(item.id, {
      title: countTitle(post.handle, post, "X"),
      ...(publishedAt ? { publishedAt } : {}),
    });
  }
  if (rejected > 0) {
    runtime.addStats({ evidenceRejected: rejected, quotesRejected: rejected });
    runtime.persist();
  }
  return ids;
}

function addCompanyEvidence(
  runtime: EngineRuntime,
  founderId: string,
  companyId: string,
  taskId: string,
  accountHandle: string | null,
  drafts: readonly XEvidenceDraft[],
): number {
  let inserted = 0;
  for (const draft of drafts) {
    if (runtime.stopped()) break;
    const excerpt = draft.excerpt.trim().slice(0, 1200);
    const claim = draft.claim.trim();
    if (!excerpt || !claim || !draft.url.trim()) continue;
    const hash = hashEvidence("x", draft.url, `company-evidence:${companyId}:${excerpt}`);
    const evidence: Evidence = {
      id: stableId("evd", `${runtime.run.id}:${taskId}:${hash}`),
      founderId,
      companyId,
      facet: draft.facet,
      kind: draft.kind,
      source: "x",
      url: draft.url.trim(),
      title: countTitle(xHandleOf(draft.url) ?? accountHandle ?? "unknown", draft),
      excerpt,
      claim,
      publishedAt: draft.publishedAt,
      capturedAt: runtime.now().toISOString(),
      collectedByTaskId: taskId,
      hash,
      verification: "unverified",
      verificationNote: null,
      sim: null,
    };
    if (runtime.deps.store.insertEvidence(evidence)) inserted += 1;
  }
  if (inserted > 0) runtime.addStats({ evidence: inserted });
  return inserted;
}

function addPostEvidence(
  runtime: EngineRuntime,
  founder: Founder,
  accountHandle: string | null,
  taskId: string,
  drafts: readonly XEvidenceDraft[],
  companyCandidates: Set<string>,
  onFile: ReadonlySet<string>,
): { founderInserted: number; companyInserted: number } {
  const founderDrafts: EvidenceDraft[] = [];
  const companyDrafts: XEvidenceDraft[] = [];
  for (const draft of drafts) {
    const postId = xPostId(draft.url);
    if (postId && onFile.has(filedKey(postId, draft.facet))) continue;
    if (draft.facet !== null) {
      if (founder.companyId && (xHandleOf(draft.url) ?? accountHandle)) companyDrafts.push(draft);
      continue;
    }
    const handle = xHandleOf(draft.url) ?? accountHandle;
    if (!handle) continue;
    founderDrafts.push({
      kind: draft.kind,
      url: draft.url,
      title: countTitle(handle, draft),
      excerpt: draft.excerpt,
      claim: draft.claim,
      publishedAt: draft.publishedAt,
    });
  }
  const founderInserted = addEvidence(runtime, founder.id, taskId, "x", founderDrafts);
  const companyInserted = founder.companyId
    ? addCompanyEvidence(runtime, founder.id, founder.companyId, taskId, accountHandle, companyDrafts)
    : 0;
  if (companyInserted > 0 && founder.companyId) companyCandidates.add(founder.companyId);
  return { founderInserted, companyInserted };
}

/** One post is filed once for the founder and once for each company facet it speaks to. */
const filedKey = (postId: string, facet: string | null | undefined): string => `${postId}:${facet ?? ""}`;

function addAccountEvidence(
  runtime: EngineRuntime,
  founder: Founder,
  taskId: string,
  handle: string,
  account: NonNullable<import("@agentswarm/shared").XInvestigateOutput["account"]>,
): number {
  if (runtime.deps.store.listEvidence(founder.id).some((item) => item.source === "x" && item.kind === "profile")) return 0;
  const followers = account.followers === null ? "" : ` ${account.followers} followers, as xAI's model reported.`;
  const excerpt = `${account.name} (@${handle}).${followers} ${account.identity}`;
  return addEvidence(runtime, founder.id, taskId, "x", [{
    kind: "profile",
    url: `https://x.com/${handle}`,
    title: `X account @${handle}`,
    excerpt,
    claim: `xAI's model ties the X account @${handle} to ${founder.name}.`,
    publishedAt: null,
  }]);
}

/** Read one X account per founder selected by the ordinary investigator stage. */
export async function runXRead(
  runtime: EngineRuntime,
  founderIds: readonly string[],
  assessmentCandidates: Set<string>,
  companyCandidates: Set<string>,
): Promise<void> {
  const agent = runtime.agents.find((candidate) => candidate.jobId === "investigate.x");
  if (runtime.run.sources !== "live" || runtime.brain !== "live"
    || !booleanParam("x.enabled", runtime.resolve(null, "x.enabled"), runtime.config)
    || !agent || agent.status === "paused" || !getJob("investigate.x").enabled
    || founderIds.length === 0) return;

  if (!(await xReadyForRun(runtime))) {
    recordUnavailable(runtime, agent, "investigate", "investigate.x");
    return;
  }

  await forEachConcurrent(founderIds, runtime.concurrency, runtime.stopped, async (founderId) => {
    if (runtime.stopped()) return;
    const founder = runtime.deps.store.getFounder(founderId);
    if (!founder || founder.swarmId !== runtime.swarm.id || founder.simId) return;
    if (noCall(founder.id, latestCalls(runtime.deps.store.allFeedback(runtime.swarm.id)))) return;
    const priorX = runtime.deps.store.listEvidence(founder.id).filter((item) => item.source === "x");
    const handle = requestedHandle(founder, priorX);
    const input: XInvestigateInput = {
      founder: founderBrief(runtime, founder),
      thesis: runtime.swarm.thesis,
      // Company facts are filed under the lead founder but belong to the company's pool, and no
      // company evidence crosses back to a founder's researcher. Code, not the prompt, keeps a
      // company post from being filed twice (`onFile` below).
      known: priorX.filter((item) => !item.facet).map(evidenceBrief),
      depth: stringParam("investigate.depth", runtime.resolve(agent, "investigate.depth"), runtime.config) as XInvestigateInput["depth"],
      gaps: openInvestigationGaps(runtime, founder.id),
      handle,
      fromDate: fromDate(runtime, agent),
      media: booleanParam("x.media", runtime.resolve(agent, "x.media"), runtime.config),
    };
    const inputSummary = `Read X posts for ${founder.name}${handle ? ` (@${handle})` : ""}.`;
    try {
      const result = await runtime.runJob({ agent, stage: "investigate", jobId: "investigate.x", input, founderId: founder.id });
      if (!result || result.task.status !== "succeeded" || !result.output) return;
      if (!result.output.account) return;
      const accountHandle = cleanXHandle(result.output.account.handle) ?? handle;
      const onFile = new Set(priorX.flatMap((item) => {
        const postId = xPostId(item.url);
        return postId ? [filedKey(postId, item.facet)] : [];
      }));
      const postInsertions = addPostEvidence(runtime, founder, accountHandle, result.task.id, result.output.evidence, companyCandidates, onFile);
      const profileInserted = accountHandle
        ? addAccountEvidence(runtime, founder, result.task.id, accountHandle, result.output.account)
        : 0;
      if (postInsertions.founderInserted + profileInserted > 0) assessmentCandidates.add(founder.id);
      if (postInsertions.founderInserted + postInsertions.companyInserted + profileInserted > 0) runtime.persist();
    } catch (error) {
      const detail = redactSensitive(error instanceof Error ? error.message : String(error))
        .replace(/\s+/gu, " ")
        .slice(0, 240) || "X investigation failed.";
      runtime.recordPlainTask({
        agent,
        stage: "investigate",
        jobId: "investigate.x",
        status: "failed",
        provider: "sim",
        model: "none",
        founderId: founder.id,
        inputSummary,
        error: detail,
      });
    }
  });
}

/** The claims and X fact-checkers share batching, controls, verdict filtering, and stats. */
export async function verifyEvidenceBatch(
  runtime: EngineRuntime,
  founder: Founder,
  agent: Agent,
  jobId: "verify.claims" | "verify.x",
  evidence: readonly Evidence[],
  assessmentCandidates: Set<string>,
  options: { controlSeed: number; controlLabel: string; updateIdentityConfidence: boolean },
): Promise<void> {
  if (evidence.length === 0 || runtime.stopped()) return;
  const batchBriefs = evidence.map(evidenceBrief);
  let controlId: string | null = null;
  if (booleanParam("verify.control", runtime.resolve(agent, "verify.control"), runtime.config)) {
    const rng = createRng(hashSeed(runtime.run.id, agent.id, founder.id, options.controlSeed));
    const control = plantControl(batchBriefs, rng, options.controlLabel);
    if (control) {
      const insertAt = Math.floor(rng() * (batchBriefs.length + 1));
      controlId = control.id;
      batchBriefs.splice(insertAt, 0, control.brief);
    }
  }

  const input: VerifyInput = { founder: founderBrief(runtime, founder), evidence: batchBriefs };
  const result = await runtime.runJob({ agent, stage: "verify", jobId, input, founderId: founder.id });
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
      outputSummary: runtime.deps.jobs.get(jobId).summarizeOutput(safeOutput),
    });
    if (controlFailed) runtime.addStats({ controlsFailed: 1 });
  }
  if (controlFailed) {
    runtime.persist();
    return;
  }

  // On X, "supported" stands only for a post somebody read: one xAI's API lists among what
  // this call fetched, or one whose quoted words code found in the post through X's own API.
  // Any other stays unverified, whatever its verdict says. An item that is not a post (the
  // account itself) has no entry to look for and is judged as before. This runs after the
  // planted claim was judged on the raw verdicts, so it cannot hide a checker that accepted it.
  const fetched = jobId === "verify.x" ? xPostIds(result.cited ?? []) : null;
  const urlOf = new Map(evidence.map((item) => [item.id, item.url] as const));
  const quoteOf = new Map(evidence.map((item) => [item.id, item.quote] as const));
  const verdicts = new Map(result.output.verdicts
    .filter((verdict) => urlOf.has(verdict.evidenceId))
    .filter((verdict) => {
      if (!fetched || verdict.verdict !== "supported") return true;
      const postId = xPostId(urlOf.get(verdict.evidenceId));
      return !postId || fetched.has(postId) || quoteOf.get(verdict.evidenceId) === "found";
    })
    .map((verdict) => [verdict.evidenceId, verdict] as const));
  let rejected = 0;
  for (const [evidenceId, verdict] of verdicts) {
    runtime.deps.store.setVerification(evidenceId, verdict.verdict, verdict.note);
    if (verdict.verdict !== "supported") rejected += 1;
  }
  if (options.updateIdentityConfidence) {
    runtime.deps.store.updateFounder(founder.id, {
      identityConfidence: Math.min(1, Math.max(0, result.output.identityConfidence)),
      updatedAt: runtime.now().toISOString(),
    });
  }
  if (rejected > 0) runtime.addStats({ evidenceRejected: rejected });
  if (verdicts.size > 0) assessmentCandidates.add(founder.id);
  runtime.persist();
}

/**
 * A founder whose current assessment cites an item whose post has since been removed is
 * assessed again. Read from what is stored, so it holds whoever removed the post: this run,
 * the hunt, a run of another swarm, or a person. The analyst is shown supported evidence
 * only, so the new assessment cannot cite the item and this asks once.
 */
function assessAgainWithoutRemovedPosts(runtime: EngineRuntime, founders: readonly Founder[], assessmentCandidates: Set<string>): void {
  for (const founder of founders) {
    const removed = new Set(runtime.deps.store.listEvidence(founder.id, { verifications: ["unsupported"] })
      .filter((item) => item.source === "x" && item.title === X_POST_REMOVED.title)
      .map((item) => item.id));
    if (removed.size === 0) continue;
    const cited = runtime.deps.store.latestAssessment(founder.id)?.judgments
      .some((judgment) => [...judgment.evidenceIds, ...judgment.counterEvidenceIds].some((id) => removed.has(id)));
    if (cited) assessmentCandidates.add(founder.id);
  }
}

/** X posts stay unverified until xAI can fetch them again in its dedicated verifier. */
export async function runVerifyX(runtime: EngineRuntime, assessmentCandidates: Set<string>): Promise<void> {
  if (runtime.run.sources !== "live" || runtime.stopped()) return;
  const allFounders = runtime.deps.store.listFounders({ swarmId: runtime.swarm.id })
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
  const enabled = booleanParam("x.enabled", runtime.resolve(null, "x.enabled"), runtime.config);
  // New evidence first, so the day's allowance goes to it before the upkeep. The upkeep runs
  // even with X switched off: posts already on file still have to follow X.
  const justRead = enabled ? await checkPostQuotes(runtime, allFounders, assessmentCandidates) : new Set<string>();
  await refreshStoredPosts(runtime, allFounders, justRead, assessmentCandidates);
  assessAgainWithoutRemovedPosts(runtime, allFounders, assessmentCandidates);

  const agent = runtime.agents.find((candidate) => candidate.jobId === "verify.x");
  if (!enabled || !agent || agent.status === "paused" || !getJob("verify.x").enabled) return;
  const founders = runtime.deps.store.listFounders({ swarmId: runtime.swarm.id })
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id))
    .filter((founder) => runtime.deps.store.listEvidence(founder.id, { verifications: ["unverified"] })
      .some((item) => item.source === "x"));
  if (founders.length === 0) return;
  if (!(await xReadyForRun(runtime))) {
    return;
  }

  await forEachConcurrent(founders, runtime.concurrency, runtime.stopped, async (founder) => {
    if (runtime.stopped()) return;
    const evidence = runtime.deps.store.listEvidence(founder.id, { verifications: ["unverified"] })
      .filter((item) => item.source === "x");
    await verifyEvidenceBatch(runtime, founder, agent, "verify.x", evidence, assessmentCandidates, {
      controlSeed: 2,
      controlLabel: `${runtime.run.id}:${founder.id}:verify.x`,
      updateIdentityConfidence: false,
    });
  });
}
