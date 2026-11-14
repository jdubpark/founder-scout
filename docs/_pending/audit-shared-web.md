# Shared and web test audit

## Baseline and final counts

The lane excludes `packages/shared/src/context.test.ts`. Test counts are Vitest test cases (`assertionResults`); line counts are physical test-file lines. Baseline was collected before edits. The full command still includes the excluded context file.

| Test file | Baseline tests / lines | Final tests / lines |
| --- | ---: | ---: |
| `apps/web/src/features/assumptions/model.test.ts` | 10 / 77 | 10 / 77 |
| `apps/web/src/features/hunt/model.test.ts` | 7 / 61 | 7 / 61 |
| `apps/web/src/features/improve/preview.test.ts` | 5 / 35 | 4 / 32 |
| `apps/web/src/features/improve/runPlan.test.ts` | 8 / 57 | 7 / 54 |
| `apps/web/src/features/improve/variants.test.ts` | 3 / 34 | 3 / 34 |
| `apps/web/src/features/swarm/contextGrid.test.ts` | 8 / 74 | 4 / 57 |
| `apps/web/src/features/swarm/poolDraft.test.ts` | 12 / 96 | 9 / 87 |
| `apps/web/src/features/swarm/poolFigures.test.ts` | 5 / 57 | 5 / 57 |
| `packages/shared/src/assumptions.test.ts` | 13 / 139 | 11 / 124 |
| `packages/shared/src/company.test.ts` | 14 / 144 | 11 / 119 |
| `packages/shared/src/feedback.test.ts` | 20 / 222 | 18 / 206 |
| `packages/shared/src/hunt.test.ts` | 31 / 423 | 27 / 380 |
| `packages/shared/src/ids.test.ts` | 3 / 22 | 2 / 19 |
| `packages/shared/src/judgments.test.ts` | 4 / 47 | 1 / 40 |
| `packages/shared/src/past.test.ts` | 8 / 98 | 5 / 81 |
| `packages/shared/src/policy.test.ts` | 9 / 56 | 9 / 57 |
| `packages/shared/src/pools.test.ts` | 20 / 217 | 14 / 159 |
| `packages/shared/src/scoring.test.ts` | 17 / 192 | 17 / 193 |
| `packages/shared/src/skills.test.ts` | 7 / 21 | 7 / 21 |
| `packages/shared/src/stats.test.ts` | 10 / 86 | 10 / 86 |
| `packages/shared/src/steering.test.ts` | 19 / 320 | 17 / 309 |
| **Lane total** | **233 / 2,478** | **198 / 2,253** |

`pnpm exec vitest run packages/shared apps/web` includes context: baseline 22 files / 239 tests; final 22 files / 204 tests.

## Deleted and merged tests

