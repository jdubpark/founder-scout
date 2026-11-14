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

With no configured providers or licences the swarm runs in simulation: a seeded world of fictional founders
stands in for the sources and the models, so every screen works.

```bash
pnpm swarm run --days 3          # three simulated runs
pnpm swarm doctor                # which model providers and sources are ready
pnpm swarm doctor --live         # one tiny real call per ready provider (costs a little)
pnpm swarm eval rounds --rounds 3
pnpm swarm eval show
```

Going live can use the Claude Code and Codex command-line tools already logged in. The selected
cheap runner routes use OpenCode and require a saved DeepSeek or Meta login there.

```bash
pnpm swarm run --brain live --sources live --budget 5
```

`--budget` is the spend cap for that run in dollars. The run stops starting new work when it is
reached.

## Companies and founders

Every founder with a company gets a company record, shared by co-founders. Company researchers
collect the mission in the company's own words, what has shipped, dated milestones, the rest of the
team and the stated plans. A company analyst answers nine rubric questions and writes a brief, and
code combines the company's score with its lead founder's into one decision. The Companies page
ranks them and takes a Yes / No with reasons, separate from the call on the founder.

The Founders table has six columns: Founder, Company, Moat, Status, Overall and Call. Company shows
industry and round chips, with its tagline below. Round uses the company's stage, then the founder's,
then the latest sourced hunt stage. Taglines need an exact quote from the company's site; the moat
needs cited evidence. Missing facts stay blank. Home uses the same company line, and the company's
own page shows the same sourced tagline and moat.

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

**Web search.** Each engine is asked for ten results. The `web` engine uses Linkup when
`LINKUP_API_KEY` is set, otherwise the model provider's own search tool. Claude's native
`WebSearch` runs through a budgeted `hunt.search` job; it accepts links only from the tool result.
`HUNT_WEB_SEARCH=off` disables general web search. OpenCode does not provide Claude's search tool.

Linkup is the selected search service. Set `LINKUP_API_KEY` and the live hunt uses it instead of
Claude WebSearch; without the key, it uses the provider tool. Leave the key unset until Linkup
confirms the queue in writing. `HUNT_WEB_SEARCH=off` disables either search engine. The adapter's
default ceiling is 200 search attempts per UTC day, held in
memory and reset when the server restarts; it is separate from a run's model budget. Its fake-client
tests pass, but it has not been run against Linkup live. The terms read on
2026-11-13 limit copying, extraction and retention to text and data mining, require that content
not be passed on, and require honoring a rights holder's opt-out. Linkup may use prompts to train
and improve its service unless zero data retention is arranged. Before connecting it, ask Linkup in
writing whether keeping result URLs, titles and snippets in a queue for later automated reading is
permitted under article 4.1, and whether zero data retention can be enabled. The terms review is in
`docs/research/web-search-services.md`.

**Outside agent.** On the Hunt page, set the navigator to **Outside agent** to hand over the
seat. Start the server, then connect Claude Code or Codex with
`pnpm --silent swarm mcp --url http://127.0.0.1:4317 --swarm SWARM_ID`. The agent sees the same
bounded view as the built-in navigator, not page text or founder dossiers; its turns pass the same
checks. The built-in navigator takes the seat back after the configured idle period (two days by
default). `codex exec` needs `--approve-for-me`. Claude Code and Codex have each held the seat
against a simulated web; setup and the agent loop are in `docs/agents/hunt-seat.md`.

**Which models.** Hunt page readers and result sifters use the small Claude model on your login
when no cheap model route is ready. The runner pool splits equally between ready DeepSeek Flash
and Muse Ember routes. For scouts and the fit screener, when both vendors are ready, the default
shares are 50% to the ordinary route and 25% to each cheap model. OpenCode uses saved vendor logins;
its provider is ready only when a login is saved. Each call gets a temporary data folder with only
a link to that login, then the folder is removed. The child process gets its real working directory
as `PWD`. Direct API routes take precedence when configured; a saved pool or pinned route takes
precedence over defaults. Code moves shares only for jobs whose results it checks; the screener's
shares stay fixed. A member whose calls fail twice in a row for a provider reason is left out for
the rest of that run.

