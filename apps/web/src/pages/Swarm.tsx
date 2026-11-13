import { useSearchParams } from "react-router-dom";
import { Pause, Play } from "lucide-react";
import { SwarmMap } from "../components/SwarmMap";
import { Button } from "../components/ui/Button";
import { ErrorNote, PageHeader, SkeletonRows } from "../components/ui/layout";
import { useToast } from "../components/ui/overlay";
import { NodeDetail } from "../features/swarm/NodeDetail";
import { formatNode, fromMapRef, parseNode, toMapRef, type NodeRef } from "../features/swarm/nodes";
import { useOverview, useStartRun, useTree, useUpdateSwarm } from "../lib/queries";
import { useSwarm } from "../lib/swarm";

export default function SwarmPage() {
  const { swarm, swarmId } = useSwarm();
  const tree = useTree(swarmId);
  const overview = useOverview(swarmId);
  const update = useUpdateSwarm();
  const run = useStartRun();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const node = parseNode(params.get("node"));

  function select(next: NodeRef) {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set("node", formatNode(next));
      return out;
    });
  }

  function togglePause() {
    if (!swarm) return;
    const status = swarm.status === "active" ? "paused" : "active";
    update.mutate(
      { id: swarm.id, patch: { status } },
      { onError: (error) => toast.problem("Not updated", error.message) },
    );
  }

  function runNow() {
    if (!swarm) return;
    run.mutate(
      { swarmId: swarm.id },
      {
        onSuccess: () => toast.done("Run started"),
        onError: (error) => toast.problem("The run did not start", error.message),
      },
    );
  }

  return (
    <>
      <PageHeader
        title={swarm?.name ?? "Swarm"}
        actions={
          swarm ? (
            <>
              <Button
                variant="secondary"
                icon={swarm.status === "active" ? <Pause /> : <Play />}
                busy={update.isPending}
                busyLabel="Saving"
                onClick={togglePause}
              >
                {swarm.status === "active" ? "Pause" : "Resume"}
              </Button>
              <Button
                variant="primary"
                icon={<Play />}
                busy={run.isPending}
                busyLabel="Starting"
                disabled={Boolean(overview.data?.activeRun)}
                onClick={runNow}
              >
                Run now
              </Button>
            </>
          ) : null
        }
      />

      {tree.error ? (
        <ErrorNote title="Could not load">{tree.error.message}</ErrorNote>
      ) : !tree.data ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="flex flex-col gap-6">
          <SwarmMap
            tree={tree.data}
            stats={overview.data?.lastRun?.stats ?? null}
            selected={toMapRef(node)}
            onSelect={(ref) => select(fromMapRef(ref))}
          />
          <NodeDetail key={formatNode(node)} tree={tree.data} node={node} />
        </div>
      )}
    </>
  );
}
