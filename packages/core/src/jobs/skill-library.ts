import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isClassId, isJobId, type Skill } from "@agentswarm/shared";

function list(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  }
  return [trimmed.replace(/^['"]|['"]$/g, "")];
}

export function parseSkillFile(id: string, source: string): Skill {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`Skill ${id} needs YAML front matter.`);
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const field = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!field) throw new Error(`Invalid front matter in skill ${id}: ${line}`);
    if (!["name", "description", "jobs", "classes", "hosts", "words", "priority"].includes(field[1]!)) {
      throw new Error(`Unknown front matter field in skill ${id}: ${field[1]}`);
    }
    fields[field[1]!] = field[2] ?? "";
  }
  const name = fields.name?.trim();
  const description = fields.description?.trim();
  if (!name || !description || description.includes("\n")) throw new Error(`Skill ${id} needs a one-line name and description.`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`Invalid skill id: ${id}`);
  const jobs = list(fields.jobs);
  const classes = list(fields.classes);
  if (!jobs.length && !classes.length) throw new Error(`Skill ${id} needs jobs or classes.`);
  if (jobs.some((job) => !isJobId(job))) throw new Error(`Skill ${id} names an unknown job.`);
  if (classes.some((agentClass) => !isClassId(agentClass))) throw new Error(`Skill ${id} names an unknown class.`);
  const priority = fields.priority === undefined ? 0 : Number(fields.priority);
  if (!Number.isFinite(priority)) throw new Error(`Skill ${id} has an invalid priority.`);
  const body = (match[2] ?? "").trim();
  if (!body || body.length > 900) throw new Error(`Skill ${id} body must contain 1 to 900 characters.`);
  return {
    id, name, description, jobs: jobs as Skill["jobs"], classes: classes as Skill["classes"],
    ...(fields.hosts ? { hosts: list(fields.hosts) } : {}),
    ...(fields.words ? { words: list(fields.words) } : {}),
    priority, body,
  };
}

export function loadSkillLibrary(directory: string): Skill[] {
  return readdirSync(directory).sort().flatMap((id) => {
    const folder = join(directory, id);
    if (!statSync(folder).isDirectory()) return [];
    return [parseSkillFile(id, readFileSync(join(folder, "SKILL.md"), "utf8"))];
  });
}
