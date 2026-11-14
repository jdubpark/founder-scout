# Founder Scout source test pruning audit

Date: 2026-11-13. Scope: `packages/core/src/sources/*.test.ts` except `web.test.ts`, `media.test.ts`, `transcribe.test.ts`, `index.test.ts`, and `*.live.test.ts`. The earlier `.audit/ledger-sources.md` was used only as an inventory.

## Baseline and final counts

Baseline full-directory run: 16 test files passed, 2 skipped; 255 tests passed, 8 skipped (263 total). Baseline lane-only run: 12 files, 216 passed and 2 skipped (218 total), 2,722 physical test-file lines.

Final full-directory run: 17 files passed, 2 skipped; 171 tests passed, 8 skipped (179 total). Final lane-only run: 13 files, 132 passed and 2 skipped (134 total), 2,150 physical test-file lines. Test counts are expanded Vitest cases, including `it.each` rows. Lines are physical file lines.

| Lane test file | Baseline cases | Baseline lines | Final cases | Final lines |
|---|---:|---:|---:|---:|
| `arxiv.test.ts` | 25 | 251 | 6 | 112 |
| `connections.test.ts` | 23 | 90 | 21 | 60 |
| `github.test.ts` | 17 | 237 | 9 | 159 |
| `hackernews.test.ts` | 16 | 195 | 4 | 118 |
| `http.test.ts` | 15 | 167 | 7 | 125 |
| `past.test.ts` | 31 | 514 | 13 | 422 |
| `pdl.test.ts` | 15 | 244 | 13 | 235 |
| `quote-check.test.ts` | 17 | 334 | 10 (8 pass, 2 skip) | 275 |
| `repo-finder.test.ts` | 36 | 300 | 27 | 284 |
| `sanitize.test.ts` | 9 | 141 | 2 | 70 |
| `search-linkup.test.ts` | 1 | 58 | 1 | 64 |
| `search.test.ts` | 11 | 191 | 6 | 162 |
| `util.test.ts` | 0 | 0 | 15 | 64 |
| **Total** | **218** | **2,722** | **134** | **2,150** |

## Contract owners and surviving proofs

- `arxiv.ts`: the default category/date query and 100-result API ceiling, requested since/beat, Atom field mapping, caller limit, date/cursor filtering, serialized requests with a three-second gap, and rejection of malformed/error feeds. Kept at the adapter boundary.
- `connections.ts`: partner CSV parsing/date mapping, no email value read into contacts, 30,000-contact cap, and work-for-a-founder titles excluded from founder classification. Kept at the parser and classification boundaries.
- `github.ts`: safe search query/date/beat, 100-result provider ceiling, item metrics and malformed-item rejection, filtering/cursor behavior, token behavior, and exhausted search quota. Kept at the adapter boundary.
- `hackernews.ts`: Show HN/Launch HN query, date and limit mapping, text/author/metric mapping, cursor progression, zero-limit no-call, and service response shape. Kept at the adapter boundary.
- `http.ts`: HTTP/rate-limit classification, JSON parsing, never-fetch checks on initial and redirect addresses, request headers, cross-host credential stripping, redirect limit/loop, caller abort, and shared deadline. Kept once at the HTTP owner.
- `past.ts`: supported launch titles, bounded dated evidence and reply author, duplicate launch removal, first-party domain/name extraction and masking, reviewed/Wikipedia/directory parsing, company-name plus intake/site outcome identity, unknown exclusion, and atomic dataset files. Kept at the collection and labeling boundaries.
- `pdl.ts`: only requested professional fields, no personal enrichment fields copied, vendor request size and daily record ceiling, SQL/domain query, cursor, no-match, reservation/concurrency/refund behavior, and API-key readiness without network access. Kept at the vendor boundary.
- `quote-check.ts`: exact visible quote fragments, stand-ins, unreachable/not-found distinction, denied/private/local address checks, DNS and redirect revalidation, pinned lookup, body size, redirect count, compression, and abort. Kept at the quote-check and pinned-lookup boundaries.
- `repo-finder.ts`: safe GitHub URL parsing, ranking/filtering and token behavior, shallow clone arguments with hooks disabled, checkout sanitization, timeout/size cleanup, and contributors. Kept at parsing and checkout boundaries.
- `sanitize.ts`: case-insensitive agent instruction and `.git` removal, `.github` Copilot-file scope, and external/dangling/internal symlink handling. Kept in two filesystem tests.
- `search-linkup.ts`: Linkup request/result mapping, 100-result ceiling, excluded domains while retaining barred links as pointers, and per-key daily ceiling. Kept at the provider boundary.
- `search.ts`: per-engine request/mapping and ordering, HN/GitHub result cap, zero-limit no-call, bounded JSON deadline and 2 MB ceiling, and no-hit error behavior. Shared bounded request behavior is tested once here.
- `util.ts`: shared limit normalization, date-window start, query-term cleanup, HTML text cleanup, time-cursor parsing, and cursor advancement. Direct utility ownership is tested in `util.test.ts`; adapter tests retain source-specific request and cursor integration.

