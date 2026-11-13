import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCommandTranscriber, createHttpTranscriber } from "./transcribe";

describe("transcription adapters", () => {
  it("passes the media path as an argument and parses command JSON without a shell", async () => {
    const runner = vi.fn(async () => JSON.stringify({ text: "Exact words.", segments: [{ start: 1, end: 2, text: "Exact words." }] }));
    const adapter = createCommandTranscriber("transcribe --input {file}", runner);
    const result = await adapter.transcribe("/tmp/a recording.wav");
    expect(runner).toHaveBeenCalledWith("transcribe", ["--input", "/tmp/a recording.wav"], undefined);
    expect(result).toMatchObject({ text: "Exact words.", segments: [{ startSec: 1, endSec: 2, text: "Exact words." }], costUsd: null });
  });

  it("sends verbose_json multipart audio to an OpenAI-compatible endpoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentswarm-transcribe-"));
    try {
      const filePath = join(directory, "voice.wav");
      await writeFile(filePath, new Uint8Array([1, 2, 3]));
      const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = init?.body as FormData;
        expect(body.get("model")).toBe("whisper-test");
        expect(body.get("response_format")).toBe("verbose_json");
        expect(init?.headers).toEqual({ Authorization: "Bearer secret" });
        return Response.json({ text: "Exact words.", duration: 2, segments: [{ start: 1, end: 2, text: "Exact words." }] });
      });
      const adapter = createHttpTranscriber({ baseUrl: "https://speech.example/v1/", apiKey: "secret", model: "whisper-test", fetch });
      const result = await adapter.transcribe(filePath);
      expect(fetch).toHaveBeenCalledWith("https://speech.example/v1/audio/transcriptions", expect.any(Object));
      expect(result).toMatchObject({ text: "Exact words.", model: "whisper-test", durationSec: 2, costUsd: null });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
