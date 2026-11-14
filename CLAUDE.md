# Founder Scout

An agent swarm that finds startup founders for a venture investor as early as they can be seen,
builds sourced dossiers on them and their companies, scores both, and learns from the partner's
Yes / No. A long-horizon navigator steers small runners across the open web; an outside agent can
take its seat over MCP, and the Hunt has a simulated yield eval (design section 16). Read the
design before changing behaviour:
`docs/superpowers/specs/2026-11-12-founder-scout-swarm-design.md`.

## Layout

`packages/shared` (pure types and logic) · `packages/core` (store, sim, jobs, providers, sources,
engine, eval, service) · `apps/server` (Fastify API, scheduler, CLI) · `apps/web` (Vite + React dashboard).

`packages/core/src/contracts.ts` is the seam between every directory in core. Change an interface
there first, then its one implementation. Which directory may import which is written down and
enforced in `packages/core/src/rules.test.ts`.

## Commands

```
pnpm check                                   # typecheck all packages, then all tests
pnpm exec vitest run packages/core/src/engine   # one area
pnpm dev                                     # API on 4317, dashboard on 5317
pnpm swarm run --days 3                      # simulated runs from the command line; each prints what its hunt read and found
pnpm swarm past collect --from 2018-01-01 --to 2021-01-01 --yc --unicorns   # build the past-companies dataset
pnpm swarm past import --file deals.csv                                      # merge the fund's labelled deal history
pnpm swarm eval rounds --flow past-founders --rounds 0 --budget 3          # measure it; this calls models
pnpm swarm eval rounds --flow hunt-yield --rounds 2                        # tune the hunt on simulated web
pnpm --silent swarm mcp --swarm SWARM_ID                                    # stdio MCP server for an outside navigator; --silent keeps pnpm's banner off the protocol
```

Package scripts call `../../node_modules/.bin/tsc` and `../../node_modules/.bin/tsx` on purpose: a
bare `tsc` resolves to an old global TypeScript on this machine and fails on the config, and `tsx`
is installed only at the workspace root.

## Rules that are not obvious from the code

Every rule names the test that fails if it is broken, or says "(Judgment.)" when no test can
check it. `packages/core/src/rules.test.ts` enforces that, so add the test with the rule.

- **Models judge, code decides.** A model never returns a score or a decision. It answers rubric
  questions; `packages/shared/src/scoring.ts` does the rest. Tests: `packages/core/src/rules.test.ts`,
  `packages/shared/src/scoring.test.ts`.
- **Outreach stays proposed; only a person's action can place an approved call.** Nothing in a run
  sends or dials, and the disclosure on a draft is written by code and cannot be edited. Placing a
  call records how the person agreed and needs the fund's name and E.164 callback number, an E.164
  destination, local time from 09:00 to 19:59, the stop switch off, and fewer than five placements
  on the UTC date. The consent and a placement mark are saved before dialling; a placement whose
  result is uncertain is failed for a person to check and is never dialled again. Only the last
  two digits of the number are stored, and stored call text has phone numbers removed. Generated
  instructions keep the call to its approved agenda, end it on a stop request, and pass a
  15-minute limit to the dialler. Tests: `packages/core/src/engine/index.test.ts`,
  `packages/core/src/service/index.test.ts`, `packages/core/src/sources/dialler-vapi.test.ts`.
- **Nothing requests the professional network's own site.** No adapter, no fetching, no logged-in
  automation, for linkedin.com and the other hosts in `packages/shared/src/policy.ts`. A link to one
  is a pointer for a person to open. Profile data comes from a data vendor under contract, from a
  partner's own exported contact list, or not at all. Tests: `packages/shared/src/policy.test.ts`,
  `packages/core/src/sources/http.test.ts`, `packages/core/src/sources/quote-check.test.ts`,
  `packages/core/src/providers/claude-cli.test.ts`.
