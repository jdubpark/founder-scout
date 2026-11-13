# People-data vendors and search APIs for founder sourcing

Research date: 2026-11-13. All access dates are 2026-11-13 unless noted.

**Not legal advice.** This is a reading of vendors' own documentation and trust pages. It is not a legal opinion on scraping, privacy, data-broker or licensing questions. Have counsel review any vendor contract and the firm's own use (outreach, storage, EU data) before go-live.

Evidence labels: OPENED = I read the provider's own page. SNIPPET = web-search result text only. BLOG = third-party write-up (weak). No request was sent to linkedin.com. Dealroom's marketing site and PitchBook's site returned a Cloudflare challenge; I did not try to get around it.

## 1. Summary

| Provider | SEARCH | ENRICH | Entry price (published) | Provenance, own words | Risk note |
|---|---|---|---|---|---|
| People Data Labs | Yes, ES DSL or SQL | Yes, by profile URL, email, name+company, pdl_id | Free 100 credits/mo; Pro from $98/mo for 350 credits | Proprietary partners plus public data | $6.36M phone-number class settlement (Colorado) |
| Coresignal | Yes, ES DSL | Yes, by profile URL or id | 7-day trial 2,000 credits; Mini $49/mo | Public web data only | Fields still mirror LinkedIn; no suit found |
| Crustdata | Yes, filter JSON | Yes, by profile URL (max 25) | $20 free credits; search 0.03 credits per result | Indexed web data plus live web retrieval | "Live" calls fetch at request time; LinkedIn URLs are the key |
| Bright Data | Dataset filter API; Business Search (beta) | Scraper API by URL | LinkedIn people dataset $0.0006 per record shown at checkout | Collected from public pages, re-scraped on demand | Scraper-based; no LinkedIn suit found |
| Apollo | Yes, free, no emails | Yes, 1 to 9 credits | Free plan exists; credit price not on docs page | Public sources plus vetted third parties | Sales-tool data; thin work history in search |
| Harmonic | Saved searches only | By profile URL or email | Not published | Public sources, legal filings, founder submissions | API docs behind a login-style console |
| Specter | Saved searches and date feed | By profile URL or email | 200 free credits; plans via sales | Not stated on pages I could open | Best stealth-founder fit; enrich needs LinkedIn identifier |
| Crunchbase | Yes, people and jobs entities | Yes, entity lookup | Sales only | Crunchbase's own database | Thin on stealth people; no stated refresh per person |
| Dealroom | Yes, `/data/people` | Yes, by id and career | Not published | Dealroom database | EU startup focus; gated plan |
| PitchBook | Unverified | Unverified | Not published | Own research | Contract only; docs gated |
| Clay | No (aggregator) | Waterfall of other vendors | Not verified | Vendors' data | Not an API to adapt; sources conflict |
| Proxycurl | Gone | Gone | n/a | n/a | Shut down 2025-07-04 after LinkedIn suit |

## 2. Status, litigation and enforcement

| Subject | Finding | Evidence |
|---|---|---|
| Proxycurl (Nubela) | Founder post dated 2025-07-04: LinkedIn sued in January 2025; "we are shutting Proxycurl down", "to comply with the legal settlement with LinkedIn". The founder now runs NinjaPear. | OPENED https://nubela.co/blog/goodbye-proxycurl/ |
| ProAPIs | LinkedIn v. ProAPIs, N.D. Cal. 5:25-cv-08393, filed 2025-10. One source reports a consent judgment on 2026-09-16; Bloomberg Law reports a settlement filing in 2026-02. Dates conflict. | SNIPPET digitalpolicyalert.org, news.bloomberglaw.com |
| Mantheos | LinkedIn v. Mantheos, 2022, consent judgment, deletion of scraped data. Old, resolved. | SNIPPET lawstreetmedia.com, law360.com |
| People Data Labs | Cochrane v. People Data Labs (alleged listing of Colorado cell numbers). Reported $6.36M settlement, preliminary approval 2026-06-30, final hearing 2026-11-17. PDL denies the allegations. Figures come from settlement aggregators, not a docket. | SNIPPET openclassactions.com, classaction.org |
| Apollo, Coresignal, Crustdata, Bright Data, Specter, Harmonic | Searches for LinkedIn suits against these names found none. Absence of results is not proof of absence. | SNIPPET |
| California data brokers | CalPrivacy has an active enforcement program (LocateSmarter fine 2026-08, strike force since 2025-11). I could not confirm any vendor above is on or off the registry. | SNIPPET law firm notes |
| Apollo | Privacy policy: "Apollo operates as a registered business-to-business data broker." | OPENED https://www.apollo.io/privacy-policy |
| Bing Search APIs | Retired 2025-08-11. Replacement is Grounding with Bing inside Azure AI Agents. | OPENED learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement |
| Google Custom Search JSON API | Closed to new customers; existing customers must move by 2027-01-01. | OPENED developers.google.com/custom-search/v1/overview |

