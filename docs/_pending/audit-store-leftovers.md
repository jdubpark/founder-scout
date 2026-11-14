# Core store, sources, and shared test audit

Counts are Vitest cases after expanding `it.each`, including skipped cases. Lines are physical test-file lines.

## Baseline and final counts

| Test file | Baseline cases / lines | Final cases / lines |
| --- | ---: | ---: |
| `packages/core/src/db/store.test.ts` | 23 / 856 | 16 / 759 |
| `packages/core/src/sources/web.test.ts` | 28 / 531 | 27 / 523 |
| `packages/core/src/sources/media.test.ts` | 2 / 48 | 3 / 95 |
| `packages/core/src/sources/transcribe.test.ts` | 2 / 36 | 2 / 36 |
| `packages/core/src/sources/index.test.ts` | 9 / 90 | 4 / 48 |
| `packages/shared/src/calls.test.ts` | absent / 0 | 9 / 41 |
| `packages/shared/src/context.test.ts` | 6 / 54 | 7 / 70 |
| **Total** | **70 / 1,615 across 6 files** | **68 / 1,572 across 7 files** |

Baseline was 69 passed and 1 skipped. Final was 67 passed and 1 skipped. The `calls.test.ts` baseline file did not exist; its nine cases cover the four required call contracts. Excluding those new cases, the existing lane went from 70 to 59 cases.

## Contracts and keepers

- `store.ts` / `schema.ts`: evidence is unique by founder and hash; setting a quote preserves verification; old databases migrate through the current schema; see the evidence and version-1 migration tests below.
- `store.ts`: company rows use attached company facts and company assessment facts; pool counts select evidence or leads by job and honor swarm, job, and start-window filters; the dashboard-row and member-pool tests are the keepers.
- `store.ts`: frontier items are globally deduplicated; waiting work moves to the trail that asks again; pages are not read twice; searches run again only on a later day or run; the three frontier tests are the keepers.
- `web.ts` / `policy.ts` / `quote-check.ts`: never-fetch and terms-barred hosts, named public hosts, private and loopback addresses, every redirect, DNS-pinned requests, robots matching and parser limits, status handling, request spacing, credential-free requests, bounded page reads, and final refusals are covered by the direct-reader tests. Robots byte truncation is a product bug below.
- `media.ts`: shared address and robots checks apply to recording requests and redirects; direct media type, declared and streamed size, and generated file name are checked in the media tests.
- `transcribe.ts`: local transcription receives the path as an argument and parses JSON without a shell; the compatible endpoint receives verbose JSON multipart audio.
- `index.ts`: live adapter order/labels and GitHub token status, PDL configuration and fail-closed behavior, and lazy repository-finder construction are covered at the live-source boundary.
- `context.ts`: every job input field is required in the pool map, no job reads a sealed pool, contributor-model eligibility matches the permitted job set, and the remaining tests preserve named isolation/crossing contracts.
- `calls.ts`: local-time hours, E.164 formatting, phone redaction, and the opening built from code and draft context each have one keeper.

## Deleted or merged tests

