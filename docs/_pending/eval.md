## README

The Hunt yield eval compares hunt settings on fixed simulated worlds. It measures how many strong early founders the hunt keeps for the runner calls it uses. Its results describe the simulator only.

## Design

- The service runs each case with a fresh in-memory store, a seeded simulated world, one swarm, and three hunt-only runs.
- Hunt trials join kept people to hidden founder quality, stage, and web visibility inside the service. None of those fields enter a prompt.
- The eval uses 16 fixed worlds, eight for proposing and eight held out for measurement. Each world runs for three days.
- The baseline and every candidate keep wave size and navigator turns fixed. Proposals change one tunable hunt setting at a time.
- `strong_early_found` is the share of strong early founders visible on the web by the final day that the hunt kept. `late_kept`, planted-page failures, and runner calls are lower-is-better guardrails.
- The noise floor is a deterministic bootstrap over held-out worlds. The shared candidate decision gate decides whether a measured candidate is kept.
- Simulated brain is free. A live baseline can read the simulated web within its budget. Live automatic rounds return conflict until a spending approval path exists.
- Per-model page, kept-person, page-check refusal, planted-page failure, and latency summaries make runner behavior visible.
- `realData` is false. Autopilot must not apply this result without a person.

## Rules

- Hidden simulator truth is joined only in `service/hunt-trial.ts`, after a hunt finishes. The service boundary test `packages/core/src/service/hunt-trial.test.ts` fails if kept people are not web-backed or if a repeated trial changes.
- Train worlds choose proposals; held-out worlds decide them beyond the bootstrap noise floor. `packages/core/src/eval/index.test.ts` fails if a train-only gain is kept or a clear held-out gain is reverted.
- Wave size and navigator turns stay fixed across variants so the headline compares the same call budget. `packages/core/src/eval/index.test.ts` checks the flow's held-out decision path.
