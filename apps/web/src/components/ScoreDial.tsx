import { cn } from "../lib/cn";

const TONE = {
  green: "var(--color-green-2)",
  gold: "var(--color-gold)",
  bistre: "var(--color-bistre)",
} as const;

/**
 * One 0 to 100 score as a half-circle gauge with the figure inside. `threshold`
 * draws the bar the score has to reach as a tick on the arc.
 */
export function ScoreDial({
  value,
  label,
  threshold,
  tone = "green",
  size = 76,
  className,
}: {
  /** 0..1, or null when not known. */
  value: number | null;
  label: string;
  /** 0..1 */
  threshold?: number;
  tone?: keyof typeof TONE;
  size?: number;
  className?: string;
}) {
  const known = value !== null && Number.isFinite(value);
  const v = known ? Math.max(0, Math.min(1, value as number)) : 0;
  const figure = known ? String(Math.round(v * 100)) : "—";

  // A half circle from the left (0) over the top to the right (1).
  const r = 32;
  const cx = 40;
  const cy = 40;
  const point = (t: number, radius = r) => {
    const angle = Math.PI * (1 - t);
    return [cx + radius * Math.cos(angle), cy - radius * Math.sin(angle)] as const;
  };
  const [ex, ey] = point(v);
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  const track = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  const tick =
    threshold === undefined
      ? null
      : (() => {
          const t = Math.max(0, Math.min(1, threshold));
          const [x1, y1] = point(t, r - 6);
          const [x2, y2] = point(t, r + 6);
          return { x1, y1, x2, y2 };
        })();

  return (
    <figure
      className={cn("m-0 flex flex-col items-center gap-0.5", className)}
      role="img"
      aria-label={`${label}: ${known ? `${figure} out of 100` : "not known"}${
        threshold !== undefined ? `. The bar is ${Math.round(threshold * 100)}.` : ""
      }`}
    >
      <svg width={size} height={size * 0.62} viewBox="0 0 80 50" aria-hidden>
        <path d={track} fill="none" stroke="var(--color-sunk)" strokeWidth="7" />
        {known && v > 0 ? <path d={arc} fill="none" stroke={TONE[tone]} strokeWidth="7" /> : null}
        {tick ? (
          <line x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} stroke="var(--color-ink)" strokeWidth="1.5" />
        ) : null}
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fontSize="19"
          fontWeight="600"
          fill="var(--color-ink)"
          style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
        >
          {figure}
        </text>
      </svg>
      <figcaption className="text-xs font-medium text-ink-2">{label}</figcaption>
    </figure>
  );
}
