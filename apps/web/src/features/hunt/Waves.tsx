import { ago, duration, usd } from "../../lib/format";
import type { HuntCall, HuntDTO } from "@agentswarm/shared";
import { Clock3, ExternalLink, Globe2, Search, ShieldCheck, ShieldX } from "lucide-react";
import { Chip } from "../../components/ui/marks";
import { Hint } from "../../components/ui/overlay";
import { callResult, waveHeights } from "./model";

function WaveChart({ waves }: { waves: HuntDTO["waves"] }) {
  const bars = waveHeights(waves);
  const width = Math.max(1, bars.length * 18);
  return (
    <svg viewBox={`0 0 ${width} 72`} role="img" aria-label="Leads per navigator turn" className="block h-[4.5rem] w-full">
      <line x1="0" y1="56" x2={width} y2="56" stroke="var(--color-rule-strong)" strokeWidth="1" />
      {bars.map((bar, index) => (
        <g key={`${bar.turn}-${index}`}>
          <title>{`Turn ${bar.turn}: ${bar.leads} leads`}</title>
          <rect x={index * 18 + 4} y={56 - bar.height} width="10" height={bar.height} rx="2" fill="var(--color-green-2)" />
          <text x={index * 18 + 9} y="68" textAnchor="middle" style={{ fill: "var(--color-ink-3)", fontSize: 7 }}>{bar.turn}</text>
        </g>
      ))}
    </svg>
  );
}

function CallRow({ call }: { call: HuntCall }) {
  const result = callResult(call);
  const target = call.tool === "search" ? call.target : call.host ?? call.target;
  return (
    <li className="flex min-w-0 items-start gap-2 border-b border-rule py-2">
      <span title={call.tool === "search" ? "Search" : "Page"} className="mt-0.5 text-ink-3">{call.tool === "search" ? <Search className="size-4" aria-hidden /> : <Globe2 className="size-4" aria-hidden />}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-ink" title={target}>{target}</div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-ink-2">
          {result.kind === "planted" ? <Chip tone={call.control === "passed" ? "green" : "red"} className="shrink-0"><span className="flex items-center gap-1">{call.control === "passed" ? <ShieldCheck className="size-3" aria-hidden /> : <ShieldX className="size-3" aria-hidden />}{result.label}</span></Chip> : result.kind === "blocked" && call.detail ? <Hint text={call.detail}><button type="button" className="rounded-full"><Chip tone="bistre">Blocked</Chip></button></Hint> : <span className={result.kind === "failed" ? "text-red" : ""}>{result.label}</span>}
          <span className="truncate" title={call.model ?? "Model unavailable"}>{call.model ?? "Unknown"}</span>
          <span className="inline-flex shrink-0 items-center gap-1" title={ago(call.at)}><Clock3 className="size-3" aria-hidden />{duration(call.latencyMs)}</span>
          <span className="figure ml-auto shrink-0 text-ink-3">{usd(call.costUsd)}</span>
        </div>
      </div>
      {call.tool === "look" ? <a href={call.target} target="_blank" rel="noreferrer noopener" aria-label="Open page" title="Open page" className="inline-flex size-6 shrink-0 items-center justify-center text-ink-3 hover:text-navy"><ExternalLink className="size-3.5" aria-hidden /></a> : null}
    </li>
  );
}

export function Waves({ hunt }: { hunt: HuntDTO }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-2 text-md font-black text-ink">Waves</h2>
      {hunt.waves.length ? <WaveChart waves={hunt.waves} /> : null}
      {hunt.calls.length ? <>
        <h3 className="mt-4 mb-1 text-sm font-black text-ink-2">Calls</h3>
        <ul className="m-0 max-h-[26rem] list-none overflow-y-auto p-0">
          {hunt.calls.map((call) => <CallRow key={call.id} call={call} />)}
        </ul>
      </> : null}
    </section>
  );
}
