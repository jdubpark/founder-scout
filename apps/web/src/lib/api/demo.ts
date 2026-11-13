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
  normalizeScope,
  scopeLabel,
  scopeLevel,
  scopeMatches,
  swarmIdentity,
  type AgentIdentity,
  type ApiClient,
  type CallExample,
  type Feedback,
  type SteeringSuggestion,
  type DemoSnapshot,
  type Directive,
  type DirectiveRow,
  type FounderRow,
  type OutreachRow,
  type ScopeNames,
  type ScopeSelector,
  type SwarmTreeDTO,
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
      const { schedule, ...rest } = patch;
      state.settings.settings = {
        ...state.settings.settings,
        ...rest,
        schedule: { ...state.settings.settings.schedule, ...(schedule ?? {}) },
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
      return buildEffectiveSteering({
        directives: state.directives,
        identity,
        config: t.config,
        names: names(),
        label,
        calls: callExamples(query.swarmId),
      });
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
          [r.name, r.headline ?? "", r.companyName ?? ""].some((v) => v.toLowerCase().includes(q)),
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
  };

  recount();
  return client;
}

/** Whether scope `d` would reach an agent, exported for pages that preview reach. */
export function directiveReaches(scope: ScopeSelector, identity: AgentIdentity): boolean {
  return scopeMatches(scope, identity);
}
