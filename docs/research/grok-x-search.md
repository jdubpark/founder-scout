# Grok X search for the hunt

Use the `x_search` tool on `POST https://api.x.ai/v1/responses` with `grok-4.7` to read a known founder's account and `grok-4.3` for discovery sweeps. It can be combined with a JSON-schema response format. It does not return post records: the Responses API returns only the model's text, a list of cited URLs, and token and fetch counts, so every post field the adapter keeps (text, date, counts) is whatever the model wrote into its answer. Each quote has to be checked by something other than Grok. Two checks are closed: X's oEmbed endpoint is barred by robots.txt on both hosts, and x.ai's own legal pages could not be read from this machine. The official X API reads one post for $0.005.

Read on 2026-11-13. Every quoted sentence was copied from a saved copy of the page named. No account was created, no key was used, no paid API was called. The one live call this note was asked to make (oEmbed) was not made, for the reason in section 6.

## 1. How the xAI API searches X

Endpoint: `POST https://api.x.ai/v1/responses` (US regional endpoint: `https://us.api.x.ai/v1`, `grok-4.7` and `grok-4.6` only). Tool: `{"type": "x_search"}`. The older `search_parameters` field ("Live Search") still appears in the Chat Completions reference with `mode`, `sources`, `from_date`, `to_date`, `max_search_results` and `return_citations`. The docs read here carry no sentence retiring it, and the X Search page does not mention it. Build on `x_search`.

Source: https://docs.x.ai/developers/tools/x-search.md

"The X Search tool enables Grok to perform keyword search, semantic search, user search, and thread fetch on X (formerly Twitter)."

### Tool settings

| Parameter | Type | Documented limit |
|---|---|---|
| `allowed_x_handles` | array of strings | Handles without `@`. "max 20; 10 in the Vercel AI SDK". Cannot be set with `excluded_x_handles`. |
| `excluded_x_handles` | array of strings | Same limits. |
| `from_date` | string `YYYY-MM-DD` | "00:00 UTC on `from_date` up to, but not including, `to_date`". Other formats "aren't applied". |
| `to_date` | string `YYYY-MM-DD` | To search one day, set it to the next day. |
| `enable_image_understanding` | boolean | Default `false`. |
| `enable_video_understanding` | boolean | Default `false`. "This is only available for X Search (not Web Search)." |

"`allowed_x_handles` cannot be set together with `excluded_x_handles` in the same request."

"Your handle and date parameters apply to every keyword and semantic search, whatever query the model writes. Thread fetches don't use them."

Not in the tool: a result count, an engagement filter, a follower filter, a language filter. The reference page for the voice-agent session lists the same six settings and says an invalid configuration (too many entries, both handle lists, an inverted date window) "is rejected with an `error` event".

Request-level settings that bound the work: `max_turns` (integer, "Maximum number of agentic tool calling turns allowed for this request"; unset means "the server applies a global default cap", value not stated), `max_output_tokens` (default 128,000), `include`, `text.format`, `store`, `safety_identifier`.

### What the model can do inside the tool

| Function (output item name) | Use | Billed as |
|---|---|---|
| `x_keyword_search` | "Keyword search with X's advanced search operators, sorted by `Top` or `Latest`" | posts fetched |
| `x_semantic_search` | "Search by meaning rather than exact words" | posts fetched |
| `x_user_search` | "Find users by name or description" | profiles fetched |
| `x_thread_fetch` | "Fetch one post with its parent posts and replies" | posts fetched |

The model picks the function and writes the query. Operators such as `min_faves:` or `from:` are X's own advanced-search operators; the page does not list them, so whether the model applies a follower or like threshold is up to the prompt and unverified.

Each call appears in `output` as an item of type `custom_tool_call` whose `call_id` starts with `xs_`. The item carries the arguments the model sent, not the results.

### Call: read one known founder's account

