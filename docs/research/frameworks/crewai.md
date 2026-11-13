# crewAIInc/crewAI: what the code does

Pinned commit `bc36a4df6293` (2026-11-13). Source paths are relative to `lib/crewai/src/crewai/`. Test paths are relative to `lib/crewai/`. Doc paths are relative to the checkout root. Everything here comes from reading source, the `docs/edge/` pages, and test names. Nothing was executed, and no test was run.

- Memory is the most developed part. It has LLM-scored saves, a consolidation step that can rewrite or hard-delete records, a depth-routed recall flow, and path-based scopes. Isolation between scopes is a naming convention, not access control.
- There is no dynamic agent pool. The roster is fixed when the Crew is built. Routing picks among existing agents by role name (delegation) or by configured id (A2A).
- The two self-change loops, training and flow `learn=True`, turn human feedback into prompt text or stored memory. Neither has a held-out check, and no measured effect was found.
- The planner loop (plan, step, observe, replan) is real and capped by config, except that `max_attempts` defaults to unbounded.
- The most reusable single piece is the task guardrail: a bounded retry loop with feedback, where a judge error counts as a failed check.

## Mechanisms

### 1. Save pipeline (EncodingFlow)

**What it is.** Each `remember` or `remember_many` call runs a five-step flow. It embeds all items in one call, drops near-duplicates inside the batch, searches storage for similar records, asks the LLM only where needed, and writes once.

**How it works.** `memory/encoding_flow.py:112` runs one batch embedding. Items at cosine 0.98 or more are dropped (`memory/types.py:204`). `parallel_analyze` (`encoding_flow.py:223`, groups A to D in its docstring) makes no LLM call for a new record with full fields, and one or two calls otherwise. It runs at most 10 threads (`encoding_flow.py:277`). If the analysis call fails, the item is inserted with defaults (`memory/analyze.py:330`).

```python
if fields_provided and not has_similar:
    self._apply_defaults(item)
    item.plan = ConsolidationPlan(actions=[], insert_new=True)
```

**Context and crossing.** The analysis sees the new text, existing scope names (`encoding_flow.py:254`), and the root scope boundary (`encoding_flow.py:247-252`).

**Evidence.** `tests/memory/test_memory_root_scope.py:750` and `:776` cover the fast and LLM paths. No measured quality data.

**Cost.** Zero to two LLM calls per item, plus one embedding call per batch.

**Failure modes.** The model's guess at scope, categories, and importance is stored as fact. Nothing checks it later.

**Verdict.** ADAPT. Keep the batch shape and the no-LLM fast path. Keep the model's judgments as proposals (see Mechanism 2).

### 2. Consolidation: keep, update, or delete on save

**What it is.** When a new item is similar to an existing record (cosine 0.85 or more), an LLM returns a plan: keep, update, or delete for each existing record, plus whether to insert the new text.

**How it works.** `memory/analyze.py:333` `analyze_for_consolidation` builds the plan. It sends at most five existing records (`memory/types.py:195`), each cut to 200 characters (`analyze.py`, inside `analyze_for_consolidation`). `execute_plans` (`memory/encoding_flow.py:388`) keeps one action per record id, first one wins, then deletes:

```python
if dedup_deletes:
    self._storage.delete(record_ids=list(dedup_deletes))
    self.state.records_deleted += len(dedup_deletes)
```

**Context and crossing.** The model sees the new text and truncated versions of similar records. It does not see the record's full history, because none is kept.

**Evidence.** `tests/memory/test_unified_memory.py:1046` uses a mocked `ConsolidationPlan`. No test with a live model was found.

**Cost.** One LLM call per item that has a similar record.

**Failure modes.** A model can hard-delete a record during an unrelated save. There is no tombstone, no history, and no approval step. The model judges on 200-character excerpts. The error path inserts, which is the safe default.

**Verdict.** ADAPT. Keep the keep/update/delete contract and its reason field. Replace hard delete with a superseded marker, and gate deletes on a second check.

