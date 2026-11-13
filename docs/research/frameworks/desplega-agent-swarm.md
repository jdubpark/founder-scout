# desplega-ai/agent-swarm: what the code does

Pinned commit `b1fc5965adfa` (2026-11-13). Paths are relative to the checkout. Code was read, not run.

1. Memory is the most developed part. Rows carry a scope (`agent` or `swarm`), a closed set of curated roots is writable only by the lead, and a rating loop changes ranking weights.
2. The loop never changes prompts, skills, routing or structure from outcomes. Prompt templates are seeded at boot. Evals measure but do not gate. The dreaming lane classifies only.
3. Pool sizing and routing are small and real: a pure function sizes runtimes per agent from queue depth, and routing tries warm workers before waking sleeping ones. Agent identities stay fixed.
4. The strongest evidence is in workflows: TLA+ models whose counterexamples became repro tests, with fixes recorded (`specs/tla/workflows/FINDINGS.md`).
5. Goals and assumptions are thin. There is no goal model and no assumption tracking.

## Mechanisms

### 1. Memory scope and read rule

Each memory row has scope `agent` or `swarm`, and no user or task scope exists (`src/types.ts:2458`). A read passes when the row is swarm-scoped or owned by the caller (`src/be/memory/access.ts:3-5`). The list query applies the same rule in SQL (`src/be/memory/providers/sqlite-store.ts:1219-1224`).

Each agent sees its own rows plus every swarm row. Rows cross between agents only by being written to swarm scope. Cost is not measured. Failure: one swarm row reaches every worker at once, and nothing separates a guess from a curated fact except the key guard in mechanism 2.

Evidence: the read rule has no direct unit test that I read. `memory-search-reader.test.ts` exists; I did not open it.

Verdict: ADAPT. Keep a private scope per job and a shared scope, and make an explicit promotion step the only way across. Founder Scout already keeps evidence per founder and per company (CLAUDE.md), so the missing piece is the promotion step.

### 2. Lead-only curated tree and key guard

Keys under `/longterm` must fall in a closed root list, and the lead-only roots include `company-story`, `entities` and `timeline` (`src/be/memory/key-paths.ts:43-46`). Writing there requires `memory.write.consolidated`, which non-lead agents lack:

```ts
if (!isConsolidatedKey(key)) return;
const { principal, source } = writer ?? NO_AUTHORITY;
const decision = can({ principal, verb: "memory.write.consolidated", ... });
if (!decision.allow) throw new MemoryKeyError(consolidatedKeyMessage(key), "forbidden");
```

`src/be/memory/key-guard.ts:84-92`. A `sourcePath` under `/longterm` gets the same checks (`key-guard.ts:76-81`), so a file cannot bypass the guard by path. Anything written under a non-curated key still reaches every worker.

Evidence: `sealed-key-guard.test.ts` and `memory-key-paths.test.ts` exist. I read their names only.

Verdict: ADAPT. A closed root list and one `assertWritable(key, writer)` function is cheap and blocks the worst spread.

### 3. Learning capture from finished work

An agent calls `store-progress` with a learning, and code writes one swarm `manual` row under `/learnings/<workstream>/<slug>` (`src/be/memory/task-learning.ts:2-9`). Checks run in order: secret scrub, a 2000-character cap, an 80-character floor (`:41`), rejection of text that restates the same call's progress or output (`:156-178`), replay by task and content hash (`:180-191`), then a near-duplicate check (`:204-247`).

```ts
const duplicate = await findNearDuplicate({ agentId, isLead, text });
if (duplicate) {
  await rateDuplicate(duplicate, task.id);
  return duplicate;
}
```

A duplicate becomes a positive rating on the existing row instead of a second row (`:250-273`). Learnings expire after 30 days unless moved to `/longterm` (`src/be/memory/constants.ts:21`).

The writer is the worker, and the output is visible to later searches by any agent. Cost is one embedding call per learning. Failure: the file admits a gap, since two near-identical learnings written seconds apart can both store (`:13-15`).

