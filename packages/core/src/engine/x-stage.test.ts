import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BASE_CONFIG,
  EMPTY_STEERING,
  getJob,
  X_POST_REMOVED,
  type Agent,
  type Company,
  type Founder,
  type TaskRun,
  type VerifyInput,
  type XInvestigateInput,
  type XInvestigateOutput,
} from "@agentswarm/shared";
import type { Evidence } from "@agentswarm/shared";
import type { XPost, XPostReader } from "../contracts";
import { createJobRegistry } from "../jobs";
import { openStore } from "../db";
import type { EngineRuntime } from "./runtime";
import { hashEvidence } from "./pipeline";
import { runVerifyX, runXRead } from "./x-stage";

const NOW = new Date("2026-11-12T18:00:00.000Z");
const SWARM_ID = "swm_x_stage";
const CONFIG_ID = "cfg_x_stage";
const THESIS = {
  summary: "Find technical founders building useful products.",
  sectors: ["Software"],
  stages: ["seed"],
  geos: ["Anywhere"],
  avoid: [],
};

const stores: Array<ReturnType<typeof openStore>> = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function makeAgent(jobId: Agent["jobId"]): Agent {
  const meta = getJob(jobId);
  return {
    id: `agt_${jobId.replace(/[^a-z0-9]/gi, "_")}`,
    swarmId: SWARM_ID,
    jobId,
    classId: meta.classId,
    name: meta.label,
    status: "active",
    beat: null,
    state: {},
    createdAt: NOW.toISOString(),
  };
}

function makeCompany(): Company {
  return {
    id: "co_x_stage",
    swarmId: SWARM_ID,
    name: "Northstar",
    domain: "northstar.example",
    url: "https://northstar.example",
    oneLiner: null,
    mission: null,
    tagline: null,
    sector: null,
    stage: null,
    links: { github: null, x: null, linkedin: null, docs: null, careers: null },
    status: "tracked",
    firstSeenAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    lastResearchedAt: null,
    lastAssessedAt: null,
    nextRecheckAt: null,
    simId: null,
  };
}

function makeFounder(id: string, companyId: string | null = null): Founder {
  return {
    id,
    swarmId: SWARM_ID,
    name: id === "fnd_x_person" ? "Ari Founder" : "Bea Founder",
    headline: "Founder",
    location: null,
    company: { name: "Northstar", url: "https://northstar.example", oneLiner: null, stage: "seed" },
    ...(companyId ? { companyId } : {}),
    links: { github: null, linkedin: null, x: "https://x.com/ari_founder", site: null, scholar: null },
    status: "queued",
    fit: 0.8,
    fitReasons: [],
    tags: [],
    identityConfidence: 0.7,
    sources: ["github"],
    firstSeenAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    lastAssessedAt: null,
    nextRecheckAt: null,
    simId: null,
  };
}

function makeOutput(): XInvestigateOutput {
  return {
    account: {
      handle: "ari_founder",
      name: "Ari Founder",
      followers: 1200,
      identity: "The account identifies Ari as the founder of Northstar.",
    },
    evidence: [
      {
        kind: "post",
        facet: null,
        url: "https://x.com/ari_founder/status/1234567890123",
        excerpt: "We shipped the first version of Northstar today.",
        claim: "Ari says they shipped Northstar's first version.",
        publishedAt: "2026-11-01T00:00:00.000Z",
        likes: 120,
        reposts: 14,
        replies: 3,
        views: 3400,
      },
      {
        kind: "launch",
        facet: "product",
        url: "https://x.com/ari_founder/status/1234567890124",
        excerpt: "Northstar is open to its first customers.",
        claim: "Northstar opened its product to customers.",
        publishedAt: "2026-11-02T00:00:00.000Z",
        likes: null,
        reposts: null,
        replies: null,
        views: null,
      },
    ],
    notes: "Read the founder's account.",
  };
}

