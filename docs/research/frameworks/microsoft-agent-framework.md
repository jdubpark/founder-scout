# microsoft/agent-framework: what the code does

Pinned commit `739a387ab14b` (2026-11-13). Paths are relative to the checkout `python/` tree unless stated. Nothing was run; all claims come from reading source, tests and decision records.

Findings:

1. The Magentic orchestrator is the one design worth copying. It writes facts into four labelled sections (given, to look up, to derive, educated guesses), counts stalls in code, and replans.
2. Stall detection follows the same split as Founder Scout: the model answers yes/no questions, and code counts them.
3. Its replan has a defect. `reset()` clears the transcript before the replan model runs, so the model asked "what went wrong" never sees the failed run.
4. Context is isolated per session by default. Crossing between agents needs an explicit step. Shared mutable state exists, but it is last-write-wins.
5. There are no dynamic agent pools and no self-improvement loop in the framework. Agents are built at startup, or from YAML or dicts through an experimental factory.

## Mechanisms

### M1. Magentic task ledger (topic 4)

**What it is.** A planning step in which the manager model writes a fact sheet and then a plan for the task, before any participant speaks.

**How it works.** The fact prompt asks for four headings: "1. GIVEN OR VERIFIED FACTS / 2. FACTS TO LOOK UP / 3. FACTS TO DERIVE / 4. EDUCATED GUESSES" (`orchestrations/agent_framework_orchestrations/_magentic.py:110-137`). The plan prompt follows (`:140`). Both answers are appended to the manager's history (`:661`), so later progress calls can see them:

```
magentic_context.chat_history.extend([facts_user, facts_msg, plan_user, plan_msg])
```

The facts are stored as text. Nothing parses the four sections.

**Context.** The manager sees the full chat history. Participants do not receive the ledger.

**Evidence.** `tests/test_magentic.py:349` and `:554` check that plan and replan produce the combined ledger and call the model in order. No test or measurement checks that the facts are accurate.

**Cost.** Two manager calls to plan (facts, then plan).

**Failure modes.** Guesses and verified facts are the same kind of text once rendered. The update prompt asks for revision on every replan: "please at least add or update one educated guess or hunch, and explain your reasoning" (`:171-185`). That forces output even when nothing new was learned.

**Verdict for Founder Scout: ADAPT.** Keep the four headings, but store them as typed records. Code should refuse to move an item from guess to verified unless it cites a source id that the fact-checker has accepted.

### M2. Magentic progress ledger and stall counter (topic 3, topic 4)

**What it is.** Each round, the manager answers a fixed set of questions as JSON. Code decides whether to continue, replan or finish.

**How it works.** The model is asked whether the request is satisfied, whether it is in a loop, whether progress is being made, who speaks next, and what to ask them (`:207-220`). Code then applies the counter:

```
if not self._progress_ledger.is_progress_being_made.answer or self._progress_ledger.is_in_loop.answer:
    self._magentic_context.stall_count += 1
else:
    self._magentic_context.stall_count = max(0, self._magentic_context.stall_count - 1)
...
if self._magentic_context.stall_count > self._manager.max_stall_count:
```

Source: `_magentic.py:1147-1158`. The default `max_stall_count` is 3 (`:492`), so the fourth net stall triggers a replan. The counter leaks: each progress round subtracts one, so alternating rounds never reach the limit. Malformed JSON is retried up to three times (`:606`). If every attempt fails, the run resets and replans (`:1124-1127`).

**Context.** The progress call sees the full history plus the question. Each participant sees the messages broadcast to it after every response (`_magentic.py:1016-1024`), plus the instruction string the manager wrote for it.

**Evidence.** `tests/test_magentic.py:935` (`test_magentic_stall_and_reset_reach_limits`) uses a fake manager that always reports no progress, to show the limits fire. No test checks whether a real model's yes/no answers are reliable.

**Cost.** One manager call per round, plus retries.

**Failure modes.** The model that is stuck is the same model asked whether it is stuck. A model that always answers "progress made" never replans. The round cap defaults to unlimited (`:1492`, "None means unlimited"), and so does the reset cap.

**Verdict: ADOPT** the split: model answers the booleans, code counts. Add a hard round cap and a non-leaking counter.