Evidence: `store-progress-learning.test.ts` has about 25 named cases (`:124-725`). The floor was calibrated on stored learnings, per the file's comment. No outcome measurement was found.

Verdict: ADAPT. Take the floor, the hash replay and the duplicate-becomes-rating move. Do not auto-share lessons. Write them as proposals that the partner's Yes or No accepts.

### 4. Usefulness ratings and the Beta posterior

After a task, each retrieved memory gets an event. The implicit-citation rater gives +1 at weight 0.5 when the memory's id appears in the task's session logs, and -1 at weight 0.25 otherwise (`src/be/memory/raters/implicit-citation.ts:30-42`). The store adds the event to the row's alpha or beta (`src/be/memory/raters/store.ts:125-127`):

```ts
const alphaDelta = Math.max(0, event.signal) * event.weight;
const betaDelta = Math.max(0, -event.signal) * event.weight;
```

Ranking uses `min(2, 2α/(α+β))`, floored at 0.5. It drops below 1.0 only when `hasDemotionEvidence` is true (`src/be/memory/reranker.ts:108-120`). That needs explicit-self evidence, or at least 10 LLM ratings with a mean under 0.25 (`:97-113`). Implicit misses alone never demote. Memories are never deleted on this path (`:86-89`).

The rater cannot name its own source. The framework stamps it from the rater's name (`implicit-citation.ts:16-18`). The LLM rater is opt-in, since the default is `implicit-citation,explicit-self` (`src/be/memory/raters/registry.ts:11-12`), and it shells out to `claude -p` (`llm-client.ts:11-13`). The explicit-self rater returns nothing server-side (`explicit-self.ts:16-22`) and receives ratings from the `memory_rate` tool.

Agents never see ratings. Ratings change rank for every later search. Evidence: `memory-reranker.test.ts` (41 cases), `memory-rater-implicit-citation.test.ts` (14), `memory-rater-e2e.test.ts` (7). No measured effect on task success was found. The author's note says rater labels come only from what the system already showed, so every alternative embedding model "lost" to the incumbent (`thoughts/taras/learnings/2026-09-28-memory-embedding-eval-learnings.md:82`).

Failure: the signal exists only when an agent writes a UUID into its logs, so citation is a weak proxy for use.

Verdict: ADAPT. The demotion gate is the best idea here. A memory is demoted only when someone with evidence says it is wrong. Map Founder Scout's partner Yes or No to explicit-self, and treat citation as a weak positive only.

### 5. Dreaming classifier (memtax)

A seeded catalog script classifies the last 24 hours of curated docs into a closed path enum (`src/be/seed-scripts/catalog/dreaming-memtax.ts:1-16`). Learnings are excluded so a separate step handles them once (`:38`). The header says the lane makes no memory writes in any mode. I read the header and did not trace the write paths.

Evidence: `dreaming-learnings.test.ts` exists. The report draws 30 random samples for a human to check (`:9`).

Verdict: ADAPT the closed enum with a validator and the sampled report. Skip the lane itself for now.

### 6. Pool sizing and routing

Each agent's runtime count is computed from queued work. `computeDesired` (`src/be/runtime-pools/demand.ts:58-83`):

```ts
const uncovered = Math.max(0, agent.work - agent.freeSlots - agent.provisioning * pool.slotsPerRuntime);
const count = Math.min(limit, Math.max(pool.minRuntimes, agent.current + Math.ceil(uncovered / pool.slotsPerRuntime)));
```

Existing runtimes use up the pool cap before any new capacity is granted (`:64-67`). "Work" is pending or offered tasks plus unread mention channels (`:5-29`), so a chat mention counts the same as a task. The whole feature is off unless `RUNTIME_POOLS_ENABLED` is set (`src/utils/runtime-pools-flag.ts:3-11`).

Routing (`src/be/runtime-pools/routing.ts:67`) tries each idle warm worker that passes `eligible()`: headroom, capability, harness and profile check (`:219-223`). Only if none passes does it wake a sleeping runtime, after a 15-second grace (`:255-260`). Stranded pending tasks are released after `RUNTIME_WAKE_REROUTE_SEC`, default 600 (`:94-107`).

