import { useState } from "react";
import { Archive, Pause, Pencil, Play } from "lucide-react";
import {
  coerceParam,
  getParamDef,
  type DirectiveRow,
  type ParamValue,
  type UpdateDirectiveInput,
} from "@agentswarm/shared";
import { Avatar } from "../../components/ui/layout";
import { Button, IconButton } from "../../components/ui/Button";
import { Field, Textarea } from "../../components/ui/Field";
import { Caution, Chip, KindChip, ScopeLabel } from "../../components/ui/marks";
import { useToast } from "../../components/ui/overlay";
import { ago } from "../../lib/format";
import { useUpdateDirective } from "../../lib/queries";
import { formatParamValue, paramLabel } from "./paramText";
import { ParamValueInput, draftFor, type ParamDraft } from "./ParamValueInput";

/** One steering message: who wrote it, what it says, where it reaches, and its kind. */
export function MessageRow({ row }: { row: DirectiveRow }) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateDirective();
  const toast = useToast();
  const isSetting = row.kind === "param";
  const archived = row.status === "archived";

  function change(patch: UpdateDirectiveInput, failed: string) {
    update.mutate(
      { id: row.id, patch },
      { onError: (error) => toast.problem(failed, error.message) },
    );
  }

  return (
    <li className="group flex flex-col">
      <div className="flex gap-3 rounded-md px-3 py-2.5 hover:bg-sunk">
        <Avatar name={row.author} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-bold text-ink">{row.author}</span>
            <span className="text-sm text-ink-3">{ago(row.createdAt)}</span>
          </div>
          {isSetting ? (
            <p className="text-base text-ink">
              {paramLabel(row.key ?? "")}{" "}
              <span className="font-bold">{formatParamValue(row.key ?? "", row.value)}</span>
            </p>
          ) : (
            <p className="text-base break-words whitespace-pre-line text-ink">{row.text}</p>
          )}
          {row.problem ? <Caution className="mt-1">{row.problem}</Caution> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex h-[1.375rem] items-center rounded-full border border-rule bg-surface px-2">
              <ScopeLabel level={row.level} label={row.scopeLabel} />
            </span>
            <KindChip kind={row.kind} />
            {row.status === "paused" ? <Chip>Paused</Chip> : null}
          </div>
        </div>

        {!archived ? (
          <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
            {row.status === "active" ? (
              <IconButton label="Pause" disabled={update.isPending} onClick={() => change({ status: "paused" }, "Not paused")}>
                <Pause />
              </IconButton>
            ) : (
              <IconButton label="Resume" disabled={update.isPending} onClick={() => change({ status: "active" }, "Not resumed")}>
                <Play />
              </IconButton>
            )}
            <IconButton label="Edit" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
              <Pencil />
            </IconButton>
            <IconButton label="Archive" disabled={update.isPending} onClick={() => change({ status: "archived" }, "Not archived")}>
              <Archive />
            </IconButton>
          </div>
        ) : null}
      </div>

      {editing && !archived ? <EditMessage row={row} onDone={() => setEditing(false)} /> : null}
    </li>
  );
}

/** Inline editor for a message's text or setting value. */
function EditMessage({ row, onDone }: { row: DirectiveRow; onDone: () => void }) {
  const update = useUpdateDirective();
  const toast = useToast();
  const def = row.kind === "param" && row.key ? getParamDef(row.key) : undefined;
  const [text, setText] = useState(row.text ?? "");
  const [draft, setDraft] = useState<ParamDraft>(def ? draftFor(def, row.value) : "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (row.kind === "param") {
      if (!def) return;
      const checked = coerceParam(def.key, draft);
      if (!checked.ok) {
        setError(checked.error);
        return;
      }
      const value: ParamValue = checked.value;
      update.mutate(
        { id: row.id, patch: { value } },
        { onSuccess: onDone, onError: (e) => toast.problem("Not saved", e.message) },
      );
      return;
    }
    const body = text.trim();
    if (!body) {
      setError("Write something.");
      return;
    }
    update.mutate(
      { id: row.id, patch: { text: body } },
      { onSuccess: onDone, onError: (e) => toast.problem("Not saved", e.message) },
    );
  }

  return (
    <div className="ml-11 mt-1 flex flex-col gap-3 px-3 pb-2">
      {row.kind === "param" && def ? (
        <ParamValueInput def={def} value={draft} error={error} onChange={(v) => { setDraft(v); setError(null); }} />
      ) : (
        <Field label="Text" error={error}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              rows={3}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" busy={update.isPending} busyLabel="Saving" onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
