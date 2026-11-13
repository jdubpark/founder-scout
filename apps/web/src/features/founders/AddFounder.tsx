import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Field, Input } from "../../components/ui/Field";
import { useToast } from "../../components/ui/overlay";
import { ApiError } from "../../lib/api/http";
import { useAddFounder } from "../../lib/queries";

type Fields = "name" | "companyName" | "link";

/** A secondary button that opens a small form to add one founder by hand. */
export function AddFounder({ swarmId }: { swarmId: string }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // Escape and a click outside close the form.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <Button variant="secondary" icon={<Plus />} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Add
      </Button>
      {open ? <AddFounderForm swarmId={swarmId} onDone={() => setOpen(false)} /> : null}
    </div>
  );
}

function AddFounderForm({ swarmId, onDone }: { swarmId: string; onDone: () => void }) {
  const add = useAddFounder();
  const toast = useToast();
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [link, setLink] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setErrors({ name: "Enter a name." });
      return;
    }
    setErrors({});
    add.mutate(
      {
        swarmId,
        name: name.trim(),
        companyName: companyName.trim() || null,
        link: link.trim() || null,
      },
      {
        onSuccess: () => {
          toast.done("Added. Looked at in the next run.");
          onDone();
        },
        onError: (failure) => {
          const fields = failure instanceof ApiError ? failure.fields : {};
          if (Object.keys(fields).length > 0) {
            setErrors({ name: fields.name, companyName: fields.companyName, link: fields.link });
          } else {
            toast.problem("The founder was not added", failure.message);
          }
        },
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Add a founder"
      className="absolute top-full right-0 z-30 mt-2 flex w-80 flex-col gap-3 rounded-lg border border-rule bg-surface p-4 shadow-overlay"
    >
      <Field label="Name" error={errors.name}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <Field label="Company" error={errors.companyName}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <Field label="Link" error={errors.link}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <div className="flex items-center justify-end gap-2">
        <Button variant="quiet" size="sm" onClick={onDone} disabled={add.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" busy={add.isPending} busyLabel="Adding">
          Add
        </Button>
      </div>
    </form>
  );
}