## Deleted or merged tests and remaining proof

Each bullet names one original test (or one removed `it.each` row) and its surviving proof. “No contract” gives the reason that no test remains.

### arXiv

- “reads every entry, in document order” → `arxiv.test.ts > "uses the requested date and beat, maps the Atom fields, and respects the caller's limit"`.
- “reads the full author list and categories” → same Atom mapping keeper.
- “joins a title that spans several lines into one line” → same Atom mapping keeper.
- “decodes named, decimal and hexadecimal entities and collapses whitespace in the abstract” → same Atom mapping keeper.
- “unwraps CDATA sections” → same Atom mapping keeper.
- “keeps every author of a multi-author paper” → same Atom mapping keeper.
- “has no PDF link when the entry lists none” → same Atom mapping keeper.
- “throws on a body that is not an Atom feed” → `arxiv.test.ts > "rejects %s instead of returning partial results"`.
- “throws on an arXiv error entry rather than returning it as a paper” → same rejection table.
- “formats dates as GMT YYYYMMDDHHMM” → `arxiv.test.ts > "sends the startup categories in the default window and caps the API page size"`.
- “covers the seven startup-relevant categories” → same default request keeper.
- “builds the category and date-range query with an optional all-fields beat” → same default request keeper and the explicit-beat keeper.
- “requests the default 36 hour window, newest first” → same default request keeper.
- “uses req.since as the window start when given” → `arxiv.test.ts > "uses the requested date and beat, maps the Atom fields, and respects the caller's limit"`.
- “adds the beat as an all-fields term” → same requested date/beat keeper.
- “maps entries to raw items with authors first in the text” → same Atom mapping keeper.
- “returns at most req.limit items” → same Atom mapping keeper.
- “drops entries published before the window, including ones the fake returned anyway” → `arxiv.test.ts > "filters results to the requested window and resumes after the cursor"`.
- “returns nothing new on a second call with the cursor from the first” → same filtering/cursor keeper.
- “treats a malformed cursor as no cursor” → `util.test.ts > "rejects a malformed time cursor: %s"`; the arXiv adapter's valid cursor flow remains in its filtering keeper.
- “waits three seconds between requests, the arXiv terms of use minimum” → `arxiv.test.ts > "serializes requests with the required three-second gap"`.
- “keeps one request in flight at a time” → same serialization keeper.
- “throws on other HTTP failures, naming the source and status” → `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`.
- “throws a rate-limit error on HTTP 429” → same HTTP classification keeper.
- “reports itself configured and states the request rate in status, without a network call” → no contract: the adapter always reports the same hard-coded public-service readiness and cadence text.

### Connections

- “finds the header after notes and parses BOM, CRLF, quotes, commas and embedded newlines” → `connections.test.ts > "maps partner-owned contact fields, dates and no email address"`.
- “skips rows without names and normalizes all documented date forms” → same parser keeper.
- “throws a plain explanation when the expected header is absent” → `connections.test.ts > "rejects input without the required columns and caps returned contacts"`.
- “caps returned contacts and counts remaining rows as skipped” → same parser keeper.
- Founder-title rows remain at `connections.test.ts > "classifies %s as a founder title: %s"`, including Founder Associate, Founder's Office, and Chief of Staff false cases.

