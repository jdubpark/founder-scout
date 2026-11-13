import { Bot, Compass } from "lucide-react";
import { Segmented } from "../../components/ui/Field";
import { useToast } from "../../components/ui/overlay";
import { ago } from "../../lib/format";
import { useCreateDirective, useEffectiveSteering, useUpdateDirective } from "../../lib/queries";

export function HuntSeat({ swarmId, holder, seatAt }: { swarmId: string; holder: "built_in" | "outside"; seatAt: string | null }) {
  const steering = useEffectiveSteering({ swarmId });
  const create = useCreateDirective();
  const update = useUpdateDirective();
  const toast = useToast();
  const current = steering.data?.params.find((item) => item.key === "hunt.navigator");
  const busy = create.isPending || update.isPending;

  function setHolder(value: "built_in" | "outside") {
    if (!swarmId || busy || value === (current?.value ?? "built_in")) return;
    const onSuccess = () => toast.done("Saved");
    const onError = (error: Error) => toast.problem("Not saved", error.message);
    if (current?.directiveId && current.scope?.swarmId === swarmId && !current.scope.classId && !current.scope.jobId && !current.scope.agentId) {
      update.mutate({ id: current.directiveId, patch: { value } }, { onSuccess, onError });
    } else {
      create.mutate({ scope: { swarmId }, kind: "param", key: "hunt.navigator", value }, { onSuccess, onError });
    }
  }

  const options = ["built_in", "outside"] as const;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-4">
      <div className="flex items-center gap-2 text-sm font-bold text-ink">
        {holder === "outside" ? <Bot size={16} aria-hidden="true" /> : <Compass size={16} aria-hidden="true" />}
        <span>{holder === "outside" ? "Outside agent" : "Built in"}</span>
        {seatAt ? <span className="text-xs font-normal text-ink-3">Last turn {ago(seatAt)}</span> : null}
      </div>
      <Segmented
        value={(current?.value === "outside" ? "outside" : "built_in")}
        onChange={setHolder}
        options={options.map((option) => ({ value: option, label: option === "outside" ? "Outside" : "Built in" }))}
        label="Hunt navigator"
        className={busy ? "pointer-events-none opacity-60" : undefined}
      />
    </div>
  );
}
