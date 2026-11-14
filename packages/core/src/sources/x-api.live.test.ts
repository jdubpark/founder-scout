import { describe, expect, it } from "vitest";
import { createXPostReader } from "./x-api";

const live = process.env.LIVE_SOURCES === "1" && Boolean(process.env.X_BEARER_TOKEN?.trim());

describe.skipIf(!live)("X API live", () => {
  it("reads one known post and reports a made-up id as gone", async () => {
    const reader = createXPostReader({ env: process.env });
    const result = await reader.read(["20", "99999999999999"]);

    expect(result.posts.get("20")?.text).toBe("just setting up my twttr");
    expect(result.posts.get("20")?.handle).toBe("jack");
    expect(result.gone.has("99999999999999")).toBe(true);
  }, 30_000);
});
