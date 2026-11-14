# Hunt-yield eval repair notes

## README

- Describe the hunt-yield headline as distinct strong early founders found per 100 runner calls. Report the late-found, weak-found, planted-failure, and call guardrails, with found and fit-kept counts as context.

## Design

- The denominator is runner calls. The numerator uses each simulated founder's hidden quality and true company stage, and counts a reported lead before the separate fit screener. The screener's kept count is reported separately.
- Simulated search trails lead to different featured places: Hacker News to a rich early-founder directory, GitHub to a sparse job-board directory, and web search to a small-team directory. The navigator can shift attention using observed leads per page and can extend the best-yield trail.
- Project pages link to generic archived build notes. These links consume deeper crawl calls without introducing founders, so `hunt.max_depth` changes yield rather than only page volume.
- The rounds evaluate one tunable setting at a time (`hunt.pages_per_search`, `hunt.stale_after`, `hunt.max_depth`) on train worlds. Candidate retention remains `decideCandidate`, with a bootstrap noise floor over worlds.

## Rules

- State that this is a simulated web used to tune how the hunt spends its calls. The result says nothing about real founders.
- Simulated trials use a fixed internal budget independent of `SIM_TRIAL_BUDGET_USD`; live-brain baselines use the caller's budget, and live-brain rounds remain refused.
- The app passes its skill library and default model pools into the trial so live-brain prompts and model selection follow ordinary runs.

## Measurement

- Baseline, simulated brain, default config, 3 days, 16 fixed worlds: **14.167 strong early founders per 100 calls**, 95% bootstrap range **[11.670, 16.825]**, with **16/16** worlds above zero. Noise floor: **1.644** (bootstrap standard deviation over held-out worlds). Mean calls: **61.9**; found: **31.0**; fit-kept: **1.0**.
- Paired comparison on the same 16 worlds, simulated brain, same skills, pools, and budget: default config **14.167** per 100 calls vs. the low-boundary config (`hunt.pages_per_search=1`, `hunt.stale_after=5`, `hunt.max_depth=0`) at **11.896**. The default-minus-boundary difference is **2.270**, above the **1.644** noise floor; its paired bootstrap 95% range is **[-1.455, 6.214]**, which includes zero. Mean calls were **61.9** vs. **22.3**; found were **31.0** vs. **8.9**; fit-kept were **1.0** vs. **0.4**. The fixed-equal-attention control did not produce a difference above noise, so this report uses the permitted tunable-boundary comparison.
- Three CLI rounds: (1) `hunt.max_depth` 2→1, train headline **21.353** and calls **95.3**, held-out **19.760** and calls **84.4**, reverted; (2) `hunt.max_depth` 2→3, train **15.950** and calls **56.6**, held-out **11.442** and calls **67.3**, reverted; (3) `hunt.pages_per_search` 3→2, train **15.655** and calls **61.5**, held-out **12.678** and calls **62.4**, reverted. These figures are means across the 8 train or 8 held-out worlds. Full guardrail and found/kept figures are in the CLI narrative.
