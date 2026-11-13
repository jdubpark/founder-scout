import { Button } from "../components/ui/Button";
import { EmptyState, ErrorNote, PageHeader, Panel, SkeletonRows } from "../components/ui/layout";
import { Status } from "../components/ui/marks";
import { useToast } from "../components/ui/overlay";
import { useOverview, useHunt, useStartRun } from "../lib/queries";
import { useSwarm } from "../lib/swarm";
import { HuntFlow } from "../features/hunt/HuntFlow";
import { TrailTable } from "../features/hunt/TrailTable";
import { Notebook } from "../features/hunt/Notebook";
import { Finds } from "../features/hunt/Finds";
import { Waves } from "../features/hunt/Waves";

export default function HuntPage() {
  const { swarm, swarmId } = useSwarm();
  const hunt = useHunt(swarmId);
  const overview = useOverview(swarmId);
  const start = useStartRun();
  const toast = useToast();
  const activeRun = Boolean(overview.data?.activeRun);

  async function runNow() {
    if (!swarmId) return;
    try {
      await start.mutateAsync({ swarmId });
      toast.done("Run started");
    } catch (error) {
      toast.problem("Run not started", error instanceof Error ? error.message : undefined);
    }
  }

  const header = (
    <PageHeader title="Hunt" actions={
      <>
        {hunt.data ? <Status state={!hunt.data.enabled ? "paused" : hunt.data.active ? "running" : "idle"}>{!hunt.data.enabled ? "Off" : hunt.data.active ? "Hunting" : "Idle"}</Status> : null}
        <Button variant="primary" onClick={() => void runNow()} busy={start.isPending} disabled={activeRun || !swarmId}>Run now</Button>
      </>
    } />
  );

  if (!swarm) return <>{header}<EmptyState title="No swarm yet" /></>;
  if (hunt.error) return <>{header}<ErrorNote title="The hunt could not be loaded">{hunt.error.message}</ErrorNote></>;
  if (!hunt.data) return <>{header}<SkeletonRows rows={8} /></>;

  return (
    <>
      {header}
      <div className="flex flex-col gap-6">
        <Panel title="Flow">
          <HuntFlow hunt={hunt.data} />
        </Panel>
        <div className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] gap-6">
          <TrailTable hunt={hunt.data} />
          <Notebook notes={hunt.data.notes} swarmId={swarm.id} />
        </div>
        {hunt.data.finds.length || hunt.data.waves.length || hunt.data.calls.length ? <div className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] gap-6">
          {hunt.data.finds.length ? <Finds hunt={hunt.data} /> : null}
          {hunt.data.waves.length || hunt.data.calls.length ? <Waves hunt={hunt.data} /> : null}
        </div> : null}
      </div>
    </>
  );
}
