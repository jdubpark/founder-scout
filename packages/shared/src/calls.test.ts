import { describe, expect, it } from "vitest";
import { callOpening, isCallTimeAllowed, isE164, redactPhoneNumbers } from "./calls";
import type { OutreachDraft } from "./domain";

describe("call safety helpers", () => {
  it("allows calls only from 09:00 through 19:59 in the recipient's time zone", () => {
    expect(isCallTimeAllowed("America/Chicago", new Date("2026-01-01T14:59:00.000Z"))).toBe(false);
    expect(isCallTimeAllowed("America/Chicago", new Date("2026-01-01T15:00:00.000Z"))).toBe(true);
    expect(isCallTimeAllowed("America/Chicago", new Date("2026-01-02T01:59:00.000Z"))).toBe(true);
    expect(isCallTimeAllowed("America/Chicago", new Date("2026-01-02T02:00:00.000Z"))).toBe(false);
    expect(isCallTimeAllowed("Not/A_Timezone", new Date("2026-01-01T15:00:00.000Z"))).toBe(false);
  });

  it.each([
    ["+14155552671", true],
    ["+123456789012345", true],
    ["+1234567890123456", false],
    ["+1", false],
    ["+0123456789", false],
    ["14155552671", false],
  ])("checks E.164 form for %s", (value, valid) => {
    expect(isE164(value)).toBe(valid);
  });

  it("removes phone-like sequences from text without altering adjacent identifiers", () => {
    expect(redactPhoneNumbers("Call +1 (415) 555-2671 or 415-555-2671; keep ID A1234567."))
      .toBe("Call [removed: phone number] or [removed: phone number]; keep ID A1234567.");
  });

  it("builds the opening from code, draft disclosure and call context", () => {
    const draft: OutreachDraft = {
      subject: null,
      body: null,
      agenda: ["what the founder is building"],
      questions: [],
      disclosure: "I am an AI assistant calling for Northstar Ventures.",
    };
    expect(callOpening(draft, true, "Northstar Ventures", "Ada"))
      .toBe("Hello. This is an AI assistant, not a person, calling for Northstar Ventures. I am an AI assistant calling for Northstar Ventures. Am I speaking with Ada? Is now still a good time to talk? This call is being recorded.");
  });
});
