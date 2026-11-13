# Data sources and compliance for founder scouting

Research date: 2026-11-12. Not legal advice. Have counsel review every verdict and rule below before the system goes live.

## How to read this file

- **Method limit.** WebFetch was not available in this session, so I could not open pages. Every claim below comes from a WebSearch result snippet (the URL and the snippet text). Snippets are secondary, often third-party blogs, and in several cases contradict each other. Treat each claim as "reported by [URL], accessed 2026-11-12" until someone opens the primary page.
- **Primary-page check needed.** Each row in the "Unverified / unknown" list (end of file) names what must be opened before a decision.
- **Verdicts.** "Use freely" = official, documented API or open data with clear terms. "Use via licence" = commercial contract or paid vendor needed. "Avoid" = terms or case law make automated collection a high risk.

---

## Part 1: Data sources

### 1.1 Summary table

| Source | Access method | Cost (as reported) | Key restrictions | Verdict and reason |
|---|---|---|---|---|
| LinkedIn profiles | Partner-program APIs only; no general public profile API | Partner approval needed; no public price | Scraping banned by terms; partner APIs scoped to specific products; SNAP reported closed to new partners | **Avoid** scraping. Use via licence only if a partner approval is obtained, which is not realistic in the near term. |
| LinkedIn Sales Navigator API (SNAP) | Partner program | Requires active Sales Navigator seats for the integration customer | Reported "not currently accepting new partners" | **Avoid** as a plan. Not an option for a new company without a partner deal. |
| Licensed people-data vendors (PDL, Coresignal, Crustdata, Harmonic, Specter, Apollo, etc.) | Commercial API or dataset | PDL: per-match credits, third-party price range $0.28/credit (unverified) | Vendors' sourcing and compliance terms not checked | **Use via licence**, but only after reading each vendor's terms, sourcing statement and DPA. Several vendors describe data as cached. |
| GitHub REST and GraphQL | Official API, token auth | REST: 5,000 req/hr authenticated, 60/hr unauthenticated (search snippet of official docs) | Acceptable Use and API terms restrict some profile-data uses (not yet read) | **Use freely** for public repositories, within rate limits. Check terms before using profile email addresses. |
| GH Archive / BigQuery | Public dataset | Free dataset; BigQuery query charges apply | Not checked | **Use freely** after checking the GH Archive license (unverified). |
| Hacker News Firebase API | Official, no key | No cost. No official rate limit found | Unverified | **Use freely** for item and user reads, with throttling. |
| HN Search (Algolia) | Public REST search API | No cost reported | Unverified | **Use freely**, with throttling. Confirm the rate limit and terms. |
| arXiv API | Official API | Free | Unverified | **Use freely** (not checked in this session). |
| OpenAlex | Official API | Free | Key required from 13 Feb 2026 (forum post, unverified); polite pool via email in User-Agent (unverified) | **Use freely** with an API key. Confirm the current limits. |
| Semantic Scholar API | Official API with optional key | Free tier; key needed for higher limits | Limits reported inconsistently (1 RPS with key; 100 req/min or 100 per 5 min unauthenticated) | **Use freely**, with a key. Confirm the limits. |
| OpenReview | Official API | Not checked | Not checked | Unverified. |
| Product Hunt API | Official GraphQL API | Not checked | Not checked | Unverified. |
| Y Combinator directory | Public website | Not checked | Terms not checked | Unverified. Read the terms before any bulk collection. |
| X (Twitter) API | Official API, pay-per-use or legacy tiers | Pay-per-use reported at $0.005 per post read and $0.01 per user lookup (third-party blogs). Legacy Basic $200/mo, Pro $5,000/mo (reported) | Plan changes in 2026 reported; pricing conflicts across sources | **Use via licence**. Confirm current prices on docs.x.com. |
| YouTube Data API v3 | Official API, Google Cloud key | Default 10,000 units/day; captions.download 200 units; captions.list 50 units (official quota table, as reported) | captions.download requires edit permission on the video | **Use freely** for metadata within quota. Caption download is limited to videos the authenticated user can edit. |
| YouTube transcripts via third-party services | Third-party | Varies | Likely breaches YouTube terms. Not checked | **Avoid** unless terms are checked and cleared. |
| Podcast Index, Listen Notes | Official APIs | Not checked | Not checked | Unverified. |
| SEC EDGAR (incl. Form D) | data.sec.gov and EDGAR full text | Free | 10 requests/second total; User-Agent with contact must be declared (SEC access page, as reported) | **Use freely**. Declare a User-Agent. Form D-specific endpoint not confirmed. |
| USPTO PatentsView | Official API | Not checked | Not checked | Unverified. |
| Devpost and hackathon listings | Public web | Not checked | Terms not checked | Unverified. |
| Agent search and fetch APIs (Exa, Tavily, Brave, Firecrawl, Parallel) | Commercial APIs | Not checked in this session | Their terms govern how fetched content may be stored and reused | Unverified. Read each vendor's pricing and terms before choosing one. |

