# Deck Developer Team

The Developer Team is a runtime-installed bundle of agents for software delivery. It is based on an SDD workflow methodology, but Deck defines the team as a product-level concept that can be installed after tools in multiple environments such as Pi and OpenCode.

This document describes the Developer Team roster and workflow decisions. The canonical agent catalog (IDs, display names, descriptions) lives in `packages/core/src/teams/developer/catalog.ts` as a runtime-neutral source of truth. All 12 Developer Team agents have real prompts and matching skills under `packages/core/src/teams/developer/`; each prompt adapts the source methodology to Deck rather than copying it blindly.

## Installation position

Developer Team installation happens after base runtime tools are installed and validated.

```txt
1. Runtime base
2. Tools
3. Developer Team bundle
4. Model assignments
5. Project init / doctor
```

Tools and teams are separate concepts:

- Tools provide capabilities such as context optimization, MCP, memory, and codebase intelligence.
- Teams install one user-facing bundle that contains agent definitions, matching skills, prompts, model assignments, and workflow behavior.

## Agent and skill model

Deck follows a separation between agents and skills.

| Layer | Purpose |
|---|---|
| Agent | Runtime wrapper: name, role, tools, model hints, boundaries, result contract, and instruction to follow the matching skill. |
| Skill | Phase methodology: detailed steps, artifact rules, checks, persistence behavior, failure handling, and reporting format. |

Every Developer Team agent must have a matching skill. The agent prompt should stay thin. The skill owns the detailed procedure.

This avoids duplicating methodology across Pi, OpenCode, Claude, Codex, or future runtimes.

Installer UX rule:

- The installer must present this as one `Developer Team` unit.
- It must not ask users to install agents and skills as separate things.
- Agent/skill separation is internal architecture, not a user-facing package split.

## Naming rules

Agents use product-level names, not internal SDD file names.

Examples:

- `Orchestrator Agent`, not `dev-orchestrator`
- `Explorer Agent`, not `sdd-explore`
- `Proposal Agent`, not `sdd-propose`

Prompt implementation may still use source methodology assets as source material, but the Deck-facing team roster uses human-readable agent names.

## Core workflow

```txt
Orchestrator Agent
  ↓
Explorer Agent
  ↓
Proposal Agent
  ├─ Spec Agent
  └─ Design Agent
        ↓
      Task Agent
        ↓
      Apply Agents
        ├─ Verify Agent
        └─ Review Agent(s)
              ↓
          Apply fixes if needed
              ↓
          Archive Agent
```

Spec and Design run in parallel after Proposal. Task waits for both.

Verify and Review can run in parallel after Apply. Apply agents receive combined findings for fixes.

## Agent and skill roster

| Agent | Matching skill | Required | Source skill | Primary responsibility |
|---|---|---:|---|---|
| Orchestrator Agent | `deck-developer-orchestrator` | Yes | `sdd-orchestrator` | Coordinate the team, delegate work, enforce workflow safety, synthesize results. |
| Explorer Agent | `deck-developer-explorer` | Yes | `sdd-explore` | Investigate code, architecture, constraints, risks, and approaches before commitment. |
| Proposal Agent | `deck-developer-proposal` | Yes | `sdd-propose` | Turn an idea into a formal change proposal with intent, scope, approach, risks, and rollback. |
| Spec Agent | `deck-developer-spec` | Yes | `sdd-spec` | Define formal requirements and acceptance scenarios. |
| Design Agent | `deck-developer-design` | Yes | `sdd-design` | Define technical architecture, tradeoffs, file impact, and implementation approach. |
| Task Agent | `deck-developer-task` | Yes | `sdd-tasks` | Convert Spec + Design into atomic, routed implementation tasks. |
| General Apply Agent | `deck-developer-apply-general` | Yes | `sdd-apply` | Implement small, shared, cross-cutting, config, script, or general tasks. |
| Backend Apply Agent | `deck-developer-apply-backend` | Yes | `sdd-apply` adapted by scope | Implement backend/API/service/database/auth/server-side tasks when applicable. |
| Frontend Apply Agent | `deck-developer-apply-frontend` | Yes | `sdd-apply` adapted by scope | Implement UI/component/state/accessibility/frontend test tasks when applicable. |
| Verify Agent | `deck-developer-verify` | Yes | `sdd-verify` | Check compliance with specs, tasks, tests, build/typecheck, and basic design coherence. |
| Review Agent | `deck-developer-review` | Yes | `sdd-review` / fresh review behavior | Review engineering quality: architecture, security, scalability, maintainability, frontend/backend practices. |
| Archive Agent | `deck-developer-archive` | Yes | `sdd-archive` | Close the change, preserve traceability, and update project AI notes when useful. |

