import { PROVIDERS, getModel, getParamDef, type ParamValue } from "@agentswarm/shared";
import { usd } from "../../lib/format";

/** A parameter's name as a person reads it. */
export function paramLabel(key: string): string {
  return getParamDef(key)?.label ?? key;
}

/** A parameter's value as a person reads it. Provider and model ids become their names. */
export function formatParamValue(key: string, value: ParamValue | null): string {
  if (value === null) return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (key === "route.provider") {
    return PROVIDERS.find((p) => p.id === value)?.label ?? String(value);
  }
  if (key === "route.model") return getModel(String(value))?.label ?? String(value);
  if (key.endsWith("_usd") && typeof value === "number") return usd(value);
  return String(value);
}