- `store.test.ts` — `"round-trips nested records and initializes the base config and default settings"` — no contract: generic record round-trip/default-getter assertions; actual file-backed record survival is exercised by `store.test.ts > "migrates a populated version-1 database without changing its records and fills old run counters"`.
- `store.test.ts` — `"sets an evidence quote without changing verification"` — merged into `store.test.ts > "deduplicates evidence by founder and hash and preserves verification when setting a quote"`.
- `store.test.ts` — `"deduplicates evidence by founder and hash"` — merged with quote preservation into `store.test.ts > "deduplicates evidence by founder and hash and preserves verification when setting a quote"`.
- `store.test.ts` — `"stores a person listed twice in one upload once, instead of failing the upload"` — merged into `store.test.ts > "reconciles network changes by profile link or normalized name"`, which includes repeated input and replacement behavior.
- `store.test.ts` — `"aggregates member tasks and their evidence within the requested swarm, job and start window"` — merged into `store.test.ts > "counts member pools from evidence or leads within the requested swarm, job and start window"`.
- `store.test.ts` — `"counts scout leads by later fit-screen outcomes"` — merged into the same member-pool keeper, alongside `"counts hunt look items from leads and preserves evidence counts for other jobs"`.
- `store.test.ts` — `"counts hunt look items from leads and preserves evidence counts for other jobs"` — merged into `store.test.ts > "counts member pools from evidence or leads within the requested swarm, job and start window"`.
- `store.test.ts` — `"opens a version-3 database and makes all hunt tables usable"` — subsumed by the older version-1 migration path in `store.test.ts > "migrates a populated version-1 database without changing its records and fills old run counters"`.
- `store.test.ts` — `"keeps file-backed data and saved configs across reopen without destructive migration reruns"` — file-backed close/reopen behavior remains in the version-1 migration keeper; a separate saved-config reopen case only exercised the same JSON record persistence path.
- `index.test.ts` — `"returns an adapter for each of the four live sources and null for the rest"` — merged into `index.test.ts > "registers live adapters, labels, and GitHub token status"`.
- `index.test.ts` — `"reports one status per live adapter, in order, with labels from the shared registry"` — merged into the registry keeper above; labels now come from the shared registry fixture.
- `index.test.ts` — `"reports people data as not configured without a vendor key"` — configuration state remains in `index.test.ts > "connects the licensed people lookup only when a non-empty vendor key is configured"`; missing-key refusal remains in `index.test.ts > "fails closed when the people-data vendor is not configured"`.
- `index.test.ts` — `"configures PDL from a non-empty key and exposes the same live lookup"` — merged into `index.test.ts > "connects the licensed people lookup only when a non-empty vendor key is configured"`.
- `index.test.ts` — `"says whether a GitHub token is in use"` — merged into `index.test.ts > "registers live adapters, labels, and GitHub token status"`.
- `index.test.ts` — `"makes the placeholder people-data source fail without any network call"` — no separate no-network contract: its assertion only checked the same missing-vendor rejection as `index.test.ts > "fails closed when the people-data vendor is not configured"`; it had no fetch spy.
- `index.test.ts` — `"delegates status and fetch to a licensed vendor when one is connected"` — no contract: a trivial injected-vendor wrapper; the real configured live lookup is covered by the PDL keeper.
- `index.test.ts` — `"exposes the repository finder, with the sanitiser exported on its own"` — no contract: export/type probes; actual finder imports and lazy construction remain covered by `index.test.ts > "does not contact GitHub while the repository finder is only constructed"` and GitHub adapter tests.
- `index.test.ts` — `"does not call the network when the finder is only constructed"` — renamed and retained as `index.test.ts > "does not contact GitHub while the repository finder is only constructed"`, with an explicit fetch recorder.
- `media.test.ts` — `"blocks a redirect to a never-fetch host before following it"` — shared redirect guard remains in `web.test.ts > "rechecks every redirect before requesting $target"`; the media redirect row now checks a terms-barred destination at the media boundary.
- `web.test.ts` — `"blocks never-fetch hosts and resolved private addresses before requesting them"` and `"refuses loopback by default without a request"` — merged into `web.test.ts > "blocks never-fetch, private and loopback addresses before requesting them"`; the fixture uses named hosts resolving to IPv4/IPv6 loopback so bare-IP rejection cannot mask a broken range check.
- `web.test.ts` — `"blocks a redirect to a never-fetch host before following it"` — merged into the table `web.test.ts > "rechecks every redirect before requesting $target"`.
- `web.test.ts` — `"supports wildcard and end-anchor rules when the wildcard group was selected"`, `"is not slowed by a robots rule built to make matching explode"`, and `"matches star and end rules by hand the way a pattern would"` — merged into `web.test.ts > "matches robots wildcards and end anchors from the selected group"`, including a hostile-pattern timing case.
- `web.test.ts` — `"matches robots paths case-sensitively and encodes non-ASCII rule paths"` and `"is not walked around by an escaped letter in the path or by a bare carriage return in the file"` — escaped path/rule cases now share `web.test.ts > "matches robots paths case-sensitively and normalizes escaped path and rule bytes"`; all line endings remain in `web.test.ts > "parses robots.txt records separated by %j"`.
- `web.test.ts` — `"merges matching robots groups, ignores rules before user-agent, and always allows robots.txt"` — merged into `web.test.ts > "obeys robots.txt, caches it per origin, and applies the most specific rules with allow winning ties"`.
- `web.test.ts` — `"stops reading an oversized body at the byte limit"` — repaired and retained as `web.test.ts > "cancels an oversized response after reading only through the byte limit"`, which checks stream pulls and bounded output.
- `context.test.ts` — `"allows contributor models only for public inputs and fund instructions without partner calls"` — replaced by the complete job eligibility contract in `context.test.ts > "allows contributor models only for jobs whose inputs are permitted"`; the required-field type assertion and runtime mapping check are in `context.test.ts > "assigns every model input field to a known context pool"`.

