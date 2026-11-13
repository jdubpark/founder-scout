import { PageHeader, EmptyState, ErrorNote, SkeletonRows } from "../components/ui/layout";
import { useRuns } from "../lib/queries";
import { useSwarm } from "../lib/swarm";
import { isActive } from "../features/activity/labels";
import { RunNow } from "../features/activity/RunNow";
import { RunsTable } from "../features/activity/RunsTable";

export default function ActivityPage() {
  const { swarmId } = useSwarm();
  const runs = useRuns(swarmId);
  const list = runs.data ?? [];
  const running = list.some(isActive);

  return (
    <>
      <PageHeader title="Activity" actions={swarmId ? <RunNow swarmId={swarmId} running={running} /> : null} />

      {runs.error ? (
        <ErrorNote title="Runs could not be loaded">{runs.error.message}</ErrorNote>
      ) : !runs.data ? (
        <SkeletonRows rows={8} />
      ) : list.length === 0 ? (
        <EmptyState title="No runs yet" />
      ) : (
        <RunsTable runs={list} />
      )}
    </>
  );
}
