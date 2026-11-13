# AI voice calls: which API to use, and what the law requires

**Recommendation.** Use Vapi. In the pages read, it is the only candidate that documents all of the following without the fund hosting a public endpoint. One request, `POST https://api.vapi.ai/call`, carries the whole call plan as a one-off assistant: the system prompt, a fixed first sentence, and the questions [V-CREATE]. Recording, logs and transcript can be off for a consent step and on for the interview [V-REC]. The result can be polled at `GET /call/{id}` [V-GET]. The call and its data can be deleted with `DELETE /call/{id}` [V-DEL]. Raw data is kept 14 days on the usage-only plan [V-BILL]. The cost is $0.05 per minute to Vapi plus speech, model and carrier fees, about $0.10 to $0.14 per minute in total by Vapi's own calculator [V-PRICE]. The law does not turn on the vendor. In the United States the FCC treats an AI voice as an "artificial or prerecorded voice", so the fund needs the called person's prior express consent before it dials a mobile number [L-FCC] [L-CFR]. The flow treats every number that way. The call must name the fund at the start and give a phone number [L-CFR]. Recording needs every party's consent, or in Montana every party's knowledge, in the eleven states checked here (section 4.2). Section 5 has the flow. Placing calls also changes a tested rule of this repository (nothing dials when sources are live), so the dialler remains a decision for the partner.

Research date: 2026-11-13. Every source was read on that date.

**Not legal advice.** This note reads vendors' own pages and the text of statutes, rules and rulings. The fund needs its own counsel before any call is placed. Section 4.5 lists the questions counsel must answer.

**Method.** Pages were downloaded with `curl` and searched as raw text. Every blockquote line (starting with `>`) is a verbatim quote that a script matched against the downloaded text. White space and quote marks are normalised, Markdown emphasis marks are dropped, and `...` marks an omission. Bracketed keys such as `[V-CREATE]` point to the Sources list. No account was created, no key was used, and no call was placed. Every API shape below is as documented, not as tested.

## 1. Vendor comparison

| | Vapi | Retell AI | Bland AI | ElevenLabs Agents | OpenAI (Live or Realtime, SIP) | Twilio ConversationRelay |
|---|---|---|---|---|---|---|
| Place one call | `POST /call` with a one-off assistant [V-CREATE] | `POST /v2/create-phone-call` with a stored agent and per-call overrides [R-CREATE] | `POST /v1/calls` with `task` and `first_sentence` [B-SEND] | `POST /v1/convai/twilio/outbound-call` with a stored agent and overrides [E-OUT] | Live API `POST /v1/live/sessions` over the fund's own SIP trunk. Realtime API takes inbound SIP only [O-SIP] | `POST .../Calls.json` with TwiML. The fund's own WebSocket server is the agent [T-CALL] [T-NOUN] |
| Completion | Webhook or polling [V-EVT] [V-GET] | Webhook or polling [R-HOOK] [R-GET] | Webhook or polling [B-QUICK] | Webhook or polling [E-HOOK] [E-GET] | Events on a WebSocket the fund opens [O-SIP] | Webhook or polling [T-CALL] |
| Fixed first sentence | `firstMessage` [V-CREATE] | `begin_message` [R-CREATE] | `first_sentence` [B-SEND] | `first_message` override [E-OUT] | Not guaranteed by the model [O-CONV] | `welcomeGreeting` [T-NOUN] |
| Recording only after consent | Documented two ways [V-CONSENT] [V-REC] | Not found in pages read | `record` is set when the call is sent [B-SEND] | Not found in pages read | No recording by the API [O-CONV] | Fund's code decides when to record [T-REC] |
| Callee starts the call | Inbound number, or Web SDK on the fund's page [V-PHONE] [V-KEYS] | Inbound number, or web call [R-IN] [R-WEB] | Inbound number, or web SDK [B-INB] [B-WEBSDK] | Inbound number, or a hosted shareable page [E-TWILIO] [E-WIDGET] | Inbound SIP, or WebRTC on the fund's page [O-SIP] [O-CREATE] | A Twilio number with the same TwiML [T-ONB] |
| Price per minute | $0.05 plus providers. Calculator: $0.082 to $0.129, plus $0.014 Twilio outbound [V-PRICE] | $0.07 to $0.31. Page example $0.11, plus $0.015 US carrier [R-PRICE] | $0.14 (Start) or $0.12 (Build, $299 a month) [B-PRICE] | $0.08 plus model, plus the fund's carrier [E-PRICE] | `gpt-live-1` $0.05 plus backend model, plus SIP trunk [O-PRICE] | $0.07 plus $0.014 outbound, plus the fund's model [T-PRICE] |
| Default retention | 14 days (usage only) [V-BILL] | Forever [R-RET] | "as long as necessary" [B-PRIV] | 2 years [E-RET] | Abuse logs 30 days. No session state unless stored [O-DATA] | Not found for recordings |
| Delete by API | `DELETE /call/{id}` [V-DEL] | `DELETE /v2/delete-call/{call_id}` [R-DEL] | None in the docs index [B-INDEX] | `DELETE /v1/convai/conversations/{id}` [E-DEL] | Nothing to delete by default [O-DATA] | `DELETE .../Recordings/{Sid}.json` [T-REC] |
| Trains on call data | Uses content to improve the service without identifying the business or caller [V-TERMS] | Yes, de-identified, unless recording is opted out or an MSA says otherwise [R-TERMS] [R-COMP] | Not stated. Broad licence [B-TERMS] | Yes by default, with an opt-out [E-TERMS] | No [O-DATA] | Only for the AI features the customer uses [T-AI] |
| Terms on consent, AI disclosure, recording | Docs warn. Terms add a TCPA indemnity [V-OUT] [V-TERMS] | Most explicit of the six [R-TERMS] | Generic [B-TERMS] | Explicit policy lines [E-POLICY] | Usage policies not retrieved | Acceptable use policy cites consent laws [T-AUP] |

## 2. Vendors: call shapes

### 2.1 Vapi

Base URL `https://api.vapi.ai`. Auth header `Authorization: Bearer <private API key>` [V-CREATE]. Public keys are for browser SDKs only [V-KEYS].

**(a) Place one call** [V-CREATE] [V-OUT] [V-WEB].

```
POST https://api.vapi.ai/call
{
  "phoneNumberId": "<id of an imported number>",
  "customer": { "number": "+14155550123" },
  "name": "<the fund's own reference>",
  "assistant": {
    "firstMessage": "<fixed disclosure sentence, written by code>",
    "firstMessageMode": "assistant-speaks-first",
    "model": { "provider": "openai", "model": "gpt-4o",
               "messages": [ { "role": "system", "content": "<system prompt with the questions>" } ] },
    "voice": { "provider": "11labs", "voiceId": "<voice id>" },
    "maxDurationSeconds": 900,
    "endCallMessage": "<fixed closing sentence>",
    "artifactPlan": { "recordingEnabled": false, "loggingEnabled": false,
                      "transcriptPlan": { "enabled": false } },
    "server": { "url": "https://<optional webhook>" },
    "serverMessages": ["status-update", "end-of-call-report"]
  }
}
```

- Response `201`: a `Call` object. Keep `id` [V-CREATE].
- `assistant` is a one-off ("transient") assistant. `assistantId` reuses a saved one. `assistantOverrides` changes a saved one for this call [V-CREATE].
- `firstMessage`: if unset, the assistant waits for the person to speak [V-CREATE].
- `maxDurationSeconds` defaults to 600 [V-CREATE].
- `artifactPlan.recordingEnabled` defaults to true, so set it to false wherever recording must not run. `transcriptPlan.enabled` and `loggingEnabled` also default to true [V-GET].
- `schedulePlan.earliestAt` and `latestAt` schedule the call. `customers` (plural) is for batches and is not needed here [V-OUT].
- Outbound calls need a number imported from Twilio, Telnyx or DIDWW. The free Vapi number is inbound only [V-PHONE].
- The example shows the values for a consent step. An assistant that should record sets all three `artifactPlan` values to true.
- The model examples in the docs use `provider: "openai"`. Other providers are listed in the schema; their exact enum values were not checked [V-CREATE].

**(b) Learn that it ended.** Both ways.

- Webhook: Vapi sends `POST` requests to `assistant.server.url` with body `{ "message": { "type": "status-update", "status": "ended", "call": {...} } }` and `{ "message": { "type": "end-of-call-report", "endedReason": "...", "call": {...}, "artifact": { "transcript": "...", "recording": {...}, "messages": [...] } } }` [V-EVT]. Webhook auth is a credential the fund defines (bearer token, OAuth or HMAC) [V-AUTH].
- Polling: `GET /call/{id}`. `status` is one of `scheduled`, `queued`, `ringing`, `in-progress`, `forwarding`, `ended`, `not-found`, `deletion-failed`. Also `endedReason`, `startedAt`, `endedAt`, `cost` [V-GET].

**(c) Transcript and recording** [V-GET] [V-ART].

- `artifact.transcript` (one string), `artifact.messages[]` (turns), `artifact.assistantActivations[]` (which assistants were active).
- `artifact.recording` holds private URLs. Download with `GET /call/{id}/mono-recording` or `GET /call/{id}/stereo-recording` and the same bearer key. The answer is a `302` to a short-lived signed URL. `artifact.presignedMonoUrl` is a ready link that expires at `artifact.presignedUrlsExpiresAt`.
- `compliance.recordingConsent.type` and `.grantedAt` are set when a recording consent plan is used. No `grantedAt` means consent was not given [V-CONSENT].
- Delete: `DELETE /call/{id}` [V-DEL].

