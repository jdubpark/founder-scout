import type { SteeringSuggestion } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { Panel } from "../../components/ui/layout";
import { Chip, KIND_NAME } from "../../components/ui/marks";
import { useToast } from "../../components/ui/overlay";
import { KindIcon } from "../../components/icons";
import { useCreateDirective, useDismissSuggestion, useSuggestions } from "../../lib/queries";

/** Steering proposed from the partners' yes and no calls. Hidden when there is nothing to propose. */
export function SuggestionsPanel({ swarmId }: { swarmId: string }) {
  const suggestions = useSuggestions(swarmId);
  const items = suggestions.data ?? [];
  if (items.length === 0) return null;
  return (
    <Panel title="From your calls" aside={<Chip>{items.length}</Chip>}>
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((s) => (
          <SuggestionRow key={s.key} swarmId={swarmId} suggestion={s} />
        ))}
      </ul>
    </Panel>
  );
}

function SuggestionRow({ swarmId, suggestion }: { swarmId: string; suggestion: SteeringSuggestion }) {
  const create = useCreateDirective();
  const dismiss = useDismissSuggestion();
  const toast = useToast();
  const kind = suggestion.directive.kind;

  function accept() {
    create.mutate(suggestion.directive, {
      onSuccess: () => {
        dismiss.mutate({ swarmId, key: suggestion.key });
        toast.done(`${KIND_NAME[kind]} saved`, suggestion.title);
      },
      onError: (error) => toast.problem(`The ${KIND_NAME[kind].toLowerCase()} was not saved`, error.message),
    });
  }

  const busy = create.isPending || dismiss.isPending;

  return (
    <li className="flex flex-col gap-2 border-b border-rule py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <KindIcon kind={kind} className="size-4 text-ink-2" />
          <span className="font-semibold text-ink">{suggestion.title}</span>
          <Chip>{suggestion.support}</Chip>
        </div>
        <p className="text-sm break-words text-ink-2">{suggestion.because}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" busy={busy} busyLabel="Saving" onClick={accept}>
          Accept
        </Button>
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => dismiss.mutate({ swarmId, key: suggestion.key })}>
          Dismiss
        </Button>
      </div>
    </li>
  );
}
