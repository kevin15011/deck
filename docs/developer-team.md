# Developer Team

The Developer Team is Deck's adaptive work-routing system. It does not force every request through every role: Lead selects the smallest safe route, and specialists are activated only when their uncertainty, design, implementation, readiness, or verification work is justified.

> **Audience:** People using Deck's Developer Team.
> **Authority:** Product behavior and role inventory; the canonical catalog, runner adapters, and execution contracts define current behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [role catalog](../packages/core/src/teams/developer/catalog.ts), [Developer Team content registry](../packages/core/src/teams/developer/content-registry.ts), [Pi adapter](../packages/adapter-pi/src/developer-team-install.ts), [OpenCode adapter](../packages/adapter-opencode/src/developer-team-install.ts), and [documentation governance](../tests/documentation-governance.test.ts).

## Role inventory

The canonical installation contains seven agent/skill pairs. The first column is the stable catalog ID.

| Role ID | Display name | Responsibility |
|---|---|---|
| `deck-lead` | Lead | Owns the user outcome, chooses the smallest safe route, coordinates specialists, and can implement clear low-risk deltas directly. |
| `deck-investigate` | Investigate | Traces unfamiliar code and production composition, locates causes and risks, and returns a compact evidence-backed handoff. |
| `deck-architect` | Architect | Plans proportionally from a Working Brief through Full SDD only when durable design decisions justify the cost. |
| `deck-apply-fast` | Apply Fast | Implements clear, routine, localized, or pattern-based changes as a complete vertical slice with proportional tests. |
| `deck-apply-deep` | Apply Deep | Handles algorithmic, concurrent, performance-sensitive, protocol, migration, or difficult debugging work requiring deep reasoning. |
| `deck-quality` | Quality | Independently verifies behavior, architecture, regression risk, security, and protected boundaries without modifying the candidate. |
| `deck-setup` | Setup | Repairs missing, stale, invalid, or indeterminate project-readiness components found during preflight. |

The standalone `deck-onboard` and `deck-archive` skills are lifecycle companions, not additional Developer Team agents. Legacy role IDs remain migration/history surfaces and are not materialized as aliases.

## Adaptive routing

Lead chooses among these routes:

| Situation | Smallest useful route |
|---|---|
| Clear, low-risk, localized change | Lead or Apply Fast directly, with focused evidence. |
| Unfamiliar code, production composition, or unclear cause | Investigate, then return a compact handoff. |
| Durable interface, architecture, or lifecycle decision | Architect with a Working Brief or Full SDD proportional to the decision. |
| Algorithmic, concurrent, protocol, migration, or hard debugging work | Apply Deep. |
| Missing or stale readiness component | Setup, limited to the discovered project-readiness repair. |
| Material protected risk, uncertain evidence, release readiness, or explicit request | Quality, independently and without changing the candidate. |

Quality is conditional, not a universal final phase. The objective is one functional candidate with checks proportional to the risk, not a phase parade.

## Runner materialization

The role inventory is runner-neutral, but installation effects are runner-native. Pi writes the Developer Team into the project team surface shown by its installer; OpenCode writes its corresponding runner-native configuration. The TUI shows the target and included roles before applying the plan.

Model assignment is per role. The configuration flow discovers providers and models through the active runner, then lets you set reasoning/thinking levels where the selected model supports them. See [Configuration](configuration.md).

Pi can launch the installed Developer Team explicitly:

```sh
deck pi developer
deck pi developer --continue
deck pi developer --resume
```

The memory choice is also explicit for that launch path:

```sh
deck pi developer --memory=none
deck pi developer --memory=engram
deck pi developer --memory=supermemory
```

## Authority and safety

- OpenSpec artifacts and Spec Registry entries are the official record for requirements, design, tasks, and change state.
- Source, tests, and current runner evidence define volatile runtime facts.
- Adaptive memory can add context but never outranks official artifacts or runner evidence.
- Runner hooks provide trusted execution context; agent-supplied context is not authority.
- Protected writes require the applicable authorization and Git-safety boundaries.
- Verification starts focused and broadens only when the change or risk requires it.

For maintainers operating the rollout controls, see [Developer Team execution](developer-team-execution.md). For user-facing setup, see [Getting started](getting-started.md).