**Recording only after consent.** Two documented ways.

1. `assistant.compliancePlan.recordingConsentPlan` with `type: "verbal"`, a `message`, and a `declineTool`. It is an Enterprise feature [V-CONSENT].

> Call recording only begins after consent is granted, ensuring compliance with privacy laws and regulations across different jurisdictions. [V-CONSENT]

2. A squad of two assistants on any plan. The first has all artifacts off and asks for consent. The second has them on [V-REC]. Shape: `squad.members[]`, each with `assistant` and `assistantDestinations: [{ "type": "assistant", "assistantName": "..." }]`. The call starts with the first member [V-CREATE]. The tool that triggers the handoff was not read.

> The consent assistant runs without generating artifacts, while the main assistant records the actual conversation after consent is obtained. [V-REC]

**Callee-initiated.** Give a phone number an `assistantId` and it answers inbound calls with that assistant [V-PHONE]. For the web, the fund hosts a page that runs the Web SDK with a public key restricted to allowed origins and assistants [V-KEYS] [V-WEB]. No hosted link was found in the pages read.

**Price** [V-PRICE]. Vapi hosting $0.05 per minute. The calculator adds Deepgram $0.0095 to $0.0099, an OpenAI model $0.0077 to $0.0452, an ElevenLabs voice $0.0146 to $0.0238. Its estimate for 1,000 minutes is $82 to $129 with Vapi's own telephony. Twilio outbound is $0.014 per minute. Core package $29 a month.

**Terms** [V-OUT] [V-TCPA] [V-REC] [V-TERMS, last updated 2026-09-14].

> It is a violation of FCC law to dial phone numbers without consent in an automated manner. [V-OUT]

> The TCPA does not apply to inbound telephone calls. [V-TCPA]

> Always comply with local laws regarding call recording. Some jurisdictions require explicit consent from all parties before recording. [V-REC]

> your breach of these Terms, any rights of another party, or any applicable law or regulation, including but not limited to the Telephone Consumer Protection Act of 1991 (TCPA), the Telemarketing and Consumer Fraud and Abuse Prevention Act, and their implementing regulations [V-TERMS]

The last quote is from the customer's duty to indemnify Vapi. The list of restrictions in the terms also covers pretending to be someone else and falsely stating a link to another entity. A keyword search of the terms found no clause on AI disclosure or on recording consent. Outbound calls run on a number imported from a carrier, so the carrier's terms apply as well; Twilio's are in 2.6.

**Data** [V-BILL] [V-ZDR] [V-TERMS].

- Raw data retention: 14 days (usage only), 30 days (Core), 180 days (Pro).
- Zero Data Retention is included in Core and Pro. With it, the fund must store artifacts in its own bucket.

> Zero Data Retention (ZDR) stops Vapi from retaining call content after a call ends. [V-ZDR]

> We use Your Content to: (a) provide and maintain the Services, and (b) improve, enhance, and optimize the performance of the service and call improvement-related features, including, without limitation, speech recognition accuracy, end-of-turn detection, interruption detection, and latency reduction, provided that such processing is conducted in a manner that does not identify the business or the caller and does not disclose business' proprietary information. [V-TERMS]

> We do not share Your Content with third-party services for their independent model training purposes. [V-TERMS]

The transcriber, model and voice providers each receive call content under their own terms [V-TERMS].

### 2.2 Retell AI

Base URL `https://api.retellai.com`. Auth header `Authorization: Bearer YOUR_API_KEY` [R-CREATE]. An agent and its response engine must exist first; those pages were not opened. The docs index says identity verification (KYC) unlocks outbound calling [R-INDEX].

**(a) Place one call** [R-CREATE].

```
POST https://api.retellai.com/v2/create-phone-call
{
  "from_number": "+14157774444",
  "to_number": "+12137774445",
  "override_agent_id": "<agent id>",
  "agent_override": { "retell_llm": { "begin_message": "<fixed disclosure sentence>" } },
  "retell_llm_dynamic_variables": { "questions": "<text>", "purpose": "<text>" },
  "metadata": { "outreach_id": "<the fund's id>" },
  "honor_internal_dnc": true,
  "idempotency_key": "<5 to 255 characters>"
}
```

- Required: `from_number`, `to_number`. Response `201` is the call object with `call_id` and `call_status`.
- The per-call override of the response engine supports only `model_config`, `knowledge_base_ids`, `kb_config`, `start_speaker`, `begin_after_user_silence_ms` and `begin_message`. The system prompt cannot be replaced per call. Pass the questions as dynamic variables, which are strings placed into the stored prompt.
- `agent_override.agent` can change agent settings for one call, such as `webhook_url` and `data_storage_setting`.
- Numbers bought from Retell reach US numbers only.

**(b) Learn that it ended.** Both ways.

- Webhooks `call_started`, `call_ended`, `call_analyzed`, sent by `POST` with an `x-retell-signature` header. Timeout 10 seconds, up to 3 retries. A call that never connects sends no `call_started` but still sends `call_ended` and `call_analyzed` [R-HOOK].
- Polling: `GET /v2/get-call/{call_id}`. `call_status` is `registered`, `not_connected`, `ongoing`, `ended` or `error`. Also `disconnection_reason`, `start_timestamp`, `end_timestamp`, `duration_ms` [R-GET].

**(c) Transcript and recording** [R-GET]. `transcript` (string), `transcript_object[]` (turns with times), `recording_url`, `recording_multi_channel_url`, `scrubbed_recording_url`. With `opt_in_signed_url` the links expire after 24 hours. Delete: `DELETE /v2/delete-call/{call_id}` [R-DEL].

**Callee-initiated.** Bind an agent to a Retell or imported number with `inbound_agent_id` [R-IN]. For the web, the Web SDK runs `client.createWebCall({ agent_id })` with a public key on the fund's page, or the server calls `POST /v3/create-web-call` and passes the returned `access_token` to the browser [R-WEB] [R-WEBAPI].

**Price** [R-PRICE]. "$0.07-$0.31/minute" on the page. Voice infrastructure $0.055 and platform voices $0.015. The model price depends on the model, for example GPT 5 nano $0.0016 and Claude 5 Sonnet $0.064. The page's worked example totals $0.11. US telephony through Retell $0.015 per minute. A Retell number $2.00 a month.

**Terms** [R-TERMS, last updated 2026-10-25].

> Customer may not use the Platform to place AI-generated voice calls without first obtaining the consent required under applicable Telecom Laws. [R-TERMS]

> (a) At Call Initiation. Customer must configure AI voice agents to identify, at the beginning of each outbound call: (i) the name of the business or entity on whose behalf the call is made; and (ii) the purpose of the call. In some jurisdictions, Customer may be required to disclose that the AI voice agent is artificially generated. [R-TERMS]

> (d) AI Voice Disclosure Compliance. Customer is prohibited from misleading any consumer about the artificial identity of any AI voice agent. [R-TERMS]

> (b) Two-Party Consent States. Certain states require all-party consent before recording a telephone conversation. Customer must configure AI voice agents to announce recording and obtain verbal consent when calling numbers in two-party consent jurisdictions. [R-TERMS]

> Customer may not use the Services to initiate calls before 8:00 a.m. or after 9:00 p.m. in the called party's local time zone, unless Customer has obtained the called party's prior express consent to receive calls outside these hours. [R-TERMS]

> Customer must retain records of consent (including the method of consent, the date and time consent was obtained, the disclosure presented to the consumer, and the telephone number for which consent was given) for a minimum of five (5) years or such longer period as required by applicable law or litigation hold. [R-TERMS]

**Data** [R-RET] [R-STORE] [R-TERMS] [R-COMP].

> By default, data is kept indefinitely (no automatic deletion). [R-RET]

- `data_storage_retention_days` on the agent, 1 to 730, deletes on a schedule. Storage modes are `everything`, `everything_except_pii`, `basic_attributes_only`. When storage is opted out, raw files are deleted about 10 minutes after post-call processing, so the webhook is the only copy [R-STORE].

> If you do not opt-out of recording, you give Retell AI permission to record calls made using the Service and process communication data (“Communications”) and User Content for offering AI-powered analytics and the development, training, and improvement of artificial intelligence and machine learning models that are included in the Service. However, before being used for these purposes, the data will be de-identified and aggregated using commercially reasonable industry-standard technologies. [R-TERMS]

> If you're an enterprise customer with a Master Services Agreement (MSA), Retell doesn't use your data to train models. [R-COMP]

### 2.3 Bland AI

Base URL `https://api.bland.ai`. Auth header `Authorization: Bearer YOUR_API_KEY`. A bare key with no prefix is also accepted. `x-api-key` is not read [B-QUICK].

**(a) Place one call** [B-SEND] [B-QUICK].

```
POST https://api.bland.ai/v1/calls
{
  "phone_number": "+15551234567",
  "task": "<prompt with the questions>",
  "first_sentence": "<fixed disclosure sentence>",
  "voice": "Karen",
  "max_duration": 15,
  "record": false,
  "from": "<own number, optional>",
  "metadata": { "outreach_id": "<the fund's id>" },
  "webhook": "https://<optional>"
}
```

