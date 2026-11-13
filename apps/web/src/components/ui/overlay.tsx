import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { IconButton } from "./Button";

/* ------------------------------- Sheet ----------------------------- */

/**
 * A panel that slides in from the right for reading one record in depth (a
 * task transcript, an evidence item) without losing the list behind it.
 * Prefer inline detail; reach for this only when the content is long.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: "md" | "lg";
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 animate-[fade-in_150ms_var(--ease-out)] bg-ink/30" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-overlay",
            "animate-[sheet-in_220ms_var(--ease-out)]",
            width === "lg" ? "max-w-[46rem]" : "max-w-[34rem]",
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-black text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-sm text-ink-3">{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close">
                <X />
              </IconButton>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* -------------------------------- Tabs ----------------------------- */

export const Tabs = TabsPrimitive.Root;

export function TabList({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <TabsPrimitive.List
      aria-label={label}
      className={cn("flex min-w-0 gap-5 overflow-x-auto border-b border-rule", className)}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export function Tab({ value, children, count }: { value: string; children: ReactNode; count?: number }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        "-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent text-base font-bold text-ink-3",
        "transition-colors duration-150 hover:text-ink",
        "data-[state=active]:border-green-2 data-[state=active]:text-ink",
      )}
    >
      {children}
      {count !== undefined ? <span className="figure text-sm text-ink-3">{count}</span> : null}
    </TabsPrimitive.Trigger>
  );
}

export const TabPanel = TabsPrimitive.Content;

/* ------------------------------ Tooltip ---------------------------- */

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}>{children}</TooltipPrimitive.Provider>;
}

/** Extra explanation on hover or focus. Never the only place a fact appears. */
export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 max-w-72 rounded-md bg-ink px-2.5 py-1.5 text-sm leading-snug font-bold text-surface shadow-overlay"
        >
          {text}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ------------------------------- Toast ----------------------------- */

interface ToastItem {
  id: number;
  title: string;
  detail?: string;
  tone: "done" | "problem";
}

interface ToastApi {
  /** Confirms that an action happened, in the past tense: "Rule saved". */
  done: (title: string, detail?: string) => void;
  /** Says what went wrong and what to do next. */
  problem: (title: string, detail?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((tone: ToastItem["tone"], title: string, detail?: string) => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-3), { id, title, detail, tone }]);
    window.setTimeout(
      () => setItems((prev) => prev.filter((t) => t.id !== id)),
      tone === "problem" ? 9000 : 4500,
    );
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      done: (title, detail) => push("done", title, detail),
      problem: (title, detail) => push("problem", title, detail),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "problem" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto animate-[fade-in_150ms_var(--ease-out)] rounded-md border bg-surface px-3.5 py-2.5 shadow-overlay",
              t.tone === "problem" ? "border-red" : "border-transparent",
            )}
          >
            <p className={cn("text-base font-bold", t.tone === "problem" ? "text-red" : "text-ink")}>{t.title}</p>
            {t.detail ? <p className="mt-0.5 text-sm text-ink-2">{t.detail}</p> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside ToastProvider");
  return api;
}
