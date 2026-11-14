import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { findOnPath, runProcess } from "./subprocess";

const base = { cwd: process.cwd(), env: process.env, stdin: "" };

describe("runProcess", () => {
  it("writes stdin, closes it, and returns stdout", async () => {
    const out = await runProcess({ ...base, command: "cat", args: [], stdin: "hello from stdin", timeoutMs: 10_000 });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe("hello from stdin");
    expect(out.timedOut).toBe(false);
  });

  it("passes arguments as an array, never through a shell", async () => {
    const out = await runProcess({ ...base, command: "printf", args: ["%s", "$HOME;rm"], timeoutMs: 10_000 });
    expect(out.stdout).toBe("$HOME;rm");
  });

  it("tells the child the directory it really runs in, not the parent's", async () => {
    // A tool that reads PWD for its project directory (opencode does) must not be pointed at
    // this repository when it was started in a scratch directory.
    const cwd = realpathSync(tmpdir());
    const out = await runProcess({
      ...base,
      cwd,
      env: { ...process.env, PWD: "/somewhere/else", OLDPWD: "/before" },
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.env.PWD + '|' + (process.env.OLDPWD ?? 'unset'))"],
      timeoutMs: 10_000,
    });
    expect(out.stdout).toBe(`${cwd}|unset`);
  });

  it("kills the process and reports a timeout", async () => {
    const started = Date.now();
    const out = await runProcess({ ...base, command: "sleep", args: ["30"], timeoutMs: 200 });
    expect(out.timedOut).toBe(true);
    expect(out.cancelled).toBe(false);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("kills the process when the signal aborts, and reports cancellation", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const out = await runProcess({ ...base, command: "sleep", args: ["30"], timeoutMs: 20_000, signal: controller.signal });
    expect(out.cancelled).toBe(true);
    expect(out.timedOut).toBe(false);
  });

  it("does not start a process when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await runProcess({ ...base, command: "sleep", args: ["30"], timeoutMs: 20_000, signal: controller.signal });
    expect(out.cancelled).toBe(true);
  });

  it("reports a missing binary as a spawn error, not an exit code", async () => {
    const out = await runProcess({ ...base, command: "agentswarm-no-such-binary", args: [], timeoutMs: 10_000 });
    expect(out.spawnError).toMatch(/ENOENT/);
    expect(out.exitCode).toBeNull();
  });
});

describe("findOnPath", () => {
  it("finds an executable on PATH and returns null when it is absent", async () => {
    expect(await findOnPath("sh", { PATH: "/usr/bin:/bin" })).toMatch(/sh$/);
    expect(await findOnPath("agentswarm-no-such-binary", { PATH: "/usr/bin:/bin" })).toBeNull();
    expect(await findOnPath("sh", {})).toBeNull();
  });
});