### GitHub adapter

- “builds a creation-date, star-threshold, no-fork, no-archive query over the default window” → `github.test.ts > "sends the default window, safe query terms and the provider's page ceiling"`.
- “uses req.since as the window start when given” → same request keeper (it checks both default and explicit-since calls).
- “adds the beat as a quoted search term, with quotes removed” → same request keeper.
- “parses a repository's owner and optional topics” → `github.test.ts > "maps search results to raw items with stars, age and stars per day"`.
- “sends the token when GITHUB_TOKEN is set, and reports it in status” → `github.test.ts > "sends a configured token and omits it when unset"`.
- “sends no token when GITHUB_TOKEN is absent, and says the lower limits apply” → same token keeper.
- “reports the last search quota seen in the status detail, without a network call” → `github.test.ts > "reports an exhausted search quota and refuses a second request"`.
- “throws a rate-limit error with the reset time on a rate-limited 403” → `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`.
- “throws a rate-limit error with the Retry-After delay on a 429” → same HTTP classification keeper.
- “does not call the network while the last known search quota is exhausted” → GitHub exhausted-quota keeper.
- “throws on other HTTP failures, naming the source and status” → shared HTTP classification keeper.

### Hacker News adapter

- “reports itself configured without a network call” → no contract: static keyless-public-service readiness getter.
- “maps Show HN and Launch HN payloads to raw items, newest first” → `hackernews.test.ts > "sends bounded Show HN and Launch HN searches and maps their fields"`.
- “decodes entities and strips HTML from the post text” → same mapping keeper.
- “returns at most req.limit items” → same mapping keeper.
- “returns nothing for a limit of zero and makes no request” → same mapping keeper.
- “applies the default 36 hour window when there is no cursor and no since” → same request keeper and `util.test.ts > "chooses the start of the request window from %s"`.
- “uses req.since in the query when given” → same HN request keeper.
- “adds the beat as a search query, with quotes removed” → same HN request keeper.
- “returns nothing new on a second call with the cursor from the first” → `hackernews.test.ts > "advances the cursor without replaying old items and admits a newer one"`.
- “returns only the newer item when one arrives between calls” → same cursor keeper.
- “treats a malformed cursor as no cursor” → `util.test.ts > "rejects a malformed time cursor: %s"`; valid source cursor flow remains in the HN cursor keeper.
- “throws a rate-limit error that says when to retry” → `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`.
- “throws on other HTTP failures, naming the source and status” → same HTTP classification keeper.
- “throws on a body that is not JSON instead of returning partial data” → `http.test.ts > "rejects malformed JSON at the shared parsing boundary"`.
- “honours the caller's abort signal” → `hackernews.test.ts > "passes the caller's aborted signal into the source request"` verifies adapter forwarding; composed abort behavior remains at `http.test.ts > "rethrows the caller's abort and applies the shared 20-second deadline"`.

### HTTP helper

- “accepts a 2xx response” → `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`.
- “treats 429 as rate limited, with the Retry-After delay” → same classification keeper.
- “treats a 403 with an exhausted quota as rate limited, using the reset header” → same classification keeper.
- “treats a 403 whose body says rate limit as rate limited, with no reset time” → same classification keeper.
- “treats an ordinary 403 as a plain HTTP failure” → same classification keeper.
- “names the status on other failures” → same classification keeper.
- “refuses never-fetch hosts before calling fetch” → `http.test.ts > "refuses a never-fetch address before an initial or redirected request"`.
- “sends the agentswarm User-Agent and the caller's headers” → `http.test.ts > "identifies itself and keeps caller headers on same-host redirects"`.
- “follows redirects within an allowed host” → same same-host redirect keeper.
- “refuses a redirect to a never-fetch host before requesting it” → never-fetch address keeper.
- “does not send caller headers after a redirect to another host” remains at `http.test.ts > "drops caller credentials after a redirect to another host"`.
- “fails when a sixth redirect would be followed” → `http.test.ts > "stops redirect chains at the shared limit and detects loops"`.
- “fails on a redirect loop” → same redirect keeper.
- “rethrows the caller's own abort rather than reporting a timeout” remains at `http.test.ts > "rethrows the caller's abort and applies the shared 20-second deadline"`.

