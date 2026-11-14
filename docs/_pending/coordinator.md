# Facts from the coordinator, for the second documentation pass

Everything here was done or measured on 2026-11-13 after the first documentation pass. Where
this file and an older sentence in README, CLAUDE.md or the design disagree, this file and the
code are right.

## What changed in behaviour

1. **Calls.** A calling service can now be connected. `createLiveDialler` returns the Vapi
   adapter when `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID` and `VAPI_VOICE_ID` are set; placing a
   call also needs `FUND_NAME` and `FUND_CALLBACK_NUMBER`, because a call with an artificial
   voice must say who is calling and give a number. The adapter has a fake-client test only and
   has never placed a call. Before dialling, the consent and a placement mark are saved, so a
   crash between the service accepting the call and the record being written cannot lead to a
   second call: such an item is marked failed and a person checks. Phone numbers are removed
   from every stored call text. Not built: an invitation and written-consent flow, a
   do-not-call list, a check that the callee is in the United States, a review of transcripts.
   A lawyer must review before a first real call. See `docs/_pending/vapi.md` for the table of
   the compliant flow against the code.
2. **Recordings are reachable.** A person adds a recording on the founder's page by link or by
   upload; the talks analyst lists recordings it found (at most three for a founder in a run).
   A link passes the same address rules as a page (the media fetcher now uses the reader's own
   checks). Length is found before transcribing (`ffprobe`, else an estimate from the file size
   at a low bitrate); a recording longer than the run's allowance is refused, not queued again;
   a transcript is made once; sentences stating personal attributes are removed from it; what
   transcription cost is recorded as a task of the run.
3. **The hunt eval was rebuilt twice.** See "The hunt eval" below.
4. **opencode provider.** Each call gets its own data folder holding only a link to the saved
   login, deleted afterwards, so nothing is added to the person's opencode history. The process
   runner now sets `PWD` to the directory the child runs in (opencode takes its project folder
   from `PWD`). The provider reports ready only when a login is saved. Like Codex and the API
   adapters, it cannot be given a spend ceiling for one call: only headless Claude can. A run's
   cap is checked between calls for all of them.
5. **A pool member that is down is left out.** A member whose calls fail twice in a row for a
   provider reason (down, not set up, unsupported, timed out, rate limited) is left out for the
   rest of that run, and its share goes to the others or to the job's one route.
6. **Model and per-task settings** now apply to the navigator, the runners and the company
   researchers as well.
7. **The navigator's "done"** ends the steering for that run. The rounds that are left still
   send runners to what is queued.
8. **A hunt-only run** (an outside agent's wave, an eval's trial) lets the hunt spend at least
   90% of the run's cap, because nothing after the hunt but the fit screen has to be paid for.
9. **Search.** Every engine is asked for ten results. The `web` engine is Linkup when
   `LINKUP_API_KEY` is set, else the model provider's own search tool; `HUNT_WEB_SEARCH=off`
   leaves it out.
10. **robots.txt.** A robots.txt answered with 401, 403 or 429, or one too large to read in
    full (512 KiB), now means the site is not read. A missing one still means no rules.
11. **A tagline** is kept only when it was read on the company's own site.
12. **Who is shown the partners' calls.** Scouts are shown them again (a worker had removed
    this). A task sent to a model whose vendor trains on what it is sent is not shown them.
    Which jobs may be sent to such a model is decided by the job's inputs alone: public pages
    and feed items, and the fund's own words (thesis, steering, notebook, learned lines,
    skills). So: the scouts, the navigator and the runners may; the fit screener may not (a
    lead can come from a contact list or a typed note); nothing that reads a founder's or a
    company's file, a transcript or a contact list may. Choosing such a model is a person's
    act, never a default, and it sends the thesis and steering text to that vendor.
13. **Prompts** tell every agent to refer to a person by name or as "they", and not to guess
    a pronoun from a name.
14. **Deal history.** `pnpm swarm past import --file deals.csv [--bar "<text>"]` merges the
    fund's own past deals into the past-founders dataset. See `docs/_pending/deals.md` and
    `docs/examples/deals.example.csv`.
15. **Dashboard.** The Home list shows the same company line as the Founders table (company,
    industry, round, tagline). The Founders table has six columns: Founder, Company (with
    industry and round chips and the tagline under it), Moat, Status, Overall, Call.
16. **Architecture page** is light only, as designed.

## Fixes after the second independent review (same day)

17. **The past-companies eval never sends a case to a model that trains on what it is sent.**
    Since deal history can be imported, a case may hold the fund's own notes. An `EVAL_JUDGE`
    that names such a model is refused when the server or the command line starts, and inside
    the eval such a route falls back to the job's default route.
18. **The hunt eval's saved state carries a version.** A state file from an older definition
    of the eval is set aside and the flow starts from a fresh baseline, so results measured
    under different definitions are never compared.
19. **A candidate that changes how many calls a run may make** (`hunt.turns` or
    `hunt.wave_size`) is reverted without being measured: the headline is fair only because
    every variant has the same allowance.
20. **A trial whose run failed, was cancelled or stopped at its spend cap is an error**, not a
    low score. The candidate is recorded as incomplete, which the keep rule reverts.
21. **A recording is fetched under the reader's own name** (`HUNT_USER_AGENT`), so a site's
    robots.txt rules for that name apply to recordings as to pages. **A recording whose length
    cannot be measured** is bounded from its file size at 6 kbit/s, the lowest speech is
    encoded at; if that bound does not fit the allowance it is refused.
22. **Two proofs that pruning had weakened were restored**: the default pools' members and
    shares, and the rule that simulator fields stay out of prompts (its test could no longer
    fail; it now can, and was checked by breaking the code on purpose).
