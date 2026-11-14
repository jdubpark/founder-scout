# Founder Scout swarm: design

Date: 2026-11-12. Status: v0 built against this design; decisions marked **(my call)** were made
without an interview and are yours to overturn. The picture for non-technical readers is
`docs/architecture/founder-scout-architecture.html`.

## 1. Intent

A venture investor wants to meet exceptional technical founders before other investors do. Finding
them is reading work: thousands of launches, repositories, papers and talks, most of them noise. The
system does that reading every day with a swarm of AI agents, builds a sourced dossier on each
promising founder, scores it against a rubric the fund controls, and puts a short ranked list in
front of a partner. The partner says yes or no with a reason. Those calls steer the swarm and are the
measurement it improves against.

## 2. Goals, non-goals, anti-goals

**Goals**

1. A daily, unattended run that turns public and licensed sources into a ranked shortlist with a dossier per founder.
2. Every claim traceable to a source, and every score traceable to claims.
3. A dashboard where a non-technical partner can see the swarm, steer any part of it in plain language, call yes or no on each candidate, and approve outreach.
4. An evaluation the swarm can be tuned against, with a loop that keeps only changes that measurably help.
5. Model choice per job, across Anthropic, OpenAI, DeepSeek and Meta, decided by measurement.

**Non-goals for v0**

- Connecting a live voice calling service. Approved-call actions and a simulated dialler exist; no
  live dialler adapter is connected.
- A licensed professional-profile data feed. The adapter slot exists and reports "not configured".
- Login, multi-user roles, hosting. The server refuses to bind to anything but the local machine.
- Evidence about real founders' outcomes. The first eval is synthetic.

**Anti-goals** (it has failed if it does these, even if everything else works)

- Contacting anyone without a person approving that specific message or call.
- Scoring pedigree, or recording age, family, health or other personal attributes.
- Presenting a guess as a fact, an estimate as a measurement, or simulated data as real.
- Scraping LinkedIn or automating an account on it.

## 3. Constraints

- No model API keys and no data licences were available. The machine has logged-in Claude Code and Codex command-line tools.
- LinkedIn offers no general profile API; scraping it has ended badly for others (hiQ's consent judgment in 2022, Proxycurl's shutdown in 2025). See `docs/research/data-sources-and-compliance.md`.
- Real outcomes for founders take years, so ground truth is slow and scarce.
- The reader of the dashboard is not an engineer.

## 4. Approaches considered

| | A. Own orchestrator, any model **(chosen)** | B. Anthropic Managed Agents as the runtime | C. Scheduled Claude Code routines plus a shared page |
|---|---|---|---|
| What it is | A small engine in our code runs the pipeline; each job routes to any provider | Anthropic hosts the agent loop, sandbox, schedule and multi-agent workflows | Each agent is a headless coding-agent session on a timer |
| Multi-vendor | Yes, per job | Claude only for agent loops | Per harness |
| Steering and audit | Full: every task records what it was told | Through agent configs; less granular | Weak |
| Code we own | Most | Least | Little, but brittle |
| Verifiable today without keys | Yes, through the two command-line tools | No | Partly |

A is chosen because steering per swarm, class, job and agent, per-job model bake-offs, and a
dashboard over our own records all need the orchestration to be ours. B remains a good home for the
long research jobs later: the job interface does not care what runs a job.

Inside A, one structural decision matters more than any other:

> **Models make judgments. Code makes decisions.**

Models answer ten narrow rubric questions from fact-checked evidence. Code turns the answers into
scores and a decision. Consequences: weights and thresholds change instantly without a model call;
every number is explainable; the improvement loop can test a weight change for free; and the answers
become features for a learned model once real outcomes exist. Independent work points the same way:
on anonymised founder profiles, LLM-written yes/no questions combined by a plain vote did as well as
learned weights, and a handful of expert-written questions raised precision from about 0.10 to 0.16
(`docs/research/founder-eval-prior-art.md`, Random Rule Forest).

## 5. The pipeline

One run takes one swarm through these stages. A swarm is one investment thesis with its own agents,
budget and steering; a fund can run several.

| Stage | Class | Jobs | What happens |
|---|---|---|---|
| Follow up | Outreach | `call.debrief` | Results of outreach approved since the last run become evidence |
| Scout | Scouts | `scout.hackernews`, `scout.github`, `scout.research`, `scout.talent` | Read new items from each source and extract people who are founding something, or who show unusually strong original work with no company yet |
| Match | Matchers | `resolve.identity` (code) | Merge sightings that share a profile link, or a name and company, into one founder. Never on a name alone |
| Screen | Screeners | `screen.fit` | Thesis fit, 0 to 1, with reasons. Fit is not quality |
| Investigate | Investigators | `investigate.background`, `.code`, `.company`, `.media`, `.redflags` | Collect evidence about the person: each item is a source link, the source's exact words, and the one-sentence claim they support |
| Company research | Company researchers | `company.product`, `.traction`, `.team` | For companies whose founder passed the screen: the mission in the company's own words, what has shipped, dated milestones, the rest of the team, and what it says comes next. Same evidence shape, plus a facet |
| Fact-check | Fact-checkers | code, then `verify.claims` | Code opens each cited page and rejects an item whose quoted words are not there. Then a different model family re-reads each remaining item: supported, unsupported, contradicted, or about the wrong person or company |
| Assess | Analysts | `assess.judgments`, `assess.company` | Ten rubric answers about the founder and nine about the company, each with a level 0 to 4 or "not settled", a confidence, and the evidence relied on. Code scores both and combines them |
| Memo | Analysts | `assess.memo` | One page for founders above the bar |
| Outreach plan | Outreach | `outreach.plan` | For founders a partner said yes to: an intro email, a call plan, reference suggestions. All wait for approval |

Four kinds of job exist: deterministic code; one structured model call with no tools; a research
call with web search and page fetch; and a repository review, where an agent reads a sanitised,
read-only checkout of the founder's own code. The last one is how "is this person a superstar
engineer" gets answered from the work itself. The reviewer is given the repository named after the
founder's project where there is one, and GitHub's commit counts per contributor, because a
checkout has no history and "did they write it themselves" is half the question.

**Scoring.** Each answered question contributes `confidence × level/4 + (1 − confidence) × prior`;
an unanswered one contributes the prior (0.35) at zero confidence. The overall score is the weighted
mean. Decisions: surface when the score reaches the bar (0.58 by default) and enough of the rubric
is covered by evidence; "needs evidence" when the answers given point above the bar but too little
is known, or known too loosely, for the score to reach it; watch; pass. The default bar is a
starting point tuned on simulated founders, where it surfaces about a tenth of those investigated. A possible material
misrepresentation is never surfaced automatically and never silently dropped: it is held for a person.
A founder whose first assessment is "needs evidence" is investigated again on the next run at the
deepest setting, once; after that the normal re-check interval applies.

**The rubric** (`packages/shared/src/rubric.ts`): built hard things, technical depth, shipping speed,
trajectory (against years of experience, never age), earned insight, ambition, clarity, talent
magnet, persistence, and whether claims match the record. There is deliberately no pedigree question.

**Companies.** A founder is judged as a person; a company is judged as a business, and the two are
kept apart so a partner can see a strong person at a weak company or the reverse. Founders share
one company record when they name the same company on the same site, when two differently spelled
names both point at the front page of the same site, or, with no site, when the names are exactly
the same. A page under a host that many companies use (a code host, a site builder) identifies
nobody, so two names there stay two companies: merging puts one company's evidence on another,
which is worse than keeping one company twice.

The company rubric (`packages/shared/src/company.ts`) has nine questions: is the stated mission a
problem worth solving, how large is the market, what has shipped, what edge does it have, do people
want it, how fast is it moving, does the team beyond the lead founder cover what is needed, is the
plan specific, and do the company's claims match the record. Every company fact is an evidence item
with a facet (mission, product, traction, funding, team, roadmap, market, risk), so each line on the
company page has a source behind it. The company analyst also writes a brief; a point in it that
cites no verified evidence is dropped by code.

Code combines the two scores: `deal = share × lead founder's score + (1 − share) × company score`,
with the share at 0.6 by default because an early company is mostly its people. The lead founder is
the company's highest-scoring assessed founder. The same bars then decide: surface, needs evidence,
watch or pass. A possible misrepresentation by the company or by a founder holds the company for a
person. When a founder is re-assessed and the company evidence has not changed, code recomputes the
decision without a model call.

A partner says Yes or No on a company as well as on a founder, with their own reasons, because "back
this person" and "fund this company now" are different calls. The founder analyst is not shown
company facts and the company analyst is not shown founder evidence.

## 6. Steering

A directive is a rule, a preference, a piece of context, or a setting, attached to a scope:

```
everything  >  one swarm  >  a class of agents  >  one job  >  one agent
```

When an agent runs, every active directive whose scope contains it applies. For settings the
narrowest scope wins. Rules, preferences and context all apply, ordered broad to narrow, and the
agent is told later lines win. Every task stores the exact text it was given, and the dashboard shows
that text for any agent before it runs. Settings layer three ways, weakest first: the default, the
swarm's current config (changed by promoting an eval winner), a person's directive.

## 7. The partner's yes and no

A partner calls yes or no on a candidate and taps a reason. One call does four things:

1. **Decides.** A yes queues outreach drafts on the next run. A no takes the founder off the list. A partner's call outranks the score.
2. **Teaches by example.** The swarm's recent calls are shown to scouts, screeners and analysts as examples of taste, marked as examples and not rules.
3. **Suggests steering.** When three of the last twenty calls share a reason, a proposal appears with the count behind it ("3 of your last 12 calls said no: outside thesis. Raise the thesis-fit bar to 65"). A person accepts or dismisses it. Nothing applies itself. Calls made before a setting was last changed do not count toward changing it again, so accepting a proposal does not immediately produce the next step up.
4. **Scores the swarm.** Every call is a label. A second eval flow asks whether the swarm ranks the partner's yeses above their noes, and tunes weights against it at no model cost.