### M3. Magentic replan and reset (topic 3, topic 4)

**What it is.** When stalled, the orchestrator wipes participant state and the manager writes a new fact sheet and plan.

**How it works.** `_reset_and_replan` runs `self._magentic_context.reset()` (`:1203`), then calls `self._manager.replan(...)` (`:1209`). `reset()` calls `self.chat_history.clear()` (`:394`). The replan prompt asks: "Please briefly explain what went wrong on this last run (the root cause of the failure)" (`:188-190`).

Reading the order: the transcript is cleared first, so the replan model receives the task, the old fact sheet and the new prompt. It does not receive the messages that failed.

**Evidence.** `test_magentic.py:1069` checks that `reset()` leaves no duplicate messages. It does not check what the replan model is sent. No test found for the root-cause explanation.

**Cost.** Two manager calls to replan, plus a full participant restart.

**Failure modes.** The root-cause analysis is written without the evidence it describes. The reset also broadcasts a `MagenticResetSignal` to every participant (`:1206`, `:1303-1307`). What each participant keeps after that signal was not traced, so the findings already gathered may be lost too.

**Verdict: ADAPT.** Before clearing, summarise the failed run into the replan input and keep the verified facts from it. Record the failure reason as a field, not free text.

### M4. Group chat speaker selection and handoff (topic 1, topic 2)

**What it is.** Two ways to choose the next speaker: a plain function over the conversation, or a model that returns structured JSON. Handoff is a separate mode where the active agent calls a tool to pass control.

**How it works.** A selection function receives `GroupChatState` and returns a name (`orchestrations/agent_framework_orchestrations/_group_chat.py:240-260`). The agent-based orchestrator asks the model for `{terminate, reason, next_speaker, final_message}` and checks the name against the roster (`:497-530`). On a parse error it sends the error back and retries (`:553-568`).

Every participant gets every message, with `should_respond=False` (`_base_group_chat_orchestrator.py:410-438`). In handoff, `_full_conversation` keeps all messages with tool calls stripped and broadcasts them to all agents (`_handoff.py:415-457`). The handoff tool is intercepted by middleware (`:142-170`).

**Context.** Everyone sees everything. The orchestrator keeps its own thread (`_group_chat.py:513`). One call per turn, plus retries. Tests exist in `tests/test_group_chat.py` and `tests/test_handoff.py`; no measured result.

**Verdict.** ADAPT the JSON-with-validation pattern for routing. SKIP handoff, because broadcasting everything to everyone breaks the isolation Founder Scout needs.

### M5. Fan-out and sequential context modes (topic 2)

**What it is.** Concurrent runs send one prompt to all participants and aggregate. Sequential runs chain agents, each seeing what the previous one produced.

**How it works.** The concurrent dispatcher sends the same request to every participant. The default aggregator keeps only the last assistant message from each (`orchestrations/agent_framework_orchestrations/_concurrent.py:97-135`). Participants never see each other. Sequential chains use `context_mode` on `AgentExecutor` (`core/agent_framework/_workflows/_agent_executor.py:321`):

- `"full"`: the whole conversation so far.
- `"last_agent"`: only the previous reply.
- `"custom"`: a `context_filter` function applied to the conversation (`:395-420`).

**Context.** The `"custom"` mode is the only place where a function decides what crosses from one agent to the next, the deliberate step topic 2 asks for. N calls for fan-out. The default aggregator keeps only each agent's final message, so evidence ids and tool results are lost. No measured result.

**Verdict.** ADOPT fan-out with a custom aggregator that keeps evidence ids. ADAPT `context_filter` as the only way one scout's output reaches another.

### M6. Workflow superstep runtime, shared State, and checkpoints (topic 2)

**What it is.** A graph runtime. Messages sent in one step arrive in the next. Shared state is staged and committed at each step boundary. A checkpoint is written after each step.

**How it works.** `run_until_convergence` loops over supersteps (`core/agent_framework/_workflows/_runner.py:108-182`). It commits state at the boundary (`:166-167`, `_state.py:106`) and writes a checkpoint (`:173`). A checkpoint holds messages, state, pending requests and iteration count (`_checkpoint.py:86-103`). A fan-in buffers messages until every source has produced one (`_edge_runner.py:390-412`), and the buffer is saved in the checkpoint. On resume, a graph-signature hash must match (`_runner.py:320`).