### 3. Deep recall router (RecallFlow)

**What it is.** `recall()` defaults to `depth="deep"`. That runs a flow: an optional LLM query split, selection of up to 20 candidate scopes, parallel vector search, a confidence router, and at most one LLM exploration round. `depth="shallow"` is a single vector search.

**How it works.** The router is `memory/recall_flow.py:277-295`. It synthesizes when the top raw score is at least 0.8 (`memory/types.py:231`). It explores when the query is complex and confidence is under 0.7, or when confidence is under 0.5, and the budget lasts. The budget defaults to 1 (`memory/types.py:258`), and it is decremented in `recursive_exploration` (`recall_flow.py:297`), so the loop ends. The LLM split is skipped for queries under 250 characters (`recall_flow.py:199`). Confidence is the maximum raw vector score (`recall_flow.py:181`), so it depends on the embedder.

```python
if self.state.confidence >= self._config.confidence_threshold_high:
    return "synthesize"
if (self.state.exploration_budget > 0
    and self.state.confidence < self._config.confidence_threshold_low):
    return "explore_deeper"
```

**Context and crossing.** Search covers the candidate scopes inside the caller's root scope. Exploration sends the top five results' text to the LLM.

**Evidence.** No test by name exercises `decide_depth` or `explore_deeper`. The scope filter is covered by `tests/memory/test_memory_root_scope.py:844`.

**Cost.** Zero to two LLM calls per deep recall, plus one search per candidate scope.

**Failure modes.** Thresholds are not calibrated in the repo. Recall writes `last_accessed` on every hit (`memory/unified_memory.py:794-800`), so a read changes stored state.

**Verdict.** ADAPT. Use the shallow path by default, with one optional expansion under an explicit budget.

### 4. Composite score and recency

**What it is.** The final rank is `0.5 * semantic + 0.3 * recency + 0.2 * importance`. Recency is exponential decay with a 30-day half-life.

**How it works.** `memory/types.py:345-376` computes it. Decay is taken from `record.created_at` (`types.py:364`). `touch_records` (`memory/storage/lancedb_storage.py:365`) writes `last_accessed`, and nothing in scoring reads that field. Its only reader in the tests is `tests/memory/test_unified_memory.py:501`, which checks that a read-only recall leaves it unchanged.

**Evidence.** The docs state the same formula (`docs/edge/en/concepts/memory.mdx:341-346`).

**Failure modes.** A record that is recalled often still decays from creation. Nothing removes old records automatically. `forget` is manual (`memory/unified_memory.py:828`).

**Verdict.** ADOPT the formula and the weights as a starting point. If recency should mean "recently used", score on `last_accessed`, which is already written.

### 5. Scopes, root scopes, slices, and visibility (context pools)

**What it is.** Each record has a path such as `/crew/research/findings`. A crew, agent, or flow gets a root prefix, and its writes are joined under it. `memory.scope(path)` gives a restricted view. `MemorySlice` reads several scopes at once and merges the results.

**How it works.** A crew with `memory=True` gets root `/crew/<name>` (`crew.py:670-690`). `memory/memory_scope.py:76-100` joins relative paths under the root. `MemorySlice.recall` runs one recall per scope and merges by score (`memory/memory_scope.py:295-328`). `remember` on a read-only slice returns nothing (`memory_scope.py:272-280`). A private record is visible only to a matching `source` (`memory/unified_memory.py:751-761`).

The prefix match is a SQL `LIKE` with no segment boundary (`memory/storage/lancedb_storage.py:55-63`). So `/crew/a` also matches `/crew/ab`.

**Context and crossing.** A scope view can read anywhere under its path. Reads across scopes happen only through an explicit slice. There is no summary step between scopes. The underlying `Memory` object is still reachable from any caller that holds it.