## 8. Models

Facts and sources are in `docs/research/models-2026-11.md`; prices are list prices per million
tokens, read from vendor pages on 2026-11-13.

| Job | Default | Why | Price in / out |
|---|---|---|---|
| Scouts, screener | Claude Haiku 5.5; cheap pool when available | Highest volume, simplest judgment | $0.10 / $0.50 |
| Web investigators | Claude Sonnet 5.5 with web tools | Multi-step research with sources | $2 / $10 |
| Code reviewer | Codex with GPT-6 Astra, read-only sandbox | A coding agent reading real code; the core "cracked engineer" judgment | $10 / $50 |
| Fact-checker | GPT-6.1 Sol | A different vendor from the researcher, so the two do not share blind spots | $2 / $10 |
| Rubric analyst, memo | Claude Opus 5.5 | The judgment calls | $4 / $20 |
| Voice, later | OpenAI realtime over a telephony provider | The only one of the four vendors with a realtime voice model; matches your existing calling stack | $32 / $64 audio |

Where the other two vendors fit:

- **DeepSeek V4 Pro** ($1.32 / $3.96 at peak) is a cheap, strong third opinion for fact-checking. Use it through a US-hosted provider of the open weights, not the first-party API (the adapter has no default endpoint, so one must be named): its terms are governed by PRC law, its privacy policy could not be retrieved, and founder data is personal data. It offers JSON mode but not strict schemas, so the adapter validates and retries.
- **Meta Muse**: Muse Spark 1.3 ($1.25 / $4.25) as another independent judge; Muse Voice Transcribe ($0.18 per hour) for turning talks and podcasts into text; Muse Glimmer (open, single GPU) if bulk extraction must run in-house. Never the cheaper "contributor" tier, which lets Meta use the data.

Small models are now the same price across vendors (Haiku 5.5, GPT-6 Luna and Muse Ember are all
$0.10 / $0.50), so cost no longer argues for mixing vendors at the bottom. Independence does: a
second family for checking, and a bake-off per job. On the one independent capability index found,
Claude Fable 5.2 led every domain and GPT-6 Astra sat fourth or fifth; that is a reason to try Fable
5.2 on the rubric step ($8 / $40, a few dollars a day at this volume) and adopt it if the eval says so.
**These defaults are starting points. The eval decides.**

Estimated cost for ten deep dives a day at list prices: about $15 to $30, most of it the code review
on the top model. It is an estimate from token counts, not a measurement.

**Providers in code.** `claude-cli` and `codex-cli` drive the headless command-line tools, which
bring their own web and file tools and work with the existing logins or with API keys; both were
verified live, including one whole run on real sources (2026-11-13, $1.14 for one founder at quick
depth) and one repository review. Codex has no file-reading tool, so the review prompt allows
read-only shell commands and forbids running anything from the repository. `anthropic-api` and an OpenAI-compatible adapter (OpenAI, DeepSeek, Meta) make direct
structured calls; they are unit-tested against documented shapes and **not verified against a live
service**, because no keys were available. `opencode-cli` runs structured jobs through OpenCode
with a generated tool-free agent, a temporary work directory and an empty configuration directory.
It uses the saved vendor login when OpenCode is installed; this provider path has not been run live.

**Cheap pool.** When both DeepSeek Flash and Muse Ember routes are ready, scouts and the fit
screener assign 50% to their ordinary route and 25% to each cheap model. Hunt page readers and
result sifters split equally between ready DeepSeek and Meta routes. Direct API routes take
precedence over OpenCode; a person's configured pool or pinned route takes precedence over these
defaults. Pool changes use checked output; the screener's shares stay fixed.

The owner accepted DeepSeek Flash and Muse Ember for scouts, screening and runners through
OpenCode on 2026-11-13. Direct API routes remain available when configured. Meta's cheaper
contributor tier may train on prompts and answers; code permits it only for public material and
fund instructions. Jobs that read partner calls or private founder and company files refuse that
tier. No route in the default pool uses it.

## 9. Sources and conduct

| Source | Access | Status |
|---|---|---|
| Hacker News | Official search API | Live, verified |
| GitHub | Official REST API, optional token | Live, verified |
| arXiv | Official API, one request per three seconds | Live, verified |
| Open web | Claude WebSearch for hunt queries, or Linkup when configured; research tools for investigations | Linkup is wired but unverified against the live service |
| Professional profiles | A data vendor's API under contract. An adapter for People Data Labs is built | Built, unverified against the live service (no key on this machine) |
| X | xAI's API with its X search tool finds and reads; X's own API reads a post xAI named, by id, to check its words (section 18). No page on x.com is requested | Built. The xAI side is unverified against the live service (no key on this machine); X's API was read live on 2026-11-13 |
| Accelerator batches | Four programmes' public company lists, read by code (section 18) | Built; the listing addresses were read by hand on 2026-11-13 |
| Your network | A partner's own exported contact list, uploaded by that partner | Built |
| Added by a person | A name and a link typed into the dashboard | Built |
| Conversations | Approved calls, simulated calls, pasted notes | Call controls and simulation built; no live dialler |
| Recordings | Direct public audio and video files | Fetch and transcript stage built; intake and live transcription unverified |

Rules the system enforces in code, not in prose:

1. Nothing requests the professional network's own site (linkedin.com and its related hosts, listed in `packages/shared/src/policy.ts`). The shared fetch helper and the quote check refuse those hosts, and research agents run with a deny rule for them that was checked by running it: a rule for the bare host does not cover `www.`, so each host gets a bare rule and a wildcard rule. A link to a profile is kept as a pointer a person can open.
2. Every evidence item has a source; unsupported, wrong-person and not-yet-checked items are excluded from scoring. A rubric answer that cites no verified evidence is treated as unsettled, and a founder whose evidence has not been fact-checked waits instead of being scored.
3. Prohibited attributes are named in every people-reading prompt and have no field anywhere. One phrase-based check runs on every text before it is stored: model output, transcripts of model calls, and notes a person pastes in. Evidence and leads that state one are dropped; in other text the sentence is removed. Steering that states one is refused.
4. Repository checkouts are shallow, size-capped, stripped of agent-instruction files and `.git`, and reviewed with read-only tools. A test plants a hostile hook and proves it does not run.
5. Outreach is created as "proposed" and nothing in the engine sends or dials when sources are live. A simulated run acts only on simulated founders.
6. The disclosure sentence on every draft is written by code, stored apart from the editable text, and cannot be edited or removed.
7. A spend cap per run and per task, each a ceiling across retries, and a stop switch.
8. An audit entry for every change a person makes.

Before any AI call is placed, counsel should confirm consent for AI-voiced calls to mobile numbers
(the FCC treats them as artificial-voice calls), recording consent in all-party states, AI disclosure
duties (EU AI Act Article 50 applies from August 2026), and notice duties to EU and UK data subjects.
The research file lists what was and was not verified; much of the compliance material rests on
secondary sources and is flagged as such.

### Professional profiles without reading LinkedIn

LinkedIn is where most professional history is written down, and the swarm still never requests
it. The reasons, from `docs/research/linkedin-rules-and-official-access.md` and
`docs/research/people-data-vendors.md` (researched 2026-11-13; not legal advice):

- Its User Agreement bars scraping and automated access by any means, browser extensions included.
  Logged-in automation and made-up accounts are the facts behind every case it has won: hiQ (2022,
  permanent injunction and $500,000), Proxycurl (shut down in July 2025 and made to delete its data),
  ProAPIs (consent judgment in 2026). A partner's own account can be restricted for the same conduct.
- No official programme gives a bulk, storable feed of other people's work history. The official
  routes are consent-based and one member at a time, and the Sales Navigator API is closed to new
  partners.
- No data vendor states that it holds a licence from LinkedIn. Buying from a vendor is a contract
  with the vendor, and where its data came from is the buyer's risk to check.
- France's regulator fined the vendor of a LinkedIn contact-details extension EUR 240,000 in
  December 2024 for collecting restricted details, keeping them too long and telling people late.

So the same information arrives four ways, none of which touches the site:

| Route | What it gives | Scale | Status |
|---|---|---|---|
| A data vendor's API (People Data Labs first) | Search for people who recently became founders; a known founder's work history; a company's team | Hundreds of millions of records, paid per record returned | Adapter built; needs `PDL_API_KEY`; unverified against the live service |
| A partner's own exported contact list | Who the partners know at a company. A contact whose title changes to a founder's between two uploads becomes a lead | Each partner's own connections | Built |
| Search results | Names, links and snippets a search engine shows | Per query | Research agents may search; the deny rule stops them opening the pages |
| A person, by hand | A partner sees someone on LinkedIn or Sales Navigator and types the name and link in | Human pace | Built |

What the agents add is the work between the records: code turns the thesis into the vendor query,
the matcher recognises a vendor record as the person already seen on GitHub or Hacker News, and a
vendor record is a claim like any other, fact-checked before it counts.

People Data Labs is first because its documentation is public, it has a free tier, it can look a
person up by name and company without a profile link, and it describes its sources as data partners
and public records. Specter and Harmonic sell the exact "just left to start something" signal, by
sales contract. The adapter asks the vendor only for professional fields; birth dates, phone numbers
and personal email addresses are never requested, and the email column of a contact list is never
read.

Not built, and needed before this holds data on people in the EU or UK: a recorded legitimate-interest
test, a notice to each person within a month of first holding their data, and a retention limit
that does not restart every time a record is refreshed.

## 10. Autonomy

