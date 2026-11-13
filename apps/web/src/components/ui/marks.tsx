import type { ReactNode } from "react";
import { Bot, Briefcase, Globe2, Network, Users } from "lucide-react";
import type { DirectiveKind, NodeHealth, ScopeLevel } from "@agentswarm/shared";
import { cn } from "../../lib/cn";

/**
 * State is a printed mark plus a word, never colour alone:
 *   filled = working or done, hollow = waiting, half = needs attention,
 *   struck = failed, bars = paused, dotted = not enabled yet.
 */
export type MarkState = "ok" | "running" | "idle" | "warn" | "error" | "paused" | "planned" | "surfaced";

const MARK_TONE: Record<MarkState, string> = {
  ok: "text-green-2",
  running: "text-green-2",
  idle: "text-ink-3",
  warn: "text-bistre",
  error: "text-red",
  paused: "text-ink-3",
  planned: "text-ink-3",
  surfaced: "text-gold-ink",
};

export function StateMark({ state, className }: { state: MarkState; className?: string }) {
  const common = { width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": true } as const;
  const cls = cn("shrink-0", MARK_TONE[state], className);
  switch (state) {
    case "ok":
      return (
        <svg {...common} className={cls}>
          <circle cx="5" cy="5" r="4" fill="currentColor" />
        </svg>
      );
    case "running":
      return (
        <svg {...common} className={cn(cls, "animate-[mark-pulse_1.4s_ease-in-out_infinite]")}>
          <circle cx="5" cy="5" r="4" fill="currentColor" />
        </svg>
      );
    case "idle":
      return (
        <svg {...common} className={cls}>
          <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      );
    case "warn":
      return (
        <svg {...common} className={cls}>
          <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <path d="M5 1.5 A3.5 3.5 0 0 1 5 8.5 Z" fill="currentColor" />
        </svg>
      );
    case "error":
      return (
        <svg {...common} className={cls}>
          <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <path d="M2.2 7.8 L7.8 2.2" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      );
    case "paused":
      return (
        <svg {...common} className={cls}>
          <rect x="2" y="1.5" width="2" height="7" fill="currentColor" />
          <rect x="6" y="1.5" width="2" height="7" fill="currentColor" />
        </svg>
      );
    case "planned":
      return (
        <svg {...common} className={cls}>
          <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="1.6 1.6" />
        </svg>
      );
    case "surfaced":
      // The seal: a filled mark with a notched edge.
      return (
        <svg {...common} className={cls}>
          <path
            fill="currentColor"
            d="M5 0.4 6.1 1.5 7.6 1.2 8 2.7 9.4 3.3 8.9 4.8 9.6 6.1 8.4 7 8.4 8.5 6.9 8.6 5.9 9.7 4.7 8.9 3.2 9.4 2.6 8 1.1 7.6 1.4 6.1 0.4 5 1.4 3.9 1.1 2.4 2.6 2 3.2 0.6 4.7 1.1Z"
          />
        </svg>
      );
  }
}

export function Status({
  state,
  children,
  className,
}: {
  state: MarkState;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-ink-2", className)}>
      <StateMark state={state} />
      <span>{children}</span>
    </span>
  );
}

const HEALTH: Record<NodeHealth, { state: MarkState; label: string }> = {
  ok: { state: "ok", label: "Working" },
  warn: { state: "warn", label: "Needs attention" },
  error: { state: "error", label: "Failing" },
  idle: { state: "idle", label: "Has not run yet" },
  paused: { state: "paused", label: "Paused" },
  planned: { state: "planned", label: "Not enabled yet" },
};

export function HealthStatus({ health, className }: { health: NodeHealth; className?: string }) {
  const h = HEALTH[health];
  return (
    <Status state={h.state} className={className}>
      {h.label}
    </Status>
  );
}

export function healthMark(health: NodeHealth): MarkState {
  return HEALTH[health].state;
}

/* ------------------------------------------------------------------ */

type ChipTone = "neutral" | "green" | "gold" | "red" | "bistre";

const CHIP: Record<ChipTone, string> = {
  neutral: "border-rule-strong text-ink-2 bg-surface",
  green: "border-green-3 text-green bg-green-tint",
  gold: "border-gold text-gold-ink bg-gold-tint",
  red: "border-red text-red bg-red-tint",
  bistre: "border-bistre text-bistre bg-bistre-tint",
};

/** A short label attached to a row. Gold means surfaced, red a caution, bistre the watchlist. */
export function Chip({
  tone = "neutral",
  children,
  className,
  title,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap",
        CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The red legend. Used only to say that something is simulated, estimated,
 * unverified or flagged, the way a preliminary prospectus carries its legend.
 */
export function Caution({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs leading-snug font-semibold tracking-[0.04em] text-red uppercase",
        className,
      )}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="mt-[3px] shrink-0">
        <path d="M5 0.8 9.4 9.2H0.6Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5 4v2.4" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="5" cy="7.6" r="0.6" fill="currentColor" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */

const SCOPE_ICON: Record<ScopeLevel, typeof Globe2> = {
  global: Globe2,
  swarm: Network,
  class: Users,
  job: Briefcase,
  agent: Bot,
};

export const SCOPE_NAME: Record<ScopeLevel, string> = {
  global: "Everything",
  swarm: "One swarm",
  class: "A class of agents",
  job: "One job",
  agent: "One agent",
};

/** Where a directive applies, as an icon and the readable scope label. */
export function ScopeLabel({ level, label, className }: { level: ScopeLevel; label: string; className?: string }) {
  const Icon = SCOPE_ICON[level];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-sm text-ink-2", className)}>
      <Icon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

export const KIND_NAME: Record<DirectiveKind, string> = {
  rule: "Rule",
  opinion: "Preference",
  context: "Context",
  param: "Setting",
};

export const KIND_HELP: Record<DirectiveKind, string> = {
  rule: "Always followed. A rule beats a preference.",
  opinion: "Weighed whenever the agent makes a judgment call.",
  context: "A fact the agent can rely on.",
  param: "A number or switch the system applies directly, with no model involved.",
};

/** The kind of a directive. Rules are the only kind drawn solid. */
export function KindChip({ kind }: { kind: DirectiveKind }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1.5 text-xs font-semibold whitespace-nowrap",
        kind === "rule" ? "border-ink bg-ink text-surface" : "border-rule-strong bg-surface text-ink-2",
      )}
    >
      {KIND_NAME[kind]}
    </span>
  );
}
