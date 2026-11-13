# Assumptions behind "find the best founders", and what the evidence says

Research date: 2026-11-13. Every source below was opened on this date. Where I read only the abstract, the entry says so. Where I could read only the metadata record, I list no numbers from it. Section "Not verified" lists what I could not open.

## Eight findings that matter most

1. **Explicit task ledgers are a proven pattern, and they separate facts from guesses.** Magentic-One keeps a task ledger with four parts: given or verified facts, facts to look up, facts to derive, and educated guesses. The outer loop updates the guesses as evidence arrives. Source: Fourney et al., arXiv 2411.04468 (Nov 2024), full text read. The paper does not report an accuracy number for the ledger alone.
2. **A learned rubric from LLM outputs drifts as people grade.** EvalGen found "criteria drift": users need criteria to grade outputs, and grading outputs changes the criteria. Source: Shankar et al., arXiv 2404.12272 (Apr 2024), abstract read. The finding is qualitative, from a user study.
3. **Founder-only LLM predictors do better than random, and they beat humans in one published setting.** GPTree reports 7.8% precision for "unicorn" startups at inception, against 3.1% to 5.6% for the best human decision makers in its comparison. Source: Xiong, arXiv 2411.08257 (Nov 2024), abstract read.
4. **The strongest published LLM result is a relative gain over random, on a small label set.** R.A.I.S.E. raises precision from 0.225 to 0.346 over a standalone OpenAI o3 model, and reports precision of about 2.2 times a random classifier at 16%. Source: Preuveneers et al., arXiv 2504.12090 (Apr 2025), abstract read. The label set and sample size are not in the abstract.
5. **An LLM-based benchmark exists for this exact task, and it reports a base rate.** VCBench has 9,000 anonymized founder profiles. The market index reaches precision 1.9% at inception. Y Combinator is 1.7 times better and tier-1 firms are 2.9 times better. The best model, DeepSeek-V3, delivers more than six times the baseline precision. Source: Chen, arXiv 2509.14448 (Sep 2025), abstract read.
6. **LLMs over-predict startup success.** The Startup Success Forecasting Framework (SSFF) reports that baseline LLMs over-predict success and lean on founder claims. Its founder segmentation found L5 founders 3.79 times more likely to succeed than L1 founders, on its own segmentation. Source: arXiv 2405.19456 (May 2024), abstract read.
7. **At the earliest stage, the business matters more than the team, on one large study.** Kaplan, Sensoy and Strömberg followed 50 VC-financed companies from business plan to IPO. Business lines stayed stable, management turnover was substantial, and the authors conclude investors should weight the business more than the management team at the margin. Source: Journal of Finance 2009, DOI 10.1111/j.1540-6261.2008.01429.x, abstract read.
8. **Investors respond strongly to team information, and that response is causal.** A randomized field experiment found the average investor responds strongly to founding team information, and not to traction or existing lead investors. The authors argue this is rational, not only a signal. Source: Bernstein, Korteweg and Laws, Journal of Finance 2017, DOI 10.1111/jofi.12470, abstract read. This is evidence about investor behaviour. It is not evidence that the team predicts outcomes better than the business.

Findings 5 and 7 pull in opposite directions on the team versus business question. The system's 60/40 split between founder and company is a choice the sources do not settle.

## Part A: how to hold and revise the assumptions behind an objective

### A1. Writing assumptions down while working

| Source | Mechanism | What was measured | Result |
|---|---|---|---|
| Fourney et al., Magentic-One, arXiv 2411.04468, full text read | Orchestrator keeps a task ledger (given facts, facts to look up, facts to derive, educated guesses) and a progress ledger. Stalls trigger replanning. | Performance on GAIA, AssistantBench, WebArena | "Statistically competitive" with state of the art. The paper states that the guesses let the agent give a qualified best guess when stuck. |

What follows for this system: the ledger separates what is known from what is guessed, and it marks guesses as guesses. The system's rubric questions and weights are guesses, and they should live in a ledger of that kind, with a status field and a review date. I did not check whether the paper ablates the ledger, so the value of the ledger for accuracy is a hypothesis to test on our own runs.

### A2. Finding what the person did not say

