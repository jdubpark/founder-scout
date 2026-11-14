## README

Export one row per company and date the fund considered it, then run `pnpm swarm past import --file deals.csv --bar "our words for what counts as success"`. The importer merges labelled rows into `evals/datasets/past-founders/cases.jsonl`; use `pnpm swarm past show` to review the combined dataset. Keep each summary to evidence known on the `seen` date. Do not add hindsight: the importer cannot detect it.

## Design

- A deal is one company as seen on one date; month-only dates use the first day of that month.
- Quarter cohorts follow the UTC seen date, as they do for launch posts.
- Stable `past_deal_` ids hash the normalized company name and date, separate from launch ids.
- CSV headers are case-insensitive and ignore spacing; quoted commas, quotes, and newlines are supported.
- Outcomes accept the listed yes/no aliases; unknown outcomes are skipped, never labelled as misses.
- Valid cases merge by id into the existing past-founders dataset.
- Decision, company names, founder names, and domains remain metadata for masking and later analysis.

## Rules

- Unknown outcomes stay out rather than becoming failures: `packages/core/src/sources/deals.test.ts`.
- Invalid required fields and dates are refused without printing company names: `packages/core/src/sources/deals.test.ts`.
- Sensitive personal-detail sentences are removed before storage: `packages/core/src/sources/deals.test.ts`.
- Reimporting a company and date updates the same case id: `packages/core/src/sources/deals.test.ts`.
- Investment decisions are retained on cases and absent from masked judge evidence: `packages/core/src/sources/deals.test.ts`.
