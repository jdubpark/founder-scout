# Rapid runner models: speed, structured output, data handling (as of 2026-11-13)

Scope: facts for choosing a small, fast model for "runner" calls (one web page of 2k to 15k tokens in, schema-matching JSON out, hundreds to thousands per day, many in parallel). No recommendation beyond the implications list. Prices, IDs and context sizes are reused from `docs/research/models-2026-11.md` unless stated. All pages below were fetched on 2026-11-13 with `curl` (no WebFetch tool in this session) unless another date is shown.

## Source tags

| Tag | URL | Date |
|---|---|---|
| AA-ember | https://artificialanalysis.ai/models/muse-ember/providers (and `/muse-ember-xhigh/providers`) | fetched 2026-11-13; AA says speed and latency are 5-day averages |
| AA-ds1017 | https://artificialanalysis.ai/models/deepseek-v4-1-flash-1017-non-reasoning/providers | same |
| AA-ds-nr | https://artificialanalysis.ai/models/deepseek-v4-1-flash-non-reasoning/providers (pre-1017 snapshot) | same |
| AA-ds-max | https://artificialanalysis.ai/models/deepseek-v4-1-flash/providers | same |
| AA-spark | https://artificialanalysis.ai/models/muse-spark-1-3/providers and `/muse-spark-1-3-xhigh/providers` | same |
| AA-glimmer | https://artificialanalysis.ai/models/muse-glimmer/providers | same |
| AA-haiku | https://artificialanalysis.ai/models/claude-haiku-5-5/providers and `/claude-haiku-5-5-low/providers` | same |
| AA-luna | https://artificialanalysis.ai/models/gpt-6-luna-non-reasoning/providers and `/gpt-6-luna/providers` | same |
| AA-models | the AA model overview pages for the same slugs (embedded model data, fields `omniscienceHallucinationRate`, `omniscienceAccuracy`) | same |
| M-docs | https://dev.meta.ai/llms.txt (index of Meta Model API docs as Markdown) and the pages cited below | same |
| M-struct | https://dev.meta.ai/docs/structured-output.md | same |
| M-tools | https://dev.meta.ai/docs/tool-calling.md | same |
| M-price | https://dev.meta.ai/docs/pricing-rate-limits.md | same |
| M-reason | https://dev.meta.ai/docs/reasoning.md | same |
| M-ember | https://dev.meta.ai/docs/muse-ember.md | same |
| M-terms | https://dev.meta.ai/legal/terms-of-service ("Last updated: October 9, 2026") | same |
| M-commit | https://dev.meta.ai/legal/commitments (no date shown) | same |
| M-geo | https://dev.meta.ai/legal/geographic-use-policy ("Last updated: November 9, 2026") | same |
| DS-json | https://api-docs.deepseek.com/guides/json_mode (no date shown) | same |
| DS-tools | https://api-docs.deepseek.com/guides/tool_calls (no date shown) | same |
| DS-chat | https://api-docs.deepseek.com/api/create-chat-completion (no date shown) | same |
| DS-rate | https://api-docs.deepseek.com/quick_start/rate_limit (no date shown) | same |
| DS-price | https://api-docs.deepseek.com/quick_start/pricing (no date shown) | same |
| DS-search | https://api-docs.deepseek.com/guides/search (no date shown) | same |
| DS-log | https://api-docs.deepseek.com/updates (newest entry dated 2026-11-13) | same |
| DS-terms | https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html (release 2026-04-22, effective 2026-04-29) | same |
| DS-priv | https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy-2025-02-14.html ("Last Update: February 14, 2025") | same |
| FR-DHS | https://public-inspection.federalregister.gov/2026-21447.pdf (Docket DHS-2026-0628, publication date 2026-10-20) | same |
| TG-priv | https://docs.together.ai/docs/privacy-and-security (no date shown) | same |
| FW-zdr | https://docs.fireworks.ai/guides/security_compliance/data_handling (page title "Zero Data Retention", no date shown) | same |
| VEC | https://github.com/vectara/hallucination-leaderboard (README, "Last updated on October 22, 2026") | same |
| AN-so | https://platform.claude.com/docs/en/build-with-claude/structured-outputs | same |
| AN-rl | https://platform.claude.com/docs/en/api/rate-limits | same |
| AN-ret | https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data | same |
| OAI-luna | https://developers.openai.com/api/docs/models/gpt-6-luna | same |

## Findings first

- Speed on Artificial Analysis (AA), measured on non-reasoning endpoints: DeepSeek V4.1 Flash 1017 runs at 141 tokens/s with 1.35 s time to first token (TTFT) on DeepSeek's own API, and 261 tokens/s with 0.81 s on CoreWeave. Fast variants reach 378 tokens/s (Inco FAST) on the 1017 snapshot and 781 tokens/s with 0.28 s on Baseten FAST (pre-1017 snapshot).
- Muse Ember is fast on output (440 tokens/s) but has a TTFT of 4.9 s at AA's tested effort (max, its default). Meta's docs say reasoning cannot be turned off on Ember, Spark or Wonder (`"none"` returns HTTP 400). AA measured only max and xhigh for Ember, so TTFT at `minimal` is unmeasured.
- Meta documents a strict JSON Schema mode with constrained decoding (`response_format` `json_schema`). DeepSeek documents only `json_object` (valid JSON, no schema), and says the output may come back as blank spaces. DeepSeek's `strict` mode applies to tool-call arguments only and is still Beta.
- Data handling differs sharply. DeepSeek's first-party terms are governed by PRC law and its privacy policy says servers are in the PRC. Meta's Standard tier (which includes Ember and Spark 1.3 non-contributor) promises no training on content; the Contributor tier trains on it.

