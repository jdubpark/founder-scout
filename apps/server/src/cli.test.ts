import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient, EvalFlowDTO, PastCase, Run, SettingsDTO, Swarm } from "@agentswarm/shared";
import { pastCasesFile, readPastCases, writePastCases, type DoctorRow, type SwarmService } from "@agentswarm/core";
import { runCliCommand } from "./cli";

function pastCase(id: string, company: string, outcome: 0 | 1, cohort = "2018-Q1"): PastCase {
  return {
    id,
    cohort,
    asOf: "2018-04-01T00:00:00.000Z",
    subject: { company, aliases: [], people: [], domains: [], handles: [] },
    evidence: [{ kind: "launch", source: "hackernews", title: company, text: "post", date: "2018-01-01T00:00:00.000Z" }],
    outcome,
    outcomeSource: outcome ? "label" : "unlabelled",
  };
}

async function tempDataset(): Promise<{ root: string; env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "agentswarm-cli-past-"));
  return {
    root,
    env: { EVAL_DATASETS_DIR: root, EVAL_FLOWS_DIR: join(root, "evals", "flows") },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function fakeService() {
  const calls: Array<{ actor: string; method: string; args: unknown[] }> = [];
  const run = {
    id: "run-1", swarmId: "swarm-1", trigger: "manual", brain: "sim", sources: "sim", status: "succeeded",
    stage: null, configId: "config-1", budgetUsd: 2, costUsd: 0.12,
    stats: { leads: 3, screenedIn: 2, investigated: 1, surfaced: 1 }, error: null, simDay: 1,
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z",
  } as Run;
  const flow = {
    id: "flow-1", label: "Founder ranking", description: "Test flow", headlineMetric: "ndcg5",
    variants: [
      { id: "baseline", round: 0, description: "Starting point", status: "baseline", changes: [], test: { ndcg5: 0.5 }, train: { ndcg5: 0.55 } },
      { id: "v1", round: 1, description: "Weight strong evidence", status: "kept", changes: ["Weight evidence more"], test: { ndcg5: 0.6 }, train: { ndcg5: 0.62 } },
    ],
  } as unknown as EvalFlowDTO;
  const api = {
    listSwarms: vi.fn(async () => [{ id: "swarm-1" } as Swarm]),
    startRun: vi.fn(async () => run),
    listEvalFlows: vi.fn(async () => [{ id: "flow-1" }]),
    getEvalFlow: vi.fn(async () => flow),
    getSettings: vi.fn(async () => ({ sources: [{ id: "github", configured: false, detail: "No token" }] } as unknown as SettingsDTO)),
  } as unknown as ApiClient;
  const service = {
    as: vi.fn((actor: string) => {
      calls.push({ actor, method: "as", args: [] });
      return api;
    }),
    ensureSeeded: vi.fn(async () => undefined),
    runs: { wait: vi.fn(async () => run) },
  } as unknown as SwarmService;
  return { service, api, calls, run, flow };
}

describe("CLI commands", () => {
  it("runs one simulated run, waits for it, and prints funnel and cost", async () => {
    const { service, api, calls, run } = fakeService();
    const lines: string[] = [];
    const status = await runCliCommand(service, ["run", "--brain", "sim", "--sources", "sim"], (line) => lines.push(line));

    expect(status).toBe(0);
    expect(service.ensureSeeded).toHaveBeenCalledOnce();
    expect(calls.some((call) => call.actor === "Partner")).toBe(true);
    expect(api.startRun).toHaveBeenCalledWith({ swarmId: "swarm-1", brain: "sim", sources: "sim" });
    expect(service.runs.wait).toHaveBeenCalledWith(run.id);
    expect(lines[0]).toContain("succeeded leads=3 screened=2 investigated=1 surfaced=1 cost=$0.12");
  });

  it("prints provider and source readiness without making live calls", async () => {
    const { service } = fakeService();
    const lines: string[] = [];
    const doctor = vi.fn(async () => [{ provider: "openai-api", configured: false, detail: "No key", live: null } as DoctorRow]);
    const status = await runCliCommand(service, ["doctor"], (line) => lines.push(line), { doctor });

    expect(status).toBe(0);
    expect(doctor).toHaveBeenCalledWith({ live: false, env: undefined });
    expect(lines).toEqual(["provider openai-api: not configured — No key", "source github: not configured — No token"]);
  });

  it("shows eval rounds as a compact table with a zero exit status", async () => {
    const { service } = fakeService();
    const lines: string[] = [];
    const status = await runCliCommand(service, ["eval", "show", "--flow", "flow-1"], (line) => lines.push(line));

    expect(status).toBe(0);
    expect(lines[0]).toBe("round | change | test | train | status");
    expect(lines[2]).toBe("1 | Weight evidence more | 0.600 | 0.620 | kept");
  });

  it("runs an eval that calls models live, under a spending ceiling, and says what it spent", async () => {
    const { service, api, flow } = fakeService();
    const paid = { ...flow, id: "past-founders", callsModels: true, ready: true } as EvalFlowDTO;
    const runEvalRounds = vi.fn(async () => ({ ...paid, spentUsd: 1.234, narrative: "Baseline picks past winners in 61% of pairs." }));
    Object.assign(api, { getEvalFlow: vi.fn(async () => paid), runEvalRounds });
    const lines: string[] = [];

    expect(await runCliCommand(service, ["eval", "rounds", "--rounds", "0", "--budget", "2.5"], (line) => lines.push(line))).toBe(0);
    expect(runEvalRounds).toHaveBeenCalledWith("flow-1", { rounds: 0, brain: "live", budgetUsd: 2.5 });
    expect(lines[0]).toContain("spent $1.23");
    expect(lines[1]).toBe("Baseline picks past winners in 61% of pairs.");

    // With no ceiling named, a paid eval still gets one.
    await runCliCommand(service, ["eval", "rounds"], () => undefined);
    expect(runEvalRounds).toHaveBeenLastCalledWith("flow-1", { rounds: 1, brain: "live", budgetUsd: 5 });
  });

  it("says why an eval is not ready instead of running it, and runs a free eval in simulation", async () => {
    const { service, api, flow } = fakeService();
    const runEvalRounds = vi.fn(async () => flow);
    Object.assign(api, { getEvalFlow: vi.fn(async () => ({ ...flow, ready: false, dataNote: "No past cases yet." })), runEvalRounds });
    const lines: string[] = [];
    expect(await runCliCommand(service, ["eval", "rounds"], (line) => lines.push(line))).toBe(0);
    expect(runEvalRounds).not.toHaveBeenCalled();
    expect(lines).toEqual(["flow-1: not ready. No past cases yet."]);

    Object.assign(api, { getEvalFlow: vi.fn(async () => flow) });
    await runCliCommand(service, ["eval", "rounds", "--rounds", "2"], () => undefined);
    expect(runEvalRounds).toHaveBeenCalledWith("flow-1", { rounds: 2, brain: "sim" });
    expect(await runCliCommand(service, ["eval", "rounds", "--budget", "-1"], () => undefined)).toBe(1);
  });

  it("collects, labels, merges by id, writes the dataset and prints successes", async () => {
    const { service } = fakeService();
    const dataset = await tempDataset();
    try {
      await writePastCases(dataset.root, [pastCase("past_hn_old", "Existing", 0), pastCase("past_hn_1", "Old Acme", 0)]);
      const labelsPath = join(dataset.root, "labels.csv");
      await writeFile(labelsPath, "company,outcome,source\nAcme,1,reviewed winners\nMissing Winner,1,reviewed winners\n");
      const collectLaunchPosts = vi.fn(async () => [pastCase("past_hn_1", "Acme", 0), pastCase("past_hn_2", "Other", 0)]);
      const lines: string[] = [];
      const status = await runCliCommand(service, ["past", "collect", "--from", "2018-01-01", "--to", "2018-12-31", "--labels", labelsPath], (line) => lines.push(line), {
        env: dataset.env,
        collectLaunchPosts,
      });

      expect(status).toBe(0);
      expect(collectLaunchPosts).toHaveBeenCalledWith({ from: "2018-01-01", to: "2018-12-31" });
      const saved = await readPastCases(dataset.root);
      // "Other" is on no label, so nobody can say how it turned out and it is left out.
      expect(saved.map((item) => [item.id, item.subject.company, item.outcome])).toEqual([
        ["past_hn_old", "Existing", 0], ["past_hn_1", "Acme", 1],
      ]);
      expect(lines).toContain("Cases: 2; successes: 1; periods: 1 (2018-Q1)");
      expect(lines).toContain("Left out, outcome unknown: 1 (Other: no label names it)");
      expect(lines).toContain("Successes: Acme");
      expect(lines).toContain("Successes in the labels file with no matching launch: Missing Winner");
      expect(lines.at(-1)).toMatch(/Review the labels before trusting the eval/);
      expect(lines[0]).toContain(pastCasesFile(dataset.root));
    } finally {
      await dataset.cleanup();
    }
  });

  it("lets a reviewed file correct the public list, and does not print the list's thousand misses", async () => {
    const { service } = fakeService();
    const dataset = await tempDataset();
    try {
      const labelsPath = join(dataset.root, "labels.csv");
      // "Bolt" here is a different company from the listed one; "Scale" is listed under a longer name.
      await writeFile(labelsPath, "company,outcome,source\nBolt,0,same name as a listed company\nScale,1,listed as Scale AI\n");
      const collectLaunchPosts = vi.fn(async () => [
        pastCase("past_hn_1", "Bolt", 0), pastCase("past_hn_2", "Scale", 0), pastCase("past_hn_3", "Brex", 0), pastCase("past_hn_4", "Other", 0),
      ]);
      const fetchUnicornNames = vi.fn(async () => ({ names: ["Bolt", "Brex", "Scale AI", "Never Posted Here"], source: "public list" }));
      const lines: string[] = [];
      const status = await runCliCommand(
        service,
        ["past", "collect", "--from", "2018-01-01", "--to", "2018-12-31", "--unicorns", "--labels", labelsPath],
        (line) => lines.push(line),
        { env: dataset.env, collectLaunchPosts, fetchUnicornNames },
      );

      expect(status).toBe(0);
      const saved = await readPastCases(dataset.root);
      expect(saved.map((item) => [item.subject.company, item.outcome, item.outcomeSource])).toEqual([
        ["Bolt", 0, "same name as a listed company"],
        ["Scale", 1, "listed as Scale AI"],
        ["Brex", 1, "public list"],
      ]);
      expect(lines.join("\n")).not.toContain("Never Posted Here");
      expect(lines).toContain("Successes in the labels file with no matching launch: none");
    } finally {
      await dataset.cleanup();
    }
  });

  it("labels from the company directory, states the bar, and leaves out what it cannot label", async () => {
    const { service } = fakeService();
    const dataset = await tempDataset();
    try {
      // An earlier collection called this one a failure; the directory now says it was bought.
      await writePastCases(dataset.root, [pastCase("past_hn_2", "Bought Co", 0)]);
      const collectLaunchPosts = vi.fn(async () => [
        { ...pastCase("past_hn_1", "Big Co", 0), batch: "W18" },
        { ...pastCase("past_hn_2", "Bought Co", 0), batch: "W18" },
        { ...pastCase("past_hn_3", "Gone Co", 0), batch: "W18" },
      ]);
      const company = (name: string, status: string, teamSize: number) => ({
        name, formerNames: [], batch: "W18", status, topCompany: false, teamSize, domain: null,
      });
      const fetchYcDirectory = vi.fn(async () => ({
        entries: [company("Big Co", "Active", 60), company("Bought Co", "Acquired", 30), company("Gone Co", "Inactive", 0)],
        source: "directory",
      }));
      const lines: string[] = [];
      const status = await runCliCommand(
        service,
        ["past", "collect", "--from", "2018-01-01", "--to", "2018-12-31", "--yc", "--min-team", "50"],
        (line) => lines.push(line),
        { env: dataset.env, collectLaunchPosts, fetchYcDirectory },
      );

      expect(status).toBe(0);
      expect((await readPastCases(dataset.root)).map((item) => [item.subject.company, item.outcome, item.outcomeSource])).toEqual([
        ["Big Co", 1, "directory: operating with 60 people"],
        ["Gone Co", 0, "directory: no longer operating"],
      ]);
      expect(lines).toContain("Success bar: publicly listed, on the programme's list of top companies, or operating with at least 50 people.");
      expect(lines).toContain("Left out, outcome unknown: 1 (Bought Co: acquired, terms not public)");
    } finally {
      await dataset.cleanup();
    }
  });

  it("removes a sentence stating a personal detail before the dataset is written", async () => {
    const { service } = fakeService();
    const dataset = await tempDataset();
    try {
      const collected = { ...pastCase("past_hn_1", "Acme", 0) };
      collected.evidence = [{ kind: "launch", source: "hackernews", title: "Launch", text: "We built payments first. We raised money when we were 16. It worked.", date: "2018-01-01T00:00:00.000Z" }];
      const labelsPath = join(dataset.root, "labels.csv");
      await writeFile(labelsPath, "company,outcome,source\nAcme,0,reviewed\n");
      const status = await runCliCommand(service, ["past", "collect", "--from", "2018-01-01", "--to", "2018-12-31", "--labels", labelsPath], () => undefined, {
        env: dataset.env,
        collectLaunchPosts: vi.fn(async () => [collected]),
      });
      expect(status).toBe(0);
      const [saved] = await readPastCases(dataset.root);
      expect(saved?.evidence[0]?.text).toBe("We built payments first. [removed: personal detail] It worked.");
    } finally {
      await dataset.cleanup();
    }
  });

  it("keeps all successes and chooses bounded controls deterministically by case ids", async () => {
    const { service } = fakeService();
    const dataset = await tempDataset();
    try {
      const labelsPath = join(dataset.root, "labels.csv");
      await writeFile(labelsPath, [
        "company,outcome,source", "Winner A,1,verified", "Winner B,1,verified",
        ...["Control C", "Control D", "Control E", "Control F", "Control G", "Other cohort"].map((name) => `${name},0,verified`),
      ].join("\n") + "\n");
      const collected = [
        pastCase("a", "Winner A", 0), pastCase("b", "Winner B", 0),
        pastCase("c", "Control C", 0), pastCase("d", "Control D", 0), pastCase("e", "Control E", 0),
        pastCase("f", "Control F", 0), pastCase("g", "Control G", 0), pastCase("h", "Other cohort", 0, "2018-Q2"),
      ];
      const collectLaunchPosts = vi.fn(async () => collected);
      const invoke = () => runCliCommand(service, ["past", "collect", "--from", "2018-01-01", "--to", "2018-12-31", "--labels", labelsPath, "--controls", "1"], () => {}, {
        env: dataset.env,
        collectLaunchPosts,
      });
      expect(await invoke()).toBe(0);
      const first = await readPastCases(dataset.root);
      expect(await invoke()).toBe(0);
      const second = await readPastCases(dataset.root);

      expect(first.filter((item) => item.outcome === 1).map((item) => item.subject.company).sort()).toEqual(["Winner A", "Winner B"]);
      expect(first.filter((item) => item.outcome === 0)).toHaveLength(2);
      expect(first.some((item) => item.cohort === "2018-Q2")).toBe(false);
      expect(second.map((item) => item.id).sort()).toEqual(first.map((item) => item.id).sort());
    } finally {
      await dataset.cleanup();
    }
  });

  it("refuses to collect with nothing that can state an outcome, and says when only successes were kept", async () => {
    const { service } = fakeService();
    const dataset = await tempDataset();
    try {
      const collectLaunchPosts = vi.fn(async () => [pastCase("case", "New Co", 0), pastCase("other", "Listed Co", 0)]);
      expect(await runCliCommand(service, ["past", "collect", "--from", "2018-01-01", "--to", "2018-12-31"], () => undefined, { env: dataset.env, collectLaunchPosts })).toBe(1);
      expect(collectLaunchPosts).not.toHaveBeenCalled();
      expect(await readPastCases(dataset.root)).toEqual([]);

      // A list of successes alone cannot say that the company missing from it failed.
      const lines: string[] = [];
      const status = await runCliCommand(service, ["past", "collect", "--from", "2018-01-01", "--to", "2018-12-31", "--unicorns"], (line) => lines.push(line), {
        env: dataset.env,
        collectLaunchPosts,
        fetchUnicornNames: async () => ({ names: ["Listed Co"], source: "public list" }),
      });
      expect(status).toBe(0);
      expect((await readPastCases(dataset.root)).map((item) => [item.subject.company, item.outcome])).toEqual([["Listed Co", 1]]);
      expect(lines).toContain("Left out, outcome unknown: 1 (New Co: no label names it)");
      expect(lines.some((line) => line.startsWith("Every case kept is a success."))).toBe(true);
    } finally {
      await dataset.cleanup();
    }
  });

  it("shows a dataset summary and lists both past commands in help", async () => {
    const { service } = fakeService();
    const dataset = await tempDataset();
    try {
      await writePastCases(dataset.root, [pastCase("winner", "Winner", 1), pastCase("control", "Control", 0)]);
      const lines: string[] = [];
      expect(await runCliCommand(service, ["past", "show"], (line) => lines.push(line), { env: dataset.env })).toBe(0);
      expect(lines).toEqual([
        `Dataset: ${pastCasesFile(dataset.root)}`,
        "Cases: 2; successes: 1; periods: 1",
        "2018-Q1: 2 cases; 1 successes",
      ]);
      const help: string[] = [];
      expect(await runCliCommand(service, ["--help"], (line) => help.push(line))).toBe(0);
      expect(help.join("\n")).toContain("swarm past collect");
      expect(help.join("\n")).toContain("swarm past show");
    } finally {
      await dataset.cleanup();
    }
  });
});