### 1.2 Notes by source

#### LinkedIn

- **Partner program gating.** Snippets state that LinkedIn data access runs through the LinkedIn Partner Program and that one 2026 guide says all LinkedIn API access has required partner status since 2015. Approval rate (about 1%) comes from a secondary source only. Source: https://www.getphyllo.com/post/linkedin-api-access-in-2026-partner-program-approval-timeline-alternatives (search snippet, accessed 2026-11-12; unverified).
- **Sales Navigator API.** Snippet reports LinkedIn's SNAP documentation saying it is "not currently accepting new partners," and that integrations require Sales Navigator seats and an approved app. Source: https://pipeline.zoominfo.com/sales/linkedin-sales-navigator-api and https://www.auditsocials.com/blog/linkedin-sales-navigator-api-compliance-2026-third-party-tool-restrictions-data-scraping-gdpr-b2b (search snippets, accessed 2026-11-12; both secondary, unverified).
- **Terms on scraping.** Snippets say LinkedIn's API terms forbid aggregating profile content and storing it beyond narrow limits, and bar using scraped content. Sources: https://www.unipile.com/linkedin-api-a-comprehensive-guide-to-integration/ and https://apiserpent.com/blog/official-linkedin-api-vs-scraping (search snippets; secondary, unverified against linkedin.com).
- **hiQ v. LinkedIn.** Snippets report the case ended in a stipulated consent judgment and permanent injunction, entered 8 December 2022 in the Northern District of California. hiQ agreed to stop scraping and to delete the code, data and algorithms it obtained from LinkedIn. Settlement terms are confidential. One outlet reports $500,000 (unverified). Snippets say a stipulation has no precedential value. Sources: https://natlawreview.com/article/linkedin-s-data-scraping-battle-hiq-labs-ends-proposed-judgment and https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/ (search snippets, accessed 2026-11-12). The Ninth Circuit's 2022 ruling on the CFAA question is reported as the main appellate authority. Its exact holding was not checked.
- **Proxycurl.** Snippets report LinkedIn sued Proxycurl in January 2025 over fake accounts and scraping of profiles, and that Proxycurl shut down in July 2025 rather than contest the case. Some low-quality sites give 2026 dates; the 2025 dates are corroborated by Bloomberg Law coverage (search snippet). Sources: https://www.startuphub.ai/ai-news/startup-news/2025/the-1-linkedin-scraping-startup-proxycurl-shuts-down and https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/ (search snippets, accessed 2026-11-12). Snippets also mention a similar LinkedIn suit against ProAPIs, with a reported December filing about early resolution (unverified).
- **Vendor status.** Shutdown of Proxycurl is confirmed by snippets (see above). Other vendors (Coresignal, Crustdata, Harmonic, Specter, Crunchbase, PitchBook, Dealroom, Apollo) were not checked for current status or sourcing statements.

#### Licensed people-data vendors

- **People Data Labs (PDL).** Official docs say one Person Enrichment credit equals one matched record returned. Enterprise plans start at 100,000 records per year. Source: https://docs.peopledatalabs.com/docs/pricing-detail (search snippet; accessed 2026-11-12). Third-party sources disagree on entry price and per-credit cost. Reviewers describe the data as cached and periodically refreshed. No PDL terms, sourcing statement or opt-out description was found. Compliance claims (SOC 2, GDPR and CCPA "yes") come from third-party comparison pages only.
- **Other vendors.** Not checked. Before any contract, obtain each vendor's sourcing statement, data-subject request process, and whether it will sign a DPA.

#### GitHub

- **Rate limits.** Official docs (as quoted in search snippets from docs.github.com) state 5,000 requests per hour for authenticated REST calls and 60 per hour unauthenticated. GITHUB_TOKEN gets 1,000 per hour per repository. Secondary limits: no more than 100 concurrent requests; no more than 80 content-creating requests per minute and 500 per hour. Source: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api (search snippet; accessed 2026-11-12). Search-endpoint limits were reported inconsistently; check the official page.
- **Terms on profile data.** Not checked. The GitHub Acceptable Use Policies and Privacy Statement govern use of email addresses and profile data. Read them before storing or contacting any GitHub user from scraped data.

