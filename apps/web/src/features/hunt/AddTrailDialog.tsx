import { useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X } from "lucide-react";
import type { AddTrailInput, HuntEngineView } from "@agentswarm/shared";
import { Button, IconButton } from "../../components/ui/Button";
import { Field, Input, Select, Textarea } from "../../components/ui/Field";
import { useAddHuntTrail } from "../../lib/queries";
import { ApiError } from "../../lib/api/http";

export function AddTrailDialog({ swarmId, engines }: { swarmId: string; engines: HuntEngineView[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [intent, setIntent] = useState("");
  const [engine, setEngine] = useState(engines.find((item) => item.configured)?.id ?? "");
  const [query, setQuery] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const add = useAddHuntTrail(swarmId);
  const configured = engines.filter((item) => item.configured);

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
      setOpen(false);
      setName(""); setIntent(""); setQuery(""); setAddress("");
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
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild><Button size="sm" icon={<Plus />}>Add trail</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface p-5 shadow-overlay">
          <header className="mb-4 flex items-center justify-between gap-4">
            <Dialog.Title className="text-lg font-black text-ink">Add trail</Dialog.Title>
            <Dialog.Close asChild><IconButton label="Close"><X /></IconButton></Dialog.Close>
          </header>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label="Name" error={fieldErrors.name}>{(ids) => <Input id={ids.id} value={name} onChange={(event) => { setName(event.target.value); clearErrors(); }} required aria-invalid={ids.invalid} aria-describedby={ids.describedBy} />}</Field>
            <Field label="What to look for" error={fieldErrors.intent}>{(ids) => <Textarea id={ids.id} rows={2} value={intent} onChange={(event) => { setIntent(event.target.value); clearErrors(); }} aria-invalid={ids.invalid} aria-describedby={ids.describedBy} />}</Field>
            <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3">
              <Field label="Engine" error={fieldErrors.engine}>{(ids) => <Select id={ids.id} value={engine} onChange={(event) => { setEngine(event.target.value); clearErrors(); }} disabled={!configured.length} aria-invalid={ids.invalid} aria-describedby={ids.describedBy}><option value="">Engine</option>{configured.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>}</Field>
              <Field label="Search" error={fieldErrors.searches}>{(ids) => <Input id={ids.id} value={query} onChange={(event) => { setQuery(event.target.value); clearErrors(); }} aria-invalid={ids.invalid} aria-describedby={ids.describedBy} />}</Field>
            </div>
            <Field label="Page address" error={fieldErrors.pages}>{(ids) => <Input id={ids.id} type="url" value={address} onChange={(event) => { setAddress(event.target.value); clearErrors(); }} aria-invalid={ids.invalid} aria-describedby={ids.describedBy} />}</Field>
            {/* A message already shown under its field is not repeated here. */}
            {error && Object.keys(fieldErrors).length === 0 ? <p role="alert" className="text-sm font-bold text-red">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild><Button>Cancel</Button></Dialog.Close>
              <Button type="submit" variant="primary" busy={add.isPending}>Add</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
