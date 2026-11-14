import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { FounderSort, FounderStatus } from "@agentswarm/shared";
import { STATUS_VIEW } from "../../lib/stages";

export const PAGE_SIZE = 50;

export const SORT_OPTIONS: ReadonlyArray<{ value: FounderSort; label: string }> = [
  { value: "composite", label: "Overall" },
  { value: "cracked", label: "Engineering" },
  { value: "fit", label: "Thesis fit" },
  { value: "recent", label: "Most recent" },
];

/** A view of the list that is not a founder status: every founder with no partner call yet. */
export const WAITING = "waiting" as const;

export type StatusView = FounderStatus | "all" | typeof WAITING;

export interface FounderListState {
  status: StatusView;
  q: string;
  sort: FounderSort;
  page: number;
}

/** With no status in the URL, the list opens on the founders waiting for a call. */
function parseStatus(value: string | null): StatusView {
  if (value === null) return WAITING;
  if (value === "all" || value === WAITING) return value;
  return Object.prototype.hasOwnProperty.call(STATUS_VIEW, value) ? (value as FounderStatus) : WAITING;
}

function parseSort(value: string | null): FounderSort {
  return SORT_OPTIONS.find((o) => o.value === value)?.value ?? "composite";
}

function parsePage(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function write(next: URLSearchParams, key: string, value: string | null) {
  if (value === null || value === "") next.delete(key);
  else next.set(key, value);
}

/** The list's filters live in the URL, so a shared or reloaded link shows the same list. */
export function useFounderListState() {
  const [params, setParams] = useSearchParams();

  const state: FounderListState = {
    status: parseStatus(params.get("status")),
    q: params.get("q") ?? "",
    sort: parseSort(params.get("sort")),
    page: parsePage(params.get("page")),
  };

  const setFilters = useCallback(
    (patch: Partial<FounderListState>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (patch.status !== undefined) {
            // The default view is kept out of the URL; "all" is written so it survives a reload.
            write(next, "status", patch.status === WAITING ? null : patch.status);
          }
          if (patch.q !== undefined) write(next, "q", patch.q.trim() ? patch.q : null);
          if (patch.sort !== undefined) write(next, "sort", patch.sort === "composite" ? null : patch.sort);
          if (patch.page !== undefined) write(next, "page", patch.page <= 1 ? null : String(patch.page));
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { state, setFilters };
}
