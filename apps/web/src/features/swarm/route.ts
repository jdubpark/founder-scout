import { PROVIDERS, getModel, type JobKind, type ModelRoute } from "@agentswarm/shared";

/** A job's model in a few words: the model and the provider, or why there is none. */
export function routeText(kind: JobKind, route: ModelRoute): string {
  if (kind === "code") return "No model. Plain code.";
  if (route.model === "none") return "No model call";
  if (route.provider === "sim") return "Simulation, no real model";
  const model = getModel(route.model)?.label ?? route.model;
  const provider = PROVIDERS.find((p) => p.id === route.provider)?.label ?? route.provider;
  return `${model}, ${provider}`;
}

/** Just the model's name, for the tree rows. */
export function shortRoute(kind: JobKind, route: ModelRoute): string {
  if (kind === "code") return "Code";
  if (route.model === "none") return "No model";
  if (route.provider === "sim") return "Simulation";
  return getModel(route.model)?.label ?? route.model;
}
