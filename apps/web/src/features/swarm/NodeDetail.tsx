import { useState } from "react";
import { Link } from "react-router-dom";
import type { SwarmTreeDTO } from "@agentswarm/shared";
import { Chip } from "../../components/ui/marks";
import { Panel } from "../../components/ui/layout";
import { Tab, TabList, TabPanel, Tabs } from "../../components/ui/overlay";
import { Composer } from "../steering/Composer";
import { useSuggestions } from "../../lib/queries";
import { SettingsTab } from "./SettingsTab";
import { ToldTab } from "./ToldTab";
import { ContextTab, ReadsLine } from "./ContextTab";
import { PoolsTab } from "./PoolsTab";
import { findNode, nodeScope, type NodeRef } from "./nodes";

type TabId = "told" | "settings" | "context" | "pools";

/** The selected node: what it is told, the message box to tell it more, and its settings. */
export function NodeDetail({ tree, node }: { tree: SwarmTreeDTO; node: NodeRef }) {
  const swarmId = tree.swarm.id;
  const info = findNode(tree, node);
  const [tab, setTab] = useState<TabId>("told");
  const suggestions = useSuggestions(swarmId);

  if (!info) return null;

  const suggestionCount = node.kind === "swarm" ? (suggestions.data?.length ?? 0) : 0;

  return (
    <Panel
      title={info.title}
      aside={
        suggestionCount > 0 ? (
          <Link to="/steering" className="inline-flex items-center gap-2">
            <Chip tone="gold">{suggestionCount}</Chip>
          </Link>
        ) : (
          <span className="text-sm text-ink-3">{info.kindLabel}</span>
        )
      }
    >
      {info.job ? <ReadsLine jobId={info.job.job.id} /> : null}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabList label="Node">
          <Tab value="told">Told</Tab>
          <Tab value="settings">Settings</Tab>
          {node.kind === "swarm" ? <Tab value="context">Context</Tab> : null}
          {node.kind === "swarm" ? <Tab value="pools">Pools</Tab> : null}
        </TabList>

        <TabPanel value="told" className="flex flex-col gap-4 pt-4">
          <ToldTab node={node} swarmId={swarmId} />
          <Composer tree={tree} initialScope={nodeScope(node, swarmId)} submitVariant="secondary" />
        </TabPanel>

        <TabPanel value="settings" className="pt-4">
          <SettingsTab node={node} swarmId={swarmId} tree={tree} />
        </TabPanel>

        {node.kind === "swarm" ? (
          <TabPanel value="context" className="pt-4">
            <ContextTab tree={tree} />
          </TabPanel>
        ) : null}

        {node.kind === "swarm" ? (
          <TabPanel value="pools" className="pt-4">
            <PoolsTab tree={tree} swarmId={swarmId} />
          </TabPanel>
        ) : null}
      </Tabs>
    </Panel>
  );
}
