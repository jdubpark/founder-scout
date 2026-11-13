import { useState } from "react";
import { Play } from "lucide-react";
import type { Brain, SourceMode } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/overlay";
import { useStartRun } from "../../lib/queries";

/** The page's one primary action, with the brain and source choices kept small beside it. */
export function RunNow({ swarmId, running }: { swarmId: string; running: boolean }) {
  const [brain, setBrain] = useState<Brain>("sim");
  const [sources, setSources] = useState<SourceMode>("sim");
  const start = useStartRun();
  const toast = useToast();

  const run = () =>
    start.mutate(
      { swarmId, brain, sources },
      {
        onSuccess: () => toast.done("Run started"),
        onError: (e) => toast.problem("The run did not start", e.message),
      },
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-56">
        <Select aria-label="Brain" value={brain} onChange={(e) => setBrain(e.target.value as Brain)}>
          <option value="sim">Brain: Simulation</option>
          <option value="live">Brain: Live</option>
        </Select>
      </div>
      <div className="w-56">
        <Select aria-label="Sources" value={sources} onChange={(e) => setSources(e.target.value as SourceMode)}>
          <option value="sim">Sources: Simulation</option>
          <option value="live">Sources: Live</option>
        </Select>
      </div>
      <Button
        variant="primary"
        icon={<Play />}
        onClick={run}
        busy={start.isPending}
        busyLabel="Starting"
        disabled={running}
      >
        {running ? "Running" : "Run now"}
      </Button>
    </div>
  );
}