- `assumptions.test.ts` — “gives every assumption its own id and points only at settings that exist”: **no contract**; copied metadata/reference inventory, not a behavior boundary.
- `assumptions.test.ts` — “holds unstated assumptions as well as stated ones, in every area”: **no contract**; fixed inventory/count assertion.
- `company.test.ts` — “has default weights that sum to 16.5, the figure the hand-worked cases below use”: **no contract**; sum of constants is a fixture, while scoring outcomes remain tested by `packages/shared/src/company.test.ts > shrinks one confident answer toward the prior by hand-worked amounts`.
- `company.test.ts` — “does not count an answer that cites no supplied evidence”: remaining helper proof is `packages/shared/src/company.test.ts > does not score company judgments that cite no supplied evidence`.
- `company.test.ts` — “uses the company's own site and ignores hosts many companies share”: remaining production-path proof is `packages/core/src/engine/company-stages.test.ts > merges exact company identities and ignores shared hosting as a domain`.
- `company.test.ts` — “drops legal suffixes from a name and nothing else”: remaining production-path proof is `packages/core/src/engine/company-stages.test.ts > merges exact company identities and ignores shared hosting as a domain`.
- `feedback.test.ts` — “keeps only the most recent call per founder”: latest-call use remains covered by `packages/shared/src/feedback.test.ts > counts a founder once, by their latest call` and `packages/core/src/service/index.test.ts > groups overview runs by UTC day and summarizes only each founder's latest call`.
- `feedback.test.ts` — “proposes nothing until three recent calls share a reason” and “turns three 'outside thesis' calls into a higher thesis-fit bar, with the count behind it”: merged as `packages/shared/src/feedback.test.ts > turns only three recent calls sharing a reason into a steering suggestion`.
- `hunt.test.ts` — “is too late only when the page states a later round than the fund wants”: stronger persisted hunt proof is `packages/core/src/engine/hunt.test.ts > counts a page that states a round past the latest stage as too late without keeping its people`.
- `hunt.test.ts` — “stores an address in one form”: merged into `packages/shared/src/hunt.test.ts > refuses anything that is not a public page the system may request`.
- `hunt.test.ts` — pinned/paused assertions were removed from “keeps a pinned trail open and holds the ceiling on open trails”; the complete race with concurrent person changes is covered by `packages/core/src/engine/hunt.test.ts > never undoes what a person did to a trail while the navigator was thinking`.
- `hunt.test.ts` — “gives a trail that found people more of the wave than one that found nobody”: stronger wave allocation proof is `packages/core/src/engine/hunt.test.ts > gives more of each wave to a trail that keeps finding people than to one whose companies are all too late`.
- `hunt.test.ts` — “closes a trail that read enough and found nobody, unless a person pinned it”: persisted stale closure and pin handling remain covered by `packages/core/src/engine/hunt.test.ts > closes a stale trail by code and keeps a pinned trail open`.
- `ids.test.ts` — “gives the same id for the same seed and different ids for different seeds”: merged into `packages/shared/src/ids.test.ts > builds stable, unique ids in the stored id alphabet`.
- `judgments.test.ts` — “returns one judgment per rubric dimension, in rubric order, with the unanswered ones unsettled”: merged into `packages/shared/src/judgments.test.ts > returns rubric order and grounds the last answer with verified evidence`.
- `judgments.test.ts` — “does not count an answer that cites nothing, or only ids that were never supplied”: helper proof remains `packages/shared/src/judgments.test.ts > returns rubric order and grounds the last answer with verified evidence`; the surfaced-founder consequence is also covered by `packages/core/src/engine/index.test.ts > treats an answer that cites no verified evidence as unsettled, so it cannot surface a founder`.
- `judgments.test.ts` — “counts an answer that rests on evidence against, keeps real ids and drops invented ones”: merged into `packages/shared/src/judgments.test.ts > returns rubric order and grounds the last answer with verified evidence`.
- `judgments.test.ts` — “rounds and clamps levels and confidence, and lets the last answer for a dimension win”: merged into `packages/shared/src/judgments.test.ts > returns rubric order and grounds the last answer with verified evidence`.
- `past.test.ts` — “removes the company, its people, its sites, its accounts and every year” and “leaves words that only contain a masked name, and ordinary numbers, alone”: merged into `packages/shared/src/past.test.ts > removes names, sites, accounts and years without damaging unrelated words`.
- `past.test.ts` — “counts a guess that names the company, an alias or a founder, however it is spelled around it” and “does not count a wrong guess, an empty one, or a first name alone”: merged into `packages/shared/src/past.test.ts > recognises a company or founder despite spelling variation, and rejects unrelated guesses`.
- `past.test.ts` — “tunes on the earlier cohorts and holds out the later ones”: higher-level split and reuse proof is `packages/core/src/eval/past.test.ts > splits earlier cohorts for training, keeps a generalizable company weight, and reuses cached judgments`.
- `pools.test.ts` — “sends the same task to the same member every time”: the model-picking path is covered by `packages/shared/src/steering.test.ts > gives a task to a pool member, the same one each time, and records which`.
- `pools.test.ts` — “accepts a pool whose active shares add up to one” and “names what is wrong with a pool”: persisted service validation is covered by `packages/core/src/service/pools.test.ts > refuses unknown swarms, non-model jobs and invalid pool members with their fields`.
- `pools.test.ts` — “shares each runner job equally between the runner models that are ready”, “is a pool of one when one key is set, and no pool at all when none is”, “adds a default, DeepSeek and Muse pool for scouts and screening through OpenCode, while a config pool wins”, and “stays behind a pool the config names”: ready-provider and config precedence remain covered by `packages/core/src/service/index.test.ts > resolves both configured runner providers into default pools and lets saved pools replace them`; basic readiness/empty behavior is also kept in `packages/shared/src/pools.test.ts > uses ready runner providers and keeps configured pools ahead of defaults`.
- `steering.test.ts` — “undoes a change when the two ends are exchanged”: baseline rollback is covered at the service boundary by `packages/core/src/service/index.test.ts > puts a variant into use without dropping the swarm's pools, learned lines or another eval's changes`.
- `steering.test.ts` — “changes nothing when the two ends are the same”: merged into `packages/shared/src/steering.test.ts > carries across only what the winner changed, and keeps everything else the swarm has`.
- `scoring.test.ts` — “uses the last judgment when a dimension is answered twice” was first removed, then restored after a first-wins mutation passed the remaining tests. The kept proof is `packages/shared/src/scoring.test.ts > uses the last judgment when a dimension is answered twice`.
- `preview.test.ts` — “lists everything and counts nothing when there are eight or fewer”: merged into `apps/web/src/features/improve/preview.test.ts > shows at most eight flips and counts the rest`.
- `runPlan.test.ts` — “shows a dash when no interval is known”: merged into `apps/web/src/features/improve/runPlan.test.ts > formats known intervals and leaves unknown ones blank`.
- `contextGrid.test.ts` — “has one row per pool, in pool order”: **no contract**; copies the `CONTEXT_POOLS` inventory.
- `contextGrid.test.ts` — “is empty for a job that calls no model”, “always includes steering and learned lines for a model job”, and “never includes a sealed pool”: merged into `apps/web/src/features/swarm/contextGrid.test.ts > shows model inputs and keeps sealed pools out of every job`.
- `contextGrid.test.ts` — “carry the labels of both pools”: **no contract**; compares each row's labels with labels looked up through that same row's IDs.
- `poolDraft.test.ts` — “converts percentages to fractions” and “sends shares that do not add up as they are, for the server to refuse”: merged into `apps/web/src/features/swarm/poolDraft.test.ts > converts percentages without normalizing shares the server must reject`.
- `poolDraft.test.ts` — “keeps the status and leaves out effort when none was set” and “keeps an effort the member already had”: merged into `apps/web/src/features/swarm/poolDraft.test.ts > keeps member status and preserves an explicitly selected effort`.
- `poolDraft.test.ts` — “makes a readable name from a label” and “adds a number when the name is taken”: merged into `apps/web/src/features/swarm/poolDraft.test.ts > makes a readable unique name from a label`.

