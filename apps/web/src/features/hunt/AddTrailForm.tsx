import { useState, type FormEvent } from "react";
import type { AddTrailInput, HuntEngineView } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Field";
import { useAddHuntTrail } from "../../lib/queries";
import { ApiError } from "../../lib/api/http";

/**
 * A trail a person opens, written in place above the table: a name, what to look for, and
 * somewhere to start (a search, a page, or both). Inline, because pages here have no modal
 * dialogs. The server holds it to the rules the navigator is held to and says why when it
 * refuses.
 */
export function AddTrailForm({ swarmId, engines, onDone }: { swarmId: string; engines: HuntEngineView[]; onDone: () => void }) {
  const configured = engines.filter((item) => item.configured);
  const [name, setName] = useState("");
  const [intent, setIntent] = useState("");
  const [engine, setEngine] = useState(configured[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const add = useAddHuntTrail(swarmId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    const input: AddTrailInput = {
      name: name.trim(),
      ...(intent.trim() ? { intent: intent.trim() } : {}),
      ...(query.trim() && engine ? { searches: [{ engine, query: query.trim() }] } : {}),
      ...(address.trim() ? { pages: [address.trim()] } : {}),
    };
    try {
      await add.mutateAsync(input);
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fields);
      } else {
        setError("The trail was not added.");
      }
    }
  }

  function clearErrors() {
    setError("");
    setFieldErrors({});
  }

  return (
    <form onSubmit={submit} aria-label="Add trail" className="mb-3 flex flex-col gap-3 rounded-md border border-rule p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <Field label="Name" error={fieldErrors.name}>{(ids) => <Input id={ids.id} value={name} onChange={(event) => { setName(event.target.value); clearErrors(); }} required autoFocus aria-invalid={ids.invalid} aria-describedby={ids.describedBy} />}</Field>
        <Field label="What to look for" error={fieldErrors.intent}>{(ids) => <Input id={ids.id} value={intent} onChange={(event) => { setIntent(event.target.value); clearErrors(); }} aria-invalid={ids.invalid} aria-describedby={ids.describedBy} />}</Field>
      </div>
      <div className="grid grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <Field label="Engine" error={fieldErrors.engine}>{(ids) => (
          <Select id={ids.id} value={engine} onChange={(event) => { setEngine(event.target.value); clearErrors(); }} disabled={!configured.length} aria-invalid={ids.invalid} aria-describedby={ids.describedBy}>
            {configured.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </Select>
        )}</Field>
        <Field label="Search" error={fieldErrors.searches}>{(ids) => <Input id={ids.id} value={query} onChange={(event) => { setQuery(event.target.value); clearErrors(); }} aria-invalid={ids.invalid} aria-describedby={ids.describedBy} />}</Field>
        <Field label="Page address" error={fieldErrors.pages}>{(ids) => <Input id={ids.id} type="url" value={address} onChange={(event) => { setAddress(event.target.value); clearErrors(); }} aria-invalid={ids.invalid} aria-describedby={ids.describedBy} />}</Field>
      </div>
      {/* A message already shown under its field is not repeated here. */}
      {error && Object.keys(fieldErrors).length === 0 ? <p role="alert" className="text-sm font-bold text-red">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" busy={add.isPending}>Add</Button>
      </div>
    </form>
  );
}
