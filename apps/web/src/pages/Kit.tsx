import { useState } from "react";
import { Radar, Rocket, ShieldCheck, Users } from "lucide-react";
import { AGENT_CLASSES } from "@agentswarm/shared";
import { FunnelDiagram } from "../components/FunnelDiagram";
import { ClassIcon, DecisionIcon, EvidenceIcon, KindIcon, SourceIcon } from "../components/icons";
import { ScoreDial } from "../components/ScoreDial";
import { SwarmMap, nodeToParam, type SwarmNodeRef } from "../components/SwarmMap";
import { YesNo } from "../components/YesNo";
import { PageHeader, Panel, SkeletonRows } from "../components/ui/layout";
import { StateMark } from "../components/ui/marks";
import { useFounder, useFounders, useOverview, useTree } from "../lib/queries";
import { useSwarm } from "../lib/swarm";

/** A gallery of the shared visuals on live data, for checking them in one place. */
export default function KitPage() {
  const { swarmId } = useSwarm();
  const tree = useTree(swarmId);
  const overview = useOverview(swarmId);
  const founders = useFounders(swarmId ? { swarmId, sort: "composite", limit: 4 } : null);
  const first = founders.data?.rows[0];
  const detail = useFounder(first?.id ?? null);
  const [node, setNode] = useState<SwarmNodeRef>({ kind: "swarm" });

  if (!tree.data || !overview.data) return <SkeletonRows rows={6} />;
  const stats = overview.data.lastRun?.stats ?? null;

  return (
    <>
      <PageHeader title="Shared visuals" />
      <div className="flex flex-col gap-8">
        <Panel title="Swarm map" aside={<span>selected: {nodeToParam(node)}</span>}>
          <SwarmMap tree={tree.data} stats={stats} selected={node} onSelect={setNode} waiting={overview.data.calls.waiting} />
        </Panel>
        <Panel title="Swarm map, compact">
          <SwarmMap tree={tree.data} stats={stats} compact waiting={overview.data.calls.waiting} />
        </Panel>
        <Panel title="Funnel">
          {stats ? (
            <FunnelDiagram
              steps={[
                { id: "leads", label: "Leads", value: stats.leads, icon: <Radar className="size-3.5" aria-hidden /> },
                { id: "founders", label: "Founders", value: stats.newFounders, icon: <Users className="size-3.5" aria-hidden /> },
                { id: "fit", label: "In thesis", value: stats.screenedIn, icon: <ShieldCheck className="size-3.5" aria-hidden /> },
                { id: "dive", label: "Investigated", value: stats.investigated, icon: <Rocket className="size-3.5" aria-hidden /> },
                { id: "surfaced", label: "Surfaced", value: stats.surfaced, tone: "gold", icon: <StateMark state="surfaced" /> },
              ]}
            />
          ) : null}
        </Panel>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <Panel title="Score dials and radar">
            {detail.data?.assessment ? (
              <div className="flex flex-wrap items-center gap-6">
                <div className="grid grid-cols-3 gap-4">
                  <ScoreDial value={detail.data.assessment.composite} label="Overall" threshold={0.58} tone="gold" />
                  <ScoreDial value={detail.data.assessment.cracked} label="Engineering" />
                  <ScoreDial value={detail.data.assessment.founderScore} label="Founder" />
                  <ScoreDial value={detail.data.assessment.fit} label="Thesis fit" threshold={0.55} />
                  <ScoreDial value={detail.data.assessment.coverage} label="Evidence" threshold={0.45} tone="bistre" />
                  <ScoreDial value={null} label="Not known" />
                </div>
              </div>
            ) : null}
          </Panel>
          <Panel title="Yes or no">
            <ul className="m-0 flex list-none flex-col p-0">
              {(founders.data?.rows ?? []).map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-4 border-b border-rule py-2">
                  <span className="name-caps truncate text-sm">{row.name}</span>
                  <YesNo founderId={row.id} verdict={row.feedback} reasons={row.feedbackReasons} />
                </li>
              ))}
            </ul>
            {first ? (
              <div className="mt-4">
                <YesNo founderId={first.id} verdict={first.feedback} reasons={first.feedbackReasons} size="full" />
              </div>
            ) : null}
          </Panel>
        </div>
        <Panel title="Icons">
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-ink-2">
            {AGENT_CLASSES.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5">
                <ClassIcon classId={c.id} /> {c.label}
              </span>
            ))}
            {(["hackernews", "github", "arxiv", "people_data", "web", "call"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <SourceIcon source={s} /> {s}
              </span>
            ))}
            {(["repo", "code_review", "paper", "launch", "talk", "article", "funding", "reference"] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <EvidenceIcon kind={k} /> {k}
              </span>
            ))}
            {(["rule", "opinion", "context", "param"] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <KindIcon kind={k} /> {k}
              </span>
            ))}
            {(["surface", "needs_evidence", "watch", "pass"] as const).map((d) => (
              <span key={d} className="inline-flex items-center gap-1.5">
                <DecisionIcon decision={d} /> {d}
              </span>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
