import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  repositoryRoot: string;
  port: number;
  host: string;
  dbPath: string;
  dataDir: string;
  flowsDir: string;
  webDist: string;
  fundName: string;
  simSeed: number;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function pathFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const configured = env[key]?.trim();
  const value = configured ? configured : fallback;
  return isAbsolute(value) ? resolve(value) : resolve(repositoryRoot, value);
}

function integerFromEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const configured = env[key];
  if (configured === undefined || configured.trim() === "") return fallback;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

/** Resolves server settings without reading the filesystem or mutating the environment. */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    repositoryRoot,
    port: integerFromEnv(env, "PORT", 4317, 0, 65_535),
    host: env.HOST?.trim() || "127.0.0.1",
    dbPath: pathFromEnv(env, "SWARM_DB_PATH", "data/swarm.db"),
    dataDir: pathFromEnv(env, "SWARM_DATA_DIR", "data"),
    flowsDir: pathFromEnv(env, "EVAL_FLOWS_DIR", "evals/flows"),
    webDist: pathFromEnv(env, "WEB_DIST_DIR", "apps/web/dist"),
    fundName: env.FUND_NAME?.trim() || "the fund",
    simSeed: integerFromEnv(env, "SIM_SEED", 7, 0, Number.MAX_SAFE_INTEGER),
  };
}
