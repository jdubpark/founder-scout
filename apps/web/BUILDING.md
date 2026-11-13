# Building dashboard pages

Read this before writing any page. The product context is in `/PRODUCT.md`, the visual
system in `/DESIGN.md`, and the direction for this surface in
`apps/web/.impeccable/surfaces/apps-web-index-html.md`.

## Who reads these pages

A venture partner who is not an engineer. They think in founders, theses and meetings.
A technical operator uses the same pages, so nothing is hidden, but nothing assumes
knowledge of models, prompts or tokens.

## The owner's direction (this overrides anything below that conflicts)

1. **Very simple, and professional.** The model is a well-known team chat app: a dark purple
   sidebar, a white work area, one typeface, rounded and lightly bordered regions, plain lists
   with one obvious action per row. If a screen looks busy, remove things until it does not.
2. **Only the text that is necessary.** No page subtitles or descriptions, no captions, no helper
   sentences under controls, no footnotes or small print, no explanatory paragraphs. A label is
   one to three words. If something truly needs explaining, it goes in a hover `Hint`, and most
   things do not need one. `PageHeader` no longer shows a description: do not work around that.
3. **Diagrams and icons instead of words**, and keep the diagrams simple: few shapes, few labels.
4. **Every candidate gets a Yes or a No, with a reason.** Use `YesNo` wherever a founder appears.
5. **The swarm must be visible and steerable.** Use `SwarmMap`.
6. Light theme only. Desktop only: no phone layouts and no phone screenshots.
7. **A panel with nothing in it is not shown.** No "None yet" under a heading, unless the empty
   state is the page's main content and offers the next step.

The look is set in `src/styles/app.css` and the kit. Do not restyle anything by hand: use the
kit and the tokens, and the pages will match. Typeface, colours and corner radii changed on
2026-11-12; if you wrote classes for the earlier look, check your pages again.

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
| Components | `src/components/ui/*` and the shared visuals in `src/components/` (below) |
| Partner calls | `FEEDBACK_REASONS`, `reasonLabel` from `@agentswarm/shared`; `useAddFeedback`, `useSuggestions`, `useDismissSuggestion` |
| Icons | `lucide-react`, 16px, one stroke weight. Never emoji or Unicode symbols. |

The kit: `Button`, `IconButton`, `Field`, `Input`, `Textarea`, `Select`, `Switch`, `Segmented`,
`Panel`, `PageHeader`, `EmptyState`, `ErrorNote`, `Skeleton`, `SkeletonRows`, `Fact`, `Meter`,
`Table`, `TableScroll`, `Th`, `Tr`, `Td`, `Tabs`, `TabList`, `Tab`, `TabPanel`, `Sheet`, `Hint`,
`StateMark`, `Status`, `HealthStatus`, `Chip`, `Caution`, `ScopeLabel`, `KindChip`.
Shared visuals in `src/components/` (use these instead of drawing your own):

| Component | Shows |
| --- | --- |
| `SwarmMap` | The swarm as one line: sources, the seven classes of agent with state and last-run counts, and you. Selecting a class opens its jobs underneath; jobs and agents are selectable too. |
| `YesNo` | The partner's call on a founder: Yes, No, tap-able reasons, optional note. Saves itself. |
| `ScoreDial` | One 0 to 100 score as a small arc with the figure inside. |
| `FunnelDiagram` | Counts narrowing through stages. |
| `SurfacedAnnouncement` | The ranked surfaced list: avatar, name, score, and the Yes / No on each row. |
| `icons.tsx` | `ClassIcon`, `SourceIcon`, `EvidenceIcon`, `DecisionIcon`, `KindIcon`: one icon per class of agent, source, evidence kind, decision and steering kind. Use them wherever those things are named. |

Do not edit the kit or the shared visuals. Put components that only your pages need in your own
`src/features/<area>/` folder. If something every page needs is missing, say so in your report.

## Tokens (Tailwind utilities). Nothing else exists.

