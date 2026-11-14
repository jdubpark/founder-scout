# Founder Scout

A swarm of AI agents that finds startup founders every day, builds a sourced dossier on each
founder and on their company, scores both against rubrics you control, and learns from your
Yes / No.

- Picture for non-technical readers: `docs/architecture/founder-scout-architecture.html`
- Design and decisions: `docs/superpowers/specs/2026-11-12-founder-scout-swarm-design.md`
- Research behind the model and compliance choices: `docs/research/`
- Look and feel of the dashboard: `DESIGN.md`

## Run it

```bash
pnpm install
pnpm dev            # API on http://127.0.0.1:4317, dashboard on http://localhost:5317
```

With no keys and no licences the swarm runs in simulation: a seeded world of fictional founders
stands in for the sources and the models, so every screen works.

```bash
pnpm swarm run --days 3          # three simulated runs
pnpm swarm doctor                # which model providers and sources are ready
pnpm swarm doctor --live         # one tiny real call per ready provider (costs a little)
pnpm swarm eval rounds --rounds 3
pnpm swarm eval show
```

Going live needs nothing but the Claude Code and Codex command-line tools already logged in:

```bash
pnpm swarm run --brain live --sources live --budget 5
```

`--budget` is the spend cap for that run in dollars. The run stops starting new work when it is
reached.

## Companies

Every founder with a company gets a company record, shared by co-founders. Company researchers
collect the mission in the company's own words, what has shipped, dated milestones, the rest of the
team and the stated plans. A company analyst answers nine rubric questions and writes a brief, and
code combines the company's score with its lead founder's into one decision. The Companies page
ranks them and takes a Yes / No with reasons, separate from the call on the founder.

## The hunt

The fixed scouts read three feeds. The hunt roams: it looks for people at the earliest stage,
before a priced round and often before the company has a name.

- A **navigator**, one long-horizon agent (Claude by default, Codex by changing its route),
  decides where to look. It opens and closes trails, writes searches and keeps a notebook. Its
  memory is that notebook, in the database, so it carries on from run to run for as long as
  you let it and picks up after a restart.
- **Runners**, small fast models used as tools, do the reading. Each reads one public page or
  one list of search results, returns a short record and is gone.
