import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppOptions, SwarmService } from "@agentswarm/core";
import { createApp } from "@agentswarm/core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./app";
import { resolveConfig } from "./config";
import { createCronHelper } from "./cron";
import { startScheduler } from "./scheduler";

export function isLoopbackHost(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(host.toLowerCase());
}

export function assertLoopbackHost(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new Error("The dashboard has no login yet. Set HOST to 127.0.0.1, localhost, or ::1 before starting the server.");
  }
}

async function stopActiveRuns(service: SwarmService): Promise<void> {
  const api = service.as("Shutdown");
  const swarms = await api.listSwarms();
  const swarmRuns = await Promise.all(swarms.map((swarm) => api.listRuns(swarm.id, 100_000)));
  const activeRuns = swarmRuns.flat().filter(
    (run) => run.status === "queued" || run.status === "running" || (run.status === "cancelled" && run.finishedAt === null),
  );
  const results = await Promise.allSettled(activeRuns.map(async (run) => {
    await service.runs.cancel(run.id);
    await service.runs.wait(run.id);
  }));
  for (const result of results) {
    if (result.status === "rejected") {
      process.stderr.write(`Could not finish a run during shutdown: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}\n`);
    }
  }
}

export async function startServer(): Promise<void> {
  const config = resolveConfig(process.env);
  assertLoopbackHost(config.host);
  const cron = createCronHelper();
  const appOptions: AppOptions = {
    dbPath: config.dbPath,
    dataDir: config.dataDir,
    flowsDir: config.flowsDir,
    datasetsDir: config.datasetsDir,
    evalJudge: config.evalJudge,
    cron,
    env: process.env,
    simSeed: config.simSeed,
    fundName: config.fundName,
  };
  const app = createApp(appOptions);
  const service = app.service;
  let scheduler: ReturnType<typeof startScheduler> | undefined;
  let http: FastifyInstance | undefined;
  let closing: Promise<void> | undefined;

  try {
    await service.ensureSeeded();
    await service.runs.recover();
    scheduler = startScheduler({ service, cron, catchUp: true });
    http = buildServer({ service, webDist: config.webDist, logger: true });
    await http.listen({ port: config.port, host: config.host });
    process.stdout.write(`agentswarm listening on http://${config.host}:${config.port}\n`);

    const shutdown = () => {
      closing ??= (async () => {
        scheduler?.stop();
        try {
          await http?.close();
        } finally {
          try {
            await scheduler?.waitForIdle();
            await stopActiveRuns(service);
          } finally {
            app.close();
          }
        }
      })();
      return closing;
    };
    let resolveSignal!: () => void;
    const signalReceived = new Promise<void>((resolve) => { resolveSignal = resolve; });
    const onSignal = () => {
      resolveSignal();
      void shutdown().catch(() => undefined);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
      await signalReceived;
      await shutdown();
    } finally {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
  } catch (error) {
    scheduler?.stop();
    await http?.close().catch(() => undefined);
    app.close();
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void startServer().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
