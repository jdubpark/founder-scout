## README

The hunt can search the open web through Claude's native WebSearch tool. Search links come from tool results and each search runs as a budgeted job.

## Design

The `web` engine delegates to `hunt.search` when its provider supports native search. The job asks Claude to call WebSearch once with the supplied query. The provider reads links only from WebSearch tool results and ignores assistant prose. Search failures count as blocked calls. Successful hits pass through the existing URL checks and result sifter.

The search task shares the hunt stage spend cap. Its allowance has a separate observed cost from page reads, so search spend does not change the expected cost of a runner read. Simulated web access stays unchanged, and the simulated search job returns no hits.

## Rules

- A search hit address must come from a provider search tool result. Assistant prose cannot add a hit. Test: `packages/core/src/providers/claude-cli.test.ts`.
- A live model-backed web search runs as `hunt.search` inside the hunt budget, and its numbered hits reach the sifter. Test: `packages/core/src/engine/hunt.test.ts`.
