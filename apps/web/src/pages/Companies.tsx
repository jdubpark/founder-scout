import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import type { CompanySort, CompanyStatus } from "@agentswarm/shared";
import { Button } from "../components/ui/Button";
import { Input, Segmented, Select, type SegmentedOption } from "../components/ui/Field";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "../components/ui/layout";
import { TableScroll } from "../components/ui/table";
import { CompanyTable } from "../features/companies/CompanyTable";
import { COMPANY_SORT_OPTIONS } from "../features/companies/labels";
import { useCompanyListState, type CompanyStatusView } from "../features/companies/listState";
import { useCompanies } from "../lib/queries";
import { useSwarm } from "../lib/swarm";

/** Enough to hold every company in one view, so the list needs no paging. */
const LIST_LIMIT = 200;

const STATUS_TABS: Array<SegmentedOption<CompanyStatusView>> = [
  { value: "surfaced", label: "Waiting" },
  { value: "needs_evidence", label: "More evidence" },
  { value: "watch", label: "Watching" },
  { value: "passed", label: "Passed" },
  { value: "all", label: "All" },
];

export default function CompaniesPage() {
  const { swarmId, loading: swarmLoading, error: swarmError } = useSwarm();
  const { state, setFilters } = useCompanyListState();

  const q = state.q.trim() || undefined;
  const list = useCompanies(
    swarmId
      ? {
          swarmId,
          status: state.status,
          q,
          sort: state.sort,
          limit: LIST_LIMIT,
          offset: 0,
        }
      : null,
  );

  // Counts come from the unfiltered list, so one query serves every tab.
  const counts = list.data?.counts ?? {};
  const total = Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const options: Array<SegmentedOption<CompanyStatusView>> = STATUS_TABS.map((tab) => ({
    ...tab,
    count: tab.value === "all" ? total : (counts[tab.value as CompanyStatus] ?? 0),
  }));

  // Search waits 250 ms after the last keystroke before it changes the URL.
  const [text, setText] = useState(state.q);
  const urlQ = useRef(state.q);
  urlQ.current = state.q;
  useEffect(() => {
    setText(state.q);
  }, [state.q]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (text.trim() !== urlQ.current.trim()) setFilters({ q: text });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [text, setFilters]);

  if (swarmError) {
    return (
      <>
        <PageHeader title="Companies" />
        <ErrorNote title="The swarm could not be read">{swarmError.message}</ErrorNote>
      </>
    );
  }
  if (!swarmId) {
    return swarmLoading ? (
      <SkeletonRows rows={8} />
    ) : (
      <EmptyState title="No swarm yet">Create a swarm to start finding companies.</EmptyState>
    );
  }

  const rows = list.data?.rows ?? [];
  const clear = () => {
    setText("");
    setFilters({ status: "all", q: "" });
  };

  return (
    <>
      <PageHeader
        title="Companies"
        actions={
          <>
            <div className="relative w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input
                type="search"
                aria-label="Search companies"
                value={text}
                placeholder="Search"
                onChange={(event) => setText(event.target.value)}
                className="pl-8"
              />
            </div>
            <div className="w-40">
              <Select
                aria-label="Sort by"
                value={state.sort}
                onChange={(event) => setFilters({ sort: event.target.value as CompanySort })}
              >
                {COMPANY_SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <Segmented
          label="Status"
          value={state.status}
          options={options}
          onChange={(status) => setFilters({ status })}
        />

        {list.error ? (
          <ErrorNote title="The companies could not be loaded">{list.error.message}</ErrorNote>
        ) : list.isPending || !list.data ? (
          <SkeletonRows rows={10} />
        ) : rows.length === 0 ? (
          total === 0 ? (
            <EmptyState title="No companies yet" action={<Link to="/" className="text-sm font-bold text-navy hover:underline">Overview</Link>} />
          ) : (
            <EmptyState
              title="No matches"
              action={
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          )
        ) : (
          <TableScroll>
            <CompanyTable rows={rows} />
          </TableScroll>
        )}
      </div>
    </>
  );
}

