import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { Transcriber } from "../contracts";
import type { FetchFn } from "./http";

export type CommandRunner = (command: string, args: string[], options?: { signal?: AbortSignal }) => Promise<string>;
const runCommand: CommandRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], signal: options?.signal });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `Transcriber exited with code ${code}.`)));
});

/** Ask ffprobe for the container duration. Missing ffprobe and unreadable files are unknown. */
export async function probeMediaDuration(
  filePath: string,
  options: { signal?: AbortSignal } = {},
  runner: CommandRunner = runCommand,
): Promise<number | null> {
  try {
    const output = await runner("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], options);
    const seconds = Number(output.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

function commandParts(template: string, filePath: string): { command: string; args: string[] } {
  const words = template.match(/(?:[^\s"']+|"[^"\\]*(?:\\.[^"\\]*)*"|'[^']*')+/gu) ?? [];
  const parts = words.map((word) => word.replace(/^(?:"(.*)"|'(.*)')$/u, (_, double: string | undefined, single: string | undefined) => double ?? single ?? "").replaceAll("{file}", filePath));
  const command = parts.shift();
  if (!command || !template.includes("{file}")) throw new Error("TRANSCRIBE_COMMAND must include {file}.");
  return { command, args: parts };
}

function parseTranscript(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("The transcription response was not an object.");
  const result = value as { text?: unknown; segments?: unknown; model?: unknown; duration?: unknown };
  if (typeof result.text !== "string" || !Array.isArray(result.segments)) throw new Error("The transcription response is missing text or segments.");
  const segments = result.segments.map((segment) => {
    if (!segment || typeof segment !== "object") throw new Error("A transcription segment was invalid.");
    const row = segment as { start?: unknown; end?: unknown; text?: unknown };
    if (typeof row.start !== "number" || typeof row.end !== "number" || typeof row.text !== "string") throw new Error("A transcription segment was invalid.");
    return { startSec: row.start, endSec: row.end, text: row.text };
  });
  return { text: result.text, segments, durationSec: typeof result.duration === "number" ? result.duration : segments.at(-1)?.endSec ?? 0, model: typeof result.model === "string" ? result.model : "unknown" };
}

export function createCommandTranscriber(template: string, runner: CommandRunner = runCommand): Transcriber {
  return {
    async status() { return { configured: template.trim().length > 0, detail: template.trim() ? "Command transcriber configured." : "TRANSCRIBE_COMMAND is empty." }; },
    async transcribe(filePath, options) {
      const { command, args } = commandParts(template, filePath);
      const parsed = parseTranscript(JSON.parse(await runner(command, args, options)));
      return { ...parsed, costUsd: null };
    },
  };
}

export function createHttpTranscriber(options: { baseUrl: string; apiKey: string; model: string; fetch?: FetchFn }): Transcriber {
  const fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    async status() { return { configured: Boolean(options.baseUrl && options.apiKey && options.model), detail: "OpenAI-compatible transcription endpoint configured." }; },
    async transcribe(filePath, callOptions) {
      const file = new File([await readFile(filePath)], filePath.split("/").at(-1) ?? "recording", { type: "application/octet-stream" });
      const body = new FormData();
      body.set("file", file);
      body.set("model", options.model);
      body.set("response_format", "verbose_json");
      const response = await fetchFn(`${options.baseUrl.replace(/\/+$/u, "")}/audio/transcriptions`, {
        method: "POST", headers: { Authorization: `Bearer ${options.apiKey}` }, body, signal: callOptions?.signal,
      });
      if (!response.ok) throw new Error(`Transcription endpoint returned HTTP ${response.status}.`);
      const payload = await response.json() as Record<string, unknown>;
      return { ...parseTranscript({ ...payload, model: payload.model ?? options.model }), costUsd: null };
    },
  };
}

export function createLiveTranscriber(env: NodeJS.ProcessEnv = process.env, options: { runner?: CommandRunner; fetch?: FetchFn } = {}): Transcriber | null {
  if (env.TRANSCRIBE_COMMAND?.trim()) return createCommandTranscriber(env.TRANSCRIBE_COMMAND, options.runner);
  if (env.TRANSCRIBE_BASE_URL && env.TRANSCRIBE_API_KEY && env.TRANSCRIBE_MODEL) {
    return createHttpTranscriber({ baseUrl: env.TRANSCRIBE_BASE_URL, apiKey: env.TRANSCRIBE_API_KEY, model: env.TRANSCRIBE_MODEL, fetch: options.fetch });
  }
  return null;
}
