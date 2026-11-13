import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import type { FounderSort, FounderStatus, FounderRow } from "@agentswarm/shared";
import { Button } from "../components/ui/Button";
import { Input, Segmented, Select, type SegmentedOption } from "../components/ui/Field";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "../components/ui/layout";
import { TableScroll } from "../components/ui/table";
import { BarPanel, BAR_PARAM, COVERAGE_PARAM, wouldSurface } from "../features/founders/BarPanel";
import { AddFounder } from "../features/founders/AddFounder";
import { FounderTable } from "../features/founders/FounderTable";
import { PAGE_SIZE, SORT_OPTIONS, WAITING, useFounderListState } from "../features/founders/listState";
import { count } from "../lib/format";
import { STATUS_VIEW } from "../lib/stages";
import { useEffectiveSteering, useFounders } from "../lib/queries";
import { useSwarm } from "../lib/swarm";

/** Shown as filters in this order, then any other status that has founders. */
const CORE_STATUSES: FounderStatus[] = ["surfaced", "needs_evidence", "watch", "passed", "screened_out"];
const OTHER_STATUSES: FounderStatus[] = ["lead", "queued", "contacted", "meeting", "archived"];

/** Enough to hold every surfaced founder on one page, so the waiting view needs no paging. */
const WAITING_LIMIT = 200;
/** Enough to count every scored founder against a bar that is being tried. */
const PREVIEW_LIMIT = 500;

function numberParam(params: ReadonlyArray<{ key: string; value: unknown }>, key: string): number | null {
  const found = params.find((p) => p.key === key);
  return found && typeof found.value === "number" ? found.value : null;
}

