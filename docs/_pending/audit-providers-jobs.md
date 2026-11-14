# Provider and jobs test audit

Audit date: 2026-11-13. Scope: all `*.test.ts` files in `packages/core/src/providers`, plus `packages/core/src/jobs/index.test.ts`. The three `.live.test.ts` files were left unchanged. There is no `packages/core/src/jobs/company.test.ts` or `packages/core/src/sim/index.test.ts` in this checkout.

The baseline lane run passed 336 tests and skipped 8 across 13 files. The final lane has 236 passing tests and 8 skipped across the same 13 files. The counts below use expanded Vitest cases (including `it.each` rows) and physical test-file lines.

## Baseline and final counts

| File | Baseline tests | Baseline lines | Final tests | Final lines |
|---|---:|---:|---:|---:|
| `providers/anthropic-api.test.ts` | 17 | 251 | 17 | 253 |
| `providers/claude-cli.live.test.ts` | 5 | 140 | 5 | 140 |
| `providers/claude-cli.test.ts` | 31 | 497 | 24 | 454 |
| `providers/codex-cli.live.test.ts` | 2 | 60 | 2 | 60 |
| `providers/codex-cli.test.ts` | 24 | 319 | 20 | 297 |
| `providers/doctor.live.test.ts` | 1 | 23 | 1 | 23 |
| `providers/env.test.ts` | 14 | 121 | 5 | 67 |
| `providers/openai-compatible.test.ts` | 22 | 339 | 22 | 348 |
| `providers/opencode-cli.test.ts` | 1 | 61 | 1 | 61 |
| `providers/registry.test.ts` | 7 | 109 | 7 | 110 |
| `providers/schema.test.ts` | 27 | 67 | 27 | 67 |
| `providers/subprocess.test.ts` | 8 | 65 | 8 | 72 |
| `jobs/index.test.ts` | 185 | 1,597 | 105 | 1,528 |
| **Total (13 files)** | **344** | **3,649** | **244** | **3,480** |

`jobs/company.test.ts` and `sim/index.test.ts`: absent at baseline and final (0 tests, 0 lines).

## Contracts and owners

- `providers/anthropic-api.ts` — sends structured schemas and effort through the SDK stream, uses server fallback only for listed models, reports the served model and usage, and leaves fallback cost unknown.
- `providers/claude-cli.ts` — builds per-job tool allow/deny arguments, isolates the working directory and environment, parses Claude JSON/stream output, and reads billed model, usage, cost, and provider failures.
- `providers/codex-cli.ts` — starts ephemeral read-only Codex calls, passes repository checkout only for reviews, and parses event usage, served model, final output, and failures.
- `providers/doctor.ts` — reports provider readiness and errors without making model calls unless live mode is requested.
- `providers/env.ts` — removes credentials by name or URL, keeps explicitly required prefixes and proxy settings, and drops undefined values.
- `providers/openai-compatible.ts` — resolves per-vendor endpoint and structured-output settings, applies DeepSeek/Meta fast defaults, repairs invalid JSON once, and prices response model usage.
- `providers/opencode-cli.ts` — disables agent tools, redirects OpenCode config to an isolated XDG directory, parses its JSONL output usage/cost, and maps its failures.
- `providers/registry.ts` — returns statuses in provider order, avoids exposing key values, and refuses simulated provider calls.
- `providers/schema.ts` — recursively closes object schemas, requires every property, and rejects open-ended records.
- `providers/subprocess.ts` — starts children without a shell, supplies the real child `PWD`, and reports timeout, cancellation, spawn, and PATH outcomes.
- `providers/common.ts` — owns shared request validation, JSON parsing, result/error construction, timeout defaults, and cancellation checks; provider integration tests exercise those paths. There is no standalone `common.test.ts` in this lane.
- `jobs/common.ts` — owns prompt tag escaping, shared prompt rules, prohibited-person detection, and output redaction.
- `jobs/company.ts` — creates a deterministic unsupported planted control with unverified metadata.
- `jobs/index.ts` — registers job prompts, hides simulator fields, preserves learned guidance and evidence rules, normalizes/redacts outputs, and executes live/simulated jobs with usage and cost.

## Deleted and merged tests

Each item names its remaining proof. Removed helper assertions with no observable contract are marked explicitly.

