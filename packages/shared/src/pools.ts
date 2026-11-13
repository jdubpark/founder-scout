/**
 * Pools of agents.
 *
 * A job can be done by more than one member: a member is a model route, and each task of the
 * job is sent to one member. Code picks the member, deterministically, in proportion to each
 * member's share. After a run, code moves share toward the members whose work held up under
 * the system's own checks, and benches a member whose work did not.
 *
 * Three rules, each from what the research found in other systems
 * (docs/research/frameworks/):
 *  - a model never picks the model. Routers that let a model choose its own provider or
 *    rewrite its own task are the least reliable part of the frameworks studied;
 *  - share moves on evidence the member did not produce about itself: whether its quoted
 *    words were on the page, whether the fact-checker supported its items, whether it
 *    accepted a planted false claim. Never on a self-reported score;
 *  - every active member keeps a small share, so a member that had a bad week is measured
 *    again, and a change is small enough to undo.
 */

import { DEFAULT_ROUTES, RUNNER_JOBS, RUNNER_POOL } from "./models";
import { mayUseContributorModel } from "./context";
import type { JobId, ModelRoute, ProviderId } from "./registry";
import { textSeed } from "./stats";

export interface PoolMember {
  /** Unique within the job's pool. Shown to people, so keep it readable: "sonnet", "haiku". */
  id: string;
  route: ModelRoute;
  /** Share of the job's tasks sent to this member, 0 to 1. Active shares add up to 1. */
  share: number;
  status: "active" | "benched";
  /** Why it was benched, in one line. null otherwise. */
  note: string | null;
}

export type Pools = Partial<Record<JobId, PoolMember[]>>;

/** The most members one job's pool may hold. More would spread a day's tasks too thin to measure. */
export const MAX_POOL_MEMBERS = 4;

/**
 * The member a task goes to. The same key always picks the same member while shares are
 * unchanged, so a retry or a re-run does not move a task to another model. null when the pool
 * has nobody to send work to; the caller then uses the job's ordinary route.
 */
export function pickMember(members: readonly PoolMember[] | undefined, key: string): PoolMember | null {
  const usable = (members ?? []).filter((member) => member.status === "active" && member.share > 0);
  if (usable.length === 0) return null;
  const total = usable.reduce((sum, member) => sum + member.share, 0);
  const point = (textSeed(key) / 4294967296) * total;
  let running = 0;
  for (const member of usable) {
    running += member.share;
    if (point < running) return member;
  }
  return usable[usable.length - 1] as PoolMember;
}

/** What one member did over a window of tasks, counted by code. */
export interface MemberStats {
  memberId: string;
  tasks: number;
  /** Tasks that failed or returned an answer that could not be used. */
  failed: number;
  costUsd: number;
  /** Evidence items it produced. */
  items: number;
  /** Of those, items the fact-checker supported. */
  supported: number;
  /** Items rejected: quoted words not on the cited page, or unsupported by the fact-checker. */
  rejected: number;
  /** Fact-check calls it made that carried a planted false claim, and how many it accepted. */
  controls: number;
  controlsFailed: number;
}

export const EMPTY_MEMBER_STATS = (memberId: string): MemberStats => ({
  memberId, tasks: 0, failed: 0, costUsd: 0, items: 0, supported: 0, rejected: 0, controls: 0, controlsFailed: 0,
});

/**
 * Supported items for each dollar spent: the one figure a pool is balanced on. null when the
 * member produced no evidence to check (a screener or an analyst), or spent nothing.
 *
 * What it does not measure: how much an item told the analyst. A member that returns many true
 * and obvious items scores well here. The bench rule on rejected items, the floor every member
 * keeps and the small step are what stop that from running away; the evals are what would show
 * it, because thinner evidence ranks worse.
 */
export function memberYield(stats: MemberStats): number | null {
  if (stats.items === 0 || stats.costUsd <= 0) return null;
  return stats.supported / stats.costUsd;
}

export interface RebalanceOptions {
  /** A member's share moves only when every active member has done at least this many tasks. */
  minTasks: number;
  /** The most one member's share may move in one rebalance. */
  step: number;
  /** The least share an active member keeps. */
  explore: number;
  /**
   * Bench a member once it is fairly sure (see `surelyAbove`) that it accepts more than this
   * share of planted false claims...
   */
  maxControlFailRate: number;
  /** ...and it has faced at least this many. */
  minControls: number;
  /** Bench a member once it is fairly sure that more than this share of its tasks fail. */
  maxFailRate: number;
  /** Bench a member once it is fairly sure that more than this share of its items are rejected... */
  maxRejectRate: number;
  /** ...and it has produced at least this many items. */
  minItems: number;
}

