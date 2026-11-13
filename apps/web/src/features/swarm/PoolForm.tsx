import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { DEFAULT_MODEL_BY_PROVIDER, PROVIDERS, type JobId, type ProviderId } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { Input, Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/overlay";
import { ApiError } from "../../lib/api/http";
import { useSetPool } from "../../lib/queries";
import {
  blankDraft,
  canAddMember,
  modelsFor,
  toSetPoolInput,
  type MemberDraft,
} from "./poolDraft";

const GRID = "grid grid-cols-[7rem_8rem_minmax(0,1fr)_5.5rem_6.5rem_auto] items-center gap-2";

/** A job's pool: one row per member, saved as one list. An empty list removes the pool. */
export function PoolForm({
  swarmId,
  jobId,
  initial,
  onDone,
}: {
  swarmId: string;
  jobId: JobId;
  initial: MemberDraft[];
  onDone: () => void;
}) {
  const save = useSetPool();
  const toast = useToast();
  const [drafts, setDrafts] = useState<MemberDraft[]>(initial);
  const [membersError, setMembersError] = useState<string | null>(null);

  const patch = (key: string, change: Partial<MemberDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...change } : d)));

  function submit() {
    setMembersError(null);
    save.mutate(
      { swarmId, jobId, input: toSetPoolInput(drafts) },
      {
        onSuccess: () => {
          toast.done(drafts.length === 0 ? "Pool removed" : "Pool saved");
          onDone();
        },
        onError: (failure) => {
          const message = failure instanceof ApiError ? failure.fields.members : undefined;
          if (message) setMembersError(message);
          else toast.problem("The pool was not saved", failure.message);
        },
      },
    );
  }

  return (
    <form
      aria-label="Pool"
      className="flex flex-col gap-3 rounded-md border border-rule p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {drafts.length > 0 ? (
        <div className={`${GRID} text-sm font-bold text-ink-3`} aria-hidden>
          <span>Name</span>
          <span>Provider</span>
          <span>Model</span>
          <span>Share</span>
          <span>Status</span>
          <span />
        </div>
      ) : null}

      {drafts.map((draft) => (
        <MemberRow
          key={draft.key}
          draft={draft}
          onChange={(change) => patch(draft.key, change)}
          onRemove={() => setDrafts((prev) => prev.filter((d) => d.key !== draft.key))}
        />
      ))}

      {drafts.length === 0 ? <p className="m-0 text-sm text-ink-3">No pool. The job uses its one model.</p> : null}

      {membersError ? (
        <p role="alert" className="m-0 text-sm font-bold text-red">
          {membersError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {canAddMember(drafts) ? (
          <Button variant="quiet" size="sm" icon={<Plus />} onClick={() => setDrafts((prev) => [...prev, blankDraft(prev)])}>
            Add member
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="quiet" size="sm" onClick={onDone} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" busy={save.isPending} busyLabel="Saving">
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

function MemberRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: MemberDraft;
  onChange: (change: Partial<MemberDraft>) => void;
  onRemove: () => void;
}) {
  const listId = useId();
  const models = modelsFor(draft.provider);

  return (
    <div className={GRID}>
      <Input aria-label="Name" value={draft.id} onChange={(e) => onChange({ id: e.target.value })} />
      <Select
        aria-label="Provider"
        value={draft.provider}
        onChange={(e) => {
          const provider = e.target.value as ProviderId;
          onChange({ provider, model: DEFAULT_MODEL_BY_PROVIDER[provider] ?? "" });
        }}
      >
        {PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
      <div>
        <Input
          aria-label="Model"
          list={listId}
          value={draft.model}
          onChange={(e) => onChange({ model: e.target.value })}
        />
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </datalist>
      </div>
      <span className="flex items-center gap-1">
        <Input
          aria-label="Share"
          inputMode="decimal"
          value={draft.share}
          onChange={(e) => onChange({ share: e.target.value })}
          className="text-right"
        />
        <span className="text-sm text-ink-3">%</span>
      </span>
      <Select
        aria-label="Status"
        value={draft.status}
        onChange={(e) => onChange({ status: e.target.value as MemberDraft["status"] })}
      >
        <option value="active">Active</option>
        <option value="benched">Benched</option>
      </Select>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${draft.id || "member"}`}
        title="Remove"
        className="inline-flex size-7 items-center justify-center rounded-sm text-ink-3 hover:bg-sunk hover:text-ink"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
