import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Field, Input, Switch } from "../../components/ui/Field";
import { ErrorNote, Panel } from "../../components/ui/layout";
import { Status } from "../../components/ui/marks";
import { useToast } from "../../components/ui/overlay";
import { setActor } from "../../lib/api/context";
import { useUpdateSettings } from "../../lib/queries";
import { InfoHint } from "../steering/InfoHint";

/** The kill switch. When it is on, the page says so before anything else. */
export function EmergencyPanel({ saved }: { saved: boolean }) {
  return (
    <Panel
      title="Emergency stop"
      aside={saved ? <Status state="paused">Stopped</Status> : <Status state="ok">Allowed</Status>}
    >
      {saved ? <ErrorNote title="All runs are stopped" /> : null}
      <EmergencyForm key={String(saved)} saved={saved} />
    </Panel>
  );
}

function EmergencyForm({ saved }: { saved: boolean }) {
  const update = useUpdateSettings();
  const toast = useToast();
  const [stop, setStop] = useState(saved);
  const dirty = stop !== saved;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    update.mutate(
      { killSwitch: stop },
      {
        onSuccess: () => toast.done(stop ? "Runs stopped" : "Runs allowed again"),
        onError: (error) => toast.problem("The emergency stop was not saved", error.message),
      },
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Switch checked={stop} onCheckedChange={setStop} label="Stop all runs" />
        <InfoHint text="When on, no new run or task starts anywhere in the swarm." />
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={!dirty} busy={update.isPending} busyLabel="Saving">
          Save
        </Button>
      </div>
    </form>
  );
}

/** The name recorded against steering and approvals. */
export function OperatorPanel({ saved }: { saved: string }) {
  return (
    <Panel title="Your name">
      <OperatorForm key={saved} saved={saved} />
    </Panel>
  );
}

function OperatorForm({ saved }: { saved: string }) {
  const update = useUpdateSettings();
  const toast = useToast();
  const [name, setName] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const dirty = name.trim() !== saved;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name.");
      return;
    }
    update.mutate(
      { operatorName: trimmed },
      {
        onSuccess: () => {
          setActor(trimmed);
          toast.done("Name saved");
        },
        onError: (failure) => toast.problem("The name was not saved", failure.message),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4" noValidate>
      <Field label="Name" error={error}>
        {({ id, describedBy, invalid }) => (
          <div className="flex items-center gap-2">
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              className="min-w-0 flex-1"
            />
            <InfoHint text="Recorded against every rule, preference, setting and approval you make." />
          </div>
        )}
      </Field>
      <div>
        <Button type="submit" variant="secondary" disabled={!dirty} busy={update.isPending} busyLabel="Saving">
          Save
        </Button>
      </div>
    </form>
  );
}
