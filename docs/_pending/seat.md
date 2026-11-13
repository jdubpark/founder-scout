## README

Outside agents can take the hunt navigator seat through the stdio MCP server. Start the local API, then connect Claude Code or Codex with `pnpm swarm mcp --swarm SWARM_ID`.

## Design

The seat API returns the same `NavigateInput` built for the built-in navigator. A shared engine builder keeps the view aligned: thesis, configured search engines and limits, trail digests, recent notes, last wave, and budget. It never includes page text or founder dossiers.

The configured holder is `hunt.navigator`; the active holder also depends on `Hunt.seatAt` and `hunt.outside_idle_days`. An outside turn uses `SEAT_ASKER`, passes through `applyNavigatorTurn` and `checkTurn`, updates `seatAt`, and records an audit entry. Personal attributes are refused at the service boundary.

An outside wave starts a hunt-only run with trigger `agent`, schedule brain and sources, and waits for completion. Turn calls are refused during a hunt stage. Wave calls are refused while any run is active. The stdio MCP process forwards only to the loopback HTTP API and never opens the database.

## Rules

- The outside agent sees the navigator's bounded view and every request passes the navigator's checks. `packages/core/src/service/index.test.ts` and `packages/core/src/engine/hunt.test.ts` fail if the seat gains page access or bypasses a pinned trail or address check.
- MCP speaks newline JSON-RPC and carries HTTP conflicts as tool errors. `apps/server/src/mcp.test.ts` fails if initialization, tool listing, or a conflict response drifts.
- The server keeps its loopback Host and Origin checks. `apps/server/src/app.test.ts` fails if a remote site or Host can reach the unauthenticated API.
