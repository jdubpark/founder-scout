import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/cn";

const CONTROL =
  "w-full rounded-sm border border-rule-strong bg-surface px-2.5 text-base text-ink placeholder:text-ink-3 " +
  "transition-colors duration-150 hover:border-ink-3 focus-visible:border-green-2 " +
  "disabled:cursor-not-allowed disabled:bg-sunk disabled:text-ink-3 aria-[invalid=true]:border-red";

export interface FieldProps {
  label: string;
  /** One line under the label that explains what the value does. */
  hint?: ReactNode;
  /** Problem and how to fix it. Shown in place of the hint. */
  error?: string | null;
  /** Render function receives the ids to wire the control for assistive technology. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

/** A labelled form control with its hint or error. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const hasNote = Boolean(error || hint);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children({ id, describedBy: hasNote ? noteId : undefined, invalid: Boolean(error) })}
      {hasNote ? (
        <p id={noteId} className={cn("text-sm", error ? "text-red" : "text-ink-3")}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(CONTROL, "resize-y py-2 leading-snug", className)} {...rest} />;
  },
);

/** The platform's own select, styled to match. Familiar on every device. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(CONTROL, "h-9 cursor-pointer pr-7", className)} {...rest}>
      {children}
    </select>
  );
});

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible text beside the switch. */
  label: string;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onCheckedChange, label, disabled, id }: SwitchProps) {
  const fallbackId = useId();
  const switchId = id ?? fallbackId;
  return (
    <div className="flex items-center gap-2.5">
      <SwitchPrimitive.Root
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          "relative h-5 w-9 shrink-0 cursor-pointer rounded-full border border-rule-strong bg-sunk",
          "transition-colors duration-150 data-[state=checked]:border-green-2 data-[state=checked]:bg-green-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "block size-3.5 translate-x-0.5 rounded-full bg-ink-3 transition-transform duration-150",
            "data-[state=checked]:translate-x-[1.125rem] data-[state=checked]:bg-on-green",
          )}
        />
      </SwitchPrimitive.Root>
      <label htmlFor={switchId} className="cursor-pointer text-base text-ink select-none">
        {label}
      </label>
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional count shown after the label. */
  count?: number;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  /** Names the group for assistive technology. */
  label: string;
  className?: string;
}

/** A small set of mutually exclusive filters, shown all at once. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex flex-wrap gap-px bg-rule-strong p-px rounded-sm", className)}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "h-7 px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
              selected ? "bg-green-2 text-on-green" : "bg-surface text-ink-2 hover:bg-ground hover:text-ink",
            )}
          >
            {opt.label}
            {opt.count !== undefined ? (
              <span className={cn("figure ml-1.5", selected ? "text-on-green-2" : "text-ink-3")}>{opt.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
