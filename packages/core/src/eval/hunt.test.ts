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

/** What one simulated world's trial reports: strong early founders found, weak ones found, runner calls. */
interface Shape { strong: number; weak: number; calls: number }
const BASE: Shape = { strong: 1, weak: 0, calls: 10 };
/** The worlds from seed 929 up are held back from tuning. */
const heldOut = (seed: number): boolean => seed >= 929;

describe("hunt-yield evaluation boundary", () => {
  it.each([
    {
      name: "keeps a gain on every held-out world, though it used twice the calls and the fit screener kept nobody",
      tuned: (): Shape => ({ strong: 4, weak: 0, calls: 20 }),
      status: "champion",
    },
    {
      name: "reverts a gain that shows only on the worlds it was tuned on",
      tuned: (seed: number): Shape => (heldOut(seed) ? BASE : { strong: 2, weak: 0, calls: 10 }),
      status: "reverted",
    },
    {
      name: "reverts a gain that one held-out world accounts for",
      tuned: (seed: number): Shape => (seed === 929 ? { strong: 3, weak: 0, calls: 10 } : BASE),
      status: "reverted",
    },
    {
      name: "reverts a gain that brings weak founders with it",
      tuned: (): Shape => ({ strong: 2, weak: 1, calls: 10 }),
      status: "reverted",
    },
  ])("$name", async ({ tuned, status }) => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-hunt-yield-"));
    roots.push(root);
    const jobs = createJobRegistry();
    const trial = async ({ seed, config }: HuntTrialInput) => {
      const shape = Number(config.params["hunt.max_depth"]) >= 3 ? tuned(seed) : BASE;
      return {
        found: [
          ...Array.from({ length: shape.strong }, (_, index) => ({ simFounderId: `strong-${index}`, quality: 0.8, stage: "pre-seed" })),
          ...Array.from({ length: shape.weak }, (_, index) => ({ simFounderId: `weak-${index}`, quality: 0.2, stage: "pre-seed" })),
        ],
        kept: [],
        runnerCalls: shape.calls,
        pages: shape.strong + shape.weak,
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
    expect(result.variants[0]?.test.strong_early_found).toBe(1);
    expect(result.goal.target).toBe("strong_early_found");
    expect(result.variants[1]?.status).toBe(status);
    expect(result.goal.hold).not.toContain("calls");
  });

  it("measures a live baseline only with a budget that covers it, and never climbs on real models", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentswarm-hunt-yield-"));
    roots.push(root);
    const jobs = createJobRegistry();
    const asked: Array<Pick<HuntTrialInput, "brain" | "budgetUsd">> = [];
    const service = createEvalService({
      store: null,
      jobs,
      executeJob: createExecuteJob({ jobs, providers: createProviderRegistry({}) }),
      flowsDir: root,
      huntTrial: async ({ brain, budgetUsd }) => {
        asked.push({ brain, budgetUsd });
        return { found: [], kept: [], runnerCalls: 10, pages: 1, searches: 0, plantedRead: 1, plantedFailed: 0, costUsd: 0.5, unpricedCalls: 0, models: {} };
      },
    });

    // Two dollars over sixteen worlds would cut every hunt short, so nothing is run or spent.
    await expect(service.runRounds("hunt-yield", { rounds: 0, brain: "live", budgetUsd: 2 })).rejects.toMatchObject({ status: 409 });
    expect(asked).toEqual([]);

    const live = await service.runRounds("hunt-yield", { rounds: 0, brain: "live", budgetUsd: 16 });
    expect(live.callsModels).toBe(true);
    expect(asked).toHaveLength(16);
    expect(asked.every((trial) => trial.brain === "live" && trial.budgetUsd === 1)).toBe(true);

    await expect(service.runRounds("hunt-yield", { rounds: 1, brain: "live", budgetUsd: 16 })).rejects.toMatchObject({ status: 409 });
  });
});