Skill names intentionally mirror agent IDs so installers can pair them deterministically.

## Agent definitions

### Orchestrator Agent

The Orchestrator Agent coordinates the Developer Team. It keeps the main conversation thin, delegates real work to specialist agents, enforces workflow safety rules, and synthesizes results for the user.

Responsibilities:

- Receive user intent.
- Decide whether the change needs a compact flow or full SDD-style flow.
- Delegate work to the correct agent.
- Avoid unnecessary context growth.
- Enforce delegation triggers:
  - 4+ files to understand means delegate exploration.
  - Multi-file non-trivial implementation means delegate apply work.
  - Fresh review before commit, push, or PR unless changes are trivial docs/text.
  - Stop for audit after incidents or confusing environment workarounds.
- Coordinate artifact persistence via OpenSpec (required, not a mode selection).
- Retrieve project AI notes before work and inject relevant context into agents.
- Inject stack and task-specific skills into sub-agents.
- Synthesize results and ask for user confirmation when workflow risk requires it.

Non-goals:

- Does not implement complex changes directly.
- Does not run heavy tests/builds itself.
- Does not perform broad exploration inline.
- Does not become a mega-agent that does everything.

### Explorer Agent

The Explorer Agent investigates before the team commits to a formal change.

Responsibilities:

- Understand the topic, feature, bug, or idea.
- Read relevant codebase files.
- Identify entry points, affected modules, existing tests, coupling, constraints, and risks.
- Compare possible approaches with pros, cons, and effort.
- Recommend a path forward.

Non-goals:

- Does not modify files.
- Does not implement.
- Does not create formal specs or proposals.
- Does not delegate further.

### Proposal Agent

The Proposal Agent turns an explored idea into a formal change proposal.

Responsibilities:

- Read the Explorer artifact when available.
- Define intent, scope, out-of-scope items, approach, affected modules, risks, and rollback plan.
- Persist the proposal artifact.
- Recommend Spec Agent and Design Agent as next steps.

Non-goals:

- Does not explore broadly again unless minimal context is missing.
- Does not write detailed specs.
- Does not make deep technical design decisions.
- Does not implement.

### Spec Agent

The Spec Agent turns a proposal into formal requirements and acceptance scenarios.

Responsibilities:

- Read the Proposal artifact.
- Write requirements using clear requirement language such as MUST, SHOULD, and MAY.
- Write acceptance scenarios using Given/When/Then.
- Capture edge cases and ambiguity.
- Persist the spec artifact.

Important behavior:

- The Spec Agent is surface-aware, not implementation-aware.
- It may describe behavior by surface such as UI, API, data, security, permissions, empty states, and errors.
- It must not prescribe implementation details such as specific React components, routes, database tables, or file names unless those are part of the public contract.

Non-goals:

- Does not design implementation architecture.
- Does not break work into tasks.
- Does not implement or run tests.

### Design Agent

The Design Agent turns a proposal into technical architecture decisions, implementation approach, file impact, tradeoffs, and system flow.

Responsibilities:

