import { Link, NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  Building2,
  ClipboardCheck,
  Hash,
  House,
  LineChart,
  ListChecks,
  Network,
  Plus,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { getStage } from "../../lib/stages";
import { useApi } from "../../lib/api/context";
import { cn } from "../../lib/cn";
import { until } from "../../lib/format";
import { useOverview, useSettings } from "../../lib/queries";
import { useSwarm } from "../../lib/swarm";
import { EmptyState, ErrorNote, Skeleton } from "../ui/layout";
import { StateMark } from "../ui/marks";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Daily work first, then the pages for running the swarm. */
const WORK: NavItem[] = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/founders", label: "Founders", icon: Users },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/approvals", label: "Approvals", icon: ClipboardCheck },
];

const MANAGE: NavItem[] = [
  { to: "/swarm", label: "Swarm", icon: Network },
  { to: "/steering", label: "Steering", icon: SlidersHorizontal },
  { to: "/improve", label: "Improve", icon: LineChart },
  { to: "/assumptions", label: "Assumptions", icon: ListChecks },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const ROW =
  "on-rail flex h-8 w-full min-w-0 items-center gap-2.5 rounded-sm px-2.5 text-left text-base no-underline transition-colors duration-150";
const ROW_IDLE = "text-on-rail-2 hover:bg-rail-hover hover:text-on-rail";
const ROW_ACTIVE = "bg-rail-active font-bold text-on-rail";

function Badge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      className="figure ml-auto inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red px-1 text-2xs font-black text-white"
      aria-label={`${count} ${label}`}
    >
      {count}
    </span>
  );
}

function NavRow({ item, badge }: { item: NavItem; badge?: { count: number; label: string } }) {
  return (
    <li>
      <NavLink to={item.to} end={item.end} className={({ isActive }) => cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE)}>
        <item.icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{item.label}</span>
        {badge ? <Badge count={badge.count} label={badge.label} /> : null}
      </NavLink>
    </li>
  );
}

function SectionLabel({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <div className="mt-4 mb-1 flex h-7 items-center justify-between px-2.5">
      <p className="text-sm font-bold text-on-rail-2">{children}</p>
      {action}
    </div>
  );
}

/** What the swarm is doing right now, in one line at the foot of the sidebar. */
function RunStatus() {
  const { swarmId } = useSwarm();
  const overview = useOverview(swarmId);
  const settings = useSettings();

  let mark: "paused" | "running" | "idle" = "idle";
  let text: string;
  if (settings.data?.settings.killSwitch) {
    mark = "paused";
    text = "All runs stopped";
  } else if (overview.data?.activeRun) {
    mark = "running";
    const stage = overview.data.activeRun.stage;
    text = `Running: ${stage ? getStage(stage).label : "starting"}`;
  } else {
    const next = overview.data?.nextRunAt ?? settings.data?.nextRunAt ?? null;
    text = next ? `Next run ${until(next)}` : "No run scheduled";
  }
  return (
    <p className="flex items-center gap-2 px-2.5 text-sm text-on-rail-2">
      <StateMark state={mark} className={mark === "running" ? "text-green-3" : "text-on-rail-2"} />
      {text}
    </p>
  );
}

function Sidebar() {
  const { swarms, swarmId, select } = useSwarm();
  const overview = useOverview(swarmId);
  const { demo } = useApi();
  const pending = overview.data?.today.pendingApprovals ?? 0;
  const waiting = overview.data?.calls.waiting ?? 0;
  const companiesWaiting = overview.data?.companiesWaiting ?? 0;

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-rail text-on-rail lg:sticky lg:top-0 lg:h-dvh">
      <div className="flex h-12 items-center border-b border-white/10 px-4">
        <p className="truncate text-lg font-black text-on-rail">Founder Scout</p>
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          <NavRow item={WORK[0]!} />
          <NavRow item={WORK[1]!} badge={{ count: waiting, label: "founders waiting for your call" }} />
          <NavRow item={WORK[2]!} badge={{ count: companiesWaiting, label: "companies waiting for your call" }} />
          <NavRow item={WORK[3]!} badge={{ count: pending, label: "drafts waiting for approval" }} />
        </ul>

        <SectionLabel
          action={
            <Link
              to="/settings"
              aria-label="New swarm"
              title="New swarm"
              className="on-rail inline-flex size-6 items-center justify-center rounded-sm text-on-rail-2 hover:bg-rail-hover hover:text-on-rail"
            >
              <Plus className="size-4" aria-hidden />
            </Link>
          }
        >
          Swarms
        </SectionLabel>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {swarms.map((s) => {
            const active = s.id === swarmId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => select(s.id)}
                  // The current page is the one blue row; the current swarm is bold on a quiet fill.
                  className={cn(ROW, active ? "bg-rail-hover font-black text-on-rail" : ROW_IDLE)}
                >
                  <Hash className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{s.name}</span>
                  {s.status === "paused" ? <StateMark state="paused" className="ml-auto text-on-rail-2" /> : null}
                </button>
              </li>
            );
          })}
        </ul>

        <SectionLabel>Manage</SectionLabel>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {MANAGE.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-2 border-t border-white/10 px-2 py-3">
        <RunStatus />
        {/* Shown in the demo, and on a real server whenever the swarm's last run was a simulation. */}
        {demo || overview.data?.lastRun?.brain === "sim" || overview.data?.lastRun?.sources === "sim" ? (
          <p className="mx-2.5 rounded-sm bg-gold px-2 py-1 text-center text-xs font-black text-ink">Simulated data</p>
        ) : null}
      </div>
    </aside>
  );
}

/** The frame around every page: the sidebar and the page area. */
export function AppShell() {
  const { swarm, loading, error } = useSwarm();

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[76rem] px-8 py-6">
          {error ? (
            <ErrorNote title="The dashboard could not reach the server">
              {error.message} Start it with <code className="font-mono text-sm">pnpm dev</code>, then reload.
            </ErrorNote>
          ) : loading ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-9 w-64" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : swarm ? (
            <Outlet />
          ) : (
            <EmptyState title="No swarm yet" action={<Link to="/settings" className="font-bold text-navy">Create one</Link>} />
          )}
        </div>
      </main>
    </div>
  );
}
