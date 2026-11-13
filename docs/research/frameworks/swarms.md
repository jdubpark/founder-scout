# kyegomez/swarms: what the code does

Pinned commit `293a5c768015` (2026-11-12). Paths are relative to the checkout root. I read source with grep, sed and find, because Glob was not available. I ran nothing from the checkout.

Findings:

1. Run-time agent creation exists, but it is one-shot. `AutoSwarmBuilder` has a model write a team spec, builds agents, runs them, and drops them. The model-driven sub-agent tool in the autonomous loop caches sub-agents with no count limit and no retirement.
2. Nothing in the repo changes prompts, skills, routing or structure from outcomes. Reflexion scores its own answers within one task. I found no cross-run learning loop.
3. Most decisions are a model's word, and code only parses around it. Several gates fail open: a rejected contract still runs, an unparseable step passes, and an unparsed self-score defaults to 5 of 10.
4. The reusable patterns are small: schema validation with a repair retry, optimistic version checks on a task queue, memory keyed by agent name, and fallback on exceptions with the attempts logged.
5. Names overstate the code. "Majority voting" sends answers to a consensus model and counts nothing. "60+ structures" is a file count; the router offers 14 types. Tests are mostly offline, and no quality benchmark is committed.

## Mechanisms

### 1. AutoSwarmBuilder: one-shot team design

**What it is.** A boss model returns a `SwarmRouterConfig` with agents, swarm type, flow and rules. Code validates it, builds `Agent` objects, and runs a `SwarmRouter` on them.

**How it works.** Validation errors go back to the model for repair (`swarms/structs/auto_swarm_builder.py:431-452`):
```python
raw = model.run(current_prompt)
data = self._parse_llm_json(raw)
return config.model_validate(data)
```
Spec fields go straight into `Agent(**agent_data)` (`:812`). The `max_agents` cap is set to `None` in the constructor with no parameter (`:297`), so the check is inert by default.

**State and context.** Each spec lasts for one task. The `model_name` per agent comes from the model, default `gpt-5.4` (`:160-163`).

**Evidence.** Offline tests cover repair retry, duplicate names and recursion rejection (`tests/structs/test_auto_swarms_builder.py:538-660`). None shows that a generated team beats a fixed one.

**Failure modes.** The `goal` field (`:184`) is dropped without error. `Agent.__init__` takes `**kwargs` and never reads it (`swarms/structs/agent.py:433-435`).

**Cost.** One boss call, plus up to one repair call, then the team's calls.

**Verdict: ADAPT.** Keep the validate-and-repair wrapper and the duplicate-name check. Do not let a model add agent types or pick models.

### 2. Model-created sub-agents in the autonomous loop

**What it is.** In `max_loops="auto"` mode the model can call `create_sub_agent` with a name, description and prompt, then `assign_task`.

**How it works.** `create_sub_agent_tool` builds an `Agent` with the parent's model and tools, caches it in `agent.sub_agents`, and never removes it (`swarms/structs/autonomous_loop_utils.py:1362-1440`). The cap is `max_loops=5 if parent_tools else 1` (`:1414`). The comment says this stops recursion. It does so because the loop's own tools are not added to `agent.tools`, not because of a depth counter.

**State.** Sub-agents keep their history for the life of the parent. Results return through a spawn registry keyed by `spawned_task_id` (`:1504-1533`).

**Evidence.** None found. `tests/agents/test_autonomous_loop.py` has 64 test functions, and none mentions sub-agents.

**Failure modes.** No limit on how many sub-agents exist, no retirement, and prompts written by the model. The depth guard in `SubagentRegistry` (`swarms/structs/async_subagent.py:83`) receives `depth=0` on this path (`autonomous_loop_utils.py:1504`), so it never fires here.

**Cost.** Each sub-agent runs up to 5 loops. The count is unbounded.

**Verdict: SKIP.** This is the only place the repo lets a model grow its own pool at run time, and it has no limit that matters.

### 3. SelfOrganizingSwarm: leaderless identical agents

