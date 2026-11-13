import { describe, expect, it } from "vitest";
import { DEFAULT_REBALANCE, EMPTY_MEMBER_STATS, memberYield, pickMember, poolProblems, producesEvidence, rebalance, runnerPools, surelyAbove, withDefaultPools, type MemberStats, type PoolMember, type Pools } from "./pools";
import type { JobId, ModelRoute } from "./registry";

const member = (id: string, share: number, status: PoolMember["status"] = "active"): PoolMember => ({
  id, route: { provider: "claude-cli", model: `model-${id}` }, share, status, note: null,
});
const stats = (memberId: string, extra: Partial<MemberStats>): MemberStats => ({ ...EMPTY_MEMBER_STATS(memberId), ...extra });

describe("pickMember", () => {
  it("sends the same task to the same member every time", () => {
    const pool = [member("a", 0.5), member("b", 0.5)];
    expect(pickMember(pool, "task-17")?.id).toBe(pickMember(pool, "task-17")?.id);
  });

  it("splits tasks in proportion to share and never picks a benched member", () => {
    const pool = [member("a", 0.7), member("b", 0.3), member("c", 0, "benched")];
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let index = 0; index < 4000; index += 1) counts[pickMember(pool, `task-${index}`)?.id ?? "none"] = (counts[pickMember(pool, `task-${index}`)?.id ?? "none"] ?? 0) + 1;
    expect(counts.c).toBe(0);
    expect(Math.abs((counts.a ?? 0) / 4000 - 0.7)).toBeLessThan(0.03);
  });

  it("has nobody to pick from an empty or fully benched pool", () => {
    expect(pickMember(undefined, "x")).toBeNull();
    expect(pickMember([member("a", 0, "benched")], "x")).toBeNull();
  });
});