`State.set` writes to a pending buffer, and when two executors write the same key in one step, the last write wins (`_state.py:32-41`).

**Evidence.** Checkpoint round-trip tests in `tests/test_magentic.py:467`, `:816` and `:843`. Concurrent writes to shared state drop silently. Editing the graph strands existing checkpoints, because the signature no longer matches.

**Verdict.** ADAPT the commit-at-boundary and checkpoint-per-step design for the daily run, so a crash mid-run can resume. SKIP shared `State` as the pool mechanism.

### M7. Request and response for human input (topic 3, topic 4)

**What it is.** A workflow pauses, emits a request, and resumes when a response handler receives an answer.

**How it works.** `RequestInfoMixin` and `@response_handler` route responses to the paused executor (`core/agent_framework/_workflows/_request_info_mixin.py:115-212`). Magentic uses this for plan review. After a stall-triggered replan, when `_require_plan_signoff` is set, the orchestrator sends a `MagenticPlanReviewRequest` carrying the plan and `is_stalled` (`orchestrations/agent_framework_orchestrations/_magentic.py:868-895`, `:1221`). The reviewer can approve or revise with feedback (`:839-865`). Pending requests are saved in the checkpoint (`core/agent_framework/_workflows/_checkpoint.py:96`).

**Evidence.** `tests/test_magentic.py:364` (approval resumes to completion) and `:391` (revise). The run stays paused until someone answers.

**Verdict: ADOPT** for the partner's Yes/No. The stalled-plan review is the natural place for the partner to steer, and it fits the rule that outreach is only ever proposed.

### M8. Agents as tools and background agents (topic 1)

**What it is.** An agent exposed as one function, or a parent agent that starts child tasks and collects results.

**How it works.** `Agent.as_tool` builds a function whose only argument is the task string (`core/agent_framework/_agents.py:664-680`), and `propagate_session` defaults to `False`. `BackgroundAgentsProvider` takes a fixed list of agents in its constructor (`core/agent_framework/_harness/_background_agents.py:386-393`). The parent can start, wait for, continue and clear tasks (`:574-777`), each in its own session. The child sees only the string the parent wrote.

**Verdict.** SKIP for dynamic creation, since the roster is fixed. ADAPT the start, wait and collect pattern for the investigator fan-out.

### M9. Declarative agents and workflows from data (topic 1)

**What it is.** Agents and workflows defined as YAML or dicts, built at run time.

**How it works.** `AgentFactory.create_agent_from_yaml`, `create_agent_from_dict` and their async versions build an `Agent` (`python/packages/declarative/agent_framework_declarative/_loader.py:287-545`). `WorkflowFactory.create_workflow_from_definition` builds a `Workflow`, and each YAML action becomes an executor (`_workflows/_factory.py:44-50`, `:330`). The package header marks the agent loading path as experimental (`__init__.py`, docstring).

**Evidence.** None measured. Nothing manages a pool: no sizing, routing or retirement. The schema is experimental and may change.

**Verdict: ADAPT.** Store each scout's definition (instructions, tools, model) as data and build it at run time, with a validator in code. Build the pool logic yourself.

### M10. Context scoping: sessions, file memory, mem0 and Redis (topic 2)

**What it is.** Per-session history and memory, with providers that inject context before a run and store after it.

**How it works.** Each `AgentSession` holds its own state. History is a `HistoryProvider` (`core/agent_framework/_sessions.py:996`). `FileMemoryProvider` isolates memory per session by default (`_harness/_file_memory.py`, module docstring). ADR 0035 (status accepted) partitions stored sessions by path: `{root}/a-{agent}/u-{user}/c-{context}.json`, with a path-traversal guard (`docs/decisions/0035-hosted-per-user-session-storage-isolation.md`).

mem0 separates the storage scope from the retrieval scope. Memories are written with `application_id`, `agent_id` and `user_id`, and retrieval uses `search_*` values that never inherit from storage: "If no `search_*` value is configured, no memories are retrieved" (`python/packages/mem0/agent_framework_mem0/_context_provider.py:44-56`).

