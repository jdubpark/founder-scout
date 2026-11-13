# ruvnet/ruflo: what the code does

Checkout pinned at `002d8c1` (2026-11-12). Read with Read, Grep and shell search only. Nothing from the checkout was executed. Paths are relative to the checkout unless marked otherwise.

- **The agent layer is bookkeeping.** Pool "agents" are records with a status field. No model SDK call exists in `swarm`, `memory`, `neural` or `guidance` source. Work happens in external agents that report back with a `task_complete` message (`v3/@claude-flow/swarm/src/unified-coordinator.ts:916`).
- **The learning claims stop short of changing behavior.** SONA accumulates gradients into a buffer that nothing reads, and its "improvement" is average quality minus a constant 0.5.
- **The self-evolution gate is sound, but nothing generates candidates.** The replay gate in `guidance/src/evolution.ts` compares decisions on golden traces. The optimizer's "A/B test" applies fixed multipliers.
- **Most governance modules have no caller.** Truth anchors, uncertainty, meta-governance, the continue gate and the adversarial quorum are referenced only by their own file and the package index.
- **Real and worth reading:** namespace-keyed memory, a retrieval guard against poisoned memory (opt-in), memory dedupe, and the Darwin loop, whose metric is measured nDCG on BEIR data.

## Mechanisms

### 1. Agent pool and autoscaling

**What it is.** A per-type pool that grows and shrinks between `minSize` and `maxSize` on a utilization ratio, with a cooldown. Its members are `AgentState` records.

**How it works.** Scale-up creates records only:
```ts
this.agentCounter++;
const agentId = `${this.config.name}_agent_${this.agentCounter}`;
```
(`v3/@claude-flow/swarm/src/agent-pool.ts:317-318`; the record is built and stored at 320-347.) Scale-down removes least-recently-used idle records (243-250). Defaults are at 41-45. Domain pools never resize (389-395).

**Status: PARTIAL.** The sizing logic runs. The agents do not do work.

**Sees and crosses:** a status and capability object. Nothing crosses between pools.

**Evidence it helps:** none found.

**Verdict for Founder Scout: ADAPT.** Keep the cooldown and the fixed-roster guard around your own dispatch. Do not model a pool member as a unit of work that has not run.

### 2. Queen scoring and delegation

**What it is.** A coordinator that scores each idle agent for a task and hands the task to the best one.

**How it works.** The score is a weighted sum with hand-set weights:
```ts
const totalScore =
  capabilityScore * 0.30 +
  loadScore * 0.20 +
  performanceScore * 0.25 +
  healthScore * 0.15 +
  availabilityScore * 0.10;
```
(`v3/@claude-flow/swarm/src/queen-coordinator.ts:1206-1211`.) The capability score starts at 0.5 and adds a type match (1226-1240). Delegation is an assignment call plus a broadcast message (1390-1404).

**Status: PARTIAL.** The weights are constants and nothing fits them to outcomes.

**Sees and crosses:** the task definition, agent state and matched patterns from past outcomes. Delegation messages go to everyone on the bus.

**Evidence it helps:** none found.

**Verdict: SKIP** the weights. Log the component scores with each decision if you want the eval loop to fit them later.

### 3. Consensus engine

**What it is.** Raft, Byzantine and gossip protocols behind a `proposeConsensus` call, with majority, supermajority and weighted tallies in the queen.

**How it works.** The protocol code is real, but it runs over an in-process registry (`v3/@claude-flow/swarm/src/consensus/transport.ts:256-264`). In gossip, the proposer approves its own proposal:
```ts
// Auto-vote (simplified)
if (node.id === this.node.id) {
  await this.vote(proposalId, { voterId: this.node.id, approve: true, confidence: 0.9, ... });
```
(`consensus/gossip.ts:471-473`.) Nothing in the checkout casts votes from model-backed agents. The majority path uses threshold 0.51 (`queen-coordinator.ts:1782-1791`).

**Status: PARTIAL.** Working protocols with no real voters.

**Sees and crosses:** a proposal value and weights. Votes cross on the in-process bus.

**Evidence it helps:** none found.

**Verdict: SKIP.** A single process does not need consensus. Multi-judge voting is a separate idea, and this code does not show it working.

### 4. Outcome learning inside the queen

**What it is.** After each task, the queen stores a trajectory with a reward and a memory entry, so later routing can see past outcomes.

