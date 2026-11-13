# Look-ahead bias when a model is tested on the past

Research date: 2026-11-13. Every source below was opened by the author of this note on that date, except where the "Not verified" section says otherwise.

## Findings that matter most

1. **Masking does not remove memory.** Lopez-Lira, Tang and Zhu (2025) masked company names, numbers, locations and dates in an Ethan Allen earnings call. GPT-4o still returned the ticker, quarter and year. On anonymised Apple, Meta and Microsoft calls it named the company in 100% of cases, and above 85% for all seven of the "Magnificent Seven" firms. Masking is therefore a weak control against memorisation.

2. **Masking also costs signal.** Wu et al. (arXiv 2511.15364, 2025) found that raw texts clearly beat anonymised texts when predicting S&P credit downgrades, and that look-ahead bias does not explain the gap. Anonymisation removes informative numbers and entities. The cost is real and must be reported.

3. **Post-cutoff tests are the only clean ones in the sources.** Lopez-Lira et al. found memorisation of economic and financial values before a model's knowledge cutoff, and "no recall" after it. ForecastBench (2024) avoids leakage by using only questions with no known answer at submission.

4. **Glasserman and Lin measured the two biases separately.** In-sample, anonymised headlines beat original headlines, so the distraction effect (general knowledge of a company interfering with sentiment) was larger than the look-ahead effect. Out-of-sample, look-ahead bias is not a concern, but distraction remains.

5. **Prompt instructions reduce leakage but do not remove it.** Sarkar and Vafa (2024) found that "COVID-19" appeared in 6.8% of outputs with a "consider only information up to" instruction and in 12.2% without it. Their conclusion is that prompting cannot be relied on to counteract the bias.

6. **Chronologically consistent models exist, with a capability cost that is not yet measured on this task.** He, Lv, Manela and Wu (2025) trained ChronoBERT and ChronoGPT only on text available at each date. Their abstract says the models are "competitive with larger open-weight models" on NLP benchmarks and that lookahead bias is "model and application-specific."

For the reader's 2018 to 2020 cases, the central fact is this. A judging model trained in 2024 or later has almost certainly seen the outcomes of those companies. The six controls can make the evidence pack cleaner. They cannot clean the model's memory. Only a model trained before the outcomes, or a test on cases after the model's cut-off, addresses that.

## 1. Size of the problem

