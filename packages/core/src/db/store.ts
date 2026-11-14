import type Database from "better-sqlite3";
import {
  DEFAULT_SETTINGS,
  ZERO_STATS,
  awaitsCall,
  type Agent,
  type FounderListDTO,
  type FounderQuery,
  type FounderRow,
  type Assessment,
  type AuditEntry,
  type Company,
  type CompanyAssessment,
  type CompanyFeedback,
  type CompanyMember,
  type CompanyStatus,
  type Directive,
  type Evidence,
  type Feedback,
  type FeedbackVerdict,
  type FrontierItem,
  type Founder,
  type FounderStatus,
  type Hunt,
  type HuntCall,
  type HuntNote,
  type Lead,
  type MemberStats,
  type Memo,
  type OutreachAction,
  type OutreachStatus,
  type ProfileLinks,
  type Recording,
  type RecordingStatus,
  type QuoteStatus,
  type Run,
  type Settings,
  type Swarm,
  type SwarmConfig,
  type TaskRun,
  type Trail,
  type Verification,
  newId,
  normalizeCompanyName,
  normalizeRoundLabel,
  stageLabel,
  X_POST_REMOVED,
  xPostId,
} from "@agentswarm/shared";
import type { CompanyListDTO, CompanyQuery, CompanyRow } from "@agentswarm/shared";
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

function normalizedTask(task: TaskRun): TaskRun {
  return { ...task, poolMember: task.poolMember ?? null };
}

function clone<T>(value: T): T {
  return JSON.parse(serialize(value)) as T;
}

function missing(kind: string, id: string): Error {
  return new Error(`${kind} ${id} not found`);
}

const companyStatuses: readonly CompanyStatus[] = ["tracked", "surfaced", "needs_evidence", "watch", "passed", "archived"];

function normalizedRun(run: Run): Run {
  return { ...run, stats: { ...ZERO_STATS, ...run.stats } };
}

