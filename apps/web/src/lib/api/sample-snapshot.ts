/**
 * A small hand-built snapshot of entirely fictional data, used while building
 * the pages and as the fallback for the demo build until a snapshot generated
 * from a simulated run replaces it. Scores are computed with the same shared
 * scoring and steering code the server uses, so the numbers are consistent.
 */
import {
  AGENT_CLASSES,
  BASE_CONFIG,
  COMPANY_DIMENSIONS,
  DEFAULT_ROUTES,
  DEFAULT_SETTINGS,
  DIMENSIONS,
  EMPTY_COMPANY_LINKS,
  EMPTY_LINKS,
  earliness,
  FACET_DIMENSIONS,
  JOBS,
  PROVIDERS,
  SOURCES,
  STAGES,
  ZERO_STATS,
  effectiveThresholds,
  effectiveWeights,
  resolveSteering,
  scopeLabel,
  scopeLevel,
  scoreCompany,
  scoreFounder,
  stableId,
  swarmIdentity,
  type Agent,
  type Assessment,
  type Company,
  type CompanyAssessment,
  type CompanyDetailDTO,
  type CompanyDimensionId,
  type CompanyFeedback,
  type CompanyJudgment,
  type CompanyMember,
  type CompanyRow,
  type CompanyStatus,
  type DemoSnapshot,
  type Decision,
  type Directive,
  type DirectiveRow,
  type Evidence,
  type EvidenceFacet,
  type EvidenceKind,
  type Founder,
  type FounderDetailDTO,
  type FounderRow,
  type FounderStatus,
  type HuntDTO,
  type StageRead,
  type Judgment,
  type Level,
  type NetworkContact,
  type NodeStats,
  type OutreachRow,
  type QuoteStatus,
  type Run,
  type ScopeSelector,
  type SourceId,
  type Swarm,
  type SwarmTreeDTO,
  type TaskRun,
  type Verification,
} from "@agentswarm/shared";

const NOW = Date.parse("2026-11-12T15:30:00Z");
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const DAY = 24 * 60;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SWARM_ID = "swm_sample0000001";

const swarm: Swarm = {
  id: SWARM_ID,
  name: "AI infrastructure, pre-seed",
  status: "active",
  thesis: {
    summary:
      "Technical founders building infrastructure and developer tools for AI systems, before or at their first round.",
    sectors: ["AI infrastructure", "developer tools", "data infrastructure"],
    stages: ["pre-seed", "seed"],
    geos: ["North America", "Europe"],
    avoid: ["crypto", "consumer"],
  },
  configId: BASE_CONFIG.id,
  createdAt: iso(30 * DAY),
  updatedAt: iso(2 * DAY),
};

/* ----------------------------- Directives -------------------------- */

function directive(
  n: number,
  scope: ScopeSelector,
  body: Pick<Directive, "kind"> & Partial<Directive>,
  minutesAgo: number,
): Directive {
  return {
    id: stableId("dir", `sample-${n}`),
    scope,
    key: null,
    value: null,
    text: null,
    priority: 0,
    status: "active",
    author: "Partner",
    note: null,
    createdAt: iso(minutesAgo),
    updatedAt: iso(minutesAgo),
    expiresAt: null,
    ...body,
  };
}

const githubScoutTwo = stableId("agt", "sample-scout.github-2");

const directives: Directive[] = [
  directive(1, {}, { kind: "rule", text: "Never contact a founder or a reference without an approved outreach item." }, 29 * DAY),
  directive(2, {}, { kind: "rule", text: "Use public, professional information only. Never record age, family, health or other personal attributes." }, 29 * DAY),
  directive(3, { swarmId: SWARM_ID }, { kind: "opinion", text: "We care more about what someone has shipped than where they studied or worked." }, 21 * DAY),
  directive(4, { swarmId: SWARM_ID }, { kind: "param", key: "investigate.max_founders", value: 12 }, 14 * DAY),
  directive(5, { classId: "investigator" }, { kind: "context", text: "We already know the robotics lab spin-outs from last year's cohort. Note the connection but do not treat it as new." }, 9 * DAY),
  directive(6, { jobId: "scout.github" }, { kind: "opinion", text: "Rust and Zig systems projects with fast, organic star growth are our sweet spot." }, 6 * DAY),
  directive(7, { agentId: githubScoutTwo }, { kind: "context", text: "Skip forks, awesome-lists and course repositories." }, 3 * DAY),
  directive(8, { swarmId: SWARM_ID }, { kind: "param", key: "weights.built_hard_things", value: 4 }, 2 * DAY),
  directive(9, { jobId: "assess.memo" }, { kind: "opinion", text: "Lead the memo with the single strongest piece of evidence, not the biography.", status: "paused" }, 5 * DAY),
];

/* ------------------------------- Tree ------------------------------ */

const emptyStats = (): NodeStats => ({ tasks: 0, failures: 0, costUsd: 0, itemsOut: 0, lastRunAt: null });
const random = rng(11);

const agents: Agent[] = [];
for (const job of JOBS) {
  const copies = job.id === "scout.github" ? 2 : 1;
  for (let i = 1; i <= copies; i++) {
    agents.push({
      id: stableId("agt", `sample-${job.id}-${i}`),
      swarmId: SWARM_ID,
      jobId: job.id,
      classId: job.classId,
      name: copies > 1 ? `${job.label} ${i}` : job.label,
      status: job.id === "scout.talent" ? "paused" : "active",
      beat: job.id === "scout.github" ? (i === 1 ? "Rust and Zig systems" : "ML tooling") : null,
      state: {},
      createdAt: iso(30 * DAY),
    });
  }
}

const names = {
  swarms: { [SWARM_ID]: swarm.name },
  agents: Object.fromEntries(agents.map((a) => [a.id, a.name])),
};

const tree: SwarmTreeDTO = {
  swarm,
  config: BASE_CONFIG,
  swarmDirectiveCount: 0,
  globalDirectiveCount: 0,
  classes: AGENT_CLASSES.map((cls) => {
    const jobs = JOBS.filter((j) => j.classId === cls.id).map((job) => {
      const nodes = agents
        .filter((a) => a.jobId === job.id)
        .map((agent) => {
          const ran = job.enabled && agent.status === "active";
          const stats: NodeStats = ran
            ? {
                tasks: 4 + Math.floor(random() * 30),
                failures: job.id === "investigate.media" ? 2 : 0,
                costUsd: Math.round(random() * 400) / 100,
                itemsOut: 6 + Math.floor(random() * 60),
                lastRunAt: iso(9 * 60 + Math.floor(random() * 40)),
              }
            : emptyStats();
          return {
            agent,
            health: !job.enabled
              ? ("planned" as const)
              : agent.status === "paused"
                ? ("paused" as const)
                : job.id === "investigate.media"
                  ? ("warn" as const)
                  : ("ok" as const),
            directiveCount: 0,
            stats,
            lastOutput: ran ? `${stats.itemsOut} items from the last run` : null,
          };
        });
      const sum = (pick: (s: NodeStats) => number) => nodes.reduce((t, n) => t + pick(n.stats), 0);
      return {
        job,
        health: nodes.some((n) => n.health === "warn") ? ("warn" as const) : (nodes[0]?.health ?? ("idle" as const)),
        directiveCount: 0,
        route: DEFAULT_ROUTES[job.id],
        stats: {
          tasks: sum((s) => s.tasks),
          failures: sum((s) => s.failures),
          costUsd: Math.round(sum((s) => s.costUsd) * 100) / 100,
          itemsOut: sum((s) => s.itemsOut),
          lastRunAt: nodes.map((n) => n.stats.lastRunAt).filter(Boolean).sort().at(-1) ?? null,
        },
        agents: nodes,
      };
    });
    const sum = (pick: (s: NodeStats) => number) => jobs.reduce((t, j) => t + pick(j.stats), 0);
    return {
      cls,
      health: jobs.some((j) => j.health === "warn") ? ("warn" as const) : ("ok" as const),
      directiveCount: 0,
      stats: {
        tasks: sum((s) => s.tasks),
        failures: sum((s) => s.failures),
        costUsd: Math.round(sum((s) => s.costUsd) * 100) / 100,
        itemsOut: sum((s) => s.itemsOut),
        lastRunAt: jobs.map((j) => j.stats.lastRunAt).filter(Boolean).sort().at(-1) ?? null,
      },
      jobs,
    };
  }),
};

/* ------------------------------ Founders --------------------------- */

const steering = resolveSteering(directives, swarmIdentity(SWARM_ID), new Date(NOW));
const weights = effectiveWeights(steering, BASE_CONFIG);
const thresholds = effectiveThresholds(steering, BASE_CONFIG);

interface Seed {
  name: string;
  company: string;
  oneLiner: string;
  headline: string;
  levels: Array<Level | null>;
  fit: number;
  sources: SourceId[];
}