### Past-source collection and outcomes

- “uses encoded search parameters and fetches every search page” → `past.test.ts > "paginates the encoded search and keeps only supported YC launch-title forms"`.
- “keeps YC launch titles with each dash or no tagline and drops other title forms” → same pagination/title keeper.
- “builds dated evidence from the post and only the author's replies in the nested time window” remains at `past.test.ts > "builds dated evidence from the post and only the author's nested replies in range"`.
- “skips a story with no post text and no qualifying replies” remains at the same-named test.
- “lets the shared HTTP boundary reject never-fetch hosts” → `http.test.ts > "refuses a never-fetch address before an initial or redirected request"`.
- “parses reordered CSV headers, quoted fields and skips incomplete outcomes” → `past.test.ts > "parses reviewed CSV and extracts only company columns from a company table"`.
- “reads only company columns from tables whose header includes Company” → same parser keeper.
- “fetches only the public Wikipedia wikitext endpoint and labels its read date” remains at the same-named endpoint test.
- “matches labels on the company's own name, leaves out a company no label names, and reports unmatched positives” remains at `past.test.ts > "matches a reviewed label by the company's name and leaves unnamed companies unknown"`.
- “keeps paragraphs apart when the page marks them with an opening tag only” → `past.test.ts > "keeps company sites from first-party links and ignores hosts shared by other companies"`.
- “drops the full stop or comma a sentence leaves on a link” → same first-party site keeper.
- “tidies doubled spaces in a title, and reads the intake however it is punctuated” → `past.test.ts > "paginates the encoded search and keeps only supported YC launch-title forms"`.
- “adds the shorter spellings a post uses for its own company, so the name does not survive masking” remains at `past.test.ts > "adds short spellings of the company's own name so masking removes them"`.
- “finds names with inner capitals and hyphens, and does not take a nationality or the site for a person” → `past.test.ts > "builds dated evidence from the post and only the author's nested replies in range"`.
- “masks a founder who is named only in a reply” → same dated evidence keeper.
- “does not take a sentence opener or a role for a person” → same dated evidence keeper.
- “takes every name from a list that ends in 'here'” → same dated evidence keeper.
- “keeps only the first launch when a company posts twice” remains at `past.test.ts > "keeps one dated launch per company and intake"`.
- “does not treat a host many companies share as the company's own site” → `past.test.ts > "keeps company sites from first-party links and ignores hosts shared by other companies"`.
- “takes the label that names the company, not the first one, from its site's address” → `past.test.ts > "requires the company's own name with its intake or site and never matches from a link alone"`.
- “never gives a case the outcome of a company it only links to” → same identity keeper.
- “lets the first matching label win, so a reviewed file can override a list” → `past.test.ts > "matches a reviewed label by the company's name and leaves unnamed companies unknown"`.
- “reads the directory's own field names and turns an intake into the tag a launch title uses” remains at `past.test.ts > "maps the directory's fields and intake tags before outcome matching"`.
- “holds a company to the stated bar, and says it cannot tell for an acquisition” → `past.test.ts > "applies the stated directory bar, trusts public-list positives only for active companies, and leaves unknowns out"`.
- “matches on name and intake together, so a namesake from another year is not the same company” → `past.test.ts > "requires the company's own name with its intake or site and never matches from a link alone"`.
- “finds a renamed company by its former name, and never by a site alone” → same identity keeper.
- “accepts another intake only when the name and the site both match” → same identity keeper.
- “leaves out a case whose outcome nobody can state, instead of calling it a failure” → `past.test.ts > "applies the stated directory bar, trusts public-list positives only for active companies, and leaves unknowns out"`.
- “believes the public list of successes only for a company the directory shows still operating” → same directory bar keeper.
- “lets a person's own label win over the directory” → same directory bar keeper.
- “atomically writes and reads JSONL, returns an empty list when missing, and summarizes cohorts” remains at `past.test.ts > "atomically writes and reads JSONL, returns empty when missing, and summarizes cohorts"`.