- Response: `{ "status": "success", "call_id": "..." }`.
- `task` is required unless `agent_id`, `persona_id` or `pathway_id` is given. `record` defaults to false. `max_duration` is in minutes and defaults to 30.

> By default, calls are initiated from a separate pool of numbers owned by Bland. [B-SEND]

**(b) Learn that it ended.** Both ways. A `webhook` URL receives the full call object when the call ends, signed in an `X-Webhook-Signature` header (HMAC SHA-256) [B-QUICK] [B-SIGN]. Or poll `GET /v1/calls/{call_id}` until `completed` is `true`. `status` is `completed`, `failed`, `busy`, `no-answer`, `canceled` or `unknown`. `answered_by` is `human`, `voicemail`, `unknown` or `no-answer`. Also `error_message` and `call_ended_by` [B-QUICK].

**(c) Transcript and recording** [B-QUICK] [B-REC]. `concatenated_transcript` (string), `transcripts[]` (`text`, `user`, `created_at`), `summary`. `recording_url` exists only when `record` was true. Audio stream: `GET https://api.bland.ai/v1/recordings/{call_id}`. Fields can take up to a minute to settle. No endpoint that deletes a call is listed in the docs index [B-INDEX].

**Callee-initiated.** Buy an inbound number ($15 a month) and set its prompt. On inbound numbers `record` defaults to true [B-INB] [B-INBU]. For the web, a server-minted session token lets a browser talk to an agent through the Web Agent SDK [B-WEBSDK].

**Price** [B-PRICE] [B-BILL] [B-INDEX]. $0.14 per minute on Start (no platform fee, 100 calls a day). $0.12 on Build ($299 a month). The docs also list Scale at $0.11 for $499. Model, speech and telephony are included.

**Terms and data** [B-TERMS, last updated 2026-08-28] [B-PRIV, last updated 2026-06-23].

> You are solely responsible for ensuring that your use of the Service complies with all applicable laws and regulations. [B-TERMS]

> However, by submitting User Content, you automatically grant Bland AI a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, store, reproduce, modify, create derivative works, publish, distribute and sublicense your User Content in connection with operating and providing the Service. [B-TERMS]

> We retain your information for as long as necessary to provide you with the Service and fulfill the purposes described in this Privacy Policy. [B-PRIV]

The prohibited uses name "unauthorized spam" and gathering personal information without consent (paraphrase). Neither page has a clause on AI disclosure, recording consent or model training.

### 2.4 ElevenLabs Agents

Base URL `https://api.elevenlabs.io` (regional hosts exist). Auth header `xi-api-key: <key>` [E-AUTH] [E-OUT]. A stored agent and an imported Twilio number or SIP trunk are needed first [E-TWILIO]. Overrides of the system prompt and first message must be switched on in the agent's security settings [E-OVR].

**(a) Place one call** [E-OUT] [E-SIP].

```
POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call
{
  "agent_id": "<agent id>",
  "agent_phone_number_id": "<number id>",
  "to_number": "+14155550123",
  "conversation_initiation_client_data": {
    "conversation_config_override": {
      "agent": { "first_message": "<fixed disclosure sentence>",
                 "prompt": { "prompt": "<system prompt with the questions>" } } },
    "dynamic_variables": { "purpose": "<text>" }
  },
  "call_recording_enabled": false
}
```

- Response `200`: `success`, `message`, `conversation_id`, `callSid`.
- `call_recording_enabled` lets Twilio record the call into the fund's Twilio account. ElevenLabs' own audio saving is a separate agent setting and is on by default [E-AUDIOSAVE].
- For a SIP trunk the path is `POST /v1/convai/sip-trunk/outbound-call` [E-SIP].

**(b) Learn that it ended.** Both ways. Post-call webhooks are set for the workspace: `post_call_transcription`, `post_call_audio`, `call_initiation_failure`, verified with the `ElevenLabs-Signature` header [E-HOOK]. Or poll `GET /v1/convai/conversations/{conversation_id}`; `status` is `initiated`, `in-progress`, `processing`, `done` or `failed` [E-GET].

**(c) Transcript and recording** [E-GET] [E-AUDIO] [E-DEL]. `transcript[]` with `role` (`user` or `agent`), `message`, `time_in_call_secs`. `metadata.call_duration_secs`, `metadata.termination_reason`, `has_audio`. Audio: `GET /v1/convai/conversations/{conversation_id}/audio`. Delete: `DELETE /v1/convai/conversations/{conversation_id}`.

**Callee-initiated.** A Twilio number linked to the agent answers inbound calls [E-TWILIO]. A public agent has an embeddable widget and a hosted shareable page. A private agent needs a signed URL from `GET /v1/convai/conversation/get-signed-url` [E-WIDGET] [E-SIGNED].

**Price** [E-PRICE]. Calls beyond the plan's minutes cost $0.08 per minute, or $0.16 above the concurrency limit. Model use is billed on top. The carrier bills the fund directly.

**Terms** [E-POLICY, last updated 2026-10-09].

> You must clearly disclose when people are interacting with AI where required by law or where failing to do so would materially mislead them. [E-POLICY]

> Generating content for spam, or for automated calling or messaging that is unlawful or made without the consent required by applicable law [E-POLICY]

> You may not use our Services, or permit them to be used, for any purpose or as part of any system that is classified as prohibited, high-risk, high-impact, or by a similar description under any applicable law governing artificial intelligence, including the European Union's Artificial Intelligence Act, Regulation (EU) 2024/1689. [E-POLICY]

The second quote is an item in the list of prohibited uses. The third matters if a founder-scoring system is ever classed as high-risk (question 11 in section 4.5).

**Data** [E-RET] [E-ZRM] [E-TERMS, last updated 2026-10-09].

> By default, ElevenLabs retains conversation data for 2 years. [E-RET]

- Retention can be set in days, to -1 for unlimited, or to 0 for scheduled deletion. Zero Retention Mode stores no recording and no transcript; results then arrive only by webhook [E-ZRM].

> You hereby grant to ElevenLabs a license to use, reproduce, modify, adapt, publish, translate, create derivative works from, distribute, publicly or otherwise perform and display, and use your Content to provide the Services (including the trust and safety features therein), to improve the Services, and to develop new services and products. [E-TERMS]

> In addition, you may opt out of our use of your Content for training at any time by navigating to the 'Data use' menu in the 'Terms and Privacy' section of your ElevenLabs account. [E-TERMS]

Whether a business agreement or a data processing addendum changes this default for agent calls was not checked.

### 2.5 OpenAI

There are two APIs. The Live API (`gpt-live-1`) can place a call. The Realtime API (`gpt-realtime-2.1`) can only take one [O-SIP].

> Outbound SIP calling is available to all organizations through the Live API, not the Realtime API call-creation endpoint. [O-SIP]

Auth header `Authorization: Bearer $OPENAI_API_KEY` [O-SIP].

**(a) Place one call** (Live API) [O-SIP] [O-CREATE].

```
POST https://api.openai.com/v1/live/sessions
{
  "session": { "model": "gpt-live-1",
               "instructions": "<system prompt with the questions>",
               "audio": { "output": { "voice": "marin" } },
               "delegation": { "type": "client" } },
  "transport": { "type": "sip", "destination": "+14155550123",
                 "trunk": { "provider_url": "sips:sip.example.com:5061",
                            "auth": { "type": "digest", "username": "...", "password": "..." },
                            "caller_number": "+14155550100" } }
}
```

- Response: `{ "session": { "id": "live_123" }, "transport": { "type": "sip" } }`. The guide says `200 OK`; the reference says `201 Created`. It does not mean the call was answered.
- The fund supplies the SIP trunk (TLS signalling, SRTP media) and its credentials on every request.
- A retried request can place a second call [O-CREATE].
- Ringing is limited to 3 minutes and a call to 2 hours.

**(b) Learn that it ended.** The guide describes no completion webhook for an outbound call. The fund's server opens `wss://api.openai.com/v1/live/sessions/{session_id}/attach` at once and reads `transport.ringing`, `transport.answered`, `transport.failed` and `session.closed`. Events from the 3 seconds before attaching are replayed. Hang up with `POST /v1/live/sessions/{session_id}/hangup` [O-SIP].

**(c) Transcript and recording** [O-CONV]. The same socket carries `session.input_transcript.delta` (the person) and `session.output_transcript.delta` (the model), each with `start_ms` and `end_ms`. There is no end-of-turn marker; the fund's code assembles the transcript. The API keeps no recording unless `store` is true, and that feature exists to fork sessions.

> Stored recordings are available for 30 days. [O-CONV]

**The first sentence is not guaranteed** [O-CONV].

> Startup instructions can improve greeting behavior, but do not guarantee that the model will speak. [O-CONV]

> For exact wording and a known playback-completion point, play a verified recording or rendered clip through your application and control GPT-Live output while it plays. [O-CONV]

**Callee-initiated** [O-SIP]. Point a SIP trunk at `sip:$PROJECT_ID@sip.api.openai.com;transport=tls`. The Live API sends a `live.transport.incoming` webhook and the server answers with `POST /v1/live/sessions/{session_id}/accept`. The Realtime API sends `realtime.call.incoming`, and the server answers with `POST /v1/realtime/calls/{call_id}/accept`, then watches `wss://api.openai.com/v1/realtime?call_id={call_id}`. Both need a public webhook endpoint. A browser can also start a WebRTC session from the fund's page [O-CREATE].