| Source | Mechanism | What was measured | Result |
|---|---|---|---|
| Li et al., "Eliciting Human Preferences with Language Models" (GATE), arXiv 2310.11589 (Oct 2023), abstract read | The LM asks open questions and synthesizes edge cases to elicit preferences in free-form interaction. | Preregistered experiments in email validation, content recommendation and moral reasoning. | LM-elicited responses are often more informative than user-written prompts or labels. Users report less effort and surface considerations they had not anticipated. |

What follows: the partner's unstated preferences are most likely to surface when the system generates edge cases (for example, a founder profile the rubric scores oddly) and asks the partner to judge them. This is a cheaper route to the unstated assumptions than asking the partner to write a rubric. Full text was not read, so effect sizes are not reported here.

Not verified: a 2024 to 2026 benchmark for clarification under ambiguity, and work on underspecified instructions for agents. I did not search for these with enough depth to cite them.

### A3. Criteria that move as people grade

| Source | Mechanism | What was measured | Result |
|---|---|---|---|
| Shankar et al., "Who Validates the Validators?" (EvalGen), arXiv 2404.12272 (Apr 2024), abstract read | Mixed-initiative: the system proposes criteria and LLM grader prompts or code assertions, the human grades a subset of outputs, and the system selects implementations that agree with the grades. | Qualitative user study. | Criteria drift: grading outputs changes the criteria. Some criteria depend on the outputs observed, which breaks the assumption that criteria can be fixed in advance. |

What follows: the system's rubric must be versioned, and each partner grade must record the rubric version it was given under. A decision made under version 3 should not be counted against version 4 without a note. The paper's point about criteria that depend on observed outputs means the rubric can change because the partner saw a batch of founders, not because the partner's values changed. The system should record which of the two happened.

Not verified: later work on aligning LLM judges with human graders beyond EvalGen. I did not open those papers.

### A4. Learning a rubric or policy from decisions

Not verified. I did not open a source on LLM rule induction or decision-list learning from a few dozen labels, and I will not cite one from memory. The GPTree paper (Xiong, arXiv 2411.08257) is the nearest source. It learns a decision tree with an LLM and adds an expert-in-the-loop step where a human rebuilds decision paths. Its abstract gives no sample size or overfitting analysis, so it does not answer the overfitting question.

What follows for this system: with a few dozen partner decisions, a learned weight vector will overfit. The safer design is to keep the rubric fixed and learn only the weights, with a prior, and to report the uncertainty on each weight. This is my judgement, not a sourced result.

### A5. Telling a real preference from noise

Not verified. I did not open a source that gives the number of decisions needed before a learned preference is trustworthy. The R.A.I.S.E. result (precision gain of 0.225 to 0.346) is on a curated dataset whose size is not in its abstract, so it cannot tell us the sample size needed.

## Part B: what the evidence says predicts founder and startup success

### B1. LLM-based prediction of founder or startup success

| Source | Data and label | What the model sees | Leakage control | Metric and result | Baseline |
|---|---|---|---|---|---|
| VCBench, Chen, arXiv 2509.14448 (Sep 2025), abstract read | 9,000 anonymized founder profiles; success label defined in the full paper, not in the abstract | Standardized founder features | Adversarial re-identification tests; more than 90% reduction in re-identification risk | Precision at inception; DeepSeek-V3 more than six times the baseline; GPT-4o highest F0.5 | Market index 1.9% precision; YC 1.7 times; tier-1 2.9 times |
| GPTree, Xiong, arXiv 2411.08257 (Nov 2024), abstract read | "Unicorn" startups at inception; data not in the abstract | Task prompt, tree-structured splits | Not in the abstract | 7.8% precision | Human decision makers 3.1% to 5.6%; GPT-4o few-shot is lower (number not in abstract) |
| Founder-GPT, Xiong, arXiv 2312.12037 (Dec 2023), abstract read | Not a predictive study; scores founder-idea fit by self-play | Founder profile and idea | Not in the abstract | Qualitative: "early promising results" | None reported |
| R.A.I.S.E., Preuveneers, arXiv 2504.12090 (Apr 2025), abstract read | "Curated startup datasets"; label not in the abstract | Chain-of-thought logs distilled to rules | Not in the abstract | Precision 0.225 to 0.346; accuracy 0.46 to 0.70 | Standalone OpenAI o3; random classifier precision 16% |
| SSFF, arXiv 2405.19456 (May 2024), abstract read | Startup outcomes; label not in the abstract | Multi-agent analysis with random forests and neural networks in a retrieval-augmented setup | Not in the abstract | L5 founders 3.79 times more likely to succeed than L1 | Baseline LLMs over-predict success |

