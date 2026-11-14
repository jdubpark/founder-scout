import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { ServiceError, mediaMaxBytes, type SwarmService } from "@agentswarm/core";
import { ACTOR_HEADER, AGENT_CLASSES, JOBS, NavigateOutputSchema } from "@agentswarm/shared";
import type { AddTrailInput, ApiClient, ClassId, CompanySort, CompanyStatus, DirectiveFilter, JobId, SetPoolInput, UpdateTrailInput } from "@agentswarm/shared";

const actorHeader = ACTOR_HEADER.toLowerCase();
const allowedOrigins = ["http://localhost:5317", "http://127.0.0.1:5317"] as const;
const invalid = Symbol("invalid request");

/**
 * The dashboard has no login, so the server only answers a browser that is talking to this
 * computer by a loopback name. The Host check stops DNS rebinding (another site's name
 * pointed at 127.0.0.1); the Origin check stops another site's page from posting here.
 */
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const requiredText = z.string().trim().min(1);
const optionalText = z.string().trim().min(1);
const nullableText = z.string().nullable();
const queryInteger = z
  .string()
  .regex(/^\d+$/, "Expected a non-negative integer")
  .transform(Number)
  .pipe(z.number().int().nonnegative());
const classIds = AGENT_CLASSES.map((cls) => cls.id) as [ClassId, ...ClassId[]];
const jobIds = JOBS.map((job) => job.id) as [JobId, ...JobId[]];
const companyStatuses = ["tracked", "surfaced", "needs_evidence", "watch", "passed", "archived"] as const satisfies readonly CompanyStatus[];
const companySorts = ["deal", "company", "team", "recent"] as const satisfies readonly CompanySort[];
const recordingKinds = ["talk", "interview", "call"] as const;

const thesisSchema = z
  .object({
    summary: z.string(),
    sectors: z.array(z.string()),
    stages: z.array(z.string()),
    geos: z.array(z.string()),
    avoid: z.array(z.string()),
  })
  .strict();

