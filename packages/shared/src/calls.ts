import type { OutreachDraft } from "./domain";

export const CALLS_PER_DAY = 5;
const PHONE_SEQUENCE = /(?<![A-Za-z0-9])\+?\d(?:[ \t().-]*\d){6,}(?![A-Za-z0-9])/gu;

/** Removes E.164 and commonly spaced or dashed phone-like sequences of seven or more digits. */
export function redactPhoneNumbers(text: string): string {
  return text.replace(PHONE_SEQUENCE, "[removed: phone number]");
}

export function isE164(value: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(value);
}

export function isCallTimeAllowed(timezone: string, at: Date): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return Number.isInteger(hour) && hour >= 9 && hour < 20;
  } catch {
    return false;
  }
}

export function callOpening(draft: OutreachDraft, recording: boolean, fundName: string, firstName: string): string {
  return [
    `Hello. This is an AI assistant, not a person, calling for ${fundName}.`,
    draft.disclosure,
    `Am I speaking with ${firstName}?`,
    "Is now still a good time to talk?",
    ...(recording ? ["This call is being recorded."] : []),
  ].join(" ");
}

export function callClosing(fundName: string, callbackNumber: string): string {
  return `This call was made for ${fundName}. You can reach us at ${callbackNumber}. Goodbye.`;
}

export function callInstructions(draft: OutreachDraft, fundName: string, firstName: string, callbackNumber: string): string {
  return [
    "Ask only about this approved agenda and the listed questions.",
    `Agenda: ${draft.agenda.join("; ") || "No additional agenda."}`,
    `If the person is not ${firstName}, apologize and end the call at once.`,
    "Never ask about personal attributes.",
    "If the person declines or asks to stop, end the call politely at once.",
    "End after at most 15 minutes.",
    `End with this sentence: ${callClosing(fundName, callbackNumber)}`,
  ].join(" ");
}
