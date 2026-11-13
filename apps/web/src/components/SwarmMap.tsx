import { Fragment, type ReactNode } from "react";
import { ChevronRight, SlidersHorizontal, UserRound } from "lucide-react";
import {
  isClassId,
  isJobId,
  type ClassId,
  type ClassNode,
  type JobId,
  type JobNode,
  type NodeHealth,
  type RunStats,
  type SourceId,
  type StageId,
  type SwarmTreeDTO,
} from "@agentswarm/shared";
import { cn } from "../lib/cn";
import { ClassIcon, SourceIcon } from "./icons";
import { StateMark, healthMark } from "./ui/marks";

/** A point in the swarm that can be selected and steered. */
export type SwarmNodeRef =
  | { kind: "swarm" }
  | { kind: "class"; classId: ClassId }
  | { kind: "job"; jobId: JobId }
  | { kind: "agent"; agentId: string };

/** The `?node=` form: `swarm`, `class:scout`, `job:scout.github`, `agent:<id>`. */
export function nodeToParam(node: SwarmNodeRef): string {
  switch (node.kind) {
    case "swarm":
      return "swarm";
    case "class":
      return `class:${node.classId}`;
    case "job":
      return `job:${node.jobId}`;
    case "agent":
      return `agent:${node.agentId}`;
  }
}

export function paramToNode(text: string | null | undefined): SwarmNodeRef {
  if (!text) return { kind: "swarm" };
  const [kind, ...rest] = text.split(":");
  const id = rest.join(":");
  if (kind === "class" && isClassId(id)) return { kind: "class", classId: id };
  if (kind === "job" && isJobId(id)) return { kind: "job", jobId: id };
  if (kind === "agent" && id) return { kind: "agent", agentId: id };
  return { kind: "swarm" };
}

export function sameNode(a: SwarmNodeRef | null | undefined, b: SwarmNodeRef): boolean {
  return Boolean(a) && nodeToParam(a as SwarmNodeRef) === nodeToParam(b);
}

const JOB_SHORT: Record<JobId, string> = {
  "scout.hackernews": "Hacker News",
  "scout.github": "GitHub",
  "scout.research": "Research",
  "scout.talent": "Talent moves",
  "resolve.identity": "Identity",
  "screen.fit": "Thesis fit",
  "investigate.background": "Background",
  "investigate.code": "Code",
  "investigate.company": "Company",
  "investigate.media": "Talks",
  "investigate.redflags": "Risks",
  "verify.claims": "Claims",
  "assess.judgments": "Rubric",
  "assess.memo": "Memo",
  "outreach.plan": "Drafts",
  "call.founder": "Founder call",
  "call.reference": "Ref call",
  "call.debrief": "Debrief",
};

const SOURCE_SHORT: Partial<Record<SourceId, string>> = {
  hackernews: "Hacker News",
  github: "GitHub",
  arxiv: "arXiv",
  people_data: "Profiles",
};

/** Which class is working during each stage of a run. */
const STAGE_CLASS: Partial<Record<StageId, ClassId>> = {
  scout: "scout",
  resolve: "resolver",
  screen: "screener",
  investigate: "investigator",
  verify: "verifier",
  assess: "analyst",
  memo: "analyst",
  outreach: "outreach",
  debrief: "outreach",
};

/** What each class handed on in the last run, with its unit. */
function classFigure(classId: ClassId, stats: RunStats | null): { value: number; unit: string } | null {
  if (!stats) return null;
  switch (classId) {
    case "scout":
      return { value: stats.leads, unit: "leads" };
    case "resolver":
      return { value: stats.newFounders, unit: "founders" };
    case "screener":
      return { value: stats.screenedIn, unit: "in thesis" };
    case "investigator":
      return { value: stats.evidence, unit: "evidence" };
    case "verifier":
      return { value: stats.evidenceRejected, unit: "rejected" };
    case "analyst":
      return { value: stats.surfaced, unit: "surfaced" };
    case "outreach":
      return { value: stats.outreachProposed, unit: "drafts" };
  }
}

