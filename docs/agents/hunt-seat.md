# Hunt seat

Start the API on this computer with `pnpm dev`. Connect the agent to the MCP stdio server from the repository root and replace the path and swarm id. Use `SWARM_ID` as a shell-safe placeholder:

```sh
pnpm swarm mcp --url http://127.0.0.1:4317 --swarm SWARM_ID
```

For Claude Code, register that command as a stdio MCP server:

```sh
claude mcp add --transport stdio founder-scout -- pnpm --dir /path/to/founder-scout swarm mcp --url http://127.0.0.1:4317 --swarm SWARM_ID
```

For Codex, register the same command:

```sh
codex mcp add founder-scout -- pnpm --dir /path/to/founder-scout swarm mcp --url http://127.0.0.1:4317 --swarm SWARM_ID
```

The server must be running, and the URL must use a loopback host. If `--swarm` is omitted, the MCP server uses the first swarm returned by the API.

## Agent loop

1. Call `hunt_view`. Use its thesis, limits, trail counts, notes, and last wave to choose the next search direction.
2. Call `hunt_turn` with the `NavigateTurn` fields: `open`, `extend`, `close`, `focus`, `notes`, and `done`. Read every refusal and adjust the next request.
3. Call `hunt_wave` with one to three waves. Wait for its result.
4. Read the digest and the new view, then repeat while useful work remains.

Write a note only when a later day needs the lesson. The seat steers search only. The server checks the requests and owns scoring.
