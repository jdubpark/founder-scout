import { useState, type FormEvent } from "react";
import type { Brain, ScheduleSettings, SettingsDTO, SourceMode } from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { Caution } from "../../components/ui/marks";
import { Field, Select, Switch, Input } from "../../components/ui/Field";
import { Panel } from "../../components/ui/layout";
import { useToast } from "../../components/ui/overlay";
import { InfoHint } from "../steering/InfoHint";
import { dateTime, until } from "../../lib/format";
import { useUpdateSettings } from "../../lib/queries";
import { dailyCron, timeFromCron, zoneOptions } from "./cron";

export function DailyRunPanel({ dto }: { dto: SettingsDTO }) {
  const saved = dto.settings.schedule;
  const aside = !saved.enabled
    ? "Off"
    : dto.nextRunAt
      ? `Next ${until(dto.nextRunAt)}`
      : "Not scheduled";
  return (
    <Panel title="Daily run" aside={aside}>
      <DailyRunForm key={JSON.stringify(saved)} saved={saved} nextRunAt={dto.nextRunAt} />
    </Panel>
  );
}

function DailyRunForm({ saved, nextRunAt }: { saved: ScheduleSettings; nextRunAt: string | null }) {
  const update = useUpdateSettings();
  const toast = useToast();
  const [enabled, setEnabled] = useState(saved.enabled);
  const [time, setTime] = useState(timeFromCron(saved.cron) ?? "06:00");
  const [timezone, setTimezone] = useState(saved.timezone);
  const [brain, setBrain] = useState<Brain>(saved.brain);
  const [sources, setSources] = useState<SourceMode>(saved.sources);
  const [timeError, setTimeError] = useState<string | null>(null);

  const cron = dailyCron(time);
  const customSaved = timeFromCron(saved.cron) === null;
  const dirty =
    enabled !== saved.enabled ||
    cron !== saved.cron ||
    timezone !== saved.timezone ||
    brain !== saved.brain ||
    sources !== saved.sources;
  const simulated = brain === "sim" || sources === "sim";

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cron) {
      setTimeError("Choose a time.");
      return;
    }
    setTimeError(null);
    update.mutate(
      { schedule: { enabled, cron, timezone, brain, sources } },
      {
        onSuccess: () => toast.done("Daily run saved"),
        onError: (error) => toast.problem("The daily run was not saved", error.message),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-5" noValidate>
      <Switch checked={enabled} onCheckedChange={setEnabled} label="On" />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Time" error={timeError}>
          {({ id, describedBy, invalid }) => (
            <div className="flex items-center gap-2">
              <Input
                id={id}
                type="time"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setTimeError(null);
                }}
                className="min-w-0 flex-1"
              />
              {customSaved ? (
                <InfoHint text="The saved schedule is a custom pattern. Saving replaces it with a daily time." />
              ) : null}
            </div>
          )}
        </Field>

        <Field label="Time zone">
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zoneOptions(saved.timezone).map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Brain">
          {({ id, describedBy }) => (
            <div className="flex items-center gap-2">
              <Select
                id={id}
                aria-describedby={describedBy}
                value={brain}
                onChange={(e) => setBrain(e.target.value as Brain)}
                className="min-w-0 flex-1"
              >
                <option value="live">Live</option>
                <option value="sim">Simulation</option>
              </Select>
              <InfoHint text="Live uses the model providers. Simulation uses a stand-in with no model calls." />
            </div>
          )}
        </Field>

        <Field label="Sources">
          {({ id, describedBy }) => (
            <div className="flex items-center gap-2">
              <Select
                id={id}
                aria-describedby={describedBy}
                value={sources}
                onChange={(e) => setSources(e.target.value as SourceMode)}
                className="min-w-0 flex-1"
              >
                <option value="live">Live</option>
                <option value="sim">Simulation</option>
              </Select>
              <InfoHint text="Live reads public sources and any licensed data. Simulation uses made-up sources." />
            </div>
          )}
        </Field>
      </div>

      {simulated ? (
        <Caution>Simulated founders</Caution>
      ) : null}

      <p className="text-base text-ink-2">
        Next run{" "}
        <span className="figure font-semibold text-ink">
          {!enabled ? "off" : nextRunAt ? `${dateTime(nextRunAt, saved.timezone)}, ${until(nextRunAt)}` : "not scheduled"}
        </span>
      </p>

      <div>
        <Button type="submit" variant="secondary" disabled={!dirty} busy={update.isPending} busyLabel="Saving">
          Save
        </Button>
      </div>
    </form>
  );
}