describe("rebalance", () => {
  it("counts supported items for each dollar, and nothing for a job that produces no evidence", () => {
    expect(memberYield(stats("a", { items: 10, supported: 6, costUsd: 2 }))).toBe(3);
    expect(memberYield(stats("a", { tasks: 30, costUsd: 2 }))).toBeNull();
  });

  it("moves share toward the member whose work held up, one step at a time, and keeps the shares at 1", () => {
    const pool = [member("strong", 0.5), member("weak", 0.5)];
    const seen = [
      stats("strong", { tasks: 40, items: 80, supported: 60, costUsd: 2 }),
      stats("weak", { tasks: 40, items: 80, supported: 10, costUsd: 2 }),
    ];
    const result = rebalance(pool, seen);
    expect(result.members.map((item) => [item.id, item.share])).toEqual([["strong", 0.6], ["weak", 0.4]]);
    expect(result.changes).toEqual([
      "strong: 50% → 60% of tasks (30.0 supported items per dollar).",
      "weak: 50% → 40% of tasks (5.0 supported items per dollar).",
    ]);
  });

  it("never takes a working member below its floor, however it compares", () => {
    let pool = [member("strong", 0.5), member("weak", 0.5)];
    const seen = [
      stats("strong", { tasks: 40, items: 80, supported: 79, costUsd: 1 }),
      stats("weak", { tasks: 40, items: 80, supported: 1, costUsd: 4 }),
    ];
    for (let round = 0; round < 12; round += 1) pool = rebalance(pool, seen).members;
    expect(pool.map((item) => item.share)).toEqual([0.9, 0.1]);
  });

  it("never moves a share by more than the step, with any number of members", () => {
    // Four equal members and only one of them produced anything supported.
    const pool = ["a", "b", "c", "d"].map((id) => member(id, 0.25));
    const seen = [
      stats("a", { tasks: 40, items: 40, supported: 40, costUsd: 1 }),
      ...["b", "c", "d"].map((id) => stats(id, { tasks: 40, items: 40, supported: 0, costUsd: 1 })),
    ];
    const result = rebalance(pool, seen);
    const shares = result.members.map((item) => item.share);
    expect(shares[0]).toBeCloseTo(0.35, 10);
    expect(shares.slice(1).every((share) => Math.abs(share - 0.2167) < 0.011)).toBe(true);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 10);
    for (const [index, share] of shares.entries()) expect(Math.abs(share - 0.25)).toBeLessThanOrEqual(DEFAULT_REBALANCE.step + 1e-9), index;
  });

  it("never takes a member at its floor below it while others move", () => {
    const pool = [member("a", 0.1), member("b", 0.1), member("c", 0.4), member("d", 0.4)];
    const seen = [
      stats("a", { tasks: 40, items: 40, supported: 0, costUsd: 1 }),
      stats("b", { tasks: 40, items: 40, supported: 0, costUsd: 1 }),
      stats("c", { tasks: 40, items: 40, supported: 30, costUsd: 1 }),
      stats("d", { tasks: 40, items: 40, supported: 30, costUsd: 1 }),
    ];
    const shares = rebalance(pool, seen).members.map((item) => item.share);
    expect(shares).toEqual([0.1, 0.1, 0.4, 0.4]);
  });

  it("does not move a share on a handful of tasks, and says who is short", () => {
    const result = rebalance(
      [member("a", 0.5), member("b", 0.5)],
      [stats("a", { tasks: 40, items: 40, supported: 30, costUsd: 1 }), stats("b", { tasks: 5, items: 5, supported: 0, costUsd: 1 })],
    );
    expect(result.members.map((item) => item.share)).toEqual([0.5, 0.5]);
    expect(result.changes).toEqual([]);
    expect(result.note).toBe(`Shares move once every member has done ${DEFAULT_REBALANCE.minTasks} tasks. Still short: b.`);
  });

  it("benches a fact-checker that accepts planted false claims, and gives its share to the rest", () => {
    const result = rebalance(
      [member("careful", 0.5), member("credulous", 0.5)],
      [stats("careful", { tasks: 30, controls: 30, controlsFailed: 1 }), stats("credulous", { tasks: 30, controls: 30, controlsFailed: 12 })],
    );
    expect(result.members).toEqual([
      { ...member("careful", 1), note: null },
      { ...member("credulous", 0, "benched"), note: "Accepted the planted false claim in 12 of 30 checks." },
    ]);
    expect(result.changes[0]).toBe("credulous benched. Accepted the planted false claim in 12 of 30 checks.");
  });

  it("does not bench on an unlucky handful, and does once the count leaves little doubt", () => {
    // 4 of 15 is 27%, and with fifteen checks that is still consistent with a checker that fails 15% of the time.
    expect(surelyAbove(4, 15, 0.15)).toBe(false);
    expect(surelyAbove(12, 30, 0.15)).toBe(true);
    expect(surelyAbove(0, 40, 0.15)).toBe(false);
    expect(surelyAbove(3, 0, 0.15)).toBe(false);
    const unlucky = rebalance(
      [member("careful", 0.5), member("unlucky", 0.5)],
      [stats("careful", { tasks: 15, controls: 15, controlsFailed: 0 }), stats("unlucky", { tasks: 15, controls: 15, controlsFailed: 4 })],
    );
    expect(unlucky.members.map((item) => item.status)).toEqual(["active", "active"]);
  });

  it("benches a member whose items the checks keep rejecting", () => {
    const result = rebalance(
      [member("sound", 0.5), member("sloppy", 0.5)],
      [stats("sound", { tasks: 30, items: 60, supported: 55, rejected: 3, costUsd: 1 }), stats("sloppy", { tasks: 30, items: 60, supported: 20, rejected: 36, costUsd: 0.1 })],
    );
    // The sloppy member is far cheaper, so it would have won on yield alone.
    expect(result.members.map((item) => [item.id, item.status, item.share])).toEqual([["sound", "active", 1], ["sloppy", "benched", 0]]);
    expect(result.changes[0]).toBe("sloppy benched. 36 of 60 items were rejected by the checks.");
  });

  it("benches a member whose tasks mostly fail, but never the last one standing", () => {
    const failing = stats("only", { tasks: 40, failed: 30 });
    expect(rebalance([member("only", 1)], [failing]).members[0]?.status).toBe("active");
    const two = rebalance([member("only", 0.5), member("other", 0.5)], [failing, stats("other", { tasks: 40, failed: 39 })]);
    expect(two.members.map((item) => item.status)).toEqual(["benched", "active"]);
  });

  it("leaves shares alone for a job the checks cannot count", () => {
    const result = rebalance(
      [member("a", 0.6), member("b", 0.4)],
      [stats("a", { tasks: 50, costUsd: 3 }), stats("b", { tasks: 50, costUsd: 1 })],
      DEFAULT_REBALANCE,
      false,
    );
    expect(result.members.map((item) => item.share)).toEqual([0.6, 0.4]);
    expect(result.note).toBe("This job produces nothing the checks can count, so shares are left as they are.");
    expect(producesEvidence("investigate.background")).toBe(true);
    expect(producesEvidence("company.traction")).toBe(true);
    expect(producesEvidence("verify.claims")).toBe(false);
    expect(producesEvidence("assess.judgments")).toBe(false);
  });
});

