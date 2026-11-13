# Founder and startup success evaluation: prior art

Research date: 2026-11-12.

Method and limits: Every claim below comes from a page I opened (arXiv HTML or abstract pages, NBER, company homepages and blog posts, Anthropic and OpenAI pages) unless it is marked "search snippet only" or sits in the Unverified list. Only WebSearch was available as a search tool; pages were read by downloading them with curl and converting them to text. Numbers are quoted as the source states them. Where I computed a figure from a source's own numbers, the text says so. Some arXiv versions differ; the version used is given.

---

## 1. Published work on predicting founder or startup success with LLMs or ML

### 1.1 VCBench (Chen, Ternasky, et al.; University of Oxford and Vela Research)

- Dataset: 9,000 anonymized founder profiles, 810 labelled successful, 9% base rate. Founders are paired with their most recently founded company. U.S. companies founded 2010–2018; the paper says this covers about one fifth of an estimated 45,000-company base population. (https://arxiv.org/html/2509.14448v2, v2 dated 05 May 2026; first posted Sept 2025)
- Success label: the company was acquired or IPO'd above $500M, or raised more than $500M. Companies that raised $100K–$4M and had no exit, IPO, or substantial follow-on funding within eight years are labelled unsuccessful. The paper gives the eight-year horizon as expert practice, and lists right-censoring of recent cohorts as a limitation. (https://arxiv.org/html/2509.14448v2, 05 May 2026)
- Human reference points, as stated: market index 1.9% precision at inception; Y Combinator 3.2%; tier-1 VC firms 5.6%. The paper says these are relative to a 1.9% real-world rate. (https://arxiv.org/html/2509.14448v2, 05 May 2026)
- Results on the leaderboard (six folds of 1,500, averaged; F0.5 weights precision twice as heavily as recall):
  - GPT-4o: precision 29.1%, recall 16.2%, F0.5 25.1%. The paper states this is 3.2 times the precision baseline and above the 2.9 for tier-1 VC firms. (https://arxiv.org/html/2509.14448v2, 05 May 2026)
  - DeepSeek-V3: precision 59.1%, recall 3.0%, F0.5 11.8%.
  - Gemini-2.5-Flash: precision 12.6%, recall 69.1%, F0.5 15.1%.
  - GPT-5: precision 53.7%, recall 4.3%, F0.5 16.2%.
  - The abstract says DeepSeek-V3 delivers "over 6×" the baseline precision. (Table 4, same source.)
- Stated caveats: the 9% prevalence is inflated relative to 1.9%, and "precision does not scale linearly with prevalence", so multipliers may not hold at the real rate. Human and model baselines differ in deal-flow access. Data comes from LinkedIn and Crunchbase and under-covers non-tech, self-funded, and underrepresented founders. (https://arxiv.org/html/2509.14448v2, 05 May 2026)
- Anonymization and leakage: entry-level removal of names, companies, locations, and dates. Industry labels clustered into 61 clusters of at least 10 founders each. QS university rankings kept, job durations bucketed. Iterative loop that tests re-identification with o3 and retains a change only if it reduces identification. (https://arxiv.org/html/2509.14448v2, 05 May 2026)
- Re-identification test (sample of 300 successful founders; adversaries: DeepSeek-R1 offline, Gemini-2.5-Pro with web search). Processed JSON: 77.0% online, 17.2% offline. Final VCBench format: 15.1% online, 1.3% offline. The body says identifiable founders were reduced by 92%; the abstract says "more than 90%". (https://arxiv.org/html/2509.14448v2, 05 May 2026)
- Leakage check on the fold with high precision (fold 4): identification rates 4.3% (o3) and 7.3% (Gemini with search) on 300 founders. The paper attributes the high precision to founders with extreme outcomes, not identity leakage. (https://arxiv.org/html/2509.14448v2, 05 May 2026)
- Future-leakage control: only 4,500 of 9,000 profiles are released publicly; leaderboard scores are computed on the private half. (https://arxiv.org/html/2509.14448v2, 05 May 2026)
- Public access: leaderboard and resource at vcbench.com (named in the abstract). The licence for the released data is not stated in the sections I read. (https://arxiv.org/abs/2509.14448, Sept 2025)

### 1.2 Policy induction (Founder-GPT line; the paper's author list was not opened)

- Method: an LLM writes a natural-language decision policy from labelled examples. The policy is refined in an in-context loop with LLM self-explanations and optional expert edits, scored by training-set precision. No gradient updates. (https://arxiv.org/html/2505.21427v2, v2 dated 04 Jun 2025)
- Dataset ("founder_cleaned_data"): 1,022 successful and 9,902 failed companies, U.S., founded 2010 or later. Success label: IPO or acquisition above $500M, or raised more than $500M and still operating. Failure: founded 2010–2020, raised $100K–$4M, still operating, no reasonable sign of success. (https://arxiv.org/html/2505.21427v2, 04 Jun 2025)
- Leakage handling: company and founder names were excluded; only the Crunchbase profile, LinkedIn profile, and label were used. The paper says this stops the model from "cheating" by memorizing cases. It does not report a re-identification test. (https://arxiv.org/html/2505.21427v2, 04 Jun 2025)
- Training size: best policy trained on 120 successful and 120 unsuccessful examples; the paper says 60 and 60 were already enough for reasonable policies. A training round took 3–4 hours with GPT-4o-mini. (https://arxiv.org/html/2505.21427v2, 04 Jun 2025)
- Test sets: 100 successful and 1,000 unsuccessful (9.09% base rate); and 40 successful and 2,000 unsuccessful (about 1.96%). (https://arxiv.org/html/2505.21427v2, 04 Jun 2025)
- Results, GPT-4o-mini with the best policy, on the 100/1,000 set: precision 0.645, recall 0.200, F0.5 0.446 (Table 2). Vanilla GPT-4o precision 0.202; vanilla o3 precision 0.229 (Table 1). (https://arxiv.org/html/2505.21427v2, 04 Jun 2025)
- Eight subsets of the 100/1,000 design: mean precision 0.467, mean recall 0.15 (Table 3). The paper notes Test Sets 6 and 7 are weaker and that vanilla GPT-4o is also weaker on them. (https://arxiv.org/html/2505.21427v2, 04 Jun 2025)
- Realistic-rate sets (40/2,000), GPT-4o-mini best policy: mean precision 0.172, recall 0.163; the paper reports an "8.8 lift over random precision" (Table 4). (https://arxiv.org/html/2505.21427v2, 04 Jun 2025)
- Realistic-rate sets, with o3 used only for policy generation: mean precision 0.405, recall 0.150 (Table 5). The paper states this is "more than 20 lift" in the body; the abstract says "over 20" with a symbol lost in the HTML rendering. The abstract also says "7.1" more precise than the 5.6% tier-1 rate. (https://arxiv.org/html/2505.21427v2, 04 Jun 2025)
- Caveats the paper gives: training is nondeterministic and sensitive to prompt phrasing and order; LLMs may still have latent exposure to the dataset; performance varies across data segments. (https://arxiv.org/html/2505.21427v2, 04 Jun 2025)
- Data and code release: not stated in the sections read. (https://arxiv.org/html/2505.21427v2, 04 Jun 2025)
- Relationship to other work: LLM-AR (below) cites "Mu et al., 2025" as a policy-generation study. VCBench cites "Mu et al." for an earlier VC profile study. These two citations are consistent with this paper being Mu et al., but I did not open the author list. (https://arxiv.org/html/2510.22034v1, 24 Oct 2025; https://arxiv.org/html/2509.14448v2, 05 May 2026)

### 1.3 SSFF: Startup Success Forecasting Framework (Wang, Ihlamur, Alican)

- Design: a multi-agent system with a prediction block (random forests and neural networks, plus LLM reasoning), an analysis block, and an external-knowledge block (retrieval). (https://arxiv.org/html/2405.19456v2, v2 dated 19 Apr 2025; first posted May 2024)
- Data: "over 2000 entries" from LinkedIn profiles, with Crunchbase enrichment "subject to licensing restrictions". Success means a company valued above USD 500 million. Segmentation analysis used 1,000 sampled entries per label. (https://arxiv.org/html/2405.19456v2, 19 Apr 2025)
- Evaluation sample: the paper itself calls it "a relatively small, stratified sample of 50 startups" and lists this as a limitation. (https://arxiv.org/html/2405.19456v2, 19 Apr 2025)
- Results on that sample: GPT-4o precision 21.28%, recall 100%, accuracy 26.00%. SSFF-4o accuracy 34%. SSFF-4o-mini accuracy 50.00%, recall 90%, precision 27.27%. (https://arxiv.org/html/2405.19456v2, 19 Apr 2025)
- Headline relative gains stated by the paper: 108.3% over GPT-4o-mini and 30.8% over GPT-4o. (https://arxiv.org/html/2405.19456v2, 19 Apr 2025)
- Over-prediction: the paper reports baseline LLMs "consistently overpredict startup success", which it attributes to "overtrusting founder claims". (https://arxiv.org/html/2405.19456v2, 19 Apr 2025)
- Founder segmentation: L5 founders 3.79 times more likely to succeed than L1; L2 1.12 times (abstract and body). The segmentation prompt defines L5 as founders who built a $100M+ ARR business, took a company public, or achieved a sale above $500M. Several of these criteria are the outcome label itself, so the segmentation and the label overlap. This is my reading of the appendix definition. (https://arxiv.org/html/2405.19456v2, 19 Apr 2025)
- Code: the paper says code is "provided as open-source resources in the appendix". I did not locate a repository link in the text. (https://arxiv.org/html/2405.19456v2, 19 Apr 2025)

### 1.4 GPTree (Xiong, Ihlamur, Alican, Yin; Vela)

- Method: an LLM generates the split criteria of a decision tree, with expert-in-the-loop refinement after training. Backend in the paper: GPT-4o-mini. (https://arxiv.org/abs/2411.08257, submitted 13 Nov 2024; https://arxiv.org/html/2411.08257v1)
- Data: over 115K U.S. companies founded 2014–2016, each raised more than $100K. Base rate in the modelling dataset: 9.9%. (https://arxiv.org/html/2411.08257v1, 13 Nov 2024)
- Benchmarks as stated: index 1.9%, Y Combinator 3.2%, tier-1 VCs 5.6%. The paper says metrics on the 9.9% dataset "should be scaled down 5.5×" to match 1.9%. (https://arxiv.org/html/2411.08257v1, 13 Nov 2024)
- Results (averaged test set): GPTree precision 37.3%, recall 27.1%, F0.5 33.4%. With expert: precision 40.8%, recall 23.4%, F0.5 33.2%. (Table 4, same source.)
- Vanilla GPT-4o precision 15.7% at the 9.9% base rate; the paper says this is 1.59 times the base proportion. (Table 2, same source.)
- Vela's proprietary model, trained without cross-validation, is reported at 17.9% precision after scaling. The paper says it is omitted from academic results. (Section 4.5, same source.)
- Computation note: dividing 37.3% by 5.5 gives about 6.8%. This is my arithmetic, not a figure the paper states.
- Other papers quote different scaled numbers for GPTree: 7.2% (LLM-AR, 2025) and 7.8% (R.A.I.S.E., 2025). I did not reconcile these. (https://arxiv.org/html/2510.22034v1, 24 Oct 2025; https://arxiv.org/html/2504.12090v1, 16 Apr 2025)

### 1.5 Founder-GPT (Xiong and Ihlamur, 2023)

- The paper evaluates founder-idea fit with embeddings, self-play, tree-of-thought, and critique-based refinement. Its abstract gives no numbers and describes the results only as "early promising". (https://arxiv.org/abs/2312.12037, Dec 2023; date taken from the SSFF reference list, since the page did not show it)
- Note: "Founder-GPT" is the 2023 fit-evaluation paper. It is not the policy-induction paper in 1.2.

### 1.6 Random Rule Forest (Griffin, Yin, Vidaurre, Koyluoglu, Ternasky, Alican, et al.; Oxford and Vela Research)

- Method: an LLM generates YES/NO questions from anonymised founder summaries. An equal-weight vote over the strongest questions ("green-flags" scorecard) produces the prediction. (https://arxiv.org/html/2505.24622v4, v4 dated 09 Nov 2026)
- Data: 9,192 founder profiles, U.S. companies founded 2010–2016, raised $100K–$4M at the decision point. Labels follow the VCBench definition. Evaluation: 8,204 founders with 158 successes (1.9%). (https://arxiv.org/html/2505.24622v4, 09 Nov 2026)
- Results (F0.5, nested cross-validation): Rule Forest 0.097; learned-weight elastic net 0.098; best direct LLM prediction 0.088 (o3 few-shot). The paper states that differences of this size are not statistically established at a 1.9% base rate; the bootstrap comparison with elastic net gives a 95% interval of [-0.032, +0.035]. (https://arxiv.org/html/2505.24622v4, 09 Nov 2026)
- Abstract: the share of shortlisted founders who succeed goes "from about 1 in 50 to 1 in 10, and to about 1 in 6 with a handful of expert-written questions". Expert questions raised precision from 0.103 ± 0.015 to 0.164 ± 0.020 and lowered recall from 0.080 to 0.064. (https://arxiv.org/html/2505.24622v4, 09 Nov 2026)
- Sensitivity: the question-generating LLM changes F0.5 substantially (GPT-4o-mini 0.097; Claude Sonnet 4.5 0.079; GPT-5.2 0.048). (https://arxiv.org/html/2505.24622v4, 09 Nov 2026)
- Caveats from the paper: question generation is stochastic; LLM answers "are not independently verified"; learned rules "can encode pedigree signals and may act as proxies for protected characteristics". (https://arxiv.org/html/2505.24622v4, 09 Nov 2026)
- Release: the paper says it releases "only anonymised summary text" and refers to released code. I did not find a repository URL in the text. Paper licence: CC BY 4.0. (https://arxiv.org/html/2505.24622v4, 09 Nov 2026)

### 1.7 LLM-AR (Oct 2025)

- Method: LLM-generated heuristics are distilled into probabilistic rules run in the ProbLog engine, with an iterative policy-evolution loop. (https://arxiv.org/abs/2510.22034, 24 Oct 2025)
- Dataset: 6,000 founders; base rate 10% in the feature-engineered dataset (the paper says it is "inflated from the real-world figure of 1.9%"). Four-fold cross-validation over 12 partitions. (https://arxiv.org/html/2510.22034v1, 24 Oct 2025)
- Results: average cross-validated precision 59.5% and recall 8.7%, "5.9×" the baseline precision. Abstract: 59.5% precision and 8.7% recall on unseen folds. (https://arxiv.org/html/2510.22034v1, 24 Oct 2025)
- Vanilla LLM baselines on the same data (six folds): GPT-4o-mini highest precision at 49.5%. The paper notes the numerical features were converted back to text for this comparison. (https://arxiv.org/html/2510.22034v1, 24 Oct 2025)
- Caveats: only ten iterations and four candidate policies were tested "due to computational constraints"; the paper flags prevalence shift and says its real-world performance "should be interpreted cautiously". (https://arxiv.org/html/2510.22034v1, 24 Oct 2025)

### 1.8 Feature-engineered ensemble for rare events (Sept 2025)

- Method: LLM feature engineering, then XGBoost, Random Forest, and linear models in a layered ensemble. (https://arxiv.org/abs/2509.08140, 09 Sep 2025)
- Abstract: precision 9.8× to 11.1× the random classifier baseline across three test subsets. Feature sensitivity: the startup's category list 15.6% of predictive influence, then the number of founders; education level and domain expertise smaller. (https://arxiv.org/abs/2509.08140, 09 Sep 2025)
- Dataset size and base rate were not checked. This entry rests on the abstract only.

### 1.9 Summary of stated precision figures (not comparable as-is)

| Source | Base rate in eval | Precision reported | Multiplier stated by source |
|---|---|---|---|
| VCBench, GPT-4o (leaderboard) | 9% | 29.1% | 3.2× precision baseline |
| Policy induction, GPT-4o-mini best policy | 9.09% | 64.5% (one 100/1,000 set) | not stated |
| Policy induction, realistic-rate sets | ~1.96% | 17.2% (GPT-4o-mini); 40.5% (o3-policy) | 8.8×; ">20×" |
| GPTree, averaged | 9.9% | 37.3% (40.8% with expert) | 5.5× scaling factor to 1.9% |
| SSFF, 50-startup sample | not stated (stratified) | 27.27% (SSFF-4o-mini) vs 21.28% (GPT-4o) | 108.3% and 30.8% relative accuracy gains |
| LLM-AR, cross-validated | 10% | 59.5% | 5.9× |
| Rule Forest, evaluation set | 1.9% | 0.103 (F0.5 0.097) rising to 0.164 with expert questions | "1 in 50 to 1 in 10" |

Each row uses the source's own base rate and definitions; none uses the same test set.

---

## 2. Empirical findings on founder attributes and startup success

### 2.1 Prior founding experience (serial founders)

- Gompers, Kovner, Lerner, and Scharfstein: founders with a prior successful venture are more likely to succeed than first-time founders and those whose earlier ventures failed. More experienced VC firms improve the odds of success mainly for founders without a successful track record. Experienced VCs can identify first-time founders who later become serial founders. (https://www.nber.org/papers/w12592, working paper 2006; published as Journal of Financial Economics 96(1): 18–32, 2010)
- The published JFE abstract adds that persistence appears in industry and timing choices, and that the evidence fits both a skill and a perception-based explanation. (search snippet only, from https://econpapers.repec.org/RePEc:nbr:nberwo:12592; not opened)
- No effect sizes were in the abstract I opened. Survivorship and selection caveats were not checked in the sources read.

### 2.2 Founder age

- Azoulay, Jones, Kim, and Miranda, using U.S. Census administrative data: "successful entrepreneurs are middle-aged, not young." The mean founder age for the 1-in-1,000 fastest-growing new ventures is 45.0. Findings are "broadly similar" for high-technology sectors, entrepreneurial hubs, and exits. (https://www.nber.org/papers/w24489, NBER working paper 2018)
- The American Economic Review: Insights version is listed as 2020, vol. 2 no. 1, pp. 65–82. (search snippet only, from https://www.aeaweb.org/doi/10.1257/aeri.20180582; not opened)
- The selection caveat (that the gap may partly reflect who chooses to enter entrepreneurship) appears only in a secondary summary. It is not confirmed in the abstract I opened.

### 2.3 Founder segmentation and team background

- SSFF segmentation (L1–L5), covered in 1.3: L5 founders 3.79 times more likely to succeed than L1. The label overlaps with the outcome definition (see 1.3). (https://arxiv.org/html/2405.19456v2, 19 Apr 2025)
- Feature sensitivity from the feature-engineered ensemble: category list 15.6% of predictive influence; number of founders is the next largest; education level and domain expertise are "smaller yet consistent" (abstract only). (https://arxiv.org/abs/2509.08140, 09 Sep 2025)
- VCBench features include QS-ranked education, job role, company size, industry, and job duration. The paper does not report per-feature effect sizes in the sections read. (https://arxiv.org/html/2509.14448v2, 05 May 2026)

### 2.4 Investor response to founding-team information

- Bernstein, Korteweg, and Laws (Journal of Finance, 2017): the average investor responds strongly to founding-team information, not to traction or lead investors; experienced investors respond only to team information. (search snippet only, from https://econpapers.repec.org/RePEc:bla:jfinan:v:72:y:2017:i:2:p:509-538; not opened). This is a finding about investor behaviour, not about outcomes.

### 2.5 Caveats that recur across the sources read

- Right-censoring: VCBench's eight-year window penalises later cohorts. (https://arxiv.org/html/2509.14448v2, 05 May 2026)
- Data coverage: LinkedIn and Crunchbase under-cover non-tech, self-funded, and underrepresented founders. (https://arxiv.org/html/2509.14448v2, 05 May 2026)
- Pedigree proxies: learned rules "may act as proxies for protected characteristics." (https://arxiv.org/html/2505.24622v4, 09 Nov 2026)
- Selection on the outcome: SSFF's L5 definition includes outcome events (see 1.3). (https://arxiv.org/html/2405.19456v2, 19 Apr 2025)
- Founder-idea fit was evaluated qualitatively in Founder-GPT and not quantified in the abstract. (https://arxiv.org/abs/2312.12037, Dec 2023)

---

## 3. How data-driven venture firms use AI in sourcing

Only the firm's own pages were opened for the first three items. Third-party claims are marked.

### 3.1 SignalFire (Beacon AI)

- Beacon is an in-house data platform. The blog says it "tracks and ranks more than 80 million companies, 600 million people, and millions of open-source projects", built on "40 different datasets". (https://signalfire.com/blog/signalfire-beacon-ai; date not shown in the fetched text)
- Stated uses: research on every deal; recommending founders, companies, and open-source projects to contact, "by tracking people's mobility and quantifying some of the essential aspects of teams, companies, and projects". (https://signalfire.com/blog/signalfire-beacon-ai; date not shown)
- Stated LLM use: "to optimize internal data gathering rather than decision-making and communication". The blog calls automated LLM outreach to startups "a disrespectful waste of founders' time." (https://signalfire.com/blog/signalfire-beacon-ai; date not shown)
- Reported accuracy: "LLMs had a precision/recall of ~75% for company sector tagging." (https://signalfire.com/blog/signalfire-beacon-ai; date not shown)
- The blog gives no hit-rate or outcome data for sourcing. A third-party search snippet cites "650 million individuals and 80 million organizations" from a 2026 State of Talent report. (search snippet only; not opened)

### 3.2 EQT (Motherbrain)

- Motherbrain was "initially launched in 2016 by EQT Ventures" and "uses AI to scan, model, and track investment opportunities". (https://tech.eu/2025/11/20/how-eqt-uses-ai-to-see-the-startup-world-differently/, 20 Nov 2025)
- EQT describes Motherbrain as "A powerful synergy of AI and human expertise". Its head of Motherbrain says "I don't see a world where human intervention isn't valued – or even, essential." (https://tech.eu/2025/11/20/how-eqt-uses-ai-to-see-the-startup-world-differently/, 20 Nov 2025; https://eqtgroup.com/thinq/technology/how-exactly-is-eqt-using-ai, date not shown)
- The EQT thinq article says Motherbrain collects and displays internal records, including meeting notes, alongside external facts and figures. It lists deal management, market analysis and monitoring, and talent sourcing as uses. (https://eqtgroup.com/thinq/technology/how-exactly-is-eqt-using-ai, date not shown)
- No hit-rate figure appears in the EQT pages read. The VentureBeat claim of 7 of about 50 investments is not verified (see Unverified).

### 3.3 Vela Partners

- Vela describes itself as "AI-native quant VC", "AI only, since 2017", with seed checks of $100K–$500K. (https://vela.partners/, undated homepage)
- Decision rule as stated: "Two partners and one machine. Any two decide." (https://vela.partners/, undated)
- Research claims on the homepage: "50+ papers published" and a NeurIPS '25 Best Poster award. It links to VCBench and Think-Reason-Learn. (https://vela.partners/, undated)
- Performance claim on the homepage: "Top-decile returns." This is marketing text with no source. It is not verified.

### 3.4 Tribe Capital

- Homepage: "$2.6B AUM venture capital firm focused on harnessing AI and data science", "Founded June 2018", Menlo Park. (https://tribecap.co/, undated)
- A third-party search snippet gives "$2.2B" AUM and says the firm "ingests raw startup data to benchmark and quantify product-market fit and growth". These figures conflict with the homepage. (search snippet only)

### 3.5 Moonfire and Correlation Ventures

- Moonfire homepage: portfolio, thesis, people, technology, and stories sections. The fetched homepage text contains no sourcing methodology. (https://www.moonfire.com/, undated)
- Correlation Ventures: the homepage returned no usable text. Search snippets describe an "analytics-driven co-investor" and a "VC by the Numbers" research series. These are not verified. (search snippets only)

### 3.6 What works or fails

- None of the firm pages read gives a measured result for sourcing hit rate or false positives, apart from SignalFire's sector-tagging precision/recall. The sources reviewed do not document what fails. Claims of performance are marketing text.

---

## 4. Evaluation methodology for a multi-agent research system

### 4.1 Calibrating an LLM judge against humans; agreement levels

- Zheng et al. (MT-Bench and Chatbot Arena): "strong LLM judges like GPT-4 can match both controlled and crowdsourced human preferences well, achieving over 80% agreement, the same level of agreement between humans." (https://arxiv.org/html/2306.05685v4, first posted June 2023)
- The same paper examines position bias, verbosity bias, self-enhancement bias, and limited reasoning ability. (https://arxiv.org/html/2306.05685v4, June 2023)
- MT-Bench questions, 3K expert votes, and 30K human-preference conversations are released via the FastChat repository. (search snippet only, from https://arxiv.org/abs/2306.05685; not opened)
- Anthropic's guidance: "LLM-as-judge graders should be closely calibrated with human experts to gain confidence that there is little divergence." It recommends letting the grader return "Unknown" to avoid hallucinated verdicts. (https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents, 9 Jan 2026)
- Anthropic describes Descript's workflow as moving "from manual grading to LLM graders with criteria defined by the product team and periodic human calibration." (https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents, 9 Jan 2026)

### 4.2 Pairwise preference vs absolute scoring

- MT-Bench defines pairwise comparison as: "an LLM judge is presented with a question and two answers, and tasked to determine which one is better or declare a tie." It notes pairwise comparison "may lack scalability when the number of players increases, given that the number of possible pairs grows quadratically", while single-answer grading "may be unable to discern subtle" differences. (https://arxiv.org/html/2306.05685v4, June 2023)
- The VCBench and policy-induction papers use absolute binary classification with precision-weighted F-scores. (https://arxiv.org/html/2509.14448v2, 05 May 2026; https://arxiv.org/html/2505.21427v2, 04 Jun 2025)

### 4.3 Groundedness and citation accuracy for research agents

- Anthropic: research-agent evals can combine "groundedness checks verify that claims are supported by retrieved sources, coverage checks define key facts a good answer must include, and source quality checks confirm the consulted sources are authoritative." It says LLM-based rubrics "should be frequently calibrated against expert human judgment." (https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents, 9 Jan 2026)
- ALCE (Gao, Yen, Yu, Chen): the first benchmark for automatic citation evaluation of LLM outputs, requiring retrieval, generation, and citation of supporting passages. (https://arxiv.org/abs/2305.14627, submitted 24 May 2023; EMNLP 2023 per search snippet)
- The exact citation precision and recall definitions were not in the abstract I opened. See Unverified.

### 4.4 Backtesting with temporal leakage controls

- VCBench limits data to what was available before each founding date and removes identifiers. It keeps half of the labelled data private. (https://arxiv.org/html/2509.14448v2, 05 May 2026)
- Gao, Jiang, and Yan (Dec 2025): a "Lookahead Propensity" (LAP) statistic is estimated with a date-only recall query. "LAP is materially positive throughout the in-sample period and collapses essentially to zero right after the training-data cutoff." A positive LAP interaction in an accuracy regression indicates lookahead-bias contamination. (https://arxiv.org/abs/2512.23847, Dec 2025)
- The LAP paper's reported effect size is from search snippet only ("0.077%", "about 37% of the baseline LLM effect"). I did not verify it in the full text.

### 4.5 Automated prompt and configuration optimization

- DSPy, MIPRO: optimizes "the free-form instructions and few-shot demonstrations of every module" using Bayesian optimization over candidate combinations, without module-level labels or gradients. The paper releases a seven-program benchmark. (https://arxiv.org/html/2406.11695v2, Opsahl-Ong et al.; June 2024; EMNLP 2024 per search snippet)
- The optimizer name in the paper is MIPRO. "MIPROv2" appears only in third-party docs. (search snippet only, from a third-party page; the paper body was not checked for this)
- Gains reported for MIPRO versus baselines ("five of seven" programs, "up to 13%" accuracy in v1) are from search snippets only and are not verified in the full text.
- GEPA (Agrawal et al., ICLR 2026 oral per search snippet): reflective prompt evolution with a Pareto front of candidates. "Across six tasks, GEPA outperforms GRPO by 6% on average and by up to 20%, while using up to 35x fewer rollouts. GEPA also outperforms the leading prompt optimizer, MIPROv2, by over 10%." Code: github.com/gepa-ai/gepa. (https://arxiv.org/html/2507.19457v2, first posted 25 Jul 2025; v2 revised 14 Feb 2026 per search snippet)
- GEPA's v1 abstract reported a 10% average gain on four tasks, so the v1 and v2 numbers differ. (search snippet only)
- How GEPA avoids overfitting to the eval set is not described in the abstract. The Pareto front is said to avoid local optima. The full paper was not checked for held-out evaluation details.
- TextGrad (Yuksekgonul et al.): "treats LLM-generated textual feedback as a stand-in for gradients" to optimize components of a compound system. Code: github.com/zou-group/textgrad. (https://arxiv.org/abs/2406.07496, submitted 11 June 2024)
- TextGrad's GPQA result (51% to 55% for GPT-4o) is from search snippet only. The Nature publication is not confirmed; search found only the arXiv preprint.
- OpenAI cookbook "Self-Evolving Agents: A Cookbook for Autonomous Agent Retraining": a retraining loop that captures failures and promotes improvements, using human or LLM-as-judge feedback. The example is a pharmaceutical drafting agent. The notebook notes the Evals platform has no API to retrieve user feedback programmatically. (https://developers.openai.com/cookbook/examples/partners/self_evolving_agents/autonomous_agent_retraining; publication date not confirmed in the fetched text)
- Anthropic on regression vs capability evals: regression evals "should have a nearly 100% pass rate"; capability evals with high pass rates can "graduate" into a regression suite. (https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents, 9 Jan 2026)
- Anthropic on metrics: "pass@k measures the likelihood that an agent gets at least one correct solution in k attempts"; "pass^k measures the probability that all k trials succeed." The post gives the example of a 75% per-trial rate giving 42% pass^3. (https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents, 9 Jan 2026)
- Anthropic on overfitting and grader quality: the post recommends reading transcripts and says "make your graders resistant to bypasses or hacks". It also gives a case where an apparent 42% score on CORE-Bench was grading bugs. (https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents, 9 Jan 2026)

### 4.6 Champion/challenger and shadow testing in production

- Not researched. No source was opened for this topic. See Unverified.

---

## Reusable assets

| Asset | What it gives us | Licence | Link |
|---|---|---|---|
| VCBench dataset (4,500 public profiles; 4,500 held out) and leaderboard | Anonymized founder profiles with success labels, 9% base rate; re-identification test results | Not stated in the pages read | https://vcbench.com ; https://arxiv.org/html/2509.14448v2 |
| Random Rule Forest code and anonymised summaries | Question-generation and equal-weight vote pipeline; Kiva microloan dataset (public snapshot) | Paper: CC BY 4.0. Code licence not checked; repository URL not located in text | https://arxiv.org/html/2505.24622v4 |
| MT-Bench questions, expert votes, and human-preference conversations | Judge-agreement reference data | Not checked (FastChat repository) | https://arxiv.org/abs/2306.05685 |
| ALCE benchmark | Citation-evaluation benchmark for generated text with citations | Code and data linked from the arXiv page; licence not checked | https://arxiv.org/abs/2305.14627 |
| DSPy (MIPRO optimizer and benchmark) | Instruction and demonstration optimization for multi-stage LM programs | Not checked | https://dspy.ai ; https://arxiv.org/abs/2406.11695 |
| GEPA | Reflective prompt evolution with Pareto selection | Not checked | https://github.com/gepa-ai/gepa |
| TextGrad | Textual-gradient optimization for compound systems | Not checked | https://github.com/zou-group/textgrad |
| Anthropic eval guidance | Grader types, pass@k and pass^k, regression vs capability evals | Web page; no licence | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents |
| OpenAI self-evolving agents cookbook | Retraining loop with LLM-as-judge graders | Not checked | https://developers.openai.com/cookbook/examples/partners/self_evolving_agents/autonomous_agent_retraining |
| Policy induction (paper only) | Method description; no data release stated | Not stated | https://arxiv.org/html/2505.21427v2 |

---

## Unverified / unknown

- The author list of the policy-induction paper (2505.21427). Its link to "Mu et al." is inferred from citations, not confirmed.
- Whether the Founder-GPT name refers to any work other than arXiv 2312.12037. The Dec 2023 date comes from the SSFF reference list.
- The SSFF code repository. The paper says code is "provided as open-source resources in the appendix", but no link was found.
- SSFF's "L5 founders 3.79 times" and related segmentation figures are not checked against a second source beyond the paper itself.
- The GPTree scaled precision. The paper gives 37.3% on a 9.9% base rate; other papers cite 7.2% and 7.8% after scaling. I did not reconcile these.
- The Gompers et al. JFE abstract and any effect sizes. The NBER abstract was opened; the JFE text was not.
- Azoulay et al.: the AEA Insights publication and its selection caveat. Only the NBER abstract was opened.
- Bernstein, Korteweg, and Laws (2017): the findings are from a search snippet, not the paper.
- Kaplan, Sensoy, and Strömberg (VC evaluation of management teams): not found in search. I have no verified citation.
- The VentureBeat claim that 7 of about 50 EQT Ventures investments were identified by Motherbrain. The EQT promotional claim of 15 sourced investments is also unverified.
- The SignalFire 2026 figures ("650 million individuals and 80 million organizations") are from a search snippet. The blog date is not shown in the fetched text.
- The Tribe Capital "$2.2B" figure from a search snippet and the "Termina" claims. The homepage says $2.6B AUM.
- Vela's "Top-decile returns" and "50+ papers" claims are firm marketing; no independent verification.
- Moonfire and Correlation Ventures: no methodology found in any page opened.
- MIPRO gains ("five of seven", "up to 13%") and how it avoids overfitting. The v2 HTML was opened but the results tables were not checked.
- GEPA overfitting controls and held-out evaluation details. The v1 vs v2 gain discrepancy is from a search snippet.
- TextGrad GPQA result and any Nature publication.
- ALCE citation precision and recall definitions. Only the abstract was opened.
- The LAP paper's effect size (0.077%, 37%). Only the abstract was opened.
- Publication dates for the OpenAI cookbook entry and the SignalFire blog post.
- Whether the policy-induction and VCBench datasets are licensed for reuse. The VCBench licence was not stated in the pages read.
- Champion/challenger and shadow-testing practice in production: not researched.
- Survivorship bias and pedigree bias in the founder-attribute studies, beyond the caveats the papers themselves state.