- **Every founder waits for the partner's Yes / No, for now.** The swarm's own decision is a
  suggestion until a person calls it, whatever the status: the partner asked for this on
  2026-11-13 (`awaitsCall` in `packages/shared/src/feedback.ts` is the one place to narrow it). A
  call keeps the status it replaced and the assessment then current, so an eval can later compare
  the swarm with the partner. Test: `packages/core/src/service/index.test.ts`.
- **Never store or score personal attributes** (`PROHIBITED_ATTRIBUTES` in `rubric.ts`). Trajectory
  is judged against years of experience, never age. The text check is phrase based: it removes an
  explicit statement whoever its subject is (a name, a pronoun, "I"), and a phone number or an
  email address only where the text calls it personal. It does not catch hints. Tests:
  `packages/core/src/jobs/index.test.ts`, `packages/core/src/service/index.test.ts`.
- **A quote must be on the page it cites.** Research prompts ask for the source's exact words, and
  before the fact-checker runs, code opens each cited page and rejects an item whose words are not
  there. The check refuses private network addresses, because the address comes from a model.
  Tests: `packages/core/src/sources/quote-check.test.ts`, `packages/core/src/engine/index.test.ts`.
- **Every fact-check call carries one planted false claim.** A checker that accepts it has that
  call's verdicts thrown away, and an item the checker did not judge stays unverified; neither is
  ever rejected by default. Tests: `packages/core/src/engine/index.test.ts`,
  `packages/core/src/jobs/index.test.ts`.
- **A company is decided by its founders and the company together.** The company rubric is in
  `packages/shared/src/company.ts`; `decideDeal` in `scoring.ts` combines the two scores. Company
  facts are evidence with a facet, filed under the lead founder; the founder analyst is not shown
  them. A brief point or moat without verified citations is dropped; live mission and tagline text
  must match the page at its cited address. Tests:
  `packages/shared/src/company.test.ts`, `packages/core/src/engine/company-stages.test.ts`.
- **A contact list is the uploader's own, and stays out of prompts.** Email addresses in it are
  never read. Tests: `packages/core/src/sources/connections.test.ts`,
  `packages/core/src/service/index.test.ts`.
- **Vendor records cost money outside the run's spend cap.** The People Data Labs adapter asks only
  for professional fields and has its own ceiling on records per day. Test:
  `packages/core/src/sources/pdl.test.ts`.
- **Headless agents do not inherit unrelated secrets or user instructions.** Claude and Codex get
  only required environment keys. OpenCode runs a generated tool-free agent in a temporary
  directory with an empty config directory. It is ready only with a saved login, and each call
  gets a data folder of its own holding only a link to that login, removed afterwards, so nothing
  is added to the person's OpenCode history. The process runner sets a child's `PWD` to the
  directory it runs in. Tests: `packages/core/src/providers/env.test.ts`,
  `packages/core/src/providers/opencode-cli.test.ts`,
  `packages/core/src/providers/subprocess.test.ts`.
- **Simulator fields stay out of prompts.** `simId`, `simFounderId`, `sim` and hidden hunt truth
  exist for checks after a job, not as model input. Tests: `packages/core/src/jobs/index.test.ts`,
  `packages/core/src/engine/index.test.ts`, `packages/core/src/service/hunt-trial.test.ts`.
- **Simulated data is always labelled** in the dashboard, and synthetic eval scores are never
  described as evidence about real founders. (Judgment.)
- **A repository checkout is untrusted.** It is shallow, size-capped, stripped of agent-instruction
  files and `.git`, and read with read-only tools. Tests: `packages/core/src/sources/sanitize.test.ts`,
  and `packages/core/src/providers/claude-cli.live.test.ts`, which plants a hostile hook.
- **Eval discipline is structural.** The proposer is only ever given train case ids; the headline
  is the test score; a change is kept only by `decideCandidate` in `packages/core/src/eval`: a gain
  beyond the noise floor with no guardrail worse, or no loss at all with a guardrail clearly better.
  The synthetic flow's headline is rank correlation with hidden true quality, on purpose: outcomes
  in the simulated world are too noisy to steer by. Test: `packages/core/src/eval/index.test.ts`.
