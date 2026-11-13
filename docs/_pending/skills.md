## README

Reviewed prompt playbooks live in `skills/<id>/SKILL.md`. Code selects up to three matching notes for each model task, within a character budget. The Told tab previews them; `skills.off` disables ids at a scope.

## Design

Skills are repository-owned, reviewed text. They are loaded by the job registry and inserted into the system prompt before learned lines. A person's instruction takes precedence. Matching is deterministic by job or class and then host or material words; priority and id settle order. Scout and runner prompts allow 1,200 skill characters; other classes allow 2,400. No task gets more than three.

The job material matcher reads only the fields already sent to that job. It extracts public source addresses and relevant page, item, transcript or evidence text. It does not inspect simulator state. The `skills.off` parameter uses normal config and steering resolution. Task records retain the ids placed in the prompt. Skills are available to every model job as a separate context pool.

| Job | Instructions and skill match | Steering | Partner calls | Learned lines | Input pools |
|---|---|---|---|---|---|
| `scout.hackernews` | Scout task/system; launch-post and founder-title notes when source host or words match | Yes | Yes | Yes | sources, steering, objective |
| `scout.github` | Scout task/system; repository-authorship and founder-title notes on matching material | Yes | Yes | Yes | sources, steering, objective |
| `scout.research` | Scout task/system; Hugging Face, paper-to-product and founder-title notes on matching material | Yes | Yes | Yes | sources, steering, objective |
| `scout.talent` | Scout task/system; founder-title note when title words match | Yes | Yes | Yes | sources, steering, objective |
| `hunt.navigate` | Navigator task/system; engine-query note | Yes | Yes | Yes | objective, steering, hunt |
| `hunt.look` | Page-reader task/system; host and page-text notes | Yes | No | Yes | objective, hunt, steering, sources |
| `hunt.sift` | Result-sifter task/system; matching result text notes | Yes | No | Yes | objective, hunt, steering, sources |
| `screen.fit` | Fit-screen task/system; thin-early-evidence note | Yes | Yes | Yes | lead, objective, steering |
| `investigate.background` | Investigator task/system; paper-to-product note when known evidence matches | Yes | No | Yes | founder, objective, steering, repo, questions |
| `investigate.code` | Read-only code-review task/system; repository-authorship note for GitHub repository | Yes | No | Yes | founder, objective, steering, repo, questions |
| `investigate.company` | Founder-role task/system; funding and title notes when material matches | Yes | No | Yes | founder, objective, steering, repo, questions |
| `investigate.media` | Talk/interview task/system; transcript-quote note when evidence matches | Yes | No | Yes | founder, objective, steering, repo, questions |
| `investigate.redflags` | Risk-check task/system; no material-specific note by default | Yes | No | Yes | founder, objective, steering, repo, questions |
| `company.product` | Company research task/system; material-matched notes | Yes | No | Yes | company, objective, steering, questions |
| `company.traction` | Company milestones task/system; funding-language note when material matches | Yes | No | Yes | company, objective, steering, questions |
| `company.team` | Company team task/system; material-matched notes | Yes | No | Yes | company, objective, steering, questions |
| `verify.claims` | Independent source-check task/system; material-matched notes | Yes | No | Yes | founder, company, steering |
| `assess.judgments` | Rubric-answer task/system; material-matched notes | Yes | Yes | Yes | founder, objective, steering, calls |
| `assess.memo` | Partner-memo task/system; material-matched notes | Yes | No | Yes | founder, objective, steering, decision |
| `assess.company` | Company-rubric task/system; material-matched notes | Yes | Yes | Yes | company, objective, steering, calls |
| `outreach.plan` | Draft-only outreach task/system; material-matched notes | Yes | No | Yes | founder, objective, steering |
| `call.debrief` | Transcript debrief task/system; transcript-quote note | Yes | No | Yes | founder, steering |

Inputs follow `JOB_INPUT_POOLS`; all jobs also read steering, the skill library and their own learned lines. The call column follows `CLASSES_SHOWN_CALLS`. Global instructions remain in each job system prompt. The code reviewer receives a sanitized checkout and supplied contributor counts only; it receives no repository history. No input pool gap was found.

## Rules

- A skill applies only to a matching job or class and, when it names hosts or words, matching task material. `packages/shared/src/skills.test.ts` fails if matching, ordering, budget, off filtering or the three-skill cap changes.
- Skills are reviewed prompt text, not authority. A person's instruction takes precedence, and notes cannot direct scoring, ranking, decisions, personal-attribute use or barred-host requests. `packages/core/src/jobs/index.test.ts` fails if selection or placement crosses the GitHub host boundary or reviewed text contains prohibited content.
- Every skill file must parse, name known jobs/classes and stay within 900 body characters. `packages/core/src/jobs/index.test.ts` fails when repository playbooks drift from that contract.
- Prompt inputs remain limited to the pools declared in `packages/shared/src/context.ts`; skill matching does not inspect simulator fields. `packages/core/src/rules.test.ts` and `packages/core/src/jobs/index.test.ts` fail if that boundary changes.
