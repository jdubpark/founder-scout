import {
  buildEffectiveSteering,
  coerceParam,
  effectiveParam,
  isReasonFor,
  PARAM_DEFS,
  resolveSteering,
  suggestSteering,
  summarizeCalls,
  newId,
  cleanUrl,
  normalizeScope,
  scopeLabel,
  scopeLevel,
  scopeMatches,
  swarmIdentity,
  trailScore,
  ZERO_TRAIL_STATS,
  type AddTrailInput,
  type AgentIdentity,
  type ApiClient,
  type CallExample,
  type CompanyDetailDTO,
  type CompanyFeedback,
  type CompanyListDTO,
  type CompanyQuery,
  type CompanyRow,
  type Feedback,
  isCompanyReasonFor,
  type HuntDTO,
  type HuntSeatDTO,
  type NavigateInput,
  type SteeringSuggestion,
  type DemoSnapshot,
  type Directive,
  type DirectiveRow,
  type FounderRow,
  type OutreachRow,
  type ScopeNames,
  type ScopeSelector,
  type SwarmTreeDTO,
  type UpdateTrailInput,
  judgeAssumptions,
} from "@agentswarm/shared";
import { ApiError } from "./http";

const READ_ONLY =
  "This is the shareable demo, which runs on a frozen snapshot of simulated data. Start the real server to do this.";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameScope(a: ScopeSelector, b: ScopeSelector): boolean {
  const x = normalizeScope(a);
  const y = normalizeScope(b);
  return x.swarmId === y.swarmId && x.classId === y.classId && x.jobId === y.jobId && x.agentId === y.agentId;
}

/**
 * An in-memory stand-in for the server. Reads come from the snapshot. Steering,
 * feedback and approvals can be changed and are reflected at once, so the demo
 * shows how steering works, but nothing is saved and no agent runs.
 */
