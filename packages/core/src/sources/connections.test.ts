import { describe, expect, it } from "vitest";
import { looksLikeFounder, parseConnectionsCsv } from "./connections";

describe("parseConnectionsCsv", () => {
  it("maps partner-owned contact fields, dates and no email address", () => {
    const csv = "\uFEFFExported from account settings\r\nDownloaded on 13 Nov 2026\r\n" +
      " first name , LAST NAME , URL , Company , Position , Connected On , Email Address\r\n" +
      'Jane,"Doe, Jr.",https://www.linkedin.com/in/jane,"Acme, Inc.","Co-founder\r\nStealth",13 Nov 2026,jane@example.test\r\n' +
      'Sam,Lee,https://www.linkedin.com/in/sam,"Acme ""Labs""",Engineer,"Nov 13, 2026",sam@example.test\r\n' +
      "Cy,Three,,,,2026-11-13,cy@example.test\r\n" +
      "Dee,Four,,,,11/13/2026,dee@example.test\r\n" +
      ",,https://example.test/empty,,,,ignored@example.test\r\n";
    const parsed = parseConnectionsCsv(csv);
    expect(parsed.skipped).toBe(1);
    expect(parsed.contacts).toEqual([
      { name: "Jane Doe, Jr.", company: "Acme, Inc.", position: "Co-founder\r\nStealth", profileUrl: "https://www.linkedin.com/in/jane", connectedOn: "2026-11-13" },
      { name: "Sam Lee", company: 'Acme "Labs"', position: "Engineer", profileUrl: "https://www.linkedin.com/in/sam", connectedOn: "2026-11-13" },
      { name: "Cy Three", company: null, position: null, profileUrl: null, connectedOn: "2026-11-13" },
      { name: "Dee Four", company: null, position: null, profileUrl: null, connectedOn: "2026-11-13" },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("Email Address");
    expect(JSON.stringify(parsed)).not.toMatch(/(?:jane|sam|cy|dee|ignored)@example\.test/);
  });

  it("rejects input without the required columns and caps returned contacts", () => {
    expect(() => parseConnectionsCsv("Name,Email\nJane,jane@example.test\n")).toThrow(
      "This does not look like an exported connections file. Expected columns include First Name, Last Name, URL, Company, Position, and Connected On.",
    );
    const rows = ["First Name,Last Name", ...Array.from({ length: 30_002 }, (_, index) => `Name${index},Person`)].join("\n");
    const parsed = parseConnectionsCsv(rows);
    expect(parsed.contacts).toHaveLength(30_000);
    expect(parsed.skipped).toBe(2);
  });
});

describe("looksLikeFounder", () => {
  it.each([
    ["Founder", true],
    ["Co-Founder & CEO", true],
    ["cofounder", true],
    ["Founding Engineer", true],
    ["Stealth startup", true],
    ["Building something new", true],
    ["Working on something new", true],
    ["VP of Engineering", false],
    [null, false],
    [undefined, false],
    ["Founder in Residence", true],
    ["Founder's Office", false],
    ["Founder’s Office", false],
    ["Founders Office", false],
    ["Founder Associate", false],
    ["Office of the Founder", false],
    ["Chief of Staff to the Founder", false],
    ["Executive Assistant to the Co-Founders", false],
    ["Co-founder, formerly Chief of Staff to the Founder", true],
  ])("classifies %s as a founder title: %s", (position, expected) => {
    expect(looksLikeFounder(position)).toBe(expected);
  });
});
