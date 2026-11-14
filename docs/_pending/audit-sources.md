# Founder Scout source test pruning audit

Date: 2026-11-13. Scope: `packages/core/src/sources/*.test.ts` except `web.test.ts`, `media.test.ts`, `transcribe.test.ts`, `index.test.ts`, and `*.live.test.ts`. The earlier `.audit/ledger-sources.md` was used only as an inventory.

## Baseline and final counts

Baseline full-directory run: 16 test files passed, 2 skipped; 255 tests passed, 8 skipped (263 total). Baseline lane-only run: 12 files, 216 passed and 2 skipped (218 total), 2,722 physical test-file lines.

Final full-directory run: 17 files passed, 2 skipped; 168 tests passed, 8 skipped (176 total). Final lane-only run: 13 files, 129 passed and 2 skipped (131 total), 2,112 physical test-file lines. Test counts are expanded Vitest cases, including `it.each` rows. Lines are physical file lines.

| Lane test file | Baseline cases | Baseline lines | Final cases | Final lines |
|---|---:|---:|---:|---:|
| `arxiv.test.ts` | 25 | 251 | 6 | 112 |
| `connections.test.ts` | 23 | 90 | 21 | 60 |
| `github.test.ts` | 17 | 237 | 9 | 159 |
| `hackernews.test.ts` | 16 | 195 | 3 | 103 |
| `http.test.ts` | 15 | 167 | 7 | 125 |
| `past.test.ts` | 31 | 514 | 13 | 422 |
| `pdl.test.ts` | 15 | 244 | 12 | 225 |
| `quote-check.test.ts` | 17 | 334 | 10 (8 pass, 2 skip) | 275 |
| `repo-finder.test.ts` | 36 | 300 | 26 | 271 |
| `sanitize.test.ts` | 9 | 141 | 2 | 70 |
| `search-linkup.test.ts` | 1 | 58 | 1 | 64 |
| `search.test.ts` | 11 | 191 | 6 | 162 |
| `util.test.ts` | 0 | 0 | 15 | 64 |
| **Total** | **218** | **2,722** | **131** | **2,112** |

## Contract owners and surviving proofs

- `arxiv.ts`: the default category/date query and 100-result API ceiling, requested since/beat, Atom field mapping, caller limit, date/cursor filtering, serialized requests with a three-second gap, and rejection of malformed/error feeds. Kept at the adapter boundary.
- `connections.ts`: partner CSV parsing/date mapping, no email value read into contacts, 30,000-contact cap, and work-for-a-founder titles excluded from founder classification. Kept at the parser and classification boundaries.
- `github.ts`: safe search query/date/beat, 100-result provider ceiling, item metrics and malformed-item rejection, filtering/cursor behavior, token behavior, and exhausted search quota. Kept at the adapter boundary.
- `hackernews.ts`: Show HN/Launch HN query, date and limit mapping, text/author/metric mapping, cursor progression, zero-limit no-call, and service response shape. Kept at the adapter boundary.
- `http.ts`: HTTP/rate-limit classification, JSON parsing, never-fetch checks on initial and redirect addresses, request headers, cross-host credential stripping, redirect limit/loop, caller abort, and shared deadline. Kept once at the HTTP owner.
- `past.ts`: supported launch titles, bounded dated evidence and reply author, duplicate launch removal, first-party domain/name extraction and masking, reviewed/Wikipedia/directory parsing, company-name plus intake/site outcome identity, unknown exclusion, and atomic dataset files. Kept at the collection and labeling boundaries.
- `pdl.ts`: only requested professional fields, no personal enrichment fields copied, vendor request size and daily record ceiling, SQL/domain query, cursor, no-match, reservation/concurrency/refund behavior. Kept at the vendor boundary.
- `quote-check.ts`: exact visible quote fragments, stand-ins, unreachable/not-found distinction, denied/private/local address checks, DNS and redirect revalidation, pinned lookup, body size, redirect count, compression, and abort. Kept at the quote-check and pinned-lookup boundaries.
- `repo-finder.ts`: safe GitHub URL parsing, ranking/filtering and token behavior, shallow clone arguments with hooks disabled, checkout sanitization, timeout/size cleanup, and contributors. Kept at parsing and checkout boundaries.
- `sanitize.ts`: case-insensitive agent instruction and `.git` removal, `.github` Copilot-file scope, and external/dangling/internal symlink handling. Kept in two filesystem tests.
- `search-linkup.ts`: Linkup request/result mapping, 100-result ceiling, excluded domains while retaining barred links as pointers, and per-key daily ceiling. Kept at the provider boundary.
- `search.ts`: per-engine request/mapping and ordering, HN/GitHub result cap, zero-limit no-call, bounded JSON deadline and 2 MB ceiling, and no-hit error behavior. Shared bounded request behavior is tested once here.
- `util.ts`: shared limit normalization, date-window start, query-term cleanup, HTML text cleanup, time-cursor parsing, and cursor advancement. Direct utility ownership is tested in `util.test.ts`; adapter tests retain source-specific request and cursor integration.