```
POST https://api.x.ai/v1/responses
Authorization: Bearer $XAI_API_KEY
Content-Type: application/json

{
  "model": "grok-4.7",
  "input": [{"role": "user", "content": "List the founder's posts from the last 90 days that announce a launch, a customer, revenue, a hire or a raise. For each, give the post URL, the date, and the post's exact words."}],
  "tools": [{
    "type": "x_search",
    "allowed_x_handles": ["handle_without_at"],
    "from_date": "2026-08-13",
    "to_date": "2026-11-14",
    "enable_video_understanding": true
  }],
  "max_turns": 3,
  "max_output_tokens": 4000
}
```

### Call: discovery of recent launch posts

```
{
  "model": "grok-4.3",
  "input": "Find posts from the last 7 days where the author says they just launched their own startup or product. Skip accounts of companies with more than 10,000 followers.",
  "tools": [{"type": "x_search", "from_date": "2026-11-06", "to_date": "2026-11-14"}],
  "max_turns": 4
}
```

The follower cap in the prompt is a request to the model, not a filter.

### Response shape

Source: https://docs.x.ai/developers/tools/citations.md and https://docs.x.ai/developers/tools/tool-usage-details.md

- `output[]` holds the `custom_tool_call` items and one `message` item. `message.content[]` holds `output_text` blocks.
- `output_text.text` is the answer. On the Responses API inline citations are on by default, written as `[[N]](url)`. "Pass `include=["no_inline_citations"]`" to turn them off.
- `output_text.annotations[]` holds `{"type": "url_citation", "url", "start_index", "end_index", "title"}`. `title` is the citation number as a string ("1"), not a page title. `start_index` is "the first `[` of the citation" and `end_index` is "immediately *after* the closing `)` (exclusive)".
- `response.citations` (the xAI SDK name; the Responses API returns the same list) is "a comprehensive list of URLs for all sources the agent encountered". It is "always returned by default". "Not every URL in this list will necessarily be directly referenced in the final answer." Example entries: `https://x.com/i/status/1975607901571199086` and `https://x.com/i/user/1912644073896206336`. Post URLs come in the `x.com/i/status/<id>` form, without the author's handle.
- `usage` is covered in section 3.

Raw post records: not returned. "By default, server-side tool call outputs are not returned since they can be large." The Responses API table of `include` values for tool outputs lists `web_search_call.action.sources`, `code_interpreter_call.outputs` and `file_search_call.results`, and has no row for `x_search`. The xAI Python SDK has `include=["x_search_call_output"]`. The docs do not show what that output contains, so whether it holds post text, counts or follower numbers is unverified. The tool-usage page also says "server-side tool call outputs are not returned in the API response". Plan for the model's text and the URL list as the only data.

`include` on the Responses API otherwise takes `reasoning.encrypted_content`, `inline_citations`, `no_inline_citations` and `verbose_streaming` (streaming of tool calls). For `grok-4.7` "always returns `reasoning.encrypted_content`".

## 2. Structured output with the search tool

Yes. https://docs.x.ai/developers/model-capabilities/text/structured-outputs.md, section "Structured Outputs with Tools": "You can combine structured outputs with tool calling to get type-safe responses from tool-augmented queries." It names "Server-side tools like web search, X search, and code execution". Limit stated: "Structured outputs with tools is only available for supported Grok 4 family models." The page's own example uses `web_search`; no example uses `x_search`, so the combination with `x_search` rests on that sentence.

Parameter on the Responses API: `text.format`, strict flag on:

```
{
  "model": "grok-4.7",
  "input": "...",
  "tools": [{"type": "x_search", "allowed_x_handles": ["handle"]}],
  "text": {"format": {
    "type": "json_schema",
    "name": "founder_posts",
    "strict": true,
    "schema": { "type": "object", "properties": {"posts": {"type": "array", "items": {"type": "object", "properties": {"url": {"type": "string"}, "date": {"type": "string"}, "quote": {"type": "string"}}, "required": ["url", "date", "quote"], "additionalProperties": false}}}, "required": ["posts"], "additionalProperties": false }
  }}
}
```

