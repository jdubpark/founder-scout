import { NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  ClipboardCheck,
  Compass,
  LineChart,
  Network,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { getStage } from "../../lib/stages";
import { useApi } from "../../lib/api/context";
import { cn } from "../../lib/cn";
import { until } from "../../lib/format";
import { useOverview, useSettings } from "../../lib/queries";
import { useSwarm } from "../../lib/swarm";
import { EmptyState, ErrorNote, Skeleton } from "../ui/layout";
import { StateMark } from "../ui/marks";

const NAV = [
  { to: "/", label: "Overview", icon: Compass, end: true },
  { to: "/founders", label: "Founders", icon: Users },
  { to: "/swarm", label: "Swarm", icon: Network },
  { to: "/steering", label: "Steering", icon: SlidersHorizontal },
  { to: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { to: "/improve", label: "Improve", icon: LineChart },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

/** What the swarm is doing right now, in one line at the foot of the rail. */
function RunStatus() {
  const { swarmId } = useSwarm();
  const overview = useOverview(swarmId);
  const settings = useSettings();

  if (settings.data?.settings.killSwitch) {
    return (
      <p className="flex items-center gap-2 text-sm text-on-green">
        <StateMark state="paused" className="text-gold" />
        All runs stopped
      </p>
    );
  }
  const active = overview.data?.activeRun;
  if (active) {
    return (
      <p className="flex items-center gap-2 text-sm text-on-green">
        <StateMark state="running" className="text-gold" />
        Running: {active.stage ? getStage(active.stage).label : "starting"}
      </p>
    );
  }
  const next = overview.data?.nextRunAt ?? settings.data?.nextRunAt ?? null;
  return (
    <p className="flex items-center gap-2 text-sm text-on-green-2">
      <StateMark state="idle" className="text-on-green-2" />
      {next ? `Next run ${until(next)}` : "No run scheduled"}
    </p>
  );
}

function Rail() {
  const { swarms, swarmId, select } = useSwarm();
  const overview = useOverview(swarmId);
  const { demo, demoNote } = useApi();
  const pending = overview.data?.today.pendingApprovals ?? 0;

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col bg-green text-on-green",
        "max-lg:sticky max-lg:top-0 max-lg:z-30",
        "lg:sticky lg:top-0 lg:h-dvh lg:w-[13.5rem]",
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 lg:flex-col lg:items-stretch">
        <p className="name-caps text-md text-on-green">Founder Scout</p>
        <label className="flex min-w-0 flex-col gap-1 lg:mt-2">
          <span className="text-2xs font-semibold tracking-[0.07em] text-on-green-2 uppercase max-lg:sr-only">
            Swarm
          </span>
          <select
            value={swarmId ?? ""}
            onChange={(e) => select(e.target.value)}
            disabled={swarms.length === 0}
            className={cn(
              "on-rail h-8 min-w-0 cursor-pointer rounded-sm border border-on-green-2/40 bg-green-deep px-2 text-sm text-on-green",
              "hover:border-on-green-2 max-lg:max-w-[11rem]",
            )}
          >
            {swarms.length === 0 ? <option value="">No swarm yet</option> : null}
            {swarms.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <nav aria-label="Main" className="min-w-0 max-lg:overflow-x-auto lg:flex-1 lg:overflow-y-auto">
        <ul className="m-0 flex list-none gap-0.5 p-0 px-2 max-lg:pb-2 lg:flex-col">
          {NAV.map((item) => (
            <li key={item.to} className="shrink-0">
              <NavLink
                to={item.to}
                end={"end" in item ? item.end : false}
                className={({ isActive }) =>
                  cn(
                    "on-rail flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-base no-underline transition-colors duration-150",
                    isActive
                      ? "bg-green-deep font-semibold text-on-green"
                      : "text-on-green-2 hover:bg-green-deep/60 hover:text-on-green",
                  )
                }
              >
                <item.icon className="size-4 shrink-0" aria-hidden />
                <span>{item.label}</span>
                {item.to === "/approvals" && pending > 0 ? (
                  <span
                    className="figure ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-gold px-1 text-xs font-bold text-green-deep"
                    aria-label={`${pending} waiting for you`}
                  >
                    {pending}
                  </span>
                ) : null}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-2 border-t border-on-green-2/25 px-4 py-3 max-lg:hidden">
        <RunStatus />
        {demo ? (
          <p className="text-2xs leading-snug font-semibold tracking-[0.05em] text-gold uppercase">
            {demoNote ?? "Simulated data"}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

/** The frame around every page: the green rail and the page area. */
export function AppShell() {
  const { swarm, loading, error } = useSwarm();
  const { demo, demoNote } = useApi();

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Rail />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[78rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {demo ? (
            <p className="mb-4 text-2xs font-semibold tracking-[0.05em] text-red uppercase lg:hidden">
              {demoNote ?? "Simulated data"}
            </p>
          ) : null}
          {error ? (
            <ErrorNote title="The dashboard could not reach the server">
              {error.message} Start it with <code className="font-mono text-sm">pnpm dev</code>, then reload this page.
            </ErrorNote>
          ) : loading ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-9 w-64" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : swarm ? (
            <Outlet />
          ) : (
            <EmptyState title="No swarm exists yet">
              A swarm is one investment thesis with its own agents, budget and steering. Create the first one in
              Settings.
            </EmptyState>
          )}
        </div>
      </main>
    </div>
  );
}
