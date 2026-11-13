# Founder Scout

An agent swarm that finds startup founders for a venture investor, builds sourced dossiers on them
and on their companies, scores both, and learns from the partner's Yes / No. Read the design before
changing behaviour:
`docs/superpowers/specs/2026-11-12-founder-scout-swarm-design.md`.

## Layout

`packages/shared` (pure types and logic) · `packages/core` (store, sim, jobs, providers, sources,
engine, eval, service) · `apps/server` (Fastify API, scheduler, CLI) · `apps/web` (Vite + React dashboard).

`packages/core/src/contracts.ts` is the seam between every directory in core. Change an interface
there first, then its one implementation. Which directory may import which is written down and
enforced in `packages/core/src/rules.test.ts`.

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

Every rule names the test that fails if it is broken, or says "(Judgment.)" when no test can
check it. `packages/core/src/rules.test.ts` enforces that, so add the test with the rule.

- **Models judge, code decides.** A model never returns a score or a decision. It answers rubric
  questions; `packages/shared/src/scoring.ts` does the rest. Tests: `packages/core/src/rules.test.ts`,
  `packages/shared/src/scoring.test.ts`.
- **Outreach is only ever proposed.** Nothing in the engine sends or dials when sources are live.
  The disclosure sentence on a draft is written by code and must stay uneditable. Tests:
  `packages/core/src/engine/index.test.ts`, `packages/core/src/service/index.test.ts`.
- **Nothing requests the professional network's own site.** No adapter, no fetching, no logged-in
  automation, for linkedin.com and the other hosts in `packages/shared/src/policy.ts`. A link to one
  is a pointer for a person to open. Profile data comes from a data vendor under contract, from a
  partner's own exported contact list, or not at all. Tests: `packages/shared/src/policy.test.ts`,
  `packages/core/src/sources/http.test.ts`, `packages/core/src/sources/quote-check.test.ts`,
  `packages/core/src/providers/claude-cli.test.ts`.
- **Never store or score personal attributes** (`PROHIBITED_ATTRIBUTES` in `rubric.ts`). Trajectory
  is judged against years of experience, never age. Tests: `packages/core/src/jobs/index.test.ts`,
  `packages/core/src/service/index.test.ts`.
- **A quote must be on the page it cites.** Research prompts ask for the source's exact words, and
  before the fact-checker runs, code opens each cited page and rejects an item whose words are not
  there. The check refuses private network addresses, because the address comes from a model.
  Tests: `packages/core/src/sources/quote-check.test.ts`, `packages/core/src/engine/index.test.ts`.
- **Every fact-check call carries one planted false claim.** A checker that accepts it has that
  call's verdicts thrown away, and an item the checker did not judge stays unverified; neither is
  ever rejected by default. Tests: `packages/core/src/engine/index.test.ts`,
  `packages/core/src/jobs/index.test.ts`.
- **A company is decided by its founders and the company together.** The company rubric is in
  `packages/shared/src/company.ts`; `decideDeal` in `scoring.ts` combines the two scores. Company
  facts are evidence with a facet, filed under the lead founder; the founder analyst is not shown
  them. A brief point that cites no verified evidence is dropped. Tests:
  `packages/shared/src/company.test.ts`, `packages/core/src/engine/company-stages.test.ts`.
- **A contact list is the uploader's own, and stays out of prompts.** Email addresses in it are
  never read. Tests: `packages/core/src/sources/connections.test.ts`,
  `packages/core/src/service/index.test.ts`.
- **Vendor records cost money outside the run's spend cap.** The People Data Labs adapter asks only
  for professional fields and has its own ceiling on records per day. Test:
  `packages/core/src/sources/pdl.test.ts`.
- **Headless agents do not inherit unrelated secrets.** They read untrusted pages and repositories,
  so keys for other services are removed from their environment. Test:
  `packages/core/src/providers/env.test.ts`.
- **Simulator fields stay out of prompts.** `simId`, `simFounderId` and `sim` exist so simulated
  agents and evals have ground truth. Test: `packages/core/src/jobs/index.test.ts`.
- **Simulated data is always labelled** in the dashboard, and synthetic eval scores are never
  described as evidence about real founders. (Judgment.)
- **A repository checkout is untrusted.** It is shallow, size-capped, stripped of agent-instruction
  files and `.git`, and read with read-only tools. Tests: `packages/core/src/sources/sanitize.test.ts`,
  and `packages/core/src/providers/claude-cli.live.test.ts`, which plants a hostile hook.
- **Eval discipline is structural.** The proposer is only ever given train case ids; the headline
  is the test score; a change is kept only by `decideCandidate` in `packages/core/src/eval`: a gain
  beyond the noise floor with no guardrail worse, or no loss at all with a guardrail clearly better.
  The synthetic flow's headline is rank correlation with hidden true quality, on purpose: outcomes
  in the simulated world are too noisy to steer by. Test: `packages/core/src/eval/index.test.ts`.
- **The server has no login.** It binds to loopback and rejects other Host names and other sites'
  Origins (`apps/server/src/app.ts`). Keep both checks until there is a login. Test:
  `apps/server/src/app.test.ts`.
- **Defaults are tuned on simulated founders.** The surface bar (0.58) and the simulated analyst in
  `packages/core/src/jobs` were set so the simulation surfaces about a tenth of those investigated.
  They are starting points for real runs, not findings. `packages/core/src/rules.test.ts` keeps the
  quoted number equal to the code.
- **Codex reads a repository through read-only shell commands.** It has no file-reading tool, so the
  code-review prompt allows `ls`, `cat`, `rg` and forbids running anything from the repository.
  Tests: `packages/core/src/jobs/index.test.ts`, `packages/core/src/providers/codex-cli.test.ts`.
- **Dashboard:** follow `apps/web/BUILDING.md` and `DESIGN.md`. Light, simple, only necessary text, desktop only.
  `PageHeader` ignores `description` on purpose. (Judgment.)

## Testing reality

Simulation covers the engine, service, evals and dashboard end to end. Live coverage is opt-in:
`LIVE_SOURCES=1` and `LIVE_PROVIDERS=1`. The direct Claude API and OpenAI-compatible adapters have
only fake-client tests, so say "unverified against a live service" rather than implying otherwise.