- Read the Proposal artifact.
- Read existing architecture and code patterns.
- Make technical decisions with rationale.
- Record chosen approach and rejected alternatives.
- Define backend, frontend, shared, data, contract, integration, and test strategy sections when applicable.
- Produce file impact expectations.
- Include sequence diagrams when flows are complex.
- Report risks and open decisions.

Important behavior:

- The Design Agent is domain-aware and stack-aware.
- It is strongly affected by language, framework, architecture, and project conventions.
- It must receive skill injection based on stack and files touched.
- It should not be split into `React Design Agent`, `Go Design Agent`, etc. The role stays stable; injected context changes.

Relationship with Spec:

- Design does not formally depend on Spec.
- Spec and Design both depend on Proposal.
- If Design discovers missing or conflicting behavior, it reports an open question or risk instead of silently changing scope.

### Task Agent

The Task Agent turns Spec + Design into ordered, atomic implementation tasks.

Responsibilities:

- Read Spec artifact.
- Read Design artifact.
- Reconcile behavior requirements with technical decisions.
- Create numbered tasks that are atomic enough for one session.
- Map tasks to affected files or modules.
- Group tasks by phase/domain.
- Mark dependencies and hidden coupling.
- Estimate task complexity and flag work that may need splitting.
- Assign recommended owner:
  - General Apply Agent
  - Backend Apply Agent
  - Frontend Apply Agent
- Indicate whether Apply agents can run in parallel or must run sequentially.

Important behavior:

- Task Agent is owner-aware and dependency-aware.
- It should not produce a flat naive task list when backend/frontend/shared domains are involved.
- It produces the routing input that the Orchestrator uses for Apply.

Non-goals:

- Does not implement.
- Does not rewrite requirements.
- Does not change architecture decisions.

### Apply Agents

Apply work is split into three installed agents. All are part of the Developer Team. Usage is conditional; installation is not.

#### General Apply Agent

Handles:

- Small or cross-cutting changes.
- Shared packages and contracts.
- Config, scripts, project plumbing, docs tied to implementation.
- Tasks that do not clearly belong to frontend or backend.

#### Backend Apply Agent

Handles:

- APIs and contracts.
- Services and domain logic.
- Database/schema changes.
- Auth, permissions, jobs, queues, backend observability.
- Backend tests.

#### Frontend Apply Agent

Handles:

- UI components.
- Client-side state.
- Accessibility.
- Forms and user flows.
- Frontend integration with backend contracts.
- Frontend tests and visual behavior.

Routing rules:

- Task Agent recommends owner.
- Orchestrator executes owners according to dependencies.
- Shared/contracts usually run before backend/frontend.
- Backend and frontend may run in parallel only when contracts and dependencies are clear.

### Verify Agent

The Verify Agent is the compliance and test gate.

Responsibilities:

- Read Spec, Tasks, Design, and Apply progress.
- Check whether all tasks are complete.
- Run tests.
- Run build and typecheck.
- Build a compliance matrix from scenario to result.
- Report PASS, PASS WITH WARNINGS, or FAIL.
- Classify findings as CRITICAL, WARNING, or SUGGESTION.

Important behavior:

- Verify answers: “Does the implementation satisfy what was promised?”
- It is not the full engineering quality gate.
- It should not try to absorb all security, scalability, architecture, and frontend/backend best-practice review responsibilities.

### Review Agent

The Review Agent is the engineering quality gate.

Responsibilities:

- Review architecture quality.
- Review security risks.
- Review scalability and maintainability.
- Review code quality and coupling.
- Review backend and frontend best practices.
- Review integration concerns across boundaries.
- Use strong skill injection based on scope and stack.

Scopes:

- `general`
- `backend`
- `frontend`
- `integration`

Important behavior:

- There is one Review Agent role, not separate Backend Review and Frontend Review agents.
- Orchestrator may launch multiple scoped Review Agent instances in parallel.
- This avoids roster bloat while enabling deep review where needed.