**How it works.** The reward mixes success and quality:
```ts
const reward = result.success
  ? result.metrics.qualityScore * 0.8 + 0.2
  : result.metrics.qualityScore * 0.3;
```
(`queen-coordinator.ts:1892-1894`.) The task embedding is a character-hash bag (`createSimpleEmbedding`, 1019-1031). The code comment at 1021 says production embeddings should come from `agentic-flow`. The memory entry goes to namespace `queen-outcomes` (1907-1914).

**Status: PARTIAL.** Records are written and read back into scoring. No parameter is updated from them.

**Sees and crosses:** the task description and outcome. Past outcomes appear to reach scoring through matched patterns (`queen-coordinator.ts:982`), which I did not read in full.

**Evidence it helps:** none found.

**Verdict: ADAPT.** Keep the outcome record shape (task, domain, success, quality, agent id). Do not use hash embeddings for retrieval.

### 5. SONA trajectory learning and LoRA

**What it is.** A manager that records trajectories, runs a "learning" step over high-quality ones, and applies LoRA adapters at inference.

**How it works.** Gradients accumulate into `gradientAccumulator` (`neural/src/modes/balanced.ts:146-153`, 274). Nothing copies that accumulator into the LoRA matrices. The only writes to `loraWeights.A` and `.B` are at initialization (`neural/src/sona-manager.ts:540-541`). The reported improvement is a constant baseline subtracted from quality:
```ts
const baselineQuality = 0.5;
const improvementDelta = avgGoodQuality - baselineQuality;
```
(`neural/src/modes/balanced.ts:163-164`.) `applyAdaptations` has no caller outside `neural` (`sona-manager.ts:470`).

**Status: STUB in effect.** The arithmetic runs, but the learned state has no path to any output.

**Sees and crosses:** trajectory embeddings. Nothing crosses to agents.

**Evidence it helps:** none found.

**Verdict: SKIP.** Do not cite SONA as learning in any description of this system.

### 6. Mixture-of-experts router

**What it is.** A small softmax gate over experts with a REINFORCE update from a reward signal and a load-balance term.

**How it works.** `updateExpertWeights` implements a real policy-gradient step on cached logits (`neural/src/moe-router.ts:489-605`). The load-balance gradient was added after review. The file's own comment says the earlier version "was never fed back into a weight update" (536-537). Nothing in `swarm`, `memory` or `guidance` calls `updateExpertWeights` or `createMoERouter`.

**Status: WORKING math, UNWIRED.** The update is correct for its inputs. No live routing uses it.

**Sees and crosses:** the input embedding and a reward. Nothing crosses.

**Evidence it helps:** none found.

**Verdict: SKIP** for now. If you need learned routing later, this is a usable reference for the update rule.

### 7. ReasoningBank judge and distillation

**What it is.** Stores trajectories, judges them, and distills successful ones into reusable patterns.

**How it works.** The file header describes the judge as "LLM-as-judge" (`neural/src/reasoning-bank.ts:6`). The code does this instead:
```ts
const success = trajectory.qualityScore >= this.config.distillationThreshold &&
  stepAnalysis.positiveRatio > 0.6;
```
(`reasoning-bank.ts:414-415`.) The method's docstring says "In production, this could be enhanced with LLM-as-judge" (398).

**Status: PARTIAL.** A rule-based verdict and a consolidation step that averages quality.

**Sees and crosses:** trajectory steps. Patterns cross to later retrieval.

**Evidence it helps:** none found.

**Verdict: SKIP** the claim. The threshold verdict is a fair pre-filter if you need a cheap first pass.

### 8. Memory namespace isolation

**What it is.** A memory key is the pair (namespace, key), encoded into one index key.

**How it works.** `encodeMemoryKey(namespace, key)` builds the index key (`v3/@claude-flow/memory/src/agentdb-adapter.ts:188-189`). Lookups use the same encoding (279-280). A namespace is a string prefix, not a permission. Any caller can name any namespace.

**Status: WORKING** as partitioning. It is not access control.

**Sees and crosses:** a namespace string chosen by the caller. Cross-namespace reads are allowed by default.

**Evidence it helps:** a key-isolation test exists (`agentdb-adapter-key-isolation.test.ts`). I did not read it.

**Verdict: ADAPT.** Use it for pool partitioning, and add the check that a namespace belongs to the calling pool.

### 9. Retrieval guard

**What it is.** A wrapper that screens AgentDB retrieval results for injection patterns before they enter an agent's context.

