import { describe, expect, it } from "vitest";
import { ASSUMPTIONS, judgeAssumptions, type JudgedCase, type OutcomeEvidence } from "./assumptions";
import { getParamDef } from "./params";

/** Twelve winners and twelve others over two periods. `traction` tracks the outcome, `mission` runs against it, `market` is noise. */
function cases(): JudgedCase[] {
  const noise = [0.5, 0.25, 0.75, 0.5, 0.25, 0.75, 0.75, 0.25, 0.5, 0.5, 0.75, 0.25];
  return Array.from({ length: 24 }, (_, index): JudgedCase => {
    const outcome = (index % 2) as 0 | 1;
    const high = 0.75 + (index % 3) * 0.05;
    const low = 0.25 - (index % 3) * 0.05;
    return {
      group: index < 12 ? "2018-Q1" : "2018-Q2",
      outcome,
      founder: 0.5,
      company: outcome ? high : low,
      deal: outcome ? 0.6 + (index % 3) * 0.02 : 0.4 - (index % 3) * 0.02,
      founderLevels: { built_hard_things: 0.5, technical_depth: index % 4 === 0 ? null : 0.5 },
      companyLevels: { traction: outcome ? high : low, mission: outcome ? low : high, market: noise[Math.floor(index / 2)] ?? 0.5 },
    };
  });
}
const outcomes = (items: JudgedCase[], recognised = 0): OutcomeEvidence => ({ cases: items, basis: "24 past companies", recognised, probed: 30 });
const find = (rows: ReturnType<typeof judgeAssumptions>, id: string) => {
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error(`no assumption ${id}`);
  return row;
};
const judged = (input: Partial<Parameters<typeof judgeAssumptions>[0]> = {}) =>
  judgeAssumptions({ outcomes: outcomes(cases()), calls: [], current: () => null, ...input });

describe("the list of assumptions", () => {
  it("gives every assumption its own id and points only at settings that exist", () => {
    expect(new Set(ASSUMPTIONS.map((item) => item.id)).size).toBe(ASSUMPTIONS.length);
    for (const item of ASSUMPTIONS) {
      if (item.paramKey) expect(getParamDef(item.paramKey), `${item.id} names ${item.paramKey}`).toBeDefined();
    }
  });

  it("holds unstated assumptions as well as stated ones, in every area", () => {
    expect(ASSUMPTIONS.filter((item) => !item.stated).length).toBeGreaterThanOrEqual(7);
    expect(new Set(ASSUMPTIONS.map((item) => item.area))).toEqual(new Set(["objective", "weighing", "founder", "company", "method"]));
  });
});

