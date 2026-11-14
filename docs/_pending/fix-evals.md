# Eval contract updates

- Past-company evaluation routes must not send private deal notes to contributor models. `EVAL_JUDGE` rejects those routes with the standard model to use; past eval job, recognition and guidance calls fall back to each job's default route. Test: `apps/server/src/config.test.ts` and `packages/core/src/eval/past.test.ts`.
- Hunt state is comparable only within one eval definition. Its version changes whenever the metric, worlds, trial days or budget changes; stale or unversioned state is archived and a fresh baseline is measured. Test: `packages/core/src/eval/hunt.test.ts`.
- Hunt candidates use the same effective `hunt.turns` and `hunt.wave_size` as the incumbent. A different call allowance is reverted without held-out trials because the comparison is not like for like. Test: `packages/core/src/eval/hunt.test.ts`.
- Failed, cancelled or budget-stopped hunt runs are incomplete trials, with the budget-stopped error asking for a larger budget. Failed candidate worlds force a revert and are described in the narrative; a failed baseline is not saved. Test: `packages/core/src/eval/hunt.test.ts`.