const settingsPatchSchema = z
  .object({
    killSwitch: z.boolean().optional(),
    operatorName: z.string().optional(),
    dismissedSuggestions: z.array(z.string()).optional(),
    autopilot: z
      .object({
        mode: z.enum(["off", "suggest", "apply"]).optional(),
        budgetUsd: z.number().finite().min(0).max(1000).optional(),
      })
      .strict()
      .optional(),
    schedule: z
      .object({
        enabled: z.boolean().optional(),
        cron: z.string().optional(),
        timezone: z.string().optional(),
        brain: z.enum(["sim", "live"]).optional(),
        sources: z.enum(["sim", "live"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const createSwarmSchema = z.object({ name: requiredText, thesis: thesisSchema }).strict();
const updateSwarmSchema = z
  .object({
    name: optionalText.optional(),
    status: z.enum(["active", "paused"]).optional(),
    thesis: thesisSchema.optional(),
  })
  .strict();
const addAgentSchema = z
  .object({
    jobId: z.enum(jobIds),
    name: optionalText.optional(),
    beat: nullableText.optional(),
  })
  .strict();
const updateAgentSchema = z
  .object({
    name: optionalText.optional(),
    status: z.enum(["active", "paused"]).optional(),
    beat: nullableText.optional(),
  })
  .strict();
const huntSearchSchema = z.object({ engine: requiredText, query: requiredText.max(200) }).strict();
const addHuntTrailSchema: z.ZodType<AddTrailInput> = z
  .object({
    name: requiredText.max(60),
    intent: optionalText.max(200).optional(),
    searches: z.array(huntSearchSchema).max(6).optional(),
    pages: z.array(requiredText).max(6).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const starts = (input.searches?.length ?? 0) + (input.pages?.length ?? 0);
    if (starts === 0) {
      context.addIssue({ code: "custom", path: ["searches"], message: "Add a search or a public page to start this trail." });
    } else if (starts > 6) {
      context.addIssue({ code: "custom", path: ["searches"], message: "A trail can have at most 6 starting points." });
    }
  });
const updateHuntTrailSchema: z.ZodType<UpdateTrailInput> = z
  .object({
    status: z.enum(["open", "paused", "closed"]).optional(),
    pinned: z.boolean().optional(),
    weight: z.number().finite().min(1).max(5).optional(),
  })
  .strict();
const addHuntNoteSchema = z.object({ text: requiredText.max(240) }).strict();
const huntWaveSchema = z.object({ waves: z.number().int().min(1).max(3).optional() }).strict();

const scopeSchema = z
  .object({
    swarmId: requiredText.optional(),
    classId: z.enum(classIds).optional(),
    jobId: z.enum(jobIds).optional(),
    agentId: requiredText.optional(),
  })
  .strict();
const directiveFilterSchema = z
  .object({
    swarmId: requiredText.optional(),
    level: z.enum(["global", "swarm", "class", "job", "agent"]).optional(),
    kind: z.enum(["param", "rule", "opinion", "context"]).optional(),
    status: z.enum(["active", "paused", "archived"]).optional(),
    scope: z.string().optional(),
  })
  .strict()
  .transform((query, context): DirectiveFilter => {
    const { scope, ...filter } = query;
    if (scope === undefined || scope === "") return filter;
    let json: unknown;
    try {
      json = JSON.parse(scope);
    } catch {
      context.addIssue({ code: "custom", path: ["scope"], message: "Scope must be valid JSON" });
      return z.NEVER;
    }
    const parsedScope = scopeSchema.safeParse(json);
    if (!parsedScope.success) {
      context.addIssue({ code: "custom", path: ["scope"], message: "Scope has an invalid shape" });
      return z.NEVER;
    }
    return { ...filter, scope: parsedScope.data };
  });
const paramValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
const createDirectiveSchema = z
  .object({
    scope: scopeSchema,
    kind: z.enum(["param", "rule", "opinion", "context"]),
    key: z.string().nullable().optional(),
    value: paramValueSchema.nullable().optional(),
    text: z.string().nullable().optional(),
    priority: z.number().finite().optional(),
    note: z.string().nullable().optional(),
    expiresAt: z.string().nullable().optional(),
  })
  .strict();
const updateDirectiveSchema = z
  .object({
    status: z.enum(["active", "paused", "archived"]).optional(),
    value: paramValueSchema.nullable().optional(),
    text: z.string().nullable().optional(),
    priority: z.number().finite().optional(),
    note: z.string().nullable().optional(),
    expiresAt: z.string().nullable().optional(),
  })
  .strict();
const effectiveSteeringQuerySchema = z
  .object({
    swarmId: requiredText,
    agentId: requiredText.optional(),
    classId: z.enum(classIds).optional(),
    jobId: z.enum(jobIds).optional(),
  })
  .strict();
const dismissSuggestionSchema = z.object({ key: requiredText }).strict();

const founderQuerySchema = z
  .object({
    swarmId: requiredText,
    status: z
      .enum(["lead", "screened_out", "queued", "surfaced", "needs_evidence", "watch", "passed", "contacted", "meeting", "archived", "all"])
      .optional(),
    decision: z.enum(["surface", "needs_evidence", "watch", "pass"]).optional(),
    q: z.string().optional(),
    sort: z.enum(["composite", "cracked", "fit", "recent"]).optional(),
    limit: queryInteger.optional(),
    offset: queryInteger.optional(),
  })
  .strict();
const feedbackSchema = z
  .object({
    verdict: z.enum(["yes", "no"]),
    reasonTags: z.array(z.string()).optional(),
    note: z.string().nullable().optional(),
  })
  .strict();
const addFounderSchema = z
  .object({
    swarmId: requiredText,
    name: requiredText,
    companyName: nullableText.optional(),
    companyUrl: nullableText.optional(),
    link: nullableText.optional(),
    why: nullableText.optional(),
  })
  .strict();
const addRecordingLinkSchema = z.object({ title: requiredText, kind: z.enum(recordingKinds), url: requiredText }).strict();
const companyQuerySchema = z
  .object({
    swarmId: requiredText,
    status: z.enum([...companyStatuses, "all"]).optional(),
    q: z.string().optional(),
    sort: z.enum(companySorts).optional(),
    limit: queryInteger.optional(),
    offset: queryInteger.optional(),
  })
  .strict();
const networkImportSchema = z.object({ csv: z.string() }).strict();
const outreachQuerySchema = z
  .object({
    swarmId: requiredText,
    status: z.enum(["proposed", "approved", "rejected", "dispatched", "completed", "failed", "cancelled", "all"]).optional(),
  })
  .strict();
const outreachDraftSchema = z
  .object({
    subject: z.string().nullable(),
    body: z.string().nullable(),
    agenda: z.array(z.string()),
    questions: z.array(z.string()),
    disclosure: z.string(),
  })
  .strict();
const outreachDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    note: z.string().nullable().optional(),
    draft: outreachDraftSchema.optional(),
  })
  .strict();
const outreachCompleteSchema = z
  .object({ summary: requiredText, transcript: z.string().nullable().optional() })
  .strict();
const placeCallSchema = z.object({
  to: z.string(), timezone: requiredText,
  consent: z.object({ how: z.string(), recording: z.boolean() }).strict(),
}).strict();
const runsQuerySchema = z.object({ swarmId: requiredText, limit: queryInteger.optional() }).strict();
const startRunSchema = z
  .object({
    swarmId: requiredText,
    brain: z.enum(["sim", "live"]).optional(),
    sources: z.enum(["sim", "live"]).optional(),
    budgetUsd: z.number().finite().nonnegative().optional(),
  })
  .strict();
const runEvalRoundsSchema = z
  .object({
    // Zero rounds measures the baseline and tries no change.
    rounds: z.number().int().min(0).max(20).optional(),
    brain: z.enum(["sim", "live"]).optional(),
    // The most this request may spend on model calls. A flow that costs nothing ignores it.
    budgetUsd: z.number().finite().min(0).max(1000).optional(),
  })
  .strict();
const promoteEvalVariantSchema = z.object({ variant: requiredText, swarmId: requiredText }).strict();
const poolRouteSchema = z
  .object({ provider: requiredText, model: requiredText, effort: z.enum(["low", "medium", "high"]).optional() })
  .strict();
const setPoolSchema = z
  .object({
    members: z
      .array(z.object({ id: requiredText, route: poolRouteSchema, share: z.number().finite().min(0).max(1), status: z.enum(["active", "benched"]).optional() }).strict())
      .max(8),
  })
  .strict();
const rebalancePoolsSchema = z.object({ apply: z.boolean().optional() }).strict();
const evalFlowQuerySchema = z.object({ swarmId: requiredText.optional() }).strict();
const emptySchema = z.object({}).strict();

type InputPart = "body" | "query";
type ApiHandler<T> = (api: ApiClient, input: T, params: Record<string, string>) => unknown | Promise<unknown>;

function actorFor(request: FastifyRequest): string {
  const raw = request.headers[actorHeader];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 60);
  return value || "Partner";
}

function validationFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.length ? issue.path.join(".") : "request";
    fields[field] ??= issue.message;
  }
  return fields;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | typeof invalid {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  reply.code(400).send({ error: "Request validation failed", fields: validationFields(parsed.error) });
  return invalid;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildServer(options: {
  service: SwarmService;
  webDist?: string | null;
  logger?: boolean;
}): FastifyInstance {
  const { service, webDist, logger } = options;
  const app = Fastify({ logger: logger ?? false });
  app.addHook("onRequest", async (request, reply) => {
    if (!LOOPBACK_HOST.test(request.headers.host ?? "")) {
      return reply.code(403).send({ error: "This dashboard only answers on this computer.", fields: {} });
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !isLoopbackOrigin(origin)) {
      return reply.code(403).send({ error: "Requests from other sites are not accepted.", fields: {} });
    }
  });
  app.register(cors, {
    origin: [...allowedOrigins],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", actorHeader, "x-recording-title", "x-recording-kind"],
  });
  app.addContentTypeParser(/^(?:audio|video)\/[^;\s]+(?:\s*;.*)?$/iu, { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  const staticRoot = webDist ? resolve(webDist) : null;
  const hasWebDist = staticRoot !== null && existsSync(staticRoot) && statSync(staticRoot).isDirectory();
  if (hasWebDist && staticRoot) {
    app.register(fastifyStatic, { root: staticRoot, prefix: "/", wildcard: false });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ServiceError) {
      return reply.code(error.status).send({ error: error.message, fields: error.fields });
    }
    const statusCode = (error as Error & { statusCode?: number }).statusCode;
    if (statusCode !== undefined && statusCode < 500) {
      const invalidJson = (error as Error & { code?: string }).code === "FST_ERR_CTP_INVALID_JSON_BODY";
      return reply.code(statusCode).send({
        error: invalidJson ? "Invalid JSON body" : "Invalid request",
        fields: invalidJson ? { body: "Invalid JSON" } : {},
      });
    }
    const detail = { error: errorMessage(error), stack: error instanceof Error ? error.stack : undefined };
    if (logger) request.log.error({ err: error, detail }, "Unhandled server error");
    else console.error("Unhandled server error", detail);
    return reply.code(500).send({
      error: "Something went wrong on the server. Try again, and check the server log if it keeps happening.",
    });
  });

  const register = <T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    part: InputPart,
    schema: z.ZodType<T>,
    handler: ApiHandler<T>,
    options?: { bodyLimit?: number },
  ) => {
    app.route({
      method,
      url,
      ...options,
      handler: async (request, reply) => {
        const requestInput = part === "body" ? (request.body === undefined ? {} : request.body) : request.query;
        const input = parseInput(schema, requestInput, reply);
        if (input === invalid) return reply;
        return handler(service.as(actorFor(request)), input, request.params as Record<string, string>);
      },
    });
  };
  const get = <T>(url: string, schema: z.ZodType<T>, handler: ApiHandler<T>) => register("GET", url, "query", schema, handler);
  const post = <T>(url: string, schema: z.ZodType<T>, handler: ApiHandler<T>) => register("POST", url, "body", schema, handler);
  const patch = <T>(url: string, schema: z.ZodType<T>, handler: ApiHandler<T>) => register("PATCH", url, "body", schema, handler);
  const put = <T>(url: string, schema: z.ZodType<T>, handler: ApiHandler<T>) => register("PUT", url, "body", schema, handler);
  const del = <T>(url: string, schema: z.ZodType<T>, handler: ApiHandler<T>) => register("DELETE", url, "query", schema, handler);

  app.get("/api/health", async () => ({ ok: true }));
  get("/api/settings", emptySchema, (api) => api.getSettings());
  patch("/api/settings", settingsPatchSchema, (api, input) => api.updateSettings(input));
  get("/api/swarms", emptySchema, (api) => api.listSwarms());
  post("/api/swarms", createSwarmSchema, (api, input) => api.createSwarm(input));
  patch("/api/swarms/:id", updateSwarmSchema, (api, input, params) => api.updateSwarm(params.id!, input));
  get("/api/swarms/:id/overview", emptySchema, (api, _input, params) => api.getOverview(params.id!));
  get("/api/swarms/:id/tree", emptySchema, (api, _input, params) => api.getTree(params.id!));
  post("/api/swarms/:id/agents", addAgentSchema, (api, input, params) => api.addAgent(params.id!, input));
  patch("/api/agents/:id", updateAgentSchema, (api, input, params) => api.updateAgent(params.id!, input));

  get("/api/directives", directiveFilterSchema, (api, input) => api.listDirectives(input));
  post("/api/directives", createDirectiveSchema, (api, input) => api.createDirective(input));
  patch("/api/directives/:id", updateDirectiveSchema, (api, input, params) => api.updateDirective(params.id!, input));
  get("/api/steering/effective", effectiveSteeringQuerySchema, (api, input) => api.getEffectiveSteering(input));
  get("/api/swarms/:id/suggestions", emptySchema, (api, _input, params) => api.listSuggestions(params.id!));
  post("/api/swarms/:id/suggestions/dismiss", dismissSuggestionSchema, (api, input, params) => api.dismissSuggestion(params.id!, input.key));

  get("/api/founders", founderQuerySchema, (api, input) => api.listFounders(input));
  get("/api/founders/:id", emptySchema, (api, _input, params) => api.getFounder(params.id!));
  get("/api/founders/:id/recordings", emptySchema, (api, _input, params) => api.listRecordings(params.id!));
  app.route({
    method: "POST",
    url: "/api/founders/:id/recordings",
    bodyLimit: mediaMaxBytes(),
    handler: async (request, reply) => {
      const founderId = (request.params as Record<string, string>).id!;
      const api = service.as(actorFor(request));
      const contentType = request.headers["content-type"] ?? "";
      if (/^(?:audio|video)\//iu.test(contentType.split(";", 1)[0]!.trim())) {
        const title = request.headers["x-recording-title"];
        const kind = request.headers["x-recording-kind"];
        if (typeof title !== "string" || typeof kind !== "string" || !recordingKinds.includes(kind as (typeof recordingKinds)[number])) {
          return reply.code(400).send({ error: "Recording title and kind headers are required.", fields: { title: "Enter a title.", kind: "Choose talk, interview, or call." } });
        }
        if (!Buffer.isBuffer(request.body)) {
          return reply.code(400).send({ error: "Choose a non-empty recording file.", fields: { file: "Choose a non-empty file." } });
        }
        return api.uploadRecording(founderId, { title, kind: kind as (typeof recordingKinds)[number], contentType, data: new Uint8Array(request.body) });
      }
      const input = parseInput(addRecordingLinkSchema, request.body, reply);
      if (input === invalid) return reply;
      return api.addRecordingLink(founderId, input);
    },
  });
  app.delete("/api/recordings/:id", async (request, reply) => {
    await service.as(actorFor(request)).removeRecording((request.params as Record<string, string>).id!);
    return reply.code(204).send();
  });
  post("/api/founders/:id/feedback", feedbackSchema, (api, input, params) => api.addFeedback(params.id!, input));
  post("/api/founders", addFounderSchema, (api, input) => api.addFounder(input));
  get("/api/companies", companyQuerySchema, (api, input) => api.listCompanies(input));
  get("/api/companies/:id", emptySchema, (api, _input, params) => api.getCompany(params.id!));
  post("/api/companies/:id/feedback", feedbackSchema, (api, input, params) => api.addCompanyFeedback(params.id!, input));
  get("/api/network", emptySchema, (api) => api.getNetwork());
  register("POST", "/api/network/import", "body", networkImportSchema, (api, input) => api.importNetwork(input), { bodyLimit: 10 * 1024 * 1024 });
  del("/api/network/:owner", emptySchema, (api, _input, params) => api.removeNetwork(params.owner!));
  get("/api/outreach", outreachQuerySchema, (api, input) => api.listOutreach(input));
  post("/api/outreach/:id/decision", outreachDecisionSchema, (api, input, params) => api.decideOutreach(params.id!, input));
  post("/api/outreach/:id/complete", outreachCompleteSchema, (api, input, params) => api.completeOutreach(params.id!, input));
  post("/api/outreach/:id/call", placeCallSchema, (api, input, params) => api.placeCall(params.id!, input));
  post("/api/swarms/:id/calls/sync", emptySchema, (api, _input, params) => api.syncCalls(params.id!));

  get("/api/runs", runsQuerySchema, (api, input) => api.listRuns(input.swarmId, input.limit));
  get("/api/runs/:id", emptySchema, (api, _input, params) => api.getRun(params.id!));
  get("/api/tasks/:id", emptySchema, (api, _input, params) => api.getTask(params.id!));
  post("/api/runs", startRunSchema, (api, input) => api.startRun(input));
  post("/api/runs/:id/cancel", emptySchema, (api, _input, params) => api.cancelRun(params.id!));

  get("/api/evals", emptySchema, (api) => api.listEvalFlows());
  get("/api/evals/:id", evalFlowQuerySchema, (api, input, params) =>
    input.swarmId ? api.getEvalFlow(params.id!, input.swarmId) : api.getEvalFlow(params.id!));
  post("/api/evals/:id/rounds", runEvalRoundsSchema, (api, input, params) => api.runEvalRounds(params.id!, input));
  post("/api/evals/:id/promote", promoteEvalVariantSchema, (api, input, params) => api.promoteEvalVariant(params.id!, input));
  post("/api/evals/:id/preview", promoteEvalVariantSchema, (api, input, params) => api.previewEvalVariant(params.id!, input));

  get("/api/swarms/:id/assumptions", emptySchema, (api, _input, params) => api.getAssumptions(params.id!));
  get("/api/swarms/:id/pools", emptySchema, (api, _input, params) => api.getPools(params.id!));
  post("/api/swarms/:id/pools/rebalance", rebalancePoolsSchema, (api, input, params) => api.rebalancePools(params.id!, input));
  put("/api/swarms/:id/pools/:jobId", setPoolSchema, (api, input, params) => api.setPool(params.id!, params.jobId as JobId, input as SetPoolInput));

  get("/api/swarms/:id/hunt", emptySchema, (api, _input, params) => api.getHunt(params.id!));
  get("/api/swarms/:id/hunt/seat", emptySchema, (api, _input, params) => api.getHuntSeat(params.id!));
  post("/api/swarms/:id/hunt/seat/turn", NavigateOutputSchema, (api, input, params) => api.takeHuntTurn(params.id!, input));
  post("/api/swarms/:id/hunt/seat/wave", huntWaveSchema, (api, input, params) => api.runHuntWave(params.id!, input));
  post("/api/swarms/:id/hunt/trails", addHuntTrailSchema, (api, input, params) => api.addHuntTrail(params.id!, input));
  patch("/api/swarms/:id/hunt/trails/:trailId", updateHuntTrailSchema, (api, input, params) => api.updateHuntTrail(params.id!, params.trailId!, input));
  post("/api/swarms/:id/hunt/notes", addHuntNoteSchema, (api, input, params) => api.addHuntNote(params.id!, input));
  del("/api/swarms/:id/hunt/notes/:noteId", emptySchema, (api, _input, params) => api.removeHuntNote(params.id!, params.noteId!));

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split("?", 1)[0] ?? request.url;
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found", fields: {} });
    }
    if (hasWebDist && request.method === "GET") return reply.type("text/html").sendFile("index.html");
    return reply.code(404).send({ error: "Not found", fields: {} });
  });

  return app;
}
