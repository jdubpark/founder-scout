import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A titled region of a page. Regions sit on the paper and are separated by a
 * rule above the title; they are not boxes. Use `boxed` only for something
 * that is a separate object on the page, such as a draft to approve.
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
  /** What needs a person here, a count, or the panel's one action. Sits right of the title. */
  aside?: ReactNode;
  children: ReactNode;
  boxed?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "min-w-0",
        boxed ? "border border-rule bg-surface p-4" : "border-t border-rule-strong pt-3",
        className,
      )}
    >
      {title || aside ? (
        <header className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {title ? <h2 className="name-caps text-sm text-ink">{title}</h2> : <span />}
          {aside ? <div className="flex items-center gap-2 text-sm text-ink-3">{aside}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** The heading block at the top of every page. */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  /** One plain sentence saying what this page is for. */
  description?: ReactNode;
  actions?: ReactNode;
  /** Filters or tabs that belong to the whole page. */
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-normal text-ink">{title}</h1>
          {description ? <p className="prose-measure mt-1 text-base text-ink-2">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/** Empty states teach: say what will appear here and how to make it appear. */
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
    <div className={cn("flex flex-col items-start gap-2 border border-dashed border-rule-strong px-4 py-5", className)}>
      <p className="text-base font-semibold text-ink">{title}</p>
      {children ? <div className="prose-measure text-base text-ink-2">{children}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** A problem loading or saving, with what to do about it. */
export function ErrorNote({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 border border-red bg-red-tint px-4 py-3">
      <p className="text-base font-semibold text-red">{title}</p>
      {children ? <div className="prose-measure text-base text-ink">{children}</div> : null}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-[skeleton_1.6s_ease-in-out_infinite] bg-sunk", className)} />;
}

/** Placeholder rows while a list loads, so the layout does not jump. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

/** A label and its value on one line, for definition-style lists. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-4 border-b border-rule py-1.5", className)}>
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="figure m-0 min-w-0 text-right text-base text-ink">{children}</dd>
    </div>
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
        className="relative h-1.5 min-w-12 flex-1 bg-sunk"
      >
        {known ? <div className={cn("absolute inset-y-0 left-0", fill)} style={{ width: `${pct}%` }} /> : null}
        {threshold !== undefined ? (
          <div
            aria-hidden
            className="absolute -inset-y-1 w-px bg-ink"
            style={{ left: `${Math.max(0, Math.min(1, threshold)) * 100}%` }}
          />
        ) : null}
      </div>
      {showFigure ? (
        <span className="figure w-7 shrink-0 text-right text-sm font-semibold text-ink">
          {known ? Math.round(pct) : "—"}
        </span>
      ) : null}
    </div>
  );
}
