import { describe, expect, it } from "vitest";
import { cohortAuc, cutOff, maskText, recognises, walkForwardSplit, type PastEvidence, type PastSubject } from "./past";

const subject: PastSubject = {
  company: "Quillmark Labs",
  aliases: ["Quillmark"],
  people: ["Odric Halversen", "Mirelle Vasquant"],
  domains: ["quillmark.example"],
  handles: ["odrich"],
};

const item = (date: string | null, title = "t"): PastEvidence => ({ kind: "post", source: "hackernews", title, text: "x", date });

describe("cut-off", () => {
  it("keeps only dated items on or before the as-of date, oldest first, and counts what it dropped", () => {
    const result = cutOff({
      asOf: "2018-03-10T00:00:00.000Z",
      evidence: [item("2018-03-10T00:00:00.000Z", "same day"), item("2018-03-11T00:00:00.000Z", "day after"), item(null, "undated"), item("2017-12-01T00:00:00.000Z", "earlier"), item("not a date", "garbled")],
    });
    expect(result.evidence.map((entry) => entry.title)).toEqual(["earlier", "same day"]);
    expect(result.dropped).toBe(3);
  });
});

describe("masking", () => {
  it("removes the company, its people, its sites, its accounts and every year", () => {
    const masked = maskText(
      "Launch: Quillmark (W18). Hi, I'm Odric Halversen and with Mirelle I started QuillmarkLabs in 2017. Odric wrote the engine. See https://quillmark.example/docs or quillmark.example, and ask odrich.",
      subject,
    );
    expect(masked).not.toMatch(/quillmark|odric|halversen|mirelle|vasquant|odrich|2017|W18/i);
    expect(masked).toContain("the company");
    expect(masked).toContain("Founder A");
    expect(masked).toContain("Founder B");
    expect(masked).toContain("[link]");
    expect(masked).toContain("[year]");
    expect(masked).toContain("[batch]");
  });

  it("leaves words that only contain a masked name, and ordinary numbers, alone", () => {
    const masked = maskText("Quillmarkers shipped 2048 builds in 300 days. Model S30 is unrelated to S3 storage.", subject);
    expect(masked).toContain("Quillmarkers");
    expect(masked).toContain("300 days");
    // 2048 is in the range of calendar years, so it is masked: a false alarm is cheaper than a leaked year.
    expect(masked).toContain("[year] builds");
    expect(masked).toContain("S3 storage");
  });
});

describe("recognition", () => {
  it("counts a guess that names the company, an alias or a founder, however it is spelled around it", () => {
    expect(recognises({ company: "I believe this is Quillmark.", people: [] }, subject)).toBe(true);
    expect(recognises({ company: null, people: ["odric  HALVERSEN"] }, subject)).toBe(true);
    expect(recognises({ company: "QUILLMARK LABS, Inc", people: [] }, subject)).toBe(true);
  });

  it("does not count a wrong guess, an empty one, or a first name alone", () => {
    expect(recognises({ company: "Inkwell", people: ["Someone Else"] }, subject)).toBe(false);
    expect(recognises({ company: null, people: [] }, subject)).toBe(false);
    expect(recognises({ company: "unknown", people: ["Odric"] }, subject)).toBe(false);
    expect(recognises({ company: "Quillmarkers", people: [] }, subject)).toBe(false);
  });
});

describe("walk-forward split", () => {
  it("tunes on the earlier cohorts and holds out the later ones", () => {
    expect(walkForwardSplit(["2018-Q2", "2017-Q4", "2018-Q1", "2018-Q3", "2018-Q1"])).toEqual({
      train: ["2017-Q4", "2018-Q1"],
      test: ["2018-Q2", "2018-Q3"],
    });
    expect(walkForwardSplit(["a", "b", "c"])).toEqual({ train: ["a", "b"], test: ["c"] });
    expect(walkForwardSplit(["only"])).toEqual({ train: [], test: [] });
  });
});

describe("ranking within cohorts", () => {
  it("counts pairs inside a cohort only, with a tie as half", () => {
    // Cohort A: winner 0.8 beats 0.5 and 0.3 (2 right of 2). Cohort B: winner 0.4 loses to 0.6
    // and ties 0.4 (0.5 right of 2). Pooled: 2.5 of 4.
    const auc = cohortAuc([
      { cohort: "A", outcome: 1, score: 0.8 },
      { cohort: "A", outcome: 0, score: 0.5 },
      { cohort: "A", outcome: 0, score: 0.3 },
      { cohort: "B", outcome: 1, score: 0.4 },
      { cohort: "B", outcome: 0, score: 0.6 },
      { cohort: "B", outcome: 0, score: 0.4 },
    ]);
    expect(auc).toBe(0.625);
  });

  it("never compares across cohorts, and says so when no cohort holds both outcomes", () => {
    expect(cohortAuc([
      { cohort: "A", outcome: 1, score: 0.1 },
      { cohort: "B", outcome: 0, score: 0.9 },
    ])).toBeNull();
    expect(cohortAuc([])).toBeNull();
  });
});
