import { afterEach, describe, expect, it, vi } from "vitest";

const stream = vi.hoisted(() => ({ listeners: {} as Record<string, (...args: unknown[]) => void> }));
vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => {
    const input = {
      on(event: string, listener: (...args: unknown[]) => void) {
        stream.listeners[event] = listener;
        return input;
      },
    };
    return input;
  }),
}));

import { createMcpHandler, serveMcp } from "./mcp";

afterEach(() => {
  stream.listeners = {};
  vi.restoreAllMocks();
});

describe("hunt seat MCP transport", () => {
  it("reads and writes one newline-delimited JSON-RPC response per request", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const done = serveMcp({ swarmId: "swm_local" });
    stream.listeners.line?.("{not json");
    stream.listeners.line?.(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }));
    stream.listeners.line?.(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    stream.listeners.close?.();
    await done;

    expect(write).toHaveBeenCalledTimes(3);
    const lines = write.mock.calls.map(([line]) => String(line));
    expect(lines.every((line) => line.endsWith("\n"))).toBe(true);
    expect(JSON.parse(lines[0]!).error.code).toBe(-32700);
    expect(JSON.parse(lines[1]!).result.protocolVersion).toBe("2025-03-26");
    expect(JSON.parse(lines[2]!).result.tools.map((tool: { name: string }) => tool.name)).toEqual(["hunt_view", "hunt_turn", "hunt_wave"]);
  });

  it("handles MCP requests and converts server conflicts to tool errors", async () => {
    expect(() => createMcpHandler({ url: "http://remote.example" })).toThrow(/loopback/i);
    const handler = createMcpHandler({
      swarmId: "swm_local",
      fetch: async () => new Response(JSON.stringify({ error: "The outside agent does not hold this swarm's seat." }), { status: 409 }),
    });
    const initialized = JSON.parse((await handler(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })))!);
    expect(initialized.result.protocolVersion).toBe("2025-03-26");
    const listed = JSON.parse((await handler(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })))!);
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["hunt_view", "hunt_turn", "hunt_wave"]);
    const call = JSON.parse((await handler(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "hunt_view" } })))!);
    expect(call.result.isError).toBe(true);
    expect(call.result.content[0].text).toContain("does not hold this swarm's seat");
  });
});
