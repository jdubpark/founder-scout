---
name: Founder Scout
description: A team-chat style control room for a founder-scouting agent swarm
colors:
  sidebar-plum: "#3f1142"
  sidebar-plum-hover: "#53195a"
  sidebar-current: "#1466a8"
  on-sidebar: "#ffffff"
  on-sidebar-quiet: "#d3c4d6"
  action-green: "#007a5a"
  action-green-hover: "#006048"
  action-green-pressed: "#004d3a"
  yes-outline-green: "#2ea873"
  green-wash: "#e5f4ee"
  surfaced-yellow: "#f2b824"
  surfaced-yellow-ink: "#8a5a00"
  surfaced-yellow-wash: "#fff5d9"
  needs-you-red: "#c81e4e"
  red-wash: "#fdecf1"
  watching-amber: "#9a5b00"
  amber-wash: "#fff1d6"
  link-blue: "#1264a3"
  blue-wash: "#e8f1f8"
  page-white: "#ffffff"
  quiet-fill: "#f4f4f5"
  hairline: "#e4e4e7"
  control-border: "#c6c6cb"
  ink: "#1d1c1d"
  ink-secondary: "#454245"
  ink-quiet: "#6b696b"
typography:
  headline:
    fontFamily: "Lato, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 900
    lineHeight: 1.25
  title:
    fontFamily: "Lato, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 900
    lineHeight: 1.33
  section:
    fontFamily: "Lato, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 900
    lineHeight: 1.5
  body:
    fontFamily: "Lato, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.47
  label:
    fontFamily: "Lato, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1.46
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  row: "32px"
  control: "36px"
  gutter: "32px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action-green}"
    textColor: "{colors.page-white}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.action-green-hover}"
  button-secondary:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 16px"
  button-secondary-hover:
    backgroundColor: "{colors.quiet-fill}"
  nav-row:
    textColor: "{colors.on-sidebar-quiet}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 10px"
  nav-row-current:
    backgroundColor: "{colors.sidebar-current}"
    textColor: "{colors.on-sidebar}"
  filter-pill:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.full}"
    height: "32px"
    padding: "0 12px"
  filter-pill-selected:
    backgroundColor: "{colors.action-green}"
    textColor: "{colors.page-white}"
  input:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 10px"
  count-badge:
    backgroundColor: "{colors.needs-you-red}"
    textColor: "{colors.page-white}"
    rounded: "{rounded.full}"
    height: "18px"
---

# Design System: Founder Scout

## Overview

**Creative North Star: "The Team Channel"**

The dashboard looks and behaves like a team-chat app, on purpose. The owner asked for a light, very
simple, professional interface that copies Slack, with as little text as possible and icons and
simple diagrams in its place. A venture partner already knows how to read this layout: pages and
swarms in a plum sidebar, work in a white area, a count in a red badge when something needs them.

Steering the swarm is presented as sending a message. A founder who clears the bar is announced like
a post, with Yes and No on the row. Nothing on a page explains itself in a sentence: there are no
subtitles, captions, helper lines or footnotes, and `PageHeader` ignores a description if one is
passed. When a detail is needed it sits behind an information icon.

**Key Characteristics:**
- Light only. One typeface. Desktop only.
- A plum sidebar with swarms listed like channels; the current page is the one blue row.
- White work area, regions separated by space and a hairline, not by boxes.
- Green means act or yes. Red means a count that needs you or a caution. Yellow means surfaced.
- Diagrams use few shapes and labels of one to three words.

## Colors

A white page, near-black text and a plum sidebar, with four signal colours that each mean one thing.

### Primary
- **Action Green** (`action-green`): the one primary button on a view, the selected filter pill, the
  Yes button once chosen, filled meters and score dials. Hover and pressed darken it.
- **Sidebar Plum** (`sidebar-plum`): the sidebar ground. Nothing in the work area uses it.

### Secondary
- **Link Blue** (`link-blue`): links, focus rings, the slider, a selected row's wash, and the current
  page in the sidebar (`sidebar-current`).

### Tertiary
- **Surfaced Yellow** (`surfaced-yellow`): only for "surfaced" and for the "Simulated data" badge.
- **Needs-You Red** (`needs-you-red`): count badges in the sidebar, failures and caution lines.
- **Watching Amber** (`watching-amber`): watching and needs-attention states, the thesis-fit dial.

### Neutral
- **Ink** (`ink`), **Ink Secondary** (`ink-secondary`), **Ink Quiet** (`ink-quiet`): text in three
  strengths. Quiet ink still passes contrast on white.