**How it works.** It delegates pattern detection to a `ToolOutputGuardrail` from `@claude-flow/security`, and adds a size gate and per-chunk annotation (`v3/@claude-flow/memory/src/agentdb-retrieval-guard.ts:1-25`).

**Status: WORKING, OFF BY DEFAULT.** The header says: "Off by default: set `CLAUDE_FLOW_RETRIEVAL_GUARD=true` to enable" (line 16).

**Sees and crosses:** retrieved chunks, before assembly. Flagged chunks are annotated, or dropped in strict mode.

**Evidence it helps:** a test file exists. The header cites an external paper for the 93 to 100 percent undefended attack rate. I did not check that paper.

**Verdict: ADAPT, and default it on.** Founder Scout retrieves untrusted pages into prompts, so this is the most relevant guard in the checkout.

### 10. Memory consolidator

**What it is.** Deduplicates memory entries by exact key match and by cosine similarity above a threshold.

**How it works.** The default similarity floor is 0.95 (`v3/@claude-flow/memory/src/consolidator.ts:41-48`). The pass runs to a fixed point (283-285). Duplicates are merged with a keep-newest, keep-oldest or merge-tags strategy (33).

**Status: WORKING.** A deterministic dedupe.

**Sees and crosses:** stored entries. Nothing crosses to agents.

**Evidence it helps:** a consolidator test and an embedding benchmark exist. I did not read the benchmark.

**Verdict: ADAPT.** Use the dedupe step on the evidence store. Do not call it learning.

### 11. Evolution replay gate

**What it is.** A pipeline that proposes a change, replays golden traces under baseline and candidate, and stages or rolls back the change.

**How it works.** `simulate` runs an evaluator over every trace under both configs (`v3/@claude-flow/guidance/src/evolution.ts:325-326`). It collects decision diffs per trace and sequence position (327-345). It passes when divergence is within `maxDivergence` (366).

**Status: WORKING gate, NO GENERATOR.** The caller writes the candidate and the evaluator. The checkout contains no caller of `EvolutionPipeline.propose`.

**Sees and crosses:** the golden traces and the evaluator's outputs.

**Evidence it helps:** none beyond unit tests.

**Verdict: ADAPT.** The decision-diff report is the useful part. Put the flipped decisions in front of the reviewer, next to your existing `decideCandidate` gate.

### 12. Optimizer loop

**What it is.** A weekly loop that ranks violations, proposes one rule change each, runs an "A/B test" and promotes local rules that win twice.

**How it works.** The file header says the loop runs "the fixed task suite with and without the change." The code does not. The candidate metrics come from fixed multipliers per change type:
```ts
violationReduction = affectedRatio * 0.4;
reworkReduction = change.triggeringViolation.cost * 0.3;
```
(`v3/@claude-flow/guidance/src/optimizer.ts:302-303`; the 0.6 and 0.8 cases are at 307-313.) The docstring at 280-281 says it "does NOT run a real A/B test against live traffic."

**Status: STUB.** The promotion decision reads numbers the code assigned.

**Sees and crosses:** the violation ledger. Promoted rules cross into the root policy.

**Evidence it helps:** none. The code says the estimates are "not measured values."

**Verdict: SKIP.** Do not copy the promotion rule.

### 13. Truth anchors and other governance modules

**What it is.** Signed facts that override model beliefs (`truth-anchors.ts`), uncertainty ledgers, meta-governance over amendments, a continue gate for long runs, and an adversarial quorum for memory writes.

**How it works.** Truth anchors use HMAC-SHA256 with a symmetric key held in the same store (`truth-anchors.ts:15`), defaulting to an empty string (`truth-anchors.ts:148`). The proof chain refuses to run without a key (`proof.ts:136`). `UncertaintyLedger`, `MetaGovernance`, `ContinueGate` and `MemoryQuorum` have no non-test references outside their own files and the package index (grep over `v3` and `plugins`).

**Status: UNWIRED.** The code exists and is not on any path an agent takes.

**Sees and crosses:** nothing at runtime.

**Evidence it helps:** none found.

**Verdict: SKIP** as a mechanism. Two ideas are worth a note: a fact store whose entries carry a source and a signature, and an explicit key requirement like the one in `proof.ts`.

### 14. Darwin capability loop

