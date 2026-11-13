import { Fragment, type ReactNode } from "react";
import { ArrowDown, ChevronRight, Database, SlidersHorizontal, UserRound } from "lucide-react";
import {
  isClassId,
  isJobId,
  type ClassId,
  type ClassNode,
  type JobId,
  type JobNode,
  type NodeHealth,
  type RunStats,
  type StageId,
  type SwarmTreeDTO,
} from "@agentswarm/shared";
import { cn } from "../lib/cn";
import { ClassIcon } from "./icons";
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
  "hunt.navigate": "Navigate",
  "hunt.look": "Page reader",
  "hunt.sift": "Result sifter",
  "resolve.identity": "Identity",
  "screen.fit": "Thesis fit",
  "investigate.background": "Background",
  "investigate.code": "Code",
  "investigate.company": "Role",
  "investigate.media": "Talks",
  "investigate.redflags": "Risks",
  "company.product": "Product",
  "company.traction": "Traction",
  "company.team": "Team",
  "verify.claims": "Claims",
  "assess.judgments": "Rubric",
  "assess.memo": "Memo",
  "assess.company": "Company",
  "outreach.plan": "Drafts",
  "call.founder": "Founder call",
  "call.reference": "Reference call",
  "call.debrief": "Debrief",
};

/** Which class is working during each stage of a run. */
const STAGE_CLASSES: Partial<Record<StageId, readonly ClassId[]>> = {
  plan: ["navigator"],
  scout: ["scout"],
  hunt: ["navigator", "runner"],
  resolve: ["resolver"],
  screen: ["screener"],
  investigate: ["investigator"],
  verify: ["verifier"],
  assess: ["analyst"],
  memo: ["analyst"],
  outreach: ["outreach"],
  debrief: ["outreach"],
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
      return { value: stats.evidence, unit: "facts" };
    case "company":
      return { value: stats.companiesResearched, unit: "companies" };
    case "verifier":
      return { value: stats.evidenceRejected, unit: "rejected" };
    case "analyst":
      return { value: stats.surfaced, unit: "surfaced" };
    case "outreach":
      return { value: stats.outreachProposed, unit: "drafts" };
  }
  return null;
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
  /** The last run's totals, for the figure on each class. */
  stats: RunStats | null;
  selected?: SwarmNodeRef | null;
  onSelect?: (node: SwarmNodeRef) => void;
  /** The stage a run is in right now, which makes that class pulse. */
  activeStage?: StageId | null;
  /** Surfaced founders waiting for a yes or a no. */
  waiting?: number;
  /** One row of classes only, without the jobs of the selected class. */
  compact?: boolean;
  className?: string;
}

