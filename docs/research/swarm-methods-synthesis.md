# What to take from five agent frameworks, and what to leave

Written 2026-11-13. Eight research notes sit behind this page: one for each framework, read
from source at a pinned commit (`docs/research/frameworks/`), and three on published evidence
(`multi-agent-methods.md`, `objectives-and-founder-evidence.md`,
`look-ahead-bias-in-llm-backtests.md`). The framework notes cite file and line; a sample of
those citations was checked against the checkouts and held. Nothing from the checkouts was run.

## What the five codebases show

1. **None of them keeps a change only when held-out cases improve.** crewAI's training turns one
   session of human feedback into "You MUST follow" text for every later run, with a quality
   score that no code reads. ruflo's optimizer scores a candidate with fixed multipliers; its
   own comment says it "does NOT run a real A/B test". swarms has no loop across runs.
   desplega's loop changes only how memories rank. Microsoft's framework has evaluators and no
   loop. This system's keep rule is stricter than all five.
2. **None of them creates a kind of agent from evidence.** The real pool mechanics are small:
   desplega sizes workers from queue depth with a pure function and routes to warm workers
   first; crewAI lets a model pick among a fixed roster through a constrained field; ruflo's
   pool resizes records that do no work. Letting a model choose its own provider, topology or
   task text (swarms) is the pattern to avoid.
3. **Context is isolated by default almost everywhere, and a deliberate crossing step exists
   almost nowhere.** The usable pieces: Microsoft's `context_filter` (a function decides what
   one agent's output passes to the next) and its mem0 adapter, where the scope a memory is
   stored under is never the scope it is read under and an empty read scope returns nothing;
   desplega's closed list of curated memory roots that only the lead may write. crewAI's scopes
   are a naming convention: any holder of the memory object reads everything.
4. **Only one design writes its assumptions down.** Microsoft's Magentic orchestrator keeps a
   fact sheet with four headings: given facts, facts to look up, facts to derive, educated
   guesses. It is free text. Nothing checks a guess, and the replan step clears the transcript
   before asking the model what went wrong.
5. **Large claims often have no code behind them.** ruflo's "SONA" learning never writes to the
   weights it says it trains, its consensus protocol approves its own proposals, and its
   multi-agent benchmark runs on a mock. swarms' "majority voting" hands the answers to another
   model and counts nothing. Each note has a table of these.

## What the published evidence adds

- Several agents gained up to 81% on work that splits into independent parts and lost up to
  70% on work done in order (Kim et al., 2025). Scouting and investigating are the first kind.
- Without a central checker, errors grew 17.2 times; with one, 4.4 times (same study). The
  fact-checker, the quote check and the planted claim are that checker.
- A multi-agent run cost about 15 times the tokens of a chat, and tokens explained 80% of the
  gain (Anthropic, 2025). More agents are not free quality.
- Majority voting gets most of what debate gets (Choi et al., 2025), and one strong model
  sampled several times beat a mix of models (Li et al., 2025).
- Rewriting a growing playbook erodes it; adding small entries does not (ACE, 2025).
- No prompt or playbook optimiser reports overfitting measured on cases it never saw.
- Masking names does not stop a model recognising a company: every masked earnings call from
  three large firms was identified (Lopez-Lira et al., 2025). A judge trained after the
  outcomes gives an upper bound on skill, whatever is masked.

## What was built from this

| Idea | Where it came from | What this system does | Code |
|---|---|---|---|
| Pools of context, isolated by default | Microsoft `context_filter`, mem0 scopes, desplega key guard | Thirteen named pools. Each job declares the pool behind every input field; a field with no pool does not compile. Two pools are sealed from every prompt. | `packages/shared/src/context.ts` |
| Crossings as data | ruflo's sketch of a promote step (not built there) | Thirteen crossings, each with who carries it, in what form, and what stays behind. | same file, `CROSSINGS` |
| Pools of agents | desplega sizing and routing, crewAI fixed roster, ruflo's unfitted routing scores | A job can have several members (models). Code gives each task to a member by share. Shares move toward members whose work passed the system's own checks; a member that accepts planted false claims is benched. A model never picks a model. | `packages/shared/src/pools.ts`, `packages/core/src/service/pools.ts` |
| An assumption ledger | Magentic's fact sheet; the criteria-drift finding | Every assumption the swarm runs on, stated or not, as a statement that could be false. Code tests each against past companies and against the partner's calls, and shows where the two disagree. | `packages/shared/src/assumptions.ts`, `packages/core/src/service/assumptions.ts` |
| See what a change would do | ruflo's replay gate with decision diffs | Before a config is put into use, the rubric answers on file are re-scored under it and every decision that would flip is listed. No model call. | `packages/core/src/service/preview.ts` |
| A keep rule that cannot peek | The gap in every loop above | Changes are proposed on the earliest periods, chosen on middle periods held back from tuning, and reported on the latest, which choose nothing. The noise floor includes which cases were drawn. | `packages/core/src/eval/past.ts` |
| Honest look-ahead reporting | The look-ahead note | A placebo with shuffled outcomes, a probe for the year as well as the company, and the words "upper bound" next to the score. | same file, `packages/shared/src/stats.ts` |
| Lessons as gated proposals | desplega's learning floor and duplicate check; crewAI's ungated version as the warning | One line per job, proposed from mistakes with names removed, refused with a stated reason when it names a subject or a personal detail, kept only by the rule above. | `packages/core/src/eval/past.ts` |