// Level order follows DIMENSIONS: built, depth, velocity, slope, insight, ambition, clarity, magnet, grit, integrity.
const SEEDS: Seed[] = [
  { name: "Mirelle Vasquant", company: "Tessaly", oneLiner: "A vector index built for robot telemetry logs.", headline: "Wrote the storage engine behind Tessaly", levels: [4, 4, 3, 4, 4, 3, 3, 3, 3, 3], fit: 0.91, sources: ["github", "hackernews"] },
  { name: "Odric Halversen", company: "Quillmark", oneLiner: "Deterministic replay for agent workflows.", headline: "Founder of Quillmark, previously built a tracing system", levels: [4, 3, 4, 3, 3, 3, 4, 2, 3, 3], fit: 0.86, sources: ["hackernews", "web"] },
  { name: "Sanne Kirkbride", company: "Loomfield", oneLiner: "A scheduler that packs inference jobs onto idle accelerators.", headline: "First author of a scheduling paper now running in production", levels: [3, 4, 3, 3, 4, 3, 3, 3, null, 3], fit: 0.83, sources: ["arxiv", "github"] },
  { name: "Ilya Brandmeer", company: "Coppice", oneLiner: "Incremental builds for model pipelines.", headline: "Solo founder of Coppice", levels: [3, 3, 4, 3, 3, 2, 2, 2, 3, null], fit: 0.8, sources: ["github"] },
  { name: "Tovah Lindqvist", company: "Marrow Labs", oneLiner: "Evaluation harnesses for speech models.", headline: "Co-founder of Marrow Labs", levels: [3, 3, 3, 2, 3, 3, 3, 3, 2, 3], fit: 0.78, sources: ["hackernews"] },
  { name: "Renzo Avelard", company: "Stonecrop", oneLiner: "Private model serving for regulated teams.", headline: "Founder of Stonecrop", levels: [4, 4, null, null, null, null, null, null, null, null], fit: 0.84, sources: ["github"] },
  { name: "Petra Olsvik", company: "Fenwright", oneLiner: "Feature stores without the platform team.", headline: "Founder of Fenwright", levels: [2, 3, 2, 2, 3, 3, 4, 2, 2, 3], fit: 0.74, sources: ["web", "hackernews"] },
  { name: "Caspian Thorvald", company: "Brindle", oneLiner: "A typed query layer over data lakes.", headline: "Founder of Brindle", levels: [3, 2, 2, 2, 2, 2, 2, 2, 3, 3], fit: 0.71, sources: ["github"] },
  { name: "Ysolde Farrant", company: "Halcyard", oneLiner: "Cost reports for training runs.", headline: "Founder of Halcyard", levels: [2, 2, 3, 2, 2, 2, 3, 1, 2, 3], fit: 0.69, sources: ["hackernews"] },
  { name: "Dmitar Kovalenko", company: "Northgate Systems", oneLiner: "A compiler for sparse tensor programs.", headline: "Founder of Northgate Systems", levels: [4, 4, 3, 3, 3, 3, 2, 2, 3, 0], fit: 0.82, sources: ["arxiv", "github"] },
  { name: "Anneke Ruysdael", company: "Pennant", oneLiner: "Dashboards for annotation teams.", headline: "Founder of Pennant", levels: [1, 2, 2, 1, 2, 2, 3, 1, 2, 3], fit: 0.62, sources: ["hackernews"] },
  { name: "Bram Oskarsson", company: "Tidewell", oneLiner: "A wallet for onchain game assets.", headline: "Founder of Tidewell", levels: [3, 3, 3, 3, 3, 3, 3, 2, 2, 3], fit: 0.18, sources: ["github"] },
];

const evidenceFor = (founderId: string, seed: Seed): Evidence[] => {
  const handle = seed.company.toLowerCase().replace(/[^a-z]/g, "");
  const items: Array<Pick<Evidence, "kind" | "source" | "title" | "excerpt" | "claim"> & { path: string; bad?: boolean }> = [
    {
      kind: "repo",
      source: "github",
      path: `github/${handle}/${handle}`,
      title: `${handle}/${handle}: core repository`,
      excerpt: `${seed.oneLiner} 1,840 commits over 14 months, nearly all by one author. Implements its own write-ahead log and a lock-free index rather than wrapping an existing store.`,
      claim: `${seed.name} personally built the core of ${seed.company}, including the storage layer.`,
    },
    {
      kind: "code_review",
      source: "github",
      path: `github/${handle}/${handle}/blob/main/src/index/merge.rs`,
      title: "Code review: index merge path",
      excerpt: "src/index/merge.rs lines 88 to 214: a concurrent merge that keeps readers wait-free, with a property test covering interleavings and a written argument for correctness in the module header.",
      claim: "The hardest part of the system is solved carefully and is tested against concurrency bugs.",
    },
    {
      kind: "launch",
      source: "hackernews",
      path: `hn/item/${handle}`,
      title: `Show HN: ${seed.company}`,
      excerpt: `"We rebuilt the ingest path three times in six weeks after the first users hit it with real logs." 412 points, 163 comments, several from engineers running it in production.`,
      claim: `${seed.company} shipped quickly and iterated on feedback from real users.`,
    },
    {
      kind: "talk",
      source: "web",
      path: `talks/${handle}-systems-meetup`,
      title: "Talk at a systems meetup",
      excerpt: `"The index is the easy part. The hard part is deciding what you are allowed to forget." Explains the trade-off between recall and write cost with a worked example and answers a hostile question directly.`,
      claim: `${seed.name} explains a difficult trade-off clearly and has a point of view of their own.`,
    },
    {
      kind: "article",
      source: "web",
      path: `press/${handle}-profile`,
      title: "Profile in a trade newsletter",
      excerpt: "Describes the company as backed by two well-known funds. No filing or announcement from either fund could be found.",
      claim: `${seed.company} has raised from two well-known funds.`,
      bad: true,
    },
  ];
  return items.map((item, i) => ({
    id: stableId("evd", `${founderId}-${i}`),
    founderId,
    kind: item.kind,
    source: item.source,
    url: `https://sim.invalid/${item.path}`,
    title: item.title,
    excerpt: item.excerpt,
    claim: item.claim,
    publishedAt: iso((20 + i * 9) * DAY),
    capturedAt: iso(10 * 60),
    collectedByTaskId: null,
    hash: `h${founderId}${i}`,
    verification: item.bad ? "unsupported" : "supported",
    verificationNote: item.bad ? "The excerpt reports a claim it could not confirm. Not counted as evidence." : null,
    sim: null,
  }));
};

/** Calls a partner has already made in the sample, by position in SEEDS. */
const CALLS: Record<number, { verdict: "yes" | "no"; reasonTags: string[]; note: string | null }> = {
  1: { verdict: "yes", reasonTags: ["builder", "speed"], note: "I know their old team lead." },
  3: { verdict: "no", reasonTags: ["too_early"], note: null },
  4: { verdict: "no", reasonTags: ["weak_insight"], note: null },
  5: { verdict: "yes", reasonTags: ["builder"], note: "Thin so far, but the code is the real thing." },
};

const founders: Founder[] = [];
const rows: FounderRow[] = [];
const details: Record<string, FounderDetailDTO> = {};

SEEDS.forEach((seed, index) => {
  const id = stableId("fnd", `sample-${seed.name}`);
  const evidence = index < 6 ? evidenceFor(id, seed) : [];
  const supported = evidence.filter((e) => e.verification === "supported").map((e) => e.id);

  const judgments: Judgment[] = DIMENSIONS.map((d, i) => {
    const level = seed.levels[i] ?? null;
    return {
      dimension: d.id,
      level,
      confidence: level === null ? 0 : 0.62 + ((index + i) % 4) * 0.08,
      rationale:
        level === null
          ? "Nothing in the verified evidence settles this."
          : `${d.levels[level]} Based on ${supported.length ? "the repository, the code review and the launch thread" : "the public record"}.`,
      evidenceIds: level === null ? [] : supported.slice(0, 2 + (i % 2)),
      counterEvidenceIds: [],
    };
  });

  const score = scoreFounder({ judgments, weights, thresholds, fit: seed.fit });
  const status: FounderStatus =
    score.decision === "surface"
      ? "surfaced"
      : score.decision === "needs_evidence"
        ? "needs_evidence"
        : score.decision === "watch"
          ? "watch"
          : seed.fit < thresholds.minFit
            ? "screened_out"
            : "passed";

  const founder: Founder = {
    id,
    swarmId: SWARM_ID,
    name: seed.name,
    headline: seed.headline,
    location: index % 3 === 0 ? "Europe" : "North America",
    company: { name: seed.company, url: `https://sim.invalid/co/${seed.company.toLowerCase().replace(/[^a-z]/g, "")}`, oneLiner: seed.oneLiner, stage: "pre-seed" },
    links: { ...EMPTY_LINKS, github: `https://sim.invalid/github/${seed.company.toLowerCase().replace(/[^a-z]/g, "")}` },
    status,
    fit: seed.fit,
    fitReasons: seed.fit >= thresholds.minFit
      ? ["Builds infrastructure for AI systems.", "Company is at the pre-seed stage."]
      : ["The sector is on this swarm's avoid list."],
    tags: ["infrastructure"],
    identityConfidence: 0.94,
    sources: seed.sources,
    firstSeenAt: iso((1 + (index % 6)) * DAY + 9 * 60),
    updatedAt: iso(9 * 60 + index * 3),
    lastAssessedAt: status === "screened_out" ? null : iso(9 * 60),
    nextRecheckAt: status === "watch" ? iso(-21 * DAY) : null,
    simId: `sim-${index}`,
  };
  founders.push(founder);

  const assessed = status !== "screened_out";
  const assessment: Assessment | null = assessed
    ? {
        id: stableId("asm", id),
        founderId: id,
        runId: null,
        configId: BASE_CONFIG.id,
        composite: score.composite,
        cracked: score.cracked,
        founderScore: score.founder,
        coverage: score.coverage,
        potential: score.potential,
        fit: seed.fit,
        decision: score.decision,
        reasons: score.reasons,
        flags: score.flags,
        breakdown: score.breakdown,
        judgments,
        summary: `${seed.name} is building ${seed.company}. ${seed.oneLiner}`,
        memo:
          score.decision === "surface"
            ? {
                headline: `${seed.name} wrote the hard part of ${seed.company} alone and shipped it to real users in weeks.`,
                body: `**Why now.** ${seed.company} launched five weeks ago and already has engineers running it in production.\n\n**Evidence.** The core repository shows a custom storage layer written almost entirely by the founder. The merge path is carefully tested. The launch thread shows three rebuilds of the ingest path in six weeks.\n\n**What we do not know.** Whether anyone strong has joined, and how the founder sells.`,
                strengths: ["Primary author of a hard system that others use.", "Ships and iterates in weeks.", "Explains trade-offs clearly."],
                risks: ["Solo founder so far.", "No evidence yet of commercial pull."],
                openQuestions: ["Who are the first paying users?", "Who would be the first two hires?"],
                nextStep: "A 30-minute first call with a partner this week.",
              }
            : null,
        createdAt: iso(9 * 60),
      }
    : null;

  rows.push({
    id,
    name: seed.name,
    headline: seed.headline,
    companyName: seed.company,
    companyOneLiner: seed.oneLiner,
    sector: null,
    stage: null,
    tagline: null,
    moat: null,
    status,
    decision: assessed ? score.decision : null,
    composite: assessed ? score.composite : null,
    cracked: assessed ? score.cracked : null,
    founderScore: assessed ? score.founder : null,
    fit: seed.fit,
    coverage: assessed ? score.coverage : null,
    sources: seed.sources,
    evidenceCount: supported.length,
    flagCount: score.flags.filter((f) => f.severity !== "info").length,
    feedback: CALLS[index]?.verdict ?? null,
    feedbackReasons: CALLS[index]?.reasonTags ?? [],
    firstSeenAt: founder.firstSeenAt,
    updatedAt: founder.updatedAt,
  });

  if (index < 6) {
    details[id] = {
      founder,
      company: null,
      assessment,
      history: assessed
        ? [
            { at: iso(8 * DAY), composite: Math.max(0, score.composite - 0.09), decision: "watch" },
            { at: iso(9 * 60), composite: score.composite, decision: score.decision },
          ]
        : [],
      evidence,
      leads: seed.sources.map((source, i) => ({
        id: stableId("led", `${id}-${i}`),
        swarmId: SWARM_ID,
        founderId: id,
        source,
        sourceRef: `https://sim.invalid/${source}/${index}-${i}`,
        sourceTitle: source === "hackernews" ? `Show HN: ${seed.company}` : `${seed.company} repository`,
        personName: seed.name,
        role: "Founder",
        companyName: seed.company,
        companyUrl: founder.company.url,
        oneLiner: seed.oneLiner,
        links: founder.links,
        why: "New project with unusually fast adoption and a single clear author.",
        discoveredByTaskId: null,
        discoveredAt: founder.firstSeenAt,
      })),
      outreach: [],
      feedback: CALLS[index]
        ? [
            {
              id: stableId("fbk", id),
              founderId: id,
              author: "Partner",
              verdict: CALLS[index]!.verdict,
              reasonTags: CALLS[index]!.reasonTags,
              note: CALLS[index]!.note,
              createdAt: iso(4 * 60 + index),
            },
          ]
        : [],
      tasks: [],
    };
  }
});