Post-Apply flow:

```txt
Apply Agents
  ├─ Verify Agent
  └─ Review Agent(s)
       ↓
Combined findings
       ↓
Apply Agent(s) fix
```

### Archive Agent

The Archive Agent closes a completed and verified change.

Responsibilities:

- Read all change artifacts:
  - proposal
  - spec
  - design
  - tasks
  - apply progress
  - verify report
  - review report
- Produce final traceability report.
- Merge delta specs into main specs when using file-based specs.
- Move completed changes to archive under the OpenSpec directory.
- Record follow-ups if any remain.
- Extract or update project AI notes when the session reveals reusable project knowledge.

Important behavior:

- Archive does not modify prompts, skills, agents, or policies automatically.
- Archive can propose project learnings and update project-owned AI notes.
- Archive runs only after Verify and Review have passed, unless explicitly archiving a blocked/abandoned change.

## Skill injection

Skill injection is a core part of the Developer Team.

Deck must not create separate agents for every language or framework. Instead, agents keep stable roles and receive stack-specific rules at runtime.

Examples:

```txt
Design Agent
+ React rules
+ TypeScript rules
+ Tailwind rules
→ frontend design
```

```txt
Design Agent
+ Node backend rules
+ Database schema rules
+ API design rules
→ backend design
```

Required behavior:

- Orchestrator resolves relevant skills by stack, file paths, and task context.
- Orchestrator injects compact rules into agents under `## Project Standards (auto-resolved)`.
- Agents obey injected standards for stack-specific decisions.
- Prompt implementation must explicitly respect this injected section.

Relevant skill types include:

- API design
- database schema design
- Node backend patterns
- React/Next best practices
- Tailwind design systems
- Shopify Liquid themes and standards
- Go testing
- TypeScript advanced types
- Playwright/webapp testing
- TDD
- Git/PR/work-unit rules

## Project AI notes (Phase 5 — planned)

> **Note**: Project AI notes are a planned Phase 5 feature. The behavior described below is the target design, not current behavior. Do not reference `.deck/ai-notes/` as active until Phase 5 is implemented.

Project AI notes will be shared, repo-owned knowledge for future agents and developers. They are not session logs and are not individual user memory.

Planned source of truth:

```txt
.deck/ai-notes/
```

Engram or other memory systems may cache/index this information, but they are not the source of truth because they are local to a user or runtime.

Purpose:

- Capture non-obvious, reusable project knowledge.
- Prevent future agents from missing related files or project-specific constraints.
- Make learnings available to all developers who work on the project.

Example note:

```md
# Product card variants

This Shopify theme has three product card variants:

- `snippets/product-card.liquid`
- `snippets/featured-product-card.liquid`
- `snippets/collection-product-card.liquid`

When changing pricing, badges, media, or CTA behavior in one card, inspect all three variants.
```

Archive Agent lifecycle:

1. Search existing AI notes for related knowledge.
2. If the note already exists and is correct, do nothing.
3. If the note exists but is incomplete, update it.
4. If no relevant note exists, create one.
5. Do not create one note per session.
6. Do not duplicate learnings.

Orchestrator lifecycle:

1. Search project AI notes before launching work.
2. Retrieve notes relevant to the user request, changed files, stack, or domain.
3. Inject them into agents under `## Project Context (auto-retrieved)`.

## Artifact and memory policy

Project-owned artifacts are persisted as OpenSpec files — this is required and non-optional.

Architecture:

- **OpenSpec files** (required): source of truth for all SDD artifacts. Versionable, committable, full git history. Stored under `openspec/changes/{change-name}/`.
- **Spec Registry** (required): operational authority and control plane. Tracks change lifecycle, artifact state, and events in `openspec/changes/{change-name}/state.yaml` and `events.yaml`. A phase is not complete until the artifact and matching registry entries exist. See `docs/openspec-registry-roadmap.md`.
- **Memory adapters** (auxiliary): optional cache/index for local retrieval and cross-session convenience (e.g., Engram). Memory never replaces or overwrites official OpenSpec artifacts.
- **Project AI notes** (planned, Phase 5): repo-owned shared knowledge under `.deck/ai-notes/`. Not yet active — deferred to Phase 5.

