import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Info, Lock, X } from "lucide-react";
import type { OutreachDraft, OutreachRow } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { Input, Textarea } from "../../components/ui/Field";
import { Avatar, Panel } from "../../components/ui/layout";
import { Caution, Status } from "../../components/ui/marks";
import { useToast } from "../../components/ui/overlay";
import { ScoreDial } from "../../components/ScoreDial";
import { ago, dateTime } from "../../lib/format";
import { useDecideOutreach, usePlaceCall } from "../../lib/queries";
import { CompleteForm } from "./CompleteForm";
import { isCall, KIND_VIEW, STATUS_VIEW } from "./groups";

/** One outreach item: a separate object to act on, so it is one rounded box. */
export function OutreachItem({ row }: { row: OutreachRow }) {
  const kind = KIND_VIEW[row.kind];
  const status = STATUS_VIEW[row.status];
  const waiting = row.status === "proposed";
  const approved = row.status === "approved";
  const KindIcon = kind.icon;

  // The partner's wording lives here, so the approval sends exactly what the editor shows.
  const [subject, setSubject] = useState(row.draft.subject ?? "");
  const [body, setBody] = useState(row.draft.body ?? "");

  const draft: OutreachDraft =
    row.kind === "email_founder" ? { ...row.draft, subject: subject || null, body: body || null } : row.draft;

  return (
    <Panel boxed className="flex flex-col gap-4 rounded-md">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span title={kind.label} className="text-ink-2">
            <KindIcon className="size-5" aria-hidden />
            <span className="sr-only">{kind.label}</span>
          </span>
          <Avatar name={row.founderName} />
          <Link
            to={`/founders/${encodeURIComponent(row.founderId)}`}
            className="min-w-0 truncate text-base font-bold text-ink hover:underline"
          >
            {row.founderName}
          </Link>
          {!waiting ? <Status state={status.mark}>{status.label}</Status> : null}
        </div>
        <ScoreDial value={row.composite} label="Score" size={56} />
      </header>

      {row.kind === "email_founder" ? (
        <EmailDraft editable={waiting} subject={subject} body={body} onSubject={setSubject} onBody={setBody} />
      ) : (
        <CallPlan draft={row.draft} />
      )}

      {isCall(row.kind) && row.status === "dispatched" && row.call ? (
        <p className="m-0 border-t border-rule pt-3 text-base text-ink-2">Call {row.call.state}{row.call.detail ? `: ${row.call.detail}` : ""}</p>
      ) : null}

      <Disclosure text={row.draft.disclosure} />

      <details className="text-sm text-ink-2">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 font-semibold hover:text-ink">
          <Info className="size-4" aria-hidden />
          Why
        </summary>
        <dl className="m-0 mt-2 flex flex-col gap-2 pl-6">
          <div>
            <dt className="font-bold text-ink-3">Consent</dt>
            <dd className="m-0 text-base text-ink">{row.consentBasis}</dd>
          </div>
          <div>
            <dt className="font-bold text-ink-3">Rationale</dt>
            <dd className="m-0 text-base text-ink">{row.rationale}</dd>
          </div>
        </dl>
      </details>

      {waiting ? <DecisionBar row={row} draft={draft} /> : null}
      {approved ? <ApprovedBar row={row} /> : null}
      {!waiting && !approved ? <Outcome row={row} /> : null}
    </Panel>
  );
}