LinkedIn-licensed providers: I found no vendor that states a licence or partnership with LinkedIn or Microsoft for profile data. Searches returned only the LinkedIn Partner Program (case-by-case approval, no profile search or outreach API) and vendor blogs. Treat every vendor below as unlicensed unless its contract says otherwise. SNIPPET/BLOG (getphyllo.com, unipile.com).

## 3. People Data Labs (PDL)

Status: operating. Dataset release v36.0 on 2026-10-20. OPENED https://docs.peopledatalabs.com/changelog/october-2026-release-notes-v360.md

### API surface (OPENED, docs.peopledatalabs.com, `.md` pages)

| Item | Person Enrichment | Person Search |
|---|---|---|
| URL | `GET https://api.peopledatalabs.com/v5/person/enrich` | `https://api.peopledatalabs.com/v5/person/search` (quickstart shows GET; verify whether POST with a JSON body is accepted before coding) |
| Auth | Header `X-Api-Key: <key>` or `api_key` query param | Same |
| Match inputs | `profile`, `email`, `phone`, `email_hash`, `lid`, `pdl_id`, or (`name` or `first_name`+`last_name`) plus one of `company`, `school`, `location`, `locality`, `region`, `country`, `postal_code`, `birth_date` | `query` (Elasticsearch 7.7 DSL) or `sql`, not both |
| Control params | `min_likelihood` (default 2), `required`, `data_include`, `include_if_matched`, `titlecase`, `pretty` | `size` 1 to 100 (default 1), `scroll_token`, `from` (0 to 9999, legacy), `dataset` (default `resume`), `data_include`, `titlecase` |
| Pagination | n/a | `scroll_token` from each response; `null` when exhausted |
| Query limits | n/a | Allowed: term, terms, exists, bool, match, range, match_phrase, wildcard, prefix, match_all. Arrays max 1000 elements. SQL wildcards max 20. No aggregations or boosting. |
| Success | `200` with `status`, `likelihood` (1 to 10), `data` | `200` with `status`, `data[]`, `total`, `scroll_token` |
| No match | `404` `{"status":404,"error":{"type":"not_found",...}}` | Reference page says `200` for any valid query, so check `total`. The input-parameters page also mentions a `404` when scroll pagination is finished. Handle both. |
| Other errors | `400 invalid_request_error`, `401 authentication_error`, `402 payment_required`, `405`, `429 rate_limit_error`, `5xx api_error` | Same |
| Rate limit | Free 100 per minute, paid 1,000 per minute | Default 10 requests per minute |
| Credits | 1 per successful match; 404 not billed | 1 per profile returned in `data` |

Sources: reference-person-enrichment-api.md, input-parameters-person-enrichment-api, reference-person-search-api.md, input-parameters-person-search-api.md, errors.md, usage-limits.md, how-credits-work.md (support/billing).

Rate-limit and credit response headers (OPENED usage-limits.md): `x-call-credits-spent`, `x-call-credits-type`, `x-ratelimit-reset`, `x-ratelimit-limit` and `x-ratelimit-remaining` (objects with `minute`, `day`, `month`), `x-lifetime-used`, `x-totallimit-remaining`, `x-totallimit-purchased-remaining`, `x-totallimit-overages-remaining`. Rate limits are fixed-window per key and per endpoint.

### Response fields to map (OPENED https://docs.peopledatalabs.com/docs/fields.md)

