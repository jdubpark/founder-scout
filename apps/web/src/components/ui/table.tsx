import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "../../lib/cn";

/** Wraps a table so a wide one scrolls inside its own box instead of the page. */
export function TableScroll({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-w-0 overflow-x-auto", className)}>{children}</div>;
}

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full text-left text-base", className)} {...rest} />;
}

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  /** Makes the header a sort button. */
  sort?: { active: boolean; direction: "asc" | "desc"; onSort: () => void };
}

export function Th({ numeric, sort, className, children, ...rest }: ThProps) {
  const ariaSort = sort ? (sort.active ? (sort.direction === "asc" ? "ascending" : "descending") : "none") : undefined;
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        "label-caps border-b border-rule px-2 py-2 whitespace-nowrap first:pl-0 last:pr-0",
        numeric && "text-right",
        className,
      )}
      {...rest}
    >
      {sort ? (
        <button
          type="button"
          onClick={sort.onSort}
          className={cn(
            "inline-flex items-center gap-1 font-bold hover:text-ink",
            sort.active && "text-ink",
          )}
        >
          {children}
          {sort.active ? (
            sort.direction === "asc" ? (
              <ArrowUp className="size-3" aria-hidden />
            ) : (
              <ArrowDown className="size-3" aria-hidden />
            )
          ) : null}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
  /** Rows that open something get a hover state and a pointer. */
  interactive?: boolean;
}

export function Tr({ selected, interactive, className, ...rest }: TrProps) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        "border-b border-rule",
        interactive && "cursor-pointer transition-colors duration-150 hover:bg-sunk",
        selected && "bg-green-tint hover:bg-green-tint",
        className,
      )}
      {...rest}
    />
  );
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export function Td({ numeric, className, ...rest }: TdProps) {
  return (
    <td
      className={cn("px-2 py-2.5 align-middle first:pl-0 last:pr-0", numeric && "figure text-right whitespace-nowrap", className)}
      {...rest}
    />
  );
}
