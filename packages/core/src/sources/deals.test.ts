import { describe, expect, it } from "vitest";
import { cutOff, maskText, type PastCase } from "@agentswarm/shared";
import { redactSensitive } from "../jobs";
import { importDealsCsv } from "./deals";

const HEADER = "Company, SEEN, Summary, Outcome, URL, Sector, Stage, Founders, Decision";
const NOW = new Date("2024-01-01T12:00:00.000Z");

describe("past deal imports", () => {
  it("imports valid rows, skips unknown outcomes, refuses invalid rows, and preserves quoted text safely", () => {
    const csv = [
      HEADER,
      'Example Robotics Co,2021-04,"We shipped a working robot, and the founder is 19 years old. The system completed 12 factory pilots.",win,https://example-robotics.invalid,Robotics,Pre-seed,"Ada Sample; Lin Example",invested',
      'Example Cloud Tools,2020-11,"The service processed 8,000 events.",miss,,,Seed,,passed',
      'Example Zero Co,2020-10,"A measured result was 0.4 seconds.",0,,,,,',
      'Example No Co,2018-01,"A smaller customer segment used the tool.",no,,,,,',
      "Example Empty Notes,2020-02,,yes,,,,,passed",
      'Example Bad Date,2020-13,"A dated summary.",yes,,,,,',
      'Example Future Co,2030-01,"A future summary.",no,,,,,',
      'Example Unknown Co,2019-04,"A summary with no outcome.",,,,,,',
      'Example Unclear Co,2019-05,"A summary with an unclear outcome.",maybe,,,,,',
      'Example Multiline Works,2019-02,"We built an offline demo, with two signed pilots.\nThe note called it ""never left the lab"", and the team shipped again.",yes,,,Pre-seed,Seed,"Casey Madeup",passed',
    ].join("\n");

    const result = importDealsCsv(csv, { now: NOW, bar: "our own bar", redact: redactSensitive });

    const table = [
      { line: 2, company: "Example Robotics Co", expected: { status: "imported", outcome: 1 } },
      { line: 3, company: "Example Cloud Tools", expected: { status: "imported", outcome: 0 } },
      { line: 4, company: "Example Zero Co", expected: { status: "imported", outcome: 0 } },
      { line: 5, company: "Example No Co", expected: { status: "imported", outcome: 0 } },
      { line: 6, company: "Example Empty Notes", expected: { status: "refused", reason: "missing required field: summary." } },
      { line: 7, company: "Example Bad Date", expected: { status: "refused", reason: 'unreadable seen date "2020-13" (expected YYYY-MM-DD or YYYY-MM).' } },
      { line: 8, company: "Example Future Co", expected: { status: "refused", reason: "seen date is in the future." } },
      { line: 9, company: "Example Unknown Co", expected: { status: "left out for no outcome" } },
      { line: 10, company: "Example Unclear Co", expected: { status: "left out for no outcome" } },
      { line: 11, company: "Example Multiline Works", expected: { status: "imported", outcome: 1 } },
    ];
    const actual = table.map(({ line, company }) => {
      const pastCase = result.cases.find((item) => item.subject.company === company);
      const refused = result.refused.find((item) => item.line === line);
      if (pastCase) return { line, company, status: "imported", outcome: pastCase.outcome };
      if (refused) return { line, company, status: "refused", reason: refused.reason };
      return { line, company, status: "left out for no outcome" };
    });
    expect(actual).toEqual(table.map(({ line, company, expected }) => ({ line, company, ...expected })));
    expect(result.imported).toBe(5);
    expect(result.leftOutNoOutcome).toBe(2);
    expect(result.refused).toEqual([
      { line: 6, reason: "missing required field: summary." },
      { line: 7, reason: 'unreadable seen date "2020-13" (expected YYYY-MM-DD or YYYY-MM).' },
      { line: 8, reason: "seen date is in the future." },
    ]);
    expect(JSON.stringify(result.refused)).not.toMatch(/Example/);

    const robot = result.cases.find((pastCase) => pastCase.subject.company === "Example Robotics Co");
    expect(robot).toMatchObject({ outcome: 1, cohort: "2021-Q2", asOf: "2021-04-01T00:00:00.000Z" });
    expect(robot?.outcomeSource).toContain("Fund's own deal history, imported on 2024-01-01; success bar: our own bar");
    expect(robot?.evidence[0]?.text).toContain("[removed: personal detail]");
    expect(robot?.evidence[0]?.text).not.toContain("19 years old");

    const cloud = result.cases.find((pastCase) => pastCase.subject.company === "Example Cloud Tools");
    expect(cloud?.outcome).toBe(0);
    const multiline = result.cases.find((pastCase) => pastCase.subject.company === "Example Multiline Works");
    expect(multiline?.evidence[0]?.text).toContain("two signed pilots.\nThe note called it \"never left the lab\"");
  });

  it("uses stable deal ids, updates the same company and date, and cannot collide with a launch id", () => {
    const csv = `${HEADER}\nExample Same Day Co,2021-04-12,"Built and shipped a prototype.",1,,,,,`;
    const launch: PastCase = {
      id: "past_hn_42",
      cohort: "2021-Q2",
      asOf: "2021-04-12T00:00:00.000Z",
      batch: "W21",
      subject: { company: "Example Same Day Co", aliases: [], people: [], domains: [], handles: [] },
      evidence: [],
      outcome: 0,
      outcomeSource: "test launch label",
    };

    const first = importDealsCsv(csv, { existing: [launch], now: NOW, redact: redactSensitive });
    const second = importDealsCsv(csv, { existing: first.cases, now: new Date("2024-01-02T12:00:00.000Z"), redact: redactSensitive });
    const deal = first.cases.find((pastCase) => pastCase.id !== launch.id);

    expect(first.imported).toBe(1);
    expect(first.updated).toBe(0);
    expect(second.imported).toBe(0);
    expect(second.updated).toBe(1);
    expect(second.cases).toEqual(first.cases);
    expect(deal?.id).not.toBe(launch.id);
    expect(deal?.id).toMatch(/^past_deal_/);
  });

  it("keeps investment decisions on cases while omitting them from masked judge evidence", () => {
    for (const decision of ["invested", "passed"] as const) {
      const csv = `${HEADER}\nExample Hidden Decision Co,2021-04,"The company shipped an early product.",yes,,,,"Riley Example",${decision}`;
      const pastCase = importDealsCsv(csv, { now: NOW, redact: redactSensitive }).cases[0]!;
      const maskedJudgeEvidence = cutOff(pastCase).evidence.map((item) => ({
        title: maskText(item.title, pastCase.subject),
        text: maskText(item.text, pastCase.subject),
      }));

      expect(pastCase.decision).toBe(decision);
      expect(JSON.stringify(maskedJudgeEvidence).toLowerCase()).not.toContain(decision);
    }
  });
});
