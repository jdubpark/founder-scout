/** Formatting helpers. Every figure a partner reads goes through one of these. */

const DASH = "—";

/** A 0..1 score shown on a 0..100 scale, which reads more naturally than a decimal. */
export function score100(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return String(Math.round(value * 100));
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `${Math.round(value * 100)}%`;
}

/** Cost in dollars. null means the provider reported none and the model has no confirmed price. */
export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "not priced";
  if (value === 0) return "$0.00";
  if (value < 0.01) return "under $0.01";
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return value.toLocaleString("en-US");
}

export function tokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return rest ? `${m} min ${rest} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** "just now", "12 min ago", "3 h ago", "2 d ago", then a date. */
export function ago(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return DASH;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return DASH;
  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 0) return until(iso, now);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} d ago`;
  return dateShort(iso);
}

/** "in 5 min", "in 3 h", "in 2 d". */
export function until(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return DASH;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return DASH;
  const seconds = Math.round((then - now.getTime()) / 1000);
  if (seconds <= 0) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} d`;
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function dateLong(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** A date and time. Pass `timeZone` to show it in a chosen zone instead of the viewer's own. */
export function dateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  try {
    return d.toLocaleString("en-GB", timeZone ? { ...options, timeZone } : options);
  } catch {
    // An unknown zone name falls back to the viewer's zone rather than breaking the page.
    return d.toLocaleString("en-GB", options);
  }
}

/** "1 lead", "3 leads". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
