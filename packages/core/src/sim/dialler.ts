import type { OutreachKind } from "@agentswarm/shared";
import type { Dialler, SimWorld } from "../contracts";

/** A local-only caller whose recordings come from the same synthetic world as other evidence. */
export function createSimDialler(world: SimWorld): Dialler {
  type CallResult = Awaited<ReturnType<Dialler["fetch"]>>;
  const calls = new Map<string, CallResult>();
  let sequence = 0;
  return {
    vendor: "Simulated",
    status: async () => ({ configured: true, detail: "Simulated" }),
    place: async (request) => {
      const callId = `sim-call-${++sequence}`;
      const [simId, kind, targetName] = request.reference.split("\u0000");
      const supported = kind === "call_founder" || kind === "call_reference" ? kind as OutreachKind : "call_founder";
      calls.set(callId, {
        state: "completed",
        transcript: world.transcript(simId ?? "", supported, targetName ?? "Founder"),
        durationSec: 240,
        costUsd: 0,
        detail: "Simulated call completed.",
      });
      return { callId };
    },
    fetch: async (callId) => calls.get(callId) ?? {
      state: "failed", transcript: null, durationSec: null, costUsd: null, detail: "Simulated call was not found.",
    },
  };
}
