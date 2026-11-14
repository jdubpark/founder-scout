# X API post lookup: what X's own documents say

Read 2026-11-13 from docs.x.com, using the Markdown form of each page and a generic client. Quotes are copied from the page named with them, with the source's punctuation; markdown bold and links are dropped. Pricing per read and the Developer Policy's first "Content compliance" sentence are in the earlier note and are not repeated.

## Summary

The tightest constraint is contractual: the Pay-Per-Use Agreement forbids using X Content "for purpose of ... investigating or tracking X users" without X's written approval, X's restricted-use page lists "Background checks or any form of extreme vetting" and "Individual profiling", and the use-case description filed with X is binding, so the tool's purpose (confirming founders' posts for an investor's dossiers) has to be described to X and approved before it reads posts. Stored post text has no retention limit, but it must follow the post on X (deleted, protected, suspended or withheld content must be deleted or modified, and within 24 hours of a request), and the documented bulk check is the batch compliance job, `POST /2/compliance/jobs`, whose cost no X page states. Mechanically, `GET /2/tweets` takes up to 100 ids, allows 3,500 requests per 15 minutes per app, returns unavailable posts as `errors` entries, and bills "per resource returned in the response"; whether an expanded author is billed as a $0.010 User read, and whether an `errors` entry is billed, is not stated anywhere.

## Which agreement applies

A pay-per-use account is governed by the X Developer PPU Agreement, https://docs.x.com/developer-terms/ppu-agreement (no date on the page). Its sections III.A (restrictions), IV.B (removals) and XIV.B (user protection) match the general X Developer Agreement, https://docs.x.com/developer-terms/agreement ("Last Updated: April 27, 2026"), word for word; sections III.D, III.J, III.L and VII differ, and the quotes below from those sections are from the PPU Agreement. Both incorporate the Developer Policy and the API Restricted Use Rules (section II.C):

> "Your access to and use of the Licensed Material is also subject to, and you shall comply with, the following additional terms and policies (collectively, “Incorporated Developer Terms”):"

followed by a list that starts "the X Developer Policy;" and "the API Restricted Use Rules;".

The PPU Agreement also limits what the plan is for (section III.L):

> "The Pay-Per-Use, Basic, and Pro plans (as described at developer.x.com) are designed for hobbyists, commercial prototyping, initial development, early-stage X product integrations, and supporting applications with a limited number of end-users. If you use the X API beyond this scope, then you must apply (or already subscribe to) an Enterprise plan (as described at developer.x.com)."

## 1. Post lookup, `GET /2/tweets`

### Maximum ids per request: 100

The endpoint reference, https://docs.x.com/x-api/posts/get-posts-by-ids, declares the `ids` parameter with `minItems: 1` and `maxItems: 100`. The overview, https://docs.x.com/x-api/posts/lookup/introduction, says: "Retrieve up to 100 Posts in one request". The migration guide, https://docs.x.com/x-api/posts/lookup/migrate/overview: "The v1.1 GET statuses/lookup endpoint allows you to specify up to 100 Posts per request. This also applies to the GET /tweets endpoint."

### `note_tweet`

Data dictionary, https://docs.x.com/x-api/fundamentals/data-dictionary:

> "note_tweet | object | Contains the full text of a Post for long-form Posts (>280 characters). | Get the complete text of a post."

So for a post over 280 characters, `text` is not the whole post; the tool must request `note_tweet` and compare against `note_tweet.text`.

The names conflict between X's pages. The prose pages (data dictionary, integration guide, quickstart) use `tweet.fields` and `note_tweet`. The endpoint reference and X's machine-readable spec, https://api.x.com/2/openapi.json (version 2.174), name the parameter `post.fields` and the field `note_post`, described as "The full content of the Post, including text beyond 280 characters." with a required `text` property described as "The full note text of the Post." The same spec still uses `tweet.fields` and `note_tweet` for the streaming endpoints. Which name the live `GET /2/tweets` accepts was not tested.

### `errors` entries for unavailable posts

What the docs say in general, https://docs.x.com/x-api/fundamentals/response-codes-and-errors:

> "Some requests can partially succeed. A 200 response may include both data and errors:"

with this example:

```json
{
  "data": [
    {"id": "123", "text": "Hello"}
  ],
  "errors": [
    {
      "resource_id": "456",
      "resource_type": "tweet",
      "title": "Not Found Error",
      "detail": "Could not find tweet with id: [456].",
      "type": "https://api.x.com/2/problems/resource-not-found"
    }
  ]
}
```

