# What the evidence says about systems of several agents

Research date: 2026-11-13. Every number below comes from a source I opened (arXiv abstract page, vendor post, or official docs) unless it is marked as coming from a search snippet. Source IDs in brackets point to the list at the end.

## Findings that matter most

1. **More agents help only when the task splits into independent parts.** On 260 configurations across six benchmarks, relative change against a single agent ranged from +80.8% on decomposable financial reasoning to -70.0% on sequential planning [S1].
2. **Multi-agent runs spend far more tokens, and tokens explain most of the gain.** Anthropic's multi-agent research system used about 15x the tokens of a chat, and token use alone explained 80% of the variance in its BrowseComp results [S3].
3. **Independent agents amplify errors; a central checker contains them.** Independent systems amplified trace-level errors 17.2x, and centralized coordination held this to 4.4x [S1].
4. **Tool-heavy tasks pay a coordination tax.** The scaling study found a significant negative coefficient for tool-heavy tasks (beta = -0.096, p = 0.002) [S1]. Most coding tasks have few truly parallel parts [S3].
5. **Majority voting gets most of the debate gain.** Across seven NLP benchmarks, majority voting alone accounts for most of the performance gain credited to multi-agent debate, and debate alone does not raise expected correctness [S10].
6. **One strong model can beat a mix of models.** Self-MoA, which aggregates outputs from the single best model, beat standard Mixture-of-Agents by 6.6% on AlpacaEval 2.0 and by 3.8% on average across MMLU, CRUX and MATH [S8].
7. **Measured self-improvement works on fixed benchmarks with an objective scorer, and the gains are narrow.** The Darwin Godel Machine raised SWE-bench from 20.0% to 50.0%, and GEPA beat GRPO by 6% on average using up to 35x fewer rollouts [S14, S15]. Both report on coding or reasoning tasks, and I found no overfitting measurement on a split the optimizer never saw.
8. **Context should be a curated, growing record, not a repeatedly rewritten summary.** ACE reports +10.6% on agent benchmarks and +8.6% on finance by avoiding "context collapse", where repeated rewriting erodes detail [S18]. Mem0 reports saving more than 90% of token cost against full-context memory, with a 26% relative gain in judged quality over OpenAI's memory feature [S19].

---

## 1. When do more agents help, and when do they hurt?

| Source | What was tested | Result | Conditions | Held-out? |
|---|---|---|---|---|
| [S1] Kim et al., Towards a Science of Scaling Agent Systems (arXiv 2512.08296, Dec 2025, v3 Apr 2026) | 260 configurations, six agentic benchmarks, five architectures (single, plus independent, centralized, decentralized, hybrid), three LLM families, tools and prompts held fixed | Relative change vs single agent: +80.8% (decomposable finance) to -70.0% (sequential planning). Regression R2 = 0.373 (0.413 with a capability metric). Predicts best architecture for 87% of held-out configurations | Diminishing returns once single-agent baseline is strong; tool-heavy tasks pay overhead; no central verification propagates errors | Yes, for the 87% figure |
| [S2] Cemri et al., Why Do Multi-Agent LLM Systems Fail? (arXiv 2503.13657, v3 Oct 2025) | 1,600+ annotated traces from 7 frameworks; 14 failure modes in 3 groups | Motivating claim: gains over single agents on popular benchmarks are often minimal. Annotator agreement kappa = 0.88 for humans. LLM-as-judge annotator reported as highly agreeing with humans (no figure read) | Failures cluster in system design, inter-agent misalignment, and task verification | Not a performance test |
| [S3] Anthropic, How we built our multi-agent research system (2025) | Lead Opus 4 with Sonnet 4 subagents vs single Opus 4 on an internal research eval | +90.2% on internal eval. About 4x tokens for agents vs chat, 15x for multi-agent. Token use explains 80% of variance on BrowseComp; tokens, tool calls and model choice explain 95% | Breadth-first queries; poor fit where agents share context or have many dependencies | No; internal eval |
| [S6] Yan, Don't Build Multi-Agents, Cognition (2025) | Worked example, no benchmark | Parallel subagents built a Mario-style background and a bird that did not match it, for a Flappy Bird clone | Tasks whose parts need the same decisions | No; argument from examples |
| [S8] Li et al., Rethinking Mixture-of-Agents (arXiv 2502.00674, Feb 2025) | Self-MoA (top single model, aggregated) vs MoA with mixed models | +6.6% over MoA on AlpacaEval 2.0; +3.8% average over MMLU, CRUX, MATH. Mixing lowers average output quality | Many scenarios, not all; the authors name settings where mixing helps | Benchmarks, not a split |
| [S9] Wang et al., Mixture-of-Agents (arXiv 2406.04692, 2024) | Mixture-of-Agents using only open-source models | 65.1% vs 57.5% for GPT-4 Omni on AlpacaEval 2.0 | Authors' own setup | Benchmark |
| [S10] Choi, Zhu, Li, Debate or Vote (arXiv 2508.17536, NeurIPS 2025 Spotlight) | Majority voting vs debate, seven NLP benchmarks | Majority voting accounts for most of debate's gain; debate is a martingale on belief, so it does not raise expected correctness alone | Corrective bias in belief updates recovers some gain | Benchmarks |

