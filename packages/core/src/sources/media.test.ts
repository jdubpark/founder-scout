import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMediaFetcher } from "./media";

describe("media fetch", () => {
  it("refuses private and non-media addresses before downloading a file", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === "https://redirect.example.com/audio.mp3") {
        return new Response(null, { status: 302, headers: { location: "https://devpost.com/audio.mp3" } });
      }
      return new Response("<html><video></video></html>", { status: 200, headers: { "content-type": "text/html" } });
    });
    const media = createMediaFetcher({
      fetch,
      resolveHost: async (host) => host === "private.example.com" ? ["10.0.0.2"] : ["93.184.216.34"],
      sleep: async () => undefined,
    });

    expect(await media.fetch("http://private.example.com/audio.mp3", "/tmp/media-test")).toEqual({ refused: "The recording address resolves to a restricted network address." });
    expect(await media.fetch("https://public.example.com/player", "/tmp/media-test")).toEqual({ refused: "The address is not a direct audio or video file." });
    expect(await media.fetch("https://redirect.example.com/audio.mp3", "/tmp/media-test")).toEqual({ refused: "The address is not a direct audio or video file." });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://public.example.com/player",
      "https://redirect.example.com/audio.mp3",
      "https://devpost.com/audio.mp3",
    ]);
  });

  it("downloads a recording a robots.txt would disallow, and refuses a bare public IP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentswarm-media-"));
    try {
      const fetch = vi.fn(async (url: string) => {
        if (url === "https://pattern.example.com/robots.txt") {
          return new Response("User-agent: *\nDisallow: /*.mp3$", { status: 200, headers: { "content-type": "text/plain" } });
        }
        if (url === "https://named.example.com/robots.txt") {
          // Everyone may read this site except the reader by name: a recording is refused as a page would be.
          return new Response("User-agent: FundScout\nDisallow: /\n\nUser-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
        }
        if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
      });
      const media = createMediaFetcher({
        env: { HUNT_USER_AGENT: "FundScout/1.0 (+https://fund.example/bot)" },
        fetch,
        resolveHost: async () => ["93.184.216.34"],
        sleep: async () => undefined,
      });

      const pattern = await media.fetch("https://pattern.example.com/private.mp3", directory);
      expect(pattern).toEqual({ path: expect.stringMatching(/\.media$/), detail: "" });
      expect(await media.fetch("https://93.184.216.34/audio.mp3", directory)).toEqual({ refused: expect.any(String) });
      const named = await media.fetch("https://named.example.com/talk.mp3", directory);
      expect(named).toEqual({ path: expect.stringMatching(/\.media$/), detail: "" });
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        "https://pattern.example.com/private.mp3",
        "https://named.example.com/talk.mp3",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts direct media with a generated file name and refuses wrong types and oversized files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentswarm-media-files-"));
    try {
      const fetch = vi.fn(async (url: string) => {
        if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
        if (url.endsWith("/wrong-type.mp3")) {
          return new Response(new Uint8Array([1]), { headers: { "content-type": "text/plain" } });
        }
        if (url.endsWith("/declared-large.mp3")) {
          return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg", "content-length": "2" } });
        }
        if (url.endsWith("/streamed-large.mp3")) {
          return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } });
        }
        return new Response(new Uint8Array([7]), { headers: { "content-type": "audio/mpeg" } });
      });
      const media = createMediaFetcher({
        env: { MEDIA_MAX_MB: "0.000001" },
        fetch,
        resolveHost: async () => ["93.184.216.34"],
        sleep: async () => undefined,
      });

      expect(await media.fetch("https://files.example.com/wrong-type.mp3", directory))
        .toEqual({ refused: "The address is not a direct audio or video file." });
      expect(await media.fetch("https://files.example.com/declared-large.mp3", directory))
        .toEqual({ refused: "The recording is larger than the configured size limit." });
      expect(await media.fetch("https://files.example.com/streamed-large.mp3", directory))
        .toEqual({ refused: "The recording is larger than the configured size limit." });

      const saved = await media.fetch("https://files.example.com/clip.mp3", directory);
      expect(saved).toMatchObject({ detail: "" });
      if (!("path" in saved)) throw new Error("The valid recording was not saved.");
      expect(basename(saved.path)).toMatch(/^[0-9a-f-]{36}\.media$/iu);
      expect([...await readFile(saved.path)]).toEqual([7]);
      expect(await readdir(join(directory, "recordings"))).toEqual([basename(saved.path)]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
