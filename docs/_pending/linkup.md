## README

Add Linkup as the optional open-web search engine. Configure `LINKUP_API_KEY`; `LINKUP_SEARCHES_PER_DAY` defaults to 200 searches per UTC day and is separate from a hunt's model spend cap. The in-memory ceiling resets when the server restarts.

## Design

Linkup is the `web` search engine and is wired by the coordinator through `extraEngines`.
It accepts plain words and quoted phrases and returns open-web result links, titles, and snippets.
Requests use the fast `searchResults` endpoint and exclude every host in the shared no-read policy.
The response reader has a deadline and a 2 MB ceiling; errors and malformed responses yield no hits.
Only a fake-client test exists; the adapter is unverified against the live service.
Linkup terms article 4.1 limits reproduction and extraction to text and data mining and retention to as long as that work needs; results must not be passed on.
By default, Linkup may use queries to improve its service; zero data retention must be requested.
Before relying on a queue of addresses for later automated reading, get Linkup's written answer that keeping it is permitted.

## Rules

- The Linkup request, mapping, no-read exclusions, missing-key behavior, and daily ceiling are covered by `packages/core/src/sources/search-linkup.test.ts`.
- The added sites and subdomains stay barred from automated reading under `packages/shared/src/policy.test.ts`.
