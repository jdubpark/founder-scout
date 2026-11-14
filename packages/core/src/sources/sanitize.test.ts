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
  it("removes agent instructions, .git and case variants while keeping ordinary files", async () => {
    for (const path of [
      "CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "GEMINI.md", ".mcp.json", ".cursorrules", ".windsurfrules",
      ".codex/config.toml", ".cursor/rules/style.mdc", ".gemini/settings.json",
      ".github/copilot-instructions.md", "packages/app/.claude/settings.json", "docs/Claude.MD", ".Claude/Settings.json", ".git/config",
    ]) write(path);
    write("docs/copilot-instructions.md");
    write("src/index.ts", "export const safe = true;");
    write(".github/workflows/ci.yml", "name: ci");
    write("README.md", "# readme");

    const { removed } = await sanitizeCheckout(checkout);
    expect(removed).toEqual([
      ".Claude", ".codex", ".cursor", ".cursorrules", ".gemini", ".git",
      ".github/copilot-instructions.md", ".mcp.json", ".windsurfrules", "AGENTS.md", "CLAUDE.local.md", "CLAUDE.md",
      "GEMINI.md", "docs/Claude.MD", "packages/app/.claude",
    ].sort());
    for (const rel of removed) expect(existsSync(join(checkout, rel))).toBe(false);
    expect(readFileSync(join(checkout, "src/index.ts"), "utf8")).toBe("export const safe = true;");
    expect(existsSync(join(checkout, ".github/workflows/ci.yml"))).toBe(true);
    expect(existsSync(join(checkout, "docs/copilot-instructions.md"))).toBe(true);
    expect(existsSync(join(checkout, "README.md"))).toBe(true);
  });

  it("removes links that escape or dangle without following them, and keeps an internal link", async () => {
    write("src/index.ts", "inside");
    write("CLAUDE.md", "untrusted instructions");
    symlinkSync(join(outside, "secret.txt"), join(checkout, "leak.txt"));
    symlinkSync("../../outside/secret.txt", join(checkout, "src", "escape.txt"));
    symlinkSync("src/index.ts", join(checkout, "entry.ts"));
    symlinkSync("CLAUDE.md", join(checkout, "notes.md"));
    symlinkSync("missing.txt", join(checkout, "dangling"));
    symlinkSync(outside, join(checkout, "linked-dir"));

    const { removed } = await sanitizeCheckout(checkout);
    expect(removed).toEqual(["CLAUDE.md", "dangling", "leak.txt", "linked-dir", "notes.md", "src/escape.txt"]);
    expect(readFileSync(join(checkout, "entry.ts"), "utf8")).toBe("inside");
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("outside the checkout");
  });
});
