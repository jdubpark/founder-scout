# Accelerator directories a program can list

Under the reading rule (robots.txt for a generic agent, no login, no challenge, no key taken from a page), six programmes can be listed by code today and three of them name founders: Y Combinator (open mirror, then each company page), 500 Global (one JSON file) and a16z speedrun (one page, then each company page). Founders, Inc. and South Park Commons name founders on company pages, and Entrepreneurs First names them on its list page. Berkeley SkyDeck, Alliance and ODF list companies with a cohort but name no founders. Techstars draws its list from a search service with a key the page hands out, so it is not listable under the rule.

Read on 2026-11-13. Every figure below was read that day. Terms are recorded and bar nothing here; robots.txt decides.

## Comparison

"Listed" means a program can get the list with plain GET or POST requests to addresses the site's own pages use, without a key.

| Programme | How listed | Founders named | Newest cohort in the list | robots.txt verdict |
|---|---|---|---|---|
| Y Combinator, open mirror | One JSON file per batch, tag, industry; all 6,394 in one file | No | "Winter 2027" (13), "Summer 2027" (1), "Fall 2026" (231) | No robots.txt on the mirror (404). Readable |
| Y Combinator, own site | `/launches` returns JSON, 20 per page, newest first; `/companies/<slug>` HTML | Yes, on company page, with LinkedIn and X | Launches dated 2026-11-13; batch "Fall 2026" | Readable in part: `/companies?*` refused, `/companies/<slug>` and `/launches` allowed |
| 500 Global | `GET /api/startups`, 2,242 records | Yes, first and last name on the list | Latest investment date 2026-06-25 (batch "SF 37") | Readable (no Disallow) |
| a16z speedrun | `/companies` page embeds the list as JSON | Yes, on company page, with LinkedIn | SR007, 79 companies (only SR007 is in the page) | No robots.txt (404). Readable |
| Founders, Inc. | Static HTML, 615 portfolio links; sitemap | Yes, on company page, with LinkedIn and X | No cohort field; "FOUNDED" year per company | Readable; names AI crawlers as welcome |
| Entrepreneurs First | Static HTML, first 48 tiles; the rest by an unidentified "Load more" | Yes, on the list tile (CEO, CTO names) | Tiles up to "Founded 2026" | Readable, `Crawl-delay: 10` |
| South Park Commons | Static HTML, 42 company links | Yes, on company page, with LinkedIn | No cohort field | Readable |
| Berkeley SkyDeck | `POST /wp-admin/admin-ajax.php`, 360 records | No | "Batch 21" (15) | Readable; the ajax path is explicitly allowed |
| Alliance | Static HTML; cohort class number embedded, 187 companies | No | Class 18 (19 companies) | Readable |
| ODF (On Deck) | `companies.joinodf.com` page embeds 104 records | No | ODF25 (1 listed); ODF28 starts Q1 2027 | Readable |
| Village Global | Static HTML | Yes, on the list | No cohort field | robots.txt has only a sitemap line. Readable |
| Betaworks | Static HTML, names only | No | None (Camp pages by theme) | robots.txt is empty. Readable |
| AI Grant | Static HTML on the home page | No | Batch 4 (17 companies) | No robots.txt (404). Readable |
| Techstars | Search service behind a key | No | `first_session_year` up to 2026 (134) | Readable, but the list needs the key. Not used |
| Antler | Featured companies only in HTML | No | None | Readable in part: `/portfolio/company/` and the showcase refused |
| Plug and Play | First 12 of 2,562 in the page; paging is under `/.rest/` | No | None | Readable in part: `/.rest/` refused |
| Neo, Alchemist, StartX, NVIDIA Inception, Conviction Embed, Sequoia Arc, Z Fellows, Thiel Fellowship | No public company directory found | | | See sections |
| HF0, PearX, Microsoft for Startups | Not read | | | See "Not verified" |

## Y Combinator

### Open mirror (yc-oss.github.io)

An unofficial JSON mirror. Its README says: "It only includes **publicly launched companies** with pages on the Y Combinator website. It does not scrape the Y Combinator website, instead it uses the Algolia search index to fetch the companies in a GitHub Actions workflow that runs every day." It was last rebuilt `2026-11-13T04:12:00.660Z` (`meta.json`). Companies: 6,394. Batches: 51. Industries: 59. Tags: 338. Licence: none found. The GitHub API returns `"license": null` for `yc-oss/api` and `LICENSE` on the main branch is a 404.

