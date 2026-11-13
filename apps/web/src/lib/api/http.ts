import {
  ACTOR_HEADER,
  type AddFounderInput,
  type ApiClient,
  type ApiErrorBody,
  type CompanyQuery,
  type DirectiveFilter,
  type EffectiveSteeringQuery,
  type FounderQuery,
  type NetworkImportInput,
  type OutreachQuery,
} from "@agentswarm/shared";

/** A failed API call, carrying the server's message and any per-field problems. */
export class ApiError extends Error {
  readonly status: number;
  readonly fields: Record<string, string>;

  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * The dashboard's client for the real server. `getActor` supplies the name
 * recorded in the audit trail for every change.
 */
export function createHttpClient(options: { baseUrl?: string; getActor: () => string }): ApiClient {
  const base = options.baseUrl ?? "";

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          [ACTOR_HEADER]: options.getActor(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "The server did not respond. Check that it is running, then try again.");
    }
    if (!response.ok) {
      let parsed: ApiErrorBody | null = null;
      try {
        parsed = (await response.json()) as ApiErrorBody;
      } catch {
        parsed = null;
      }
      throw new ApiError(
        response.status,
        parsed?.error ?? `The server answered with an error (${response.status}).`,
        parsed?.fields,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  const get = <T>(path: string, query?: Query) => call<T>("GET", withQuery(path, query));

  return {
    getSettings: () => get("/api/settings"),
    updateSettings: (patch) => call("PATCH", "/api/settings", patch),

    listSwarms: () => get("/api/swarms"),
    createSwarm: (input) => call("POST", "/api/swarms", input),
    updateSwarm: (id, patch) => call("PATCH", `/api/swarms/${encodeURIComponent(id)}`, patch),
    getOverview: (swarmId) => get(`/api/swarms/${encodeURIComponent(swarmId)}/overview`),
    getTree: (swarmId) => get(`/api/swarms/${encodeURIComponent(swarmId)}/tree`),
    addAgent: (swarmId, input) => call("POST", `/api/swarms/${encodeURIComponent(swarmId)}/agents`, input),
    updateAgent: (agentId, patch) => call("PATCH", `/api/agents/${encodeURIComponent(agentId)}`, patch),

    listDirectives: (filter: DirectiveFilter = {}) =>
      get("/api/directives", {
        swarmId: filter.swarmId,
        level: filter.level,
        kind: filter.kind,
        status: filter.status,
        scope: filter.scope ? JSON.stringify(filter.scope) : undefined,
      }),
    createDirective: (input) => call("POST", "/api/directives", input),
    updateDirective: (id, patch) => call("PATCH", `/api/directives/${encodeURIComponent(id)}`, patch),
    getEffectiveSteering: (query: EffectiveSteeringQuery) => get("/api/steering/effective", { ...query }),
    listSuggestions: (swarmId) => get(`/api/swarms/${encodeURIComponent(swarmId)}/suggestions`),
    dismissSuggestion: (swarmId, key) =>
      call("POST", `/api/swarms/${encodeURIComponent(swarmId)}/suggestions/dismiss`, { key }),

    listFounders: (query: FounderQuery) => get("/api/founders", { ...query }),
    getFounder: (id) => get(`/api/founders/${encodeURIComponent(id)}`),
    addFeedback: (founderId, input) =>
      call("POST", `/api/founders/${encodeURIComponent(founderId)}/feedback`, input),
    addFounder: (input: AddFounderInput) => call("POST", "/api/founders", input),

    listCompanies: (query: CompanyQuery) => get("/api/companies", { ...query }),
    getCompany: (id) => get(`/api/companies/${encodeURIComponent(id)}`),
    addCompanyFeedback: (companyId, input) =>
      call("POST", `/api/companies/${encodeURIComponent(companyId)}/feedback`, input),

    getNetwork: () => get("/api/network"),
    importNetwork: (input: NetworkImportInput) => call("POST", "/api/network/import", input),
    removeNetwork: (owner) => call("DELETE", `/api/network/${encodeURIComponent(owner)}`),

    listOutreach: (query: OutreachQuery) => get("/api/outreach", { ...query }),
    decideOutreach: (id, input) => call("POST", `/api/outreach/${encodeURIComponent(id)}/decision`, input),
    completeOutreach: (id, input) => call("POST", `/api/outreach/${encodeURIComponent(id)}/complete`, input),

    listRuns: (swarmId, limit) => get("/api/runs", { swarmId, limit }),
    getRun: (id) => get(`/api/runs/${encodeURIComponent(id)}`),
    getTask: (id) => get(`/api/tasks/${encodeURIComponent(id)}`),
    startRun: (input) => call("POST", "/api/runs", input),
    cancelRun: (id) => call("POST", `/api/runs/${encodeURIComponent(id)}/cancel`),

    listEvalFlows: () => get("/api/evals"),
    getEvalFlow: (id) => get(`/api/evals/${encodeURIComponent(id)}`),
    runEvalRounds: (id, input) => call("POST", `/api/evals/${encodeURIComponent(id)}/rounds`, input ?? {}),
    promoteEvalVariant: (id, input) => call("POST", `/api/evals/${encodeURIComponent(id)}/promote`, input),
  };
}