**Evidence.** `tests/memory/test_memory_root_scope.py:844` checks that a root-scoped recall returns only scoped records. `:1126` checks that consolidation search is constrained to the root. `tests/memory/test_lancedb_filter_escaping.py:28-32` and `:144-147` test injection through the scope string. No test was found that checks a scoped `forget` leaves root-level records alone.

**Cost.** A slice multiplies recall work by its scope count, and each scope may run the deep flow.

**Failure modes.** No access control. Prefix matching has no boundary. The LanceDB delete path adds `OR scope = '/'` to its conditions (`lancedb_storage.py:474`), so a scoped delete may also remove records at the root. I read this from code and did not run it.

**Verdict.** ADOPT the pattern for context pools: private scopes by default, explicit slices for cross-context reads. Fix the prefix boundary and the root-delete path before relying on it.

### 6. Hierarchical process (manager agent)

**What it is.** `Process.hierarchical` creates a manager LLM agent that holds delegation tools for every crew agent. The manager is the only agent that runs tasks.

**How it works.** `crew.py:1537-1539` runs the tasks through `_execute_tasks`. `_create_manager_agent` gives the manager `AgentTools(agents=self.agents).tools()` (`crew.py:1565`). `_get_agent_to_use` returns the manager for every task (`crew.py:1742-1745`), so a task's own `agent` field does not run it.

**Context and crossing.** The manager sees the task list and whatever its delegated coworkers return as tool output.

**Evidence.** `tests/test_crew.py` has 18 mentions of `Process.hierarchical`. I did not read them.

**Cost.** One manager call per step, plus each coworker's full run.

**Failure modes.** One model both assigns and judges work. The docs say the manager "reviews outputs, and assesses task completion" (`docs/edge/en/concepts/processes.mdx:57`). No review step exists in the code.

**Verdict.** SKIP as a design for pools. The delegation pattern is covered in Mechanism 7.

### 7. Delegation tools and A2A routing (routing among a fixed set)

**What it is.** Agents with delegation get `DelegateWorkTool` and `AskQuestionTool`. The LLM names a coworker by role string. Code matches it against the crew's fixed agent list and runs that agent. A2A routing uses a response model whose agent-id field is a Literal over the configured remote ids.

**How it works.** `tools/agent_tools/agent_tools.py:26-31` builds the two tools. `tools/agent_tools/base_agent_tools.py:46` matches the sanitized role against `self.agents`, then `:120` runs `selected_agent.execute_task(task, context)`. The context is one string from the caller. `a2a/utils/response_model.py:17-38` builds the constrained model, with `a2a_ids` typed as a tuple of Literals and capped at the number of configured ids. The conversation cap is `a2a/config.py:397` (`max_turns`), and `a2a/wrapper.py:763` returns the last agent message when the cap is hit.

**Context and crossing.** A coworker sees the task and the context string, not the caller's memory or message history.

**Evidence.** `tests/agents/test_agent_a2a_kickoff.py` exists. I did not read its assertions.

**Cost.** One coworker run per delegation.

**Failure modes.** An unknown role returns an error string as tool output. The model may retry, and nothing caps that. A2A stops at `max_turns`.

**Verdict.** ADAPT. The Literal-constrained choice over a fixed set is the piece to copy for routing among Founder Scout investigators.

### 8. Per-run model overlay (llm_overlay)

**What it is.** A context-scoped map from agent role, or model string, to a replacement model. Agents built inside the block use the mapped model.

**How it works.** `llm_overlay.py` (docstring, lines 1-30) defines the rule. It is read in `llm.py:37` and `agent/core.py:96`. It applies to the current run only.

**Failure modes.** A model swap is easy to miss in results.

**Verdict.** ADOPT for per-run model choice, such as an experiment on another model. Not a production routing layer.

### 9. Planning and step execution

**What it is.** With `planning_config`, an agent writes a plan of structured steps, refines it up to `max_attempts`, turns each step into a todo, runs each step in its own message list, observes the result, and replans up to `max_replans`.

