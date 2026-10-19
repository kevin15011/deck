# Building Deck

*A case study in designing, directing and validating an AI development team — written by Deck's author, Kevin Londoño.*

Deck started as a personal tool and became the most complete system I have built with AI. This document explains why it exists, the architectural decisions behind it, the hardest change I made along the way, and what I learned about leading work that AI agents carry out.

For what Deck does today, see the [README](../README.md). For its package boundaries, see [Architecture](architecture.md).

## Five months in numbers

| | |
|---|---|
| First commit | 2026-05-15 — an environment installer for Pi and OpenCode |
| Today | v0.12.0, 55 tagged releases, 405 commits |
| Runners | Pi, OpenCode, Codex (added 2026-08-07) and Claude (added 2026-09-30) |
| Cross-runner sessions and web workspace | 2026-10-12 onward |
| Recorded changes | 151 OpenSpec changes, each with its proposal, spec, design, tasks or verification record |
| Code | ~256k lines of TypeScript, 513 test files |

## The problem: my way of working did not travel

I work on more than one machine, and with more than one coding agent. Each agent has its own format for agents, skills, MCP servers, hooks and model settings. Every time I added a rule, a contract, a skill or a tool, I had to rebuild it by hand everywhere else, and the setups drifted apart.

I wanted three things:

1. **Control** over how the agents work: which skills they load, which tools they use, which rules and contracts they follow.
2. **Portability**: one definition of that way of working, replicated on every device and every runner I use.
3. **Better results through specialization**: separate responsibilities such as investigation, implementation and code review, so each agent gets a focused job and a focused context instead of doing everything at once.

Deck began as the installer that made this possible. It kept growing until it became what it is today: a runner-neutral Developer Team, native adapters for four coding agents, and a web workspace where one session can mix models from different providers, including from my phone.

## Architectural decisions

### Define once, materialize natively

The core (`@deck/core`) describes the team in runner-neutral terms: roles, skills, capabilities, contracts and safety policy. Each runner adapter translates that canonical definition into its runner's native files, packages and hooks, then verifies the result. The CLI composes both and keeps the user in control with preflight, review-before-apply, ownership manifests and rollback.

This boundary is what made portability real. Adding a rule means changing it once in the core; every runner receives it in its own format.

### No false parity

Runners are not equal, and pretending otherwise would be a promise the system cannot keep. Pi and OpenCode expose lifecycle hooks, so Deck can *enforce* protected execution controls there. Claude Code and Codex do not, so Deck carries those controls as instructions. The support matrix states this explicitly ("full team, instruction-level safety") instead of hiding it behind a generic "supported".

### Authority has an order

OpenSpec artifacts, source code, tests and current runner evidence are authoritative. Adaptive memory is useful context, but advisory: it never outranks the official record. This keeps long-running AI work grounded in what is actually true in the repository rather than in what a model remembers.

## The hardest decision: from 14 agents to 7

The first Developer Team mirrored a full spec-driven pipeline: an orchestrator plus explorer, proposal, spec, design, task, three apply agents (backend, frontend, general), verify, review and archive, alongside init and onboard skills — fourteen catalog entries in total. Every session walked through most of those phases.

It produced too much bureaucracy. Small changes paid the full cost of a large one, sessions grew long, and the process became the work.

On 2026-08-04 I redesigned the team around seven roles: **Lead, Investigate, Architect, Apply Fast, Apply Deep, Quality and Setup**. The Lead now chooses the smallest safe route for each request. A clear, low-risk change is done directly with a minimal check. Unknown territory goes to Investigate. Durable design decisions go to Architect, and only those that justify it become a full spec. Quality runs when there is protected risk, a public contract, a release or contradictory evidence — not as a mandatory final phase.

This was the hardest change because it was not a refactor; it meant rethinking the philosophy of AI-assisted development I had been following. Two lessons came out of it:

- **More is not always better.** Halving the team improved the flow of every session.
- **Specialization still matters, for context.** The answer was not one agent doing everything. Specialists exist so that each one receives only the context its job needs, instead of filling a single context window with discovery, design, code and review at the same time.

## How Deck was built

Deck was built by AI agents under my direction, using a mix of Codex, OpenCode and Deck itself. Using Deck to build Deck was also how I tested it: every session exercised the routing, the delegation and the verification I was designing.

My work was to:

- **Identify the needs** and turn them into clear outcomes.
- **Direct the team**: assign work, reassign it when a role was the wrong fit, and reframe or redirect when an agent drifted from the goal.
- **Teach through the system itself**: system prompts, contracts and the core definitions are how the team learns, so improving them improves every future session.
- **Validate and grade the results**: read the evidence, run the checks, and decide whether a result is actually done.

OpenSpec is the trace of that process: proposals, specs, designs, tasks and verification reports for each meaningful change, kept in the repository next to the code they describe.

## What I learned about leading AI work

1. **Ownership does not transfer to the system.** Even when you trust the system you built, read the AI's answers and proposals consciously. The agent does the work; responsibility for the result stays with you.
2. **Process should be proportional.** A fixed pipeline feels safe but slows everything down. Route by uncertainty and risk, and add ceremony only where it pays for itself.
3. **Context is a resource to design for.** Splitting responsibilities is less about having many agents and more about giving each one a clean, focused context.
4. **Evidence beats claims.** Agents report success easily. Preflight checks, tests, verification records and honest status labels are what make a result trustworthy.
5. **The system is the curriculum.** The most durable way to improve AI output is to encode what you learn into the prompts, contracts and tools every agent receives.

## Where this goes

I want to keep working on systems like this one, where the challenge is not a single prompt but the architecture around AI: how work is routed, how context is shaped, how results are verified, and how a team of agents stays aligned with what people actually need.

Deck is open source under the MIT License. It is maintained at <https://github.com/kevin15011/deck>.