- `builds a safely fenced prompt and schema-valid simulation for %s` and `keeps every input text marker inside a user-data fence for %s` → `packages/core/src/jobs/index.test.ts > "keeps prompts fenced and simulator data hidden for %s"`.
- `keeps the prompt unchanged with no learned lines for %s` → no contract: equality of two empty-guidance builds only checks the no-op default; learned guidance addition/filtering/escaping remain in the same file.
- `summarizeInput`, `summarizeOutput`, and `countItems` existence assertions in `registers every model job...` → no contract: nonempty strings and nonnegative counts did not test a consumer-visible result.
- `registers every model job, derives kinds and schemas...` inventory loop → `packages/core/src/jobs/index.test.ts > "keeps prompts fenced and simulator data hidden for %s"` exercises every model job, and `packages/core/src/jobs/index.test.ts > "provides the supported variants and rejects unknown jobs"` pins variants and unknown-ID rejection.
- `maps founder and reference conversations to distinct debrief evidence kinds` → `packages/core/src/jobs/index.test.ts > "requires exact page excerpts for web research and debrief while preserving code-review wording"`.
- `takes sentences that state a personal attribute out of text, and leaves the rest` direct `redactSensitive` helper check → `packages/core/src/jobs/index.test.ts > "removes prohibited personal text at the job output boundary: %s"` and `packages/core/src/jobs/index.test.ts > "applies the privacy boundary to every kind of stored model text, not only evidence"`.
- Direct `findSensitive` prohibited-attribute input inventory → `packages/core/src/jobs/index.test.ts > "removes prohibited personal text at the job output boundary: %s"`.
- Direct `findSensitive` benign-work/company inventory → `packages/core/src/jobs/index.test.ts > "preserves work history and company context: %s"`.
- `exports the simulation model-strength and effort parameters as one table` → no contract: it copied the source parameter inventory; behavior remains covered by `packages/core/src/jobs/index.test.ts > "uses an exact 0.03 blind-pedigree beta for the small tier"` and `packages/core/src/jobs/index.test.ts > "has lower frontier score error and catches more non-supported claims than the small tier"`.
- `gives research calls only web search and web fetch, pre-approved`, `denies page fetches to every never-fetch host...`, and `puts the research deny list last...` → `packages/core/src/providers/claude-cli.test.ts > "gives research calls only web tools and denies every protected page host"` pins tools, host rules, and variadic-argument ordering.
- `adds no deny rules for structured calls...` → `packages/core/src/providers/claude-cli.test.ts > "gives structured calls no tools at all"` pins the empty tool list and absence of allow/deny flags.
- `leaves the repository-review argument list exactly as it was` copied argument inventory → `packages/core/src/providers/claude-cli.test.ts > "gives repo reviews read and search tools only, with shell, write and network denied"` pins literal allow and deny arrays.
- `refuses a repo review without a checkout` at the argument-builder boundary → `packages/core/src/providers/claude-cli.test.ts > "rejects a repo review with no checkout as unsupported, before spawning"` proves the provider rejects it before process launch.
- `takes the served model from the response, not from the request` and `serves the model with the largest cost` helper tests → `packages/core/src/providers/claude-cli.test.ts > "returns the validated structured output with the served model and mapped usage"` reads a response with two model costs through the provider.
- `ignores stream lines that are not JSON` parser probe → `packages/core/src/providers/claude-cli.test.ts > "builds a research trace with tool calls, truncated results, and the final answer"` now includes a non-JSON warning line in the stream fixture.
- Codex builder probes `reads the prompt from stdin and writes the final message to a file`, `points at the checkout with -C for repo reviews only`, and `puts the system text first under a heading...` → `packages/core/src/providers/codex-cli.test.ts > "returns the validated output with usage from the events and a list-price cost estimate"` pins the actual provider invocation; `packages/core/src/providers/codex-cli.test.ts > "points repo reviews at the checkout with -C"` and `packages/core/src/providers/codex-cli.test.ts > "runs structured calls in a fresh temporary directory and removes it"` prove checkout scoping.
- `counts uncached input by removing the cached part` direct `codexUsage` helper test → `packages/core/src/providers/codex-cli.test.ts > "returns the validated output with usage from the events and a list-price cost estimate"` proves the same calculation from provider events. The `codexUsage` export was made module-private after a repository-wide caller search.
- Environment-name secret suffix/named-secret/middle-token/credential-part/SSH-agent probes → `packages/core/src/providers/env.test.ts > "credential names and safe substrings"`.
- Credential URL and public URL/port probes → `packages/core/src/providers/env.test.ts > "credential-bearing URLs but keeps public URLs"`.
- Proxy credential exception and ordinary runtime-variable probes → `packages/core/src/providers/env.test.ts > "proxy credentials and ordinary runtime paths"`.
- Kept-prefix and other-vendor-key probes → `packages/core/src/providers/env.test.ts > "only the provider's explicitly kept credentials"`.
- Anthropic provider-local nested `additionalProperties: false` assertion and OpenAI provider payload schema assertions → `packages/core/src/providers/schema.test.ts > "is strict for %s"` and `packages/core/src/providers/schema.test.ts > "closes nested objects inside arrays"`.
- OpenAI served/unpriced result assertions were consolidated with priced response assertions → `packages/core/src/providers/openai-compatible.test.ts > "uses the served model and usage for cost, leaving unpriced models unknown"`.
- `returns a provider for every id...` repeated `registry.get` loop → `packages/core/src/providers/registry.test.ts > "returns one status per provider in PROVIDERS order"`; the simulation refusal remains `packages/core/src/providers/registry.test.ts > "the simulation provider refuses to run"`.
- OpenCode assertion that result model equals the requested route was removed → no contract: the adapter currently echoes `req.route.model` and the response fixtures do not supply a served model. This is listed below as a product gap.