`policy.test.ts` only had a more precise test title; no test was removed. `scoring.test.ts` retains its duplicate-input behavior test after mutation disproved the candidate higher-layer keeper.

## Production changes

None. No exports, parameters, wrappers, or other production code were removed. The final production diff is empty.

## Mutation preservation checks

Each intentional source mutation was reverted byte-for-byte. The named keeper failed on the stated behavior. The failed core-job judgment probe is recorded because it exposed the missing helper keeper; the direct shared helper test was restored and then failed under the corrected mutation.

| Production mutation | Keeper that failed |
| --- | --- |
| `packages/shared/src/policy.ts`: made `isNeverFetchHost` always false | `packages/shared/src/policy.test.ts > covers the host, its subdomains, and odd spellings, and nothing that merely looks similar` |
| `packages/shared/src/hunt.ts`: bypassed `isOffLimitsHost` in `cleanUrl` | `packages/shared/src/hunt.test.ts > refuses anything that is not a public page the system may request` |
| `packages/shared/src/hunt.ts`: bypassed the on-page name check | `packages/core/src/engine/hunt.test.ts > drops a person who is absent from the page and marks a planted-page report as failed` |
| `packages/shared/src/hunt.ts`: made `tooLate` always false | `packages/core/src/engine/hunt.test.ts > counts a page that states a round past the latest stage as too late without keeping its people` |
| `packages/shared/src/hunt.ts`: made `trailScore` constant | `packages/core/src/engine/hunt.test.ts > gives more of each wave to a trail that keeps finding people than to one whose companies are all too late` |
| `packages/shared/src/company.ts`: made `companyIdentityDomain` always null | `packages/core/src/engine/company-stages.test.ts > merges exact company identities and ignores shared hosting as a domain` |
| `packages/shared/src/company.ts`: stopped dropping legal suffixes in `normalizeCompanyName` | `packages/core/src/engine/company-stages.test.ts > merges exact company identities and ignores shared hosting as a domain` |
| `packages/shared/src/pools.ts`: bypassed member-ID validation | `packages/core/src/service/pools.test.ts > refuses unknown swarms, non-model jobs and invalid pool members with their fields` |
| `packages/shared/src/pools.ts`: made `pickMember` return null | `packages/shared/src/steering.test.ts > gives a task to a pool member, the same one each time, and records which` |
| `packages/shared/src/pools.ts`: counted all items instead of supported items in `memberYield` | `packages/shared/src/pools.test.ts > counts supported items for each dollar, and nothing for a job that produces no evidence` |
| `packages/shared/src/hunt.ts` and `packages/core/src/engine/hunt.ts`: bypassed pin/pause checks and allowed navigator closes through | `packages/core/src/engine/hunt.test.ts > never undoes what a person did to a trail while the navigator was thinking` |
| `packages/shared/src/hunt.ts`: made `plantedDue` always false | `packages/core/src/engine/hunt.test.ts > drops a person who is absent from the page and marks a planted-page report as failed` |
| `packages/shared/src/past.ts`: made `maskText` return the original text | `packages/shared/src/past.test.ts > removes names, sites, accounts and years without damaging unrelated words` |
| `packages/core/src/eval/past.ts`: selected report/test cohorts instead of train cohorts for outcome evidence | `packages/core/src/eval/past.test.ts > returns read-only clean train evidence with per-repetition score and level means` |
| `packages/shared/src/steering.ts`: made `overlayConfig` return the current config unchanged | `packages/core/src/service/index.test.ts > puts a variant into use without dropping the swarm's pools, learned lines or another eval's changes` |
| `packages/shared/src/steering.ts`: stopped deleting a parameter when restoring the baseline variant | `packages/core/src/service/index.test.ts > puts a variant into use without dropping the swarm's pools, learned lines or another eval's changes` |
| `packages/shared/src/judgments.ts`: kept the first answer instead of the last | `packages/shared/src/judgments.test.ts > returns rubric order and grounds the last answer with verified evidence` |
| `packages/shared/src/judgments.ts`: allowed uncited company judgments to count | `packages/shared/src/company.test.ts > does not score company judgments that cite no supplied evidence` |
| `packages/shared/src/ids.ts`: made `stableId` return one fixed suffix | `packages/shared/src/ids.test.ts > builds stable, unique ids in the stored id alphabet` |
| `packages/shared/src/past.ts`: removed the `at <= limit` cut-off comparison | `packages/core/src/eval/past.test.ts > keeps the judging pack masked and cut off, and excludes recognised cases from the headline` |
| `packages/shared/src/scoring.ts`: made the first duplicate-dimension judgment win | `packages/shared/src/scoring.test.ts > uses the last judgment when a dimension is answered twice` |

