import { describe, expect, it } from "vitest";
import type { AssumptionRow, SeparationStat } from "@agentswarm/shared";
import { BAR_WIDTH, barGeometry, barLabel, barX, countByStatus, differs, groupByArea } from "./model";

const row = (over: Partial<AssumptionRow>): AssumptionRow => ({ id: "x", area: "method", status: "untested", calls: null, ...over }) as AssumptionRow;

const stat = (over: Partial<SeparationStat>): SeparationStat => ({ n: 69, positives: 30, value: 0.62, low: 0.48, high: 0.75, ...over });

describe("assumption counts", () => {
  it("counts each status, with zeros for the ones not present", () => {
    const counts = countByStatus([row({ status: "supported" }), row({ status: "supported" }), row({ status: "against" }), row({ status: "untested" })]);
    expect(counts).toEqual({ supported: 2, against: 1, open: 0, untested: 1 });
  });
});

describe("assumption grouping", () => {
  it("keeps the fixed area order and drops areas with no rows", () => {
    const groups = groupByArea([row({ id: "a", area: "method" }), row({ id: "b", area: "objective" }), row({ id: "c", area: "method" })]);
    expect(groups.map((g) => g.id)).toEqual(["objective", "method"]);
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("partner calls against outcomes", () => {
  it("differs when both sides have a verdict and they are not the same", () => {
    expect(differs({ status: "supported", calls: "against" })).toBe(true);
    expect(differs({ status: "open", calls: "supported" })).toBe(true);
  });

  it("does not differ when they agree, when calls are absent, or when either side is untested", () => {
    expect(differs({ status: "supported", calls: "supported" })).toBe(false);
    expect(differs({ status: "supported", calls: null })).toBe(false);
    expect(differs({ status: "untested", calls: "supported" })).toBe(false);
    expect(differs({ status: "supported", calls: "untested" })).toBe(false);
  });
});

describe("evidence bar geometry", () => {
  it("places the dot at the value and the band from low to high", () => {
    const geometry = barGeometry(stat({}));
    expect(geometry.value).toBe(0.62);
    expect(geometry.band).toEqual([0.48, 0.75]);
    expect(barX(0.5)).toBe(BAR_WIDTH / 2);
  });

  it("clamps values and band ends to the track", () => {
    const geometry = barGeometry(stat({ value: 1.2, low: -0.1, high: 1.4 }));
    expect(geometry.value).toBe(1);
    expect(geometry.band).toEqual([0, 1]);
    expect(barX(-3)).toBe(0);
    expect(barX(3)).toBe(BAR_WIDTH);
  });

  it("draws no band when the interval is unknown and no dot when there is no value", () => {
    expect(barGeometry(stat({ low: null, high: null })).band).toBeNull();
    expect(barGeometry(stat({ value: null })).value).toBeNull();
  });

  it("is an empty track when there is no statistic", () => {
    expect(barGeometry(null)).toEqual({ value: null, band: null, thin: false });
    expect(barGeometry(undefined)).toEqual({ value: null, band: null, thin: false });
  });

  it("draws a figure the ledger will not read as a hollow dot with no band", () => {
    // Twenty cases with four winners: fewer than five of one kind, so the row is Untested.
    const few = stat({ value: 0.23, low: 0, high: 0.56, n: 20, positives: 4 });
    expect(barGeometry(few)).toEqual({ value: 0.23, band: null, thin: true });
    expect(barLabel("Past companies", few)).toBe("Past companies: 23% on 20 cases, too few to judge");
    // Five of each kind is the least the ledger reads.
    expect(barGeometry(stat({ n: 10, positives: 5 })).thin).toBe(false);
  });

  it("labels the bar for a screen reader", () => {
    expect(barLabel("Past companies", stat({}))).toBe("Past companies: 62%, range 48% to 75%, 69 cases");
    expect(barLabel("Past companies", null)).toBe("Past companies: no evidence");
  });
});
