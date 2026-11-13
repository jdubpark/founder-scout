import { describe, expect, it } from "vitest";
import type { Feedback, FeedbackVerdict } from "./domain";
import {
  MAX_CALL_EXAMPLES,
  latestCalls,
  renderCallsBlock,
  suggestSteering,
  summarizeCalls,
  type CallExample,
} from "./feedback";

let seq = 0;
function call(founderId: string, verdict: FeedbackVerdict, reasonTags: string[], minute = ++seq): Feedback {
  return {
    id: `fbk_${founderId}_${minute}`,
    founderId,
    author: "Partner",
    verdict,
    reasonTags,
    note: null,
    createdAt: `2026-11-12T10:${String(minute).padStart(2, "0")}:00Z`,
  };
}

const ctx = { swarmId: "swm_a", current: {}, dismissed: [] as string[] };

describe("latestCalls", () => {
  it("keeps only the most recent call per founder", () => {
    const first = call("fnd_1", "no", ["too_early"], 1);
    const changedMind = call("fnd_1", "yes", ["builder"], 5);
    const other = call("fnd_2", "no", ["outside_thesis"], 3);
    const latest = latestCalls([changedMind, first, other]);
    expect(latest.get("fnd_1")).toBe(changedMind);
    expect(latest.get("fnd_2")).toBe(other);
    expect(latest.size).toBe(2);
  });
});

describe("suggestSteering", () => {
  it("proposes nothing until three recent calls share a reason", () => {
    const two = [call("a", "no", ["outside_thesis"]), call("b", "no", ["outside_thesis"])];
    expect(suggestSteering(two, ctx)).toEqual([]);
  });

  it("turns three 'outside thesis' calls into a higher thesis-fit bar, with the count behind it", () => {
    const calls = ["a", "b", "c"].map((id) => call(id, "no", ["outside_thesis"]));
    const [s] = suggestSteering(calls, ctx);
    // The default bar is 0.55, and the step is 0.10.
    expect(s?.key).toBe("screen.min_fit=0.65");
    expect(s?.directive).toMatchObject({
      scope: { swarmId: "swm_a" },
      kind: "param",
      key: "screen.min_fit",
      value: 0.65,
    });
    expect(s?.because).toContain("3 of your last 3 calls");
    expect(s?.support).toBe(3);
  });

  it("starts from the value in force, not the default", () => {
    const calls = ["a", "b", "c"].map((id) => call(id, "no", ["outside_thesis"]));
    const [s] = suggestSteering(calls, { ...ctx, current: { "screen.min_fit": 0.7 } });
    expect(s?.key).toBe("screen.min_fit=0.8");
  });

  it("does not propose going past a parameter's maximum", () => {
    const calls = ["a", "b", "c"].map((id) => call(id, "yes", ["builder"]));
    // Weights are capped at 5.
    expect(suggestSteering(calls, { ...ctx, current: { "weights.built_hard_things": 5 } })).toEqual([]);
  });

  it("counts a founder once, by their latest call", () => {
    const calls = [
      call("a", "no", ["outside_thesis"], 1),
      call("a", "no", ["outside_thesis"], 2),
      call("a", "no", ["outside_thesis"], 3),
    ];
    expect(suggestSteering(calls, ctx)).toEqual([]);
  });

  it("merges two reasons that point at the same change, keeping the better-supported one", () => {
    const calls = [
      ...["a", "b", "c"].map((id) => call(id, "no", ["not_technical"])),
      ...["d", "e", "f", "g"].map((id) => call(id, "yes", ["builder"])),
    ];
    const builders = suggestSteering(calls, ctx).filter((s) => s.directive.key === "weights.built_hard_things");
    expect(builders).toHaveLength(1);
    expect(builders[0]?.support).toBe(4);
  });

  it("proposes a rule for screeners when partners keep saying a company already raised", () => {
    const calls = ["a", "b", "c"].map((id) => call(id, "no", ["too_late"]));
    const [s] = suggestSteering(calls, ctx);
    expect(s?.directive).toMatchObject({
      scope: { swarmId: "swm_a", classId: "screener" },
      kind: "rule",
    });
    expect(s?.directive.text).toMatch(/priced funding round/);
  });

  it("stops offering a suggestion once it is dismissed, but offers the next step up later", () => {
    const calls = ["a", "b", "c"].map((id) => call(id, "no", ["outside_thesis"]));
    expect(suggestSteering(calls, { ...ctx, dismissed: ["screen.min_fit=0.65"] })).toEqual([]);
    const later = suggestSteering(calls, {
      ...ctx,
      current: { "screen.min_fit": 0.65 },
      dismissed: ["screen.min_fit=0.65"],
    });
    expect(later[0]?.key).toBe("screen.min_fit=0.75");
  });

  it("looks only at the twenty most recent calls", () => {
    const old = ["a", "b", "c"].map((id, i) => call(id, "no", ["outside_thesis"], i + 1));
    const recent = Array.from({ length: 20 }, (_, i) => call(`r${i}`, "yes", [], 10 + i));
    expect(suggestSteering([...old, ...recent], ctx)).toEqual([]);
  });

  it("puts the best-supported suggestion first", () => {
    const calls = [
      ...["a", "b", "c"].map((id) => call(id, "no", ["thin_evidence"])),
      ...["d", "e", "f", "g", "h"].map((id) => call(id, "no", ["outside_thesis"])),
    ];
    expect(suggestSteering(calls, ctx).map((s) => s.directive.key)).toEqual([
      "screen.min_fit",
      "assess.min_coverage",
    ]);
  });
});