Composed from the X Search page and the structured-outputs page; not a documented example. The OpenAI SDK call is `client.responses.parse(..., text_format=PydanticModel)`; the JavaScript form is the `text.format` object above. The answer comes back as JSON text in `output_text.text`. The schema subset (supported types, `additionalProperties`) is on the same page; read it before writing the schema. Inline citation links are also written into text; whether they are suppressed or placed inside string fields under a schema is unverified. Send `include: ["no_inline_citations"]` to be safe, and read the URLs from `response.citations`.

## 3. Models, price, usage, rate limits

Source: https://docs.x.ai/developers/models.md, https://docs.x.ai/developers/pricing.md, https://docs.x.ai/developers/rate-limits.md. Per million tokens, for a prompt under 200k tokens (at or above 200k, every token in the request is billed at the higher rate, about double).

| Model id | Input | Cached input | Output | Context |
|---|---|---|---|---|
| `grok-4.7` | $2.00 | $0.50 | $6.00 | 500k |
| `grok-4.6` | $2.00 | $0.50 | $6.00 | 500k |
| `grok-4.5` | $2.00 | $0.30 | $6.00 | 500k |
| `grok-4.3` | $1.25 | $0.20 | $2.50 | 1M |
| `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning` | $1.25 | $0.20 | $2.50 | 1M |
| `grok-4.20-multi-agent-0309` | $1.25 | $0.20 | $2.50 | 1M |
| `grok-build-0.1` | $1.00 | $0.20 | $2.00 | 256k |

"For everything else, including code, use Grok 4.7. It is the most capable model we've built." `grok-4.3` is described as "Fast, reliable model with strong tool calling and instruction following capabilities", with `reasoning` efforts `none`, `low`, `medium`, `high`, `xhigh` (default `low`); `grok-4.7` supports `low` to `xhigh` (default `high`). Cheap and fast: `grok-4.3` at `none` or `low`. Strong: `grok-4.7`. The docs have no page listing which models accept `x_search`. The docs' Batch example sends `x_search` to `grok-4.3`, and every `x_search` example elsewhere uses `grok-4.7`; no model is documented as unable to use it.

Tool price: "X Search is billed at $5 per 1k posts fetched and $10 per 1k user profiles fetched, in addition to token costs". "Every post returned by a search or thread fetch, including parent and quoted posts, counts toward the post rate". The per-item rates apply "as of September 21, 2026". Counts are "not de-duplicated; a post returned by two searches counts twice". "Only successful tool executions ... are billed."

Other price terms: Batch API is 20% off tokens for `grok-4.7`, `4.6`, `4.5`, `4.3` and the `4.20` models. Priority processing is 2x. The US regional endpoint is 1.1x. A request refused by usage-guideline screening before generation costs "a $0.05 usage guideline violation fee per request".

Worked example from the docs: 19 posts fetched is 19 x $0.005 = $0.095 before tokens. A 3-turn read of one account that fetches 60 posts costs about $0.30 plus tokens.

Image and video: "For the view image and view x video tools, you will not be charged for the tool invocation itself but will be charged for the image tokens used to process the image or video." `usage` reports these as `prompt_image_tokens`.

Usage fields on a Responses API response (reference page, `usage` object):

- `input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens`, `output_tokens_details.reasoning_tokens`, `total_tokens`.
- `cost_in_usd_ticks` ("10'000'000'000 ticks in one *dollar*") and `cost_in_nano_usd`.
- `num_server_side_tools_used`.
- `server_side_tool_usage_details`: `x_search_calls`, `x_posts_fetched`, `x_users_fetched`, `web_search_calls`, `code_interpreter_calls`, `file_search_calls`, `document_search_calls`, `image_generation_calls`, `mcp_calls`.
- "`prompt_tokens` Represents the **cumulative input tokens** across all inference requests made during the agentic process" and "`completion_tokens` Represents **only the final text output**". The page uses the Chat Completions names for these; the Responses names are `input_tokens` and `output_tokens`.