**What it is.** N copies of one model share one objective and coordinate through a message board. There are no leaders and no roles.

**How it works.** Names are sampled per episode, so no naming convention can carry meaning (`swarms/structs/self_organize.py:440-442`). The board supports `post`, `read` and `notification` under a lock (`:98-136`). A member sleeps until mail arrives or the episode goes quiet (`:498-544`). A team reward is computed in code as success times `1 - token_cost * tokens` (`:819-831`).

**State.** Each member has private history and sees the board. Teammate order is shuffled per member (`:745-746`).

**Evidence.** 22 offline tests with a patched agent (`tests/structs/test_self_organize.py`). The module calls itself an "inference-only port" of a 2026 paper (`:4-6`). I did not check that claim, and the repo has no reproduction.

**Failure modes.** The token budget only sets a flag (`:611`). A call already in flight still finishes. The default is 4 members with `max_loops_per_wake=100` and a 900-second timeout.

**Cost.** Unbounded except by timeout and the budget flag.

**Verdict: SKIP** for the pipeline. The message board is a reference if investigators ever need peer review.

### 4. SwarmRouter: topology chosen by config, fallback on exceptions only

**What it is.** One entry point over 14 topology types (`swarms/structs/swarm_router.py:187-202`). The type comes from config, which a boss model may write.

**How it works.** Fallback runs only when a swarm raises (`swarm_router.py:1022-1041`):
```python
for position, swarm_type in enumerate(chain):
    try:
        self.swarm = self._create_swarm(task, swarm_type, *args)
        result = self.swarm.run(**run_kwargs, **kwargs)
```
Each fallback reruns the whole task, so side effects repeat. A poor answer never triggers fallback.

**State.** Each attempt builds a new swarm. The attempt list is saved in run metadata (`:1059-1065`). That part is worth copying.

**Evidence.** `tests/structs/test_swarm_router.py` has 71 test functions. I did not read them, and I found no evaluation of topology choice.

**Verdict: ADAPT.** Keep fallback on error, recording each failed attempt. Skip model-picked topologies.

### 5. ModelRouter: a model picks provider and model

**What it is.** One model call returns JSON with `model`, `provider`, `task`, `system_prompt`, `temperature` and `max_tokens`. Code passes them to LiteLLM.

**How it works.** The output is checked against a schema, not an allowlist (`swarms/structs/model_router.py:256-313`). Provider and model are joined into a LiteLLM model string (`:297-300`). The router may also rewrite the task through `routed_task`.

**Evidence.** 4 test functions in `tests/structs/test_model_router.py`. None checks the quality of the choice.

**Cost.** Two model calls per task.

**Verdict: SKIP.** A model that chooses its own provider, prompt and task text breaks "code decides" and fixed vendors for fact-checking.

### 6. AgentRouter: embedding argmax with history fed back

**What it is.** Returns the agent whose embedding is closest to the task (`swarms/structs/agent_router.py:211-263`).

**How it works.** There is no minimum similarity, so the best agent is returned even at a near-zero score. After each run, `update_agent_history` re-embeds the agent's name, description, prompt and full history (`:177-208`). An agent that answered similar tasks attracts more similar tasks.

**Evidence.** 18 test functions. I found no routing-accuracy check.

**Cost.** One embedding call per lookup, plus one per agent per history update.

**Verdict: SKIP.** The history term is a rich-get-richer loop with no check. If investigators are ever routed by similarity, use a threshold and fall back to the fixed job.

### 7. Context views and per-agent memory

**What it is.** A shared `Conversation` log. Each agent gets a view of it: its own turns become `assistant` turns, and everyone else's become labelled `user` turns (`swarms/structs/context_utils.py:37-103`).

**How it works.** `messages_for` sends the whole history on every call, with no cursor. The older `new_context_for` (`:131-185`) sends only the delta. Isolation by default comes from `persistent_memory`: each agent writes `agents/<agent_name>/MEMORY.md` (`swarms/structs/agent.py:796-803`), so two agents with the same name share one file. Context trimming is opt-in (`agent.py:633-640`).

