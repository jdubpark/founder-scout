# Service and server test audit

Date: 2026-11-13

## Baseline and final counts

Baseline was `pnpm exec vitest run packages/core/src/service apps/server`: 13 files and 142 passing cases. `packages/core/src/service/hunt-trial.test.ts` belongs to another worker and is excluded from this lane's counts. The in-scope baseline was 12 files, 141 cases, and 3,948 test-file lines.

Final in-scope count is 12 files, 121 cases, and 3,605 test-file lines (20 fewer cases and 343 fewer lines). The final aggregate command also included the other worker's hunt-trial file: 13 files, 122 cases.

| Test file | Baseline cases / lines | Final cases / lines |
| --- | ---: | ---: |
| `apps/server/src/app.test.ts` | 20 / 621 | 11 / 321 |
| `apps/server/src/cli.test.ts` | 13 / 351 | 12 / 339 |
| `apps/server/src/config.test.ts` | 4 / 65 | 4 / 65 |
| `apps/server/src/cron.test.ts` | 3 / 27 | 3 / 27 |
| `apps/server/src/main.test.ts` | 6 / 14 | 7 / 57 |
| `apps/server/src/mcp.test.ts` | 1 / 18 | 2 / 56 |
| `apps/server/src/scheduler.test.ts` | 14 / 343 | 13 / 333 |
| `packages/core/src/service/assumptions.test.ts` | 5 / 120 | 5 / 120 |
| `packages/core/src/service/hunt.test.ts` | 9 / 516 | 9 / 522 |
| `packages/core/src/service/index.test.ts` | 50 / 1,394 | 40 / 1,290 |
| `packages/core/src/service/pools.test.ts` | 11 / 322 | 10 / 318 |
| `packages/core/src/service/preview.test.ts` | 5 / 157 | 5 / 157 |
| **In-scope total** | **141 / 3,948** | **121 / 3,605** |

## Contracts and keepers

| Production owner | Contract kept at this boundary |
| --- | --- |
| `apps/server/src/app.ts` | Raw audio bytes and upload metadata only; no caller path; media, network-import, and default body caps; actor normalization; JSON validation/error shape; ServiceError mapping; generic 500; CORS; Host and Origin rejection; health, static fallback, and JSON 404s. Keepers are `app.test.ts`'s upload, limits, validation, error, CORS, loopback, and static-fallback tests. |
| `apps/server/src/main.ts` | Startup rejects non-loopback bind configuration and passes the configured loopback host to `listen`; shutdown drains scheduler/server/app. `main.test.ts > "passes the configured loopback host to the listener"` and the allowed/refused host rows. |
| `apps/server/src/mcp.ts` | MCP target is HTTP loopback; newline JSON-RPC framing and initialization/tools-list; HTTP conflicts become tool errors. The two `mcp.test.ts` tests separately keep stream and handler behavior. |
| `apps/server/src/cli.ts` | Simulated hunt totals; spend reporting; past dataset outcome-source requirements, directory labels, unknown omissions, personal-detail redaction, deterministic bounded controls, reviewed corrections, and dataset summaries. Keep the corresponding dataset/collect tests in `cli.test.ts`. |
| `apps/server/src/config.ts`, `apps/server/src/cron.ts` | Configuration parsing/defaults and cron/time-zone validation/next occurrence. Their tests were retained; additional reduction candidates were not reviewed. |
| `apps/server/src/scheduler.ts` | Schedule dispatch/rearm, serialization and draining, opt-in catch-up, and catch-up only for active swarms that missed the due run. `scheduler.test.ts > "catches up only active swarms that missed their run"` covers ran-today, missed, and paused cases; separate tests retain opt-in and wait/coaching order. |
| `packages/core/src/service/index.ts`, `calls.ts`, `recordings.ts`, `seat.ts` | Service API behavior and audit attribution; generated recording IDs and bounded writes; proposed outreach disclosure cannot be edited and a call requires approval; all placement guards; number tail only in stored/audit records; crash-uncertain calls cannot be dialled again; personal attributes are refused in instructions and redacted from stored text; outside seat requires handover and receives no page text. Kept in focused `index.test.ts` keepers. |
| `packages/core/src/service/index.ts` and `packages/shared/src/steering.ts` | Autopilot off/emergency behavior, real-data-only promotion, one applied winner, reported daily spend and serialized coaching; promotion overlays only the winner's delta; per-swarm promotion state. Kept in the merged autopilot and promotion tests. |
| `packages/core/src/service/pools.ts` | Pool validation, private-training-model refusal, defaults/overrides, rebalance preview/apply/no-op behavior, and audit. `pools.test.ts` owns the member/rebalance rules; the service API test checks boundary and audit. |
| `packages/core/src/service/assumptions.ts` | Rows remain available without evidence, basis counts and current effective values are distinct from judgments, and unknown swarm handling. Direct service tests plus `index.test.ts > "serves the assumption ledger through the swarm API"`. Latest-period exclusion remains owned by `packages/core/src/eval/past.test.ts`. |
| `packages/core/src/service/hunt.ts`, `packages/core/src/service/seat.ts` | Persisted hunt DTO limits, agent-scoped runner settings, safe starts, deduplication, audit, notebook/open-trail limits, outside-seat checks, and bounded view. Keepers are the direct Hunt service tests and the outside-seat API test. |
| `packages/core/src/service/preview.ts` | Preview reports only decision flips attributable to a candidate, uses the same bar for current/candidate scoring, and does not claim guidance-only changes have a measured score change. `preview.test.ts` retained. |
| `packages/core/src/sources/connections.ts`, `packages/shared/src/context.ts` | Contact CSV parsing never returns email; contact lists are a sealed prompt pool. Existing source/context tests are the keepers; the service contact-import test separately proves addresses are not stored or audited. |

