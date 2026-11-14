import { describe, expect, it } from "vitest";
import { CONTEXT_POOLS, CROSSINGS, JOB_INPUT_POOLS, crossingsOf, mayUseContributorModel, poolsReadBy } from "./context";
import { MODEL_JOB_IDS } from "./jobio";

type ScoutGitHubPools = typeof JOB_INPUT_POOLS["scout.github"];
// @ts-expect-error input fields are required keys in each job's pool map
const missingScoutInputPool: ScoutGitHubPools = { beat: "steering", thesis: "objective" };
void missingScoutInputPool;

describe("pools of context", () => {
  it("assigns every model input field to a known context pool", () => {
    const poolIds = new Set(CONTEXT_POOLS.map((pool) => pool.id));
    for (const job of MODEL_JOB_IDS) {
      const fields = Object.entries(JOB_INPUT_POOLS[job]);
      expect(fields.length, `${job} has declared input fields`).toBeGreaterThan(0);
      for (const [field, pools] of fields) {
        for (const pool of Array.isArray(pools) ? pools : [pools]) {
          expect(poolIds.has(pool), `${job}.${field} maps to ${pool}`).toBe(true);
        }
      }
    }
  });

  it("allows contributor models only for jobs whose inputs are permitted", () => {
    expect(MODEL_JOB_IDS.filter(mayUseContributorModel)).toEqual([
      "scout.hackernews", "scout.github", "scout.research", "scout.talent",
      // The search of X is sent the same things as the web search: words from the hunt and limits.
      "hunt.navigate", "hunt.search", "hunt.xsearch", "hunt.look", "hunt.sift",
    ]);
  });

  it("never lets a job read a sealed pool", () => {
    const sealed = CONTEXT_POOLS.filter((pool) => pool.sealed).map((pool) => pool.id);
    expect(sealed.length).toBeGreaterThan(0);
    for (const job of MODEL_JOB_IDS) {
      for (const pool of sealed) expect(poolsReadBy(job), `${job} must not read ${pool}`).not.toContain(pool);
    }
  });

  it("keeps the founder analyst out of the company file and the company analyst out of the founder file", () => {
    expect(poolsReadBy("assess.judgments")).not.toContain("company");
    expect(poolsReadBy("assess.company")).not.toContain("founder");
    for (const job of ["company.product", "company.traction", "company.team"] as const) expect(poolsReadBy(job)).not.toContain("founder");
    for (const job of ["investigate.background", "investigate.code", "investigate.media", "investigate.redflags"] as const) expect(poolsReadBy(job)).not.toContain("company");
  });

  it("hands a score to the memo writer only, and partner calls only to the classes that are shown them", () => {
    expect(MODEL_JOB_IDS.filter((job) => poolsReadBy(job).includes("decision"))).toEqual(["assess.memo"]);
    expect(poolsReadBy("verify.claims")).not.toContain("calls");
    expect(poolsReadBy("scout.github")).toContain("calls");
  });

  it("lets the fact-checker read the items under check and nothing else about the subject", () => {
    expect(poolsReadBy("verify.claims")).toEqual(["steering", "lessons", "skills", "founder", "company"]);
    expect(Object.keys(JOB_INPUT_POOLS["verify.claims"])).toEqual(["founder", "evidence"]);
  });

  it("only describes crossings between pools that exist, and none into a sealed pool", () => {
    const ids = CONTEXT_POOLS.map((pool) => pool.id) as string[];
    for (const crossing of CROSSINGS) {
      expect(ids).toContain(crossing.from);
      expect(ids).toContain(crossing.to);
      expect(["network", "truth"]).not.toContain(crossing.to);
    }
    // Open questions come from both kinds of assessment, and a founder reaches a company file as a profile only.
    expect(crossingsOf("questions").into.map((crossing) => crossing.from)).toEqual(["founder", "company"]);
    expect(CROSSINGS.find((crossing) => crossing.from === "founder" && crossing.to === "company")?.rule).toContain("No founder evidence");
    // What is hidden from every agent reaches them only as a kept line or a kept setting.
    expect(crossingsOf("truth").outOf.map((crossing) => [crossing.to, crossing.by])).toEqual([["lessons", "eval"], ["steering", "eval"]]);
  });
});
