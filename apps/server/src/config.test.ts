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
      webDist: resolve(config.repositoryRoot, "apps/web/dist"),
      fundName: "the fund",
      simSeed: 7,
    });
    expect(config.repositoryRoot).toMatch(/\/agentswarm$/);
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
      webDist: resolve(config.repositoryRoot, "web/build"),
      fundName: "North Star",
      simSeed: 19,
    });
  });

  it("rejects invalid integer settings", () => {
    expect(() => resolveConfig({ PORT: "70000" })).toThrow(/PORT must be an integer/);
    expect(() => resolveConfig({ SIM_SEED: "1.5" })).toThrow(/SIM_SEED must be an integer/);
  });
});