describe("renderCallsBlock", () => {
  const example = (n: number, verdict: FeedbackVerdict = "yes"): CallExample => ({
    verdict,
    about: `Company ${n}: a thing`,
    reasonTags: verdict === "yes" ? ["builder"] : ["too_late"],
    note: n === 1 ? "Knows the old team lead" : null,
    at: `2026-11-${String(n).padStart(2, "0")}T00:00:00Z`,
  });

  it("is empty when there are no calls", () => {
    expect(renderCallsBlock([])).toBe("");
  });

  it("lists calls newest first with readable reasons and the partner's own words", () => {
    const block = renderCallsBlock([example(1), example(2, "no")]);
    const lines = block.split("\n");
    expect(lines[2]).toBe("- NO: Company 2: a thing. Why: Already raised");
    expect(lines[3]).toBe("- YES: Company 1: a thing. Why: Exceptional builder; Knows the old team lead");
  });

  it("says the calls are examples, not rules", () => {
    expect(renderCallsBlock([example(1)])).toContain("examples, not rules");
  });

  it("keeps only the most recent calls so the prompt stays short", () => {
    const many = Array.from({ length: 20 }, (_, i) => example(i + 1));
    const listed = renderCallsBlock(many).split("\n").filter((l) => l.startsWith("- "));
    expect(listed).toHaveLength(MAX_CALL_EXAMPLES);
    expect(listed[0]).toContain("Company 20");
  });
});

describe("summarizeCalls", () => {
  it("counts each founder's latest call and ranks the reasons", () => {
    const calls = [
      call("a", "no", ["too_early"], 1),
      call("a", "yes", ["builder"], 2),
      call("b", "yes", ["builder", "speed"], 3),
      call("c", "no", ["outside_thesis"], 4),
    ];
    const summary = summarizeCalls(calls, { called: 3, yes: 2, waiting: 4 });
    expect(summary).toMatchObject({ yes: 2, no: 1, waiting: 4 });
    expect(summary.hitRate).toBeCloseTo(2 / 3, 6);
    expect(summary.topReasons[0]).toEqual({ verdict: "yes", id: "builder", label: "Exceptional builder", count: 2 });
  });

  it("reports no hit rate before any surfaced founder has been called", () => {
    expect(summarizeCalls([], { called: 0, yes: 0, waiting: 5 }).hitRate).toBeNull();
  });
});
