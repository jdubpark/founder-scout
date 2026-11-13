import { describe, expect, it, vi } from "vitest";
import type { ApiClient, EvalFlowDTO, Run, SettingsDTO, Swarm } from "@agentswarm/shared";
import type { DoctorRow, SwarmService } from "@agentswarm/core";
import { runCliCommand } from "./cli";

function fakeService() {
  const calls: Array<{ actor: string; method: string; args: unknown[] }> = [];
  const run = {
    id: "run-1", swarmId: "swarm-1", trigger: "manual", brain: "sim", sources: "sim", status: "succeeded",
    stage: null, configId: "config-1", budgetUsd: 2, costUsd: 0.12,
    stats: { leads: 3, screenedIn: 2, investigated: 1, surfaced: 1 }, error: null, simDay: 1,
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z",
  } as Run;
  const flow = {
    id: "flow-1", label: "Founder ranking", description: "Test flow", headlineMetric: "ndcg5",
    variants: [
      { id: "baseline", round: 0, description: "Starting point", status: "baseline", changes: [], test: { ndcg5: 0.5 }, train: { ndcg5: 0.55 } },
      { id: "v1", round: 1, description: "Weight strong evidence", status: "kept", changes: ["Weight evidence more"], test: { ndcg5: 0.6 }, train: { ndcg5: 0.62 } },
    ],
  } as unknown as EvalFlowDTO;
  const api = {
    listSwarms: vi.fn(async () => [{ id: "swarm-1" } as Swarm]),
    startRun: vi.fn(async () => run),
    listEvalFlows: vi.fn(async () => [{ id: "flow-1" }]),
    getEvalFlow: vi.fn(async () => flow),
    getSettings: vi.fn(async () => ({ sources: [{ id: "github", configured: false, detail: "No token" }] } as unknown as SettingsDTO)),
  } as unknown as ApiClient;
  const service = {
    as: vi.fn((actor: string) => {
      calls.push({ actor, method: "as", args: [] });
      return api;
    }),
    ensureSeeded: vi.fn(async () => undefined),
    runs: { wait: vi.fn(async () => run) },
  } as unknown as SwarmService;
  return { service, api, calls, run, flow };
}

describe("CLI commands", () => {
  it("runs one simulated run, waits for it, and prints funnel and cost", async () => {
    const { service, api, calls, run } = fakeService();
    const lines: string[] = [];
    const status = await runCliCommand(service, ["run", "--brain", "sim", "--sources", "sim"], (line) => lines.push(line));

    expect(status).toBe(0);
    expect(service.ensureSeeded).toHaveBeenCalledOnce();
    expect(calls.some((call) => call.actor === "Partner")).toBe(true);
    expect(api.startRun).toHaveBeenCalledWith({ swarmId: "swarm-1", brain: "sim", sources: "sim" });
    expect(service.runs.wait).toHaveBeenCalledWith(run.id);
    expect(lines[0]).toContain("succeeded leads=3 screened=2 investigated=1 surfaced=1 cost=$0.12");
  });

  it("prints provider and source readiness without making live calls", async () => {
    const { service } = fakeService();
    const lines: string[] = [];
    const doctor = vi.fn(async () => [{ provider: "openai-api", configured: false, detail: "No key", live: null } as DoctorRow]);
    const status = await runCliCommand(service, ["doctor"], (line) => lines.push(line), { doctor });

    expect(status).toBe(0);
    expect(doctor).toHaveBeenCalledWith({ live: false, env: undefined });
    expect(lines).toEqual(["provider openai-api: not configured — No key", "source github: not configured — No token"]);
  });

  it("shows eval rounds as a compact table with a zero exit status", async () => {
    const { service } = fakeService();
    const lines: string[] = [];
    const status = await runCliCommand(service, ["eval", "show", "--flow", "flow-1"], (line) => lines.push(line));

    expect(status).toBe(0);
    expect(lines[0]).toBe("round | change | test | train | status");
    expect(lines[2]).toBe("1 | Weight evidence more | 0.600 | 0.620 | kept");
  });
});