const HEALTH_WORD: Record<NodeHealth, string> = {
  ok: "working",
  warn: "needs attention",
  error: "failing",
  idle: "has not run",
  paused: "paused",
  planned: "not enabled yet",
};

export interface SwarmMapProps {
  tree: SwarmTreeDTO;
  /** The last run's totals, for the figure under each class. */
  stats: RunStats | null;
  selected?: SwarmNodeRef | null;
  onSelect?: (node: SwarmNodeRef) => void;
  /** The stage a run is in right now, which makes that class pulse. */
  activeStage?: StageId | null;
  /** Surfaced founders waiting for a yes or a no, shown at the end of the flow. */
  waiting?: number;
  /** Classes and figures only, without the job nodes. */
  compact?: boolean;
  className?: string;
}

/**
 * The swarm drawn as a flow, left to right: sources, the seven classes of
 * agent with each job as a node, and the partner at the end. Every class and
 * job is a button that selects it for steering. The figure under a class is
 * what it handed on in the last run.
 */
export function SwarmMap({
  tree,
  stats,
  selected,
  onSelect,
  activeStage,
  waiting,
  compact = false,
  className,
}: SwarmMapProps) {
  const activeClass = activeStage ? (STAGE_CLASS[activeStage] ?? null) : null;
  const interactive = Boolean(onSelect);

  const scoutJobs = tree.classes.find((c) => c.cls.id === "scout")?.jobs ?? [];
  const sources = scoutJobs
    .filter((j) => j.job.source)
    .map((j) => ({ source: j.job.source as SourceId, health: j.health }));

  return (
    <div className={cn("min-w-0 overflow-x-auto", className)}>
      <div className={cn("flex items-stretch", compact ? "min-w-[40rem]" : "min-w-[66rem]")}>
        <Column
          header={<ColumnTitle icon={<DatabaseGlyph />} label="Sources" compact={compact} />}
          figure={stats ? { value: stats.rawItems, unit: "items" } : null}
          compact={compact}
          width="w-[7rem]"
        >
          {sources.map((s) => (
            <div
              key={s.source}
              className="flex h-7 min-w-0 items-center gap-1.5 px-1.5 text-sm text-ink-2"
              title={`${SOURCE_SHORT[s.source] ?? s.source}: ${HEALTH_WORD[s.health]}`}
            >
              <SourceIcon source={s.source} className="size-3.5 text-ink-3" />
              <span className="truncate">{SOURCE_SHORT[s.source] ?? s.source}</span>
              {s.health === "paused" || s.health === "planned" ? (
                <StateMark state={healthMark(s.health)} className="ml-auto" />
              ) : null}
            </div>
          ))}
        </Column>

        {tree.classes.map((c) => (
          <Fragment key={c.cls.id}>
            <Arrow />
            <ClassColumn
              node={c}
              figure={classFigure(c.cls.id, stats)}
              running={activeClass === c.cls.id}
              selected={selected ?? null}
              onSelect={onSelect}
              interactive={interactive}
              compact={compact}
            />
          </Fragment>
        ))}

        <Arrow />
        <Column
          header={<ColumnTitle icon={<UserRound aria-hidden className="size-4 shrink-0" />} label="You" compact={compact} />}
          figure={waiting === undefined ? null : { value: waiting, unit: "to call" }}
          compact={compact}
          tone="gold"
          width="w-[5.5rem]"
        >
          <div className="flex h-7 items-center px-1.5 text-sm text-ink-2">Yes or no</div>
          <div className="flex h-7 items-center px-1.5 text-sm text-ink-2">Approve</div>
        </Column>
      </div>
    </div>
  );
}

function DatabaseGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <ellipse cx="8" cy="3.5" rx="5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function Arrow() {
  return (
    <div className="flex w-3.5 shrink-0 items-start justify-center pt-2.5 text-rule-strong" aria-hidden>
      <ChevronRight className="size-3.5" />
    </div>
  );
}

