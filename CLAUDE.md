# Founder Scout

An agent swarm that finds startup founders for a venture investor, builds sourced dossiers, scores
them, and learns from the partner's Yes / No. Read the design before changing behaviour:
`docs/superpowers/specs/2026-11-12-founder-scout-swarm-design.md`.

## Layout

`packages/shared` (pure types and logic) · `packages/core` (store, sim, jobs, providers, sources,
engine, eval, service) · `apps/server` (Fastify API, scheduler, CLI) · `apps/web` (Vite + React dashboard).

`packages/core/src/contracts.ts` is the seam between every directory in core. Change an interface
there first, then its one implementation.

## Commands

```
pnpm check                                   # typecheck all packages, then all tests
pnpm exec vitest run packages/core/src/engine   # one area
pnpm dev                                     # API on 4317, dashboard on 5317
pnpm swarm run --days 3                      # simulated runs from the command line
```

Package scripts call `../../node_modules/.bin/tsc` and `../../node_modules/.bin/tsx` on purpose: a
bare `tsc` resolves to an old global TypeScript on this machine and fails on the config, and `tsx`
is installed only at the workspace root.

## Rules that are not obvious from the code

- **Models judge, code decides.** A model never returns a score or a decision. It answers rubric
  questions; `packages/shared/src/scoring.ts` does the rest. Keep it that way.
- **Outreach is only ever proposed.** Nothing in the engine sends or dials when sources are live.
  The disclosure sentence on a draft is written by code and must stay uneditable.
- **No LinkedIn.** No adapter, no fetching, no logged-in automation. Profile data comes from a
  licensed vendor or not at all.
- **Never store or score personal attributes** (`PROHIBITED_ATTRIBUTES` in `rubric.ts`). Trajectory
  is judged against years of experience, never age.
- **Simulator fields stay out of prompts.** `simId`, `simFounderId` and `sim` exist so simulated
  agents and evals have ground truth. A test asserts prompts never contain them.
- **Simulated data is always labelled** in the dashboard, and synthetic eval scores are never
  described as evidence about real founders.
- **A repository checkout is untrusted.** It is shallow, size-capped, stripped of agent-instruction
  files and `.git`, and read with read-only tools. A live test plants a hostile hook to prove it.
- **Eval discipline is structural.** The proposer is only ever given train case ids; the headline
  is the test score; a change is kept only by `decideCandidate` in `packages/core/src/eval`: a gain
  beyond the noise floor with no guardrail worse, or no loss at all with a guardrail clearly better.
  The synthetic flow's headline is rank correlation with hidden true quality, on purpose: outcomes
  in the simulated world are too noisy to steer by.
- **The server has no login.** It binds to loopback and rejects other Host names and other sites'
  Origins (`apps/server/src/app.ts`). Keep both checks until there is a login.
- **Defaults are tuned on simulated founders.** The surface bar (0.58) and the simulated analyst in
  `packages/core/src/jobs` were set so the simulation surfaces about a tenth of those investigated.
  They are starting points for real runs, not findings.
- **Codex reads a repository through read-only shell commands.** It has no file-reading tool, so the
  code-review prompt allows `ls`, `cat`, `rg` and forbids running anything from the repository.
- **Dashboard:** follow `apps/web/BUILDING.md` and `DESIGN.md`. Light, simple, only necessary text, desktop only.
  `PageHeader` ignores `description` on purpose.

## Testing reality

Simulation covers the engine, service, evals and dashboard end to end. Live coverage is opt-in:
`LIVE_SOURCES=1` and `LIVE_PROVIDERS=1`. The direct Claude API and OpenAI-compatible adapters have
only fake-client tests, so say "unverified against a live service" rather than implying otherwise.