function makeRuntime(options: {
  brain?: "live" | "sim";
  sources?: "live" | "sim";
  xReady?: () => Promise<boolean>;
  xReadyAbsent?: boolean;
  output?: XInvestigateOutput;
  xPosts?: XPostReader | null;
  verifyX?: boolean;
} = {}) {
  const store = openStore(":memory:");
  stores.push(store);
  const config = { ...BASE_CONFIG, id: CONFIG_ID, params: { ...BASE_CONFIG.params, "x.lookback_days": 90, "verify.control": false } };
  store.saveConfig(config);
  const swarm = {
    id: SWARM_ID,
    name: "X stage tests",
    status: "active" as const,
    thesis: THESIS,
    configId: CONFIG_ID,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  store.insertSwarm(swarm as never);
  const company = makeCompany();
  store.insertCompany(company);
  const founder = makeFounder("fnd_x_person", company.id);
  const withoutCompany = makeFounder("fnd_x_no_company");
  store.insertFounder(founder);
  store.insertFounder(withoutCompany);
  const calls: Array<{ founderId: string | null; input: XInvestigateInput }> = [];
  const skipped: Array<{ status: string; jobId: string; skipReason?: string | null }> = [];
  const output = options.output ?? makeOutput();
  const xReady = options.xReady ?? (options.xReadyAbsent ? undefined : vi.fn(async () => true));
  const runtime = {
    deps: {
      store,
      jobs: createJobRegistry(),
      xReady,
      xPosts: options.xPosts,
    },
    run: { id: "run_x_stage", sources: options.sources ?? "live" },
    swarm,
    config,
    agents: [makeAgent("investigate.x"), ...(options.verifyX ? [makeAgent("verify.x")] : [])],
    brain: options.brain ?? "live",
    concurrency: 2,
    signal: new AbortController().signal,
    now: () => new Date(NOW),
    stopped: () => false,
    persist: vi.fn(),
    setStage: vi.fn(),
    addStats: vi.fn(),
    recordPlainTask: (input: { status: string; jobId: string; skipReason?: string | null }) => {
      skipped.push(input);
      return { id: "tsk_skip" } as TaskRun;
    },
    resolve: () => EMPTY_STEERING,
    runJob: async (args: { founderId?: string | null; input: XInvestigateInput }) => {
      calls.push({ founderId: args.founderId ?? null, input: args.input });
      return { task: { id: `tsk_${args.founderId}`, status: "succeeded" } as TaskRun, output };
    },
  } as unknown as EngineRuntime;
  return { runtime, store, founder, withoutCompany, company, calls, skipped, output, xReady };
}

function makeXEvidence(id: string, url: string, excerpt: string, verification: Evidence["verification"] = "unverified"): Evidence {
  return {
    id,
    founderId: "fnd_x_person",
    companyId: null,
    facet: null,
    kind: "post",
    source: "x",
    url,
    title: "Post by @ari_founder on X (xAI reports: 1 like)",
    excerpt,
    claim: "Ari made a claim in an X post.",
    publishedAt: "2026-11-01",
    capturedAt: NOW.toISOString(),
    collectedByTaskId: null,
    hash: id,
    verification,
    verificationNote: null,
    quote: null,
    sim: null,
  };
}

describe("X investigation stage", () => {
  it("files personal posts and profiles separately from company facts", async () => {
    const fixture = makeRuntime();
    const assessmentCandidates = new Set<string>();
    const companyCandidates = new Set<string>();

    await runXRead(fixture.runtime, [fixture.founder.id, fixture.withoutCompany.id], assessmentCandidates, companyCandidates);

    expect(fixture.calls).toHaveLength(2);
    expect(fixture.calls[0]?.input).toMatchObject({
      handle: "ari_founder",
      fromDate: "2026-08-14",
      media: true,
      known: [],
    });
    for (const founder of [fixture.founder, fixture.withoutCompany]) {
      const evidence = fixture.store.listEvidence(founder.id);
      const personal = evidence.find((item) => item.kind === "post");
      const profile = evidence.find((item) => item.kind === "profile");
      expect(personal).toMatchObject({
        source: "x",
        verification: "unverified",
        title: "Post by @ari_founder on X (xAI reports: 120 likes, 14 reposts, 3 replies, 3,400 views)",
      });
      expect(profile).toMatchObject({
        source: "x",
        url: "https://x.com/ari_founder",
        title: "X account @ari_founder",
        excerpt: "Ari Founder (@ari_founder). 1200 followers, as xAI's model reported. The account identifies Ari as the founder of Northstar.",
        claim: `xAI's model ties the X account @ari_founder to ${founder.name}.`,
      });
      expect(fixture.store.getFounder(founder.id)?.links.x).toBe("https://x.com/ari_founder");
      expect(assessmentCandidates.has(founder.id)).toBe(true);
    }
    const companyEvidence = fixture.store.listEvidence(fixture.founder.id).find((item) => item.companyId === fixture.company.id);
    expect(companyEvidence).toMatchObject({ source: "x", facet: "product", verification: "unverified" });
    expect(companyEvidence?.hash).toBe(hashEvidence("x", fixture.output.evidence[1]!.url, `company-evidence:${fixture.company.id}:${fixture.output.evidence[1]!.excerpt}`));
    expect(fixture.store.listEvidence(fixture.withoutCompany.id).some((item) => item.facet === "product")).toBe(false);
    expect(companyCandidates).toEqual(new Set([fixture.company.id]));
    expect(fixture.runtime.persist).toHaveBeenCalledTimes(2);

    // A second reading is shown the founder's own posts on file and never the company's, and
    // files nothing twice.
    const filed = fixture.store.listEvidence(fixture.founder.id).length;
    await runXRead(fixture.runtime, [fixture.founder.id], assessmentCandidates, companyCandidates);
    const known = (fixture.calls[2]?.input as XInvestigateInput).known;
    expect(known.length).toBeGreaterThan(0);
    expect(known.some((item) => item.facet)).toBe(false);
    expect(fixture.store.listEvidence(fixture.founder.id)).toHaveLength(filed);
  });

  it("does not read X in a simulated run and records one skip when xAI is unavailable", async () => {
    const xPosts: XPostReader = {
      status: vi.fn(async () => ({ configured: true, detail: "Ready." })),
      read: vi.fn(async (_ids: readonly string[]) => ({ posts: new Map<string, XPost>(), gone: new Set<string>() })),
    };
    for (const simulated of [makeRuntime({ sources: "sim", xPosts, verifyX: true }), makeRuntime({ brain: "sim" })]) {
      const simReady = simulated.xReady as ReturnType<typeof vi.fn>;
      await runXRead(simulated.runtime, [simulated.founder.id], new Set(), new Set());
      await runVerifyX(simulated.runtime, new Set());
      expect(simulated.calls).toHaveLength(0);
      expect(simulated.skipped).toHaveLength(0);
      expect(simReady).not.toHaveBeenCalled();
    }
    expect(xPosts.status).not.toHaveBeenCalled();
    expect(xPosts.read).not.toHaveBeenCalled();

    const unavailable = makeRuntime({ xReady: async () => false });
    const assessmentCandidates = new Set<string>();
    await runXRead(unavailable.runtime, [unavailable.founder.id, unavailable.withoutCompany.id], assessmentCandidates, new Set());
    expect(unavailable.calls).toHaveLength(0);
    expect(unavailable.skipped).toEqual([expect.objectContaining({
      status: "skipped",
      jobId: "investigate.x",
      skipReason: "xAI is not connected, so no X account was read.",
    })]);

    const missingReadiness = makeRuntime({ xReadyAbsent: true });
    await runXRead(missingReadiness.runtime, [missingReadiness.founder.id], new Set(), new Set());
    expect(missingReadiness.calls).toHaveLength(0);
    expect(missingReadiness.skipped).toHaveLength(1);
  });

  it("checks new X quotes and refreshes stored posts once through X's API", async () => {
    const readCalls: string[][] = [];
    const posts = new Map<string, XPost>([
      ["1234567890123", {
        // X shortens a link in a post's text; the quote may carry the address it leads to.
        id: "1234567890123", text: "We shipped the first version of Northstar today. https://t.co/Ab12Cd34Ef", createdAt: "2026-11-10T09:00:00.000Z",
        handle: "ari_founder", name: "Ari Founder", followers: 1200, likes: 120, reposts: 14, replies: 3, views: 3400,
      }],
      ["1234567890124", {
        id: "1234567890124", text: "We are exploring ideas for a developer tool.", createdAt: "2026-11-10T09:00:00.000Z",
        handle: "another_account", name: "Another Account", followers: 1200, likes: 8, reposts: null, replies: 1, views: null,
      }],
    ]);
    const xPosts: XPostReader = {
      status: vi.fn(async () => ({ configured: true, detail: "Ready." })),
      read: vi.fn(async (ids: readonly string[]) => {
        readCalls.push([...ids]);
        const returned = new Map<string, XPost>();
        const gone = new Set<string>();
        for (const id of ids) {
          const post = posts.get(id);
          if (post) returned.set(id, post);
          if (["1234567890125", "1234567890126", "1234567890127", "1234567890128"].includes(id)) gone.add(id);
        }
        return {
          posts: returned,
          gone,
        };
      }),
    };
    const fixture = makeRuntime({ xPosts, verifyX: true });
    fixture.store.insertEvidence(makeXEvidence("evd_x_found", "https://x.com/ari_founder/status/1234567890123", "We shipped the first version of Northstar today. northstar.dev/launch"));
    fixture.store.insertEvidence(makeXEvidence("evd_x_wrong", "https://x.com/ari_founder/status/1234567890124", "We have thousands of paying enterprise customers now."));
    fixture.store.insertEvidence(makeXEvidence("evd_x_gone", "https://x.com/ari_founder/status/1234567890125", "This removed post used to contain words."));
    fixture.store.insertEvidence(makeXEvidence("evd_x_old", "https://x.com/ari_founder/status/1234567890125", "Older supported words from the same removed post.", "supported"));
    fixture.store.insertEvidence(makeXEvidence("evd_x_refresh", "https://x.com/ari_founder/status/1234567890126", "Words from a post that was removed.", "supported"));
    fixture.store.insertLead({
      id: "lead_x_refresh",
      swarmId: SWARM_ID,
      founderId: fixture.founder.id,
      source: "x",
      sourceRef: "https://x.com/ari_founder/status/1234567890127",
      sourceTitle: "X post",
      personName: fixture.founder.name,
      role: "Founder",
      companyName: "Northstar",
      companyUrl: null,
      oneLiner: "A claim from the post.",
      links: { github: null, linkedin: null, x: null, site: null, scholar: null },
      why: "The post supports the claim.",
      discoveredByTaskId: null,
      discoveredAt: NOW.toISOString(),
      quote: "Words from the post.",
    });
    const heldHunt = { id: "hnt_x_refresh", swarmId: SWARM_ID, turn: 0, looks: 0, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
    fixture.store.saveHunt(heldHunt);
    fixture.store.addFrontier([{
      id: "frt_x_refresh",
      huntId: heldHunt.id,
      trailId: "trl_x_refresh",
      kind: "page",
      target: "https://x.com/ari_founder/status/1234567890128",
      engine: null,
      label: "Post",
      priority: 2,
      depth: 0,
      from: "navigator",
      state: "queued",
      addedAt: NOW.toISOString(),
      held: { title: "Held post", text: "Words from the held post.", fromX: true },
    }]);
    fixture.store.insertEvidence({
      ...makeXEvidence("evd_x_video", "https://x.com/ari_founder/status/1234567890123", "Words reported from a video."),
      kind: "video",
    });
    // A post removed by hand, before this run: the other founder's assessment still cites it.
    fixture.store.insertEvidence({
      ...makeXEvidence("evd_x_by_hand", "https://x.com/ari_founder/status/1234567890129", X_POST_REMOVED.excerpt, "unsupported"),
      founderId: fixture.withoutCompany.id,
      title: X_POST_REMOVED.title,
    });
    fixture.store.insertAssessment({
      id: "asm_x_by_hand", founderId: fixture.withoutCompany.id, runId: null, configId: "cfg_base", composite: 0.5, cracked: 0.5,
      founderScore: 0.5, coverage: 0.5, potential: null, fit: null, decision: "watch", reasons: [], flags: [], breakdown: [],
      judgments: [{ dimension: "built_hard_things", level: null, confidence: 0.5, rationale: "", evidenceIds: ["evd_x_by_hand"], counterEvidenceIds: [] }],
      summary: "", memo: null, createdAt: NOW.toISOString(),
    });
    const verifyInputs: VerifyInput[] = [];
    const runVerify = async (args: { input: VerifyInput }) => {
      verifyInputs.push(args.input);
      return {
        task: { id: "tsk_verify_x", status: "succeeded" } as TaskRun,
        output: { identityConfidence: 0.7, verdicts: args.input.evidence.map((item) => ({ evidenceId: item.id, verdict: "supported" as const, note: "Read by X." })) },
      };
    };
    fixture.runtime.runJob = runVerify as EngineRuntime["runJob"];
    const candidates = new Set<string>();

    await runVerifyX(fixture.runtime, candidates);

    expect(xPosts.status).toHaveBeenCalledTimes(1);
    // New evidence is read first, so the day's allowance goes to it before the upkeep.
    expect(readCalls).toHaveLength(2);
    expect(new Set(readCalls[0])).toEqual(new Set(["1234567890123", "1234567890124", "1234567890125"]));
    expect(readCalls[1]).toEqual(["1234567890127", "1234567890128", "1234567890126"]);
    expect(verifyInputs).toHaveLength(1);
    expect(verifyInputs[0]?.evidence.map((item) => item.id)).toEqual(["evd_x_found", "evd_x_video"]);
    expect(fixture.store.listEvidence(fixture.founder.id).find((item) => item.id === "evd_x_found")).toMatchObject({
      quote: "found",
      verification: "supported",
      title: "Post by @ari_founder on X (X reports: 120 likes, 14 reposts, 3 replies, 3,400 views)",
      publishedAt: "2026-11-10",
    });
    expect(fixture.store.listEvidence(fixture.founder.id).find((item) => item.id === "evd_x_wrong")).toMatchObject({
      quote: "not_found",
      verification: "unsupported",
      verificationNote: "X gives this post to another account.",
    });
    for (const id of ["evd_x_gone", "evd_x_old"]) {
      expect(fixture.store.listEvidence(fixture.founder.id).find((item) => item.id === id)).toMatchObject({
        title: X_POST_REMOVED.title,
        excerpt: X_POST_REMOVED.excerpt,
        claim: X_POST_REMOVED.claim,
        quote: "not_found",
        verification: "unsupported",
        verificationNote: X_POST_REMOVED.note,
      });
    }
    expect(fixture.store.listEvidence(fixture.founder.id).find((item) => item.id === "evd_x_refresh")).toMatchObject({
      title: X_POST_REMOVED.title,
      excerpt: X_POST_REMOVED.excerpt,
      claim: X_POST_REMOVED.claim,
      quote: "not_found",
      verification: "unsupported",
      verificationNote: X_POST_REMOVED.note,
    });
    expect(fixture.store.listLeads({ swarmId: SWARM_ID }).find((item) => item.id === "lead_x_refresh")).toMatchObject({
      quote: null,
      oneLiner: null,
      why: X_POST_REMOVED.note,
    });
    expect(fixture.store.listFrontier(heldHunt.id).find((item) => item.id === "frt_x_refresh")).toMatchObject({
      state: "skipped",
      held: null,
    });
    expect(fixture.store.listEvidence(fixture.founder.id).find((item) => item.id === "evd_x_video")).toMatchObject({
      quote: "unreachable",
      verification: "unverified",
    });
    expect(candidates).toContain(fixture.founder.id);
    expect(candidates).toContain(fixture.withoutCompany.id);
    expect(fixture.runtime.addStats).toHaveBeenCalledWith({ evidenceRejected: 2, quotesRejected: 2 });
  });
});