/* ------------------------------ Outreach --------------------------- */

const surfaced = rows.filter((r) => r.status === "surfaced");
const disclosure =
  "This message was drafted with the help of an AI assistant working for the fund and was reviewed by a partner before it was sent.";

const outreach: OutreachRow[] = surfaced.slice(0, 3).flatMap((row, i): OutreachRow[] => {
  const base = {
    swarmId: SWARM_ID,
    founderId: row.id,
    founderName: row.name,
    founderHeadline: row.headline,
    composite: row.composite,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    resultSummary: null,
    transcriptEvidenceId: null,
    createdByTaskId: null,
    createdAt: iso(8 * 60 + i),
    updatedAt: iso(8 * 60 + i),
  };
  const email: OutreachRow = {
    ...base,
    id: stableId("out", `${row.id}-email`),
    kind: "email_founder",
    target: { name: row.name, role: "Founder", relationship: null, channelHint: "Public contact address on the company site" },
    rationale: `Overall score ${Math.round((row.composite ?? 0) * 100)} with strong evidence of building ability.`,
    draft: {
      subject: `Your work on ${row.companyName}`,
      body: `Hi ${row.name.split(" ")[0]},\n\nI read through the ${row.companyName} repository and the launch thread. The way you handled the merge path stood out.\n\nWe invest in infrastructure for AI systems at the earliest stage. Would you be open to a 30-minute call this week?\n\nBest,\nThe partner`,
      agenda: [],
      questions: [],
      disclosure,
    },
    consentBasis: "First contact through a business address the founder published.",
    status: i === 2 ? "approved" : "proposed",
  };
  const call: OutreachRow = {
    ...base,
    id: stableId("out", `${row.id}-ref`),
    kind: "call_reference",
    target: { name: "A former colleague named in the launch thread", role: "Engineer", relationship: "Worked with the founder for two years", channelHint: null },
    rationale: "Would settle the open question about how the founder works with others.",
    draft: {
      subject: null,
      body: null,
      agenda: ["Introduce the call and ask for consent to take notes", "How they worked together", "What the founder is unusually good at", "Where they needed help"],
      questions: ["What is the hardest thing you saw them build?", "Would you work for them?"],
      disclosure: "This call is made by an AI assistant on behalf of the fund. It will say so in its first sentence and ask before taking notes.",
    },
    consentBasis: "Only after the founder agrees to reference calls and provides this contact.",
    status: "proposed",
  };
  return i === 0 ? [email, call] : [email];
});

for (const o of outreach) details[o.founderId]?.outreach.push(o);

/* -------------------------------- Runs ----------------------------- */

const run = (n: number, minutesAgo: number, status: Run["status"], costUsd: number): Run => ({
  id: stableId("run", `sample-${n}`),
  swarmId: SWARM_ID,
  trigger: n === 3 ? "manual" : "schedule",
  brain: "sim",
  sources: "sim",
  status,
  stage: status === "running" ? "investigate" : null,
  configId: BASE_CONFIG.id,
  budgetUsd: 25,
  costUsd,
  stats: {
    ...ZERO_STATS,
    rawItems: 148 + n * 7,
    leads: 61 + n * 3,
    newFounders: 44 + n,
    mergedLeads: 14,
    screened: 44 + n,
    screenedIn: 17,
    investigated: 12,
    evidence: 139,
    evidenceRejected: 16,
    assessed: 12,
    surfaced: 3 + (n % 2),
    needsEvidence: 1,
    watch: 5,
    passed: 3,
    outreachProposed: 4,
    tasks: 132,
    failures: n === 2 ? 2 : 0,
    skippedBudget: 0,
  },
  error: null,
  simDay: 40 - n,
  startedAt: iso(minutesAgo),
  finishedAt: status === "running" ? null : iso(minutesAgo - 11),
});

const runs: Run[] = [run(1, 9 * 60 + 30, "succeeded", 14.82), run(2, DAY + 9 * 60 + 30, "succeeded", 13.4), run(3, 2 * DAY + 4 * 60, "succeeded", 15.11)];
const latest = runs[0]!;

const tasks: TaskRun[] = agents
  .filter((a) => JOBS.find((j) => j.id === a.jobId)?.enabled && a.status === "active")
  .map((agent, i): TaskRun => {
    const job = JOBS.find((j) => j.id === agent.jobId)!;
    const stage =
      job.classId === "scout" ? "scout" : job.classId === "resolver" ? "resolve" : job.classId === "screener" ? "screen" : job.classId === "investigator" ? "investigate" : job.classId === "verifier" ? "verify" : job.classId === "analyst" ? (job.id === "assess.memo" ? "memo" : "assess") : job.id === "call.debrief" ? "debrief" : "outreach";
    const failed = job.id === "investigate.media" && i % 2 === 0;
    const route = DEFAULT_ROUTES[job.id];
    return {
      id: stableId("tsk", `sample-${agent.id}`),
      runId: latest.id,
      swarmId: SWARM_ID,
      agentId: agent.id,
      jobId: job.id,
      classId: job.classId,
      stage,
      founderId: job.classId === "scout" || job.classId === "resolver" ? null : (founders[0]?.id ?? null),
      status: failed ? "failed" : "succeeded",
      skipReason: null,
      attempt: 1,
      provider: "sim",
      model: route.model,
      effort: route.effort ?? null,
      inputSummary: job.classId === "scout" ? "38 new items" : `Founder: ${founders[0]?.name}`,
      outputSummary: failed ? null : job.classId === "scout" ? "9 leads" : "4 evidence items",
      output: null,
      steering: { directiveIds: directives.slice(0, 3).map((d) => d.id), params: {}, block: "" },
      usage: { inputTokens: 4200 + i * 310, outputTokens: 380 + i * 12, cachedInputTokens: 0, cacheWriteTokens: 0, webSearches: job.kind === "research" ? 6 : 0 },
      costUsd: route.model.startsWith("gpt") ? null : Math.round((0.004 + i * 0.011) * 1000) / 1000,
      latencyMs: 1800 + i * 420,
      itemsOut: failed ? 0 : 4,
      error: failed ? "The page fetch timed out after two attempts." : null,
      startedAt: iso(9 * 60 + 28 - i),
      finishedAt: iso(9 * 60 + 27 - i),
    };
  });

const taskDetails: Record<string, TaskRun> = {};
for (const t of tasks.slice(0, 4)) {
  taskDetails[t.id] = {
    ...t,
    trace: [
      { role: "system", content: "You work for a venture fund. Use only public, professional information and cite a source for every claim." },
      { role: "user", content: `## Steering from the investment team\nRules. Always follow these.\n- [Everything] Never contact a founder or a reference without an approved outreach item.\n\nTask: ${t.inputSummary}` },
      { role: "assistant", content: JSON.stringify({ note: "Simulated answer", items: t.itemsOut }, null, 2) },
    ],
  };
}

for (const d of Object.values(details)) d.tasks = tasks.filter((t) => t.founderId === d.founder.id).slice(0, 8);

/* ------------------------------ Companies -------------------------- */

// Companies are filed under the lead founder of the same name, so each one has a person behind it.
// Every name, site and person here is invented.

interface EvidenceSeed {
  facet: EvidenceFacet;
  kind: EvidenceKind;
  source: SourceId;
  title: string;
  excerpt: string;
  claim: string;
  /** How many days before the sample's "now" the source was published. */
  days: number;
  verification?: Verification;
  quote?: QuoteStatus;
  note?: string;
}