Failure: the scan starts at offset 0 on every call (`:230`) and stops at 500 rows (`:229`). If the first 500 unassigned tasks are incompatible, tasks past them are never reached.

Evidence: `runtime-demand.test.ts`, `runtime-pool-routing.test.ts`, `pool-affinity.test.ts` exist. I read names only.

Verdict: ADAPT. Use `computeDesired` as a pure concurrency sizer for per-job workers, with table tests. Use warm-first, then wake, and the explicit release rule. Skip the container runtime unless Founder Scout moves its jobs into containers.

### 7. Stalled runtime detection and recovery

The supervisor marks a runtime stale when its last ping is older than a cutoff, missing when the provider no longer lists it, or timed out while provisioning after `RUNTIME_PROVISION_TIMEOUT_SEC`, default 300 (`src/be/runtime-pools/supervisor.ts:526-556`). It then terminates the runtime and recovers its sessions. Recovery is serialized per runtime (`src/be/runtime-pools/recovery.ts:31-46`), and in-progress tasks are re-queued through `remediateTaskForDeadRuntime` (`:48-79`). The loop ticks every 5 seconds by default (`supervisor.ts:1012`).

Failure, from the code: detection depends on the ping timestamp. A process that keeps pinging while hung is not caught by this path. I found no progress check.

Evidence: `runtime-supervisor.test.ts` and `runtime-pool-reachability.test.ts` exist. I read names only.

Verdict: ADAPT the per-entity serialization and the three separate stall causes, with an added progress check.

### 8. Budget admission

`canClaim` checks global, then agent, then user daily spend against budgets, and returns a refusal with `resetAt` (`src/be/budget-admission.ts:63-103`). A kill switch exists (`:77`). The file's own header calls the function pure (`:3-5`). It reads spend and allows the claim. It does not reserve spend for claims in flight, so two claims starting together can both pass. I did not measure the overshoot. This follows from the code's shape.

Evidence: `budget-admission.test.ts` and `budget-claim-gate.test.ts` exist. I read names only.

Verdict: ADAPT the global-first order, the refusal with a reset time, and the kill switch. Add a reservation counter for concurrent claims.

### 9. Fenced workflow checkpoints

A step's result is written only if the attempt still holds the step. `holdsFence` requires the step to be `running` with the same `retryCount`, the run to be `running` or `waiting`, and no cancelled ancestor (`src/workflows/checkpoint.ts:15-25`). A stale write returns `stale: true` and changes nothing (`:79-90`). Context is merged before each write so concurrent walkers do not drop keys (`:27-41`).

Evidence: `src/tests/workflow-tla-races.test.ts`. `FINDINGS.md` says its repro tests cover counterexamples CX1 to CX7, all fixed.

Failure: fencing depends on `retryCount` being bumped on every new attempt. I did not check every writer.

Verdict: ADAPT. A per-attempt token on every checkpoint write stops a late worker from overwriting a retried result. Founder Scout's daily pipeline has retryable steps, so this applies directly.

### 10. TLA+ models tied to regression tests

`Heartbeat.cfg` lists seven invariants (`OneRunner`, `NoLiveKill`, `AcceptOwnOffer` and others) and four properties (`TerminalAbsorbing`, `EventuallyFinished` and others) (`specs/tla/heartbeat/Heartbeat.cfg:31-43`). For workflows, calibration rediscovered two of two historical bugs. Model checking found seven counterexamples on `main`, each fixed, with a repro test (`specs/tla/workflows/FINDINGS.md:8-29`). Several later counterexamples have no repro test yet.

The heartbeat README says "A green run proves the model, not the code" (`specs/tla/heartbeat/README.md:33`). The mapping in `ACTIONS.md` is maintained by hand. Some heartbeat tests cite it, but I found no test that checks its rows. A TLC run needs Java 21 and a 6 GiB heap by default (`README.md:10-23`).

Verdict: ADAPT the method, not the tool. Write each invariant and each bad interleaving as a test. Skip TLC unless the pipeline grows much more concurrent.

