import { CartesianGrid, Label, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FunnelDay } from "@agentswarm/shared";
import { count, dateShort } from "../../lib/format";
import { ChartTable } from "./ChartTable";

/** Four series, each a fixed colour that means the same thing everywhere: gold is surfaced only. */
export const FUNNEL_SERIES: ReadonlyArray<{ key: string; label: string; color: string; dash?: string }> = [
  { key: "leads", label: "Leads", color: "var(--color-green-2)" },
  { key: "screenedIn", label: "Screened in", color: "var(--color-bistre)" },
  { key: "investigated", label: "Investigated", color: "var(--color-navy)" },
  { key: "surfaced", label: "Surfaced", color: "var(--color-gold)" },
] as const;

const AXIS = { fill: "var(--color-ink-3)", fontSize: 12 };

export function FunnelChart({ days }: { days: FunnelDay[] }) {
  const data = days.map((d) => ({ ...d, label: dateShort(d.date) }));

  return (
    <div className="min-w-0">
      <div className="h-72 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-rule)" />
            <XAxis
              dataKey="label"
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: "var(--color-rule-strong)" }}
              minTickGap={16}
            >
              <Label value="Day" position="insideBottom" offset={-2} style={{ fill: "var(--color-ink-3)", fontSize: 12 }} />
            </XAxis>
            <YAxis
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              width={72}
              allowDecimals={false}
            >
              <Label
                value="Founders"
                angle={-90}
                position="insideLeft"
                offset={12}
                style={{ fill: "var(--color-ink-3)", fontSize: 12, textAnchor: "middle" }}
              />
            </YAxis>
            <Tooltip
              cursor={{ stroke: "var(--color-rule-strong)" }}
              contentStyle={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-rule-strong)",
                borderRadius: 2,
                fontSize: 12,
                color: "var(--color-ink)",
              }}
              labelStyle={{ color: "var(--color-ink)", fontWeight: 600 }}
            />
            <Legend
              verticalAlign="top"
              align="left"
              iconType="plainline"
              wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
              formatter={(value: string) => <span style={{ color: "var(--color-ink-2)" }}>{value}</span>}
            />
            {FUNNEL_SERIES.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dash}
                dot={{ r: 4, fill: s.color, stroke: "var(--color-surface)", strokeWidth: 2 }}
                activeDot={{ r: 5, fill: s.color, stroke: "var(--color-surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartTable
        caption="Founders a day for the last 14 days, by step"
        rows={data.map((d) => ({ ...d, key: d.date }))}
        columns={[
          { key: "day", label: "Day", cell: (r) => r.label },
          { key: "leads", label: "Leads", cell: (r) => count(r.leads) },
          { key: "screen", label: "Passed screen", cell: (r) => count(r.screenedIn) },
          { key: "inv", label: "Investigated", cell: (r) => count(r.investigated) },
          { key: "surf", label: "Surfaced", cell: (r) => count(r.surfaced) },
        ]}
      />
    </div>
  );
}
