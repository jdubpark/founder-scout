import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvalBusyError, serializeEvalFlow } from "./lock";
import { appendJsonLine, readJsonLines } from "./persistence";

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "agentswarm-eval-persist-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("appendJsonLine", () => {
  it("repairs a file that was cut off mid-row before adding to it", async () => {
    const file = join(scratch(), "results.jsonl");
    // A process died half way through the second row.
    writeFileSync(file, '{"case":"a","score":1}\n{"case":"b","sco');
    await appendJsonLine(file, { case: "c", score: 3 });
    await appendJsonLine(file, { case: "d", score: 4 });

    expect(readFileSync(file, "utf8")).toBe('{"case":"a","score":1}\n{"case":"c","score":3}\n{"case":"d","score":4}\n');
    expect(await readJsonLines<{ case: string }>(file)).toEqual([
      { case: "a", score: 1 },
      { case: "c", score: 3 },
      { case: "d", score: 4 },
    ]);
  });

  it("creates the file when it does not exist", async () => {
    const file = join(scratch(), "nested", "errors.jsonl");
    await appendJsonLine(file, { message: "first" });
    expect(await readJsonLines(file)).toEqual([{ message: "first" }]);
  });
});

describe("serializeEvalFlow with a lock file", () => {
  it("refuses a flow that another live process holds, and releases its own lock afterwards", async () => {
    const lockFile = join(scratch(), ".flow.lock");
    // The parent process is alive and is not this process.
    writeFileSync(lockFile, `${process.ppid}\n`);
    await expect(serializeEvalFlow("held", async () => "ran", { file: lockFile })).rejects.toBeInstanceOf(EvalBusyError);

    rmSync(lockFile);
    await expect(serializeEvalFlow("free", async () => existsSync(lockFile), { file: lockFile })).resolves.toBe(true);
    expect(existsSync(lockFile)).toBe(false);
  });

  it("takes over a lock left by a process that no longer exists", async () => {
    const lockFile = join(scratch(), ".flow.lock");
    writeFileSync(lockFile, "999999999\n");
    await expect(serializeEvalFlow("stale", async () => "ran", { file: lockFile })).resolves.toBe("ran");
    expect(existsSync(lockFile)).toBe(false);
  });

  it("runs calls on one flow in this process one after another", async () => {
    const lockFile = join(scratch(), ".flow.lock");
    const order: string[] = [];
    const slow = serializeEvalFlow("queue", async () => {
      order.push("first starts");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first ends");
    }, { file: lockFile });
    const fast = serializeEvalFlow("queue", async () => { order.push("second runs"); }, { file: lockFile });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["first starts", "first ends", "second runs"]);
  });
});
