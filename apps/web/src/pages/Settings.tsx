import { EmptyState, ErrorNote, PageHeader, Panel, SkeletonRows } from "../components/ui/layout";
import { DailyRunPanel } from "../features/settings/DailyRunPanel";
import { EmergencyPanel, OperatorPanel } from "../features/settings/SafetyPanels";
import { NetworkPanel } from "../features/settings/NetworkPanel";
import { SwarmPanel, NewSwarmPanel } from "../features/settings/SwarmPanels";
import { ModelsPanel, ProvidersPanel, SourcesPanel } from "../features/settings/StatusTables";
import { useSettings, useTree } from "../lib/queries";
import { useSwarm } from "../lib/swarm";

export default function SettingsPage() {
  const { swarm, swarmId } = useSwarm();
  const settings = useSettings();
  const tree = useTree(swarmId);

  return (
    <>
      <PageHeader title="Settings" />

      {settings.error ? (
        <ErrorNote title="Settings could not be loaded">{settings.error.message}</ErrorNote>
      ) : !settings.data ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-12">
            <DailyRunPanel dto={settings.data} />
            <EmergencyPanel saved={settings.data.settings.killSwitch} />
            <OperatorPanel saved={settings.data.settings.operatorName} />
            <NetworkPanel />

            {swarm ? (
              <SwarmPanel swarm={swarm} />
            ) : (
              <Panel title="This swarm">
                <EmptyState title="No swarm yet" />
              </Panel>
            )}
            <NewSwarmPanel />
          </div>

          <div className="flex min-w-0 flex-col gap-12">
            <ProvidersPanel providers={settings.data.providers} />
            <SourcesPanel sources={settings.data.sources} />

            {tree.error ? (
              <ErrorNote title="Models in use could not be loaded">{tree.error.message}</ErrorNote>
            ) : tree.data ? (
              <ModelsPanel tree={tree.data} />
            ) : (
              <SkeletonRows rows={4} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