### People Data Labs

- “maps HTTP 429 to SourceRateLimitError” → `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`.
- “uses a company domain when present, otherwise an escaped lowercase company name” → `pdl.test.ts > "prefers a company domain and safely escapes the company-name fallback"`.
- “escapes SQL values and uses the PDL source path” → same PDL query keeper.
- “reports local key readiness without making a request” remains at `pdl.test.ts > "reports local key readiness without making a request"`; it checks the API-key readiness result and that status performs no provider request.

### Quote checking

- “finds an exact quote” → `quote-check.test.ts > "finds normalized exact quotes, requires every fragment, and rejects changed words"`.
- “requires every separated fragment” → same exact quote keeper.
- “normalizes curly quotes, dashes, line breaks, and inline markup” → same exact quote keeper.
- “requires exact comparison words when one word changes” → same exact quote keeper.
- “does not count text inside script blocks” → `quote-check.test.ts > "counts only visible text and does not join separate JSON fields into a quote"`.
- “marks HTTP errors, non-text content, and tiny pages unreachable” → `quote-check.test.ts > "treats errors, non-text content and too little page text as unreachable"`.
- “reads Hacker News item text from Algolia, including nested comment HTML” → `quote-check.test.ts > "uses complete or partial source stand-ins for Hacker News, GitHub and arXiv"`.
- “reads GitHub blob quotes from the raw file address” → same stand-in keeper.
- “treats the arXiv abstract as a partial stand-in” → same stand-in keeper.
- “keeps missing quotes on complete Hacker News stand-ins as not found” → same stand-in keeper.
- “does not join JSON string fields into a quote across field boundaries” → visible-text/JSON boundary keeper.
- “blocks denied and private addresses before fetching them” → `quote-check.test.ts > "blocks denied, local and private addresses before initial or redirected requests"`.
- “validates a redirect destination before fetching it” → same address keeper.
- “refuses to follow a fourth redirect” → `quote-check.test.ts > "refuses a fourth redirect and reports pages cut off at its byte limit"`.
- “reports truncated pages as unreachable unless the quote was found” → same redirect/byte keeper.
- The actual pinned socket integration, compression, and caller-abort tests remain in the suite; the shared DNS lookup assertion is at `quote-check.test.ts > "returns only prevalidated addresses from both Node lookup callback forms"`.

### Repository finder and sanitization

- Removed URL row “ssh scheme” → `repo-finder.test.ts > "rejects unsafe repository URL form: %s"`.
- Removed URL row “trailing slash” → same unsafe URL table.
- Removed URL row “.git suffix” → same unsafe URL table.
- Removed URL row “plain http” → same unsafe URL table.
- Removed URL row “query string” → same unsafe URL table.
- Removed URL row “fragment” → same unsafe URL table.
- Removed URL row “owner only” → same unsafe URL table.
- Removed URL row “option-like name” → same unsafe URL table.
- Removed URL row “option-like owner” → same unsafe URL table.
- Removed URL row “dash-prefixed option” → same unsafe URL table.
- Removed URL row “whitespace” → same unsafe URL table.
- “returns null for missing, invalid or non-GitHub links” remains at the two URL/login representative tables; accepted GitHub URL shapes remain in the paired `accepts %s` table.
- “drops forks, ranks by stars and keeps the top N with localPath null” remains at the top-repository test.
- “sends the token when GITHUB_TOKEN is set” remains at the token test.
- “returns an empty list with no GitHub link, without a network call” remains at the top-repository test.
- “returns an empty list for an unknown account” remains at the top-repository test.
- “throws on a rate-limited response” → `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`.
- “refuses a non-GitHub URL before starting git or creating the work directory” → `repo-finder.test.ts > "refuses unsafe URL %s before starting git or creating the work directory"` (five representative unsafe inputs).
- “clones shallowly with hooks disabled and returns a sanitised checkout” remains at the same-named checkout test.
- “removes the directory and throws when git exits with an error” → `repo-finder.test.ts > "reports git execution failures clearly and leaves nothing behind"` checks the process-exit diagnostic and cleanup.
- “reports a missing git executable as a clear error and leaves nothing behind” → the same keeper checks the spawn-error diagnostic and cleanup.
- “kills a clone that exceeds the timeout, removes the directory and throws” remains at the same-named timeout test.
- “removes the directory and throws when the checkout exceeds the size cap” remains at the same-named size test.
- “returns commit counts by person, most first, without bots” remains at the contributors test.
- “says nothing when the host cannot count, and never asks about a non-GitHub URL” remains at the contributors test.
- “removes every agent-instruction file and directory wherever it appears, and keeps ordinary files” → `sanitize.test.ts > "removes agent instructions, .git and case variants while keeping ordinary files"`.
- “matches names case-insensitively” → same sanitizer keeper.
- “does not remove a copilot instructions file outside .github” → same sanitizer keeper.
- “removes a symbolic link that points outside the checkout, without touching its target” → `sanitize.test.ts > "removes links that escape or dangle without following them, and keeps an internal link"`.
- “removes a relative symbolic link that escapes through parent directories” → same symlink keeper.
- “keeps a symbolic link that stays inside the checkout” → same symlink keeper.
- “removes a dangling symbolic link, including one that pointed at a file just removed” → same symlink keeper.
- “does not follow a symbolic link to a directory outside the checkout” → same symlink keeper.
- “returns an empty list for a clean checkout” → no contract: clean-input identity assertion only.

