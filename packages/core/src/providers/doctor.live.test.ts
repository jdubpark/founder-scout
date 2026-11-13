import { describe, expect, it } from "vitest";
import { runDoctor } from "./doctor";

const LIVE = process.env.LIVE_PROVIDERS === "1";

describe.skipIf(!LIVE)("runDoctor live", () => {
  it(
    "probes each configured provider with one tiny structured call",
    async () => {
      const rows = await runDoctor({ live: true });
      console.log("runDoctor:", JSON.stringify(rows.map((r) => ({ provider: r.provider, configured: r.configured, live: r.live }))));
      for (const row of rows) {
        if (row.provider === "sim" || !row.configured) {
          expect(row.live).toBeNull();
        } else {
          expect(row.live?.error ?? null, `${row.provider} probe`).toBeNull();
          expect(row.live?.ok, `${row.provider} probe`).toBe(true);
        }
      }
    },
    300_000,
  );
});
