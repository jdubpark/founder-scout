import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

let tempSequence = 0;

export type TempWriter = (file: string, contents: string) => Promise<void>;

/** Writes beside the destination and atomically replaces it after the temp is complete. */
export async function writeAtomicFile(
  file: string,
  contents: string,
  writeTemp: TempWriter = async (temp, value) => writeFile(temp, value, "utf8"),
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${tempSequence++}.tmp`;
  try {
    await writeTemp(temp, contents);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Reads complete JSONL rows and ignores only a malformed, unterminated final line. */
export async function readJsonLines<T>(file: string): Promise<T[]> {
  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const lines = contents.split("\n");
  const rows: T[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch (error) {
      const isUnterminatedTail = index === lines.length - 1 && !contents.endsWith("\n");
      if (isUnterminatedTail) break;
      throw error;
    }
  }
  return rows;
}

/**
 * Appends one row to a JSONL file. If an earlier process died half way through a row, the file
 * ends without a newline; appending after that fragment would weld two rows into one line that
 * no reader can parse. So the complete rows are rewritten first, and only then is the row added.
 */
export async function appendJsonLine(file: string, row: unknown): Promise<void> {
  let contents: string | null = null;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (contents !== null && contents.length > 0 && !contents.endsWith("\n")) {
    const complete = await readJsonLines<unknown>(file);
    await writeAtomicFile(file, complete.map((item) => `${JSON.stringify(item)}\n`).join(""));
  }
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
}