export const DEFAULT_REBALANCE: RebalanceOptions = {
  minTasks: 20,
  step: 0.1,
  explore: 0.1,
  maxControlFailRate: 0.15,
  minControls: 12,
  maxFailRate: 0.3,
  maxRejectRate: 0.3,
  minItems: 20,
};

/**
 * Whether `bad` of `total` is enough to be fairly sure the true rate is above `limit`: the lower
 * end of a one-sided 90% Wilson interval sits above it. A raw rate would bench a good member on
 * an unlucky dozen (3 of 12 is 25%, and a checker that fails one time in ten does that about
 * once in nine dozens), and benching is not undone automatically.
 */
export function surelyAbove(bad: number, total: number, limit: number): boolean {
  if (total <= 0) return false;
  const z = 1.2816;
  const rate = bad / total;
  const centre = rate + (z * z) / (2 * total);
  const spread = z * Math.sqrt((rate * (1 - rate)) / total + (z * z) / (4 * total * total));
  return (centre - spread) / (1 + (z * z) / total) > limit;
}

export interface RebalanceResult {
  members: PoolMember[];
  /** One line for each thing that changed, written for a person. Empty when nothing changed. */
  changes: string[];
  /** Why nothing moved, when nothing did. */
  note: string | null;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Shares as whole percents that add up to 1. Each is rounded down, and the points left over go
 * to the shares that lost most by it, so no share moves by a whole point from where it was.
 */
function tidy(shares: number[]): number[] {
  const total = shares.reduce((sum, share) => sum + share, 0);
  if (shares.length === 0 || total <= 0) return shares.map(() => (shares.length ? 1 / shares.length : 0));
  const points = shares.map((share) => (share / total) * 100);
  const whole = points.map((value) => Math.floor(value + 1e-9));
  let left = 100 - whole.reduce((sum, value) => sum + value, 0);
  const byLoss = points.map((value, index) => ({ index, loss: value - (whole[index] as number) })).sort((a, b) => b.loss - a.loss || a.index - b.index);
  for (const { index } of byLoss) {
    if (left <= 0) break;
    whole[index] = (whole[index] as number) + 1;
    left -= 1;
  }
  return whole.map((value) => value / 100);
}

/**
 * Each member's part of the total yield, with nobody below `floor`. A member whose part would
 * be smaller is given the floor, and the others share what remains in proportion to their yield.
 */
function flooredShares(values: readonly number[], floor: number): number[] {
  const shares = values.map(() => 0);
  let open = values.map((_, index) => index);
  let remaining = 1;
  for (;;) {
    const total = open.reduce((sum, index) => sum + (values[index] as number), 0);
    const below = open.filter((index) => total <= 0 || ((values[index] as number) / total) * remaining < floor);
    if (below.length === 0 || below.length === open.length) {
      for (const index of open) shares[index] = total > 0 && below.length === 0 ? ((values[index] as number) / total) * remaining : remaining / open.length;
      return shares;
    }
    for (const index of below) shares[index] = floor;
    remaining -= below.length * floor;
    open = open.filter((index) => !below.includes(index));
  }
}

/**
 * New shares for one job's pool, from what each member did.
 *
 * Benching comes first and needs no comparison: a fact-checker that accepts planted false
 * claims, or a member whose tasks mostly fail, is taken out whatever the others did. The last
 * active member is never benched, because a job with nobody to do it is worse than a weak one.
 *
 * Shares then move toward each member's part of the total yield, by at most `step`, and never
 * below `explore`. Nothing moves until every active member has done `minTasks`: a share set on
 * five tasks is a coin toss.
 */
export function rebalance(
  members: readonly PoolMember[],
  stats: readonly MemberStats[],
  options: RebalanceOptions = DEFAULT_REBALANCE,
  /** false for a job that produces no evidence to check: its members can be benched, and its shares stay. */
  producesEvidence = true,
): RebalanceResult {
  const byId = new Map(stats.map((item) => [item.memberId, item]));
  const next = members.map((member) => ({ ...member }));
  const changes: string[] = [];

  for (const member of next) {
    if (member.status !== "active") continue;
    const activeCount = next.filter((item) => item.status === "active").length;
    if (activeCount <= 1) break;
    const seen = byId.get(member.id);
    if (!seen) continue;
    let reason: string | null = null;
    if (seen.controls >= options.minControls && surelyAbove(seen.controlsFailed, seen.controls, options.maxControlFailRate)) {
      reason = `Accepted the planted false claim in ${seen.controlsFailed} of ${seen.controls} checks.`;
    } else if (seen.tasks >= options.minTasks && surelyAbove(seen.failed, seen.tasks, options.maxFailRate)) {
      reason = `${seen.failed} of ${seen.tasks} tasks failed.`;
    } else if (seen.items >= options.minItems && surelyAbove(seen.rejected, seen.items, options.maxRejectRate)) {
      reason = `${seen.rejected} of ${seen.items} items were rejected by the checks.`;
    }
    if (reason) {
      member.status = "benched";
      member.share = 0;
      member.note = reason;
      changes.push(`${member.id} benched. ${reason}`);
    }
  }

  const active = next.filter((member) => member.status === "active");
  const renormalise = () => {
    const total = active.reduce((sum, member) => sum + member.share, 0);
    const shares = tidy(active.map((member) => (total > 0 ? member.share / total : 1 / active.length)));
    active.forEach((member, index) => { member.share = shares[index] as number; });
  };

  if (active.length < 2) {
    renormalise();
    return { members: next, changes, note: changes.length ? null : "One member does this job, so there is nothing to balance." };
  }

  const short = active.filter((member) => (byId.get(member.id)?.tasks ?? 0) < options.minTasks);
  // A member with nothing to count yet yields nothing. That is different from a job that never
  // produces anything to count (a screener, an analyst, the fact-checker itself), which the
  // caller says with `producesEvidence`.
  const values = active.map((member) => memberYield(byId.get(member.id) ?? EMPTY_MEMBER_STATS(member.id)) ?? 0);
  let note: string | null = null;
  if (!producesEvidence) {
    note = "This job produces nothing the checks can count, so shares are left as they are.";
  } else if (short.length > 0) {
    note = `Shares move once every member has done ${options.minTasks} tasks. Still short: ${short.map((member) => member.id).join(", ")}.`;
  } else if (values.every((value) => value === 0)) {
    note = "No member produced a supported item, so there is nothing to tell them apart by.";
  }
  if (note) {
    renormalise();
    return { members: next, changes, note: changes.length ? null : note };
  }

  const before = active.map((member) => member.share);
  const targets = flooredShares(values, options.explore);
  // Every share moves the same fraction of the way to its target, and that fraction is set by
  // the member with furthest to go. The moves then add up to nothing, so the shares still add
  // up to 1 with no rescaling afterwards, no move is larger than the step, and a share never
  // lands outside the span between where it was and where it is going.
  const furthest = Math.max(...active.map((member, index) => Math.abs((targets[index] as number) - member.share)));
  const fraction = furthest > options.step ? options.step / furthest : 1;
  const moved = tidy(active.map((member, index) => member.share + fraction * ((targets[index] as number) - member.share)));
  active.forEach((member, index) => { member.share = moved[index] as number; });
  active.forEach((member, index) => {
    const was = before[index] as number;
    if (Math.abs(member.share - was) >= 0.005) {
      changes.push(`${member.id}: ${percent(was)} → ${percent(member.share)} of tasks (${(values[index] as number).toFixed(1)} supported items per dollar).`);
    }
  });
  return { members: next, changes, note: changes.length ? null : "Shares already match what each member produces." };
}

/**
 * Whether a job's output is something another part of the system then judges: evidence, which
 * the quote check and the fact-checker judge, or the leads a runner finds on a page, which
 * code checks against the page and the fit screener then keeps or drops. Only such a job has
 * something to balance its pool on.
 */
export function producesEvidence(jobId: JobId): boolean {
  return jobId.startsWith("investigate.") || jobId.startsWith("company.") || jobId === "hunt.look" || jobId.startsWith("scout.");
}

/** Problems with a pool a person entered, as sentences. Empty when it can be used. */
export function poolProblems(members: readonly PoolMember[]): string[] {
  const problems: string[] = [];
  if (members.length > MAX_POOL_MEMBERS) problems.push(`A pool holds at most ${MAX_POOL_MEMBERS} members.`);
  const ids = members.map((member) => member.id.trim());
  if (ids.some((id) => !/^[a-z0-9][a-z0-9-]{0,23}$/.test(id))) problems.push("A member's name is 1 to 24 lower-case letters, digits or hyphens.");
  if (new Set(ids).size !== ids.length) problems.push("Two members have the same name.");
  if (members.some((member) => !Number.isFinite(member.share) || member.share < 0 || member.share > 1)) problems.push("A share is a number from 0 to 1.");
  const active = members.filter((member) => member.status === "active");
  if (members.length > 0 && active.length === 0) problems.push("At least one member must be active.");
  const total = active.reduce((sum, member) => sum + member.share, 0);
  if (active.length > 0 && Math.abs(total - 1) > 0.011) problems.push("The active members' shares must add up to 1.");
  return problems;
}

/**
 * Default pools for runners, scouts and screening. Runners split work equally across ready
 * DeepSeek and Meta routes. Scouts and screening get their normal route half the time, and
 * DeepSeek and Meta a quarter each, when both vendors are reachable. Direct APIs win over
 * OpenCode for each vendor.
 */
export function runnerPools(ready: (provider: ProviderId) => boolean): Pools {
  const usable = RUNNER_POOL.map((member) => {
    const apiProvider = member.route.provider;
    const cliModel = apiProvider === "deepseek-api" ? "deepseek/deepseek-flash" : "meta/muse-ember-1.0";
    const cliId = apiProvider === "deepseek-api" ? "deepseek-flash-opencode" : "muse-ember-opencode";
    if (ready(apiProvider)) return member;
    return ready("opencode-cli") ? { id: cliId, route: { provider: "opencode-cli" as const, model: cliModel } } : null;
  }).filter((member): member is { id: string; route: ModelRoute } => member !== null);
  const memberVendor = (member: { route: ModelRoute }) => member.route.provider === "deepseek-api" || member.route.model.startsWith("deepseek/")
    ? "deepseek"
    : member.route.provider === "meta-api" || member.route.model.startsWith("meta/") ? "meta" : member.route.provider;
  const availableVendors = new Set(usable.map(memberVendor));
  const bothVendors = availableVendors.has("deepseek") && availableVendors.has("meta");
  if (usable.length === 0) return {};
  const share = Math.round((1 / usable.length) * 1000) / 1000;
  const pools: Pools = {};
  for (const jobId of RUNNER_JOBS) {
    pools[jobId] = usable.map((member, index) => ({
      id: member.id,
      route: { ...member.route },
      // The last member takes what rounding left, so the shares add up to exactly 1.
      share: index === usable.length - 1 ? Math.round((1 - share * (usable.length - 1)) * 1000) / 1000 : share,
      status: "active" as const,
      note: null,
    }));
  }
  // Scouts and fit screening compare today's default with the two cheap vendors.
  if (bothVendors) {
    const scouts = ["scout.hackernews", "scout.github", "scout.research", "scout.talent", "screen.fit"] as const;
    const byVendor = new Map(usable.map((member) => [memberVendor(member), member]));
    const deepseek = byVendor.get("deepseek");
    const meta = byVendor.get("meta");
    if (deepseek && meta) for (const job of scouts) {
      pools[job] = [
        { id: "default", route: { ...DEFAULT_ROUTES[job] }, share: 0.5, status: "active", note: null },
        { ...deepseek, route: { ...deepseek.route }, share: 0.25, status: "active", note: null },
        { ...meta, id: "muse-ember", route: { ...meta.route }, share: 0.25, status: "active", note: null },
      ];
    }
  }
  return pools;
}

/** A config's pools with defaults behind them: a pool the config names always wins. */
export function withDefaultPools<T extends { pools?: Pools; routes?: Partial<Record<JobId, ModelRoute>> }>(config: T, defaults: Pools): T {
  const merged: Pools = { ...defaults, ...(config.pools ?? {}) };
  for (const job of ["scout.hackernews", "scout.github", "scout.research", "scout.talent", "screen.fit"] as const) {
    if (config.pools?.[job]) continue;
    const route = config.routes?.[job];
    if (!route) continue;
    merged[job] = (merged[job] ?? []).map((member) => member.id === "default" ? { ...member, route: { ...route } } : member);
  }
  return Object.keys(merged).length === 0 ? config : { ...config, pools: merged };
}
