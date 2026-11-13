import { createInterface } from "node:readline";
import { ACTOR_HEADER, NavigateOutputSchema } from "@agentswarm/shared";
import type { NavigateTurn } from "@agentswarm/shared";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Fetcher = typeof fetch;

function loopbackUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase())) {
    throw new Error("The MCP server URL must use HTTP on a loopback host.");
  }
  return url;
}

function errorResponse(id: Rpc["id"], code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function toolDefinitions() {
  const turn = NavigateOutputSchema.toJSONSchema();
  return [
    { name: "hunt_view", description: "Read the navigator's current view of the hunt. It contains the thesis, brief, trail counts and short labels, recent notes, last wave digest, and budget, with no page text or founder dossiers. Use this before choosing a turn.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "hunt_turn", description: "Ask the hunt to open or extend trails, close trails, focus attention, or save short notes. The server checks each request using the same rules as its built in navigator, and returns accepted changes and refusals. Read the view first and write only search direction, never scoring guidance.", inputSchema: turn },
    { name: "hunt_wave", description: "Send one to three waves of hunt runners using the current notebook and schedule sources. Wait for the wave to finish, then read its digest and the new view before deciding what to do next.", inputSchema: { type: "object", properties: { waves: { type: "integer", minimum: 1, maximum: 3 } }, additionalProperties: false } },
  ];
}

export function createMcpHandler(options: { url?: string; swarmId?: string; fetch?: Fetcher }) {
  const base = loopbackUrl(options.url ?? "http://127.0.0.1:4317");
  const fetcher = options.fetch ?? fetch;

  async function swarmId(): Promise<string> {
    if (options.swarmId) return options.swarmId;
    const response = await fetcher(new URL("/api/swarms", base), { headers: { [ACTOR_HEADER]: "Outside agent" } });
    if (!response.ok) throw new Error(`The server answered with an error (${response.status}).`);
    const swarms = await response.json() as Array<{ id: string }>;
    if (!swarms[0]) throw new Error("No swarm is available.");
    return swarms[0].id;
  }

  async function callTool(name: string, args: Record<string, unknown>) {
    const selected = await swarmId();
    let path: string;
    let method = "GET";
    let body: string | undefined;
    if (name === "hunt_view") {
      if (Object.keys(args).length) throw new Error("hunt_view takes no arguments.");
      path = `/api/swarms/${encodeURIComponent(selected)}/hunt/seat`;
    } else if (name === "hunt_turn") {
      const parsed = NavigateOutputSchema.safeParse(args);
      if (!parsed.success) throw new Error("hunt_turn arguments must match the NavigateTurn shape.");
      path = `/api/swarms/${encodeURIComponent(selected)}/hunt/seat/turn`;
      method = "POST";
      body = JSON.stringify(parsed.data satisfies NavigateTurn);
    } else if (name === "hunt_wave") {
      const waves = args.waves;
      if (Object.keys(args).some((key) => key !== "waves") || (waves !== undefined && (!Number.isInteger(waves) || Number(waves) < 1 || Number(waves) > 3))) {
        throw new Error("hunt_wave accepts an optional waves value from 1 to 3.");
      }
      path = `/api/swarms/${encodeURIComponent(selected)}/hunt/seat/wave`;
      method = "POST";
      body = JSON.stringify(args);
    } else {
      throw new Error(`Unknown hunt tool: ${name}`);
    }
    const response = await fetcher(new URL(path, base), {
      method,
      headers: { [ACTOR_HEADER]: "Outside agent", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body } : {}),
    });
    let text: string;
    try {
      const data = await response.json() as unknown;
      if (!response.ok) {
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : `The server answered with an error (${response.status}).`;
        return { content: [{ type: "text", text: message }], isError: true };
      }
      text = JSON.stringify(data);
    } catch {
      text = response.ok ? "null" : `The server answered with an error (${response.status}).`;
      if (!response.ok) return { content: [{ type: "text", text }], isError: true };
    }
    return { content: [{ type: "text", text }] };
  }

  return async (line: string): Promise<string | null> => {
    let request: Rpc;
    try {
      request = JSON.parse(line) as Rpc;
    } catch {
      return errorResponse(null, -32700, "Parse error");
    }
    if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") return errorResponse(request?.id, -32600, "Invalid Request");
    const hasId = Object.hasOwn(request, "id");
    if (request.method === "notifications/initialized") return null;
    if (!hasId) return errorResponse(null, -32600, "Request id is required");
    if (request.method === "initialize") {
      const clientVersion = request.params?.protocolVersion;
      const protocolVersion = typeof clientVersion === "string" && (PROTOCOLS as readonly string[]).includes(clientVersion) ? clientVersion : PROTOCOLS[0];
      return JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "founder-scout-hunt-seat", version: "1.0.0" } } });
    }
    if (request.method === "ping") return JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} });
    if (request.method === "tools/list") return JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: toolDefinitions() } });
    if (request.method === "tools/call") {
      const name = request.params?.name;
      const args = request.params?.arguments;
      if (typeof name !== "string" || (args !== undefined && (!args || typeof args !== "object" || Array.isArray(args)))) return errorResponse(request.id, -32602, "Invalid tool call parameters");
      try {
        const result = await callTool(name, (args ?? {}) as Record<string, unknown>);
        return JSON.stringify({ jsonrpc: "2.0", id: request.id, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("Unknown hunt tool:")) return errorResponse(request.id, -32602, message);
        return JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: message }], isError: true } });
      }
    }
    return errorResponse(request.id, -32601, `Method not found: ${request.method}`);
  };
}

export function serveMcp(options: { url?: string; swarmId?: string }): Promise<void> {
  const handle = createMcpHandler(options);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let pending = Promise.resolve();
  const done = new Promise<void>((resolve) => input.on("close", resolve));
  input.on("line", (line) => {
    pending = pending.then(async () => {
      try {
        const response = await handle(line);
        if (response !== null) process.stdout.write(`${response}\n`);
      } catch (error) {
        process.stdout.write(`${errorResponse(null, -32603, error instanceof Error ? error.message : String(error))}\n`);
      }
    });
  });
  return done;
}
