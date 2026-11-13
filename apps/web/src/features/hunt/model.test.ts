import { describe, expect, it } from "vitest";
import type { HuntCall, HuntFind, HuntNote, HuntTrailView } from "@agentswarm/shared";
import { callResult, earlinessSteps, findMark, sharePercent, sortNotes, splitTrails, waveHeights } from "./model";

const trail = (over: Partial<HuntTrailView>): HuntTrailView => ({
  id: "t", huntId: "h", swarmId: "s", name: "Trail", intent: "Intent", status: "open", openedBy: "person", weight: 3,
  pinned: false, stats: { searches: 0, pages: 0, leads: 0, kept: 0, dropped: 0, tooLate: 0, blocked: 0, costUsd: 0 },
  openedAt: "2026-01-01", closedAt: null, closedWhy: null, queued: 0, score: 1, share: 0, ...over,
});

describe("hunt view model", () => {
  it("sorts open trails by score and groups paused and closed trails", () => {
    const grouped = splitTrails([trail({ id: "paused", status: "paused", score: 9 }), trail({ id: "low", score: 1 }), trail({ id: "high", score: 4 }), trail({ id: "closed", status: "closed" })]);
    expect(grouped.open.map((item) => item.id)).toEqual(["high", "low"]);
    expect(grouped.resting.map((item) => item.id)).toEqual(["paused", "closed"]);
  });

  it("sorts notebook notes newest first with a stable id tie break", () => {
    const note = (id: string, createdAt: string) => ({ id, createdAt }) as HuntNote;
    expect(sortNotes([note("a", "2026-01-01"), note("c", "2026-01-02"), note("b", "2026-01-02")]).map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("clamps and labels next-wave shares", () => {
    expect(sharePercent(0.236)).toBe("24%");
    expect(sharePercent(-1)).toBe("0%");
    expect(sharePercent(1.4)).toBe("100%");
  });

  it("marks kept, dropped, and unscreened finds", () => {
    const find = (founderStatus: HuntFind["founderStatus"]) => ({ founderStatus });
    expect(findMark(find("surfaced"))).toBe("kept");
    expect(findMark(find("screened_out"))).toBe("dropped");
    expect(findMark(find("lead"))).toBe("waiting");
    expect(findMark(find(null))).toBe("waiting");
  });

  it("maps earliness to five steps and leaves unknown values blank", () => {
    expect(earlinessSteps(0)).toBe(0);
    expect(earlinessSteps(0.51)).toBe(3);
    expect(earlinessSteps(1)).toBe(5);
    expect(earlinessSteps(null)).toBeNull();
  });

  it("scales wave bars against the largest turn and preserves zeros", () => {
    expect(waveHeights([{ turn: 1, leads: 2 }, { turn: 2, leads: 4 }, { turn: 3, leads: 0 }])).toEqual([
      { turn: 1, leads: 2, height: 24 }, { turn: 2, leads: 4, height: 48 }, { turn: 3, leads: 0, height: 0 },
    ]);
    expect(waveHeights([{ turn: 1, leads: 0 }])[0]?.height).toBe(0);
  });

  it("labels call outcomes including planted pages", () => {
    const call = (over: Partial<HuntCall>) => ({ control: null, result: "ok", leads: 0, queued: 0, ...over }) as HuntCall;
    expect(callResult(call({ control: "passed", result: "empty" }))).toEqual({ kind: "planted", label: "Passed" });
    expect(callResult(call({ control: "failed", leads: 1 }))).toEqual({ kind: "planted", label: "Failed" });
    expect(callResult(call({ result: "blocked" }))).toEqual({ kind: "blocked", label: "Blocked" });
    expect(callResult(call({ leads: 2 }))).toEqual({ kind: "leads", label: "2 leads" });
    expect(callResult(call({ leads: 2, queued: 3 }))).toEqual({ kind: "leads", label: "2 leads, 3 queued" });
    expect(callResult(call({ queued: 1 }))).toEqual({ kind: "queued", label: "1 queued" });
    expect(callResult(call({ result: "failed" }))).toEqual({ kind: "failed", label: "Failed" });
  });
});
