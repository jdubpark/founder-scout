import { useState } from "react";
import {
  coerceParam,
  getParamDef,
  type EffectiveSteeringDTO,
  type ModelRoute,
  type ParamValue,
  type SwarmTreeDTO,
} from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorNote, SkeletonRows } from "../../components/ui/layout";
import { Chip } from "../../components/ui/marks";
import { useToast } from "../../components/ui/overlay";
import { useCreateDirective, useEffectiveSteering, useUpdateDirective } from "../../lib/queries";
import { formatParamValue, paramLabel } from "../steering/paramText";
import { ParamValueInput, draftFor, type ParamDraft } from "../steering/ParamValueInput";
import { AddAgentForm, AgentControls } from "./AgentTab";
import { attachedHere, effectiveQuery, findNode, nodeScope, type NodeRef } from "./nodes";

type Param = EffectiveSteeringDTO["params"][number];

/** Settings for the selected node, with agent controls above them where they apply. */
export function SettingsTab({ node, swarmId, tree }: { node: NodeRef; swarmId: string; tree: SwarmTreeDTO }) {
  const eff = useEffectiveSteering(effectiveQuery(node, swarmId));
  const create = useCreateDirective();
  const update = useUpdateDirective();
  const toast = useToast();
  const info = findNode(tree, node);

  if (eff.error) return <ErrorNote title="Could not load">{eff.error.message}</ErrorNote>;
  if (!eff.data) return <SkeletonRows rows={5} />;

  const data = eff.data;
  const busy = create.isPending || update.isPending;

  function save(p: Param, overridden: boolean, value: ParamValue) {
    const label = paramLabel(p.key);
    const failed = (error: Error) => toast.problem("Not saved", error.message);
    if (overridden && p.directiveId) {
      update.mutate({ id: p.directiveId, patch: { value } }, { onSuccess: () => toast.done("Saved"), onError: failed });
    } else {
      create.mutate(
        { scope: nodeScope(node, swarmId), kind: "param", key: p.key, value },
        { onSuccess: () => toast.done("Saved", label), onError: failed },
      );
    }
  }

  function reset(p: Param) {
    if (!p.directiveId) return;
    update.mutate(
      { id: p.directiveId, patch: { status: "archived" } },
      { onSuccess: () => toast.done("Reset"), onError: (error) => toast.problem("Not reset", error.message) },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {info?.agent ? <AgentControls node={info.agent} /> : null}
      {info?.job && info.job.job.classId === "scout" && !info.agent ? (
        <AddAgentForm swarmId={swarmId} job={info.job} />
      ) : null}

      {data.params.length === 0 ? (
        <EmptyState title="No settings" />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {data.params.map((p) => {
            const overridden = p.origin === "directive" && p.scope !== null && attachedHere(p.scope, node, swarmId);
            return (
              <ParamRow
                key={p.key}
                param={p}
                route={data.route}
                overriddenHere={overridden}
                busy={busy}
                onSave={(value) => save(p, overridden, value)}
                onReset={() => reset(p)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function routeValueFor(key: string, route: ModelRoute | null): ParamValue | null {
  if (!route) return null;
  if (key === "route.provider") return route.provider;
  if (key === "route.model") return route.model;
  if (key === "route.effort") return route.effort ?? null;
  return null;
}

function ParamRow({
  param,
  route,
  overriddenHere,
  busy,
  onSave,
  onReset,
}: {
  param: Param;
  route: ModelRoute | null;
  overriddenHere: boolean;
  busy: boolean;
  onSave: (value: ParamValue) => void;
  onReset: () => void;
}) {
  const def = getParamDef(param.key);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ParamDraft>("");
  const [error, setError] = useState<string | null>(null);

  const shown = param.value ?? routeValueFor(param.key, route);

  function open() {
    if (def) setDraft(draftFor(def, shown));
    setError(null);
    setEditing(true);
  }

  function save() {
    if (!def) return;
    const checked = coerceParam(def.key, draft);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    onSave(checked.value);
    setEditing(false);
  }

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md px-3 py-2 hover:bg-sunk">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="font-bold text-ink">{param.label}</span>
        <span className="flex items-center gap-2">
          {overriddenHere ? <Chip tone="green">Here</Chip> : null}
          <span className="figure text-base text-ink">{formatParamValue(param.key, shown)}</span>
          {!editing ? (
            <Button size="sm" variant="quiet" onClick={open} disabled={!def}>
              Edit
            </Button>
          ) : null}
        </span>
      </div>

      {editing && def ? (
        <div className="flex flex-col gap-3">
          <ParamValueInput def={def} value={draft} error={error} onChange={(v) => { setDraft(v); setError(null); }} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" busy={busy} busyLabel="Saving" onClick={save}>
              Save
            </Button>
            {overriddenHere ? (
              <Button size="sm" variant="quiet" onClick={() => { onReset(); setEditing(false); }} disabled={busy}>
                Reset
              </Button>
            ) : null}
            <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