Redis does the opposite. Its docstring says: "Omitted identifiers do not constrain retrieval" (`python/packages/redis/agent_framework_redis/_context_provider.py:92-98`). Leaving out `user_id` widens the search to every user.

**Evidence.** None measured. The Redis rule fails open. ADR 0045 (shared session store) is still "proposed", so cross-agent storage is not settled.

**Verdict: ADOPT** mem0's split between storage scope and retrieval scope. ADAPT ADR 0035's per-pool path layout. Make retrieval fail closed when the scope is empty.

### M11. Compaction and summarisation (topic 2)

**What it is.** Strategies that shorten long histories: truncation, tool-result trimming, and LLM summaries.

**How it works.** `core/agent_framework/_compaction.py` has about a dozen strategies. `SummarizationStrategy` (`:2315`) calls a model and writes the result into history as a normal assistant message. Its docstring says the output "permanently becomes part of chat history" and warns of "a form of indirect prompt injection that survives beyond the turn in which it was introduced" (`:2325-2336`). `AgentTriggeredCompactionStrategy` (`:1345`) lets the agent call `compact_context`, and it only works with client-managed history.

**Evidence.** Tests exist. No measured quality result. One model call per summary.

**Verdict: ADAPT, for long runs only.** Trim tool results first (`ToolResultCompactionStrategy`, `:1950`). If summarising, keep source ids and treat summary text as untrusted.

### M12. Skills with progressive disclosure (topic 1)

**What it is.** Capability instructions stored as skill files and loaded on demand.

**How it works.** Names and descriptions go into the system prompt. The body loads through a `load_skill` tool, and resources through `read_skill_resource` (`core/agent_framework/_skills.py:16-22`). ADR 0030 is "proposed". The model must choose to load a skill, or it works without the instructions.

**Verdict: ADAPT.** Put playbooks per source type into skill files loaded per job, rather than repeating them in every prompt.

### M13. Security labels, quarantine and variable indirection (safety)

**What it is.** Information-flow control: each piece of content carries integrity and confidentiality labels. Untrusted content is stored in a variable, and a quarantined model without tools reads it.

**How it works.** `core/agent_framework/security.py` (6,244 lines) defines `IntegrityLabel` (`:335`), `ContentVariableStore` (`:717`), the `quarantined_llm` and `inspect_variable` tools (`:100-101`), `LabelTrackingFunctionMiddleware` (`:2089`) and `PolicyEnforcementFunctionMiddleware` (`:3552`). Its test file is 11,741 lines.

ADR 0024 is still marked "proposed" (line 2). The code is shipped in the package, so the record and the code disagree.

**Evidence.** Unit tests only. No benchmark against prompt injection was found. One extra model call per untrusted item.

**Verdict: ADAPT the idea.** Store fetched page text as a variable, read it only in a model without tools, and return a labelled result. This still needs Founder Scout's own quote-check, because the quarantined reader can paraphrase.

### M14. AgentLoopMiddleware: bounded retries with a feedback log (topic 3)

**What it is.** Re-runs an agent while a predicate says to continue, with a feedback log.

**How it works.** `core/agent_framework/_harness/_loop.py` re-invokes the agent while `should_continue` holds. `DEFAULT_MAX_ITERATIONS = 10` (`:126`). Up to ten full runs by default. No measured result.

**Verdict: ADOPT** the default cap and the feedback log for scout retries.

### M15. Learning and evaluation (topic 3)

**What it is.** The framework has evaluation tools and no self-improvement loop of its own.

**How it works.** `core/agent_framework/_evaluation.py` provides evaluators, `EvalResults` (`:378`) and assertions such as `assert_score_at_least` (`:507`). It runs checks. It does not propose changes, keep or reject them, or hold out cases. A search of the Python packages for optimise, tune, learn, lightning and reflection found only two things: a tracer in `lab/lightning/agent_framework_lab_lightning/__init__.py:22-35`, and a sample that uses Agent Lightning's external `Trainer` with VERL for reinforcement learning (`lab/lightning/samples/train_math_agent.py`).

The README reports two runs with Qwen2.5-1.5B-Instruct and GRPO. Validation accuracy rose from 10% to 35% over the first 8 steps, "then begins to overfit" (`lab/lightning/README.md:102`). A second run went from 28% to 40% over 8 epochs (`:138`).

