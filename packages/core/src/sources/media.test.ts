import { describe, expect, it, vi } from "vitest";
import { createMediaFetcher } from "./media";

describe("media fetch", () => {
  it("refuses private, denied, and non-media addresses before downloading a file", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200 });
      return new Response("<html><video></video></html>", { status: 200, headers: { "content-type": "text/html" } });
    });
    const media = createMediaFetcher({
      fetch,
      resolveHost: async (host) => host === "private.test" ? ["10.0.0.2"] : ["93.184.216.34"],
    });

    expect(await media.fetch("http://private.test/audio.mp3", "/tmp/media-test")).toEqual({ refused: "The recording address resolves to a restricted network address." });
    expect(await media.fetch("https://linkedin.com/audio.mp3", "/tmp/media-test")).toEqual({ refused: "This host is never requested." });
    expect(await media.fetch("https://public.test/player", "/tmp/media-test")).toEqual({ refused: "The address is not a direct audio or video file." });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://public.test/robots.txt", "https://public.test/player"]);
  });
});