**What follows.** The scaling study is the most careful source here. Its headline is not "more agents" or "fewer agents" but "match the architecture to the task": parallel, decomposable work gains, and sequential or tool-dense work loses [S1]. Anthropic's result (+90.2%) and Cognition's objection both fit that rule. Anthropic's team was explicit that their winning pattern suits breadth-first research, and that most coding work does not [S3]. The cost side is consistent across sources: a multi-agent run is roughly an order of magnitude more expensive than a chat, so the task must be worth that price [S3].

Sources disagree on where the threshold sits. Anthropic reports a large gain on its own eval; the scaling study reports that gains shrink once the single-agent baseline is already strong [S1]. One possible explanation, not tested by either source, is that Anthropic's eval used weak single-agent baselines on breadth-first questions. The "Debate or Vote" result [S10] and the Self-MoA result [S8] suggest that part of what looks like multi-agent benefit is ensembling of samples from one model. Self-consistency [S33], a 2022 result outside the brief's window, shows the same pattern for a single model: sampling several answers and voting gave +17.9% on GSM8K over plain chain of thought.

Cemri et al. group their 14 failure modes into system design, inter-agent misalignment and task verification [S2]. That fits the scaling study's finding that architectures without a central checker let errors spread [S1].

## 2. Context: isolation versus sharing

| Source | What is isolated | What crosses, and in what form | Measured result |
|---|---|---|---|
| [S3] Anthropic multi-agent system | Each subagent has its own context window, tools and trajectory | Subagents return a condensed result; large outputs go to a filesystem and only references return to the lead | +90.2% on internal eval; Anthropic credits separate context windows for extra parallel capacity (not ablated) |
| [S4] Anthropic, Effective context engineering (2025) | Subagents keep detailed search context | A condensed summary, "often 1,000-2,000 tokens", from subagents that may explore "tens of thousands of tokens or more" | Qualitative. The post states that context rot exists and "must be treated as a finite resource" |
| [S6] Cognition, Don't Build Multi-Agents (2025) | Nothing isolated by design | Full agent traces shared, not single messages | Qualitative; the Flappy Bird failure is an illustration |
| [S18] ACE (arXiv 2510.04618, v3 Mar 2026) | Generator, reflector and curator roles | Structured, incremental playbook entries; no full rewrite | +10.6% agents, +8.6% finance, lower adaptation latency and rollout cost; avoids collapse |
| [S16] Magentic-One (arXiv 2411.04468, 2024) | Specialized worker agents, coordinated by one orchestrator | Orchestrator plans, tracks progress and re-plans; the abstract does not describe what workers return | "Statistically competitive" with state of the art on GAIA, AssistantBench, WebArena (no figure read) |
| [S19] Mem0 (arXiv 2504.19413, 2025) | Memory extracted from history; not the full history | Retrieved memories sent per query, compared with full-context prompting | +26% relative judged quality over OpenAI's memory feature; 91% lower p95 latency; more than 90% token saving vs full context |
| [S21] Generative Agents (arXiv 2304.03442, 2023) | Per-agent memory stream | Memories synthesized into reflections, retrieved to plan | Qualitative (abstract only) |
| [S22] MemGPT (arXiv 2310.08560, 2023) | Context tiers, paged in and out | Explicit memory operations by the agent | Qualitative in abstract; long-document analysis beyond the window |
| [S23] Chroma, Context Rot (Jul 2025) | Not applicable | Input length alone | Performance grows less reliable as input grows, across 18 LLMs, with task complexity held fixed |
| [S24] Manus, Context Engineering for AI Agents (2025) | Tool sets masked, not removed | Stable prefix to keep KV-cache hits | Qualitative: KV-cache hit rate named the most important production metric |