- **The hunt yield eval counts distinct strong early founders found per simulated world.** Eight
  train worlds propose a change and eight held-out worlds decide it, each candidate compared with
  the current config world by world. A candidate that changes `hunt.turns` or `hunt.wave_size` is
  reverted unmeasured, so every variant has the same allowance of calls. The headline is a count
  and not a rate for each call, because a rate rewards reading less. Late or weak finds and
  planted-page failures are guards; calls, the per-call rate and the fit-kept count are reported
  only. A trial whose run failed, was cancelled or hit its spend cap is an error, never a low
  score, and saved state from an older definition of the eval is set aside. Tests:
  `packages/core/src/eval/hunt.test.ts`, `packages/core/src/service/hunt-trial.test.ts`.
- **On past companies, the latest periods choose nothing.** A change is proposed on the earliest
  periods, chosen on middle periods held back from tuning, and only reported on the latest. The
  noise floor is the larger of the judge's own spread and a bootstrap over which cases were drawn.
  A rejected line of guidance is not judged on the latest periods at all, and a candidate is
  never compared with the current config on different cases: if a failed call left one side
  short, the round is reverted as incomplete. Test: `packages/core/src/eval/past.test.ts`.
- **A past case is masked, cut off at its date, and its score is called an upper bound.** Names,
  years and intake tags are replaced; anything dated later is dropped; a case the judge names is
  left out of the headline; the page says the judge was trained after the outcomes. Do not
  describe the result as free of look-ahead. Tests: `packages/shared/src/past.test.ts`,
  `packages/core/src/eval/past.test.ts`.
- **An outcome label is matched on the company's own name, together with its intake or its own
  site, never on a name or a site taken from a link alone, and an outcome nobody can state is
  left out, not called a failure.** A list of successes cannot say that a company missing from
  it failed. The dataset has sentences stating personal details removed, names found in replies
  masked as well as those in the post, and stays out of the repository. Tests:
  `packages/core/src/sources/past.test.ts`, `apps/server/src/cli.test.ts`.
- **Putting an eval's winner into use applies only what the winner changed.** A swarm's config
  also holds its pools, its learned lines and other evals' changes; `overlayConfig` keeps them,
  and the config records which variant of each flow it carries. Tests:
  `packages/shared/src/steering.test.ts`, `packages/core/src/service/index.test.ts`.
- **Autopilot applies one change at a time, and only one measured on real data.** A change kept
  on simulated founders waits for a person. Evals that call a model have a daily ceiling, zero
  by default, counted from what each round reports it spent; coaching passes run one at a time
  so two swarms cannot spend the same remainder. Test: `packages/core/src/service/index.test.ts`.
- **A pool of context is isolated unless a crossing is listed.** Each job names the pool behind
  every one of its input fields in `packages/shared/src/context.ts`; a field with no pool does
  not compile, and no job reads a sealed pool (contact lists, hidden truth). Skills match only
  fields already sent to that job. Models that train on inputs are refused for jobs with private
  material. Add a crossing to `CROSSINGS` before moving text between pools. Tests:
  `packages/shared/src/context.test.ts`, `packages/shared/src/skills.test.ts`,
  `packages/core/src/service/pools.test.ts`.
- **Code picks the pool member, and share moves only on checks the member did not make about
  itself.** Supported items for each dollar, planted claims accepted, tasks failed. When both cheap
  models are ready, scout and screener defaults split 50% to their ordinary route and 25% to each;
  direct APIs take precedence over OpenCode, and a configured pool or pinned route takes
  precedence over defaults. A member whose calls fail twice in a row for a provider reason is
  left out for the rest of that run. Tests: `packages/shared/src/pools.test.ts`,
  `packages/core/src/service/pools.test.ts`, `packages/core/src/db/store.test.ts`,
  `packages/core/src/engine/index.test.ts`, `packages/core/src/engine/hunt.test.ts`.
