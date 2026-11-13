import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A titled region of a page. Regions are separated by space and a light rule;
 * they are not boxes. Use `boxed` only for something that is a separate
 * object on the page, such as a draft to approve.
 */
export function Panel({
  title,
  aside,
  children,
  boxed = false,
  className,
  id,
}: {
  title?: ReactNode;
  /** A count, or the panel's one action. Never a sentence. */
  aside?: ReactNode;
  children: ReactNode;
  boxed?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("min-w-0", boxed && "rounded-md border border-rule bg-surface p-4", className)}>
      {title || aside ? (
        <header className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {title ? <h2 className="text-md font-black text-ink">{title}</h2> : <span />}
          {aside ? <div className="flex items-center gap-2 text-sm text-ink-3">{aside}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * The heading at the top of every page: the title and its actions. There is
 * deliberately no subtitle. `description` is accepted for compatibility and
 * is not shown; a page should be clear from its content.
 */
export function PageHeader({
  title,
  actions,
  children,
}: {
  title: ReactNode;
  /** Not rendered. Kept so existing callers still compile. */
  description?: ReactNode;
  actions?: ReactNode;
  /** Filters or tabs that belong to the whole page. */
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b border-rule pb-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="min-w-0 text-lg font-black text-ink">{title}</h1>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/** Shown when there is nothing yet: a few words and, at most, one action. */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-2 rounded-md bg-sunk px-4 py-5", className)}>
      <p className="text-base font-bold text-ink">{title}</p>
      {children ? <div className="prose-measure text-base text-ink-2">{children}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** A problem loading or saving, with what to do about it. */
export function ErrorNote({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-red bg-red-tint px-4 py-3">
      <p className="text-base font-bold text-red">{title}</p>
      {children ? <div className="prose-measure text-base text-ink">{children}</div> : null}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-[skeleton_1.6s_ease-in-out_infinite] rounded-sm bg-sunk", className)} />;
}

/** Placeholder rows while a list loads, so the layout does not jump. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/** A label and its value on one line. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-4 border-b border-rule py-2", className)}>
      <dt className="shrink-0 text-base text-ink-2">{label}</dt>
      <dd className="figure m-0 min-w-0 text-right text-base font-bold text-ink">{children}</dd>
    </div>
  );
}

const AVATAR_TONES = [
  "bg-green-tint text-green",
  "bg-blue-tint text-navy",
  "bg-gold-tint text-gold-ink",
  "bg-bistre-tint text-bistre",
  "bg-red-tint text-red",
  "bg-sunk text-ink-2",
] as const;

/** A person or company as a rounded square with initials. The colour is stable for a given name. */
export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? "") + (words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length];
  const dims = size === "sm" ? "size-6 text-2xs" : size === "lg" ? "size-12 text-lg" : "size-9 text-sm";
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-md font-black", dims, tone, className)}
    >
      {initials}
    </span>
  );
}

/**
 * A 0..1 value as a bar with its figure. `threshold` draws the bar a value has
 * to reach, so a reader can see how far above or below it sits.
 */
export function Meter({
  value,
  threshold,
  tone = "green",
  label,
  showFigure = true,
  className,
}: {
  value: number | null;
  threshold?: number;
  tone?: "green" | "gold" | "bistre" | "ink";
  /** Accessible name, for example "Overall score". */
  label: string;
  showFigure?: boolean;
  className?: string;
}) {
  const known = value !== null && Number.isFinite(value);
  const pct = known ? Math.max(0, Math.min(1, value as number)) * 100 : 0;
  const fill = { green: "bg-green-2", gold: "bg-gold", bistre: "bg-bistre", ink: "bg-ink-2" }[tone];
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? Math.round(pct) : undefined}
        aria-valuetext={known ? `${Math.round(pct)} out of 100` : "Not known"}
        className="relative h-2 min-w-12 flex-1 rounded-full bg-sunk"
      >
        {known ? <div className={cn("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: `${pct}%` }} /> : null}
        {threshold !== undefined ? (
          <div
            aria-hidden
            className="absolute -inset-y-1 w-0.5 rounded-full bg-ink"
            style={{ left: `${Math.max(0, Math.min(1, threshold)) * 100}%` }}
          />
        ) : null}
      </div>
      {showFigure ? (
        <span className="figure w-7 shrink-0 text-right text-sm font-bold text-ink">
          {known ? Math.round(pct) : "—"}
        </span>
      ) : null}
    </div>
  );
}