23. **The deal-history importer** never quotes a cell's content in the reason for refusing a
    row, so a company's name cannot be printed for a refused row.

## The hunt eval (`hunt-yield`)

- Headline: strong early founders found in one simulated world over three days (hidden quality
  at least 0.6, company truly at or before seed), counted when a runner's report passes the
  page check, before the fit screener. Every variant has the same turns and wave size, so the
  same allowance of calls.
- Guardrails held: share of found people from companies past the latest stage, share with
  hidden quality under 0.4, planted pages fallen for. Reported and not held: runner calls,
  strong early founders per 100 calls, people the fit screener kept.
- A change is compared with the current config world by world on the eight held-out worlds.
  Each metric's noise floor is 1.96 standard errors of those differences, from a bootstrap
  over worlds.
- Why a count and not a rate: the first repair used strong early founders per 100 calls, and
  the loop then kept "follow links one step, not two", which scored 38% better per call and
  found fewer strong founders in total (16.1 against 16.8 on held-out worlds), because the hunt
  ran out of things to read and stopped. A rate for each call rewards reading less.
- Result on this machine (simulated brain, 16 worlds): baseline 17.75 strong early founders
  per world, 95% range 15.4 to 20.1, noise floor of the held-out mean 2.33. Three rounds
  proposed `hunt.max_depth` 2 to 1, `hunt.pages_per_search` 3 to 2 and 3 to 4; all three were
  reverted. The loop works and nothing in these three settings beats the default.
- A trial uses the app's own skills and default pools, so the figure depends on which
  providers are ready on the machine (here the runners were split between DeepSeek Flash and
  Muse Ember, simulated).
- A live baseline (`--brain live --rounds 0`) has real models read the simulated web. It needs
  a budget of at least 16 dollars (a dollar for each world) and is refused with less. It has
  not been run. One live hunt-only run on the simulated web has been (see below).
- The earliest version scored zero everywhere for two reasons worth keeping in the design
  notes: a found person counted only after the fit screener kept them, and each simulated run
  was given about two cents, which is less than one navigator turn.

## Verified by running, 2026-11-13 evening

- **Scouts, screener and runners on DeepSeek Flash and Muse Ember through opencode, inside a
  real run**: 33 tasks, none failed, $0.12, 113 seconds. Scouts read real Hacker News and
  GitHub items; the hunt ran 6 searches (2 of them general web searches through Claude's
  search tool, about $0.013 and 14 to 25 seconds each), read 6 real pages on four sites and one
  planted page (not fallen for), and found 3 people; the fit screen ran on all three models.
  Median call times: sift 3.1 s (Muse Ember) and 7.5 s (DeepSeek Flash); page read 3.4 s and
  5.3 s. Too few calls to rank the two models.
- **An outside agent in the navigator's seat through the MCP server**, on a simulated web: a
  headless Claude Code session (Haiku) read the view, took a turn (one trail opened, one
  LinkedIn address refused with the reason given back), sent a wave and read the view again,
  for $0.004; a headless Codex session (`gpt-6-luna`) read the view, opened one trail, closed
  another and sent a wave. `codex exec` needs `--approve-for-me`, and the command needs
  `pnpm --silent`.
- **The built-in navigator on Codex** (`gpt-6-astra`) with real runner models on the simulated
  web, hunt only: 19 tasks, none failed, $0.25, 43 seconds, 5 people found.
- **A recording end to end**: a ten-second spoken clip made with the Mac's own voice was
  uploaded for a made-up founder, transcribed by a local Whisper model (`mlx-whisper`, tiny,
  run through `TRANSCRIBE_COMMAND`), read by Claude Sonnet, and gave two evidence items whose
  words code found in the transcript; 7 seconds, $0.013.
- **The dashboard** on a real server in simulation: the Founders table and the Home list at
  1280 pixels; the demo page builds (8.7 MB) and opens.
- **The deal-history importer** on the example file: 5 imported, 1 left out for no outcome,
  and the same file again updates without adding.

## Still not verified, say so plainly

- Linkup (no key). The HTTP transcriber against a real service. Fetching a recording by link
  from a real site. Vapi (never called). A live baseline of the hunt eval. The direct DeepSeek
  and Meta API adapters (the keys are in opencode, not in the environment). The People Data
  Labs adapter. Autopilot applying changes over several days.

## Tests

The suite was pruned from 1,209 tests to the number `pnpm check` prints now, in six lanes,
each with a note in `docs/_pending/audit-*.md`: every deleted test names the proof that
remains, and each lane changed the production code on purpose to confirm the kept tests fail
(more than a hundred such checks, all caught). README's Checks section should say in a few
lines how tests are kept few: one proof for each contract at the strongest boundary, a
regression test for each defect a review or a live run found, and no test of a wrapper, a
copied list or a value the code itself produced. CLAUDE.md should carry the same as one rule
ending "(Judgment.)". Do not paste the audit notes into the documents; summarise them in a
short paragraph and delete them.

## Decisions (design section "Decisions that are yours")

- Reader's name and contact (`HUNT_USER_AGENT`): still the owner's. Recommended form:
  `<FundName>Scout/1.0 (+https://<fund site>/bot; <a role address>)`, with a page at that
  address saying what the reader does and how to ask it to stop. It is not set, because a
  contact address is the owner's to choose.
- Runner and scout models: decided and running. Muse Ember (standard tier) and DeepSeek Flash
  through the owner's opencode login. Direct API keys are for unattended runs.
- Web search: the model provider's search tool works today. Linkup is the contracted choice;
  it needs a key and Linkup's written answer on keeping a queue of addresses.
- More labelled cases: the fund's deal history first, through `pnpm swarm past import`.
- Repository: pushed to a private GitHub repository on 2026-11-13 (branch `v0-next`).
- Calls: Vapi after counsel's review; off until its keys are set.