- **Code marks an assumption supported, never a model, and never from the latest periods.** The
  ledger in `packages/shared/src/assumptions.ts` tests each statement on past companies from the
  tuning periods and on the partner's calls, and keeps the two apart. Tests:
  `packages/shared/src/assumptions.test.ts`, `packages/core/src/service/assumptions.test.ts`.
- **The navigator steers the search and never the scoring.** It is one long-horizon agent whose
  memory is a notebook in the database. It is shown counts and labels of a few words, never a
  page. Its turn is a request that `checkTurn` checks, and it cannot write guidance for the
  analysts or change a weight. An outside MCP agent receives the same bounded view and its turns
  pass through the same checks; the built-in navigator takes the seat back when the outside agent
  has gone quiet. Saying `done` ends the steering for that run while queued runner work goes on,
  and a hunt-only run gives the hunt at least 90% of the run's cap. Tests:
  `packages/shared/src/hunt.test.ts`,
  `packages/core/src/engine/hunt.test.ts`, `packages/core/src/service/index.test.ts`,
  `packages/shared/src/context.test.ts`.
- **A runner cannot add a person or an address.** A person is kept only when the name and the
  quoted words are on the page; links and search results are picked by number; a stage answer
  without the page's words is reset; a company whose page states a round later than the fund
  wants is left out, and silence is never too late. Earliness is a proxy and is never called a
  valuation. Tests: `packages/shared/src/hunt.test.ts`, `packages/core/src/engine/hunt.test.ts`.
- **One page in every so many that a runner reads is planted.** It names no founder and tells
  the reader to report one. The result is the task's control, counted against the pool member,
  and nobody from a planted page is ever kept. Tests: `packages/shared/src/hunt.test.ts`,
  `packages/core/src/engine/hunt.test.ts`, `packages/core/src/jobs/hunt.test.ts`.
- **The hunt reads public pages within their rules.** robots.txt is obeyed, requests to one host
  are spaced, there is no login and no cookie, a refusal is final, an address must be a named
  public host, and the sites in `TERMS_BARRED_HOSTS` are not read even where robots.txt allows.
  This includes YouTube, Vimeo and Spotify media hosts. Add a site to that list with the sentence
  that bars it. A robots.txt answered with 401, 403 or 429, or one too large to read in full
  (512 KiB), means the site is not read; a missing one means no rules. The reader names itself
  with `HUNT_USER_AGENT`. Tests:
  `packages/core/src/sources/web.test.ts`, `packages/shared/src/policy.test.ts`,
  `packages/shared/src/hunt.test.ts`.
- **A recording fetch must be a permitted direct audio or video file.** It goes through the page
  reader's own checks under the reader's name (`HUNT_USER_AGENT`), and refuses barred or private
  hosts, player pages, robots.txt refusals, unsafe redirects and files over the size limit. Its
  length is found before transcribing, or bounded from its size at 6 kbit/s when it cannot be
  measured, and a recording that does not fit the run's allowance is refused. Tests:
  `packages/core/src/sources/media.test.ts`, `packages/core/src/engine/index.test.ts`.
- **A transcript quote must be present in the time-coded stretch.** Code drops unsupported words,
  keeps the recording time in the evidence address, and marks the quote found before fact-checking.
  Test: `packages/core/src/engine/index.test.ts`.
- **Claude search hits come from its search tool result.** Assistant prose cannot add an address,
  and code caps every search engine request at ten results. Tests:
  `packages/core/src/providers/claude-cli.test.ts`, `packages/core/src/engine/hunt.test.ts`.
- **Linkup search observes its separate per-day ceiling and the no-read list.** A missing key or
  failed response yields no hits; the ceiling is held in memory and resets with the server.
  Test: `packages/core/src/sources/search-linkup.test.ts`.
- **Completed calls become redacted evidence only when recording was chosen.** A simulated call's
  evidence is labelled simulated. The completed call item is synced; it is not retried as a new
  call. The Vapi adapter has a fake-client test only and has never placed a real call. Tests:
  `packages/core/src/sources/dialler-vapi.test.ts`,
  `packages/core/src/service/index.test.ts`.