**Price** [O-PRICE]. `gpt-live-1` $0.05 per minute, billed per second, with backend model use charged separately. `gpt-realtime-2.1` audio is $32 per million input tokens and $64 per million output tokens. The SIP trunk is extra.

**Terms and data** [O-DATA]. The usage policies page returned HTTP 403 to `curl` and to a fetch tool, and was not read.

> As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us). [O-DATA]

The data table lists `/v1/live/sessions` with 30 days of abuse-monitoring logs and application state "None, or 30 days if stored", and `/v1/realtime` with 30 days of logs and no application state [O-DATA].

### 2.6 Twilio ConversationRelay

Twilio places the call and does speech-to-text and text-to-speech. The fund's own WebSocket server receives the person's words as text and sends back the reply as text [T-NOUN]. Auth is HTTP Basic with an API key and secret [T-CALL].

**(a) Place one call** [T-CALL] [T-NOUN] [T-CR].

```
POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Calls.json
(form encoded)
To=+14155550123
From=+14155550100
StatusCallback=https://<fund server>/status
Twiml=<Response><Connect action="https://<fund server>/connect_action">
        <ConversationRelay url="wss://<fund server>/websocket"
                           welcomeGreeting="<fixed disclosure sentence>" />
      </Connect></Response>
```

- Required: `To` and `From`. The call instructions come from `Twiml` (inline, at most 4,000 characters), `Url` or `ApplicationSid`. Other parameters include `Record`, `RecordingStatusCallback`, `MachineDetection`, `Timeout`, `TimeLimit`.
- Response: the Call resource. Keep `sid`.

> The message Twilio plays to the caller after answering a call. [T-NOUN]

- The WebSocket handshake carries an `X-Twilio-Signature` header [T-ONB]. Twilio sends `setup`, `prompt` (`voicePrompt`, `lang`, `last`), `dtmf`, `interrupt` and `error` messages. The server sends `text` tokens and an `end` message [T-WS].

**(b) Learn that it ended.** Both ways. `StatusCallback` posts `CallSid` and `CallStatus` (`queued`, `initiated`, `ringing`, `in-progress`, `completed`, `busy`, `failed`, `no-answer`, `canceled`). Or `GET .../Calls/{Sid}.json`. The `action` URL on `<Connect>` is called when the relay session ends [T-CALL] [T-NOUN].

**(c) Transcript and recording.** The transcript is whatever the fund's server kept from the `prompt` messages and its own replies. An `intelligenceService` attribute can also persist transcripts in Twilio [T-NOUN]. Recording starts with `Record` on the call or through the Recordings resource. Media: `GET .../Recordings/{Sid}.mp3` or `.wav`. Delete: `DELETE .../Recordings/{Sid}.json`; metadata stays 40 days [T-REC].

**Callee-initiated.** A Twilio number or TwiML App that returns the same TwiML [T-ONB].

**Price** [T-PRICE]. Conversation Relay $0.07 per minute. US local outbound $0.0140, inbound $0.0085. Recording $0.0025 per minute, storage $0.0005 per minute per month. The fund's own model is extra.

**Terms and data** [T-AUP, last updated 2025-05-12] [T-REC] [T-AI, last updated 2026-05-04]. The first two quotes are items in the list of prohibited activities.

> Violating laws, regulations, governmental orders, industry standards, or telecommunications providers' requirements or guidance in any applicable jurisdiction, including any of the foregoing that require (a) consent be obtained prior to transmitting, recording, collecting, or monitoring data or communications or (b) compliance with opt-out requests for any data or communications. [T-AUP]

> Creating a false identity or any attempt to mislead others as to the identity of the sender or the origin of any data or communications. [T-AUP]