The first attempted stable-ID probe altered `newId`, so the stable-ID keeper passed; the corrected mutation targeted `stableId` and failed as expected. A first multi-edit restoration left one temporary pause-condition edit; `git diff` exposed it, it was restored, and the final production diff is empty.

The first last-answer mutation was checked against `packages/core/src/jobs/index.test.ts > keeps only the last judgment per dimension, valid evidence IDs, rounded levels, and clamped confidence`; that test passed because it exercises job normalization, not `groundJudgments`. The direct shared helper keeper was restored and failed under the same mutation. The 21 mutations in the table are the final keeper checks that failed as intended.

## Kept tests with uncertain redundancy

- `packages/shared/src/skills.test.ts > applies %s deterministically`: kept because the core host-matched skill test does not cover all seven selection, budget, opt-out, and cap cases; whether every row is needed remains uncertain.
- `packages/shared/src/stats.test.ts`: kept because eval-level tests do not obviously replace all interval, within-group pairing, and shuffle-baseline contracts; there may be overlap in the eval lane.
- `apps/web/src/features/assumptions/model.test.ts`: kept because it covers displayed counts, grouping, and interval labels, but the page-level tests are outside the audited lane and no exact rendered-page keeper was mapped.

## Product bugs

None found in this test-pruning pass.

## Final checks

- `pnpm exec vitest run packages/shared apps/web`: 22 files and 204 tests passed (includes the out-of-lane context file).
- `pnpm typecheck`: all four checked workspace projects passed.
- `pnpm exec vitest run packages/core/src/rules.test.ts`: 1 file and 6 tests passed.