- **A hunt skill applies only to matching jobs or classes and matching task material.** Code picks
  at most three by priority then id, within the prompt budget; `skills.off` removes an id at its
  steering scope. Skill files must parse, name known jobs or classes and stay within 900 body
  characters. Skills are guidance, not authority: a person's instruction wins, and a note cannot
  direct scoring, decisions, personal-attribute use or barred-host requests. Tests:
  `packages/shared/src/skills.test.ts`, `packages/core/src/jobs/index.test.ts`.
- **Founders rows use matched company facts, not guesses.** Industry and round come from company
  data, the tagline needs an exact company-page quote, and the moat needs cited verified evidence;
  unknown values stay empty. Tests: `packages/core/src/db/store.test.ts`,
  `packages/core/src/service/index.test.ts`, `packages/core/src/engine/company-stages.test.ts`,
  `packages/shared/src/hunt.test.ts`.
- **A page is read once; a search runs again only in a later run or on a later day.** Test:
  `packages/core/src/db/store.test.ts`.
- **X is searched only through xAI, and what comes back is a model's report.** No page on
  x.com is requested; its robots.txt refuses a generic reader. A post is kept only when
  xAI's API returned its address, a founder's posts only from the account the call was held to,
  and where xAI's own address names the account, no other account is the author. Only the xAI
  provider runs a job with an X scope. The words, dates and counts are what Grok wrote, so X
  evidence is stored unverified and a runner is told it is a report, until X's own API says
  otherwise (two rules down). A search xAI answers without a price, or that times out, is
  charged at the cap it was given. Tests:
  `packages/core/src/jobs/x.test.ts`, `packages/core/src/providers/xai-api.test.ts`,
  `packages/core/src/engine/hunt.test.ts`, `packages/core/src/jobs/index.test.ts`.
- **X evidence is checked by a second xAI call, never by the fact-checker that cannot open X.**
  That call carries its own planted false claim, and "supported" stands only for a post
  somebody read: one xAI's API lists among what that call fetched, or one whose quoted words
  code found in the post. A post about the company is filed with the company and is not shown
  to the founder's reader, and nothing is read from X in a simulated run.
  Tests: `packages/core/src/engine/index.test.ts`, `packages/core/src/engine/x-stage.test.ts`.
- **X's own API reads only posts xAI already named, by id, and never finds anyone.** It is
  sent nothing but post ids (`X_BEARER_TOKEN`; unset, none of this runs). A quote that is not
  in the post, or a post X gives to another account, rejects the item before the fact-check;
  an item that passes carries X's counts and date. A link-shaped word in a quote matches a
  link only where the post has one. In the hunt a runner is shown the post's own words, and
  the follower ceiling is applied to X's count. A task that carries those words is never sent
  to a model whose vendor trains on what it is sent. Each post read costs money outside the run's
  spend cap, under `X_POSTS_PER_DAY`, counted when the request is sent. Tests:
  `packages/shared/src/quote.test.ts`, `packages/core/src/sources/x-api.test.ts`,
  `packages/core/src/engine/x-stage.test.ts`, `packages/core/src/engine/hunt.test.ts`,
  `packages/shared/src/steering.test.ts`.
- **What is read from X is held to X's own list as well.** Besides the prohibited attributes,
  nothing is kept about a person's money troubles, trade union membership, or an alleged or
  actual crime: the jobs that read X are told so, and `offLimitsOnX` drops a hit, an account,
  an item or a post read through X's API whose words state one. A company's finances are not
  a person's. Tests: `packages/core/src/jobs/x.test.ts`, `packages/core/src/engine/hunt.test.ts`.
- **A post X no longer shows is removed from everything that holds its words.** Evidence,
  leads, pages held in the hunt's queue, and the output and transcript of any task that
  carried it: `forgetXPosts` in the store does all of them at once, and stored posts are
  re-read in turn to find them. `pnpm swarm x forget` removes one by hand. A founder whose
  assessment cites a removed item is assessed again. A new place that keeps a post's words is
  added to that method. Tests: `packages/core/src/db/store.test.ts`,
  `packages/core/src/engine/x-stage.test.ts`.