#### Hacker News

- **Algolia HN Search** has public docs at https://hn.algolia.com/api (search snippet; accessed 2026-11-12). The snippet did not show a rate limit.
- **Firebase API.** One guide says HN publishes no formal rate limit but Firebase may throttle heavy polling (unverified, secondary).
- A wrapper project claims 10,000 requests per hour per IP. This is not from HN and is unverified.

#### Research APIs

- **OpenAlex.** A January 2026 post on the OpenAlex users forum says an API key will be required from 13 February 2026. Source: https://groups.google.com/g/openalex-users/c/rI1GIAySpVQ (search snippet; accessed 2026-11-12). Snippets from third-party guides give defaults of 100,000 requests per day and 10 requests per second in the polite pool. Confirm on docs.openalex.org.
- **Semantic Scholar.** Snippets disagree on limits: one CASRAI guide cites 1 RPS for an introductory key; other sources cite 100 requests per minute or per five minutes without a key. Source: https://casrai.org/guides/semantic-scholar-api (search snippet; accessed 2026-11-12; unverified).
- **arXiv, OpenReview, Product Hunt, Podcast Index, Listen Notes, PatentsView, Devpost:** no usable snippets were obtained. Marked unverified below.

#### X (Twitter) API

- Snippets say the fixed Basic and Pro tiers are closed to new sign-ups and that the default for new customers is pay-per-use, starting around 6 February 2026. Reported per-call prices: $0.005 per post read, $0.01 per user lookup or post creation. Legacy Basic $200/month, Pro $5,000/month. Migration dates for legacy plans conflict across sources (June 2026 and September 2026). Sources: https://www.wearefounders.uk/the-x-api-price-hike-a-blow-to-indie-hackers/ and https://www.postproxy.dev/blog/x-api-pricing-2026/ (search snippets; third-party; accessed 2026-11-12). Confirm on docs.x.com before budgeting.

#### YouTube

- Official quota reference (as quoted in search snippets from developers.google.com) lists captions.download at 200 units and captions.list at 50 units. Default project allowance is 10,000 units per day. Source: https://developers.google.com/youtube/v3/determine_quota_cost and https://developers.google.com/youtube/data/reference/rest/v3/captions/download (search snippets; accessed 2026-11-12).
- The official captions.download method requires the caller to have edit permission on the video. Snippet from the same reference page. This means it cannot fetch captions for other people's videos.
- Third-party transcript services: not checked. A third-party guide suggests they exist and are used to avoid quota; their terms are likely to conflict with YouTube's terms and were not reviewed. Verdict: avoid until reviewed.

#### SEC EDGAR