| Need | Field |
|---|---|
| Stable id | `id` (PDL persistent id) |
| Name | `full_name`, `first_name`, `last_name` |
| Profile link | `linkedin_url` (null when no active profile), `profiles[]` |
| Current role | `job_title`, `job_company_name`, `job_company_id`, `job_company_linkedin_url`, `job_start_date` (example `"2015-03"`), `job_title_levels` (example `["cxo","owner"]`), `job_title_role` |
| Change signals | `job_last_changed`, `job_last_verified` (dates); `experience[].first_seen`, `.last_seen` |
| History | `experience[]` with `company{name,id,industry,founded,linkedin_url,...}`, `title{name,...}`, `start_date`, `end_date` (null if current), `is_primary`, `summary`, `location_names` |
| Education | `education[]` with `school{name,linkedin_url,...}`, `start_date`, `end_date`, `majors`, `degrees` |
| Other | `skills[]`, `location_name`, `location_last_updated`, `inferred_years_experience`, `dataset_version` |

`birth_date` and `birth_year` exist in the schema. The firm's rules forbid storing or scoring personal attributes, so request with `data_include` to leave them out.

### Pricing and freshness

- Free: up to 100 credits a month, contact data obfuscated. Pro (self-serve): "Starting at $98/mo", "as few as 350 credits/mo", annual saves 20 percent. Enterprise: custom, data license. OPENED https://www.peopledatalabs.com/pricing
- Search and enrich draw from one credit pool; the `x-call-credits-type` header names the type.
- API data updates monthly (data-updates.md, OPENED). October 2026 notes: "53M+ resume experiences" refreshed and "6.1M+ job changes" detected in the month (OPENED). `job_last_verified` is the per-record freshness field. A Person Changelog API exists for diffs (not read).

### Provenance and compliance (OPENED docs.peopledatalabs.com/docs/data-sources.md)

- Sources: "proprietary sources" (HR tech, identity, martech and others) and "public data sources" (open datasets, public records). The page does not name LinkedIn as a source. The enrich API accepts a `profile` or `lid` as an input key.
- Opt-out and deletion: Privacy Center form and a privacy email; API opt-outs apply immediately; Subject Request API and Person Changelog API exist for licensees.
- Acceptable Data Use Policy bans use for employment, credit, insurance or housing decisions, and sensitive profiling. Outreach for investing sits outside the listed bans, but confirm the exact policy text.
- Certifications: "ISO & SOC 2 Type 2 compliant" (pricing page, OPENED). DPA, GDPR position and data-broker registrations: not verified.

### Adapter notes: PDL

```
BASE   https://api.peopledatalabs.com/v5
AUTH   header  X-Api-Key: $PDL_API_KEY

ENRICH by profile link, name+company, or email
GET /person/enrich?profile=<url>&min_likelihood=6&data_include=id,full_name,linkedin_url,job_title,job_company_name,job_start_date,job_last_changed,job_last_verified,experience,education,location_name
GET /person/enrich?name=Jane%20Doe&company=Acme&min_likelihood=6
GET /person/enrich?email=<email>
  200 {status,likelihood,data}   404 not_found = no match (not an error)
  402 out of credits   429 back off using x-ratelimit-reset

SEARCH recent founders (Elasticsearch DSL)
body: {"size": 100, "dataset": "resume",
       "query": {"bool": {"must": [
         {"wildcard": {"job_title": "*founder*"}},
         {"range": {"job_start_date": {"gte": "2026-08"}}},
         {"terms": {"job_company_name": ["stealth", "stealth startup"]}}   // optional, as a should
       ], "filter": [{"term": {"location_country": "united states"}}]}}}
  Field names for the query (job_title, job_start_date, experience.company.name,
  location_country) come from the schema page. Confirm against the Elasticsearch
  Mapping page before shipping. All stored text is lowercase.
  Page with scroll_token until null; each profile returned costs 1 credit.
  Limit 10 searches per minute by default.
```

Mapping notes: map `job_start_date` ("YYYY-MM" or "YYYY") to a partial date. Use `job_last_verified` as the record age. A founder "recently left to start something" is `experience[]` where the primary entry started recently and the previous entry has an `end_date` near that start. Previous-employer lists use `experience.company.name` terms; test that nested query shape on the free tier first.

## 4. Coresignal

Status: operating; docs updated 2026 (record sample shows `updated_at` 2026-05-23). OPENED https://docs.coresignal.com/

