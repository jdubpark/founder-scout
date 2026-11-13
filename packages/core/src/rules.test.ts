/**
 * Checks on the project's own rules, so they cannot drift into prose nobody enforces.
 *
 * Each failure message says what to do about it, because the reader is as likely to be a
 * coding agent as a person.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JOB_OUTPUT_SCHEMAS, getParamDef } from "@agentswarm/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const read = (relative: string): string => readFileSync(path.join(repo, relative), "utf8");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file);

describe("project rules", () => {
  it("names, for every rule in CLAUDE.md, the test that enforces it", () => {
    const text = read("CLAUDE.md");
    const start = text.indexOf("## Rules that are not obvious from the code");
    expect(start, "CLAUDE.md lost its rules section. Restore the heading 'Rules that are not obvious from the code'.").toBeGreaterThan(-1);
    const rest = text.slice(start + 3);
    const end = rest.indexOf("\n## ");
    const section = end === -1 ? rest : rest.slice(0, end);

    // A rule is a top-level bullet and the indented lines under it.
    const rules = section.split(/\n(?=- )/).filter((block) => block.startsWith("- "));
    expect(rules.length).toBeGreaterThan(5);

    const problems: string[] = [];
    for (const rule of rules) {
      const title = rule.slice(2, 70).replace(/\s+/g, " ");
      const tests = [...rule.matchAll(/`([^`]+\.test\.tsx?)`/g)].map((match) => match[1] as string);
      const judgment = /\(Judgment[.)]/.test(rule);
      if (tests.length === 0 && !judgment) {
        problems.push(
          `"${title}..." names no test. Add the test that would fail if this rule were broken and name its path in backticks, or end the rule with "(Judgment.)" if no test can check it.`,
        );
      }
      for (const test of tests) {
        if (!existsSync(path.join(repo, test))) {
          problems.push(`"${title}..." names ${test}, which does not exist. Point the rule at the test that enforces it now.`);
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("keeps the numbers the documents quote equal to the defaults in code", () => {
    const quoted: Array<{ file: string; pattern: RegExp; param: string }> = [
      { file: "CLAUDE.md", pattern: /surface bar \((\d(?:\.\d+)?)\)/, param: "assess.surface_threshold" },
      {
        file: "docs/superpowers/specs/2026-11-12-founder-scout-swarm-design.md",
        pattern: /reaches the bar \((\d(?:\.\d+)?) by default\)/,
        param: "assess.surface_threshold",
      },
      {
        file: "docs/superpowers/specs/2026-11-12-founder-scout-swarm-design.md",
        pattern: /contributes the prior \((\d(?:\.\d+)?)\)/,
        param: "assess.unknown_prior",
      },
    ];
    for (const { file, pattern, param } of quoted) {
      const match = pattern.exec(read(file));
      expect(
        match,
        `${file} no longer contains a phrase matching ${pattern}. If the sentence was reworded, update this test to follow it.`,
      ).not.toBeNull();
      expect(
        Number(match?.[1]),
        `${file} quotes ${match?.[1]} for ${param}, but the default in packages/shared/src/params.ts is ${String(getParamDef(param)?.default)}. Change whichever is wrong.`,
      ).toBe(getParamDef(param)?.default);
    }
  });

  it("only quotes commands that exist", () => {
    const rootScripts = Object.keys((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts);
    const builtIn = new Set(["exec", "install", "add", "run", "dlx", "-r", "--parallel", "--filter"]);
    const problems: string[] = [];
    for (const file of ["README.md", "CLAUDE.md"]) {
      for (const match of read(file).matchAll(/pnpm (--filter (\S+) )?([a-z][a-z0-9:-]*)/g)) {
        const [, , filter, script] = match;
        if (!script || builtIn.has(script)) continue;
        if (filter) {
          const dir = filter.replace("@agentswarm/", "");
          const manifest = ["apps", "packages"].map((base) => path.join(repo, base, dir, "package.json")).find(existsSync);
          const scripts = manifest
            ? Object.keys((JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {})
            : [];
          if (!scripts.includes(script)) problems.push(`${file} quotes "pnpm --filter ${filter} ${script}", which ${filter} does not define.`);
        } else if (!rootScripts.includes(script)) {
          problems.push(`${file} quotes "pnpm ${script}", which the root package.json does not define.`);
        }
      }
    }
    expect(problems, `${problems.join("\n")}\nFix the document or add the script.`).toEqual([]);
  });
});

describe("models judge, code decides", () => {
  it("gives no model a field to put a score, a rank or a decision in", () => {
    const banned = new Set(["score", "scores", "composite", "decision", "rank", "ranking", "recommendation", "surface", "shortlist"]);
    const found: string[] = [];
    const seen = new Set<string>();
    const walk = (node: unknown, where: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${where}[${index}]`));
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record.properties && typeof record.properties === "object") {
        for (const [key, value] of Object.entries(record.properties as Record<string, unknown>)) {
          seen.add(key);
          if (banned.has(key.toLowerCase())) found.push(`${where}.${key}`);
          walk(value, `${where}.${key}`);
        }
      }
      for (const key of ["items", "anyOf", "oneOf", "allOf", "$defs", "definitions"]) {
        if (record[key] !== undefined) walk(record[key], where);
      }
    };
    for (const [jobId, schema] of Object.entries(JOB_OUTPUT_SCHEMAS)) walk(z.toJSONSchema(schema), jobId);
    // A check that never fires proves nothing. Confirm the walk reaches fields nested inside arrays.
    expect([...seen]).toEqual(expect.arrayContaining(["judgments", "evidenceIds", "verdicts", "leads"]));
    expect(
      found,
      `These output fields let a model return a score or a decision: ${found.join(", ")}. A model answers rubric questions; packages/shared/src/scoring.ts computes every number. Remove the field and compute it in code.`,
    ).toEqual([]);
  });
});

describe("architecture", () => {
  /**
   * Which directory of packages/core/src may import which. Everything may import contracts.ts
   * and @agentswarm/shared. The service is the one place that assembles the parts.
   */
  const ALLOWED: Record<string, readonly string[]> = {
    db: [],
    sim: [],
    jobs: [],
    providers: [],
    sources: [],
    engine: ["db", "jobs", "sim"],
    eval: ["sim"],
    service: ["db", "engine", "eval", "jobs", "providers", "sim", "sources"],
  };

  it("keeps the directories of core talking through contracts.ts", () => {
    const root = path.join(repo, "packages/core/src");
    const problems: string[] = [];
    for (const file of sourceFiles(root)) {
      if (isTest(file)) continue;
      const relative = path.relative(root, file);
      const from = relative.split(path.sep)[0] as string;
      if (!relative.includes(path.sep)) continue;
      for (const match of readFileSync(file, "utf8").matchAll(/from\s+"(\.\.?\/[^"]+)"/g)) {
        const target = path.relative(root, path.resolve(path.dirname(file), match[1] as string));
        if (target.startsWith("..")) {
          problems.push(`${relative} imports ${match[1]}, which is outside packages/core/src. Import a package by name instead.`);
          continue;
        }
        const to = target.split(path.sep)[0] as string;
        if (!target.includes(path.sep) || to === from) continue;
        if (!(ALLOWED[from] ?? []).includes(to)) {
          problems.push(
            `${relative} imports from ${to}/. ${from}/ may import only: ${(ALLOWED[from] ?? []).join(", ") || "nothing but contracts.ts and @agentswarm/shared"}. Put the shared type or interface in contracts.ts and have the service pass the implementation in. If this dependency is truly needed, add it to ALLOWED in packages/core/src/rules.test.ts with the reason.`,
          );
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("keeps the shared package pure and the dashboard off the server's internals", () => {
    const problems: string[] = [];
    for (const file of sourceFiles(path.join(repo, "packages/shared/src"))) {
      const text = readFileSync(file, "utf8");
      if (/from\s+"(node:|@agentswarm\/core|better-sqlite3|fastify)/.test(text) && !isTest(file)) {
        problems.push(`${path.relative(repo, file)} imports a runtime-specific module. packages/shared must run unchanged in the browser and on the server.`);
      }
    }
    for (const file of sourceFiles(path.join(repo, "apps/web/src"))) {
      if (/from\s+"@agentswarm\/core/.test(readFileSync(file, "utf8"))) {
        problems.push(`${path.relative(repo, file)} imports @agentswarm/core. The dashboard may depend on @agentswarm/shared only; add what it needs to packages/shared/src/api.ts.`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
