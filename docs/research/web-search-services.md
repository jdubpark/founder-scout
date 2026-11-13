# Web search services for the hunt

Use **Linkup**. It is the only service read here whose terms both name AI agents as authorized users and say that results may be reproduced, extracted and retained (for text and data mining only), and it costs $5 per 1,000 searches with a from and to date filter. Tavily is the fallback: its terms are silent on storing and its own SDK can write results to the customer's database, but its acceptable use policy of 2026-10-21 limits person-level use, and a founder search has to be checked against that. Brave and Kagi forbid storing results. You.com, Parallel and Exa restrict it.

## Comparison

Read on 2026-11-13. Prices are for the cheapest call that returns URL, title and, where the service has one, a snippet. "Silent" means the pages named in the service's section were read and no sentence on the point was found.

| Service | May results be stored? | Price per 1,000 basic searches | Date filter | Notes |
|---|---|---|---|---|
| Exa | No, unless Exa permits it in writing [1] | $4 (`lite`), $7 (`auto`), up to 10 results | Yes | 10 queries per second. Queries train Exa's models. Docs target people and company search. |
| Tavily | Silent in the terms. Docs show it [2] | $8 pay as you go, $5 to $7.50 on monthly plans | Yes | 1,000 requests per minute. Terms name agents. Policy limits person-level use. |
| Perplexity Search API | Silent. Customer does not own results [3] | $5, or $1 with `search_type: "fast"` | Yes | 50 query units per second. No personal data in queries without written consent. |
| Brave Search API | No [4] | $5 | Yes | 50 queries per second. Storage rights need a custom plan. |
| You.com | No for "significant portions" without a contract [5] | $5 | Yes | 10 requests per second. No profiles of individuals from outputs. |
| Linkup | Yes, for text and data mining [6] | $5 (`flash`, `fast`, `standard`), $50 (`deep`) | Yes | 10 queries per second. Terms name AI agents. May train on prompts unless zero data retention is arranged. |
| Parallel | Restricted [7] | $1 (`turbo`, `fast`), $5 (`basic`, `advanced`), 10 results | Start date only | 600 requests per minute. May train on inputs and outputs. |
| Jina (s.jina.ai) | Yes: "no restrictions" on Output [8] | Not confirmed. Billed in tokens | No | 100 requests per minute. A `provider` parameter names `google` and `bing`. Terms predate the Elastic acquisition. |
| Kagi Search API | No [9] | $12 | Yes | Rate limit not published. |
| Anthropic web search tool | Docs silent. Customer "owns its Outputs" [10] | $10 plus tokens | No | Returns URL and title, no plain snippet. A model writes the query. |
| OpenAI web search tool | Docs silent. Terms not read [11] | $10 plus tokens | No | Returns URL and title through citations and sources. A model writes the query. |

Table notes. Every quoted sentence is copied from the page named, which was read on 2026-11-13.

1. Exa Terms of Service, section 4.2(a), in the list that opens "You may not do, and may not permit any of your Authorized Users to do, any of the following in connection with your use of the Services, unless applicable laws or regulations prohibit these restrictions or you have our written permission to do so:": "download, modify, copy, distribute, transmit, display, perform, reproduce, duplicate, publish, license, create derivative works from, or offer for sale any information contained on, or obtained from or through, the Services, except for temporary files that are automatically cached by your web browser for display purposes, or as otherwise expressly permitted in these Terms or by us in writing;" https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf
2. Tavily Platform Terms of Service, section 1.7: "“Services” does not include Output." The use restrictions in section 3.2 are written about "the Services". No sentence limits keeping Output. Tavily SDK reference, heading "Adding retrieved data to the database": "If you want to add the retrieved data to the database, you can do so by setting the save_foreign parameter to True" https://www.tavily.com/terms and https://docs.tavily.com/sdk/python/reference
3. Perplexity Search Addendum, Schedule 1: "Customer does not own, and Perplexity shall not grant it ownership of, the Search API’s Output." https://www.perplexity.ai/hub/legal/perplexity-api-terms-of-service-search
4. Brave Search API Terms of Service, "Use Restrictions" (cited in the Terms as section 3(b)): "(i) store, cache, or create a database of Search Results, in whole or in part, other than transient storage required for operation of Customer Applications or related software, service or systems;" https://api-dashboard.search.brave.com/terms-of-service
5. You.com Acceptable Use Policy: API Search & Router Services, section 9: "Do not copy or store for re-use significant portions of Search Content without contractual authorization." https://you.com/aup
6. Linkup Client General Terms and Conditions, article 4.1: "Particularly, Client shall (i) check that the Open Web Content is lawfully accessible; (ii) limit its use of such content to reproduction and extraction for the sole purpose of text and data mining, ie. automated analytical technique aimed at analysing text and data in digital form in order to generate information which includes but is not limited to patterns, trends and correlations; and (iii) retain Open Web Content for as long as is necessary for the purposes of text and data mining only." https://www.linkup.so/terms-of-use
7. Parallel Customer Terms, section 2(c): "(vi) use the Services or any Customer Output to (A) create synthetic training data to develop or train a language model or any other machine learning model, or (B) create databases, data brokerage, data selling/reselling businesses, or related products or services, whether competitive with the Services or not (all of the foregoing collectively, the “AI and Data Selling Services”), or (C) otherwise for any competitive purposes;" and "(xi) intentionally or knowingly diverge requests of Authorized Users away from the Services (such as by making available Customer Outputs from previous queries for future uses, or incorporating Customer Outputs into an AI and Data Selling Services);" https://parallel.ai/customer-terms
8. Jina AI Terms and Conditions, section 4.3: "Jina AI (except as expressly stated otherwise herein) claims no rights to such Output and imposes no restrictions on the Customer regarding the use of the Output unless otherwise agreed in an agreement with the Customer." https://jina.ai/legal
9. Kagi API Terms of Service, under "What you may not do": "Store, cache, or build a database of Results beyond the transient caching needed to operate your application. You may not create a persistent copy of, or a derivative index from, the Kagi search index or other Results, and you may not bulk download, scrape, or archive Results." https://kagi.com/privacy/api
10. Anthropic Commercial Terms of Service, section B: "Anthropic agrees that Customer (a) retains all rights to its Inputs, and (b) owns its Outputs." The web search tool page says nothing about keeping URLs or titles. https://www.anthropic.com/legal/commercial-terms
11. OpenAI's web search guide, pricing page and data controls page say nothing about keeping URLs or titles. The Services Agreement and Service Terms on openai.com returned HTTP 403 with a JavaScript challenge and were not read.

How this was read. Each page was fetched with `curl -sL -A "Mozilla/5.0"` on 2026-11-13 and saved. Every quotation in this note was copied by a script from the saved raw text (HTML tags stripped, PDF text extracted with `pdftotext`), and the script fails if the words are not on the page. Prices, limits and document dates stated here were checked the same way. No account was created and no API was called, so every call shape below is from the vendor's reference, not from a live response. This is a reading of published terms, not legal advice.

## Exa

