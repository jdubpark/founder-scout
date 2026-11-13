/**
 * Makes an untrusted checkout safe to hand to an AI reviewer. A repository can
 * carry files that configure or instruct coding agents, so those are removed
 * wherever they appear, along with the .git directory and any symbolic link
 * that leads outside the checkout.
 *
 * Names are compared case-insensitively, because the default macOS file system
 * treats `claude.md` and `CLAUDE.md` as the same file.
 */

import { lstat, readdir, realpath, rm, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/** Directory names removed wherever they appear. `.git` is included. */
const DENIED_DIRECTORY_NAMES = new Set([".claude", ".codex", ".cursor", ".gemini", ".git"]);

/** File names removed wherever they appear. */
const DENIED_FILE_NAMES = new Set([
  "claude.md",
  "claude.local.md",
  "agents.md",
  "gemini.md",
  ".mcp.json",
  ".cursorrules",
  ".windsurfrules",
]);

/** Removed only when it sits directly inside a `.github` directory. */
const GITHUB_COPILOT_FILE = "copilot-instructions.md";

export interface SanitizeResult {
  /** Removed paths, relative to the checkout root, with forward slashes. Sorted. */
  removed: string[];
}

export async function sanitizeCheckout(dir: string): Promise<SanitizeResult> {
  const root = resolve(dir);
  const realRoot = await realpath(root);
  const removed: string[] = [];
  const symlinks: Array<{ abs: string; rel: string }> = [];

  await walk(root, "", null, removed, symlinks);

  // Checked after the walk, so a link to a file that was just removed is also caught.
  for (const link of symlinks) {
    if (!(await linkStaysInside(link.abs, realRoot))) {
      await unlink(link.abs);
      removed.push(link.rel);
    }
  }

  return { removed: removed.sort() };
}

async function walk(
  absDir: string,
  relDir: string,
  parentName: string | null,
  removed: string[],
  symlinks: Array<{ abs: string; rel: string }>,
): Promise<void> {
  const entries = await readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(absDir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const lower = entry.name.toLowerCase();

    const denied =
      DENIED_DIRECTORY_NAMES.has(lower) ||
      DENIED_FILE_NAMES.has(lower) ||
      (lower === GITHUB_COPILOT_FILE && parentName === ".github");
    if (denied) {
      await removeEntry(abs);
      removed.push(rel);
      continue;
    }

    if (entry.isSymbolicLink()) {
      symlinks.push({ abs, rel });
      continue;
    }
    if (entry.isDirectory()) {
      await walk(abs, rel, lower, removed, symlinks);
    }
  }
}

/** True when the link resolves to something that exists inside the checkout. Dangling links are not kept. */
async function linkStaysInside(linkPath: string, realRoot: string): Promise<boolean> {
  let target: string;
  try {
    target = await realpath(linkPath);
  } catch {
    return false;
  }
  return target === realRoot || target.startsWith(realRoot + sep);
}

async function removeEntry(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isDirectory()) {
    await rm(path, { recursive: true, force: true });
  } else {
    await unlink(path);
  }
}