DeepSeek Flash and Muse Ember are the selected cheaper options for scouts, screening and runners.
In a real run through OpenCode they completed 33 tasks with no failures for $0.12 in 113 seconds;
that is too few calls to rank the models. Use the standard Meta tier. Meta's cheaper contributor
tier may train on prompts and answers, and a vendor that trains on its inputs is allowed only for a
job whose inputs are public pages or feeds and the fund's own words. A lead is not public: it may
come from a contact list or a partner's note. So scouts, the navigator and the runners may use
such a model and the fit screener may not, nor may anything that reads a founder's or a company's
file, a transcript or a contact list. A task sent to such a model is not shown your Yes and No
calls. A person must choose this tier; it is never a default, and the thesis and steering text go
to the vendor. DeepSeek has no default API endpoint; approve the host before sending named-person
data. Measurements and terms are in `docs/research/rapid-runner-models.md`.

**What it reads.** Public pages only. The reader obeys robots.txt, waits between requests to one
site, reads at most three of its pages in a wave, sends no login and no cookie, and treats a refusal
as final. A robots.txt answered with 401, 403 or 429, or one too large to read in full (512 KiB),
means the site is not read; a missing one means no rules. A site that asks for a pause is left
alone for the rest of the run. It never requests LinkedIn, nor sites whose terms forbid automated
reading even where robots.txt allows it. The list also bars YouTube, Vimeo and Spotify media
hosts; every site's rule is in `TERMS_BARRED_HOSTS` in `packages/shared/src/policy.ts`. Set
`HUNT_USER_AGENT` to a name and a contact address of your own before a live hunt, so a site can
tell who is reading and say no by name. Recording links go through the same reader checks.

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

## Recordings and calls

On a founder's page, a person can add a recording by public link or upload. The talks analyst can
queue up to three recordings per founder in a run. Fetches accept direct audio or video files and
use the page reader's address, robots.txt, redirect and `HUNT_USER_AGENT` checks. Embedded players,
barred or private hosts, non-media responses and files over `MEDIA_MAX_MB` (150 MB by default) are
refused. Before transcription, `ffprobe` measures the length; if that fails, code uses a file-size
bound at 6 kbit/s. A recording that does not fit the remaining run allowance is refused. A saved
transcript is not repeated. `TRANSCRIBE_COMMAND` takes precedence and must contain `{file}`; it runs
without a shell. Otherwise the OpenAI-compatible endpoint uses `TRANSCRIBE_BASE_URL`,
`TRANSCRIBE_API_KEY` and `TRANSCRIBE_MODEL`, with time-coded `verbose_json` segments. The reader
gets one transcript stretch and a founder brief; unsupported words are dropped, detected personal
detail sentences are removed, and transcription cost is recorded on the task. Neither transcription
adapter nor a recording fetched from a real site has been tested live.

Runs only propose outreach. A person may place one approved founder or reference call after
recording how the person agreed to an AI call and choosing whether to record. A call needs the
Vapi key, outbound number ID and voice ID, plus `FUND_NAME` and an E.164 `FUND_CALLBACK_NUMBER`.
Before dialing, code saves the consent and a placement mark. If the service response is uncertain,
the item is failed for a person to check; code does not redial it. Stored call text has phone numbers
removed. Vapi artifacts are deleted after local sync by default. The adapter has a fake-client test
and has never placed a call.

The call needs an approved action, E.164 destination, local time from 09:00 through 19:59, the
emergency stop off and fewer than five placements on the UTC date across all swarms. Code builds
the opening, approved agenda, stop instructions and closing with the fund's name and callback
number. It does not run an invitation or written-consent flow, check a do-not-call list or US-only
eligibility, or review transcripts. Recording starts with the call; the person is not asked in-call
before it starts. Results sync only when requested. Counsel must review the consent, recording,
disclosure, retention and jurisdiction questions in `docs/research/ai-voice-calls.md` before a
first real call.

## How it improves itself

Four evals, on the Improve page. Each proposes a change, measures it on cases it was not tuned
on, and keeps it only when the gain is larger than the noise.

- **Ranking quality**: simulated founders with known strength. Free. It proves the loop works
  and says nothing about real founders.
- **Partner calls**: your own Yes and No. Free. Starts once there are about twenty calls.
- **Past founders**: real companies at the moment they launched, whose outcome is now known.
  It calls a model, so it has a budget.
