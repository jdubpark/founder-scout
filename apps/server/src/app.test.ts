import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { ServiceError, type SwarmService } from "@agentswarm/core";
import type { ApiClient } from "@agentswarm/shared";
import { buildServer } from "./app";

type Call = { actor: string; method: string; args: unknown[] };
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

describe("buildServer routes", () => {
  it("passes an audio upload as raw bytes and deletes recordings with a no-content response", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);
    const data = Buffer.alloc(2 * 1024 * 1024 + 1, 255);
    data.set([0, 1, 2, 3]);
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/founders/f-1/recordings",
      headers: {
        "content-type": "audio/mpeg",
        "x-recording-title": "Founder talk",
        "x-recording-kind": "talk",
        "x-recording-path": "../../outside.media",
        "x-actor": "Morgan Operator",
      },
      payload: Buffer.from(data),
    });
    const removed = await app.inject({ method: "DELETE", url: "/api/recordings/rec-1", headers: { "x-actor": "Morgan Operator" } });

    expect(uploaded.statusCode).toBe(200);
    expect(calls[0]).toMatchObject({ method: "uploadRecording", actor: "Morgan Operator", args: ["f-1", { title: "Founder talk", kind: "talk", contentType: "audio/mpeg" }] });
    expect(calls[0]?.args[1]).not.toHaveProperty("path");
    expect(Buffer.from((calls[0]?.args[1] as { data: Uint8Array }).data).compare(data)).toBe(0);
    expect(removed.statusCode).toBe(204);
    expect(calls[1]).toMatchObject({ method: "removeRecording", args: ["rec-1"] });
  });

  it("starts a manual run without triggering scheduled coaching", async () => {
    const { service, calls, coach } = fakeService();
    const app = await serverFor(service);

    const response = await app.inject({ method: "POST", url: "/api/runs", payload: { swarmId: "sw-1" } });

    expect(response.statusCode).toBe(200);
    expect(calls.map((call) => call.method)).toEqual(["startRun"]);
    expect(coach).not.toHaveBeenCalled();
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

  it("validates settings, query values, directives and JSON before service calls", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);
    const validSettings = await app.inject({ method: "PATCH", url: "/api/settings", payload: { autopilot: { mode: "apply", budgetUsd: 25 } } });
    const invalidMode = await app.inject({ method: "PATCH", url: "/api/settings", payload: { autopilot: { mode: "automatic" } } });
    const invalidBody = await app.inject({ method: "PATCH", url: "/api/settings", payload: { killSwitch: "yes" } });
    const invalidNumber = await app.inject({ method: "GET", url: "/api/founders?swarmId=sw-1&limit=1.5" });
    const malformedScope = await app.inject({ method: "GET", url: "/api/directives?scope=%7Bnope" });
    const badScopeShape = await app.inject({ method: "GET", url: "/api/directives?scope=%7B%22jobId%22%3A%22unknown%22%7D" });
    const missingName = await app.inject({ method: "POST", url: "/api/swarms", payload: {} });
    const invalidTrailName = await app.inject({ method: "POST", url: "/api/swarms/sw-1/hunt/trails", payload: { name: "  ", searches: [{ engine: "exa", query: "founders" }] } });
    const missingTrailStart = await app.inject({ method: "POST", url: "/api/swarms/sw-1/hunt/trails", payload: { name: "Seed founders" } });
    const invalidSearch = await app.inject({ method: "POST", url: "/api/swarms/sw-1/hunt/trails", payload: { name: "Seed founders", searches: [{ engine: "exa", query: "  " }] } });
    const invalidTrailUpdate = await app.inject({ method: "PATCH", url: "/api/swarms/sw-1/hunt/trails/trail-1", payload: { status: "running", weight: 6 } });
    const longNote = await app.inject({ method: "POST", url: "/api/swarms/sw-1/hunt/notes", payload: { text: "n".repeat(241) } });
    const companyStatus = await app.inject({ method: "GET", url: "/api/companies?swarmId=sw-1&status=unknown" });
    const companySort = await app.inject({ method: "GET", url: "/api/companies?swarmId=sw-1&sort=score" });
    const unknownCompanyQuery = await app.inject({ method: "GET", url: "/api/companies?swarmId=sw-1&surprise=yes" });
    const badShare = await app.inject({ method: "PUT", url: "/api/swarms/sw-1/pools/investigate.background", payload: { members: [{ id: "haiku", route: { provider: "claude-cli", model: "claude-haiku-5-5" }, share: 1.5 }] } });
    const largeBudget = await app.inject({ method: "POST", url: "/api/evals/flow-1/rounds", payload: { budgetUsd: 5000 } });
    const malformedJson = await app.inject({ method: "POST", url: "/api/swarms", headers: { "content-type": "application/json" }, payload: "{not json" });

    expect(validSettings.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "updateSettings", args: [{ autopilot: { mode: "apply", budgetUsd: 25 } }] });
    for (const response of [
      invalidMode, invalidBody, invalidNumber, malformedScope, badScopeShape, missingName,
      invalidTrailName, missingTrailStart, invalidSearch, invalidTrailUpdate, longNote,
      companyStatus, companySort, unknownCompanyQuery, badShare, largeBudget,
    ]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "Request validation failed", fields: expect.any(Object) });
      expect(Object.keys(response.json().fields).length).toBeGreaterThan(0);
    }
    expect(invalidMode.json().fields["autopilot.mode"]).toBeDefined();
    expect(invalidBody.json().fields.killSwitch).toBeDefined();
    expect(invalidNumber.json().fields.limit).toBeDefined();
    expect(malformedScope.json().fields.scope).toBe("Scope must be valid JSON");
    expect(badScopeShape.json().fields.scope).toBe("Scope has an invalid shape");
    expect(missingName.json().fields.name).toBeDefined();
    expect(invalidTrailName.json().fields.name).toBeDefined();
    expect(missingTrailStart.json().fields.searches).toBeDefined();
    expect(invalidSearch.json().fields["searches.0.query"]).toBeDefined();
    expect(invalidTrailUpdate.json().fields).toMatchObject({ status: expect.any(String), weight: expect.any(String) });
    expect(longNote.json().fields.text).toBeDefined();
    expect(companyStatus.json().fields.status).toBeDefined();
    expect(companySort.json().fields.sort).toBeDefined();
    expect(unknownCompanyQuery.json().fields.request).toBeDefined();
    expect(badShare.json().fields["members.0.share"]).toBeDefined();
    expect(largeBudget.json().fields.budgetUsd).toBeDefined();
    expect(malformedJson.statusCode).toBe(400);
    expect(malformedJson.json()).toEqual({ error: "Invalid JSON body", fields: { body: "Invalid JSON" } });
    expect(calls).toHaveLength(1);
  });

  it("accepts six combined Hunt starting points and rejects a seventh", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);
    const sixStarts = await app.inject({
      method: "POST",
      url: "/api/swarms/sw-1/hunt/trails",
      payload: {
        name: "Seed founders",
        searches: [
          { engine: "exa", query: "first" },
          { engine: "exa", query: "second" },
          { engine: "exa", query: "third" },
        ],
        pages: ["https://one.example", "https://two.example", "https://three.example"],
      },
    });
    const sevenStarts = await app.inject({
      method: "POST",
      url: "/api/swarms/sw-1/hunt/trails",
      payload: {
        name: "Too many starts",
        searches: Array.from({ length: 4 }, (_, index) => ({ engine: "exa", query: `query ${index}` })),
        pages: ["https://one.example", "https://two.example", "https://three.example"],
      },
    });

    expect(sixStarts.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[1]).toMatchObject({ searches: expect.arrayContaining([{ engine: "exa", query: "third" }]), pages: expect.arrayContaining(["https://three.example"]) });
    expect(sevenStarts.statusCode).toBe(400);
    expect(sevenStarts.json().fields.searches).toBe("A trail can have at most 6 starting points.");
    expect(calls).toHaveLength(1);
  });

  it("limits the network import separately from the default body cap", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);
    const imported = await app.inject({
      method: "POST",
      url: "/api/network/import",
      payload: { csv: "x".repeat(2 * 1024 * 1024) },
    });
    expect(imported.statusCode).toBe(200);
    expect(calls.at(-1)?.method).toBe("importNetwork");

    const tooLarge = await app.inject({
      method: "POST",
      url: "/api/network/import",
      payload: { csv: "x".repeat(11 * 1024 * 1024) },
    });
    expect(tooLarge.statusCode).toBe(413);

    const defaultLimited = await app.inject({
      method: "POST",
      url: "/api/swarms",
      payload: { name: "x".repeat(1024 * 1024), thesis },
    });
    expect(defaultLimited.statusCode).toBe(413);
    expect(calls).toHaveLength(1);
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

  it("allows CORS only from the two local dashboard origins", async () => {
    const { service } = fakeService();
    const app = await serverFor(service);
    const allowed = await app.inject({ method: "OPTIONS", url: "/api/settings", headers: { origin: "http://localhost:5317", "access-control-request-method": "GET" } });
    const patchAllowed = await app.inject({ method: "OPTIONS", url: "/api/swarms/sw-1/hunt/trails/trail-1", headers: { origin: "http://localhost:5317", "access-control-request-method": "PATCH" } });
    const deleteAllowed = await app.inject({ method: "OPTIONS", url: "/api/swarms/sw-1/hunt/notes/note-1", headers: { origin: "http://localhost:5317", "access-control-request-method": "DELETE" } });
    const otherHost = await app.inject({ method: "OPTIONS", url: "/api/settings", headers: { origin: "http://localhost:5318", "access-control-request-method": "GET" } });
    const allowedIp = await app.inject({ method: "OPTIONS", url: "/api/settings", headers: { origin: "http://127.0.0.1:5317", "access-control-request-method": "GET" } });

    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5317");
    expect(patchAllowed.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(deleteAllowed.headers["access-control-allow-methods"]).toContain("DELETE");
    expect(allowedIp.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5317");
    expect(otherHost.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers only loopback hosts and loopback origins", async () => {
    const { service, calls } = fakeService();
    const app = await serverFor(service);

    // Another site's name pointed at this computer (DNS rebinding).
    const rebound = await app.inject({ method: "GET", url: "/api/swarms", headers: { host: "evil.example" } });
    expect(rebound.statusCode).toBe(403);
    const huntRebound = await app.inject({ method: "GET", url: "/api/swarms/sw-1/hunt", headers: { host: "evil.example" } });
    expect(huntRebound.statusCode).toBe(403);

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
    const health = await app.inject({ method: "GET", url: "/api/health" });
    const unavailableWeb = await serverFor(service, { webDist: join(tmpdir(), "agentswarm-missing-web-dist") });
    const missingPage = await unavailableWeb.inject({ method: "GET", url: "/founders/f-1" });

    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe("window.dashboard = true;");
    expect(routeFallback.statusCode).toBe(200);
    expect(routeFallback.body).toBe("<main>Dashboard shell</main>");
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toEqual({ error: "Not found", fields: {} });
    expect(nonGetFallback.statusCode).toBe(404);
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });
    expect(missingPage.statusCode).toBe(404);
    expect(missingPage.json()).toEqual({ error: "Not found", fields: {} });
  });

});
