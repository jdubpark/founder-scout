import { useId, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { EvalFlowDTO } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Field";
import { useToast } from "../../components/ui/overlay";
import { useRunEvalRounds } from "../../lib/queries";
import { BUDGET_DEFAULT, BUDGET_MAX, BUDGET_MIN, BUDGET_STEP, canRun, isBudgetValid, roundDoneTitle, runInput, runLabel } from "./runPlan";

/** The run button, with a budget field beside it for flows that call models. */
export function RunRound({ flow }: { flow: EvalFlowDTO }) {
  const run = useRunEvalRounds();
  const toast = useToast();
  const budgetId = useId();
  const [budget, setBudget] = useState(String(BUDGET_DEFAULT));
  const amount = Number(budget);
  const budgetOk = !flow.callsModels || isBudgetValid(amount);

  return (
    <div className="flex items-center gap-2">
      {flow.callsModels ? (
        <>
          <label htmlFor={budgetId} className="text-sm text-ink-2">
            Budget (USD)
          </label>
          <div className="w-24">
            <Input
              id={budgetId}
              type="number"
              min={BUDGET_MIN}
              max={BUDGET_MAX}
              step={BUDGET_STEP}
              value={budget}
              aria-invalid={!budgetOk || undefined}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        </>
      ) : null}
      <Button
        variant="primary"
        icon={<RefreshCw />}
        disabled={!canRun(flow) || !budgetOk}
        busy={run.isPending}
        busyLabel="Running"
        onClick={() =>
          run.mutate(
            { id: flow.id, input: runInput(flow, amount) },
            {
              onSuccess: (data) => toast.done(roundDoneTitle(data.spentUsd)),
              onError: (e) => toast.problem("The round did not run", e.message),
            },
          )
        }
      >
        {runLabel(flow)}
      </Button>
    </div>
  );
}
