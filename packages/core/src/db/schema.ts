import type Database from "better-sqlite3";

type Migration = (db: Database.Database) => void;

const migrations: readonly Migration[] = [
  (db) => {
    db.exec(`
      CREATE TABLE settings (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE configs (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE swarms (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE agents (id TEXT PRIMARY KEY, swarm_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX agents_by_swarm ON agents(swarm_id);
      CREATE TABLE directives (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX directives_by_created ON directives(created_at);
      CREATE TABLE leads (id TEXT PRIMARY KEY, swarm_id TEXT NOT NULL, founder_id TEXT, discovered_at TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX leads_by_swarm ON leads(swarm_id);
      CREATE INDEX leads_by_founder ON leads(founder_id);
      CREATE TABLE founders (
        id TEXT PRIMARY KEY, swarm_id TEXT NOT NULL, normalized_name TEXT NOT NULL,
        updated_at TEXT NOT NULL, next_recheck_at TEXT, status TEXT NOT NULL, record TEXT NOT NULL
      );
      CREATE INDEX founders_by_swarm_name ON founders(swarm_id, normalized_name);
      CREATE INDEX founders_by_swarm_updated ON founders(swarm_id, updated_at DESC);
      CREATE TABLE founder_links (
        swarm_id TEXT NOT NULL, founder_id TEXT NOT NULL, field TEXT NOT NULL, normalized_link TEXT NOT NULL,
        PRIMARY KEY (founder_id, field)
      );
      CREATE INDEX founder_links_match ON founder_links(swarm_id, field, normalized_link);
      CREATE TABLE evidence (
        id TEXT PRIMARY KEY, founder_id TEXT NOT NULL, hash TEXT NOT NULL,
        captured_at TEXT NOT NULL, verification TEXT NOT NULL, record TEXT NOT NULL,
        UNIQUE (founder_id, hash)
      );
      CREATE INDEX evidence_by_founder ON evidence(founder_id, captured_at);
      CREATE TABLE assessments (
        id TEXT PRIMARY KEY, founder_id TEXT NOT NULL, created_at TEXT NOT NULL,
        decision TEXT NOT NULL, composite REAL NOT NULL, cracked REAL NOT NULL,
        founder_score REAL NOT NULL, fit REAL, coverage REAL NOT NULL, record TEXT NOT NULL
      );
      CREATE INDEX assessments_by_founder ON assessments(founder_id, created_at DESC);
      CREATE TABLE feedback (id TEXT PRIMARY KEY, founder_id TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX feedback_by_founder ON feedback(founder_id, created_at DESC);
      CREATE TABLE outreach (
        id TEXT PRIMARY KEY, swarm_id TEXT NOT NULL, founder_id TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, record TEXT NOT NULL
      );
      CREATE INDEX outreach_by_swarm ON outreach(swarm_id, created_at);
      CREATE INDEX outreach_by_founder ON outreach(founder_id, created_at);
      CREATE TABLE runs (
        id TEXT PRIMARY KEY, swarm_id TEXT NOT NULL, status TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, record TEXT NOT NULL
      );
      CREATE INDEX runs_by_swarm_started ON runs(swarm_id, started_at DESC);
      CREATE INDEX runs_by_status ON runs(status, started_at DESC);
      CREATE TABLE tasks (
        insertion_order INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL, swarm_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        founder_id TEXT, status TEXT NOT NULL, started_at TEXT, finished_at TEXT,
        cost_usd REAL, items_out INTEGER NOT NULL, output_summary TEXT, record TEXT NOT NULL
      );
      CREATE INDEX tasks_by_run ON tasks(run_id, insertion_order);
      CREATE INDEX tasks_by_agent ON tasks(agent_id);
      CREATE INDEX tasks_by_swarm_agent ON tasks(swarm_id, agent_id);
      CREATE TABLE task_traces (task_id TEXT PRIMARY KEY, trace TEXT NOT NULL);
      CREATE TABLE task_directives (
        task_id TEXT NOT NULL, directive_id TEXT NOT NULL, started_at TEXT,
        PRIMARY KEY (task_id, directive_id)
      );
      CREATE INDEX task_directives_by_directive ON task_directives(directive_id, started_at);
      CREATE TABLE audit (id TEXT PRIMARY KEY, at TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX audit_by_at ON audit(at DESC);
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE companies (
        id TEXT PRIMARY KEY, swarm_id TEXT NOT NULL, domain TEXT, normalized_name TEXT NOT NULL,
        status TEXT NOT NULL, updated_at TEXT NOT NULL, next_recheck_at TEXT, record TEXT NOT NULL
      );
      CREATE INDEX companies_by_swarm_domain ON companies(swarm_id, domain);
      CREATE INDEX companies_by_swarm_name ON companies(swarm_id, normalized_name);
      CREATE TABLE company_members (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, normalized_name TEXT NOT NULL,
        record TEXT NOT NULL, UNIQUE(company_id, normalized_name)
      );
      CREATE INDEX company_members_by_company ON company_members(company_id);
      CREATE TABLE company_assessments (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, created_at TEXT NOT NULL,
        decision TEXT NOT NULL, deal REAL NOT NULL, record TEXT NOT NULL
      );
      CREATE INDEX company_assessments_by_company ON company_assessments(company_id, created_at DESC);
      CREATE TABLE company_feedback (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL
      );
      CREATE INDEX company_feedback_by_company ON company_feedback(company_id, created_at DESC);
      CREATE TABLE network_contacts (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, normalized_name TEXT NOT NULL,
        normalized_company TEXT, record TEXT NOT NULL
      );
      CREATE INDEX network_contacts_by_owner ON network_contacts(owner);
      CREATE INDEX network_contacts_by_company ON network_contacts(normalized_company);
      ALTER TABLE founders ADD COLUMN company_id TEXT;
      CREATE INDEX founders_by_company ON founders(company_id);
      ALTER TABLE evidence ADD COLUMN company_id TEXT;
      CREATE INDEX evidence_by_company ON evidence(company_id, captured_at);
      ALTER TABLE tasks ADD COLUMN company_id TEXT;
      CREATE INDEX tasks_by_company ON tasks(company_id, insertion_order);
    `);
  },
  (db) => {
    db.exec("ALTER TABLE tasks ADD COLUMN pool_member TEXT");
  },
];

export function migrate(db: Database.Database): void {
  const current = Number(db.pragma("user_version", { simple: true }));
  if (!Number.isInteger(current) || current < 0 || current > migrations.length) {
    throw new Error(`Unsupported database schema version: ${String(current)}`);
  }
  for (let index = current; index < migrations.length; index++) {
    db.transaction(() => {
      migrations[index]?.(db);
      db.pragma(`user_version = ${index + 1}`);
    })();
  }
}
