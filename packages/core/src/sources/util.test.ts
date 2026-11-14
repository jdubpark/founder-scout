import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  cleanQueryTerm,
  cleanText,
  isAfterCursor,
  normalizeLimit,
  parseTimeCursor,
  windowStartMs,
} from "./util";

describe("shared source request helpers", () => {
  it.each([
    ["negative", -1, 0],
    ["fractional", 2.9, 2],
    ["NaN", Number.NaN, 0],
    ["infinite", Number.POSITIVE_INFINITY, 0],
  ])("normalizes a %s result limit", (_label, input, expected) => {
    expect(normalizeLimit(input)).toBe(expected);
  });

  it.each([
    ["a valid since date", "2026-11-10T00:00:00Z", Date.parse("2026-11-10T00:00:00Z")],
    ["a missing since date", null, Date.parse("2026-11-11T17:00:00Z")],
    ["an invalid since date", "yesterday", Date.parse("2026-11-11T17:00:00Z")],
  ])("chooses the start of the request window from %s", (_label, since, expected) => {
    expect(windowStartMs(since, Date.parse("2026-11-13T05:00:00Z"))).toBe(expected);
  });

  it("removes quote syntax and control characters from a query term", () => {
    expect(cleanQueryTerm('  open "agent"\\tools\n  ')).toBe("open agent tools");
    expect(cleanQueryTerm(" \u0000 ")).toBeNull();
  });

  it("cleans shared HTML text while preserving paragraph breaks", () => {
    expect(cleanText("First &amp; more.<p>Second &lt;note&gt;."))
      .toBe("First & more.\n\nSecond <note>.");
  });

  it.each([
    ["null", null],
    ["missing fields", {}],
    ["non-finite timestamp", { after: Number.POSITIVE_INFINITY, ids: [] }],
    ["non-string key", { after: 1, ids: ["ok", 2] }],
  ])("rejects a malformed time cursor: %s", (_label, input) => {
    expect(parseTimeCursor(input)).toBeNull();
  });

  it("keeps valid time cursor keys and their timestamp", () => {
    expect(parseTimeCursor({ after: 1_000, ids: ["one", "two"] }))
      .toEqual({ after: 1_000, ids: ["one", "two"] });
  });

  it("advances one timestamp cursor without replaying keys already delivered", () => {
    const cursor = { after: 1_000, ids: ["seen"] };
    expect(isAfterCursor(cursor, 1_000, "seen")).toBe(false);
    expect(isAfterCursor(cursor, 1_000, "new")).toBe(true);
    expect(isAfterCursor(cursor, 999, "older")).toBe(false);
    expect(advanceCursor(cursor, [
      { key: "new", timeMs: 1_000 },
      { key: "new", timeMs: 1_000 },
    ])).toEqual({ after: 1_000, ids: ["new", "seen"] });
  });
});