export default function FoundersPage() {
  const { swarmId, loading: swarmLoading, error: swarmError } = useSwarm();
  const { state, setFilters } = useFounderListState();
  const steering = useEffectiveSteering(swarmId ? { swarmId } : null);

  const waiting = state.status === WAITING;
  const q = state.q.trim() || undefined;

  // Surfaced founders, unpaged, for the "Waiting for your call" count and view.
  const surfaced = useFounders(
    swarmId
      ? { swarmId, status: "surfaced", q: waiting ? q : undefined, sort: state.sort, limit: WAITING_LIMIT, offset: 0 }
      : null,
  );

  const paged = useFounders(
    swarmId && !waiting
      ? {
          swarmId,
          status: state.status === WAITING ? "all" : state.status,
          q,
          sort: state.sort,
          limit: PAGE_SIZE,
          offset: (state.page - 1) * PAGE_SIZE,
        }
      : null,
  );

  // The counts for every filter come from the unfiltered list, so one query serves them.
  const counts = (paged.data ?? surfaced.data)?.counts ?? {};
  const waitingCount = (surfaced.data?.rows ?? []).filter((r) => r.feedback === null).length;
  const total = Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);

  // The waiting view is the surfaced founders with no call yet, shown without paging.
  const waitingRows: FounderRow[] = surfaced.data?.rows.filter((r) => r.feedback === null) ?? [];
  const data = waiting
    ? surfaced.data && { rows: waitingRows, total: waitingRows.length, counts: surfaced.data.counts }
    : paged.data;
  const loading = waiting ? surfaced.isPending : paged.isPending;
  const failure = waiting ? surfaced.error : paged.error;

  // The bar is a swarm setting, read from its steering. The table marks founders against the previewed bar.
  const [draft, setDraft] = useState<number | null>(null);
  // Every founder, read only while a new bar is being tried, so the readout counts the whole swarm.
  const everyone = useFounders(
    swarmId && draft !== null
      ? { swarmId, status: "all", sort: "composite", limit: PREVIEW_LIMIT, offset: 0 }
      : null,
  );

  // Search waits 250 ms after the last keystroke before it changes the URL.
  const [text, setText] = useState(state.q);
  const urlQ = useRef(state.q);
  urlQ.current = state.q;
  useEffect(() => {
    setText(state.q);
  }, [state.q]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (text.trim() !== urlQ.current.trim()) setFilters({ q: text, page: 1 });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [text, setFilters]);

  if (swarmError) {
    return (
      <>
        <PageHeader title="Founders" />
        <ErrorNote title="The swarm could not be read">{swarmError.message}</ErrorNote>
      </>
    );
  }
  if (!swarmId) {
    return swarmLoading ? (
      <SkeletonRows rows={8} />
    ) : (
      <EmptyState title="No swarm yet">Create a swarm to start finding founders.</EmptyState>
    );
  }

  const statusOptions: SegmentedOption<StatusFilter>[] = [
    { value: WAITING, label: "Waiting for your call", count: waitingCount },
    { value: "all", label: "All", count: total },
    ...CORE_STATUSES.map((s) => ({ value: s, label: STATUS_VIEW[s].label, count: counts[s] ?? 0 })),
    ...OTHER_STATUSES.filter((s) => (counts[s] ?? 0) > 0).map((s) => ({
      value: s,
      label: STATUS_VIEW[s].label,
      count: counts[s] ?? 0,
    })),
  ];

  const offset = waiting ? 0 : (state.page - 1) * PAGE_SIZE;
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const savedBar = numberParam(steering.data?.params ?? [], BAR_PARAM);
  const minCoverage = numberParam(steering.data?.params ?? [], COVERAGE_PARAM);
  const previewing = draft !== null && minCoverage !== null;
  const threshold = savedBar === null ? undefined : (draft ?? Math.round(savedBar * 100)) / 100;
  const marks =
    previewing && minCoverage !== null
      ? new Set(rows.filter((row) => wouldSurface(row, (draft ?? 0) / 100, minCoverage)).map((row) => row.id))
      : null;

  const clear = () => {
    setText("");
    setFilters({ status: "all", q: "", page: 1 });
  };

  return (
    <>
      <PageHeader
        title="Founders"
        actions={
          <>
            <AddFounder swarmId={swarmId} />
            <div className="relative w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input
                type="search"
                aria-label="Search founders"
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
                onChange={(event) => setFilters({ sort: event.target.value as FounderSort, page: 1 })}
              >
                {SORT_OPTIONS.map((o) => (
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
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Segmented
            label="Status"
            value={state.status}
            options={statusOptions}
            onChange={(status) => setFilters({ status, page: 1 })}
          />
          {steering.error ? (
            <p role="alert" className="text-sm text-red">The bar could not be read</p>
          ) : steering.data && savedBar !== null && minCoverage !== null ? (
            <BarPanel
              swarmId={swarmId}
              rows={everyone.data?.rows ?? null}
              saved={savedBar}
              minCoverage={minCoverage}
              draft={draft}
              onDraft={setDraft}
            />
          ) : null}
        </div>

        {failure ? (
          <ErrorNote title="The founders could not be loaded">{failure.message}</ErrorNote>
        ) : loading || !data ? (
          <SkeletonRows rows={10} />
        ) : rows.length === 0 ? (
          total === 0 ? (
            <EmptyState title="No founders yet" action={<Link to="/" className="text-sm font-bold text-navy hover:underline">Overview</Link>} />
          ) : waiting ? (
            <EmptyState
              title="All surfaced founders have a call"
              action={
                <Button variant="secondary" size="sm" onClick={() => setFilters({ status: "all", page: 1 })}>
                  Show all founders
                </Button>
              }
            />
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
          <>
            <TableScroll>
              <FounderTable rows={rows} threshold={threshold} wouldSurface={marks} />
            </TableScroll>

            {!waiting ? (
              <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t border-rule pt-3 text-sm">
                <p className="figure text-ink-2">
                  {`${count(offset + 1)}–${count(offset + rows.length)} of ${count(data.total)}`}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={state.page <= 1}
                    onClick={() => setFilters({ page: state.page - 1 })}
                    aria-label="Previous page"
                  >
                    Previous
                  </Button>
                  <span className="figure text-ink-2">{`${state.page} / ${pages}`}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={state.page >= pages}
                    onClick={() => setFilters({ page: state.page + 1 })}
                    aria-label="Next page"
                  >
                    Next
                  </Button>
                </div>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

type StatusFilter = FounderStatus | "all" | typeof WAITING;