## Deleted or merged tests and remaining proof

Each entry names the old test (or removed table row) and the surviving test that now owns its contract. “No contract” marks a trivial getter, generic error path already owned elsewhere, or redundant assertion with no independent behavior.

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
- “builds the category and date-range query with an optional all-fields beat” → same default request keeper plus the explicit-beat mapping keeper.
- “requests the default 36 hour window, newest first” → default request keeper.
- “uses req.since as the window start when given” → `arxiv.test.ts > "uses the requested date and beat, maps the Atom fields, and respects the caller's limit"`.
- “adds the beat as an all-fields term” → same requested date/beat keeper.
- “maps entries to raw items with authors first in the text” → same Atom mapping keeper.
- “returns at most req.limit items” → same Atom mapping keeper.
- “drops entries published before the window, including ones the fake returned anyway” → `arxiv.test.ts > "filters results to the requested window and resumes after the cursor"`.
- “returns nothing new on a second call with the cursor from the first” → same filtering/cursor keeper.
- “treats a malformed cursor as no cursor” → `util.test.ts > "rejects a malformed time cursor: %s"` for shared parsing; adapter cursor integration remains in the arXiv filtering keeper.
- “waits three seconds between requests, the arXiv terms of use minimum” and “keeps one request in flight at a time” → `arxiv.test.ts > "serializes requests with the required three-second gap"`.
- “throws on other HTTP failures, naming the source and status” and “throws a rate-limit error on HTTP 429” → `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`.
- “reports itself configured and states the request rate in status, without a network call” → no contract: static adapter readiness/rate text only.

### Connections

- “finds the header after notes and parses BOM, CRLF, quotes, commas and embedded newlines” and “skips rows without names and normalizes all documented date forms” → `connections.test.ts > "maps partner-owned contact fields, dates and no email address"`.
- “throws a plain explanation when the expected header is absent” and “caps returned contacts and counts remaining rows as skipped” → `connections.test.ts > "rejects input without the required columns and caps returned contacts"`.
- Founder title rows remain in `connections.test.ts > "classifies %s as a founder title: %s"`; the Founder Associate, Founder's Office, and Chief of Staff regressions are still explicit cases.

### GitHub adapter

- “builds a creation-date, star-threshold, no-fork, no-archive query over the default window”, “uses req.since as the window start when given”, and “adds the beat as a quoted search term, with quotes removed” → `github.test.ts > "sends the default window, safe query terms and the provider's page ceiling"` (checks both default and explicit since requests).
- “sends the token when GITHUB_TOKEN is set, and reports it in status” and “sends no token when GITHUB_TOKEN is absent, and says the lower limits apply” → `github.test.ts > "sends a configured token and omits it when unset"`.
- “reports the last search quota seen in the status detail, without a network call” and “does not call the network while the last known search quota is exhausted” → `github.test.ts > "reports an exhausted search quota and refuses a second request"`.
- “throws a rate-limit error with the reset time on a rate-limited 403”, “throws a rate-limit error with the Retry-After delay on a 429”, and “throws on other HTTP failures, naming the source and status” → `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`.
- “parses a repository's owner and optional topics” → `github.test.ts > "maps search results to raw items with stars, age and stars per day"` (topic and owner fields are checked at the adapter boundary).
- Mapping, limit, fork/archive/date filters, cursor replay, malformed cursor, and malformed repository cases remain in their source-specific keepers.

