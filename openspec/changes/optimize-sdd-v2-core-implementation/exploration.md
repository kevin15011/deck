# Exploration: SDD v2 Core Implementation Architecture

## Goal

Investigate the source architecture of `packages/core` and `packages/sdd-runtime` so that the next implementation cycle targets the correct files — not `.pi/` (generated output).

## Current State

### Architecture Overview

The system has a **three-layer architecture**:

1. **Source layer** (`packages/core/src/teams/developer/`) — canonical, runtime-neutral agent content
2. **Adapter layer** (`packages/adapter-pi/`) — transforms source into `.pi/` output
3. **Generated output** (`.pi/agents/`, `.pi/skills/`) — gitignored runtime files

**The prior implementation failed because it edited the adapter output layer (`.pi/`) instead of the source layer (`packages/core/`).** The correct implementation target is `packages/core/src/teams/developer/` for all agent content changes.

---

## 1. How `packages/core` Defines Developer Team Agent Content

### Directory Structure

```
packages/core/src/teams/developer/
├── catalog.ts                           # Agent catalog: 12 agents, IDs, descriptions
├── content-registry.ts                  # Runtime-agnostic registry (getAgentContent, getTeamSessionInstructions)
├── orchestrator-content.ts              # Orchestrator SYSTEM_PROMPT, AGENT_BODY, SKILL_BODY
├── explorer-content.ts                  # Explorer AGENT_BODY, SKILL_BODY
├── proposal-content.ts                  # Proposal AGENT_BODY, SKILL_BODY
├── spec-content.ts                      # Spec AGENT_BODY, SKILL_BODY
├── design-content.ts                     # Design AGENT_BODY, SKILL_BODY
├── task-content.ts                      # Task AGENT_BODY, SKILL_BODY
├── apply-general-content.ts            # General Apply AGENT_BODY, SKILL_BODY
├── apply-backend-content.ts            # Backend Apply AGENT_BODY, SKILL_BODY
├── apply-frontend-content.ts            # Frontend Apply AGENT_BODY, SKILL_BODY
├── verify-content.ts                   # Verify AGENT_BODY, SKILL_BODY
├── review-content.ts                   # Review AGENT_BODY, SKILL_BODY
├── archive-content.ts                  # Archive AGENT_BODY, SKILL_BODY
├── visual-explanations-content.ts      # Mermaid/visual fragment (Orchestrator only)
├── [content].test.ts                   # Tests for each content file
├── content-registry.test.ts
├── catalog.test.ts
```

### Agent Content Pattern

Each content file exports two strings:
- `*_AGENT_BODY` — thin identity + boundaries + skill reference (goes after frontmatter in agent file)
- `*_SKILL_BODY` — detailed methodology (goes after frontmatter in skill file)

### Content Registry (`content-registry.ts`)

- `getAgentContent(agentId)` — returns `{agentBody, skillBody}` for a given agent ID; appends adaptive-memory guidance
- `getTeamSessionInstructions(teamId)` — returns full system prompt for a team; for "developer-team" returns `ORCHESTRATOR_SYSTEM_PROMPT`
- `REAL_CONTENT` map holds all 12 agents with real content; catalog-only agents get placeholder builders
- Visual explanations are composed into Orchestrator skill only

### Catalog (`catalog.ts`)

- `DEVELOPER_TEAM_AGENTS` — array of 12 agent definitions: `id`, `name`, `displayName`, `description`, `skillId`
- Agent IDs: `deck-developer-orchestrator`, `deck-developer-explorer`, `deck-developer-proposal`, `deck-developer-spec`, `deck-developer-design`, `deck-developer-task`, `deck-developer-apply-general`, `deck-developer-apply-backend`, `deck-developer-apply-frontend`, `deck-developer-verify`, `deck-developer-review`, `deck-developer-archive`

---

## 2. How `packages/sdd-runtime` Orchestrates the SDD Workflow

### Directory Structure