### 11. Savings estimate with stated assumptions

`savingsAssumptions(tier)` returns nine plain sentences that the API shows (`src/be/savings/model.ts:661-674`, `src/http/savings.ts:308`). One of them says what the model leaves out: "Scripts record no LLM spend, so their actual cost counts as $0; LLM calls made inside scripts are not counted." Calibration re-derives the curve from the deployment's own session costs and refuses to store it unless coverage thresholds are met (`src/be/savings/calibrate.ts:1-23`).

Evidence: `savings-calibration.test.ts` and `savings-compute.test.ts` exist. I read names only.

Verdict: ADAPT. Put a plain list of assumptions and known omissions in every spend report. This fits Founder Scout's spend caps.

### 12. Approval requests and secret-safe config questions

A person can answer a config question from the dashboard. Only a result is stored or sent onward, never the value (`src/be/approval-config-question.ts:3-6`). Unanswered approval requests auto-cancel after 7 days unless they carry an expiry, and a request that gates a live run cancels that run too (`src/be/approval-sweeps.ts:11, 20-34`).

Evidence: names only. Verdict: ADAPT the secret-stays-out rule and the TTL on human questions. Founder Scout already keeps vendor keys out of agents (CLAUDE.md).

### 13. Eval harness without a gate

`apps/evals` runs a scenario-by-config matrix in E2B sandboxes. It grades with deterministic checks and LLM judges, and it stores each attempt by (run, scenario, config, index) so resume is idempotent (`apps/evals/README.md:9-22`). A metered-cost cap applies per run (`:26`). There are 39 scenarios. `publish` freezes a matrix to `/benchmark` (`:46-49`). CI type-checks and tests the evals (`.github/workflows/ci.yml:82-106`). `merge-gate.yml` does not reference them, so no score gates a change to prompts or code.

Evidence: no measured results were read.

Verdict: ADAPT the attempt ledger and the hard cost cap. Skip it as a gate. Founder Scout's `decideCandidate` already does the gating this harness lacks.

## Topic answers

**1. Dynamic agent pools.** Pools scale runtimes for fixed agent identities. Counts follow queued work (`demand.ts:58-83`), routing prefers warm workers (`routing.ts:219-254`), and recovery replaces dead runtimes (`supervisor.ts:526-556`). The signal is queued tasks plus unread mention channels, minus free slots and runtimes already starting. A task goes to the first eligible warm worker that passes capacity, capability, harness and profile checks. Spend is a claim-time check. Not found: any code that creates a new agent role or retires one on evidence.

**2. Context pools.** Two scopes, enforced by one read rule (`access.ts:3-5`). Isolation is the default. Crossing happens in three places: `store-progress` writes learnings to swarm scope (mechanism 3), the lead writes the curated tree (mechanism 2), and a review-task filter removes other review tasks' completion memories (`src/be/memory/review-recall-filter.ts:2-16`). The last is an exclusion rule, not a summary. Not found: a summary or hand-off step between pools, or a user or task scope.

**3. Self-evolution.** The only outcome-driven loop is rank: rating, then alpha and beta, then a rank multiplier (mechanism 4). It changes ordering and never deletes. Prompt templates are seeded at boot (`src/be/seed-prompt-templates.ts:49-60`), not changed from outcomes. No outcome-driven change to skills, routing or structure was found. Evals measure and do not propose. Honesty mechanisms exist: demotion needs evidence and the rater cannot set its own source. No held-out set decides whether a change is kept, which Founder Scout's `decideCandidate` does.

**4. Objective assumptions.** No mechanism found. The goal is the task text, which the prompt template asks for (`src/prompts/session-templates.ts:97`), plus a compaction reminder an operator can edit (`:416-418`). Assumptions appear in two places: the savings model lists its assumptions as plain sentences (mechanism 11), and a human question can go out as an approval request (mechanism 12). Nothing records implicit assumptions about a goal, checks them against outcomes, or revises them.

## Claims the code does not back

