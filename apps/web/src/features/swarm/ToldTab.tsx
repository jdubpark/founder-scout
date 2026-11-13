import { scopeLevel, type ScopeSelector } from "@agentswarm/shared";
import { EmptyState, ErrorNote, SkeletonRows } from "../../components/ui/layout";
import { KindChip, ScopeLabel } from "../../components/ui/marks";
import { useEffectiveSteering } from "../../lib/queries";
import { attachedHere, effectiveQuery, type NodeRef } from "./nodes";

/** The messages that reach this node. Lines from a broader scope carry their scope pill. */
export function ToldTab({ node, swarmId }: { node: NodeRef; swarmId: string }) {
  const eff = useEffectiveSteering(effectiveQuery(node, swarmId));

  if (eff.error) return <ErrorNote title="Could not load">{eff.error.message}</ErrorNote>;
  if (!eff.data) return <SkeletonRows rows={3} />;

  const data = eff.data;
  const scopeById = new Map<string, ScopeSelector>(data.resolved.guidance.map((g) => [g.directiveId, g.scope]));

  return (
    <div className="flex flex-col gap-4">
      {data.guidance.length === 0 ? (
        <EmptyState title="Nothing yet" />
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {data.guidance.map((line) => {
            const scope = scopeById.get(line.directiveId) ?? {};
            const exact = attachedHere(scope, node, swarmId);
            return (
              <li key={line.directiveId} className="flex flex-col gap-1.5 rounded-md px-3 py-2.5 hover:bg-sunk">
                <p className="text-base break-words whitespace-pre-line text-ink">{line.text}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <KindChip kind={line.kind} />
                  {exact ? null : (
                    <span className="inline-flex h-[1.375rem] items-center rounded-full border border-rule bg-surface px-2">
                      <ScopeLabel level={scopeLevel(scope)} label={line.scopeLabel} />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {data.block || data.callsBlock ? (
        <details className="flex flex-col">
          <summary className="cursor-pointer text-sm font-bold text-ink-2 hover:text-ink">Prompt</summary>
          {data.block ? (
            <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-rule bg-sunk p-3 font-mono text-sm break-words whitespace-pre-wrap text-ink">
              {data.block}
            </pre>
          ) : null}
          {data.callsBlock ? (
            <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-rule bg-sunk p-3 font-mono text-sm break-words whitespace-pre-wrap text-ink">
              {data.callsBlock}
            </pre>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