### Hacker News adapter

- “reports itself configured without a network call” → no contract: static public-service readiness getter.
- “maps Show HN and Launch HN payloads to raw items, newest first”, “decodes entities and strips HTML from the post text”, “returns at most req.limit items”, “returns nothing for a limit of zero and makes no request”, “applies the default 36 hour window when there is no cursor and no since”, “uses req.since in the query when given”, and “adds the beat as a search query, with quotes removed” → `hackernews.test.ts > "sends bounded Show HN and Launch HN searches and maps their fields"` (covers default and explicit date requests, provider ceiling, zero limit, mapping, and text).
- “returns nothing new on a second call with the cursor from the first” and “returns only the newer item when one arrives between calls” → `hackernews.test.ts > "advances the cursor without replaying old items and admits a newer one"`.
- “treats a malformed cursor as no cursor” → `util.test.ts > "rejects a malformed time cursor: %s"`; valid source cursor flow remains in the HN cursor keeper.
- “throws a rate-limit error that says when to retry”, “throws on other HTTP failures, naming the source and status”, “throws on a body that is not JSON instead of returning partial data”, and “honours the caller's abort signal” → the shared owner tests `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`, `http.test.ts > "rejects malformed JSON at the shared parsing boundary"`, and `http.test.ts > "rethrows the caller's abort and applies the shared 20-second deadline"`.
- “throws on JSON without a hits array” remains at `hackernews.test.ts > "rejects a response without the service's hits array"`.

### HTTP helper

- “accepts a 2xx response”, the three 429/rate-limited-403 tests, “treats an ordinary 403 as a plain HTTP failure”, and “names the status on other failures” → `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`.
- “refuses never-fetch hosts before calling fetch” and “refuses a redirect to a never-fetch host before requesting it” → `http.test.ts > "refuses a never-fetch address before an initial or redirected request"`.
- “sends the agentswarm User-Agent and the caller's headers” and “follows redirects within an allowed host” → `http.test.ts > "identifies itself and keeps caller headers on same-host redirects"`.
- “does not send caller headers after a redirect to another host” remains at `http.test.ts > "drops caller credentials after a redirect to another host"`.
- “fails when a sixth redirect would be followed” and “fails on a redirect loop” → `http.test.ts > "stops redirect chains at the shared limit and detects loops"`.
- “rethrows the caller's own abort rather than reporting a timeout” remains in `http.test.ts > "rethrows the caller's abort and applies the shared 20-second deadline"`.

### Past-source collection and outcomes

- “uses encoded search parameters and fetches every search page” and “keeps YC launch titles with each dash or no tagline and drops other title forms” → `past.test.ts > "paginates the encoded search and keeps only supported YC launch-title forms"`.
- “builds dated evidence from the post and only the author's replies in the nested time window” remains at `past.test.ts > "builds dated evidence from the post and only the author's nested replies in range"`.
- “lets the shared HTTP boundary reject never-fetch hosts” → `http.test.ts > "refuses a never-fetch address before an initial or redirected request"`.
- “parses reordered CSV headers, quoted fields and skips incomplete outcomes” and “reads only company columns from tables whose header includes Company” → `past.test.ts > "parses reviewed CSV and extracts only company columns from a company table"`.
- Paragraph/newline, punctuation, and shared-host cases (“keeps paragraphs apart…”, “drops the full stop or comma…”, “does not treat a host many companies share…”) → `past.test.ts > "keeps company sites from first-party links and ignores hosts shared by other companies"`.
- “tidies doubled spaces in a title, and reads the intake however it is punctuated” and “keeps only the first launch when a company posts twice” → `past.test.ts > "keeps one dated launch per company and intake"`.
- “adds the shorter spellings of the company's own name…” → `past.test.ts > "adds short spellings of the company's own name so masking removes them"`.
- The name extraction, role exclusion, and reply masking tests (“finds names with inner capitals…”, “masks a founder who is named only in a reply”, “does not take a sentence opener or a role for a person”, and “takes every name from a list that ends in 'here'”) → `past.test.ts > "builds dated evidence from the post and only the author's nested replies in range"` (the single integration fixture asserts the collected people, reply text, dates, and masking).
- “takes the label that names the company, not the first one, from its site's address” and “reads the directory's own field names and turns an intake into the tag a launch title uses” → `past.test.ts > "maps the directory's fields and intake tags before outcome matching"`.
- “never gives a case the outcome of a company it only links to”, “matches on name and intake together…”, “finds a renamed company by its former name…”, and “accepts another intake only when the name and the site both match” → `past.test.ts > "requires the company's own name with its intake or site and never matches from a link alone"`.
- “matches labels on the company's own name, leaves out a company no label names, and reports unmatched positives” and “lets the first matching label win…” → `past.test.ts > "matches a reviewed label by the company's name and leaves unnamed companies unknown"`.
- “holds a company to the stated bar…”, “leaves out a case whose outcome nobody can state…”, “believes the public list of successes only for a company the directory shows still operating”, and “lets a person's own label win over the directory” → `past.test.ts > "applies the stated directory bar, trusts public-list positives only for active companies, and leaves unknowns out"`.
- “fetches only the public Wikipedia wikitext endpoint and dates its source label” remains at the same-named Wikipedia endpoint test.
- “atomically writes and reads JSONL, returns an empty list when missing, and summarizes cohorts” remains at `past.test.ts > "atomically writes and reads JSONL, returns empty when missing, and summarizes cohorts"`.

