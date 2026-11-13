import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

const flowTails = new Map<string, Promise<void>>();

/** A lock file older than this belongs to a process that died; a round never takes this long. */
const STALE_LOCK_MS = 15 * 60 * 1000;

export class EvalBusyError extends Error {
  constructor() {
    super("Another process is working on this eval. Try again when it finishes.");
    this.name = "EvalBusyError";
  }
}

async function acquireFileLock(lockFile: string): Promise<() => Promise<void>> {
  await mkdir(dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockFile, "wx");
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return async () => {
        await rm(lockFile, { force: true }).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = Number((await readFile(lockFile, "utf8").catch(() => "")).trim());
      const age = Date.now() - (await stat(lockFile).then((info) => info.mtimeMs).catch(() => Date.now()));
      // Our own process holding it is handled by the in-process queue; a dead owner's lock is taken over.
      const ownerAlive = Number.isInteger(owner) && owner > 0 && owner !== process.pid && isAlive(owner);
      if (ownerAlive && age < STALE_LOCK_MS) throw new EvalBusyError();
      await rm(lockFile, { force: true }).catch(() => undefined);
    }
  }
  throw new EvalBusyError();
}

async function acquireWithin(lockFile: string, waitMs: number): Promise<() => Promise<void>> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return await acquireFileLock(lockFile);
    } catch (error) {
      if (!(error instanceof EvalBusyError) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Runs one read or write of a flow at a time. Calls inside this process queue up behind each
 * other. A lock file in the flow's directory keeps a second process (the server and the command
 * line, say) from working on the same flow at once: it is refused, not queued.
 */
export async function serializeEvalFlow<T>(
  key: string,
  action: () => Promise<T>,
  /** `waitMs` is how long to keep trying when another process holds the flow. Zero refuses at once. */
  lock?: { file: string; waitMs?: number },
): Promise<T> {
  const previous = flowTails.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  flowTails.set(key, tail);
  await previous;
  let unlock: (() => Promise<void>) | null = null;
  try {
    if (lock) unlock = await acquireWithin(lock.file, lock.waitMs ?? 0);
    return await action();
  } finally {
    if (unlock) await unlock();
    release();
    if (flowTails.get(key) === tail) flowTails.delete(key);
  }
}