**What follows.** Two forces pull in opposite directions. Long contexts degrade: Chroma shows that reliability falls as input grows even when the task does not change [S23], and Anthropic calls context "a finite resource" [S4]. Isolated subagents with condensed returns are the main fix in the sources, and Anthropic's measured gain comes from exactly that design [S3]. Isolation has a cost, though: Cognition's example shows two subagents making inconsistent choices because neither saw the other's work [S6]. A reasonable reading of the sources is to share decisions and traces where consistency matters and isolate raw exploration. That reading is mine, not a tested result.

The best-measured memory designs do not keep everything. ACE keeps a playbook of incremental updates and reports that repeated LLM rewriting causes collapse [S18]. Mem0 retrieves a few memories rather than sending full history and reports large cost and latency savings [S19]. Both support the idea that what crosses between pools should be a structured record, not a transcript.

Where sources disagree: Cognition argues against parallel subagents because they lose context [S6]; Anthropic runs them successfully [S3]. The difference is the task shape. Cognition's examples are heavy on shared design decisions. Anthropic's are independent searches. The scaling study's results fit Anthropic's side for parallel tasks and Cognition's side for sequential ones [S1].

I found no measured comparison of shared blackboards against isolated pools with a fixed task set. The blackboard and hand-off designs in the brief (LangGraph, OpenAI Agents SDK) are documented but not evaluated in any source I opened (see Not verified).

## 3. Self-improvement that is measured

