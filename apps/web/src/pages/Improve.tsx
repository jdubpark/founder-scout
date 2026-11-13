import { useNavigate, useParams } from "react-router-dom";
import type { EvalFlowDTO } from "@agentswarm/shared";
import { Segmented } from "../components/ui/Field";
import { Caution } from "../components/ui/marks";
import { EmptyState, ErrorNote, Fact, PageHeader, Panel, SkeletonRows } from "../components/ui/layout";
import { useEvalFlow, useEvalFlows } from "../lib/queries";
import { useSwarm } from "../lib/swarm";
import { ContaminationFacts } from "../features/improve/ContaminationFacts";
import { LoopDiagram } from "../features/improve/LoopDiagram";
import { RoundChart } from "../features/improve/RoundChart";
import { RoundsTable } from "../features/improve/RoundsTable";
import { score } from "../features/improve/variants";
import { RunRound } from "../features/improve/RunRound";
import { baselineOf, rangeLabel } from "../features/improve/runPlan";

export default function ImprovePage() {
  const { flowId } = useParams();
  const navigate = useNavigate();
  const { swarm } = useSwarm();
  const flows = useEvalFlows();
  const selectedId = flowId ?? flows.data?.[0]?.id ?? null;
  const flow = useEvalFlow(selectedId, swarm?.id);

  const header = (
    <PageHeader
      title="Improve"
      actions={
        flow.data ? <RunRound flow={flow.data} /> : null
      }
    >
      {flows.data && flows.data.length > 1 ? (
        <Segmented
          label="Eval"
          value={selectedId ?? flows.data[0]?.id ?? ""}
          onChange={(id) => navigate(`/improve/${id}`)}
          options={flows.data.map((f) => ({ value: f.id, label: f.label }))}
        />
      ) : null}
    </PageHeader>
  );

  if (flows.error) {
    return (
      <>
        {header}
        <ErrorNote title="The evals could not be loaded">{flows.error.message}</ErrorNote>
      </>
    );
  }
  if (!flows.data) {
    return (
      <>
        {header}
        <SkeletonRows rows={8} />
      </>
    );
  }
  if (flows.data.length === 0) {
    return (
      <>
        {header}
        <EmptyState title="No eval yet" />
      </>
    );
  }

  return (
    <>
      {header}
      {flow.error ? (
        <ErrorNote title="This eval could not be loaded">{flow.error.message}</ErrorNote>
      ) : !flow.data ? (
        <SkeletonRows rows={8} />
      ) : (
        <FlowBody flow={flow.data} swarmId={swarm?.id ?? null} swarmConfigId={swarm?.configId ?? null} />
      )}
    </>
  );
}

function FlowBody({ flow, swarmId, swarmConfigId }: { flow: EvalFlowDTO; swarmId: string | null; swarmConfigId: string | null }) {
  const head = flow.headlineMetric;
  const ready = flow.variants.length > 0;
  const baseline = baselineOf(flow.variants);
  const best = flow.variants.find((v) => v.id === flow.bestVariant) ?? null;
  const start = baseline?.test[head] ?? flow.baseline;
  const top = best?.test[head] ?? flow.best;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Panel title={flow.label}>
          <div className="flex flex-col gap-4">
            <Caution>{flow.dataNote}</Caution>
            {ready ? (
              <dl className="m-0 grid grid-cols-4 gap-x-8">
                <Fact label="Start">{score(start)}</Fact>
                <Fact label="Best">{score(top)}</Fact>
                <Fact label="Range">{rangeLabel(best?.testInterval)}</Fact>
                <Fact label="Noise">{flow.noiseFloor !== null ? `±${score(flow.noiseFloor)}` : "—"}</Fact>
              </dl>
            ) : null}
            {flow.contamination ? <ContaminationFacts report={flow.contamination} /> : null}
          </div>
        </Panel>
        <Panel title="Loop">
          <LoopDiagram />
        </Panel>
      </div>

      {ready ? (
        <>
          <Panel title="Rounds">
            <RoundChart flow={flow} swarmConfigId={swarmConfigId} />
          </Panel>
          <Panel>
            {swarmId ? (
              <RoundsTable flow={flow} swarmId={swarmId} swarmConfigId={swarmConfigId} />
            ) : (
              <EmptyState title="No swarm selected" />
            )}
          </Panel>
        </>
      ) : (
        <EmptyState title="No rounds yet" />
      )}
    </div>
  );
}
