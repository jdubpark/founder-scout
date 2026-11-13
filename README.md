# Founder Scout

A swarm of AI agents that finds startup founders every day, builds a sourced dossier on each,
scores them against a rubric you control, and learns from your Yes / No.

- Picture for non-technical readers: `docs/architecture/founder-scout-architecture.html`
- Design and decisions: `docs/superpowers/specs/2026-11-12-founder-scout-swarm-design.md`
- Research behind the model and compliance choices: `docs/research/`
- Look and feel of the dashboard: `DESIGN.md`

## Run it

```bash
pnpm install
pnpm dev            # API on http://127.0.0.1:4317, dashboard on http://localhost:5317
```

With no keys and no licences the swarm runs in simulation: a seeded world of fictional founders
stands in for the sources and the models, so every screen works.

```bash
pnpm swarm run --days 3          # three simulated runs
pnpm swarm doctor                # which model providers and sources are ready
pnpm swarm doctor --live         # one tiny real call per ready provider (costs a little)
pnpm swarm eval rounds --rounds 3
pnpm swarm eval show
```

Going live needs nothing but the Claude Code and Codex command-line tools already logged in:

```bash
pnpm swarm run --brain live --sources live --budget 5
```

`--budget` is the spend cap for that run in dollars. The run stops starting new work when it is
reached.

## Run it every day

1. `pnpm start` builds the dashboard and serves it with the API on http://127.0.0.1:4317.
2. In Settings, turn Daily run on, pick the time, and set Brain and Sources to Live.
3. Keep the server running. On a Mac, `ops/com.founderscout.server.plist.example` shows how to
   have launchd start it at login and restart it if it stops.

If the machine was asleep or the server was down at the daily time, the run starts once when the
server is next up. For unattended runs put API keys in `.env` (see `.env.example`) so usage bills
an API account instead of a personal login.

The server has no login. It listens on this computer only, and refuses requests that arrive under
another host name or from another site's page. Put it behind a login before anyone else opens it.

## Share a demo

```bash
pnpm swarm demo-snapshot                      # three simulated weeks, frozen into one file
pnpm --filter @agentswarm/web build:demo      # one self-contained HTML file in apps/web/dist-demo
```

The demo holds simulated founders only and says so on every page.

## Checks

```bash
pnpm check                       # typecheck every package, then every test
LIVE_SOURCES=1 pnpm exec vitest run packages/core/src/sources     # real Hacker News, GitHub, arXiv
LIVE_PROVIDERS=1 pnpm exec vitest run packages/core/src/providers # real Claude and Codex calls
```

## Layout

| Path | What |
| --- | --- |
| `packages/shared` | Types, the rubric, steering resolution, scoring, the Yes / No feedback loop. Pure and tested. |
| `packages/core` | Store (SQLite), simulated world, jobs and prompts, model providers, sources, engine, evals, service. |
| `apps/server` | HTTP API, scheduler, command line. |
| `apps/web` | The dashboard. Page-building rules are in `apps/web/BUILDING.md`. |
| `evals/flows` | Eval state, one directory per flow. |
| `ops` | An example launchd file for keeping the server running. |

## What is and is not verified

Verified by running it:

- the whole pipeline, the dashboard and both evals in simulation;
- headless Claude and Codex as model providers, with real calls;
- live Hacker News, GitHub and arXiv reading;
- the sanitised repository checkout, with a planted hostile hook that did not run;
- one small live run (2026-11-13, $1.14): real Hacker News, GitHub and arXiv items, scouting,
  screening, web research on one founder, fact-checking by a second vendor, and rubric scoring;
- one live repository review through Codex in a read-only sandbox, which returned findings with
  file and line references.

Not verified against a live service, because no keys or accounts were available: the direct Claude
API and the OpenAI-compatible adapters (OpenAI, DeepSeek, Meta).

Not built: AI voice calling, audio or video transcription, and a licensed professional-profile
data feed. Calls are planned and drafted for a person to make; their notes are read back in.

Known limits:

- The code reviewer sees a snapshot without history. It is given GitHub's commit counts per
  contributor, so it can say how much of a repository is the founder's own, but not who wrote a
  particular file.
- Codex reviews a repository inside its read-only sandbox, which blocks writes and the network
  but can still read other files on the machine. The prompt forbids running repository code and
  following instructions found in it; that part is an instruction, not a wall. For unattended
  live runs, run the server under its own user account or in a container.
- The check for personal attributes is phrase based. It removes explicit statements ("is 42
  years old", "is married") from everything stored, and refuses steering that states one. It
  does not catch hints.
- The default bar and the simulated analyst are tuned on simulated founders. Set the bar from the
  first week of real runs, with the slider on the Founders page.
- The spend cap per task stops a call in progress only for headless Claude. Codex and the API
  adapters finish the call they are in; the cap per run is checked between calls for all of them.
- The planted hostile hook proves the Claude repository review cannot be hijacked. The Codex
  review path has no such test; it relies on the read-only sandbox described above.
- A scout reads only the newest items each run (40 by default). On a busy day Hacker News and
  arXiv publish more than that, so raise "Items scanned per scout" on the Swarm page (about 150)
  for live runs. GitHub returns at most 100 per request.
- A message sent to a class of agents or to one job from the dashboard applies to the current
  swarm. Steering a class across every swarm is possible through the API only.

## Rules the code enforces

Nothing is sent or dialled without a person approving that item. No LinkedIn scraping. Professional,
public information only. Every claim has a source. A spend cap per run and a stop switch.