```
packages/sdd-runtime/src/
├── index.ts                            # Public exports
├── contracts/
│   ├── self-audit.ts                   # Audit validation
│   ├── risk.ts                         # Risk scoring
│   ├── outcome.ts                      # Phase outcomes
│   ├── state-update.ts                 # State update contracts
│   └── [contract].test.ts
├── orchestrator/
│   ├── orchestrator-pipeline.ts        # Wires: audit → risk → quality → loop
│   ├── risk-scorer.ts                 # Risk score computation
│   ├── quality-router.ts               # Quality gate routing
│   ├── loop-breaker.ts                 # Loop detection
│   ├── budget-watchdog.ts              # Budget enforcement
│   ├── project-discovery.ts            # Project context discovery
│   ├── enforcement-mode.ts             # Enforcement mode config
│   └── [module].test.ts
├── runner/
│   ├── runner-pipeline.ts              # Wires: transport → budget → state
│   ├── runner-recovery.ts             # Recovery classification
│   └── [module].test.ts
├── artifact-state/
│   ├── artifact-state-manager.ts       # CAS, idempotency, event/lock guarantees
│   └── [module].test.ts
└── scenarios.test.ts                   # Integration scenarios
```

### Phase Sequence and Dependency Graph

The phase sequence is defined **in text** inside `orchestrator-content.ts` (ORCHESTRATOR_SYSTEM_PROMPT and ORCHESTRATOR_SKILL_BODY):

```
proposal ──┬─ spec ────┐
             │            ├─ tasks ── apply ──┬─ verify ──┬─ archive
             └─ design ──┘                    └─ review ──┘
```

- Spec and Design run in parallel after Proposal
- Task waits for both Spec and Design
- Verify and Review run in parallel after Apply
- Apply routing chooses General/Backend/Frontend based on Task recommendations
- Archive runs after Verify and Review pass

### Apply Batching/Fanout Logic

Apply batching guidance is **in text** in `orchestrator-content.ts`. The Orchestrator:
- Inspects Task's "Review Workload Forecast" and "Open Questions / Blockers"
- Classifies tasks as unblocked/blocked/allowed-with-placeholder
- Routes by owner: General, Backend, Frontend
- Does not launch Apply for blocked tasks
- May run Backend and Frontend in parallel only when contracts/dependencies are clear

### Phase Verification and Gate Checks

- Phase gates are defined **as text rules** in `orchestrator-content.ts` (ORCHESTRATOR_SYSTEM_PROMPT and ORCHESTRATOR_SKILL_BODY)
- `artifact-state-manager.ts` provides structured CAS/idempotency/event-store primitives
- `orchestrator-pipeline.ts` runs self-audit validation → risk scoring → quality routing → loop breaking
- `runner-pipeline.ts` runs transport recovery → budget check → state manager
- No hard-coded phase sequence enforcement exists in code; it is guidance in the Orchestrator's prompts

---

## 3. How `packages/adapter-pi` Transforms Core into `.pi/` Output

### Adapter Role

`adapter-pi` is a **materialization adapter**. It:
1. Calls `getAgentContent()` from `@deck/core` to get body content
2. Composes adaptive memory into content
3. Adds YAML frontmatter (name, description, skill, model, thinking, tools)
4. Writes `.pi/agents/{agentId}.md` and `.pi/skills/{agentId}/SKILL.md`

### Key Files

- `developer-team-install.ts` — `buildDeveloperTeamInstallPlan()`, `applyDeveloperTeamInstall()`, `verifyDeveloperTeamInstall()`
- `buildAgentFileContent()` — calls `getAgentContent()` from core, wraps with Pi frontmatter
- `buildSkillFileContent()` — calls `getAgentContent()` from core, wraps with frontmatter
- `developer-team-catalog.ts` — deprecated re-export from `@deck/core/teams/developer/catalog`

### Build/Install Pipeline

```
core content-registry (getAgentContent)
    ↓
adapter-pi (buildAgentFileContent / buildSkillFileContent)
    ↓
.pi/agents/{id}.md, .pi/skills/{id}/SKILL.md
```

