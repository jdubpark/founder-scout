import { useState, type FormEvent } from "react";
import type { AutopilotMode, AutopilotSettings, SettingsDTO } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { Field, Input, Segmented } from "../../components/ui/Field";
import { Panel } from "../../components/ui/layout";
import { useToast } from "../../components/ui/overlay";
import { InfoHint } from "../steering/InfoHint";
import { useUpdateSettings } from "../../lib/queries";

const MODE_NAME: Record<AutopilotMode, string> = { off: "Off", suggest: "Suggest", apply: "Apply" };

const MODE_OPTIONS = (["off", "suggest", "apply"] as const).map((value) => ({ value, label: MODE_NAME[value] }));

const MODE_HINT =
  "Suggest: after each scheduled run the swarm runs eval rounds and shows what it would change on the Improve page. " +
  "Apply: it also puts a kept change into use, but only one that was measured on real data (your calls or past founders). " +
  "Every change it makes can be undone on the Improve page.";

const BUDGET_HINT =
  "Evals on simulated founders cost nothing. Evals on past founders call a model. This is the most they may spend in a day.";

export function AutopilotPanel({ dto }: { dto: SettingsDTO }) {
  const saved = dto.settings.autopilot;
  return (
    <Panel title="Autopilot" aside={MODE_NAME[saved.mode]}>
      <AutopilotForm key={JSON.stringify(saved)} saved={saved} />
    </Panel>
  );
}

function AutopilotForm({ saved }: { saved: AutopilotSettings }) {
  const update = useUpdateSettings();
  const toast = useToast();
  const [mode, setMode] = useState<AutopilotMode>(saved.mode);
  const [budget, setBudget] = useState(String(saved.budgetUsd));
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const budgetUsd = Number(budget);
  const budgetValid = budget.trim() !== "" && Number.isFinite(budgetUsd) && budgetUsd >= 0 && budgetUsd <= 1000;
  const dirty = mode !== saved.mode || (budgetValid && budgetUsd !== saved.budgetUsd);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!budgetValid) {
      setBudgetError("Enter 0 to 1000.");
      return;
    }
    setBudgetError(null);
    update.mutate(
      { autopilot: { mode, budgetUsd } },
      {
        onSuccess: () => toast.done("Autopilot saved"),
        onError: (error) => toast.problem("Autopilot was not saved", error.message),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-5" noValidate>
      <div className="flex items-center gap-2">
        <Segmented label="Autopilot mode" value={mode} onChange={setMode} options={MODE_OPTIONS} />
        <InfoHint text={MODE_HINT} />
      </div>

      <Field label="Daily eval budget (USD)" error={budgetError}>
        {({ id, describedBy, invalid }) => (
          <div className="flex items-center gap-2">
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              min={0}
              max={1000}
              step="any"
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={budget}
              onChange={(e) => {
                setBudget(e.target.value);
                setBudgetError(null);
              }}
              className="w-40"
            />
            <InfoHint text={BUDGET_HINT} />
          </div>
        )}
      </Field>

      <div>
        <Button type="submit" variant="secondary" disabled={!dirty} busy={update.isPending} busyLabel="Saving">
          Save
        </Button>
      </div>
    </form>
  );
}