interface CompanySeed {
  id: string;
  name: string;
  host: string;
  oneLiner: string;
  sector: string;
  stage: string;
  mission: string;
  tagline: string;
  status: CompanyStatus;
  decision: Decision;
  /** Index into `rows`, the lead founder. */
  lead: number;
  /** Levels in COMPANY_DIMENSIONS order; null where the evidence does not settle the question. */
  levels: Array<Level | null>;
  reasons: string[];
  feedback: { verdict: "yes" | "no"; reasonTags: string[]; note: string | null } | null;
  members: Array<{ name: string; role: string; isFounder: boolean; background: string }>;
  evidence: EvidenceSeed[];
  brief: {
    summary: string;
    moat: { text: string; ev: number[] } | null;
    strengths: Array<{ text: string; ev: number[] }>;
    risks: Array<{ text: string; ev: number[] }>;
    openQuestions: string[];
  };
  known: Array<{ name: string; position: string }>;
}

const COMPANY_SEEDS: CompanySeed[] = [
  {
    id: "cmp_sample_tessaly",
    name: "Tessaly",
    host: "tessaly",
    oneLiner: "Finds the clip behind a robot failure in its telemetry logs.",
    sector: "Robotics data",
    stage: "pre-seed",
    mission: "Tessaly finds the one clip that explains a robot failure, from months of telemetry, in seconds.",
    tagline: "Find the clip behind any robot failure.",
    status: "surfaced",
    decision: "surface",
    lead: 0,
    levels: [3, 2, 4, 3, 3, 3, 3, 3, 2],
    reasons: ["The open core works end to end and outside users have tried it.", "Pull is early: pilots, not paid contracts."],
    feedback: null,
    members: [
      { name: "Teodor Anand", role: "Co-founder, hardware integration", isFounder: true, background: "Six years integrating sensors on logistics robots." },
      { name: "Ines Caldwell", role: "Machine learning engineer", isFounder: false, background: "Built retrieval systems for video search." },
    ],
    evidence: [
      { facet: "mission", kind: "profile", source: "web", title: "About Tessaly", excerpt: "Tessaly finds the one clip that explains a robot failure, from months of telemetry logs, in seconds.", claim: "States the problem as finding the clip behind a robot failure.", days: 340 },
      { facet: "product", kind: "repo", source: "github", title: "tessaly/core: v0.1 release", excerpt: "First public release. An index over robot telemetry with a write-ahead log and a documented on-disk format.", claim: "Ships a usable open core.", days: 318 },
      { facet: "product", kind: "repo", source: "github", title: "tessaly/core: replay command", excerpt: "A replay command re-runs a logged session through the index and prints the matching clips.", claim: "The product does the core job end to end.", days: 250 },
      { facet: "traction", kind: "launch", source: "hackernews", title: "Show HN: Tessaly", excerpt: "Posted by the founder. 210 points. Several commenters from robotics teams say they are trying it on real logs.", claim: "Got early interest from outside the company.", days: 214 },
      { facet: "traction", kind: "article", source: "web", title: "Customer story: field robotics team", excerpt: "Three field robotics teams run Tessaly on production logs, according to the company's customer page.", claim: "Has at least three production users.", days: 170 },
      { facet: "funding", kind: "funding", source: "web", title: "Pre-seed round announced", excerpt: "Announces a $2.4 million pre-seed round led by a fund that invests in developer tools.", claim: "Raised a pre-seed round.", days: 150 },
      { facet: "team", kind: "profile", source: "web", title: "Co-founder joins from a robotics company", excerpt: "Teodor Anand joins as co-founder for hardware integration after six years at a logistics robotics firm.", claim: "Added a co-founder with relevant hardware experience.", days: 128 },
      { facet: "product", kind: "launch", source: "github", title: "Release 0.4 adds replay across sessions", excerpt: "Replay now spans several sessions and keeps clip order. Twelve issues closed, four of them from outside users.", claim: "Shipped a meaningful feature in response to outside requests.", days: 96 },
      { facet: "traction", kind: "article", source: "web", title: "Pilot with a warehouse operator", excerpt: "A warehouse operator says it is piloting Tessaly on its autonomous forklift logs for one quarter.", claim: "Has a pilot with a named kind of operator.", days: 71 },
      { facet: "roadmap", kind: "post", source: "web", title: "What comes next", excerpt: "A hosted version is planned for the first quarter, with a per-site retention policy.", claim: "Has a dated next step that follows from the open core.", days: 60 },
      { facet: "market", kind: "article", source: "web", title: "Market note on robot telemetry tools", excerpt: "Sizes spending on telemetry tooling for field robots and names five vendors in the category.", claim: "Describes a category with paying buyers.", days: 45 },
      { facet: "risk", kind: "article", source: "web", title: "Trade profile: 40 customers", excerpt: "Reports that Tessaly has 40 customers. The company's own customer page lists 12.", claim: "Claims 40 customers.", days: 30, verification: "contradicted", quote: "not_found", note: "The company's own page lists 12 customers. The trade profile's figure is not counted." },
    ],
    brief: {
      summary: "Tessaly makes field-robot logs searchable. The open core works, outside users have tried it, and a pre-seed round is in place. Pull rests on pilots so far.",
      moat: { text: "Its open core is shaped around robot telemetry formats and replay workflows.", ev: [1, 2] },
      strengths: [
        { text: "The open core does the job end to end and is public.", ev: [1, 2] },
        { text: "Outside users asked for features and got them in the next release.", ev: [7, 3] },
        { text: "Three production users are named on the company's own page.", ev: [4] },
      ],
      risks: [
        { text: "Commercial pull rests on pilots, not paid contracts.", ev: [8, 4] },
        { text: "No sales lead is on record yet.", ev: [6] },
      ],
      openQuestions: ["How many pilots convert to paid?", "Who leads sales once the pilots end?"],
    },
    known: [
      { name: "Dana Whitcombe", position: "Director of Engineering, field robotics" },
      { name: "Rafa Okonjo", position: "Head of Data, logistics automation" },
    ],
  },
  {
    id: "cmp_sample_quillmark",
    name: "Quillmark",
    host: "quillmark",
    oneLiner: "Replays failed agent runs one step at a time.",
    sector: "Developer tools",
    stage: "seed",
    mission: "Quillmark makes agent workflows replayable, so a failed run can be re-run one step at a time.",
    tagline: "Replay an agent run one step at a time.",
    status: "surfaced",
    decision: "surface",
    lead: 1,
    levels: [3, 3, 4, 3, 3, 4, 3, 3, 3],
    reasons: ["The replay engine works across frameworks.", "Usage is rising by the company's own figure."],
    feedback: { verdict: "yes", reasonTags: ["strong_product", "real_pull"], note: "Replay works on my own failed runs." },
    members: [
      { name: "Priya Nandakumar", role: "Head of engineering", isFounder: false, background: "Ran the platform team at a database company." },
    ],
    evidence: [
      { facet: "mission", kind: "profile", source: "web", title: "About Quillmark", excerpt: "Quillmark makes agent workflows replayable, so a failed run can be re-run one step at a time.", claim: "States the problem as debugging failed agent runs.", days: 300 },
      { facet: "product", kind: "repo", source: "github", title: "quillmark/replay: first release", excerpt: "Records every tool call of an agent run and replays it deterministically against a pinned model response.", claim: "Ships a working replay engine.", days: 280 },
      { facet: "traction", kind: "launch", source: "hackernews", title: "Show HN: Quillmark", excerpt: "A launch thread with 180 points. Users report replaying their own failed runs for the first time.", claim: "Launched and got users talking about the core job.", days: 240 },
      { facet: "traction", kind: "post", source: "web", title: "Changelog names two design partners", excerpt: "The changelog names two design partners running replay on their agent pipelines.", claim: "Has two named design partners.", days: 200 },
      { facet: "funding", kind: "funding", source: "web", title: "Seed round of $6 million", excerpt: "Announces a $6 million seed round led by a developer-tools fund.", claim: "Raised a seed round.", days: 160 },
      { facet: "team", kind: "profile", source: "web", title: "Head of engineering joins", excerpt: "Priya Nandakumar joins as head of engineering. She ran the platform team at a database company.", claim: "Added an engineering leader with platform experience.", days: 130 },
      { facet: "product", kind: "repo", source: "github", title: "Release 0.5 records tool calls", excerpt: "Replay now records tool calls as well as model output, for a closed list of tools.", claim: "Extended the product in a dated release.", days: 100 },
      { facet: "roadmap", kind: "post", source: "web", title: "Self-hosted edition planned", excerpt: "A self-hosted edition is planned for next year, for teams with data rules.", claim: "Has a dated plan that follows from the product.", days: 80 },
      { facet: "market", kind: "article", source: "web", title: "Survey of agent builders", excerpt: "A survey of 300 agent builders ranks debugging of failed runs as their top unmet need.", claim: "Shows that the problem is widely felt.", days: 60 },
      { facet: "traction", kind: "post", source: "web", title: "Status page: weekly replays", excerpt: "The company's public update reports about 3,000 replays a week, up from 900 in the spring.", claim: "Usage is rising, per the company's own figure.", days: 42 },
      { facet: "product", kind: "article", source: "web", title: "Independent check across frameworks", excerpt: "A reviewer ran the replay engine against three agent frameworks and reported matching results on all three.", claim: "Works across frameworks, per an outside reviewer.", days: 25 },
      { facet: "risk", kind: "article", source: "web", title: "Trade profile: used by 40 enterprises", excerpt: "Says the product is used by 40 enterprises. No named enterprise customer could be found.", claim: "Claims 40 enterprise customers.", days: 15, verification: "unsupported", quote: "not_found", note: "No named enterprise customer could be found. Not counted." },
    ],
    brief: {
      summary: "Quillmark makes failed agent runs replayable. The engine works across frameworks and a seed round is in place. Named enterprise customers are not yet on record.",
      moat: { text: "Its replay engine produces matching results across several agent frameworks.", ev: [10] },
      strengths: [
        { text: "An outside reviewer found replay matching across three frameworks.", ev: [10] },
        { text: "Usage is rising by the company's own figure, from 900 to 3,000 a week.", ev: [9] },
        { text: "Two design partners are named.", ev: [3] },
      ],
      risks: [
        { text: "The seed round is recent and the sales team is not yet on record.", ev: [4] },
      ],
      openQuestions: ["Which enterprises pay today?", "Will the self-hosted edition cut into hosted revenue?"],
    },
    known: [],
  },
  {
    id: "cmp_sample_loomfield",
    name: "Loomfield",
    host: "loomfield",
    oneLiner: "A scheduler that packs inference jobs onto idle accelerators.",
    sector: "Cloud infrastructure",
    stage: "pre-seed",
    mission: "Loomfield schedules inference jobs onto idle accelerators, so clusters waste less time.",
    tagline: "Keep accelerators busy.",
    status: "watch",
    decision: "watch",
    lead: 2,
    levels: [2, 2, 3, 2, 2, 2, 2, 2, 3],
    reasons: ["A published trial shows a real result on one cluster.", "The category is crowded and pull is interest only."],
    feedback: null,
    members: [
      { name: "Matteo Varga", role: "Operations lead", isFounder: false, background: "Ran cluster operations for a university compute centre." },
    ],
    evidence: [
      { facet: "mission", kind: "profile", source: "web", title: "About Loomfield", excerpt: "Loomfield schedules inference jobs onto idle accelerators, so clusters waste less time.", claim: "Names a cost problem for clusters.", days: 290 },
      { facet: "product", kind: "repo", source: "github", title: "loomfield/scheduler: prototype", excerpt: "A scheduler prototype that packs jobs onto idle accelerators. It runs in simulation and on one test cluster.", claim: "Has a working prototype.", days: 260 },
      { facet: "product", kind: "paper", source: "arxiv", title: "Scheduling paper with a production trial", excerpt: "The paper reports a trial that cut idle accelerator time by a fifth on one cluster.", claim: "Has a published result from a trial.", days: 200 },
      { facet: "traction", kind: "launch", source: "hackernews", title: "Show HN: Loomfield", excerpt: "A launch thread with 60 points. Comments mostly ask about pricing.", claim: "Some interest, with no sign of use yet.", days: 150 },
      { facet: "funding", kind: "funding", source: "web", title: "Pre-seed round from angels", excerpt: "Announces a $900,000 pre-seed round from angel investors.", claim: "Raised a small pre-seed round.", days: 120 },
      { facet: "traction", kind: "article", source: "web", title: "Operator evaluating the scheduler", excerpt: "A cluster operator says it is evaluating the scheduler for one quarter.", claim: "Has an evaluation with one operator.", days: 95 },
      { facet: "team", kind: "profile", source: "web", title: "Operations lead joins", excerpt: "Matteo Varga joins as operations lead after running cluster operations for a university compute centre.", claim: "Added an operations lead with cluster experience.", days: 85 },
      { facet: "roadmap", kind: "post", source: "web", title: "Managed service planned", excerpt: "A managed service is planned, with no date given.", claim: "Has a plan without a date.", days: 70 },
      { facet: "market", kind: "article", source: "web", title: "Market note on GPU scheduling", excerpt: "Describes cluster schedulers as a crowded category with three well-funded incumbents.", claim: "Describes a crowded market.", days: 55 },
      { facet: "product", kind: "repo", source: "github", title: "Documentation site", excerpt: "The docs site lists installation steps and three integrations.", claim: "Has documentation for early users.", days: 35 },
      { facet: "market", kind: "other", source: "web", title: "Pricing page", excerpt: "Lists per-accelerator pricing for the managed service, which is not yet available.", claim: "Has a price for a product that does not exist yet.", days: 20 },
      { facet: "risk", kind: "article", source: "web", title: "Trade profile: 60% savings", excerpt: "Claims cluster-wide savings of 60 percent. The paper reports a fifth on one cluster.", claim: "Claims 60 percent savings.", days: 12, verification: "unsupported", quote: "not_found", note: "The paper reports a fifth on one cluster. The trade figure is not counted." },
    ],
    brief: {
      summary: "Loomfield is a prototype scheduler with a published trial. Pull is early and the category has established rivals. Re-check in a quarter.",
      moat: null,
      strengths: [
        { text: "A published trial reports a fifth of accelerator time recovered.", ev: [2] },
        { text: "The scheduler runs on a real test cluster.", ev: [1] },
      ],
      risks: [
        { text: "The category is crowded with well-funded rivals.", ev: [8] },
        { text: "Traction is interest only so far.", ev: [3] },
      ],
      openQuestions: ["Will a cluster operator pay for the managed service?", "Can the trial result be repeated on a second cluster?"],
    },
    known: [],
  },
];