- Work area: `bg-surface` / `bg-ground` (white), `bg-sunk` (hover rows, tracks, quiet fills), `border-rule`, `border-rule-strong`.
- Text: `text-ink`, `text-ink-2` (secondary), `text-ink-3` (quiet labels).
- Green is the main action, "yes" and positive state: `green`, `green-2`, `green-3`, `green-tint`, `on-green`.
- Blue is selection, links and focus: `navy`, `blue-tint`. A selected row or node is `border-navy bg-blue-tint`.
- Yellow means "surfaced" and nothing else: `gold`, `gold-ink`, `gold-tint`.
- Red is a count that needs you, a failure or a caution: `red`, `red-tint`.
- Amber is "watching" and "needs attention": `bistre`, `bistre-tint`.
- Sidebar only: `rail`, `rail-hover`, `rail-active`, `on-rail`, `on-rail-2`.
- Type: one family. Sizes `text-2xs`, `xs`, `sm`, `base` (15px), `md`, `lg`, `xl`, `2xl`, `3xl`. Weights: 400, `font-bold` (700), `font-black` (900, headings and key figures). `font-mono` for transcripts, code and ids only. `.name-caps` and `font-serif` remain as aliases and now render as bold and as the same family.
- `.label-caps` for table heads, `.figure` for numbers.
- Corners: `rounded-sm` (6px, controls), `rounded-md` (8px, boxes), `rounded-lg` (12px, cards), `rounded-full` (pills, badges). The only shadow is `shadow-overlay`, for things that float.
- The default Tailwind colours, radii and shadows have been removed. `bg-gray-100` does not exist.
- `Avatar` (in `ui/layout.tsx`) shows a person or company as a rounded square with initials. Use it on founder rows.

For charts (Recharts), pass colours as CSS variables, for example `stroke="var(--color-green-2)"`,
and set axis and legend text to `var(--color-ink-3)` at 12px.

## Rules

1. Show, do not describe. Lead each region with its diagram, list or figures.
2. No subtitles, captions, helper sentences, footnotes or small print anywhere. Count the sentences on your page: the right number is close to zero. Labels are one to three words.
3. Regions, not boxes inside boxes. A `Panel` is a titled region. Use `boxed` only for a separate object such as a draft to approve.
4. A list row is: avatar or icon, a bold name, at most one quiet line, a figure, the row's one action. Rows hover with `bg-sunk`.
5. Icons travel with a short label or an accessible name. One icon means one thing everywhere. Never emoji or Unicode symbols: use `lucide-react` or the shared icon components.
6. State is a mark plus a word (`Status`, `HealthStatus`), never colour alone.
7. Put each claim beside its proof on the same screen.
8. One `primary` button per view at most. Yes and No are always visible.
9. Every view handles loading (`SkeletonRows`), empty (`EmptyState`: a title and at most one action), failure (`ErrorNote`), and long text (truncate with a `title`, never clip).
10. Scores are 0 to 100 through `score100`. Cost goes through `usd`, which prints "not priced" when unknown.
11. Simulated or unverified data is marked once, with `Caution` or a chip. That marking is required; nothing else on the page is small print.
12. Buttons name what happens in one or two words ("Approve", "Save", "Run now"). No em dashes, no exclamation marks, no jargon.
13. Prefer inline editing and side-by-side detail. Use `Sheet` only to read one long record. No modal dialogs.
14. Everything is reachable by keyboard and inputs are labelled through `Field` (a label, no hint text unless the field is unusable without it).

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
agent-browser --session <your-name> errors                 # console errors
agent-browser --session <your-name> close
```

Desktop only. Read the screenshot, fix what you see in one batch, look once more. Two rounds at most.
When you look, count the sentences on the page and delete them. Ask of every element: would the page still work without it? If yes, remove it.

Check types with `pnpm --filter @agentswarm/web typecheck`. Other workers are writing other pages
at the same time, so report only errors in your own files.
