import { Link } from "react-router-dom";
import type { ProviderStatus, SourceStatus, SwarmTreeDTO } from "@agentswarm/shared";
import { Panel, EmptyState } from "../../components/ui/layout";
import { Status } from "../../components/ui/marks";
import { Table, TableScroll, Td, Th, Tr } from "../../components/ui/table";
import { shortRoute } from "../swarm/route";
import { ClassIcon, SourceIcon } from "../../components/icons";

function ConfiguredStatus({ configured }: { configured: boolean }) {
  return configured ? <Status state="ok">Set up</Status> : <Status state="idle">Not set</Status>;
}

/** Model providers and whether each one is set up. Never shows a secret. */
export function ProvidersPanel({ providers }: { providers: ProviderStatus[] }) {
  const configured = providers.filter((p) => p.configured).length;
  return (
    <Panel title="Model providers" aside={`${configured} of ${providers.length}`}>
      <TableScroll>
        <Table>
          <tbody>
            {providers.map((p) => (
              <Tr key={p.id}>
                <Td className="font-bold">{p.label}</Td>
                <Td className="text-right">
                  <ConfiguredStatus configured={p.configured} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </Panel>
  );
}

/** Data sources the agents read from, and whether each one is set up. */
export function SourcesPanel({ sources }: { sources: SourceStatus[] }) {
  const configured = sources.filter((s) => s.configured).length;
  return (
    <Panel title="Data sources" aside={`${configured} of ${sources.length}`}>
      <TableScroll>
        <Table>
          <tbody>
            {sources.map((s) => (
              <Tr key={s.id}>
                <Td className="font-bold">
                  <span className="inline-flex items-center gap-2">
                    <SourceIcon source={s.id} className="size-4 text-ink-2" />
                    {s.label}
                  </span>
                </Td>
                <Td className="text-right">
                  <ConfiguredStatus configured={s.configured} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </Panel>
  );
}

/** Every job's model, with a link to change it on the Swarm page. */
export function ModelsPanel({ tree }: { tree: SwarmTreeDTO }) {
  const jobs = tree.classes.flatMap((c) => c.jobs.map((j) => ({ ...j, cls: c.cls })));
  if (jobs.length === 0) {
    return (
      <Panel title="Models">
        <EmptyState title="No jobs" />
      </Panel>
    );
  }
  return (
    <Panel title="Models" aside={`${jobs.length}`}>
      <TableScroll>
        <Table>
          <tbody>
            {jobs.map((node) => (
              <Tr key={node.job.id}>
                <Td className="font-bold">
                  <span className="inline-flex items-center gap-2">
                    <ClassIcon classId={node.cls.id} className="size-4 text-ink-2" />
                    {node.job.label}
                  </span>
                </Td>
                <Td className="text-ink-2">{node.job.enabled ? shortRoute(node.job.kind, node.route) : "Not enabled"}</Td>
                <Td className="text-right">
                  <Link to={`/swarm?node=job:${node.job.id}`} className="font-bold text-navy hover:underline">
                    Change
                  </Link>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </Panel>
  );
}