## Production code removed

- Removed `export` from `servedModel` in `providers/claude-cli.ts` after `rg` found only its same-module caller and the deleted direct helper test.
- Removed `export` from `codexUsage` in `providers/codex-cli.ts` after `rg` found only its same-module caller and the deleted direct helper test.
- No provider behavior or wrapper was removed. The simulation parameter table remains exported from `jobs/index.ts`; changing that non-provider production file was outside the allowed permanent source edits.

## Mutation preservation

There were 36 distinct deliberate source mutations. Each mutation was restored byte-for-byte in a `finally` block. Every valid targeted keeper failed. One initial tag-escaping attempt filtered to the marker-fence test and did not exercise escaping; it was rerun against the named hostile-tag test, which failed. The persistent production diff is only the two test-only export removals above.

| Production file and deliberate break | Keeper that failed |
|---|---|
| `providers/env.ts`: disable secret-name filtering | `providers/env.test.ts > "credential names and safe substrings"` |
| `providers/subprocess.ts`: set `PWD` from the parent env instead of `req.cwd` | `providers/subprocess.test.ts > "tells the child the directory it really runs in, not the parent's"` |
| `providers/claude-cli.ts`: give structured calls `Bash` | `providers/claude-cli.test.ts > "gives structured calls no tools at all"` |
| `providers/claude-cli.ts`: omit research host-deny rules | `providers/claude-cli.test.ts > "gives research calls only web tools and denies every protected page host"` |
| `providers/claude-cli.ts`: replace search `WebSearch` with `WebFetch` | `providers/claude-cli.test.ts > "gives search calls WebSearch only, with no page-fetch tool"` |
| `providers/claude-cli.ts`: remove `Bash` from the repo-review deny array | `providers/claude-cli.test.ts > "gives repo reviews read and search tools only, with shell, write and network denied"` |
| `providers/opencode-cli.ts`: enable all agent tools | `providers/opencode-cli.test.ts > "runs a locked structured call and maps success and error events"` |
| `providers/openai-compatible.ts`: set DeepSeek thinking to enabled | `providers/openai-compatible.test.ts > "asks a model that reasons by default to answer fast when the route names no effort"` |
| `providers/openai-compatible.ts`: change Meta reasoning effort from minimal to high | `providers/openai-compatible.test.ts > "asks a model that reasons by default to answer fast when the route names no effort"` |
| `jobs/common.ts`: include `item.sim` in rendered evidence | `jobs/index.test.ts > "keeps prompts fenced and simulator data hidden for %s"` (five rows failed) |
| `jobs/common.ts`: remove tag escaping | `jobs/index.test.ts > "escapes source-supplied tag endings and treats them as data"` |
| `jobs/common.ts`: make `redactSensitive` return all input unchanged | `jobs/index.test.ts > "removes prohibited personal text at the job output boundary: %s"` (ten rows failed) |
| `jobs/common.ts`: invert the shared personal-attribute prompt instruction | `jobs/index.test.ts > "keeps prompts fenced and simulator data hidden for %s"` (24 rows failed) |
| `jobs/index.ts`: remove the LinkedIn fetch denial | `jobs/index.test.ts > "requires licensed profile data for %s"` (four rows failed) |
| `jobs/index.ts`: use the ordinary catch rate for planted claims | `jobs/index.test.ts > "has the simulated fact-checker miss a planted claim far less often than an ordinary unsupported one"` |
| `providers/schema.ts`: set `additionalProperties` true | `providers/schema.test.ts > "is strict for %s"` (24 rows failed) |
| `providers/anthropic-api.ts`: estimate cost for a fallback model | `providers/anthropic-api.test.ts > "reports no cost when a fallback served the call, because it bills at other rates"` |
| `providers/anthropic-api.ts`: return the requested model instead of response model | `providers/anthropic-api.test.ts > "reports no cost when a fallback served the call, because it bills at other rates"` |
| `providers/anthropic-api.ts`: zero the response output-token count | `providers/anthropic-api.test.ts > "maps the served model, the usage and the estimated cost"` |
| `providers/claude-cli.ts`: return the requested model instead of `modelUsage` winner | `providers/claude-cli.test.ts > "returns the validated structured output with the served model and mapped usage"` |
| `providers/claude-cli.ts`: discard response cost | `providers/claude-cli.test.ts > "returns the validated structured output with the served model and mapped usage"` |
| `providers/claude-cli.ts`: zero response output tokens | `providers/claude-cli.test.ts > "returns the validated structured output with the served model and mapped usage"` |
| `providers/codex-cli.ts`: ignore the event served model | `providers/codex-cli.test.ts > "takes the served model from the events when they name one"` |
| `providers/codex-cli.ts`: remove list-price cost | `providers/codex-cli.test.ts > "returns the validated output with usage from the events and a list-price cost estimate"` |
| `providers/codex-cli.ts`: zero event output tokens | `providers/codex-cli.test.ts > "returns the validated output with usage from the events and a list-price cost estimate"` |
| `providers/openai-compatible.ts`: ignore response model | `providers/openai-compatible.test.ts > "uses the served model and usage for cost, leaving unpriced models unknown"` |
| `providers/openai-compatible.ts`: zero response output tokens | `providers/openai-compatible.test.ts > "uses the served model and usage for cost, leaving unpriced models unknown"` |
| `providers/openai-compatible.ts`: remove priced response cost | `providers/openai-compatible.test.ts > "uses the served model and usage for cost, leaving unpriced models unknown"` |
| `providers/opencode-cli.ts`: discard fixture cost | `providers/opencode-cli.test.ts > "runs a locked structured call and maps success and error events"` |
| `providers/opencode-cli.ts`: zero fixture input tokens | `providers/opencode-cli.test.ts > "runs a locked structured call and maps success and error events"` |
| `providers/codex-cli.ts`: change sandbox from read-only to workspace-write | `providers/codex-cli.test.ts > "runs read-only, ephemeral, with no user config, rules, hooks, plugins or memories"` |
| `jobs/index.ts`: reverse the repo-review prompt's no-execution rule | `jobs/index.test.ts > "requires inspected code lines and repository citations for code-review evidence"` |
| `jobs/index.ts`: replace exact-source quotation with paraphrasing | `jobs/index.test.ts > "requires exact page excerpts for web research and debrief while preserving code-review wording"` |
| `jobs/index.ts`: replace debrief word-for-word requirement with paraphrasing | `jobs/index.test.ts > "requires exact page excerpts for web research and debrief while preserving code-review wording"` |
| `jobs/company.ts`: mark a generated control as not planted | `jobs/index.test.ts > "plants a deterministic unsupported control with matching simulator metadata"` |
| `providers/opencode-cli.ts`: stop redirecting `XDG_CONFIG_HOME` | `providers/opencode-cli.test.ts > "runs a locked structured call and maps success and error events"` |

