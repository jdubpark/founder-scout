import { describe, expect, it } from "vitest";
import { createMcpHandler } from "./mcp";

describe("hunt seat MCP transport", () => {
  it("speaks newline JSON-RPC and returns server conflicts as tool errors", async () => {
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
