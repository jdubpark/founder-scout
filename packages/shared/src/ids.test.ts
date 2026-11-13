import { describe, expect, it } from "vitest";
import { newId, stableId } from "./ids";

const SHAPE = /^[a-z]{3}_[0-9a-hjkmnp-tv-z]{12}$/;

describe("ids", () => {
  it("builds a stable id from only the id alphabet, whatever the seed hashes to", () => {
    for (let i = 0; i < 2000; i++) {
      expect(stableId("run", `seed-${i}:2026-11-12T00:00:00.000Z:manual:${i}`)).toMatch(SHAPE);
    }
  });

  it("gives the same id for the same seed and different ids for different seeds", () => {
    expect(stableId("tsk", "run-1:0")).toBe(stableId("tsk", "run-1:0"));
    const ids = new Set(Array.from({ length: 2000 }, (_, i) => stableId("tsk", `run-1:${i}`)));
    expect(ids.size).toBe(2000);
  });

  it("builds a random id in the same shape", () => {
    expect(newId("fnd")).toMatch(SHAPE);
  });
});
