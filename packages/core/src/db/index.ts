import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { BASE_CONFIG } from "@agentswarm/shared";
import type { Store } from "../contracts";
import { migrate } from "./schema";
import { SqliteStore, normalizeLink, normalizeName } from "./store";

export { normalizeLink, normalizeName };

export function openStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  try {
    migrate(db);
    db.prepare("INSERT OR IGNORE INTO configs (id, record) VALUES (?, ?)").run(BASE_CONFIG.id, JSON.stringify(BASE_CONFIG));
    return new SqliteStore(db);
  } catch (error) {
    db.close();
    throw error;
  }
}
