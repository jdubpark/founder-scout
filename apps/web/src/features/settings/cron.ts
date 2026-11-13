/** Common time zones for the daily run. The saved zone is added to the list if it is not one of these. */
export const TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "America/Los_Angeles", label: "Los Angeles (Pacific)" },
  { value: "America/Denver", label: "Denver (Mountain)" },
  { value: "America/Chicago", label: "Chicago (Central)" },
  { value: "America/New_York", label: "New York (Eastern)" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris and Berlin" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Tokyo", label: "Tokyo" },
];

/** "06:30" becomes the five-field cron "30 6 * * *". Returns null for anything that is not a clock time. */
export function dailyCron(time: string): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${minute} ${hour} * * *`;
}

/** The reverse of dailyCron. Returns null when the saved schedule is a pattern that is not a plain daily time. */
export function timeFromCron(cron: string): string | null {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron.trim());
  if (!match) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function zoneOptions(saved: string): ReadonlyArray<{ value: string; label: string }> {
  return TIMEZONES.some((z) => z.value === saved) ? TIMEZONES : [...TIMEZONES, { value: saved, label: saved }];
}
