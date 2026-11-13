# Product

<!-- impeccable:product-schema 1 -->

> Status of this record: written on 2026-11-12 from the original project brief, without an interview.
> Lines marked **(inferred)** are assumptions to confirm or correct. Nothing here is a customer claim.

## Platform

web

## Stack

delegated: pnpm TypeScript monorepo, Fastify server, Vite + React dashboard. Chosen to match the owner's other projects (Fastify service plus a web app sharing typed contracts) and so one process can serve both the API and the dashboard. **(inferred)**

## Users

- **Primary: a venture partner** who is not an engineer. They open the dashboard in the morning to see which new founders the swarm surfaced overnight, read why, decide who to meet, approve or reject drafted outreach, and tell the swarm what to do differently. They think in theses, founders and meetings, not in models, prompts or tokens.
- **Secondary: the technical operator** who runs the system for the fund. They watch cost, failures and run health, change model routing and budgets, and run the improvement loop. **(inferred)**

## Product Purpose

A swarm of AI agents that runs every day to find startup founders worth meeting before other investors do, builds a sourced dossier on each, and scores them against a rubric the fund controls. Success is a short daily list a partner trusts enough to act on, where every score can be traced to its sources, and a system that measurably improves from the partners' reactions.

## Positioning

Models answer narrow rubric questions from fact-checked evidence; code, not a model, turns those answers into scores and decisions. That makes every number explainable, lets weights change instantly without re-running a model, and gives an eval loop something precise to improve.

## Operating Context

- The swarm runs unattended once a day; partners react to its output rather than operating it live.
- Partners steer with four kinds of directive (rule, preference, context, parameter) attached to a scope: everything, one swarm, a class of agents, one job, or one agent.
- No email or call goes out without a person approving that specific action.
- The same screen is used to explain the system to people outside the fund. **(inferred)**

## Capabilities and Constraints

- Agent classes: scouts, matchers, screeners, investigators, fact-checkers, analysts, outreach.
- Sources: Hacker News, GitHub, arXiv and the open web through official APIs; professional-profile data only through a licensed vendor, never by scraping LinkedIn.
- Voice calls to founders and references are designed but not enabled in this version.
- Runs in simulation with entirely fictional founders when no model credentials or data licences are configured. Simulated data must always be labelled as simulated.
- Never records or scores age, ethnicity, religion, gender, health, family status, political views or home address.
- Terminology: swarm, agent, job, run, lead, founder, evidence, judgment, directive, surface (verb: to put a founder in front of partners), watchlist.
- Undecided: the fund's name and thesis, which licensed data vendor, which voice vendor, authentication for a hosted dashboard.

## Evidence on Hand

- No real founder data, customers, results or testimonials exist yet. Do not fabricate any.
- The only data available for demonstrations is the built-in simulation, which must be presented as such.

## Product Principles

1. Every claim shows its source. A score nobody can trace is worth nothing to an investor.
2. People decide, agents prepare. The system recommends meetings; it never contacts anyone or rejects anyone on its own.
3. Steering is plain language attached to a visible scope, and the screen shows exactly what each agent was told.
4. Judge the work, not the pedigree. Schools and employers are context, never a score.
5. Say what is simulated, estimated or unverified. Never present a guess as a measurement.

## Accessibility & Inclusion

WCAG 2.2 AA contrast and full keyboard operation. State is never carried by colour alone. **(inferred)**