Rate limits are per team and per model, set by tier from cumulative spend since 2026-01-01: Tier 0 $0, Tier 1 $50, Tier 2 $250, Tier 3 $1,000, Tier 4 $5,000. Limits are requests per second and tokens per minute; over the limit returns HTTP 429.

| Model | Tier 0 RPS | Tier 0 TPM | Tier 4 RPS | Tier 4 TPM |
|---|---|---|---|---|
| `grok-4.7`, `4.6`, `4.5` | 150 | 50M | 500 | 100M |
| `grok-4.3`, `grok-4.20-0309-*`, `grok-build-0.1` | 37 | 10M | 208 | 85M |
| `grok-4.20-multi-agent-0309` | 9 | 2.5M | 56 | 21M |

No separate X Search rate limit is documented.

## 4. Video and image understanding

The X Search page says only: "Setting `enable_video_understanding` to true allows the agent to analyze videos in X posts." and "Setting `enable_image_understanding` to true allows the agent to analyze images in X posts encountered during the search process." The pricing page lists "X Video Understanding | `view_x_video` | Analyze videos found during X Search | Token-based" and "Image Understanding | `view_image`" as token-based. Output items for these are the `view_x_video` and `view_image` tool names in `server_side_tool_usage`.

Not documented anywhere read: maximum video length, number of videos per request, whether the model hears audio or reads captions, what a video costs in tokens. Measure it on a few real videos and read `prompt_image_tokens` and `cost_in_usd_ticks`. The docs page for image input says the maximum image is 20 MiB and `jpg/jpeg` or `png`, which describes images you send, not images the tool finds. The page https://docs.x.ai/developers/model-capabilities/video/video-understanding.md returned 404.

## 5. xAI terms

The live pages https://x.ai/legal, https://x.ai/legal/terms-of-service-enterprise, https://x.ai/legal/acceptable-use-policy, https://x.ai/legal/privacy-policy and https://x.ai/legal/data-processing-addendum all returned HTTP 403 with a Cloudflare challenge page to `curl`. No challenge was bypassed. The quotes below come from two sources:

- Primary: https://docs.x.ai/developers/faq/security.md (read directly).
- Secondary: Internet Archive copies of the vendor's own pages, https://web.archive.org/web/20261111135713/https://x.ai/legal/terms-of-service-enterprise (page text says "Last Updated: October 27, 2026") and https://web.archive.org/web/20261113074700/https://x.ai/legal/acceptable-use-policy (page text says "Effective: August 14, 2026 (previous version)"). The live AUP may be newer than the archived one. Section numbers were not preserved in the saved text, so quotes are cited by heading.

Training and retention (API):

- FAQ: "SpaceXSI never trains on your API inputs or outputs without your explicit permission."
- FAQ: "By default, all API requests and responses are stored on our servers (encrypted at rest) for 30 days for auditing purposes in the event of suspected abuse or misuse. SpaceXSI does not train on this data, and it is automatically deleted after 30 days."
- Enterprise Terms, "User Content": "SpaceXSI will not use any User Content to train any foundation models, large language models, or other artificial intelligence systems or to develop any new products, services, or features, subject to disclosures to Customer and Customer-controlled user settings."
- Enterprise Terms, "De-Identified and Aggregated Data": "Except when Customer elects to use SpaceXSI's Zero Data Retention-enabled APIs ("ZDR-Enabled API" or "ZDR"), SpaceXSI may create and use, for any lawful purpose, de-identified and/or aggregated data derived from Customer's use of the Services".
- Enterprise Terms, "Deletion and Retention of User Content": "All User Content will be automatically and permanently deleted no later than 30 days after the end of the interaction or session in which it was submitted unless a different retention period is: ... (c) reasonably necessary for safety, security, compliance, moderation, abuse prevention, or investigation of suspected violations of this Agreement".
- ZDR (FAQ): "For most customers, we do not recommend enabling ZDR". It is team-wide, self-serve for a team admin, and it disables the stateful Responses API, Files, Collections, Batch and deferred completions. Every response carries an `x-zero-data-retention` header.