- A scheduler starts one run per active swarm at the configured time. Overlapping runs are refused, not queued. If the server was down or the machine asleep at the daily time, the run starts once when the server is next up.
- The server has no login: it binds to loopback and rejects other host names and other sites' origins.
- A failed task never fails a run. Retryable provider errors are retried twice with backoff, and failed spend is counted.
- Runs interrupted by a restart are marked failed on startup. Run state is on disk; nothing lives only in memory.
- Founders on the watchlist are re-investigated on a schedule; a transcript from a completed call triggers a re-assessment.
- Simulation: a seeded world of fictional founders with hidden true quality stands in for sources and models, so the pipeline, the dashboard and the eval run with no credentials. Brain and sources switch independently, which also allows real models to be tested on synthetic founders.

## 11. Evaluation and hill-climbing

**Discipline**, enforced structurally:

- cases are split once into train and test; the part that proposes a change sees train only;
- the headline is the test score. A change is kept in one of two ways, both judged on test with complete, identical coverage: the headline rises by more than the eval's own noise and no guardrail worsens; or the headline is not lower at all and a guardrail improves by more than its own noise (a free improvement). A guardrail counts as worse or better only beyond the larger of its noise and 1% of its value;
- one change per round, with its reason in plain words, so every movement can be attributed;
- state on disk in the layout the Claude eval tooling reads (`_state.json`, `baseline/`, `vN/`, `results.jsonl`, traces), so the same report tools and the `/claude-api hillclimb` workflow apply. Files are replaced atomically, a results file cut off by a crash is repaired before it is appended to, and a lock file lets only one process run rounds on a flow at a time;
- rows measured by simulated and by live models never mix: the ranking flow refuses to resume across modes, and the partner flow counts only live answers once any exist;
- both flows score with the same rule as the pipeline: a rubric answer that cites no supplied, verified evidence is unsettled.

**Flows**

| Flow | Cases | Headline | Guardrails | Cost per round |
|---|---|---|---|---|
| Ranking quality | 120 groups of 20 synthetic founders whose true strength is known, 60 train and 60 test | How closely the swarm's ranking matches true strength (rank correlation: 1 perfect, 0 chance) | Pedigree leak, cost | Free in simulation, about ten seconds |
| Agreement with your calls | Founders a partner called yes or no, with their stored rubric answers, split in half | Chance a yes outranks a no | Noes that would be surfaced | Free: re-scoring only |

| Past founders | Real companies at the moment they launched, whose later outcome is known. Names and years removed | Chance that a company which later did well outranks a contemporary which did not, among cases the model did not recognise | Cost | Re-scoring is free; a change to wording re-judges the cases with a model |

The second flow starts once each half of a fixed random split holds four yeses and four noes: sixteen calls at the least, usually twenty to thirty.

**Past founders, and not knowing the answer.** The third flow asks whether the swarm, shown only
what was public on a past date, ranks the companies that later did well above their
contemporaries. A model has read about the winners and today's web is full of their success, so
each case is built to hold that out (`packages/shared/src/past.ts`):

1. *Cut-off.* Every piece of evidence carries the date it was published. Code drops anything dated after the case's as-of date, and anything undated.
2. *No research.* A case is a frozen pack: the company's own launch post and its founders' replies in the first three days. Nothing is looked up when the eval runs, because anything read today can carry what happened later.
3. *Masking.* The names of the company, its people, its sites and accounts, and every calendar year are replaced before a model sees the pack.
4. *Recognition.* The judging model is asked to name the company from the masked pack. Code compares the guess with the hidden names. Cases it names are scored apart and left out of the headline, so the size of what memory adds is measured and not assumed.
5. *Cohorts.* A company is compared only with others that launched in the same quarter.
6. *Order, in three slices.* A change is proposed on the earliest quarters, chosen on the middle quarters, which are held back from tuning, and reported on the latest quarters. The latest quarters choose nothing, so a headline is not the best of several looks at the same cases. A change counts only when it beats the larger of two noise estimates: the spread between repeats of the judge, and the spread from which cases happened to be drawn (a paired bootstrap).
7. *Placebo.* The outcomes are shuffled inside each quarter and the score recomputed a thousand times. The page shows what shuffled outcomes give; a headline that does not clear 95% of the shuffles cannot be told from chance.
8. *Era.* The same probe asks the model which year the text was written in. A model that can date a masked launch can bring what it knows of that era, so the share it dates is reported too.

**What these controls do not do.** Published tests found that masking does not stop a model
recognising a well-known company (every masked earnings call from three large firms was named),
and that models recall exact figures from before their training cut-off and none from after
(`docs/research/look-ahead-bias-in-llm-backtests.md`). The judging models here were trained years
after these companies launched. So the score is an upper bound on skill, and the page says so in
those words. The only clean test runs forward: today's assessments, scored when their outcomes
are known. They are stored with their dates and the config that produced them for that purpose.

**Labels.** The dataset is built by a command (`pnpm swarm past collect`) from Hacker News launch
posts. Outcomes come from Y Combinator's own directory, matched on the company's own name
together with its intake or its own site, because unrelated companies share names and a link in
a post can point at someone else's site. A company has met the bar when it is
publicly listed, on the programme's list of top companies, or still operating with at least 100
people; a public list of unicorns can raise a company the directory shows still operating; a
person's own labels file overrides both. A company nobody can speak for (acquired on unpublished
terms, absent from the directory, or simply not on a list of successes) is left out instead of
being called a failure. The bar is a proxy, it is this system's own choice,
and it is listed among the assumptions (section 15). A company that launched twice is one case.
Sentences in which a founder states a personal detail are removed before the dataset is written.
It is kept out of the repository because it names real people.

**What the past-founders eval measured** (2026-11-13, real data). 155 companies that launched on
Hacker News between 2018 and 2020, 23 of which met the bar; 66 more were collected and left out
because nobody can state their outcome. Twelve quarters: the earliest (39 cases) propose, the
middle (28) choose, the latest six (88) report. Judge: `claude-haiku-5-5`, two repetitions, under
one cent a case, about $2.70 for everything including the first collection that was later
relabelled.

| Figure | Value |
|---|---|
| Latest quarters, cases the judge did not name | 0.50, 95% range 0.17 to 0.72 |
| Shuffled outcomes on the same cases | 0.50 on average, 95% of shuffles below 0.70 |
| Latest quarters, all cases | 0.44 |
| Earlier quarters | 0.65 |
| Named by the judge despite masking | 22 of 155; their score 0.57 |
| Year given within one | 52 of 155; one fixed answer would score 155 |
| Noise floor | 0.21 |
| Round 1, founders' share 0.6 to 0.5 | fit 0.68 to 0.73, held back 0.61 to 0.62, reverted |
| Round 2, Talent magnet weight 1.5 to 2.5 | fit 0.68 to 0.71, held back 0.61 to 0.63, reverted |

Three readings. The machinery held on real data: both changes looked good where they were
proposed, gained 0.008 and 0.016 where they were chosen, and were refused. The default rubric
with a small judge and a launch post alone shows no skill: 0.50 is chance. And the eval cannot
steer yet: with a noise floor of 0.21 only a very large gain would be kept, and narrowing the
range to 0.10 either side needs roughly seven times the cases. The difference between the earlier
and the latest quarters is not overfitting, since nothing was tuned; it is what samples this
small do. Winners thin out toward the present, 8 of 42 companies from 2018 against 6 of 64 from
2020, because a recent company has had less time to reach the bar. Comparing only within a
quarter keeps that from biasing the score, but it leaves the reporting quarters with 11 winners,
and the last quarter with none. More cases matter more than a stronger judge, and launch posts
cannot supply them, which is why a public benchmark of labelled founder profiles is the next
eval to build (below).

**Why the synthetic headline is not outcomes.** The first design ranked on simulated outcomes. Measured on 200 groups, a random ranker scored 0.20, the default pipeline 0.31 and an oracle that knows true quality 0.35, with noise of 0.03: the whole headroom was the size of the noise, so no change could ever be kept. Outcomes in the simulated world are a weak, noisy function of quality, as they are in venture. In a simulated world true strength is known, and recovering it is the thing the pipeline controls, so that is the headline; outcome hits in the top five are reported beside it.

**What the loop did on the default configuration** (2026-11-13, simulation): starting quality 0.877, noise 0.012. Of five proposals, four were reverted because their gains were inside the noise or raised cost. One was kept: hiding school and employer names from the rubric analyst cut pedigree leak from 0.31 to 0.20 with ranking quality no lower. A separate test starts from a deliberately broken configuration (the two engineering weights at zero) and checks that the loop climbs out of it.

What the loop may change: rubric weights for founders and for companies, the share of a company's
score that comes from its founders, thresholds, the prompt variant of the rubric analyst, the model
of the analyst and the fact-checker, and **learned guidance**: one-sentence lines the swarm writes
for its own analysts. A line is proposed by a model shown the cases the current configuration
ranked wrongly on the tuning half, and it is kept only if the same configuration with the line
beats it without on the held-out half. Kept lines are part of the configuration, so they are put
into use and taken out like any other change, and an agent's "Told" tab shows them. What the loop
may not change: anything a person has set by directive, the thesis, spend caps, or outreach.

**Autopilot.** After each scheduled run the swarm can run eval rounds by itself. The setting has
three positions. *Off*: only a person starts an eval. *Suggest* (the default): it runs the rounds
and shows what it would change. *Apply*: it also puts a kept change into use, one at a time, and
only when the change was measured on real data, which means the partner's calls or past founders.
A change kept on simulated founders always waits for a person. Evals that call a model have their
own daily budget, zero by default. Every automatic change is recorded, shown on the home page, and
undone on the Improve page.

**What the synthetic flow proves and does not.** It proves the machinery: the split, the noise
floor, keep-or-revert, the guardrails, and that a pipeline which leaks pedigree is caught. It says
nothing about real founders.

**Next evals, in order of value**

