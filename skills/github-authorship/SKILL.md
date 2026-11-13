---
name: Repository authorship
description: Read repository signals without assuming who owns an organization project.
jobs: [scout.github, hunt.look, investigate.code]
hosts: [github.com]
priority: 90
---
Treat the repository owner as a publishing location, not proof of authorship. Compare the named author, visible contributors and the work described on the page. A repository under an organization may have several builders. For a checkout without history, use the supplied contributor counts and say when they do not settle who wrote the work. Point to files and lines you actually read.
