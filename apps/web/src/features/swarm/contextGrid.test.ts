import { describe, expect, it } from "vitest";
import { CONTEXT_POOLS, type ClassId, type PoolId } from "@agentswarm/shared";
import { CARRIER_LABEL, classReadsPool, contextGrid, crossingLines, poolsForJob } from "./contextGrid";

const CLASSES: ClassId[] = ["navigator", "scout", "runner", "resolver", "screener", "investigator", "company", "verifier", "analyst", "outreach"];

function cell(pool: PoolId, classId: ClassId): boolean {
  const row = contextGrid(CLASSES).find((r) => r.pool.id === pool);
  return row?.cells.find((c) => c.classId === classId)?.filled ?? false;
}

describe("context grid", () => {
  it("has one row per pool, in pool order", () => {
    expect(contextGrid(CLASSES).map((r) => r.pool.id)).toEqual(CONTEXT_POOLS.map((p) => p.id));
  });

  it("fills a cell exactly when a job of that class reads the pool", () => {
    // The analyst class includes assess.company, which reads the company file, so that cell is filled.
    expect(cell("company", "analyst")).toBe(true);
    expect(classReadsPool("analyst", "company")).toBe(true);
    // No scout reads a company file, so the scout column stays empty there.
    expect(cell("company", "scout")).toBe(false);
    // Scouts read source items; analysts never do.
    expect(cell("sources", "scout")).toBe(true);
    expect(cell("sources", "analyst")).toBe(false);
    // The hunt notebook is shared with the navigator and runner, not scouts.
    expect(cell("hunt", "navigator")).toBe(true);
    expect(cell("hunt", "runner")).toBe(true);
    expect(cell("hunt", "scout")).toBe(false);
  });

  it("draws the sealed pools with no dots at all", () => {
    const sealed = CONTEXT_POOLS.filter((p) => p.sealed).map((p) => p.id);
    expect(sealed.length).toBeGreaterThan(0);
    for (const pool of sealed) {
      for (const classId of CLASSES) expect(cell(pool, classId)).toBe(false);
    }
  });
});

describe("pools a job reads", () => {
  it("is empty for a job that calls no model", () => {
    expect(poolsForJob("resolve.identity")).toEqual([]);
  });

  it("always includes steering and learned lines for a model job", () => {
    const pools = poolsForJob("scout.github");
    expect(pools).toContain("steering");
    expect(pools).toContain("lessons");
    expect(pools).toContain("sources");
  });

  it("never includes a sealed pool", () => {
    for (const job of ["scout.github", "assess.memo", "call.debrief", "verify.claims"] as const) {
      for (const pool of poolsForJob(job)) {
        expect(CONTEXT_POOLS.find((p) => p.id === pool)?.sealed).toBe(false);
      }
    }
  });
});

describe("crossing lines", () => {
  it("labels the runner as a carrier", () => {
    expect(CARRIER_LABEL.runners).toBe("Runners");
  });

  it("carry the labels of both pools", () => {
    const lines = crossingLines();
    expect(lines.length).toBeGreaterThan(0);
    const first = lines[0];
    expect(first?.fromLabel).toBe(CONTEXT_POOLS.find((p) => p.id === first?.from)?.label);
    expect(first?.toLabel).toBe(CONTEXT_POOLS.find((p) => p.id === first?.to)?.label);
  });
});
