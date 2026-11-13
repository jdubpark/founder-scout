import type { Memo } from "@agentswarm/shared";
import { Panel } from "../../../components/ui/layout";
import { Markdown } from "./Markdown";

function Listed({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <ul className="prose-measure m-0 flex list-disc flex-col gap-1 pl-5 text-base text-ink-2">
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function MemoPanel({ memo }: { memo: Memo | null }) {
  // A memo is written only for founders above the bar. Without one, the rubric speaks for itself.
  if (!memo) return null;

  return (
    <Panel title="Memo">
      <article className="flex flex-col gap-6">
        <h3 className="text-xl font-black text-ink">{memo.headline}</h3>
        <Markdown text={memo.body} className="flex flex-col gap-3" />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Listed title="Strengths" items={memo.strengths} />
          <Listed title="Risks" items={memo.risks} />
          <Listed title="Open questions" items={memo.openQuestions} />
        </div>

        {memo.nextStep ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-ink">Next step</h3>
            <p className="prose-measure text-base text-ink">{memo.nextStep}</p>
          </div>
        ) : null}
      </article>
    </Panel>
  );
}