## Uncertain items and product bugs

- The three live provider/doctor tests remain unchanged and skipped without their environment flags; these runs provide no current installed-CLI or live-vendor compatibility evidence.
- The simulation-quality sweep and `0.03` blind-pedigree behavior test remain; they prove deterministic implementation behavior, not empirical calibration of model tiers.
- There is no `sim/index.test.ts` or `jobs/company.test.ts` in this checkout, so those paths have no lane-local test evidence.
- **Product bug:** `jobs/common.ts > findSensitive` has no personal phone or personal email patterns, despite those attributes being prohibited in the shared rubric.
- **Product bug:** gender and orientation patterns recognize role words such as `the founder`, but miss named subjects such as `Ada is gay` or `Ada identifies as non-binary`.
- **Product gap:** `providers/opencode-cli.ts` reports `req.route.model` and does not read a served model from OpenCode output. The fixture format also has no served-model field, so no test currently proves a response-derived model for this adapter.

## Final commands

- `pnpm exec vitest run packages/core/src/providers packages/core/src/jobs/index.test.ts packages/core/src/sim/index.test.ts` — `Test Files 10 passed | 3 skipped (13)`; `Tests 236 passed | 8 skipped (244)`.
- `pnpm typecheck` — passed; final line `apps/server typecheck: Done`.
- `pnpm exec vitest run packages/core/src/rules.test.ts` — `Test Files 1 passed (1)`; `Tests 6 passed (6)`.