**What it is.** A recurring loop in which a headless `claude -p` run reads a log, picks the weakest benchmark dimension, makes one change, and keeps it only if the score rises (`docs/darwin/PLAN.md`).

**How it works.** The loop is prompt-driven. The decision is a measured score. The log records real figures with four-decimal nDCG values, for example `ndcg10: 0.35171471732484655` with `action: "advance"` (`docs/benchmarks/darwin-runs.jsonl`, first line). Logged gains are small, for example +0.0028 and +0.0046 on NFCorpus. The log gives no confidence interval or noise estimate.

**Status: PROMPT-ONLY loop over WORKING measurement.** The measurement is real. The change proposer is a model acting under a contract.

**Sees and crosses:** the log and the benchmark results. Kept changes become commits.

**Evidence it helps:** the measured nDCG deltas, which are small and unestimated.

**Verdict: ADAPT.** Keep the change log format: dimension, change, measured before and after, action, commit. Do not run the loop unattended on a metric without a noise floor.

## Topic answers

**1. Dynamic agent pools.** Sizing rules exist (`agent-pool.ts:201-256`, 389-412), but pool members are records. Nothing in the checkout creates, routes or retires an agent that performs model work. The closest working part is cooldown plus fixed-roster protection. Build your own dispatch and copy the sizing guard.

**2. Context pools.** The checkout partitions by namespace string (`agentdb-adapter.ts:188-189`), and it has an opt-in guard for retrieved content (`agentdb-retrieval-guard.ts:16`). It has no explicit hand-off step. Queen outcomes go to a shared namespace (`queen-coordinator.ts:1914`). The isolate-by-default, cross-by-explicit-step design you want is not built here. It is sketched in the namespace key and the agent-memory scope bridge.

**3. Self-evolution.** The replay gate with decision diffs (`evolution.ts:312-366`) is the sound piece. Everything that changes behavior either has no effect (SONA, `balanced.ts:163-164`), has no caller (MoE), or uses fixed numbers (optimizer, `optimizer.ts:302-313`). The Darwin loop changes retrieval code and keeps changes on measured nDCG. It is the only loop here that closes on a real metric, and its gains have no noise estimate.

**4. Objective assumptions.** No mechanism represents the goal explicitly or revises assumptions. The nearest pieces, truth anchors and the uncertainty ledger, are unwired. The `ruflo-goals` plugin adds only a tighten-only guard and a status file (`plugins/ruflo-goals/hooks/register.ts:52-60`). Treat this topic as unanswered by the checkout.

## Claims the code does not back

| Claim | Where made | What the code shows | Evidence |
|---|---|---|---|
| "Intelligent routing (89% accuracy)" | `README.md:446` | No accuracy measurement or data file in the repo. The only matches for "89%" are the README and its Chinese translation. Routing weights are constants. | `v3/@claude-flow/swarm/src/queen-coordinator.ts:1206-1211` |
| "SONA self-learning with pattern matching" | `README.md:445` | Gradients never reach the LoRA matrices. The learned delta is quality minus 0.5. | `v3/@claude-flow/neural/src/modes/balanced.ts:163-164`; `sona-manager.ts:540-541` |
| "Queen-led hierarchy (Raft, Byzantine, Gossip)" | `README.md:443` | Protocols exist but run in process. The proposer auto-approves its own gossip proposal. | `consensus/transport.ts:256-264`; `consensus/gossip.ts:471-473` |
| "LLM-as-judge trajectory evaluation" | `reasoning-bank.ts:6` | The judge is a threshold rule. The docstring says LLM judging is a future enhancement. | `reasoning-bank.ts:398`, `414-415` |
| "Measured ~1.9x faster at N=20k" (HNSW) | `README.md:366` | The phrase appears in prose files only (README, CLAUDE.md, plugin READMEs). No raw data file with that figure was found. | grep over `docs/benchmarks` and `v3` |
| Multi-agent pass rates per topology | `docs/benchmarks/multi-agent/multiagent-mock-*.json` | The file says `"backend": "mock"`. Pass rates are constants in the script, sampled with a seeded RNG. The real backend exits with code 2. | `scripts/benchmark-multiagent.mjs:78`, `195`, `220-226` |
| Optimizer "runs the fixed task suite with and without the change" | `optimizer.ts` header | Candidate metrics come from fixed multipliers. | `optimizer.ts:280-281`, `302-313` |
| Truth anchors are "externally signed" | `truth-anchors.ts:9` | HMAC with a local symmetric key; the default key is empty; no caller outside the file. | `truth-anchors.ts:148` |
| Retrieval guard protects agent context | `agentdb-retrieval-guard.ts:1-25` | Opt-in only; off unless an environment variable is set. | `agentdb-retrieval-guard.ts:16` |
| Swarm of agents with "queen" coordination | `README.md:465` (architecture diagram) | No model call in `swarm`; the queen assigns records and reads messages. | `agent-pool.ts:312-350` |
| "Ruflo wins cold start ... by 1.3x to 1953x" | `README.md:496` | Points to an external gist. Not in the repo; not checked. | none |