- **Code** does what has to be predictable. It spends each wave of runner calls across the
  trails by what each has found, reads pages before it searches again, and never reads a page
  twice. It keeps a person only when the name and the quoted words are on the page, and an
  address only when the page has it. It leaves out a company whose page states a round later than you set ("Latest
  stage worth a look", seed by default). One page in twelve that a runner reads is a planted
  one that tells the reader to report a made-up founder, and a model that falls for it is
  counted and, if it keeps doing it, benched.

On the **Hunt** page you see the trails, what each found and cost, the notebook, the people
found and the latest runner calls. You steer by opening a trail, pinning one so it cannot be
closed, pausing or closing one, setting its attention, or writing a line in the notebook.

**Which models.** With no keys set, runners use the small Claude model on your login. That
works, and it is slow, because a headless agent takes seconds to start. Set `DEEPSEEK_API_KEY`
with `DEEPSEEK_BASE_URL`, or `META_API_KEY` with `META_BASE_URL`, and the runner jobs are
shared between DeepSeek Flash and Meta Muse Ember through their APIs, in equal parts at first;
code then moves share toward the one whose finds the screener keeps for each dollar and away
from one that fails planted pages. What was measured about the two is in
`docs/research/rapid-runner-models.md`: DeepSeek Flash answers in about a second with thinking
switched off, fastest on a US host; Muse Ember writes faster once it starts, enforces the
answer's shape, and promises not to train on what it is sent. DeepSeek's own endpoint is
governed by Chinese law and says its servers are in China, so point `DEEPSEEK_BASE_URL` at a
host you have approved for data about named people.

**What it reads.** Public pages only. The reader obeys robots.txt, waits between requests to
one site, reads at most three of its pages in a wave, sends no login and no cookie, and treats
a refusal as final. A site that asks for a pause is left alone for the rest of the run. It never requests
LinkedIn, nor the sites whose terms forbid automated reading even where robots.txt allows it
(the list, with each site's rule, is `TERMS_BARRED_HOSTS` in `packages/shared/src/policy.ts`).
Set `HUNT_USER_AGENT` to a name and a contact address of your own before a live hunt, so a
site can tell who is reading and say no by name.

## X and accelerator batches

Set `XAI_API_KEY` and three things switch on for live runs:

- **A founder's own X account** is read by Grok through xAI's X search tool: what they ship,
  launches and how people answered, numbers they state, and what is said or shown in attached
  video. Posts about the company are filed with the company.
- **The hunt can search X** for recent posts by small accounts announcing something of their
  own (`x.max_followers`, 25,000 by default, as the model reports it).
- **X evidence is checked** by a second Grok call that fetches each post again and carries a
  planted false claim. A post counts as supported only when xAI's API lists it among what
  that call fetched.

xAI's API returns the model's answer and the addresses its search found, not the posts. X's
robots.txt refuses a generic reader, at its site and at its embed address, so no page on X is
opened. A post's words and its counts are therefore a model's report, labelled as such, and an
address is kept only when xAI's API lists it. Every post fetched is billed ($5 a thousand,
plus tokens); `x.enabled` and `x.media` turn it off.

Set `X_BEARER_TOKEN` as well, a token for X's own API, and code reads each post xAI named, by
its id, and checks it:

- a quote that is not in the post rejects the item, and one that is carries X's own counts
  and date;
- in the hunt, a runner reads the post's own words and the follower ceiling uses X's count;
- a post X no longer shows has its words removed here, from evidence, leads, the hunt's queue
  and task transcripts, and stored posts are re-read in turn to find them.

`pnpm swarm x forget <post address or id>` removes one post's words at once, for when X or an
account's owner asks.

X bills each post read ($0.005, outside the run's spend cap); `X_POSTS_PER_DAY` (200) is the
ceiling, kept in memory, so a restart begins the day's count again. This API never searches
and never looks a person up. X's developer terms restrict uses that concern individual people:
"The remaining decisions" in section 18 of the design says what was decided, and holds the
use-case description to submit on the developer account, which only its holder can do.

With no key at all, the hunt has one more engine: **accelerators**. Code lists the newest
batches of Y Combinator (through an open mirror), a16z speedrun, 500 Global and Berkeley
SkyDeck, after reading each directory's robots.txt, and the hunt reads each company's page
for its founders.

None of the xAI path has run against the live service: no key was on the machine that built it.
X's own API was read live on 2026-11-13, and the accelerator engine was run against the four
live directories the same day.

## Professional profiles, without reading LinkedIn

Nothing here requests linkedin.com, logged in or not; the design explains why
(section 9). The same information comes in three ways:

- **A data vendor.** Put a People Data Labs key in `.env` as `PDL_API_KEY`. The talent-move scout
  then searches for people who recently became founders, and company research can list a company's
  team. Each record costs a vendor credit; `PDL_RECORDS_PER_DAY` (default 50) is the ceiling. The
  adapter has not been run against the live service: no key was available.
- **Your own connections.** Export your connections from your own account settings and upload the
  file under Settings, Your network. The dashboard then shows who you know at each company, and a
  contact whose title changes to a founder's between two uploads becomes a lead. Email addresses in
  the file are never read.
- **By hand.** "Add" on the Founders page takes a name, a company and a link.

## How it improves itself

Three evals, on the Improve page. Each proposes a change, measures it on cases it was not tuned
on, and keeps it only when the gain is larger than the noise.

- **Ranking quality**: simulated founders with known strength. Free. It proves the loop works
  and says nothing about real founders.
- **Partner calls**: your own Yes and No. Free. Starts once there are about twenty calls.
- **Past founders**: real companies at the moment they launched, whose outcome is now known.
  It calls a model, so it has a budget.

```bash
pnpm swarm past collect --from 2018-01-01 --to 2021-01-01 --yc --unicorns
pnpm swarm past show
EVAL_JUDGE=claude-cli:claude-haiku-5-5 pnpm swarm eval rounds --flow past-founders --rounds 0 --budget 3
```

`past collect` reads old "Launch HN" posts and the founders' replies in the first three days,
then labels each company from Y Combinator's own directory (`--yc`), matched on the company's
name together with its intake or its own site. A company has met the bar when it is publicly
listed, on the programme's list of top companies, or still operating with at least 100 people
(`--min-team` changes that); `--unicorns` adds a public list of successes; `--labels file.csv`
(columns company, outcome, source) overrides both. A company nobody can speak for, such as one
bought on unpublished terms, is left out instead of being called a failure, so the command needs
`--yc` or a labels file that marks some companies 0. The dataset names real people, so it is
written to `evals/datasets/`, which is not in the repository.

`EVAL_JUDGE` names the model that judges the cases. Without it the analysts' own model is used,
which costs tens of dollars for a few hundred cases; a small model costs a few. `--rounds 0`
measures the starting point; more rounds try changes. A run that reaches its budget stops, keeps
what it judged, and resumes next time.

Names, years and intake tags are removed before a model sees a case, and the model is then asked
to name the company; cases it names are left out of the headline. That does not make the result
clean: the judging model was trained after these outcomes, so the score is an upper bound on
skill. The page says so, and shows what shuffled outcomes give beside it.

**Autopilot** (Settings): after each scheduled run the swarm runs eval rounds itself. *Suggest*
shows what it would change. *Apply* also puts a kept change into use, one at a time, and only one
measured on real data. Before any change is put into use, the Improve page lists every founder
and company whose decision would change.

## Assumptions, pools of context, pools of agents

- **Assumptions** page: every assumption behind "find the best founders", written down or not,
  as a statement that could be false. Code tests each one on past companies and on your own
  calls, and marks where the two disagree.
- **Swarm, Context**: thirteen named pools of context. An agent sees only the pools its job
  reads, and text crosses between pools only through the listed crossings.
- **Swarm, Pools**: a job can be done by several models at once. Code gives each task to one,
  and after a run moves share toward the models whose work held up under the swarm's own checks.

Where these came from: `docs/research/swarm-methods-synthesis.md`.

## Run it every day

1. `pnpm start` builds the dashboard and serves it with the API on http://127.0.0.1:4317.
2. In Settings, turn Daily run on, pick the time, and set Brain and Sources to Live.
3. Keep the server running. On a Mac, `ops/com.founderscout.server.plist.example` shows how to
   have launchd start it at login and restart it if it stops.

If the machine was asleep or the server was down at the daily time, the run starts once when the
server is next up. For unattended runs put API keys in `.env` (see `.env.example`) so usage bills
an API account instead of a personal login.

The server has no login. It listens on this computer only, and refuses requests that arrive under
another host name or from another site's page. Put it behind a login before anyone else opens it.

## Share a demo

```bash
pnpm swarm demo-snapshot                      # three simulated weeks, frozen into one file
pnpm --filter @agentswarm/web build:demo      # one self-contained HTML file in apps/web/dist-demo
```

The demo holds simulated founders only and says so on every page.

## Checks

```bash
pnpm check                       # typecheck every package, then every test
LIVE_SOURCES=1 pnpm exec vitest run packages/core/src/sources     # real Hacker News, GitHub, arXiv
LIVE_PROVIDERS=1 pnpm exec vitest run packages/core/src/providers # real Claude and Codex calls
```

## Layout

| Path | What |
| --- | --- |
| `packages/shared` | Types, the rubric, steering resolution, scoring, the Yes / No feedback loop, the hunt's rules. Pure and tested. |
| `packages/core` | Store (SQLite), simulated world and web, jobs and prompts, model providers, sources and the page reader, engine, evals, service. |
| `apps/server` | HTTP API, scheduler, command line. |
| `apps/web` | The dashboard. Page-building rules are in `apps/web/BUILDING.md`. |
| `evals/flows` | Eval state, one directory per flow. |
| `evals/datasets` | Datasets built from real past data. Not in the repository. |
| `ops` | An example launchd file for keeping the server running. |

## What is and is not verified

Verified by running it:

- the whole pipeline, the dashboard and both evals in simulation;
- headless Claude and Codex as model providers, with real calls;
- live Hacker News, GitHub and arXiv reading;
- the sanitised repository checkout, with a planted hostile hook that did not run;
- one small live run (2026-11-13, $1.14): real Hacker News, GitHub and arXiv items, scouting,
  screening, web research on one founder, fact-checking by a second vendor, and rubric scoring;
- one live repository review through Codex in a read-only sandbox, which returned findings with
  file and line references;
- the past-founders eval on real companies (2026-11-13, about $2.70 in all), described below;
- the hunt in simulation: six simulated days from the command line, and in the dashboard a
  trail added by hand, a note, its attention raised and pinned, then Run now, after which that
  trail had read fifteen pages and found seven people;
- the hunt live (2026-11-13, four runs on one notebook, $0.25): the navigator on Claude Opus
  took five turns at about $0.04 each and on the fifth closed the trail that had found nobody;
  Hacker News, GitHub and Hugging Face search returned results for 12 of 13 searches; runners
  on Claude Haiku sifted 12 result lists and read 18 pages; 14 real pages were read after their
  robots.txt, one was refused by robots.txt and one answered an error; 4 people were kept after
  code found their names and quoted words on the page; all 4 planted pages were ignored by the
  runner; the fit screen kept 3 of the 4;
- the page reader against real sites: Wikipedia, GitHub and Hugging Face read; a Hacker News
  post read through its API; Devpost, Reddit, LinkedIn and a cloud-metadata address refused
  without a request;
- pools of agents on a running server in simulation: tasks split between two models by share,
  each member's supported items, planted claims and failures counted, share moved by code;
- the Assumptions page on the real eval's judgments, and the Improve page on its rounds.

**What the past-founders eval found.** 155 companies that launched on Hacker News between 2018
and 2020, labelled from Y Combinator's directory (23 met the bar; 66 more were collected and left
out because nobody can state their outcome), judged by `claude-haiku-5-5` twice each.

| | |
| --- | --- |
| Later winner ranked above a contemporary, latest six quarters (88 cases) | 50%, 95% range 17% to 72% |
| The same with outcomes shuffled | 50% on average; 95% of shuffles below 70% |
| Earlier six quarters, where changes are proposed and chosen | 65% |
| Masked companies the judge named anyway | 22 of 155 |
| Changes tried | 2, both reverted: gains of 0.008 and 0.016 against noise of 0.21 |

Read it this way. The loop did its job on real data: it proposed a change, measured it on
quarters held back from tuning, and refused it because the gain was inside the noise. The default
rubric, with a small judge and nothing but a launch post to read, has shown no ability to pick
later winners: 50% is chance and the range is wide. The range is wide because the latest quarters
hold few winners (11 among 88 companies, against 12 among 67 earlier: recent companies have had
less time to grow). Narrowing it to ten points either side needs roughly seven times as many
cases, which launch posts alone cannot supply. Nothing here is a finding about founders.

**What the assumption ledger said on that run** (earlier quarters only: 54 comparable companies,
8 winners). Of 31 statements: 4 supported, 1 against, 10 open, 16 untested. The company score
alone ranked winners above contemporaries 85% of the time (range 66% to 100%); the founder score
alone 57% (33% to 79%, open); the two together did 21 points worse than the company alone (range
42 worse to level, open). Against: that masking stops a model recognising a company. A launch
post answered Trajectory and Momentum for no company at all, and five more questions for fewer
than three in ten. Eight winners is few and thirty statements were tested at once, so one or two
of these will be chance; they say where to look next, and the page says so.

Not verified against a live service, because no keys or accounts were available: the direct Claude
API and the OpenAI-compatible adapters (OpenAI, DeepSeek, Meta).

Not verified against a live service either: the People Data Labs adapter, for the same reason.

Not run: the past-founders eval with the analysts' own model as judge (tens of dollars), and
autopilot in Apply mode over several days.

Not verified for the hunt: runners on DeepSeek or Meta. No key for either was present, so what
is sent to them (thinking off, the lowest reasoning, the answer's shape) has run only against a
fake client, and "fast" is unmeasured here: on the headless login a runner call took a median
of six seconds. Four live runs show the parts working together. They are far too few to say
how many founders a hunt finds or which trails are worth their cost.

Checked by running it on 2026-11-13: the rule that stops research agents opening linkedin.com
(a rule for the bare host does not cover `www.`, so both forms are passed); headless Claude and
Codex still sign in after unrelated keys are removed from their environment; and the quote check,
which found none of the first live run's nine excerpts on the pages they cited under the old
"quote or paraphrase" prompt, and seven of eight under the exact-quote prompt (one was too short
to check). One founder, so this shows the direction, not a rate. The quote check was run again
after it was changed to connect only to the address it had validated: an exact quote was found
on a live page, the same quote with one word changed was not, a redirect from http to https was
followed, and loopback, cloud-metadata and never-requested hosts were refused without a request.

Not built: AI voice calling, audio or video transcription, a retention schedule, and the notice
that people in the EU and UK are owed when data about them is held. Calls are planned and drafted
for a person to make; their notes are read back in.

Known limits:

- The code reviewer sees a snapshot without history. It is given GitHub's commit counts per
  contributor, so it can say how much of a repository is the founder's own, but not who wrote a
  particular file.
- Codex reviews a repository inside its read-only sandbox, which blocks writes and the network
  but can still read other files on the machine. The prompt forbids running repository code and
  following instructions found in it; that part is an instruction, not a wall. For unattended
  live runs, run the server under its own user account or in a container.
- The check for personal attributes is phrase based. It removes explicit statements ("is 42
  years old", "is married") from everything stored, and refuses steering that states one. It
  does not catch hints.
- The default bar and the simulated analyst are tuned on simulated founders. Set the bar from the
  first week of real runs, with the slider on the Founders page.
- The spend cap per task stops a call in progress only for headless Claude. Codex and the API
  adapters finish the call they are in; the cap per run is checked between calls for all of them.
- The planted hostile hook proves the Claude repository review cannot be hijacked. The Codex
  review path has no such test; it relies on the read-only sandbox described above.
- A scout reads only the newest items each run (40 by default). On a busy day Hacker News and
  arXiv publish more than that, so raise "Items scanned per scout" on the Swarm page (about 150)
  for live runs. GitHub returns at most 100 per request.
- A message sent to a class of agents or to one job from the dashboard applies to the current
  swarm. Steering a class across every swarm is possible through the API only.
- The past-founders eval asks the judge which year a masked case was written in, and counts an
  answer within one year. Over a dataset that spans three years, always answering the middle
  year scores 155 of 155, so the judge's 52 of 155 shows nothing either way. The page prints that
  ceiling beside the figure. The probe needs a wider span of years to mean something.
- Every past case is a Y Combinator company that posted a launch. What the eval says about
  founders found elsewhere is unknown.
- The hunt has no general web search. Its engines are Hacker News, GitHub and Hugging Face
  search, the links on pages it reads, and any page a person or the navigator names. A web
  search service is a contract with terms on keeping results; choosing one is yours. The
  prices and terms in `docs/research/open-web-hunting-grounds.md` were gathered through a tool
  that summarises pages: read the vendor's own page before signing.
- The hunt's too-late rule reads a page that is about one company. A page that lists several
  companies names people without saying how far along each is, and they go on to the fit
  screen. A person shown only as a handle is not kept; the runner follows the profile link.
- The first live hunt read no page at all, because searches went first and kept arriving.
  Pages now go before searches. There is no eval flow for the hunt yet: its only measures are
  each trail's and each model's yield on the Hunt page.
- The hunt was reviewed twice by a second model, which found sixteen defects in all. Every one
  is fixed and has a test. The fixes to the second review were not reviewed a third time.
- A page tells a runner what it says, and a runner can be fooled by it. Code keeps a person
  only when the name and the quoted words are on the page, and tests each model with planted
  pages, but a page that states something false about a real person in plain words passes
  both. The fact-checker and the quote check further on are what catch that.

## Rules the code enforces

Nothing is sent or dialled without a person approving that item. Nothing requests LinkedIn.
Professional, public information only. Every claim has a source, and code checks that a quote is on
the page it cites before a model is asked about it. Every fact-check carries one planted false claim;
a checker that accepts it has that call's verdicts thrown away. A spend cap per run, a ceiling on
vendor records per day, and a stop switch. `CLAUDE.md` lists each rule with the test that enforces
it.
