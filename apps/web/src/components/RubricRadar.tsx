import { DIMENSIONS, type DimensionId, type DimensionScore } from "@agentswarm/shared";
import { cn } from "../lib/cn";

/**
 * A founder's ten rubric answers as a radar. Distance from the centre is the
 * level (0 to 4). A hollow point at the rim of the inner ring means the
 * evidence does not settle that question; it is never drawn as a zero.
 * Point size carries confidence.
 */
export function RubricRadar({
  breakdown,
  size = 410,
  selected,
  onSelect,
  className,
}: {
  breakdown: readonly DimensionScore[];
  size?: number;
  selected?: DimensionId | null;
  onSelect?: (dimension: DimensionId) => void;
  className?: string;
}) {
  const by = new Map(breakdown.map((b) => [b.dimension, b]));
  const n = DIMENSIONS.length;
  // Wider than tall, so the longest labels on the left and right are never clipped.
  const cx = 205;
  const cy = 150;
  const maxR = 96;
  const step = maxR / 4;

  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const at = (i: number, radius: number) =>
    [cx + radius * Math.cos(angle(i)), cy + radius * Math.sin(angle(i))] as const;

  const answered = DIMENSIONS.map((d, i) => {
    const b = by.get(d.id);
    const level = b?.level ?? null;
    return { d, i, level, confidence: b?.confidence ?? 0 };
  });

  // The shape joins answered questions only, so an unanswered one does not pull it to the centre.
  const shape = answered
    .filter((a) => a.level !== null)
    .map((a) => at(a.i, (a.level as number) * step).map((v) => v.toFixed(1)).join(","))
    .join(" ");

  const summary = answered
    .map((a) => `${a.d.label}: ${a.level === null ? "not settled" : `level ${a.level} of 4`}`)
    .join("; ");

  return (
    <svg
      viewBox="0 0 410 300"
      width={size}
      height={(size * 300) / 410}
      role="img"
      aria-label={`Rubric answers. ${summary}.`}
      className={cn("max-w-full shrink-0", className)}
    >
      {[1, 2, 3, 4].map((ring) => (
        <polygon
          key={ring}
          points={DIMENSIONS.map((_, i) => at(i, ring * step).map((v) => v.toFixed(1)).join(",")).join(" ")}
          fill="none"
          stroke={ring === 4 ? "var(--color-rule-strong)" : "var(--color-rule)"}
          strokeWidth="1"
        />
      ))}
      {DIMENSIONS.map((_, i) => {
        const [x, y] = at(i, maxR);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-rule)" strokeWidth="1" />;
      })}

      {shape ? (
        <polygon
          points={shape}
          fill="var(--color-green-2)"
          fillOpacity="0.16"
          stroke="var(--color-green-2)"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      ) : null}

      {answered.map((a) => {
        const isSelected = selected === a.d.id;
        if (a.level === null) {
          const [x, y] = at(a.i, step * 0.45);
          return (
            <circle
              key={a.d.id}
              cx={x}
              cy={y}
              r="3"
              fill="var(--color-ground)"
              stroke="var(--color-ink-3)"
              strokeWidth="1.25"
              strokeDasharray="1.6 1.6"
            />
          );
        }
        const [x, y] = at(a.i, a.level * step);
        return (
          <circle
            key={a.d.id}
            cx={x}
            cy={y}
            r={2.5 + 2.5 * a.confidence}
            fill={isSelected ? "var(--color-ink)" : "var(--color-green-2)"}
            stroke="var(--color-ground)"
            strokeWidth="1.25"
          />
        );
      })}

      {answered.map((a) => {
        const [x, y] = at(a.i, maxR + 14);
        const cos = Math.cos(angle(a.i));
        const anchor = Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end";
        const isSelected = selected === a.d.id;
        const text = (
          <text
            x={x}
            y={y}
            dy="0.35em"
            textAnchor={anchor}
            fontSize="10.5"
            fontWeight={isSelected ? 700 : 500}
            fill={a.level === null ? "var(--color-ink-3)" : "var(--color-ink)"}
            textDecoration={isSelected ? "underline" : undefined}
          >
            {a.d.label}
          </text>
        );
        if (!onSelect) return <g key={a.d.id}>{text}</g>;
        return (
          <g
            key={a.d.id}
            role="button"
            tabIndex={0}
            aria-label={`Show ${a.d.label}`}
            aria-pressed={isSelected}
            onClick={() => onSelect(a.d.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(a.d.id);
              }
            }}
            className="cursor-pointer outline-none [&:focus-visible>text]:underline"
          >
            {text}
          </g>
        );
      })}
    </svg>
  );
}