/**
 * The swarm as one line: sources, the seven classes of agent, and you. Each
 * class is a button. Selecting one opens its jobs underneath, and each job
 * (and each agent of a job that has several) is a button too.
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
  const activeClasses = new Set(activeStage ? (STAGE_CLASSES[activeStage] ?? []) : []);
  const interactive = Boolean(onSelect);
  const upstreamIds = new Set<ClassId>(["navigator", "scout", "runner"]);
  const scouts = tree.classes.find((node) => node.cls.id === "scout");
  const navigator = tree.classes.find((node) => node.cls.id === "navigator");
  const runner = tree.classes.find((node) => node.cls.id === "runner");
  const downstream = tree.classes.filter((node) => !upstreamIds.has(node.cls.id));

  // The class whose jobs are open: the selected class, or the class of the selected job or agent.
  const open =
    selected && selected.kind !== "swarm"
      ? (tree.classes.find((c) =>
          selected.kind === "class"
            ? c.cls.id === selected.classId
            : c.jobs.some((j) =>
                selected.kind === "job"
                  ? j.job.id === selected.jobId
                  : j.agents.some((a) => a.agent.id === selected.agentId),
              ),
        ) ?? null)
      : null;

  const makeClassCard = (node: ClassNode, className?: string) => (
    <ClassCard
      node={node}
      figure={classFigure(node.cls.id, stats)}
      running={activeClasses.has(node.cls.id)}
      selected={sameNode(selected, { kind: "class", classId: node.cls.id })}
      open={open?.cls.id === node.cls.id}
      onSelect={onSelect}
      interactive={interactive}
      compact={compact}
      className={className}
    />
  );

  return (
    <div className={cn("min-w-0", className)}>
      <div className="min-w-0 overflow-x-auto">
        <div className="flex min-w-[62rem] items-stretch gap-0.5">
          <EndCap icon={<Database className="size-4" aria-hidden />} label="Sources" />
          {scouts || navigator || runner ? (
            <>
              <ChevronRight className="size-3.5 shrink-0 self-center text-rule-strong" aria-hidden />
              {/* Two ways of finding people, side by side: the fixed scouts, and the runners the
                  navigator steers. Each column is as wide as any other team's card. */}
              <div
                className={cn("flex min-w-0 basis-0 items-stretch gap-0.5", scouts && (navigator || runner) ? "flex-[2]" : "flex-1")}
                role="group"
                aria-label="Lead finding"
              >
                {scouts ? makeClassCard(scouts) : null}
                {navigator || runner ? (
                  <div className="flex min-w-0 flex-1 basis-0 flex-col items-stretch gap-0.5">
                    {navigator ? makeClassCard(navigator) : null}
                    {navigator && runner ? (
                      <span className="inline-flex h-3.5 shrink-0 items-center justify-center text-ink-3" role="img" aria-label="Steers">
                        <ArrowDown className="size-3" aria-hidden />
                      </span>
                    ) : null}
                    {runner ? makeClassCard(runner) : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          {downstream.map((c) => (
            <Fragment key={c.cls.id}>
              <ChevronRight className="size-3.5 shrink-0 self-center text-rule-strong" aria-hidden />
              {makeClassCard(c)}
            </Fragment>
          ))}
          <ChevronRight className="size-3.5 shrink-0 self-center text-rule-strong" aria-hidden />
          <EndCap icon={<UserRound className="size-4" aria-hidden />} label="You" count={waiting} />
        </div>
      </div>

      {open && !compact ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-sunk p-3"
          role="group"
          aria-label={`${open.cls.label}: jobs`}
        >
          {open.jobs.map((j) => (
            <JobPill key={j.job.id} job={j} selected={selected ?? null} onSelect={onSelect} interactive={interactive} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EndCap({ icon, label, count }: { icon: ReactNode; label: string; count?: number }) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 self-center text-center">
      <span className="relative inline-flex size-9 items-center justify-center rounded-full bg-sunk text-ink-2">
        {icon}
        {count ? (
          <span
            className="figure absolute -top-1 -right-2 inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red px-1 text-2xs font-black text-white"
            aria-label={`${count} waiting for your call`}
          >
            {count}
          </span>
        ) : null}
      </span>
      <span className="text-sm font-bold text-ink-2">{label}</span>
    </div>
  );
}

function ClassCard({
  node,
  figure,
  running,
  selected,
  open,
  onSelect,
  interactive,
  compact,
  className,
}: {
  node: ClassNode;
  figure: { value: number; unit: string } | null;
  running: boolean;
  selected: boolean;
  open: boolean;
  onSelect?: (node: SwarmNodeRef) => void;
  interactive: boolean;
  compact: boolean;
  className?: string;
}) {
  const mark = running ? "running" : healthMark(node.health);
  const steering = node.directiveCount;
  const label = `${node.cls.label}: ${running ? "working now" : HEALTH_WORD[node.health]}${
    figure ? `, ${figure.value} ${figure.unit}` : ""
  }${steering ? `, ${steering} steering attached` : ""}`;
  const lit = selected || open;

  const inner = (
    <>
      <span className="relative inline-flex size-9 items-center justify-center rounded-md bg-green-tint text-green">
        <ClassIcon classId={node.cls.id} className="size-[1.125rem]" />
        <StateMark state={mark} className="absolute -top-1 -right-1 size-2.5 rounded-full ring-2 ring-surface" />
      </span>
      <span className="text-sm leading-tight font-bold text-ink">{node.cls.label}</span>
      {figure ? (
        <span className="flex items-baseline gap-1">
          <span className={cn("figure font-black text-ink", compact ? "text-md" : "text-lg")}>
            {figure.value.toLocaleString("en-US")}
          </span>
          <span className="text-xs text-ink-3">{figure.unit}</span>
        </span>
      ) : null}
      {steering > 0 && !compact ? (
        <span className="figure absolute top-1.5 left-2 inline-flex items-center gap-0.5 text-xs font-bold text-navy">
          <SlidersHorizontal className="size-3" aria-hidden />
          {steering}
        </span>
      ) : null}
    </>
  );

  const cls = cn(
    "relative flex min-w-0 flex-1 basis-0 flex-col items-center gap-1.5 self-stretch rounded-lg border px-1.5 text-center",
    compact ? "py-2.5" : "py-3",
    lit ? "border-navy bg-blue-tint" : "border-rule bg-surface",
    interactive && !lit && "transition-colors duration-150 hover:bg-sunk",
    className,
  );

  return interactive ? (
    <button
      type="button"
      className={cls}
      aria-pressed={selected}
      aria-expanded={compact ? undefined : open}
      aria-label={label}
      title={node.cls.description}
      onClick={() => onSelect?.({ kind: "class", classId: node.cls.id })}
    >
      {inner}
    </button>
  ) : (
    <div className={cls} title={node.cls.description} aria-label={label}>
      {inner}
    </div>
  );
}

function JobPill({
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

  const pill = cn(
    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-bold",
    isSelected ? "border-navy bg-blue-tint text-ink" : "border-rule-strong bg-surface text-ink",
    planned && !isSelected && "border-dashed text-ink-3",
    interactive && !isSelected && "transition-colors duration-150 hover:bg-ground",
  );
  const inner = (
    <>
      <StateMark state={healthMark(job.health)} />
      {JOB_SHORT[job.job.id]}
      {steering > 0 ? (
        <span className="figure inline-flex items-center gap-0.5 text-xs text-navy">
          <SlidersHorizontal className="size-3" aria-hidden />
          {steering}
        </span>
      ) : null}
    </>
  );

  return (
    <span className="inline-flex items-center gap-1">
      {interactive ? (
        <button type="button" className={pill} aria-pressed={isSelected} aria-label={label} title={job.job.description} onClick={() => onSelect?.(ref)}>
          {inner}
        </button>
      ) : (
        <span className={pill} title={job.job.description} aria-label={label}>
          {inner}
        </span>
      )}
      {job.agents.length > 1
        ? job.agents.map((a, i) => {
            const agentRef: SwarmNodeRef = { kind: "agent", agentId: a.agent.id };
            const on = sameNode(selected, agentRef);
            const chip = cn(
              "figure inline-flex size-6 items-center justify-center rounded-full border text-xs font-black",
              on ? "border-navy bg-blue-tint text-ink" : "border-rule-strong bg-surface text-ink-2",
              interactive && !on && "hover:bg-ground",
            );
            const title = `${a.agent.name}${a.agent.beat ? `: ${a.agent.beat}` : ""} (${HEALTH_WORD[a.health]})`;
            return interactive ? (
              <button key={a.agent.id} type="button" className={chip} aria-pressed={on} aria-label={title} title={title} onClick={() => onSelect?.(agentRef)}>
                {i + 1}
              </button>
            ) : (
              <span key={a.agent.id} className={chip} title={title}>
                {i + 1}
              </span>
            );
          })
        : null}
    </span>
  );
}
