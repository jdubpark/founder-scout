import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BASE_CONFIG, type SwarmConfig } from "@agentswarm/shared";
import type { EvalDeps, HuntTrialInput } from "../contracts";
import { createExecuteJob, createJobRegistry } from "../jobs";
import { createProviderRegistry } from "../providers";
import { createEvalService } from "./index";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("hunt-yield evaluation boundary", () => {
  it("keeps a found-yield gain even when the separate fit screener keeps nobody", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-hunt-yield-"));
    roots.push(root);
    const jobs = createJobRegistry();
    const trial = async ({ config }: HuntTrialInput) => {
      const count = Number(config.params["hunt.max_depth"]) >= 3 ? 2 : 1;
      return {
        found: Array.from({ length: count }, (_, index) => ({
          simFounderId: `founder-${index}`,
          quality: 0.8,
          stage: index === 0 ? "seed" : "pre-seed",
        })),
        kept: [],
        runnerCalls: 10,
        pages: count,
        searches: 0,
        plantedRead: 1,
        plantedFailed: 0,
        costUsd: 0,
        unpricedCalls: 0,
        models: {},
      };
    };
    const deps: EvalDeps = {
      store: null,
      jobs,
      executeJob: createExecuteJob({ jobs, providers: createProviderRegistry({}) }),
      flowsDir: root,
      huntTrial: trial,
    };
    const service = createEvalService(deps, {
      huntPropose: async ({ currentConfig, evaluate }) => {
        const config: SwarmConfig = { ...currentConfig, params: { ...currentConfig.params, "hunt.max_depth": 3 } };
        return { key: "hunt.max_depth:3", description: "increase link depth", config, train: await evaluate(config) };
      },
    });

    const result = await service.runRounds("hunt-yield", { rounds: 1, brain: "sim" });
    expect(result.variants[1]?.status).toBe("champion");
    expect(result.variants[0]?.test.strong_early_per_100_calls).toBe(10);
    expect(result.variants[1]?.test.strong_early_per_100_calls).toBe(20);
    expect(result.variants[1]?.test.kept_people).toBe(0);
  });
});
