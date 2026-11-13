import { describe, expect, it } from "vitest";
import {
  BASE_CONFIG,
  effectiveParam,
  effectiveRoute,
  renderSteeringBlock,
  resolveSteering,
  swarmIdentity,
  type AgentIdentity,
  type Directive,
  type ScopeSelector,
  type SwarmConfig,
} from "./steering";
import { DEFAULT_MODEL_BY_PROVIDER, DEFAULT_ROUTES } from "./models";

const NOW = new Date("2026-11-12T12:00:00Z");

let seq = 0;
function directive(partial: Partial<Directive> & { scope: ScopeSelector }): Directive {
  seq += 1;
  return {
    id: `dir_${seq}`,
    kind: "opinion",
    key: null,
    value: null,
    text: null,
    priority: 0,
    status: "active",
    author: "test",
    note: null,
    createdAt: `2026-11-01T00:00:${String(seq).padStart(2, "0")}Z`,
    updatedAt: "2026-11-01T00:00:00Z",
    expiresAt: null,
    ...partial,
  };
}

const githubScout: AgentIdentity = {
  swarmId: "swm_a",
  classId: "scout",
  jobId: "scout.github",
  agentId: "agt_gh1",
};

function param(scope: ScopeSelector, key: string, value: number | string | boolean, extra: Partial<Directive> = {}) {
  return directive({ scope, kind: "param", key, value, ...extra });
}

describe("resolveSteering: parameters", () => {
  it("lets the narrowest scope win, whatever order directives arrive in", () => {
    const all = [
      param({ agentId: "agt_gh1" }, "scout.max_items", 500),
      param({}, "scout.max_items", 10),
      param({ jobId: "scout.github" }, "scout.max_items", 400),
      param({ swarmId: "swm_a" }, "scout.max_items", 20),
      param({ classId: "scout" }, "scout.max_items", 30),
    ];
    expect(resolveSteering(all, githubScout, NOW).params["scout.max_items"]?.value).toBe(500);

    const withoutAgent = all.slice(1);
    expect(resolveSteering(withoutAgent, githubScout, NOW).params["scout.max_items"]?.value).toBe(400);

    const classAndBroader = [all[1]!, all[3]!, all[4]!];
    expect(resolveSteering(classAndBroader, githubScout, NOW).params["scout.max_items"]?.value).toBe(30);
  });

  it("treats a class scope limited to one swarm as narrower than the same class everywhere", () => {
    const all = [
      param({ swarmId: "swm_a", classId: "scout" }, "scout.max_items", 75),
      param({ classId: "scout" }, "scout.max_items", 30),
    ];
    expect(resolveSteering(all, githubScout, NOW).params["scout.max_items"]?.value).toBe(75);
  });

  it("breaks ties inside one scope by priority, then by the newer directive", () => {
    const older = param({ swarmId: "swm_a" }, "scout.max_items", 20);
    const newer = param({ swarmId: "swm_a" }, "scout.max_items", 25);
    expect(resolveSteering([newer, older], githubScout, NOW).params["scout.max_items"]?.value).toBe(25);

    const pinned = param({ swarmId: "swm_a" }, "scout.max_items", 15, { priority: 5 });
    expect(
      resolveSteering([newer, pinned, older], githubScout, NOW).params["scout.max_items"]?.value,
    ).toBe(15);
  });

  it("ignores directives that are paused, archived, expired, or aimed elsewhere", () => {
    const all = [
      param({}, "scout.max_items", 10),
      param({ swarmId: "swm_a" }, "scout.max_items", 99, { status: "paused" }),
      param({ swarmId: "swm_a" }, "scout.max_items", 98, { status: "archived" }),
      param({ swarmId: "swm_a" }, "scout.max_items", 97, { expiresAt: "2026-11-12T11:59:59Z" }),
      param({ swarmId: "swm_other" }, "scout.max_items", 96),
      param({ jobId: "scout.hackernews" }, "scout.max_items", 95),
      param({ agentId: "agt_someone_else" }, "scout.max_items", 94),
    ];
    const resolved = resolveSteering(all, githubScout, NOW);
    expect(resolved.params["scout.max_items"]?.value).toBe(10);
    expect(resolved.directiveIds).toEqual([all[0]!.id]);
  });

  it("still applies a directive whose expiry is in the future", () => {
    const d = param({ swarmId: "swm_a" }, "scout.max_items", 60, { expiresAt: "2026-11-12T12:00:01Z" });
    expect(resolveSteering([d], githubScout, NOW).params["scout.max_items"]?.value).toBe(60);
  });

  it("reports an invalid value instead of applying it, and falls back to the broader one", () => {
    const good = param({}, "scout.max_items", 10);
    const bad = param({ agentId: "agt_gh1" }, "scout.max_items", 100000);
    const unknown = param({ agentId: "agt_gh1" }, "no.such_param", 1);
    const resolved = resolveSteering([good, bad, unknown], githubScout, NOW);
    expect(resolved.params["scout.max_items"]?.value).toBe(10);
    expect(resolved.invalid.map((x) => x.directiveId).sort()).toEqual([bad.id, unknown.id].sort());
    expect(resolved.directiveIds).toEqual([good.id]);
  });

  it("resolves run-level values from global and swarm scopes only", () => {
    const all = [
      param({ swarmId: "swm_a" }, "investigate.max_founders", 7),
      param({ classId: "investigator" }, "investigate.max_founders", 50),
      param({ agentId: "agt_gh1" }, "investigate.max_founders", 60),
    ];
    const resolved = resolveSteering(all, swarmIdentity("swm_a"), NOW);
    expect(resolved.params["investigate.max_founders"]?.value).toBe(7);
  });
});

