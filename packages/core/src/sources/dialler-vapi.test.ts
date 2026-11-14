import { expect, it } from "vitest";
import { createLiveDialler } from "./index";
import { createVapiDialler } from "./dialler-vapi";
import type { FetchFn } from "./http";

const API_KEY = "vapi-test-private-key";
const PHONE_NUMBER = "+14155550123";
const BASE_ENV = { VAPI_API_KEY: API_KEY, VAPI_PHONE_NUMBER_ID: "phone-number-id", VAPI_VOICE_ID: "voice-id" };

it("uses Vapi's documented one-off call, maps ended states, and keeps credentials and destination private", async () => {
  const rows = [
    { id: "scheduled", body: { status: "scheduled" }, state: "queued" },
    { id: "queued", body: { status: "queued" }, state: "queued" },
    { id: "ringing", body: { status: "ringing" }, state: "queued" },
    { id: "in-progress", body: { status: "in-progress" }, state: "in_progress" },
    { id: "forwarding", body: { status: "forwarding" }, state: "in_progress" },
    { id: "no-answer", body: { status: "ended", endedReason: "customer-did-not-answer", startedAt: "2026-11-13T10:00:00Z", endedAt: "2026-11-13T10:00:30Z", artifact: { transcript: "not returned" } }, state: "no_answer" },
    { id: "declined", body: { status: "ended", endedReason: "customer-declined", startedAt: "2026-11-13T10:00:00Z", endedAt: "2026-11-13T10:00:30Z", artifact: { transcript: "not returned" } }, state: "declined" },
    { id: "declined-in-transcript", body: { status: "ended", endedReason: "assistant-ended-call", startedAt: "2026-11-13T10:00:00Z", endedAt: "2026-11-13T10:00:30Z", artifact: { transcript: "No thanks, I am not interested." } }, state: "declined" },
    { id: "immediate-hangup", body: { status: "ended", endedReason: "customer-ended-call", startedAt: "2026-11-13T10:00:00Z", endedAt: "2026-11-13T10:00:02Z", artifact: { transcript: "not returned" } }, state: "declined" },
    { id: "completed", body: { status: "ended", endedReason: "assistant-ended-call", startedAt: "2026-11-13T10:00:00Z", endedAt: "2026-11-13T10:02:00Z", cost: 0.12, artifact: { transcript: "A completed conversation." } }, state: "completed" },
    { id: "not-found", body: { status: "not-found" }, state: "failed" },
    { id: "deletion-failed", body: { status: "deletion-failed" }, state: "failed" },
  ] as const;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: FetchFn = async (url, init) => {
    requests.push({ url, init });
    const method = init?.method ?? "GET";
    if (method === "POST") return new Response(JSON.stringify({ id: "call-1" }), { status: 201 });
    if (method === "DELETE") return new Response(null, { status: 204 });
    const id = url.split("/").at(-1);
    const row = rows.find((candidate) => candidate.id === id);
    return new Response(JSON.stringify(row?.body ?? {}), { status: 200 });
  };
  expect(createLiveDialler({ VAPI_API_KEY: API_KEY })).toBeNull();
  expect(createLiveDialler({ VAPI_PHONE_NUMBER_ID: "phone-number-id" })).toBeNull();
  expect(createLiveDialler({ VAPI_API_KEY: API_KEY, VAPI_PHONE_NUMBER_ID: "phone-number-id" })?.vendor).toBe("Vapi");
  const dialler = createLiveDialler(BASE_ENV, { fetch: fakeFetch });
  expect(dialler).not.toBeNull();
  const status = await dialler!.status();
  expect(status).toEqual({ configured: true, detail: "Vapi call service is configured." });
  const incompleteStatus = await createVapiDialler({ env: { VAPI_API_KEY: API_KEY } }).status();
  expect(incompleteStatus.detail).toContain("VAPI_PHONE_NUMBER_ID");
  expect(incompleteStatus.detail).toContain("VAPI_VOICE_ID");
  expect(incompleteStatus.detail).not.toContain(API_KEY);
  expect(incompleteStatus.detail).not.toContain(PHONE_NUMBER);

  const request = {
    to: PHONE_NUMBER,
    opening: "Hello. This is an AI assistant calling for Northstar Ventures.",
    instructions: "Ask only the approved questions.",
    questions: ["What did you ship?", "What are you building next?"],
    closing: "This call was made for Northstar Ventures. Call us at +14155550100. Goodbye.",
    maxMinutes: 15,
    record: false,
    reference: "founder-1-call_founder-Ari",
  };
  expect(await dialler!.place(request)).toEqual({ callId: "call-1" });
  const first = requests[0]!;
  expect(first.url).toBe("https://api.vapi.ai/call");
  expect(first.init?.method).toBe("POST");
  expect(first.init?.signal).toBeInstanceOf(AbortSignal);
  expect(first.init?.headers).toEqual({ Accept: "application/json", Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" });
  const serializedBody = String(first.init?.body);
  expect(serializedBody.match(/\+14155550123/gu)).toHaveLength(1);
  expect(JSON.parse(serializedBody)).toEqual({
    phoneNumberId: "phone-number-id",
    customer: { number: PHONE_NUMBER },
    name: "founder-1-call_founder-Ari",
    assistant: {
      firstMessage: request.opening,
      firstMessageMode: "assistant-speaks-first",
      model: { provider: "openai", model: "gpt-4o", messages: [{ role: "system", content: "Ask only the approved questions.\n\nApproved questions:\nWhat did you ship?\nWhat are you building next?" }] },
      voice: { provider: "11labs", voiceId: "voice-id" },
      maxDurationSeconds: 900,
      endCallMessage: request.closing,
      artifactPlan: { recordingEnabled: false, loggingEnabled: false, transcriptPlan: { enabled: false } },
    },
  });

  const recorded = await dialler!.place({ ...request, record: true });
  expect(recorded.callId).toBe("call-1");
  expect(JSON.parse(String(requests[1]?.init?.body)).assistant.artifactPlan).toEqual({
    recordingEnabled: true, loggingEnabled: true, transcriptPlan: { enabled: true },
  });

  for (const row of rows) {
    const result = await dialler!.fetch(row.id);
    expect(result.state, row.id).toBe(row.state);
    expect(result.transcript, row.id).toBe(row.state === "completed" ? "A completed conversation." : null);
  }
  expect(await dialler!.fetch("completed")).toMatchObject({ durationSec: 120, costUsd: 0.12 });
  await dialler!.forget?.("completed");
  expect(requests.at(-1)?.url).toBe("https://api.vapi.ai/call/completed");
  expect(requests.at(-1)?.init?.method).toBe("DELETE");
  expect(requests.every((entry) => entry.init?.signal instanceof AbortSignal)).toBe(true);
  expect(requests.every((entry) => !entry.url.includes(API_KEY))).toBe(true);
  expect(serializedBody).not.toContain(API_KEY);
  let deleteOffRequests = 0;
  const deleteOff = createLiveDialler({ ...BASE_ENV, VAPI_DELETE_AFTER_FETCH: "off" }, {
    fetch: async () => { deleteOffRequests += 1; return new Response(null, { status: 204 }); },
  });
  await deleteOff?.forget?.("completed");
  expect(deleteOffRequests).toBe(0);

  const failingFetch: FetchFn = async () => new Response(JSON.stringify({ error: `${API_KEY} ${PHONE_NUMBER}` }), { status: 500 });
  const failingDialler = createLiveDialler(BASE_ENV, { fetch: failingFetch });
  let errorText = "";
  try { await failingDialler!.place(request); } catch (error) { errorText = error instanceof Error ? error.message : String(error); }
  expect(errorText).toContain("HTTP 500");
  expect(errorText).not.toContain(API_KEY);
  expect(errorText).not.toContain(PHONE_NUMBER);
  expect(JSON.stringify(status)).not.toContain(API_KEY);
  expect(JSON.stringify(status)).not.toContain(PHONE_NUMBER);
});
