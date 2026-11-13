/** The improvement loop as four labelled steps and the arrows between them. */
export function LoopDiagram() {
  const W = 212;
  const H = 48;
  const nodes = [
    { x: 4, y: 16, n: "1", label: "Measure" },
    { x: 244, y: 16, n: "2", label: "Find a pattern" },
    { x: 244, y: 120, n: "3", label: "Change one thing" },
    { x: 4, y: 120, n: "4", label: "Keep if held-out improves", keep: true },
  ];
  const arrow = "url(#loop-arrow)";
  return (
    <svg viewBox="0 0 460 184" role="img" aria-label="Loop: measure, find a pattern, change one thing, keep the change only if the held-out half improves" className="block h-auto w-full max-w-xl">
      <defs>
        <marker id="loop-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--color-ink-3)" />
        </marker>
      </defs>
      <g stroke="var(--color-ink-3)" strokeWidth="1.5" fill="none">
        <line x1="216" y1="40" x2="242" y2="40" markerEnd={arrow} />
        <line x1="350" y1="64" x2="350" y2="118" markerEnd={arrow} />
        <line x1="242" y1="144" x2="218" y2="144" markerEnd={arrow} />
        <line x1="110" y1="118" x2="110" y2="66" markerEnd={arrow} />
      </g>
      {nodes.map((node) => (
        <g key={node.n}>
          <rect
            x={node.x}
            y={node.y}
            width={W}
            height={H}
            rx="2"
            fill={node.keep ? "var(--color-green-tint)" : "var(--color-surface)"}
            stroke={node.keep ? "var(--color-green-2)" : "var(--color-rule-strong)"}
            strokeWidth="1.5"
          />
          <text x={node.x + 12} y={node.y + 30} style={{ fill: "var(--color-ink-3)", fontSize: 13, fontWeight: 600 }}>
            {node.n}
          </text>
          <text x={node.x + 30} y={node.y + 30} style={{ fill: "var(--color-ink)", fontSize: 13, fontWeight: 600 }}>
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