Reading across these: the strongest number is VCBench's market-index precision of 1.9%, which sets the floor any model must clear. A model is useful if it beats the index by a wide margin, not if it beats a random coin. Every LLM result above is precision on a small or unpublished label set. None of the abstracts reports a confidence interval.

The system should adopt the VCBench framing: a precision number against the market index, on a labelled set, with the leakage controls stated.

Not verified: the full text of any of these papers, so I cannot report label definitions, leakage controls in detail, or confidence intervals. The "Startup Success Forecasting Framework" name is the one in the arXiv title; I did not check whether it matches the name in the brief.

### B2. What investors weigh, and what predicts outcomes

| Source | Mechanism | What was measured | Result |
|---|---|---|---|
| Kaplan, Sensoy, Strömberg, Journal of Finance 2009, abstract read | Follow firm characteristics from business plan to IPO | 50 VC-financed companies; cross-check with 2004 IPOs | Business lines stable; management turnover substantial. Investors should weight the business at the margin. |
| Bernstein, Korteweg, Laws, Journal of Finance 2017, abstract read | Randomized information sets for investors | Investor response to team, traction, lead investors | Strong response to team; none to traction or lead investors |
| "Performance persistence in entrepreneurship," Journal of Financial Economics 2010, DOI 10.1016/j.jfineco.2009.11.001, metadata read (Crossref title, journal, year; author list not checked) | Not read | Not read | Not verified; no result reported here |
| "How Do Venture Capitalists Make Decisions?", NBER Working Paper 22587 (2016), DOI 10.3386/w22587, metadata read (Crossref lists first author Gompers; full author list not checked) | Not read | Not read | Not verified; no result reported here |

Effect sizes: the Bernstein paper reports a strong response to team information. I did not extract a coefficient from the abstract, so I report the direction only. The Kaplan paper reports stability of business lines and turnover in management, which is a fact about firms over time, not a predictive coefficient.

Not verified: founder experience, prior startups, technical background, team completeness and co-founder effects. I did not open studies that measure these, so I will not state effect sizes for them.

Personal attributes: I did not open a source on age or other personal attributes. The system must not use them in any case. No finding in this section depends on one.

### B3. The jockey and the horse

The Kaplan, Sensoy and Strömberg paper is the one source I opened that bears on this question directly. It finds the business stable and management turnover high, and it concludes that at the margin the business deserves more weight than the team. It studies 50 VC-financed companies and checks 2004 IPOs, and it does not measure predictive power for later returns. So it supports a claim about where the information sits over time, not about how much weight each deserves in a prediction.

The Bernstein paper shows that investors weight the team heavily, which is a fact about behaviour. Behaviour is not evidence that the team is the better predictor.

The system's 60/40 split (founder 60, company 40) is therefore an unsupported choice in the evidence I read. It should be treated as an assumption to test, not as a finding. A test is to compare the predictive power of the founder score alone, the company score alone, and the combined score on past companies with known outcomes.

### B4. Base rates

Not verified. I did not open a published base rate for venture-backed or accelerator-backed companies reaching a large outcome. The VCBench market-index precision of 1.9% is a base rate in one labelled benchmark, and it is the one number I can cite. It is not a base rate for accelerator launches.

On the system's 15% accelerator success proxy (headcount): I cannot say how it compares with published rates, because I did not open those rates. The critique I can state from the design alone is that headcount growth is slow to appear, can reflect a hiring policy rather than value, and misses companies that are acquired early or that return capital without growing headcount. These are my reasoning, not sourced.

## An assumption ledger for this system

The table lists assumptions the system makes today, written as testable statements. Evidence is limited to what I opened. "Unstated" means the assumption appears in neither the founder rubric, the company rubric, the thesis nor the split. The column "Test on our data" uses the partner's decisions and the past-company eval.

