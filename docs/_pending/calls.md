## README

The service can place one approved founder or reference call at a time. It records the caller's AI consent and recording choice, keeps only the phone number's last two digits, and syncs completed transcripts into evidence.

## Design

- Runs only propose outreach. The service places a call after one person's action on one approved call item.
- Consent text, recording choice, recorder and timestamp are stored with the call. Calls without a short consent sentence are refused.
- The number must be E.164 and is passed only to the dialler request. The action and audit keep only the last two digits.
- The caller's time zone is required. Calls outside 09:00 to 20:00 there are refused.
- A daily limit, emergency stop and connected dialler are required. Failed, declined and unanswered calls become failed and do not retry.
- The opening, question about timing, recording notice and call instructions come from code. The approved agenda is the only allowed topic, personal attributes are prohibited, stop requests end the call, and calls last at most 15 minutes.
- Simulation uses `SimWorld.transcript` and marks the resulting evidence as simulated. Live calling stays disconnected until a reviewed vendor adapter is added.
- Completed transcripts use the existing call evidence kind and redaction path so the next run's debrief stage can read them.

## Rules

- An engine run never places an approved call; `packages/core/src/engine/index.test.ts` fails if a run changes it from approved.
- Only an approved founder or reference call with consent can be placed, and its full number never enters stored action or audit data; `packages/core/src/service/index.test.ts` fails if these limits regress.
- A synced simulated transcript becomes redacted call evidence and completes the item; `packages/core/src/service/index.test.ts` fails if the service stops doing this.