## Prompt and skill implementation policy

This document defines the roster and workflow only. Placeholder prompts are acceptable during early installation work, but the final Developer Team bundle must contain both agents and matching skills internally.

When implementing prompts and skills:

1. Re-open the matching source agent definition and skill definition.
2. Review them one by one with the user when needed.
3. Keep agent prompts thin: identity, boundaries, tools/model hints, result contract, and instruction to follow the matching skill.
4. Put detailed methodology in the matching skill.
5. Copy source content exactly when appropriate.
6. Adapt only when Deck's team model, runtime adapters, naming, skill injection, project AI notes, or split Apply/Review model requires it.
7. Record any adaptation as an explicit decision.

### Orchestrator prompt implementation

The Orchestrator Agent has a real prompt and skill. Its content lives in `packages/core/src/teams/developer/orchestrator-content.ts` and is derived from the source `sdd-orchestrator.md` with the following adaptations:

- **No slash commands**: Deck's Pi launcher uses `deck pi developer` to start a session. The user does not need `/sdd-new`, `/sdd-ff`, or `/sdd-continue` inside the session. The orchestrator responds to natural language.
- **No OpenCode-specific model assignments**: Deck is runtime-agnostic. Model assignment is left to the adapter layer (Pi, OpenCode, etc.), not hardcoded in the orchestrator prompt.
- **Team-scoped routing**: The orchestrator routes only within the Developer Team. Each team has its own orchestrator.
- **Apply routing**: Deck has three Apply agents (General, Backend, Frontend). The orchestrator routes based on Task recommendations.
- **Spec and Design parallel**: Explicitly documented as parallel after Proposal, with Tasks waiting for both.
- **Verify and Review parallel**: Explicitly documented as separate parallel gates after Apply.
- **Project AI notes** (planned): Will be `.deck/ai-notes/` — repo-owned shared notes, deferred to Phase 5.
- **Skill injection**: Orchestrator resolves compact rules from the registry and injects them under `## Project Standards (auto-resolved)`.

The orchestrator content is exported as three constants:

- `ORCHESTRATOR_SYSTEM_PROMPT` — the Pi session system prompt (written to `.deck/pi/profiles/developer-team/system-prompt.md`).
- `ORCHESTRATOR_AGENT_BODY` — the body of `.pi/agents/deck-developer-orchestrator.md` (after Pi frontmatter).
- `ORCHESTRATOR_SKILL_BODY` — the body of `.pi/skills/deck-developer-orchestrator/SKILL.md` (after Pi frontmatter).

### Explorer prompt implementation

The Explorer Agent has a real prompt and skill. Its content lives in `packages/core/src/teams/developer/explorer-content.ts` and is derived from the source `sdd-explore` skill with the following adaptations:

- **Structured findings format**: Explorer produces a fixed output format with Goal, Current State, Relevant Files, Constraints, Risks, Options and Tradeoffs, Recommendation, and Open Questions — designed for consumption by Proposal, Spec, and Design agents.
- **Tool preference**: Explicitly prefers codebase graph/search tools for structural discovery and documents filesystem fallback.
- **Scope discipline**: Instructs the agent to start narrow and avoid reading too broadly, compressing findings as it goes.
- **No product code changes**: Explorer is prohibited from modifying product code or configuration; it may write `exploration.md` plus required Spec Registry files.
- **No delegation**: Explorer is the terminal exploration phase and must not delegate further.
- **Runtime-agnostic**: No references to Pi-specific launcher behavior, slash commands, or model assignments.
- **Artifact persistence**: Writes `exploration.md` to the OpenSpec change directory. Memory is auxiliary only.

