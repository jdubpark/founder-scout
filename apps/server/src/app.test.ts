import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { ServiceError, type SwarmService } from "@agentswarm/core";
import type { ApiClient } from "@agentswarm/shared";
import { buildServer } from "./app";

type Call = { actor: string; method: string; args: unknown[] };
type RouteCase = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  apiMethod: string;
  args?: unknown[];
  body?: Record<string, unknown>;
};

const apps: FastifyInstance[] = [];
let tempWebDist: string | undefined;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  if (tempWebDist) {
    await rm(tempWebDist, { recursive: true, force: true });
    tempWebDist = undefined;
  }
  vi.restoreAllMocks();
});

function fakeService(failure?: unknown) {
  const calls: Call[] = [];
  const coach = vi.fn(async () => ({}));
  const service = {
    as(actor: string) {
      return new Proxy(
        {},
        {
          get: (_target, property) =>
            (...args: unknown[]) => {
              const method = String(property);
              calls.push({ actor, method, args });
              if (failure !== undefined) throw failure;
              return { method, args };
            },
        },
      ) as ApiClient;
    },
    coach,
  } as unknown as SwarmService;
  return { service, calls, coach };
}

async function serverFor(service: SwarmService, options: { webDist?: string | null; logger?: boolean } = {}) {
  const app = await buildServer({ service, ...options });
  apps.push(app);
  return app;
}

const thesis = { summary: "AI tools", sectors: [], stages: [], geos: [], avoid: [] };

