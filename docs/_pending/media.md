## README

Recordings can be fetched as direct audio or video files and transcribed through a configured command or OpenAI-compatible endpoint. Neither transcription adapter has been run against a real service by this worker. Recording analysis and person upload or link intake are incomplete.

## Design

A recording belongs to one founder and swarm and moves through queued, transcribing, ready, failed, or refused. SQLite stores its transcript and time-coded segments.

The live transcriber uses `TRANSCRIBE_COMMAND` when configured, otherwise the OpenAI-compatible endpoint variables. Commands are started without a shell and must include `{file}`. The HTTP adapter requests `verbose_json`.

Media fetching accepts a direct HTTP audio or video response only. It checks host policy and resolved addresses, reads robots.txt, rechecks redirects, and enforces `MEDIA_MAX_MB` (150 MB by default). Embedded-player pages are refused.

The media stage uses the `media.enabled` and `media.max_minutes_per_run` settings. Simulated recordings use the simulated world's transcript. `media.read` receives a founder brief and one time-coded transcript stretch. Code keeps only exact excerpts found in that stretch, adds the recording time to the evidence address, and marks the excerpt found before ordinary fact-checking.

The server API for adding and deleting recordings, the talks analyst's recording suggestions, and the founder-page Recordings block are not implemented yet. Uploads are not supported.

## Rules

- Never fetch a denied host, a private address, or a player page as a recording. `packages/core/src/sources/media.test.ts` fails if any is downloaded.
- Keep only quoted words found in the transcript and mark recording excerpts found before fact-checking. `packages/core/src/engine/index.test.ts` fails if fabricated words survive.
- Keep simulator-only transcript state out of model inputs. `packages/core/src/engine/index.test.ts` exercises the simulated stage with a normal `media.read` input.
