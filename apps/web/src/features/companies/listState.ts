import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { CompanySort, CompanyStatus } from "@agentswarm/shared";
import { COMPANY_STATUS_VIEW } from "./labels";

/** The list opens on surfaced companies, the ones waiting for a call. */
export const DEFAULT_STATUS: CompanyStatus | "all" = "surfaced";

export type CompanyStatusView = CompanyStatus | "all";

export interface CompanyListState {
  status: CompanyStatusView;
  q: string;
  sort: CompanySort;
}

const SORTS: readonly CompanySort[] = ["deal", "company", "team", "recent"];

function parseStatus(value: string | null): CompanyStatusView {
  if (value === null) return DEFAULT_STATUS;
  if (value === "all") return "all";
  return Object.prototype.hasOwnProperty.call(COMPANY_STATUS_VIEW, value) ? (value as CompanyStatus) : DEFAULT_STATUS;
}

function parseSort(value: string | null): CompanySort {
  return SORTS.find((s) => s === value) ?? "deal";
}

function write(next: URLSearchParams, key: string, value: string | null) {
  if (value === null || value === "") next.delete(key);
  else next.set(key, value);
}

/** The list's filters live in the URL, so a shared or reloaded link shows the same list. */
export function useCompanyListState() {
  const [params, setParams] = useSearchParams();

  const state: CompanyListState = {
    status: parseStatus(params.get("status")),
    q: params.get("q") ?? "",
    sort: parseSort(params.get("sort")),
  };

  const setFilters = useCallback(
    (patch: Partial<CompanyListState>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (patch.status !== undefined) {
            write(next, "status", patch.status === DEFAULT_STATUS ? null : patch.status);
          }
          if (patch.q !== undefined) write(next, "q", patch.q.trim() ? patch.q : null);
          if (patch.sort !== undefined) write(next, "sort", patch.sort === "deal" ? null : patch.sort);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { state, setFilters };
}