/** In the full map the title is one line; in the compact map the label sits under the icon so it never truncates. */
function titleClass(compact: boolean): string {
  return compact
    ? "flex min-h-[3.25rem] w-full min-w-0 flex-col items-center justify-center gap-1 px-1 py-1.5 text-center text-xs leading-tight font-semibold text-ink"
    : "flex h-9 w-full min-w-0 items-center gap-1.5 px-1.5 text-left text-sm font-semibold text-ink";
}

function ColumnTitle({ icon, label, compact }: { icon: ReactNode; label: string; compact: boolean }) {
  return (
    <div className={titleClass(compact)}>
      {icon}
      <span className={compact ? undefined : "truncate"}>{label}</span>
    </div>
  );
}

function Figure({
  figure,
  tone,
  compact,
  trailing,
}: {
  figure: { value: number; unit: string } | null;
  tone?: "gold";
  compact: boolean;
  /** Shown at the right of the figure row in the full map. */
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 border-t border-rule px-1.5",
        compact ? "flex-col items-center py-1 text-center" : "h-9 items-baseline gap-1 pt-1.5",
      )}
    >
      {figure ? (
        <>
          <span className={cn("figure text-md font-semibold", tone === "gold" ? "text-gold-ink" : "text-ink")}>
            {figure.value.toLocaleString("en-US")}
          </span>
          <span className="truncate text-xs text-ink-3">{figure.unit}</span>
        </>
      ) : (
        <span className="text-xs text-ink-3">No run yet</span>
      )}
      {trailing && !compact ? <span className="ml-auto shrink-0 self-center">{trailing}</span> : null}
    </div>
  );
}

/** The two end columns (sources and the partner). Narrower than a class column. */
function Column({
  header,
  figure,
  children,
  compact,
  tone,
  width,
}: {
  header: ReactNode;
  figure: { value: number; unit: string } | null;
  children: ReactNode;
  compact: boolean;
  tone?: "gold";
  /** Width class in the full map. */
  width: string;
}) {
  return (
    <div className={cn("flex min-w-0 shrink-0 flex-col border border-rule bg-surface", compact ? "w-[4.75rem]" : width)}>
      {header}
      {compact ? null : <div className="flex flex-1 flex-col gap-1 border-t border-rule px-1 py-1.5">{children}</div>}
      <Figure figure={figure} tone={tone} compact={compact} />
    </div>
  );
}

function ClassColumn({
  node,
  figure,
  running,
  selected,
  onSelect,
  interactive,
  compact,
}: {
  node: ClassNode;
  figure: { value: number; unit: string } | null;
  running: boolean;
  selected: SwarmNodeRef | null;
  onSelect?: (node: SwarmNodeRef) => void;
  interactive: boolean;
  compact: boolean;
}) {
  const ref: SwarmNodeRef = { kind: "class", classId: node.cls.id };
  const isSelected = sameNode(selected, ref);
  const mark = running ? "running" : healthMark(node.health);
  const steered = node.directiveCount > 0;

  const headerInner = (
    <>
      <span className="relative shrink-0">
        <ClassIcon classId={node.cls.id} className={isSelected ? "text-green" : "text-ink-2"} />
        <StateMark state={mark} className="absolute -top-1 -right-1.5 size-2" />
      </span>
      <span className={compact ? undefined : "truncate pl-0.5"}>{node.cls.label}</span>
    </>
  );
  const headerClass = cn(
    titleClass(compact),
    interactive && "transition-colors duration-150 hover:bg-ground",
    isSelected && "bg-green-tint hover:bg-green-tint",
  );
  const label = `${node.cls.label}: ${running ? "working now" : HEALTH_WORD[node.health]}${
    steered ? `, ${node.directiveCount} steering attached` : ""
  }`;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 basis-0 flex-col border bg-surface",
        isSelected ? "border-green-2" : "border-rule",
      )}
    >
      {interactive ? (
        <button type="button" className={headerClass} aria-pressed={isSelected} aria-label={label} title={node.cls.description} onClick={() => onSelect?.(ref)}>
          {headerInner}
        </button>
      ) : (
        <div className={headerClass} title={node.cls.description} aria-label={label}>
          {headerInner}
        </div>
      )}
      {compact ? null : (
        <div className="flex flex-1 flex-col gap-1 border-t border-rule px-1 py-1.5">
          {node.jobs.map((j) => (
            <JobButton key={j.job.id} job={j} selected={selected} onSelect={onSelect} interactive={interactive} />
          ))}
        </div>
      )}
      <Figure
        figure={figure}
        tone={node.cls.id === "analyst" ? "gold" : undefined}
        compact={compact}
        trailing={steered ? <Steered count={node.directiveCount} /> : undefined}
      />
    </div>
  );
}

