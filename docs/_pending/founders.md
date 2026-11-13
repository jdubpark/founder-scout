## README

Founder rows show each matched company's industry, current round, website tagline, and evidence-backed moat beside the founder's status and score. Company pages also show the tagline and moat.

## Design

A company's tagline is copied from the lead line on its own site and stored with the page address. Live mission and tagline text is kept only when the page checker finds the exact words; if the checker cannot confirm it, the field stays empty. Simulated company profiles supply synthetic taglines.

The company analyst can return one cited moat sentence or null. Code keeps the point only when it cites supplied verified company evidence. The moat is descriptive text, not a score.

Founder list rows use matched company sector, company stage then founder stage then the latest sourced hunt stage, exact tagline then company one-liner, and the latest company assessment's moat. Unknown or missing values stay empty. Round text is normalized to a short label in shared logic.

The Founders table uses fixed column proportions at desktop widths. Company and moat receive the flexible text columns, with truncation and full text on hover. The company detail page shows the same sourced fields where they fit.

## Rules

- A company moat without verified citations is dropped, and a cited moat stays on the brief. `packages/core/src/engine/company-stages.test.ts` fails if grounding changes.
- Live company mission and tagline text must match the page at its cited address before storage. `packages/core/src/engine/company-stages.test.ts` fails if an unsupported tagline is stored.
- Free-text company rounds use a shared short label; unknown stages stay empty. `packages/shared/src/hunt.test.ts` covers observed spellings.
- Founder rows derive company details and the latest assessment moat from matched records. `packages/core/src/db/store.test.ts` and `packages/core/src/service/index.test.ts` cover list row behavior.