## Mutation preservation

Every mutation below was temporary. Each source file was restored byte-for-byte; `git diff --exit-code` on all mutated production paths was clean. Keepers listed here failed after the mutation. A wildcard-to-regex mutation was killed at the 6-second timeout because the hostile-path case hung.

| Production owner changed | Deliberate break | Keeper that failed |
| --- | --- | --- |
| `packages/shared/src/policy.ts` | `isNeverFetchHost` always false | `web.test.ts > "blocks never-fetch, private and loopback addresses before requesting them"`; `web.test.ts > "rechecks every redirect before requesting $target"` |
| `packages/shared/src/policy.ts` | `isOffLimitsHost` ignores terms-barred entries | `web.test.ts > "blocks terms-barred hosts with the policy detail and on redirects"`; `web.test.ts > "rechecks every redirect before requesting $target"`; `media.test.ts > "refuses private, denied, and non-media addresses before downloading a file"` |
| `packages/shared/src/hunt.ts` | `cleanUrl` no longer rejects IP literals | `web.test.ts > "blocks never-fetch, private and loopback addresses before requesting them"`; `media.test.ts > "applies robots wildcards and refuses a bare public IP before requesting it"` |
| `packages/core/src/sources/quote-check.ts` | IPv4 restricted-range guard always false | `web.test.ts > "blocks never-fetch, private and loopback addresses before requesting them"`; `web.test.ts > "rechecks every redirect before requesting $target"`; `media.test.ts > "refuses private, denied, and non-media addresses before downloading a file"`; `quote-check.test.ts > "blocks denied, local and private addresses before initial or redirected requests"` |
| `packages/core/src/sources/quote-check.ts` | IPv6 loopback check always false | `web.test.ts > "blocks never-fetch, private and loopback addresses before requesting them"` |
| `packages/core/src/sources/quote-check.ts` | local-hostname guard removed | `quote-check.test.ts > "blocks denied, local and private addresses before initial or redirected requests"` |
| `packages/core/src/sources/quote-check.ts` | pinned lookup returns no validated records | `quote-check.test.ts > "returns only prevalidated addresses from both Node lookup callback forms"` |
| `packages/core/src/sources/web.ts` | robots matcher replaced with backtracking regex | `web.test.ts > "matches robots wildcards and end anchors from the selected group"` timed out |
| `packages/core/src/sources/web.ts` | unreserved percent escapes stop decoding | `web.test.ts > "matches robots paths case-sensitively and normalizes escaped path and rule bytes"` |
| `packages/core/src/sources/web.ts` | parser stops recognizing bare CR | `web.test.ts > "parses robots.txt records separated by %j"` |
| `packages/core/src/sources/web.ts` | overflow no longer blocks the site | `web.test.ts > "refuses a whole site whose robots.txt has a rule it will not work on, instead of ignoring the rule"` |
| `packages/core/src/sources/web.ts` | robots 5xx branch allows the response | `web.test.ts > "allows a robots 404 and blocks a robots 503"` |
| `packages/core/src/sources/web.ts` | crawl delay ignored | `web.test.ts > "spaces requests by the default gap and raises it for Crawl-delay"` |
| `packages/core/src/sources/web.ts` | inject `Cookie` or `Authorization` header | `web.test.ts > "sends a generic user agent without cookies, authorization, or a referer"` |
| `packages/core/src/sources/web.ts` | page byte cap set to infinity | `web.test.ts > "cancels an oversized response after reading only through the byte limit"` |
| `packages/core/src/sources/web.ts` | remove HTTP 403 from refusal set | `web.test.ts > "refuses HTTP $status without retrying"` |
| `packages/core/src/sources/web.ts` | robots matcher always allows | `media.test.ts > "applies robots wildcards and refuses a bare public IP before requesting it"` |
| `packages/core/src/sources/media.ts` | allow all content types | `media.test.ts > "accepts direct media with a generated file name and refuses wrong types and oversized files"` |
| `packages/core/src/sources/media.ts` | size limit set to infinity | the media direct-file keeper above |
| `packages/core/src/sources/media.ts` | generated suffix changed from `.media` | the media direct-file keeper above |
| `packages/core/src/db/schema.ts` | evidence unique key changed from `(founder_id, hash)` to `id` | `store.test.ts > "deduplicates evidence by founder and hash and preserves verification when setting a quote"` |
| `packages/core/src/db/schema.ts` | migration version advanced by two | `store.test.ts > "migrates a populated version-1 database without changing its records and fills old run counters"` |
| `packages/core/src/db/store.ts` | quote update overwrites verification in the stored record | `store.test.ts > "deduplicates evidence by founder and hash and preserves verification when setting a quote"` |
| `packages/core/src/db/store.ts` | member counts always query evidence | `store.test.ts > "counts member pools from evidence or leads within the requested swarm, job and start window"` |
| `packages/core/src/db/store.ts` | founder row tagline forced null | `store.test.ts > "builds filtered dashboard rows with all status counts, evidence, flags, sorts and pagination"` |
| `packages/core/src/db/store.ts` | completed pages may be queued again | `store.test.ts > "queues a search again on a later day and never queues a page again"` |
| `packages/core/src/db/store.ts` | search retry requires both later day and different run | the frontier schedule keeper above |
| `packages/core/src/db/store.ts` | waiting-trail reassignment guard inverted | `store.test.ts > "moves an item that is still waiting to the trail that asks for it again"` |
| `packages/shared/src/context.ts` | input pool map made partial | `pnpm typecheck` failed at the intentional `@ts-expect-error` with TS2578, proving a missing field had stopped being a type error |
| `packages/shared/src/context.ts` | `screen.fit` receives sealed `network` pool | `context.test.ts > "never lets a job read a sealed pool"` |
| `packages/shared/src/context.ts` | contributor-model policy always true | `context.test.ts > "allows contributor models only for jobs whose inputs are permitted"` |
| `packages/core/src/sources/github.ts` | token status always reports unauthenticated | `index.test.ts > "registers live adapters, labels, and GitHub token status"` |
| `packages/shared/src/calls.ts` | earliest allowed hour changed from 9 to 8 | `calls.test.ts > "allows calls only from 09:00 through 19:59 in the recipient's time zone"` |
| `packages/shared/src/calls.ts` | E.164 regex accepts missing plus | `calls.test.ts > "checks E.164 form for %s"` |
| `packages/shared/src/calls.ts` | phone redaction returns input unchanged | `calls.test.ts > "removes phone-like sequences from text without altering adjacent identifiers"` |
| `packages/shared/src/calls.ts` | opening omits draft disclosure | `calls.test.ts > "builds the opening from code, draft disclosure and call context"` |

The first loopback mutation attempt passed because its fixture used a bare IP that `cleanUrl` rejected before the loopback check. I changed the fixture to a named host resolving to `127.0.0.1` and added `::1`; both IPv4 and IPv6 loopback mutations then failed the address keeper. One initial company-tagline mutation selected the broad company-storage test and passed; selecting the founder dashboard-row keeper made the same mutation fail at the tagline assertion.

## Uncertain keepers

- `web.test.ts > "can read a local server only when the explicit loopback test option is enabled"` was skipped because this environment returned `EPERM` while binding the local server. This is the live socket-level reader/DNS-pinning check; `quote-check.test.ts > "returns only prevalidated addresses from both Node lookup callback forms"` passed and was mutation-checked, but it only proves the lookup callback boundary.

## Product bug found; not fixed

- `packages/core/src/sources/web.ts:226-241`: `loadRobots` limits robots reads to 512 KiB but ignores `result.truncated` before parsing the clipped body. A temporary probe placed `Allow: /`, more than 512 KiB of comment text, and then `Disallow: /private`; `reader.read("/private")` returned `ok` rather than refusing the site. The probe test was removed and the test file restored. This violates the robots size-limit fail-closed contract; fixing production was outside this audit's test-pruning scope.