describe("judging assumptions from evidence", () => {
  it("supports a question that separates winners, counts one that runs the other way against, and leaves noise open", () => {
    const rows = judged();
    expect(find(rows, "company.traction")).toMatchObject({ status: "supported", evidence: { outcomes: { n: 24, positives: 12, value: 1 } } });
    expect(find(rows, "company.mission")).toMatchObject({ status: "against", evidence: { outcomes: { value: 0 } } });
    expect(find(rows, "company.market").status).toBe("open");
    // Every case got the same answer: a tie everywhere is one half, and one half is not support.
    expect(find(rows, "founder.built_hard_things")).toMatchObject({ status: "open", evidence: { outcomes: { value: 0.5 } } });
  });

  it("does not read a comparison with fewer than five of either kind", () => {
    const few = cases().filter((item, index) => item.outcome === 0 || index < 8);
    expect(few.filter((item) => item.outcome === 1)).toHaveLength(4);
    expect(find(judged({ outcomes: outcomes(few) }), "company.traction").status).toBe("untested");
  });

  it("does not call an assumption supported on one real pair padded with one-sided periods", () => {
    const base = cases()[0]!;
    const padded: JudgedCase[] = [
      { ...base, group: "mixed", outcome: 1, companyLevels: { traction: 1 } },
      { ...base, group: "mixed", outcome: 0, companyLevels: { traction: 0 } },
      ...[0, 1, 2, 3].map(() => ({ ...base, group: "winners-only", outcome: 1 as const, companyLevels: { traction: 0.75 } })),
      ...[0, 1, 2, 3].map(() => ({ ...base, group: "others-only", outcome: 0 as const, companyLevels: { traction: 0.75 } })),
    ];
    const row = find(judged({ outcomes: outcomes(padded) }), "company.traction");
    expect(row.evidence.outcomes).toMatchObject({ n: 2, positives: 1, value: 1 });
    expect(row.status).toBe("untested");
  });

  it("reports how often the evidence did not settle a question", () => {
    const row = find(judged(), "founder.technical_depth");
    expect(row.evidence.unknownShare).toBe(0.25);
    expect(row.evidence.outcomes?.n).toBe(18);
  });

  it("is untested with no past cases, and says how an untestable one could be tested", () => {
    const rows = judged({ outcomes: null });
    expect(find(rows, "company.traction")).toMatchObject({ status: "untested", evidence: { outcomes: null } });
    expect(find(rows, "method.memory")).toMatchObject({ status: "untested" });
    expect(find(rows, "method.memory").evidence.detail).toContain("launch after the judging model was trained");
  });

  it("shows the partner's calls beside the outcomes, so a difference between taste and results is visible", () => {
    // The partner says Yes to a clear mission, which on past companies ran against the outcome.
    const calls = cases().map((item) => ({ ...item, group: "calls", outcome: (item.outcome ? 0 : 1) as 0 | 1 }));
    const row = find(judged({ calls }), "company.mission");
    expect(row.status).toBe("against");
    expect(row.calls).toBe("supported");
    expect(find(judged(), "company.mission").calls).toBeNull();
  });

  it("compares the combined score with the better of its two parts", () => {
    const row = find(judged(), "weighing.together");
    expect(row.evidence.detail).toBe("Together 100%, founder alone 50%, company alone 100%. Together against the company alone: 0 points, range 0 to 0.");
    // Equal to the better part is not better than it.
    expect(row.status).toBe("open");
    const flat = cases().map((item) => ({ ...item, deal: 0.5 }));
    const worse = find(judged({ outcomes: outcomes(flat) }), "weighing.together");
    expect(worse.status).toBe("against");
    expect(worse.evidence.detail).toContain("Together against the company alone: -50 points, range -50 to -50.");
    // The combined score beats both parts on every resample.
    const better = cases().map((item) => ({ ...item, company: 0.5 }));
    expect(find(judged({ outcomes: outcomes(better) }), "weighing.together").status).toBe("supported");
  });

  it("checks the real score against shuffled outcomes", () => {
    const row = find(judged(), "method.signal");
    expect(row.status).toBe("supported");
    expect(row.evidence.detail).toMatch(/^Real outcomes 100%\. Shuffled outcomes (4\d|5\d)% on average/);
    const flat = cases().map((item) => ({ ...item, deal: 0.5 }));
    expect(find(judged({ outcomes: outcomes(flat) }), "method.signal").status).toBe("open");
  });

  it("counts any recognised company against the claim that masking hides it", () => {
    expect(find(judged({ outcomes: outcomes(cases(), 3) }), "method.masking")).toMatchObject({
      status: "against",
      evidence: { detail: "The judging model named 3 of 30 masked companies. Those are left out of the headline." },
    });
    expect(find(judged(), "method.masking").status).toBe("open");
  });

  it("reads the share of questions a launch post settled", () => {
    const row = find(judged(), "method.launch");
    // Four of five answers are settled in three cases of four, and all five in the rest.
    expect(row.evidence.detail).toBe("A launch post settled 95% of the rubric questions on average.");
    expect(row.status).toBe("supported");
  });

  it("carries the current value of the setting an assumption lives in", () => {
    const rows = judged({ current: (key) => (key === "deal.team_share" ? "0.6" : null) });
    expect(find(rows, "weighing.together").current).toBe("0.6");
    expect(find(rows, "objective.outcome").current).toBeNull();
  });
});