| Source | What changes | Signal and selection | Reported result | Notes on held-out and failure |
|---|---|---|---|---|
| [S11] ADAS, Hu, Lu, Clune (arXiv 2408.08435, 2024) | Agent code: prompts, tools, workflows | Meta agent writes new agents in code, building on an archive of earlier ones | "Greatly outperform" hand-designed agents across coding, science, math (no figure read) | Not read |
| [S12] MaAS (arXiv 2502.04180, 2025; ICML venue per search) | A distribution over agent architectures, sampled per query | Optimized architecture probabilities and prompts (abstract does not name the optimizer) | Uses 6-45% of the inference cost of existing multi-agent systems; beats them by 0.54-11.82% on six benchmarks | Claims cross-dataset and cross-backbone transfer |
| [S13] AFlow (arXiv 2410.10762, 2024) | Code-represented workflows, LLM-invoking nodes and edges | Monte Carlo Tree Search over workflow code, refined with execution results | 5.7% average gain over state-of-the-art baselines on six benchmarks; smaller models beat GPT-4o on some tasks at 4.55% of its inference cost | Abstract only |
| [S14] GEPA (arXiv 2507.19457, 2025) | Prompts | Natural-language reflection on sampled trajectories; Pareto selection of candidates | +6% average over GRPO, up to +20%, using up to 35x fewer rollouts; +10% over MIPROv2 | Current arXiv abstract; an earlier version reported 10% over GRPO |
| [S15] Darwin Godel Machine (arXiv 2505.22954, 2025) | The agent's own code | Each change is tested empirically on coding benchmarks; an open-ended archive of agents is kept | SWE-bench 20.0% to 50.0%; Polyglot 14.2% to 30.7%; significantly beats runs without self-improvement or open-ended exploration | Gains on coding benchmarks only |
| [S18] ACE (arXiv 2510.04618) | Playbook of strategies | Generator, reflector and curator; execution feedback, no labels | +10.6% agents, +8.6% finance; matches top AppWorld agent with a smaller open model | Names context collapse as a failure mode |
| [S28] TextGrad (arXiv 2406.07496, 2024) | Prompts and components | Textual feedback as gradient | GPT-4o from 51% to 55% on Google-Proof QA; 20% relative gain on LeetCode-Hard | Small gains on some tasks |
| [S27] Reflexion (arXiv 2303.11366, 2023) | Episodic memory of reflections | Feedback from environment or tests | 91% pass@1 on HumanEval vs 80% for GPT-4 | Coding focus |
| [S29] Voyager (arXiv 2305.16291, 2023) | Skill library of code | Environment feedback and self-verification | 3.3x unique items, 2.3x distance, milestones up to 15.3x faster (Minecraft) | Game environment |
| [S30] Dynamic Cheatsheet (arXiv 2504.07952, 2025) | Reusable memory of solutions | Retrieval of validated code | GPT-4o on Game of 24: 10% to 99% after reusing a program; Claude +9% GPQA-Diamond, +8% MMLU-Pro | Arithmetic-heavy tasks show largest gains |

**What follows.** The results that are most useful for a daily pipeline are the ones that keep a fixed scorer and change one artifact at a time. GEPA and ACE both do that: they change text (a prompt or a playbook) against a measured signal [S14, S18]. DGM and ADAS change code, which gives larger gains but needs a sandbox and a benchmark where the score is objective [S11, S15]. AFlow and MaAS change structure and report cost along with accuracy [S12, S13], which matters for a cost-capped pipeline.

Failure modes are less well measured than gains. The clearest warning comes from ACE: repeated rewriting by an LLM shrinks context and causes sharp drops, which is why it moved to incremental edits [S18]. DGM's own ablations show that removing open-ended exploration hurts, so keeping a population of candidates is not optional decoration [S15]. I did not find a source that measures overfitting of a prompt or playbook to a training split with held-out numbers at the level this pipeline needs. The eval rule in this repo (a gain beyond the noise floor on held-out cases) is stricter than any of these papers report.

Transfer claims are mostly within one benchmark family. MaAS claims transfer across datasets and backbones [S12]; I did not open AFlow's body to check its transfer results, so I take none from it.

## 4. Dynamic teams

| Source | Mechanism | Measured effect | Conditions |
|---|---|---|---|
| [S17] DyLAN (arXiv 2310.02170, 2024; COLM venue per search) | Team optimization selects agents by an unsupervised Agent Importance Score from a preliminary trial | Outperforms strong baselines on code, decision-making, reasoning and arithmetic "with moderate computational cost"; up to +25.0% on specific MMLU subjects | Selection per task, from a trial run |
| [S12] MaAS (2025) | Query-dependent sampling of an agent architecture, allocating calls and tokens by query difficulty | 6-45% of baseline inference cost; +0.54-11.82% accuracy | Six benchmarks; cross-backbone transfer claimed |
| [S13] AFlow (2024) | MCTS over workflow code | +5.7% average over state of the art | Six benchmarks |
| [S16] Magentic-One (2024) | One orchestrator that plans, tracks progress and re-plans; four fixed worker types | Competitive on GAIA, AssistantBench, WebArena (no figure read) | Worker set fixed; orchestrator adapts |
| [S3] Anthropic (2025) | Lead agent sizes effort by query: 1 agent with 3-10 tool calls for simple fact-finding; 2-4 subagents for comparisons; more than 10 for complex research | Targets an early failure: spawning 50 subagents for simple queries | Rules written into the prompt, not learned |
| [S32] AgentVerse (arXiv 2308.10848, 2023) | Group formation and expert roles | "Outperform a single agent" (no figure read) | Qualitative in abstract |

