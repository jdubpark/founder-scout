import type Database from "better-sqlite3";
import {
  DEFAULT_SETTINGS,
  type Agent,
  type FounderListDTO,
  type FounderQuery,
  type FounderRow,
  type Assessment,
  type AuditEntry,
  type Directive,
  type Evidence,
  type Feedback,
  type FeedbackVerdict,
  type Founder,
  type FounderStatus,
  type Lead,
  type Memo,
  type OutreachAction,
  type OutreachStatus,
  type ProfileLinks,
  type Run,
  type Settings,
  type Swarm,
  type SwarmConfig,
  type TaskRun,
  type Verification,
  newId,
} from "@agentswarm/shared";
import type { NodeStatRow, Store } from "../contracts";

type RecordRow = { record: string };
type FounderStatusValue = FounderStatus;
const founderStatuses: readonly FounderStatus[] = [
  "lead", "screened_out", "queued", "surfaced", "needs_evidence", "watch", "passed", "contacted", "meeting", "archived",
];
const linkFields = ["github", "linkedin", "x", "site", "scholar"] as const;
type LinkField = (typeof linkFields)[number];

function parse<T>(row: RecordRow | undefined): T | null {
  return row === undefined ? null : JSON.parse(row.record) as T;
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function clone<T>(value: T): T {
  return JSON.parse(serialize(value)) as T;
}

function missing(kind: string, id: string): Error {
  return new Error(`${kind} ${id} not found`);
}

function rowRecords<T>(rows: readonly RecordRow[]): T[] {
  return rows.map((row) => JSON.parse(row.record) as T);
}

function updateRecord<T extends { id: string }>(
  db: Database.Database,
  table: string,
  id: string,
  patch: object,
  kind: string,
): T {
  const current = parse<T>(db.prepare(`SELECT record FROM ${table} WHERE id = ?`).get(id) as RecordRow | undefined);
  if (current === null) throw missing(kind, id);
  const updated = { ...current, ...patch } as T;
  db.prepare(`UPDATE ${table} SET record = ? WHERE id = ?`).run(serialize(updated), id);
  return updated;
}

function linksFor(links: ProfileLinks): Array<[LinkField, string]> {
  const normalized: Array<[LinkField, string]> = [];
  for (const field of linkFields) {
    const link = links[field];
    if (link !== null) normalized.push([field, normalizeLink(link)]);
  }
  return normalized;
}

function saveFounderLinks(db: Database.Database, founder: Founder): void {
  db.prepare("DELETE FROM founder_links WHERE founder_id = ?").run(founder.id);
  const insert = db.prepare("INSERT INTO founder_links (swarm_id, founder_id, field, normalized_link) VALUES (?, ?, ?, ?)");
  for (const [field, link] of linksFor(founder.links)) insert.run(founder.swarmId, founder.id, field, link);
}

function compareUpdated(a: { updatedAt: string; id: string }, b: { updatedAt: string; id: string }): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
}

function compareMetric(a: FounderRow, b: FounderRow, key: "composite" | "cracked" | "fit"): number {
  const left = a[key];
  const right = b[key];
  if (left === null && right !== null) return 1;
  if (left !== null && right === null) return -1;
  if (left !== null && right !== null && left !== right) return right - left;
  return compareUpdated(a, b);
}