### Can We Modify Behavior by Changing Only Core?

**YES.** All agent body and skill body content is defined in `packages/core/src/teams/developer/`. Changing those files and running the adapter produces updated `.pi/` output.

**The adapter does NOT contribute behavioral logic.** It only:
- Adds frontmatter wrapper
- Composes adaptive memory
- Writes to `.pi/`

No adapter changes are needed for the 7 needs from the prior change, unless a need involves frontmatter, memory injection, or model/thinking configuration.

---

## 4. Source File Map: Where to Implement Each of the 7 Needs

### Need 1: Apply Batching Optimization

**Source:** `packages/core/src/teams/developer/orchestrator-content.ts`
**What to change:** `ORCHESTRATOR_SYSTEM_PROMPT` and `ORCHESTRATOR_SKILL_BODY` — expand the "Apply Routing" section to add batching guidance: group tasks by owner/context, convert Task's execution groups into coherent Apply batches, define criteria for safe parallel fanout (independent areas, non-overlapping, low conflict risk).

**Tests:** `orchestrator-content.test.ts`

### Need 2: Post-Archive Git Suggestions

**Source:** `packages/core/src/teams/developer/orchestrator-content.ts` and `packages/core/src/teams/developer/archive-content.ts`
**What to change:**
- `ORCHESTRATOR_SYSTEM_PROMPT` — add post-Archive section: inspect completed change/diff, suggest conventional commit messages and optional PR title/body (advisory only, no auto-commit)
- `ARCHIVE_SKILL_BODY` — add that Archive should prepare change diff context for post-Archive Git suggestions

**Tests:** `orchestrator-content.test.ts`, `archive-content.test.ts`

### Need 3: Explorer-Before-Proposal Triage

**Source:** `packages/core/src/teams/developer/orchestrator-content.ts` (SDD Triage Gate section)
**What to change:** Expand the triage triggers in `ORCHESTRATOR_SYSTEM_PROMPT` and `ORCHESTRATOR_SKILL_BODY` to include: codebase changes, architecture changes, agent config/prompt changes, workflow-internal changes, OpenSpec/routing implications, broad project impact.

**Tests:** `orchestrator-content.test.ts`

### Need 4: Role-Based Delegation Outside SDD

**Source:** `packages/core/src/teams/developer/orchestrator-content.ts` (Delegation Rules and Sub-Agent Context Protocol sections)
**What to change:** Clarify in `ORCHESTRATOR_SYSTEM_PROMPT` and `ORCHESTRATOR_SKILL_BODY` that specialized role delegation applies outside formal SDD/direct when delegation rules trigger, while SDD remains the formal pipeline.

**Tests:** `orchestrator-content.test.ts`

### Need 5: Artifact/Registry Persistence Hardening

**Sources:**
- `packages/core/src/teams/developer/orchestrator-content.ts` (Artifact Persistence Policy section)
- `packages/sdd-runtime/src/artifact-state/artifact-state-manager.ts`
- Individual phase content files: `explorer-content.ts`, `proposal-content.ts`, `spec-content.ts`, `design-content.ts`, `task-content.ts`, `apply-*-content.ts`, `verify-content.ts`, `review-content.ts`, `archive-content.ts`

**What to change:**
- `orchestrator-content.ts` — expand Artifact Persistence Policy: self-verification rules before claiming completion, registry-deferred mode for parallel phases, Orchestrator verification before phase advancement
- Phase content files — add self-verification steps to SKILL_BODY of each phase agent
- `artifact-state-manager.ts` — may need hardening of CAS/idempotency adapters if gaps found

**Tests:** `orchestrator-content.test.ts`, `content-registry.test.ts`, `artifact-state-manager.test.ts`

### Need 6: Execution Config Respect