### People Data Labs

- “maps HTTP 429 to SourceRateLimitError” → `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`.
- “uses a company domain when present, otherwise an escaped lowercase company name” and “escapes SQL values and uses the PDL source path” → `pdl.test.ts > "prefers a company domain and safely escapes the company-name fallback"`.
- “reports local key readiness without making a request” → no contract: local readiness getter only.
- Search/mapping, enrichment privacy, 404 no-match, 401/402 service errors, cursor bound, per-day allowance, parallel reservation, and reservation refunds remain at their PDL owner tests.

### Quote checking

- “finds an exact quote”, “requires every separated fragment”, “normalizes curly quotes, dashes, line breaks, and inline markup”, and “requires exact comparison words when one word changes” → `quote-check.test.ts > "finds normalized exact quotes, requires every fragment, and rejects changed words"`.
- “does not count text inside script blocks” and “does not join JSON string fields into a quote across field boundaries” → `quote-check.test.ts > "counts only visible text and does not join separate JSON fields into a quote"`.
- “marks HTTP errors, non-text content, and tiny pages unreachable” → `quote-check.test.ts > "treats errors, non-text content and too little page text as unreachable"`.
- Hacker News, GitHub, arXiv stand-ins, and complete HN missing-quote behavior → `quote-check.test.ts > "uses complete or partial source stand-ins for Hacker News, GitHub and arXiv"`.
- “blocks denied and private addresses before fetching them” and “validates a redirect destination before fetching it” → `quote-check.test.ts > "blocks denied, local and private addresses before initial or redirected requests"`.
- “refuses to follow a fourth redirect” and “reports truncated pages as unreachable unless the quote was found” → `quote-check.test.ts > "refuses a fourth redirect and reports pages cut off at its byte limit"`.
- “uses the first validated DNS answer for both Node lookup callback forms” → `quote-check.test.ts > "returns only prevalidated addresses from both Node lookup callback forms"`.
- The actual pinned socket integration, compression, and caller-abort tests remain in the suite.

### Repository finder and sanitization