and an "Error types" table that includes:

> "`.../resource-not-found` | Post, user, or other resource doesn't exist"
>
> "`.../not-authorized-for-resource` | No access to private/protected content"

Case by case:

- **Deleted.** Integration guide, https://docs.x.com/x-api/posts/lookup/integrate: "If a Post is deleted or from a protected account you don't follow:" then "Single Post lookup returns 404" and "Multi-Post lookup omits the Post from results with an errors array". Its example entry has `"title": "Not Found Error"` and `"detail": "Could not find tweet with id: [1234567891]."` and no `type`; the errors page gives the matching `type` as `https://api.x.com/2/problems/resource-not-found`.
- **Protected account.** Not settled by the docs. The integration guide groups it with deleted posts under the sentence above (an app-only token follows no one, so every protected post is in this case), and shows only the "Not Found Error" example. The errors page lists `not-authorized-for-resource` for "No access to private/protected content". No page shows the `title` returned for a protected post.
- **Suspended account.** Not found for posts. The users lookup guide, https://docs.x.com/x-api/users/lookup/integrate, says of users: "If a user is suspended or deleted:" then "Multi-user lookup omits the user from results with an errors array", with an example entry titled "Not Found Error". Nothing says the same for posts by a suspended account.
- **Withheld in a country.** Not found. The data dictionary only defines the field: "withheld | object | Contains withholding details for withheld content." The spec's `PostWithheld` object has `copyright` ("Indicates whether this content is withheld due to a copyright claim."), `country_codes` ("Uppercase ISO 3166-1 alpha-2 country codes where this content is withheld.") and `scope`. The errors page lists under "Missing expected posts": "Some posts are withheld in certain regions". No page says whether a withheld post comes back in `data` with a `withheld` object or as an `errors` entry, or which country the API applies for an app-only caller.

The endpoint's error schema allows these `type` values among others (spec, `Problem` schema): `resource-not-found`, `not-authorized-for-resource`, `resource-unavailable`, `disallowed-resource`, `invalid-request`, `field-unauthorized`, `not-authorized-for-field`, `field-hydration-failure`. The schema does not say which case produces which.

### Edits, which affect a word-for-word check

Integration guide, https://docs.x.com/x-api/posts/lookup/integrate: "Each edit creates a new Post ID", "edit_history_tweet_ids contains all versions (oldest first)" and "The endpoint always returns the most recent version". Edit Posts page, https://docs.x.com/x-api/fundamentals/edit-posts: "Posts on X can be edited within 30 minutes of posting, up to 5 times." and "Deleting any version deletes the entire chain".

## 2. Billing

### Expanded users

Not stated. No page says whether a user object returned in `includes` because of `expansions=author_id` is billed as a User read. The closest sentence is on the pricing page, https://docs.x.com/x-api/getting-started/pricing:

> "Read operations"
>
> "Charged per resource returned in the response."

followed by the rows "Posts: Read | $0.005 per resource" and "User: Read | $0.010 per resource". Read literally, an expanded author is a resource returned in the response. Until a bill or the Developer Console shows otherwise, budget as if each distinct author in a UTC day costs a User read. The Usage and Billing page, https://docs.x.com/x-api/fundamentals/post-cap, lists only post-returning endpoints under "Tracked endpoints" ("Posts retrieved from these endpoints count toward usage") and says nothing about users.

If the tool needs only the author's id, `tweet.fields=author_id` without the expansion returns it on the post itself (integration guide, field table: "author_id | Author's user ID"), which avoids the question.

### Ids named in `errors`

Not stated for a 200 response that mixes `data` and `errors`. The only sentence on failures is the FAQ on https://docs.x.com/x-api/fundamentals/post-cap:

> "Do failed requests count?"
>
> "No. Only successful responses that return data are billed."

With "Charged per resource returned in the response", this implies an id that comes back only as an `errors` entry is not billed, but no page says so.

### Other billing facts that bear on the tool

- Monthly cap, pricing page: "Pay-per-usage plans are capped at 3 million Post reads per monthly billing cycle."
- De-duplication is best-effort, pricing page: "Deduplication is a soft guarantee. While it occurs in the vast majority of cases, there may be specific edge cases like service outages that result in resources not being deduplicated."
- Empty balance, PPU Agreement section III.D: "If your credit balance is insufficient for a call, requests will be denied until your credit balance is sufficient to allow deduction for that request."
- Usage can be read by API, pricing page: `GET https://api.x.com/2/usage/tweets` "returns daily Post consumption counts".