**Source:** `packages/adapter-pi/src/developer-team-install.ts` and `packages/core/src/teams/developer/orchestrator-content.ts`
**What to change:**
- `orchestrator-content.ts` — add guidance that Orchestrator must not override registered agent `model`, `context`, `thinking`, `tools` unless explicitly requested or required by documented workflow rules
- `developer-team-install.ts` — the adapter already reads model/thinking from `.pi/` files via `readDeveloperTeamModelAssignments()`; the orchestrator guidance must match this

**Tests:** `orchestrator-content.test.ts`, `developer-team-install.test.ts`

### Need 7: Mermaid-Backed Orchestrator Summaries

**Source:** `packages/core/src/teams/developer/visual-explanations-content.ts` and `packages/core/src/teams/developer/orchestrator-content.ts`
**What to change:**
- `visual-explanations-content.ts` — expand `VISUAL_EXPLANATIONS_SKILL_FRAGMENT` to include guidance for Phase summaries: Proposal (scope/decision structure), Spec (requirements relationships), Design (architecture/flows), Task (dependency/execution groups)
- `orchestrator-content.ts` — update `ORCHESTRATOR_SYSTEM_PROMPT` and `ORCHESTRATOR_SKILL_BODY` to require Mermaid in user-facing phase summaries after Proposal/Spec/Design/Task; specify that phase agents should provide Mermaid source or diagram-ready structure
- Phase content files (`proposal-content.ts`, `spec-content.ts`, `design-content.ts`, `task-content.ts`) — add guidance to provide Mermaid in artifacts/return contracts

**Tests:** `visual-explanations-content.ts` tests, `orchestrator-content.test.ts`, content tests for updated phase agents

---

## 5. Tests

### Core Tests

```
packages/core/src/teams/developer/
├── catalog.test.ts                  # Catalog has 12 agents, correct IDs
├── content-registry.test.ts         # getAgentContent returns correct content
├── orchestrator-content.test.ts     # Orchestrator content structure
├── explorer-content.test.ts         # Explorer content structure
├── proposal-content.test.ts         # Proposal content structure
├── spec-content.test.ts            # Spec content structure
├── design-content.test.ts           # Design content structure
├── task-content.test.ts             # Task content structure
├── apply-*-content.test.ts          # Apply agent content structure
├── verify-content.test.ts           # Verify content structure
├── review-content.test.ts           # Review content structure
├── archive-content.test.ts          # Archive content structure
```

### Adapter Tests

```
packages/adapter-pi/
├── developer-team-install.test.ts   # Install plan/build/apply/verify
├── capability-catalog.test.ts       # Capability catalog
├── capability-inventory.test.ts     # Capability inventory
├── capability-plan.test.ts          # Capability planning
├── installation-plan.test.ts        # Installation planning
├── internal-runner-packages.test.ts # Internal runner packages
├── model-config.test.ts             # Model configuration
├── pi-mcp-config.test.ts            # Pi MCP config
├── pi-mcp-runtime-validation.test.ts # Runtime validation
├── install-tools.test.ts            # Install tools
```

### SDD Runtime Tests

```
packages/sdd-runtime/src/
├── scenarios.test.ts               # Integration scenarios
├── contracts/*.test.ts             # Contract tests
├── orchestrator/*.test.ts          # Orchestrator module tests
├── runner/*.test.ts                # Runner module tests
└── artifact-state/*.test.ts       # State manager tests
```

### How to Run

```bash
bun test packages/core/src/teams/developer/      # Core content tests
bun test packages/adapter-pi/                     # Adapter tests
bun test packages/sdd-runtime/                     # Runtime tests
```

---

## Source File Map Summary

