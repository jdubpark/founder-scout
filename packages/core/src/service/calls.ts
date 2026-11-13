import { CALLS_PER_DAY, callInstructions, callOpening, isCallTimeAllowed, isE164, newId, type OutreachAction, type PlaceCallInput } from "@agentswarm/shared";
import type { Dialler, Store } from "../contracts";
import { ServiceError } from "../contracts";
import { redactSensitive } from "../jobs";

const iso = (date: Date): string => date.toISOString();
function reject(status: number, message: string): never { throw new ServiceError(status, message); }

export function createCallService(options: {
  store: Store;
  dialler?: { sim: Dialler; live: Dialler | null };
  now: () => Date;
  audit(actor: string, action: string, target: string, detail?: Record<string, unknown>): unknown;
}) {
  let placementTail: Promise<void> = Promise.resolve();
  const serializePlacement = async <T>(action: () => Promise<T>): Promise<T> => {
    const waiting = placementTail;
    let release!: () => void;
    placementTail = new Promise<void>((resolve) => { release = resolve; });
    await waiting;
    try { return await action(); }
    finally { release(); }
  };
  const selected = (mode: "sim" | "live"): Dialler | null => mode === "sim"
    ? options.dialler?.sim ?? null
    : options.dialler?.live ?? null;

  return {
    async status() {
      const mode = options.store.getSettings().schedule.sources;
      const dialler = selected(mode);
      if (!dialler) return { vendor: null, configured: false, detail: "No calling service connected." };
      const status = await dialler.status();
      return { vendor: dialler.vendor, ...status };
    },
    placeCall(actor: string, outreachId: string, input: PlaceCallInput): Promise<OutreachAction> {
      return serializePlacement(async () => {
      const action = options.store.getOutreach(outreachId);
      if (!action) reject(404, "Outreach action not found.");
      if (action.status !== "approved") reject(409, "Only approved outreach can be called.");
      if (action.kind !== "call_founder" && action.kind !== "call_reference") reject(409, "Only approved call items can be placed.");
      if (action.call) reject(409, "This call was already placed.");
      const how = typeof input?.consent?.how === "string" ? redactSensitive(input.consent.how.trim()) : "";
      if (how.length < 20 || !/[.!?]$/.test(how)) reject(400, "Record how the person agreed to an AI call in a short sentence.");
      if (!isE164(input.to)) reject(400, "Enter a phone number in E.164 form.");
      const at = options.now();
      if (typeof input.timezone !== "string" || !input.timezone.trim() || !isCallTimeAllowed(input.timezone.trim(), at)) reject(400, "Calls are allowed from 09:00 to 20:00 in the callee's time zone.");
      if (options.store.getSettings().killSwitch) reject(409, "Emergency stop is on.");
      const today = at.toISOString().slice(0, 10);
      const placedToday = options.store.listSwarms().flatMap((swarm) => options.store.listOutreach({ swarmId: swarm.id })).filter((item) => item.call?.placedAt.slice(0, 10) === today).length;
      if (placedToday >= CALLS_PER_DAY) reject(409, "The daily call limit has been reached.");
      const mode = options.store.getSettings().schedule.sources;
      const dialler = selected(mode);
      if (!dialler) reject(503, "No calling service is connected.");
      const readiness = await dialler.status();
      if (!readiness.configured) reject(503, "No calling service is connected.");
      const founder = options.store.getFounder(action.founderId);
      const consentAt = iso(at);
      const consent = { how, recording: Boolean(input.consent.recording), recordedBy: actor, at: consentAt };
      let result: { callId: string };
      try {
        result = await dialler.place({
          to: input.to,
          opening: callOpening(action.draft, consent.recording),
          instructions: callInstructions(action.draft),
          questions: action.draft.questions,
          maxMinutes: 15,
          record: consent.recording,
          reference: `${founder?.simId ?? action.founderId}\u0000${action.kind}\u0000${action.target.name}`,
        });
      } catch {
        const failedAt = iso(options.now());
        const failed = options.store.updateOutreach(outreachId, {
          status: "failed",
          call: { vendor: dialler.vendor, callId: "failed-before-id", placedBy: actor, placedAt: consentAt, consent, numberTail: input.to.slice(-2), state: "failed", endedAt: failedAt, durationSec: null, costUsd: null, detail: "The calling service could not place the call." },
          updatedAt: failedAt,
        });
        options.audit(actor, "outreach.call.failed", outreachId, { founderId: action.founderId, reason: "place_failed" });
        return failed;
      }
      const updated = options.store.updateOutreach(outreachId, {
        status: "dispatched",
        call: { vendor: dialler.vendor, callId: result.callId, placedBy: actor, placedAt: consentAt, consent, numberTail: input.to.slice(-2), state: "queued", endedAt: null, durationSec: null, costUsd: null, detail: null },
        updatedAt: consentAt,
      });
      options.audit(actor, "outreach.call.place", outreachId, { founderId: action.founderId, vendor: dialler.vendor, numberTail: input.to.slice(-2) });
      return updated;
      });
    },
    async syncCalls(swarmId: string): Promise<OutreachAction[]> {
      const actions = options.store.listOutreach({ swarmId, statuses: ["dispatched"] });
      const synced: OutreachAction[] = [];
      for (const action of actions) {
        if (!action.call) continue;
        const dialler = [options.dialler?.sim, options.dialler?.live].find((candidate) => candidate?.vendor === action.call?.vendor);
        const at = iso(options.now());
        if (!dialler) {
          const detail = "The calling service is no longer connected.";
          const updated = options.store.updateOutreach(action.id, { status: "failed", call: { ...action.call, state: "failed", endedAt: at, detail }, updatedAt: at });
          options.audit(action.call.placedBy, "outreach.call.failed", action.id, { founderId: action.founderId, reason: "service_disconnected" });
          synced.push(updated);
          continue;
        }
        let result;
        try { result = await dialler.fetch(action.call.callId); }
        catch { result = { state: "failed" as const, transcript: null, durationSec: null, costUsd: null, detail: "The calling service could not return this call." }; }
        const call = { ...action.call, state: result.state, endedAt: ["completed", "failed", "no_answer", "declined"].includes(result.state) ? at : null, durationSec: result.durationSec, costUsd: result.costUsd, detail: result.detail ? redactSensitive(result.detail) : null };
        if (result.state === "completed") {
          let evidenceId = action.transcriptEvidenceId;
          if (result.transcript?.trim() && action.call.consent.recording) {
          const transcript = redactSensitive(result.transcript.trim());
          evidenceId = newId("evd");
          options.store.insertEvidence({ id: evidenceId, founderId: action.founderId, kind: "call_transcript", source: "call", url: null, title: `Conversation with ${action.target.name}`, excerpt: transcript, claim: "Notes a partner wrote after this conversation.", publishedAt: null, capturedAt: at, collectedByTaskId: null, hash: `transcript:${evidenceId}`, verification: "unverified", verificationNote: null, sim: action.call.vendor === options.dialler?.sim.vendor ? { signals: [], truth: "supported" } : null });
          }
          const detail = !action.call.consent.recording && result.transcript?.trim() ? "Recording was not agreed; transcript was not stored." : call.detail;
          const completedCall = { ...call, detail };
          const updated = options.store.updateOutreach(action.id, { status: "completed", resultSummary: "AI call completed.", transcriptEvidenceId: evidenceId, call: completedCall, updatedAt: at });
          options.audit(action.call.placedBy, "outreach.call.complete", action.id, { founderId: action.founderId, transcriptStored: Boolean(evidenceId) });
          synced.push(updated);
        } else if (["completed", "failed", "no_answer", "declined"].includes(result.state)) {
          const detail = call.detail ?? (result.state === "no_answer" ? "No answer." : result.state === "declined" ? "The person declined." : "The call failed.");
          const updated = options.store.updateOutreach(action.id, { status: "failed", call: { ...call, detail }, updatedAt: at });
          options.audit(action.call.placedBy, "outreach.call.failed", action.id, { founderId: action.founderId, reason: result.state });
          synced.push(updated);
        } else {
          const updated = options.store.updateOutreach(action.id, { call, updatedAt: at });
          synced.push(updated);
        }
      }
      return synced;
    },
  };
}