### Search engines

- “maps Hacker News stories and uses author and points when a story has no text” → `search.test.ts > "maps Hacker News results, falls back to author metrics, and caps the request size"`.
- “maps GitHub repositories, sends the raw search syntax, and reports token status” → `search.test.ts > "maps GitHub repositories, preserves search syntax and sends its configured headers"`.
- “names itself to GitHub as the owner chose” → same GitHub search keeper (asserts the selected User-Agent on the request).
- “searches new models and demo spaces on the Hugging Face Hub…” → `search.test.ts > "orders Hub models and demo spaces by traction then date, with a bounded page size"`.
- “gives up on an answer that never ends or is too large, and returns nothing” → `search.test.ts > "ends a slow response at its deadline and discards a response above the byte ceiling"`.
- “returns an empty list when the Hub fails” → `search.test.ts > "returns no hits for an HTTP refusal, malformed JSON or a network error"`.
- The `rate-limit response` row of “returns an empty list on a %s” → same generic search failure keeper.
- The `network error` row of “returns an empty list on a %s” → same generic search failure keeper.
- “returns an empty list when Hacker News answers with a rate limit” → same generic search failure keeper.
- “accepts additional engines in the live access factory” was restored after a repository-wide caller search found `service/index.ts` supplies Linkup or model-search engines through this option. Proof: `search.test.ts > "keeps contracted extra engines in the live access factory"`.
- “does not perform a request when the requested limit is zero” → `search.test.ts > "maps Hacker News results, falls back to author metrics, and caps the request size"`.
- Linkup's original test remains and was strengthened with a barred LinkedIn result, explicit maxResults 100 assertion, excluded-host list, and daily-ceiling boundary: `search-linkup.test.ts > "caps results, excludes barred hosts, keeps barred links as pointers, and enforces its daily ceiling"`.

## Mutations

Each mutation was applied to its production owner, its named keeper was run and failed, and the source bytes were restored and compared with the pre-mutation bytes. The only remaining production diff is the intentional export-surface cleanup below.