const routeCases: RouteCase[] = [
  { method: "GET", url: "/api/settings", apiMethod: "getSettings" },
  { method: "PATCH", url: "/api/settings", apiMethod: "updateSettings", args: [{ killSwitch: true }], body: { killSwitch: true } },
  { method: "GET", url: "/api/swarms", apiMethod: "listSwarms" },
  { method: "POST", url: "/api/swarms", apiMethod: "createSwarm", args: [{ name: "AI", thesis }], body: { name: "AI", thesis } },
  { method: "PATCH", url: "/api/swarms/sw-1", apiMethod: "updateSwarm", args: ["sw-1", { status: "paused" }], body: { status: "paused" } },
  { method: "GET", url: "/api/swarms/sw-1/overview", apiMethod: "getOverview", args: ["sw-1"] },
  { method: "GET", url: "/api/swarms/sw-1/tree", apiMethod: "getTree", args: ["sw-1"] },
  { method: "POST", url: "/api/swarms/sw-1/agents", apiMethod: "addAgent", args: ["sw-1", { jobId: "scout.github" }], body: { jobId: "scout.github" } },
  { method: "PATCH", url: "/api/agents/ag-1", apiMethod: "updateAgent", args: ["ag-1", { status: "paused" }], body: { status: "paused" } },
  {
    method: "GET",
    url: "/api/directives?swarmId=sw-1&scope=%7B%22swarmId%22%3A%22sw-1%22%7D",
    apiMethod: "listDirectives",
    args: [{ swarmId: "sw-1", scope: { swarmId: "sw-1" } }],
  },
  {
    method: "POST",
    url: "/api/directives",
    apiMethod: "createDirective",
    args: [{ scope: {}, kind: "rule", text: "Check the source" }],
    body: { scope: {}, kind: "rule", text: "Check the source" },
  },
  { method: "PATCH", url: "/api/directives/d-1", apiMethod: "updateDirective", args: ["d-1", { status: "paused" }], body: { status: "paused" } },
  {
    method: "GET",
    url: "/api/steering/effective?swarmId=sw-1&jobId=scout.github",
    apiMethod: "getEffectiveSteering",
    args: [{ swarmId: "sw-1", jobId: "scout.github" }],
  },
  { method: "GET", url: "/api/swarms/sw-1/suggestions", apiMethod: "listSuggestions", args: ["sw-1"] },
  {
    method: "POST",
    url: "/api/swarms/sw-1/suggestions/dismiss",
    apiMethod: "dismissSuggestion",
    args: ["sw-1", "key-1"],
    body: { key: "key-1" },
  },
  {
    method: "GET",
    url: "/api/founders?swarmId=sw-1&limit=20&offset=5",
    apiMethod: "listFounders",
    args: [{ swarmId: "sw-1", limit: 20, offset: 5 }],
  },
  { method: "GET", url: "/api/founders/f-1", apiMethod: "getFounder", args: ["f-1"] },
  {
    method: "POST",
    url: "/api/founders/f-1/feedback",
    apiMethod: "addFeedback",
    args: ["f-1", { verdict: "yes", reasonTags: ["builder"] }],
    body: { verdict: "yes", reasonTags: ["builder"] },
  },
  {
    method: "POST",
    url: "/api/founders",
    apiMethod: "addFounder",
    args: [{ swarmId: "sw-1", name: "Ada Lovelace", companyName: "Analytical Engines", why: "Built an early computing concept." }],
    body: { swarmId: "sw-1", name: "Ada Lovelace", companyName: "Analytical Engines", why: "Built an early computing concept." },
  },
  {
    method: "GET",
    url: "/api/companies?swarmId=sw-1&status=needs_evidence&q=Orbit&sort=deal&limit=15&offset=3",
    apiMethod: "listCompanies",
    args: [{ swarmId: "sw-1", status: "needs_evidence", q: "Orbit", sort: "deal", limit: 15, offset: 3 }],
  },
  { method: "GET", url: "/api/companies/co-1", apiMethod: "getCompany", args: ["co-1"] },
  {
    method: "POST",
    url: "/api/companies/co-1/feedback",
    apiMethod: "addCompanyFeedback",
    args: ["co-1", { verdict: "yes", reasonTags: ["real_pull"] }],
    body: { verdict: "yes", reasonTags: ["real_pull"] },
  },
  { method: "GET", url: "/api/network", apiMethod: "getNetwork" },
  {
    method: "POST",
    url: "/api/network/import",
    apiMethod: "importNetwork",
    args: [{ csv: "First Name,Last Name\nAda,Lovelace\n" }],
    body: { csv: "First Name,Last Name\nAda,Lovelace\n" },
  },
  { method: "DELETE", url: "/api/network/Partner", apiMethod: "removeNetwork", args: ["Partner"] },
  { method: "GET", url: "/api/outreach?swarmId=sw-1&status=proposed", apiMethod: "listOutreach", args: [{ swarmId: "sw-1", status: "proposed" }] },
  {
    method: "POST",
    url: "/api/outreach/out-1/decision",
    apiMethod: "decideOutreach",
    args: ["out-1", { decision: "approve" }],
    body: { decision: "approve" },
  },
  {
    method: "POST",
    url: "/api/outreach/out-1/complete",
    apiMethod: "completeOutreach",
    args: ["out-1", { summary: "Had a useful call" }],
    body: { summary: "Had a useful call" },
  },
  { method: "GET", url: "/api/runs?swarmId=sw-1&limit=8", apiMethod: "listRuns", args: ["sw-1", 8] },
  { method: "GET", url: "/api/runs/run-1", apiMethod: "getRun", args: ["run-1"] },
  { method: "GET", url: "/api/tasks/task-1", apiMethod: "getTask", args: ["task-1"] },
  { method: "POST", url: "/api/runs", apiMethod: "startRun", args: [{ swarmId: "sw-1", brain: "sim" }], body: { swarmId: "sw-1", brain: "sim" } },
  { method: "POST", url: "/api/runs/run-1/cancel", apiMethod: "cancelRun", args: ["run-1"] },
  { method: "GET", url: "/api/evals", apiMethod: "listEvalFlows" },
  { method: "GET", url: "/api/evals/flow-1", apiMethod: "getEvalFlow", args: ["flow-1"] },
  { method: "GET", url: "/api/evals/flow-1?swarmId=sw-2", apiMethod: "getEvalFlow", args: ["flow-1", "sw-2"] },
  { method: "POST", url: "/api/evals/flow-1/rounds", apiMethod: "runEvalRounds", args: ["flow-1", {}], body: {} },
  {
    method: "POST",
    url: "/api/evals/flow-1/promote",
    apiMethod: "promoteEvalVariant",
    args: ["flow-1", { variant: "v1", swarmId: "sw-1" }],
    body: { variant: "v1", swarmId: "sw-1" },
  },
  {
    method: "POST",
    url: "/api/evals/flow-1/preview",
    apiMethod: "previewEvalVariant",
    args: ["flow-1", { variant: "v1", swarmId: "sw-1" }],
    body: { variant: "v1", swarmId: "sw-1" },
  },
  {
    method: "POST",
    url: "/api/evals/flow-1/rounds",
    apiMethod: "runEvalRounds",
    args: ["flow-1", { rounds: 0, brain: "live", budgetUsd: 2.5 }],
    body: { rounds: 0, brain: "live", budgetUsd: 2.5 },
  },
  { method: "GET", url: "/api/swarms/sw-1/assumptions", apiMethod: "getAssumptions", args: ["sw-1"] },
  { method: "GET", url: "/api/swarms/sw-1/pools", apiMethod: "getPools", args: ["sw-1"] },
  {
    method: "PUT",
    url: "/api/swarms/sw-1/pools/investigate.background",
    apiMethod: "setPool",
    args: ["sw-1", "investigate.background", { members: [{ id: "haiku", route: { provider: "claude-cli", model: "claude-haiku-5-5" }, share: 1 }] }],
    body: { members: [{ id: "haiku", route: { provider: "claude-cli", model: "claude-haiku-5-5" }, share: 1 }] },
  },
  {
    method: "POST",
    url: "/api/swarms/sw-1/pools/rebalance",
    apiMethod: "rebalancePools",
    args: ["sw-1", { apply: true }],
    body: { apply: true },
  },
];

