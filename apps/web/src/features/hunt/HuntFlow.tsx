import { ArrowRight, Compass, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { getModel } from "@agentswarm/shared";
import type { HuntDTO } from "@agentswarm/shared";
import { InfoHint } from "../steering/InfoHint";
import { sharePercent } from "./model";

function FlowNode({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-md border border-rule bg-surface p-3 ${className}`}>
      <div className="mb-2 text-sm font-black text-ink">{title}</div>
      {children}
    </div>
  );
}

export function HuntFlow({ hunt }: { hunt: HuntDTO }) {
  const runnerPool = hunt.runners.find((pool) => pool.jobId === "hunt.look");
  const runnerText = runnerPool?.members.length
    ? runnerPool.members.map((member) => `${member.modelLabel} ${sharePercent(member.share)}`)
    : [runnerPool?.route ? getModel(runnerPool.route.model)?.label ?? runnerPool.route.model : "Unknown"];
  const navName = hunt.navigator.route ? getModel(hunt.navigator.route.model)?.label ?? hunt.navigator.route.model : "Unknown";
  const total = hunt.totals;
  const metrics = [
    { label: "Leads", value: total.leads },
    { label: "Kept", value: total.kept },
    { label: "Too late", value: total.tooLate },
    { label: "Dropped", value: total.dropped },
  ];

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-stretch gap-2">
      <FlowNode title="Navigator">
        <div className="flex items-center gap-2 text-sm text-ink-2"><Compass className="size-4 shrink-0 text-navy" aria-hidden /><span className="truncate" title={navName}>{navName}</span></div>
        <div className="figure mt-2 text-sm font-bold text-ink">Turn {hunt.turn}</div>
      </FlowNode>
      <div className="flex items-center justify-center text-ink-3"><ArrowRight className="size-4" aria-hidden /></div>
      <FlowNode title="Runners">
        <div className="flex min-h-6 flex-wrap gap-1">
          {runnerText.map((label) => <span key={label} className="max-w-full truncate rounded-full bg-sunk px-2 py-0.5 text-xs font-bold text-ink-2" title={label}>{label}</span>)}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-2">
          <ShieldCheck className="size-3.5 text-green-2" aria-hidden />
          <span className="figure">{hunt.planted.read} read / {hunt.planted.failed} failed</span>
          <InfoHint text="Planted pages test whether runners follow instructions found on a page." />
        </div>
      </FlowNode>
      <div className="flex items-center justify-center text-ink-3"><ArrowRight className="size-4" aria-hidden /></div>
      <FlowNode title="Web">
        <div className="figure text-sm font-bold text-ink">{total.pages} pages</div>
        <div className="figure mt-1 text-sm text-ink-2">{total.searches} searches</div>
      </FlowNode>
      <div className="flex items-center justify-center text-ink-3"><ArrowRight className="size-4" aria-hidden /></div>
      <FlowNode title="Finds">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {metrics.map((item) => <div key={item.label} className="flex justify-between gap-2 text-xs text-ink-2"><span>{item.label}</span><span className="figure font-bold text-ink">{item.value}</span></div>)}
        </div>
      </FlowNode>
    </div>
  );
}