Pages read: Terms of Service PDF https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf (the "Terms" link in the exa.ai footer; https://exa.ai/terms-of-service redirects to it). Privacy Policy https://exa.ai/privacy-policy ("Last updated: June 29, 2026"). Pricing https://exa.ai/docs/admin/pricing.md and https://exa.ai/pricing. Billing and rate limits https://exa.ai/docs/admin/billing.md. Zero data retention https://exa.ai/docs/admin/security/zero-data-retention.md. Search reference https://exa.ai/docs/reference/search.md. Content policy https://exa.ai/docs/reference/content-policy.

The PDF prints no revision date. Its file metadata gives a creation date of 2025-03-04. It still holds an unfilled placeholder: section 5.4 points to a data processing agreement "available at [LINK]".

Storing and reuse:

- Section 1.1: "Subject to these Terms, we hereby grant you and your Authorized Users a non-exclusive, non-transferable, non-sublicensable, worldwide, revocable right and license to use our APIs for the limited purposes set forth in the documentation for the Services."
- Section 4.2, opening: "You may not do, and may not permit any of your Authorized Users to do, any of the following in connection with your use of the Services, unless applicable laws or regulations prohibit these restrictions or you have our written permission to do so:"
- Section 4.2(a): "download, modify, copy, distribute, transmit, display, perform, reproduce, duplicate, publish, license, create derivative works from, or offer for sale any information contained on, or obtained from or through, the Services, except for temporary files that are automatically cached by your web browser for display purposes, or as otherwise expressly permitted in these Terms or by us in writing;"
- Section 4.2(f): "access, use or exploit the Services (including Output) to develop any competitive product or service;"

Reading: 4.2(a) bars downloading or copying information obtained through the Services unless the Terms or Exa in writing allow it. No clause in the Terms allows keeping results. The docs do describe products that hand results to the customer's own systems: the docs index lists a Monitors API that sends new results to a webhook (https://exa.ai/docs/llms.txt). That is not a written permission. Treat storing as not allowed until Exa says so in writing, or in an Enterprise agreement.

Automated agents:

- Section 4.2(j): "use any robot, spider, crawlers, scraper, or other automatic device, process, software or queries that intercepts, “mines,” scrapes, extracts, or otherwise accesses the Services to monitor, extract, copy or collect information or data from or through the Services, or engage in any manual process to do the same;"

Read literally this covers any program that collects data through the Services. The docs describe the product as a search tool for agents, so the clause is probably aimed at scraping outside the API. The Terms do not say so.

Queries and retention:

- Section 1.2(c): "You grant us a nonexclusive, royalty-free, transferable, sub-licensable, worldwide, perpetual and irrevocable license to access, use, host, cache, store, reproduce, transmit, display, publish, distribute, and modify any User Input and Output as needed to provide, develop and improve upon our products and services, including the Services"
- Privacy Policy, "Query Data": "Query Data is used to improve our products and technology, including by training and fine-tuning models that power our Services"
- Zero data retention page: "Zero Data Retention (ZDR) is available on Enterprise plans and enabled per team." The upgrade costs $12,000 per year, paid upfront, and includes $12,000 of credits and 25 queries per second.
- Content policy: "If your product sends requests on behalf of your users, use an opaque `userIdentifier` that does not contain personal information such as an email address or name."

Price (https://exa.ai/docs/admin/pricing.md): `/search` with `type: "lite"` is $4 per 1,000 requests. `auto` (the default) is $7 per 1,000. Both include up to 10 results. Each result above 10 costs $1 per 1,000 results. Text and highlights are included. Summaries written by Exa cost $1 per 1,000 pages. The free tier gives $10 of credits each month.

Rate limit (https://exa.ai/docs/admin/billing.md): `/search` is 10 queries per second on the free and pay-as-you-go plans, for the team as a whole. Adding $1,000 of credits within 30 days raises it to 25 for 90 days. Over the limit returns `429`. Out of credits returns `402`.

Call (https://exa.ai/docs/reference/search.md):

```
POST https://api.exa.ai/search
x-api-key: <key>                 (or Authorization: Bearer <key>)
Content-Type: application/json

{
  "query": "seed stage robotics founder interview",
  "type": "lite",
  "numResults": 10,
  "startPublishedDate": "2026-10-01T00:00:00.000Z",
  "endPublishedDate": "2026-11-13T00:00:00.000Z",
  "contents": { "highlights": true }
}
```

- `query` is required. `numResults` is 1 to 100, default 10. Dates are ISO 8601.
- `type` defaults to `auto`. `lite` accepts only a short list of fields. That list includes `numResults`, the two date fields, `includeDomains`, `excludeDomains`, `category`, `contents.highlights` and `contents.text`.
- `category` can be `company`, `people`, `news`, `publication`, `personal site` or `financial report`. `company` and `people` do not support the date fields.
- Response: `requestId`, `costDollars`, `results[]`. Each result has `url`, `title`, `publishedDate` (ISO 8601, an estimate), `author`, `id`, and `highlights[]` (the snippet) or `text` when asked for.

## Tavily

Pages read: Platform Terms of Service https://www.tavily.com/terms ("Last updated: May 4, 2026"). Acceptable Use Policy https://www.tavily.com/acceptable-use-policy ("Last updated: October 21, 2026"). Privacy Policy https://www.tavily.com/privacy ("Last updated: November 24, 2025"). Credits and pricing https://docs.tavily.com/documentation/api-credits.md. Rate limits https://docs.tavily.com/documentation/rate-limits.md. Search reference https://docs.tavily.com/documentation/api-reference/endpoint/search.md. FAQ https://docs.tavily.com/faq/faq.md. Full docs text https://docs.tavily.com/llms-full.txt.

The terms page has run-together words in its own source, for example "PlatformTerms of Service". Quotes below are as the page has them.

Storing and reuse:

- Section 1.6: "“Output” means the outputs or results delivered or made available to Customer through the Services, resulting from Customer Input’s processing via the Services, including the generated text, information, links or other materials included therein."
- Section 1.7, closing words: "“Services” does not include Output."
- Section 2: "Tavily hereby grants Customer a non-exclusive, revocable (in accordance with the terms of this Agreement), non-transferable, and non-sublicensable right, during the Term, to install, access, and use the Tavily APIs and to remotely access and use the Services, including integration of the Services with Customer Applications via the Tavily API, solely for Customer’s internal business purposes and in accordance with the Services’ documentation."
- Acceptable Use Policy, section 2: "to access, use, scrape, extract, harvest, or index the Services (including any data or content made available through the Services) by automated means, except as expressly permitted by the Services or in writing by Tavily;"
- SDK reference, heading "Adding retrieved data to the database" (https://docs.tavily.com/sdk/python/reference): "If you want to add the retrieved data to the database, you can do so by setting the save_foreign parameter to True"

Reading: the Terms have no sentence about keeping Output. Their restrictions are written about the Services, and Output is defined as outside the Services. Tavily's own SDK has an option that saves web results into the customer's database. The policy sentence above bars indexing content from the Services by automated means unless the Services permit it. The API and SDK are such permitted means. A written confirmation from Tavily would close the gap.

Automated agents:

- Terms, preamble: "Tavily may make available to Customer an Agent Key that enables automated interaction between Customer’s agents and the Services without requiring separate registration or the creation of an Account (as defined below)"
- Section 3.2: "(viii) use any data mining, robots, or similar data gathering or extraction methods through the Services (provided, that reasonable use of Tavily APIs in accordance with this Agreement will not constitute a violation of this subsection);"
- Section 3.2: "(xvi) use the Services or the Output to make automated decisions without human oversight that have a significant adverse impact on individual rights in high-risk areas such as employment, healthcare, finance, legal, housing, insurance or social benefits;"

Person-level limits. These matter for a founder search:

- Policy, section 2: "In addition, where the Services or Outputs contain information relating to an identified or identifiable individual, you must not use (or allow any third party to use) the Services or Outputs:"
- First item under it: "to make or materially support decisions concerning an individual’s eligibility, selection, access, or terms in connection with employment, housing, credit, insurance, education, healthcare, public benefits, or other similarly significant opportunities or services;"
- Another item: "to create, sell, license, or otherwise make available person-level profiles as a standalone data product or for resale, unless expressly permitted under the applicable Agreement and applicable law;"
- Policy, section 5: "Customer must not rely solely on an Output to make a decision that produces legal or similarly significant effects concerning an individual."
- Policy, section 6: "where Tavily reasonably suspects that Customer is using the Services or Outputs for person-level profiling, high-impact decision-making, bulk person-level collection, resale, or another use restricted under this AUP, Tavily may require Customer to provide reasonable information regarding"

The hunt keeps a person in the decision, which answers the "rely solely" sentence. Whether an investment decision is one of the "similarly significant opportunities" is a question for counsel.

Queries and retention:

- Terms, section 6.5: "Tavily and its third-party artificial intelligence service providers may use, process, analyze, and retain Customer Input submitted to the AI Functionality and Outputs generated by the AI Functionality for purposes of training, improving, developing, and enhancing artificial intelligence models, machine learning systems, and related technologies including Tavily’s services."
- Terms, section 6.7: "certain Third-Party Service Providers may not be required to maintain the confidentiality of any Customer Input or Output and may retain certain rights to use or disclose Customer Input and Output, including to further train their algorithmic models."
- Privacy Policy: "unless otherwise specified under the contract between you and us, we may use certain portions of your query data to improve our responses to future queries."
- The docs FAQ lists this as a product benefit: "SOC 2 certified, zero data retention, and built to handle high-volume workloads." That does not fit sections 6.5 and 6.7. The two were not reconciled.

Price (https://docs.tavily.com/documentation/api-credits.md): a `basic` search costs 1 credit. Pay as you go is $0.008 per credit, so $8 per 1,000. Monthly plans run from Project (4,000 credits for $30, $7.50 per 1,000) to Growth (100,000 credits for $500, $5 per 1,000). The free plan gives 1,000 credits a month. An `advanced` search costs 2 credits.

Rate limit (https://docs.tavily.com/documentation/rate-limits.md): 1,000 requests per minute with pay as you go enabled or on the Project plan. 100 on the free plan. Over the limit returns `429`, sometimes with `Retry-After`.

Call (https://docs.tavily.com/documentation/api-reference/endpoint/search.md):

```
POST https://api.tavily.com/search
Authorization: Bearer tvly-<key>
Content-Type: application/json

{
  "query": "seed stage robotics founder interview",
  "search_depth": "basic",
  "max_results": 10,
  "start_date": "2026-10-01",
  "end_date": "2026-11-13",
  "include_published_date": true
}
```

- `max_results` is 0 to 20, default 10. Dates are `YYYY-MM-DD`. `time_range` takes `day`, `week`, `month` or `year` instead.
- `include_published_date` is marked beta. Results with no detectable date are kept unless `filter_by_published_date` is true.
- Response: `query`, `results[]`, `response_time`, `usage.credits`, `request_id`. Each result has `url`, `title`, `content` (the snippet), `score`, `published_date` (only when asked for, or with `topic: "news"`), `favicon`, `id`.

## Perplexity Search API

Pages read: Search Addendum https://www.perplexity.ai/hub/legal/perplexity-api-terms-of-service-search ("Last updated: September 22, 2025"). API Terms of Service https://www.perplexity.ai/hub/legal/perplexity-api-terms-of-service ("Last updated: January 23, 2026"). Acceptable Use Policy https://www.perplexity.ai/hub/legal/aup ("Last updated: July 8th, 2025"). Pricing https://docs.perplexity.ai/docs/getting-started/pricing.md. Rate limits https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers.md. Search reference https://docs.perplexity.ai/api-reference/search-post.md. Privacy and security https://docs.perplexity.ai/docs/resources/privacy-security.md.

Storing and reuse:

- Addendum, Schedule 1, on `/search`: "An API endpoint that retrieves and returns search results (e.g., snippets, URLs, page titles and associated metadata) from an index of public content."
- Addendum, Schedule 1: "Customer does not own, and Perplexity shall not grant it ownership of, the Search API’s Output."
- API Terms, section 2.1: "(ii) use the Services and the API Keys solely to submit Input (as defined in Section 2.3 below) to the Service, receive Output (as defined in Section 2.3 below) from the Service, and display such Output, in each case, solely within the Customer Applications in accordance with the API Documentation"
- API Terms, section 2.3.1, which the Addendum overrides for search: "Customer (i) retains all ownership rights in Input and (ii) owns all Output."

Reading: no sentence speaks of storing or caching. The licence is to receive Output and display it inside the customer's application, and the customer does not own search Output. Silent, and not a clear yes.

Automated agents and people:

- Addendum, section 2.3: "Customer shall not submit Personal Data (as defined in the DPA) to the Search Services unless explicitly authorized by Perplexity in writing (for clarity, excluding authorizations already included in the Agreement)." A query that names a person is very likely personal data. If so, name queries are blocked until Perplexity agrees in writing. The definition in the data processing addendum was not read.
- Acceptable Use Policy: "Make automated decisions about individuals that materially impact them (e.g., decisions regarding their employment, healthcare, finances, housing or insurance)"
- The policy also lists "unauthorized collections of personal data" among things the Services may not be used to create.

Queries and retention:

- Addendum, section 2.2: "Perplexity may retain, copy, distribute and otherwise use Search Data for its lawful business purposes, including the improvement and development of products and services."
- Addendum, section 1.2.2: "except for obligations expressly set out in this Addendum, any Perplexity obligations in the Agreement applicable to its other products and services (e.g., update, upgrade and/or zero data retention obligations) do not apply to the Search Services."
- API Terms, section 2.3.3: "Perplexity shall not use (or authorize third parties to use) Customer Content to train, retrain, fine-tune or otherwise improve any generative artificial intelligence models."
- Docs: "Under the API Terms of Service, Perplexity does not use Customer Content to train generative AI models. Certain APIs may be subject to product-specific terms." and "ZDR is available only to eligible customers through an account-level configuration under a written agreement with Perplexity."

Price (https://docs.perplexity.ai/docs/getting-started/pricing.md): $5.00 per 1,000 successful requests. $1.00 per 1,000 with `search_type: "fast"`. One request may carry up to five queries and is billed once.

Rate limit (https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers.md): 50 query units per second on every tier. Each query in a request uses one unit.

Call (https://docs.perplexity.ai/api-reference/search-post.md):

```
POST https://api.perplexity.ai/search
Authorization: Bearer <key>
Content-Type: application/json

{
  "query": "seed stage robotics startup launch",
  "max_results": 10,
  "search_after_date_filter": "10/01/2026",
  "search_before_date_filter": "11/13/2026"
}
```

- `query` is a string or an array of strings. `max_results` is 1 to 20, default 10.
- Dates are `MM/DD/YYYY`. `search_recency_filter` takes `hour`, `day`, `week`, `month` or `year`. `last_updated_after_filter` and `last_updated_before_filter` filter on update date. `search_domain_filter` takes up to 20 domains.
- Response: `id`, `results[]`. Each result has `title`, `url`, `snippet`, `date` (`YYYY-MM-DD` or null) and `last_updated`.

## Brave Search API

Pages read: Terms of Service https://api-dashboard.search.brave.com/terms-of-service ("Last updated: 1 Sep, 2026"). Product and pricing page https://brave.com/search/api/. Privacy notice https://api-dashboard.search.brave.com/documentation/resources/privacy-notice/index.html.md ("Updated 3 November 2026"). Rate limiting https://api-dashboard.search.brave.com/documentation/guides/rate-limiting/index.html.md. Web search guide https://api-dashboard.search.brave.com/documentation/services/web-search/index.html.md. Web search reference https://api-dashboard.search.brave.com/api-reference/web/search/get/index.html.md.

Storing and reuse:

- Terms, "License": the customer may "(ii) use the Search Results with the Customer Applications".
- Terms, "Use Restrictions" (the Terms cite this list as section 3(b)): "(i) store, cache, or create a database of Search Results, in whole or in part, other than transient storage required for operation of Customer Applications or related software, service or systems;"
- Same list: "(xiv) upon expiration or termination of this Agreement, continue any further use of the API or Documentation or retain Documentation or Search Results in Customer’s possession and control;"
- Product page FAQ: "Can I store results or use them to train models? Yes, with a custom plan. Contact sales to learn more about search with storage rights."

Reading: storing is forbidden on the published plans. Storage rights exist only by custom agreement. No price is published for them.

Automated agents:

- Terms, "Use Restrictions": "(xiii) use the Search Results to create, evaluate, train, re-train, fine-tune, benchmark or otherwise improve artificial intelligence models or services offered by Customer or third parties;"
- Terms, "Attribution": "Customer may provide attribution to Provider in the Customer Applications." Attribution is optional.
- Web search guide: "Looking to power agents or chatbots? Use the [LLM Context endpoint](/documentation/services/llm-context) instead."

The product page describes the Search plan as data for chatbots and agents. Feeding results to an agent is the intended use. Using results to evaluate, benchmark or improve an AI model or service is barred.

Queries and retention:

- Privacy notice: "A record of search queries submitted to the Brave Search API via a customer's Search API account is retained for a maximum of 90 days for the purpose of billing Search API account holders and for troubleshooting subject to Brave's legal obligations." Zero data retention is offered to enterprise clients.
- The product page states "Queries never shared or trained on".

Price (https://brave.com/search/api/): the Search plan is $5 per 1,000 requests and "Includes $5 in free credits every month". The page header says "Up to $20 in free calls every month". The two were not reconciled.

Rate limit (https://brave.com/search/api/): 50 queries per second on the Search plan. Limits are counted on a one-second sliding window, and only successful requests are billed (rate limiting guide). Over the limit returns `429`.

Call (web search reference):

```
GET https://api.search.brave.com/res/v1/web/search?q=seed+stage+robotics&count=20&freshness=2026-10-01to2026-11-13
X-Subscription-Token: <key>
Accept: application/json
```

- `q` is required, at most 600 characters and 75 words. `count` is 1 to 20, default 20. `offset` is 0 to 9 and counts pages.
- `freshness` takes `pd`, `pw`, `pm`, `py`, or a range written `YYYY-MM-DDtoYYYY-MM-DD`.
- Response: `web.results[]`. Each result has `url`, `title`, `description` (the snippet), `page_age` (the page's date), `age` (a readable form such as "2 days ago"), and `extra_snippets[]` when `extra_snippets=true`. `query.more_results_available` says whether another page exists.

## You.com

Pages read: Acceptable Use Policy: API Search & Router Services https://you.com/aup ("Effective : October 22, 2026"; reached from https://you.com/acceptable-use-policy-may-2026). Master Services Agreement, online version, footer "MSA v.121525" https://45321510.fs1.hubspotusercontent-na1.net/hubfs/45321510/Legal/You.com%20MSA%20(Online)%20(December%202025).pdf. Terms & Conditions for the website and apps https://you.com/terms ("Last updated : August 27, 2024"). Privacy Policy https://you.com/privacy ("Last updated : September 22, 2026"). Pricing https://you.com/pricing. Rate limits https://you.com/docs/rate-limits.md. Zero data retention https://you.com/docs/administration/zero-data-retention.md. Search reference https://you.com/docs/api-reference/search/v1-search.md. Authentication https://you.com/docs/using-the-api/authentication.md.

Storing and reuse:

- Policy, section 9: "Do not copy or store for re-use significant portions of Search Content without contractual authorization."
- Policy, section 9: "Do not republish, resell, or redistribute Search Content as a standalone dataset, feed, or index."
- Policy, section 10: "Implement exponential back-off and caching in your integration."
- Master Services Agreement, section 6.1: "to the extent permitted by applicable law, and subject to Customer’s compliance with this Agreement, You.com hereby assigns to Customer all of our right, title, and interest, if any, in and to Outputs."

Reading: the customer is assigned You.com's rights in Outputs, but may not store "significant portions" of search content for re-use without a contract that says so. The policy does not define "significant". A queue that keeps every result is hard to defend as insignificant.

Automated agents and people:

- Master Services Agreement, section 3.5: "(p) except when you are accessing our Services via a You.com API key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise;"
- Master Services Agreement, section 3.5: "(e) automatically or programmatically extracting data or Output;" This sits beside the API key exception above. The agreement defines "Services" as You.com's "cloud based AI assistant services and related content, but excluding Third Party Services." It was written for the assistant product.
- Policy, section 1, in a list of things an integration must not do: "Use Outputs to build profiles of personal or sensitive information on individuals or to re-identify any anonymized data." A founder dossier built from search outputs sits close to this.
- Policy, section 7: "You must not rely solely on Outputs for decisions with legal, medical, financial, employment, housing, credit, or safety consequences for a person."

Queries and retention:

- Master Services Agreement, section 3.4.3: "You.com agrees that it will only use Customer Data as necessary to provide Customer with the Services, comply with applicable law, and for safety purposes to combat malicious uses and enforce the AUP."
- Zero data retention page: "ZDR is available for the Web Search API and the Answer API on enterprise agreements." It is not on by default.

Price (https://you.com/pricing): Web Search API, Standard, $5 per 1,000 calls. A free route through the MCP server allows 100 queries a day.

Rate limit (https://you.com/docs/rate-limits.md): 10 requests per second on `/v1/search` for self-serve accounts. Over the limit returns `429`.

Call (search reference and authentication page):

```
POST https://ydc-index.io/v1/search
X-API-Key: <key>
Content-Type: application/json

{
  "query": "seed stage robotics founder interview",
  "count": 10,
  "freshness": "2026-10-01to2026-11-13"
}
```

- `count` is 1 to 100, default 10. `offset` is 0 to 9 in multiples of `count`.
- `freshness` takes `day`, `week`, `month`, `year`, or a range written `YYYY-MM-DDtoYYYY-MM-DD`. `include_domains` and `exclude_domains` cannot be combined.
- Response: `results.web[]` and `metadata` (`search_uuid`, `query`, `latency`). Each web result has `url`, `title`, `description`, `snippets[]`, `page_age` and `favicon_url`.

## Linkup

Pages read: Linkup Client General Terms and Conditions as shown at https://www.linkup.so/terms-of-use ("Last update: August 2025"). Pricing https://docs.linkup.so/pages/documentation/platform/pricing.md. Rate limits https://docs.linkup.so/pages/documentation/platform/rate-limits.md. Search reference https://docs.linkup.so/pages/documentation/endpoints/search/reference.md. Data processing and privacy https://docs.linkup.so/pages/security-and-privacy/data-processing-privacy.md. Security FAQ https://docs.linkup.so/pages/security-and-privacy/faq.md. The docs link to a copy of the terms on Notion. That copy needs JavaScript and was not read.

Storing and reuse:

- Article 1, definitions: "Open Web Content means the content accessible via the web, verified by Linkup under the conditions provided in article 4.1, and accessed by Client through Linkup Solution and/or used by Linkup to provide Answers, under the terms of this Agreement."
- Article 4.1: "The sole basis for referencing URL links to Open Web Content through Linkup APIs and using this Open Web Content to provide Answers is the exception for text and data mining provided for in Article 4 of EU Copyright Directive 2019/790."
- Article 4.1: "Particularly, Client shall (i) check that the Open Web Content is lawfully accessible; (ii) limit its use of such content to reproduction and extraction for the sole purpose of text and data mining, ie. automated analytical technique aimed at analysing text and data in digital form in order to generate information which includes but is not limited to patterns, trends and correlations; and (iii) retain Open Web Content for as long as is necessary for the purposes of text and data mining only."
- Article 4.1: "Client acknowledges and agrees that it is not authorized to use, including to distribute, Open Web Content for any purpose other than strictly specified above."
- Article 6.3: "Client is also aware that the rightsholders of Open Web Content are entitled to request at any time immediate cease of use their content by expressly reserved by their rights in an appropriate manner, such as machine-readable means in the case of content made publicly available online."

Reading: the terms say what a client may do with returned content: reproduce and extract it for text and data mining, and keep it for as long as that needs. The clause is written as a limit, not as a grant, but it names reproduction, extraction and retention as the permitted acts. That fits a queue of addresses that agents read later. Three limits follow from the same words. The use must be analysis that generates information, not republishing. Results may not be passed on to others. A site owner's opt-out has to be honoured, and that reaches content already stored. In practice: keep Linkup's `content` text inside the pipeline, use it to choose what to read, and show a person only words from the page the hunt fetched itself.

Automated agents:

- Article 1, definitions: "Authorized Users means Client’s employees, AI agents and services providers authorized by an Administrator to access and use Linkup Platform."

No clause on scoring or profiling people was found. Article 10 says "The Personal Data processed by Linkup are data related to Client’s Operators: name and email." That is account data, not search subjects. The customer stays responsible for data protection law.

Queries and retention:

- Article 6.5: "Client grants Linkup a worldwide right to use, reproduce and modify the Client Data, including prompts, for the purposes of providing, maintaining, developing, training and improving the Linkup Solution."
- Docs: "ZDR can be requested on demand. It is not enabled by default."
- Docs: "Linkup can offer ZDR because its retrieval is built on its own search index and processing stack."

Other terms: "The Agreement is governed by French Law." Disputes go to the courts of Paris. Article 5.1 says "All prices are in Euros, exclusive of costs and taxes." while the docs price in US dollars.

Price (https://docs.linkup.so/pages/documentation/platform/pricing.md): $0.005 per call for `depth` of `flash`, `fast` or `standard` with `outputType: "searchResults"`, so $5 per 1,000. `deep` is $0.05 per call. Failed calls are not charged. A new account with a professional email starts with $20 of credit.

Rate limit (https://docs.linkup.so/pages/documentation/platform/rate-limits.md): "our rate limits are currently set at 10 queries per second per organization". The API answers `429` both when the limit is passed and when the balance runs out.

Call (https://docs.linkup.so/pages/documentation/endpoints/search/reference.md):

```
POST https://api.linkup.so/v1/search
Authorization: Bearer <key>
Content-Type: application/json

{
  "q": "seed stage robotics founder interview",
  "depth": "fast",
  "outputType": "searchResults",
  "maxResults": 10,
  "fromDate": "2026-10-01",
  "toDate": "2026-11-13"
}
```

- `q`, `depth` and `outputType` are required. `depth` is `flash`, `fast`, `standard` or `deep`. The reference calls `fast` the recommended default for agents.
- Dates are `YYYY-MM-DD`. `includeDomains` takes up to 100 domains. `excludeDomains` is also accepted.
- Response: `results[]`. Each result has `name` (the title), `url`, `content` (extracted text, the snippet), `publishedAt` (`YYYY-MM-DD`, when known), `favicon` and `type` (`text`).

Before relying on it, ask Linkup in writing: that keeping `url`, `name` and `content` in a database for later automated reading is within article 4.1; whether zero data retention can be set for the account; and which currency and terms apply to a US customer.

## Parallel

Pages read: Customer Terms https://parallel.ai/customer-terms ("Effective date: November 10, 2026"). Acceptable Use Policy https://parallel.ai/acceptable-use-policy. Pricing https://docs.parallel.ai/getting-started/pricing.md. Rate limits https://docs.parallel.ai/getting-started/rate-limits.md. Search reference https://docs.parallel.ai/api-reference/search/search.md. FAQ https://docs.parallel.ai/resources/faqs.md. https://parallel.ai/terms-of-service covers the websites only.

Storing and reuse:

- Section 4(b): "As between the Parties, Customer retains all right, title and interest in and to the Customer IP, except for the license granted to Parallel in this Section 4(b)."
- Section 2(b): "(i) Customer Output generated from one query shall be primarily for the use of one End Customer only, and shall not be copied, cached, stored, or made available to other End Customers or other third parties;"
- Section 2(b): "(ii) Customer shall not copy, cache, or store any significant portion of any Customer Output to create the AI and Data Selling Services (as defined in Section 2(c) below)."
- Section 2(c): "(vi) use the Services or any Customer Output to (A) create synthetic training data to develop or train a language model or any other machine learning model, or (B) create databases, data brokerage, data selling/reselling businesses, or related products or services, whether competitive with the Services or not (all of the foregoing collectively, the “AI and Data Selling Services”), or (C) otherwise for any competitive purposes;"
- Section 2(c): "(xi) intentionally or knowingly diverge requests of Authorized Users away from the Services (such as by making available Customer Outputs from previous queries for future uses, or incorporating Customer Outputs into an AI and Data Selling Services);"
- FAQ: "you own the output you create with Parallel, including the right to reprint, sell, and merchandise."

Reading: the customer owns the output but may not use it to create databases, and may not keep earlier outputs for future use in a way that moves requests away from Parallel. A stored queue of results is close to both.

Automated agents and people:

- Acceptable Use Policy, scope: it applies to use of the products "including all uses and interactions by, with, or through AI agents and agentic features".
- Acceptable Use Policy, prohibited use cases: "assign social/behavioral “scores” to individuals (social scoring) without consent;" The hunt gives founders a score, so this needs a reading before use.
- Section 4(d): "Before Customer use the Services to process any “personal data” or “personal information” as defined under applicable data protection laws (“Personal Data”), Customer shall separately execute Parallel’s Data Processing Addendum made available by Parallel."

Queries and retention:

- Section 4(b): "Parallel may use Customer IP to train and improve the machine learning and other artificial intelligence models used to provide the Services."
- FAQ: "Under the standard Customer Terms, Parallel may use inputs and outputs, not linked to any individual, to train and improve the models behind its services. Enterprise plans with zero data retention exclude that use. Search API traffic sent to the EU endpoint is also excluded."

Price (https://docs.parallel.ai/getting-started/pricing.md): $1 per 1,000 requests in `turbo` or `fast` mode. $5 per 1,000 in `basic` or `advanced` mode. Ten results are included. More cost $1 per 1,000 results. The default mode is `advanced`.

Rate limit (https://docs.parallel.ai/getting-started/rate-limits.md): 600 requests per minute on `/v1/search`.

Call (https://docs.parallel.ai/api-reference/search/search.md):

```
POST https://api.parallel.ai/v1/search
x-api-key: <key>
Content-Type: application/json

{
  "objective": "Find recent interviews with founders of seed stage robotics startups.",
  "search_queries": ["seed stage robotics founder interview"],
  "mode": "fast",
  "advanced_settings": {
    "max_results": 10,
    "source_policy": { "after_date": "2026-10-01" }
  }
}
```

- `search_queries` is required. `max_results` defaults to 10. Sending it at the top level returns `422`.
- The only date filter is `after_date` (`YYYY-MM-DD`). There is no end date.
- Response: `search_id`, `session_id`, `results[]`. Each result has `url`, `title`, `publish_date` (`YYYY-MM-DD`, when known) and `excerpts[]` (the snippet).

## Jina (s.jina.ai)

Pages read: Legal Information https://jina.ai/legal ("Last Modified: May. 04, 2026"). Reader product page https://jina.ai/reader/. API reference in plain text https://docs.jina.ai/api.md and https://docs.jina.ai/openapi.json. Model list https://api.jina.ai/v1/models.

The legal page opens with a notice: "In October 2025, Jina AI GmbH was acquired by Elastic N.V." and "The terms and policies below were established by Jina AI GmbH prior to the acquisition and may no longer reflect the current data processing practices."

Storing and reuse:

- Section 4.1: "All software, data bases, websites, search results, documents, information, algorithms, processes, prototypes, ideas, knowhow, patents, trademarks or other work results (“IP”) used by Jina AI to provide the Services or made available to the Customer by Jina AI are owned by Jina AI or its licensors"
- Section 4.3: "Jina AI (except as expressly stated otherwise herein) claims no rights to such Output and imposes no restrictions on the Customer regarding the use of the Output unless otherwise agreed in an agreement with the Customer."
- Section 4.3: "To the extent that the Output consists of extracted or restructured content from existing third-party materials (e.g. websites, PDF files, search results, collectively the “Material”), the Customer acknowledges that any third party intellectual property rights in the underlying Material remain unaffected."

Reading: section 4.3 is the widest permission found in any of these terms. Section 4.1 lists search results as Jina's property all the same, and the notice says the terms may be out of date.

Automated agents:

- Section 4.5: "(iv) use automated methods to extract information, data or result from the JINA-AI website or the Services, including by means of scraping, harvesting, or web data extraction."

Read literally this bars an agent calling the API. No other sentence deals with agents.

Queries and retention:

- Section 4.6: "Unless agreed otherwise (e.g. in these TCs) Jina AI will only store Input or Output on its servers to the extent required to provide the Services."
- Product page FAQ, "Is my API data used to train your models?": "No. We never use your API requests, inputs, or outputs to train our embedding, reranker, or any other models."

Price: not confirmed. The product page says of s.jina.ai: "Every request costs a fixed number of tokens, starting from 10,000 tokens". The price per token is drawn by JavaScript and could not be read. The model list prices most models at $0.05 per million tokens. If search tokens cost the same, a search is $0.0005, or $0.50 per 1,000. That is an inference, not a published price.

Rate limit (https://docs.jina.ai/api.md and the product page): 100 requests per minute with a free or paid key, 1,000 with a premium key. "Reader also answers without a key, at a lower rate limit; Search needs one."

Call (https://docs.jina.ai/api.md):

```
GET https://s.jina.ai/?q=seed+stage+robotics+founder+interview&num=10
Authorization: Bearer <key>
Accept: application/json
X-Respond-With: no-content
```

- `num` is 0 to 20, default 10. `X-Respond-With: no-content` returns results without page text. `site` limits results to one domain. `type` is `web`, `images` or `news`.
- `provider` is documented as: "Search engine to use: `google`, `bing` or `reader`." The docs do not say how Google or Bing results are obtained.
- No date range parameter is documented.
- Response (JSON): `code`, `status`, `data[]`. Each item has `title`, `url`, `description` (the snippet), `content` (page text unless turned off) and `publishedTime`.

## Kagi Search API

Pages read: Kagi API Terms of Service https://kagi.com/privacy/api ("Effective Date: 2026-09-22"). Privacy and terms page https://kagi.com/privacy. Pricing https://kagi.com/api/pricing. OpenAPI file https://kagi.com/api/docs/_bundle/openapi.yaml?download. Help pages https://help.kagi.com/kagi/api/search.html and https://help.kagi.com/kagi/api/overview.html.

Storing and reuse:

- Under "What you may do":

  > Within your plan limits, you get a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to call the API and use the outputs it returns, including search results, translations, and summaries ("Results") in your own applications and services, including sending Results to an AI model to answer your users' queries.

- Under "What you may not do": "Store, cache, or build a database of Results beyond the transient caching needed to operate your application. You may not create a persistent copy of, or a derivative index from, the Kagi search index or other Results, and you may not bulk download, scrape, or archive Results."
- Under "Ownership": "The API, the Results, and the Kagi search index are Kagi's property."
- Under "Suspension and termination": "On termination, your license ends and you must stop using the API and delete any cached Results (except limited records you are legally required to keep)."

Reading: storing is forbidden. Sending results to a model is allowed.

Queries and retention:

- "We don't tie your queries to your account beyond metering usage for billing, we don't sell data, and we don't build profiles."
- "Queries may be logged temporarily, separated from your account, for debugging and abuse prevention, then purged, as described in the Privacy Policy."

Price (https://kagi.com/api/pricing): Search is $12 per 1,000 requests.

Rate limit: no number is published. The terms say limits and quotas apply per plan.

Call (OpenAPI file):

```
POST https://kagi.com/api/v1/search
Authorization: Bearer <key>
Content-Type: application/json

{
  "query": "seed stage robotics founder interview",
  "limit": 10,
  "filters": { "after": "2026-10-01", "before": "2026-11-13" }
}
```

- `query` is required. `limit` is 1 to 1024 and only caps what is returned. `page` is 1 to 10.
- Response: `meta`, `data.search[]`. Each result has `url`, `title`, `snippet` and `time` (ISO 8601).

## Anthropic web search tool

Pages read: web search tool https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.md. API and data retention https://platform.claude.com/docs/en/manage-claude/api-and-data-retention.md. Rate limits https://platform.claude.com/docs/en/api/rate-limits.md. Commercial Terms of Service https://www.anthropic.com/legal/commercial-terms ("Effective Jun 17, 2025"). Service Specific Terms https://www.anthropic.com/legal/service-specific-terms (no mention of web search).

Storing and reuse:

- Commercial Terms, section B: "Anthropic agrees that Customer (a) retains all rights to its Inputs, and (b) owns its Outputs." and "Subject to Customer’s compliance with these Terms, Anthropic hereby assigns to Customer its right, title and interest (if any) in and to Outputs." The same section defines Outputs as "responses generated by the Services to Inputs".
- Tool page, on results: `encrypted_content` is "Encrypted content that you must pass back in multi-turn conversations".
- Tool page, note under "Citations": "When displaying API outputs directly to end users, citations must be included to the original source."

Reading: the docs do not address keeping the URL and title that the tool returns. The Commercial Terms give the customer ownership of Outputs and do not single out search results.

Queries and retention:

- Commercial Terms, section B: "Anthropic may not train models on Customer Content from Services."
- Retention page: "Retained data is never used for model training without your express permission."
- Tool page, data handling: the tool is eligible for zero data retention, with this detail: "Real-time web search results returned in the API response. Dynamic filtering for web search is not eligible for ZDR or HIPAA."

Price (tool page): "Web search is available on the Claude API for $10 USD per 1,000 searches, plus standard token costs for search-generated content." Each search counts once however many results come back. A failed search is not billed.

Rate limit: no number is published. The tool page says the organization's web search limit is shown on the Rate limits page of the Claude Console.

Call (tool page):

```
POST https://api.anthropic.com/v1/messages
x-api-key: <key>
anthropic-version: 2026-10-21
content-type: application/json

{
  "model": "<model id>",
  "max_tokens": 1024,
  "messages": [{ "role": "user", "content": "Search for: seed stage robotics founder interview. List what you find." }],
  "tools": [{ "type": "web_search_20250305", "name": "web_search", "max_uses": 1 }]
}
```

- Tool settings: `max_uses`, `allowed_domains` or `blocked_domains` (not both), `user_location`. There is no number-of-results field and no date range field. The model writes the query.
- Versions: `web_search_20250305` is the basic tool. `web_search_20260209` adds dynamic filtering, where the model runs code over the results first. `web_search_20260318` adds a `response_inclusion` setting.
- Response: `content[]` holds a `server_tool_use` block (`input.query`), then a `web_search_tool_result` block whose `content[]` items have `url`, `title`, `page_age` and `encrypted_content`. There is no plain snippet. Text blocks carry `citations[]` with `url`, `title` and `cited_text` of up to 150 characters. `usage.server_tool_use.web_search_requests` counts searches.
- An error comes back with HTTP 200. `content` is then one object with an `error_code`, not a list.

## OpenAI web search tool

Pages read: web search guide https://developers.openai.com/api/docs/guides/tools-web-search.md. Pricing https://developers.openai.com/api/docs/pricing. Data controls https://developers.openai.com/api/docs/guides/your-data. Not read: https://openai.com/policies/services-agreement/ and https://openai.com/policies/service-terms/. Both returned HTTP 403 with a JavaScript challenge, to curl and to a page-fetch tool.

Storing and reuse:

- Guide, "Output and citations": "When your interface displays web results or information from them, you must show inline citations as prominent, clickable links."
- Guide, "Sources": "To view all URLs retrieved during a web search, use the `sources` field."

Reading: the docs do not address keeping the URLs and titles returned. The contract terms that would settle it were not read.

Queries and retention:

- Data controls: "As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us)."
- Data controls: "By default, abuse monitoring logs are generated for all API feature usage and retained for up to 30 days, unless longer retention is required by law, or is reasonably necessary to protect our services or any third party from harm."
- Data controls: "Web Search with live internet access is not HIPAA eligible and is not covered by a BAA."

Price (pricing page): web search is $10.00 per 1,000 calls, plus search content tokens at the model's rates.

Rate limit (guide): "Responses API web search uses the underlying model's tiered rate limits."

Call (guide):

```
POST https://api.openai.com/v1/responses
Authorization: Bearer <key>
Content-Type: application/json

{
  "model": "<model id>",
  "tools": [{ "type": "web_search", "filters": { "allowed_domains": ["example.com"] } }],
  "include": ["web_search_call.action.sources"],
  "input": "Search for: seed stage robotics founder interview. List what you find."
}
```

- Tool settings: `filters.allowed_domains` or `filters.blocked_domains` (up to 100), `search_context_size`, `user_location`, `external_web_access`. There is no number-of-results field and no date range field. The model writes the query.
- Response: `output[]` holds a `web_search_call` item (`action.type`, the query, and `action.sources[]` with `url` when asked for), then a `message` item. `content[0].text` is the answer. `content[0].annotations[]` items have `type: "url_citation"`, `url`, `title`, `start_index` and `end_index`. There is no snippet field.

## Side questions

### A. YouTube, Vimeo, Spotify and podcast feeds

YouTube Terms of Service, https://www.youtube.com/t/terms ("Dated: December 15, 2023"), under "Permissions and Restrictions", in the list that begins "You are not allowed to":

- "access the Service using any automated means (such as robots, botnets or scrapers) except (a) in the case of public search engines, in accordance with YouTube’s robots.txt file; or (b) with YouTube’s prior written permission;"
- "access, reproduce, download, distribute, transmit, broadcast, display, sell, license, alter, modify or otherwise use any part of the Service or any Content except: (a) as expressly authorized by the Service; or (b) with prior written permission from YouTube and, if applicable, the respective rights holders;"
- "collect or harvest any information that might identify a person (for example, usernames or faces), unless permitted by that person or allowed under section (3) above;"

YouTube's robots.txt (https://www.youtube.com/robots.txt) lists `/results` and `/t/terms` under `Disallow` for every user agent. The terms page was fetched once to quote it.

Vimeo Terms of Service, https://vimeo.com/legal/ ("Last Updated: July 8, 2024"; https://vimeo.com/terms redirects there), section 5.4, "Prohibited Technical Measures", in the list that begins "You will not":

- "Access the Services using any automated means (such as robots, botnets, or scrapers) except (1) using our APIs, in accordance with our API License Addendum and the related documentation, (2) in the case of public search engines, in accordance with our robots.txt file; or (3) with our prior written permission;"

Spotify. The Terms of Use page (https://www.spotify.com/us/legal/end-user-agreement/, "Last Updated: September 4, 2026") has no sentence on automated access. The Spotify User Guidelines beside it do (https://www.spotify.com/us/legal/user-guidelines/), in the list that begins "The following is not permitted for any reason whatsoever":

> "crawling" or "scraping", whether manually or by automated means, or otherwise using any automated means (including bots, scrapers, and spiders), to view, access or collect information, or using any part of the Services or Content to train a machine learning or AI model or otherwise ingesting Spotify Content into a machine learning or AI model;

Spotify Developer Terms, https://developer.spotify.com/terms (Version 10, effective 15 May 2025):

- "Do not improperly access, alter or store the Spotify Service or Spotify Content, including using any robot, spider, site search/retrieval application, or other tool to retrieve, duplicate, or index any portion of the Spotify Service or Spotify Content (which includes playlist data) or collect information about Spotify users for any unauthorized purpose;"

Podcast feeds. The RSS 2.0 specification defines the file link as part of the feed: "<enclosure> is an optional sub-element of <item>. It has three required attributes. url says where the enclosure is located, length says how big it is in bytes, and type says what its type is, a standard MIME type. The url must be an http url." (https://www.rssboard.org/rss-specification). The use case the specification links to describes software fetching those files without a person: "What if, in the middle of the night, while I'm not using my computer, it downloads huge video and audio stuff to my local hard drive." and "You never see a video or music document until it's fully downloaded. The computer does the waiting, not you." (https://www.rssboard.org/rss-enclosures-use-case). Apple's requirements for podcast feeds say "RSS feed URLs must adhere to RSS 2.0 specifications, be publicly addressable (not password-protected)" and tell hosts to "allow streaming playback of your episodes by enabling your hosting server for HTTP HEAD requests and byte-range requests." (https://podcasters.apple.com/support/823-podcast-requirements). So an enclosure file is published at a public address for programs to download, and that is how podcast apps work. None of these pages grants a right to copy, transcribe or republish the audio. That depends on each show's own terms and on copyright law, which were not read here. Read the publisher's own feed, not Spotify's pages, since Spotify bars automated collection.

### B. Do Anthropic or OpenAI docs speak to storing search URLs and titles?

Anthropic: silent. The web search tool page has no sentence on storing, caching or keeping the `url` and `title` it returns. The nearest statements are that `encrypted_content` must be sent back unchanged to continue a conversation, that citations must be shown when outputs are displayed to end users ("When displaying API outputs directly to end users, citations must be included to the original source."), and, in the Commercial Terms, that the customer "owns its Outputs".

OpenAI: silent in the docs. The web search guide has no sentence on storing or caching results. The nearest statement is the display rule: "When your interface displays web results or information from them, you must show inline citations as prominent, clickable links." The Services Agreement and Service Terms were not readable.

## Not verified

- OpenAI Services Agreement and Service Terms. HTTP 403 with a JavaScript challenge. Whether they restrict keeping search results is unknown.
- Whether any vendor's sign-up flow shows terms that differ from the published pages. No account was created.
- Every response shape. No API was called. Field names are from each vendor's reference.
- Result quality for finding early founders. No search was run on any service.
- Exa: the date of the Terms of Service (none printed), any Master Subscription Agreement or data processing agreement, and whether Exa will permit storing in writing.
- Tavily: how the "zero data retention" claim in the FAQ fits sections 6.5 and 6.7 of the Terms. Whether Tavily reads its person-level limits as covering a venture investor's founder search.
- Perplexity: whether the no-training clause in the API Terms (2.3.3) applies to the Search API, given Addendum section 2.2. The data processing addendum was not read.
- Brave: the free credit amount ($5 in the plan, "Up to $20" in the header). The price and terms of a plan with storage rights.
- You.com: whether the Master Services Agreement, written around the assistant product, is the contract for a self-serve API key. What "significant portions" means.
- Linkup: the Notion copy of the terms (needs JavaScript), so a newer version than "August 2025" may exist. Whether Linkup reads article 4.1 as covering a stored queue. Currency for a US customer.
- Parallel: the data processing addendum, and the date of the Acceptable Use Policy.
- Jina: the price per token for s.jina.ai, the default `provider`, how Google and Bing results are sourced, and which terms apply after the Elastic acquisition.
- Kagi: the rate limit. The data processing addendum is not yet published, by Kagi's own account.
- Anthropic: the numeric web search rate limit (shown only in the Console), and any terms of the search provider behind the tool.
- YouTube API Services terms, Vimeo's API addendum, and each podcast's own terms were not read.

Sources:

All read 2026-11-13.

Exa
- https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf (via https://exa.ai/terms-of-service)
- https://exa.ai/privacy-policy
- https://exa.ai/pricing
- https://exa.ai/docs/admin/pricing.md
- https://exa.ai/docs/admin/billing.md
- https://exa.ai/docs/admin/security/zero-data-retention.md
- https://exa.ai/docs/admin/security/overview.md
- https://exa.ai/docs/admin/faqs.md
- https://exa.ai/docs/reference/search.md
- https://exa.ai/docs/reference/content-policy (read inside https://exa.ai/docs/llms-full.txt)
- https://exa.ai/docs/llms.txt

Tavily
- https://www.tavily.com/terms
- https://www.tavily.com/acceptable-use-policy
- https://www.tavily.com/privacy
- https://docs.tavily.com/documentation/api-credits.md
- https://docs.tavily.com/documentation/rate-limits.md
- https://docs.tavily.com/documentation/api-reference/endpoint/search.md
- https://docs.tavily.com/faq/faq.md
- https://docs.tavily.com/sdk/python/reference (read inside https://docs.tavily.com/llms-full.txt)

Perplexity
- https://www.perplexity.ai/hub/legal/perplexity-api-terms-of-service-search
- https://www.perplexity.ai/hub/legal/perplexity-api-terms-of-service
- https://www.perplexity.ai/hub/legal/aup
- https://docs.perplexity.ai/docs/getting-started/pricing.md
- https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers.md
- https://docs.perplexity.ai/api-reference/search-post.md
- https://docs.perplexity.ai/docs/resources/privacy-security.md

Brave
- https://api-dashboard.search.brave.com/terms-of-service
- https://brave.com/search/api/
- https://api-dashboard.search.brave.com/documentation/resources/privacy-notice/index.html.md
- https://api-dashboard.search.brave.com/documentation/guides/rate-limiting/index.html.md
- https://api-dashboard.search.brave.com/documentation/services/web-search/index.html.md
- https://api-dashboard.search.brave.com/api-reference/web/search/get/index.html.md

You.com
- https://you.com/aup (via https://you.com/acceptable-use-policy-may-2026)
- https://45321510.fs1.hubspotusercontent-na1.net/hubfs/45321510/Legal/You.com%20MSA%20(Online)%20(December%202025).pdf
- https://you.com/terms
- https://you.com/privacy
- https://you.com/pricing
- https://you.com/docs/rate-limits.md
- https://you.com/docs/administration/zero-data-retention.md
- https://you.com/docs/api-reference/search/v1-search.md
- https://you.com/docs/using-the-api/authentication.md

Linkup
- https://www.linkup.so/terms-of-use
- https://linkup-platform.notion.site/Linkup-Client-General-Terms-and-Conditions-13f161ecef69806784dfe808b4e162a1 (needs JavaScript; not read)
- https://docs.linkup.so/pages/documentation/platform/pricing.md
- https://docs.linkup.so/pages/documentation/platform/rate-limits.md
- https://docs.linkup.so/pages/documentation/endpoints/search/reference.md
- https://docs.linkup.so/pages/security-and-privacy/data-processing-privacy.md
- https://docs.linkup.so/pages/security-and-privacy/faq.md

Parallel
- https://parallel.ai/customer-terms
- https://parallel.ai/acceptable-use-policy
- https://parallel.ai/terms-of-service
- https://docs.parallel.ai/getting-started/pricing.md
- https://docs.parallel.ai/getting-started/rate-limits.md
- https://docs.parallel.ai/api-reference/search/search.md
- https://docs.parallel.ai/resources/faqs.md

Jina
- https://jina.ai/legal
- https://jina.ai/reader/
- https://docs.jina.ai/api.md
- https://docs.jina.ai/openapi.json
- https://api.jina.ai/v1/models

Kagi
- https://kagi.com/privacy/api
- https://kagi.com/privacy
- https://kagi.com/api/pricing
- https://kagi.com/api/docs/_bundle/openapi.yaml?download
- https://help.kagi.com/kagi/api/search.html
- https://help.kagi.com/kagi/api/overview.html

Anthropic
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.md
- https://platform.claude.com/docs/en/manage-claude/api-and-data-retention.md
- https://platform.claude.com/docs/en/api/rate-limits.md
- https://www.anthropic.com/legal/commercial-terms
- https://www.anthropic.com/legal/service-specific-terms

OpenAI
- https://developers.openai.com/api/docs/guides/tools-web-search.md
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/your-data
- https://openai.com/policies/services-agreement/ (HTTP 403; not read)
- https://openai.com/policies/service-terms/ (HTTP 403; not read)

Side questions
- https://www.youtube.com/t/terms
- https://www.youtube.com/robots.txt
- https://vimeo.com/legal/ (via https://vimeo.com/terms)
- https://www.spotify.com/us/legal/end-user-agreement/
- https://www.spotify.com/us/legal/user-guidelines/
- https://developer.spotify.com/terms
- https://www.rssboard.org/rss-specification
- https://www.rssboard.org/rss-enclosures-use-case
- https://podcasters.apple.com/support/823-podcast-requirements
