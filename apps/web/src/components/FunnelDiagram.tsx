import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface FunnelStep {
  id: string;
  label: string;
  value: number;
  icon?: ReactNode;
  /** Gold is reserved for the surfaced step. */
  tone?: "green" | "gold";
}

/**
 * Counts narrowing through stages, drawn to scale. Bar height follows the
 * square root of the count so a small last stage stays visible; the figures
 * under the bars carry the exact values.
 */
export function FunnelDiagram({ steps, className }: { steps: readonly FunnelStep[]; className?: string }) {
  if (steps.length === 0) return null;
  const max = Math.max(1, ...steps.map((s) => s.value));
  const H = 96;
  const minH = 6;
  const colW = 100 / steps.length;
  // Each bar takes 16% of its column.
  const w = colW * 0.16;
  const height = (v: number) => (v <= 0 ? 0 : Math.max(minH, H * Math.sqrt(v / max)));
  const x = (i: number) => colW * i + colW / 2;

  const summary = steps.map((s) => `${s.label} ${s.value.toLocaleString("en-US")}`).join(", then ");

  return (
    <div className={cn("min-w-0", className)}>
      <svg
        viewBox={`0 0 100 ${H + 4}`}
        preserveAspectRatio="none"
        className="block h-24 w-full"
        role="img"
        aria-label={`Funnel: ${summary}.`}
      >
        {steps.slice(0, -1).map((s, i) => {
          const next = steps[i + 1]!;
          const h1 = height(s.value);
          const h2 = height(next.value);
          const mid = H / 2 + 2;
          const x1 = x(i) + w / 2;
          const x2 = x(i + 1) - w / 2;
          return (
            <polygon
              key={s.id}
              points={`${x1},${mid - h1 / 2} ${x2},${mid - h2 / 2} ${x2},${mid + h2 / 2} ${x1},${mid + h1 / 2}`}
              fill="var(--color-green-tint)"
            />
          );
        })}
        {steps.map((s, i) => {
          const h = height(s.value);
          const mid = H / 2 + 2;
          return (
            <rect
              key={s.id}
              x={x(i) - w / 2}
              y={mid - h / 2}
              width={w}
              height={h}
              rx="1"
              fill={s.tone === "gold" ? "var(--color-gold)" : "var(--color-green-2)"}
            />
          );
        })}
      </svg>
      <ol className="m-0 mt-2 grid list-none p-0" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s) => (
          <li key={s.id} className="flex min-w-0 flex-col items-center gap-0.5 px-1 text-center">
            <span className="figure text-xl font-black text-ink">{s.value.toLocaleString("en-US")}</span>
            <span className="flex min-w-0 items-center gap-1 text-sm font-bold text-ink-2">
              {s.icon}
              <span className="truncate">{s.label}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
