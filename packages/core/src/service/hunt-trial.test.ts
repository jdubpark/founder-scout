import { describe, expect, it } from "vitest";
import { BASE_CONFIG, SIM_WEB_HOST } from "@agentswarm/shared";
import { createSimWorld } from "../sim";
import type { HuntTrialInput } from "../contracts";
import { createHuntTrial } from "./hunt-trial";

describe("hunt trial service boundary", () => {
  it("returns only web-backed people and repeats the same trial exactly", async () => {
    const input: HuntTrialInput = { seed: 917, days: 3, config: BASE_CONFIG, brain: "sim", budgetUsd: 3 };
    const trial = createHuntTrial({}, { founders: 24 });
    const first = await trial(input);
    const second = await trial(input);
    const world = createSimWorld({ seed: input.seed, days: input.days, founders: 24 });

    expect(first).toEqual(second);
    expect(first.kept.length).toBeGreaterThan(0);
    for (const person of first.kept) {
      expect(world.founder(person.simFounderId)).toBeDefined();
      expect(world.page(`https://${SIM_WEB_HOST}/p/${encodeURIComponent(person.simFounderId)}`, input.days - 1)?.simFounderIds).toContain(person.simFounderId);
    }
  });
});