## 3. Rate limit

Rate limits page, https://docs.x.com/x-api/fundamentals/rate-limits, table "Tweets lookup":

> "GET | /2/tweets | 3,500/15min | 5,000/15min"

The columns are "Per App" and "Per User". The page says "Per-app limits | Apply with Bearer Token (app-only)" and "Limits are shown per 15 minutes unless otherwise noted". So with an app-only bearer token: 3,500 requests per 15-minute window, each carrying up to 100 ids. For comparison, single-post `GET /2/tweets/:id` is "450/15min" per app.

The page has one table for all self-serve use and does not name the pay-per-use plan; it says only that "Enterprise customers have custom rate limits." It also says: "Rate limits and billing are separate" and "You can be within rate limits but still incur usage costs, or hit rate limits without additional cost." A 429 can mean either limit: errors page, "429 | Too Many Requests | Rate limit or usage cap exceeded".

## 4. Developer Agreement and Developer Policy

### (a) Uses that concern individuals

PPU Agreement, section XIV.B "User Protection" (identical in the Developer Agreement):

> "Unless explicitly approved by X in writing, you shall not use, or knowingly display, distribute, or otherwise make X Content, or information derived from X Content, available for purpose of: (a) conducting or providing surveillance or gathering intelligence, including but not limited to investigating or tracking X users or X Content; (b) conducting or providing analysis or research for any unlawful or discriminatory purpose or in a manner that would be inconsistent with X users' reasonable expectations of privacy; (c) monitoring sensitive events (including but not limited to protests, rallies, or community organizing meetings); or (d) targeting, segmenting, or profiling individuals based on sensitive personal information, including their health (e.g., pregnancy), negative financial status or condition, political affiliation or beliefs, racial or ethnic origin, religious or philosophical affiliation or beliefs, sex life or sexual orientation, trade union membership, X Content relating to any alleged or actual commission of a crime, or any other sensitive categories of personal information prohibited by law."

Same agreements, section III.A(g):

> "(g) use the Licensed Material to derive or obtain non-public information of individual X users;"

API Restricted Use Rules, section "Surveillance, privacy, and user protection", https://docs.x.com/developer-terms/restricted-use-cases:

> "However, we prohibit the use of X data and the X APIs by any entity for surveillance purposes, or in any other way that would be inconsistent with our users' reasonable expectations of privacy. Period."
>
> "We describe prohibited uses of our data and developer products in the Developer Agreement, including prohibitions on investigating or tracking X users or their content, as well as tracking, alerting, or monitoring sensitive events (such as protests, rallies, or community organizing meetings)."
>
> "Other categories of activities prohibited under these terms include (but are not limited to):"
>
> - "Investigating or tracking sensitive groups and organizations, such as unions or activist groups"
> - "Background checks or any form of extreme vetting"
> - "Credit or insurance risk analyses"
> - "Individual profiling or psychographic segmentation"
> - "Facial recognition"

Same page, section "Sensitive information":

> "You should be careful about using X data to derive or infer potentially sensitive characteristics about X users. Never derive or infer, or store derived or inferred, information about a X user’s:"
>
> - "Health (including pregnancy)"
> - "Negative financial status or condition"
> - "Political affiliation or beliefs"
> - "Racial or ethnic origin"
> - "Religious or philosophical affiliation or beliefs"
> - "Sex life or sexual orientation"
> - "Trade union membership"
> - "Alleged or actual commission of a crime"
>
> "Aggregate analysis of X content that does not store any personal data (for example, user IDs, usernames, and other identifiers) is permitted, provided that the analysis also complies with applicable laws and all parts of the Developer Agreement and Policy."

Developer Policy, https://docs.x.com/developer-terms/policy, section "Privacy and control are essential":

> "Any use of the X developer platform, X API, or X Content in a manner that is inconsistent with people’s reasonable expectations of privacy may be subject to enforcement action, which can include suspension and termination of API and X Content access."

Developer Guidelines, https://docs.x.com/developer-guidelines (a summary page, not a contract), "Prohibited activities" table:

> "Surveillance | Profiling, tracking, or monitoring users without consent"

None of these pages defines "investigating", "tracking", "vetting" or "profiling", and none mentions investors, due diligence, recruiting or deal sourcing. The only route the Agreement names is "explicitly approved by X in writing".

### (b) Off-X matching, in full

