import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sanitizeCheckout } from "./sanitize";

let base: string;
let checkout: string;
let outside: string;

function write(rel: string, content = "x"): void {
  const path = join(checkout, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "sanitize-test-"));
  checkout = join(base, "checkout");
  outside = join(base, "outside");
  mkdirSync(checkout);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "outside the checkout");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("sanitizeCheckout", () => {
  it("removes every agent-instruction file and directory wherever it appears, and keeps ordinary files", async () => {
    write("CLAUDE.md");
    write("CLAUDE.local.md");
    write("AGENTS.md");
    write("GEMINI.md");
    write(".mcp.json");
    write(".cursorrules");
    write(".windsurfrules");
    write(".claude/settings.json");
    write(".codex/config.toml");
    write(".cursor/rules/style.mdc");
    write(".gemini/settings.json");
    write(".github/copilot-instructions.md");
    write(".git/config");
    write("packages/app/.claude/settings.json");
    write("docs/agents.md");
    write("docs/claude.md");
    write("src/index.ts", "export const ok = true;");
    write(".github/workflows/ci.yml", "name: ci");
    write("README.md", "# readme");

    const { removed } = await sanitizeCheckout(checkout);

    expect(removed).toEqual(
      [
        ".claude",
        ".codex",
        ".cursor",
        ".cursorrules",
        ".gemini",
        ".git",
        ".github/copilot-instructions.md",
        ".mcp.json",
        ".windsurfrules",
        "AGENTS.md",
        "CLAUDE.local.md",
        "CLAUDE.md",
        "GEMINI.md",
        "docs/agents.md",
        "docs/claude.md",
        "packages/app/.claude",
      ].sort(),
    );
    for (const rel of removed) {
      expect(existsSync(join(checkout, rel))).toBe(false);
    }
    expect(readFileSync(join(checkout, "src/index.ts"), "utf8")).toBe("export const ok = true;");
    expect(existsSync(join(checkout, ".github/workflows/ci.yml"))).toBe(true);
    expect(existsSync(join(checkout, "README.md"))).toBe(true);
  });

  it("matches names case-insensitively", async () => {
    write("docs/Claude.MD");
    write(".Claude/Settings.json");
    const { removed } = await sanitizeCheckout(checkout);
    expect(removed).toEqual([".Claude", "docs/Claude.MD"]);
  });

  it("does not remove a copilot instructions file outside .github", async () => {
    write("docs/copilot-instructions.md");
    const { removed } = await sanitizeCheckout(checkout);
    expect(removed).toEqual([]);
    expect(existsSync(join(checkout, "docs/copilot-instructions.md"))).toBe(true);
  });

  it("removes a symbolic link that points outside the checkout, without touching its target", async () => {
    write("src/index.ts");
    symlinkSync(join(outside, "secret.txt"), join(checkout, "leak.txt"));

    const { removed } = await sanitizeCheckout(checkout);

    expect(removed).toEqual(["leak.txt"]);
    expect(existsSync(join(checkout, "leak.txt"))).toBe(false);
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("outside the checkout");
  });

  it("removes a relative symbolic link that escapes through parent directories", async () => {
    write("src/index.ts");
    symlinkSync("../../outside/secret.txt", join(checkout, "src", "escape.txt"));
    const { removed } = await sanitizeCheckout(checkout);
    expect(removed).toEqual(["src/escape.txt"]);
  });

  it("keeps a symbolic link that stays inside the checkout", async () => {
    write("src/index.ts", "inside");
    symlinkSync("src/index.ts", join(checkout, "entry.ts"));
    const { removed } = await sanitizeCheckout(checkout);
    expect(removed).toEqual([]);
    expect(readFileSync(join(checkout, "entry.ts"), "utf8")).toBe("inside");
  });

  it("removes a dangling symbolic link, including one that pointed at a file just removed", async () => {
    write("CLAUDE.md");
    symlinkSync("CLAUDE.md", join(checkout, "notes.md"));
    symlinkSync("missing.txt", join(checkout, "dangling"));
    const { removed } = await sanitizeCheckout(checkout);
    expect(removed).toEqual(["CLAUDE.md", "dangling", "notes.md"]);
  });

  it("does not follow a symbolic link to a directory outside the checkout", async () => {
    symlinkSync(outside, join(checkout, "linked-dir"));
    const { removed } = await sanitizeCheckout(checkout);
    expect(removed).toEqual(["linked-dir"]);
    expect(existsSync(join(outside, "secret.txt"))).toBe(true);
  });

  it("returns an empty list for a clean checkout", async () => {
    write("src/index.ts");
    expect(await sanitizeCheckout(checkout)).toEqual({ removed: [] });
  });
});