- SEC access page (search snippet from https://www.sec.gov/os/accessing-edgar-data; accessed 2026-11-12) reports a maximum request rate of 10 per second total across all machines for one requester, a requirement to declare a User-Agent with contact information, and temporary IP blocks for exceeding the rate. A 2021 SEC announcement says the cap applies in aggregate.
- Form D: no Form D-specific endpoint or rule was confirmed. Verify whether Form D data is in the data.sec.gov JSON or only in the full-text and index files.

#### Agent search and fetch APIs

- Not checked. Pricing and terms for Exa, Tavily, Brave Search API, Firecrawl and Parallel were not retrieved. Check whether each vendor allows storing fetched content, and whether its terms let you use the content for outreach.

---

## Part 2: AI voice calls, outreach, and compliance

### 2.1 Voice-call platforms and per-minute cost

Snippets from comparison blogs (accessed 2026-11-12) give ranges, not official prices. Verify each vendor's pricing page before deciding.

- **Vapi:** platform fee reported at $0.05 per minute; model costs pass through when you bring your own key. All-in estimates $0.10 to $0.30 per minute. Source: https://www.morphllm.com/comparisons/vapi-vs-retell-vs-bland-vs-synthflow and https://telnyx.com/resources/vapi-pricing (search snippets; secondary).
- **Retell:** advertised per-minute range $0.07 to $0.31; one article cites $0.115 per minute from Retell's estimator. Source: https://ainora.lt/blog/retell-ai-pricing-2026 (search snippet; secondary).
- **Bland:** reported at $0.09 per minute flat in one source and $0.14 all-in in another; telephony billed separately. Source: https://www.bland.ai/blog/voice-ai-pricing-enterprise and https://ringly.io/blog/bland-ai-pricing (search snippets; sources conflict).
- **Twilio Programmable Voice (US):** outbound to US and Canada most often cited at $0.0140 per minute (third-party guide). Recording $0.0025 per minute and storage $0.0005 per minute, and standard transcription $0.0500 per minute, per a Twilio pricing snippet. Batch transcription $0.024 and streaming $0.027 per minute (third-party). Rounding rules conflict across sources. Source: https://twilio.com/voice/pricing (search snippet, not fully opened) and https://support.twilio.com/hc/en-us/articles/223179868-How-Much-Will-My-Voice-Application-Cost-per-Minute (search snippet).
- **Not checked:** ElevenLabs agents, LiveKit Agents, Deepgram and OpenAI realtime models as the speech layer; compliance tooling in each platform.

### 2.2 US federal: TCPA and the AI-voice ruling

- **FCC Declaratory Ruling, 8 February 2024, CG Docket No. 23-362, FCC 24-17.** Holds that calls using AI-generated voices that simulate or clone a human voice, or that generate content using a prerecorded voice, are "artificial or prerecorded voice" calls under the TCPA. Such calls to wireless numbers need prior express consent (or prior express written consent for telemarketing), or an emergency purpose. Adopted unanimously and effective on release. Sources: https://huntonak.com/privacy-and-information-security-law/fcc-issues-declaratory-ruling-that-tcpa-applies-to-ai-generated-voice-calls and https://www.mayerbrown.com/en/insights/publications/2024/02/fcc-declares-authority-and-intent-to-regulate-ai-generated-calls-under-the-tcpa (search snippets, accessed 2026-11-12).
- **Press framing.** Some firms say the FCC press release overstated the ruling; the ruling does not ban AI voices outright. Source: search snippet from the same results.
- **Non-marketing B2B calls to a mobile number.** The TCPA's prior-express-consent rule for artificial or prerecorded voice applies to non-marketing calls to wireless numbers, not only telemarketing. Snippets say the consent form depends on whether the call is telemarketing or advertising. Consent-to-call for a founder who has not opted in should be treated as required. Confirm the exact consent standard for an informational, non-marketing call in the current 47 CFR 64.1200 text (not opened).
- **2025 and 2026 FCC rules on AI call disclosure or consent.** Not found in this session. Unverified.

### 2.3 US states

- **Two-party (all-party) consent for recording.** California Penal Code § 632 requires consent of all parties to a confidential communication (search snippet; primary statute not opened). Snippets list other all-party states as Florida, Illinois, Maryland, Massachusetts, Montana, New Hampshire, Pennsylvania, Washington, and in some lists Connecticut, Delaware, Nevada, Oregon. The lists disagree, especially on Oregon, Nevada and Delaware. Treat any of these as all-party until checked. Source: https://www.justia.com/documents/50-state-surveys-recording-calls-and-conversations.pdf (search result listing; accessed 2026-11-12, not opened).
- **Interstate calls.** Snippets state that the stricter rule generally applies and cite Kearney v. Salomon Smith Barney (Cal. 2006), in which the California Supreme Court applied the California rule to a call with a party in a one-party state (search snippet).
- **California SB 1001 (2018), Bus. & Prof. Code § 17940 et seq.** Makes it unlawful to use a bot to communicate with a person in California online, with intent to mislead about its artificial identity, to influence a commercial transaction or an election. Disclosure that the bot is a bot, clear and conspicuous, gives a safe harbor (§ 17941). Operative 1 July 2019. Sources: https://law.justia.com/codes/california/code-bpc/division-7/part-3/chapter-6/section-17940 and https://perkinscoie.com/insights/update/i-am-robot-californias-new-law-requires-disclosure-use-bots (search snippets; not opened). Snippets say it is enforced through the Unfair Competition Law. Snippets do not say whether it applies to voice calls; the statute refers to "online" communication, so application to phone calls is unverified.
- **Utah.** Utah AI Policy Act (effective 1 May 2024, as amended by SB 226 and SB 332 in 2025, per snippets) requires disclosure of generative AI use in consumer transactions when asked; a clear disclosure at the outset of the interaction gives a safe harbor. Business-to-business calls are not clearly covered. Sources: https://www.davispolk.com/insights/client-update/utah-scales-back-reach-generative-ai-consumer-protection-law and https://www.wiley.law/wiley-connect/Utah-Adopts-New-AI-Disclosure-Law-that-Goes-Into-Effect-on-May-1-2024 (search snippets; accessed 2026-11-12; not opened).
- **Colorado.** SB 24-205 (original Colorado AI Act) was repealed and replaced by SB 26-189, effective 1 January 2027 per snippets. A separate Chatbot Safety Act (HB 26-1263), signed 1 July 2026 per snippets, requires chatbot operators to disclose AI interaction, also effective 1 January 2027. Sources: https://www.mvalaw.com/data-points/colorados-ai-act-implementation-delayed and https://glacis-landing.pages.dev/guide-colorado-ai-act (search snippets; accessed 2026-11-12; secondary, not opened). Snippets disagree on some dates; verify the bill text.

### 2.4 EU and UK

- **EU AI Act Article 50 (transparency).** Snippets from law firms report that Article 50 obligations apply from 2 August 2026, including the duty to inform people they are interacting with an AI system unless obvious to a reasonably well-informed person. Article 50(2) machine-readable marking reportedly has a transition to 2 December 2026 for systems already on the market (one source; verify). Commission guidelines reportedly published 20 July 2026 (non-binding). Fines up to EUR 15 million or 3% of worldwide turnover for transparency breaches (secondary). Sources: https://cooley.com/news/insight/2026/2026-08-03-eu-ai-act-transparency-obligations-take-effect-2-august-2026 and https://www.mccannfitzgerald.com/knowledge/data-privacy-and-cyber-risk/ai-transparency-european-commissions-guidelines-on-article-50-part-1-provider-obligations (search snippets; accessed 2026-11-12; not opened). The regulation text was not checked.
- **GDPR Article 14 (notice when data is not collected from the person).** Article 14 requires the controller to notify the person when collecting personal data from a third party. The exception in Article 14(5)(b) (disproportionate effort) is narrow. EDPB draft Guidelines 03/2026 on web scraping (adopted 7 July 2026 for consultation, per snippets) say the exception is reserved for limited purposes, requires a balancing test, and is unlikely to apply to targeted collection of identifiable individuals, where direct notice is expected. The Polish DPA is reported to have rejected publishing notice on a website as sufficient. Sources: https://www.reedsmith.com/our-insights/blogs/technology-law-dispatch/102nbqu/edpb-web-scraping-guidelines-for-ai-making-the-impossible-possible/ and https://datamatters.sidley.com/2026/07/23/what-do-the-european-data-protection-boards-web-scraping-guidelines-mean-for-ai-training-datasets/ (search snippets; accessed 2026-11-12; the guidelines are draft and were about AI training, but their Article 14 reasoning applies by analogy).
- **Legitimate interest for professional profiling.** Not checked in this session.
- **UK.** The ICO expects a documented assessment from any scraper relying on Article 14(5)(b). Source: search snippet from the same EDPB results; not opened.

### 2.5 US privacy: CCPA / CPRA

- Not checked. Known background (not verified in this session): CPRA's exemption for business-contact information in B2B contexts expired on 1 January 2023, so professional data is generally in scope. Verify against Cal. Civ. Code § 1798.140 before relying on it.

### 2.6 FCRA: investor due diligence

- **Permissible purpose.** Snippets from a privacy-compliance reference say 15 U.S.C. § 1681b lists "potential investor" for a valuation assessment as a permissible purpose. The statute was not opened. Source: search snippet from the FCRA results (accessed 2026-11-12; secondary).
- **Narrow use.** FCRA § 604(f) (as quoted in a snippet about FTC enforcement) bars using a consumer report for purposes other than those listed.
- **Founder background checks through a consumer reporting agency** are likely to produce a consumer report. Snippets say the FTC's 2023 TruthFinder and Instant Checkmate action concerned impermissible purpose and consumer-facing sites, not investor diligence.
- **Vendor terms.** People-data vendors' FCRA-related terms were not checked. Most PDL-type APIs are not consumer-report products; confirm in writing.
- **Practical rule.** Do not run criminal, credit or background checks through the system. Counsel must confirm any check.

### 2.7 Reference checks and backchannel calls

- Not researched in this session. Known risks to verify: consent-based reference-check products disclose the request to the candidate and obtain consent before contacting the reference; unsolicited backchannel calls raise defamation and privacy exposure, particularly if the caller records or passes on opinions. Unverified: no sources were retrieved.

---

## Rules the system must enforce

These follow from the findings above. Each item needs counsel review.

1. Do not scrape LinkedIn profiles or use vendors whose data comes from scraping LinkedIn. Use only licensed data with a written sourcing statement.
2. Log the source and access date for every founder record.
3. Respect the GitHub, arXiv, OpenAlex, Semantic Scholar, SEC and HN rate limits and User-Agent rules in code, not in prose.
4. Do not transcribe YouTube videos through third-party services until the terms are checked.
5. Disclose at the start of every AI call that the caller is an AI system, and give a human-contact option.
6. Do not place an outbound AI voice call to a mobile number without documented prior express consent, unless counsel confirms a non-marketing exemption.
7. Do not record a call without consent from every party, and treat all listed all-party states (and any caller or callee in them) as requiring consent. Play a recording notice.
8. Give Article 14 notice to EU/UK founders and references within a reasonable time after collection, unless counsel documents a disproportionate-effort assessment.
9. Keep a human approval step before any outreach, and log who approved it.
10. Do not run FCRA-covered checks. Do not use consumer reports for the investor-diligence workflow without counsel sign-off.
11. Honour opt-outs and deletion requests across all stores, including vendor caches.
12. Keep backchannel reference calls out of scope until counsel reviews defamation and privacy risk.

---

## Unverified / unknown

Each item needs a primary page opened before it is used in a decision.

1. Every verdict in Part 1 depends on search snippets, not opened pages.
2. LinkedIn: current User Agreement, API Terms of Use, SNAP page, and any 2026 changes. Snippets conflict on whether SNAP is paused.
3. Whether the hiQ Ninth Circuit 2022 ruling and the Proxycurl and ProAPIs outcomes are as described. The hiQ settlement amount ($500,000) is unverified.
4. Current status of Coresignal, Crustdata, Harmonic, Specter, Crunchbase API, PitchBook, Dealroom, Apollo, and any notable newcomer, including any shutdowns. Not checked.
5. PDL's sourcing statement, terms, DPA, and opt-out process. Prices conflict across sources.
6. GitHub Acceptable Use Policies and Privacy Statement as they apply to profile email addresses.
7. GitHub search-endpoint rate limits (sources conflict).
8. GH Archive and BigQuery terms and costs.
9. Hacker News rate limits (none found) and Algolia terms.
10. arXiv, OpenReview, Product Hunt, Y Combinator directory terms, Podcast Index, Listen Notes, USPTO PatentsView, and Devpost terms. No usable snippets.
11. OpenAlex current key and rate-limit rules. Semantic Scholar limits (sources conflict).
12. X API current plans, prices, and migration dates (sources conflict; docs.x.com not opened).
13. YouTube quota numbers beyond the captions endpoints; whether auto-generated captions are accessible through the API (sources conflict).
14. Form D data availability through data.sec.gov.
15. Pricing and terms for Exa, Tavily, Brave Search API, Firecrawl, and Parallel.
16. Vapi, Retell, Bland, ElevenLabs agents, and LiveKit Agents: current prices and compliance tooling. Snippets conflict.
17. Twilio: official current US outbound rate, recording and transcription prices, and billing rounding rule (sources conflict).
18. FCC rules adopted in 2025 or 2026 on AI call disclosure or consent. Not found.
19. The exact consent standard for non-marketing AI-voice calls to mobile numbers under 47 CFR 64.1200 (not opened).
20. Current all-party consent state list (sources disagree on Oregon, Nevada, Delaware and others), and Kearney's holding as applied.
21. California SB 1001: whether it applies to voice calls, and whether it has been amended since 2019.
22. California and other newer AI disclosure laws (not checked beyond Utah and Colorado).
23. Utah's current scope after SB 332 (sources conflict; statute not opened).
24. Colorado SB 26-189 and HB 26-1263 dates and text (sources conflict).
25. EU AI Act Article 50 text, the 2 December 2026 marking transition date (single source), and the 20 July 2026 guidelines. Regulation text not checked.
26. EDPB Guidelines 03/2026 final version (draft as of this research).
27. Legitimate-interest basis for professional profiling under GDPR. Not checked.
28. UK ICO guidance on scraping. Not checked.
29. CCPA/CPRA treatment of B2B and professional contact data. Background belief only; not verified.
30. FCRA: 15 U.S.C. § 1681b permissible purposes, including investor valuation language. Not opened.
31. Reference-check products (consent, disclosure) and backchannel defamation and privacy risk. No sources retrieved.
32. Whether any of the vendors above has a documented sourcing audit or certification.