- **Quiet Fill** (`quiet-fill`): hover, empty states, locked lines, unfilled meter track.
- **Hairline** (`hairline`) and **Control Border** (`control-border`): dividers and control outlines.

### Named Rules
**The One Meaning Rule.** A signal colour never decorates. Yellow is not a highlight, red is not an
accent, green is not a brand flourish.

**The One Blue Row Rule.** In the sidebar only the current page is blue. The current swarm is bold
on a plum hover fill.

## Typography

**Display Font:** Lato (with Helvetica Neue, Helvetica, Arial)
**Body Font:** Lato
**Label/Mono Font:** the system monospace, for model ids only

**Character:** One friendly, sturdy sans at three weights (400, 700, 900). Hierarchy comes from
weight and size, never from capitals, letter-spacing or a second family.

### Hierarchy
- **Headline** (900, 1.5rem): a founder's name at the top of a dossier.
- **Title** (900, 1.125rem): the page title and the app name.
- **Section** (900, 1rem): the heading of a region on a page.
- **Body** (400, 0.9375rem): everything read as a sentence. Reading text is capped at 68ch.
- **Label** (700, 0.8125rem): column heads, field labels, pills. Sentence case.

### Named Rules
**The No Small Print Rule.** No subtitle under a title, no caption under a diagram, no helper line
under a field, no footnote. If a sentence is needed to use a control, the control is wrong.

## Layout

A fixed 240px sidebar and one work column up to 76rem wide with 32px side padding. Pages stack
regions with 40px between them. Lists are rows of 32 to 56px with a hairline between; a row opens
its detail. Wide pages use two columns (Home, Settings, the rubric with its evidence). The layout
is built and checked at desktop widths only; phone layouts are out of scope by the owner's decision.

## Elevation & Depth

Flat. Depth is a hairline or a quiet fill. A shadow exists only on things that float over the page.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 8px 28px rgb(29 28 29 / 0.16), 0 0 0 1px rgb(29 28 29 / 0.08)`): menus,
  the reason popover on Yes / No, the task side sheet, toasts.

### Named Rules
**The Flat Page Rule.** Nothing resting on the page has a shadow.

## Shapes

Lightly rounded rectangles: controls and rows 6px, avatars and boxes 8px, large regions 12px. Pills
and badges are fully round. A box (border plus 8px radius) is reserved for a separate object the
reader acts on, such as an outreach draft, a swarm team, or the message composer.

## Components

### Buttons
- **Shape:** 6px corners, 36px tall (28px in rows), bold label, optional 16px leading icon.
- **Primary:** Action Green with white text; at most one per view, except a list of the same
  decision (Approve on each draft).
- **Secondary:** white with a control border. **Quiet:** no border until hovered.
- **Caution:** red outline on white; never a red slab.

### Yes / No
- Two buttons on every surfaced founder. Yes is a green outline that fills when chosen; No is a
  neutral outline that fills ink. Tapping either opens a small popover of reason pills and an
  optional note; a reason is required because the reasons are what the swarm learns from.

### Chips and filter pills
- **Style:** fully round, 32px tall, bold 13px label, count in quiet ink after the label.
- **State:** the selected pill is Action Green with white text.

### Containers
- **Regions:** a heading and content, no border. **Boxes:** 8px corners, hairline border, 16px
  padding, used only for separate objects.

### Inputs
- **Style:** white, control border, 6px corners, 36px tall. **Focus:** Link Blue border and ring.
- **Error:** red border with a short message that says how to fix it.

### Navigation
- Sidebar rows are 32px tall with a 16px icon. Quiet text at rest, plum hover fill, Link Blue fill
  for the current page, a red count badge at the right. Swarms are listed under their own heading
  with a hash mark, like channels.

### Swarm map
- One line of boxes from Sources to You, one box per team, each with an icon, a name, one number and
  a status dot. Selecting a box opens that team's jobs and agents beneath it.

### Score dial and level bar
- A score is a half-ring dial with the number inside and a one or two word label beneath. A rubric
  level is five short bars, filled up to the level.

## Do's and Don'ts

### Do:
- **Do** start a page with the thing the partner acts on, then supporting detail.
- **Do** put a detail behind an information icon rather than printing it.
- **Do** label simulated data once per page with the yellow or red "Simulated" mark.
- **Do** keep diagram labels to one to three words.

### Don't:
- **Don't** add subtitles, captions, helper text or footnotes.
- **Don't** add a dark theme, a second typeface, gradients or decorative colour.
- **Don't** use capitals or letter-spacing for hierarchy.
- **Don't** make the outreach disclosure line editable or removable.
- **Don't** build or test phone layouts.
