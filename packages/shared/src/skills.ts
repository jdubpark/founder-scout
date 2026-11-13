import { getJob, type ClassId, type JobId } from "./registry";

/** A reviewed project playbook that code may add to a task prompt. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  jobs: JobId[];
  classes: ClassId[];
  hosts?: string[];
  words?: string[];
  priority: number;
  body: string;
}

export interface SkillTask {
  jobId: JobId;
  classId: ClassId;
  hosts: string[];
  text: string;
}

function matches(skill: Skill, task: SkillTask): boolean {
  if (!skill.jobs.includes(task.jobId) && !skill.classes.includes(task.classId)) return false;
  if (!skill.hosts?.length && !skill.words?.length) return true;
  const hostMatch = (skill.hosts ?? []).some((host) =>
    task.hosts.some((candidate) => candidate.toLowerCase() === host.toLowerCase() || candidate.toLowerCase().endsWith(`.${host.toLowerCase()}`)),
  );
  const material = task.text.toLowerCase();
  const wordMatch = (skill.words ?? []).some((word) => material.includes(word.toLowerCase()));
  return hostMatch || wordMatch;
}

/** Pick the highest priority applicable notes that fit the prompt allowance. */
export function pickSkills(library: readonly Skill[], task: SkillTask, budget?: number, off: readonly string[] = []): Skill[] {
  const allowance = budget ?? (task.classId === "runner" || task.classId === "scout" ? 1_200 : 2_400);
  if (!Number.isFinite(allowance) || allowance <= 0) return [];
  const selected: Skill[] = [];
  let used = 0;
  for (const skill of library.filter((item) => !off.includes(item.id) && matches(item, task)).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    // The budget measures all skill text that will be inserted, including its visible heading.
    const size = skill.name.length + skill.description.length + skill.body.length;
    if (selected.length === 3) break;
    if (used + size > allowance) continue;
    selected.push(skill);
    used += size;
  }
  return selected;
}

/** Job/class match only, for the dashboard's scope preview. */
export function skillsForScope(library: readonly Skill[], jobId: JobId | null, classId: ClassId | null): Skill[] {
  return library
    .filter((skill) => jobId ? (skill.jobs.includes(jobId) || skill.classes.includes(getJob(jobId).classId)) : classId ? (skill.classes.includes(classId) || skill.jobs.some((id) => getJob(id).classId === classId)) : false)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
