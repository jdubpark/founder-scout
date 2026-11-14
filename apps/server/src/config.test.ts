import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config";

describe("resolveConfig", () => {
  it("uses repository-root-relative paths and the documented defaults", () => {
    const config = resolveConfig({});
    expect(config).toEqual({
      repositoryRoot: config.repositoryRoot,
      port: 4317,
      host: "127.0.0.1",
      dbPath: resolve(config.repositoryRoot, "data/swarm.db"),
      dataDir: resolve(config.repositoryRoot, "data"),
      flowsDir: resolve(config.repositoryRoot, "evals/flows"),
      datasetsDir: resolve(config.repositoryRoot, "evals/datasets"),
      evalJudge: null,
      webDist: resolve(config.repositoryRoot, "apps/web/dist"),
      fundName: "the fund",
      simSeed: 7,
    });
    // The root is the workspace, whatever the checkout directory is called.
    expect(existsSync(resolve(config.repositoryRoot, "pnpm-workspace.yaml"))).toBe(true);
  });

  it("resolves relative path overrides from the repository root and preserves absolute paths", () => {
    const config = resolveConfig({
      PORT: "8080",
      HOST: "0.0.0.0",
      SWARM_DB_PATH: "var/state.sqlite",
      SWARM_DATA_DIR: "/srv/swarm-data",
      EVAL_FLOWS_DIR: "fixtures/flows",
      WEB_DIST_DIR: "web/build",
      FUND_NAME: "North Star",
      SIM_SEED: "19",
    });
    expect(config).toEqual({
      repositoryRoot: config.repositoryRoot,
      port: 8080,
      host: "0.0.0.0",
      dbPath: resolve(config.repositoryRoot, "var/state.sqlite"),
      dataDir: "/srv/swarm-data",
      flowsDir: resolve(config.repositoryRoot, "fixtures/flows"),
      datasetsDir: resolve(config.repositoryRoot, "fixtures/datasets"),
      evalJudge: null,
      webDist: resolve(config.repositoryRoot, "web/build"),
      fundName: "North Star",
      simSeed: 19,
    });
  });

  it("keeps datasets where it is told to, and reads the model that judges past cases", () => {
    const config = resolveConfig({ EVAL_DATASETS_DIR: "/srv/datasets", EVAL_JUDGE: "claude-cli:claude-haiku-5-5" });
    expect(config.datasetsDir).toBe("/srv/datasets");
    expect(config.evalJudge).toEqual({ provider: "claude-cli", model: "claude-haiku-5-5" });
    expect(resolveConfig({ EVAL_JUDGE: "claude-cli:claude-opus-5-5:high" }).evalJudge).toEqual({ provider: "claude-cli", model: "claude-opus-5-5", effort: "high" });
    expect(() => resolveConfig({ EVAL_JUDGE: "claude-haiku-5-5" })).toThrow(/EVAL_JUDGE must look like/);
    expect(() => resolveConfig({ EVAL_JUDGE: "claude-cli:claude-haiku-5-5:extreme" })).toThrow(/EVAL_JUDGE must look like/);
    expect(() => resolveConfig({ EVAL_JUDGE: "meta-api:muse-spark-1.3-contributor" })).toThrow(/vendor may train on private deal notes.*use muse-spark-1\.3/);
  });

  it("rejects invalid integer settings", () => {
    expect(() => resolveConfig({ PORT: "70000" })).toThrow(/PORT must be an integer/);
    expect(() => resolveConfig({ SIM_SEED: "1.5" })).toThrow(/SIM_SEED must be an integer/);
  });
});
