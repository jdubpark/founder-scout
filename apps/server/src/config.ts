import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isContributorModel, type ModelRoute } from "@agentswarm/shared";

export interface ServerConfig {
  repositoryRoot: string;
  port: number;
  host: string;
  dbPath: string;
  dataDir: string;
  flowsDir: string;
  /** Where datasets built from real past data are kept. Beside the flows unless set. */
  datasetsDir: string;
  /** The model that judges past cases, when one was named. null uses the analysts' own models. */
  evalJudge: ModelRoute | null;
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

const EFFORTS = ["low", "medium", "high"] as const;

/**
 * EVAL_JUDGE names the model that judges past cases, as "provider:model" or
 * "provider:model:effort", for example "claude-cli:claude-haiku-5-5". Judging a few hundred
 * past cases with the analysts' own model costs tens of dollars; a smaller judge costs a few.
 */
function judgeFromEnv(env: NodeJS.ProcessEnv): ModelRoute | null {
  const configured = env.EVAL_JUDGE?.trim();
  if (!configured) return null;
  const [provider, model, effort, ...rest] = configured.split(":");
  const validEffort = effort === undefined || (EFFORTS as readonly string[]).includes(effort);
  if (!provider || !model || rest.length > 0 || !validEffort) {
    throw new RangeError('EVAL_JUDGE must look like "provider:model" or "provider:model:effort", with effort low, medium or high');
  }
  if (isContributorModel(model)) {
    const standardModel = model.replace(/-contributor$/, "");
    throw new RangeError(`EVAL_JUDGE cannot use ${model} because its vendor may train on private deal notes; use ${standardModel}, the same model without the contributor tier.`);
  }
  return { provider, model, ...(effort ? { effort } : {}) } as ModelRoute;
}

/** Resolves server settings without reading the filesystem or mutating the environment. */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const flowsDir = pathFromEnv(env, "EVAL_FLOWS_DIR", "evals/flows");
  return {
    repositoryRoot,
    port: integerFromEnv(env, "PORT", 4317, 0, 65_535),
    host: env.HOST?.trim() || "127.0.0.1",
    dbPath: pathFromEnv(env, "SWARM_DB_PATH", "data/swarm.db"),
    dataDir: pathFromEnv(env, "SWARM_DATA_DIR", "data"),
    flowsDir,
    datasetsDir: env.EVAL_DATASETS_DIR?.trim() ? pathFromEnv(env, "EVAL_DATASETS_DIR", "") : resolve(dirname(flowsDir), "datasets"),
    evalJudge: judgeFromEnv(env),
    webDist: pathFromEnv(env, "WEB_DIST_DIR", "apps/web/dist"),
    fundName: env.FUND_NAME?.trim() || "the fund",
    simSeed: integerFromEnv(env, "SIM_SEED", 7, 0, Number.MAX_SAFE_INTEGER),
  };
}