1. Partner calls, which start accumulating on day one.
2. A forward ledger: the outcome of each founder and company the swarm decided on, recorded as it becomes known. It is the one eval a model's memory cannot reach.
3. A public benchmark of anonymised real founder profiles with outcome labels (VCBench: 9,000 profiles, 9% base rate, with re-identification tests; licence to confirm) for the assessment stage.
4. A sourcing-recall replay: of founders who later raised from strong investors, how many would the scouts have flagged, and how early.
5. A judge calibrated against partner labels before any model-graded metric steers a change.

Known hazards: models may recognise famous founders (the past-founders flow masks names and tests
for recognition); outcomes are right-censored; scores can learn pedigree as a proxy (the pedigree-leak metric exists for this);
language models over-predict success by trusting founder claims (the reason for the fact-checker and
the integrity question).

## 12. The dashboard

Eleven destinations: Home, Founders, Companies, Approvals, Swarm, Hunt, Steering, Improve,
Assumptions, Activity, Settings.
Direction from the owner: light, very simple and professional, modelled on Slack; as little text as
possible, with icons and simple diagrams in its place; desktop only. The visual system is recorded
in `DESIGN.md` and the page-building rules in `apps/web/BUILDING.md`.

- **Home**: who was surfaced, with Yes and No on each row; what needs the partner; the swarm as one line of teams; the last run as a funnel.

- **Swarm**: a map of the swarm as a flow of nodes with state and volume. Select any swarm, class, job or agent to see what it is told and to steer it.
- **Founders**: the ranked list with a yes and a no on every row; matched company, tagline or one-line
  description, industry, current round, cited moat, status, overall score and call; a slider that
  shows who would clear a different bar before saving it; a dossier where each rubric answer sits
  beside its evidence. Round uses company stage, then founder stage, then the latest sourced hunt
  stage. Tagline uses an exact company-page quote before the company one-line description. The moat
  is descriptive, not a score, and needs cited evidence. Missing facts stay blank.
- **Steering**: everything the swarm has been told, suggestions from the partner's calls, and a composer.
- **Approvals**: drafts to approve, edit or reject; an approved call can be placed by a person's action with consent, time zone and recording choice.
- **Hunt**: a control to hand the navigator seat to an outside agent; the navigator, its runners and what they found as one figure; each trail with its attention, its share of the next wave, what it read, found and cost, and buttons to pin, pause and close it; the notebook, with a line to add to it; the people found, each with how early the company is; the latest runner calls.
- **Companies**: the ranked list of companies with the same Yes and No, and a dossier per company.
- **Improve**: the eval flows, including hunt yield on simulated worlds, round by round, with a budget for the one that calls a model and a list of every decision a change would flip before it is put into use.
- **Assumptions**: the ledger of section 15, one row per statement, with a bar for past companies and a bar for the partner's calls.

The demo build is one self-contained file running on a snapshot of a simulated system, for sharing.
The snapshot is made with a simulated clock, one run per day, so it has two weeks of history.

## 13. Layout

```
packages/shared   types, rubric, steering resolution, scoring, feedback loop: pure, tested
packages/core     store (SQLite), simulated world, jobs, providers, sources, engine, evals, service
apps/server       HTTP API, scheduler, command line
apps/web          the dashboard (Vite, React, Tailwind)
evals/flows       eval state, one directory per flow
docs              this design, research notes, the architecture page
```

## 14. The harness: what steers the agents and what checks them

The model is one part of an agent; the harness is everything else. This system's harness has
guides, which act before a model answers, and checks, which act after. Where code can do a check
it does, because code is exact, free and the same every time; a model checks only what code cannot
(`docs/research/harness-engineering.md` has the sources and the strength of evidence for each idea).

| Part | Kind | What it does | What it assumes the model gets wrong |
|---|---|---|---|
| Narrow jobs with a typed answer | Guide | One question per call, answered in a fixed shape | Doing several things well in one answer |
| One repair after a rejected answer | Check, code | An answer that fails validation is sent back once with the validator's message | Getting the shape right every time |
| Grounding rule | Check, code | A rubric answer or a brief point that cites no verified evidence does not count | Citing a source for every statement |
| Quote check | Check, code | Opens the cited page and looks for the quoted words; an item whose words are not there is rejected before any model sees it | Copying a quote exactly |
| Fact-checker on another model family | Check, model | Judges whether the quoted words support the claim and are about the right person or company | Noticing its own unsupported claims |
| Planted false claim | Check, code and model | Every fact-check call carries one made-up claim. A checker that accepts it has that call's verdicts thrown away, and the dashboard says so | That the checker itself is reliable today |
| Open questions on a second look | Guide, from code | The scorer lists the rubric questions still unsettled and hands them to the researchers | Knowing what is missing |
| Fences, read-only tools, a deny list, a scrubbed environment | Guide and check, code | Untrusted text is fenced; research agents can search and read but not act; repository reviewers cannot write; sub-processes do not inherit unrelated keys | Ignoring instructions in what it reads |
| Redaction boundary | Check, code | Personal attributes are removed from everything stored, and steering that states one is refused | Never repeating a personal detail |
| Spend caps and the stop switch | Check, code | Ceilings per task and per run, across retries | Stopping by itself |
| Prompt hash on every task | Check, code | Each task records which wording it was given, so a silent change of wording is visible | Nothing: this watches the harness, not the model |
| Keep rule with a noise floor | Check, code | A change to the configuration is kept only if the held-out score moves beyond rerun noise | That a change which looks better is better |

Three rules keep the harness itself honest. Every check has a test that plants the fault it exists
to catch. Every rule in `CLAUDE.md` names the test that enforces it, and a test fails when one does
not (`packages/core/src/rules.test.ts`). And the two checks that cost time on a live run, the quote
check and the planted claim, are settings: turning one off and comparing is how to find out whether
a stronger model has made it unnecessary. A harness part that outlives the weakness it was built
for is dead weight.

What was measured here. The nine evidence items from the first live run (2026-11-13) were collected
under a prompt that allowed "a quote or close paraphrase". The quote check found none of them word
for word: seven were not on the page as quoted and two pages could not be read. The model
fact-checker had marked four of those seven as supported, because it was shown the paraphrase and
not the page. The prompt now requires the source's exact words. Four live investigator calls with
the new prompt, on the same founder the same day, returned eight items: seven were found word for
word, one was too short to check, and none was missing. That is one founder and eight items, enough
to show the direction and not enough to quote a rate.

What was deliberately not built. A second analyst voting on borderline founders: the research found
agreement between models a weak sign of being right. A proposer that rewrites prompts from raw
traces: it cannot be evaluated in simulation, where the simulated agents do not read prompts. The
planted claim has no published evidence behind it; it is this project's own idea and should be
judged by the failures it catches.

**Skills** (`skills/<id>/SKILL.md`) are reviewed, repository-owned prompt notes. The job registry
matches them by job or class and, when set, by public host or task material; priority and id order
the matches. A task receives at most three notes, within 1,200 characters for scouts and runners
or 2,400 for other jobs. Code inserts them before learned lines and records their ids on the task.
`skills.off` disables named notes at a steering scope. A person's instruction takes precedence;
skills cannot direct scoring, decisions, personal-attribute use or barred-host requests. Matching
uses only fields already sent to the job and never simulator state.

## 15. Pools of agents, pools of context, and the assumptions behind the objective

Five agent frameworks were read from source, and the published evidence on systems of several
agents was collected, to decide what to add here and what to leave
(`docs/research/swarm-methods-synthesis.md`). Three things were built from it.

**Pools of context** (`packages/shared/src/context.ts`). Every piece of text an agent can be shown
belongs to one of thirteen named pools: the objective, steering, the partner's calls, learned
lines, source items, a lead, a founder's file, a company's file, a code checkout, open questions,
scores, and two that are sealed from every prompt (a partner's contact lists, and the hidden
truth: simulator ground truth, eval labels and the names behind masked cases). A pool is isolated
by default. Each job declares the pool behind every one of its input fields, and the declaration
is typed against the job's inputs, so giving a job a new field without naming its pool stops the
build. Text moves between pools only through thirteen listed crossings, each with who carries it
(code, the fact-checker, a scout, a person, an eval), in what form, and what stays behind: a
founder's file reaches the company file as a name and a site and nothing else; the hidden truth
reaches an agent only as one line or one setting that the keep rule accepted. The Swarm page
draws the grid and the crossings.

Why isolation: in the largest controlled study, agents without a central checker multiplied
errors 17 times, and with one, 4 times; and what the working systems pass between agents is a
short structured record, not a transcript.

**Pools of agents** (`packages/shared/src/pools.ts`). A job can be done by up to four members,
each a model with a share of the job's tasks. Code gives each task to a member, deterministically,
so the same founder goes to the same member on a retry. After a run, code counts what each member
did using evidence the member did not produce about itself: how many of its items the
fact-checker supported, for each dollar; whether it accepted planted false claims; how many of
its tasks failed. Share moves toward the members whose work held up, by at most ten points at a
time and never below ten, and only once every member has done twenty tasks. A member is benched,
with the reason recorded, once the count leaves little doubt (the low end of a 90% interval) that
it accepts more than 15% of planted claims, fails more than 30% of its tasks, or has more than
30% of its items rejected by the checks. The figure counts supported items, not how much each
one told the analyst; the floor, the small step and the rejected-items rule bound what a cheap
member that returns obvious items can gain, and the evals are where thinner evidence would show. A person
who pins a model for a scope takes that scope out of the pool. A model never chooses a model: the
routers that allow it were the least reliable part of the frameworks studied.