**How it works.** `utilities/reasoning_handler.py:244` creates the plan, and the refine loop at `:278` runs `while not ready and (max_attempts is None or attempt < max_attempts)`. `agent/planning_config.py:98` defaults `max_attempts` to `None`, so the loop runs until the plan is ready. `agent_executor.py:745-763` sets effort to medium and `max_replans` to 3. `agents/step_executor.py:253-266` builds fresh messages for each step. `agents/planner_observer.py:113` observes after each step. `agent_executor.py:876-882` routes by effort.

**Context and crossing.** Each step sees only its own description and dependencies. The planner sees the task and the latest observation.

**Evidence.** `tests/agents/test_agent_reasoning.py:89` checks that `planning=True` sets a bounded `max_attempts`. `tests/agents/test_agent_executor.py:2110-2180` checks that medium effort routes a failed step to `replan_now`. Most tests use mocks. No measured effect was found.

**Cost.** One or more plan calls, one tool loop per step, one observer call per step at medium and high, and one more plan per replan.

**Failure modes.** `max_steps` is passed to the prompt but not enforced (`docs/edge/en/concepts/planning.mdx:90`). An unbounded refine loop is possible (`planning.mdx:86`). A failed planning call falls back to the normal loop without a warning in the result.

**Verdict.** ADAPT. Keep the plan as data, a cheap heuristic check after each step, and a capped replan. SKIP the default unbounded refine.

### 10. Task guardrails with bounded retries

**What it is.** A task can carry a function guardrail or an LLM guardrail. A failed check sends its feedback back to the agent. After `guardrail_max_retries` (default 3), the task raises.

**How it works.** `task.py:289` sets the default to 3. `task.py:1423-1500` runs the loop, and each guardrail index has its own retry count. `tasks/llm_guardrail.py:102-129` returns `(False, feedback)` on any exception, so a judge error fails the check.

```python
except Exception as e:
    return False, f"Error while validating the task output: {e!s}"
```

**Context and crossing.** The guardrail sees the task output only.

**Evidence.** `tests/test_task_guardrails.py:98` (retry succeeds), `:525` (retries exhausted), and `:734` (per-guardrail retry counts). These use the code path directly.

**Cost.** One judge call per attempt for an LLM guardrail.

**Failure modes.** An LLM judge can pass bad output. Code does not check `expected_output`. A guardrail can return a whole new `TaskOutput`, which replaces the earlier one.

**Verdict.** ADOPT the loop for rubric-shaped checks: bounded retries, feedback to the producer, fail-closed errors. Keep the final decision in code, as the founder scorer already does.

### 11. Training (crew.train)

**What it is.** `crew.train(n, filename)` runs the crew n times with human input forced on every task and delegation off. For each agent it saves the initial output, the human feedback, and the improved output. A model then distills those into `suggestions`, `quality`, and `final_summary`. Later runs append the suggestions to that agent's task prompt as "You MUST follow these instructions".

**How it works.** Setup is `crew.py:941-952`, which sets `task.human_input = True` and turns off delegation. The loop and evaluation are `crew.py:954-1000`. Capture is `agents/agent_executor.py:3449-3476`. The distillation is `utilities/evaluators/task_evaluator.py:115` (`evaluate_training_data`). The store is a pickle keyed by agent role (`utilities/training_handler.py:8`). The injection is at `agent/core.py:1543-1561`.

**Context and crossing.** Suggestions are per role and persist across runs through the file. They never cross between agents.

**Evidence.** `tests/test_crew.py:2974` (train success), `tests/utilities/evaluators/test_task_evaluator.py:11`, and `tests/agents/test_agent.py:1147` (injection). Mocked. No measured effect in the repo.

**Cost.** N full crew runs, a human at each task, and one distillation call per agent.

**Failure modes.** There is no gate. `quality` is stored but no code reads it to accept or reject a result. One session's feedback becomes mandatory instructions for every later run of that role. Training mode blocks non-interactive runs (`docs/edge/en/concepts/training.mdx:97`).

