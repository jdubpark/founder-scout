import type { OutreachDraft } from "./domain";

export const CALLS_PER_DAY = 5;

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

export function callOpening(draft: OutreachDraft, recording: boolean): string {
  return [
    draft.disclosure,
    "Is now still a good time to talk?",
    ...(recording ? ["This call is being recorded."] : []),
  ].join(" ");
}

export function callInstructions(draft: OutreachDraft): string {
  return [
    "Ask only about this approved agenda and these questions.",
    `Agenda: ${draft.agenda.join("; ") || "No additional agenda."}`,
    `Questions: ${draft.questions.join("; ") || "No additional questions."}`,
    "Never ask about personal attributes.",
    "If the person declines or asks to stop, end the call politely at once.",
    "End after at most 15 minutes.",
  ].join(" ");
}
