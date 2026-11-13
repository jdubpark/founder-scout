import { describe, expect, it } from "vitest";
import { pickSkills, type Skill, type SkillTask } from "./skills";

const task: SkillTask = { jobId: "scout.github", classId: "scout", hosts: [], text: "" };
const skill = (id: string, overrides: Partial<Skill> = {}): Skill => ({
  id, name: id, description: "note", jobs: [], classes: [], priority: 0, body: "body", ...overrides,
});

describe("pickSkills", () => {
  it.each([
    ["job match", [skill("job", { jobs: ["scout.github"] })], task, 100, [], ["job"]],
    ["class match", [skill("class", { classes: ["scout"] })], { ...task, jobId: "scout.research" }, 100, [], ["class"]],
    ["host match", [skill("host", { jobs: ["scout.github"], hosts: ["github.com"] })], { ...task, hosts: ["github.com"] }, 100, [], ["host"]],
    ["word match", [skill("word", { jobs: ["scout.github"], words: ["Launch HN"] })], { ...task, text: "Show HN then Launch HN" }, 100, [], ["word"]],
    ["switched off", [skill("off", { jobs: ["scout.github"] })], task, 100, ["off"], []],
    ["budget cut", [skill("large", { jobs: ["scout.github"], priority: 9, body: "x".repeat(100) }), skill("small", { jobs: ["scout.github"], priority: 1 })], task, 20, [], ["small"]],
    ["at most three", ["a", "b", "c", "d"].map((id) => skill(id, { jobs: ["scout.github"] })), task, 1_000, [], ["a", "b", "c"]],
  ])("applies %s deterministically", (_name, library, input, budget, off, expected) => {
    expect(pickSkills(library as Skill[], input as SkillTask, budget as number, off as string[]).map((item) => item.id)).toEqual(expected);
  });
});