**Evidence.** These README figures are the only measured learning numbers. They were not rerun here.

**Cost.** Not applicable to Founder Scout's loop.

**Failure modes.** Overfitting appears within 8 steps in the README's own run, which supports holding out cases.

**Verdict: SKIP** the loop. Use the README's overfitting note as support for keeping `decideCandidate`'s held-out guard.

## Topic answers

**1. Dynamic agent pools.** Nothing in the framework creates, sizes, routes or retires agents at run time. Rosters are fixed when the workflow or provider is built (M4, M8). The closest tools are declarative factories (M9) and the validated speaker selection (M4). Building the pool means writing the sizing, routing and retirement yourself, on top of M9.

**2. Context pools.** Isolation is the default: each session has its own history and file memory (M10). Crossing happens only through a `context_filter` (M5) or a scoped retrieval (M10). Shared `State` (M6) is the one shared mutable place, and it is last-write-wins. For Founder Scout, combine ADR 0035's per-pool path layout with mem0's split of storage and retrieval scope.

**3. Self-evolution.** The framework has none. Magentic's replan (M3) changes the plan after a failure, but only within one run, and nothing checks the new plan before it is used. The only learning loop is an external RL sample (M15).

**4. Objective assumptions.** The Magentic ledgers are the best published design here (M1-M3). They separate given facts, facts to look up, facts to derive and guesses, and they force revision. The gaps: no step checks a guess against evidence, and replan clears the evidence it would need to revise from. Founder Scout should keep the representation and add the checking.

## Claims the code does not back

| Claim or expectation | Where | What the code does |
|---|---|---|
| Replan explains "what went wrong on this last run" | `_magentic.py:188-190` | The transcript is cleared before replan runs (`:1203`, `:1209`). The model has no run to explain. |
| Security module defends against prompt injection | `security.py:1-10`, ADR 0024 | Code is in the package, but ADR 0024 status is "proposed". No injection benchmark found. |
| Shared session store isolates agents | ADR 0045 | Status "proposed". Not a shipped guarantee. |

## Five ideas worth taking, ranked

1. **Typed ledger with promotion rules.** Four lists per task: given, to look up, to derive, guesses. Each item has a source id and a status. Code blocks promotion from guess to verified without an accepted source. Smallest version: one JSON record per scout task, the four headings from `_magentic.py:110-137`, and one validator function.
2. **Stall counter in code with a hard cap.** Model answers booleans, code counts them, and the counter does not leak (M2). Smallest version: a 30-line function, a round cap near 10, and a reset that keeps a summary of the failed run (M3).
3. **Split scopes for memory.** Each record has storage scope. Retrieval needs an explicit scope and returns nothing if it is empty (M10, mem0 rule with the Redis failure avoided). Smallest version: a `scope` dict on each record, and a query function that raises on an empty scope.
4. **Fan-out investigators with a custom aggregator.** Run the sources in parallel, aggregate by keeping evidence ids (M5). The only hand-off between scouts is a `context_filter` function. Smallest version: one aggregator function that returns a list of evidence records.
5. **Partner-gated replan.** When the stall counter fires, write a proposal row and wait for Yes or No before the next round (M7). Smallest version: a status field on the job record, checked before the run continues.

## What to avoid

- Shared mutable state across agents with last-write-wins (M6).
- Broadcasting every message to every agent (M4).
- Unlimited rounds and resets as defaults (`_magentic.py:1492`).
- Summaries written back as trusted assistant messages (M11).
- Retrieval that widens when a scope field is omitted (M10, Redis).
- Taking an ADR status or module docstring as proof of shipped behaviour.

## Not read

`dotnet/src`; most of `_sessions.py`, `_middleware.py`, `_agent_hooks.py`, `_vectors.py` and `_harness/_tool_approval.py` (headers and named classes only); the bodies of the mem0 and redis packages; ADRs 0006, 0015, 0023 and 0033 beyond status; `lab/gaia`, `lab/tau2`; `python/samples/`; `declarative-agents/` and `skills/` (untrusted, not followed). The Magentic-One paper (arXiv 2411.04468) was not checked, so no paper numbers appear here. No tests were run, as instructed.
