import { useEffect, useId, useState, type KeyboardEvent, type MouseEvent } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, X } from "lucide-react";
import { FEEDBACK_REASONS, reasonLabel, type FeedbackInput, type FeedbackVerdict } from "@agentswarm/shared";
import { cn } from "../lib/cn";
import { useAddCompanyFeedback, useAddFeedback } from "../lib/queries";
import { Button } from "./ui/Button";
import { useToast } from "./ui/overlay";

/** The reasons offered for each call. Founders use FEEDBACK_REASONS; companies use COMPANY_REASONS. */
export type ReasonOptions = Record<FeedbackVerdict, ReadonlyArray<{ id: string; label: string }>>;

export interface YesNoProps {
  /** Set for a founder: the call is saved against this founder. */
  founderId?: string;
  /** Set for a company: the call is saved against this company. Give `reasons` too. */
  companyId?: string;
  /** The reasons to offer. Defaults to the founder reasons. */
  reasonOptions?: ReasonOptions;
  /** The call in force, if a partner has already made one. */
  verdict: FeedbackVerdict | null;
  /** The reasons given with that call. */
  reasons: string[];
  /** "row" is two icon buttons for a table row. "full" adds labels and shows the reasons. */
  size?: "row" | "full";
  className?: string;
}

/**
 * The partner's call on a candidate or a company. Tap Yes or No, tap a reason, save.
 * A reason is required because the reasons are what the swarm learns from.
 */
export function YesNo({ founderId, companyId, reasonOptions, verdict, reasons, size = "row", className }: YesNoProps) {
  const [draft, setDraft] = useState<FeedbackVerdict | null>(null);
  const full = size === "full";
  const options: ReasonOptions = reasonOptions ?? FEEDBACK_REASONS;
  const labelOf = (id: string) =>
    [...options.yes, ...options.no].find((r) => r.id === id)?.label ?? reasonLabel(id);

  // Sits inside clickable rows, so it must not open the row.
  const contain = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

  const button = (kind: FeedbackVerdict) => {
    const active = verdict === kind;
    const Icon = kind === "yes" ? Check : X;
    return (
      <Popover.Root open={draft === kind} onOpenChange={(open) => setDraft(open ? kind : null)}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={kind === "yes" ? "Yes" : "No"}
            aria-pressed={active}
            title={
              active && reasons.length
                ? `${kind === "yes" ? "Yes" : "No"}: ${reasons.map(reasonLabel).join(", ")}`
                : kind === "yes"
                  ? "Yes"
                  : "No"
            }
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm border font-bold transition-colors duration-150",
              full ? "h-10 px-4 text-base" : "size-8",
              kind === "yes"
                ? active
                  ? "border-green-2 bg-green-2 text-on-green"
                  : "border-green-3 bg-surface text-green-2 hover:bg-green-tint"
                : active
                  ? "border-ink bg-ink text-surface"
                  : "border-rule-strong bg-surface text-ink-2 hover:bg-sunk hover:text-ink",
            )}
          >
            <Icon className={full ? "size-5" : "size-4"} strokeWidth={2.5} aria-hidden />
            {full ? <span>{kind === "yes" ? "Yes" : "No"}</span> : null}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align={kind === "yes" ? "start" : "end"}
            sideOffset={6}
            collisionPadding={12}
            onClick={contain}
            onKeyDown={contain}
            className="z-50 w-[19rem] rounded-md bg-surface p-3 shadow-overlay"
          >
            <ReasonForm
              founderId={founderId}
              companyId={companyId}
              options={options}
              verdict={kind}
              initialReasons={verdict === kind ? reasons : []}
              onDone={() => setDraft(null)}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  };

  return (
    <div
      className={cn("inline-flex min-w-0 flex-wrap items-center gap-2", className)}
      onClick={contain}
      onKeyDown={contain}
      role="group"
      aria-label="Your call"
    >
      {button("yes")}
      {button("no")}
      {full && verdict && reasons.length > 0 ? (
        <span className="flex min-w-0 flex-wrap gap-1">
          {reasons.map((id) => (
            <span
              key={id}
              className="inline-flex h-[1.375rem] items-center rounded-full bg-sunk px-2 text-xs font-bold text-ink-2"
            >
              {labelOf(id)}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

function ReasonForm({
  founderId,
  companyId,
  options,
  verdict,
  initialReasons,
  onDone,
}: {
  founderId?: string;
  companyId?: string;
  options: ReasonOptions;
  verdict: FeedbackVerdict;
  initialReasons: string[];
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(initialReasons);
  const [note, setNote] = useState("");
  const saveFounder = useAddFeedback();
  const saveCompany = useAddCompanyFeedback();
  const busy = companyId !== undefined ? saveCompany.isPending : saveFounder.isPending;
  const toast = useToast();
  const noteId = useId();

  useEffect(() => {
    setPicked(initialReasons);
    // Reset only when the form is opened for a different verdict.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdict]);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const ready = picked.length > 0 || note.trim().length > 0;

  const submit = () => {
    if (!ready) return;
    const input: FeedbackInput = { verdict, reasonTags: picked, note: note.trim() || null };
    const done = {
      onSuccess: () => {
        toast.done(verdict === "yes" ? "Yes saved" : "No saved");
        onDone();
      },
      onError: (e: Error) => toast.problem("Your call was not saved", e.message),
    };
    if (companyId !== undefined) saveCompany.mutate({ companyId, input }, done);
    else if (founderId !== undefined) saveFounder.mutate({ founderId, input }, done);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2.5"
    >
      <p className="text-base font-black text-ink">{verdict === "yes" ? "Yes, because" : "No, because"}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reasons">
        {options[verdict].map((r) => {
          const on = picked.includes(r.id);
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(r.id)}
              className={cn(
                "h-7 rounded-full border px-2.5 text-sm font-bold transition-colors duration-150",
                on
                  ? "border-green-2 bg-green-tint text-green"
                  : "border-rule-strong bg-surface text-ink-2 hover:bg-sunk hover:text-ink",
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <div>
        <label htmlFor={noteId} className="sr-only">
          Anything else
        </label>
        <input
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything else"
          maxLength={400}
          className="h-8 w-full rounded-sm border border-rule-strong bg-surface px-2 text-sm text-ink placeholder:text-ink-3 focus-visible:border-green-2"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!ready} busy={busy} busyLabel="Saving">
          Save
        </Button>
      </div>
    </form>
  );
}