- **Accelerator batches are listed by code, within each directory's robots.txt.** Four public
  listings, each asked after its robots.txt, with requests to one host spaced by the page
  reader's gap or the site's crawl delay, and a listing once read is reused, not asked for
  again. A hit is a company's name and its own site, or for a16z speedrun the programme's page
  about it; a founder's name in a listing is not used, and Y Combinator's own site is not
  read. Test: `packages/core/src/sources/accelerators.test.ts`.
- **A runner call names no effort, and that means answer fast.** DeepSeek is sent thinking off
  and Meta the lowest reasoning, because both reason by default. DeepSeek has no default
  address. The runner pool can use DeepSeek Flash and Muse Ember through OpenCode or their direct
  APIs, and only includes ready routes. Tests: `packages/core/src/providers/openai-compatible.test.ts`,
  `packages/shared/src/pools.test.ts`, `packages/core/src/service/pools.test.ts`.
- **A model whose vendor trains on what it is sent is allowed only for a job whose inputs are
  public pages or feeds and the fund's own words.** `mayUseContributorModel` decides from the
  job's input pools alone. Scouts, the navigator and the runners may use one; the fit screener may
  not, because a lead can come from a contact list or a typed note; nothing that reads a founder's
  or a company's file, a transcript or a contact list may. A task sent to such a model is not
  shown the partners' calls. Choosing one is a person's act, never a default. Tests:
  `packages/shared/src/context.test.ts`, `packages/shared/src/steering.test.ts`,
  `packages/core/src/engine/index.test.ts`.
- **The fund's own deal history never reaches a model that trains on what it is sent, and an
  unknown outcome is left out.** An `EVAL_JUDGE` naming such a model is refused at start, and
  inside the eval such a route falls back to the job's default. The importer never quotes a cell
  in its reason for refusing a row. Tests: `apps/server/src/config.test.ts`,
  `packages/core/src/eval/past.test.ts`, `packages/core/src/sources/deals.test.ts`.
- **The server has no login.** It binds to loopback and rejects other Host names and other sites'
  Origins (`apps/server/src/app.ts`); the MCP process forwards only to this local API. Keep both
  checks until there is a login. Tests: `apps/server/src/app.test.ts`, `apps/server/src/mcp.test.ts`.
- **The hunt MCP server speaks newline JSON-RPC.** It reports HTTP conflicts as tool errors.
  Test: `apps/server/src/mcp.test.ts`.
- **Defaults are tuned on simulated founders.** The surface bar (0.58) and the simulated analyst in
  `packages/core/src/jobs` were set so the simulation surfaces about a tenth of those investigated.
  They are starting points for real runs, not findings. `packages/core/src/rules.test.ts` keeps the
  quoted number equal to the code.
- **Codex reads a repository through read-only shell commands.** It has no file-reading tool, so the
  code-review prompt allows `ls`, `cat`, `rg` and forbids running anything from the repository.
  Tests: `packages/core/src/jobs/index.test.ts`, `packages/core/src/providers/codex-cli.test.ts`.
- **Dashboard:** follow `apps/web/BUILDING.md` and `DESIGN.md`. Light, simple, only necessary text, desktop only.
  `PageHeader` ignores `description` on purpose. (Judgment.)
- **Tests stay few.** One proof for each contract at the strongest boundary, a regression test for
  each defect a review or a live run found, and no test of a wrapper, a copied list or a value the
  code itself produced. A kept test must be able to fail. (Judgment.)

## Testing reality

Simulation covers the engine, service, evals and dashboard end to end. Live coverage is opt-in:
`LIVE_SOURCES=1` and `LIVE_PROVIDERS=1`. The direct Claude API and OpenAI-compatible adapters have
only fake-client tests, and so do the Linkup, Vapi, People Data Labs and HTTP transcriber adapters,
so say "unverified against a live service" rather than implying otherwise. DeepSeek Flash and Muse
Ember have run only through OpenCode's saved logins.