**Evidence.** `tests/structs/test_transforms.py` has 2 test functions. I did not check tests for `messages_for`.

**Cost.** The full history is resent on each call and grows with the team.

**Verdict: ADAPT.** Use the role-based view and name-keyed memory. Make cross-pool hand-off an explicit step that writes one summary record, not a shared log.

### 8. PlannerGeneratorEvaluator: contract and score gate

**What it is.** A planner writes steps. For each step, the generator proposes acceptance criteria, the evaluator reviews them, and the two loop with score feedback.

**How it works.** Approval is a substring test (`swarms/structs/planner_generator_evaluator.py:516-518`):
```python
approved = (
    "approved" in contract_review.lower()
    and "amendments required" not in contract_review.lower()
)
```
"Not approved" passes. The run loop never reads `contract.approved` (`:860-861`). The pass decision uses the threshold written into the evaluator's own table row, which overrides the negotiated threshold (`:734-737`). The PASS/FAIL column is captured and ignored (`:699-703`). If no scores parse, `overall_passed = True` (`:752-754`).

**State.** A shared-state text that each role reads and appends to.

**Evidence.** One test file references the class (`tests/structs/test_hierarchical_swarm.py:1317`). No test covers the gate, and no test contains "not approved".

**Cost.** Per step: 2 negotiation calls, then 2 calls per attempt. With defaults (`max_steps=10`, `max_retries_per_step=3`, `:218-219`), that is up to about 100 calls plus planning.

**Verdict: ADAPT.** An explicit contract checked before work starts suits scout assumptions. Before copying, require an explicit approval token, read thresholds only from the contract, and fail closed on unparseable output.

### 9. PlannerWorkerSwarm: versioned task queue

**What it is.** A planner writes tasks with dependencies. Workers claim them from a queue, and a judge decides after each cycle whether to run another.

**How it works.** `claim` takes the highest-priority pending task whose dependencies are complete, and bumps its version (`swarms/structs/planner_worker_swarm.py:76-115`). `start` and `complete` take `expected_version` and return false on mismatch (`:117-129`). That optimistic check is the part to copy.

The judge is a fresh `Agent` each cycle (`:833-842`). It returns `is_complete` and `needs_fresh_start` (`:874-888`). A parse failure defaults to incomplete, which is the safe direction. Completion is still the model's call.

**Evidence.** One test function (`tests/structs/test_planner_worker_swarm.py:25`), which checks usage counts only.

**Verdict: ADAPT.** Copy the version check on claim, start and complete for investigation jobs. Skip the model judge for completion, and use code gates based on the rubric.

### 10. Reflexion: self-scored retries

**What it is.** Act, evaluate, reflect and refine, repeated up to `max_loops`. The best answer is kept.

**How it works.** The evaluator is a model asked for a "final score" (`swarms/agents/flexion_agent.py:294-334`). If no number parses, the score is 5 of 10 (`:323`):
```python
score = float(score_matches[-1]) if score_matches else 5.0
```
The best answer is chosen on that score (`:514`). Long-term memory keeps entries scored above 0.8 or the last iteration (`:452-453`), retrieved by term overlap (`:82-110`). On refine iterations the memories are fetched and then unused, because `act` is skipped (`:417-431`).

**State.** Memory lives on the agent instance and spans tasks.

**Evidence.** 2 test functions (`tests/agents/test_flexion_agent.py`). They check what is recorded and sent, not whether scores track quality.

**Cost.** One act, then 3 calls per iteration (refine, evaluate, reflect).

**Verdict: SKIP.** A model grades its own work, with a default that reads as a middling pass. Founder Scout forbids model scores.

### 11. Voting and aggregation: consensus models, not votes

**What it is.** Majority voting, self-consistency, the council and mixture-of-agents all send several answers to an aggregator model.