(a) Storing outputs. Enterprise Terms, "Rights in Input and Output": "Customer (a) retains all right, title, and interest (including all intellectual-property rights) in and to the Input; and (b) owns all right, title, and interest in the Output in perpetuity". Storing Output is not restricted. Two limits sit next to it. Same section: "Customer will not, and will not permit any third party to: (i) use any Output to train any foundation models, large language models, or other artificial intelligence systems except as may be expressly permitted in an Order Form". AUP, under "Detrimentally impacting the Service": "Scraping, harvesting or reselling any Input or Output, or distilling model data or Outputs". A dossier kept for the partner's own use is not reselling; sharing Output with third parties is not addressed.

(b) Profiles of individuals and personal data.
- Enterprise Terms, "Zero Data Retention": "Customer represents and warrants that it will not intentionally submit, and will use reasonable efforts to prevent Permitted Users and End Users from submitting any Personal Data to the Services except through SpaceXSI's ZDR-Enabled API." This is the sentence that bears most on a founder dossier. "Personal Data" is not defined in the archived text (searched); a founder's name and posts are personal data under most privacy laws. Read literally, founder data should go through a ZDR-enabled team. Whether `x_search` runs under ZDR is not stated in the pages read.
- Enterprise Terms, "Privacy": for personal data in submitted data, "SpaceXSI will process such data as a processor on Customer's behalf, and SpaceXSI's Data Processing Addendum ... shall automatically apply." The DPA was not read.
- Enterprise Terms, "User Content": Customer "is solely responsible for all Input" and warrants "that, to the best of its knowledge: (a) it has and will maintain all rights, licenses, consents, permissions, and authorizations, and has obtained all required consents, necessary to submit Input to the Services".
- AUP: "Using the Service in a way that infringes, misappropriates or violates a person's privacy or their right to publicity", "Engaging in stalking, doxing, or phishing", and "Making high-stakes automated decisions that affect a person's safety, legal or material rights, or well-being (such as making financial credit, educational, employment, housing, insurance, legal, medical, or other important decisions about or for them)". Whether funding triage is a "high-stakes automated decision" is a legal reading; the repo's rule that code, not a model, decides, with a person making the call, is the relevant mitigation.
- AUP: "Operating in a regulated industry without complying with those regulations, for example, by using the Services to unlawfully buy or sell securities or to provide or receive advice about securities". A venture investor's use is likely outside this, but it is the sentence to show counsel.
- AUP: "Accessing the Services through unauthorized automated or non-human means, whether through a bot, script, or otherwise". An authorized API client is not unauthorized; stated for completeness.
- Retention under the 30-day default means prompts that hold founder names sit at xAI for 30 days unless ZDR is on.

(c) Training: see the three quotes above. Training on API data needs explicit permission, with the "subject to disclosures to Customer and Customer-controlled user settings" qualifier.

## 6. Checking a quoted post with X's oEmbed

Documented by X: https://docs.x.com/x-for-websites/oembed-api.md. "Requires authentication? | No". "Rate limited | No". Resource URL `https://publish.x.com/oembed`. Parameter `url` (required, "The URL of the Tweet to be embedded"), plus `maxwidth` (220 to 550), `hide_media`, `hide_thread`, `omit_script`, `align`, `lang`, `theme`, `dnt`. Format: JSON. "Please note that the API is recommended for performing tasks in bulk, and we advise using our robust publish.x.com tool for embedding content." The page's example request uses `twitter.com/.../status/<id>` in the `url` value and its `twurl` example uses `x.com/...`; both host forms appear in X's examples. Which hosts the endpoint accepts is not stated in a rule; the second form is only shown as a profile URL.

robots.txt, read with `/usr/bin/curl -sL -A "Mozilla/5.0"` on 2026-11-13, HTTP 200 on both hosts:

```
https://publish.twitter.com/robots.txt
User-agent: *
Disallow: /oembed

https://publish.x.com/robots.txt
User-agent: *
Disallow: /oembed
```