Listing endpoints (all `GET https://yc-oss.github.io/api/<path>`, each an array of company records):

- `companies/all.json` (10.9 MB), `companies/top.json` (91), `companies/hiring.json` (1,490), `companies/nonprofit.json` (42), `companies/app-video-public.json` (103), `companies/demo-day-video-public.json`. `black-founded`, `hispanic-latino-founded` and `women-founded` exist but each has count 0 today.
- `batches/<batch-slug>.json`, for example `batches/fall-2026.json`, `batches/winter-2027.json`, `batches/summer-2027.json`. Old batches use the long form too (`summer-2005.json`). One extra, `batches/unspecified.json`.
- `industries/<slug>.json` (for example `b2b`, `fintech`, `healthcare`) and `tags/<slug>.json` (for example `3d-printing`).
- `changes/latest.json` and `changes/latest.md`: a daily change set. Today: previous 6,391, current 6,394, added 3, removed 0, updated 42. Each added company is a full record.
- `meta.json`: counts and the endpoint for every list.
- One company: the `api` field of a record, for example `batches/fall-2026/tire-swing.json`.

The list cannot be filtered by date, only by batch, tag or industry. `all.json` is ordered oldest batch first. Newest batches today are `winter-2027` (13 companies, `launched_at` 2026-05-14 to 2026-11-12), `summer-2027` (1) and `fall-2026` (231). Batch names run ahead of the calendar in this data; take them as the mirror writes them. `launched_at` can be older than the batch: Tire Swing is in "Fall 2026" with `launched_at` 2025-02-25.

One record, trimmed (`batches/fall-2026.json`):

```json
{
 "id": 30290, "name": "Tire Swing", "slug": "tire-swing", "former_names": [],
 "small_logo_thumb_url": "https://bookface-images.s3.amazonaws.com/small_logos/954a...png",
 "website": "https://gettireswing.com", "all_locations": "New York City, NY, USA",
 "long_description": "Tire Swing uses AI to power resident and applicant eligibility evaluations ...",
 "one_liner": "The AI Affordable Housing Platform", "team_size": 2,
 "industry": "B2B", "subindustry": "B2B -> Legal", "launched_at": 1740473580,
 "tags": ["GovTech","Real Estate","Housing","Compliance","Legal"], "tags_highlighted": [],
 "top_company": false, "isHiring": false, "nonprofit": false,
 "batch": "Fall 2026", "status": "Active", "industries": ["B2B","Legal"],
 "regions": ["United States of America","America / Canada"], "stage": "Early",
 "partners": "Grey", "app_video_public": false, "demo_day_video_public": false,
 "app_answers": null, "question_answers": false,
 "url": "https://www.ycombinator.com/companies/tire-swing",
 "api": "https://yc-oss.github.io/api/batches/fall-2026/tire-swing.json"
}
```

Every record in `all.json` has exactly these 30 fields. The README schema also lists `highlight_black`, `highlight_latinx` and `highlight_women`; none of the 6,394 records carries them. `partners` is in the records but not in the README schema. The `batch` field uses the long form in the data ("Winter 2012"), although the README example shows `"W09"`; `parseYcDirectory` in the repo reads the long form. Founders are not in the record. Profile links are not either; the company `url` leads to them.

Robots: `https://yc-oss.github.io/robots.txt` is a GitHub Pages 404, so no rule applies. Verdict: readable.

### Own site: Launches and company pages

robots.txt (`https://www.ycombinator.com/robots.txt`), the group for `*`:

```
User-Agent: *
Disallow: /verify/*
Disallow: /library?categories=*&*
Allow: /library?categories=*
Disallow: /library?*
Disallow: /companies?*
Allow: /
```

No line names an AI agent. Verdict: readable in part. The directory with a query string (`/companies?batch=...`) is refused. `/launches`, `/launches?page=N` and `/companies/<slug>` are not named and fall under `Allow: /`. `/companies` itself is drawn from an Algolia index, and the page carries the search key in `AlgoliaOpts`; it was not used.

List the newest launches:

```
GET https://www.ycombinator.com/launches            (page 0)
GET https://www.ycombinator.com/launches?page=1
```

The response (content type `application/json`) is `{"hits":[...],"nbHits":3504,"page":0,"nbPages":50,"hitsPerPage":20}`. A hit has `id`, `title`, `tagline`, `slug`, `created_at`, `total_vote_count`, `search_path` and `company{id, model_type, model_id, name, url, slug, logo, tags[], batch, industry, search_path}`. Newest first: page 0 starts at `2026-11-13T23:00:00.702Z`. No founders in a hit. A launch page is `https://www.ycombinator.com/launches/<slug>`.

Founders come from the company page: `GET https://www.ycombinator.com/companies/<slug>` is HTML with a `data-page` attribute holding JSON. `props.company` has `name`, `slug`, `batch` (short form, `F26`), `batch_name` (`Fall 2026`), `one_liner`, `long_description`, `website`, `year_founded`, `team_size`, `location`, `linkedin_url`, `twitter_url`, `github_url`, `ycdc_status`, `tags`, `primary_group_partner` and `founders[]`. Each founder has `full_name`, `title`, `founder_bio`, `linkedin_url`, `twitter_url`, `avatar_thumb_url`, `has_email`, `user_id`. Read for Tire Swing: two founders, both with a LinkedIn address, one with an X address. Email addresses are not given.

The sitemap (`/sitemap.xml`, 92 addresses) has no company pages.

Terms, from the earlier note `open-web-hunting-grounds.md` (not re-read today): "In connection with your use of the Site you will not engage in or use any data mining, robots, scraping or similar data gathering or extraction methods."

## 500 Global