## Deleted or merged tests

Each line names the old test and the remaining proof. “No contract” means the removed assertion was an inventory, exact-string grep, or a duplicate that did not establish a separate behavior.

| Deleted or merged test | Remaining proof |
| --- | --- |
| `app.test.ts > "maps every ApiClient method to its documented route and passes the parsed values"` | No contract: copied route inventory. Route-specific status, body parsing, headers, caps, and errors remain in `app.test.ts`. |
| `app.test.ts > "accepts valid autopilot settings and rejects an unsupported mode"` | `apps/server/src/app.test.ts > "validates settings, query values, directives and JSON before service calls"` |
| `app.test.ts > "returns field errors for invalid bodies, numeric queries and malformed scope JSON"` | `apps/server/src/app.test.ts > "validates settings, query values, directives and JSON before service calls"` |
| `app.test.ts > "validates Hunt trail, update, and note bodies before calling the service"` | `apps/server/src/app.test.ts > "validates settings, query values, directives and JSON before service calls"` |
| `app.test.ts > "strictly validates the company query contract"` | `apps/server/src/app.test.ts > "validates settings, query values, directives and JSON before service calls"` |
| `app.test.ts > "reports a missing required body field"` | `apps/server/src/app.test.ts > "validates settings, query values, directives and JSON before service calls"` |
| `app.test.ts > "refuses a pool whose share is out of range and an eval budget above the ceiling"` | `apps/server/src/app.test.ts > "validates settings, query values, directives and JSON before service calls"` |
| `app.test.ts > "normalizes malformed JSON bodies into the public 400 shape"` | `apps/server/src/app.test.ts > "validates settings, query values, directives and JSON before service calls"` |
| `app.test.ts > "allows a 2 MB network import while retaining the default body cap elsewhere"` | `apps/server/src/app.test.ts > "limits the network import separately from the default body cap"` |
| `app.test.ts > "returns health and JSON 404s for unknown API routes"` | `apps/server/src/app.test.ts > "serves built assets and the SPA fallback while keeping unknown API paths JSON"` |
| `app.test.ts > "returns 404 for non-API GETs when no web distribution is available"` | `apps/server/src/app.test.ts > "serves built assets and the SPA fallback while keeping unknown API paths JSON"` |
| `cli.test.ts > "runs one simulated run, waits for it, and prints funnel and cost"` and `cli.test.ts > "prints hunt pages, leads and open trails when a run enters the hunt stage"` | `apps/server/src/cli.test.ts > "runs one simulated hunt run, waits for it, and prints funnel, cost and hunt totals"` |
| `cli.test.ts > "shows a dataset summary and lists both past commands in help"` | Summary: `apps/server/src/cli.test.ts > "shows a dataset summary"`. Help assertion removed as an exact help-string grep; command parsing is exercised by command tests. |
| `mcp.test.ts > "speaks newline JSON-RPC and returns server conflicts as tool errors"` | Split by boundary: `apps/server/src/mcp.test.ts > "reads and writes one newline-delimited JSON-RPC response per request"` and `apps/server/src/mcp.test.ts > "handles MCP requests and converts server conflicts to tool errors"` |
| `scheduler.test.ts > "does nothing when a run already started after the daily time"` | Merged into the ran-today row in `apps/server/src/scheduler.test.ts > "catches up only active swarms that missed their run"` |
| `scheduler.test.ts > "catches up only the swarms that missed their run"` | `apps/server/src/scheduler.test.ts > "catches up only active swarms that missed their run"` |
| `scheduler.test.ts > "leaves a paused swarm alone, and stays off unless asked for"` | Off-by-default: `apps/server/src/scheduler.test.ts > "stays off unless catch-up is enabled"`; paused case: `apps/server/src/scheduler.test.ts > "catches up only active swarms that missed their run"` |
| `index.test.ts > "backfills enabled job agents for a swarm loaded from an older database"` and `index.test.ts > "backfills the four enabled company and analyst agents once for an older swarm"` | `packages/core/src/service/index.test.ts > "backfills enabled jobs for both legacy and partially upgraded swarms"` |
| `index.test.ts > "uses agent scoped runner directives for Hunt limits"` | `packages/core/src/service/hunt.test.ts > "shows an empty hunt with resolved limits, navigator state, runner pools, and scheduled engines"` |
| `index.test.ts > "assembles the app from its options and closes the shared store"` | No contract: assembly/close smoke probe; the end-to-end app run remains in `packages/core/src/service/index.test.ts > "runs the hunt through the assembled simulation app"`. |
| `index.test.ts > "seeds a complete swarm, two global rules and one swarm preference, once"` | Seed inventory removed; idempotency retained in `packages/core/src/service/index.test.ts > "runs the hunt through the assembled simulation app"`, which calls `ensureSeeded` twice and checks one swarm. |
| `index.test.ts > "records an off-mode coach note without starting evals"` and `index.test.ts > "stops coaching on the emergency switch and records a zero-round reason"` | `packages/core/src/service/index.test.ts > "records zero-round reports when autopilot is off or the emergency stop is on"` |
| `index.test.ts > "keeps a synthetic winner for review without applying it in apply mode"` and the two-real-winner coach case | `packages/core/src/service/index.test.ts > "applies at most one real-data winner and leaves synthetic winners for review"` |
| `index.test.ts > "finds the last report in the audit log after a restart"` | Renamed with accurate scope: `packages/core/src/service/index.test.ts > "reads the latest coaching report for this swarm from the audit log"` |
| `index.test.ts > "puts a variant into use without dropping the swarm's pools, learned lines or another eval's changes"` and `index.test.ts > "reports the variant in use for the swarm asked about, not for any swarm"` | `packages/core/src/service/index.test.ts > "puts a variant into use without dropping other changes and reports which swarm carries it"` |
| `index.test.ts > "shows configured runner defaults until a swarm saves its own pool"` | `packages/core/src/service/index.test.ts > "resolves both configured runner providers into default pools and lets saved pools replace them"` |
| `index.test.ts > "lists every assumption even when nothing has been judged yet"` | Public boundary: `packages/core/src/service/index.test.ts > "serves the assumption ledger through the swarm API"`; no-evidence rows: `packages/core/src/service/assumptions.test.ts > "%s and still returns rows"`. |
| `index.test.ts > "resolves narrow parameters and broad-to-narrow guidance and only shows calls to supported classes"` | Broad-to-narrow resolution: `packages/shared/src/steering.test.ts > "keeps every applicable line, ordered from broad to narrow"`; service call-example integration remains in `packages/core/src/service/index.test.ts > "includes partner call examples only for classes that may read them"`. |
| `index.test.ts > "promotes a variant and identifies it as the config in use"` | `packages/core/src/service/index.test.ts > "puts a variant into use without dropping other changes and reports which swarm carries it"` |
| `index.test.ts > "starts scheduled runs for eligible swarms and continues after one refusal"` and `index.test.ts > "starts scheduled runs only for the named swarms when a catch-up asks for some"` | `packages/core/src/service/index.test.ts > "continues scheduled runs after a refusal and limits catch-up to named swarms"` |
| `pools.test.ts > "does not save when shares already match the measured yields"` and `pools.test.ts > "returns an empty report and saves nothing when the swarm has no pools"` | `packages/core/src/service/pools.test.ts > "does not save when shares already match or there are no pools to rebalance"` |

