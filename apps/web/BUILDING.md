# Building dashboard pages

Read this before writing any page. The product context is in `/PRODUCT.md` and the
visual direction in `apps/web/.impeccable/surfaces/apps-web-index-html.md`.

## Who reads these pages

A venture partner who is not an engineer. They think in founders, theses and meetings.
A technical operator uses the same pages, so nothing is hidden, but nothing assumes
knowledge of models, prompts or tokens.

## The owner's direction (this overrides anything below that conflicts)

1. **As little text as possible. Diagrams and icons in its place.** Before writing a sentence,
   ask whether a diagram, an icon with a one-to-three-word label, a number, or a state mark
   says it. Explanations go in a hover hint (`Hint`), not on the page. No page descriptions,
   no instructional paragraphs, no helper sentences under every control.
2. **Friendly and usable.** Big obvious targets for the main actions, one glance to see what
   needs a decision, nothing that needs reading a manual.
3. **Every candidate gets a Yes or a No, with a reason.** Use the `YesNo` component wherever a
   founder appears with enough context to judge. Those calls feed back into the swarm.
4. **The swarm must be visible and steerable.** Use the `SwarmMap` component to show it.
5. Do not spend time on phone layouts or phone screenshots. Desktop only.

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
| `SwarmMap` | The swarm as a flow: sources, the seven classes, each agent as a node with its state, and the volume passing between stages. Click a node to select it. |
| `YesNo` | The partner's call on a founder: Yes, No, tap-able reasons, optional note. Saves itself. |
| `RubricRadar` | A founder's ten rubric answers as a radar, with confidence. |
| `ScoreDial` | One 0 to 100 score as a small arc with the figure inside. |
| `FunnelDiagram` | Counts narrowing through stages. |
| `SurfacedAnnouncement` | The ranked surfaced list on the overview. |
| `icons.tsx` | `ClassIcon`, `SourceIcon`, `EvidenceIcon`, `DecisionIcon`, `KindIcon`: one icon per class of agent, source, evidence kind, decision and steering kind. Use them wherever those things are named. |

Do not edit the kit or the shared visuals. Put components that only your pages need in your own
`src/features/<area>/` folder. If something every page needs is missing, say so in your report.

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

1. Show, then tell. Lead each region with its diagram, icons or figures. Text is a short label,
   not a sentence. If a region needs explaining, put the explanation in a `Hint`.
2. Regions, not boxes inside boxes. A `Panel` is a ruled region on the paper. Use `boxed` only
   for a separate object such as a draft to approve. Never nest boxes.
3. Icons always travel with a short label or an accessible name. One icon means one thing
   everywhere. Never emoji or Unicode symbols: use `lucide-react` or the shared icon components.
4. State is a mark plus a word (`Status`, `HealthStatus`), never colour alone.
5. Put each claim beside its proof on the same screen.
6. One `primary` button per view at most. Yes and No are the exception: they are always visible.
7. Every view handles loading (`SkeletonRows`), empty (`EmptyState`: a few words and one action),
   failure (`ErrorNote`), and long text (truncate with a `title`, never clip).
8. Scores are 0 to 100 through `score100`. Cost goes through `usd`, which prints "not priced"
   when unknown: never show $0.00 for an unknown cost.
9. Say what is simulated, estimated or unverified, with `Caution`. This is the one place text is required.
10. Copy that does appear: a few plain words, active voice, buttons name what happens
    ("Approve", "Save"). No em dashes, no exclamation marks, no jargon.
11. Prefer inline editing and side-by-side detail. Use `Sheet` only to read one long record. No modal dialogs.
12. Colour has one meaning each (see Tokens). No gradients, no decorative shadows, no coloured side stripes.
13. Everything is reachable by keyboard and inputs are labelled through `Field`.

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
When you look, count the sentences on the page. If there are more than a handful, replace them.

Check types with `pnpm --filter @agentswarm/web typecheck`. Other workers are writing other pages
at the same time, so report only errors in your own files.
