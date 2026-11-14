## README

Live calls use a one-off Vapi assistant when Vapi credentials, an imported outbound number, and a voice ID are configured. Each call requires the fund's registered name and an E.164 callback number. A persisted placement intent prevents automatic redial after an uncertain provider response; a human must check with the calling service. Phone-like sequences are removed from stored call text. Vapi call artifacts are deleted after local sync by default.

This adapter has only a fake-client test and has never placed a call.

## Design

| Step | Where enforced |
|---|---|
| 1. Configuration gate | Call service requires `FUND_NAME` and E.164 `FUND_CALLBACK_NUMBER`; Vapi requires key, imported number ID, and voice ID. No US-only routing. |
| 2. Partner invitation | Approval is required; invitation text generation and sending are not implemented. |
| 3. Written, stored consent | Call placement requires consent text and records its method, time, recorder, and recording choice; phone-like sequences are removed. No durable signed-consent record, chosen window, or revocation state. |
| 4. Pre-dial checks | Approved one-call action, E.164 destination, 09:00–20:00 local time, daily cap, kill switch, and prohibited agenda/questions are checked. No DNC list or chosen time window. |
| 5. Dial | Intent is stored before calling; the outreach ID is the Vapi call name and reference. `POST /call` sends one transient assistant; no idempotency header or two-assistant handoff is documented in the selected shape. |
| 6. Fixed first sentence | Code-built opening identifies the AI and registered fund, asks for the named person, and prompt rules end a wrong-person call. |
| 7. Ask before recording | Not enforced in-call; the configured recording starts when the call starts. |
| 8. Confirm recording on record | Not enforced; no assistant handoff or recorded verbal confirmation. |
| 9. Decline, silence, voicemail | No-answer, explicit refusal, and hangups of five seconds or less are not completed; terminal Vapi call data is deleted after local state is saved. Voicemail detection and spoken-step artifact proof are absent. |
| 10. During call | System prompt limits questions and directs the assistant to stop on request; no durable do-not-call list. |
| 11. Fixed closing | Vapi `endCallMessage` names the fund and gives its callback number. |
| 12. Collect | `syncCalls()` polls `GET /call/{id}` when invoked; a `placing` intent without an ID becomes failed with a human-check instruction. No automatic polling loop. |
| 13. Verify transcript | Local transcript is redacted and stored only when recording was agreed; required verbal confirmation and closing are not checked. |
| 14. Delete at vendor | Optional `forget()` runs after local terminal state and transcript storage; `VAPI_DELETE_AFTER_FETCH` defaults on. |
| 15. Later requests | Revocation and local/vendor delete requests are not implemented. |

## Rules

- A missing caller identity or callback number blocks placement: `packages/core/src/service/index.test.ts`.
- Prohibited personal attributes in approved call questions block placement: `packages/core/src/service/index.test.ts`.
- A provider response lost after acceptance cannot trigger a second placement: `packages/core/src/service/index.test.ts`.
- Local transcript storage completes before vendor deletion is attempted: `packages/core/src/service/index.test.ts`.
- Phone-like sequences are removed from consent, provider details, summaries, and transcript evidence: `packages/core/src/service/index.test.ts`.
- Vapi request shape, destination privacy, state mapping, status redaction, and HTTP error redaction are covered offline: `packages/core/src/sources/dialler-vapi.test.ts`.

## Environment

- `FUND_NAME`: registered legal name spoken at the beginning and end of calls; required to place a call.
- `FUND_CALLBACK_NUMBER`: E.164 caller callback number spoken at the end; required to place a call.
- `VAPI_API_KEY`: private Vapi API key sent only as a bearer Authorization header.
- `VAPI_PHONE_NUMBER_ID`: imported Vapi outbound number ID.
- `VAPI_VOICE_ID`: Vapi voice ID used by the documented one-off assistant shape.
- `VAPI_DELETE_AFTER_FETCH`: vendor call deletion switch; defaults on, disabled by `false`, `0`, or `off`.