describe("buildServer routes", () => {
  it("maps every ApiClient method to its documented route and passes the parsed values", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);

    for (const route of routeCases) {
      const response = await app.inject({
        method: route.method,
        url: route.url,
        headers: { "x-actor": "  Morgan Operator  " },
        ...(route.body === undefined ? {} : { payload: route.body }),
      });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(200);
      expect(response.json()).toEqual({ method: route.apiMethod, args: route.args ?? [] });
    }

    expect(calls).toHaveLength(routeCases.length);
    expect(calls.every((call) => call.actor === "Morgan Operator")).toBe(true);
  });

  it("starts a manual run without triggering scheduled coaching", async () => {
    const { service, calls, coach } = fakeService();
    const app = await serverFor(service);

    const response = await app.inject({ method: "POST", url: "/api/runs", payload: { swarmId: "sw-1" } });

    expect(response.statusCode).toBe(200);
    expect(calls.map((call) => call.method)).toEqual(["startRun"]);
    expect(coach).not.toHaveBeenCalled();
  });

  it("accepts valid autopilot settings and rejects an unsupported mode", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);

    const valid = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: { autopilot: { mode: "apply", budgetUsd: 25 } },
    });
    const invalid = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: { autopilot: { mode: "automatic" } },
    });

    expect(valid.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("updateSettings");
    expect(calls[0]?.args).toEqual([{ autopilot: { mode: "apply", budgetUsd: 25 } }]);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: "Request validation failed", fields: { "autopilot.mode": expect.any(String) } });
    expect(calls).toHaveLength(1);
  });

  it("defaults blank actors and trims before enforcing the 60-character limit", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);
    await app.inject({ method: "GET", url: "/api/swarms", headers: { "x-actor": "   " } });
    const longActor = `  ${"a".repeat(62)}  `;
    await app.inject({ method: "GET", url: "/api/swarms", headers: { "x-actor": longActor } });
    await app.inject({ method: "GET", url: "/api/swarms" });

    expect(calls.map((call) => call.actor)).toEqual(["Partner", "a".repeat(60), "Partner"]);
  });

  it("returns field errors for invalid bodies, numeric queries and malformed scope JSON", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);
    const invalidBody = await app.inject({ method: "PATCH", url: "/api/settings", payload: { killSwitch: "yes" } });
    const invalidNumber = await app.inject({ method: "GET", url: "/api/founders?swarmId=sw-1&limit=1.5" });
    const malformedScope = await app.inject({ method: "GET", url: "/api/directives?scope=%7Bnope" });
    const badScopeShape = await app.inject({ method: "GET", url: "/api/directives?scope=%7B%22jobId%22%3A%22unknown%22%7D" });

    for (const response of [invalidBody, invalidNumber, malformedScope, badScopeShape]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "Request validation failed", fields: expect.any(Object) });
      expect(Object.keys(response.json().fields).length).toBeGreaterThan(0);
    }
    expect(invalidBody.json().fields.killSwitch).toBeDefined();
    expect(invalidNumber.json().fields.limit).toBeDefined();
    expect(malformedScope.json().fields.scope).toBe("Scope must be valid JSON");
    expect(badScopeShape.json().fields.scope).toBe("Scope has an invalid shape");
    expect(calls).toHaveLength(0);
  });

  it("strictly validates the company query contract", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);
    const unsupportedStatus = await app.inject({ method: "GET", url: "/api/companies?swarmId=sw-1&status=unknown" });
    const unsupportedSort = await app.inject({ method: "GET", url: "/api/companies?swarmId=sw-1&sort=score" });
    const unknownQuery = await app.inject({ method: "GET", url: "/api/companies?swarmId=sw-1&surprise=yes" });

    for (const response of [unsupportedStatus, unsupportedSort, unknownQuery]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "Request validation failed", fields: expect.any(Object) });
    }
    expect(unsupportedStatus.json().fields.status).toBeDefined();
    expect(unsupportedSort.json().fields.sort).toBeDefined();
    expect(unknownQuery.json().fields.request).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it("allows a 2 MB network import while retaining the default body cap elsewhere", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);
    const imported = await app.inject({
      method: "POST",
      url: "/api/network/import",
      payload: { csv: "x".repeat(2 * 1024 * 1024) },
    });
    expect(imported.statusCode).toBe(200);
    expect(calls.at(-1)?.method).toBe("importNetwork");

    const defaultLimited = await app.inject({
      method: "POST",
      url: "/api/swarms",
      payload: { name: "x".repeat(1024 * 1024), thesis },
    });
    expect(defaultLimited.statusCode).toBe(413);
    expect(calls).toHaveLength(1);
  });

  it("reports a missing required body field", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);
    const response = await app.inject({ method: "POST", url: "/api/swarms", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Request validation failed", fields: { name: expect.any(String) } });
    expect(calls).toHaveLength(0);
  });

  it("refuses a pool whose share is out of range and an eval budget above the ceiling", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);
    const badShare = await app.inject({
      method: "PUT",
      url: "/api/swarms/sw-1/pools/investigate.background",
      payload: { members: [{ id: "haiku", route: { provider: "claude-cli", model: "claude-haiku-5-5" }, share: 1.5 }] },
    });
    expect(badShare.statusCode).toBe(400);
    const bigBudget = await app.inject({ method: "POST", url: "/api/evals/flow-1/rounds", payload: { budgetUsd: 5000 } });
    expect(bigBudget.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("normalizes malformed JSON bodies into the public 400 shape", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);
    const response = await app.inject({
      method: "POST",
      url: "/api/swarms",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid JSON body", fields: { body: "Invalid JSON" } });
    expect(calls).toHaveLength(0);
  });

  it("preserves ServiceError status and fields", async () => {
    const { service } = fakeService(new ServiceError(409, "Run already active", { swarmId: "Already running" }));
    const app = await serverFor(service);
    const response = await app.inject({ method: "POST", url: "/api/runs", payload: { swarmId: "sw-1" } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Run already active", fields: { swarmId: "Already running" } });
  });

  it("logs unexpected failures but returns a generic 500", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { service } = fakeService(new Error("database password is private"));
    const app = await serverFor(service, { logger: false });
    const response = await app.inject({ method: "GET", url: "/api/settings" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "Something went wrong on the server. Try again, and check the server log if it keeps happening.",
    });
    expect(response.body).not.toContain("database password");
    expect(errorLog).toHaveBeenCalledWith("Unhandled server error", expect.objectContaining({ error: "database password is private" }));
  });

  it("returns health and JSON 404s for unknown API routes", async () => {
    const { service } = fakeService();
    const app = await serverFor(service);
    const health = await app.inject({ method: "GET", url: "/api/health" });
    const missing = await app.inject({ method: "GET", url: "/api/not-a-route" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Not found", fields: {} });
  });

  it("allows CORS only from the two local dashboard origins", async () => {
    const { service } = fakeService();
    const app = await serverFor(service);
    const allowed = await app.inject({ method: "OPTIONS", url: "/api/settings", headers: { origin: "http://localhost:5317", "access-control-request-method": "GET" } });
    const otherHost = await app.inject({ method: "OPTIONS", url: "/api/settings", headers: { origin: "http://localhost:5318", "access-control-request-method": "GET" } });
    const allowedIp = await app.inject({ method: "OPTIONS", url: "/api/settings", headers: { origin: "http://127.0.0.1:5317", "access-control-request-method": "GET" } });

    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5317");
    expect(allowedIp.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5317");
    expect(otherHost.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers only loopback hosts and loopback origins", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);

    // Another site's name pointed at this computer (DNS rebinding).
    const rebound = await app.inject({ method: "GET", url: "/api/swarms", headers: { host: "evil.example" } });
    expect(rebound.statusCode).toBe(403);

    // Another site's page posting here.
    const crossSite = await app.inject({
      method: "POST",
      url: "/api/runs/run_1/cancel",
      headers: { host: "127.0.0.1:4317", origin: "https://evil.example" },
    });
    expect(crossSite.statusCode).toBe(403);
    const sandboxed = await app.inject({ method: "POST", url: "/api/runs/run_1/cancel", headers: { host: "127.0.0.1:4317", origin: "null" } });
    expect(sandboxed.statusCode).toBe(403);
    expect(calls).toEqual([]);

    // The dashboard itself, served by this server or by the dev server.
    for (const headers of [
      { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" },
      { host: "localhost:5317", origin: "http://localhost:5317" },
      { host: "[::1]:4317" },
    ]) {
      const ok = await app.inject({ method: "POST", url: "/api/runs/run_1/cancel", headers });
      expect(ok.statusCode).toBe(200);
    }
    expect(calls.map((call) => call.method)).toEqual(["cancelRun", "cancelRun", "cancelRun"]);
  });

  it("serves built assets and the SPA fallback while keeping unknown API paths JSON", async () => {
    tempWebDist = await mkdtemp(join(tmpdir(), "agentswarm-web-"));
    await mkdir(join(tempWebDist, "assets"), { recursive: true });
    await writeFile(join(tempWebDist, "index.html"), "<main>Dashboard shell</main>");
    await writeFile(join(tempWebDist, "assets", "app.js"), "window.dashboard = true;");
    const { service } = fakeService();
    const app = await serverFor(service, { webDist: tempWebDist });

    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    const routeFallback = await app.inject({ method: "GET", url: "/founders/f-1" });
    const missingApi = await app.inject({ method: "GET", url: "/api/missing" });
    const nonGetFallback = await app.inject({ method: "POST", url: "/missing" });

    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe("window.dashboard = true;");
    expect(routeFallback.statusCode).toBe(200);
    expect(routeFallback.body).toBe("<main>Dashboard shell</main>");
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toEqual({ error: "Not found", fields: {} });
    expect(nonGetFallback.statusCode).toBe(404);
  });

  it("returns 404 for non-API GETs when no web distribution is available", async () => {
    const { service } = fakeService();
    const app = await serverFor(service, { webDist: join(tmpdir(), "agentswarm-missing-web-dist") });
    const response = await app.inject({ method: "GET", url: "/founders/f-1" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not found", fields: {} });
  });
});
