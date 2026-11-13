import { Info } from "lucide-react";
import { Hint } from "../../components/ui/overlay";

/** A small info icon. The explanation lives in the hover and focus hint, not on the page. */
export function InfoHint({ text }: { text: string }) {
  return (
    <Hint text={text}>
      <button
        type="button"
        aria-label={text}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:bg-sunk hover:text-ink"
      >
        <Info className="size-4" aria-hidden />
      </button>
    </Hint>
  );
}