> If you choose to record voice or video calls, you need to comply with certain laws and regulations, including those regarding obtaining consent to record (such as California's Invasion of Privacy Act and similar laws in other jurisdictions). [T-REC]

> Twilio agrees that AI/ML Content will not be used to improve, train, and fine-tune Twilio’s other AI/ML Features and any related models not used by Customer, without Customer’s acceptance of or agreement to supplemental terms granting Twilio the right to do so. [T-AI]

How long Twilio keeps a recording that is never deleted was not found in the pages read.

## 3. Why Vapi and not the others

- **Retell.** Its terms are the clearest, and its API has polling and deletion. Two gaps for this use: the prompt cannot be replaced per call, and no way to start recording only after consent was found. Data is kept forever unless the agent is configured otherwise, and call data feeds model training unless recording is opted out [R-CREATE] [R-RET] [R-TERMS].
- **Bland.** The simplest request. But recording is fixed when the call is sent, no delete endpoint is listed, and the terms take a perpetual, irrevocable licence to content [B-SEND] [B-INDEX] [B-TERMS].
- **ElevenLabs.** Good API and deletion. Default retention is 2 years, training is opt-out, and the policy bars use inside a system classed as high-risk [E-RET] [E-TERMS] [E-POLICY].
- **OpenAI.** A low stated price and no training on API data. But its own guide says the model may not speak the first sentence as written, it keeps no recording, and the fund must bring a SIP trunk and build the transcript [O-CONV] [O-SIP].
- **Twilio.** The most control: the fund's code holds the conversation and decides when recording starts. It needs a public `wss://` server, and this repository's server binds to loopback and has no login. It is the route to take if the fund later wants its own models in the loop [T-NOUN] [T-ONB].

Vapi can also use OpenAI and Anthropic models and ElevenLabs voices, so the choice does not lock the model [V-CREATE] [V-PRICE].

## 4. Law

### 4.1 United States: the TCPA and the FCC's ruling on AI voices

**The statute** (47 U.S.C. § 227(b)(1), 2024 edition) [L-227]. It is unlawful:

> to make any call (other than a call made for emergency purposes or made with the prior express consent of the called party) using any automatic telephone dialing system or an artificial or prerecorded voice ... to any telephone number assigned to a paging service, cellular telephone service, specialized mobile radio service, or other radio common carrier service, or any service for which the called party is charged for the call [L-227]

> to initiate any telephone call to any residential telephone line using an artificial or prerecorded voice to deliver a message without the prior express consent of the called party [L-227]

**The ruling.** Declaratory Ruling FCC 24-17, CG Docket No. 23-362, adopted 2 February 2024, released 8 February 2024 [L-FCC].

> In this Declaratory Ruling, we confirm that the TCPA’s restrictions on the use of “artificial or prerecorded voice” encompass current AI technologies that generate human voices. [L-FCC]

> As a result, calls that use such technologies fall under the TCPA and the Commission’s implementing rules, and therefore require the prior express consent of the called party to initiate such calls absent an emergency purpose or exemption. [L-FCC]

> Therefore, callers must obtain prior express consent from the called party before making a call that utilizes artificial or prerecorded voice simulated or generated through AI technology. If these robocalls introduce an advertisement or contain telemarketing, the Commission’s rules require that the caller obtain the prior express written consent of the called party. [L-FCC]

> In addition, our rules require that all artificial or prerecorded voice messages must provide certain identification and disclosure information for the entity responsible for initiating the call. [L-FCC]

> IT IS FURTHER ORDERED that this Declaratory Ruling shall be effective upon release. [L-FCC]

So the ruling held that an AI-generated voice is an "artificial or prerecorded voice". The consent it requires is prior express consent, or prior express written consent when the call advertises or is telemarketing.

**The rule** (47 CFR 64.1200, eCFR current to 2026-11-10) [L-CFR].

- Mobile numbers, paragraph (a)(1)(iii). No person may:

> initiate any telephone call (other than a call made for emergency purposes or is made with the prior express consent of the called party) using an automatic telephone dialing system or an artificial or prerecorded voice; ... To any telephone number assigned to a paging service, cellular telephone service, specialized mobile radio service, or other radio common carrier service, or any service for which the called party is charged for the call. [L-CFR]

- Landlines. Paragraph (a)(3) covers residential lines and lets a non-marketing commercial call through without consent within a limit. Neither (a)(1) nor (a)(3) names a business landline. Software cannot reliably tell a mobile from a landline or a home from an office, so the flow in section 5 treats every number as needing consent. A residential call needs no consent if it:

> Is made for a commercial purpose but does not include or introduce an advertisement or constitute telemarketing and the caller makes no more than three calls within any consecutive 30-day period to the residential line and honors the called party's request to opt out of future calls as required in paragraphs (b) and (d) of this section; [L-CFR]

- Written consent, paragraphs (f)(9) and (f)(13).

> The term prior express written consent means an agreement, in writing, bearing the signature of the person called that clearly authorizes the seller to deliver or cause to be delivered to the person called advertisements or telemarketing messages using an automatic telephone dialing system or an artificial or prerecorded voice, and the telephone number to which the signatory authorizes such advertisements or telemarketing messages to be delivered. [L-CFR]

> The term telemarketing means the initiation of a telephone call or message for the purpose of encouraging the purchase or rental of, or investment in, property, goods, or services, which is transmitted to any person. [L-CFR]

- Identification, paragraphs (b)(1) and (b)(2). All artificial or prerecorded voice telephone messages shall:

> At the beginning of the message, state clearly the identity of the business, individual, or other entity that is responsible for initiating the call. If a business is responsible for initiating the call, the name under which the entity is registered to conduct business with the State Corporation Commission (or comparable regulatory authority) must be stated; [L-CFR]

> During or after the message, state clearly the telephone number (other than that of the autodialer or prerecorded message player that placed the call) of such business, other entity, or individual. [L-CFR]

- Calling hours, paragraph (c)(1). The limit is written for a "telephone solicitation". A call made with the person's "prior express invitation or permission" is outside that term (paragraph (f)(15)).

> No person or entity shall initiate any telephone solicitation to: ... Any residential telephone subscriber before the hour of 8 a.m. or after 9 p.m. (local time at the called party's location) [L-CFR]

- Revocation, paragraph (a)(10), as in force today.

> All requests to revoke prior express consent or prior express written consent made in any reasonable manner must be honored within a reasonable time not to exceed ten business days from receipt of such request. [L-CFR]

A final rule published at 91 FR 67214 (FCC 26-67) rewrites paragraphs (a)(10) to (a)(12) with effect from 25 November 2026. A caller may then name one method as the only way to revoke, and must say so on the call. The ten business day limit stays [L-FR26].

> The caller must clearly and conspicuously disclose the designated method to revoke consent on the call or in the text. [L-FR26]

**Damages** [L-227].

> an action to recover for actual monetary loss from such a violation, or to receive $500 in damages for each such violation, whichever is greater [L-227]

**Two limits on the ruling.**

- The FCC proposed, but has not adopted, rules that would define AI-generated calls and require callers to disclose them (89 FR 73321, 10 September 2024) [L-FR24]. A Federal Register search on 2026-11-13 for FCC documents citing docket 23-362 returned that proposal and no final rule [L-FRSEARCH].
- A court need not follow the FCC's reading. McLaughlin Chiropractic Associates, Inc. v. McKesson Corp., 606 U.S. 146 (2025) [L-MCK]:

> The District Court is not bound by the FCC's interpretation of the TCPA. [L-MCK]

### 4.2 Recording consent

**Federal: one party is enough** (18 U.S.C. § 2511(2)(d)) [L-2511].

> It shall not be unlawful under this chapter for a person not acting under color of law to intercept a wire, oral, or electronic communication where such person is a party to the communication or where one of the parties to the communication has given prior consent to such interception unless such communication is intercepted for the purpose of committing any criminal or tortious act in violation of the Constitution or laws of the United States or of any State. [L-2511]

**States that require more than one party's consent.** Each quote below is the state's own text.

- California, Penal Code § 632(a), and § 632.7(a) for calls with a mobile or cordless phone. § 637.2 allows a civil claim of $5,000 per violation [L-CA].

> A person who, intentionally and without the consent of all parties to a confidential communication, uses an electronic amplifying or recording device to eavesdrop upon or record the confidential communication, whether the communication is carried on among the parties in the presence of one another or by means of a telegraph, telephone, or other device, except a radio, shall be punished by a fine not exceeding two thousand five hundred dollars ($2,500) per violation [L-CA]

> Every person who, without the consent of all of the parties to a communication, intercepts or receives and intentionally records, or assists in the interception or reception and intentional recordation of, a communication transmitted between two cellular radio telephones, a cellular radio telephone and a landline telephone [L-CA]

- Florida, Fla. Stat. § 934.03(2)(d) (2026 statutes) [L-FL].

> It is lawful under this section and ss. 934.04-934.09 for a person to intercept a wire, oral, or electronic communication when all of the parties to the communication have given prior consent to such interception. [L-FL]

- Illinois, 720 ILCS 5/14-2(a)(2). "Surreptitious" and "private conversation" are defined in 5/14-1 [L-IL] [L-IL1].

> Uses an eavesdropping device, in a surreptitious manner, for the purpose of transmitting or recording all or any part of any private conversation to which he or she is a party unless he or she does so with the consent of all other parties to the private conversation; [L-IL]

- Washington, RCW 9.73.030(1)(a) and (3). The announcement must itself be on the recording [L-WA].

> Private communication transmitted by telephone, telegraph, radio, or other device between two or more individuals between points within or without the state by any device electronic or otherwise designed to record and/or transmit said communication regardless how such device is powered or actuated, without first obtaining the consent of all the participants in the communication; [L-WA]

> Where consent by all parties is needed pursuant to this chapter, consent shall be considered obtained whenever one party has announced to all other parties engaged in the communication or conversation, in any reasonably effective manner, that such communication or conversation is about to be recorded or transmitted: PROVIDED, That if the conversation is to be recorded that said announcement shall also be recorded. [L-WA]

- Pennsylvania, 18 Pa.C.S. § 5704(4), an exception to the felony in § 5703 [L-PA] [L-PA3].

> A person, to intercept a wire, electronic or oral communication, where all parties to the communication have given prior consent to such interception. [L-PA]

- Massachusetts, G.L. c. 272, § 99(B)(4). "Interception":

> means to secretly hear, secretly record, or aid another to secretly hear or secretly record the contents of any wire or oral communication through the use of any intercepting device by any person other than a person given prior authority by all parties to such communication [L-MA]

- Maryland, Cts. & Jud. Proc. § 10-402(c)(3) [L-MD].

> It is lawful under this subtitle for a person to intercept a wire, oral, or electronic communication where the person is a party to the communication and where all of the parties to the communication have given prior consent to the interception [L-MD]

- New Hampshire, RSA 570-A:2, I [L-NH].

> A person is guilty of a class B felony if, except as otherwise specifically provided in this chapter or without the consent of all parties to the communication, the person: (a) Wilfully intercepts, endeavors to intercept, or procures any other person to intercept or endeavor to intercept, any telecommunication or oral communication; [L-NH]

- Montana, MCA 45-8-213(1)(c). The test is every party's knowledge [L-MT].

> records or causes to be recorded a conversation by use of a hidden electronic or mechanical device that reproduces a human conversation without the knowledge of all parties to the conversation [L-MT]

- Connecticut, Gen. Stat. § 52-570d(a). Consent must be in writing or at the start of the recording [L-CT].

> No person shall use any instrument, device or equipment to record an oral private telephonic communication unless the use of such instrument, device or equipment (1) is preceded by consent of all parties to the communication and such prior consent either is obtained in writing or is part of, and obtained at the start of, the recording, or (2) is preceded by verbal notification which is recorded at the beginning and is part of the communication by the recording party [L-CT]

- Nevada, NRS 200.620(1). One party's consent is not enough on its own [L-NV].

> it is unlawful for any person to intercept or attempt to intercept any wire communication unless: ... The interception or attempted interception is made with the prior consent of one of the parties to the communication; and ... An emergency situation exists and it is impractical to obtain a court order [L-NV]

Other states often listed as all-party (Delaware, Michigan, Oregon and others) were not checked. The flow in section 5 asks every person in every state, so the list does not change the code.

### 4.3 Laws that make a bot or an AI say what it is

**Federal.** No rule in force was found that requires the words "I am an AI". The identification rule in 4.1 requires the caller's name at the start. The FCC's AI disclosure rule is still a proposal [L-FR24].

**California, B.O.T. Act** (SB 1001, Bus. & Prof. Code §§ 17940 to 17943, operative 1 July 2019) [L-CA].

> It shall be unlawful for any person to use a bot to communicate or interact with another person in California online, with the intent to mislead the other person about its artificial identity for the purpose of knowingly deceiving the person about the content of the communication in order to incentivize a purchase or sale of goods or services in a commercial transaction or to influence a vote in an election. A person using a bot shall not be liable under this section if the person discloses that it is a bot. [L-CA]

> “Bot” means an automated online account where all or substantially all of the actions or posts of that account are not the result of a person. [L-CA]

> “Online” means appearing on any public-facing Internet Web site, Web application, or digital application, including a social network or publication. [L-CA]

By these words the act covers an online account used to sell or to sway a vote. The text does not mention telephone calls. Whether a web call counts is unclear.

**California, automatic dialing-announcing devices** (Pub. Util. Code §§ 2871 to 2874; § 2874 as amended by AB 2905, in effect since 1 January 2025) [L-CA].

> “automatic dialing-announcing device” means any automatic equipment which incorporates a storage capability of telephone numbers to be called or a random or sequential number generator capable of producing numbers to be called and the capability, working alone or in conjunction with other equipment, to disseminate a prerecorded message to the telephone number called. [L-CA]

> Automatic dialing-announcing devices may be used to place calls over telephone lines only pursuant to a prior agreement between the persons involved, whereby the person called has agreed that he or she consents to receive such calls from the person calling, or as specified in Section 2874. [L-CA]

> Whenever telephone calls are placed through the use of an automatic dialing-announcing device, the device may be operated only after an unrecorded, natural voice announcement has been made to the person called by the person calling. [L-CA]

> Inform the person called if the prerecorded message uses an artificial voice. [L-CA]

> A person shall not operate an automatic dialing-announcing device in this state to place a call that is received by a telephone in this state during the hours between 9 p.m. and 9 a.m. California time. [L-CA]

> This article does not apply to any automatic dialing-announcing device that is not used to randomly or sequentially dial telephone numbers, but that is used solely to transmit a message to an established business associate, customer, or other person having an established relationship with the person using the automatic dialing-announcing device to transmit the message, or to any call generated at the request of the recipient. [L-CA]

Whether a live AI agent "disseminate[s] a prerecorded message" is unclear. A prior agreement (§ 2873) or a call made at the person's request (§ 2872(f)) is the safe path either way.

**Utah** (Utah Code § 13-77-103 and § 13-77-104, both enacted in the 2025 session, in a chapter effective 7 May 2025 whose definitions were amended in 2026) [L-UT].

> A supplier that uses generative artificial intelligence to interact with an individual in connection with a consumer transaction shall disclose to the individual that the individual is interacting with generative artificial intelligence and not a human, if the individual asks or otherwise prompts the supplier about whether artificial intelligence is being used. [L-UT]

> A person is not subject to an enforcement action for violating Section 13-77-103 if the person's generative artificial intelligence clearly and conspicuously discloses: at the outset of any interaction with an individual in connection with: a consumer transaction; or the provision of regulated services; and throughout the interaction that it: is generative artificial intelligence; is not human; or is an artificial intelligence assistant. [L-UT]

The division may fine up to $2,500 per violation [L-UT].

**Maine** (10 M.R.S. § 1500-DD(2), enacted 2025) [L-ME].

> A person may not use an artificial intelligence chatbot or any other computer technology to engage in trade and commerce with a consumer in a manner that may mislead or deceive a reasonable consumer into believing that the consumer is engaging with a human being unless the consumer is notified in a clear and conspicuous manner that the consumer is not engaging with a human being. [L-ME]

**Colorado: in flux.** The legislature's summaries of the 2024 act and of the 2025 delay say [L-CO24] [L-CO25]:

> A person doing business in this state, including a deployer or other developer, that deploys or makes available an artificial intelligence system that is intended to interact with consumers must ensure disclosure to each consumer who interacts with the artificial intelligence system that the consumer is interacting with an artificial intelligence system. [L-CO24]

> The act extends the effective date of the requirements of Senate Bill 24-205 to June 30, 2026. [L-CO25]

SB 26-189, signed 14 May 2026, replaces that part from 1 January 2027 with notice duties for automated decisions in education, employment, housing, lending, insurance, health care and government services [L-CO26].

> The act repeals and reenacts those provisions with new requirements regarding the use of automated decision-making technology in consequential decisions. [L-CO26]

Whether the 2024 duty can be enforced between 30 June 2026 and 1 January 2027 was not verified.

**European Union** (Regulation (EU) 2024/1689, consolidated text of 27 July 2026) [L-EU].

> Providers shall ensure that AI systems intended to interact directly with natural persons are designed and developed in such a way that the natural persons concerned are informed that they are interacting with an AI system, unless this is obvious from the point of view of a natural person who is reasonably well-informed, observant and circumspect, taking into account the circumstances and the context of use. [L-EU]

> The information referred to in paragraphs 1 to 4 shall be provided to the natural persons concerned in a clear and distinguishable manner at the latest at the time of the first interaction or exposure. [L-EU]

> It shall apply from 2 August 2026. [L-EU]

Article 50(1) and 50(5) therefore apply since 2 August 2026. The 2026 amending regulation (EU) 2026/1744 left them in place. It gave providers of systems already on the market until 2 December 2026 for the separate marking duty in Article 50(2) [L-EU-AMEND].

> Providers of AI systems, including general-purpose AI systems, generating synthetic audio, image, video or text content, that have been placed on the market before 2 August 2026 shall take the necessary steps in order to comply with Article 50(2) by 2 December 2026. [L-EU-AMEND]

The regulation reaches providers and deployers outside the Union "where the output produced by the AI system is used in the Union" (Article 2(1)(c)). A breach of Article 50 can be fined up to EUR 15,000,000 or 3 % of worldwide turnover (Article 99(4)) [L-EU]. Data protection law (GDPR) also applies to recording and transcribing a person in the Union. It was not researched here.

**United Kingdom** (Privacy and Electronic Communications Regulations 2003, regulations 19 and 24) [L-PECR19] [L-PECR24].

> A person shall neither transmit, nor instigate the transmission of, communications comprising recorded matter for direct marketing purposes by means of an automated calling ... system except in the circumstances referred to in paragraph (2). [L-PECR19]

> an automated calling system is a system which is capable of ... automatically initiating a sequence of calls to more than one destination in accordance with instructions stored in that system; and ... transmitting sounds which are not live speech for reception by persons at some or all of the destinations so called. [L-PECR19]

The omitted words in the first quote are "or communication", added in 2011. Paragraph (2) requires that the subscriber has told the caller that they consent to such calls on that line. Regulation 24 requires the caller's name and an address or free phone number [L-PECR24]. The regulator's guidance reads [L-ICO]:

> You must not make an automated marketing call ... unless the person has specifically consented to receive this type of call from you. [L-ICO]

The rule is written for direct marketing. Whether a reference call or a founder call is direct marketing is unclear. UK data protection law was not researched here.

### 4.4 A reference call about a named founder: FCRA and state law

**Unclear.** The Fair Credit Reporting Act turns on four definitions (15 U.S.C. § 1681a, 2024 edition) [L-1681a].

> The term "consumer report" means any written, oral, or other communication of any information by a consumer reporting agency bearing on a consumer's credit worthiness, credit standing, credit capacity, character, general reputation, personal characteristics, or mode of living which is used or expected to be used or collected in whole or in part for the purpose of serving as a factor in establishing the consumer's eligibility for ... (A) credit or insurance to be used primarily for personal, family, or household purposes; ... (B) employment purposes; or ... (C) any other purpose authorized under section 1681b of this title. [L-1681a]

> The term "investigative consumer report" means a consumer report or portion thereof in which information on a consumer's character, general reputation, personal characteristics, or mode of living is obtained through personal interviews with neighbors, friends, or associates of the consumer reported on or with others with whom he is acquainted or who may have knowledge concerning any such items of information. [L-1681a]

> The term "consumer reporting agency" means any person which, for monetary fees, dues, or on a cooperative nonprofit basis, regularly engages in whole or in part in the practice of assembling or evaluating consumer credit information or other information on consumers for the purpose of furnishing consumer reports to third parties [L-1681a]

> The term "employment purposes" when used in connection with a consumer report means a report used for the purpose of evaluating a consumer for employment, promotion, reassignment or retention as an employee. [L-1681a]

Section 1681b lists as a permissible purpose a person who [L-1681b]:

> otherwise has a legitimate business need for the information ... in connection with a business transaction that is initiated by the consumer [L-1681b]

What the text supports: a report exists only when a "consumer reporting agency" furnishes it to "third parties". A fund that interviews references itself, for its own decision, is not on its face furnishing reports to third parties. What the text leaves open: whether a vendor that conducts and summarises the interviews for the fund is such an agency; whether sharing a reference transcript with co-investors is furnishing to third parties; and whether an investment decision that includes keeping the founder as chief executive counts as "employment purposes". No agency guidance on investor reference calls was found.

California's investigative reporting law is narrower on its face. Its "consumer" is defined as [L-CA]:

> The term “consumer” means a natural individual who has made application to a person for employment purposes, for insurance for personal, family, or household purposes, or the hiring of a dwelling unit [L-CA]

Other state laws on reference statements (defamation, employer reference rules, confidentiality duties of the reference) were not researched.

### 4.5 Questions the fund's counsel must answer

1. Is the fund's call to a founder "telemarketing" or an "advertisement" under 47 CFR 64.1200(f), given the words "investment in"? If so, written consent with the (f)(9) elements is required. Is a reference call ever telemarketing?
2. Is consent given by email or web form, as in section 5, valid prior express consent, and valid prior express written consent, for an AI-voice call to a mobile number? Who must consent when a number is shared or reassigned?
3. Which legal entity must be named under 64.1200(b)(1): the management company or the fund? Which phone number satisfies (b)(2)?
4. Does a call that the person starts (inbound number or web link) fall outside the TCPA, as Vapi's guide states?
5. Which state's recording law governs an interstate call? Is live transcription by a vendor an interception even when no audio is kept? Under California Penal Code § 631, is the vendor a third party who must also be covered by the consent? That section punishes one [L-CA]:

> who willfully and without the consent of all parties to the communication, or in any unauthorized manner, reads, or attempts to read, or to learn the contents or meaning of any message, report, or communication while the same is in transit [L-CA]

6. Is an AI voice agent an "automatic dialing-announcing device" under California Pub. Util. Code § 2871? If it is, does a prior agreement under § 2873 remove the need for a live human announcement under § 2874?
7. Do the California B.O.T. Act, Utah Code § 13-77-103 and Maine § 1500-DD reach a non-sales call to a business reference? Does Utah's safe harbor need the disclosure repeated during the call?
8. What is the status of Colorado's 2024 disclosure duty until 1 January 2027, and is an investment decision a "consequential decision" under the 2026 act?
9. FCRA and state consumer-report laws: the open points in 4.4.
10. Must the founder agree before the fund calls a reference? What duties does the reference have to an employer or under a confidentiality agreement, and what is the fund's exposure to a defamation claim over a stored transcript?
11. EU and UK: is the fund a provider or a deployer under the AI Act; is a founder-scoring system high-risk under Annex III point 4 (which also matters under ElevenLabs' policy); what are the GDPR and UK GDPR duties (lawful basis, notice, transfer to a US vendor); do PECR regulation 19 or national rules on automated calls apply?
12. Vendor contract: data processing agreement, sub-processors (transcriber, model, voice), use of content for service improvement, retention, and the TCPA indemnity the fund gives Vapi.
13. How long to keep consent records and transcripts, and when a litigation hold applies.
14. Do the FTC's Telemarketing Sales Rule or state telemarketing and automatic-dialer laws add anything? They were not researched.

## 5. The minimum compliant flow

This is the outbound flow on Vapi. Each step names the source that drives it. Counsel must confirm it.

1. **Configuration gate.** The fund's registered legal name and a callback phone number are set in configuration. Calls go only to US numbers until counsel clears other countries. Without these, no call plan can be created. (64.1200(b)(1) and (b)(2) [L-CFR].)
2. **Partner approval creates an invitation, not a call.** The partner approves the call plan. The system produces invitation text. The partner sends it.
3. **The person consents in writing, before any call.** The invitation states: an AI voice assistant will call for the fund (legal name); the purpose; that the call will be recorded and transcribed by a named service provider; how to decline or stop. The person gives the number to call and a time window, and agrees by an act of their own (an unticked box they tick, or a reply that says they agree). Store the person, the number, the exact text shown, the time, the method and the purpose. Keep it at least five years. ([L-FCC]; 64.1200(a)(1)(iii) and (f)(9) [L-CFR]; Cal. Pub. Util. Code § 2873 [L-CA]; Conn. § 52-570d(a)(1) [L-CT]; five years is the floor in Retell's terms [R-TERMS].)
4. **Checks in code before dialling. Any failure refuses the call.**
   - A consent record exists for this person, this number and this purpose, and is not revoked.
   - The partner approved this one call. No batch request is ever built.
   - The local time at the person's number is between 9:00 and 21:00 and inside the window they chose. (64.1200(c)(1) [L-CFR]; Cal. Pub. Util. Code § 2872(c) [L-CA].)
   - The number is not on the fund's own do-not-call list.
   - The call plan passes the repository's check for prohibited personal attributes.
5. **Dial.** `POST /call` with a squad of two one-off assistants. The first has recording, logging and transcript off. The second has them on [V-REC] [V-CREATE].
6. **First sentence, fixed by code.** "Hello. This is an AI assistant, not a person, calling for [fund legal name]." Then: "Am I speaking with [first name]?" A wrong person ends the call. (64.1200(b)(1) [L-CFR]; Utah § 13-77-104 [L-UT]; Maine § 1500-DD [L-ME]; AI Act Article 50(1) and 50(5) [L-EU]; [R-TERMS]; [E-POLICY].)
7. **Ask before recording.** "I am calling about [purpose], as you agreed on [date]. May I record and transcribe this call? If you say no, I will end the call and nothing is kept." If the person asks at any point whether they are talking to an AI, the answer is always yes. (Section 4.2; Utah § 13-77-103 [L-UT].)
8. **Yes: start recording, then put the consent on the record.** The second assistant takes over. Its fixed first sentence: "Thank you. Recording has started. To confirm, you agree that this call with [fund legal name]'s AI assistant is recorded and transcribed. Is that right?" Anything but yes ends the call. (RCW 9.73.030(3) [L-WA]; Conn. § 52-570d(a) [L-CT].)
9. **No, silence, voicemail, or an unclear answer: end.** Say goodbye and hang up. Leave no voicemail. Store only the call id, the time and an outcome code. The first assistant has recording, logging and transcript off, so no audio and no transcript should exist [V-REC]. Delete the call record at Vapi anyway with `DELETE /call/{id}` [V-DEL]. Confirm on a test call that nothing spoken in this step is kept.
10. **During the call.** Only the approved questions. No pitch. If the person says stop or do not call again, end the call and add the number to the do-not-call list at once. (64.1200(a)(10) [L-CFR] [L-FR26].)
11. **Closing sentence, fixed by code.** "This call was made for [fund legal name]. You can reach us at [fund phone number]. Goodbye." (64.1200(b)(2) [L-CFR].)
12. **Collect.** Poll `GET /call/{id}` until `status` is `ended`. Read `artifact.transcript`, `artifact.messages` and, if wanted, `GET /call/{id}/mono-recording` [V-GET] [V-ART].
13. **Check by code, not by trust.** The transcript must contain the confirmation from step 8 and the closing sentence. If not, do not use it; delete it at Vapi and locally. Run the repository's prohibited-attribute filter. Store the transcript as untrusted data, linked to the consent record.
14. **Delete at the vendor.** `DELETE /call/{id}` once the transcript is stored. Do not wait for the 14-day default [V-DEL] [V-BILL].
15. **Later requests.** A request to stop or to delete is honoured at once, locally and at the vendor.

**What the software refuses.** A call with no consent record. A call after revocation. A call outside the hours. A second attempt after a decline. A non-US number. A batch. A voicemail message. A cloned or real person's voice. A first sentence that a person or a model has edited. Recording that starts before the yes.

**The five rules code must enforce.**

| Rule | Source |
|---|---|
| No dial without a stored, unrevoked, written consent for that person and number | 47 U.S.C. § 227(b)(1) [L-227]; 64.1200(a)(1)(iii) [L-CFR]; [L-FCC] |
| The first sentence says it is an AI and names the fund by its registered name; a fund phone number is spoken before the call ends | 64.1200(b)(1), (b)(2) [L-CFR]; [L-UT]; [L-ME]; [L-EU] |
| No recording or transcript until every party has said yes, and the yes is on the recording | Section 4.2 |
| Calls only between 9:00 and 21:00 at the person's location | 64.1200(c)(1) [L-CFR]; Cal. Pub. Util. Code § 2872(c) [L-CA] |
| A request to stop ends the call and blocks every later call to that number | 64.1200(a)(10) [L-CFR]; [L-FR26] |

**A lower-risk variant: the person starts the call.** The invitation carries a phone number or a web link, and the person calls when ready. The TCPA's words are "to make any call" and "to initiate any telephone call" [L-227], and Vapi's guide says the TCPA does not apply to inbound calls [V-TCPA]. Steps 6 to 15 stay the same. On Vapi this needs a saved assistant per approved plan and a number bound to it, or a page the fund hosts for the Web SDK [V-PHONE] [V-KEYS]. Counsel must confirm the reading (question 4).

## 6. Not verified

- Nothing was tested against a live service. No account, no key, no call.
- OpenAI's usage policies: the page returned HTTP 403 twice. Nothing is quoted from it, so OpenAI's terms on consent, AI disclosure and recording are unknown here.
- Vapi: the price of the Enterprise plan that includes the recording consent plan; the tool that hands a call from one squad member to the next; whether any message text is kept for a squad member whose transcript is off; provider enum values other than those in the docs' examples; whether Vapi's use of content for service improvement can be switched off.
- Retell and ElevenLabs: the pages for creating an agent were not opened. Whether either can start recording only after consent was not found, which is not proof that it cannot. Whether an ElevenLabs business agreement changes the training default was not checked.
- Bland: no delete-call endpoint is in the docs index; a support request might still delete data. Training on call data is not addressed in its terms or privacy page.
- Twilio: how long an undeleted recording is kept; the page for binding a number to TwiML was not opened.
- Whether the fund's calls are "telemarketing"; whether FCRA or a state consumer-report law applies; every item in section 4.5.
- All-party recording states beyond the eleven quoted. Case law on any statute here.
- Colorado between 30 June 2026 and 1 January 2027. A search result reported a federal court order pausing enforcement of the 2024 act; it was not opened.
- Whether the FCC has adopted an AI call rule that is not yet in the Federal Register.
- GDPR, UK GDPR, national rules in EU member states, and UK recording law.
- The FTC's Telemarketing Sales Rule and state automatic-dialer laws other than California's.
- California's code was read from the Legislature's bulk download file, because its web pages sit behind a bot challenge that was not bypassed. The bulk file is dated 2026-11-09.
- EUR-Lex also returned a challenge page. The EU texts were read from the EU Publications Office repository instead, which serves the same Official Journal and consolidated files.
- The US Code text is the 2024 edition on govinfo.gov. Later amendments, if any, were not checked.
- A local safety hook blocked one command that would have saved a site certificate. No result depends on it; the Illinois pages were then read with the system `curl` and normal certificate checks.

## Sources:

Date read for every entry: 2026-11-13.

Vapi
- [V-CREATE] https://docs.vapi.ai/api-reference/calls/create.md
- [V-GET] https://docs.vapi.ai/api-reference/calls/get.md
- [V-DEL] https://docs.vapi.ai/api-reference/calls/delete.md
- [V-ART] https://docs.vapi.ai/assistants/retrieve-call-artifacts.md
- [V-REC] https://docs.vapi.ai/assistants/call-recording.md
- [V-EVT] https://docs.vapi.ai/server-url/events.md
- [V-AUTH] https://docs.vapi.ai/server-url/server-authentication.md
- [V-OUT] https://docs.vapi.ai/calls/outbound-calling.md
- [V-PHONE] https://docs.vapi.ai/phone-calling.md
- [V-WEB] https://docs.vapi.ai/quickstart/web.md
- [V-KEYS] https://docs.vapi.ai/security-and-privacy/api-keys.md
- [V-CONSENT] https://docs.vapi.ai/security-and-privacy/recording-consent-plan.md
- [V-ZDR] https://docs.vapi.ai/security-and-privacy/zero-data-retention.md
- [V-TCPA] https://docs.vapi.ai/tcpa-consent.md
- [V-BILL] https://docs.vapi.ai/billing/pricing-and-success-packages.md
- [V-PRICE] https://vapi.ai/pricing
- [V-TERMS] https://vapi.ai/terms-of-service (page says last updated September 14, 2026)

Retell AI
- [R-INDEX] https://docs.retellai.com/llms.txt
- [R-CREATE] https://docs.retellai.com/api-references/create-phone-call.md (spec revision 2026-11-13)
- [R-GET] https://docs.retellai.com/api-references/get-call.md
- [R-DEL] https://docs.retellai.com/api-references/delete-call.md
- [R-WEBAPI] https://docs.retellai.com/api-references/create-web-call.md
- [R-HOOK] https://docs.retellai.com/features/webhook-overview.md
- [R-IN] https://docs.retellai.com/deploy/inbound-call.md
- [R-WEB] https://docs.retellai.com/deploy/web-call.md
- [R-RET] https://docs.retellai.com/accounts/data-retention.md
- [R-STORE] https://docs.retellai.com/accounts/privacy-disable.md
- [R-COMP] https://docs.retellai.com/general/compliance.md
- [R-PRICE] https://www.retellai.com/pricing
- [R-TERMS] https://www.retellai.com/legal/terms-of-service (page says last updated October 25, 2026)

Bland AI
- [B-INDEX] https://docs.bland.ai/llms.txt
- [B-QUICK] https://docs.bland.ai/platform/agent-quickstart.md
- [B-SEND] https://docs.bland.ai/api-v1/post/calls.md
- [B-REC] https://docs.bland.ai/api-v1/get/calls-id-recording
- [B-SIGN] https://docs.bland.ai/tutorials/webhook-signing.md
- [B-INB] https://docs.bland.ai/api-v1/post/inbound-purchase.md
- [B-INBU] https://docs.bland.ai/api-v1/post/inbound-number-update.md
- [B-WEBSDK] https://docs.bland.ai/sdks/web-agent-sdk.md
- [B-BILL] https://docs.bland.ai/platform/billing.md
- [B-PRICE] https://www.bland.ai/pricing
- [B-TERMS] https://www.bland.ai/legal/terms (page says last updated August 28, 2026)
- [B-PRIV] https://www.bland.ai/legal/privacy (page says last updated June 23, 2026)

ElevenLabs
- [E-AUTH] https://elevenlabs.io/docs/api-reference/authentication.md
- [E-OUT] https://elevenlabs.io/docs/eleven-agents/api-reference/integrations/twilio/outbound-call.md
- [E-SIP] https://elevenlabs.io/docs/eleven-agents/api-reference/sip-trunk/outbound-call.md
- [E-GET] https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get.md
- [E-AUDIO] https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-audio.md
- [E-DEL] https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/delete.md
- [E-SIGNED] https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-signed-url.md
- [E-HOOK] https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks.md
- [E-OVR] https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides.md
- [E-TWILIO] https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration.md
- [E-WIDGET] https://elevenlabs.io/docs/eleven-agents/customization/widget.md
- [E-RET] https://elevenlabs.io/docs/eleven-agents/customization/privacy/retention.md
- [E-AUDIOSAVE] https://elevenlabs.io/docs/eleven-agents/customization/privacy/audio-saving.md
- [E-ZRM] https://elevenlabs.io/docs/eleven-agents/customization/privacy/zrm.md
- [E-PRICE] https://elevenlabs.io/pricing/agents
- [E-TERMS] https://elevenlabs.io/terms-of-use (page says last updated 09 October 2026)
- [E-POLICY] https://elevenlabs.io/use-policy (page says last updated 09 October 2026)

OpenAI
- [O-SIP] https://developers.openai.com/api/docs/guides/voice-sip.md
- [O-CREATE] https://developers.openai.com/api/reference/resources/live/methods/create.md
- [O-CONV] https://developers.openai.com/api/docs/guides/live-conversations.md
- [O-PRICE] https://developers.openai.com/api/docs/pricing.md
- [O-DATA] https://developers.openai.com/api/docs/guides/your-data.md
- Not read (HTTP 403): https://openai.com/policies/usage-policies/

Twilio
- [T-CR] https://www.twilio.com/docs/voice/conversationrelay.md
- [T-NOUN] https://www.twilio.com/docs/voice/twiml/connect/conversationrelay.md
- [T-WS] https://www.twilio.com/docs/voice/conversationrelay/websocket-messages.md
- [T-ONB] https://www.twilio.com/docs/voice/conversationrelay/onboarding.md
- [T-CALL] https://www.twilio.com/docs/voice/api/call-resource.md
- [T-REC] https://www.twilio.com/docs/voice/api/recording.md
- [T-PRICE] https://www.twilio.com/en-us/voice/pricing/us
- [T-AUP] https://www.twilio.com/en-us/legal/aup (page says last updated May 12, 2025)
- [T-AI] https://www.twilio.com/en-us/legal/ai-terms/predictive-generative-ai-features (page says last updated May 4, 2026)

United States, federal
- [L-FCC] https://docs.fcc.gov/public/attachments/FCC-24-17A1.txt (same ruling as PDF: https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf)
- [L-CFR] https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-47?part=64&section=64.1200 (eCFR says Title 47 is up to date as of 2026-11-10: https://www.ecfr.gov/api/versioner/v1/titles.json)
- [L-FR26] https://www.federalregister.gov/documents/2026/10/26/2026-21821/enhancing-the-ability-of-consumers-to-control-the-robocalls (text: https://www.federalregister.gov/documents/full_text/text/2026/10/26/2026-21821.txt)
- [L-FR24] https://www.federalregister.gov/documents/2024/09/10/2024-19028/implications-of-artificial-intelligence-technologies-on-protecting-consumers-from-unwanted-robocalls
- [L-FRSEARCH] https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=%2223-362%22&conditions%5Bagencies%5D%5B%5D=federal-communications-commission&conditions%5Bpublication_date%5D%5Bgte%5D=2024-01-01&per_page=40&order=newest
- [L-227] https://www.govinfo.gov/content/pkg/USCODE-2024-title47/html/USCODE-2024-title47-chap5-subchapII-partI-sec227.htm
- [L-2511] https://www.govinfo.gov/content/pkg/USCODE-2024-title18/html/USCODE-2024-title18-partI-chap119-sec2511.htm
- [L-1681a] https://www.govinfo.gov/content/pkg/USCODE-2024-title15/html/USCODE-2024-title15-chap41-subchapIII-sec1681a.htm
- [L-1681b] https://www.govinfo.gov/content/pkg/USCODE-2024-title15/html/USCODE-2024-title15-chap41-subchapIII-sec1681b.htm
- [L-MCK] https://www.supremecourt.gov/opinions/24pdf/606us1r55_3d9g.pdf

United States, states
- [L-CA] https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip (the Legislature's bulk file, dated 2026-11-09; sections read: Penal Code 631, 632, 632.7, 637.2; Business and Professions Code 17940 to 17943; Public Utilities Code 2871 to 2875; Civil Code 1786.2)
- [L-FL] https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0900-0999/0934/Sections/0934.03.html
- [L-IL] https://www.ilga.gov/documents/legislation/ilcs/documents/072000050K14-2.htm
- [L-IL1] https://www.ilga.gov/documents/legislation/ilcs/documents/072000050K14-1.htm
- [L-WA] https://app.leg.wa.gov/RCW/default.aspx?cite=9.73.030
- [L-PA] https://www.legis.state.pa.us/WU01/LI/LI/CT/HTM/18/00.057.004.000..HTM
- [L-PA3] https://www.legis.state.pa.us/WU01/LI/LI/CT/HTM/18/00.057..HTM
- [L-MA] https://malegislature.gov/Laws/GeneralLaws/PartIV/TitleI/Chapter272/Section99
- [L-MD] https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcj&section=10-402&enactments=false
- [L-NH] https://gc.nh.gov/rsa/html/LVIII/570-A/570-A-2.htm
- [L-MT] https://mca.legmt.gov/bills/mca/title_0450/chapter_0080/part_0020/section_0130/0450-0080-0020-0130.html
- [L-CT] https://www.cga.ct.gov/current/pub/chap_925.htm
- [L-NV] https://www.leg.state.nv.us/nrs/nrs-200.html
- [L-UT] https://le.utah.gov/xcode/Title13/Chapter77/C13-77_2025050820250508.xml (chapter page: https://le.utah.gov/xcode/Title13/Chapter77/13-77.html)
- [L-ME] https://legislature.maine.gov/statutes/10/title10sec1500-DD-1.html
- [L-CO24] https://leg.colorado.gov/bills/sb24-205
- [L-CO25] https://leg.colorado.gov/bills/sb25b-004
- [L-CO26] https://leg.colorado.gov/bills/sb26-189 (signed act: https://leg.colorado.gov/bill_files/116489/download)

European Union and United Kingdom
- [L-EU] http://publications.europa.eu/resource/celex/02024R1689-20260727 (consolidated text; original at http://publications.europa.eu/resource/celex/32024R1689)
- [L-EU-AMEND] http://publications.europa.eu/resource/celex/32026R1744
- [L-PECR19] https://www.legislation.gov.uk/uksi/2003/2426/regulation/19
- [L-PECR24] https://www.legislation.gov.uk/uksi/2003/2426/regulation/24
- [L-ICO] https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/telephone-marketing/
