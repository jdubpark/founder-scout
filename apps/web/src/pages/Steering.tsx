import { useSearchParams } from "react-router-dom";
import type { DirectiveStatus } from "@agentswarm/shared";
import { EmptyState, ErrorNote, PageHeader, Panel, SkeletonRows } from "../components/ui/layout";
import { Segmented, type SegmentedOption } from "../components/ui/Field";
import { Composer } from "../features/steering/Composer";
import { MessageRow } from "../features/steering/MessageRow";
import { SuggestionsPanel } from "../features/steering/SuggestionsPanel";
import { useDirectives, useTree } from "../lib/queries";
import { useSwarm } from "../lib/swarm";

const STATUSES: DirectiveStatus[] = ["active", "paused", "archived"];

const STATUS_OPTIONS: ReadonlyArray<SegmentedOption<DirectiveStatus>> = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
];

export default function SteeringPage() {
  const { swarmId } = useSwarm();
  const tree = useTree(swarmId);
  const [params, setParams] = useSearchParams();
  const raw = params.get("status");
  const status: DirectiveStatus = STATUSES.includes(raw as DirectiveStatus) ? (raw as DirectiveStatus) : "active";
  const rows = useDirectives({ swarmId: swarmId ?? undefined, status }, Boolean(swarmId));

  return (
    <>
      <PageHeader title="Steering" />

      <div className="flex flex-col gap-6">
        {swarmId ? <SuggestionsPanel swarmId={swarmId} /> : null}

        <Panel
          aside={
            <Segmented
              label="Status"
              value={status}
              onChange={(v) =>
                setParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    if (v === "active") next.delete("status");
                    else next.set("status", v);
                    return next;
                  },
                  { replace: true },
                )
              }
              options={STATUS_OPTIONS}
            />
          }
        >
          {rows.error ? (
            <ErrorNote title="Could not load">{rows.error.message}</ErrorNote>
          ) : !rows.data ? (
            <SkeletonRows rows={4} />
          ) : rows.data.length === 0 ? (
            <EmptyState title="No messages" />
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {rows.data.map((row) => (
                <MessageRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </Panel>

        {tree.data ? (
          <Composer tree={tree.data} />
        ) : tree.error ? (
          <ErrorNote title="Could not load">{tree.error.message}</ErrorNote>
        ) : (
          <SkeletonRows rows={2} />
        )}
      </div>
    </>
  );
}