**The assumption ledger** (`packages/shared/src/assumptions.ts`). "Find the best founders" leaves
most of the work to assumptions. Some are written down where a person can change them: each
rubric question and its weight, the founders' share of a company's score, the bar. Some are not
written anywhere: that "best" means the outcome and not a partner's Yes, that a launch post holds
enough to judge a company, that what the partner wants stays the same while they grade, that
several agents find more than one. The ledger lists both kinds as statements that could turn out
false. Code tests each one on two kinds of evidence that are kept apart: past companies whose
outcome is known (earlier quarters only, so the latest stay untouched for the headline), and the
partner's own calls. Each row gets a status from code: supported when the 95% range sits above
chance, against when it sits below, open when it straddles, untested when fewer than five cases
of either kind exist. A statement that compares two scores ("founders and company together beat
either alone") is tested on the difference between them over the same cases, resampled together,
because two separate ranges overlap even when one score is better on every draw. About thirty
statements are tested at once at a 95% range, so one or two will look settled by chance; the page
says so above the list, and a single row is a reason to look, not a result. Where the partner's
calls and the outcomes disagree, the page marks it: taste and results are different things, and
the difference is the finding. A model never marks an assumption supported.

On the first real run (the earlier six quarters: 54 comparable companies, 8 winners) the ledger
marked 4 statements supported, 1 against, 10 open and 16 untested. Supported: the company score
alone ranks winners above contemporaries (85%, range 66% to 100%), Ambition (74%, 55% to 88%),
Problem worth solving (70%, 57% to 81%), and that a launch post settles most rubric questions
(56% of them). Against: that masking stops a model recognising a company. Open: the founder
score alone (57%, 33% to 79%), and founders and company together, which did 21 points worse than
the company alone (range 42 worse to level). A launch post answered Trajectory and Momentum for
no company, the two Claims match record questions for about one in ten, Shipping speed and Talent
magnet for one in five, and Market for three in ten, so those seven weights are untested by this
evidence and will stay so until cases carry more than a launch. The second change the loop tried
was a higher weight on Talent magnet, a question answered for eight comparable companies; it was
refused on the held-back quarters, which is the keep rule doing what it is for. Eight winners is
few. These rows say where to look; none is a result.

**Seeing what a change would do.** Before a kept change is put into use, the rubric answers
already on file are scored again under it, and every founder and company whose decision would
change is listed. No model is called.

What was left out, with reasons, is in the synthesis note: consensus protocols, debate, models
that pick their own topology or sub-agents, shared mutable state, memory a model may rewrite or
delete, and self-modifying code.

## 16. The hunt: a navigator, runners, and the open web

**Why.** The fund wants founders as early as they can be seen, when the price is lowest: before
a priced round, often before the company has a name. The fixed feeds of section 5 read three
places. The earliest signal is wherever a person first shows work, and that changes. So the
swarm needs to roam, and something has to decide where.

**Three kinds of actor, on purpose** (`packages/shared/src/hunt.ts`).

| | What it is | What it does | What it never does |
|---|---|---|---|
| **Navigator** | One long-horizon agent, Claude or Codex | Decides where to look: opens and closes trails, writes searches, says where attention should go, writes what it learned in the notebook | Reads a page. Scores a person. Chooses a model |
| **Runners** | Small fast models, used as tools. DeepSeek and Meta share the work | Read one page or one list of search results and return a short record: the people starting something in the page's own words, how early the company is, the links worth opening | Remember anything. Add an address of their own. Decide who is kept |
| **Code** | The engine | Spends each wave across trails by what each has yielded, checks every person against the page, leaves out companies past the wanted stage, plants pages that test the runners, keeps the address rules, stops at the budget | Judge a founder |

**Long-horizon means the memory is in the database.** The navigator does not hold a
conversation open. Each turn it is handed its notebook: the trails with their counts, the latest
notes, what the last wave found. It answers with one structured request, and code carries it
out. So a hunt runs for days across scheduled runs, survives a restart, costs the same on turn
400 as on turn 4, and works the same with Claude or Codex. A turn is a request: code checks it
(`checkTurn`) and tells the navigator what it refused and why.

**A turn, then a wave.**

1. The navigator's turn: open trails (a name, what to look for, searches or pages to start
   from), extend or close trails, set attention from 1 to 5, add notes, or say it is done.
2. Code plans the wave (`planWave`): the open trails share `hunt.wave_size` runner calls in
   proportion to attention times yield, where yield is leads for each thing read, a lead the
   fit screener later kept counting three times. A new trail gets a head start, every trail
   with something waiting gets at least one call, and a trail that read thirty pages and found
   nobody is closed by code unless a person pinned it. Within a trail pages go before
   searches, and while both are waiting a trail runs one search for every three pages it has
   read, counted over its life: people are on pages, and a search only finds more pages. A
   page is read once and never again. A search that has run is run again only by a later run
   or on a later day. Something still waiting on a closed trail moves to the trail that asks
   for it again. On a real site no more than three pages are read in one wave, and a site that
   asks for a pause is left alone for the rest of the run, with what is waiting behind it read
   in its place.