**Verdict.** ADAPT the distillation step as a proposal that a gate then accepts or rejects. SKIP the mandatory injection without an evaluation gate.

### 12. Flow human feedback with `learn=True`

**What it is.** A flow method marked `learn=True` recalls past lessons before a human sees the output, and an LLM rewrites the output with them. After feedback, another LLM call distills lessons and stores them in memory with `source="hitl"`.

**How it works.** The pre-review call is `flow/runtime/__init__.py:3667` inside `_run_human_feedback_step` (`:3652`). `flow/human_feedback.py:317` (`_pre_review_with_lessons`) recalls with `source=learn_source` (`:346`) and asks the LLM for an improved version. `:391` (`_distill_and_store_lessons`) stores the lessons with `mem.remember_many(lessons, source=learn_source)` (`:435`). The store is gated at `flow/runtime/__init__.py:3745` by non-empty feedback.

```python
mem.remember_many(lessons, source=learn_source)
```

**Context and crossing.** Lessons carry a source tag and no scope. They are recalled by source across the memory the flow uses.

**Evidence.** `tests/test_human_feedback_decorator.py:641` (lessons stored) and `:680` (pre-review uses past lessons). Both use a mocked LLM and a mocked memory. No end-to-end evidence was found.

**Cost.** One recall, one rewrite call, and one distillation call per step.

**Failure modes.** Distilled lessons are stored unchecked. A bad lesson rewrites every later draft. The rewrite happens before the human reviews the draft, so the reviewer sees changed text. A failure in pre-review falls back to the raw output unless `learn_strict` is set.

**Verdict.** ADAPT. Keep the human feedback as the source of truth. Store lessons with a scope, a version, and the feedback id as evidence. Apply them only after an evaluation gate.

### 13. Evaluation harnesses (no feedback loop)

**What it is.** `crew.test(n)` runs the crew n times with an LLM judge and prints scores. `ExperimentRunner` runs dataset cases and asserts scores.

**How it works.** `crew.py:2353` (`test`), `utilities/evaluators/crew_evaluator_handler.py:208` (reads `quality`), `experimental/evaluation/experiment/runner.py:26` and `:130`. A search of `src/` for "holdout", "held-out", "train_test_split", and "noise_floor" found nothing.

**Failure modes.** Scores are for display. No path leads from a score to a prompt or routing change.

**Verdict.** SKIP as the self-evolution loop. ADAPT the runner's shape for the eval harness, with a gate on top.

### 14. Knowledge sources

**What it is.** Static sources are embedded, and agents or crews query them per task. The results go into the prompt.

**How it works.** `knowledge/knowledge.py:135-151` queries with `results_limit=5` and `score_threshold=0.6`. `agent/core.py:1618` has an LLM write the search query for each task. Knowledge is read-only at run time, and the query is model-written, so it can miss.

**Verdict.** SKIP. Founder Scout's source layer already covers static evidence.

## Topic answers

**1. Dynamic agent pools: not present.** No code creates, sizes, or retires agents at run time. The roster is set when the Crew is built, and delegation only picks from it (`tools/agent_tools/base_agent_tools.py:46`). The dynamic parts are narrower: the LLM picks a coworker per call, the LLM picks A2A ids per turn (Mechanism 7), the planner writes steps per task (Mechanism 9), and `llm_overlay` picks a model per run (Mechanism 8). Routing is a choice among a fixed set. The useful piece for the reader is the constrained schema, not a pool.

**2. Context pools: present, with weak isolation.** Scopes, root scopes, slices, and source-based privacy (Mechanism 5) are the mechanisms. Isolation holds only by convention. Any code with the `Memory` object can read or write any scope, and a scope view does not stop it. Crossing happens through explicit slices and explicit writes into shared scopes. No summary or review step runs between pools. Knowledge (Mechanism 14) is a separate read-only store.