| Claim | Where | Finding |
|---|---|---|
| A 0.4 display threshold hid every hybrid hit for 30 days | `thoughts/taras/learnings/2026-09-28-memory-embedding-eval-learnings.md:53-54` (author's note) | Not confirmed. I found no 0.4 display threshold in `src/` outside tests, so the note may describe an older state. |
| Heartbeat TLA rows stay true as code changes | `specs/tla/heartbeat/README.md:33` | Stated as a manual step. No test reads `ACTIONS.md`. |
| Dreaming lane B1 makes no memory writes in any mode | `src/be/seed-scripts/catalog/dreaming-memtax.ts:4-5` | Stated in the header. Not traced. |
| The learning check catches near-identical learnings | `src/be/memory/task-learning.ts:11-15` | The file states a race gap. Stated, not a false claim. |

## Five ideas worth taking, ranked

1. **Demotion gate from partner verdicts.** Table `memory_use(memory_id, run_id, signal, source)` with `alpha` and `beta` on the memory row. Rank multiplier `clamp(2α/(α+β), 0.5, 2)`, applied only when explicit evidence exists, such as a partner No. Test: a history of citations alone never lowers rank.
2. **Learning proposals with a floor and dedupe.** Table `learnings(id, content_sha, text, run_id, status)`. Reject under 80 characters, replay by hash, and on a near match increment a `seen` counter instead of inserting. New rows start as `proposed` and reach shared use only after the partner accepts.
3. **One write guard for curated keys.** A list of curated roots and `assertWritable(key, writer)`. Only the lead role may write to those roots. About 40 lines, plus a test per root.
4. **A pure sizer for per-job concurrency.** `desiredWorkers({ queued, running, min, max, perWorker })` using `Math.ceil`, with table tests. Keep mentions and tasks in separate counts.
5. **Attempt fence on checkpoints.** An integer `attempt` on each step. Writes use `WHERE attempt = ?` and treat zero affected rows as stale. A regression test replays a late write after a retry.

## What to avoid

- Citation as a quality signal on its own. The miss penalty fires whenever an agent omits an id, and the author's note says raters judge only what was shown.
- Shared scope for agent-written lessons with no review step. The learning path has a noise floor but no trust tier.
- A budget check without reservation when claims run concurrently.
- Reading a green TLA+ run as proof of the code.
- Calling an eval matrix a gate when CI does not run it against changes.
- Sizing pools from mentions and tasks summed into one number.
- Starting a scan at offset 0 on every tick with a fixed cap.

## Not read

- `src/be/memory`: `search-candidates.ts`, `search-reader.ts`, `graph-expansion.ts`, `edges-store.ts`, `links-store.ts`, `link-resolver.ts`, `key-browser.ts`, `key-paths.ts` in full, `chunking.ts`, `index-content.ts`, `embedding-space.ts`, `raters/llm.ts` internals, `demotion-evidence.ts` beyond its main function.
- `src/memory/automatic-task-gate.ts`, `src/memory/recall-query.ts`.
- `src/be/runtime-pools`: `lifecycle.ts`, `controllers.ts`, `reachability.ts`, `remote-controller.ts`, `db.ts`. `src/be/model-tier-resolution.ts`, `src/be/multi-runtime.ts`, `src/heartbeat/`, `src/scheduler/`, `src/tasks/`, `src/ranking/`.
- `src/workflows`: `definition.ts`, `engine.ts` body, `foreach-driver.ts` and `foreach-join.ts` bodies, `successor-routing.ts`, `retry-poller.ts`, `wait-poller.ts` body.
- `specs/tla/heartbeat/ACTIONS.md`, `CALIBRATION.md`, the TLA module bodies.
- `apps/evals/src`, the scenario files, and the benchmark data.
- Test bodies. Test coverage in this report is from file names and, for learnings, test titles.
- `thoughts/` beyond two files. `src/prompts/`, `templates/`, `DESIGN.md`, `MCP.md`, `runbooks/`, `onboarding.ts`, `org-profile.ts`.
- `improvements.ts` was read only for its header. It sends product feedback to the vendor and is not a self-improvement loop.
