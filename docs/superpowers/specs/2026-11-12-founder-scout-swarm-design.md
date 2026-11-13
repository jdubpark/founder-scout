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

- Placing AI voice calls. The queue, approval flow, transcript intake and debrief exist; the dialler does not.
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
kept apart so a partner can see a strong person at a weak company or the reverse. Founders who name
the same company site (or, with no site, exactly the same name) share one company record.

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
| Scouts, screener | Claude Haiku 5.5 | Highest volume, simplest judgment | $0.10 / $0.50 |
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
service**, because no keys were available.

## 9. Sources and conduct

| Source | Access | Status |
|---|---|---|
| Hacker News | Official search API | Live, verified |
| GitHub | Official REST API, optional token | Live, verified |
| arXiv | Official API, one request per three seconds | Live, verified |
| Open web | The model provider's search and fetch tools | Through research jobs |
| Professional profiles | A data vendor's API under contract. An adapter for People Data Labs is built | Built, unverified against the live service (no key on this machine) |
| Your network | A partner's own exported contact list, uploaded by that partner | Built |
| Added by a person | A name and a link typed into the dashboard | Built |
| Conversations | Approved outreach, pasted notes | Intake built; no dialler |

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

The second flow starts once each half of a fixed random split holds four yeses and four noes: sixteen calls at the least, usually twenty to thirty.

**Why the synthetic headline is not outcomes.** The first design ranked on simulated outcomes. Measured on 200 groups, a random ranker scored 0.20, the default pipeline 0.31 and an oracle that knows true quality 0.35, with noise of 0.03: the whole headroom was the size of the noise, so no change could ever be kept. Outcomes in the simulated world are a weak, noisy function of quality, as they are in venture. In a simulated world true strength is known, and recovering it is the thing the pipeline controls, so that is the headline; outcome hits in the top five are reported beside it.

**What the loop did on the default configuration** (2026-11-13, simulation): starting quality 0.877, noise 0.012. Of five proposals, four were reverted because their gains were inside the noise or raised cost. One was kept: hiding school and employer names from the rubric analyst cut pedigree leak from 0.31 to 0.20 with ranking quality no lower. A separate test starts from a deliberately broken configuration (the two engineering weights at zero) and checks that the loop climbs out of it.

What the loop may change: rubric weights, thresholds, the prompt variant of the rubric analyst,
and the model of the analyst and the fact-checker. What it may not: anything a person has set by
directive. Promotion to the live swarm is a person's click.

**What the synthetic flow proves and does not.** It proves the machinery: the split, the noise
floor, keep-or-revert, the guardrails, and that a pipeline which leaks pedigree is caught. It says
nothing about real founders.

**Next evals, in order of value**

1. Partner calls, which start accumulating on day one.
2. A public benchmark of anonymised real founder profiles with outcome labels (VCBench: 9,000 profiles, 9% base rate, with re-identification tests; licence to confirm) for the assessment stage.
3. A sourcing-recall replay: of founders who later raised from strong investors, how many would the scouts have flagged, and how early.
4. Groundedness: plant unsupported claims and measure the fact-checker's catch rate on real pages.
5. A judge calibrated against partner labels before any model-graded metric steers a change.

Known hazards: models may recognise famous founders (anonymise, and test for recognition); outcomes
are right-censored; scores can learn pedigree as a proxy (the pedigree-leak metric exists for this);
language models over-predict success by trusting founder claims (the reason for the fact-checker and
the integrity question).

## 12. The dashboard

Eight destinations: Home, Founders, Approvals, Swarm, Steering, Improve, Activity, Settings.
Direction from the owner: light, very simple and professional, modelled on Slack; as little text as
possible, with icons and simple diagrams in its place; desktop only. The visual system is recorded
in `DESIGN.md` and the page-building rules in `apps/web/BUILDING.md`.

- **Home**: who was surfaced, with Yes and No on each row; what needs the partner; the swarm as one line of teams; the last run as a funnel.

- **Swarm**: a map of the swarm as a flow of nodes with state and volume. Select any swarm, class, job or agent to see what it is told and to steer it.
- **Founders**: the ranked list with a yes and a no on every row; a slider that shows who would clear a different bar before saving it; a dossier where each rubric answer sits beside its evidence.
- **Steering**: everything the swarm has been told, suggestions from the partner's calls, and a composer.
- **Approvals**: drafts to approve, edit or reject.
- **Improve**: both eval flows, round by round.

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

## 15. Decisions that are yours

1. The fund's name and first thesis.
2. Which profile-data vendor to sign with, after reading its terms and asking where its data comes from. The People Data Labs adapter works with a free key (100 records a month) for a first look.
3. Whether the fund will hold data on people in the EU or UK. If so, a notice and a retention limit must be built first.
4. How much the founders should count against the company (the share is 0.6 today), once there are real calls to tune it on.
5. Whether AI voice calls are wanted at all, and with which vendor, after legal review.
6. API keys for unattended daily runs. The command-line logins are fine for a prototype; a scheduled production run should bill an API account.
7. Where real labelled founders for the eval come from.
8. Hosting and login, before anyone but you opens the dashboard.
