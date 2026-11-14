import { useRef, useState, type FormEvent } from "react";
import type { Recording, RecordingKind, RecordingStatus } from "@agentswarm/shared";
import { Button } from "../../../components/ui/Button";
import { Field, Input, Select } from "../../../components/ui/Field";
import { EmptyState, ErrorNote, Panel, SkeletonRows } from "../../../components/ui/layout";
import { Status, type MarkState } from "../../../components/ui/marks";
import { Sheet, useToast } from "../../../components/ui/overlay";
import { useAddRecordingLink, useRecordings, useRemoveRecording, useUploadRecording } from "../../../lib/queries";

const STATUS: Record<RecordingStatus, { label: string; state: MarkState }> = {
  queued: { label: "Queued", state: "idle" },
  transcribing: { label: "Transcribing", state: "running" },
  ready: { label: "Ready", state: "ok" },
  failed: { label: "Failed", state: "error" },
  refused: { label: "Refused", state: "warn" },
};

const KINDS: RecordingKind[] = ["talk", "interview", "call"];

function duration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "Unknown";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function RecordingsPanel({ founderId }: { founderId: string }) {
  const toast = useToast();
  const recordings = useRecordings(founderId);
  const addLink = useAddRecordingLink(founderId);
  const upload = useUploadRecording(founderId);
  const remove = useRemoveRecording(founderId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<RecordingKind>("talk");
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Recording | null>(null);

  function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addLink.mutate(
      { title, kind, url },
      {
        onSuccess: () => {
          setTitle("");
          setUrl("");
          toast.done("Recording added");
        },
        onError: (error) => toast.problem("Recording not added", error.message),
      },
    );
  }

  function submitFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
      toast.problem("Choose an audio or video file");
      return;
    }
    void file.arrayBuffer().then((buffer) => {
      upload.mutate(
        { title, kind, contentType: file.type, data: new Uint8Array(buffer) },
        {
          onSuccess: () => {
            setTitle("");
            if (fileRef.current) fileRef.current.value = "";
            toast.done("Recording uploaded");
          },
          onError: (error) => toast.problem("Recording not uploaded", error.message),
        },
      );
    }).catch((error: unknown) => {
      toast.problem("Recording not uploaded", error instanceof Error ? error.message : undefined);
    });
  }

  return (
    <Panel title="Recordings" aside={recordings.data ? String(recordings.data.length) : undefined}>
      {recordings.error ? <ErrorNote title="Recordings could not be loaded">{recordings.error.message}</ErrorNote> : null}
      {recordings.isPending ? <SkeletonRows rows={2} /> : null}
      {recordings.data?.length === 0 ? <EmptyState title="No recordings" /> : null}
      {recordings.data?.length ? (
        <ul className="divide-y divide-rule">
          {recordings.data.map((recording) => {
            const status = STATUS[recording.status];
            return (
              <li key={recording.id} className="flex min-w-0 items-center gap-4 py-2.5 hover:bg-sunk">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setSelected(recording)}
                  title={recording.title}
                >
                  <span className="block truncate font-bold text-ink">{recording.title}</span>
                  <span className="text-sm capitalize text-ink-3">{recording.kind}</span>
                </button>
                <Status state={status.state}>{status.label}</Status>
                <span className="figure w-12 text-right text-sm text-ink-2">{duration(recording.durationSec)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="mt-4 grid max-w-3xl grid-cols-[minmax(10rem,1fr)_9rem] gap-3">
          <Field label="Title">
            {({ id }) => <Input id={id} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required />}
          </Field>
          <Field label="Kind">
            {({ id }) => (
              <Select id={id} value={kind} onChange={(event) => setKind(event.target.value as RecordingKind)}>
                {KINDS.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            )}
          </Field>
          <form onSubmit={submitLink} className="col-span-2 flex items-end gap-2">
            <Field label="Link" className="min-w-0 flex-1">
              {({ id }) => <Input id={id} type="url" value={url} onChange={(event) => setUrl(event.target.value)} required />}
            </Field>
            <Button type="submit" busy={addLink.isPending} disabled={!title.trim()}>Add link</Button>
          </form>
          <form onSubmit={submitFile} className="col-span-2 flex items-end gap-2">
            <Field label="File" className="min-w-0 flex-1">
              {({ id }) => <Input id={id} ref={fileRef} type="file" accept="audio/*,video/*" required className="pt-1.5" />}
            </Field>
            <Button type="submit" busy={upload.isPending} disabled={!title.trim()}>Upload</Button>
          </form>
      </div>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected?.title ?? "Transcript"}
        description={selected ? `${selected.kind}, ${duration(selected.durationSec)}` : undefined}
        width="lg"
      >
        {selected?.transcript ? (
          <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-ink">{selected.transcript.text}</pre>
        ) : (
          <p className="text-ink-2">{selected?.detail || "Transcript not available"}</p>
        )}
        {selected ? (
          <Button
            className="mt-5"
            variant="caution"
            busy={remove.isPending}
            onClick={() => remove.mutate(selected.id, {
              onSuccess: () => {
                setSelected(null);
                toast.done("Recording removed");
              },
              onError: (error) => toast.problem("Recording not removed", error.message),
            })}
          >
            Remove
          </Button>
        ) : null}
      </Sheet>
    </Panel>
  );
}