describe("resolveSteering: guidance", () => {
  const guidance = [
    directive({ scope: { agentId: "agt_gh1" }, kind: "context", text: "Skip forks and awesome-lists." }),
    directive({ scope: {}, kind: "rule", text: "Never contact anyone." }),
    directive({ scope: { classId: "scout" }, kind: "opinion", text: "Prefer builders over credentials." }),
    directive({ scope: { swarmId: "swm_a" }, kind: "opinion", text: "We like developer tools." }),
    directive({ scope: { swarmId: "swm_a" }, kind: "opinion", text: "   " }),
  ];

  it("keeps every applicable line, ordered from broad to narrow", () => {
    const resolved = resolveSteering(guidance, githubScout, NOW);
    expect(resolved.guidance.map((g) => g.text)).toEqual([
      "Never contact anyone.",
      "We like developer tools.",
      "Prefer builders over credentials.",
      "Skip forks and awesome-lists.",
    ]);
  });

  it("renders rules, preferences and context under separate headings with scope labels", () => {
    const block = renderSteeringBlock(resolveSteering(guidance, githubScout, NOW), {
      swarms: { swm_a: "AI infrastructure" },
      agents: { agt_gh1: "GitHub scout 1" },
    });
    expect(block).toContain("- [Everything] Never contact anyone.");
    expect(block).toContain("- [Swarm: AI infrastructure] We like developer tools.");
    expect(block).toContain("- [All scouts] Prefer builders over credentials.");
    expect(block).toContain("- [Agent: GitHub scout 1] Skip forks and awesome-lists.");
    expect(block.indexOf("Rules.")).toBeLessThan(block.indexOf("Preferences."));
    expect(block.indexOf("Preferences.")).toBeLessThan(block.indexOf("Context."));
  });

  it("renders nothing when no guidance applies", () => {
    expect(renderSteeringBlock(resolveSteering([], githubScout, NOW))).toBe("");
  });
});

describe("effective values", () => {
  const config: SwarmConfig = {
    ...BASE_CONFIG,
    id: "cfg_test",
    params: { "screen.min_fit": 0.7 },
    routes: { "scout.github": { provider: "codex-cli", model: "gpt-6-luna", effort: "low" } },
  };

  it("layers default, then config, then a person's directive", () => {
    const none = resolveSteering([], githubScout, NOW);
    expect(effectiveParam("assess.watch_threshold", none, config)).toMatchObject({
      value: 0.48,
      origin: "default",
    });
    expect(effectiveParam("screen.min_fit", none, config)).toMatchObject({ value: 0.7, origin: "config" });

    const steered = resolveSteering([param({ swarmId: "swm_a" }, "screen.min_fit", 0.4)], githubScout, NOW);
    expect(effectiveParam("screen.min_fit", steered, config)).toMatchObject({
      value: 0.4,
      origin: "directive",
    });
  });

  it("uses the config route, then the built-in default route", () => {
    const none = resolveSteering([], githubScout, NOW);
    expect(effectiveRoute("scout.github", none, config)).toEqual(config.routes["scout.github"]);
    expect(effectiveRoute("scout.github", none, BASE_CONFIG)).toEqual(DEFAULT_ROUTES["scout.github"]);
  });

  it("gives a provider-only override that provider's default model, and keeps explicit models", () => {
    const providerOnly = resolveSteering(
      [param({ jobId: "scout.github" }, "route.provider", "anthropic-api")],
      githubScout,
      NOW,
    );
    expect(effectiveRoute("scout.github", providerOnly, config)).toEqual({
      provider: "anthropic-api",
      model: DEFAULT_MODEL_BY_PROVIDER["anthropic-api"],
      effort: "low",
    });

    const full = resolveSteering(
      [
        param({ jobId: "scout.github" }, "route.provider", "claude-cli"),
        param({ jobId: "scout.github" }, "route.model", "claude-opus-5-5"),
        param({ agentId: "agt_gh1" }, "route.effort", "high"),
      ],
      githubScout,
      NOW,
    );
    expect(effectiveRoute("scout.github", full, config)).toEqual({
      provider: "claude-cli",
      model: "claude-opus-5-5",
      effort: "high",
    });
  });
});
