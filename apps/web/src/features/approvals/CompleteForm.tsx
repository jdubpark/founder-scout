import { useId, useState, type FormEvent } from "react";
import { Info } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Field, Input, Textarea } from "../../components/ui/Field";
import { Hint } from "../../components/ui/overlay";
import { useToast } from "../../components/ui/overlay";
import { useCompleteOutreach } from "../../lib/queries";

/** Records what happened after an approved item was carried out by a person. */
export function CompleteForm({ id, onDone, onCancel }: { id: string; onDone: () => void; onCancel: () => void }) {
  const complete = useCompleteOutreach();
  const toast = useToast();
  const [summary, setSummary] = useState("");
  const [transcript, setTranscript] = useState("");
  const transcriptId = useId();
  const canSave = summary.trim().length > 0 && !complete.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;
    complete.mutate(
      { id, input: { summary: summary.trim(), transcript: transcript.trim() || null } },
      {
        onSuccess: () => {
          toast.done("Marked as done");
          onDone();
        },
        onError: (e) => toast.problem("The item was not marked as done", e.message),
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border border-rule bg-ground p-3">
      <Field label="Summary">
        {({ id: inputId, describedBy }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={280}
            autoFocus
          />
        )}
      </Field>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <label htmlFor={transcriptId} className="text-sm font-semibold text-ink">
            Notes
          </label>
          <Hint text="Pasted notes become evidence on the next run.">
            <button
              type="button"
              aria-label="About pasted notes"
              className="inline-flex size-6 items-center justify-center text-ink-3 hover:text-ink"
            >
              <Info className="size-4" aria-hidden />
            </button>
          </Hint>
        </div>
        <Textarea
          id={transcriptId}
          rows={5}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={!canSave} busy={complete.isPending} busyLabel="Saving">
          Save
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={complete.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