**How it works.** `MajorityVoting` runs voters in a loop and passes their answers to a consensus agent (`swarms/structs/majority_voting.py:268-330`). The docstring says it "returns the majority vote" (`:253`). No answer is counted. Self-consistency does the same (`swarms/agents/consistency_agent.py:293-298`). The only in-code match is substring containment, `if answer in response:` (`:350`), so "4" matches "14". Mixture-of-agents labels its input "Previous layer synthesis" but sends raw concatenated outputs (`swarms/structs/mixture_of_agents.py:264`, `:280-282`). The council gives each dimension a judge, and an aggregator writes the report. No score is computed in code (`swarms/structs/council_as_judge.py:413-472`).

**Evidence.** 3 council tests cover isolation and concurrency, not accuracy. The council evaluation example checks lowercase containment against a dataset answer (`examples/multi_agent/council/judges/council_judge_evaluation.py:315-316`). No results are committed.

**Cost.** Self-consistency is `num_samples + 1` calls. Mixture-of-agents is `layers x agents + 1`. Majority voting is voters times loops, plus consensus calls.

**Verdict: SKIP** as built. ADAPT the idea: ask for K independent extractions of a discrete answer, and count them in code.

## Topic answers

**1. Dynamic agent pools.** Offered: one-shot generation (`AutoSwarmBuilder`) and model-created sub-agents in the autonomous loop. Missing: pool sizing, routing to a pool, retirement, and per-pool budgets. The fixed alternatives validate names: `HierarchicalSwarm` rejects director orders that name an unknown worker (`swarms/structs/hiearchical_swarm.py:887`), and `HeavySwarm` uses three fixed role tables of 5, 4 or 16 agents (`swarms/agents/heavy_swarm_agents.py:49-52`, `:275-288`). Strongest example: `create_sub_agent_tool` (`autonomous_loop_utils.py:1362`), which caches sub-agents and never removes them.

**2. Context pools.** Offered: per-agent memory keyed by name and role-based views of a shared log (`context_utils.py:37`). Opt-in trimming exists. Missing: named pools and a hand-off step that writes a record. Strongest example: `messages_for`.

**3. Self-evolution.** Not found. No loop changes prompts, skills, routing or structure from outcomes. Reflexion improves within one task only. `get_reward` (`swarms/agents/agent_judge.py:16`) is keyword matching. The skills loader ranks skill files by term frequency (`swarms/structs/dynamic_skills_loader.py:171`) and does not learn. Nearest example: Reflexion's within-task refine loop, `flexion_agent.py:465-520`.

**4. Objective assumptions.** Not represented. The closest pieces are the contract in idea 8 (text, never checked), a judge prompt that asks it to "flag assumptions" (`swarms/agents/agent_judge.py:77`, text only), and a router that may rewrite the task (`swarms/structs/multi_agent_router.py:40`). Strongest example: the contract gate that is never read (`planner_generator_evaluator.py:516`, `:860`).

## Claims the code does not back

| Claim (where) | What the code shows | Location |
|---|---|---|
| "returns the majority vote" (`majority_voting.py:253`) | A consensus model writes the answer. Nothing is counted. | `majority_voting.py:312-330` |
| "60+ Multi-Agent Structures" (`README.md:287`) | `SwarmType` lists 14 types. | `swarm_router.py:187-202` |
| AgentRearrange "Dynamically maps" (`README.md:278`) | The flow is a string set by the caller and validated. No model changes it. | `agent_rearrange.py:343-367` |
| `max_agents` cap (`auto_swarm_builder.py:319-323`) | No constructor parameter, and it is set to `None`. | `auto_swarm_builder.py:297` |
| Contract approval (`planner_generator_evaluator.py:473`, "The approved StepContract") | The run loop never checks approval. | `:516`, `:860-861` |
| "Previous layer synthesis" (`mixture_of_agents.py:264`) | Raw worker outputs are concatenated. | `:280-282` |
| "inference-only port of s3" (`self_organize.py:4-6`) | Not checked. No reproduction in repo. | not checked |
| `test_error_handling` as a passing test (`test_auto_swarms_builder.py:159`) | On the failure path it prints "Should have raised" and asserts nothing. | `:182-188` |
| Best answer chosen by score (`flexion_agent.py:514`) | An unparsed score defaults to 5.0. | `:323` |
| Agent `goal` field (`auto_swarm_builder.py:184`) | Silently absorbed by `**kwargs`. | `agent.py:433-435` |

