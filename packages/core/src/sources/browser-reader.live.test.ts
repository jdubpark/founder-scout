import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { linkedinAccountsFromEnv, personaFor } from "./sessions";
import { createOctoLocalClient, octoProfileUuidsFromEnv } from "./octo";
import { createBrowserLinkedInReader } from "./browser-reader";

/**
 * Live coverage for the Octo browser reader, opt-in like the other live tests: set
 * LIVE_OCTO=1, run the Octo Browser app, and give each account a profile UUID. The
 * local `.env` is read when the variables are not already in the environment. Without
 * the flag the suite is skipped, and the browser path stays unverified against the live
 * service — say so rather than implying otherwise.
 */
const LIVE = process.env.LIVE_OCTO === "1";

function envFromLocalFile(): Record<string, string> {
  try {
    const env: Record<string, string> = {};
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const at = line.indexOf("=");
      if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
    }
    return env;
  } catch {
    return {};
  }
}

const localEnv = envFromLocalFile();
const env = { ...localEnv, ...process.env };
const accounts = linkedinAccountsFromEnv(env);
const profileUuids = octoProfileUuidsFromEnv(env);

describe.skipIf(!LIVE || accounts.length === 0 || profileUuids.length !== accounts.length)("browser reader live", () => {
  afterAll(async () => {
    // The reader leaves profiles running on purpose; a test stops what it started.
    const client = createOctoLocalClient();
    for (const uuid of profileUuids) await client.stopProfile(uuid).catch(() => undefined);
  });

  it("reads one page of the professional network through a real profile", async () => {
    // A weekday inside the account's own workday, so the rhythm gate lets the read through
    // whenever the test runs. The rhythm itself is covered by the offline tests.
    const insideWorkday = new Date(2026, 10, 10, 0, personaFor(accounts[0]!.cookie).workdayStartMinute + 60).getTime();
    const reader = createBrowserLinkedInReader({ accounts, profileUuids, now: () => insideWorkday });
    const page = await reader.read("https://www.linkedin.com/in/elad-moshe-05a90413/", { maxTextChars: 20_000 });
    expect(page.status).toBe("ok");
    expect(page.text.length).toBeGreaterThan(80);
  }, 240_000);
});