Developer Policy, https://docs.x.com/developer-terms/policy, section "Off-X matching", complete:

> "We limit the circumstances under which you may match a person on X to information obtained or stored off-X. Off-X matching involves associating X Content, including a X @handle or user ID, with a person, household, device, browser, or other off-X identifier. You may only do this if you have express opt-in consent from the person before making the association, or as described below."
>
> "In situations in which you don’t have a person’s express, opt-in consent to link their X identity to an off-X identifier, we require that any connection you draw be based only on information that someone would reasonably expect to be used for that purpose. In addition, absent a person’s express opt-in consent you may only attempt to match your records about someone to a X identity based on:"
>
> - "Information provided directly to you by the person. Note that records about individuals with whom you have no prior relationship, including data about individuals obtained from third parties, do not meet this standard; and/or"
> - "Public data. “Public data” in this context refers to:"
>   - "Information about a person that you obtained from a public, generally-available resource (such as a directory of members of a professional association)"
>   - "Information on X about a person that is publicly available, including:"
>     - "Posts"
>     - "Profile information, including an account bio and publicly-stated location"
>     - "Display name and @handle"

The API Restricted Use Rules repeat this, https://docs.x.com/developer-terms/restricted-use-cases, adding an example and two sentences:

> "One example would be associating a X username with a business’s customer records (i.e. “John Doe” in your customer record is matched to @johndoe on X)."
>
> "We want people to feel comfortable to create a separate and, if they choose, pseudonymous identity on X. If you intend to associate any information about a X user with an off-X identifier, we require that you get express, opt-in consent from the user before making the association."
>
> "If a user would be surprised to learn that you are using information they provided to link their X account to an identity off of X, don’t do it."

### (c) Third parties, service providers, and AI models

Sharing with third parties. PPU Agreement, section III.A(d) and (e):

> "(d) sell, rent, lease, sublicense, distribute, redistribute, syndicate, create derivative works of, assign, or otherwise transfer or provide access to, in whole or in part, the Licensed Material to any third party except as expressly permitted in this Agreement; (e) provide use of the X API on a service bureau, rental or managed services basis, or permit other individuals or entities to create links to the X API or "frame" or "mirror" the X API on any other server, or wireless or Internet-based device, or otherwise make available to a third party any token, key, password, or other login credentials to the X API;"

Developer Policy, section "Content redistribution":

> "The best place to get X Content is directly from X. Consequently, we restrict the redistribution of X Content to third parties. If you provide X Content to third parties, including downloadable datasets or via an API, you may only distribute Post IDs, Direct Message IDs, and/or User IDs (except as described below)."
>
> "In total, you may not distribute more than 1,500,000 Post IDs to any entity (inclusive of multiple individuals associated with a single entity) within any 30 day period unless you have received written permission from X. In addition, developers may provide up to 500 public Posts Objects and/or User Objects to each person who uses your service on a daily basis if this is done via non-automated means (e.g., download of spreadsheets or PDFs)."
>
> "Any X Content provided to third parties remains subject to this Policy, and those third parties must agree to the X Terms of Service, Privacy Policy, Developer Agreement, and Developer Policy before receiving such downloads."

The API Restricted Use Rules give a different number for hydrated objects:

> "We permit limited redistribution of hydrated X content via non-automated means. If you choose to share hydrated X content with another party in this way, you may only share up to 50,000 hydrated public Post Objects and/or User Objects per recipient, per day, and should not make this data publicly available (for example, as an attachment to a blog post or in a public Github repository)."

The two pages conflict (500 per person per day against 50,000 per recipient per day); the Policy's figure is the stricter.

Service providers: not found. No page mentions service providers, processors, subprocessors or contractors acting for the developer, so none is carved out of "any third party". The Agreement points to a data protection addendum (section XIV.E: "Each party shall comply with the X Controller-to-Controller Data Protection Addendum located at https://gdpr.x.com/en/controller-to-controller-transfers.html, which may be updated by X from time to time."), which was not read for this note.

Sending X Content to a third-party AI model for analysis: not found in any contract or policy page. The only AI rule is about training. PPU Agreement, section III.A(k):

> "(k) use the X API or X Content to fine-tune or train a foundation or frontier model;"

API Restricted Use Rules:

> "In addition, at this time, X prohibits any use of the X APIs and/or X Content to fine-tune or train a foundation or frontier model with the exception of Grok."