| Item | Detail |
|---|---|
| Base and auth | `https://api.coresignal.com/cdapi/v2/...`, header `apikey: <key>` |
| SEARCH | `POST /v2/employee_multi_source/search/es_dsl` (free, returns ids), `.../semantic_search/es_dsl`, `.../search/es_dsl/preview` (20 credits, partial fields, up to 20 per call). Search filters also exist. |
| ENRICH / COLLECT | `GET /v2/employee_multi_source/collect/{employee_id}` and `.../collect/{profile_url/shorthand_name}`, 20 credits; `fields=` and `bundle=` params; Core bundle 10 credits |
| Bulk | `POST /v2/data_requests/employee_multi_source/es_dsl` or `/ids`, then `GET /v2/data_requests/{id}/files` |
| Change feed | Webhooks `POST /v2/subscriptions/experience_changes/employee_multi_source/ids` or `/es_dsl`: notifications when "employee experience records add or close positions". Subscriptions last 91 days; no credit per notification. This is the closest thing to a "just left to start something" feed among the API vendors. |
| Fields | `full_name`, `headline`, `is_working`, `active_experience_title`, `active_experience_company_id`, `experience[]` (`position_title`, `date_from`, `date_from_year`, `date_from_month`, `date_to`, `company_name`, `company_id`, `active_experience`, `order_in_profile`), `education[]` (`institution_name`, `date_from_year`, `date_to_year`, `degree`), `created_at`, `updated_at`, `checked_at`, `is_deleted`. The profile link field is `professional_network_url`. |
| Pagination | ES DSL results pagination (page doc not read) |
| Status codes | 200, 400, 401, 402 insufficient credits, 404 unknown id, 422, 429, 500, 502, 503. Header `x-credits-remaining`. |
| Rate limits | 5 req/s (trial to Starter) up to 100+ req/s |
| Pricing | Trial 2,000 credits for 7 days. Mini $49/mo (2,500 credits), Starter $199 (12,000), Pro $499 (35,000), Growth $1,000 (150,000). Annual 10 percent off. Search Preview not on Mini or Starter. |
| Freshness | Per-record `updated_at` and `checked_at`. |
| Provenance | "exclusively collects publicly available data from online sources", "strictly refrains from any data collection that involves any kind of data aggregation within secured login areas", founding member of the Ethical Web Data Collection Initiative. Docs avoid naming the network, but sample URLs use `media.licdn.com`. |
| Compliance | Privacy page not opened. SOC 2, DPA, data-broker status: not verified. |

URLs: docs.coresignal.com/employee-data/api.md, /collect.md, /search-preview.md, /bundles/core.md, /pricing/pricing.md, /api-introduction/credits.md, /rate-limits.md, /response-codes.md, /introduction/data-and-compliance.md.

## 5. Crustdata (clearest public API after PDL)

