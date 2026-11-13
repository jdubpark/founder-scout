import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { ServiceError, type SwarmService } from "@agentswarm/core";
import { ACTOR_HEADER, AGENT_CLASSES, JOBS } from "@agentswarm/shared";
import type { ApiClient, ClassId, CompanySort, CompanyStatus, DirectiveFilter, JobId } from "@agentswarm/shared";

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
  .object({ rounds: z.number().int().positive().optional(), brain: z.enum(["sim", "live"]).optional() })
  .strict();
const promoteEvalVariantSchema = z.object({ variant: requiredText, swarmId: requiredText }).strict();
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
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", actorHeader],
  });

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
    method: "GET" | "POST" | "PATCH" | "DELETE",
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

  get("/api/runs", runsQuerySchema, (api, input) => api.listRuns(input.swarmId, input.limit));
  get("/api/runs/:id", emptySchema, (api, _input, params) => api.getRun(params.id!));
  get("/api/tasks/:id", emptySchema, (api, _input, params) => api.getTask(params.id!));
  post("/api/runs", startRunSchema, (api, input) => api.startRun(input));
  post("/api/runs/:id/cancel", emptySchema, (api, _input, params) => api.cancelRun(params.id!));

  get("/api/evals", emptySchema, (api) => api.listEvalFlows());
  get("/api/evals/:id", emptySchema, (api, _input, params) => api.getEvalFlow(params.id!));
  post("/api/evals/:id/rounds", runEvalRoundsSchema, (api, input, params) => api.runEvalRounds(params.id!, input));
  post("/api/evals/:id/promote", promoteEvalVariantSchema, (api, input, params) => api.promoteEvalVariant(params.id!, input));

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