X's non-contract pages treat sending post text to a model as an ordinary use. "What to Build", https://docs.x.com/what-to-build: "Feed X data into LLMs for sentiment analysis, content generation, and automated reporting." X's tutorial "Manage replies in real time", https://docs.x.com/x-api/posts/hide-replies/integrate/manage-replies-in-realtime, sends reply text to xAI's Grok and notes: "An earlier version of this guide used Google Jigsaw's Perspective API for toxicity scoring". These are examples, not permissions; the Agreement's third-party clause above makes no exception for them.

### (d) How long X Content may be stored or cached

No time limit found. What the documents impose is a duty to keep stored copies current.

Developer Policy, "Content compliance", the list after the sentence already in the earlier note:

> "Modified content can take various forms. This includes (but is not limited to):"
>
> - "Content that has been made private or gained protected status"
> - "Content that has been suspended from the platform"
> - "Content that has had geotags removed from it"
> - "Content that has been withheld or removed from X"

PPU Agreement, section IV.B "Removals":

> "If X Content is deleted, gains protected status, or is otherwise suspended, withheld, modified, or removed from the X Applications (including removal of location information), you will make all reasonable efforts to delete or modify that X Content (as applicable) as soon as possible, and in any case within twenty four (24) hours after a written request to do so by X or by an X user with regard to its X Content unless prohibited by law or regulation and with the express written permission of X."

Developer Policy, "Public display of Posts":

> "If you don’t use X for Websites to display content, then you must use the X API to retrieve the most current version available for display. If displayed content ceases to be available through the X API, then you must remove it from your service as soon as reasonably possible, or within 24 hours after the receipt of a removal request from X, or the applicable X account owner, or as otherwise required by applicable law."

The license, PPU Agreement section II.A, allows the developer to "Copy a reasonable amount of and display the X Content on and through your Services to Users, as permitted by this Agreement;".

On termination, PPU Agreement section VII.I: "Upon termination of this Agreement: (a) all licenses granted in this Agreement immediately expire and you must cease use of any Licensed Material; and (b) you shall permanently delete all Licensed Material in all forms and types of media, and copies thereof, in your possession."

The Developer Guidelines summary, https://docs.x.com/developer-guidelines, reads the duty more strictly than the Agreement, with a 24-hour deadline and no request needed: "Content is suspended/removed on X | 24 hours".

### (e) Describing the use case and reporting changes

Developer Policy, section "Set yourself up for success":

> "We review all proposed uses of the X developer platform to verify policy compliance — so you’re required to disclose (and update, as applicable) your planned use of the X API and X Content in order to be granted and to maintain access."
>
> "As part of this process, you’ll need to provide us with a written description of your intended uses of the X API and X Content."
>
> "Your use case description is binding on you, and any substantive deviation from it may constitute a violation of our rules and result in enforcement action. You must notify us of any substantive modification to your use case and receive approval before you may begin using X Content for that new purpose. Failure to do so may result in suspension and termination of your API and data access."
>
> "In this context, a “use case” is a consistent set of analyses, displays, or actions performed via an application."

Developer Policy, opening:

> "Finally, please note that X may monitor your use of the X API to improve the X Applications, to examine any commercial use, and to ensure your compliance with your approved use case and this Policy."

The license grant is tied to approval, PPU Agreement section II.A: "Use the X API to integrate X Content into your Services or conduct analysis of the X Content, as explicitly approved by X;". The PPU Agreement, section III.D, adds: "You agree to comply with X’s requests for additional information in connection with your usage. X may review your use of Licensed Material at any time." The same section then says, as published: "X’s granting of access to the X API or allowing use of Licensed Material shall be deemed to be approval of your use or a waiver or limitation on its right to required use that is compliant with this Agreement and X’s policies." The rest of the clause reads as though "not" is missing before "be deemed"; do not rely on this sentence as approval.

## 5. Learning of deletions without re-reading each post

### Batch compliance (documented; cost not stated)

Batch Compliance, https://docs.x.com/x-api/compliance/batch-compliance/introduction:

> "The Batch Compliance endpoints let you upload datasets of Post IDs or user IDs and receive their current compliance status. Use this to identify deleted Posts, suspended accounts, and other compliance events."

Its post events table:

> "delete | deleted | Post was deleted"
> "delete | protected | Author's account became protected"
> "delete | deactivated | Author's account was deactivated"
> "delete | suspended | Author's account was suspended"
> "rehydrate | tweet_edited | Post was edited; re-fetch it to get the current revision"
> "scrub_geo | geo_scrubbed | Author removed geo data from their Posts; delete stored geo information"