Status: operating; "$10M ARR" on its pricing page (OPENED https://crustdata.com/pricing). Every endpoint needs `Authorization: Bearer <key>` and `x-api-version: 2025-11-01`. OPENED https://docs.crustdata.com/general/introduction.md

| Item | Detail |
|---|---|
| SEARCH | `POST https://api.crustdata.com/person/search`. Body `{"filters": {"op":"and","conditions":[{"field","type","value"}]}, "fields":[...], "limit": n, "cursor": "..."}`. Operators include `=`, `!=`, `in`, `not_in`, `>`, `is_not_null`, `(.)` (all words), `[.]`, `(!)`. No `contains`. Response: `profiles[]`, `next_cursor` (null at end), `total_count`. Rate 30 per minute. OPENED person-docs/search/introduction.md and reference.md |
| Founder filters | `experience.employment_details.title` with `(.)` "Co-Founder" or "Founder"; `experience.employment_details.current.company_name`; `basic_profile.location.full_location`; boolean `recently_changed_jobs` ("previous role ended within 90 days of the last index rebuild"); a filter on `experience.employment_details.current.start_date` for a time window (data-updates.md names it; operator syntax not copied). |
| ENRICH | `POST https://api.crustdata.com/person/enrich`, body `{"professional_network_profile_urls": [up to 25], "fields": [...]}`. Response array of `{matched_on, match_type, match_status (matched/not_found/redacted), matches[{confidence_score, person_data}]}`. 15 per minute. Name-plus-company enrich is not offered on this endpoint; use Search then Enrich, or Person Identify (profile URLs or emails). |
| Response fields | `crustdata_person_id`, `basic_profile{name,headline,location{...}}`, `social_handles.professional_network_identifier.profile_url`, `experience.employment_details{current[],past[]}` (each with `name`, `title`, dates), `education`, `skills` |
| Watchers | Person Discovery Watcher re-runs a search on a schedule and delivers new matches to webhook, Slack or email. OPENED llms.txt entry; page not read. |
| Pricing | Search 0.03 credits per result; with no `fields`, experience and education are included, so 0.23 per result. Enrich 1 credit per profile (up to 4). `GET /account/endpoints` returns your own prices. New accounts get $20 free credits. Credits valid 12 months. Dollars per credit: not shown on pages I read. |
| Freshness | "at least once every 30 days, and the most active profiles as often as every day"; per-record `updated_at`. "Live" endpoints "retrieve it from the web at the moment you call them" (enterprise or add-on). |
| Compliance | Privacy page lists delete and opt-out rights and GDPR Article 21 objection. `match_status: redacted` marks removed people. SOC 2, DPA, data-broker status: not verified. |

## 6. Bright Data

OPENED https://docs.brightdata.com/ (llms.txt, FAQ, purchase options, Business Search intro).

- Datasets: LinkedIn people profiles are sold as a marketplace dataset. Purchase page shows "Cost per record - $0.0006" for the "LinkedIn people profile dataset". The product page says "Starts from $250/100K rec". Filter API: "no monthly commitment or minimum order of $250", pay for matched records; a filter can bill even before you buy.
- Provenance in its own words: fresh data means records outside the time range "will be scraped when the request is processed" and incur an extra fee. Records do not include emails or phones by default.
- Business Search (beta): `POST https://api.brightdata.com/search/people` and `/search/company`, header `Authorization: Bearer`, body `{"mode":"ludicrous"|"instant"|"smart","query":{...}|"sentence","limit":n,"view":"summary"}`. Ludicrous takes structured `and`/`text`/`equals`/`range` conditions, up to 100 per page; index of "more than 700 million people and companies, refreshed monthly". People fields listed: title, current company, location, follower count. No work-history or start-date filter is shown.
- Security: ISO 27001, SOC 2 Type II, GDPR and CCPA (OPENED security overview entry).
- Litigation: Meta v. Bright Data (Facebook, Instagram) was beaten back in 2024 (SNIPPET, Bloomberg Law). No LinkedIn suit found.
- Fit: bulk datasets suit backfill, not low-latency enrich. The vendor describes its own LinkedIn products as scraping, which is the provenance the firm's rule on profile data is meant to avoid. Use only after counsel review.

## 7. Apollo

OPENED https://docs.apollo.io/ (llms.txt, reference pages).

- Base `https://api.apollo.io/api/v1`, header `x-api-key`. Terms: apollo.io/terms/api.
- SEARCH `POST /mixed_people/api_search`: filters `person_titles[]`, `person_locations[]`, `person_seniorities[]`, `organization_ids[]`, `organization_locations[]`, `q_organization_domains_list[]`, `q_keywords`; 100 per page, max 500 pages (50,000). 0 credits. No emails or phones. No start-date filter seen. Results carry `last_refreshed_at`.
- ENRICH `POST /people/match`: inputs include name, email, domain, organization name, `linkedin_url`, `hashed_email`; response has `match_confidence` (high, medium, low, none), `employment_history[]`, `linkedin_url`. Bulk up to 10 via `POST /people/bulk_match`. 1 to 9 credits, only when data is found; 8 extra for mobile.
- Rate limits per team, per minute, hour, day: Free 50/200/600; Basic and Professional 200/400/2,000; Organization 200/600/6,000.
- Provenance: "publicly accessible websites, professional directories, public regulatory and government sources, and vetted third parties". Registered B2B data broker (own policy). Credit price in dollars: not on the pages read.

## 8. Harmonic and Specter (stealth-founder products)

### Harmonic

- Public OpenAPI at https://api.harmonic.ai/openapi.json (OPENED, 62 paths). People endpoints: `GET /persons` (ids, urns), `POST /persons` (body `linkedin_url` or `email`), `GET /persons/{id_or_urn}`, `POST /persons/batchGet`. Discovery runs through saved searches: `POST /saved_searches`, `GET /saved_searches:results/{id_or_urn}`, `GET /saved_searches/{id}/net_new_results`; also `GET /search/search_agent` (natural language) and typeahead. There is no ad-hoc people search endpoint in the spec.
- Person fields: `experience[]` (person-company metadata has `title`, `start_date`, `end_date`, `is_current_position`), `education`, `linkedin_headline`, `linkedin_profile_visibility_type`, `last_checked_at`, `last_refreshed_at`, `is_redacted`.
- Auth header, base URL and pricing: not in the spec; docs console (console.harmonic.ai/docs) did not render for me. Unverified.
- Changelog: legacy watchlist and custom-field REST APIs retire 2026-11-05, replaced by a GraphQL Workspace API; enrichment, search and company and people data v1 REST stays. OPENED https://support.harmonic.ai/en/articles/14892859-api-bulk-data-changelog
- Stealth: Stealth Emergence feature (OPENED support.harmonic.ai/en/articles/11586000-stealth-emergence): "legal filings, LinkedIn signals, blog posts, news articles, and more"; "Stealth Emergence Date" filter and API fields for emergence date and name aliases. Its blog frames founder departures from top labs as an early signal (SNIPPET).

### Specter

OPENED https://api.tryspecter.com (llms.txt, products, rate limits, OpenAPI).

- Base `https://app.tryspecter.com/api/v1`, header `X-API-Key`, 15 requests per second, `429 RATE_LIMITED`, `402 OUT_OF_CREDITS`.
- Talent Signals: "founders going into stealth, executives changing roles". Fields: `signal_type` (example "New Company"), `signal_status` (example "Stealth"), `signal_score` (1 to 10), `out_of_stealth_advantage` (months), `new_position_title`, `new_position_company_name`, `past_position_company_id`, `signal_summary`, `highlights`, plus the full person profile.
- Endpoints: `GET /talent` (by `signal_date_after`, `signal_date_before`, 50 per page, 1 credit per result, empty page free), `GET /people/{personId}/talent-signals`, `GET /searches/talent/{searchId}/results` (with `new_results_after`). Saved searches are created in the web app and must be shared to the API.
- ENRICH: `POST /people` by exactly one LinkedIn identifier (URL, vanity id, numeric id, URN), 1 credit per match; `202` means queued, usually within 24 hours. `POST /people/by-email`. Profile has career history, education, skills.
- Pricing: "requires at least one paid web-app seat"; 200 free credits in the API console; plans by sales. Freshness per record: not stated.
- Provenance: not stated on pages I opened. Plans page mentions "Network mapping across your team's LinkedIn connections", which implies connection data supplied by customers. Marketing claims 700M people. Ask in writing how signals are sourced.
- Fit: closest match to "recently became a founder" with a ranked score, but search is feed-style, not filter-style.

## 9. Crunchbase, Dealroom, PitchBook, Clay

| Provider | Findings | Evidence |
|---|---|---|
| Crunchbase | `https://api.crunchbase.com/v4/data/`, header `X-cb-user-key`. Read-only; "API access is available through the Crunchbase sales team". 200 requests per minute, 3 concurrent. Person search `POST /data/searches/people`; Job search `POST /data/searches/jobs` (fields `started_on`, `ended_on`, `is_current`, `job_type`, `title`); person cards: degrees, founded_organizations, jobs, primary_job. No price published. | OPENED data.crunchbase.com/docs/using-the-api.md, /reference/searchjobs.md |
| Dealroom | `https://api.dealroom.app`; OAuth2 client credentials, token from `https://accounts.dealroom.co/oauth/token` (audience `https://api.dealroom.app`), about 1 hour; `API-Version` date header. `GET /data/people`, `GET /data/people/{id}`, `GET /data/people/{id}/career` (role flags founder, executive, partner, tenure). Pricing not found. | OPENED developers.dealroom.co |
| PitchBook | API is a separate contract; endpoint overview is for contracted clients; no public OpenAPI; a people endpoint is reported (about 4.4M professionals) but unconfirmed by PitchBook. | SNIPPET pitchbook.com/help/pitchbook-api; BLOG pipeline.zoominfo.com |
| Clay | Aggregator over 200+ vendors. Public REST API status is disputed across blogs (one says GA since 2026-09-15; another says undocumented). Webhook and HTTP-API column gating varies by source. Not a candidate for a typed adapter. | BLOG cleanlist.ai, pipeline.zoominfo.com; pricing page opened but no plan details extracted |

## 10. Search APIs (discovery without touching the site)

| API | Available Nov 2026 | Profile pages with title and snippet | Price | Storing results | Evidence |
|---|---|---|---|---|---|
| Google Custom Search JSON | Closed to new customers; existing users until 2027-01-01 | Not tested | 100 free per day, then fee (rate not on page read) | Not read | OPENED |
| Bing Search APIs | Retired 2025-08-11 | n/a | n/a | n/a | OPENED |
| Brave Search API | Yes | Generic web results; index coverage of profile pages not tested | $5 per 1,000 requests, $5 free credit a month; Answers $4 per 1,000 | Terms bar anyone from "stor[ing], cach[ing], or creat[ing] a database of Search Results" except transient storage. Brave help text says a separate "Data with storage rights" plan exists; its price is not public. | OPENED pricing and ToS; SNIPPET help page |
| Exa | Yes, `POST https://api.exa.ai/search`, `x-api-key` or Bearer | Docs: "professional profiles" are a supported result type, with example queries like "professional profiles of founders of YC-backed developer tools companies" | Search from $4 per 1,000; contents $1 per 1,000 pages; $10 free credits monthly | Terms page returned no storage clause to my search; read it before storing | OPENED docs and pricing |
| Tavily | Yes | Not tested | Free 1,000 credits a month; $0.008 per credit pay as you go | Terms define "Output"; storage rights not extracted | OPENED pricing and terms |
| Parallel | Yes | Not tested | Search $1 to $5 per 1,000 requests; Extract $1 per 1,000 URLs | Terms found restrict copying the vendor's website content; API output terms not found | OPENED pricing |

Takeaway: for discovery, Exa is the only one whose own docs target people and profile queries. Storing results is the open question for every search API, and Brave's terms say no on standard plans.

## 11. How venture firms describe their sourcing systems

| System | Sources and signals (firm's words) | Evidence |
|---|---|---|
| EQT Motherbrain | "vast proprietary database containing hundreds of millions of data points about companies, people, and the connections between them"; head of Motherbrain's 2024 post. Earlier material: external data plus company data plus about 140,000 connections uploaded by EQT staff; "over 50 sources". | OPENED eqtgroup.com/thinq/technology/how-exactly-is-eqt-using-ai; SNIPPET for the 140,000 and 50 figures |
| SignalFire Beacon | Tracks "80 million companies, 600 million people, and millions of open-source projects"; matching of people and companies across sources. Source names such as LinkedIn or GitHub not confirmed. | SNIPPET signalfire.com/signalfire-beacon-ai/ (page body did not render for me) |

Both describe internal platforms that are not sold as APIs. Secondary: no source list beyond the above.

## 12. Notes for the adapter design

- Every enrich path except PDL name+company, Apollo and Harmonic email takes a LinkedIn profile URL as the key. Passing a URL string to a vendor is not a request to linkedin.com, but it ties the firm to vendor data that mirrors that site. Prefer PDL `pdl_id`, email, or name plus company once a record is known.
- Only Coresignal (experience webhooks), Crustdata (watchers, `recently_changed_jobs`) and Specter (talent feed) offer change-based discovery. PDL search can approximate it with `job_start_date` ranges, polled on a schedule.
- Keep `last updated` fields on every stored record: PDL `job_last_verified`, Coresignal `updated_at`, Crustdata `updated_at`, Apollo `last_refreshed_at`, Harmonic `last_refreshed_at`.

## 13. Unverified / unknown

- PDL: whether Person Search accepts POST with a JSON body; exact Elasticsearch field paths for nested experience queries (mapping page not opened); DPA, GDPR statement, and any California, Vermont, Texas or Oregon data-broker registration; the Cochrane settlement figures against a court docket.
- Coresignal, Crustdata, Specter, Harmonic, Dealroom: SOC 2, DPA, data-broker registration, and opt-out pages not opened or not found.
- Crustdata: dollars per credit; the `start_date` filter operator syntax; Person Identify details.
- Harmonic: auth header, base URL, pricing, the stealth filter name; docs console would not render.
- Specter: where signals come from, per-record freshness, price.
- Bright Data: people-record fields and the Filter API request shape (docs page not opened); the $0.0006 figure is shown for one dataset in a purchase flow and conflicts with "$250/100K" on the product page.
- Search APIs: whether any returns professional-profile pages for a given query (needs a live test with a key); Google per-query price; Exa, Tavily and Parallel storage clauses.
- Apollo: dollar price per credit; whether `api_search` returns start dates.
- Whether any vendor holds a LinkedIn or Microsoft licence: none found; vendors may state it in contracts only.
- ProAPIs resolution date: two sources conflict (2026-02 and 2026-09-16).
- Clay public API status; PitchBook people endpoint; Crunchbase and Dealroom prices.