| Behavior | Source File |
|---|---|
| SDD phase sequence, dependency graph, apply routing, triage | `orchestrator-content.ts` |
| Explorer methodology, persistence, return contract | `explorer-content.ts` |
| Proposal methodology, persistence, return contract | `proposal-content.ts` |
| Spec methodology, persistence, return contract | `spec-content.ts` |
| Design methodology, persistence, return contract | `design-content.ts` |
| Task methodology, persistence, return contract | `task-content.ts` |
| Apply (General/Backend/Frontend) methodology | `apply-*-content.ts` |
| Verify methodology, persistence, return contract | `verify-content.ts` |
| Review methodology, persistence, return contract | `review-content.ts` |
| Archive methodology, persistence, return contract | `archive-content.ts` |
| Mermaid/visual guidance (Orchestrator only) | `visual-explanations-content.ts` |
| Agent catalog (IDs, names, descriptions) | `catalog.ts` |
| Content registry (getAgentContent, getTeamSessionInstructions) | `content-registry.ts` |
| Artifact state management (CAS, idempotency) | `artifact-state-manager.ts` |
| Orchestrator pipeline (audit → risk → quality → loop) | `orchestrator-pipeline.ts` |
| Runner pipeline (transport → budget → state) | `runner-pipeline.ts` |
| Materialize core → `.pi/` (frontmatter, memory injection) | `developer-team-install.ts` |
| Model/thinking config for Pi agents | `model-config.ts` |

---

## Implementation Guidance

### Primary Change Files

1. **`packages/core/src/teams/developer/orchestrator-content.ts`** — All 7 needs involve the Orchestrator. This is the most important file.
2. **`packages/core/src/teams/developer/visual-explanations-content.ts`** — Need 7 (Mermaid summaries)
3. **`packages/core/src/teams/developer/archive-content.ts`** — Need 2 (post-Archive Git suggestions)
4. **`packages/core/src/teams/developer/proposal-content.ts`** — Need 7 (Mermaid in proposals)
5. **`packages/core/src/teams/developer/spec-content.ts`** — Need 7 (Mermaid in specs)
6. **`packages/core/src/teams/developer/design-content.ts`** — Need 7 (Mermaid in designs)
7. **`packages/core/src/teams/developer/task-content.ts`** — Need 7 (Mermaid in tasks)
8. **`packages/adapter-pi/src/developer-team-install.ts`** — Need 6 (execution config respect)

### Adapter Changes Not Required

All 7 needs from the prior change can be implemented by modifying source content files in `packages/core/`. No changes to `developer-team-install.ts` are strictly required unless Need 6 (execution config respect) needs explicit frontmatter model preservation, which is already handled by the existing `readDeveloperTeamModelAssignments()` function.

### Tests to Update

- `packages/core/src/teams/developer/orchestrator-content.test.ts` — update for new Orchestrator content
- `packages/core/src/teams/developer/visual-explanations-content.ts` — add tests for expanded visual guidance
- Individual phase agent test files for needs 2 and 7 where those agents' content changes

### Build Output

After modifying `packages/core/`, the adapter must be run to regenerate `.pi/`:
```bash
# From the adapter or via the Deck CLI
# The adapter's buildDeveloperTeamInstallPlan() + applyDeveloperTeamInstall()
# produces updated .pi/agents and .pi/skills
```

---

## Open Questions

- Does the Orchestrator pipeline code in `packages/sdd-runtime/` have any hard-coded phase sequence enforcement that would need updating, or is all sequencing defined as guidance text in the Orchestrator prompts?
- For Need 5 (persistence hardening), should the `artifact-state-manager.ts` be extended with additional verification helpers, or is the text-based guidance in content files sufficient?
- For Need 6 (execution config respect), is there a runtime launcher (not the adapter) that overrides agent config? If so, that would need changes outside `packages/core/`.

---

## Ready for Proposal

**Yes.** The architecture is clear:

- All agent content lives in `packages/core/src/teams/developer/`
- The adapter only materializes core content into `.pi/`
- All 7 needs from the prior proposal should be implemented as content updates in the source files
- `orchestrator-content.ts` is the primary file for all 7 needs
- Tests exist for all content files and the adapter

The orchestrator should proceed to the Proposal phase, reusing the valid artifacts from `optimize-sdd-apply-and-commit-suggestions` and applying the source file map established here.