## What was left out, and why

- **Consensus protocols and debate.** One process has nothing to reach consensus with, and
  voting already gets most of debate's gain.
- **A model that picks the topology, the provider or its own sub-agents.** It breaks "code
  decides", and the frameworks that do it cap nothing.
- **A shared blackboard or shared mutable state.** Last write wins, and one bad entry reaches
  every agent.
- **Memory that a model may rewrite or delete.** No history, no check, and rewriting is what
  erodes a playbook.
- **Self-modifying code.** The measured results are on coding benchmarks with a test oracle.
  This domain has none.
- **Handoffs that broadcast the whole conversation.** They undo the isolation the rest of the
  design depends on.

## Added afterwards: the hunt

A navigator and runners were added to look for founders on the open web (design section 16).
The shape follows what this note found to work, and stops where it found things to fail.

| What the research says | What the hunt does |
| --- | --- |
| One strong lead that hands short, bounded tasks to cheap workers is the arrangement with evidence behind it (`multi-agent-methods.md`: the orchestrator and worker results) | One navigator on the strongest model; runners on the smallest. A runner's task is one page |
| Agents working without a central check multiplied errors about seventeen times, and with one about four (same note) | Nothing a runner returns is kept until code has checked it against the page: the name, the quoted words, the stage answers, the links |
| A written ledger of facts and guesses was the only design studied that keeps a plan outside a model's context (`frameworks/microsoft-agent-framework.md`) | The navigator's memory is a notebook in the database. Each turn is a fresh call handed the notebook, so turn 400 costs what turn 4 did |
| Rewriting a playbook wholesale erodes it; adding small entries does not (`multi-agent-methods.md`) | The navigator adds lines to the notebook. It cannot rewrite or delete one |
| What working systems pass between agents is a short record, not a transcript | A runner returns a record. The navigator is shown counts and labels of a few words, never a page |
| Routers that let a model choose its model or its own sub-agents were the least reliable part of the frameworks studied | The navigator chooses where to look. Code chooses which runner model reads a page, how many calls a trail gets, and when to stop |
| None of the five frameworks tests its workers with inputs whose right answer is known | One page in twelve is planted: it names nobody and tells the reader to report someone. What a model does with it is counted against that model |

Two things the hunt does that none of the five frameworks was found to do: it spends a wave
across lines of work by what each has yielded, with a head start for a new one and a floor for
every one; and it treats a site's own rules (robots.txt, and terms that forbid automated
reading) as part of the address check, before any request.

What the hunt does not have, and the evals do: a held-out measure. A trail's yield is counted
on what the fit screener kept, which is another agent's judgment, not an outcome.

## Not built yet, in the order worth doing

1. **A prospective record.** Every assessment made today is a prediction about a company that
   launched after the judge was trained. Joining outcomes to them in two years is the only
   clean test there will be. The data is already kept; the join is not written.
2. **Cheap judge first.** Judge every case with a small model and only the top third with a
   large one. The past-founders eval can price this before it is built.
3. **Retiring a lesson.** Try removing each kept line; drop it when nothing is lost.
4. **Asking the partner about edge cases.** Two real candidates the rubric scores the same for
   different reasons, and one question: which would you meet? Cheaper than asking for a rubric.
5. **Chasing one gap inside a run.** Today an open question waits for the next run.
6. **A fence on task writes.** A retried task's late result should not overwrite the retry.