## Five ideas worth taking, ranked

1. **Decision-diff report on replay.** The smallest version: for each frozen case, record the old and new decision, and list every flip for the reviewer, next to the existing `decideCandidate` gate. The idea is in `evolution.ts:330-345`. Ruflo has the gate but no generator, so this is a sketch of their design, not a working system.

2. **Screen evidence before it reaches a prompt, on by default.** The smallest version: run the injection-pattern check on every evidence chunk before it enters an analyst prompt, and annotate or drop flagged chunks. This is `agentdb-retrieval-guard.ts`, with the default flipped. It matters more for Founder Scout than for Ruflo, because Founder Scout reads untrusted pages.

3. **A dated, measured change log.** The smallest version: one JSON line per change with the dimension, the change, the measured score before and after, the decision, and the commit. Use the format in `docs/darwin/log.jsonl`. Ruflo logs its numbers but does not estimate noise, so add a noise floor from your held-out repeats before a gain counts.

4. **Context pools with an explicit hand-off.** Ruflo does not build this. Partition evidence by pool key, and add one function, `promote(item, fromPool, toPool, reason)`, that logs every cross. The namespace encoding (`agentdb-adapter.ts:188-189`) is the starting point. Treat this as a sketch.

5. **Log routing features with each decision.** Ruflo computes five component scores per agent (`queen-coordinator.ts:1190-1211`) and fits none of them. Log the components with each dispatch and its outcome, so the eval loop can fit weights later. Treat this as a sketch.

## What to avoid

- **Fixed-multiplier "A/B tests"** (`optimizer.ts:302-313`). A candidate scored by constants cannot show improvement.
- **Self-approving consensus** (`consensus/gossip.ts:471-473`). A quorum where the proposer votes for itself is not a quorum.
- **Learning claims without a write path** (`sona-manager.ts`, `balanced.ts:163-164`). Check that a learned value reaches the output before you call it learning.
- **Mock benchmarks reported as results** (`scripts/benchmark-multiagent.mjs`). Name the backend in every summary.
- **Governance modules that nothing calls.** Each one adds maintenance cost and a false sense of coverage.
- **Empty defaults for signing keys** (`truth-anchors.ts:148`). Refuse to run without a key, as `proof.ts:136` does.
- **Security features off by default** (`agentdb-retrieval-guard.ts:16`). Default them on and make the opt-out explicit.

## Not read

- `swarm/src`: `federation-hub.ts`, `message-bus.ts`, `attention-coordinator.ts`, `topology-manager.ts` (random-peer lines only), `coordination/`, `workers/`.
- `memory/src`: `controller-registry.ts`, `hnsw-index.ts`, `auto-memory-bridge.ts`, `learning-bridge.ts`, `smart-retrieval.ts`.
- `neural/src`: `pattern-learner.ts`, `reasoningbank-adapter.ts`, `sona-integration.ts`, `flash-attention.ts`.
- `guidance/src`: `analyzer.ts` (3,260 lines), `ledger.ts` evaluator bodies, `compiler.ts`, `retriever.ts` (scoring loop only), `trust.ts`, `authority.ts`, `generators.ts`.
- `hooks/src` (file list only), `v3/@claude-flow/cli` (the MCP tool implementations, where most of the 323 tools live), and the Rust crates.
- `plugins/`: `ruflo-arena`, `ruflo-cost-tracker`, `ruflo-daa`, `ruflo-swarm`, `ruflo-loop-workers` and `ruflo-intelligence` were checked by README and file list only.
- `docs/`: `reviews/`, `validation/`, `darwin-core/`, most `docs/benchmarks/runs/*.json`, and `verification/` beyond the folder listing.

Nothing was run, so every behavior claim here comes from reading code. Runtime behavior, test results and the non-mock benchmark numbers are unverified.
