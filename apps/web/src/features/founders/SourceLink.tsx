import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { useApi } from "../../lib/api/context";
import { cn } from "../../lib/cn";

/** True for links to simulated sources. The host sim.invalid is reserved for them. */
export function isSimulatedUrl(href: string): boolean {
  try {
    const host = new URL(href).hostname;
    return host === "sim.invalid" || host.endsWith(".sim.invalid");
  } catch {
    return false;
  }
}

function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A link to a source. Simulated sources are not links: the text is shown and
 * the page marks the simulation once, in its header.
 */
export function SourceLink({
  href,
  children,
  className,
}: {
  href: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const { demo } = useApi();
  if (!href || demo || isSimulatedUrl(href)) {
    return <span className={cn("min-w-0 break-words", className)}>{children}</span>;
  }

  const safe = safeHref(href);
  if (!safe) return <span className={cn("min-w-0 break-words", className)}>{children}</span>;

  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-w-0 items-center gap-1 break-words font-medium text-navy underline underline-offset-2 hover:text-navy",
        className,
      )}
    >
      <span>{children}</span>
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