export function normalizeLink(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z\d+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .split(/[?#]/, 1)[0]!
    .replace(/\/+$/, "");
}

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class SqliteStore implements Store {
  constructor(private readonly db: Database.Database) {}

  close(): void { this.db.close(); }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  getSettings(): Settings {
    const found = parse<Settings>(this.db.prepare("SELECT record FROM settings WHERE id = 'settings'").get() as RecordRow | undefined);
    return found ?? clone(DEFAULT_SETTINGS);
  }

  saveSettings(settings: Settings): void {
    this.db.prepare("INSERT INTO settings (id, record) VALUES ('settings', ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record")
      .run(serialize(settings));
  }

  getConfig(id: string): SwarmConfig | null {
    return parse(this.db.prepare("SELECT record FROM configs WHERE id = ?").get(id) as RecordRow | undefined);
  }

  saveConfig(config: SwarmConfig): void {
    this.db.prepare("INSERT INTO configs (id, record) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record")
      .run(config.id, serialize(config));
  }

  listConfigs(): SwarmConfig[] {
    return rowRecords(this.db.prepare("SELECT record FROM configs ORDER BY rowid ASC").all() as RecordRow[]);
  }

  listSwarms(): Swarm[] {
    return rowRecords(this.db.prepare("SELECT record FROM swarms ORDER BY rowid ASC").all() as RecordRow[]);
  }

  getSwarm(id: string): Swarm | null {
    return parse(this.db.prepare("SELECT record FROM swarms WHERE id = ?").get(id) as RecordRow | undefined);
  }

  insertSwarm(swarm: Swarm): void {
    this.db.prepare("INSERT INTO swarms (id, record) VALUES (?, ?)").run(swarm.id, serialize(swarm));
  }

  updateSwarm(id: string, patch: Partial<Pick<Swarm, "name" | "status" | "thesis" | "configId">>): Swarm {
    return updateRecord(this.db, "swarms", id, patch, "Swarm");
  }

  listAgents(swarmId: string): Agent[] {
    return rowRecords(this.db.prepare("SELECT record FROM agents WHERE swarm_id = ? ORDER BY rowid ASC").all(swarmId) as RecordRow[]);
  }

  getAgent(id: string): Agent | null {
    return parse(this.db.prepare("SELECT record FROM agents WHERE id = ?").get(id) as RecordRow | undefined);
  }

  insertAgent(agent: Agent): void {
    this.db.prepare("INSERT INTO agents (id, swarm_id, record) VALUES (?, ?, ?)").run(agent.id, agent.swarmId, serialize(agent));
  }

  updateAgent(id: string, patch: Partial<Pick<Agent, "name" | "status" | "beat" | "state">>): Agent {
    const agent = updateRecord<Agent>(this.db, "agents", id, patch, "Agent");
    this.db.prepare("UPDATE agents SET record = ? WHERE id = ?").run(serialize(agent), id);
    return agent;
  }

  listDirectives(options: { includeArchived?: boolean } = {}): Directive[] {
    const sql = options.includeArchived
      ? "SELECT record FROM directives ORDER BY created_at ASC, rowid ASC"
      : "SELECT record FROM directives WHERE status != 'archived' ORDER BY created_at ASC, rowid ASC";
    return rowRecords(this.db.prepare(sql).all() as RecordRow[]);
  }

  getDirective(id: string): Directive | null {
    return parse(this.db.prepare("SELECT record FROM directives WHERE id = ?").get(id) as RecordRow | undefined);
  }

  insertDirective(directive: Directive): void {
    this.db.prepare("INSERT INTO directives (id, status, created_at, record) VALUES (?, ?, ?, ?)")
      .run(directive.id, directive.status, directive.createdAt, serialize(directive));
  }

  updateDirective(id: string, patch: Partial<Pick<Directive, "status" | "value" | "text" | "priority" | "note" | "expiresAt">>): Directive {
    const updated = updateRecord<Directive>(this.db, "directives", id, patch, "Directive");
    this.db.prepare("UPDATE directives SET status = ?, record = ? WHERE id = ?").run(updated.status, serialize(updated), id);
    return updated;
  }

  directiveUsage(): Map<string, { appliedCount: number; lastAppliedAt: string | null }> {
    const rows = this.db.prepare(`
      SELECT td.directive_id AS id, COUNT(*) AS count, MAX(t.started_at) AS last_at
      FROM task_directives td JOIN tasks t ON t.id = td.task_id
      GROUP BY td.directive_id ORDER BY td.directive_id ASC
    `).all() as Array<{ id: string; count: number; last_at: string | null }>;
    return new Map(rows.map((row) => [row.id, { appliedCount: row.count, lastAppliedAt: row.last_at }]));
  }

  insertLead(lead: Lead): void {
    this.db.prepare("INSERT INTO leads (id, swarm_id, founder_id, discovered_at, record) VALUES (?, ?, ?, ?, ?)")
      .run(lead.id, lead.swarmId, lead.founderId, lead.discoveredAt, serialize(lead));
  }

  listLeads(filter: { swarmId?: string; founderId?: string; unmatchedOnly?: boolean }): Lead[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.swarmId !== undefined) { where.push("swarm_id = ?"); params.push(filter.swarmId); }
    if (filter.founderId !== undefined) { where.push("founder_id = ?"); params.push(filter.founderId); }
    if (filter.unmatchedOnly) where.push("founder_id IS NULL");
    const sql = `SELECT record FROM leads${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY rowid ASC`;
    return rowRecords(this.db.prepare(sql).all(...params) as RecordRow[]);
  }

  attachLead(leadId: string, founderId: string): void {
    const row = this.db.prepare("SELECT record FROM leads WHERE id = ?").get(leadId) as RecordRow | undefined;
    if (!row) throw missing("Lead", leadId);
    const lead = { ...JSON.parse(row.record) as Lead, founderId };
    this.db.prepare("UPDATE leads SET founder_id = ?, record = ? WHERE id = ?").run(founderId, serialize(lead), leadId);
  }

  insertFounder(founder: Founder): void {
    this.transaction(() => {
      this.db.prepare(`INSERT INTO founders (id, swarm_id, normalized_name, updated_at, next_recheck_at, status, record)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(founder.id, founder.swarmId, normalizeName(founder.name), founder.updatedAt, founder.nextRecheckAt, founder.status, serialize(founder));
      saveFounderLinks(this.db, founder);
    });
  }

  getFounder(id: string): Founder | null {
    return parse(this.db.prepare("SELECT record FROM founders WHERE id = ?").get(id) as RecordRow | undefined);
  }

  updateFounder(id: string, patch: Partial<Omit<Founder, "id" | "swarmId">>): Founder {
    return this.transaction(() => {
      const current = this.getFounder(id);
      if (current === null) throw missing("Founder", id);
      const updated = { ...current, ...patch };
      this.db.prepare(`UPDATE founders SET normalized_name = ?, updated_at = ?, next_recheck_at = ?, status = ?, record = ? WHERE id = ?`)
        .run(normalizeName(updated.name), updated.updatedAt, updated.nextRecheckAt, updated.status, serialize(updated), id);
      saveFounderLinks(this.db, updated);
      return updated;
    });
  }

  findFounderByLinks(swarmId: string, links: ProfileLinks): Founder | null {
    const candidates = linksFor(links);
    for (const [field, link] of candidates) {
      const found = this.db.prepare(`
        SELECT f.record FROM founder_links l JOIN founders f ON f.id = l.founder_id
        WHERE l.swarm_id = ? AND l.field = ? AND l.normalized_link = ? ORDER BY f.rowid ASC LIMIT 1
      `).get(swarmId, field, link) as RecordRow | undefined;
      if (found) return JSON.parse(found.record) as Founder;
    }
    return null;
  }

  findFoundersByName(swarmId: string, normalizedName: string): Founder[] {
    return rowRecords(this.db.prepare("SELECT record FROM founders WHERE swarm_id = ? AND normalized_name = ? ORDER BY rowid ASC")
      .all(swarmId, normalizedName) as RecordRow[]);
  }

  listFounders(filter: { swarmId: string; statuses?: FounderStatus[]; recheckDueBefore?: string; limit?: number }): Founder[] {
    const where = ["swarm_id = ?"];
    const params: unknown[] = [filter.swarmId];
    if (filter.statuses !== undefined) {
      if (filter.statuses.length === 0) return [];
      where.push(`status IN (${filter.statuses.map(() => "?").join(",")})`);
      params.push(...filter.statuses);
    }
    if (filter.recheckDueBefore !== undefined) {
      where.push("next_recheck_at IS NOT NULL AND next_recheck_at <= ?");
      params.push(filter.recheckDueBefore);
    }
    let sql = `SELECT record FROM founders WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, rowid ASC`;
    if (filter.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(Math.max(0, Math.floor(filter.limit)));
    }
    return rowRecords(this.db.prepare(sql).all(...params) as RecordRow[]);
  }

  founderRows(query: FounderQuery): FounderListDTO {
    const founders = rowRecords<Founder>(this.db.prepare("SELECT record FROM founders WHERE swarm_id = ? ORDER BY rowid ASC").all(query.swarmId) as RecordRow[]);
    const counts: Partial<Record<FounderStatus, number>> = {};
    for (const status of founderStatuses) counts[status] = 0;
    for (const founder of founders) counts[founder.status] = (counts[founder.status] ?? 0) + 1;

    const assessmentRows = this.db.prepare(`
      SELECT a.record FROM assessments a JOIN founders f ON f.id = a.founder_id
      WHERE f.swarm_id = ? ORDER BY a.created_at DESC, a.rowid DESC
    `).all(query.swarmId) as RecordRow[];
    const latestAssessments = new Map<string, Assessment>();
    for (const row of assessmentRows) {
      const assessment = JSON.parse(row.record) as Assessment;
      if (!latestAssessments.has(assessment.founderId)) latestAssessments.set(assessment.founderId, assessment);
    }
    const feedbackRows = this.db.prepare(`
      SELECT fb.record FROM feedback fb JOIN founders f ON f.id = fb.founder_id
      WHERE f.swarm_id = ? ORDER BY fb.created_at DESC, fb.rowid DESC
    `).all(query.swarmId) as RecordRow[];
    const latestFeedback = new Map<string, Feedback>();
    for (const row of feedbackRows) {
      const feedback = JSON.parse(row.record) as Feedback;
      if (!latestFeedback.has(feedback.founderId)) latestFeedback.set(feedback.founderId, feedback);
    }
    const evidenceRows = this.db.prepare(`
      SELECT founder_id, COUNT(*) AS count FROM evidence
      WHERE verification IN ('unverified', 'supported') GROUP BY founder_id
    `).all() as Array<{ founder_id: string; count: number }>;
    const evidenceCounts = new Map(evidenceRows.map((row) => [row.founder_id, row.count]));

    let rows = founders.map((founder): FounderRow => {
      const assessment = latestAssessments.get(founder.id) ?? null;
      return {
        id: founder.id,
        name: founder.name,
        headline: founder.headline,
        companyName: founder.company.name,
        status: founder.status,
        decision: assessment?.decision ?? null,
        composite: assessment?.composite ?? null,
        cracked: assessment?.cracked ?? null,
        founderScore: assessment?.founderScore ?? null,
        fit: assessment?.fit ?? founder.fit,
        coverage: assessment?.coverage ?? null,
        sources: founder.sources,
        evidenceCount: evidenceCounts.get(founder.id) ?? 0,
        flagCount: assessment?.flags.filter((flag) => flag.severity === "warning" || flag.severity === "critical").length ?? 0,
        feedback: latestFeedback.get(founder.id)?.verdict ?? null,
        feedbackReasons: latestFeedback.get(founder.id)?.reasonTags ?? [],
        firstSeenAt: founder.firstSeenAt,
        updatedAt: founder.updatedAt,
      };
    });
    rows = rows.filter((row) => {
      if (query.status === undefined || query.status === "all") {
        if (row.status === "archived") return false;
      } else if (row.status !== query.status) return false;
      if (query.decision !== undefined && row.decision !== query.decision) return false;
      if (query.q !== undefined && query.q.length > 0) {
        const term = query.q.toLowerCase();
        if (![row.name, row.headline, row.companyName].some((value) => value?.toLowerCase().includes(term))) return false;
      }
      return true;
    });
    switch (query.sort ?? "composite") {
      case "cracked": rows.sort((a, b) => compareMetric(a, b, "cracked")); break;
      case "fit": rows.sort((a, b) => compareMetric(a, b, "fit")); break;
      case "recent": rows.sort(compareUpdated); break;
      default: rows.sort((a, b) => compareMetric(a, b, "composite"));
    }
    const total = rows.length;
    const limit = Math.min(500, Math.max(0, Math.floor(query.limit ?? 50)));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    return { rows: rows.slice(offset, offset + limit), total, counts };
  }

  insertEvidence(evidence: Evidence): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO evidence (id, founder_id, hash, captured_at, verification, record)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(evidence.id, evidence.founderId, evidence.hash, evidence.capturedAt, evidence.verification, serialize(evidence));
    return result.changes > 0;
  }

  listEvidence(founderId: string, options: { verifications?: Verification[] } = {}): Evidence[] {
    let sql = "SELECT record FROM evidence WHERE founder_id = ?";
    const params: unknown[] = [founderId];
    if (options.verifications !== undefined) {
      if (options.verifications.length === 0) return [];
      sql += ` AND verification IN (${options.verifications.map(() => "?").join(",")})`;
      params.push(...options.verifications);
    }
    sql += " ORDER BY captured_at ASC, rowid ASC";
    return rowRecords(this.db.prepare(sql).all(...params) as RecordRow[]);
  }

  setVerification(evidenceId: string, verification: Verification, note: string | null): void {
    const row = this.db.prepare("SELECT record FROM evidence WHERE id = ?").get(evidenceId) as RecordRow | undefined;
    if (!row) throw missing("Evidence", evidenceId);
    const evidence = { ...JSON.parse(row.record) as Evidence, verification, verificationNote: note };
    this.db.prepare("UPDATE evidence SET verification = ?, record = ? WHERE id = ?").run(verification, serialize(evidence), evidenceId);
  }

  insertAssessment(assessment: Assessment): void {
    this.db.prepare(`INSERT INTO assessments (id, founder_id, created_at, decision, composite, cracked, founder_score, fit, coverage, record)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(assessment.id, assessment.founderId, assessment.createdAt, assessment.decision, assessment.composite,
        assessment.cracked, assessment.founderScore, assessment.fit, assessment.coverage, serialize(assessment));
  }

  latestAssessment(founderId: string): Assessment | null {
    return parse(this.db.prepare("SELECT record FROM assessments WHERE founder_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(founderId) as RecordRow | undefined);
  }

  assessmentHistory(founderId: string): Array<{ at: string; composite: number; decision: Assessment["decision"] }> {
    const assessments = rowRecords<Assessment>(this.db.prepare("SELECT record FROM assessments WHERE founder_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(founderId) as RecordRow[]);
    return assessments.map((assessment) => ({ at: assessment.createdAt, composite: assessment.composite, decision: assessment.decision }));
  }

  setMemo(assessmentId: string, memo: Memo): void {
    const row = this.db.prepare("SELECT record FROM assessments WHERE id = ?").get(assessmentId) as RecordRow | undefined;
    if (!row) throw missing("Assessment", assessmentId);
    const assessment = { ...JSON.parse(row.record) as Assessment, memo };
    this.db.prepare("UPDATE assessments SET record = ? WHERE id = ?").run(serialize(assessment), assessmentId);
  }

  insertFeedback(feedback: Feedback): void {
    this.db.prepare("INSERT INTO feedback (id, founder_id, created_at, record) VALUES (?, ?, ?, ?)")
      .run(feedback.id, feedback.founderId, feedback.createdAt, serialize(feedback));
  }

  listFeedback(founderId: string): Feedback[] {
    return rowRecords(this.db.prepare("SELECT record FROM feedback WHERE founder_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(founderId) as RecordRow[]);
  }

  allFeedback(swarmId: string): Feedback[] {
    return rowRecords(this.db.prepare(`SELECT fb.record FROM feedback fb JOIN founders f ON f.id = fb.founder_id
      WHERE f.swarm_id = ? ORDER BY fb.created_at ASC, fb.rowid ASC`).all(swarmId) as RecordRow[]);
  }

  insertOutreach(action: OutreachAction): void {
    this.db.prepare(`INSERT INTO outreach (id, swarm_id, founder_id, status, created_at, updated_at, record)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(action.id, action.swarmId, action.founderId, action.status, action.createdAt, action.updatedAt, serialize(action));
  }

  getOutreach(id: string): OutreachAction | null {
    return parse(this.db.prepare("SELECT record FROM outreach WHERE id = ?").get(id) as RecordRow | undefined);
  }

  updateOutreach(id: string, patch: Partial<Omit<OutreachAction, "id" | "swarmId" | "founderId">>): OutreachAction {
    const updated = updateRecord<OutreachAction>(this.db, "outreach", id, patch, "Outreach");
    this.db.prepare("UPDATE outreach SET status = ?, updated_at = ?, record = ? WHERE id = ?")
      .run(updated.status, updated.updatedAt, serialize(updated), id);
    return updated;
  }

  listOutreach(filter: { swarmId?: string; founderId?: string; statuses?: OutreachStatus[] }): OutreachAction[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.swarmId !== undefined) { where.push("swarm_id = ?"); params.push(filter.swarmId); }
    if (filter.founderId !== undefined) { where.push("founder_id = ?"); params.push(filter.founderId); }
    if (filter.statuses !== undefined) {
      if (filter.statuses.length === 0) return [];
      where.push(`status IN (${filter.statuses.map(() => "?").join(",")})`);
      params.push(...filter.statuses);
    }
    const sql = `SELECT record FROM outreach${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at ASC, rowid ASC`;
    return rowRecords(this.db.prepare(sql).all(...params) as RecordRow[]);
  }

  insertRun(run: Run): void {
    this.db.prepare("INSERT INTO runs (id, swarm_id, status, started_at, finished_at, record) VALUES (?, ?, ?, ?, ?, ?)")
      .run(run.id, run.swarmId, run.status, run.startedAt, run.finishedAt, serialize(run));
  }

  getRun(id: string): Run | null {
    return parse(this.db.prepare("SELECT record FROM runs WHERE id = ?").get(id) as RecordRow | undefined);
  }

  updateRun(id: string, patch: Partial<Omit<Run, "id" | "swarmId">>): Run {
    const updated = updateRecord<Run>(this.db, "runs", id, patch, "Run");
    this.db.prepare("UPDATE runs SET status = ?, started_at = ?, finished_at = ?, record = ? WHERE id = ?")
      .run(updated.status, updated.startedAt, updated.finishedAt, serialize(updated), id);
    return updated;
  }

  listRuns(swarmId: string, limit: number): Run[] {
    return rowRecords(this.db.prepare("SELECT record FROM runs WHERE swarm_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?")
      .all(swarmId, Math.max(0, Math.floor(limit))) as RecordRow[]);
  }

  activeRun(swarmId: string): Run | null {
    return parse(this.db.prepare("SELECT record FROM runs WHERE swarm_id = ? AND status IN ('queued', 'running') ORDER BY started_at DESC, rowid DESC LIMIT 1")
      .get(swarmId) as RecordRow | undefined);
  }

  interruptedRuns(): Run[] {
    return rowRecords(this.db.prepare("SELECT record FROM runs WHERE status IN ('queued', 'running') ORDER BY started_at DESC, rowid DESC")
      .all() as RecordRow[]);
  }

  insertTask(task: TaskRun): void {
    this.transaction(() => {
      const { trace, ...record } = task;
      this.db.prepare(`INSERT INTO tasks (id, run_id, swarm_id, agent_id, founder_id, status, started_at, finished_at,
        cost_usd, items_out, output_summary, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(task.id, task.runId, task.swarmId, task.agentId, task.founderId, task.status, task.startedAt, task.finishedAt,
          task.costUsd, task.itemsOut, task.outputSummary, serialize(record));
      if (trace !== undefined) this.db.prepare("INSERT INTO task_traces (task_id, trace) VALUES (?, ?)").run(task.id, serialize(trace));
      const insertDirective = this.db.prepare("INSERT OR IGNORE INTO task_directives (task_id, directive_id, started_at) VALUES (?, ?, ?)");
      for (const directiveId of new Set(task.steering.directiveIds)) insertDirective.run(task.id, directiveId, task.startedAt);
    });
  }

  updateTask(id: string, patch: Partial<Omit<TaskRun, "id" | "runId" | "swarmId">>): void {
    this.transaction(() => {
      const row = this.db.prepare("SELECT record FROM tasks WHERE id = ?").get(id) as RecordRow | undefined;
      if (!row) throw missing("Task", id);
      const updated = { ...JSON.parse(row.record) as Omit<TaskRun, "trace">, ...patch } as TaskRun;
      const { trace, ...record } = updated;
      this.db.prepare(`UPDATE tasks SET agent_id = ?, founder_id = ?, status = ?, started_at = ?, finished_at = ?,
        cost_usd = ?, items_out = ?, output_summary = ?, record = ? WHERE id = ?`)
        .run(updated.agentId, updated.founderId, updated.status, updated.startedAt, updated.finishedAt,
          updated.costUsd, updated.itemsOut, updated.outputSummary, serialize(record), id);
      if (Object.hasOwn(patch, "trace")) {
        if (trace === undefined) this.db.prepare("DELETE FROM task_traces WHERE task_id = ?").run(id);
        else this.db.prepare("INSERT INTO task_traces (task_id, trace) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET trace = excluded.trace")
          .run(id, serialize(trace));
      }
    });
  }

  getTask(id: string, options: { withTrace: boolean }): TaskRun | null {
    const task = parse<Omit<TaskRun, "trace">>(this.db.prepare("SELECT record FROM tasks WHERE id = ?").get(id) as RecordRow | undefined);
    if (task === null) return null;
    if (!options.withTrace) return task as TaskRun;
    const traceRow = this.db.prepare("SELECT trace FROM task_traces WHERE task_id = ?").get(id) as { trace: string } | undefined;
    return { ...task, trace: traceRow ? JSON.parse(traceRow.trace) as NonNullable<TaskRun["trace"]> : [] };
  }

  listTasks(filter: { runId?: string; founderId?: string; agentId?: string; limit?: number }): TaskRun[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.runId !== undefined) { where.push("run_id = ?"); params.push(filter.runId); }
    if (filter.founderId !== undefined) { where.push("founder_id = ?"); params.push(filter.founderId); }
    if (filter.agentId !== undefined) { where.push("agent_id = ?"); params.push(filter.agentId); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sql = filter.limit === undefined
      ? `SELECT record FROM tasks ${clause} ORDER BY insertion_order ASC`
      : `SELECT record FROM (SELECT record, insertion_order FROM tasks ${clause} ORDER BY insertion_order DESC LIMIT ?)
         ORDER BY insertion_order ASC`;
    if (filter.limit !== undefined) params.push(Math.max(0, Math.floor(filter.limit)));
    return rowRecords(this.db.prepare(sql).all(...params) as RecordRow[]) as TaskRun[];
  }

  runCost(runId: string): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM tasks WHERE run_id = ?").get(runId) as { total: number };
    return row.total;
  }

  nodeStats(swarmId: string, sinceIso: string): NodeStatRow[] {
    const rows = this.db.prepare("SELECT agent_id, status, finished_at, cost_usd, items_out, output_summary FROM tasks WHERE swarm_id = ? ORDER BY insertion_order ASC")
      .all(swarmId) as Array<{ agent_id: string; status: TaskRun["status"]; finished_at: string | null; cost_usd: number | null; items_out: number; output_summary: string | null }>;
    const stats = new Map<string, NodeStatRow>();
    const lastFinished = new Map<string, string>();
    const lastSucceeded = new Map<string, string>();
    for (const row of rows) {
      let stat = stats.get(row.agent_id);
      if (!stat) {
        stat = { agentId: row.agent_id, tasks: 0, failures: 0, costUsd: 0, itemsOut: 0, lastRunAt: null, lastOutput: null };
        stats.set(row.agent_id, stat);
      }
      if (row.finished_at !== null && (stat.lastRunAt === null || row.finished_at > stat.lastRunAt)) stat.lastRunAt = row.finished_at;
      if (row.status === "succeeded" && row.finished_at !== null && (!lastSucceeded.has(row.agent_id) || row.finished_at > lastSucceeded.get(row.agent_id)!)) {
        lastSucceeded.set(row.agent_id, row.finished_at);
        stat.lastOutput = row.output_summary;
      }
      if ((row.status === "succeeded" || row.status === "failed") && row.finished_at !== null && row.finished_at >= sinceIso) {
        stat.tasks += 1;
        if (row.status === "failed") stat.failures += 1;
        stat.costUsd += row.cost_usd ?? 0;
        stat.itemsOut += row.items_out;
      }
    }
    return [...stats.values()];
  }

  audit(entry: Omit<AuditEntry, "id" | "at">): AuditEntry {
    const result: AuditEntry = { ...entry, id: newId("aud"), at: new Date().toISOString() };
    this.db.prepare("INSERT INTO audit (id, at, record) VALUES (?, ?, ?)").run(result.id, result.at, serialize(result));
    return result;
  }

  recentAudit(limit: number): AuditEntry[] {
    return rowRecords(this.db.prepare("SELECT record FROM audit ORDER BY at DESC, rowid DESC LIMIT ?")
      .all(Math.max(0, Math.floor(limit))) as RecordRow[]);
  }
}