const companyScoreWeights = Object.fromEntries(COMPANY_DIMENSIONS.map((d) => [d.id, d.defaultWeight])) as Record<
  CompanyDimensionId,
  number
>;

const companyRows: CompanyRow[] = [];
const companies: Company[] = [];
const companyDetails: Record<string, CompanyDetailDTO> = {};

COMPANY_SEEDS.forEach((seed, index) => {
  const lead = rows[seed.lead]!;
  const leadDetail = details[lead.id];
  const companyId = seed.id;

  const evidence: Evidence[] = seed.evidence.map((item, i): Evidence => ({
    id: stableId("evd", `${companyId}-${i}`),
    founderId: lead.id,
    companyId,
    facet: item.facet,
    quote: item.quote ?? "found",
    kind: item.kind,
    source: item.source,
    url: `https://sim.invalid/${seed.host}/${i}`,
    title: item.title,
    excerpt: item.excerpt,
    claim: item.claim,
    publishedAt: iso(item.days * DAY),
    capturedAt: iso(10 * 60),
    collectedByTaskId: null,
    hash: `h${companyId}${i}`,
    verification: item.verification ?? "supported",
    verificationNote: item.note ?? null,
    sim: null,
  }));

  const judgments: CompanyJudgment[] = COMPANY_DIMENSIONS.map((d, i) => {
    const level = seed.levels[i] ?? null;
    const backing = evidence.filter(
      (e) => e.verification === "supported" && e.facet && FACET_DIMENSIONS[e.facet].includes(d.id),
    );
    const against = d.id === "claims" ? evidence.filter((e) => e.verification !== "supported").map((e) => e.id) : [];
    return {
      dimension: d.id,
      level,
      confidence: level === null ? 0 : 0.62 + ((index + i) % 4) * 0.08,
      rationale: level === null ? "Nothing in the verified evidence settles this." : d.levels[level],
      evidenceIds: level === null ? [] : backing.slice(0, 2).map((e) => e.id),
      counterEvidenceIds: against,
    };
  });

  const score = scoreCompany({
    judgments: judgments.map((j) => ({ dimension: j.dimension, level: j.level, confidence: j.confidence })),
    weights: companyScoreWeights,
    unknownPrior: 0.4,
  });
  const teamScore = lead.founderScore ?? null;
  const deal = teamScore === null ? score.composite : (teamScore + score.composite) / 2;
  const supportedCount = evidence.filter((e) => e.verification === "supported").length;
  const flags = score.flags;

  const brief = {
    summary: seed.brief.summary,
    moat: seed.brief.moat ? { text: seed.brief.moat.text, evidenceIds: seed.brief.moat.ev.map((i) => evidence[i]!.id) } : null,
    strengths: seed.brief.strengths.map((p) => ({ text: p.text, evidenceIds: p.ev.map((i) => evidence[i]!.id) })),
    risks: seed.brief.risks.map((p) => ({ text: p.text, evidenceIds: p.ev.map((i) => evidence[i]!.id) })),
    openQuestions: seed.brief.openQuestions,
  };

  const assessment: CompanyAssessment = {
    id: stableId("asm", `company-${companyId}`),
    companyId,
    runId: null,
    configId: BASE_CONFIG.id,
    company: score.composite,
    companyCoverage: score.coverage,
    companyPotential: score.potential,
    leadFounderId: lead.id,
    team: teamScore,
    deal,
    coverage: score.coverage,
    potential: score.potential,
    decision: seed.decision,
    reasons: seed.reasons,
    flags,
    breakdown: score.breakdown,
    judgments,
    brief,
    createdAt: iso(9 * 60),
  };

  const company: Company = {
    id: companyId,
    swarmId: SWARM_ID,
    name: seed.name,
    domain: `${seed.host}.example`,
    url: `https://${seed.host}.example`,
    oneLiner: seed.oneLiner,
    tagline: { text: seed.tagline, url: `https://${seed.host}.example` },
    mission: { text: seed.mission, url: `https://${seed.host}.example/about` },
    sector: seed.sector,
    stage: seed.stage,
    links: { ...EMPTY_COMPANY_LINKS, github: `https://github.example/${seed.host}` },
    status: seed.status,
    firstSeenAt: iso((4 + index) * DAY),
    updatedAt: iso(9 * 60 + index * 5),
    lastResearchedAt: iso(9 * 60),
    lastAssessedAt: iso(9 * 60),
    nextRecheckAt: seed.status === "watch" ? iso(-21 * DAY) : null,
    simId: `sim-company-${index}`,
  };
  companies.push(company);

  const members: CompanyMember[] = [
    {
      id: stableId("fnd", `${companyId}-lead`),
      companyId,
      name: lead.name,
      role: "Founder",
      isFounder: true,
      founderId: lead.id,
      links: { ...EMPTY_LINKS },
      background: null,
      source: "web",
      sourceUrl: `https://${seed.host}.example/team`,
      addedAt: iso(20 * DAY),
    },
    ...seed.members.map((m, i): CompanyMember => ({
      id: `mem_${companyId}_${i}`,
      companyId,
      name: m.name,
      role: m.role,
      isFounder: m.isFounder,
      founderId: null,
      links: { ...EMPTY_LINKS },
      background: m.background,
      source: "web",
      sourceUrl: `https://${seed.host}.example/team`,
      addedAt: iso(20 * DAY),
    })),
  ];

  const knownPeople: NetworkContact[] = seed.known.map((k, i) => ({
    id: `net_${companyId}_${i}`,
    owner: "Partner",
    name: k.name,
    company: seed.name,
    position: k.position,
    profileUrl: null,
    connectedOn: "2023-09-14",
    importedAt: iso(12 * DAY),
    previous: null,
  }));

  const feedback: CompanyFeedback[] = seed.feedback
    ? [
        {
          id: stableId("fbk", `${companyId}-call`),
          companyId,
          author: "Partner",
          verdict: seed.feedback.verdict,
          reasonTags: seed.feedback.reasonTags,
          note: seed.feedback.note,
          createdAt: iso(4 * 60),
        },
      ]
    : [];

  const companyTasks: TaskRun[] = tasks.slice(index * 2, index * 2 + 2).map((t) => ({
    ...t,
    id: `${t.id}-${companyId}`,
    companyId,
    founderId: null,
  }));
  for (const t of companyTasks) taskDetails[t.id] = { ...t, trace: [] };

  const leadRow = rows[seed.lead]!;
  const share = Math.round(deal * 100) / 100;
  companyRows.push({
    id: companyId,
    name: seed.name,
    oneLiner: seed.oneLiner,
    tagline: seed.tagline,
    moat: brief.moat?.text ?? null,
    sector: seed.sector,
    stage: seed.stage,
    status: seed.status,
    decision: seed.decision,
    deal: share,
    company: Math.round(score.composite * 100) / 100,
    team: teamScore,
    coverage: Math.round(score.coverage * 100) / 100,
    founders: [{ id: leadRow.id, name: leadRow.name }],
    teamSize: members.length,
    evidenceCount: supportedCount,
    flagCount: flags.filter((f) => f.severity !== "info").length,
    feedback: feedback[0]?.verdict ?? null,
    feedbackReasons: feedback[0]?.reasonTags ?? [],
    knownPeople: knownPeople.length,
    firstSeenAt: iso((4 + index) * DAY),
    updatedAt: iso(9 * 60 + index * 5),
  });

  companyDetails[companyId] = {
    company,
    members,
    founders: leadDetail ? [leadRow] : [],
    assessment,
    history: [
      { at: iso(8 * DAY), deal: Math.max(0, share - 0.05), decision: "watch" },
      { at: iso(9 * 60), deal: share, decision: seed.decision },
    ],
    evidence: [...evidence].reverse(),
    feedback,
    tasks: companyTasks,
    knownPeople,
  };
  const founderRow = rows.find((row) => row.id === lead.id);
  if (founderRow) {
    founderRow.companyId = company.id;
    founderRow.sector = company.sector;
    founderRow.stage = company.stage === "pre-seed" ? "Pre-seed" : company.stage;
    founderRow.tagline = company.tagline?.text ?? null;
    founderRow.moat = brief.moat?.text ?? null;
  }
  if (leadDetail) {
    leadDetail.company = company;
    leadDetail.founder = { ...leadDetail.founder, companyId: company.id };
  }
});