| # | Assumption | Where it lives | Published evidence | How to test on our data |
|---|---|---|---|---|
| 1 | The founder and company together predict success better than either alone | Split (60/40) | Kaplan et al. 2009 supports stable business lines, not a prediction. No predictive comparison opened. | Fit founder-only, company-only and combined scores on past companies with known outcomes; compare precision at a fixed list size |
| 2 | The 60/40 split is the right weight | Split | None opened | Grid over the split; report the range where precision stays within the noise floor |
| 3 | A model's precision beats the market index at inception | Eval headline | VCBench: index precision 1.9% | Report precision against the index rate computed from our own labelled set |
| 4 | Team information predicts outcomes, not only investor interest | Founder rubric, several questions | Bernstein et al. 2017 shows investor response only | Compare team-only and company-only predictions against outcomes, not against partner Yes decisions |
| 5 | Partner Yes decisions measure quality | Partner feedback loop | None opened | Check whether a partner's Yes predicts the past-company outcome, by partner and by period |
| 6 | Criteria are fixed for the length of a batch | Rubric | Shankar et al. 2024: criteria drift | Log the rubric version on every grade; measure how many grades change version mid-batch |
| 7 | Shipping speed predicts later success more than stated ambition does | Founder rubric (unstated as a weight) | None opened | Code the shipping-speed evidence on past companies with outcomes known; compare with the ambition evidence |
| 8 | Headcount growth is a fair proxy for success | Eval label (15% accelerator proxy) | None opened for this proxy | Compare the headcount label with a second label (acquisition or follow-on funding) on the same companies |
| 9 | Trajectory over years of experience predicts success | Founder rubric, trajectory question | None opened | Test on past companies; never use age (prohibited by the system) |
| 10 | Technical background matters for the founder score | Founder rubric (unstated as a weight) | None opened | Compare founders with and without technical background on past outcomes |
| 11 | Co-founder completeness matters | Founder rubric (unstated) | None opened | Same method as 10 |
| 12 | Traction predicts outcomes at the seed stage | Company rubric | Bernstein et al. 2017: investors ignore traction; prediction not tested | Compare traction-only prediction with outcomes on past companies |
| 13 | A brief point cited to a verified source is more reliable than an uncited one | Evidence rule | None opened; this is a design choice | Measure how many verified points predict outcome versus uncited points |
| 14 | The surface bar of 0.58 sends about a tenth of investigated companies forward | Defaults, tuned on simulated founders | None; the system's own simulation | Recalibrate on past companies; the simulated bar is not evidence |
| 15 | "Best" means the highest expected outcome, not the highest partner approval | Objective (unstated) | None opened | Write down the objective as a choice; evaluate on outcomes and partner approval separately |
| 16 | Models score nothing; the code does | Architecture | None needed; a design rule | Keep as is; check that no model output reaches the score |
| 17 | A research quote on the cited page is evidence | Quote check | None opened | Measure how often a quoted sentence changes a score |
| 18 | LLM judges agree with partner grades on rubric questions | Analyst prompts | Shankar et al. 2024: the agreement is unstable as criteria drift | Measure agreement between the LLM answer and the partner on a labelled sample, per question |

Unstated assumptions in this table: 4, 5, 7, 8, 10, 11, 12, 13, 15. Assumption 9 names a mechanism the rubric already uses (trajectory against years of experience). The evidence for it is absent from my sources, so it is listed as a test, not a finding.

## Design rules

1. Keep the rubric versioned and record the version on every partner grade, because criteria drift is documented (Shankar et al. 2024, abstract read). Confidence: moderate.
2. Report every LLM predictor against the market-index precision on the same labelled set, because the 1.9% index in VCBench is the floor a useful model must beat (Chen 2025, abstract read). Confidence: moderate.
3. Use a task ledger that separates known facts from educated guesses, and mark guesses as guesses (Fourney et al. 2024, full text read). Confidence: moderate.
4. Treat the 60/40 split as an assumption to test, because the two sources that bear on it point in different directions (Kaplan et al. 2009; Bernstein et al. 2017, abstracts read). Confidence: weak.
5. Generate edge cases and ask the partner to judge them, rather than asking the partner to write a rubric (Li et al. 2023, abstract read). Confidence: weak, since the effect sizes were not read.
6. Do not learn free weights from a few dozen decisions without a prior and an uncertainty report (my judgement; no sourced number). Confidence: weak.
7. Do not treat a single LLM precision number as evidence without the label definition and a confidence interval, which none of the abstracts report (all Part B entries). Confidence: moderate.
8. Never use an age or other personal attribute in any score, and do not present a finding that depends on one (system rule; no source needed). Confidence: strong.