The explorer content is exported as two constants:

- `EXPLORER_AGENT_BODY` — the body of the explorer agent file (after runtime frontmatter).
- `EXPLORER_SKILL_BODY` — the body of the explorer skill file (after runtime frontmatter).

Explorer does not have a system prompt surface — only the Orchestrator owns the session system prompt.

All remaining Developer Team agents also have real prompts and matching skills registered in `packages/core/src/teams/developer/content-registry.ts`.

### Proposal prompt implementation

The Proposal Agent is the third agent with a real (non-placeholder) prompt and skill. Its content lives in `packages/core/src/teams/developer/proposal-content.ts` and is derived from the source `sdd-propose` skill with the following adaptations:

- **Structured proposal output**: Proposal produces a fixed output template with Intent, Goal, Scope (In/Out), Affected Capabilities (New/Modified/Unchanged), Approach, Alternatives and Tradeoffs, Risks, Rollback Plan, Dependencies, Open Questions, and Acceptance Direction — designed for parallel consumption by Spec and Design agents.
- **Uncertainty preservation**: Proposal explicitly instructs the agent to flag open questions instead of inventing facts, assuming constraints, or fabricating technical details.
- **No re-exploration**: Proposal trusts Explorer findings. It reads only what is necessary to fill gaps, not to re-explore the codebase.
- **Capabilities contract**: The Affected Capabilities section serves as an explicit contract between Proposal and Spec/Design, identifying new, modified, and unchanged capabilities.
- **Downstream routing**: Proposal output explicitly recommends Spec and Design as parallel next steps with their team-scoped IDs.
- **Runtime-agnostic**: No references to Pi-specific launcher behavior, slash commands, or model assignments.
- **Artifact persistence**: Writes `proposal.md` to the OpenSpec change directory. Memory is auxiliary only.

The proposal content is exported as two constants:

- `PROPOSAL_AGENT_BODY` — the body of the proposal agent file (after runtime frontmatter).
- `PROPOSAL_SKILL_BODY` — the body of the proposal skill file (after runtime frontmatter).

Proposal does not have a system prompt surface — only the Orchestrator owns the session system prompt.

### Spec prompt implementation

The Spec Agent is the fourth agent with a real (non-placeholder) prompt and skill. Its content lives in `packages/core/src/teams/developer/spec-content.ts` and is derived from the source `sdd-spec` skill with the following adaptations:

- **Surface-aware requirements**: Spec defines externally observable behavior, contracts, states, validation rules, errors, and acceptance scenarios — not internal architecture or implementation details. Requirements use MUST/SHOULD/MAY language and are tagged by surface type (API, UI, Data, Security, etc.).
- **Given/When/Then scenarios**: Every requirement maps to one or more acceptance scenarios in explicit Given/When/Then format, covering happy paths, error states, empty states, boundary conditions, and permission failures.
- **Uncertainty preservation**: Spec explicitly instructs the agent to flag open questions instead of inventing requirements, fabricating validation rules, or assuming unstated behavior.
- **No implementation leakage**: The agent is prohibited from prescribing implementation details (specific frameworks, file names, internal structures) unless those are part of the public contract.
- **Compliance matrix**: Spec output includes a compliance matrix mapping each REQ-ID to its covering scenarios, providing a traceable link between requirements and acceptance criteria.
- **Downstream consumption**: Spec output is structured for consumption by Design Agent and Task Agent. Design runs in parallel and does not depend on Spec; Task waits for both.
- **Runtime-agnostic**: No references to Pi-specific launcher behavior, slash commands, or model assignments.
- **Artifact persistence**: Writes `spec.md` to the OpenSpec change directory. Memory is auxiliary only.

The spec content is exported as two constants:

- `SPEC_AGENT_BODY` — the body of the spec agent file (after runtime frontmatter).
- `SPEC_SKILL_BODY` — the body of the spec skill file (after runtime frontmatter).

