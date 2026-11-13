import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EvalFlowDTO } from "@agentswarm/shared";
import { inUseVariant, roundLabel, score, statusView } from "./variants";

const AXIS = { fill: "var(--color-ink-3)", fontSize: 12 };
const LINE = "var(--color-green-2)";
const PAPER = "var(--color-surface)";

/**
 * The headline score on held-out founders, round by round. A reverted round is a hollow
 * point with the word "Reverted" and the round in use carries "In use", so neither depends
 * on colour. The table under the chart has every number.
 */
export function RoundChart({ flow, swarmConfigId }: { flow: EvalFlowDTO; swarmConfigId: string | null }) {
  const head = flow.headlineMetric;
  const inUse = inUseVariant(flow, swarmConfigId);
  const rows = flow.variants.map((v) => ({
    key: v.id,
    label: roundLabel(v),
    test: v.test[head] ?? null,
    status: statusView(v, v.id === inUse).label,
    reverted: v.status === "reverted",
    inUse: v.id === inUse,
  }));

  return (
    <div className="h-56 w-full min-w-0" role="img" aria-label={`${flow.label} for each round`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 28, right: 32, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-rule)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--color-rule-strong)" }} padding={{ left: 32, right: 32 }} />
          <YAxis
            domain={[(min: number) => Math.floor((min - 0.02) * 50) / 50, (max: number) => Math.ceil((max + 0.02) * 50) / 50]}
            tickFormatter={(v: number) => v.toFixed(2)}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-rule-strong)" }}
            formatter={(value) => [typeof value === "number" ? score(value) : "—", flow.label]}
            labelFormatter={(label, payload) => {
              const row = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              return row ? `${String(label)}, ${row.status}` : String(label);
            }}
            contentStyle={{ background: PAPER, border: "1px solid var(--color-rule-strong)", borderRadius: 6, fontSize: 12, color: "var(--color-ink)" }}
            labelStyle={{ color: "var(--color-ink)", fontWeight: 700 }}
          />
          <Line
            type="linear"
            dataKey="test"
            stroke={LINE}
            strokeWidth={2.5}
            isAnimationActive={false}
            activeDot={{ r: 6, fill: LINE, stroke: PAPER, strokeWidth: 2 }}
            dot={(p: { cx?: number; cy?: number; index?: number }) => {
              const row = rows[p.index ?? -1];
              const cx = p.cx ?? 0;
              const cy = p.cy ?? 0;
              if (!row) return <g />;
              const word = row.reverted ? "Reverted" : row.inUse ? "In use" : null;
              return (
                <g key={`point-${row.key}`}>
                  {row.reverted ? (
                    <circle cx={cx} cy={cy} r={4.5} fill={PAPER} stroke={LINE} strokeWidth={2} />
                  ) : (
                    <circle cx={cx} cy={cy} r={row.inUse ? 5.5 : 4.5} fill={LINE} stroke={PAPER} strokeWidth={2} />
                  )}
                  {word ? (
                    <text x={cx} y={cy - 12} textAnchor="middle" style={{ fill: "var(--color-ink)", fontSize: 12, fontWeight: 700 }}>
                      {word}
                    </text>
                  ) : null}
                </g>
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