## Mutation preservation checks

Each temporary production edit was restored from the saved original bytes in a `finally` block. Every listed keeper failed at the contract assertion. The final production diff check found no changed production files (`git diff --name-only` had no non-test/non-report matches).

| Production owner and deliberate break | Keeper that failed |
| --- | --- |
| `apps/server/src/main.ts`: pass `0.0.0.0` to `listen` | `apps/server/src/main.test.ts > "passes the configured loopback host to the listener"` |
| `apps/server/src/app.ts`: bypass Host rejection; bypass Origin rejection | Each mutation: `apps/server/src/app.test.ts > "answers only loopback hosts and loopback origins"` |
| `apps/server/src/app.ts`: reduce audio body limit to 1 MiB; forward `x-recording-path` to the service | Upload test failed on 413 for the limit mutation and on the extra `path` property for the path mutation: `apps/server/src/app.test.ts > "passes an audio upload as raw bytes and deletes recordings with a no-content response"` |
| `packages/core/src/service/recordings.ts`: use caller title as recording ID; bypass `maxBytes` | `packages/core/src/service/index.test.ts > "refuses unsafe links and stores uploads under generated names in the founder's recording list"` |
| `packages/core/src/service/index.ts`: copy the caller's disclosure into the approved draft | `packages/core/src/service/index.test.ts > "protects the disclosure during approval and links transcript evidence on completion"` |
| `packages/core/src/service/calls.ts`: separately bypass approval status; call-item kind; consent sentence; destination E.164; registered fund name; missing callback number; callback E.164; personal-attribute questions; callee hours; daily call ceiling; emergency stop; absent dialler | Each mutation: `packages/core/src/service/index.test.ts > "refuses unsafe call placements and never stores the full number"` |
| `packages/core/src/service/calls.ts`: store full destination in `numberTail` and audit; separately store full number in audit only | First mutation failed at the failed-placement serialization assertion; audit-only mutation failed at `persisted` excluding the number. Both: `packages/core/src/service/index.test.ts > "refuses unsafe call placements and never stores the full number"` |
| `packages/core/src/service/calls.ts`: bypass uncertain-placement, dispatched-state, and existing-call guards together | `packages/core/src/service/index.test.ts > "places and syncs a simulated call into ordinary call transcript evidence"`; provider placement count increased on the orphaned call. |
| `packages/core/src/service/calls.ts`: store an unredacted transcript | `packages/core/src/service/index.test.ts > "places and syncs a simulated call into ordinary call transcript evidence"` |
| `packages/core/src/service/index.ts`: disable personal steering refusal | `packages/core/src/service/index.test.ts > "keeps personal attributes out of what a person types in"` |
| `packages/core/src/jobs/common.ts`: make `redactSensitive` return its input | `packages/core/src/service/index.test.ts > "keeps personal attributes out of what a person types in"` |
| `packages/core/src/sources/connections.ts`: include email in parsed contact records | `packages/core/src/sources/connections.test.ts > "maps partner-owned contact fields, dates and no email address"` |
| `packages/shared/src/context.ts`: give a scout the `network` pool | `packages/shared/src/context.test.ts > "never lets a job read a sealed pool"` |
| `packages/core/src/service/seat.ts`: bypass outside-seat handover; bypass outside personal-attribute refusal; append the private page-body canary as a navigator note | Each mutation: `packages/core/src/service/index.test.ts > "keeps outside turns in the navigator seat and applies only checked requests"` |
| `apps/server/src/mcp.ts`: always negotiate the default protocol; make HTTP error result `isError: false`; omit newline from stdout; bypass loopback URL restriction | Protocol/newline and URL mutations failed their respective MCP tests; HTTP mutation failed `apps/server/src/mcp.test.ts > "handles MCP requests and converts server conflicts to tool errors"`. |
| `packages/core/src/service/index.ts`: bypass autopilot-off; bypass kill switch; permit synthetic winner application; remove `appliedThisRun`; ignore previously reported spend; remove coach serialization | Off/kill mutations: `index.test.ts > "records zero-round reports when autopilot is off or the emergency stop is on"`; eligibility and one-winner mutations: `index.test.ts > "applies at most one real-data winner and leaves synthetic winners for review"`; spend and serialization mutations: the respective `"counts what a round reports it spent, including a round that stopped before recording anything"` and `"runs one coaching pass at a time, so two swarms cannot both spend the same day's budget"` keepers. |
| `packages/shared/src/steering.ts`: initialize promotion overlay from the winner config | `packages/core/src/service/index.test.ts > "puts a variant into use without dropping other changes and reports which swarm carries it"` |
| `packages/core/src/service/pools.ts`: bypass contributor-model refusal | `packages/core/src/service/pools.test.ts > "refuses unknown swarms, non-model jobs and invalid pool members with their fields"` |
| `packages/core/src/eval/past.ts`: always judge the latest test periods, including rejected guidance | `packages/core/src/eval/past.test.ts > "does not pay to judge a rejected guidance line on the later periods"` |
| `apps/server/src/scheduler.ts`: invert the missed-run comparison | `apps/server/src/scheduler.test.ts > "catches up only active swarms that missed their run"` |
| `apps/server/src/cli.ts`: skip personal-detail redaction; bypass required outcome source; omit the company directory from label inputs | Corresponding keepers: `cli.test.ts > "removes a sentence stating a personal detail before the dataset is written"`; `cli.test.ts > "refuses to collect with nothing that can state an outcome, and says when only successes were kept"`; and `cli.test.ts > "labels from the company directory, states the bar, and leaves out what it cannot label"`. |
| `packages/core/src/service/index.ts`: remove `directive.create` audit | `packages/core/src/service/index.test.ts > "validates directive scope, effect, value and text, then stores and audits a valid directive"` |
| `packages/core/src/service/index.ts`: bypass `ensureSeeded` idempotency guard | `packages/core/src/service/index.test.ts > "runs the hunt through the assembled simulation app"` |
| `packages/shared/src/feedback.ts`: remove `analyst` from visible-call classes | `packages/core/src/service/index.test.ts > "includes partner call examples only for classes that may read them"`. The shared-context test was first tried as the keeper and did not fail this mutant; the service integration keeper was retained and does fail. |

## Uncertain and not reviewed

- The MCP stream test drives `serveMcp` with mocked readline events and captures `stdout`; an actual child-process stdin/EOF lifecycle was not reviewed. The MCP handler, line framing, protocol response, loopback target, and HTTP-to-tool error mapping are covered.
- Call placement has no logger dependency in `calls.ts`; the no-full-number mutation covered stored actions and persisted audit detail. A live server logger capture for raw request handling was not reviewed.
- Additional reduction candidates in the unchanged config, cron, assumptions, and preview tests were not reviewed before the coordinator's stop request; those tests remain unchanged.
- `hunt-trial.test.ts` was not reviewed or edited because it belongs to another worker. It ran as the 13th file in the aggregate lane check.
- No product bug was identified during this test audit. A broader product bug review was not performed.

## Final checks

- `pnpm exec vitest run packages/core/src/service apps/server`: 13 files passed; 122 tests passed.
- `pnpm typecheck`: shared, core, web, and server typechecks completed successfully.
- `pnpm exec vitest run packages/core/src/rules.test.ts`: 1 file passed; 6 tests passed.
