import { ArrowRight } from "lucide-react";
import type { DecisionFlip, EvalFlowDTO, EvalVariant, PreviewDTO } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { ErrorNote, SkeletonRows } from "../../components/ui/layout";
import { Sheet, useToast } from "../../components/ui/overlay";
import { usePromoteVariant } from "../../lib/queries";
import { cutFlips, decisionName, hasChanges, reScoredLine } from "./preview";
import { roundLabel } from "./variants";

type PreviewState = {
  isPending: boolean;
  error: Error | null;
  data: PreviewDTO | undefined;
};

/** Shows what putting a round into use would change, then asks once more before it is used. */
export function UseRoundDialog({
  flow,
  variant,
  swarmId,
  preview,
  onClose,
}: {
  flow: EvalFlowDTO;
  variant: EvalVariant;
  swarmId: string;
  preview: PreviewState;
  onClose: () => void;
}) {
  const promote = usePromoteVariant();
  const toast = useToast();

  const use = () =>
    promote.mutate(
      { id: flow.id, input: { variant: variant.id, swarmId } },
      {
        onSuccess: () => {
          toast.done(`${roundLabel(variant)} is in use`);
          onClose();
        },
        onError: (e) => toast.problem("The configuration was not changed", e.message),
      },
    );

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title={`Use ${roundLabel(variant)}`}>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-5">
        {preview.isPending ? <SkeletonRows rows={4} /> : null}

        {preview.error ? (
          <ErrorNote title="The change could not be previewed">{preview.error.message}</ErrorNote>
        ) : null}

        {preview.data ? (
          <>
            {hasChanges(preview.data) ? null : <p className="m-0 text-base text-ink">No decision changes today.</p>}
            <FlipGroup title="Founders" flips={preview.data.founders} />
            <FlipGroup title="Companies" flips={preview.data.companies} />
            {preview.data.unseen.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {preview.data.unseen.map((line) => (
                  <li key={line} className="text-base text-ink-2">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="m-0 text-sm text-ink-3">{reScoredLine(preview.data.considered)}</p>
          </>
        ) : null}

        <div className="mt-auto flex items-center gap-2 pt-2">
          <Button variant="primary" onClick={use} busy={promote.isPending} busyLabel="Saving">
            Use this
          </Button>
          <Button variant="quiet" onClick={onClose} disabled={promote.isPending}>
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function FlipGroup({ title, flips }: { title: string; flips: DecisionFlip[] }) {
  if (flips.length === 0) return null;
  const { shown, more } = cutFlips(flips);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-md font-black text-ink">{title}</h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {shown.map((flip) => (
          <li key={flip.id} className="flex items-center gap-3 border-b border-rule py-2 text-base last:border-b-0">
            <span className="min-w-0 flex-1 truncate font-bold text-ink" title={flip.name}>
              {flip.name}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-ink-2">
              {decisionName(flip.from)}
              <ArrowRight className="size-4" aria-hidden />
              <span className="font-bold text-ink">{decisionName(flip.to)}</span>
            </span>
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="m-0 text-sm text-ink-3">+ {more} more</p> : null}
    </section>
  );
}
