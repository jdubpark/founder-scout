## README

OpenCode can run structured jobs through its saved vendor logins. Its default scout and screener pools use DeepSeek Flash and Muse Ember when both vendors are reachable.

## Design

OpenCode runs with `--pure`, a generated no-tools agent, and a temporary working directory. The user's home remains available for the saved login, while `XDG_CONFIG_HOME` points to an empty temporary directory so personal instructions do not enter the call. Other secret-like environment variables are removed.

Structured calls include the request schema in the user message and validate the extracted JSON before returning it. Provider usage and cost come from the completed JSONL event.

Contributor models may see only public material and the fund's own instructions. Scout jobs no longer receive partner call examples, so public scout inputs qualify; screening, founder and company work, transcripts, and partner calls do not.

Defaults use the ordinary route for half of scout and screener tasks, with DeepSeek Flash and Muse Ember taking a quarter each. Direct APIs take precedence over OpenCode. Configured pools and pinned routes keep their existing precedence.

## Rules

- OpenCode receives no tools, no user config, and no unrelated secrets. `packages/core/src/providers/opencode-cli.test.ts` fails if the generated agent, args, stdin, or environment crosses that boundary.
- Contributor models see only eligible jobs, unsafe pools and pins are refused, and a stale route falls back with a recorded reason. `packages/shared/src/context.test.ts`, `packages/shared/src/steering.test.ts`, `packages/core/src/service/pools.test.ts`, and `packages/core/src/service/index.test.ts` fail if eligibility or refusal changes.
- Configured pools override defaults; scout and screener shares use independently judged work. `packages/shared/src/pools.test.ts` and `packages/core/src/db/store.test.ts` fail if pool shares or lead counting regress.
