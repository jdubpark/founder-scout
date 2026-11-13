# Building dashboard pages

Read this before writing any page. The product context is in `/PRODUCT.md` and the
visual direction in `apps/web/.impeccable/surfaces/apps-web-index-html.md`.

## Who reads these pages

A venture partner who is not an engineer. They think in founders, theses and meetings.
Write every label, hint and message in their words. A technical operator uses the same
pages, so nothing is hidden, but nothing assumes knowledge of models, prompts or tokens.

## Where things are

| Need | Use |
| --- | --- |
| Data and changes | hooks in `src/lib/queries.ts`. Never call the API client directly. |
| Current swarm | `useSwarm()` from `src/lib/swarm.tsx` |
| Demo mode flag | `useApi().demo` from `src/lib/api/context.tsx` |
| Confirmations and failures | `useToast()`: `done("Rule saved")`, `problem("The rule was not saved", error.message)` |
| Server validation errors | `ApiError` from `src/lib/api/http.ts`, with `.fields` keyed by input name |
| Formatting | `src/lib/format.ts` (`score100`, `percent`, `usd`, `ago`, `dateShort`, `plural`, ...) |
| Status words and marks | `STATUS_VIEW`, `DECISION_LABEL`, `getStage` in `src/lib/stages.ts` |
| Rubric, jobs, classes, parameters | `@agentswarm/shared` (`DIMENSIONS`, `JOBS`, `AGENT_CLASSES`, `PARAM_DEFS`, `getParamDef`, `getModel`, `paramsFor`, `scopeMatches`, ...) |
| Components | `src/components/ui/*` and `src/components/SurfacedAnnouncement.tsx` |
| Icons | `lucide-react`, 16px, one stroke weight. Never emoji or Unicode symbols. |

The kit: `Button`, `IconButton`, `Field`, `Input`, `Textarea`, `Select`, `Switch`, `Segmented`,
`Panel`, `PageHeader`, `EmptyState`, `ErrorNote`, `Skeleton`, `SkeletonRows`, `Fact`, `Meter`,
`Table`, `TableScroll`, `Th`, `Tr`, `Td`, `Tabs`, `TabList`, `Tab`, `TabPanel`, `Sheet`, `Hint`,
`StateMark`, `Status`, `HealthStatus`, `Chip`, `Caution`, `ScopeLabel`, `KindChip`.
Do not edit the kit. Put components that only your pages need in your own `src/features/<area>/` folder.
If the kit is missing something every page needs, say so in your report.

## Tokens (Tailwind utilities). Nothing else exists.

- Paper: `bg-ground` (page), `bg-surface` (raised), `bg-sunk` (tracks), `border-rule`, `border-rule-strong`.
- Ink: `text-ink`, `text-ink-2` (secondary), `text-ink-3` (tertiary, small labels).
- Green operates and selects: `green`, `green-2`, `green-3`, `green-tint`, `on-green`.
- Gold means "surfaced" and nothing else: `gold`, `gold-ink`, `gold-tint`.
- Red is only ever a caution (simulated, unverified, flagged, failed): `red`, `red-tint`.
- Bistre is the watchlist and the second data series: `bistre`, `bistre-tint`. `navy` is the third data series only.
- Type sizes: `text-2xs`, `xs`, `sm`, `base`, `md`, `lg`, `xl`, `2xl`, `3xl`. Fonts: `font-sans` (everything), `font-serif` and `.name-caps` (founder names, page and panel titles only), `font-mono` (transcripts, code and ids only).
- `.label-caps` for table heads, `.figure` for numbers, `.prose-measure` for running text.
- Corners are square (`rounded-sm` on controls only). The only shadow is `shadow-overlay`, for things that float.
- The default Tailwind colours, radii and shadows have been removed. `bg-gray-100` does not exist.

For charts (Recharts), pass colours as CSS variables, for example `stroke="var(--color-green-2)"`,
and set axis and legend text to `var(--color-ink-3)` at 12px.

## Rules

1. Regions, not cards. A `Panel` is a ruled region on the paper. Use `boxed` only for a separate object such as a draft to approve. Never nest boxes.
2. No row of big-number tiles, no small label above a heading, no coloured stripe down the side of anything, no gradients, no decorative sparklines or progress rings.
3. State is a mark plus a word (`Status`, `HealthStatus`), never colour alone.
4. Put each claim beside its proof on the same screen. Never send the reader to another tab for the evidence behind a number.
5. A panel's `aside` says what needs a person there, or a count, or holds the panel's one action.
6. One `primary` button per view at most.
7. Every view handles loading (`SkeletonRows`), empty (`EmptyState` that says what will appear and how to make it appear), failure (`ErrorNote` with what to do), and long text (truncate or wrap, never clip).
8. Scores are shown on a 0 to 100 scale with `score100`. Cost goes through `usd`, which prints "not priced" when the cost is unknown: never show $0.00 for an unknown cost.
9. Say what is simulated, estimated or unverified, with `Caution`.
10. Copy: plain sentences, active voice, buttons name what happens ("Approve and queue", "Save rule"). Errors say what went wrong and what to do. No em dashes, no exclamation marks, no jargon.
11. Prefer inline editing and side-by-side detail. Use `Sheet` only to read one long record. No modal dialogs.
12. Works at 390px wide: grids collapse to one column, tables scroll inside `TableScroll`, the page itself never scrolls sideways. Everything is reachable by keyboard and inputs are labelled through `Field`.

## Running and looking

A dev server is already running at http://localhost:5317. Do not start another and do not stop it.
Open your pages with `?demo` on the URL you load, for example http://localhost:5317/founders?demo.
That runs on sample data in memory: steering, feedback and approvals can be changed; starting runs,
running evals and creating swarms answer with a clear "demo" error, which your page must show as a problem toast.

Look at what you built, in your own browser session so you do not collide with other workers:

```
agent-browser --session <your-name> set viewport 1440 900
agent-browser --session <your-name> open "http://localhost:5317/<page>?demo"
agent-browser --session <your-name> screenshot --full /tmp/<your-name>-desktop.png
agent-browser --session <your-name> set viewport 390 844   # then reload and screenshot again
agent-browser --session <your-name> errors                 # console errors
agent-browser --session <your-name> close
```

Read the screenshots, fix what you see in one batch, look once more. Two rounds at most.

Check types with `pnpm --filter @agentswarm/web typecheck`. Other workers are writing other pages
at the same time, so report only errors in your own files.
