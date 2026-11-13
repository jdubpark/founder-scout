import { describe, expect, it } from "vitest";
import type { MemberStats, PoolMemberView } from "@agentswarm/shared";
import { memberFigures, yieldText } from "./poolFigures";

const stats = (over: Partial<MemberStats> = {}): MemberStats => ({
  memberId: "sonnet",
  tasks: 60,
  failed: 0,
  costUsd: 0,
  items: 0,
  supported: 0,
  rejected: 0,
  controls: 0,
  controlsFailed: 0,
  ...over,
});

const member = (over: Partial<PoolMemberView> = {}): PoolMemberView => ({
  id: "sonnet",
  route: { provider: "claude-cli", model: "claude-sonnet-5-5" },
  share: 0.6,
  status: "active",
  note: null,
  modelLabel: "Claude Sonnet 5.5",
  stats: stats(),
  yieldPerUsd: null,
  ...over,
});

describe("member figures", () => {
  it("shows a dash for yield when the member has a null yield", () => {
    const f = memberFigures(member({ yieldPerUsd: null, stats: stats({ items: 0, costUsd: 0 }) }));
    expect(f.yield).toBe("—");
    expect(f.supported).toBe("—");
  });

  it("shows yield to one decimal place with a dollar sign", () => {
    expect(yieldText(12.44)).toBe("12.4 / $");
    expect(yieldText(null)).toBe("—");
  });

  it("shows supported of items", () => {
    const f = memberFigures(member({ stats: stats({ items: 60, supported: 41, costUsd: 3 }), yieldPerUsd: 41 / 3 }));
    expect(f.supported).toBe("41 / 60");
    expect(f.yield).toBe("13.7 / $");
  });

  it("shows planted checks passed of planted checks, and nothing when there were none", () => {
    expect(memberFigures(member({ stats: stats({ controls: 30, controlsFailed: 1 }) })).controls).toBe("29 / 30");
    expect(memberFigures(member()).controls).toBeNull();
  });

  it("marks a benched member", () => {
    expect(memberFigures(member({ status: "benched", note: "Failed." })).benched).toBe(true);
    expect(memberFigures(member()).benched).toBe(false);
  });
});
