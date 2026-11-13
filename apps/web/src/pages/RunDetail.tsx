import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Filter, Radar, Search, Square, Star, Users } from "lucide-react";
import type { ClassId, TaskRun } from "@agentswarm/shared";
import { FunnelDiagram } from "../components/FunnelDiagram";
import { Button } from "../components/ui/Button";
import { Meter, ErrorNote, PageHeader, Panel, SkeletonRows } from "../components/ui/layout";
import { Caution, Chip, Status } from "../components/ui/marks";
import { useToast } from "../components/ui/overlay";
import { dateTime, usd } from "../lib/format";
import { useCancelRun, useFounders, useRun } from "../lib/queries";
import { RUN_STATUS, isActive, isSimulated } from "../features/activity/labels";
import { StageTrack } from "../features/activity/StageTrack";
import { TaskSheet } from "../features/activity/TaskSheet";
import { TaskFilters, TasksTable, isProblem } from "../features/activity/TasksTable";

export default function RunDetailPage() {
  const { runId } = useParams();
  const detail = useRun(runId ?? null);
  const data = detail.data;
  const run = data?.run ?? null;

  const founders = useFounders(run ? { swarmId: run.swarmId, status: "all", limit: 100 } : null);
  const names = useMemo(
    () => new Map((founders.data?.rows ?? []).map((r) => [r.id, r.name] as const)),
    [founders.data],
  );

  const cancel = useCancelRun();
  const toast = useToast();
  const [classFilter, setClassFilter] = useState<ClassId | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const visible = useMemo(
    () =>
      tasks.filter(
        (t) => (classFilter === null || t.classId === classFilter) && (!onlyProblems || isProblem(t)),
      ),
    [tasks, classFilter, onlyProblems],
  );
  const openTask: TaskRun | null = tasks.find((t) => t.id === openId) ?? null;

  if (detail.error) {
    return (
      <>
        <PageHeader title="Run" />
        <ErrorNote
          title="This run could not be loaded"
          action={
            <Link to="/activity" className="text-base font-semibold text-green-2">
              Back to Activity
            </Link>
          }
        >
          {detail.error.message}
        </ErrorNote>
      </>
    );
  }

  if (!run || !data) {
    return (
      <>
        <PageHeader title="Run" />
        <SkeletonRows rows={8} />
      </>
    );
  }

  const stop = () =>
    cancel.mutate(run.id, {
      onSuccess: () => toast.done("Run stopped"),
      onError: (e) => toast.problem("The run did not stop", e.message),
    });

  const status = RUN_STATUS[run.status];
  const share = run.budgetUsd > 0 ? run.costUsd / run.budgetUsd : null;
  const active = isActive(run);

  return (
    <>
      <PageHeader
        title={dateTime(run.startedAt)}
        actions={
          active ? (
            <Button variant="caution" icon={<Square />} onClick={stop} busy={cancel.isPending} busyLabel="Stopping">
              Stop this run
            </Button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link to="/activity" className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-2">
            <ArrowLeft className="size-4" aria-hidden />
            Activity
          </Link>
          <Status state={status.mark}>{status.label}</Status>
          {isSimulated(run) ? <Chip tone="red">Simulated</Chip> : <Chip>Live</Chip>}
          <span className="inline-flex items-center gap-2.5">
            <span className="w-28">
              <Meter value={share} label="Cost against cap" showFigure={false} />
            </span>
            <span className="figure text-sm text-ink-2">
              {usd(run.costUsd)} / {usd(run.budgetUsd)}
            </span>
          </span>
          {run.error ? <Caution>{run.error}</Caution> : null}
        </div>
      </PageHeader>

      <div className="flex flex-col gap-8">
        <Panel title="Stages">
          <StageTrack stages={data.stages} />
        </Panel>

        <Panel title="Funnel">
          <FunnelDiagram
            steps={[
              { id: "leads", label: "Leads", value: run.stats.leads, icon: <Radar /> },
              { id: "new", label: "New", value: run.stats.newFounders, icon: <Users /> },
              { id: "screen", label: "Passed the screen", value: run.stats.screenedIn, icon: <Filter /> },
              { id: "investigated", label: "Investigated", value: run.stats.investigated, icon: <Search /> },
              { id: "surfaced", label: "Surfaced", value: run.stats.surfaced, icon: <Star />, tone: "gold" },
            ]}
          />
        </Panel>

        <Panel title="Tasks">
          <div className="flex flex-col gap-4">
            <TaskFilters
              tasks={tasks}
              classFilter={classFilter}
              onClass={setClassFilter}
              onlyProblems={onlyProblems}
              onProblems={setOnlyProblems}
            />
            <TasksTable tasks={visible} names={names} onOpen={setOpenId} openId={openId} />
          </div>
        </Panel>
      </div>

      <TaskSheet
        row={openTask}
        open={openTask !== null}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      />
    </>
  );
}