## Five ideas worth taking, ranked

1. **Gate on contracts in code, fail closed.** Smallest version: each scout run records a step contract with an explicit `approved: true` field. The run refuses to start if the field is absent or not true. Test: a review that says "not approved" blocks the run. Source: idea 8.
2. **Versioned claims on investigation jobs.** Smallest version: add a `version` integer to each job row. `claim` and `complete` update with `WHERE version = ?` and return false on mismatch. Test: two workers race for one job, and only one wins. Source: idea 9.
3. **Code-counted answers for discrete rubric questions.** Smallest version: for one rubric question, sample two extractions from the analyst at different temperatures. If they disagree, record `unknown` instead of picking one. Code computes the level. Source: idea 11.
4. **Fallback on error, with the attempt log.** Smallest version: if a fact-check call fails, retry once on the other vendor and record both attempts in the item's history. Do not fall back on low scores. Source: idea 4.
5. **A named assumption list per run.** Smallest version: each run stores its objective assumptions (time window, geography, stage, source set). Each has a source or rubric question that checks it, and a status. The partner's Yes or No changes the status, and no model does. This is the gap the framework leaves open, and it is my proposal, not something the code does.

## What to avoid

- **Model-chosen provider, model, topology or task text.** `ModelRouter`, `SwarmRouter` and the builder's `model_name` all do this. It conflicts with code deciding and with fixed fact-check vendors.
- **Self-graded loops with a middling default.** Reflexion defaults to 5 of 10, and an unparsed step passes. A default that looks like a pass hides failures.
- **Uncapped, model-created sub-agents with model-written prompts.** See `autonomous_loop_utils.py:1362`.
- **Keyword or substring verdicts.** See `consistency_agent.py:350`, `agent_judge.py:16` and the council containment check.
- **Similarity routing with no threshold and a self-reinforcing history.** See `agent_router.py:177-208`.
- **Requirements that exist only in prompts.** "Flag assumptions" and "approved" are asked of a model, and no code checks them.
- **Names that claim more than the code does.** "Majority vote", "dynamic", "60+" and "reward" for a keyword check all mislead a reader.

## Not read

- **Bodies only counted, not read:** `graph_workflow.py` (3,870 lines), `heavy_swarm.py` (1,577), `concurrent_workflow.py`, `sequential_workflow.py`, `round_robin.py`, `groupchat.py`, `multi_agent_router.py`, `tree_swarm.py`, `auction_swarm.py`, `social_algorithms.py`, `advisor_swarm.py`, `deep_discussion.py`, `debate_with_judge.py`, `multi_agent_debates.py`, `llm_council.py`, `hybrid_hiearchical_peer_swarm.py`, `phased_fan_out_workflow.py`, `self_moa_seq.py`.
- **Not read:** the `*_channel.py` files and `comms_channel.py`, `agent_registry.py`, `agent_loader.py`, `auto_agent_builder.py`, `i_agent.py`, `tool_manager.py`, `reasoning_agent_router.py`, `tree_of_thoughts.py`, `gkp_agent.py`, `context_compressor.py`, the body of `transforms.py`, and the body of `autonomous_loop.py` beyond tool wiring.
- **Partly read:** `conversation.py` (only as used by `context_utils.py`), `dynamic_skills_loader.py` (embedding only), `hiearchical_swarm.py` (worker creation and order validation).
- **Tests:** I read test names and a few assertions. I did not check tests for `messages_for`, the `SwarmRouter` fallback path, or council accuracy.
- **Not done:** no code or tests were run. The "s3" paper and the docs site were not checked, and I made no web requests.