function compareCompanyName(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function normalizedProfileUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

function comparableNetworkValue(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function rowRecords<T>(rows: readonly RecordRow[]): T[] {
  return rows.map((row) => JSON.parse(row.record) as T);
}

/**
 * The posts a text names, by either spelling of the path. The host is not looked at: an id
 * this long names one post, and a mirror of that post on another host carries the same words.
 */
function postIdsInText(text: string): Set<string> {
  return new Set([...text.matchAll(/\/status(?:es)?\/(\d{1,25})(?!\d)/g)].map((match) => match[1]!));
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
    if (!found) return clone(DEFAULT_SETTINGS);
    // Settings saved before a field existed read back with that field's default.
    return {
      ...clone(DEFAULT_SETTINGS),
      ...found,
      schedule: { ...DEFAULT_SETTINGS.schedule, ...found.schedule },
      autopilot: { ...DEFAULT_SETTINGS.autopilot, ...found.autopilot },
    };
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

  getHunt(swarmId: string): Hunt | null {
    return parse(this.db.prepare("SELECT record FROM hunts WHERE swarm_id = ?").get(swarmId) as RecordRow | undefined);
  }

  saveHunt(hunt: Hunt): void {
    this.db.prepare(`INSERT INTO hunts (id, swarm_id, record) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET swarm_id = excluded.swarm_id, record = excluded.record`)
      .run(hunt.id, hunt.swarmId, serialize(hunt));
  }

  listTrails(huntId: string): Trail[] {
    return rowRecords(this.db.prepare(`SELECT record FROM hunt_trails WHERE hunt_id = ?
      ORDER BY opened_at ASC, id ASC`).all(huntId) as RecordRow[]);
  }

  getTrail(id: string): Trail | null {
    return parse(this.db.prepare("SELECT record FROM hunt_trails WHERE id = ?").get(id) as RecordRow | undefined);
  }

  saveTrail(trail: Trail): void {
    this.db.prepare(`INSERT INTO hunt_trails (id, hunt_id, opened_at, record) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET hunt_id = excluded.hunt_id, opened_at = excluded.opened_at, record = excluded.record`)
      .run(trail.id, trail.huntId, trail.openedAt, serialize(trail));
  }

  addFrontier(items: FrontierItem[]): FrontierItem[] {
    const insert = this.db.prepare(`INSERT OR IGNORE INTO hunt_frontier
      (id, hunt_id, trail_id, kind, target, engine, state, added_at, record)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const existing = this.db.prepare(`SELECT record FROM hunt_frontier
      WHERE hunt_id = ? AND kind = ? AND target = ? AND COALESCE(engine, '') = ?`);
    const requeue = this.db.prepare(`UPDATE hunt_frontier
      SET trail_id = ?, state = ?, added_at = ?, record = ? WHERE id = ?`);
    return this.transaction(() => {
      const added: FrontierItem[] = [];
      for (const item of items) {
        const result = insert.run(item.id, item.huntId, item.trailId, item.kind, item.target,
          item.engine, item.state, item.addedAt, serialize(item));
        if (result.changes === 1) {
          added.push(item);
          continue;
        }
        const before = parse<FrontierItem>(existing.get(item.huntId, item.kind, item.target, item.engine ?? "") as RecordRow | undefined);
        if (!before) continue;
        if (before.state === "queued") {
          // Still waiting, on another trail: it moves to the trail that asks now. The first
          // trail may have been closed since, and work left on a closed trail is never done.
          if (before.trailId === item.trailId) continue;
          const moved: FrontierItem = { ...before, trailId: item.trailId, label: item.label, priority: item.priority, depth: Math.min(before.depth, item.depth), from: item.from };
          requeue.run(moved.trailId, moved.state, moved.addedAt, serialize(moved), before.id);
          added.push(moved);
          continue;
        }
        // Done with: a page is never read twice. A search is run again in a later run, or on
        // a later day: the same words find new people next week.
        if (item.kind !== "search") continue;
        // What counts is when it ran and which run ran it, not when it was first queued: a
        // search queued yesterday and run a minute ago has just been run.
        const laterDay = (before.ranAt ?? before.addedAt).slice(0, 10) < item.addedAt.slice(0, 10);
        const otherRun = (before.ranBy !== undefined ? before.ranBy : before.runId ?? null) !== (item.runId ?? null);
        if (!laterDay && !otherRun) continue;
        const again: FrontierItem = { ...item, id: before.id };
        requeue.run(again.trailId, again.state, again.addedAt, serialize(again), before.id);
        added.push(again);
      }
      return added;
    });
  }

  listFrontier(huntId: string, filter: { state?: FrontierItem["state"]; trailId?: string } = {}): FrontierItem[] {
    const where = ["hunt_id = ?"];
    const params: unknown[] = [huntId];
    if (filter.state !== undefined) { where.push("state = ?"); params.push(filter.state); }
    if (filter.trailId !== undefined) { where.push("trail_id = ?"); params.push(filter.trailId); }
    return rowRecords(this.db.prepare(`SELECT record FROM hunt_frontier WHERE ${where.join(" AND ")}
      ORDER BY added_at ASC, id ASC`).all(...params) as RecordRow[]);
  }

  getFrontierItem(id: string): FrontierItem | null {
    return parse<FrontierItem>(this.db.prepare("SELECT record FROM hunt_frontier WHERE id = ?").get(id) as RecordRow | undefined);
  }

  setFrontierState(id: string, state: FrontierItem["state"], ran?: { at: string; runId: string | null }): void {
    const item = this.getFrontierItem(id);
    if (item === null) throw missing("Frontier item", id);
    const updated: FrontierItem = ran ? { ...item, state, ranAt: ran.at, ranBy: ran.runId } : { ...item, state };
    this.db.prepare("UPDATE hunt_frontier SET state = ?, record = ? WHERE id = ?").run(state, serialize(updated), id);
  }

  insertHuntNote(note: HuntNote): void {
    this.db.prepare("INSERT INTO hunt_notes (id, hunt_id, created_at, record) VALUES (?, ?, ?, ?)")
      .run(note.id, note.huntId, note.createdAt, serialize(note));
  }

  listHuntNotes(huntId: string, limit: number): HuntNote[] {
    return rowRecords(this.db.prepare(`SELECT record FROM hunt_notes WHERE hunt_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(huntId, Math.max(0, Math.floor(limit))) as RecordRow[]);
  }

  removeHuntNote(id: string): boolean {
    return this.db.prepare("DELETE FROM hunt_notes WHERE id = ?").run(id).changes > 0;
  }

  insertHuntCall(call: HuntCall): void {
    this.db.prepare("INSERT INTO hunt_calls (id, hunt_id, run_id, turn, at, record) VALUES (?, ?, ?, ?, ?, ?)")
      .run(call.id, call.huntId, call.runId, call.turn, call.at, serialize(call));
  }

  listHuntCalls(huntId: string, filter: { turn?: number; runId?: string; limit?: number } = {}): HuntCall[] {
    const where = ["hunt_id = ?"];
    const params: unknown[] = [huntId];
    if (filter.turn !== undefined) { where.push("turn = ?"); params.push(filter.turn); }
    if (filter.runId !== undefined) { where.push("run_id = ?"); params.push(filter.runId); }
    const limit = filter.limit === undefined ? "" : " LIMIT ?";
    if (filter.limit !== undefined) params.push(Math.max(0, Math.floor(filter.limit)));
    return rowRecords(this.db.prepare(`SELECT record FROM hunt_calls WHERE ${where.join(" AND ")}
      ORDER BY at DESC, id DESC${limit}`).all(...params) as RecordRow[]);
  }

  listHuntLeads(swarmId: string, limit: number): Lead[] {
    return rowRecords(this.db.prepare(`SELECT record FROM leads WHERE swarm_id = ?
      AND COALESCE(json_extract(record, '$.trailId'), '') <> ''
      ORDER BY discovered_at DESC, id DESC LIMIT ?`).all(swarmId, Math.max(0, Math.floor(limit))) as RecordRow[]);
  }

  keptByTrail(huntId: string): Map<string, number> {
    const rows = this.db.prepare(`SELECT trails.id, COUNT(leads.id) AS kept FROM hunt_trails trails
      JOIN leads ON json_extract(leads.record, '$.trailId') = trails.id
      JOIN founders ON founders.id = leads.founder_id
      WHERE trails.hunt_id = ? AND COALESCE(json_extract(leads.record, '$.trailId'), '') <> ''
        AND founders.status NOT IN ('lead', 'screened_out')
      GROUP BY trails.id ORDER BY trails.id ASC`).all(huntId) as Array<{ id: string; kept: number }>;
    return new Map(rows.map((row) => [row.id, row.kept]));
  }

  insertFounder(founder: Founder): void {
    this.transaction(() => {
      this.db.prepare(`INSERT INTO founders (id, swarm_id, normalized_name, updated_at, next_recheck_at, status, company_id, record)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(founder.id, founder.swarmId, normalizeName(founder.name), founder.updatedAt, founder.nextRecheckAt, founder.status, founder.companyId ?? null, serialize(founder));
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
      this.db.prepare(`UPDATE founders SET normalized_name = ?, updated_at = ?, next_recheck_at = ?, status = ?, company_id = ?, record = ? WHERE id = ?`)
        .run(normalizeName(updated.name), updated.updatedAt, updated.nextRecheckAt, updated.status, updated.companyId ?? null, serialize(updated), id);
      saveFounderLinks(this.db, updated);
      return updated;
    });
  }

  insertRecording(recording: Recording): void {
    this.db.prepare(`INSERT INTO recordings (id, swarm_id, founder_id, status, created_at, updated_at, record)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(recording.id, recording.swarmId, recording.founderId,
      recording.status, recording.createdAt, recording.updatedAt, serialize(recording));
  }

  getRecording(id: string): Recording | null {
    return parse(this.db.prepare("SELECT record FROM recordings WHERE id = ?").get(id) as RecordRow | undefined);
  }

  deleteRecording(id: string): void {
    this.db.prepare("DELETE FROM recordings WHERE id = ?").run(id);
  }

  updateRecording(id: string, patch: Partial<Pick<Recording, "status" | "detail" | "durationSec" | "transcript" | "updatedAt">>): Recording {
    return this.transaction(() => {
      const current = this.getRecording(id);
      if (!current) throw missing("Recording", id);
      const updated = { ...current, ...patch };
      this.db.prepare("UPDATE recordings SET status = ?, updated_at = ?, record = ? WHERE id = ?")
        .run(updated.status, updated.updatedAt, serialize(updated), id);
      return updated;
    });
  }

  listRecordingsByFounder(founderId: string): Recording[] {
    return rowRecords(this.db.prepare("SELECT record FROM recordings WHERE founder_id = ? ORDER BY created_at, id")
      .all(founderId) as RecordRow[]);
  }

  listRecordingsByStatus(swarmId: string, status: RecordingStatus): Recording[] {
    return rowRecords(this.db.prepare("SELECT record FROM recordings WHERE swarm_id = ? AND status = ? ORDER BY created_at, id")
      .all(swarmId, status) as RecordRow[]);
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
    const companies = new Map(rowRecords<Company>(this.db.prepare("SELECT record FROM companies WHERE swarm_id = ?").all(query.swarmId) as RecordRow[]).map((company) => [company.id, company]));
    const companyAssessments = rowRecords<CompanyAssessment>(this.db.prepare(`SELECT a.record FROM company_assessments a
      JOIN companies c ON c.id = a.company_id WHERE c.swarm_id = ? ORDER BY a.created_at DESC, a.rowid DESC`).all(query.swarmId) as RecordRow[]);
    const latestCompanyAssessments = new Map<string, CompanyAssessment>();
    for (const assessment of companyAssessments) if (!latestCompanyAssessments.has(assessment.companyId)) latestCompanyAssessments.set(assessment.companyId, assessment);
    const leadsByFounder = new Map<string, Lead[]>();
    for (const lead of rowRecords<Lead>(this.db.prepare("SELECT record FROM leads WHERE swarm_id = ? ORDER BY discovered_at DESC, rowid DESC").all(query.swarmId) as RecordRow[])) {
      if (!lead.founderId) continue;
      const group = leadsByFounder.get(lead.founderId) ?? [];
      group.push(lead);
      leadsByFounder.set(lead.founderId, group);
    }
    const evidenceRows = this.db.prepare(`
      SELECT founder_id, COUNT(*) AS count FROM evidence
      WHERE verification IN ('unverified', 'supported') GROUP BY founder_id
    `).all() as Array<{ founder_id: string; count: number }>;
    const evidenceCounts = new Map(evidenceRows.map((row) => [row.founder_id, row.count]));

    let rows = founders.map((founder): FounderRow => {
      const assessment = latestAssessments.get(founder.id) ?? null;
      const company = founder.companyId ? companies.get(founder.companyId) ?? null : null;
      const companyAssessment = company ? latestCompanyAssessments.get(company.id) ?? null : null;
      const leadStage = leadsByFounder.get(founder.id)?.find((lead) => lead.stage)?.stage ?? null;
      return {
        id: founder.id,
        name: founder.name,
        headline: founder.headline,
        companyName: company?.name ?? founder.company.name,
        companyOneLiner: company?.oneLiner ?? founder.company.oneLiner,
        sector: company?.sector ?? null,
        stage: normalizeRoundLabel(company?.stage ?? null) ?? normalizeRoundLabel(founder.company.stage) ?? stageLabel(leadStage),
        tagline: company?.tagline?.text ?? null,
        moat: companyAssessment?.brief.moat?.text ?? null,
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
    const waiting = rows.filter(awaitsCall).length;
    rows = rows.filter((row) => {
      if (query.status === undefined || query.status === "all") {
        if (row.status === "archived") return false;
      } else if (row.status !== query.status) return false;
      if (query.call === "waiting" && !awaitsCall(row)) return false;
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
    return { rows: rows.slice(offset, offset + limit), total, counts, waiting };
  }

  insertCompany(company: Company): void {
    this.db.prepare(`INSERT INTO companies (id, swarm_id, domain, normalized_name, status, updated_at, next_recheck_at, record)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(company.id, company.swarmId, company.domain, normalizeCompanyName(company.name), company.status,
        company.updatedAt, company.nextRecheckAt, serialize(company));
  }

  getCompany(id: string): Company | null {
    return parse(this.db.prepare("SELECT record FROM companies WHERE id = ?").get(id) as RecordRow | undefined);
  }

  updateCompany(id: string, patch: Partial<Omit<Company, "id" | "swarmId">>): Company {
    const current = this.getCompany(id);
    if (current === null) throw missing("Company", id);
    const updated = { ...current, ...patch };
    this.db.prepare(`UPDATE companies SET domain = ?, normalized_name = ?, status = ?, updated_at = ?,
      next_recheck_at = ?, record = ? WHERE id = ?`)
      .run(updated.domain, normalizeCompanyName(updated.name), updated.status, updated.updatedAt,
        updated.nextRecheckAt, serialize(updated), id);
    return updated;
  }

  findCompanyByDomain(swarmId: string, domain: string): Company | null {
    if (!domain) return null;
    return parse(this.db.prepare("SELECT record FROM companies WHERE swarm_id = ? AND domain = ? ORDER BY rowid ASC LIMIT 1")
      .get(swarmId, domain) as RecordRow | undefined);
  }

  findCompaniesByName(swarmId: string, normalizedName: string): Company[] {
    if (!normalizedName) return [];
    return rowRecords(this.db.prepare("SELECT record FROM companies WHERE swarm_id = ? AND normalized_name = ? ORDER BY rowid ASC")
      .all(swarmId, normalizedName) as RecordRow[]);
  }

  listCompanies(filter: { swarmId: string; statuses?: CompanyStatus[] }): Company[] {
    if (filter.statuses?.length === 0) return [];
    const where = ["swarm_id = ?"];
    const params: unknown[] = [filter.swarmId];
    if (filter.statuses !== undefined) {
      where.push(`status IN (${filter.statuses.map(() => "?").join(",")})`);
      params.push(...filter.statuses);
    }
    return rowRecords(this.db.prepare(`SELECT record FROM companies WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, id ASC`)
      .all(...params) as RecordRow[]);
  }

  foundersOfCompany(companyId: string): Founder[] {
    const founders = rowRecords<Founder>(this.db.prepare("SELECT record FROM founders WHERE company_id = ?")
      .all(companyId) as RecordRow[]);
    return founders.sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
  }

  upsertCompanyMember(member: CompanyMember): CompanyMember {
    const normalizedName = normalizeName(member.name);
    const row = this.db.prepare("SELECT record FROM company_members WHERE company_id = ? AND normalized_name = ?")
      .get(member.companyId, normalizedName) as RecordRow | undefined;
    if (!row) {
      this.db.prepare("INSERT INTO company_members (id, company_id, normalized_name, record) VALUES (?, ?, ?, ?)")
        .run(member.id, member.companyId, normalizedName, serialize(member));
      return member;
    }
    const previous = JSON.parse(row.record) as CompanyMember;
    const links = { ...member.links };
    for (const key of Object.keys(links) as Array<keyof CompanyMember["links"]>) {
      if (links[key] === null) links[key] = previous.links[key];
    }
    const stored: CompanyMember = {
      ...member,
      id: previous.id,
      addedAt: previous.addedAt,
      role: member.role ?? previous.role,
      background: member.background ?? previous.background,
      sourceUrl: member.sourceUrl ?? previous.sourceUrl,
      founderId: member.founderId ?? previous.founderId,
      isFounder: member.isFounder || previous.isFounder,
      links,
    };
    this.db.prepare("UPDATE company_members SET record = ? WHERE company_id = ? AND normalized_name = ?")
      .run(serialize(stored), member.companyId, normalizedName);
    return stored;
  }

  listCompanyMembers(companyId: string): CompanyMember[] {
    const members = rowRecords<CompanyMember>(this.db.prepare("SELECT record FROM company_members WHERE company_id = ?")
      .all(companyId) as RecordRow[]);
    return members.sort((a, b) => Number(b.isFounder) - Number(a.isFounder)
      || a.addedAt.localeCompare(b.addedAt) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  listCompanyEvidence(companyId: string, options: { verifications?: Verification[] } = {}): Evidence[] {
    let sql = "SELECT record FROM evidence WHERE company_id = ?";
    const params: unknown[] = [companyId];
    if (options.verifications !== undefined) {
      if (options.verifications.length === 0) return [];
      sql += ` AND verification IN (${options.verifications.map(() => "?").join(",")})`;
      params.push(...options.verifications);
    }
    return rowRecords(this.db.prepare(`${sql} ORDER BY captured_at ASC, rowid ASC`).all(...params) as RecordRow[]);
  }

  insertCompanyAssessment(assessment: CompanyAssessment): void {
    this.db.prepare(`INSERT INTO company_assessments (id, company_id, created_at, decision, deal, record)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(assessment.id, assessment.companyId, assessment.createdAt, assessment.decision, assessment.deal, serialize(assessment));
  }

  latestCompanyAssessment(companyId: string): CompanyAssessment | null {
    return parse(this.db.prepare(`SELECT record FROM company_assessments WHERE company_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(companyId) as RecordRow | undefined);
  }

  companyAssessmentHistory(companyId: string): Array<{ at: string; deal: number; decision: CompanyAssessment["decision"] }> {
    const assessments = rowRecords<CompanyAssessment>(this.db.prepare(`SELECT record FROM company_assessments WHERE company_id = ?
      ORDER BY created_at ASC, rowid ASC`).all(companyId) as RecordRow[]);
    return assessments.map((assessment) => ({ at: assessment.createdAt, deal: assessment.deal, decision: assessment.decision }));
  }

  insertCompanyFeedback(feedback: CompanyFeedback): void {
    this.db.prepare("INSERT INTO company_feedback (id, company_id, created_at, record) VALUES (?, ?, ?, ?)")
      .run(feedback.id, feedback.companyId, feedback.createdAt, serialize(feedback));
  }

  listCompanyFeedback(companyId: string): CompanyFeedback[] {
    return rowRecords(this.db.prepare(`SELECT record FROM company_feedback WHERE company_id = ?
      ORDER BY created_at DESC, rowid DESC`).all(companyId) as RecordRow[]);
  }

  allCompanyFeedback(swarmId: string): CompanyFeedback[] {
    return rowRecords(this.db.prepare(`SELECT fb.record FROM company_feedback fb JOIN companies c ON c.id = fb.company_id
      WHERE c.swarm_id = ? ORDER BY fb.created_at ASC, fb.rowid ASC`).all(swarmId) as RecordRow[]);
  }

  companyRows(query: CompanyQuery): CompanyListDTO {
    const companies = rowRecords<Company>(this.db.prepare("SELECT record FROM companies WHERE swarm_id = ? ORDER BY rowid ASC")
      .all(query.swarmId) as RecordRow[]);
    const counts: Partial<Record<CompanyStatus, number>> = {};
    for (const status of companyStatuses) counts[status] = 0;
    for (const company of companies) counts[company.status] = (counts[company.status] ?? 0) + 1;

    const assessments = rowRecords<CompanyAssessment>(this.db.prepare(`SELECT a.record FROM company_assessments a
      JOIN companies c ON c.id = a.company_id WHERE c.swarm_id = ? ORDER BY a.created_at DESC, a.rowid DESC`)
      .all(query.swarmId) as RecordRow[]);
    const latestAssessments = new Map<string, CompanyAssessment>();
    for (const assessment of assessments) if (!latestAssessments.has(assessment.companyId)) latestAssessments.set(assessment.companyId, assessment);
    const feedbackRecords = rowRecords<CompanyFeedback>(this.db.prepare(`SELECT fb.record FROM company_feedback fb
      JOIN companies c ON c.id = fb.company_id WHERE c.swarm_id = ? ORDER BY fb.created_at DESC, fb.rowid DESC`)
      .all(query.swarmId) as RecordRow[]);
    const latestFeedback = new Map<string, CompanyFeedback>();
    for (const feedback of feedbackRecords) if (!latestFeedback.has(feedback.companyId)) latestFeedback.set(feedback.companyId, feedback);
    const foundersByCompany = new Map<string, Founder[]>();
    for (const founder of rowRecords<Founder>(this.db.prepare(`SELECT f.record FROM founders f
      JOIN companies c ON c.id = f.company_id WHERE c.swarm_id = ?`).all(query.swarmId) as RecordRow[])) {
      const group = foundersByCompany.get(founder.companyId ?? "") ?? [];
      group.push(founder);
      foundersByCompany.set(founder.companyId ?? "", group);
    }
    const memberCounts = this.db.prepare(`SELECT m.company_id AS id, COUNT(*) AS count FROM company_members m
      JOIN companies c ON c.id = m.company_id WHERE c.swarm_id = ? GROUP BY m.company_id`).all(query.swarmId) as Array<{ id: string; count: number }>;
    const evidenceCounts = this.db.prepare(`SELECT e.company_id AS id, COUNT(*) AS count FROM evidence e
      JOIN companies c ON c.id = e.company_id WHERE c.swarm_id = ? GROUP BY e.company_id`).all(query.swarmId) as Array<{ id: string; count: number }>;
    const memberCountById = new Map(memberCounts.map(({ id, count }) => [id, count]));
    const evidenceCountById = new Map(evidenceCounts.map(({ id, count }) => [id, count]));
    let rows = companies.map((company): CompanyRow => {
      const assessment = latestAssessments.get(company.id) ?? null;
      const founders = (foundersByCompany.get(company.id) ?? []).sort((a, b) =>
        a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
      if (assessment?.leadFounderId) founders.sort((a, b) => Number(b.id === assessment.leadFounderId) - Number(a.id === assessment.leadFounderId)
        || a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
      const feedback = latestFeedback.get(company.id) ?? null;
      return {
        id: company.id, name: company.name, oneLiner: company.oneLiner, tagline: company.tagline?.text ?? null,
        moat: assessment?.brief.moat?.text ?? null, sector: company.sector, stage: normalizeRoundLabel(company.stage),
        status: company.status, decision: assessment?.decision ?? null, deal: assessment?.deal ?? null,
        company: assessment?.company ?? null, team: assessment?.team ?? null, coverage: assessment?.coverage ?? null,
        founders: founders.map(({ id, name }) => ({ id, name })), teamSize: memberCountById.get(company.id) ?? 0,
        evidenceCount: evidenceCountById.get(company.id) ?? 0, flagCount: assessment?.flags.length ?? 0,
        feedback: feedback?.verdict ?? null, feedbackReasons: feedback?.reasonTags ?? [],
        knownPeople: this.networkAtCompany(normalizeCompanyName(company.name)).length,
        firstSeenAt: company.firstSeenAt, updatedAt: company.updatedAt,
      };
    });
    rows = rows.filter((row) => {
      if (query.status === undefined || query.status === "all") {
        if (row.status === "archived") return false;
      } else if (row.status !== query.status) return false;
      if (query.q) {
        const term = query.q.toLocaleLowerCase();
        if (![row.name, row.oneLiner].some((value) => value?.toLocaleLowerCase().includes(term))) return false;
      }
      return true;
    });
    const compareMetric = (key: "deal" | "company" | "team") => (a: CompanyRow, b: CompanyRow): number => {
      const left = a[key];
      const right = b[key];
      if (left === null && right !== null) return 1;
      if (left !== null && right === null) return -1;
      if (left !== null && right !== null && left !== right) return right - left;
      return compareCompanyName(a, b);
    };
    switch (query.sort ?? "deal") {
      case "company": rows.sort(compareMetric("company")); break;
      case "team": rows.sort(compareMetric("team")); break;
      case "recent": rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || compareCompanyName(a, b)); break;
      default: rows.sort(compareMetric("deal"));
    }
    const total = rows.length;
    const limit = Math.min(500, Math.max(0, Math.floor(query.limit ?? 50)));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    return { rows: rows.slice(offset, offset + limit), total, counts };
  }

  insertEvidence(evidence: Evidence): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO evidence (id, founder_id, hash, captured_at, verification, company_id, record)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(evidence.id, evidence.founderId, evidence.hash, evidence.capturedAt, evidence.verification,
        evidence.companyId ?? null, serialize(evidence));
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

  setQuote(evidenceId: string, quote: QuoteStatus): void {
    const row = this.db.prepare("SELECT record FROM evidence WHERE id = ?").get(evidenceId) as RecordRow | undefined;
    if (!row) return;
    const evidence = { ...JSON.parse(row.record) as Evidence, quote };
    this.db.prepare("UPDATE evidence SET record = ? WHERE id = ?").run(serialize(evidence), evidenceId);
  }

  updateEvidence(evidenceId: string, patch: Partial<Pick<Evidence, "title" | "excerpt" | "claim" | "publishedAt">>): void {
    const row = this.db.prepare("SELECT record FROM evidence WHERE id = ?").get(evidenceId) as RecordRow | undefined;
    if (!row) return;
    const evidence = { ...JSON.parse(row.record) as Evidence, ...patch };
    this.db.prepare("UPDATE evidence SET record = ? WHERE id = ?").run(serialize(evidence), evidenceId);
  }

  forgetXPosts(postIds: readonly string[]): { founderIds: string[] } {
    const ids = new Set(postIds.filter((id) => typeof id === "string" && /^\d{1,25}$/.test(id)));
    if (ids.size === 0) return { founderIds: [] };

    return this.transaction(() => {
      const founderIds = new Set<string>();
      const evidenceRows = this.db.prepare("SELECT id, record FROM evidence WHERE record LIKE '%/status%'").all() as Array<{ id: string; record: string }>;
      const updateEvidence = this.db.prepare("UPDATE evidence SET verification = ?, record = ? WHERE id = ?");
      for (const row of evidenceRows) {
        const evidence = JSON.parse(row.record) as Evidence;
        const postId = evidence.source === "x" ? xPostId(evidence.url) : null;
        if (!postId || !ids.has(postId) || evidence.title === X_POST_REMOVED.title) continue;
        const updated: Evidence = {
          ...evidence,
          title: X_POST_REMOVED.title,
          excerpt: X_POST_REMOVED.excerpt,
          claim: X_POST_REMOVED.claim,
          quote: "not_found",
          verification: "unsupported",
          verificationNote: X_POST_REMOVED.note,
        };
        updateEvidence.run(updated.verification, serialize(updated), row.id);
        founderIds.add(updated.founderId);
      }

      const leadRows = this.db.prepare("SELECT id, record FROM leads WHERE record LIKE '%/status%'").all() as Array<{ id: string; record: string }>;
      const updateLead = this.db.prepare("UPDATE leads SET record = ? WHERE id = ?");
      for (const row of leadRows) {
        const lead = JSON.parse(row.record) as Lead;
        const postId = lead.source === "x" ? xPostId(lead.sourceRef) : null;
        if (!postId || !ids.has(postId)) continue;
        // The stage answers carry the page's words too, and what they scored goes with them.
        updateLead.run(serialize({
          ...lead,
          sourceTitle: X_POST_REMOVED.title,
          quote: null,
          oneLiner: null,
          why: X_POST_REMOVED.note,
          stage: null,
          earliness: null,
        }), row.id);
      }

      const frontierRows = this.db.prepare("SELECT id, state, record FROM hunt_frontier WHERE record LIKE '%/status%'").all() as Array<{
        id: string;
        state: FrontierItem["state"];
        record: string;
      }>;
      const updateFrontier = this.db.prepare("UPDATE hunt_frontier SET state = ?, record = ? WHERE id = ?");
      for (const row of frontierRows) {
        const item = JSON.parse(row.record) as FrontierItem;
        const postId = item.held ? xPostId(item.target) : null;
        if (!postId || !ids.has(postId)) continue;
        const state = row.state === "queued" ? "skipped" : row.state;
        updateFrontier.run(state, serialize({ ...item, held: null, state }), row.id);
      }

      const wanted = (text: string): boolean => [...postIdsInText(text)].some((id) => ids.has(id));
      const taskRecords = this.db.prepare("SELECT id, record FROM tasks WHERE record LIKE '%/status%'")
        .all() as Array<{ id: string; record: string }>;
      const taskById = new Map<string, string>();
      const affectedTasks = new Set<string>();
      for (const row of taskRecords) {
        taskById.set(row.id, row.record);
        if (wanted(row.record)) affectedTasks.add(row.id);
      }
      const traceRows = this.db.prepare("SELECT task_id, trace FROM task_traces WHERE trace LIKE '%/status%'")
        .all() as Array<{ task_id: string; trace: string }>;
      for (const row of traceRows) {
        if (wanted(row.trace)) affectedTasks.add(row.task_id);
      }

      const readTask = this.db.prepare("SELECT record FROM tasks WHERE id = ?");
      const updateTask = this.db.prepare("UPDATE tasks SET output_summary = ?, record = ? WHERE id = ?");
      const removeTrace = this.db.prepare("DELETE FROM task_traces WHERE task_id = ?");
      const taskSummary = "Removed: it carried a post that is no longer on X.";
      for (const id of affectedTasks) {
        const record = taskById.get(id) ?? (readTask.get(id) as RecordRow | undefined)?.record;
        if (!record) continue;
        const task = JSON.parse(record) as Omit<TaskRun, "trace">;
        const error = typeof task.error === "string" && wanted(task.error) ? taskSummary : task.error;
        updateTask.run(taskSummary, serialize({ ...task, output: null, outputSummary: taskSummary, error }), id);
        removeTrace.run(id);
      }

      return { founderIds: [...founderIds].sort() };
    });
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

  replaceNetwork(owner: string, contacts: import("@agentswarm/shared").NetworkContact[]): import("@agentswarm/shared").NetworkContact[] {
    return this.transaction(() => {
      const previous = rowRecords<import("@agentswarm/shared").NetworkContact>(this.db.prepare("SELECT record FROM network_contacts WHERE owner = ?")
        .all(owner) as RecordRow[]);
      // Indexed once: an exported list can hold tens of thousands of contacts, and comparing each
      // against every previous one would take minutes.
      const byUrl = new Map<string, import("@agentswarm/shared").NetworkContact>();
      const byName = new Map<string, import("@agentswarm/shared").NetworkContact>();
      const byNameWithoutUrl = new Map<string, import("@agentswarm/shared").NetworkContact>();
      for (const old of previous) {
        const name = normalizeName(old.name);
        if (old.profileUrl) {
          const url = normalizedProfileUrl(old.profileUrl);
          if (!byUrl.has(url)) byUrl.set(url, old);
        } else if (!byNameWithoutUrl.has(name)) {
          byNameWithoutUrl.set(name, old);
        }
        if (!byName.has(name)) byName.set(name, old);
      }
      // The same person listed twice in one file is stored once, so one bad row cannot fail the upload.
      const seen = new Set<string>();
      const stored: import("@agentswarm/shared").NetworkContact[] = [];
      for (const contact of contacts) {
        if (seen.has(contact.id)) continue;
        seen.add(contact.id);
        const name = normalizeName(contact.name);
        // A link identifies a person; a name is the fallback when either side has no link.
        const match = contact.profileUrl
          ? byUrl.get(normalizedProfileUrl(contact.profileUrl)) ?? byNameWithoutUrl.get(name)
          : byName.get(name);
        const changed = match !== undefined && (
          comparableNetworkValue(contact.company) !== comparableNetworkValue(match.company)
          || comparableNetworkValue(contact.position) !== comparableNetworkValue(match.position)
        );
        stored.push({ ...contact, owner, previous: changed ? { company: match.company, position: match.position } : null });
      }
      this.db.prepare("DELETE FROM network_contacts WHERE owner = ?").run(owner);
      const insert = this.db.prepare(`INSERT INTO network_contacts (id, owner, normalized_name, normalized_company, record)
        VALUES (?, ?, ?, ?, ?)`);
      for (const contact of stored) insert.run(contact.id, contact.owner, normalizeName(contact.name),
        contact.company === null ? null : normalizeCompanyName(contact.company) || null, serialize(contact));
      return stored;
    });
  }

  listNetwork(owner?: string): import("@agentswarm/shared").NetworkContact[] {
    const rows = owner === undefined
      ? this.db.prepare("SELECT record FROM network_contacts ORDER BY owner ASC, normalized_name ASC, id ASC").all()
      : this.db.prepare("SELECT record FROM network_contacts WHERE owner = ? ORDER BY owner ASC, normalized_name ASC, id ASC").all(owner);
    return rowRecords(rows as RecordRow[]);
  }

  removeNetwork(owner: string): number {
    return this.db.prepare("DELETE FROM network_contacts WHERE owner = ?").run(owner).changes;
  }

  networkAtCompany(normalizedCompanyName: string): import("@agentswarm/shared").NetworkContact[] {
    if (!normalizedCompanyName) return [];
    return rowRecords(this.db.prepare(`SELECT record FROM network_contacts WHERE normalized_company = ?
      ORDER BY owner ASC, normalized_name ASC, id ASC`).all(normalizedCompanyName) as RecordRow[]);
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
    const run = parse<Run>(this.db.prepare("SELECT record FROM runs WHERE id = ?").get(id) as RecordRow | undefined);
    return run === null ? null : normalizedRun(run);
  }

  updateRun(id: string, patch: Partial<Omit<Run, "id" | "swarmId">>): Run {
    const updated = normalizedRun(updateRecord<Run>(this.db, "runs", id, patch, "Run"));
    this.db.prepare("UPDATE runs SET status = ?, started_at = ?, finished_at = ?, record = ? WHERE id = ?")
      .run(updated.status, updated.startedAt, updated.finishedAt, serialize(updated), id);
    return updated;
  }

  listRuns(swarmId: string, limit: number): Run[] {
    return rowRecords<Run>(this.db.prepare("SELECT record FROM runs WHERE swarm_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?")
      .all(swarmId, Math.max(0, Math.floor(limit))) as RecordRow[]).map(normalizedRun);
  }

  activeRun(swarmId: string): Run | null {
    const run = parse<Run>(this.db.prepare("SELECT record FROM runs WHERE swarm_id = ? AND status IN ('queued', 'running') ORDER BY started_at DESC, rowid DESC LIMIT 1")
      .get(swarmId) as RecordRow | undefined);
    return run === null ? null : normalizedRun(run);
  }

  interruptedRuns(): Run[] {
    return rowRecords<Run>(this.db.prepare("SELECT record FROM runs WHERE status IN ('queued', 'running') ORDER BY started_at DESC, rowid DESC")
      .all() as RecordRow[]).map(normalizedRun);
  }

  insertTask(task: TaskRun): void {
    this.transaction(() => {
      const normalized = normalizedTask(task);
      const { trace, ...record } = normalized;
      this.db.prepare(`INSERT INTO tasks (id, run_id, swarm_id, agent_id, founder_id, status, started_at, finished_at,
        cost_usd, items_out, output_summary, company_id, pool_member, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(normalized.id, normalized.runId, normalized.swarmId, normalized.agentId, normalized.founderId,
          normalized.status, normalized.startedAt, normalized.finishedAt, normalized.costUsd, normalized.itemsOut,
          normalized.outputSummary, normalized.companyId ?? null, normalized.poolMember, serialize(record));
      if (trace !== undefined) this.db.prepare("INSERT INTO task_traces (task_id, trace) VALUES (?, ?)").run(normalized.id, serialize(trace));
      const insertDirective = this.db.prepare("INSERT OR IGNORE INTO task_directives (task_id, directive_id, started_at) VALUES (?, ?, ?)");
      for (const directiveId of new Set(normalized.steering.directiveIds)) insertDirective.run(normalized.id, directiveId, normalized.startedAt);
    });
  }

  updateTask(id: string, patch: Partial<Omit<TaskRun, "id" | "runId" | "swarmId">>): void {
    this.transaction(() => {
      const row = this.db.prepare("SELECT record FROM tasks WHERE id = ?").get(id) as RecordRow | undefined;
      if (!row) throw missing("Task", id);
      const updated = normalizedTask({ ...JSON.parse(row.record) as Omit<TaskRun, "trace">, ...patch } as TaskRun);
      const { trace, ...record } = updated;
      this.db.prepare(`UPDATE tasks SET agent_id = ?, founder_id = ?, status = ?, started_at = ?, finished_at = ?,
        cost_usd = ?, items_out = ?, output_summary = ?, company_id = ?, pool_member = ?, record = ? WHERE id = ?`)
        .run(updated.agentId, updated.founderId, updated.status, updated.startedAt, updated.finishedAt,
          updated.costUsd, updated.itemsOut, updated.outputSummary, updated.companyId ?? null, updated.poolMember,
          serialize(record), id);
      if (Object.hasOwn(patch, "trace")) {
        if (trace === undefined) this.db.prepare("DELETE FROM task_traces WHERE task_id = ?").run(id);
        else this.db.prepare("INSERT INTO task_traces (task_id, trace) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET trace = excluded.trace")
          .run(id, serialize(trace));
      }
    });
  }

  getTask(id: string, options: { withTrace: boolean }): TaskRun | null {
    const record = parse<Omit<TaskRun, "trace">>(this.db.prepare("SELECT record FROM tasks WHERE id = ?").get(id) as RecordRow | undefined);
    if (record === null) return null;
    const task = normalizedTask(record as TaskRun);
    if (!options.withTrace) return task;
    const traceRow = this.db.prepare("SELECT trace FROM task_traces WHERE task_id = ?").get(id) as { trace: string } | undefined;
    return { ...task, trace: traceRow ? JSON.parse(traceRow.trace) as NonNullable<TaskRun["trace"]> : [] };
  }

  listTasks(filter: { runId?: string; founderId?: string; companyId?: string; agentId?: string; limit?: number }): TaskRun[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.runId !== undefined) { where.push("run_id = ?"); params.push(filter.runId); }
    if (filter.founderId !== undefined) { where.push("founder_id = ?"); params.push(filter.founderId); }
    if (filter.companyId !== undefined) { where.push("company_id = ?"); params.push(filter.companyId); }
    if (filter.agentId !== undefined) { where.push("agent_id = ?"); params.push(filter.agentId); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sql = filter.limit === undefined
      ? `SELECT record FROM tasks ${clause} ORDER BY insertion_order ASC`
      : `SELECT record FROM (SELECT record, insertion_order FROM tasks ${clause} ORDER BY insertion_order DESC LIMIT ?)
         ORDER BY insertion_order ASC`;
    if (filter.limit !== undefined) params.push(Math.max(0, Math.floor(filter.limit)));
    return (rowRecords(this.db.prepare(sql).all(...params) as RecordRow[]) as TaskRun[]).map(normalizedTask);
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

  memberStats(swarmId: string, jobId: TaskRun["jobId"], sinceIso: string): MemberStats[] {
    const leadJob = jobId === "hunt.look" || jobId.startsWith("scout.");
    const itemTable = leadJob
      ? `leads item ON json_extract(item.record, '$.discoveredByTaskId') = filtered_tasks.id
         LEFT JOIN founders attached ON attached.id = item.founder_id`
      : `evidence item ON json_extract(item.record, '$.collectedByTaskId') = filtered_tasks.id`;
    const supported = leadJob
      ? "attached.status NOT IN ('lead', 'screened_out')"
      : "item.verification = 'supported'";
    const rejected = leadJob ? "attached.status = 'screened_out'" : "item.verification = 'unsupported'";
    const rows = this.db.prepare(`
      WITH filtered_tasks AS (
        SELECT id, COALESCE(pool_member, '') AS member_id, status, cost_usd,
          json_extract(record, '$.control') AS control
        FROM tasks
        WHERE swarm_id = ? AND json_extract(record, '$.jobId') = ? AND started_at >= ?
      ),
      task_stats AS (
        SELECT member_id, COUNT(*) AS tasks,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          COALESCE(SUM(COALESCE(cost_usd, 0)), 0) AS cost_usd,
          SUM(CASE WHEN control IS NOT NULL THEN 1 ELSE 0 END) AS controls,
          SUM(CASE WHEN control = 'failed' THEN 1 ELSE 0 END) AS controls_failed
        FROM filtered_tasks
        GROUP BY member_id
      ),
      item_stats AS (
        SELECT filtered_tasks.member_id, COUNT(item.id) AS items,
          SUM(CASE WHEN ${supported} THEN 1 ELSE 0 END) AS supported,
          SUM(CASE WHEN ${rejected} THEN 1 ELSE 0 END) AS rejected
        FROM filtered_tasks
        LEFT JOIN ${itemTable}
        GROUP BY filtered_tasks.member_id
      )
      SELECT task_stats.member_id, task_stats.tasks, task_stats.failed, task_stats.cost_usd,
        item_stats.items, item_stats.supported, item_stats.rejected,
        task_stats.controls, task_stats.controls_failed
      FROM task_stats
      JOIN item_stats ON item_stats.member_id = task_stats.member_id
      ORDER BY task_stats.member_id ASC
    `).all(swarmId, jobId, sinceIso) as Array<{
      member_id: string;
      tasks: number;
      failed: number;
      cost_usd: number;
      items: number;
      supported: number;
      rejected: number;
      controls: number;
      controls_failed: number;
    }>;
    return rows.map((row) => ({
      memberId: row.member_id,
      tasks: row.tasks,
      failed: row.failed,
      costUsd: row.cost_usd,
      items: row.items,
      supported: row.supported,
      rejected: row.rejected,
      controls: row.controls,
      controlsFailed: row.controls_failed,
    }));
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
