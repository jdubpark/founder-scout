import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

export interface ProcessRequest {
  command: string;
  /** Passed as an argument array. Never run through a shell. */
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Written to stdin, then stdin is closed. */
  stdin: string;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

export interface ProcessOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  /** Set when the binary could not be started, such as ENOENT. */
  spawnError: string | null;
}

/** Injected in tests so provider logic runs without a real CLI. */
export type ProcessRunner = (req: ProcessRequest) => Promise<ProcessOutcome>;

const FORCE_KILL_AFTER_MS = 3_000;
const GIVE_UP_AFTER_KILL_MS = 5_000;

/** Spawns the process in its own group so a timeout or cancel takes its children too. */
export const runProcess: ProcessRunner = (req) =>
  new Promise<ProcessOutcome>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;

    const posix = process.platform !== "win32";
    let child: ReturnType<typeof spawn>;
    try {
      // spawn() changes the directory but leaves PWD as the parent's. Some tools take their
      // project directory from PWD (opencode does: found by running it, 2026-11-13), and would
      // then read this repository's own instructions and miss the generated agent. So PWD
      // always names the directory the child really runs in, and OLDPWD is not passed on.
      const { OLDPWD: _oldPwd, ...childEnv } = req.env;
      child = spawn(req.command, [...req.args], {
        cwd: req.cwd,
        env: { ...childEnv, PWD: req.cwd },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        detached: posix,
      });
    } catch (err) {
      resolve({
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        spawnError: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const finish = (spawnError: string | null, exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (giveUp) clearTimeout(giveUp);
      req.signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode, stdout, stderr, timedOut, cancelled, spawnError });
    };

    const signalGroup = (signal: NodeJS.Signals) => {
      const pid = child.pid;
      try {
        if (posix && pid !== undefined) process.kill(-pid, signal);
        else child.kill(signal);
      } catch {
        // The group has already exited.
      }
    };

    const stop = () => {
      signalGroup("SIGTERM");
      const force = setTimeout(() => signalGroup("SIGKILL"), FORCE_KILL_AFTER_MS);
      force.unref();
      // A grandchild holding the pipes open must not hang the caller.
      giveUp = setTimeout(() => finish(null, null), GIVE_UP_AFTER_KILL_MS);
      giveUp.unref();
    };

    const onAbort = () => {
      if (settled) return;
      cancelled = true;
      stop();
    };

    if (req.signal?.aborted) {
      cancelled = true;
      stop();
    } else {
      req.signal?.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, req.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    // The child may exit before reading stdin. That is reported through its exit code.
    child.stdin?.on("error", () => {});
    child.stdin?.end(req.stdin);

    child.on("error", (err) => finish(err.message, null));
    child.on("close", (code) => finish(null, code));
  });

/** The first executable named `command` on PATH, or null. Never runs it. */
export async function findOnPath(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const dirs = (env.PATH ?? "").split(delimiter).filter((d) => d.length > 0);
  for (const dir of dirs) {
    const candidate = join(dir, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }
  return null;
}
