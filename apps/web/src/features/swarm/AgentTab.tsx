import { useState } from "react";
import type { AddAgentInput, AgentNode, JobNode } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { Field, Input, Switch } from "../../components/ui/Field";
import { useToast } from "../../components/ui/overlay";
import { useAddAgent, useUpdateAgent } from "../../lib/queries";

/** Pause or resume one agent, and set its focus. */
export function AgentControls({ node }: { node: AgentNode }) {
  const { agent } = node;
  const update = useUpdateAgent();
  const toast = useToast();
  const [focus, setFocus] = useState(agent.beat ?? "");
  const paused = agent.status === "paused";
  const focusChanged = focus.trim() !== (agent.beat ?? "");

  function setActive(active: boolean) {
    update.mutate(
      { agentId: agent.id, patch: { status: active ? "active" : "paused" } },
      { onError: (e) => toast.problem("Not updated", e.message) },
    );
  }

  function saveFocus() {
    update.mutate(
      { agentId: agent.id, patch: { beat: focus.trim() || null } },
      {
        onSuccess: () => toast.done("Saved"),
        onError: (e) => toast.problem("Not saved", e.message),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Switch checked={!paused} onCheckedChange={setActive} label={paused ? "Paused" : "Working"} disabled={update.isPending} />
      <Field label="Focus">
        {({ id, describedBy }) => (
          <div className="flex items-center gap-2">
            <Input id={id} aria-describedby={describedBy} value={focus} onChange={(e) => setFocus(e.target.value)} className="min-w-0 flex-1" />
            <Button variant="secondary" size="sm" disabled={!focusChanged} busy={update.isPending} busyLabel="Saving" onClick={saveFocus}>
              Save
            </Button>
          </div>
        )}
      </Field>
    </div>
  );
}

/** Adds another agent to a scout job. */
export function AddAgentForm({ swarmId, job }: { swarmId: string; job: JobNode }) {
  const add = useAddAgent();
  const toast = useToast();
  const [name, setName] = useState("");
  const [focus, setFocus] = useState("");

  function submit() {
    const input: AddAgentInput = { jobId: job.job.id, beat: focus.trim() || null };
    if (name.trim()) input.name = name.trim();
    add.mutate(
      { swarmId, input },
      {
        onSuccess: (agent) => {
          setName("");
          setFocus("");
          toast.done("Agent added", agent.name);
        },
        onError: (e) => toast.problem("The agent was not added", e.message),
      },
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Name">
        {({ id, describedBy }) => (
          <Input id={id} aria-describedby={describedBy} value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <Field label="Focus">
        {({ id, describedBy }) => (
          <Input id={id} aria-describedby={describedBy} value={focus} onChange={(e) => setFocus(e.target.value)} />
        )}
      </Field>
      <div>
        <Button type="submit" variant="secondary" busy={add.isPending} busyLabel="Adding">
          Add agent
        </Button>
      </div>
    </form>
  );
}