## Not verified

- Full text of VCBench, GPTree, Founder-GPT, R.A.I.S.E. and SSFF. Only abstracts were read. Label definitions, leakage controls and baselines in detail are unverified.
- Full text of GATE and EvalGen. Effect sizes beyond the abstract are unverified.
- Full text of Magentic-One's results tables. I read the method section on the task ledger, not the accuracy tables.
- Gompers et al. 2010 (JFE, performance persistence): metadata only.
- Gompers, Gornall, Kaplan, Strebulaev (NBER WP 22587, 2016): metadata only; abstract not retrieved.
- Base rates for venture-backed or accelerator-backed companies reaching large outcomes.
- Effect sizes for founder experience, prior startups, technical background, team completeness and co-founders.
- Work on rule induction, learned rubrics, and the decision count needed before a preference is trustworthy (Part A4, A5).
- Work on clarification under ambiguity in 2024 to 2026 (Part A2).
- A search for SSFF's author list; the arXiv API did not return one for 2405.19456.

## Sources

1. Fourney et al., "Magentic-One: A Generalist Multi-Agent System for Solving Complex Tasks," arXiv 2411.04468, submitted 2024-11-07. https://arxiv.org/abs/2411.04468 (opened 2026-11-13; method section read in full text).
2. Li et al., "Eliciting Human Preferences with Language Models," arXiv 2310.11589, submitted 2023-10-17. https://arxiv.org/abs/2310.11589 (abstract read 2026-11-13).
3. Shankar et al., "Who Validates the Validators? Aligning LLM-Assisted Evaluation of LLM Outputs with Human Preferences," arXiv 2404.12272, submitted 2024-04-18. https://arxiv.org/abs/2404.12272 (abstract read 2026-11-13).
4. Chen, "VCBench: Benchmarking LLMs in Venture Capital," arXiv 2509.14448, submitted 2025-09-17. https://arxiv.org/abs/2509.14448 (abstract read 2026-11-13).
5. Xiong, "GPTree: Towards Explainable Decision-Making via LLM-powered Decision Trees," arXiv 2411.08257, submitted 2024-11-13. https://arxiv.org/abs/2411.08257 (abstract read 2026-11-13).
6. Xiong, "Founder-GPT: Self-play to evaluate the Founder-Idea fit," arXiv 2312.12037, submitted 2023-12-19. https://arxiv.org/abs/2312.12037 (abstract read 2026-11-13).
7. Preuveneers et al., "Reasoning-Based AI for Startup Evaluation (R.A.I.S.E.)," arXiv 2504.12090, submitted 2025-04-16. https://arxiv.org/abs/2504.12090 (abstract read 2026-11-13).
8. "SSFF: Investigating LLM Predictive Capabilities for Startup Success through a Multi-Agent Framework," arXiv 2405.19456, submitted 2024-05. https://arxiv.org/abs/2405.19456 (abstract read 2026-11-13; author list not retrieved).
9. Kaplan, Sensoy, Strömberg, "Should Investors Bet on the Jockey or the Horse?", Journal of Finance 2009, DOI 10.1111/j.1540-6261.2008.01429.x. https://doi.org/10.1111/j.1540-6261.2008.01429.x (abstract read 2026-11-13 via Crossref).
10. Bernstein, Korteweg, Laws, "Attracting Early-Stage Investors: Evidence from a Randomized Field Experiment," Journal of Finance 2017, DOI 10.1111/jofi.12470. https://doi.org/10.1111/jofi.12470 (abstract read 2026-11-13 via Crossref).
11. "Performance persistence in entrepreneurship," Journal of Financial Economics 2010, DOI 10.1016/j.jfineco.2009.11.001 (metadata only, read 2026-11-13; authors not checked).
12. "How Do Venture Capitalists Make Decisions?", NBER Working Paper 22587, 2016, DOI 10.3386/w22587 (metadata only, read 2026-11-13; no abstract retrieved; authors not checked).