const companyWaiting = companyRows.filter((r) => r.status === "surfaced" && r.feedback === null).length;

/* -------------------------------- Hunt ----------------------------- */

const sampleHuntId = "hunt_sample_01";
const sampleTrailIds = Array.from({ length: 6 }, (_, i) => `trail_sample_${i + 1}`);

const sampleHuntStages: StageRead[] = [
  {
    funding: "says_unfunded",
    fundingQuote: "We have not raised outside capital.",
    team: "two_to_five",
    teamQuote: "The two of us built the first version.",
    progress: "building",
    progressQuote: "A private preview is running with design partners.",
  },
  {
    funding: "none_stated",
    fundingQuote: null,
    team: "solo",
    teamQuote: "I am building the first release on my own.",
    progress: "launched",
    progressQuote: "The public beta opened this month.",
  },
  {
    funding: "angel_or_accelerator",
    fundingQuote: "We joined a small operator-led accelerator.",
    team: "two_to_five",
    teamQuote: "Our team is three engineers.",
    progress: "building",
    progressQuote: "The hosted version is in private preview.",
  },
  {
    funding: "seed",
    fundingQuote: "We announced a seed round in September.",
    team: "six_to_twenty",
    teamQuote: "There are twelve people on the team.",
    progress: "revenue",
    progressQuote: "Customers are paying for the hosted service.",
  },
];

interface SampleHuntCall {
  turn: number;
  trail: number | null;
  tool: "search" | "look";
  target: string;
  result?: "ok" | "empty" | "blocked" | "failed";
  detail?: string | null;
  leads?: number;
  dropped?: number;
  tooLate?: number;
  queued?: number;
  control?: "passed" | "failed" | null;
}

type SampleHuntCallOptions = Omit<Partial<SampleHuntCall>, "turn" | "trail" | "tool" | "target">;

const huntSearch = (turn: number, trail: number, target: string, options: SampleHuntCallOptions = {}): SampleHuntCall => ({
  turn,
  trail,
  tool: "search",
  target,
  result: "ok",
  queued: 1,
  ...options,
});

const huntLook = (turn: number, trail: number, path: string, options: SampleHuntCallOptions = {}): SampleHuntCall => ({
  turn,
  trail,
  tool: "look",
  target: `https://web.sim.example/${path}`,
  result: "ok",
  queued: 1,
  ...options,
});

const huntPlant = (turn: number, path: string, control: "passed" | "failed"): SampleHuntCall => ({
  turn,
  trail: null,
  tool: "look",
  target: `https://web.sim.example/controls/${path}`,
  result: control === "passed" ? "empty" : "ok",
  detail: control === "failed" ? "The runner repeated the planted founder claim; code rejected the lead." : null,
  leads: control === "failed" ? 1 : 0,
  dropped: control === "failed" ? 1 : 0,
  queued: 0,
  control,
});

// Oldest first here; the DTO exposes the most recent calls first.
const sampleHuntCallSeeds: SampleHuntCall[] = [
  // Wave 1
  huntSearch(1, 1, "new telemetry infrastructure project founder launch"),
  huntSearch(1, 2, "Rust event log tool first users maker"),
  huntLook(1, 1, "launches/cedar-trace", { leads: 2, queued: 2 }),
  huntSearch(1, 3, "open research paper agent runtime maintainer"),
  // Wave 2
  huntSearch(2, 1, "robot data storage preview founder"),
  huntLook(2, 2, "projects/keel-index", { leads: 1 }),
  huntSearch(2, 2, "typed event stream startup builder", { result: "empty", detail: "No useful project pages matched this query.", queued: 0 }),
  huntLook(2, 3, "lab-notes/quiet-scheduler", { leads: 1 }),
  // Wave 3
  huntSearch(3, 1, "new open source model tracing repository"),
  huntLook(3, 1, "launches/cedar-trace-followup", { leads: 2, queued: 1 }),
  huntSearch(3, 3, "systems paper author building developer tool"),
  // Wave 4
  huntSearch(4, 1, "founder-built telemetry database early access"),
  huntLook(4, 2, "projects/keel-index-team", { leads: 1, dropped: 1, tooLate: 1 }),
  huntSearch(4, 4, "research to production model evaluation startup"),
  huntLook(4, 1, "launches/cedar-trace-demo", { leads: 1 }),
  // Wave 5
  huntSearch(5, 2, "new Rust infrastructure company maker notes"),
  huntLook(5, 3, "lab-notes/quiet-scheduler-authors", { leads: 1, dropped: 1, tooLate: 1 }),
  huntPlant(5, "silent-project", "passed"),
  // Wave 6
  huntSearch(6, 4, "small team private inference serving"),
  huntLook(6, 1, "launches/cedar-trace-usage", { leads: 1, queued: 2 }),
  huntSearch(6, 5, "founder notes feature store prototype"),
  huntLook(6, 5, "field-notes/fen-store", { leads: 1, dropped: 1 }),
  // Wave 7
  huntSearch(7, 2, "new infrastructure launch project founder"),
  huntLook(7, 4, "projects/amber-serve", { result: "blocked", detail: "The simulated host refused the page request.", queued: 0 }),
  huntLook(7, 5, "field-notes/fen-store-team", { result: "failed", detail: "The simulated host timed out after two attempts.", queued: 0 }),
  // Wave 8
  huntSearch(8, 1, "agent trace storage project early users"),
  huntLook(8, 2, "projects/keel-index-roadmap", { leads: 1 }),
  huntSearch(8, 6, "new local runtime reproducible workflows"),
  huntPlant(8, "false-founder-claim", "failed"),
  // Wave 9
  huntSearch(9, 4, "private model serving small team launch"),
  huntLook(9, 3, "lab-notes/quiet-scheduler-followup", { leads: 1 }),
  huntSearch(9, 5, "feature store prototype project page"),
  // Wave 10
  huntSearch(10, 3, "new agent workflow runtime project"),
  huntLook(10, 6, "projects/morrow-runtime", { leads: 1 }),
  huntLook(10, 4, "projects/amber-serve-stage", { leads: 1, tooLate: 1 }),
  // Wave 11
  huntSearch(11, 6, "local replay tool maintainer project"),
  huntLook(11, 2, "projects/keel-index-release", { leads: 1 }),
  // Wave 12
  huntSearch(12, 2, "typed event stream tool first customers"),
  huntSearch(12, 3, "research runtime maintainer new company"),
  huntSearch(12, 1, "telemetry database project founder update"),
];

const callsInTurn = new Map<number, number>();
const sampleHuntCalls: HuntDTO["calls"] = sampleHuntCallSeeds
  .map((seed, index) => {
    const inTurn = callsInTurn.get(seed.turn) ?? 0;
    callsInTurn.set(seed.turn, inTurn + 1);
    const result = seed.result ?? "ok";
    const blocked = result === "blocked";
    const failed = result === "failed";
    return {
      id: `call_sample_${index + 1}`,
      huntId: sampleHuntId,
      swarmId: SWARM_ID,
      runId: latest.id,
      taskId: seed.tool === "look" && !blocked ? stableId("tsk", `sample-hunt-call-${index + 1}`) : null,
      trailId: seed.trail === null ? null : sampleTrailIds[seed.trail - 1]!,
      turn: seed.turn,
      tool: seed.tool,
      target: seed.target,
      host: seed.tool === "look" ? "web.sim.example" : null,
      result,
      detail: seed.detail ?? null,
      leads: seed.leads ?? 0,
      dropped: seed.dropped ?? 0,
      tooLate: seed.tooLate ?? 0,
      queued: seed.queued ?? 0,
      control: seed.control ?? null,
      model: seed.tool === "look" && !blocked ? "sim-page-reader-v1" : null,
      costUsd: seed.tool === "search" ? 0.001 : blocked ? 0 : failed ? 0.002 : 0.004,
      latencyMs: seed.tool === "search" ? 720 + index * 9 : blocked ? 160 : failed ? 2_100 : 1_350 + index * 11,
      at: iso((12 - seed.turn) * 70 + (4 - inTurn)),
    };
  })
  .sort((a, b) => b.at.localeCompare(a.at));