**What follows.** The evidence for choosing agents per task is real but narrow. DyLAN and MaAS both select a team or structure per query and report better accuracy at lower or moderate cost [S12, S17]. MaAS states the mechanism as allocating less compute to easier queries [S12]. This is the same pattern the scaling study predicts: the right structure depends on task properties [S1].

Anthropic's rules are the most practical evidence, but they are hand-written in the prompt and reported from its own eval [S3]. The scaling study found that a predictive model on task features picked the best architecture for 87% of held-out configurations [S1], which is the closest thing in the sources to a learned router with a held-out check. It was built on its own configurations, so it does not show the same accuracy on a new domain.

No source I opened tests a dynamic pool against a fixed pipeline on the same task set with a cost cap. That comparison is the one the reader would need before adopting dynamic pools.

## 5. Verification and judges

| Source | Finding | Number or condition |
|---|---|---|
| [S25] CALM, Ye et al. (arXiv 2410.02736, 2024) | Twelve judge biases quantified; significant biases persist in some tasks even for advanced models | Numbers per bias not read |
| [S26] Self-preference and self-recognition (arXiv 2404.13076, 2024) | LLM evaluators recognize their own outputs; fine-tuning shows a linear relation between self-recognition and self-preference, with a causal link in controlled tests | Title and authors not captured in my read |
| [S1] Scaling agent systems (2025) | Architectures without centralized verification propagate errors; centralized coordination reduces amplification from 17.2x to 4.4x | Controlled, 260 configurations |
| [S2] MAST (2025) | Task verification is one of three failure categories; an LLM annotator with o1 reports high human agreement | Human kappa 0.88 on 150 traces |
| [S10] Debate or Vote (2025) | Simple majority voting is more reliable than debate in many settings | Seven NLP benchmarks |

**What follows.** The strongest evidence concerns structure, not judges. A central verifier cut error amplification by a factor of about four in the scaling study [S1], and MAST lists verification failures as a distinct category [S2]. The sources favor a checker that is separate from the workers.

Judge reliability is weaker. CALM shows that biases persist and that the reliability of LLM judges has room to improve [S25]. The self-preference paper gives a mechanism: a judge that recognizes its own text favors it [S26]. Together these support using a verifier from a different model family, since a model should not check its own output. I did not find a measured figure for cross-vendor verification in the sources I opened, so the advantage is a reasoned inference.

On deterministic checks: none of the opened sources measures a deterministic check placed before a model check. The reader's design (code checks quotes and computes scores before a model verifies) is consistent with the sources' advice to verify structure, but there is no measured comparison here.

None of the sources I opened gives figures for position or verbosity bias, so I state no numbers for them.

---

## Design rules the evidence supports

1. **Start with one agent and add a second only when the work splits into independent parts.** Sources: [S1], [S3], [S5] ("find the simplest solution possible"). Confidence: strong.
2. **Do not add agents to sequential or tool-dense steps.** Sources: [S1] (-70.0% on sequential planning; tool-coordination penalty). Confidence: moderate; one controlled study.
3. **Put one central verifier between workers and output.** Sources: [S1] (17.2x vs 4.4x), [S2] (verification failures). Confidence: moderate.
4. **Give each subagent an objective, an output format, tool guidance and task boundaries.** Sources: [S3], which reports that vague briefs caused duplicated or missing work. Confidence: moderate; practitioner evidence.
5. **Share decisions and full traces for work that must stay consistent.** Sources: [S6] (example), [S3] (lead keeps plan in memory). Confidence: weak to moderate; no measured comparison.
6. **Return summaries or file references to the parent, not raw transcripts.** Sources: [S4] (condensed returns, 1,000-2,000 tokens), [S3] (artifacts with references). Confidence: moderate.
7. **Budget tokens for multi-agent runs explicitly; expect about 15x a chat.** Sources: [S3]. Confidence: moderate; one company's data.
8. **Compare against majority voting before adding debate.** Sources: [S10] (seven benchmarks), [S33]. Confidence: moderate.
9. **Prefer the best single model in an ensemble unless mixing is measured to help on your task.** Sources: [S8] (+6.6% AlpacaEval, +3.8% average). Confidence: moderate.
10. **Update evolving memory by incremental edits, not full LLM rewrites.** Sources: [S18] (collapse under rewriting). Confidence: moderate; one paper, and the sources do not test overfitting.