export function createDemoClient(snapshot: DemoSnapshot, getActor: () => string): ApiClient {
  const state = clone(snapshot);
  const now = () => new Date().toISOString();

  function names(): ScopeNames {
    const swarms: Record<string, string> = {};
    const agents: Record<string, string> = {};
    for (const s of state.swarms) swarms[s.id] = s.name;
    for (const tree of Object.values(state.tree)) {
      for (const c of tree.classes) for (const j of c.jobs) for (const a of j.agents) agents[a.agent.id] = a.agent.name;
    }
    return { swarms, agents };
  }

  function tree(swarmId: string): SwarmTreeDTO {
    const t = state.tree[swarmId];
    if (!t) throw new ApiError(404, "That swarm does not exist.");
    return t;
  }

  function toRow(d: Directive, previous?: DirectiveRow): DirectiveRow {
    const problem =
      d.kind === "param" && d.key
        ? (() => {
            const checked = coerceParam(d.key, d.value);
            return checked.ok ? null : checked.error;
          })()
        : null;
    return {
      ...d,
      level: scopeLevel(d.scope),
      scopeLabel: scopeLabel(d.scope, names()),
      appliedCount: previous?.appliedCount ?? 0,
      lastAppliedAt: previous?.lastAppliedAt ?? null,
      problem,
    };
  }

  /** Recount the directive badges on the tree after steering changes. */
  function recount(): void {
    const live = state.directives.filter((d) => d.status !== "archived");
    for (const t of Object.values(state.tree)) {
      const swarmId = t.swarm.id;
      const at = (scope: ScopeSelector) =>
        live.filter((d) => sameScope(d.scope, scope) || sameScope(d.scope, { ...scope, swarmId })).length;
      t.globalDirectiveCount = live.filter((d) => scopeLevel(d.scope) === "global").length;
      t.swarmDirectiveCount = live.filter((d) => sameScope(d.scope, { swarmId })).length;
      for (const c of t.classes) {
        c.directiveCount = at({ classId: c.cls.id });
        for (const j of c.jobs) {
          j.directiveCount = at({ jobId: j.job.id });
          for (const a of j.agents) a.directiveCount = live.filter((d) => d.scope.agentId === a.agent.id).length;
        }
      }
    }
  }

  function findAgent(agentId: string) {
    for (const t of Object.values(state.tree)) {
      for (const c of t.classes) {
        for (const j of c.jobs) {
          const node = j.agents.find((a) => a.agent.id === agentId);
          if (node) return { tree: t, cls: c, job: j, node };
        }
      }
    }
    return null;
  }

  function founderRows(swarmId: string): FounderRow[] {
    return state.founders[swarmId] ?? [];
  }

  function emptyHunt(swarmId: string): HuntDTO {
    return {
      swarmId,
      enabled: false,
      active: false,
      turn: 0,
      navigator: { agentId: null, paused: false, route: null },
      runners: [],
      engines: [],
      limits: { turns: 4, waveSize: 12, maxDepth: 2, budgetShare: 0.25, latestStage: "seed", plantedEvery: 12 },
      totals: { searches: 0, pages: 0, leads: 0, kept: 0, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0 },
      planted: { read: 0, failed: 0 },
      trails: [],
      notes: [],
      calls: [],
      waves: [],
      finds: [],
    };
  }

  function requireSwarm(swarmId: string): void {
    if (!state.swarms.some((swarm) => swarm.id === swarmId)) throw new ApiError(404, "That swarm does not exist.");
  }

  function mutableHunt(swarmId: string): HuntDTO {
    requireSwarm(swarmId);
    state.hunts ??= {};
    state.hunts[swarmId] ??= emptyHunt(swarmId);
    return state.hunts[swarmId];
  }

  function huntId(hunt: HuntDTO): string {
    return hunt.trails[0]?.huntId ?? hunt.notes[0]?.huntId ?? `hunt_${globalThis.crypto.randomUUID()}`;
  }

  function updateHuntViews(hunt: HuntDTO): void {
    const trails = hunt.trails.map((trail) => ({ ...trail, score: trailScore(trail), share: 0 }));
    const queuedOpen = trails.filter((trail) => trail.status === "open" && trail.queued > 0);
    const totalScore = queuedOpen.reduce((total, trail) => total + trail.score, 0);
    for (const trail of trails) {
      if (trail.status === "open" && trail.queued > 0 && totalScore > 0) trail.share = trail.score / totalScore;
    }
    const rank = { open: 0, paused: 1, closed: 2 } as const;
    hunt.trails = trails.sort((a, b) => rank[a.status] - rank[b.status] || b.score - a.score || a.openedAt.localeCompare(b.openedAt));
  }

  function checkHuntTrailInput(hunt: HuntDTO, input: AddTrailInput) {
    const fields: Record<string, string> = {};
    const name = typeof input?.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
    if (!name) fields.name = "Give this trail a name.";
    else if (name.length > 60) fields.name = "Use 60 characters or fewer.";

    const intent = typeof input?.intent === "string" ? input.intent.replace(/\s+/g, " ").trim() : "";
    if (intent.length > 200) fields.intent = "Use 200 characters or fewer.";

    const searches: Array<{ engine: string; query: string }> = [];
    for (const search of input?.searches ?? []) {
      const engine = typeof search?.engine === "string" ? search.engine.trim() : "";
      const query = typeof search?.query === "string" ? search.query.replace(/\s+/g, " ").trim() : "";
      if (!query) {
        fields.searches = "Enter words to search for.";
        continue;
      }
      if (query.length > 200) {
        fields.searches = "Searches must be 200 characters or fewer.";
        continue;
      }
      if (!hunt.engines.some((candidate) => candidate.id === engine && candidate.configured)) {
        fields.searches = "Choose a configured search engine.";
        continue;
      }
      searches.push({ engine, query });
    }

    const pages: string[] = [];
    for (const page of input?.pages ?? []) {
      const url = typeof page === "string" ? cleanUrl(page) : null;
      if (!url) {
        fields.pages = "Enter a public web page address that can be fetched.";
        continue;
      }
      pages.push(url);
    }

    const starts = [
      ...new Set(searches.map((search) => `search:${search.engine}:${search.query.toLowerCase()}`)),
      ...new Set(pages.map((url) => `page:${url}`)),
    ];
    if (!starts.length) fields.searches = "Add a search or a public page to start this trail.";
    else if (starts.length > 4) fields.searches = "A trail can start with up to four searches and pages.";

    const normalizedName = name.toLocaleLowerCase();
    if (name && hunt.trails.some((trail) => trail.status !== "closed" && trail.name.replace(/\s+/g, " ").trim().toLocaleLowerCase() === normalizedName)) {
      fields.name = "A trail with this name is already open or paused.";
    }
    if (Object.keys(fields).length) throw new ApiError(400, "Check the highlighted fields.", fields);
    return { name, intent: intent || name, searches, pages, queued: starts.length };
  }

  /** Every call recorded in the demo, across the dossiers the snapshot holds. */
  function allFeedback(swarmId: string): Feedback[] {
    const ids = new Set(founderRows(swarmId).map((r) => r.id));
    return Object.values(state.founderDetails)
      .filter((d) => ids.has(d.founder.id))
      .flatMap((d) => d.feedback);
  }

  function callExamples(swarmId: string): CallExample[] {
    return allFeedback(swarmId).map((f) => {
      const founder = state.founderDetails[f.founderId]?.founder;
      const about = founder
        ? [founder.company.name, founder.company.oneLiner ?? founder.headline].filter(Boolean).join(": ")
        : "A candidate";
      return { verdict: f.verdict, about, reasonTags: f.reasonTags, note: f.note, at: f.createdAt };
    });
  }

  function suggestions(swarmId: string): SteeringSuggestion[] {
    const t = tree(swarmId);
    const resolved = resolveSteering(state.directives, swarmIdentity(swarmId));
    const current: Record<string, number> = {};
    for (const def of PARAM_DEFS) {
      const value = effectiveParam(def.key, resolved, t.config).value;
      if (typeof value === "number") current[def.key] = value;
    }
    return suggestSteering(allFeedback(swarmId), {
      swarmId,
      current,
      dismissed: state.settings.settings.dismissedSuggestions,
    });
  }

  function callsSummary(swarmId: string) {
    const rows = founderRows(swarmId).filter((r) => r.decision === "surface" || r.status === "surfaced");
    const called = rows.filter((r) => r.feedback !== null);
    return summarizeCalls(allFeedback(swarmId), {
      called: called.length,
      yes: called.filter((r) => r.feedback === "yes").length,
      waiting: rows.filter((r) => r.feedback === null && r.status === "surfaced").length,
    });
  }

  const client: ApiClient = {
    async getSettings() {
      return clone(state.settings);
    },
    async updateSettings(patch) {
      const { schedule, autopilot, ...rest } = patch;
      state.settings.settings = {
        ...state.settings.settings,
        ...rest,
        schedule: { ...state.settings.settings.schedule, ...(schedule ?? {}) },
        autopilot: { ...state.settings.settings.autopilot, ...(autopilot ?? {}) },
      };
      return clone(state.settings);
    },

    async listSwarms() {
      return clone(state.swarms);
    },
    async createSwarm() {
      throw new ApiError(400, READ_ONLY);
    },
    async updateSwarm(id, patch) {
      const swarm = state.swarms.find((s) => s.id === id);
      if (!swarm) throw new ApiError(404, "That swarm does not exist.");
      Object.assign(swarm, patch, { updatedAt: now() });
      const t = state.tree[id];
      if (t) t.swarm = clone(swarm);
      const o = state.overview[id];
      if (o) o.swarm = clone(swarm);
      return clone(swarm);
    },
    async getOverview(swarmId) {
      const o = state.overview[swarmId];
      if (!o) throw new ApiError(404, "That swarm does not exist.");
      const pending = (state.outreach[swarmId] ?? []).filter((x) => x.status === "proposed").length;
      return clone({
        ...o,
        today: { ...o.today, pendingApprovals: pending },
        topFounders: founderRows(swarmId).filter((r) => r.status === "surfaced").slice(0, 12),
        calls: callsSummary(swarmId),
      });
    },
    async getTree(swarmId) {
      return clone(tree(swarmId));
    },
    async addAgent() {
      throw new ApiError(400, READ_ONLY);
    },
    async updateAgent(agentId, patch) {
      const found = findAgent(agentId);
      if (!found) throw new ApiError(404, "That agent does not exist.");
      Object.assign(found.node.agent, patch);
      if (patch.status) found.node.health = patch.status === "paused" ? "paused" : "idle";
      return clone(found.node.agent);
    },

    async listDirectives(filter = {}) {
      let rows = state.directives;
      if (filter.swarmId) {
        const id = filter.swarmId;
        rows = rows.filter((d) => {
          if (d.scope.agentId) return findAgent(d.scope.agentId)?.tree.swarm.id === id;
          return !d.scope.swarmId || d.scope.swarmId === id;
        });
      }
      if (filter.level) rows = rows.filter((d) => d.level === filter.level);
      if (filter.kind) rows = rows.filter((d) => d.kind === filter.kind);
      if (filter.status) rows = rows.filter((d) => d.status === filter.status);
      else rows = rows.filter((d) => d.status !== "archived");
      if (filter.scope) {
        const scope = filter.scope;
        rows = rows.filter((d) => sameScope(d.scope, scope));
      }
      return clone([...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    },
    async createDirective(input) {
      const fields: Record<string, string> = {};
      let value = input.value ?? null;
      if (input.kind === "param") {
        if (!input.key) fields.key = "Choose which setting to change.";
        else {
          const checked = coerceParam(input.key, input.value);
          if (checked.ok) value = checked.value;
          else fields.value = checked.error;
        }
      } else if (!input.text?.trim()) {
        fields.text = "Write what the agents should know or do.";
      }
      if (Object.keys(fields).length) throw new ApiError(400, "Check the highlighted fields.", fields);

      const stamp = now();
      const directive: Directive = {
        id: newId("dir"),
        scope: normalizeScope(input.scope),
        kind: input.kind,
        key: input.kind === "param" ? (input.key ?? null) : null,
        value: input.kind === "param" ? value : null,
        text: input.kind === "param" ? null : (input.text?.trim() ?? null),
        priority: input.priority ?? 0,
        status: "active",
        author: getActor(),
        note: input.note ?? null,
        createdAt: stamp,
        updatedAt: stamp,
        expiresAt: input.expiresAt ?? null,
      };
      state.directives.push(toRow(directive));
      recount();
      return clone(directive);
    },
    async updateDirective(id, patch) {
      const index = state.directives.findIndex((d) => d.id === id);
      const existing = state.directives[index];
      if (!existing) throw new ApiError(404, "That directive does not exist.");
      if (patch.value !== undefined && existing.kind === "param" && existing.key) {
        const checked = coerceParam(existing.key, patch.value);
        if (!checked.ok) throw new ApiError(400, checked.error, { value: checked.error });
      }
      const updated: Directive = { ...existing, ...patch, updatedAt: now() };
      state.directives[index] = toRow(updated, existing);
      recount();
      return clone(updated);
    },
    async getEffectiveSteering(query) {
      const t = tree(query.swarmId);
      let identity: AgentIdentity = swarmIdentity(query.swarmId);
      let label = t.swarm.name;
      if (query.agentId) {
        const found = findAgent(query.agentId);
        if (!found) throw new ApiError(404, "That agent does not exist.");
        identity = {
          swarmId: query.swarmId,
          classId: found.cls.cls.id,
          jobId: found.job.job.id,
          agentId: query.agentId,
        };
        label = found.node.agent.name;
      } else if (query.jobId) {
        const cls = t.classes.find((c) => c.jobs.some((j) => j.job.id === query.jobId));
        const job = cls?.jobs.find((j) => j.job.id === query.jobId);
        if (!cls || !job) throw new ApiError(404, "That job does not exist.");
        identity = { swarmId: query.swarmId, classId: cls.cls.id, jobId: job.job.id, agentId: null };
        label = job.job.label;
      } else if (query.classId) {
        const cls = t.classes.find((c) => c.cls.id === query.classId);
        if (!cls) throw new ApiError(404, "That class of agents does not exist.");
        identity = { swarmId: query.swarmId, classId: cls.cls.id, jobId: null, agentId: null };
        label = cls.cls.label;
      }
      const steering = buildEffectiveSteering({
        directives: state.directives,
        identity,
        config: t.config,
        names: names(),
        label,
        calls: callExamples(query.swarmId),
      });
      const skillOff = String(steering.resolved.params["skills.off"]?.value ?? t.config.params["skills.off"] ?? "")
        .split(",").map((id) => id.trim()).includes("github-authorship");
      const skills = identity.jobId === "scout.github" || identity.classId === "scout"
        ? [{
            id: "github-authorship",
            name: "Repository authorship",
            description: "Read repository signals without assuming who owns an organization project.",
            off: skillOff,
          }]
        : [];
      // One sample job carries a line the swarm wrote for itself, so the Told tab shows it.
      if (identity.jobId === "scout.github") {
        return { ...steering, skills, lessons: ["Repositories with fast star growth from several unrelated accounts were often paid for."] };
      }
      return { ...steering, skills };
    },
    async listSuggestions(swarmId) {
      return suggestions(swarmId);
    },
    async dismissSuggestion(swarmId, key) {
      const settings = state.settings.settings;
      if (!settings.dismissedSuggestions.includes(key)) settings.dismissedSuggestions.push(key);
      return suggestions(swarmId);
    },

    async listFounders(query) {
      const all = founderRows(query.swarmId);
      const counts: Record<string, number> = {};
      for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1;

      let rows = all;
      if (query.status && query.status !== "all") rows = rows.filter((r) => r.status === query.status);
      if (query.decision) rows = rows.filter((r) => r.decision === query.decision);
      if (query.q?.trim()) {
        const q = query.q.trim().toLowerCase();
        rows = rows.filter((r) =>
          [r.name, r.headline ?? "", r.companyName ?? "", r.companyOneLiner ?? "", r.sector ?? "", r.stage ?? "", r.tagline ?? "", r.moat ?? ""]
            .some((v) => v.toLowerCase().includes(q)),
        );
      }
      const sort = query.sort ?? "composite";
      const recent = (a: FounderRow, b: FounderRow) => b.updatedAt.localeCompare(a.updatedAt);
      const pick = (r: FounderRow) => (sort === "cracked" ? r.cracked : sort === "fit" ? r.fit : r.composite);
      rows = [...rows].sort((a, b) => {
        if (sort === "recent") return recent(a, b);
        const x = pick(a);
        const y = pick(b);
        if (x === null && y === null) return recent(a, b);
        if (x === null) return 1;
        if (y === null) return -1;
        return y - x || recent(a, b);
      });
      const offset = query.offset ?? 0;
      const limit = Math.min(query.limit ?? 50, 500);
      return clone({ rows: rows.slice(offset, offset + limit), total: rows.length, counts });
    },
    async getFounder(id) {
      const detail = state.founderDetails[id];
      if (!detail) {
        throw new ApiError(404, "The demo snapshot holds full dossiers only for the highest-ranked founders.");
      }
      return clone(detail);
    },
    async addFeedback(founderId, input) {
      const tags = (input.reasonTags ?? []).filter((t) => isReasonFor(input.verdict, t));
      const feedback: Feedback = {
        id: newId("fbk"),
        founderId,
        author: getActor(),
        verdict: input.verdict,
        reasonTags: tags,
        note: input.note?.trim() || null,
        createdAt: now(),
      };
      const detail = state.founderDetails[founderId];
      detail?.feedback.unshift(feedback);
      // A no takes the founder off the list. A yes keeps them surfaced; outreach is drafted on the next run.
      if (detail && input.verdict === "no") detail.founder.status = "passed";
      for (const rows of Object.values(state.founders)) {
        const row = rows.find((r) => r.id === founderId);
        if (!row) continue;
        row.feedback = input.verdict;
        row.feedbackReasons = tags;
        if (input.verdict === "no") row.status = "passed";
      }
      return clone(feedback);
    },

    async addFounder() {
      throw new ApiError(400, READ_ONLY);
    },

    async listCompanies(query: CompanyQuery): Promise<CompanyListDTO> {
      const all = state.companies?.[query.swarmId] ?? [];
      const counts: Record<string, number> = {};
      for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1;

      let rows = all;
      if (query.status && query.status !== "all") rows = rows.filter((r) => r.status === query.status);
      if (query.q?.trim()) {
        const q = query.q.trim().toLowerCase();
        rows = rows.filter((r) => [r.name, r.oneLiner ?? "", r.tagline ?? "", r.moat ?? "", r.sector ?? "", r.stage ?? ""].some((v) => v.toLowerCase().includes(q)));
      }
      const sort = query.sort ?? "deal";
      const recent = (a: CompanyRow, b: CompanyRow) => b.updatedAt.localeCompare(a.updatedAt);
      const pick = (r: CompanyRow) => (sort === "company" ? r.company : sort === "team" ? r.team : r.deal);
      rows = [...rows].sort((a, b) => {
        if (sort === "recent") return recent(a, b);
        const x = pick(a);
        const y = pick(b);
        if (x === null && y === null) return recent(a, b);
        if (x === null) return 1;
        if (y === null) return -1;
        return y - x || recent(a, b);
      });
      const offset = query.offset ?? 0;
      const limit = Math.min(query.limit ?? 50, 500);
      return clone({ rows: rows.slice(offset, offset + limit), total: rows.length, counts: counts as CompanyListDTO["counts"] });
    },
    async getCompany(id): Promise<CompanyDetailDTO> {
      const detail = state.companyDetails?.[id];
      if (!detail) {
        throw new ApiError(404, "The demo snapshot holds full records only for the highest-ranked companies.");
      }
      return clone(detail);
    },
    async addCompanyFeedback(companyId, input): Promise<CompanyFeedback> {
      const tags = (input.reasonTags ?? []).filter((t) => isCompanyReasonFor(input.verdict, t));
      const feedback: CompanyFeedback = {
        id: newId("fbk"),
        companyId,
        author: getActor(),
        verdict: input.verdict,
        reasonTags: tags,
        note: input.note?.trim() || null,
        createdAt: now(),
      };
      const detail = state.companyDetails?.[companyId];
      detail?.feedback.unshift(feedback);
      // A no takes the company off the list. A yes keeps it surfaced.
      if (detail && input.verdict === "no") detail.company.status = "passed";
      for (const rows of Object.values(state.companies ?? {})) {
        const row = rows.find((r) => r.id === companyId);
        if (!row) continue;
        row.feedback = input.verdict;
        row.feedbackReasons = tags;
        if (input.verdict === "no") row.status = "passed";
      }
      return clone(feedback);
    },

    async getNetwork() {
      return { owners: [], total: 0 };
    },
    async importNetwork() {
      throw new ApiError(400, READ_ONLY);
    },
    async removeNetwork() {
      throw new ApiError(400, READ_ONLY);
    },

    async listOutreach(query) {
      let rows: OutreachRow[] = state.outreach[query.swarmId] ?? [];
      if (query.status && query.status !== "all") rows = rows.filter((r) => r.status === query.status);
      return clone(rows);
    },
    async decideOutreach(id, input) {
      for (const rows of Object.values(state.outreach)) {
        const row = rows.find((r) => r.id === id);
        if (!row) continue;
        if (row.status !== "proposed") throw new ApiError(409, "This item has already been decided.");
        row.status = input.decision === "approve" ? "approved" : "rejected";
        row.decidedBy = getActor();
        row.decidedAt = now();
        row.decisionNote = input.note ?? null;
        if (input.draft) row.draft = input.draft;
        row.updatedAt = now();
        return clone(row);
      }
      throw new ApiError(404, "That outreach item does not exist.");
    },
    async completeOutreach(id, input) {
      for (const rows of Object.values(state.outreach)) {
        const row = rows.find((r) => r.id === id);
        if (!row) continue;
        if (row.status !== "approved" && row.status !== "dispatched") {
          throw new ApiError(409, "Only an approved item can be marked as done.");
        }
        row.status = "completed";
        row.resultSummary = input.summary;
        row.updatedAt = now();
        return clone(row);
      }
      throw new ApiError(404, "That outreach item does not exist.");
    },
    async placeCall() {
      throw new ApiError(400, READ_ONLY);
    },
    async syncCalls() {
      return [];
    },

    async listRuns(swarmId, limit = 30) {
      return clone((state.runs[swarmId] ?? []).slice(0, limit));
    },
    async getRun(id) {
      const detail = state.runDetails[id];
      if (!detail) throw new ApiError(404, "The demo snapshot does not include the details of that run.");
      return clone(detail);
    },
    async getTask(id) {
      const task = state.tasks[id];
      if (!task) throw new ApiError(404, "The demo snapshot does not include the transcript of that task.");
      return clone(task);
    },
    async startRun() {
      throw new ApiError(400, READ_ONLY);
    },
    async cancelRun() {
      throw new ApiError(400, READ_ONLY);
    },

    async listEvalFlows() {
      return clone(
        state.evalFlows.map(({ id, label, description, headlineMetric, baseline, best, rounds, updatedAt }) => ({
          id,
          label,
          description,
          headlineMetric,
          baseline,
          best,
          rounds,
          updatedAt,
        })),
      );
    },
    async getEvalFlow(id) {
      const flow = state.evalFlows.find((f) => f.id === id);
      if (!flow) throw new ApiError(404, "That eval does not exist.");
      return clone(flow);
    },
    async runEvalRounds() {
      throw new ApiError(400, READ_ONLY);
    },
    async promoteEvalVariant() {
      throw new ApiError(400, READ_ONLY);
    },
    async previewEvalVariant() {
      return clone(snapshot.preview ?? { founders: [], companies: [], considered: { founders: 0, companies: 0 }, unseen: [] });
    },
    async getAssumptions() {
      // A snapshot made before assumptions existed still shows the list, with nothing tested yet.
      return clone(snapshot.assumptions ?? {
        rows: judgeAssumptions({ outcomes: null, calls: [], current: () => null }),
        outcomesBasis: null,
        callsBasis: null,
      });
    },
    async getPools() {
      return clone(snapshot.pools ?? { pools: [], windowDays: 14 });
    },
    async setPool() {
      throw new ApiError(400, READ_ONLY);
    },
    async rebalancePools() {
      throw new ApiError(400, READ_ONLY);
    },
    async getHunt(swarmId) {
      requireSwarm(swarmId);
      return clone(state.hunts?.[swarmId] ?? emptyHunt(swarmId));
    },
    async getHuntSeat(swarmId): Promise<HuntSeatDTO> {
      requireSwarm(swarmId);
      const hunt = state.hunts?.[swarmId] ?? emptyHunt(swarmId);
      const swarm = snapshot.swarms.find((item) => item.id === swarmId)!;
      const trails = [...hunt.trails.filter((trail) => trail.status === "open" || trail.status === "paused"),
        ...hunt.trails.filter((trail) => trail.status === "closed").sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")).slice(0, 5)];
      const turnsLeft = Math.max(0, hunt.limits.turns - hunt.turn);
      const view: NavigateInput = {
        thesis: swarm.thesis,
        brief: { latestStage: hunt.limits.latestStage, engines: hunt.engines.filter((engine) => engine.configured).map(({ id, label, searches }) => ({ id, label, searches })), waveSize: hunt.limits.waveSize, maxOpenTrails: 8 },
        turn: hunt.turn + 1,
        trails: trails.map((trail) => ({ id: trail.id, name: trail.name, intent: trail.intent, status: trail.status, openedBy: trail.openedBy, weight: trail.weight, pinned: trail.pinned, searches: trail.stats.searches, pages: trail.stats.pages, leads: trail.stats.leads, kept: trail.stats.kept, tooLate: trail.stats.tooLate, blocked: trail.stats.blocked, queued: trail.queued, costUsd: trail.stats.costUsd })),
        notes: hunt.notes.slice(0, 12).map(({ by, text }) => ({ by, text })),
        lastWave: null,
        budget: { turnsLeft, callsLeft: turnsLeft * hunt.limits.waveSize },
      };
      return { swarmId, configuredHolder: "built_in", holder: "built_in", seatAt: null, activeRun: null, view };
    },
    async takeHuntTurn() {
      throw new ApiError(400, READ_ONLY);
    },
    async runHuntWave() {
      throw new ApiError(400, READ_ONLY);
    },
    async addHuntTrail(swarmId, input) {
      const hunt = mutableHunt(swarmId);
      const checked = checkHuntTrailInput(hunt, input);
      const stamp = now();
      hunt.trails.push({
        id: `trail_${globalThis.crypto.randomUUID()}`,
        huntId: huntId(hunt),
        swarmId,
        name: checked.name,
        intent: checked.intent,
        status: "open",
        openedBy: "person",
        weight: 3,
        pinned: false,
        stats: { ...ZERO_TRAIL_STATS },
        openedAt: stamp,
        closedAt: null,
        closedWhy: null,
        queued: checked.queued,
        score: 0,
        share: 0,
      });
      updateHuntViews(hunt);
      return clone(hunt);
    },
    async updateHuntTrail(swarmId, trailId, input: UpdateTrailInput) {
      requireSwarm(swarmId);
      const hunt = state.hunts?.[swarmId];
      if (!hunt) throw new ApiError(404, "That trail does not exist.");
      const trail = hunt.trails.find((candidate) => candidate.id === trailId);
      if (!trail) throw new ApiError(404, "That trail does not exist.");

      const fields: Record<string, string> = {};
      if (input.status !== undefined && !["open", "paused", "closed"].includes(input.status)) {
        fields.status = "Choose open, paused, or closed.";
      }
      if (input.pinned !== undefined && typeof input.pinned !== "boolean") fields.pinned = "Choose whether to pin this trail.";
      if (input.weight !== undefined && (!Number.isInteger(input.weight) || input.weight < 1 || input.weight > 5)) {
        fields.weight = "Attention must be a whole number from 1 to 5.";
      }
      if (Object.keys(fields).length) throw new ApiError(400, "Check the highlighted fields.", fields);
      if (input.status === "closed" && (input.pinned ?? trail.pinned)) {
        throw new ApiError(409, "Unpin this trail before closing it.");
      }

      if (input.status !== undefined) {
        trail.status = input.status;
        trail.closedAt = input.status === "closed" ? now() : null;
        trail.closedWhy = input.status === "closed" ? "Closed by a person." : null;
      }
      if (input.pinned !== undefined) trail.pinned = input.pinned;
      if (input.weight !== undefined) trail.weight = input.weight;
      updateHuntViews(hunt);
      return clone(hunt);
    },
    async addHuntNote(swarmId, input) {
      const hunt = mutableHunt(swarmId);
      const text = typeof input?.text === "string" ? input.text.replace(/\s+/g, " ").trim() : "";
      if (!text) throw new ApiError(400, "Write a note for the navigator.", { text: "Write a note." });
      if (text.length > 240) throw new ApiError(400, "Keep notes to 240 characters or fewer.", { text: "Use 240 characters or fewer." });
      hunt.notes.unshift({
        id: `note_${globalThis.crypto.randomUUID()}`,
        huntId: huntId(hunt),
        swarmId,
        by: "person",
        text,
        turn: hunt.turn,
        createdAt: now(),
      });
      return clone(hunt);
    },
    async removeHuntNote(swarmId, noteId) {
      requireSwarm(swarmId);
      const hunt = state.hunts?.[swarmId];
      if (!hunt) throw new ApiError(404, "That note does not exist.");
      const noteIndex = hunt.notes.findIndex((note) => note.id === noteId);
      if (noteIndex === -1) throw new ApiError(404, "That note does not exist.");
      hunt.notes.splice(noteIndex, 1);
      return clone(hunt);
    },
  };

  recount();
  return client;
}

/** Whether scope `d` would reach an agent, exported for pages that preview reach. */
export function directiveReaches(scope: ScopeSelector, identity: AgentIdentity): boolean {
  return scopeMatches(scope, identity);
}
