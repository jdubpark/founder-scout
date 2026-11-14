import type { Dialler } from "../contracts";
import type { FetchFn } from "./http";

const API_BASE = "https://api.vapi.ai";
const REQUEST_TIMEOUT_MS = 20_000;
const IMMEDIATE_HANGUP_SECONDS = 5;

export interface VapiDiallerOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: FetchFn;
  timeoutMs?: number;
}

/** Vapi's documented one-off assistant call shape is described in docs/research/ai-voice-calls.md, section 2.1. */
export function createVapiDialler(options: VapiDiallerOptions = {}): Dialler {
  const env = options.env ?? process.env;
  const apiKey = env.VAPI_API_KEY?.trim() ?? "";
  const phoneNumberId = env.VAPI_PHONE_NUMBER_ID?.trim() ?? "";
  const voiceId = env.VAPI_VOICE_ID?.trim() ?? "";
  const deleteAfterFetch = !["false", "0", "off"].includes(env.VAPI_DELETE_AFTER_FETCH?.trim().toLowerCase() ?? "");
  const fetchFn: FetchFn = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const missing = (): string[] => [
    ...(!apiKey ? ["VAPI_API_KEY"] : []),
    ...(!phoneNumberId ? ["VAPI_PHONE_NUMBER_ID"] : []),
    ...(!voiceId ? ["VAPI_VOICE_ID"] : []),
  ];

  const assertConfigured = (): void => {
    const variables = missing();
    if (variables.length) throw new Error(`Vapi is not configured. Missing ${variables.join(", ")}.`);
  };

  async function request(path: string, init: RequestInit, callerSignal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetchFn(`${API_BASE}${path}`, {
        ...init,
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}`, ...init.headers },
        signal,
      });
    } catch {
      throw new Error("Vapi request failed.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Vapi request failed (HTTP ${response.status}).`);
    }
    return response;
  }

  async function json(response: Response): Promise<Record<string, unknown>> {
    try {
      const value: unknown = await response.json();
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // Discard provider parse errors because they can contain request details.
    }
    throw new Error("Vapi returned an invalid response.");
  }

  return {
    vendor: "Vapi",
    async status() {
      const variables = missing();
      return variables.length
        ? { configured: false, detail: `Missing ${variables.join(", ")}.` }
        : { configured: true, detail: "Vapi call service is configured." };
    },
    async place(call, signal) {
      assertConfigured();
      const callText = [call.reference, call.opening, call.instructions, ...call.questions, call.closing];
      if (call.to.length === 0 || callText.some((part) => part.includes(call.to))) throw new Error("Vapi call details are invalid.");
      const artifactPlan = {
        recordingEnabled: call.record,
        loggingEnabled: call.record,
        transcriptPlan: { enabled: call.record },
      };
      const response = await request("/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumberId,
          customer: { number: call.to },
          name: call.reference,
          assistant: {
            firstMessage: call.opening,
            firstMessageMode: "assistant-speaks-first",
            model: {
              provider: "openai",
              model: "gpt-4o",
              messages: [{ role: "system", content: `${call.instructions}\n\nApproved questions:\n${call.questions.join("\n")}` }],
            },
            voice: { provider: "11labs", voiceId },
            maxDurationSeconds: call.maxMinutes * 60,
            endCallMessage: call.closing,
            artifactPlan,
          },
        }),
      }, signal);
      const result = await json(response);
      if (typeof result.id !== "string" || !result.id) throw new Error("Vapi did not return a call id.");
      return { callId: result.id };
    },
    async fetch(callId, signal) {
      assertConfigured();
      const response = await request(`/call/${encodeURIComponent(callId)}`, { method: "GET" }, signal);
      const result = await json(response);
      const status = typeof result.status === "string" ? result.status : "";
      const reason = typeof result.endedReason === "string" ? result.endedReason.toLowerCase() : "";
      const startedAt = typeof result.startedAt === "string" ? Date.parse(result.startedAt) : Number.NaN;
      const endedAt = typeof result.endedAt === "string" ? Date.parse(result.endedAt) : Number.NaN;
      const durationSec = Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt
        ? Math.round((endedAt - startedAt) / 1000)
        : null;
      const costUsd = typeof result.cost === "number" && Number.isFinite(result.cost) ? result.cost : null;
      const artifact = result.artifact && typeof result.artifact === "object" ? result.artifact as Record<string, unknown> : {};
      const vendorTranscript = typeof artifact.transcript === "string" ? artifact.transcript : null;
      const transcriptDeclines = vendorTranscript !== null && /\b(?:no thanks|not interested|don't call(?: me)?|do not call(?: me)?|stop calling|i decline|please stop)\b/iu.test(vendorTranscript);
      let state: Awaited<ReturnType<Dialler["fetch"]>>["state"];
      if (["scheduled", "queued", "ringing"].includes(status)) state = "queued";
      else if (["in-progress", "forwarding"].includes(status)) state = "in_progress";
      else if (status === "ended") {
        if (/did[- ]not[- ]answer|no[- ]answer|voicemail|busy|timeout/u.test(reason)) state = "no_answer";
        else if (/declin|reject/u.test(reason) || transcriptDeclines || (durationSec !== null && durationSec <= IMMEDIATE_HANGUP_SECONDS)) state = "declined";
        else if (/fail|error|cancel/u.test(reason)) state = "failed";
        else if (durationSec === null) state = "failed";
        else state = "completed";
      } else state = "failed";

      return {
        state,
        transcript: state === "completed" ? vendorTranscript : null,
        durationSec,
        costUsd,
        detail: state === "no_answer" ? "No answer." : state === "declined" ? "The person declined or ended the call immediately." : state === "failed" ? "The Vapi call did not complete." : null,
      };
    },
    async forget(callId, signal) {
      assertConfigured();
      if (!deleteAfterFetch) return;
      await request(`/call/${encodeURIComponent(callId)}`, { method: "DELETE" }, signal);
    },
  };
}