Spec does not have a system prompt surface — only the Orchestrator owns the session system prompt.

### Design prompt implementation

The Design Agent is the fifth agent with a real (non-placeholder) prompt and skill. Its content lives in `packages/core/src/teams/developer/design-content.ts` and is derived from the source `sdd-design` skill with the following adaptations:

- **Technical architecture focus**: Design defines HOW to implement the change at the architecture level — component/module boundaries, data flow, API/contract implications, state/persistence strategy, migration/backward compatibility, testing approach, tradeoffs, risks, and open questions — without writing code or creating task breakdowns.
- **Parallel with Spec**: Design does not formally depend on Spec. Both depend on Proposal and run in parallel. If Design discovers missing or conflicting behavior, it reports an open question rather than silently changing scope.
- **Domain and stack awareness**: Design is domain-aware and stack-aware. It uses injected stack-specific rules and project conventions to make informed decisions, and flags missing context rather than inventing assumptions.
- **File impact estimate**: Design output includes a file impact table estimating which files will be created, modified, or deleted.
- **Structured tradeoffs**: Design records chosen approach, rejected alternatives, and rationale in a structured format.
- **Uncertainty preservation**: Design explicitly instructs the agent to flag open questions and open decisions instead of inventing facts, assuming constraints, or fabricating architectural details.
- **Runtime-agnostic**: No references to Pi-specific launcher behavior, slash commands, or model assignments.
- **Artifact persistence**: Writes `design.md` to the OpenSpec change directory. Memory is auxiliary only.

The design content is exported as two constants:

- `DESIGN_AGENT_BODY` — the body of the design agent file (after runtime frontmatter).
- `DESIGN_SKILL_BODY` — the body of the design skill file (after runtime frontmatter).

Design does not have a system prompt surface — only the Orchestrator owns the session system prompt.

All 12 Developer Team agents now have real prompts and matching skills. Placeholder generation remains only as a defensive fallback for future catalog entries that are not implemented yet.

- The team is installed after tools.
- The team installs as one user-facing Developer Team bundle.
- Internally, that bundle contains agents and matching skills.
- Agent names are product-level names.
- Every Developer Team agent has a matching skill.
- Agent prompts stay thin; skills own methodology.
- Orchestrator Agent is required and has a real (non-placeholder) prompt and skill.
- Orchestrator prompt is derived from the source sdd-orchestrator.md, adapted for Deck.
- Orchestrator system prompt is the Pi session prompt — the user session IS the orchestrator session.
- Explorer Agent is required, has a real (non-placeholder) prompt and skill, and replaces the earlier `Discovery Agent` name.
- Proposal Agent is required.
- Spec Agent and Design Agent stay separate.
- Spec and Design can run in parallel after Proposal.
- Design does not depend directly on Spec.
- Task Agent waits for both Spec and Design.
- Spec is surface-aware and not implementation-aware.
- Design is domain-aware and stack-aware.
- Task is owner-aware and dependency-aware.
- Apply is split into General, Backend, and Frontend Apply Agents.
- All Apply Agents are installed with the team; usage is conditional.
- Verify is a compliance/test gate.
- Review is an engineering quality gate.
- Review is one scoped role, not separate backend/frontend review agents.
- Verify and Review may run in parallel after Apply.
- Archive is required and extracts project AI notes when useful.
- Project AI notes are shared repo-owned notes, not Engram-only memory.
- Project AI notes must be deduplicated and updated, not created per session.
- Agent IDs use `deck-developer-` prefix as team-scoped namespace (e.g. `deck-developer-orchestrator`). The canonical catalog lives in `packages/core/src/teams/developer/catalog.ts` as a runtime-neutral source of truth; adapters (Pi, OpenCode) consume it to materialize runtime-specific files.
- Orchestrator does not use slash commands — responds to natural language inside the session.
