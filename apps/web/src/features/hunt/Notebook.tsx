import { useState, type FormEvent } from "react";
import { Compass, Cog, Trash2, UserRound } from "lucide-react";
import type { HuntNote } from "@agentswarm/shared";
import { Button, IconButton } from "../../components/ui/Button";
import { Input } from "../../components/ui/Field";
import { useToast } from "../../components/ui/overlay";
import { ApiError } from "../../lib/api/http";
import { useAddHuntNote, useRemoveHuntNote } from "../../lib/queries";
import { sortNotes } from "./model";

function NoteIcon({ note }: { note: HuntNote }) {
  if (note.by === "person") return <UserRound className="size-4 shrink-0 text-navy" aria-hidden />;
  if (note.by === "navigator") return <Compass className="size-4 shrink-0 text-navy" aria-hidden />;
  return <Cog className="size-4 shrink-0 text-ink-3" aria-hidden />;
}

export function Notebook({ notes, swarmId }: { notes: HuntNote[]; swarmId: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const add = useAddHuntNote(swarmId);
  const remove = useRemoveHuntNote(swarmId);
  const toast = useToast();
  const latest = sortNotes(notes);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await add.mutateAsync(text.trim());
      setText("");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The note was not added.");
    }
  }

  async function removeNote(noteId: string) {
    try { await remove.mutateAsync(noteId); }
    catch (cause) { toast.problem("Note not removed", cause instanceof Error ? cause.message : undefined); }
  }

  return (
    <section className="min-w-0">
      <h2 className="mb-3 text-md font-black text-ink">Notebook</h2>
      <ul className="m-0 flex max-h-72 list-none flex-col gap-3 overflow-y-auto p-0">
        {latest.map((note) => (
          <li key={note.id} className="flex min-w-0 items-start gap-2 border-b border-rule pb-2">
            <NoteIcon note={note} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2 text-xs text-ink-3"><span className="figure">Turn {note.turn}</span><span>{note.by}</span></div>
              <p className="m-0 break-words text-sm text-ink" title={note.text}>{note.text}</p>
            </div>
            {note.by === "person" ? <IconButton label="Remove note" onClick={() => void removeNote(note.id)}><Trash2 /></IconButton> : null}
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-3 flex items-start gap-2">
        <Input aria-label="Notebook note" value={text} onChange={(event) => setText(event.target.value)} maxLength={500} />
        <Button type="submit" disabled={!text.trim() || add.isPending} busy={add.isPending} size="sm">Add</Button>
      </form>
      {error ? <p role="alert" className="mt-1 text-sm font-bold text-red">{error}</p> : null}
    </section>
  );
}
