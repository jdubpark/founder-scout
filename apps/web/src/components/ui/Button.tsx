import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "quiet" | "caution";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows the busy label and blocks clicks while an action is in flight. */
  busy?: boolean;
  busyLabel?: string;
  icon?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-green-2 text-on-green border border-green-2 hover:bg-green hover:border-green active:bg-green-deep",
  secondary:
    "bg-surface text-ink border border-rule-strong hover:border-ink-3 hover:bg-ground active:bg-sunk",
  quiet: "bg-transparent text-ink-2 border border-transparent hover:bg-sunk hover:text-ink active:bg-rule",
  // Red is reserved for cautions, so the destructive button is outlined, never a red slab.
  caution: "bg-surface text-red border border-red hover:bg-red-tint active:bg-red-tint",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-sm gap-1.5",
  md: "h-9 px-3.5 text-base gap-2",
};

/** The one button shape used everywhere. `primary` appears at most once per view. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", busy = false, busyLabel, icon, className, children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm font-medium whitespace-nowrap select-none",
        "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {icon ? <span className="-ml-0.5 flex size-4 items-center justify-center [&>svg]:size-4">{icon}</span> : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: what the button does, for screen readers and the tooltip. */
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-2",
        "transition-colors duration-150 hover:bg-sunk hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
        "[&>svg]:size-4",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
