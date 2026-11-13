import { Link, useNavigate } from "react-router-dom";
import { Check, Play, Radar, Users, Filter, Search, Star, X } from "lucide-react";
import type { RunStats } from "@agentswarm/shared";
import { SurfacedAnnouncement } from "../components/SurfacedAnnouncement";
import { FunnelDiagram } from "../components/FunnelDiagram";
import { SwarmMap, nodeToParam } from "../components/SwarmMap";
import type { SwarmNodeRef } from "../components/SwarmMap";
import { Button } from "../components/ui/Button";
import { EmptyState, ErrorNote, PageHeader, Panel, SkeletonRows } from "../components/ui/layout";
import { Status } from "../components/ui/marks";
import { useToast } from "../components/ui/overlay";
import { count } from "../lib/format";
import { useOverview, useStartRun, useTree } from "../lib/queries";
import { useSwarm } from "../lib/swarm";
import { ActiveRunLine } from "../features/overview/ActiveRun";
import { FunnelChart } from "../features/overview/FunnelChart";

function funnelSteps(stats: RunStats) {
  return [
    { id: "leads", label: "Leads", value: stats.leads, icon: <Radar /> },
    { id: "new", label: "New", value: stats.newFounders, icon: <Users /> },
    { id: "screen", label: "Screened", value: stats.screenedIn, icon: <Filter /> },
    { id: "investigated", label: "Investigated", value: stats.investigated, icon: <Search /> },
    { id: "surfaced", label: "Surfaced", value: stats.surfaced, icon: <Star />, tone: "gold" as const },
  ];
}

export default function OverviewPage() {
  const { swarm, swarmId } = useSwarm();
  const overview = useOverview(swarmId);
  const tree = useTree(swarmId);
  const startRun = useStartRun();
  const toast = useToast();
  const navigate = useNavigate();

  if (!swarm) return null;
  const data = overview.data;

  const run = () =>
    startRun.mutate(
      { swarmId: swarm.id },
      {
        onSuccess: () => toast.done("Run started"),
        onError: (e) => toast.problem("The run did not start", e.message),
      },
    );

  const select = (node: SwarmNodeRef) => navigate(`/swarm?node=${nodeToParam(node)}`);

  return (
    <>
      <PageHeader
        title={swarm.name}
        actions={
          <Button
            variant="primary"
            icon={<Play />}
            onClick={run}
            busy={startRun.isPending}
            busyLabel="Starting"
            disabled={Boolean(data?.activeRun)}
          >
            {data?.activeRun ? "Running" : "Run now"}
          </Button>
        }
      />

      {overview.error ? (
        <ErrorNote title="The overview could not be loaded">{overview.error.message}</ErrorNote>
      ) : !data ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="flex flex-col gap-6">
          {data.activeRun ? <ActiveRunLine run={data.activeRun} /> : null}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Panel title="Surfaced" aside={<span>{count(data.topFounders.length)}</span>}>
              <SurfacedAnnouncement rows={data.topFounders} companies={data.topCompanies ?? []} />
            </Panel>

            <Panel title="Needs you">
              <ul className="m-0 flex list-none flex-col p-0">
                <li className="border-b border-rule">
                  <Link to="/founders" className="flex items-center justify-between gap-3 py-2.5 no-underline">
                    <span className="text-base text-ink">Waiting for a call</span>
                    <span className="figure text-xl font-black text-ink">{count(data.calls.waiting)}</span>
                  </Link>
                </li>
                <li className="border-b border-rule">
                  <Link to="/approvals" className="flex items-center justify-between gap-3 py-2.5 no-underline">
                    <span className="text-base text-ink">Approvals</span>
                    <span className="figure text-xl font-black text-ink">{count(data.today.pendingApprovals)}</span>
                  </Link>
                </li>
                <li className="border-b border-rule">
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-base text-ink">Your calls</span>
                    <span className="figure flex items-center gap-3 text-base font-bold text-ink">
                      <span className="inline-flex items-center gap-1" aria-label={`${count(data.calls.yes)} yes`}>
                        <Check className="size-4 text-green-2" strokeWidth={2.5} aria-hidden />
                        {count(data.calls.yes)}
                      </span>
                      <span className="inline-flex items-center gap-1" aria-label={`${count(data.calls.no)} no`}>
                        <X className="size-4 text-ink-3" strokeWidth={2.5} aria-hidden />
                        {count(data.calls.no)}
                      </span>
                    </span>
                  </div>
                </li>
                {data.alerts.map((alert) => (
                  <li key={alert.id} className="border-b border-rule py-2.5 last:border-b-0">
                    <Status state={alert.level === "error" ? "error" : alert.level === "warning" ? "warn" : "idle"}>
                      <span className="text-ink" title={alert.detail}>
                        {alert.title}
                      </span>
                    </Status>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Swarm" className="xl:col-span-2">
              {tree.error ? (
                <ErrorNote title="The swarm could not be loaded">{tree.error.message}</ErrorNote>
              ) : tree.data ? (
                <SwarmMap tree={tree.data} stats={data.lastRun?.stats ?? null} compact onSelect={select} />
              ) : (
                <SkeletonRows rows={4} />
              )}
            </Panel>

            <Panel title="Last run">
              {data.lastRun ? (
                <FunnelDiagram steps={funnelSteps(data.lastRun.stats)} />
              ) : (
                <EmptyState title="No run yet" action={<Button onClick={run} busy={startRun.isPending}>Run now</Button>} />
              )}
            </Panel>

            {/* A trend needs at least two days; before that the funnel above says everything. */}
            {data.funnel.length > 1 ? (
              <Panel title="Last 14 days">
                <FunnelChart days={data.funnel} />
              </Panel>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