| Owner change | Keeper that failed |
|---|---|
| `http.ts`: bypass initial and redirect never-fetch guards | `http.test.ts > "refuses a never-fetch address before an initial or redirected request"` |
| `quote-check.ts`: bypass denied-host check | `quote-check.test.ts > "blocks denied, local and private addresses before initial or redirected requests"` |
| `quote-check.ts`: allow a private literal IP | same quote address keeper |
| `quote-check.ts`: stop rejecting private DNS answers | same quote address keeper |
| `quote-check.ts`: validate a safe substitute instead of redirect destination | same quote address keeper |
| `quote-check.ts`: return a hard-coded lookup address | `quote-check.test.ts > "returns only prevalidated addresses from both Node lookup callback forms"` |
| `quote-check.ts`: mark every quote fragment as found | `quote-check.test.ts > "finds normalized exact quotes, requires every fragment, and rejects changed words"` |
| `pdl.ts`: grant requested size without applying remaining daily allowance | `pdl.test.ts > "stops asking the vendor for records once the day's allowance is spent, and starts again the next day"` |
| `pdl.ts`: add `personal_emails` to requested fields | `pdl.test.ts > "searches the founder window with only mapped fields and maps results to RawItems"` |
| `search-linkup.ts`: send no excluded domains | `search-linkup.test.ts > "caps results, excludes barred hosts, keeps barred links as pointers, and enforces its daily ceiling"` |
| `search-linkup.ts`: raise configured per-day allowance to 1,000 | same Linkup keeper |
| `search.ts`: raise engine result ceiling from 100 to 101 | `search.test.ts > "maps Hacker News results, falls back to author metrics, and caps the request size"` |
| `search.ts`: raise response byte ceiling from 2 MB to 3 MB | `search.test.ts > "ends a slow response at its deadline and discards a response above the byte ceiling"` |
| `search.ts`: await body reads without racing the request deadline | same deadline keeper (the keeper timed out and failed) |
| `repo-finder.ts`: change `core.hooksPath=/dev/null` | `repo-finder.test.ts > "clones shallowly with hooks disabled and returns a sanitised checkout"` |
| `sanitize.ts`: stop denying `claude.md` | `sanitize.test.ts > "removes agent instructions, .git and case variants while keeping ordinary files"` |
| `connections.ts`: append Email Address to the contact name | `connections.test.ts > "maps partner-owned contact fields, dates and no email address"` |
| `connections.ts`: skip the “for a founder” title filter | `connections.test.ts > "classifies Founder Associate as a founder title: false"` |
| `past.ts`: refuse reviewed labels by company name | `past.test.ts > "matches a reviewed label by the company's name and leaves unnamed companies unknown"` |
| `past.ts`: match directory rows regardless of company name | `past.test.ts > "requires the company's own name with its intake or site and never matches from a link alone"` |
| `past.ts`: disable company-site matching | same identity keeper |
| `past.ts`: ignore intake when choosing same-name rows | same identity keeper |
| `past.ts`: label unknown directory outcomes as failures | `past.test.ts > "applies the stated directory bar, trusts public-list positives only for active companies, and leaves unknowns out"` |
| `hackernews.ts`: omit the caller signal from `httpGet` | `hackernews.test.ts > "passes the caller's aborted signal into the source request"` |
| `util.ts`: invert valid timestamp-cursor check | `util.test.ts > "keeps valid time cursor keys and their timestamp"` |

All 25 targeted mutation keepers failed as expected. The quote-check local socket and compression tests skip with `EPERM` in this environment; their active callback/helper keepers were mutation-checked.

## Production code, fixtures, uncertainty, and possible bugs

- No runtime production logic was removed. Test-only exports were made private after whole-repository caller searches: `ARXIV_CATEGORIES`, `ARXIV_MIN_INTERVAL_MS`, `formatArxivDate`, `buildArxivQuery`, `parseArxivFeed`, `GITHUB_MIN_STARS`, `buildGitHubSearchQuery`, and `REQUEST_TIMEOUT_MS`. Their behavior remains exercised through owning adapter/helper tests.
- No fixture files or `test-support.ts` helpers were removed. The fake git script's `FAKE_GIT_MODE=fail` branch remains and is covered in the combined checkout execution-failure test.
- Uncertain environment evidence: the two retained quote-check tests that bind a local TCP server skip with `EPERM`. The active lookup callback test proves the Node callback returns only validated addresses, but actual pinned socket connection and compression remain unobserved here. The `*.live.test.ts` files were left unchanged and not run.
- Possible product bug, not fixed: PDL reserves no more than the configured remainder but settles spend using the vendor's returned `records.length`. If the vendor over-returns beyond the requested size, `spent` could exceed the configured daily ceiling. No test establishes that PDL never over-returns.
