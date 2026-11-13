import { Fragment, type ReactNode } from "react";

/**
 * Renders the only Markdown a memo uses: paragraphs and **bold**. Every other
 * character is shown as written. Text becomes React elements, never HTML.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <p key={index} className="prose-measure whitespace-pre-line text-base text-ink">
          {renderInline(block)}
        </p>
      ))}
    </div>
  );
}

function renderInline(text: string): ReactNode[] {
  // With a capturing group, odd indexes are the bold spans.
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