- **Hunt yield**: counts distinct strong early founders found in each simulated world before the
  fit screen. Every variant has the same turns and wave size. Changes are compared world by world
  on eight held-out worlds, with a paired bootstrap noise floor. This is a simulated web and says
  nothing about real founders.

On this machine, the hunt-yield baseline found 17.75 strong early founders per world across 16
simulated worlds (95% range 15.4 to 20.1; held-out noise floor 2.33). Three rounds proposed
`hunt.max_depth` 2 to 1 and `hunt.pages_per_search` 3 to 2 or 4. All three were reverted. The
figure depends on which providers are ready; it is not a result about real founders.

```bash
pnpm swarm past collect --from 2018-01-01 --to 2021-01-01 --yc --unicorns
pnpm swarm past show
EVAL_JUDGE=claude-cli:claude-haiku-5-5 pnpm swarm eval rounds --flow past-founders --rounds 0 --budget 3
pnpm swarm eval rounds --flow hunt-yield --rounds 2
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

**Deal history.** The fund's own past deals are the next source of labelled cases. Import them
into the same dataset with `pnpm swarm past import --file deals.csv`. The CSV uses
`company`, `seen`, `summary` and `outcome`; optional columns are `url`, `sector`, `stage`,
`founders` and `decision`. Month-only dates use the first day of the month. Unknown outcomes are
left out, and the summary should contain only evidence known on the `seen` date. See
[`docs/examples/deals.example.csv`](docs/examples/deals.example.csv). Use `--bar "<text>"` to
state what counts as a positive outcome.

`EVAL_JUDGE` names the model that judges the cases. Without it the analysts' own model is used,
which costs tens of dollars for a few hundred cases; a small model costs a few. `--rounds 0`
measures the starting point; more rounds try changes. A run that reaches its budget stops, keeps
what it judged, and resumes next time. A model whose vendor trains on its inputs is refused as an
eval judge because imported cases can contain the fund's notes.

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

Reviewed prompt playbooks live in `skills/<id>/SKILL.md`. Code picks up to three that match the
job or class and, when specified, the task's host or text. It orders them by priority then id and
keeps within 1,200 characters for scouts and runners or 2,400 for other jobs. The Told tab previews
the selected notes. Set the scoped `skills.off` parameter to a skill id to switch it off. The notes
are guidance, not authority, and cannot change scores or decisions.

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

Tests stay few: one proof for each contract at the strongest boundary, and a regression test for
every defect a review or a live run found. There are no tests of a wrapper, a copied list or a
value the code itself produced, and a kept test must be able to fail when its contract breaks. On
2026-11-13 the suite was cut from 1,209 tests to 988 (13 of them run only with the live flags
above). Each test removed had a stronger proof left standing, and the kept tests were checked by
breaking the code on purpose and seeing them fail.

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

- the pipeline, dashboard, ranking eval and partner-call eval in simulation;
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

Verified by running it later the same day (2026-11-13, evening):

- **Scouts, screener and runners through OpenCode:** DeepSeek Flash and Muse Ember handled 33
  tasks with none failed, for $0.12 in 113 seconds. Scouts read real Hacker News and GitHub items.
  The hunt ran 6 searches, including 2 general searches through Claude's tool (about $0.013 and
  14 to 25 seconds each), read 6 real pages on four sites and one planted page, and found 3 people.
  The fit screen ran on all three models. Median sift times were 3.1 seconds for Muse and 7.5 for
  DeepSeek; page reads took 3.4 and 5.3 seconds. Too few calls to rank them.
- **Outside navigator seat through MCP, on a simulated web:** Claude Code (Haiku) read the view,
  took a turn, got a LinkedIn address refused with its reason, sent a wave and read the view again
  for $0.004. Codex (`gpt-6-luna`) read the view, opened one trail, closed another and sent a wave.
  `codex exec` needed `--approve-for-me`, and the command needed `pnpm --silent`.
- **Built-in navigator on Codex, with real runners on a simulated web:** `gpt-6-astra` ran hunt
  only for 19 tasks with no failures, $0.25 and 43 seconds; it found 5 people.
- **Recording end to end:** a ten-second clip for a made-up founder, made with the Mac's voice, was transcribed by local
  Whisper (`mlx-whisper`, tiny, through `TRANSCRIBE_COMMAND`), read by Claude Sonnet and yielded
  two evidence items whose words code found in the transcript; 7 seconds and $0.013.
- **Dashboard and demo:** on a real server in simulation, the Founders table and Home list were
  checked at 1280 pixels. The 8.7 MB demo page built and opened.
- **Deal-history import:** the example file imported 5 rows, left 1 out for no outcome, and updated
  the same cases without adding rows on reimport.

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

Not verified against a live service:

- Linkup (no key). The HTTP transcriber, and fetching a recording by link from a real site. Vapi,
  which has never placed a call.
- The direct Claude API and the OpenAI-compatible adapters (OpenAI, DeepSeek, Meta): DeepSeek
  Flash and Muse Ember have run only through OpenCode's saved logins. The People Data Labs adapter.

Not run: a live baseline of the hunt eval (real models reading the simulated web; it needs a
budget of at least 16 dollars), the past-founders eval with the analysts' own model as judge (tens
of dollars), and autopilot in Apply mode over several days.

Checked by running it on 2026-11-13: the rule that stops research agents opening linkedin.com
(a rule for the bare host does not cover `www.`, so both forms are passed); headless Claude and
Codex still sign in after unrelated keys are removed from their environment; and the quote check,
which found none of the first live run's nine excerpts on the pages they cited under the old
"quote or paraphrase" prompt, and seven of eight under the exact-quote prompt (one was too short
to check). One founder, so this shows the direction, not a rate. The quote check was run again
after it was changed to connect only to the address it had validated: an exact quote was found
on a live page, the same quote with one word changed was not, a redirect from http to https was
followed, and loopback, cloud-metadata and never-requested hosts were refused without a request.

Still not built. For calls: an invitation and written-consent flow, a do-not-call list, a check
that the person called is in the United States, a confirmation inside the call before recording
starts, a review of transcripts, automatic polling for a call's result, and a way to withdraw
consent or ask for deletion. A lawyer must review the calling path before a first real call. For
data: a retention schedule, and the notice owed to people in the EU and UK when data about them is
held.

Known limits:

- The code reviewer sees a snapshot without history. It is given GitHub's commit counts per
  contributor, so it can say how much of a repository is the founder's own, but not who wrote a
  particular file.
- Codex reviews a repository inside its read-only sandbox, which blocks writes and the network
  but can still read other files on the machine. The prompt forbids running repository code and
  following instructions found in it; that part is an instruction, not a wall. For unattended
  live runs, run the server under its own user account or in a container.
- The check for personal attributes is phrase based. It removes explicit statements ("is 42
  years old", "is married", "identifies as non-binary") from everything stored, whoever the
  subject is, and refuses steering that states one. A phone number or an email address is removed
  only where the text calls it personal, because a pattern cannot tell a private address from one
  published for business. It does not catch hints. Call text has its own phone-number redactor.
- The default bar and the simulated analyst are tuned on simulated founders. Set the bar from the
  first week of real runs, with the slider on the Founders page.
- Only headless Claude can be stopped at a per-call spend ceiling. OpenCode, Codex and the API
  adapters finish the call in progress; the run cap is checked between calls for all providers.
- The hunt-yield eval counts strong early founders on a simulated web and says nothing about real
  founders. Its figure depends on which providers are ready on the machine, because a trial uses
  the app's default pools.
- The OpenCode adapter records the model it asked for. It does not read back which model served
  the call.
- The People Data Labs ceiling limits what is asked for: a request never asks for more records
  than are left of the day, and what the vendor returns is what is counted.
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
- General web search uses Linkup when `LINKUP_API_KEY` is set, otherwise the model provider's own
  search tool. Linkup remains the selected option, pending a written answer about keeping queued
  addresses; it has only fake-client tests and no key is set. `HUNT_WEB_SEARCH=off` disables it.
- The hunt's too-late rule reads a page that is about one company. A page that lists several
  companies names people without saying how far along each is, and they go on to the fit
  screen. A person shown only as a handle is not kept; the runner follows the profile link.
- The first live hunt read no page at all, because searches went first and kept arriving. Pages
  now go before searches. A live hunt-only run with the built-in Codex navigator and real runner
  models found five people on the simulated web; it is not evidence about real founder yield.
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