**3. Self-evolution: present, ungated.** Three loops change behavior from outcomes. Training writes mandatory prompt text (Mechanism 11). Flow `learn=True` stores lessons and rewrites drafts (Mechanism 12). Consolidation rewrites or deletes memory (Mechanism 2). None has a held-out check, a noise floor, or a guardrail on the change. The eval harnesses (Mechanism 13) score but do not feed back. Founder Scout's `decideCandidate` gate is stricter than anything here.

**4. Objectives and assumptions: implicit.** The objective is the task's `description` and `expected_output`, which are prose in the prompt. Code checks the output only through guardrails (Mechanism 10). Planning writes an explicit plan with a `ready` flag (Mechanism 9), and that plan lives in agent state, not in the output contract. Assumptions are not stored or checked. Human input is the only way a person corrects an objective (`task.human_input`, flow HITL). No mechanism surfaces an assumption before the agent acts, beyond the planner's own text.

## Claims the code does not back

| Claim | Where | What the code does |
|---|---|---|
| The hierarchical manager "reviews outputs, and assesses task completion" | `docs/edge/en/concepts/processes.mdx:57` | The manager is one LLM agent with delegation tools. No review step exists in `crew.py:1537-1539`. |
| Repeated saves are merged, so "keeps only one record" | `docs/edge/en/concepts/memory.mdx:392` | Depends on the model returning `delete`. The test at `tests/memory/test_unified_memory.py:1046` mocks the plan. |
| Training `quality` is "a 0-10 score capturing improvement" | `docs/edge/en/concepts/training.mdx:103` | The score is stored. No code reads it to accept or reject a result. |

## Five ideas worth taking, ranked

1. **Constrained routing among a fixed pool.** Copy the Literal-typed `a2a_ids` field (Mechanism 7). Smallest version: a Pydantic field whose allowed values are the current investigator ids, plus a test that an id outside the pool is rejected.
2. **Scopes with a segment boundary and explicit slices.** Smallest version: a helper that matches whole path segments, a `slice(scopes)` read, and two tests. One test checks that `/crew/a` does not match `/crew/ab`. The other checks that a scoped delete leaves root records alone.
3. **Consolidation as a proposal, never a hard delete.** Keep the 0.85 similarity trigger and the 0.98 batch dedup. Smallest version: the model returns keep or update with a reason, and an update writes a new version with a `superseded_by` link. Leave out delete in v1.
4. **Bounded validator retry with a fail-closed judge.** Smallest version: a function `validate_with_retry(check, produce, max_retries=3)` where `check` returns `(ok, feedback)` and an exception counts as a failure. It keeps a separate counter per check.
5. **Plan, observe, replan, with explicit caps.** Smallest version: a plan as a list of steps, a cheap check after each step, at most one replan, and a required `max_attempts`.

## What to avoid

- `PlanningConfig.max_attempts=None`, which refines without a limit. Always set a cap.
- Injecting training suggestions as "You MUST follow" before any evaluation gate.
- Hard-deleting memory on a model's word, with no history.
- Treating scope paths as access control. The `Memory` object is shared.
- Scoped `forget` on LanceDB until the root-delete path (`lancedb_storage.py:474`) is checked.
- `respect_context_window=False`, the default. When context overflows, `utilities/agent_utils.py:1044` raises `SystemExit`, which can end the host process.
- Flow definitions from untrusted sources. The `script` action is Python and "is not sandboxed" (`flow/flow_definition.py:523-545`).
- Recency based on creation time when the goal is recent use (Mechanism 4).

## Not read

- `flow/persistence/`, `flow/async_feedback/`, `events/`, `hooks/`, `skills/`, `experimental/flow_*`, `utilities/rpm_controller.py`, the converter internals, `knowledge/storage/`, and the Qdrant backend.
- Most test files. Only the names and the cited tests were checked.
- `docs/edge/en/learn/` and `guides/`. The `docs/v1.*` folders were ignored as instructed.

Tool note: Glob and Grep were not available. I used read-only `rg` and `find` through the shell, plus `Read`. Nothing from the checkout was executed.