---

## Attractive ideas with weak or negative evidence

- **Adding more agents for more quality.** Negative on sequential and tool-heavy work [S1, S2]. Cognition argues against parallel writers [S6].
- **Multi-agent debate as a quality booster.** Debate alone does not raise expected correctness [S10]. Majority voting does most of the work.
- **Mixing different model families in an ensemble.** Mixed ensembles lower average output quality, per [S8]. The exception needs measuring on your task.
- **A fully self-modifying pipeline.** The strongest results (DGM) are on coding tasks with an objective test and a sandbox [S15]. I found no measured case of an open-ended self-modifying system in a domain without a test oracle.
- **Automatic memory of everything.** Retrieval-based memory saves cost against full context [S19], but no source I opened compares "remember everything" with selective memory.
- **Prompt or playbook evolution without a held-out check.** Sources show gains on fixed benchmarks [S14, S18], but none of them reports overfitting measured on a split the optimizer never saw. Treat any reported gain on the training split as unproven.
- **Learned routers picking agents per task.** Shown on the authors' own configurations [S1, S12, S17]. No source tests transfer to a new domain with a cost cap.

---

## Not verified

- **Cognition, Multi-Agents: What's Actually Working (April 2026).** Found in search; not opened.
- **LangGraph multi-agent documentation.** The page fetch failed. Not verified.
- **OpenAI Agents SDK handoffs.** The page was fetched and its section names confirmed (handoffs, customizing handoffs via the handoff() function). I did not read the input-filter or history semantics, so I make no claim about what crosses a hand-off.
- **Google Research blog on the scaling study.** Not opened; I used the arXiv abstract and the HTML version's text.
- **Magentic-One benchmark figures.** A secondary review reported 38% on GAIA and 27.7% on AssistantBench. I did not open the paper body, so I take no figure from it. Its ledger design is from a search summary, not from the paper.
- **DGM ablation numbers** (for example 39.0% without open-ended exploration). From a search summary; the abstract only says the DGM "significantly outperforms" those baselines.
- **GEPA rollout baseline (24,000 GRPO rollouts on Qwen3 8B).** From a search summary; not on the abstract page.
- **ADAS, Generative Agents, MemGPT, A-MEM, ExpeL, AgentVerse, Reflexion (other than the HumanEval figure).** Abstracts read; no figures available there.
- **Blackboard designs for LLM agents (2025 papers).** Not searched in depth.
- **Position and verbosity bias figures.** Not located in an opened source.
- **Cross-vendor verifier advantage.** No measured figure found.
- **Overfitting of prompt or playbook optimizers on held-out splits.** Not found in opened sources.
- **ACE venue.** ICLR 2026 comes from a search result, not the abstract page.
- **Self-preference paper title and authors.** Abstract read; title not captured.

## Sources

Venues marked "per search" come from a search result, not from the abstract page I read.