const sampleHuntTrails: HuntDTO["trails"] = [
  {
    id: sampleTrailIds[0]!, huntId: sampleHuntId, swarmId: SWARM_ID,
    name: "Launch threads", intent: "Find technical founders shipping early infrastructure projects in public.",
    status: "open", openedBy: "person", weight: 5, pinned: true,
    stats: { searches: 6, pages: 4, leads: 6, kept: 4, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0.022 },
    openedAt: iso(9 * DAY), closedAt: null, closedWhy: null,
    queued: 2, score: 4.4, share: 0.46,
  },
  {
    id: sampleTrailIds[1]!, huntId: sampleHuntId, swarmId: SWARM_ID,
    name: "Systems repositories", intent: "Look for original systems work with a clear path from repository to product.",
    status: "open", openedBy: "navigator", weight: 4, pinned: false,
    stats: { searches: 5, pages: 4, leads: 4, kept: 2, dropped: 1, tooLate: 1, blocked: 0, costUsd: 0.021 },
    openedAt: iso(7 * DAY), closedAt: null, closedWhy: null,
    queued: 2, score: 3.5, share: 0.34,
  },
  {
    id: sampleTrailIds[2]!, huntId: sampleHuntId, swarmId: SWARM_ID,
    name: "Lab work becoming tools", intent: "Find paper authors who have started turning useful systems research into software.",
    status: "open", openedBy: "navigator", weight: 3, pinned: false,
    stats: { searches: 4, pages: 3, leads: 3, kept: 2, dropped: 1, tooLate: 1, blocked: 0, costUsd: 0.016 },
    openedAt: iso(5 * DAY), closedAt: null, closedWhy: null,
    queued: 1, score: 2.2, share: 0.2,
  },
  {
    id: sampleTrailIds[3]!, huntId: sampleHuntId, swarmId: SWARM_ID,
    name: "Private model serving", intent: "Find small teams building secure serving tools for regulated engineering groups.",
    status: "paused", openedBy: "navigator", weight: 2, pinned: false,
    stats: { searches: 3, pages: 2, leads: 1, kept: 1, dropped: 0, tooLate: 1, blocked: 1, costUsd: 0.007 },
    openedAt: iso(4 * DAY), closedAt: null, closedWhy: null,
    queued: 0, score: 0, share: 0,
  },
  {
    id: sampleTrailIds[4]!, huntId: sampleHuntId, swarmId: SWARM_ID,
    name: "Feature store field notes", intent: "Check whether teams are building lighter feature infrastructure without a platform group.",
    status: "closed", openedBy: "code", weight: 1, pinned: false,
    stats: { searches: 2, pages: 2, leads: 1, kept: 1, dropped: 1, tooLate: 0, blocked: 1, costUsd: 0.008 },
    openedAt: iso(3 * DAY), closedAt: iso(190), closedWhy: "Two pages were unavailable and the accessible pages were late-stage.",
    queued: 0, score: 0, share: 0,
  },
  {
    id: sampleTrailIds[5]!, huntId: sampleHuntId, swarmId: SWARM_ID,
    name: "Local agent runtimes", intent: "Find maintainers making agent workflows reproducible on a developer's own machine.",
    status: "paused", openedBy: "navigator", weight: 2, pinned: false,
    stats: { searches: 2, pages: 1, leads: 1, kept: 0, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0.006 },
    openedAt: iso(2 * DAY), closedAt: null, closedWhy: null,
    queued: 0, score: 0, share: 0,
  },
];

const sampleHuntNoteSeeds: Array<Pick<HuntDTO["notes"][number], "by" | "text" | "turn">> = [
  { by: "person", text: "Keep the launch trail pinned; it has produced several verifiable builders.", turn: 1 },
  { by: "navigator", text: "Project pages give better founder evidence than broad infrastructure lists.", turn: 2 },
  { by: "code", text: "One search returned no useful project pages; leave the query in the history for context.", turn: 3 },
  { by: "navigator", text: "For repository trails, prioritize original work with a product path over popularity alone.", turn: 4 },
  { by: "code", text: "The staged-company page is outside the pre-seed cutoff; keep the stage quote with the lead.", turn: 5 },
  { by: "person", text: "Pause private serving until there is another reachable early-stage page.", turn: 6 },
  { by: "code", text: "The feature-store page timed out after two attempts. Do not infer anything from that failure.", turn: 7 },
  { by: "code", text: "A planted page passed: its unsupported claim did not produce a lead.", turn: 8 },
  { by: "navigator", text: "The research trail is still yielding named authors and quoted project evidence.", turn: 9 },
  { by: "code", text: "One planted claim was repeated by the runner and rejected by the page-word check.", turn: 10 },
  { by: "navigator", text: "Keep local runtimes paused while checking whether the first project has a second maintainer.", turn: 11 },
  { by: "person", text: "Review the newest leads before adding more trails; keep all contact decisions manual.", turn: 12 },
];

const sampleHuntNotes: HuntDTO["notes"] = sampleHuntNoteSeeds.map((note) => ({
  id: `note_sample_${note.turn}`,
  huntId: sampleHuntId,
  swarmId: SWARM_ID,
  ...note,
  createdAt: iso((12 - note.turn) * 70 + 12),
})).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const sampleUnmatchedFinds = [
  { name: "Edda Venn", company: "Nacreline", oneLiner: "A compact write-ahead log for agent traces." },
  { name: "Jonas Armit", company: "Signal Loom", oneLiner: "Typed events for model tool use and replay." },
  { name: "Ravi Solenne", company: "Patchwork Runtime", oneLiner: "Rollbackable local workflows for small engineering teams." },
  { name: "Mina Orwick", company: "Fieldglass Compute", oneLiner: "A queue that schedules inference on borrowed accelerator time." },
  { name: "Tomas Edevane", company: "Mica Index", oneLiner: "A small vector index tuned for robot telemetry." },
  { name: "Liora Fen", company: "Lantern Eval", oneLiner: "Evaluation sets that stay attached to each model release." },
  { name: "Bram Iver", company: "Sable Relay", oneLiner: "Private event routing for tools that run beside a developer." },
];

const sampleHuntFinds: HuntDTO["finds"] = [
  ...rows.slice(0, 8).map((row, index) => ({
    personName: row.name,
    companyName: row.companyName,
    oneLiner: details[row.id]?.founder.company.oneLiner ?? row.headline,
    founderId: row.id,
    founderStatus: row.status,
  })),
  ...sampleUnmatchedFinds.map((find) => ({
    personName: find.name,
    companyName: find.company,
    oneLiner: find.oneLiner,
    founderId: null,
    founderStatus: null,
  })),
].map((find, index) => {
  const stage = sampleHuntStages[index % sampleHuntStages.length]!;
  return {
    leadId: stableId("led", `sample-hunt-find-${index + 1}`),
    personName: find.personName,
    companyName: find.companyName,
    oneLiner: find.oneLiner,
    sourceRef: `https://web.sim.example/hunt/leads/${String(index + 1).padStart(2, "0")}`,
    trailId: sampleTrailIds[index % sampleTrailIds.length]!,
    stage,
    earliness: earliness(stage),
    founderId: find.founderId,
    founderStatus: find.founderStatus,
    discoveredAt: iso(8 + index * 11),
  };
}).sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));

const sampleHuntTotals: HuntDTO["totals"] = {
  searches: 22,
  pages: 16,
  leads: 16,
  kept: 10,
  dropped: 3,
  tooLate: 3,
  blocked: 2,
  costUsd: 0.08,
};

const sampleHuntWaves: HuntDTO["waves"] = Array.from({ length: 12 }, (_, index) => {
  const turn = index + 1;
  const calls = sampleHuntCalls.filter((call) => call.turn === turn);
  return {
    turn,
    at: iso((12 - turn) * 70),
    calls: calls.length,
    leads: calls.reduce((sum, call) => sum + call.leads, 0),
    costUsd: Math.round(calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0) * 1000) / 1000,
  };
});

const sampleHunt: HuntDTO = {
  swarmId: SWARM_ID,
  enabled: true,
  active: false,
  turn: 12,
  navigator: {
    agentId: agents.find((agent) => agent.jobId === "hunt.navigate")?.id ?? null,
    paused: false,
    route: DEFAULT_ROUTES["hunt.navigate"],
  },
  runners: (["hunt.look", "hunt.sift"] as const).map((jobId) => {
    const job = JOBS.find((candidate) => candidate.id === jobId)!;
    return { jobId, label: job.label, classId: job.classId, members: [], route: DEFAULT_ROUTES[jobId] };
  }),
  engines: [
    { id: "web-sim", label: "Simulated web index", searches: "Fictional project pages hosted on web.sim.example.", configured: true, detail: "Sample data only; no public search service is connected." },
  ],
  limits: { turns: 24, waveSize: 4, maxDepth: 3, budgetShare: 0.15, latestStage: "pre_seed", plantedEvery: 3 },
  totals: sampleHuntTotals,
  planted: { read: 2, failed: 1 },
  trails: sampleHuntTrails,
  notes: sampleHuntNotes,
  calls: sampleHuntCalls,
  waves: sampleHuntWaves,
  finds: sampleHuntFinds,
};

/* ------------------------------ Assemble --------------------------- */

const directiveRows: DirectiveRow[] = directives.map((d, i) => ({
  ...d,
  level: scopeLevel(d.scope),
  scopeLabel: scopeLabel(d.scope, names),
  appliedCount: d.status === "active" ? 40 + i * 23 : 0,
  lastAppliedAt: d.status === "active" ? iso(9 * 60 + 20) : null,
  problem: null,
}));

