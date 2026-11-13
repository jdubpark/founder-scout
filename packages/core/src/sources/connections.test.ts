import { describe, expect, it } from "vitest";
import { looksLikeFounder, parseConnectionsCsv } from "./connections";

describe("parseConnectionsCsv", () => {
  it("finds the header after notes and parses BOM, CRLF, quotes, commas and embedded newlines", () => {
    const csv = "\uFEFFExported from account settings\r\nDownloaded on 13 Nov 2026\r\n" +
      ' first name , LAST NAME , URL , Company , Position , Connected On , Email Address\r\n' +
      'Jane,"Doe, Jr.",https://www.linkedin.com/in/jane,"Acme, Inc.","Co-founder\r\nStealth",13 Nov 2026,jane@example.test\r\n' +
      'Sam,Lee,https://www.linkedin.com/in/sam,"Acme ""Labs""",Engineer,"Nov 13, 2026",sam@example.test\r\n';
    const parsed = parseConnectionsCsv(csv);
    expect(parsed.skipped).toBe(0);
    expect(parsed.contacts).toEqual([
      {
        name: "Jane Doe, Jr.",
        company: "Acme, Inc.",
        position: "Co-founder\r\nStealth",
        profileUrl: "https://www.linkedin.com/in/jane",
        connectedOn: "2026-11-13",
      },
      {
        name: "Sam Lee",
        company: 'Acme "Labs"',
        position: "Engineer",
        profileUrl: "https://www.linkedin.com/in/sam",
        connectedOn: "2026-11-13",
      },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("Email Address");
    expect(JSON.stringify(parsed)).not.toContain("jane@example.test");
    expect(JSON.stringify(parsed)).not.toContain("sam@example.test");
  });

  it("skips rows without names and normalizes all documented date forms", () => {
    const csv = [
      "First Name,Last Name,URL,Company,Position,Connected On",
      ",,https://example.test/empty,,,,",
      "Alex,One,,,,13 Nov 2026",
      'Bea,Two,,,,"Nov 13, 2026"',
      'Cy,Three,,,,"2026-11-13"',
      "Dee,Four,,,,11/13/2026",
      "Eli,Five,,,,not a date",
    ].join("\n");
    const parsed = parseConnectionsCsv(csv);
    expect(parsed.skipped).toBe(1);
    expect(parsed.contacts.map((contact) => contact.connectedOn)).toEqual([
      "2026-11-13", "2026-11-13", "2026-11-13", "2026-11-13", null,
    ]);
  });

  it("throws a plain explanation when the expected header is absent", () => {
    expect(() => parseConnectionsCsv("Name,Email\nJane,jane@example.test\n")).toThrow(
      "This does not look like an exported connections file. Expected columns include First Name, Last Name, URL, Company, Position, and Connected On.",
    );
  });

  it("caps returned contacts and counts remaining rows as skipped", () => {
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
    ["Founder's Office", true],
  ])("classifies %s", (position, expected) => {
    expect(looksLikeFounder(position)).toBe(expected);
  });
});