Directory: `https://500.co/portfolio` (the old `/companies` redirects there). The page calls first-party JSON with no key (seen in the browser's own requests):

```
GET https://500.co/api/startups     -> {"res":[2242 records],"status":...}   (2.4 MB)
GET https://500.co/api/programs     -> {"batches":[45 records]}
```

A startup record:

```json
{"id":9811,"oneLiner":"Continual Learning Models. ",
 "organization":{"id":8271,"name":"Miruvor AI Inc.","alternativeName":null,"businessName":"Miruvor AI Inc.",
   "companyUrl":"www.miruvor.ai","companyLinkedIn":"https://www.linkedin.com/company/miruvorai","imageUrl":"https://founder-hub-public.s3.amazonaws.com/...png",
   "positions":[{"person":{"firstName":"Arvind","lastName":"Anandakumar"}}],
   "countryOfOperation":{"name":"UNITED STATES"},"regionOfOperation":null},
 "businessModel":{"name":"B2B"},"stage":{"name":"Pre-Seed","onlyAdmin":false},
 "industries":[{"name":"AI/Machine Learning"}],"tenant":[{"slug":"global"}],
 "batches":[{"brandName":"SF 37"}],"investments":[{"initialInvestDate":"2026-06-25T00:00:00.000Z"}]}
```

Founders are named (`organization.positions[].person`): 2,183 of 2,242 records have at least one, many have two to four. No profile links for people. `companyUrl` is set on 2,178 records, `companyLinkedIn` on 660. The date is `investments[].initialInvestDate` (some are the placeholder `1970-01-01`). Newest by that date: `SF 37` (2026-06-25), `Eurasia 10` (2026-06-23), `MENA 11` (2026-06-18), `MENA 12` (2026-06-09). Nothing is dated after June 2026, so the list lags. Per year of first investment: 2023 176, 2024 107, 2025 108, 2026 45. `/api/programs` has `batchName`, `active`, `programName`, `type`, `stages`, `programRegion`, `applicationsDeadline`, `startDate` for 45 batches. There is no query parameter for date or batch; filter in code.

robots.txt, `https://500.co/robots.txt`, whole file: `Sitemap: https://strapi.500.co/api/sitemap/index.xml`. `strapi.500.co/robots.txt` has only commented lines. No rule. Verdict: readable.

Terms (`https://500.co/terms-of-use`): no sentence naming scraping, crawling, robots or data mining was found (searched those words and "automated", "harvest").

## a16z speedrun

Directory: `https://speedrun.a16z.com/companies`. Company page: `https://speedrun.a16z.com/companies/<slug>`. The list is in the page, in `<script id="__NEXT_DATA__">` at `props.pageProps.companies`:

```
GET https://speedrun.a16z.com/companies
-> pageProps.companies = {count:79, next:null, previous:null, results:[...]}
   pageProps.cohorts = [{name:"SR001"} ... {name:"SR007"}], pageProps.defaultCohort = "SR007"
```

A result has `id`, `slug`, `name`, `logo`, `cover_image`, `company_list_image`, `cohort`, `likes_enabled`, `preamble` (one line), `industries[]`, `team_size`, `city`, `state`, `country`, `region`, `show_last`, and `founder_set[]` with only `id` and `profile_pic` (no names). Only the default cohort, SR007 with 79 companies, comes in the page. `?cohort=SR006` returned the same 79 SR007 companies, so the filter is client side; the other six cohorts were not listed. The page names one other host, `speedrun-api.a16z.com`; its listing endpoint was not found and was not probed.

Founders: the company page's `__NEXT_DATA__` has `dehydratedState.queries[].state.data` with the company: `description`, `founded_year`, `website_url`, `github_url`, `x_url`, `linkedin_url`, `demo_day_video_url` and `founder_set[]` with `first_name`, `last_name`, `slug`, `title`, `introduction`, `linkedin_url`, `profile_pic`. Read for Abliteration.ai: two founders, titles "Co-Founder & CTO" and "Cofounder & CEO", both with LinkedIn.

robots.txt: `https://speedrun.a16z.com/robots.txt` returns 404, so no rule. Verdict: readable. `sitemap.xml` is also 404.

Terms (`/terms-of-use`): no sentence on scraping or crawling found. The nearest is a licence to a16z to use User Content "including through the use of automated or algorithmic tools".

## Founders, Inc.

Directory: `https://f.inc/portfolio`. Company page: `https://f.inc/portfolio/<slug>/`. The page is static HTML (Framer) with 615 portfolio links (some repeated) and sort buttons "Default" and "Newest" that work in the browser. The sitemap `https://f.inc/sitemap.xml` has 967 addresses, 205 of them under `/portfolio/`, with no `lastmod`. The list shows the name, tags (AI/ML, Hardware) and a one-line description, and a heading for "On Campus" and "The Garage".

The company page has FOUNDERS (name), FOUNDED (year), INDUSTRY, TEAM SIZE, COMPANY WEBSITE and a description. Read for Anara: founder Naveed Janmo, founded 2023, team size 6, LinkedIn `https://www.linkedin.com/in/naveedjanmo/`, X `https://x.com/naveedjanmo`.

robots.txt (`https://f.inc/robots.txt`):

```
# Founders, Inc. - we actively welcome search and AI crawlers.
User-agent: *
Allow: /
```

It then allows GPTBot, ChatGPT-User, ClaudeBot, Claude-Web, PerplexityBot and others by name. Verdict: readable.

Terms (`https://f.inc/terms`): "Except as expressly permitted, you agree not to copy, modify, distribute, scrape, frame, or create derivative works from the Site or Site Content."

## Entrepreneurs First

Directory: `https://www.joinef.com/portfolio/` (WordPress). The server returns the featured block and 48 company tiles. Each tile has `data-companyname`, `data-companyslug`, location and industry tags, a one-line description, founder names with titles (for example "CEO Aryan Shah, CTO Waris Reshi" for hug) and, on some tiles, a "Founded" year (hug: 2026). Filters are Location, Industry, Year (2014 to 2026) and Stage. `?pagenum=2` returned the same 48 tiles, so "Load more" uses a call that was not identified. 7 LinkedIn person links are in the page.

robots.txt, whole group: `Crawl-delay: 10` (above the group) then `User-agent: *` and `Disallow:` (empty). Verdict: readable, at one request per ten seconds. I did not find a terms page that stated a rule (`/terms-and-conditions/` is a 404).

## South Park Commons

Directory: `https://www.southparkcommons.com/companies`: 42 company links in HTML, each with a name, a status tag (Unicorn, Series A, Growth) and a one-line description. Company page `/companies/<slug>`: name, one line, "Infrastructure · 2019 · San Francisco", description, company links, "Founders" with names and titles, and LinkedIn links for each founder (Baseten: Tuhin Srivastava, Amir Haghighat, Phil Howes). No cohort or date field is in the list. robots.txt: `User-agent: *` / `Allow: /`. Verdict: readable.

## Berkeley SkyDeck

Directory: `https://skydeck.berkeley.edu/portfolio/` ("over 800+ Berkeley SkyDeck companies that have publicly launched"). The page fills its list from its own WordPress ajax call:

```
POST https://skydeck.berkeley.edu/wp-admin/admin-ajax.php
body: action=company_filtration_query&meta[0][]=main_industry&meta[0][]=all&meta[1][]=classes&meta[1][]=all&meta[2][]=industry&meta[2][]=all&search=
-> {"posts":[{"title":"1Page","url":"https://www.get1page.com/","class":"Batch 9"}, ...]}
```

360 records with `title`, `url`, `class`. Newest classes: Batch 21 (15), Batch 20 (19), Batch 19 (19). No founders, description or tags. robots.txt: `Disallow: /wp-admin/` followed by `Allow: /wp-admin/admin-ajax.php`. Verdict: readable.

## Alliance

`https://alliance.xyz/companies`: 187 company links, each with name, one-liner and category. The page's embedded state carries `"cohort":{"id":14,"class":7}` per company; classes run 1 to 18 (class 18 has 19 companies, class 14 has 17). Company page `/companies/<slug>`: name, location, tags, overview, links; no founders. robots.txt: `User-Agent: *`, `Allow: /`, `Disallow: /apply/`, `Disallow: /dd/`. Verdict: readable.

## ODF (On Deck)

`https://companies.joinodf.com/` (the page `joinodf.com/companies` points to it) embeds 104 companies. A record has `id`, `name`, `slug`, `description`, `website`, `logo`, `careerPage`, `isPublic`, `displayOrder`, `createdAt`, `updatedAt`, `locations[]`, `cohorts[{name:"ODF2"}]`, `categories[]`. Cohorts run ODF1 to ODF25 (ODF1 11, ODF2 9, ODF3 10). `createdAt` is the directory import date (2025-10), not a join date. No founders. The home page says "ODF28 kicks off in Q1 2027". robots.txt on `companies.joinodf.com`: `Allow: /`, `Disallow: /api/`, `Disallow: /admin/`, `Disallow: /edit/`. The main host's `/robots.txt` returned its home page, so it has no rule. Verdict: readable.

## Village Global, Betaworks, AI Grant

- Village Global: `https://www.villageglobal.com/portfolio` (the old `.vc` host redirects). Static HTML: sector, company, one line, "Founders" with names. No cohort or date. robots.txt has one `Sitemap:` line. Readable.
- Betaworks: `https://www.betaworks.com/companies` lists company names only; Camp cohorts are by theme at `/camp/<slug>` (for example `ai-camp-agent-systems`). robots.txt is empty. Readable.
- AI Grant: `https://aigrant.com/` lists "AI Grant companies — batch 4" (17: Goodfire, Silurian, Granola, Pulse AI, InspectMind AI, Hamming, Agency, Artificial Analysis, Pursuit, Graylark, Haize Labs, Sync, Rowan, Vapi, Juicebox, Supertrace AI, Inception Labs) and earlier batches, each with a one-liner and a link to the company site. "Applications for Batch 4 are closed." No founders. robots.txt is a 404. Readable.

## Techstars

Directory: `https://www.techstars.com/portfolio`. The server HTML shows only the 29-company unicorn registry. The searchable list is drawn in the browser: the page calls `GET https://www.techstars.com/api/search/config/companies`, which returns `{"url":"https://8gbms7c94riane0lp-1.a1.typesense.net","collection":"companies","apiKey":"..."}`, then posts a `multi_search` to that Typesense host with the key in the query string. This is a key delivered by the page, so it was not used and the list was not fetched by a program. What the page's own first response shows (read in the browser, not requested by me): 5,673 companies; fields `company_name`, `brief_description`, `website`, `city`, `state_province`, `country`, `worldregion`, `industry_vertical[]`, `program_names[]`, `program_slugs[]`, `first_session_year`, `is_current_session`, `is_1b`, `is_exit`, `linkedin_url`, `twitter_url`, `crunchbase_url`, `updated_at`; no founders. Companies by first session year: 2025 315, 2026 134, 2024 721, 2023 919.

robots.txt: `User-agent: *` / `Allow: /` and a sitemap. No AI line. The sitemap has no company pages (1,107 addresses: blog, newsroom, team, 26 accelerator pages). Verdict: readable, but the list needs the key.

Terms (`https://www.techstars.com/terms-of-use`): "Use any bot, spider, indexing agent, AI tool, site search/retrieval application or other manual or automatic device to retrieve, index, “scrape,” “data mine,” record, process, or otherwise gather any Content or information about other companies and/or users".

## Antler

Directory: `https://www.antler.co/portfolio` ("1,800+ companies"). The HTML holds only the featured companies (Lovable, Airalo and others) with a name, one line and a country tag; the full directory loads in the browser and was not listed. robots.txt:

```
User-agent: *
Crawl-delay: 10
Disallow: /portfolio/company/
Disallow: /portfolio/showcase/
Disallow: /new-portfolio-companies/
Disallow: /showcase-proxy
Disallow: /users
```

Verdict: readable in part. Company pages and the showcase are refused, so the list cannot be completed by reading them.

## Plug and Play

Directory: `https://www.plugandplaytechcenter.com/innovation-services/startups/our-startups`. The Angular page embeds (`ng-state`) the first 12 of 2,562 startups and the 37 unicorns. A record has `startupTitle`, `startupOneLiner`, `startupDescription`, `startupWebsite`, `startupCountry`, `startupLocation`, `startupMainIndustry`, `startupUnicorn`, `startupExit`, `startupAccelerated`, `startupPortfolio`, `startupBatchesList-search`, `mgnl:created`, `slug`. Company page: `/startup/<slug>`. No founders. robots.txt: `Allow: /`, `Disallow: /auth/`, `Disallow: /.rest/`, `Disallow: /.magnolia/`. Further pages come from the `/.rest/` delivery API, which is refused. Verdict: readable in part (12 per page load).

## Other programmes

- Neo: `https://neo.com/` is a Bubble app; the served HTML has no company or cohort text. robots.txt: `Disallow: /version-test/`. No directory found.
- Alchemist Accelerator: `https://www.alchemist.vc/portfolio` shows founder stories and milestones, not a company list (the `/companies` path is a 404). robots.txt refuses only preview and HubSpot paths. No directory.
- StartX: `https://startx.com/pages/companies` is a grid of logos linked to company sites, with no names or founders in the text. robots.txt: `Disallow: /admin`. Not usable for listing.
- NVIDIA Inception: `https://www.nvidia.com/en-us/startups/showcase/` shows curated stories (podcasts, blogs, videos), not a member list. robots.txt for `*` allows `/en-us/startups/` and refuses `/*page=*`. No directory.
- Conviction Embed: `https://embed.conviction.com/` says "Apply early to the 7th cohort of Embed" and names a few alumni in prose (Chai, Cognition, Listen Labs, Physical Intelligence, Pika Labs). No cohort list. No robots.txt (404).
- Sequoia Arc: `https://www.sequoiacap.com/arc/` is a 404; no cohort list found. robots.txt: `User-agent: *` / `Allow: /`.
- Z Fellows: `https://www.zfellows.com/` describes a one-week programme and mentors; no fellow list found. robots.txt: its Cloudflare block sets `Content-Signal: search=yes,ai-train=no,use=reference` and `Allow: /` for `*`, then refuses ClaudeBot, GPTBot, anthropic-ai and Claude-Web by name; a later `User-agent: *` group says `Disallow:`. A generic honest agent is allowed; an agent named as Claude is not.
- Thiel Fellowship: `https://thielfellowship.org/` has no fellows list on the home page; `/fellows` is a 404. No robots.txt (404).

## Not verified

- HF0: `https://hf0.com/robots.txt` returned HTTP 429 with a "Vercel Security Checkpoint" page. Not read; no challenge solved.
- PearX: `https://pear.vc/robots.txt` was readable (`Crawl-delay: 10`, `User-agent: *`, `Disallow:`) but `/companies/` and `/portfolio/` returned a Cloudflare "Attention Required" block (HTTP 403). Not read; nothing bypassed.
- Microsoft for Startups: `https://www.microsoft.com/robots.txt` returned HTTP 502; `foundershub.startups.microsoft.com` redirects to `portal.startups.microsoft.com`, a 3 KB sign-in page. No public directory found.
- Techstars list: the Typesense key was not used, so the list, its order and the newest cohort were not fetched by a program. The figures above are from the page's own first response in a browser.
- speedrun SR001 to SR006: the page's client call for other cohorts was not found.
- Entrepreneurs First: the "Load more" call was not identified; only the first 48 tiles were read. Ordering by year is not confirmed.
- Antler full directory: loaded by script from an address not identified; company pages are refused by robots.txt anyway.
- Y Combinator: whether `/launches` returns HTML to a browser and JSON to this client was not checked; the JSON was what `curl` received with `Accept` unset. `/companies` was not requested beyond the single page fetch that showed the key.
- Terms: sentences quoted for Techstars, Founders, Inc. and (from the earlier note) Y Combinator. 500 Global and a16z speedrun had no matching sentence. Entrepreneurs First, Antler and ODF terms pages were not found at the addresses tried. The rest were not read.
- Size of the newest cohort: stated only where the source shows it (YC, speedrun, SkyDeck, AI Grant, Alliance, ODF). 500 Global shows investment dates, not cohort sizes; Founders, Inc., South Park Commons, Village Global and Betaworks show none.
- The mirror's licence: none found in the repository; not checked beyond the GitHub API field and the root `LICENSE` path.

## Sources

All read on 2026-11-13. Saved copies are in the session scratch directory.

- `https://yc-oss.github.io/api/meta.json`, `/companies/all.json`, `/batches/fall-2026.json`, `/changes/latest.json`; `https://raw.githubusercontent.com/yc-oss/api/main/README.md`; `https://api.github.com/repos/yc-oss/api`
- `https://www.ycombinator.com/robots.txt`, `/launches`, `/launches?page=1`, `/companies/tire-swing`, `/companies`, `/sitemap.xml`
- `https://500.co/robots.txt`, `/api/startups`, `/api/programs`, `/terms-of-use`, `https://strapi.500.co/api/sitemap/index.xml`
- `https://speedrun.a16z.com/companies`, `/companies/abliteration`, `/companies?cohort=SR006`, `/terms-of-use`, `/robots.txt` (404)
- `https://f.inc/robots.txt`, `/portfolio`, `/portfolio/anara/`, `/sitemap.xml`, `/terms`
- `https://www.joinef.com/robots.txt`, `/portfolio/`, `/portfolio/?pagenum=2`
- `https://www.southparkcommons.com/robots.txt`, `/companies`, `/companies/baseten`
- `https://skydeck.berkeley.edu/robots.txt`, `/portfolio/`, `/wp-admin/admin-ajax.php`
- `https://alliance.xyz/robots.txt`, `/companies`, `/companies/pump`
- `https://companies.joinodf.com/`, `/robots.txt`; `https://joinodf.com/`
- `https://www.villageglobal.com/robots.txt`, `/portfolio`; `https://www.betaworks.com/robots.txt`, `/companies`; `https://aigrant.com/`
- `https://www.techstars.com/robots.txt`, `/portfolio`, `/sitemap.xml`, `/accelerators/anywhere`, `/api/search/config/companies`, `/terms-of-use`
- `https://www.antler.co/robots.txt`, `/portfolio`; `https://www.plugandplaytechcenter.com/robots.txt`, `/innovation-services/startups/our-startups`
- `https://neo.com/robots.txt`, `/`; `https://www.alchemist.vc/robots.txt`, `/portfolio`; `https://startx.com/robots.txt`, `/pages/companies`
- `https://www.nvidia.com/robots.txt`, `/en-us/startups/showcase/`, `/en-us/startups/showcase.md`
- `https://embed.conviction.com/`; `https://www.sequoiacap.com/robots.txt`; `https://www.zfellows.com/robots.txt`, `/`; `https://thielfellowship.org/`
- `https://hf0.com/robots.txt`, `https://pear.vc/robots.txt`, `/companies/`, `https://www.microsoft.com/robots.txt`, `https://portal.startups.microsoft.com/`
- `/Users/jwpark/Projects/agentswarm/docs/research/open-web-hunting-grounds.md`; `/Users/jwpark/Projects/agentswarm/packages/core/src/sources/past.ts` (`YC_DIRECTORY_URL`, `parseYcDirectory`)