- Removed URL-table rows (SSH scheme, trailing slash, `.git` suffix, plain HTTP, query, fragment, owner-only, option-like owner/name, dash-prefixed option, and whitespace) → `repo-finder.test.ts > "rejects unsafe repository URL form: %s"`; the kept rows cover representative parse and shell-argument hazards. Safe URL acceptance remains in the paired `accepts %s` table.
- “refuses a non-GitHub URL before starting git or creating the work directory” → `repo-finder.test.ts > "refuses unsafe URL %s before starting git or creating the work directory"` (five representative inputs).
- “throws on a rate-limited response” → `http.test.ts > "owns success, rate-limit and ordinary HTTP classification"`.
- “removes the directory and throws when git exits with an error” → checkout cleanup is asserted at `repo-finder.test.ts > "kills a clone that exceeds the timeout, removes the directory and throws"` and `repo-finder.test.ts > "removes the directory and throws when the checkout exceeds the size cap"`.
- “reports a missing git executable as a clear error and leaves nothing behind” → no contract: machine executable availability/setup path; normal clone and failure cleanup are covered at the checkout boundary.
- Top-repository ranking, token, empty-account behavior, safe shallow checkout, timeout, size cap, and contributor mapping remain at their owner tests.
- “removes every agent-instruction file and directory wherever it appears, and keeps ordinary files”, “matches names case-insensitively”, and “does not remove a copilot instructions file outside .github” → `sanitize.test.ts > "removes agent instructions, .git and case variants while keeping ordinary files"`.
- All six symlink tests (absolute/relative escape, target untouched, internal link, dangling link, and external directory link) → `sanitize.test.ts > "removes links that escape or dangle without following them, and keeps an internal link"`.
- “returns an empty list for a clean checkout” → no contract: clean-input identity assertion only.

### Search engines

- “names itself to GitHub as the owner chose” → `search.test.ts > "maps GitHub repositories, preserves search syntax and sends its configured headers"` (the selected User-Agent is asserted on the request).
- “maps Hacker News stories and uses author and points when a story has no text” and “does not perform a request when the requested limit is zero” → `search.test.ts > "maps Hacker News results, falls back to author metrics, and caps the request size"`.
- “maps GitHub repositories, sends the raw search syntax, and reports token status” → `search.test.ts > "maps GitHub repositories, preserves search syntax and sends its configured headers"`.
- “searches new models and demo spaces on the Hugging Face Hub…” and “returns an empty list when the Hub fails” → `search.test.ts > "orders Hub models and demo spaces by traction then date, with a bounded page size"` and `search.test.ts > "returns no hits for an HTTP refusal, malformed JSON or a network error"`.
- “gives up on an answer that never ends or is too large, and returns nothing” → `search.test.ts > "ends a slow response at its deadline and discards a response above the byte ceiling"` (the oversized body contains a valid result so a missed size guard changes the result).
- Generic rate-limit, HTTP refusal, malformed JSON, and network-failure tests across search engines → `search.test.ts > "returns no hits for an HTTP refusal, malformed JSON or a network error"`.
- “accepts additional engines in the live access factory” was restored after a repository-wide caller search found `service/index.ts` supplies Linkup or model-search engines through this option. Proof: `search.test.ts > "keeps contracted extra engines in the live access factory"`.
- Linkup's previous test was retained and strengthened with a barred LinkedIn result, explicit maxResults 100 assertion, excluded-host list, and daily-ceiling boundary: `search-linkup.test.ts > "caps results, excludes barred hosts, keeps barred links as pointers, and enforces its daily ceiling"`.

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
| `util.ts`: invert valid timestamp-cursor check | `util.test.ts > "keeps valid time cursor keys and their timestamp"` |

All 24 targeted mutation keepers failed as expected. The quote-check local socket and compression tests skip with `EPERM` in this environment; their active callback/helper keepers were mutation-checked.

## Production code, fixtures, uncertainty, and possible bugs

- No runtime production logic was removed. Test-only exports were made private after whole-repository caller searches: `ARXIV_CATEGORIES`, `ARXIV_MIN_INTERVAL_MS`, `formatArxivDate`, `buildArxivQuery`, `parseArxivFeed`, `GITHUB_MIN_STARS`, `buildGitHubSearchQuery`, and `REQUEST_TIMEOUT_MS`. Their behavior remains exercised through owning adapter/helper tests.
- No fixture files or `test-support.ts` helpers were removed. The fake git script's unused `FAKE_GIT_MODE=fail` branch and its clone-error-only test were removed from `repo-finder.test.ts`.
- Uncertain environment evidence: the two retained quote-check tests that bind a local TCP server skip with `EPERM`. The active lookup callback test proves the Node callback returns only validated addresses, but actual pinned socket connection and compression remain unobserved here. The `*.live.test.ts` files were left unchanged and not run.
- Possible product bug, not fixed: PDL reserves no more than the configured remainder but settles spend using the vendor's returned `records.length`. If the vendor over-returns beyond the requested size, `spent` could exceed the configured daily ceiling. No test establishes that PDL never over-returns.
