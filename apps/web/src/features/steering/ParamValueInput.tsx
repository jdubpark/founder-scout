import { type ParamDef, type ParamValue } from "@agentswarm/shared";
import { Field, Input, Select, Switch } from "../../components/ui/Field";
import { formatParamValue } from "./paramText";
import { InfoHint } from "./InfoHint";

/** What a person has typed or picked for a setting, before it is checked. */
export type ParamDraft = string | boolean;

/** The starting draft for a setting, from its current value or its default. */
export function draftFor(def: ParamDef, value: ParamValue | null): ParamDraft {
  if (def.type === "boolean") return value === true || value === "true";
  return value === null ? "" : String(value);
}

/**
 * The input that fits a parameter's type: a switch, a choice, a number with its
 * limits, or text. The parameter's help sits beside the control as an info hint.
 */
export function ParamValueInput({
  def,
  value,
  onChange,
  error,
}: {
  def: ParamDef;
  value: ParamDraft;
  onChange: (value: ParamDraft) => void;
  error?: string | null;
}) {
  if (def.type === "boolean") {
    return (
      <Field label={def.label} error={error ?? null}>
        {({ id }) => (
          <div className="flex items-center gap-2">
            <Switch
              id={id}
              checked={value === true}
              onCheckedChange={(checked) => onChange(checked)}
              label={value === true ? "On" : "Off"}
            />
            <InfoHint text={def.help} />
          </div>
        )}
      </Field>
    );
  }

  if (def.type === "enum") {
    return (
      <Field label={def.label} error={error ?? null}>
        {({ id, describedBy, invalid }) => (
          <div className="flex items-center gap-2">
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={String(value)}
              onChange={(e) => onChange(e.target.value)}
              className="min-w-0 flex-1"
            >
              {def.default === null ? (
                <option value="" disabled>
                  Choose one
                </option>
              ) : null}
              {(def.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {formatParamValue(def.key, option)}
                </option>
              ))}
            </Select>
            <InfoHint text={def.help} />
          </div>
        )}
      </Field>
    );
  }

  const numeric = def.type === "int" || def.type === "number";
  return (
    <Field label={def.label} error={error ?? null}>
      {({ id, describedBy, invalid }) => (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            type={numeric ? "number" : "text"}
            inputMode={numeric ? "decimal" : undefined}
            min={numeric ? def.min : undefined}
            max={numeric ? def.max : undefined}
            step={numeric ? (def.step ?? (def.type === "int" ? 1 : "any")) : undefined}
            placeholder={def.key === "route.model" ? "For example claude-sonnet-5-5" : undefined}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="min-w-0 flex-1"
          />
          <InfoHint text={def.help} />
        </div>
      )}
    </Field>
  );
}
