import {
  MAX_POOL_MEMBERS,
  MODELS,
  PROVIDERS,
  getModel,
  type Effort,
  type ModelInfo,
  type PoolMember,
  type PoolMemberView,
  type ProviderId,
  type SetPoolInput,
  type ModelRoute,
} from "@agentswarm/shared";

/** One row of the pool form. Share is typed as a percentage, so it stays a string until it is saved. */
export interface MemberDraft {
  /** Stable React key. Not sent to the server. */
  key: string;
  id: string;
  provider: ProviderId;
  model: string;
  effort?: Effort;
  share: string;
  status: "active" | "benched";
}

let draftCounter = 0;
export function newKey(): string {
  draftCounter += 1;
  return `m${draftCounter}`;
}

/** A share as a percentage, without trailing zeros: 0.333 becomes "33.3". */
export function sharePercent(share: number): string {
  return String(Math.round(share * 1000) / 10);
}

export function draftFromMember(member: PoolMember | PoolMemberView): MemberDraft {
  return {
    key: newKey(),
    id: member.id,
    provider: member.route.provider,
    model: member.route.model,
    effort: member.route.effort,
    share: sharePercent(member.share),
    status: member.status,
  };
}

/** The first member of a job that has no pool: its current route, at 100%. */
export function draftFromRoute(route: ModelRoute): MemberDraft {
  return {
    key: newKey(),
    id: memberIdFor(getModel(route.model)?.label ?? route.model, []),
    provider: route.provider,
    model: route.model,
    effort: route.effort,
    share: "100",
    status: "active",
  };
}

/** A new empty row, with the next free name. */
export function blankDraft(existing: readonly MemberDraft[]): MemberDraft {
  const taken = existing.map((d) => d.id);
  return {
    key: newKey(),
    id: memberIdFor("member", taken),
    provider: "claude-cli",
    model: "",
    share: "0",
    status: "active",
  };
}

/** A readable member name from a label: "Claude Sonnet 5.5" becomes "claude-sonnet-5-5". Unique within `taken`. */
export function memberIdFor(label: string, taken: readonly string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "member";
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 24 - String(n).length - 1)}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Turns the form's rows into what the server takes. Shares become fractions; nothing is checked here. */
export function toSetPoolInput(drafts: readonly MemberDraft[]): SetPoolInput {
  return {
    members: drafts.map((d) => ({
      id: d.id.trim(),
      route: {
        provider: d.provider,
        model: d.model.trim(),
        ...(d.effort ? { effort: d.effort } : {}),
      },
      share: shareFraction(d.share),
      status: d.status,
    })),
  };
}

/** "33.3" becomes 0.333. Anything that is not a number becomes 0, so the server refuses it. */
export function shareFraction(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.round((value / 100) * 1e6) / 1e6 : 0;
}

/** Models a provider can run, by vendor. Free text is still allowed in the form. */
export function modelsFor(provider: ProviderId): ModelInfo[] {
  const vendor = PROVIDERS.find((p) => p.id === provider)?.vendor;
  if (!vendor || vendor === "none") return [];
  return MODELS.filter((m) => m.vendor === vendor);
}

export function canAddMember(drafts: readonly MemberDraft[]): boolean {
  return drafts.length < MAX_POOL_MEMBERS;
}