function Steered({ count }: { count: number }) {
  return (
    <span className="figure inline-flex items-center gap-0.5 text-2xs font-semibold text-green-2" title={`${count} steering attached here`}>
      <SlidersHorizontal className="size-3" aria-hidden />
      {count}
    </span>
  );
}

function JobButton({
  job,
  selected,
  onSelect,
  interactive,
}: {
  job: JobNode;
  selected: SwarmNodeRef | null;
  onSelect?: (node: SwarmNodeRef) => void;
  interactive: boolean;
}) {
  const ref: SwarmNodeRef = { kind: "job", jobId: job.job.id };
  const isSelected = sameNode(selected, ref);
  const planned = job.health === "planned";
  const steering = job.directiveCount + job.agents.reduce((sum, a) => sum + a.directiveCount, 0);
  const label = `${job.job.label}: ${HEALTH_WORD[job.health]}${steering ? `, ${steering} steering attached` : ""}`;

  const inner = (
    <>
      <StateMark state={healthMark(job.health)} />
      <span className="truncate">{JOB_SHORT[job.job.id]}</span>
      {steering > 0 ? (
        <span className="ml-auto shrink-0">
          <Steered count={steering} />
        </span>
      ) : null}
    </>
  );
  const cls = cn(
    "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-sm border px-1.5 text-left text-sm",
    planned ? "border-dashed border-rule-strong text-ink-3" : "border-rule text-ink",
    interactive && "transition-colors duration-150 hover:border-ink-3 hover:bg-ground",
    isSelected && "border-green-2 bg-green-tint hover:border-green-2 hover:bg-green-tint",
  );

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {interactive ? (
        <button type="button" className={cls} aria-pressed={isSelected} aria-label={label} title={job.job.description} onClick={() => onSelect?.(ref)}>
          {inner}
        </button>
      ) : (
        <div className={cls} title={job.job.description} aria-label={label}>
          {inner}
        </div>
      )}
      {job.agents.length > 1 ? (
        <div className="flex flex-wrap gap-0.5 pl-3" role="group" aria-label={`${job.job.label} agents`}>
          {job.agents.map((a, i) => {
            const agentRef: SwarmNodeRef = { kind: "agent", agentId: a.agent.id };
            const on = sameNode(selected, agentRef);
            const chip = cn(
              "figure inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-sm border px-1 text-2xs font-semibold",
              on ? "border-green-2 bg-green-tint text-green" : "border-rule text-ink-2",
              interactive && "hover:border-ink-3",
            );
            const title = `${a.agent.name}${a.agent.beat ? `: ${a.agent.beat}` : ""} (${HEALTH_WORD[a.health]})`;
            return interactive ? (
              <button key={a.agent.id} type="button" className={chip} aria-pressed={on} aria-label={title} title={title} onClick={() => onSelect?.(agentRef)}>
                {a.health === "paused" ? <StateMark state="paused" className="size-2" /> : null}
                {i + 1}
              </button>
            ) : (
              <span key={a.agent.id} className={chip} title={title}>
                {i + 1}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