- [S1] Yubin Kim, Ken Gu, Chanwoo Park and others, "Towards a Science of Scaling Agent Systems," arXiv 2512.08296, submitted 9 Dec 2025, v3 8 Apr 2026. https://arxiv.org/abs/2512.08296 (abstract read 2026-11-13)
- [S2] Mert Cemri, Melissa Z. Pan, Shuyi Yang and others, "Why Do Multi-Agent LLM Systems Fail?," arXiv 2503.13657, submitted 17 Mar 2025, v3 26 Oct 2025. https://arxiv.org/abs/2503.13657 (abstract read 2026-11-13)
- [S3] Anthropic, "How we built our multi-agent research system," engineering post, 2025. https://www.anthropic.com/engineering/multi-agent-research-system (read 2026-11-13)
- [S4] Anthropic, "Effective context engineering for AI agents," engineering post, 2025. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (read 2026-11-13)
- [S5] Anthropic, "Building effective agents," engineering post, 2024. https://www.anthropic.com/engineering/building-effective-agents (read 2026-11-13; quoted sentence checked)
- [S6] Walden Yan, Cognition, "Don't Build Multi-Agents," 2025. https://cognition.ai/blog/dont-build-multi-agents (read 2026-11-13)
- [S8] Wenzhe Li, Yong Lin, Mengzhou Xia, Chi Jin, "Rethinking Mixture-of-Agents: Is Mixing Different Large Language Models Beneficial?," arXiv 2502.00674, 2 Feb 2025. https://arxiv.org/abs/2502.00674 (read 2026-11-13)
- [S9] Junlin Wang, Jue Wang, Ben Athiwaratkun, Ce Zhang, James Zou, "Mixture-of-Agents Enhances Large Language Model Capabilities," arXiv 2406.04692, 2024. https://arxiv.org/abs/2406.04692 (abstract read 2026-11-13)
- [S10] Hyeong Kyu Choi, Xiaojin Zhu, Sharon Li, "Debate or Vote: Which Yields Better Decisions in Multi-Agent Large Language Models?," arXiv 2508.17536, NeurIPS 2025 Spotlight. https://arxiv.org/abs/2508.17536 (abstract read 2026-11-13)
- [S11] Shengran Hu, Cong Lu, Jeff Clune, "Automated Design of Agentic Systems," arXiv 2408.08435, 2024, ICLR 2025. https://arxiv.org/abs/2408.08435 (abstract read 2026-11-13)
- [S12] Guibin Zhang, Luyang Niu, Junfeng Fang and others, "Multi-agent Architecture Search via Agentic Supernet," arXiv 2502.04180, 2025; ICML 2025 per search. https://arxiv.org/abs/2502.04180 (abstract read 2026-11-13)
- [S13] Jiayi Zhang and others, "AFlow: Automating Agentic Workflow Generation," arXiv 2410.10762, 2024, v4 Apr 2025. https://arxiv.org/abs/2410.10762 (abstract read 2026-11-13)
- [S14] Lakshya A. Agrawal, Shangyin Tan, Dilara Soylu and others, "GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning," arXiv 2507.19457, 2025, ICLR 2026. https://arxiv.org/abs/2507.19457 (abstract read 2026-11-13)
- [S15] Jenny Zhang, Shengran Hu, Cong Lu, Robert Lange, Jeff Clune, "Darwin Godel Machine: Open-Ended Evolution of Self-Improving Agents," arXiv 2505.22954, 2025. https://arxiv.org/abs/2505.22954 (abstract read 2026-11-13)
- [S16] Adam Fourney, Gagan Bansal and others (Microsoft Research), "Magentic-One: A Generalist Multi-Agent System for Solving Complex Tasks," arXiv 2411.04468, 2024. https://arxiv.org/abs/2411.04468 (abstract read 2026-11-13)
- [S17] Zijun Liu, Yanzhe Zhang, Peng Li, Yang Liu, Diyi Yang, "A Dynamic LLM-Powered Agent Network for Task-Oriented Agent Collaboration," arXiv 2310.02170, 2024; COLM 2024 per search. https://arxiv.org/abs/2310.02170 (abstract read 2026-11-13)
- [S18] Qizheng Zhang, Changran Hu, Shubhangi Upasani and others, "Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models," arXiv 2510.04618, submitted 6 Oct 2025, v3 29 Mar 2026, ICLR 2026 per search. https://arxiv.org/abs/2510.04618 (abstract read 2026-11-13)
- [S19] Prateek Chhikara, Dev Khant, Saket Aryan, Taranjeet Singh, Deshraj Yadav, "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory," arXiv 2504.19413, 2025. https://arxiv.org/abs/2504.19413 (abstract read 2026-11-13)
- [S20] Wujiang Xu, Zujie Liang, Kai Mei and others, "A-MEM: Agentic Memory for LLM Agents," arXiv 2502.12110, 2025. https://arxiv.org/abs/2502.12110 (abstract read 2026-11-13; no figures in abstract)
- [S21] Joon Sung Park, Joseph C. O'Brien, Carrie J. Cai and others, "Generative Agents: Interactive Simulacra of Human Behavior," arXiv 2304.03442, 2023. https://arxiv.org/abs/2304.03442 (abstract read 2026-11-13)
- [S22] Charles Packer, Sarah Wooders, Kevin Lin and others, "MemGPT: Towards LLMs as Operating Systems," arXiv 2310.08560, 2023. https://arxiv.org/abs/2310.08560 (abstract read 2026-11-13)
- [S23] Kelly Hong, Anton Troynikov, Jeff Huber, Chroma, "Context Rot: How Increasing Input Tokens Impacts LLM Performance," July 2025. https://research.trychroma.com/context-rot (read 2026-11-13)
- [S24] Manus team, "Context Engineering for AI Agents: Lessons from Building Manus," 2025. https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus (read 2026-11-13)
- [S25] Jiayi Ye, Yanbo Wang, Yue Huang and others, "Justice or Prejudice? Quantifying Biases in LLM-as-a-Judge" (CALM), arXiv 2410.02736, 2024. https://arxiv.org/abs/2410.02736 (abstract read 2026-11-13)
- [S26] ArXiv 2404.13076, "Self-preference and self-recognition in LLM evaluators," 2024; title and authors not captured in my read. https://arxiv.org/abs/2404.13076 (abstract read 2026-11-13)
- [S27] Noah Shinn, Federico Cassano, Edward Berman, Ashwin Gopinath, Karthik Narasimhan, Shunyu Yao, "Reflexion: Language Agents with Verbal Reinforcement Learning," arXiv 2303.11366, 2023. https://arxiv.org/abs/2303.11366 (abstract read 2026-11-13)
- [S28] Mert Yuksekgonul, Federico Bianchi, Joseph Boen and others, "TextGrad: Automatic 'Differentiation' via Text," arXiv 2406.07496, 2024. https://arxiv.org/abs/2406.07496 (abstract read 2026-11-13)
- [S29] Guanzhi Wang, Yuqi Xie, Yunfan Jiang and others, "Voyager: An Open-Ended Embodied Agent with Large Language Models," arXiv 2305.16291, 2023. https://arxiv.org/abs/2305.16291 (abstract read 2026-11-13)
- [S30] Mirac Suzgun, Mert Yuksekgonul, Federico Bianchi, Dan Jurafsky, James Zou, "Dynamic Cheatsheet: Test-Time Learning with Adaptive Memory," arXiv 2504.07952, 2025. https://arxiv.org/abs/2504.07952 (abstract read 2026-11-13)
- [S31] Andrew Zhao, Daniel Huang, Quentin Xu and others, "ExpeL: LLM Agents Are Experiential Learners," arXiv 2308.10144, 2023. https://arxiv.org/abs/2308.10144 (abstract read 2026-11-13; no figures)
- [S32] Weize Chen, Yusheng Su, Jingwei Zuo and others, "AgentVerse: Facilitating Multi-Agent Collaboration and Exploring Emergent Behaviors," arXiv 2308.10848, 2023. https://arxiv.org/abs/2308.10848 (abstract read 2026-11-13)
- [S33] Xuezhi Wang, Jason Wei, Dale Schuurmans and others, "Self-Consistency Improves Chain of Thought Reasoning in Language Models," arXiv 2203.11171, 2022. Outside the 2023 to 2026 window; cited only as the baseline the brief names. https://arxiv.org/abs/2203.11171 (abstract read 2026-11-13)
