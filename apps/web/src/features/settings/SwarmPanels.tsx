import { useState, type FormEvent } from "react";
import type { Swarm, Thesis } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { Field, Input, Segmented, Textarea } from "../../components/ui/Field";
import { Panel } from "../../components/ui/layout";
import { useToast } from "../../components/ui/overlay";
import { ApiError } from "../../lib/api/http";
import { useCreateSwarm, useUpdateSwarm } from "../../lib/queries";
import { useSwarm } from "../../lib/swarm";
import { InfoHint } from "../steering/InfoHint";

/** Splits "a, b, c" into a clean list. Empty items are dropped. */
function listOf(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const LISTS = [
  { key: "sectors", label: "Sectors" },
  { key: "stages", label: "Stages" },
  { key: "geos", label: "Regions" },
  { key: "avoid", label: "Avoid" },
] as const;

type ListKey = (typeof LISTS)[number]["key"];

/** The current swarm: its name, whether it is active, and its thesis. */
export function SwarmPanel({ swarm }: { swarm: Swarm }) {
  return (
    <Panel title="This swarm" aside={swarm.status === "active" ? "Active" : "Paused"}>
      <SwarmForm key={`${swarm.id}:${swarm.updatedAt}`} swarm={swarm} />
    </Panel>
  );
}

function SwarmForm({ swarm }: { swarm: Swarm }) {
  const update = useUpdateSwarm();
  const toast = useToast();
  const [name, setName] = useState(swarm.name);
  const [status, setStatus] = useState<Swarm["status"]>(swarm.status);
  const [summary, setSummary] = useState(swarm.thesis.summary);
  const [lists, setLists] = useState<Record<ListKey, string>>({
    sectors: swarm.thesis.sectors.join(", "),
    stages: swarm.thesis.stages.join(", "),
    geos: swarm.thesis.geos.join(", "),
    avoid: swarm.thesis.avoid.join(", "),
  });
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name.trim() !== swarm.name ||
    status !== swarm.status ||
    summary.trim() !== swarm.thesis.summary ||
    LISTS.some((l) => lists[l.key] !== swarm.thesis[l.key].join(", "));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    const thesis: Thesis = {
      summary: summary.trim(),
      sectors: listOf(lists.sectors),
      stages: listOf(lists.stages),
      geos: listOf(lists.geos),
      avoid: listOf(lists.avoid),
    };
    update.mutate(
      { id: swarm.id, patch: { name: name.trim(), status, thesis } },
      {
        onSuccess: () => toast.done("Swarm saved"),
        onError: (failure) => toast.problem("The swarm was not saved", failure.message),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-5" noValidate>
      <Field label="Name" error={error}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink">Status</legend>
        <Segmented
          label="Swarm status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Active" },
            { value: "paused", label: "Paused" },
          ]}
        />
      </fieldset>

      <Field label="Thesis">
        {({ id, describedBy }) => (
          <div className="flex items-start gap-2">
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="min-w-0 flex-1"
            />
            <InfoHint text="One or two sentences in your own words. The screener checks every founder against it." />
          </div>
        )}
      </Field>

      {LISTS.map((l) => (
        <Field key={l.key} label={l.label}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={lists[l.key]}
              onChange={(e) => setLists((prev) => ({ ...prev, [l.key]: e.target.value }))}
            />
          )}
        </Field>
      ))}

      <div>
        <Button type="submit" variant="secondary" disabled={!dirty} busy={update.isPending} busyLabel="Saving">
          Save
        </Button>
      </div>
    </form>
  );
}

/** A new swarm with its own thesis. The new swarm is selected as soon as it is created. */
export function NewSwarmPanel() {
  const create = useCreateSwarm();
  const { select } = useSwarm();
  const toast = useToast();
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Enter a name.";
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    create.mutate(
      {
        name: name.trim(),
        thesis: { summary: summary.trim(), sectors: [], stages: [], geos: [], avoid: [] },
      },
      {
        onSuccess: (swarm) => {
          setName("");
          setSummary("");
          setErrors({});
          select(swarm.id);
          toast.done("Swarm created", swarm.name);
        },
        onError: (failure) => {
          if (failure instanceof ApiError && Object.keys(failure.fields).length > 0) setErrors(failure.fields);
          toast.problem("The swarm was not created", failure.message);
        },
      },
    );
  }

  return (
    <Panel title="New swarm">
      <form onSubmit={submit} className="flex max-w-2xl flex-col gap-5" noValidate>
        <Field label="Name" error={errors.name ?? null}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors({});
              }}
            />
          )}
        </Field>
        <Field label="Thesis" error={errors.thesis ?? null}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          )}
        </Field>
        <div>
          <Button type="submit" variant="secondary" busy={create.isPending} busyLabel="Creating">
            Create
          </Button>
        </div>
      </form>
    </Panel>
  );
}
