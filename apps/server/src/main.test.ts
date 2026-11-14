import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(),
  buildServer: vi.fn(),
  resolveConfig: vi.fn(),
  createCronHelper: vi.fn(),
  startScheduler: vi.fn(),
}));

vi.mock("@agentswarm/core", () => ({ createApp: mocks.createApp }));
vi.mock("./app", () => ({ buildServer: mocks.buildServer }));
vi.mock("./config", () => ({ resolveConfig: mocks.resolveConfig }));
vi.mock("./cron", () => ({ createCronHelper: mocks.createCronHelper }));
vi.mock("./scheduler", () => ({ startScheduler: mocks.startScheduler }));

import { assertLoopbackHost, isLoopbackHost, startServer } from "./main";

describe("server host guard", () => {
  it.each(["127.0.0.1", "localhost", "::1"])("allows %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
    expect(() => assertLoopbackHost(host)).not.toThrow();
  });

  it.each(["0.0.0.0", "192.168.1.20", "example.com"])("refuses %s", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
    expect(() => assertLoopbackHost(host)).toThrow(/no login yet/i);
  });

  it("passes the configured loopback host to the listener", async () => {
    const service = {
      ensureSeeded: vi.fn(async () => undefined),
      runs: { recover: vi.fn(async () => 0) },
      as: vi.fn(() => ({ listSwarms: vi.fn(async () => []) })),
    };
    const app = { service, close: vi.fn() };
    const http = { listen: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
    const scheduler = { stop: vi.fn(), waitForIdle: vi.fn(async () => undefined) };
    mocks.resolveConfig.mockReturnValue({
      host: "127.0.0.1", port: 4317, dbPath: ":memory:", dataDir: ".", flowsDir: ".", datasetsDir: ".",
      evalJudge: "sim", simSeed: 1, fundName: "Northstar Ventures", webDist: null,
    });
    mocks.createApp.mockReturnValue(app);
    mocks.buildServer.mockReturnValue(http);
    mocks.createCronHelper.mockReturnValue({ isValid: () => true, next: () => null });
    mocks.startScheduler.mockReturnValue(scheduler);

    const starting = startServer();
    await vi.waitFor(() => expect(http.listen).toHaveBeenCalledOnce());
    expect(http.listen).toHaveBeenCalledWith({ port: 4317, host: "127.0.0.1" });
    process.emit("SIGINT");
    await starting;
    expect(http.close).toHaveBeenCalledOnce();
    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
  });
});