The generic user agent is disallowed on `/oembed` on both hosts. The repo's rule is that robots.txt is obeyed everywhere except the one recorded exception for the professional network, so the live oEmbed calls were not made. X's documentation invites programmatic use and its robots.txt forbids it; the two disagree, and the choice to read it despite robots.txt belongs to the partner, as it did for the professional network. I did not make it for them.

What the endpoint returns, from X's own docs example (not a live response; the post is 2014, from the `@Interior` account), trimmed:

```
{
  "url": "https:\/\/twitter.com\/Interior\/status\/463440424141459456",
  "author_name": "US Department of the Interior",
  "author_url": "https:\/\/twitter.com\/Interior",
  "html": "<blockquote class=\"twitter-tweet\"><p lang=\"en\" dir=\"ltr\">Sunsets don&#39;t get much better than this one over <a href=\"https:\/\/twitter.com\/GrandTetonNPS?ref_src=twsrc%5Etfw\">@GrandTetonNPS<\/a>. ... <a href=\"http:\/\/t.co\/YuKy2rcjyU\">pic.x.com\/YuKy2rcjyU<\/a><\/p>&mdash; US Department of the Interior (@Interior) <a href=\"https:\/\/twitter.com\/Interior\/status\/463440424141459456?ref_src=twsrc%5Etfw\">May 5, 2014<\/a><\/blockquote>\n<script async src=\"https:\/\/platform.x.com\/widgets.js\" charset=\"utf-8\"><\/script>\n",
  "width": 550, "height": null, "type": "rich", "cache_age": "3153600000",
  "provider_name": "Twitter", "provider_url": "https:\/\/twitter.com", "version": "1.0"
}
```

The `html` holds the post text, the author's display name and handle, and the date, with no counts and no follower number. It is the fallback blockquote; the docs say "The format of the returned markup may change over time". Whether the text is complete for a long post (over 280 characters) or one with media is not stated. A quote check would parse the `<p>` text, decode entities, and compare the words.

## 7. The official X API as the alternative

Source: https://docs.x.com/x-api/getting-started/pricing.md. "The X API uses **pay-per-usage** pricing. No subscriptions". Charged "per resource fetched (reads)":

| Resource | Unit cost |
|---|---|
| Posts: Read | $0.005 per resource |
| User: Read | $0.010 per resource |
| Following/Followers: Read | $0.010 per resource |
| Counts: Recent | $0.005 per request |

Reading one post by id costs $0.005. Reading one user, with the `public_metrics` field (followers, following, post count, listed count) on the same resource, costs $0.010; the page does not price fields separately. "All resources are deduplicated within a **24-hour UTC day window**": a second read of the same post that UTC day is free. "Pay-per-usage plans are capped at **3 million Post reads per monthly billing cycle**." Credits are bought in the Developer Console; a developer account application that describes the use is required ("you're required to disclose ... your planned use of the X API and X Content in order to be granted and to maintain access").

Constraining sentences. Developer Policy, https://docs.x.com/developer-terms/policy.md ("Content compliance"): "If you store X Content offline, you must keep it up to date with the current state of that content on X. Specifically, you must delete or modify any content you have if it is deleted or modified on X. This must be done as soon as reasonably possible, or within 24 hours after receiving a request to do so by X or the applicable X account owner". Developer Agreement (Last Updated: April 27, 2026), https://docs.x.com/developer-terms/agreement.md, restrictions list: "(g) use the Licensed Material to derive or obtain non-public information of individual X users; (k) use the X API or X Content to fine-tune or train a foundation or frontier model". Developer Policy ("Off-X matching"): "We limit the circumstances under which you may match a person on X to information obtained or stored off-X. ... You may only do this if you have express opt-in consent from the person before making the association, or as described below." The exceptions allow matching on public data, which includes "Posts", "Profile information, including an account bio and publicly-stated location" and "Display name and @handle". Redistribution: "you may only distribute Post IDs, Direct Message IDs, and/or User IDs", with 500 public Post or User objects a day per person via non-automated means.

