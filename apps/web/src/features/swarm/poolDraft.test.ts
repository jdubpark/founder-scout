import { describe, expect, it } from "vitest";
import type { PoolMember } from "@agentswarm/shared";
import {
  draftFromMember,
  draftFromRoute,
  memberIdFor,
  modelsFor,
  shareFraction,
  toSetPoolInput,
  type MemberDraft,
} from "./poolDraft";

const draft = (over: Partial<MemberDraft>): MemberDraft => ({
  key: "k",
  id: "sonnet",
  provider: "claude-cli",
  model: "claude-sonnet-5-5",
  share: "100",
  status: "active",
  ...over,
});

describe("turning the form into a SetPoolInput", () => {
  it("converts percentages to fractions", () => {
    const input = toSetPoolInput([draft({ share: "33.3" }), draft({ id: "haiku", share: "60", status: "active" })]);
    expect(input.members.map((m) => m.share)).toEqual([0.333, 0.6]);
  });

  it("sends shares that do not add up as they are, for the server to refuse", () => {
    const input = toSetPoolInput([draft({ share: "50" }), draft({ id: "haiku", share: "30" })]);
    expect(input.members.map((m) => m.share)).toEqual([0.5, 0.3]);
  });

  it("sends an empty list when the form has no rows, which removes the pool", () => {
    expect(toSetPoolInput([])).toEqual({ members: [] });
  });

  it("keeps the status and leaves out effort when none was set", () => {
    const [member] = toSetPoolInput([draft({ status: "benched" })]).members;
    expect(member?.status).toBe("benched");
    expect(member?.route).toEqual({ provider: "claude-cli", model: "claude-sonnet-5-5" });
  });

  it("keeps an effort the member already had", () => {
    const [member] = toSetPoolInput([draft({ effort: "high" })]).members;
    expect(member?.route).toEqual({ provider: "claude-cli", model: "claude-sonnet-5-5", effort: "high" });
  });

  it("reads a blank or non-numeric share as zero, so the server refuses it", () => {
    expect(shareFraction("")).toBe(0);
    expect(shareFraction("abc")).toBe(0);
  });
});

describe("opening the form", () => {
  it("prefills a pool's members with their shares as percentages", () => {
    const member: PoolMember = {
      id: "haiku",
      route: { provider: "claude-cli", model: "claude-haiku-5-5" },
      share: 0.25,
      status: "active",
      note: null,
    };
    expect(draftFromMember(member)).toMatchObject({ id: "haiku", share: "25", status: "active" });
  });

  it("prefills a job without a pool with its route at 100%", () => {
    expect(draftFromRoute({ provider: "claude-cli", model: "claude-sonnet-5-5" })).toMatchObject({
      provider: "claude-cli",
      model: "claude-sonnet-5-5",
      share: "100",
    });
  });
});

describe("member names", () => {
  it("makes a readable name from a label", () => {
    expect(memberIdFor("Claude Sonnet 5.5", [])).toBe("claude-sonnet-5-5");
  });

  it("adds a number when the name is taken", () => {
    expect(memberIdFor("Haiku", ["haiku"])).toBe("haiku-2");
    expect(memberIdFor("Haiku", ["haiku", "haiku-2"])).toBe("haiku-3");
  });
});

describe("models offered for a provider", () => {
  it("offers the models of the provider's vendor", () => {
    expect(modelsFor("claude-cli").length).toBeGreaterThan(0);
    expect(modelsFor("claude-cli").every((m) => m.vendor === "anthropic")).toBe(true);
  });

  it("offers none for the simulation, so the model is free text", () => {
    expect(modelsFor("sim")).toEqual([]);
  });
});