| Source | What was tested | Result |
|---|---|---|
| Glasserman and Lin, arXiv:2309.17322, submitted 2023-09-29 ([abs](https://arxiv.org/abs/2309.17322), full text read) | GPT sentiment on financial headlines, original versus company-anonymised text, in-sample and out-of-sample | In-sample, anonymised headlines outperform. The authors conclude the distraction effect outweighs look-ahead bias. The effect is strongest for large firms. Exact return figures were not extracted. |
| Sarkar and Vafa, "Lookahead Bias in Pretrained Language Models", first version 2024-03-11, revised 2024-06-28 ([NBER PDF](https://conference.nber.org/conf_papers/f205530/f205530.pdf), read) | Earnings-call risk factors and election-winner predictions; direct tests based on events that are unpredictable given the information set | "We find evidence of lookahead bias in two applications." COVID-19 mentioned in 6.8% of outputs with the no-lookahead instruction, 12.2% without it. |
| Lopez-Lira, Tang and Zhu, arXiv:2504.14765, 2025-04-20 (v2 full text read, [html](https://arxiv.org/html/2504.14765v2)) | Recall of economic and financial values from LLMs, before and after the model's cut-off | "We demonstrate LLMs have memorized economic and financial data, recalling exact values before their knowledge cutoff... Post-cutoff, we observe no recall." |
| Ludwig, Mullainathan and Rambachan, arXiv:2412.07031, 2024-12-09 ([abs](https://arxiv.org/abs/2412.07031), read) | Econometric framework for LLMs in empirical work | Prediction needs "no training leakage." No bias size is measured. |

What follows: the bias is real for both financial returns and economic values. Glasserman and Lin show it can move a backtest in either direction, because the distraction effect can work against the look-ahead effect. Sarkar and Vafa show it is not solved by instructions. Lopez-Lira et al. give the strongest evidence that memorisation is common for well-known data, and that a null result from a memorisation test is only a lower bound.

## 2. Masking and anonymisation

| Source | What was tested | Result |
|---|---|---|
| Lopez-Lira et al., 2025 (v2, [html](https://arxiv.org/html/2504.14765v2)) | GPT-4o on entity-neutered earnings calls (names, numbers, locations, dates masked) | Ethan Allen identified as ETH, Q1, 2018. Company identified in 100% of Apple, Meta and Microsoft calls and above 85% for all Magnificent Seven firms. For Apple, 93.2% accuracy on quarter and year. |
| Lopez-Lira et al., 2025, as they describe it | The entity-neutering method of Engelberg et al. | They report that masked text "maintains similar sentiment and return predictability as unmasked text." Engelberg et al. itself was not opened (see Not verified). |
| Glasserman and Lin, 2023 | Company name replaced by a placeholder in headlines | Table 4 of the paper shows a headline where the name change flips the model's reading from bad news to good news for the same company. |
| Wu et al., arXiv:2511.15364 ([abs](https://arxiv.org/abs/2511.15364), read) | Credit-downgrade prediction, raw versus anonymised texts | "Raw texts significantly outperform anonymized texts... Look-ahead bias does not explain this difference; rather, anonymization degrades predictive performance by masking informative numerical and agent entities." Introduces an "anonymization gap" metric that needs no outcome data. |

What follows: masking removes the distraction effect in part, but it does not remove memory, since the model can rebuild the entity from the remaining context. Masking also destroys signal, so a masked result is not a clean estimate of the unmasked skill. Lopez-Lira et al. state the test condition plainly: masking is valid only if the masked task does not depend on post-cutoff information and the model shows detectable skill. Without detectable skill, weak capability and over-aggressive masking cannot be told apart.

## 3. Models with a known cut-off

| Source | What was tested | Result |
|---|---|---|
| He, Lv, Manela and Wu, "Chronologically Consistent Large Language Models," arXiv:2502.21206, v1 2025-02-28, v3 2025-07-06 ([abs](https://arxiv.org/abs/2502.21206), read) | ChronoBERT and ChronoGPT, trained only on text available at each time point | "Despite this strict temporal constraint, our models achieve strong performance on natural language processing benchmarks, outperforming or matching widely used models (e.g., BERT), and remain competitive with larger open-weight models." Lookahead bias is "model and application-specific." |
| Drinkall, Rahimikia, Pierrehumbert and Zohren, "Time Machine GPT," arXiv:2404.18543, 2024-04-29 ([abs](https://arxiv.org/abs/2404.18543), read) | Point-in-time models (TiMaGPT) pre-trained only on data before each cut-off | Abstract states the models "remain uninformed about future factual information and linguistic changes." Model size and data were taken from a search summary only (see Not verified). |
| Lopez-Lira et al., 2025 | Memorisation before and after cut-off | "Post-cutoff, we observe no recall." |

What follows: the cleanest control is a judging model whose training data ends before the case outcomes. The cost is capability. He et al. claim competitiveness on NLP benchmarks, not on ranking companies, and they concede that lower comprehension is possible. For the reader, a model trained before 2018 is the only way to make the 2018 to 2020 cases clean, and no source here shows such a model working on this task. A model trained after 2020 will have seen the outcomes. The simpler rule, test only after the model's cut-off, avoids the question entirely but needs cases from after the cut-off.

## 4. Detecting that a model knows

| Source | Detection method | Finding |
|---|---|---|
| Lopez-Lira et al., 2025 | Ask for entity and date from masked text; compare pre- and post-cutoff recall; test whether instructions to ignore the future help | Masking fails "as LLMs reconstruct entities and dates from minimal context." Instructions to respect historical boundaries "fail to prevent recall-level accuracy." Negative results are a lower bound: "positive evidence is conclusive, but negative evidence is not." |
| Lopez-Lira et al., 2025 | Small post-cutoff samples as robustness checks | Invalid. "When these samples are small, genuine forecasting skill and undetected memorization produce statistically indistinguishable results." |
| Sarkar and Vafa, 2024 | Direct tests built on events that cannot be predicted from the information set; compare mentions of later events with and without a no-lookahead instruction | Mentions of later events fall with the instruction (12.2% to 6.8%) but do not reach zero. |
| Glasserman and Lin, 2023 | Compare in-sample and out-of-sample performance of the same strategy, original and anonymised | Gap between the two windows is the diagnostic. Out-of-sample look-ahead is absent by construction. |
| He et al., 2025 | Next-day return forecasts from news, standard versus chronologically consistent models | The abstract says the bias is "model and application-specific." The return comparison itself was not checked in the body (see Not verified). |

What follows: a recognition probe is useful but limited. It can fail in two directions. A model can decline to name a company it knows, and a negative answer proves nothing (Lopez-Lira et al.'s lower-bound remark). A model can also know the kind of company that won in an era without recognising the company, so an entity probe misses type-level leakage. Probes that ask for the year or era catch a different kind of leak, as the Ethan Allen example shows. Comparing pre- and post-cutoff performance is the most informative check in the sources, and it needs post-cutoff cases.

## 5. Honest reporting

The sources point to a short set of things a careful paper reports alongside the headline:

- The share of cases the model recognises (names or dates recovered from masked text), with the probe and prompt given.
- Results split by recognition: recognised cases scored separately, and the headline computed on the rest.
- Results for cases after the judging model's cut-off only, labelled as the clean subset.
- In-sample and out-of-sample results side by side, following Glasserman and Lin and Sarkar and Vafa.
- The cost of masking: the same model on masked and unmasked text, following Wu et al.'s anonymisation gap.
- Placebo results. Lopez-Lira et al. require detectable skill before a null or a masked result means anything. No source here gives a specific placebo protocol for LLM backtests, so the protocol in the controls section is a judgement, not a sourced standard.

Recommended residual-risk wording is set out in the "How to word the result" section.

## 6. The same problem in startup prediction

| Source | What was done | Result |
|---|---|---|
| VCBench, arXiv:2509.14448, submitted 2025-09-17 ([abs](https://arxiv.org/abs/2509.14448), [html](https://arxiv.org/html/2509.14448v1), read) | 9,000 anonymised founder profiles; nine LLMs; adversarial re-identification tests | Market index precision 1.9% at inception. Y Combinator 1.7 times better, tier-1 firms 2.9 times better. "More than 90% reduction in re-identification risk" under adversarial tests. The authors' own tests, not independent. |
| VCBench, introduction (read) | Data sources | "LinkedIn provides wide coverage" alongside Crunchbase. This conflicts with the project's rule against LinkedIn as a source, so VCBench's profiles cannot be reused as they stand. |
| Zbikowski and Antosiuk, 2021, Information Processing and Management | Predictors built only from information available in the early stages of a company, Crunchbase data | Not verified. The ScienceDirect page returned a captcha. Only search summaries were read. See Not verified. |

What follows: VCBench is the closest match to the reader's task and reports the same kind of re-identification concern. Its 90% figure measures a test the authors designed. The LinkedIn source means the dataset is not usable under the project's policy. The Zbikowski line of work addresses the same leakage in a different way, by restricting predictors to early-stage information, which is a form of the cut-off control. Its numbers need checking before use.

## The six controls, judged

| # | Control | What the evidence says | Verdict | Source | How to strengthen |
|---|---|---|---|---|---|
| 1 | Cut-off: evidence after the date is dropped | Stops leakage in the prompt. Does not stop the judging model's own memory of 2018 to 2020 outcomes, which Lopez-Lira et al. show is retained. | Partly supports | Lopez-Lira et al. 2025; Sarkar and Vafa 2024 | Add a check that scores the rationale for post-launch facts, following the COVID-19 test pattern. |
| 2 | No research: nothing is looked up at run time | Removes retrieval leakage. Model memory remains. | Partly supports | Sarkar and Vafa 2024 | Keep it. Report it as necessary but not sufficient. |
| 3 | Masking: names, people, sites, years, batch tags | Partly removes distraction (Glasserman and Lin). Does not stop recognition: 100% and above 85% recognition on masked calls (Lopez-Lira et al.). Costs signal (Wu et al.). | Evidence against as a leak fix; supports as a distraction fix | Lopez-Lira et al. 2025; Glasserman and Lin 2023; Wu et al. 2025 | Report the recognition rate and the masked-versus-unmasked gap. |
| 4 | Recognition probe: model names the company from masked text | Useful, but a negative answer is a lower bound, and type-level knowledge is missed. | Partly supports | Lopez-Lira et al. 2025 | Add a year and era probe. Score probe reliability on a labelled set. |
| 5 | Cohorts: compare only within a quarter | Controls market-wide shifts in each period, which matter because 2018 to 2020 outcomes are correlated with the macro cycle. No source tests cohorting against LLM memory. | No evidence | None found | Keep for the market, not as a leak control. Say so in the write-up. |
| 6 | Order: tune on earlier quarters, report later | Separates in-sample from out-of-sample. A later quarter is still inside the judging model's memory if the model was trained after it. | Partly supports | Glasserman and Lin 2023; Lopez-Lira et al. 2025 | Report later-quarter results only as a secondary headline, and only for a judging model whose cut-off precedes them. |

## Controls that are missing

Ranked by how much each would add to the reader's claim.

1. **Post-cutoff cases as the only fully clean test.** Smallest version: a second case set of companies that launched after the judging model's cut-off, with the same pre-launch-only evidence rule, and the same rubric. Source: Lopez-Lira et al. 2025 ("Post-cutoff, we observe no recall"); ForecastBench 2024 (questions with no known answer at submission). The reader's 2018 to 2020 cases cannot be clean with a model trained after 2020, so this set is the only way to put a number on the leak.

2. **A chronologically consistent judge.** Smallest version: rerun a fixed sample of cases with a model whose data ends before the outcomes, and compare its ranking with the current judge. The gap is the leak estimate, with the capability cost shown next to it. Source: He et al. 2025 (abstract only). Capability on ranking tasks is unverified.

3. **A placebo test.** Smallest version: shuffle the outcome labels within each quarter and rerun the scorer. A ranking that is not chance-level under shuffled labels indicates a leak or a scoring bug. The expected value under shuffling is 0.5 for a pairwise ranking metric, or the base rate for precision. Source: a judgement built on Lopez-Lira et al.'s requirement of detectable skill. No source here gives this protocol for LLM backtests.

4. **A year and era probe.** Smallest version: a second probe that asks the model for the year or era of the masked text, scored against the hidden date. Source: Lopez-Lira et al. 2025, where quarter and year were recovered from masked calls (93.2% for Apple).

5. **A leak scan on rationales.** Smallest version: score every rationale for mentions of events, prices or names that appear only after the launch date, using a fixed keyword list plus a model check. Source: Sarkar and Vafa 2024 (COVID-19 mentions fell with the instruction but did not reach zero).

6. **Pseudonym invariance.** Smallest version: score the same pack with a second pseudonym and report the rank correlation between runs. A large change means the score depends on the tokens. Source: Glasserman and Lin 2023 (Table 4, where a name change flips the reading). This is a judgement built on that example.

7. **Results by judging-model cut-off.** Smallest version: run the same eval with two judges whose cut-offs differ, and report both. Source: He et al. 2025 ("model and application-specific").

8. **A reported anonymisation gap.** Smallest version: score each case masked and unmasked, and report the difference. This needs no outcome data. Source: Wu et al. 2025.

Not recommended yet: parametric correction at inference time, as in FinCAD (arXiv:2605.24564). It reports a mean in-sample return correction of -67.1% for the largest model, and 2025 out-of-sample returns within $8K. It was tested on five mega-cap equities and 7 to 14 billion parameter models, so it does not transfer to the reader's setting without new evidence.

## How to word the result

1. "The system saw only text published on or before each company's launch day, with names, people, sites, dates and batch tags masked, and nothing was looked up at run time."
2. "Masking did not stop the judging model from recognising [X] percent of cases, so the headline is reported on the remaining cases, and the recognised cases are reported separately."
3. "The judging model was trained after the outcomes it is scored on, so the result is an upper bound on skill and is not evidence of skill that would hold for companies launched after its cut-off."

Fill [X] from the recognition probe. Do not describe the result as free of look-ahead bias.

## Not verified

- **Engelberg et al., "entity neutering."** Original paper not found in arXiv or SSRN search, and an SSRN copy linked from a search result could not be downloaded. Its results are cited only as Lopez-Lira et al. describe them. The "random chance" recognition figure from a search summary is not used.
- **Zbikowski and Antosiuk (2021), Information Processing and Management, vol. 58, issue 4.** ScienceDirect returned a captcha. Search summaries only. The 213,171-company figure comes from a secondary source and is not used.
- **Glasserman and Lin exact in-sample figures.** The paper was read, but its results tables were not extracted, so no return or Sharpe numbers are quoted.
- **Wu et al. (arXiv:2511.15364) coefficient figures.** A search summary gave coefficients moving from 2.331 to 0.775. The abstract was read, but the coefficients were not checked in the body, so they are not quoted. Author names were also not extracted from the abstract page.
- **Lopez-Lira et al. v1 "82%" figure.** The v1 html was not opened. The v2 figures are used instead.
- **ChronoBERT yearly vintages from 1999, and the StoriesLM comparison.** From a search summary only. The abstract confirms the training constraint and the NLP-benchmark claim.
- **Time Machine GPT model size and data.** Taken from a search summary. The abstract confirms the point-in-time design only.
- **Sarkar and Vafa at ICML 2025.** The ICML page returned no usable text. The paper itself was read from NBER.
- **VCBench details beyond the abstract and introduction.** The 810-labelled-successful and 9% base-rate figures come from a search summary and were not checked in the body. The stated author list also comes from a search result.
- **ForecastBench LLM scores.** Only the abstract was read: expert forecasters outperform the top LLM, p below 0.001, on a sample of N=200.
- **FinCAD title.** Taken from a search result. The abstract was read and the figures above come from it.
- **Ludwig, Mullainathan and Rambachan.** Read for the framework statement only. No bias size is quoted.

## Sources

1. Glasserman, P. and Lin, C. "Assessing Look-Ahead Bias in Stock Return Predictions Generated By GPT Sentiment Analysis." arXiv:2309.17322, submitted 2023-09-29. https://arxiv.org/abs/2309.17322. Read 2026-11-13.
2. Sarkar, S. K. and Vafa, K. "Lookahead Bias in Pretrained Language Models." First version 2024-03-11, revised 2024-06-28. https://conference.nber.org/conf_papers/f205530/f205530.pdf. Read 2026-11-13.
3. Lopez-Lira, A., Tang, Y. and Zhu, M. "The Memorization Problem: Can We Trust LLMs' Economic Forecasts?" arXiv:2504.14765, 2025-04-20 (v2). https://arxiv.org/html/2504.14765v2. Read 2026-11-13.
4. Ludwig, J., Mullainathan, S. and Rambachan, A. "Large Language Models: An Applied Econometric Framework." arXiv:2412.07031, 2024-12-09. https://arxiv.org/abs/2412.07031. Read 2026-11-13.
5. Karger, E. et al. "ForecastBench: A Dynamic Benchmark of AI Forecasting Capabilities." arXiv:2409.19839, 2024-09-30. https://arxiv.org/abs/2409.19839. Read 2026-11-13.
6. He, S., Lv, L., Manela, A. and Wu, J. "Chronologically Consistent Large Language Models." arXiv:2502.21206, v1 2025-02-28, v3 2025-07-06. https://arxiv.org/abs/2502.21206. Read 2026-11-13.
7. Drinkall, F., Rahimikia, E., Pierrehumbert, J. B. and Zohren, S. "Time Machine GPT." arXiv:2404.18543, 2024-04-29. https://arxiv.org/abs/2404.18543. Read 2026-11-13.
8. Wu et al. "Anonymization and Information Loss." arXiv:2511.15364, 2025 (v2). https://arxiv.org/abs/2511.15364. Read 2026-11-13. Authors not extracted.
9. "Summoning the Oracle to Slay It" (FinCAD). arXiv:2605.24564, May 2026. https://arxiv.org/abs/2605.24564. Read 2026-11-13. Title from search result.
10. Chen, R., Ternasky, J. et al. "VCBench: Benchmarking LLMs in Venture Capital." arXiv:2509.14448, submitted 2025-09-17. https://arxiv.org/abs/2509.14448 and https://arxiv.org/html/2509.14448v1. Read 2026-11-13. Author list from search result.