## Comparison table

Speed columns are AA end-to-end output speed and time to first token as measured on the page's headline workload (average of AA's single-request and multi-turn workloads), unless a size is given. "1k / 10k / 100k" are AA's input-size workloads; 10k is closest to the runner use. Reasoning effort in brackets where it applies. Measurement date for every speed cell: AA pages fetched 2026-11-13, each a 5-day average.

| Row | Price in / out per MTok | Output tokens/s | TTFT | Strict JSON schema | Tool calling | Concurrency limit | Where data is processed | Used for training |
|---|---|---|---|---|---|---|---|---|
| deepseek-flash, first-party (V4.1-Flash-1017, non-thinking) | $0.15 / $0.60 off-peak, $0.30 / $1.20 peak (DS-price) | 141 headline; 169 at 10k (AA-ds1017) | 1.35 s headline; 1.20 s at 10k (AA-ds1017) | No. `json_object` only (DS-json). Tool-arg `strict` is Beta (DS-tools) | Yes (DS-price, DS-tools) | 2,500 per account (DS-rate) | Not stated for the API. The privacy policy says it stores data on servers in the PRC (DS-priv). Terms governed by PRC law (DS-terms) | Unverified. Privacy policy lists model training as a use for the Services; the API terms do not state it either way |
| deepseek-flash on US host (CoreWeave, 1017 non-reasoning) | Not checked for CoreWeave. Together and Fireworks list $0.30 / $1.20 per `models-2026-11.md` | 261 headline; 304 at 10k (AA-ds1017) | 0.81 s headline; 0.57 s at 10k (AA-ds1017) | Unverified per host. AA marks JSON mode and function calling as supported by all 6 listed providers (AA-ds1017) | Yes (AA-ds1017) | Unverified per host | Host-dependent. Fireworks: no logging or storage of prompts for open models by default (FW-zdr). Together: stores prompts by default unless the org turns storage off (TG-priv) | Fireworks: not stated beyond "does not log or store". Together: opt-in only, off by default (TG-priv) |
| deepseek-flash, other US host (Fireworks, pre-1017 V4.1 Flash non-reasoning) | $0.30 / $1.20 (`models-2026-11.md`) | 171 headline; 198 at 10k (AA-ds-nr) | 1.83 s headline; 1.09 s at 10k (AA-ds-nr) | As above | As above | Unverified | As above | As above |
| muse-ember-1.0 [max, the default] | $0.10 / $0.50 up to 200K input; $0.30 / $1.50 above (M-price) | 440 headline; 522 at 10k (AA-ember) | 4.89 s headline; 7.77 s at 10k (AA-ember) | Yes, `response_format` `json_schema`, constrained decoding (M-struct) | Yes; `parallel_tool_calls` default true; arguments not guaranteed (M-tools) | None stated. Per team: 3,000 requests/min, 4,000,000 tokens/min (M-price) | Not stated. Terms name Meta Platforms, Inc., or Meta Platforms Ireland Limited for customers in the European Region (M-terms) | No. Ember is a Standard Model; Standard Services content is not used to train (M-geo, M-terms 5.1) |
| muse-ember-1.0 [xhigh] | same | 442 headline; 535 at 10k (AA-ember) | 4.00 s headline; 4.98 s at 10k (AA-ember) | same | same | same | same | same |
| muse-spark-1.3 [max] | $1.25 / $4.25 (M-price) | 138 headline (AA-spark) | 29.72 s headline (AA-spark) | Yes (M-struct) | Yes (M-tools) | Per team: 3,000 requests/min, 4,000,000 tokens/min (M-price) | Not stated | No for `muse-spark-1.3`. Yes for `muse-spark-1.3-contributor` ($0.10 / $0.20) (M-geo, M-terms 6.1) |
| muse-spark-1.3 [xhigh] | same | 221 headline (AA-spark) | 16.89 s headline (AA-spark) | same | same | same | same | same |
| muse-glimmer-30b on a US host [high reasoning] | Together $0.35 / $1.50; DeepInfra $0.30 / $1.20 (AA-glimmer FAQ, matches `models-2026-11.md` for Together) | Together 95; DeepInfra 68 (AA-glimmer) | Together 1.19 s to first token, 13.56 s to first answer token; DeepInfra 2.20 s and 16.46 s (AA-glimmer) | Unverified per host. AA marks JSON mode and function calling as supported by both (AA-glimmer) | Yes (AA-glimmer) | Unverified | Together and DeepInfra; see data section for Together | Together: opt-in only, off by default (TG-priv). DeepInfra: unverified |
| claude-haiku-5-5 (comparison) [low effort] | $0.10 / $0.50 as shown on AA's page, not checked on Anthropic's pricing page (AA-haiku) | 213 headline; 241 at 10k (AA-haiku low) | 6.99 s headline; 10.79 s at 10k (AA-haiku low). At max effort AA shows 256 tokens/s and a 176 s TTFT | Yes, constrained decoding via `output_config.format` `json_schema`; strict tool use (AN-so) | Yes (AN-so) | No concurrency cap stated. Rate limits in requests, input and output tokens per minute; first-listed tier: 4,000 / 2,000,000 / 400,000 (AN-rl) | Not stated on the pages read | Unverified. Retention page: inputs and outputs deleted within 30 days by default (AN-ret) |
| gpt-6-luna (comparison) [non-reasoning] | $0.10 / $0.50 (AA-luna, matches `models-2026-11.md`) | 90 headline; 114 at 10k (OpenAI endpoint) (AA-luna) | 1.74 s headline; 1.89 s at 10k (AA-luna). At max effort AA shows 107 tokens/s and 78.94 s | Yes, Structured Outputs (OAI-luna page lists it; guide documented in `models-2026-11.md`) | Yes. On Chat Completions, function calling works only with `reasoning_effort` set to `none` (OAI-luna) | No concurrency cap stated. Per tier: Build 5,000 RPM / 2,000,000 TPM up to Grow 30,000 / 180,000,000 (OAI-luna) | Global endpoint location not stated; EU data residency available (`models-2026-11.md`) | No unless opted in (`models-2026-11.md`, from OpenAI's data-controls page) |

AA caveats that matter for reading the table:

- AA labels some pages by reasoning effort. Ember, Spark 1.3, Glimmer, Haiku and Luna (max) pages measure the model with reasoning on. A reasoning model's TTFT on those pages includes thinking time. For DeepSeek, AA publishes a non-reasoning page for the 1017 snapshot, which is what the first rows use. DeepSeek's own docs say thinking is on by default (see section 3), so a runner must disable it to match those numbers.
- The 1017 non-reasoning page does not list Together or Fireworks. Fireworks appears only on the pre-1017 non-reasoning page. Together appears only on the "(max)" page for V4.1 Flash, where first-answer-token latency is 21.79 s, so no non-reasoning Together figure exists in what I fetched.
- AA lists 8 providers on the pre-1017 non-reasoning page, including Baseten (FAST) at 781 tokens/s and 0.28 s TTFT (10k: 919 tokens/s, 0.22 s), Bitdeer AI at 323, CoreWeave at 214, Crusoe at 199.
- AA lists 6 providers on the 1017 non-reasoning page: DeepSeek 141, Inco (FAST) 378, Modular 218, Modal 148, CoreWeave 261, Scaleway 136 tokens/s.

## 1. Speed

Measured by Artificial Analysis, fetched 2026-11-13, averages over the past 5 days (AA states "Speed and latency metrics average each endpoint's runs over the past 5 days"; AA says it runs the benchmark every 6 hours). AA defines output speed as "output tokens, including reasoning tokens, received per second over a request's full duration, from sending the request to receiving the final token", so it includes TTFT.

DeepSeek V4.1 Flash 1017, non-reasoning (AA-ds1017):

| Endpoint | Headline tokens/s | Headline TTFT | 1k / 10k / 100k tokens/s | 1k / 10k / 100k TTFT |
|---|---|---|---|---|
| DeepSeek (first-party) | 141 | 1.35 s | 139 / 169 / 158 | 0.94 / 1.20 / 2.52 s |
| Inco (FAST) | 378 | 1.52 s | 418 / 475 / 350 | 0.58 / 1.29 / 3.20 s |
| Modular | 218 | 0.89 s | 221 / 253 / 208 | 0.45 / 0.67 / 1.81 s |
| Modal | 148 | 1.08 s | 140 / 164 / 136 | 0.48 / 0.69 / 2.96 s |
| CoreWeave | 261 | 0.81 s | 254 / 304 / 297 | 0.44 / 0.57 / 2.21 s |
| Scaleway | 136 | 2.48 s | 160 / 189 / 65 | 1.57 / 1.60 / 7.30 s |

AA also reports first-party error rates: DeepSeek 3.8 % in the provider table (AA-ds1017) against 0.0 % to 0.8 % for CoreWeave, Modal, Modular, Inco. The earlier headline metric block for DeepSeek shows `endpointErrorRate` 0 in the embedded data and 3.8 % in the rendered table; the two disagree in the page source, so treat the DeepSeek error rate as unsettled.

DeepSeek V4.1 Flash non-reasoning, pre-1017 snapshot (AA-ds-nr), selected US hosts: Fireworks 171 tokens/s, 1.83 s (10k: 198, 1.09 s); CoreWeave 214, 0.85 s; Baseten (FAST) 781, 0.28 s; Modal 209, 0.88 s; Crusoe 199, 0.77 s.

DeepSeek V4.1 Flash on Together AI appears only on the "(max)" page (AA-ds-max): 344 tokens/s headline and 348 at 10k, with 21.79 s to first answer token. That is a reasoning measurement and does not describe a non-thinking runner call.

Muse Ember (AA-ember, Meta is the only provider AA lists):

- Max effort: 440 tokens/s, TTFT 4.89 s (1k: 512 tokens/s, 5.71 s; 10k: 522, 7.77 s; 100k: 425, 8.89 s). Multi-turn workload: 394 tokens/s, 2.32 s.
- Xhigh effort: 442 tokens/s, TTFT 4.00 s (1k: 484, 4.39 s; 10k: 535, 4.98 s; 100k: 384, 6.00 s).
- AA lists no lower efforts for Ember. Meta's default effort for Ember is `"max"` (M-reason).

Muse Spark 1.3 (AA-spark): max 138 tokens/s, 29.72 s TTFT (10k: 130, 50.24 s); xhigh 221 tokens/s, 16.89 s (10k: 242, 18.62 s). Meta's default effort for Spark is `"high"` (M-reason); AA has no `high` or lower page for 1.3.

Muse Glimmer 30B (AA-glimmer, "high" reasoning): Together AI 95 tokens/s, 1.19 s TTFT, 13.56 s to first answer token (10k: 100 tokens/s, 0.72 s TTFT); DeepInfra 68 tokens/s, 2.20 s TTFT, 16.46 s to first answer token. AA lists only these two hosts.

Comparison models:

- Claude Haiku 5.5 (AA-haiku): low effort 213 tokens/s, TTFT 6.99 s (10k: 241 tokens/s, 10.79 s). Max effort 256 tokens/s, TTFT 175.95 s. AA lists no non-thinking Haiku 5.5 page; I tried `-non-reasoning` and got a 404.
- GPT-6 Luna (AA-luna): non-reasoning OpenAI 90 tokens/s, 1.74 s (10k: 114, 1.89 s); Azure 84 tokens/s, 1.61 s. Low effort OpenAI 89 tokens/s, 3.26 s. Max effort OpenAI 107 tokens/s, 78.94 s.

Other fast hosts the lead asked about:

- Groq: its models page lists `meta-models/muse-spark-open` as "Contact Sales" and no DeepSeek V4 or Muse Ember, Spark 1.3 or Glimmer entry (https://console.groq.com/docs/models, fetched 2026-11-13).
- Cerebras: its shared-inference catalog lists only `gpt-oss-120b` (about 3000 tokens/s) and `qwen-3.8-27b` (about 1850 tokens/s) (https://inference-docs.cerebras.ai/models/overview, fetched 2026-11-13). No DeepSeek or Muse model.
- SambaNova, Together and Fireworks pages for these exact models: see Unverified.

## 2. Meta Model API: structured output, tools, limits

Quotes are from Meta's docs (M-struct, M-tools, M-price, M-reason, M-ember), fetched 2026-11-13.

Structured output:

- "Set `response_format` to `type: "json_schema"` and provide your schema in the `json_schema` field. The model constrains token generation to produce only valid JSON matching your schema. This is not post-processing: decoding itself is constrained, so the output is guaranteed to conform." (M-struct)
- "`text.format` is the Responses API parameter for structured output. `response_format` is the Chat Completions equivalent." (M-struct)
- Strict flag: "`strict` defaults to `false` on every surface... For structured output (`response_format` / `text.format`), the response is always constrained to your JSON Schema, so `strict: false` currently behaves the same as `strict: true`. The `strict` flag only controls whether the server additionally validates your schema against the strict subset." With `strict: true` the root must be a plain object, `allOf` and `oneOf` are not supported, every object needs `additionalProperties: false`, and `required` must list every property. (M-struct)
- Schema limits, each returning HTTP 400 when exceeded: nesting depth 10; 5,000 total properties; 120,000 total string characters; 1,000 enum values; 200,000 expanded nodes. "Recursive schemas... are not supported. A request containing a recursive JSON schema returns `HTTP 400`." (M-struct)
- Plain JSON mode (`response_format` `json_object`): no mention anywhere in the Meta docs pages I read (M-struct, M-tools, chat-completions guide). Not documented.
- Meta's Ember page says it "works with... structured output" and recommends it for extraction: "Get schema-guaranteed JSON from routing and extraction steps with structured output." (M-ember)
- Ember accepts "the same request body as Muse Spark, so switching most examples is a model ID change." (M-ember)

Tool calling:

- Function tools are supported on Chat Completions and Responses. "The model may return multiple calls in `tool_calls` in one turn... To limit the model to one call per turn, set `parallel_tool_calls: false` (default `true`)." (M-tools)
- `strict` on function tools "controls only schema validation" of your `parameters`. Quote: "Regardless of `strict`, the model's generated arguments are guided by your `parameters` schema but are not guaranteed to validate against it. Always parse and validate arguments in your own code before using them." (M-tools)

Reasoning:

- "`"none"` Disables reasoning. Not supported by Muse Wonder, Muse Spark, or Muse Ember: returns `HTTP 400`." The lowest accepted value is `"minimal"`: "Shortest reasoning pass." (M-reason)
- "When you omit the parameter, the model reasons at its default level: `"max"` on Muse Wonder and Muse Ember, and `"high"` on every Muse Spark version." (M-reason)
- "Reasoning tokens count toward your output-token budget (`max_tokens`...)... If the model spends most of the budget on reasoning, the visible response may be truncated." Reasoning tokens "are billed at the same rate as visible output tokens." (M-reason)

Rate limits (per team, not per key) (M-price):

| Model | Requests/min | Tokens/min |
|---|---|---|
| `muse-ember-1.0` | 3,000 | 4,000,000 |
| `muse-spark-1.3` | 3,000 | 4,000,000 |
| `muse-spark-1.3-contributor` | 150 | 3,000,000 |

- "Rate limits apply per team, not per API key: requests, tokens, and streams from every key in a team count toward the same limits. Each model below has its own limits, so traffic to one model doesn't use up another's."
- No concurrency limit is stated for the reasoning models. Concurrent streams are listed only for Muse Voice Transcribe (256).
- Retry guidance: exponential backoff with jitter on HTTP 429, honouring `Retry-After`; headers `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests` on successful responses.
- Token counting: "Token usage counts only your input and output tokens." Meta injects steering context that is not billed (M-price).
- Muse Ember page: "run the same task over thousands of images, files, or records... with many Muse Ember requests running in parallel." (M-ember). Ember limits: 1,048,576 context, 524,288 max output (M-ember).

## 3. DeepSeek: structured output, tools, limits

Quotes from DS-json, DS-tools, DS-chat, DS-rate, DS-price, fetched 2026-11-13.

JSON output (`json_object`), status: current and documented, not Beta. Documented steps and failure modes:

- "Set the `response_format` parameter to `{'type': 'json_object'}`. Include the word "json" in the system or user prompt, and provide an example of the desired JSON format... Set the `max_tokens` parameter reasonably to prevent the JSON string from being truncated midway." (DS-json)
- "When using the JSON Output feature, if the model's output cannot be recognized as JSON, the API replaces the non-JSON content with spaces (U+0020). As a result, the returned content may contain only spaces (appearing empty, even when `finish_reason` is `stop`). You can try modifying the prompt to mitigate such problems, and handle blank content in your code (e.g., retry the request)." (DS-json)
- The chat completions reference says `json_object` "guarantees the message the model generates is valid JSON" and lists `text` and `json_object` as the only two `response_format` types. There is no `json_schema` type. (DS-chat)

Tool calls and `strict` mode (Beta, still labelled Beta on 2026-11-13):

- "In strict mode, the model strictly adheres to the format requirements of the Function's JSON schema when outputting a tool call... It is supported by both thinking and non-thinking mode." To use it: "Use `base_url="https://api.deepseek.com/beta"` to enable Beta features" and "In the `tools` parameter, all function need to set the `strict` property to `true`." The server validates the schema and returns an error for unsupported types. Supported types: object, string, number, integer, boolean, array, enum, anyOf. (DS-tools)
- The `strict` field on a function is described as "This is a Beta feature." (DS-chat)
- Parallel tool calls: I found no documented `parallel_tool_calls` parameter on the DS-tools or DS-chat pages. Unverified.

Thinking mode default (important for runners):

- "When `thinking` is omitted or null, the mode follows `reasoning_effort`; if `reasoning_effort` is also omitted, thinking is enabled." Setting `thinking: {"type": "disabled"}` selects non-thinking. (DS-chat) The pricing page says "Supports both non-thinking and thinking (default) modes." (DS-price)
- `max_tokens` default when unset: 8K non-thinking, 64K thinking, 128K at reasoning effort max (DS-chat). Maximum 384K.
- In non-thinking mode, `deepseek-flash` temperature "is fixed at 1.0 and the value you pass is ignored." (DS-chat)

Limits (DS-rate):

- "deepseek-flash 2500, deepseek-v4-pro 500" concurrency, per account. "A request counts as one concurrent connection from the time it is sent until the model response is complete." "when the concurrency limit is exceeded, you will receive an HTTP 429 error code." Higher limits: "submit a capacity expansion request... There is no additional cost for capacity expansion."
- `user_id` can isolate KV cache, content safety and scheduling per end user; "Do not include user privacy information in user_id."
- No requests-per-minute or tokens-per-minute limit is stated on the page.

Pricing check: DS-price still shows deepseek-flash $0.15 / $0.60 off-peak and $0.30 / $1.20 peak (cache miss), cache hit $0.003 / $0.006, with peak 01:00 to 04:00 and 06:00 to 10:00 UTC, Monday to Friday, excluding Chinese public holidays. No change from `models-2026-11.md`.

## 4. Data handling

### DeepSeek first-party API

- Governing law: "disputes under these Terms shall be governed by the laws of the People's Republic of China in the mainland." Disputes go to a court at the registered office of Hangzhou DeepSeek Artificial Intelligence Co., Ltd. (DS-terms 10.1, 10.2)
- Where processed and stored: the privacy policy, which says it covers "DeepSeek apps, websites, software, and related services", states "We store the information we collect in secure servers located in the People's Republic of China" and "your personal data may be processed and stored in our servers in the People's Republic of China." (DS-priv, dated February 14, 2025.) The policy also says it does not cover downstream apps: "the processing rules for personal information collected from end users when accessing downstream systems or applications developed by developers using our open platform services are not covered by this privacy policy." Whether API inputs are processed only in the PRC is therefore not stated for the API in either document.
- Retention: no API-specific retention period found. The privacy policy says "The retention periods will be different depending on the amount, type and sensitivity of information... For example... we keep this information for as long as you have an account. This information includes your account information, input and payment information." (DS-priv.) No zero-retention option is described in the terms or policy I read.
- Training on API inputs: not stated in DS-terms. DS-terms 4.2 describes what customers may do with outputs: "training other models (such as model distillation)". This is a right granted to the customer, not a statement about DeepSeek's own training. This corrects the reading in `models-2026-11.md` section 3.5, which left it open. The privacy policy lists training as a use of personal information for the Services ("To improve and develop the Services and to train and improve our technology"), and API scope is ambiguous, so training on API inputs is Unverified.
- Customer obligations: the terms put controller duties on the developer. "You shall obtain the consent of end users or have other legal basis for the collection, processing of personal information, and delegation of personal information processing to us." (DS-terms 3.3). I found no data processing addendum, standard contractual clauses or EU-specific terms in DS-terms or DS-priv.
- Content safety: DeepSeek offers an optional safety parameter that reviews input and output and returns a refusal marker (DS-log, entry dated 2026-11-13).
- Government and enterprise restrictions:
  - US Department of Homeland Security order under the Federal Acquisition Supply Chain Security Act, Docket DHS-2026-0628, published in the Federal Register 2026-10-20. Order summary: "(1) excluding information technology products and services developed by Hangzhou DeepSeek Artificial Intelligence Co., Ltd (DeepSeek)... from federal civilian agency procurements; and (2) removing all DeepSeek and DeepSeek-affiliate products, and third-party products and services developed using DeepSeek implementations, from civilian agency information technology." (FR-DHS). It applies to federal civilian agencies. The CRS summary reported by a search result (https://www.everycrsreport.com/reports/IF13336.html, not opened) says the order does not restrict private use; I did not verify that sentence on the CRS page itself.
  - Other bans on government devices (Taiwan, Australia, several US states and agencies) appeared in news results (e.g. https://thenightly.com.au/..., https://techradar.com/pro/security/deepseek-ai-tools-banned-from-us-government-agency-systems-as-rift-with-china-grows). I did not open an official source for each, so they are not confirmed here.
- Export controls: the terms put export-control and sanctions compliance on the customer and say Inputs "shall not include material or information that requires a license for release or export." (DS-terms)

### Meta Model API (standard tier) and Muse Ember

- Tiers: "Meta makes certain Meta Models available in different tiers: "Contributor Models" and "Standard Models."" (M-terms). Designations are in the policy page. As of "Last updated: November 9, 2026", Standard Models are Muse Image, Muse Spark 1.1, 1.2, 1.3, Muse Voice Transcribe, SAM 3.1, Muse Wonder, Muse Wonder Full and **Muse Ember**; Contributor Models are Muse Spark 1.2 Contributor and Muse Spark 1.3 Contributor (M-geo). This answers the open question from `models-2026-11.md`: Ember's data-use status is Standard. Meta's Ember page agrees: "On Model API, Muse Ember runs in Standard mode only; it has no Contributor-mode variant." (M-ember)
- Training, Standard: "Standard Services: Meta does not use your Content from Standard Services to train Meta Models. Meta may process Content as necessary to detect, prevent, and respond to violations of the Model API AUP or the Terms of Service, and to develop and improve systems that protect the safety and security of Meta's products and services." (M-commit). Terms 5.1: Meta "will not use Content submitted in a request to the Standard Services to train Meta Models", and acts as "Service Provider" or "Processor" under the Meta Global Processor Terms, with a published subprocessor list (M-terms).
- Training, Contributor: "Meta may use your Content, including Inputs and Outputs, to train, develop, evaluate, and improve Meta's AI models" and may use content "for evaluation, safety, abuse, quality, and policy review without first applying" disassociation steps (M-commit). Terms 6.2: "You must not submit sensitive, confidential, or personal information to the Contributor Services." (M-terms)
- Retention: "Meta will retain your Content and Usage Data as needed: (i) to provide the Services under these Terms; (ii) to the extent necessary for compliance with applicable laws; (iii) in connection with the exercise of Meta's rights to use your Content and Usage Data under these Terms; (iv) when our systems flag data for a potential policy violation; and (v) for security, safety, abuse, and policy review and improvements." No fixed period is given. (M-terms 4.4). M-commit: "You can view and delete your Content through your Account."
- Where processed: not stated for the API. The contracting entity is Meta Platforms, Inc., or Meta Platforms Ireland Limited "if you are located in the European Region" (M-terms). Governing law is California for most customers, Irish law and courts where Meta Platforms Ireland Limited is the party (M-terms Exhibit A).
- Availability: "The Services are not available in all jurisdictions." Restricted territories include the People's Republic of China (including Hong Kong SAR and Macau SAR) (M-geo).
- Prompt caching and stored responses: caching is "independent of the Responses API `store` parameter"; Responses are stored by default (`store: true`) and `store: false` with encrypted reasoning replay keeps "no copy" of the conversation server-side per the Responses page (https://dev.meta.ai/docs/protocols/responses.md, fetched 2026-11-13). Cached prefixes live in memory and are evicted under pressure or after inactivity, up to 24 hours when extended retention is requested (https://dev.meta.ai/docs/prompt-caching.md).
- Exhibit C (hosted platform access, a third-party cloud hosting Meta models) is a separate path; it does not apply to calls to `api.meta.ai`.

### Third-party hosts of DeepSeek open weights

- Fireworks (FW-zdr): "Fireworks does not log or store prompt or generation data for open models, without explicit user opt-in." "prompt and generation data exist only in volatile memory for the duration of the request"; prompt cache data "can be stored in volatile memory for several minutes." Not covered: Batch API, and Responses API when `store=True` (the default), where conversation data is kept "up to 30 days". Fireworks "logs metadata (e.g. number of tokens in a request)". The nav lists a "US-only Serverless" page; I did not read it.
- Together (TG-priv): "By default, Together stores the prompts you send and the responses models return, and may use them for product improvements. This data is not shared with third parties, and you can delete it at any time." Org admins can turn storage off, which enables zero data retention. "Data sharing for training other models is opt-in and not enabled by default." Models by other authors "(DeepSeek, Qwen, Mistral, etc.) and hosted on Together run on Together's own infrastructure. They do not call out to the model author." For some serverless models, geo-specific inference "keeps inference processing in the United States... The guarantee applies to requests sent to `us-api.together.ai`. It covers only where those requests are processed, not where data is stored, logged, or routed." EU: "private networking and virtual private cloud (VPC) deployments, including in EU regions" via dedicated endpoints or sales.
- Third-party passthrough models: Together forwards prompts to the upstream provider for models marked passthrough, under that provider's policy. Whether any DeepSeek V4.1 Flash listing is passthrough: not stated on the page. Unverified.

## 5. DeepSeek Search and Fetch; Meta search grounding

DeepSeek Search and Fetch (DS-search, DS-price, DS-log):

- What they do: "Search API finds web pages for a query and returns structured results. It is powered by DeepSeek's in-house search engine. Fetch API retrieves a single web page and returns its content as Markdown." Endpoints `POST https://api.deepseek.com/v1/tools/search` and `.../v1/tools/fetch`, same bearer auth. Search takes `query` (1 to 128 characters), `count` (1 to 50), `need_content`, and operators `site:`, `lang:`, `after:`, `before:`. Search results carry `snippet`, `summary`, `content`, `date`, `authority`. Fetch takes one `url` (up to 8192 characters, no credentials in the URL) and returns `title` and `content`.
- Price: "Per 1,000 successful requests $0.75" for each of Search and Fetch. "A request is billable only when it returns HTTP 200 and produces a result... Failed requests, empty search results, and timeouts are not billed." Calls made by the model through DeepSeek's web tools bill at the same rates.
- Limits: Search 100 QPS, Fetch 25 QPS per account, "separate from the model concurrency limits"; Fetch also has a per-domain QPS limit; over-limit returns HTTP 429. Fetch 404 covers "a URL blocked by site policy"; 403 is "rejected by the security policy". "Fetching is subject to the target site's availability and access policies."
- Terms on storing results: none found on DS-search or DS-terms. The terms give the customer rights in Outputs (DS-terms 4.2) but do not mention search results or fetched page content separately. Unverified.
- Both are DeepSeek-hosted services; a Fetch call sends the target URL to DeepSeek, which retrieves the page. The model-side `deepseek_web_search` and `deepseek_read_url` tools were released 2026-11-13 (DS-log), so they are new.

Meta search grounding (M-price, https://dev.meta.ai/docs/search-grounding.md, fetched 2026-11-13):

- Per call: "Add `web_search` to `tools` in a Responses API request. The model evaluates the query and decides whether to search." The model decides whether to search; the caller cannot force a search per the page. `max_tool_calls` caps built-in tool calls (minimum 1, from M-tools).
- Price: "Web search grounding: $2.50 per 1,000 search queries, in addition to the request's token cost," for Muse Wonder, Muse Spark and Muse Ember (M-price).
- Results: response includes `web_search_call` and `url_citation` annotations; raw hits only if `include: ["web_search_call.results"]` is set.
- Meta documents this only for the Responses API. The page text I read does not show it on Chat Completions.
- Meta has no standalone fetch endpoint in the docs index I read (M-docs). Not found.

## 6. Independent evidence on small models

Short version: no independent 2026 benchmark I found tests these exact models on structured extraction or schema adherence. The evidence that exists is partial.

Document-grounded hallucination, Vectara hallucination leaderboard (VEC, last updated 2026-10-22, Vectara's own summarisation test with their HHEM scorer; it is an independent leaderboard but run by a vendor):

| Model | Hallucination rate | Answer rate |
|---|---|---|
| `deepseek-ai/DeepSeek-V4.1-Flash` | 4.2 % | 99.9 % |
| `deepseek-ai/DeepSeek-V4-Pro` | 8.6 % | 97.2 % |
| `anthropic/claude-haiku-4-5-20251001` (previous generation) | 9.8 % | 99.5 % |
| `openai/gpt-6-sol` | 6.5 % | 100.0 % |

- No row for Muse Ember, Spark 1.3, Glimmer, Claude Haiku 5.5 or GPT-6 Luna. The table lists `DeepSeek-V4.1-Flash`, not the 1017 snapshot. The task is summarising a short document; it is not extraction with quotes.

AA-Omniscience hallucination rate and accuracy, as listed in the AA model data on 2026-11-13 (lower hallucination rate is better; I did not re-read AA's metric definition, and the task is question answering, not document-grounded extraction):

| Model (effort) | Hallucination rate | Accuracy |
|---|---|---|
| Muse Ember (max) | 17.4 % | 21.1 % |
| Muse Ember (xhigh) | 17.3 % | 21.4 % |
| Muse Spark 1.3 (max) | 25.2 % | 38.0 % |
| DeepSeek V4.1 Flash 1017 (non-reasoning) | 25.3 % | 21.9 % |
| DeepSeek V4.1 Flash 1017 (max) | 64.1 % | 39.6 % |
| Claude Haiku 5.5 (max) | 34.2 % | 34.7 % |
| GPT-6 Luna (non-reasoning) | 80.0 % | 30.1 % |
| Muse Glimmer (high) | 83.6 % | 28.0 % |

Tool-calling and instruction following:

- AA data lists `ifbench` and `tau2` only for older DeepSeek snapshots (DeepSeek V4 Flash 0420: IFBench 0.79 at max, 0.47 non-reasoning; tau2 0.95 to 0.96). No values for 1017, Ember, Spark 1.3, Glimmer, Haiku 5.5 or Luna in the data I read.
- The Berkeley Function Calling Leaderboard v4 was reviewed by Epoch AI and rated "Flawed" (sample of 50 of 5,088 questions, reviewed Sep. 10, 2026) per a search result for https://epoch.ai/benchmarks/berkeley-function-calling-leaderboard/review. I did not open that page. I found no BFCL score for these models.

Structured-output papers (2026):

- VAREX, arXiv 2603.15118 (submitted 2026-03-16, revised 2026-04-09): 1,777 government-form documents, four input modalities; its abstract and the model names I searched for (DeepSeek, Muse, Haiku, Luna) match none of the models above. Reported by the search result summary, not verified in the paper body: small models fail on schemas with `$defs` (non-compliance about 2 to 3 % on flat schemas, 68 to 69 % with `$defs`). Treat as Unverified detail.
- arXiv 2609.23742 (submitted 2026-09-20): five 0.6B to 4B open models across 14 structured-output tasks. Abstract: constrained decoding takes "schema validity: 78.6-92.9% to 100%", and "instruction-semantic failures (e.g., multi-step function calling) remain CD-resistant". The models are far smaller than the ones in the question, so it supports one general point only: schema validity and content accuracy are separate axes.
- Vendor-reported numbers for these exact models on extraction: none found. DeepSeek's V4.1-Flash-1017 changelog (DS-log) lists coding and agent benchmarks, not extraction. Meta's docs describe Ember as suited to "extracting fields" but give no accuracy figure (M-ember).

## What the facts imply for a runner tier

- Fastest measured option for short JSON outputs: DeepSeek V4.1 Flash non-thinking on a fast host (AA: Baseten FAST 781 tokens/s with 0.28 s TTFT on the pre-1017 snapshot; Inco FAST 378 tokens/s on 1017). First-party DeepSeek is 141 tokens/s with 1.35 s TTFT. Muse Ember has higher raw output speed (440 tokens/s) but a 4.9 s TTFT at max and 7.8 s at 10k input, because reasoning cannot be disabled and `minimal` is unmeasured.
- A DeepSeek runner must set `thinking: {"type": "disabled"}`; thinking is on by default, and AA's reasoning-mode pages show 21 s to 60 s to first answer token for the same model.
- A Meta runner must set `reasoning_effort` explicitly. Ember defaults to `max` and `none` returns HTTP 400; `minimal` is the floor, and reasoning tokens are billed as output at $0.50 per MTok and share the `max_tokens` budget, so a small `max_tokens` can truncate the JSON.
- Only Meta documents schema-enforced JSON (`json_schema`, constrained decoding, recursive schemas rejected, depth 10). DeepSeek `json_object` gives valid JSON but not schema conformance and can return blank content, so a DeepSeek runner needs a validator plus a retry or repair step. DeepSeek's schema-strict mode exists only for tool-call arguments, is Beta, and needs the `/beta` base URL.
- Use `response_format` rather than tool calls on Meta for the result schema: Meta states tool-call arguments "are not guaranteed to validate" even with `strict`.
- Rate headroom for 10k-token pages: Meta's 4,000,000 tokens/min per team caps Ember at about 400 such calls per minute before output tokens (4,000,000 / 10,000), against a 3,000 requests/min cap; DeepSeek caps concurrency at 2,500 per account and states no per-minute token cap.
- Data about named people, including EU residents: DeepSeek first-party offers PRC governing law, PRC-located servers for its Services, no stated API retention or training position, no processor or EU transfer terms in the documents read, and a US federal civilian procurement and removal order (DHS-2026-0628). Meta Standard tier (Ember, Spark 1.3) offers processor terms, a named Irish contracting entity for the European Region, and a no-training commitment, but no stated processing region and indefinite retention for policy review. Meta's Contributor tier (the $0.10 / $0.20 Spark variants) trains on content and its terms forbid submitting personal information.
- DeepSeek weights on a US host change the data picture and the price: Fireworks states no logging or storage of prompts for open models by default; Together stores prompts by default unless an admin disables it, with training opt-in off. Listed host prices are the first-party peak rate ($0.30 / $1.20), with no off-peak halving.

## Unverified

- Time to first token for Muse Ember or Spark 1.3 at `minimal`, `low`, `medium` or `high` effort. AA has pages only for max and xhigh (Ember) and max and xhigh (Spark 1.3). Tried: AA slugs `muse-ember-minimal`, `-low`, `-medium`, `-high`, `-non-reasoning` (all 404), `muse-spark-1-3-high` (404).
- Non-thinking speed for DeepSeek V4.1 Flash on Together, and any 1017-snapshot figure for Fireworks. AA lists neither on the 1017 non-reasoning page.
- Non-thinking Claude Haiku 5.5 speed on AA (no such page; `-non-reasoning` returned 404). Haiku 5.5 price comes from AA's FAQ text, not from Anthropic's pricing page.
- Speed for `muse-glimmer-30b` at a low or no reasoning setting, and any Glimmer figure on Groq, Cerebras or SambaNova. Groq and Cerebras catalogs have no Glimmer entry. SambaNova's catalog was not fetched; a search returned only DeepSeek R1 and V3-era entries.
- Whether Together or Fireworks expose `json_schema` response formats for DeepSeek V4.1 Flash or Glimmer, and their concurrency limits. AA says all listed providers support JSON mode and function calling; I did not open Together's or Fireworks' structured-output docs.
- Where DeepSeek's first-party API processes and stores request content, its retention period for API inputs and outputs, and whether API inputs are used for DeepSeek's own training. Tried: DS-terms, DS-priv, searches. The privacy policy dated February 14, 2025 covers its apps and sites and excludes downstream applications.
- Any DeepSeek data processing addendum or EU transfer mechanism. None found in DS-terms or DS-priv.
- DeepSeek terms on storing or reusing Search and Fetch results. None found in DS-search or DS-terms.
- DeepSeek parallel tool call support. No parameter documented on DS-tools or DS-chat.
- Official sources for non-US government bans on DeepSeek. Only news results were seen.
- The CRS statement that the DHS order does not restrict nongovernmental use. Seen only in a search result summary of https://www.everycrsreport.com/reports/IF13336.html, page not opened.
- Where Meta processes and stores Model API content (region), and the Meta Global Processor Terms and subprocessor list text. The subprocessor link in M-terms points to `forwork.meta.com`, not fetched.
- Meta Model API documentation of `json_object` mode: not found in the pages read, which is not proof it is rejected.
- Whether any DeepSeek V4.1 Flash listing on Together is a passthrough model.
- Independent 2026 results on extraction, schema adherence or tool-calling reliability for Ember, Spark 1.3, Glimmer, Haiku 5.5, Luna or deepseek-flash 1017. Tried: AA data fields, Vectara leaderboard, arXiv 2603.15118 and 2609.23742, BFCL searches. Vectara has no entries for Muse, Haiku 5.5 or Luna.
- Exact definition of AA-Omniscience hallucination rate (not re-read) and the AA Intelligence Index version behind its page values (not used above).
- Two AA data points disagree in the page source: DeepSeek first-party error rate (0 in the embedded headline object, 3.8 % in the rendered table).