describe("poolProblems", () => {
  it("accepts a pool whose active shares add up to one", () => {
    expect(poolProblems([member("sonnet", 0.7), member("haiku", 0.3)])).toEqual([]);
    expect(poolProblems([])).toEqual([]);
  });

  it("names what is wrong with a pool", () => {
    expect(poolProblems([member("a", 0.7), member("a", 0.7)])).toEqual(["Two members have the same name.", "The active members' shares must add up to 1."]);
    expect(poolProblems([member("Has Space", 1)])).toEqual(["A member's name is 1 to 24 lower-case letters, digits or hyphens."]);
    expect(poolProblems([member("a", 1, "benched")])).toEqual(["At least one member must be active."]);
    expect(poolProblems([member("a", 0.2), member("b", 0.2), member("c", 0.2), member("d", 0.2), member("e", 0.2)])[0]).toBe("A pool holds at most 4 members.");
  });
});

describe("the runner pool", () => {
  it("shares each runner job equally between the runner models that are ready", () => {
    const pools = runnerPools(() => true);
    expect(Object.keys(pools).sort()).toEqual(["hunt.look", "hunt.sift", "scout.github", "scout.hackernews", "scout.research", "scout.talent", "screen.fit"]);
    expect(pools["hunt.look"]?.map((member) => [member.id, member.route.provider, member.share, member.status])).toEqual([
      ["deepseek-flash", "deepseek-api", 0.5, "active"],
      ["muse-ember", "meta-api", 0.5, "active"],
    ]);
    expect(poolProblems(pools["hunt.look"] ?? [])).toEqual([]);
  });

  it("is a pool of one when one key is set, and no pool at all when none is", () => {
    const one = runnerPools((provider) => provider === "meta-api");
    expect(one["hunt.look"]?.map((member) => [member.id, member.share])).toEqual([["muse-ember", 1]]);
    expect(runnerPools(() => false)).toEqual({});
  });

  it("adds a default, DeepSeek and Muse pool for scouts and screening through OpenCode, while a config pool wins", () => {
    const defaults = runnerPools((provider) => provider === "opencode-cli");
    const scout = defaults["scout.github"] ?? [];
    expect(scout.map((member) => [member.id, member.route.provider, member.route.model, member.share])).toEqual([
      ["default", "claude-cli", "claude-haiku-5-5", 0.5],
      ["deepseek-flash-opencode", "opencode-cli", "deepseek/deepseek-flash", 0.25],
      ["muse-ember", "opencode-cli", "meta/muse-ember-1.0", 0.25],
    ]);
    const own = [member("own", 1)];
    const merged = withDefaultPools({ pools: { "scout.github": own } as Pools }, defaults);
    expect(merged.pools?.["scout.github"]).toBe(own);
    expect(merged.pools?.["scout.research"]?.map((item) => item.share)).toEqual([0.5, 0.25, 0.25]);
    const routedConfig: { routes: Partial<Record<JobId, ModelRoute>>; pools?: Pools } = {
      routes: { "scout.github": { provider: "codex-cli", model: "gpt-6-luna" } },
    };
    const routed = withDefaultPools(routedConfig, defaults);
    expect(routed.pools?.["scout.github"]?.[0]?.route).toEqual({ provider: "codex-cli", model: "gpt-6-luna" });
    const directPreferred = runnerPools((provider) => provider === "opencode-cli" || provider === "deepseek-api");
    expect(directPreferred["scout.github"]?.map((item) => item.route.provider)).toEqual(["claude-cli", "deepseek-api", "opencode-cli"]);
  });

  it("stays behind a pool the config names", () => {
    const own = [{ id: "haiku", route: { provider: "claude-cli" as const, model: "claude-haiku-5-5" }, share: 1, status: "active" as const, note: null }];
    const config: { id: string; pools?: Pools } = { id: "c", pools: { "hunt.look": own } };
    const merged = withDefaultPools(config, runnerPools(() => true));
    expect(merged.pools?.["hunt.look"]).toBe(own);
    expect(merged.pools?.["hunt.sift"]?.length).toBe(2);
    // Nothing to add leaves the config as it was.
    const plain: { id: string; pools?: Pools } = { id: "c" };
    expect(withDefaultPools(plain, {})).toBe(plain);
  });
});