The most constraining sentence for the hunt is the 24-hour deletion rule: a stored post has to be re-checked and removed when the author deletes it, so a dossier that keeps post text needs a refresh job. This applies to content obtained through the X API under X's agreement. Whether it reaches content Grok read and summarised under xAI's terms is not stated by either vendor.

## What this means for the adapter

- Treat Grok's answer as a lead, never as evidence. Ask for a JSON list of `{url, date, quote}`; keep an item only if the quote is found on the post. The post can be read only through the X API ($0.005) or oEmbed (barred by robots.txt); a page fetch of x.com needs a login or JavaScript and was not tried.
- Counts and follower numbers in Grok's text are the model's words. Take them from `GET /2/users` `public_metrics` ($0.010) or leave them out.
- Read `x_posts_fetched`, `x_users_fetched`, `x_search_calls` and `cost_in_usd_ticks` on every response and count them against the run's spend cap. Set `max_turns`, a handle list and a date window on every call; they are the only cost controls the tool has.
- Decide on ZDR and the personal-data sentence in the Enterprise Terms before founder names go into prompts.
- Send `safety_identifier` (a hash, never an email or name) per swarm or partner, so one violation is not charged to the whole key.

## Not verified

- A live `x_search` response. No key was used, so the shape of `custom_tool_call` items, the `annotations` for X posts, and what the model puts in prose are from the docs, not from a response.
- What `include=["x_search_call_output"]` (xAI SDK) returns, and whether an equivalent exists on the REST Responses API. The REST `include` table has no `x_search` row.
- That a `text.format` JSON schema works with `x_search` specifically (docs example uses `web_search`), and how inline citations behave inside a schema-bound answer.
- Which models accept `x_search`. No list exists in the pages read.
- Video limits (length, count, audio, token cost). Image limits for images found in posts.
- Whether the tool applies engagement or follower operators when asked, and any cap on posts per search.
- The default value of `max_turns`.
- Whether `x_search` is available under ZDR.
- xAI's live legal pages (403 challenge). Quotes come from Internet Archive copies, one of which the page labels "previous version". The Data Processing Addendum, the Privacy Policy, the Consumer Terms and the "Startup Terms" were not read. "Personal Data" is not defined in the saved Enterprise Terms text.
- Live oEmbed behaviour: accepted URL hosts, whether the `html` holds the full text of a long post, any real rate limit. Not called because robots.txt disallows `/oembed`.
- Whether the Developer Agreement's 24-hour deletion rule or its restrictions reach data obtained through Grok.
- The current X API price of a single user read with `public_metrics`: the page gives $0.010 per User resource; the Developer Console rate card was not read ("Current rates are always available in the Developer Console").

## Sources

All read 2026-11-13.

- https://docs.x.ai/llms.txt and https://docs.x.ai/llms-full.txt (index and full text, used for the Responses API reference)
- https://docs.x.ai/developers/tools/x-search.md
- https://docs.x.ai/developers/tools/citations.md
- https://docs.x.ai/developers/tools/tool-usage-details.md
- https://docs.x.ai/developers/tools/advanced-usage.md
- https://docs.x.ai/developers/model-capabilities/text/structured-outputs.md
- https://docs.x.ai/developers/models.md, https://docs.x.ai/developers/models/grok-4.7.md, https://docs.x.ai/developers/models/grok-4.3.md
- https://docs.x.ai/developers/pricing.md
- https://docs.x.ai/developers/rate-limits.md
- https://docs.x.ai/developers/faq/security.md
- https://web.archive.org/web/20261111135713/https://x.ai/legal/terms-of-service-enterprise (secondary: archive copy of the vendor page)
- https://web.archive.org/web/20261113074700/https://x.ai/legal/acceptable-use-policy (secondary: archive copy of the vendor page)
- https://docs.x.com/x-for-websites/oembed-api.md
- https://publish.twitter.com/robots.txt and https://publish.x.com/robots.txt
- https://docs.x.com/x-api/getting-started/pricing.md
- https://docs.x.com/developer-terms/policy.md and https://docs.x.com/developer-terms/agreement.md