function EmailDraft({
  editable,
  subject,
  body,
  onSubject,
  onBody,
}: {
  editable: boolean;
  subject: string;
  body: string;
  onSubject: (value: string) => void;
  onBody: (value: string) => void;
}) {
  if (!editable) {
    return (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-base font-bold text-ink">{subject}</p>
        <p className="m-0 text-base whitespace-pre-wrap text-ink-2">{body}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input aria-label="Subject" value={subject} onChange={(e) => onSubject(e.target.value)} className="font-bold" />
      <Textarea aria-label="Message" rows={8} value={body} onChange={(e) => onBody(e.target.value)} />
    </div>
  );
}

function CallPlan({ draft }: { draft: OutreachDraft }) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-bold text-ink-3">Agenda</h3>
        <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-base text-ink">
          {draft.agenda.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-bold text-ink-3">Questions</h3>
        <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-base text-ink">
          {draft.questions.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Disclosure({ text }: { text: string }) {
  return (
    <p className="m-0 flex items-start gap-2 rounded-sm bg-sunk px-3 py-2 text-sm text-ink-2">
      <span className="mt-0.5 shrink-0" title="Fixed. This line cannot be edited or removed.">
        <Lock className="size-4" aria-hidden />
        <span className="sr-only">Fixed, cannot be edited.</span>
      </span>
      <span>{text}</span>
    </p>
  );
}

function DecisionBar({ row, draft }: { row: OutreachRow; draft: OutreachDraft }) {
  const decide = useDecideOutreach();
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const pending = decide.isPending ? decide.variables?.input.decision : null;

  const approve = () =>
    decide.mutate(
      { id: row.id, input: { decision: "approve", note: null, draft } },
      {
        onSuccess: () => toast.done("Approved", row.founderName),
        onError: (e) => toast.problem("The decision was not saved", e.message),
      },
    );

  const reject = () =>
    decide.mutate(
      { id: row.id, input: { decision: "reject", note: note.trim() || null } },
      {
        onSuccess: () => toast.done("Rejected", row.founderName),
        onError: (e) => toast.problem("The decision was not saved", e.message),
      },
    );

  if (rejecting) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
        <div className="w-72 min-w-0">
          <Input aria-label="Reason" placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} autoFocus />
        </div>
        <Button variant="secondary" icon={<X />} onClick={reject} busy={pending === "reject"} busyLabel="Rejecting" disabled={decide.isPending}>
          Reject
        </Button>
        <Button variant="quiet" onClick={() => setRejecting(false)} disabled={decide.isPending}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
      <Button
        variant="primary"
        icon={<Check />}
        onClick={approve}
        busy={pending === "approve"}
        busyLabel="Approving"
        disabled={decide.isPending}
      >
        Approve
      </Button>
      <Button variant="secondary" icon={<X />} onClick={() => setRejecting(true)} disabled={decide.isPending}>
        Reject
      </Button>
    </div>
  );
}

function ApprovedBar({ row }: { row: OutreachRow }) {
  const [completing, setCompleting] = useState(false);
  const hasCallService = row.callingService?.configured === true;
  const callItem = isCall(row.kind);
  return (
    <div className="flex flex-col gap-3 border-t border-rule pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Status state="ok">
          <span title={dateTime(row.decidedAt)}>
            {row.decidedBy ?? "Partner"}, {ago(row.decidedAt)}
          </span>
        </Status>
        {!completing ? <Button variant="secondary" onClick={() => setCompleting(true)}>{callItem ? "I made this call" : "Mark as done"}</Button> : null}
      </div>
      {callItem && !row.call && (hasCallService ? <CallForm row={row} /> : <Caution>Calling service not connected.</Caution>)}
      {completing ? (
        <CompleteForm id={row.id} onDone={() => setCompleting(false)} onCancel={() => setCompleting(false)} />
      ) : null}
    </div>
  );
}

function CallForm({ row }: { row: OutreachRow }) {
  const place = usePlaceCall();
  const toast = useToast();
  const [to, setTo] = useState("");
  const [timezone, setTimezone] = useState("");
  const [how, setHow] = useState("");
  const [recording, setRecording] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    place.mutate({ id: row.id, input: { to, timezone, consent: { how, recording } } }, {
      onSuccess: () => toast.done("Call placed", row.founderName),
      onError: (error) => toast.problem("Call was not placed", error.message),
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-base font-bold text-ink">Number<Input value={to} onChange={(event) => setTo(event.target.value)} autoComplete="tel" required /></label>
        <label className="flex flex-col gap-1 text-base font-bold text-ink">Time zone<Input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Chicago" required /></label>
      </div>
      <label className="flex flex-col gap-1 text-base font-bold text-ink">Consent<Input value={how} onChange={(event) => setHow(event.target.value)} placeholder="How and when they agreed to an AI call" required /></label>
      <label className="flex items-center gap-2 text-base text-ink"><input type="checkbox" checked={recording} onChange={(event) => setRecording(event.target.checked)} />Recording agreed</label>
      <div><Button type="submit" variant="primary" busy={place.isPending} busyLabel="Calling" disabled={place.isPending}>Place call</Button></div>
    </form>
  );
}

/** The result of an item that is no longer waiting: the outcome, or the reason it was rejected. */
function Outcome({ row }: { row: OutreachRow }) {
  if (row.call && row.status === "failed") {
    return <p className="m-0 border-t border-rule pt-3 text-base text-ink-2">Call {row.call.state}: {row.call.detail ?? "Call failed."}</p>;
  }
  const text = row.resultSummary ?? row.decisionNote;
  if (!text) return null;
  return <p className="m-0 border-t border-rule pt-3 text-base text-ink-2">{text}</p>;
}