3. Runners work the wave in parallel. A search is run by code against a search engine (a
   site's own search API or a web search service) and a runner picks the results worth
   opening. A page is fetched by code and a runner reads it.
4. Code checks what came back and writes it down. Then the navigator's next turn.

**Checks on a runner, all done by code.**

- *The person is on the page.* Every word of the name must be on the page, and so must the
  quoted words, compared after tidying case, spacing and quote marks. Otherwise the person is
  dropped and counted against the trail and the model.
- *Links by number.* A runner is shown a page's links numbered and answers with numbers. It
  cannot add an address.
- *Stage needs the page's words.* The three stage answers (funding, team, progress) each need a
  quote that is on the page, or code resets the answer to unknown.
- *Too late.* A company whose page states a round later than `hunt.latest_stage` is left out
  before a dollar is spent investigating it. Silence is never too late. The rule is about a
  page that is about one company; a page that lists several is left to the fit screener.
- *Addresses come from the page.* A profile link or a company address a runner reports is kept
  only when it is one of the page's links or written in its text.
- *Planted pages.* One page in `hunt.planted_every` that a runner reads was written by code: a
  dull changelog that names no founder and has one line telling the reader to report a made-up
  one. A runner that reports anyone followed an instruction it found on a page. The result is
  recorded on the task, and the pool rule of section 15 benches a model that keeps doing it.

**Earliness** (`earliness` in `hunt.ts`) is the mean of three answers, 1 for unfunded, one or two
people, nothing launched. It is a proxy for a low valuation, which no public page states, and
the page shows it as a label, not as a price.

**Reading the web within its rules** (`packages/core/src/sources/web.ts`). The reader never
requests a host on the deny list or a private address, connects only to the address it
validated, reads robots.txt and obeys it (RFC 9309: the group that names the reader, else the
general one; the longest rule wins; paths are compared with their escapes made the same; no
answer means no; a file with rules too long or too many to apply means no to the whole site),
waits between requests to one host and longer when the site asks, sends no login and no cookie,
and gives up on anything large or not text. A robots.txt is a stranger's text: its patterns
are matched by hand, because turned into a regular expression one crafted rule can hold a
server for minutes. It does not log in, does not solve challenges and does not disguise itself: a site that
says no is a blocked page, counted on its trail.

robots.txt is not the whole contract. Several places where early founders show up allow every
reader in robots.txt and forbid automated reading in their terms: Devpost, Y Combinator's own
site, Substack. Reddit and Indie Hackers refuse in robots.txt itself, the second by naming AI
agents. Product Hunt's API is not for business use, and X is a paid API. The reader does not
request any of them (`TERMS_BARRED_HOSTS` in `policy.ts`, each with its rule; the sentences are
quoted in `docs/research/open-web-hunting-grounds.md`). The list also bars YouTube, Vimeo and
Spotify media hosts. Hacker News is read through its public API. The list is a floor: it will need
a person to add to it as trails reach new sites.

The reader names itself `web-reader/1.0` unless `HUNT_USER_AGENT` says otherwise. A reader
should carry a name and a contact address of its owner, so a site can refuse it by name; that
name is the owner's to choose, so it is a setting and not a default.

**Where the early signal is.** The one place with published timing is GitHub: start-ups raise
their activity there in the twelve months before a first financing round (Conti, Peukert and
Roche; 160,065 US start-ups). For first posts, new packages, new models and people announcing
they have left a job, no study of lead time was found. The seed trails are therefore new
repositories and first posts, and everything else is for the navigator to try and for the yield
figures to judge. Places that can be read without a key and are not yet engines: the Hugging
Face Hub, the npm, PyPI and crates.io registries, OpenAlex, Mastodon and Bluesky. A securities
notice (Form D) is public and free, and late by design: it is filed after the first sale.

**Which model.** The navigator defaults to the strongest judgment model on a login that needs no
key (`claude-cli`, Opus); Codex is a route change. Runner jobs can use DeepSeek Flash and Muse
Ember through their direct APIs or OpenCode. When both routes are ready, runner calls split equally;
scouts and screening use 50% ordinary route and 25% each cheap model. Direct APIs take precedence
over OpenCode. A configured pool or pinned route takes precedence over these defaults. With no
ready cheap route, runners use the small Claude model on the login. The owner accepted DeepSeek
Flash and Muse Ember through OpenCode for scouts, screening and runners on 2026-11-13. Code
rebalances only jobs with checked output; screener shares stay fixed.

"DeepSeek or Meta" is answered by that measurement. What is known beforehand
(`docs/research/rapid-runner-models.md`, measured by Artificial Analysis and read from each
vendor's documents on 2026-11-13):

| | DeepSeek Flash | Meta Muse Ember |
|---|---|---|
| Price for a million tokens, in and out | $0.30 and $1.20 at peak, half off-peak | $0.10 and $0.50 |
| Time to the first token, 10,000 tokens in | 1.2 s on its own API, 0.6 s on a US host, with thinking off | 5 to 8 s at the two settings measured; the lowest setting is unmeasured |
| Tokens a second once started | 170 on its own API, 300 on a US host | 520 |
| Answer in the asked shape | Valid JSON only; can come back blank | Enforced |
| Reasons by default | Yes: 20 to 60 s unless switched off | Yes, and cannot be switched off, only lowered |
| What it does with what it is sent | Own API: Chinese law, servers in China, training not stated. A US host of the open weights: the host's terms | Not used for training; where it is processed is not stated |

So the adapter sends each the switch it needs when a route names no effort (thinking off for
DeepSeek, the lowest reasoning for Meta), puts the shape in the prompt and repairs once where
it is not enforced, and DeepSeek has no default address: an operator must name a host they have
approved for data about named people. None of this was run against a live key here.

**How it joins the rest.** The hunt is a stage of a run, after the fixed scouts and before
matching. A person a runner found becomes a lead like any other (source "web", with its trail,
its quote and its stage), and from there the pipeline of section 5 applies unchanged: matching,
the fit screen, investigation, the quote check, fact-checking, the rubric. The hunt may spend at
most `hunt.budget_share` of a run's cap. Each call is given an allowance before it starts, out
of what is left of that share, and is held to it; allowances in flight never add up to more
than what is left, and a call that finds no room waits for one in flight to finish instead of
ending the hunt.

**A person's hand comes first.** A navigator's turn takes seconds to arrive, and a person may
have pinned, paused or closed a trail meanwhile. The turn is checked against the trails as
they are when it arrives. The navigator cannot close a pinned trail or a paused one, cannot
reopen what a person closed, and cannot change attention on a trail that is not open.

**Pools of context.** The navigator reads the objective, steering, the partner's calls and the
hunt notebook, and nothing a page said. A runner reads the objective, one page, what its trail
is looking for and three lines of the notebook. What a runner writes about a page reaches the
navigator only as counts and as labels of a few words, and the navigator is told they are data.
Three crossings were added to the table for this.

**Steering it.** A person steers the navigator the way they steer any agent (section 6), and
also in the hunt's own terms: open a trail, pin one so it cannot be closed, pause or close one,
set its attention, write a line in the notebook. A person's note is shown to runners before the
navigator's.

**The navigator steers the search and never the scoring.** It cannot write guidance for the
analysts or change a weight. Those change only through a person or through an eval's keep rule
(section 11). A page can therefore mislead a hunt toward a bad address, which the address rules
and the budget bound, and it cannot reach a founder's score.

**Reviewed twice.** An independent reviewer read the hunt twice. The first reading found
nine defects and the second seven, all fixed, each with a test: among them a robots.txt
pattern that could freeze the server, a way round robots.txt with an escaped letter, a
navigator's answer undoing a person's pin, a runner supplying a company address that was not on
the page, and work stranded on a closed trail. The fixes to the second reading were not read a
third time.

**What happened when it ran** (2026-11-13). In simulation: six simulated days from the command
line, and in the dashboard a trail added by hand read fifteen pages and found seven people on
the next run. Live, on the headless logins, four runs on one notebook for $0.25 in all:

| | |
|---|---|
| Navigator (Claude Opus) | 5 turns, about $0.04 and 8 to 17 seconds each. It wrote searches in each engine's own syntax (`topic:llm created:>2026-10-15 stars:>50`), added nothing on later turns because enough was waiting, raised attention on the one trail whose finds the screener had kept, and on the fifth turn closed the trail that had found nobody, giving the counts as its reason |
| Search engines | Hacker News, GitHub and the Hugging Face Hub: 12 of 13 searches returned results |
| Runners (Claude Haiku on the login) | 12 result lists sifted at $0.001 each and 18 pages read at $0.002 each, a median of 5 to 8 seconds a call. That is the headless start-up, and it is why runners are meant for a direct API |
| Reader | 14 pages read on huggingface.co, github.com and projects' own sites, each after its robots.txt. One page was refused by its site's robots.txt and one answered HTTP 500; both were counted as blocked |
| Checks | 4 people kept, each after code found the name and the quoted words on the page. 4 planted pages read; the runner reported nobody each time |
| After the hunt | The 4 were matched and screened in the run that found them: the fit screen kept 3 and left 1 out, and the trail's count of kept finds followed a run later |

The first run read no page at all: every call of both waves was a search, because the oldest
item went first and the navigator kept adding searches. That is why pages now go before
searches. Four runs show that the parts work together on real sites. They say nothing about
how many founders a hunt finds, or how good they are, and nothing about DeepSeek, Meta or OpenCode
as runners: no live route for these models was available, so those paths have run only against a
fake client.
The last of the four ran on the code as it is after both reviews.

**Open-web search.** The live hunt can use Claude's native `WebSearch` tool through the
`hunt.search` job. The job asks for one search, runs inside the hunt budget and extracts URLs only
from tool results, never assistant prose. The runner call is capped at ten hits; code validates
them before the numbered results reach the sifter. Set `HUNT_WEB_SEARCH=off` to disable this engine.
OpenCode does not support this search tool.

Linkup is the selected search service, pending a written answer on keeping a queue of result
addresses. With `LINKUP_API_KEY` set, app assembly uses Linkup instead of Claude WebSearch. The
adapter sends a `fast` `searchResults` request and excludes domains on the no-read list. Its default
ceiling is 200 searches per UTC day in process memory, separate from the hunt budget, and it resets
when the server restarts. It has a fake-client test but has not been called against the live service.

The Linkup terms read on 2026-11-13 limit copying, extraction and retention to text and data
mining, require that results not be passed on, and require honoring a rights holder's opt-out.
Linkup may use prompts to improve its service unless zero data retention is arranged. Before
connecting it, ask Linkup in writing whether storing result URLs, names and snippets in a database
queue for later automated reading fits article 4.1, and whether zero data retention can be enabled.
The terms review and its limits are in `docs/research/web-search-services.md`.

**Outside navigator seat.** The Hunt page can hand `hunt.navigator` to an outside agent. Start the
local server and connect its stdio MCP process with `pnpm swarm mcp --swarm SWARM_ID`; setup and
the turn/wave loop are in `docs/agents/hunt-seat.md`. The outside agent receives the same bounded
`NavigateInput` as the built-in navigator, without page text or founder dossiers. Turns pass
`applyNavigatorTurn` and `checkTurn`, and are audited. It can ask for a hunt-only wave. The built-in
navigator takes the seat back after the configured idle period, two days by default. The MCP
process forwards requests only to the loopback API and does not open the database.

**Hunt yield eval.** `hunt-yield` runs each case with a fresh in-memory store and a seeded simulated
world for three hunt-only days. Sixteen fixed worlds split into eight train cases and eight held-out
cases. One tunable setting changes at a time; wave size and navigator turns stay fixed. The
headline, `strong_early_found`, is the share of strong early founders visible in the simulated web
that the hunt kept. Late-stage people kept, planted-page failures and runner calls are guardrails.
A deterministic bootstrap over held-out worlds sets the noise floor. Hidden simulator truth is
joined only after each trial finishes. Run it with `pnpm swarm eval rounds --flow hunt-yield
--rounds 2`. The web is simulated; these results say nothing about real founders. A live baseline
may use live models but still reads the simulated web. Automatic live rounds are refused until a
spending approval path exists, and autopilot cannot apply this `realData: false` result.

**Built now and still missing.** General web search through Claude's tool, Linkup wiring, the
outside MCP seat, and the simulated hunt-yield eval are built. Linkup has only fake-client tests;
a written answer is still needed before keeping its result queue. A live
calling adapter, recording upload and intake controls, a retention schedule, and notices for people
in the EU and UK are not built.

## 17. Recordings and calls

**Recordings.** A queued recording belongs to one founder and swarm. The fetcher accepts direct
HTTP audio or video files only. It checks the host policy, resolved addresses, robots.txt and each
redirect, and refuses embedded players, barred hosts, private addresses, non-media responses and
files over 150 MB by default. SQLite stores the transcript and time-coded segments. `MEDIA_MAX_MB`
sets the size ceiling.

The live transcriber prefers `TRANSCRIBE_COMMAND`, which must include `{file}` and is started
without a shell. Otherwise it uses `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_API_KEY` and
`TRANSCRIBE_MODEL` at an OpenAI-compatible endpoint and requests `verbose_json`. The media stage
uses `media.enabled` and `media.max_minutes_per_run`. `media.read` receives a founder brief and one
time-coded transcript stretch. Code keeps only exact words found in that stretch, adds the time to
the evidence address and marks the quote found before ordinary fact-checking. Simulation uses
`SimWorld.transcript`; hidden simulator state stays out of model input.

The add/delete recording API, upload, recording suggestions from the talks analyst, and the
founder-page Recordings block are not built. Neither transcription adapter has been run against a
real service. There is no retention schedule.

**Calls.** Runs still only propose outreach. A person can place one approved founder or reference
call after entering how the person agreed to an AI call and choosing whether to record. Code
requires an E.164 number, a time zone whose local time is from 09:00 through 19:59, the emergency
stop off, and fewer than five calls on the current UTC date. Failed, declined and unanswered calls
do not retry. The action and audit retain only the number's last two digits.

The opening and instructions are made from code and the approved agenda. The opening gives the
draft disclosure, asks if now is a good time, and states that recording is in progress when the
person chose recording. Code records the operator's consent statement and recording choice; this is
not a legal finding that consent was valid. Instructions limit the call to approved questions,
exclude personal attributes and direct it to stop on request. Code passes a 15-minute limit to the
dialler. No live dialler is connected, so those instructions have not been checked in a real call.
A completed transcript is stored only when recording was chosen and is redacted before it becomes
evidence. Simulated calls use `SimWorld.transcript` and mark the evidence simulated.

No live dialler is connected. The vendor-neutral live dialler returns no adapter, and there are no
Vapi key settings in code, so keys alone will not enable a real call. The owner accepted Vapi as
the preferred service on 2026-11-13, after counsel's review. Counsel must answer the consent,
recording, AI disclosure, time and jurisdiction, data retention and vendor-contract questions in
`docs/research/ai-voice-calls.md` before the first real call. That research was not tested against
a live service and leaves legal questions open.

## 18. Decisions that are yours

1. The fund's name and first thesis.
2. Which profile-data vendor to sign with, after reading its terms and asking where its data comes from. The People Data Labs adapter works with a free key (100 records a month) for a first look.
3. Whether the fund will hold data on people in the EU or UK. If so, a notice and a retention limit must be built first.
4. How much the founders should count against the company (the share is 0.6 today), once there are real calls to tune it on.
5. Accepted 2026-11-13: if calls proceed after counsel's review, use Vapi. Counsel's answers and
   the live dialler implementation remain open.
6. API keys for unattended daily runs. The command-line logins are fine for a prototype; a scheduled production run should bill an API account.
7. Accepted 2026-11-13: add more labelled cases from the fund's own deal history first. The
   past-founders eval has 155 cases and needs roughly seven times that to steer anything.
8. Hosting and login, before anyone but you opens the dashboard.
9. What counts as a company that did well. Today: publicly listed, on its programme's list of top companies, or still operating with at least 100 people. A labels file overrides it.
10. Which model judges past cases (`EVAL_JUDGE`), and how much autopilot may spend on evals each day (zero today, so it only suggests).
11. Accepted 2026-11-13: use DeepSeek Flash and Muse Ember through OpenCode for scouts,
    screening and runners. Direct API routes take precedence when configured. The default scout
    and screener shares are 50% ordinary route and 25% per cheap model; runner shares split equally.
    Never use Meta's contributor tier for anything but public material and fund instructions.
12. Accepted 2026-11-13: Linkup is the preferred search service, conditional on its written answer
    that keeping queued result addresses is permitted under article 4.1. Still open: that answer,
    the reader name and contact address in `HUNT_USER_AGENT`. Seed remains the latest stage by
    default; any direct DeepSeek API requires a separately approved host.
13. Which sites to add to the list the hunt does not read. The list holds the ones whose terms were read; a trail will reach others.

## 18. X through xAI, and accelerator batches

Added on 2026-11-13. Three things reach the pipeline that did not before: what a founder posts
on X, in words and in video; recent posts by small accounts announcing something of their own;
and the newest batches of four startup accelerators. Each enters as a lead or as unverified
evidence and goes through the same screen, fact-check and rubric as everything else.

**What xAI's API gives, and what it does not.** The Responses API has a tool, `x_search`, that
lets Grok search X by keyword and by meaning, find accounts, fetch a thread, and look at images
and video attached to posts. Code can hold a call to named accounts (at most twenty) and to a
range of dates. The API does not hand back the posts. It returns the model's answer, a list of
the addresses its searches returned, and counts of posts and profiles fetched, which is what it
bills: $5 for a thousand posts and $10 for a thousand profiles, on top of tokens. So every word
of a post in this system, every date and every count of likes or followers, is what a model
wrote. The one fact that comes from the API and not from the model is which posts a search
returned. The research, with each sentence of the documentation it rests on, is in
`docs/research/grok-x-search.md`.

**How code checks a post's words.** X's robots.txt refuses a generic agent. Its embed
address (`publish.x.com/oembed`), which X documents as open and needing no key, is refused by
robots.txt on both of its hosts as well. This system obeys robots.txt, so neither is read.
What code can read is X's own API, with the fund's credentials: one post by its id, for a fee.
With `X_BEARER_TOKEN` set, every post xAI names is read that way and its words, author, date
and counts are X's. Without it, a post stays a model's report, labelled as one, and the quote
check does not run on X.

**Approaches considered.**

1. Grok alone, with a second Grok call as the check. Built. One vendor, one key, video
   included. Its weakness is that a model's report is checked by another model of the same
   vendor; the planted false claim shows whether the checker looked, not whether both are wrong
   in the same way.
2. The official X API to read each post Grok names ($0.005 a post, $0.010 an account). Exact
   words and measured counts, so the quote check runs. It needs a developer account whose
   application describes the use, and its terms require stored posts to follow X, which means
   a refresh. Built on 2026-11-13, on top of 1, after the owner supplied the credentials. It
   checks what Grok found; it does not find anything itself.
3. Reading the embed address despite robots.txt. Not built. That is the owner's decision, as
   it was for the professional network, and it has not been made.

**What code decides.**

- The scope of a call (accounts, dates, whether video and images may be opened) is set by the
  job and sent as the tool's settings. A prompt, or a post, cannot widen it. Only the xAI
  provider may run a job that reads X, and that provider refuses a research or search call that
  carries no scope, so nothing is answered from memory and called a post.
- An address is kept only when xAI's API lists that post among what its search returned in the
  same call. A post the model wrote down and no search returned is dropped. The API usually
  writes a post's address without its account; where it does name the account, an answer that
  gives the post to another account is dropped.
- A call's cost is what xAI reports. When an answer carries neither a cost nor a count of what
  was fetched, or a search runs out of time, the call is charged at the cap it was given: the
  run's spend cap treats an unknown cost as nothing, and a paid search must never count as
  free. That also stops the blind retry of a paid call. A request xAI refuses or fails
  outright, with no usage in its answer, is not taken as spend; that is a judgment, since xAI
  does not say whether such a request is billed.
- A founder's evidence comes from one account. When the founder's profile link or a post the
  checker already supported names it, the search is held to that account. When neither does,
  the model must find it and say which words in its bio or posts tie it to this person and
  their company; with no such tie it returns nothing. The founder's profile link is not changed
  by what the model found.
- A post about the company (product, traction, team, funding and the other facets) is filed as
  company evidence, which the founder analyst is not shown. With no company on file it is
  dropped.
- Counts are stored in the item's title as "xAI reports: ...". The size ceiling for a search
  (`x.max_followers`, 25,000, a first guess) is applied to the count the model reports, and an
  account whose size it did not report is left out.
- In the hunt, a post cannot be opened, so what the search reported is held on the queued item
  and a runner reads that. Nothing is requested. The runner's checks are unchanged: a person is
  kept only when the name and the quoted words are in what it was shown. That guards against
  the runner inventing someone. It does not guard against xAI's report being wrong, which is
  why such a lead is only a lead. The lead's X link is set by code, and only when the person
  is the account's own display name.
- X evidence is never sent to the usual fact-checker, which cannot read X and would mark all
  of it unsupported. It goes to `verify.x`: a separate call, on a different Grok model from the
  one that collected, that fetches each post again and carries the planted false claim. A
  checker that accepts the plant has its verdicts thrown away. After that, "supported" stands
  only for a post the API lists among what that call fetched; a post the checker called
  supported without fetching stays unverified. The account item, which is not a post, is
  judged by the verdict alone. With no xAI key, X evidence stays unverified and is never scored.
- The reading of a founder's account is shown the founder's own posts already on file and not
  the company's, since no company evidence crosses back to a founder's researcher. Code keeps
  a post from being filed twice.
- A simulated run reads no X and lists no accelerator. The simulated world and the numbers
  tuned on it are unchanged.

**What X's own API is used for, and only for.** The reader in
`packages/core/src/sources/x-api.ts` asks for posts by id (`GET api.x.com/2/tweets`). It never
searches, never lists an account's posts and never looks a person up, so it cannot find
anyone: it confirms or refutes what xAI's search already named. It sends X nothing but post
ids. What X's terms say about this use, sentence by sentence, is in
`docs/research/x-api-post-lookup.md`.

- Before the X fact-check, each new post is read and the item's quoted words are looked for
  in the post, as the quote check does on a web page. X shortens every link in a post's text,
  and a copy of the post may give the address the link leads to, the short one, or none. So a
  link in the post may be left out of the quote, or matched by one link-shaped word of it
  ("acme.studio"); anywhere else such a word is compared as the words it is, and an ordinary
  word never takes a link's place. Links do not count towards the four words a quote needs.
  A quote over 4,000 characters is not looked for, and a post over 30,000 is cut at the end
  of a word; neither is reached by a real one.
  Words that are not in the post reject the item. So does a post X gives to another account
  than the item's address names.
- Words said or shown in a video cannot be found in a post's text, so a video item is marked
  as not checkable by code and stands or falls with the X fact-check alone.
- An item that passes has the model's counts and date replaced by X's: its title says
  "X reports", not "xAI reports".
- In the X fact-check, "supported" stands for a post that call fetched or a post whose words
  code found.
- In the hunt, each hit of an X search is read before anything else. A post X no longer shows
  is dropped, and so is one whose account is over the follower ceiling by X's own count. The
  sifter and the runner are then shown the post's own words, and the runner is told so. A hit
  that could not be read (the day's ceiling, a failed request) stays a model's report.
- X's terms require a stored post to follow X: removed there, removed here. A post X no
  longer shows (deleted, protected, suspended, withheld) has its words taken out of everything
  that holds them, in one step (`forgetXPosts` in the store), in every swarm:
  - every evidence item that cites it, whatever its verdict. The item keeps its id, so that
    whatever cited it still points somewhere;
  - a lead found on it: the quote, the title, the model's description and the stage answers
    with the words they quoted go; the name and account stay;
  - a page held for a runner in the hunt's queue, which is then never shown to one;
  - the output and the transcript of every task that names the post, by either spelling of
    its address and on any host, since a mirror carries the same words. Such a task carried
    other posts too, and loses those as well; its cost and counts stay.
- The founder is then assessed again without the item. When a run finds the post gone while
  checking evidence, that is in the same run. Otherwise (the hunt found it, another swarm's
  run did, or a person removed it) it is the next full live run, and only if the founder's
  current assessment cites the item.
- Each live run re-reads up to 200 stored posts, starting at a place drawn afresh each run, so
  every one comes round: posts cited by evidence, posts leads were found on, and posts held in
  the hunt's queue. This runs even with `x.enabled` off. It is upkeep in turn, not a watch: a
  post deleted today may stay on file until its turn. `pnpm swarm x forget <address or id>`
  removes one post at once, for a written request.
- Not removed: what a model wrote after reading the post, in a founder's profile fields or in
  an assessment made while the post was up. And a post that reached nothing but a task's
  transcript (a search hit nobody picked) is not re-read by the upkeep; the command above
  removes it. X documents a batch compliance job (`POST /2/compliance/jobs`) for checking many
  stored posts at once; its price is not stated anywhere and it is not used here.
- Every post read is billed by X, outside the run's spend cap, so the reader has its own
  ceiling, `X_POSTS_PER_DAY` (200). A request counts against it when it is sent, and is given
  back only when X answers that it refused the token or the rate: a request that timed out may
  have been billed. New evidence is read before the upkeep. A post read once is not asked for
  again that day. A refused token stops all reading until the server is restarted. The count
  and the day's answers are kept in memory, as the data vendor's are, so a restart begins the
  day's ceiling again; X says it bills a post once however often it is read in a day, and
  calls that a soft guarantee.

**Accelerator batches.** A search engine for the hunt, `accelerators`, run by code. It lists
the newest batches of Y Combinator (through the open mirror `yc-oss.github.io`, two newest
batches), a16z speedrun (the current cohort), 500 Global (companies first funded in the last
eighteen months) and Berkeley SkyDeck (two newest batches), ranks them by the words of the
query and by recency, and takes turns between programmes. A hit is the company's own site, or
for speedrun the programme's page about the company, which names its founders. The hunt then
does what it does with any hit: a runner picks, code reads the page within robots.txt, and a
person is kept only when the page names them. 500 Global's list names founders; those names
are not used, because a person enters only from a page a runner read. Y Combinator's own pages
are on the list of sites this branch does not read, so its founders come from each company's
own site. Listings are kept for six hours, and before a listing is asked for, the directory's
robots.txt is read and obeyed under the name the page reader uses, so a directory that later
refuses is no longer read. Requests to one directory are two seconds apart, as the page
reader's are, or as far apart as its robots.txt asks; a directory that asks for more time than
one search has is not listed. A record needs only a name and a site: the newest companies leave
other fields blank. What each directory allows, and the ones left out
and why (Techstars hands its list out behind a key in the page; Antler's robots.txt refuses
its company pages; Entrepreneurs First loads the rest of its list by a call that was not
identified), is in `docs/research/accelerator-directories.md`.

**What these add to the knowledge of a founder.** A founder found in a batch or on X is
screened, then investigated by the existing researchers (background, their part in the company,
talks, risks, code), by the data vendor for work history, and now by the reading of their X
account. The professional network itself is read or not read as `packages/shared/src/policy.ts`
says on the branch this lands on.

**Not verified.** No xAI key was on this machine, so the provider, the three jobs and the
check have run only against a fake client; the request and response shapes come from xAI's
documentation as read on 2026-11-13. Not known: whether a JSON schema works together with
`x_search` (the documentation shows it with web search), what video costs in tokens, how long
a video may be, and whether the tool honours a request to prefer small accounts. Check first,
with a live key: whether a post the checker fetches again by its address appears in the list
of addresses the API returns. If it does not, no X post can be marked supported, X evidence
stays unverified, and every run pays to check it again.

X's own API was read live on 2026-11-13 with the fund's token: two public posts and one
made-up id came back as two posts with their authors and counts, and one "not found". Not
known: whether X bills the author returned with a post as a separate read ($0.010; its
pricing page says "per resource returned in the response" and no more); how a post from a
protected or suspended account, or one withheld in a country, comes back (the reader treats
any post X names in its errors as gone); the whole text of a long post, which was not among
the posts read; and how Grok writes a link inside a quote, which the matcher allows for but
has not seen.

The accelerator engine was run against the four live directories on 2026-11-13: ten requests
(four robots.txt files, six listings), a hundred hits, all four programmes present. That is one day's page shapes; a directory that changes its page stops
being listed and the other three carry on.

**Decisions the owner made on 2026-11-13.** Asked about the first two below, the owner
answered "that's fine" to each, and gave the credentials for X's own API in answer to the
third.

1. xAI's enterprise terms have the customer warrant that personal data is sent only through a
   team with zero data retention switched on. A founder's name and posts are personal data.
   The choice put to the owner was to switch it on for the team behind `XAI_API_KEY`, or to
   accept that prompts naming founders are kept by xAI for 30 days. Whether `x_search` works
   with it on is not stated.
2. xAI's acceptable-use policy bars "high-stakes automated decisions" about a person. Here a
   model answers rubric questions, code scores, and a partner decides.
3. The official X API was added so that a post's words and counts are measured.

**The remaining decisions.** Asked for these the same day, the owner answered "for my
decisions, go with your recommendations". These are the recommendations. They stand until
the owner changes them, and the first four come from X's developer terms, which bind whoever
holds the credentials.

1. **Tell X plainly what this does.** X's Developer Agreement (section XIV.B) says that
   "unless explicitly approved by X in writing" X content is not used for "conducting or
   providing surveillance or gathering intelligence, including but not limited to
   investigating or tracking X users or X Content", and its restricted-use rules list
   "Background checks or any form of extreme vetting" and "Individual profiling or
   psychographic segmentation". None of these is defined, and none mentions investors. A
   dossier on a named founder is close enough to those words that X should be asked, and
   "your use case description is binding on you". A description to submit is below. Only the
   account's holder can submit it, so that is still the owner's to do. Until X answers, its
   API is used as built: posts xAI already named, read by id. If X refuses the use, blank
   `X_BEARER_TOKEN` and remove what was read.
2. **Models may be shown what X's API returned.** The agreement bars providing X content "to
   any third party except as expressly permitted", with no exception written for a service
   provider. A model provider that answers one request and keeps nothing is not who that bar
   is aimed at, X's own "what to build" page proposes feeding X data to language models, and
   training a model on X content, which is barred outright, is not done here. So a runner
   reads a post's own words and an analyst reads X's counts. The description below says so,
   so that X's answer covers it. Code keeps the one line X draws outright: a runner's task
   that carries a post read through X's API is never sent to a model whose vendor trains on
   what it is sent (`noContributorModel` in `routeForTask`), and the jobs that read a
   founder's file may not use such a model at all. Still the owner's to keep true: every
   other provider in use has terms under which it does not train on what it is sent.
3. **A removal request is acted on by hand, the same day.** A stored post must be removed
   "as soon as possible, and in any case within twenty four (24) hours after a written
   request". The upkeep takes posts in turn, so a request from X or an account's owner is
   answered with `pnpm swarm x forget <address or id>`. If access ends, everything read
   through the API has to be deleted, and no command does that yet.
4. **What is read from X is held to X's list as well as this system's.** X asks that nothing
   be derived or stored about a person's health, "negative financial status or condition",
   politics, origin, religion, sex life, union membership or "alleged or actual commission of
   a crime". The prohibited attributes in `rubric.ts` cover all but money troubles, union
   membership and crime. Those three are now barred for anything read from X: the two jobs
   that read X are told so, and code drops a hit, an account or an item whose words state one
   about a person (`offLimitsOnX` in `packages/core/src/jobs/common.ts`). A post read through
   X's API is held to the same check before its words are kept. It is a check on phrases: it
   misses what is said another way, and it leaves a company's finances alone. Elsewhere the
   researchers may still report a court record or a bankruptcy from a public page.
5. **Spending on X's API stays at the default ceiling**, 200 posts a day: $0.005 a post,
   perhaps $0.010 more for each distinct author in a day, so at most $1 to $3 a day.
6. **X is read with video, as asked, and measured on the first live run.** Reading one
   account fetches tens of posts: about $0.30 for sixty, plus tokens, and video costs more by
   an amount xAI does not publish. Give the first run with an xAI key a small budget and read
   what it spent before raising it. `x.enabled` turns off all reading of X but the upkeep of
   posts already on file; `x.media` turns off video and images. When the key is made, switch
   zero data retention on for its team: xAI's terms ask for that where personal data is sent.
7. **Y Combinator's own company pages are not decided here.** Its robots.txt allows them and
   its terms forbid scraping. This branch does not read them; the page reader's policy on the
   branch this lands on decides, and nothing in this section changes it.

The description for X's developer account, to be checked against what is then running and
with the model providers named:

> We are a venture investment team. Our internal tool helps a partner find and read about
> founders of early companies. It uses one endpoint of the X API, post lookup by id (`GET
> /2/tweets`). Through this API it never searches, never lists an account's posts and never
> looks a person up.
>
> Posts in which a founder writes about their own product or company are found for us by
> xAI's Grok API, which also reads a founder's recent public posts when our tool studies that
> founder, and again when the founder is next reviewed. Before the tool relies on such a
> post, it looks the post up by id through the X API to confirm that the post exists and who
> wrote it, that words quoted from it are in it, and to read its public counts and the
> author's follower count. A confirmed post becomes one source in an internal profile of the
> founder's professional work. The profile is scored against our own rubric about that work,
> and a partner reads it when deciding whether to contact the founder. A person makes every
> decision; nothing is sent to a founder automatically.
>
> We do not keep or infer anything about health, finances, politics, religion, origin,
> sexual orientation, union membership or criminal history, and posts about these are
> discarded. We do not share or resell X content. Post text and counts are processed by our
> language model providers (named here) for inference only, under terms that bar training on
> our data. No model is trained or fine-tuned on X content.
>
> Stored posts are looked up again in turn, and the content of a post X no longer shows is
> deleted. A post named in a removal request is deleted within 24 hours. We make at most 200
> lookups a day.