const classCost = (classId: string) => tree.classes.find((c) => c.cls.id === classId)?.stats.costUsd ?? 0;

export const SAMPLE_SNAPSHOT: DemoSnapshot = {
  generatedAt: new Date(NOW).toISOString(),
  note: "Simulated founders and companies. No real people or companies.",
  settings: {
    settings: {
      ...DEFAULT_SETTINGS,
      schedule: { ...DEFAULT_SETTINGS.schedule, enabled: true },
      autopilot: { mode: "suggest", budgetUsd: 0 },
    },
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.id === "sim" || p.id === "claude-cli" || p.id === "codex-cli",
      detail: p.id === "sim" ? "Always available." : p.id.endsWith("-cli") ? "Command-line tool found. Uses its existing login." : "No API key set.",
    })),
    sources: SOURCES.filter((s) => ["hackernews", "github", "arxiv", "people_data"].includes(s.id)).map((s) => ({
      id: s.id,
      label: s.label,
      configured: s.id !== "people_data",
      detail: s.id === "people_data" ? "No licensed data vendor connected. The system never scrapes LinkedIn." : s.access,
    })),
    nextRunAt: new Date(NOW + 14.5 * 3600_000).toISOString(),
  },
  swarms: [swarm],
  overview: {
    [SWARM_ID]: {
      swarm,
      today: { leads: latest.stats.leads, screenedIn: 17, investigated: 12, surfaced: surfaced.length, pendingApprovals: outreach.filter((o) => o.status === "proposed").length, costUsd: latest.costUsd, budgetUsd: 25 },
      funnel: Array.from({ length: 14 }, (_, i) => {
        const r = rng(100 + i);
        return {
          date: new Date(NOW - (13 - i) * 86_400_000).toISOString().slice(0, 10),
          leads: 48 + Math.floor(r() * 30),
          screenedIn: 12 + Math.floor(r() * 9),
          investigated: 9 + Math.floor(r() * 4),
          surfaced: 1 + Math.floor(r() * 4),
          costUsd: Math.round((11 + r() * 6) * 100) / 100,
        };
      }),
      totals: { leads: 2140, founders: 1388, screenedIn: 471, investigated: 318, surfaced: 62 },
      topFounders: rows.filter((r) => r.status === "surfaced").slice(0, 8),
      topCompanies: companyRows.filter((r) => r.status === "surfaced").slice(0, 8),
      companiesWaiting: companyWaiting,
      alerts: [
        { id: "al1", level: "warning", title: "The talks and interviews analyst failed twice", detail: "Two page fetches timed out in the last run. Those founders were assessed without media evidence.", at: iso(9 * 60 + 20), link: "/activity" },
        { id: "al2", level: "info", title: "Professional-profile source is not connected", detail: "The talent-move scout is paused until a licensed data vendor is added.", at: iso(2 * DAY), link: "/settings" },
      ],
      lastRun: latest,
      activeRun: null,
      nextRunAt: new Date(NOW + 14.5 * 3600_000).toISOString(),
      classHealth: tree.classes.map((c) => ({
        classId: c.cls.id,
        label: c.cls.label,
        health: c.health,
        note: c.health === "warn" ? "2 failures in the last run" : c.stats.lastRunAt ? "Ran this morning" : "Has not run",
      })),
      sourceYield: (["hackernews", "github", "arxiv", "people_data"] as SourceId[]).map((source, i) => ({
        source,
        label: SOURCES.find((s) => s.id === source)!.label,
        leads: [812, 934, 394, 0][i]!,
        surfaced: [24, 31, 7, 0][i]!,
      })),
      spendByClass: AGENT_CLASSES.map((c) => ({ classId: c.id, label: c.label, costUsd: classCost(c.id) })),
      calls: { yes: 0, no: 0, waiting: 0, hitRate: null, topReasons: [] },
      coach: {
        at: iso(9 * 60 + 20),
        mode: "suggest",
        spentUsd: 0,
        flows: [
          {
            flowId: "assess-ranking",
            label: "Ranking quality",
            rounds: 1,
            kept: ["Tell the rubric analyst to ignore school and employer names"],
            applied: null,
            note: null,
          },
        ],
      },
      evalTrend: [
        { variant: "baseline", test: 0.52 },
        { variant: "v1", test: 0.58 },
        { variant: "v2", test: 0.57 },
        { variant: "v3", test: 0.63 },
      ],
      recentAudit: directives.slice(-4).reverse().map((d, i) => ({
        id: stableId("aud", `sample-${i}`),
        at: d.createdAt,
        actor: d.author,
        action: "directive.create",
        target: d.id,
        detail: { scope: scopeLabel(d.scope, names), kind: d.kind, text: d.text ?? `${d.key} = ${String(d.value)}` },
      })),
    },
  },
  tree: { [SWARM_ID]: tree },
  directives: directiveRows,
  founders: { [SWARM_ID]: rows },
  founderDetails: details,
  companies: { [SWARM_ID]: companyRows },
  companyDetails,
  outreach: { [SWARM_ID]: outreach },
  runs: { [SWARM_ID]: runs },
  runDetails: {
    [latest.id]: {
      run: latest,
      stages: STAGES.map((s) => {
        const mine = tasks.filter((t) => t.stage === s.id);
        return {
          stage: s.id,
          label: s.label,
          state: mine.length || s.id === "plan" || s.id === "digest" ? ("done" as const) : ("skipped" as const),
          tasks: mine.length,
          failures: mine.filter((t) => t.status === "failed").length,
          costUsd: Math.round(mine.reduce((sum, t) => sum + (t.costUsd ?? 0), 0) * 100) / 100,
        };
      }),
      tasks,
    },
  },
  tasks: taskDetails,
  evalFlows: [
    {
      id: "assess-ranking",
      label: "Ranking quality",
      description: "Given the same evidence, does the swarm rank the founders who went on to do well above the rest?",
      headlineMetric: "ndcg5",
      baseline: 0.52,
      best: 0.63,
      rounds: 3,
      updatedAt: iso(3 * DAY),
      metrics: [
        { id: "ndcg5", label: "Ranking quality", better: "higher", description: "How close the top five are to the best possible top five. 1.0 is perfect." },
        { id: "precision5", label: "Hits in top 5", better: "higher", description: "Share of the top five that had a good outcome." },
        { id: "pedigree_leak", label: "Pedigree leak", better: "lower", description: "How much scores move with school and employer names alone." },
        { id: "cost_usd", label: "Cost per cohort", better: "lower", description: "Model spend to assess one cohort of twenty founders." },
      ],
      goal: { target: "ndcg5", direction: "higher", hold: ["pedigree_leak", "cost_usd"] },
      cases: { train: 30, test: 30, reps: 2 },
      noiseFloor: 0.03,
      dataNote: "Synthetic founders with known outcomes. This proves the loop works; it says nothing yet about real founders.",
      bestVariant: "v3",
      promotedVariant: null,
      narrative:
        "Round 3 is ahead. Weighting built work more heavily helped a little; the larger gain came from telling the rubric analyst to ignore school and employer names, which cut the pedigree leak by more than half. Round 2 lowered the surface bar and was reverted: it raised recall on the train cases but not on the held-out ones.",
      variants: [
        { id: "baseline", round: 0, description: "Starting configuration", rationale: "", status: "baseline", train: { ndcg5: 0.53, precision5: 0.31, pedigree_leak: 0.21, cost_usd: 1.92 }, test: { ndcg5: 0.52, precision5: 0.3, pedigree_leak: 0.22, cost_usd: 1.9 }, testInterval: [0.48, 0.56], costUsd: 1.9, config: BASE_CONFIG, changes: [], createdAt: iso(6 * DAY) },
        { id: "v1", round: 1, description: "Weight built work more heavily", rationale: "Founders with strong build evidence were ranked below polished communicators in 9 of 30 train cohorts.", status: "kept", train: { ndcg5: 0.6, precision5: 0.36, pedigree_leak: 0.2, cost_usd: 1.92 }, test: { ndcg5: 0.58, precision5: 0.35, pedigree_leak: 0.21, cost_usd: 1.9 }, testInterval: [0.54, 0.62], costUsd: 1.9, config: { ...BASE_CONFIG, id: "cfg_v1", label: "Round 1", params: { "weights.built_hard_things": 4 } }, changes: ["Weight: Built hard things 3 → 4"], createdAt: iso(5 * DAY) },
        { id: "v2", round: 2, description: "Lower the bar to surface a founder", rationale: "Two strong train founders sat just under the bar.", status: "reverted", train: { ndcg5: 0.62, precision5: 0.35, pedigree_leak: 0.2, cost_usd: 1.92 }, test: { ndcg5: 0.57, precision5: 0.33, pedigree_leak: 0.21, cost_usd: 1.9 }, testInterval: [0.53, 0.61], costUsd: 1.9, config: { ...BASE_CONFIG, id: "cfg_v2", label: "Round 2", params: { "weights.built_hard_things": 4, "assess.surface_threshold": 0.58 } }, changes: ["Bar to surface a founder 0.62 → 0.58"], createdAt: iso(4 * DAY) },
        { id: "v3", round: 3, description: "Tell the rubric analyst to ignore school and employer names", rationale: "Scores moved with pedigree in the train cohorts even when the work was ordinary.", status: "kept", train: { ndcg5: 0.66, precision5: 0.4, pedigree_leak: 0.09, cost_usd: 1.94 }, test: { ndcg5: 0.63, precision5: 0.38, pedigree_leak: 0.1, cost_usd: 1.92 }, testInterval: [0.59, 0.67], costUsd: 1.92, config: { ...BASE_CONFIG, id: "cfg_v3", label: "Round 3", params: { "weights.built_hard_things": 4 }, promptVariants: { "assess.judgments": "blind-pedigree" } }, changes: ["Rubric analyst prompt: base → blind-pedigree"], createdAt: iso(3 * DAY) },
      ],
    },
  ],
  hunts: { [SWARM_ID]: sampleHunt },
};
