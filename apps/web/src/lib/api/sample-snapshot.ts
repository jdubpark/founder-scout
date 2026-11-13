/**
 * A small hand-built snapshot of entirely fictional data, used while building
 * the pages and as the fallback for the demo build until a snapshot generated
 * from a simulated run replaces it. Scores are computed with the same shared
 * scoring and steering code the server uses, so the numbers are consistent.
 */
import {
  AGENT_CLASSES,
  BASE_CONFIG,
  DEFAULT_ROUTES,
  DEFAULT_SETTINGS,
  DIMENSIONS,
  EMPTY_LINKS,
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
  scoreFounder,
  stableId,
  swarmIdentity,
  type Agent,
  type Assessment,
  type DemoSnapshot,
  type Directive,
  type DirectiveRow,
  type Evidence,
  type Founder,
  type FounderDetailDTO,
  type FounderRow,
  type FounderStatus,
  type Judgment,
  type Level,
  type NodeStats,
  type OutreachRow,
  type Run,
  type ScopeSelector,
  type SourceId,
  type Swarm,
  type SwarmTreeDTO,
  type TaskRun,
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
    feedback: index === 1 ? "meet" : null,
    firstSeenAt: founder.firstSeenAt,
    updatedAt: founder.updatedAt,
  });

  if (index < 6) {
    details[id] = {
      founder,
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
      feedback:
        index === 1
          ? [{ id: stableId("fbk", id), founderId: id, author: "Partner", verdict: "meet", note: "I know their old team lead. Worth a call.", createdAt: iso(4 * 60) }]
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
  note: "Simulated founders. No real people or companies.",
  settings: {
    settings: { ...DEFAULT_SETTINGS, schedule: { ...DEFAULT_SETTINGS.schedule, enabled: true } },
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
};
