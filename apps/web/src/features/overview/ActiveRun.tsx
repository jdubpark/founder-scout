import { Link } from "react-router-dom";
import { Square } from "lucide-react";
import type { Run } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/overlay";
import { ago } from "../../lib/format";
import { useCancelRun } from "../../lib/queries";
import { getStage } from "../../lib/stages";

/** One line above the panels while a run is going. */
export function ActiveRunLine({ run }: { run: Run }) {
  const cancel = useCancelRun();
  const toast = useToast();
  const stage = run.stage ? getStage(run.stage).label : "Queued";

  const stop = () =>
    cancel.mutate(run.id, {
      onSuccess: () => toast.done("Run stopped"),
      onError: (e) => toast.problem("The run did not stop", e.message),
    });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-rule-strong py-2">
      <p className="text-base text-ink">
        <span className="font-semibold">Running</span> · {stage} · {ago(run.startedAt)} ·{" "}
        <Link to={`/activity/${run.id}`} className="font-semibold text-green-2">
          Open
        </Link>
      </p>
      <Button variant="caution" size="sm" icon={<Square />} onClick={stop} busy={cancel.isPending} busyLabel="Stopping">
        Stop
      </Button>
    </div>
  );
}