The table has no country-withheld event, so withholding is not covered by this check.

Integration guide, https://docs.x.com/x-api/compliance/batch-compliance/integrate:

> "Absence means clean. An ID missing from the results has no compliance event; your stored copy requires no action."
>
> "Run compliance jobs on a schedule. X requires stored content to reflect current compliance state; a recurring (e.g. daily or weekly) job over your stored IDs, acting on every returned event, is the intended integration pattern."

Other limits from the same guide: one active job per type ("While a tweets job is created or in_progress, creating another tweets job returns 409 Conflict."); upload "up to 100 MB (about 5 million IDs)"; the upload URL lasts "~15 minutes from job creation" and the download URL "~7 days from job creation"; "Processing has a 36-hour ceiling." Rate limits page: `POST /2/compliance/jobs` "150/15min" per app. Prerequisites listed on the introduction page are an approved developer account, a Project and App, and the App's Bearer Token; nothing says Enterprise is required.

Cost: not found. The pricing page, https://docs.x.com/x-api/getting-started/pricing, has no compliance line in its read, write or event tables, and no compliance page mentions price, credits or billing.

### Compliance streams (Enterprise only)

https://docs.x.com/x-api/compliance/streams/introduction: "These streams are available with Enterprise access and are designed to help partners that ingest high volumes of data 'listen' for compliance events such as Post edit events." The Post stream carries `delete`, `tweet_edit`, `withheld`, `drop` and `undrop`. The Developer Guidelines link to these streams under the name Compliance Firehose: "Use Compliance Firehose to receive real-time deletion events and stay compliant automatically."

### X Activity API `post.delete` (self-serve; billing conflicts)

X Activity API, https://docs.x.com/x-api/activity/introduction:

> "post.delete | Fired when the filtered user deletes a Post | user_id"

`post.delete` is listed as a public event: "For these public events, you can create subscriptions by specifying the user ID in your filter and receive them via XAA." Limits: "Posts from protected accounts are not delivered, even for public events." and a "Self-serve" tier maximum of "1,500" subscriptions.

Billing conflicts on X's own pages. The pricing page and https://docs.x.com/x-api/activity/event-pricing list "post.delete | not billed". The same event-pricing page and the introduction also say: "Billing: Each delivered Post event (post.create, post.delete, post.mention.create, post.reply.create, post.quote.create, post.repost.create) is billed as a Post."

This covers only deletions by the author, not protection, suspension or withholding. It also means subscribing to a feed of named people's activity, which is closer in form to the "investigating or tracking X users" clause in 4(a) than a batch check of stored ids is (our reading, not X's).

## Not verified

- Whether an author returned through `expansions=author_id` is billed as a User read: not stated in X's documents.
- Whether an id that comes back only in `errors` within a 200 response is billed: not stated; the FAQ covers only "failed requests".
- The `type` and `title` returned for a post from a protected account (the docs point to both `resource-not-found` and `not-authorized-for-resource`), from a suspended account, or withheld in a country: not stated for post lookup. Whether a withheld post comes back in `data` with a `withheld` object or in `errors`, and which country applies to an app-only caller: not stated.
- Which names the live `GET /2/tweets` accepts, `tweet.fields`/`note_tweet` (prose pages) or `post.fields`/`note_post` (endpoint reference and spec 2.174): not tested; no API call was made.
- Whether the rate limits page's 3,500 per 15 minutes applies to the pay-per-use plan specifically: the page does not name plans other than Enterprise.
- The cost of batch compliance jobs, and whether pay-per-use apps can use them: not stated.
- Whether `post.delete` events are billed: X's pages contradict each other.
- Whether a service provider or an AI model vendor that receives post text counts as a "third party" under section III.A(d): not addressed by any X page.
- Any limit on how long X Content may be stored: none found.
- What "investigating or tracking X users", "Background checks or any form of extreme vetting" and "Individual profiling" cover, and whether X treats founder research for an investor as any of them: not defined; only X's written approval would settle it.
- The developer.x.com pricing page (https://developer.x.com/#pricing, named in the PPU Agreement as the "Pricing Schedule") renders only with JavaScript and was not read; the Developer Console was not read.
- The X Controller-to-Controller Data Protection Addendum (gdpr.x.com) was not read.
- X's help page on country-withheld content, https://help.x.com/en/rules-and-policies/tweet-withheld-by-country, returned HTTP 403 with a "Just a moment..." JavaScript challenge; archive.org has no copy. It was not read.
