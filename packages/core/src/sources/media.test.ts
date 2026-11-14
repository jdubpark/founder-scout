import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMediaFetcher } from "./media";

describe("media fetch", () => {
  it("refuses private, denied, and non-media addresses before downloading a file", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
      return new Response("<html><video></video></html>", { status: 200, headers: { "content-type": "text/html" } });
    });
    const media = createMediaFetcher({
      fetch,
      resolveHost: async (host) => host === "private.example.com" ? ["10.0.0.2"] : ["93.184.216.34"],
      sleep: async () => undefined,
    });

    expect(await media.fetch("http://private.example.com/audio.mp3", "/tmp/media-test")).toEqual({ refused: "The recording address resolves to a restricted network address." });
    expect(await media.fetch("https://linkedin.com/audio.mp3", "/tmp/media-test")).toEqual({ refused: "This host is never requested." });
    expect(await media.fetch("https://public.example.com/player", "/tmp/media-test")).toEqual({ refused: "The address is not a direct audio or video file." });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://public.example.com/robots.txt", "https://public.example.com/player"]);
  });

  it("applies robots wildcards and refuses a bare public IP before requesting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentswarm-media-"));
    try {
      const fetch = vi.fn(async (url: string) => {
        if (url === "https://pattern.example.com/robots.txt") {
          return new Response("User-agent: *\nDisallow: /*.mp3$", { status: 200, headers: { "content-type": "text/plain" } });
        }
        if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
      });
      const media = createMediaFetcher({
        fetch,
        resolveHost: async () => ["93.184.216.34"],
        sleep: async () => undefined,
      });

      expect(await media.fetch("https://pattern.example.com/private.mp3", directory)).toEqual({ refused: "robots.txt does not allow this recording." });
      expect(await media.fetch("https://93.184.216.34/audio.mp3", directory)).toEqual({ refused: expect.any(String) });
      expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://pattern.example.com/robots.txt"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
