# Hunt seat

Start the API on this computer with `pnpm dev`. Connect the agent to the MCP stdio server from the repository root and replace the path and swarm id. Use `SWARM_ID` as a shell-safe placeholder:

```sh
pnpm --silent swarm mcp --url http://127.0.0.1:4317 --swarm SWARM_ID
```

`--silent` matters: without it pnpm prints a banner on standard output, and that stream must carry protocol messages only.

For Claude Code, register that command as a stdio MCP server:

```sh
claude mcp add --transport stdio founder-scout -- pnpm --silent --dir /path/to/founder-scout swarm mcp --url http://127.0.0.1:4317 --swarm SWARM_ID
```

For Codex, register the same command:

```sh
codex mcp add founder-scout -- pnpm --silent --dir /path/to/founder-scout swarm mcp --url http://127.0.0.1:4317 --swarm SWARM_ID
```

Before an agent can act, a person hands over the seat: on the Hunt page set who steers to the outside agent (the setting `hunt.navigator`). Until then a turn or a wave is refused.

Codex asks for approval before each MCP tool call. In an interactive session, approve them. In `codex exec`, which cannot ask, add `--approve-for-me`; without it every call fails with "MCP tool call requires approval".

Checked on 2026-11-13 against a simulated web: a headless Claude Code session and a headless Codex session each read the view, took a turn (one opened a trail and had a refused address explained to it, the other opened one trail and closed another) and sent a wave.

The server must be running, and the URL must use a loopback host. If `--swarm` is omitted, the MCP server uses the first swarm returned by the API.

## Agent loop

1. Call `hunt_view`. Use its thesis, limits, trail counts, notes, and last wave to choose the next search direction.
2. Call `hunt_turn` with the `NavigateTurn` fields: `open`, `extend`, `close`, `focus`, `notes`, and `done`. Read every refusal and adjust the next request.
3. Call `hunt_wave` with one to three waves. Wait for its result.
4. Read the digest and the new view, then repeat while useful work remains.

Write a note only when a later day needs the lesson. The seat steers search only. The server checks the requests and owns scoring.
