# Design: Optimize SDD v2 Core Implementation

## Source

- Proposal: `optimize-sdd-v2-core-implementation` proposal artifact
- Spec: `optimize-sdd-v2-core-implementation/spec.md` — 27 REQs across 7 capabilities
- Exploration: `optimize-sdd-v2-core-implementation/exploration.md`

## Architecture Overview

All 7 needs are **content updates** in `packages/core/src/teams/developer/` source files. The three-layer architecture is:

```
Source (packages/core/) → Adapter (packages/adapter-pi/) → Output (.pi/)
```

No adapter or runtime code changes required. The adapter is a passthrough that adds YAML frontmatter and writes files.

## Current Content Analysis

### orchestrator-content.ts (410 lines, 3 surfaces)

| Surface | Purpose | Lines |
|---|---|---|
| `ORCHESTRATOR_SYSTEM_PROMPT` | Session startup prompt — identity, rules, workflow | 1–207 |
| `ORCHESTRATOR_AGENT_BODY` | Agent file body — thin identity + delegation triggers | 213–248 |
| `ORCHESTRATOR_SKILL_BODY` | Skill file body — detailed SDD methodology | 254–410 |

**Key sections for this change:**
- `ORCHESTRATOR_SYSTEM_PROMPT` → "Apply Routing" (lines 140–155), "SDD Triage Gate" (lines 98–111), "Delegation Rules" (lines 52–81), "Artifact Store" (lines 122–138), "Sub-Agent Context Protocol" (lines 179–191)
- `ORCHESTRATOR_SKILL_BODY` → "Apply Routing" (lines 300–308), "Artifact Persistence Policy" (lines 318–348), "SDD Workflow > Triage Gate" (lines 260–269), "Sub-Agent Context Protocol" (lines 382–394)

### visual-explanations-content.ts (109 lines)

- `VISUAL_EXPLANATIONS_SKILL_FRAGMENT` — appended to Orchestrator skill body
- **Critical conflict**: Line 52 says `"Avoid Mermaid syntax in user-facing copy"` and line 100 has `"```mermaid"` in `VISUAL_EXPLANATIONS_FORBIDDEN_PHRASES`
- Need 7 requires reconciling this: Mermaid IS allowed in SDD phase summaries but remains discouraged elsewhere

### archive-content.ts (284 lines)

- `ARCHIVE_SKILL_BODY` has 9 steps (Read → Traceability → Merge → Move → Follow-ups → AI Notes → Write Report → Persist → Return)
- Need 2 adds a diff-context preparation between Step 7 (Write Report) and Step 9 (Return Summary)

### Phase content files (proposal, spec, design, task)

All follow the same structure: Agent Body + Skill Body with Steps → Output Template → Return Contract → Rules.
- Need 5 adds self-verification steps before Return Summary in each
- Need 7 adds Mermaid source/diagram-ready data guidance in output templates

## Change Specification

### Need 1: Apply Batching (REQ-APPLY-001 through REQ-APPLY-005)

**Target files:**
- `orchestrator-content.ts` — ORCHESTRATOR_SYSTEM_PROMPT "Apply Routing" section + ORCHESTRATOR_SKILL_BODY "Apply Routing" section

**Current behavior:** Apply Routing section lists owner types (General/Backend/Frontend) and says "Backend and frontend may run in parallel only when contracts and dependencies are clear."

**Change:** Replace the simple owner-routing guidance with structured batching guidance:

In **ORCHESTRATOR_SYSTEM_PROMPT** "Apply Routing" section (after line 147, before "When Tasks recommends an owner"):

Add a batching subsection:
```
### Apply Batching

Before dispatching Apply agents:
1. **Group related tasks** by owner, context, dependency chain, file area, component, or service into coherent batches.
2. **Assign an ordered task list** to one appropriately specialized Apply agent when tasks are related.
3. **Do NOT default to one agent per task** when tasks share a coherent owner or context.
4. **Launch multiple Apply agents only when** work areas are independent, non-overlapping, have no ordering dependency, have low conflict risk, and can be verified independently.
5. **Respect dependency ordering**: shared/contracts work runs before dependent backend/frontend work.
6. **Use Task artifact execution groups** as the primary source for batching decisions when available.
```

In **ORCHESTRATOR_SKILL_BODY** "Apply Routing" section, expand the existing bullet list with equivalent batching rules.

### Need 2: Post-Archive Git Suggestions (REQ-GIT-001 through REQ-GIT-004)

**Target files:**
- `orchestrator-content.ts` — ORCHESTRATOR_SYSTEM_PROMPT (new section after "Recovery Rule") + ORCHESTRATOR_SKILL_BODY (new section after "Recovery Rule")
- `archive-content.ts` — ARCHIVE_SKILL_BODY Step 7 (add diff-context prep)

**Change — orchestrator-content.ts:**

Add a new section `"## Post-Archive Git Suggestions"` in both SYSTEM_PROMPT and SKILL_BODY:

```
## Post-Archive Git Suggestions

After Archive completes, present advisory Git metadata:

1. **Suggest conventional commit message(s)** based on the completed change scope and diff context.
2. **Optionally suggest PR title/body** when sufficient context exists.
3. **Label suggestions as advisory** when conventional commit type or scope is ambiguous; present multiple candidates.
4. **NEVER** automatically commit, push, change branches, create PRs, or otherwise mutate Git state.

The Archive Agent prepares diff context for this step. The Orchestrator presents suggestions to the user after the Archive summary.
```

**Change — archive-content.ts:**

In ARCHIVE_SKILL_BODY, add a new step between Step 7 (Write Report) and Step 8 (Persist Artifact):

```
### Step 7.5: Prepare Diff Context for Post-Archive Git Suggestions

Gather change diff context for the Orchestrator's post-Archive Git suggestion step:
- Collect the change scope: affected capabilities, modified files, added/changed/removed behavior.
- Summarize the conventional commit type implied by the change (feat, fix, refactor, etc.).
- Note ambiguities when multiple types or scopes apply.
- Include this context in the Return Summary under a "Git Suggestion Context" section.
```

### Need 3: Explorer Triage Expansion (REQ-TRIAGE-001, REQ-TRIAGE-002)

**Target files:**
- `orchestrator-content.ts` — ORCHESTRATOR_SYSTEM_PROMPT "SDD Triage Gate" section + ORCHESTRATOR_SKILL_BODY "Triage Gate" section

**Current behavior:** Triage says "ambiguous scope, product requirements, architecture decisions, likely multi-file impact, testing strategy, migration risk, or cross-cutting behavior" for Recommend SDD.

**Change:** Expand the "Recommend SDD" and "Specialist only" triage triggers to explicitly cover:

```
- **Recommend SDD** when: ambiguous scope, product requirements, architecture decisions, multi-file impact, testing strategy, migration risk, cross-cutting behavior, OR changes involving codebase structure, agent configuration, prompts, SDD workflow internals, OpenSpec/routing behavior, or broad project impact.
```

Also expand "Specialist only" to include:
```
- **Specialist only**: bounded artifact or analysis task, such as writing a PRD/proposal, reviewing a prompt, exploring a focused area, evaluating agent configuration, or assessing workflow internals.
```

### Need 4: Role-Based Delegation Clarification (REQ-DELEGATION-001, REQ-DELEGATION-002)

**Target files:**
- `orchestrator-content.ts` — ORCHESTRATOR_SYSTEM_PROMPT "Delegation Rules" section + "Sub-Agent Context Protocol" section

**Change:** Add a clarification subsection after the "Cost and Context Balance" subsection:

```
### SDD vs. Role-Based Delegation

- **SDD is the formal pipeline**: when the user is running an SDD workflow (explicitly requested or accepted recommendation), the full phase sequence (proposal → spec/design → tasks → apply → verify/review → archive) is authoritative. Do not skip phases because of delegation rules.
- **Role-based delegation applies outside SDD**: when delegation rules trigger for non-SDD requests (quick fixes, focused analyses, bounded tasks), delegate to the appropriate specialist role according to registered delegation rules.
- **SDD delegation rules remain active during SDD**: the 4-file rule, multi-file write rule, PR rule, incident rule, and long-session rule apply during SDD phases to prevent context inflation. These are orthogonal to role-based delegation.
```

### Need 5: Persistence Hardening (REQ-VERIFY-001 through REQ-VERIFY-005)

**Target files:**
- `orchestrator-content.ts` — ORCHESTRATOR_SKILL_BODY "Artifact Persistence Policy" section
- `packages/sdd-runtime/src/artifact-state/artifact-state-manager.ts` — evaluate for code changes

**Design decision: Text guidance suffices.** The `artifact-state-manager.ts` provides pipeline utilities but does not hard-code phase behavior. Verification is a guidance concern: phase agents are instructed to self-verify before claiming completion, and the Orchestrator verifies before advancing. No code changes to sdd-runtime needed.

**Change — orchestrator-content.ts:**

In ORCHESTRATOR_SKILL_BODY "Artifact Persistence Policy", add after the "The Spec Registry is the phase gate" paragraph:

```
### Self-Verification Before Phase Completion

Before a phase agent claims completion, it MUST:
1. Verify the required artifact file exists on disk (file exists check + byte count > 0).
2. In non-deferred registry mode: verify required registry state/event persistence is recorded.
3. In registry-deferred mode: verify the artifact exists and return registry intent (do not claim registry writes).
4. Include completion evidence in the return contract: artifact path, exists=true, byte count, phase status, registry intent or recorded event type, and any blocker.
5. If verification fails, do NOT claim completion. Report the failure and block.

### Orchestrator Verification Before Phase Advancement

Before advancing to a dependent phase, the Orchestrator MUST:
1. Verify the official artifact path exists on disk.
2. Verify state.yaml records the expected phase/status/artifact.
3. Verify events.yaml records a corresponding event.
4. Verify state.yaml preserves all prior artifacts/provenance.
5. Verify events.yaml preserves all prior events.
6. If any check fails, do NOT advance. Repair or request repair from the phase agent.
```

**Change — all phase content files** (proposal, spec, design, task, archive, apply-general, apply-backend, apply-frontend, verify, review):

In each SKILL_BODY, add a self-verification step before the final "Return Summary" step:

```
### Step N-1: Self-Verify Artifact

Before returning completion:
1. Verify the required artifact file exists at the expected path.
2. Verify the artifact has content (byte count > 0).
3. Verify registry state/event persistence (or return registry intent if deferred).
4. Include completion evidence: artifact path, exists, byte count, phase status, registry status, blockers.
```

### Need 6: Execution Config Respect (REQ-CONFIG-001 through REQ-CONFIG-003)

**Target files:**
- `orchestrator-content.ts` — ORCHESTRATOR_SKILL_BODY (new subsection in "SDD Workflow")

**Change:** Add a new subsection under "SDD Workflow" in the SKILL_BODY:

```
### Agent Execution Configuration

- **Use registered configuration by default**: model, context window, thinking level, tools, and similar settings configured for each agent MUST be respected when launching sub-agents.
- **Do not override** registered execution configuration unless:
  1. The user explicitly requests an override, OR
  2. A documented workflow rule requires a specific override (e.g., parallel phase batching may standardize context).
- **When an override is used**, identify the basis in the delegation context or summary (e.g., "model override: user requested opus for review").
- The adapter preserves registered model/thinking via `readDeveloperTeamModelAssignments()`. Orchestrator guidance must not contradict registered config.
```

### Need 7: Mermaid Phase Summaries (REQ-MERMAID-001 through REQ-MERMAID-005)

**Target files:**
- `visual-explanations-content.ts` — VISUAL_EXPLANATIONS_SKILL_FRAGMENT + VISUAL_EXPLANATIONS_FORBIDDEN_PHRASES
- `orchestrator-content.ts` — ORCHESTRATOR_SKILL_BODY (new section)
- `proposal-content.ts`, `spec-content.ts`, `design-content.ts`, `task-content.ts` — SKILL_BODY output templates

**Design decision: Reconcile Mermaid guidance.** The current rule "Avoid Mermaid syntax in user-facing copy" (REQ-VISUAL-004) is narrowed to: "Avoid Mermaid syntax in non-SDD conversational copy." SDD phase summaries are an explicit exception that REQUIRE Mermaid diagrams.

**Change — visual-explanations-content.ts:**

1. In `VISUAL_EXPLANATIONS_SKILL_FRAGMENT` "Visual Output Rules" table, change:
   - FROM: `"Avoid Mermaid syntax in user-facing copy"` → rationale: `"Users should not need to read or configure diagram syntax (REQ-VISUAL-004)"`
   - TO: `"Avoid Mermaid syntax in non-SDD conversational copy. SDD phase summaries are an explicit exception that REQUIRE concise Mermaid diagrams."` → rationale: `"SDD summaries benefit from structural diagrams; other copy stays prose-first"`

2. In `VISUAL_EXPLANATIONS_FORBIDDEN_PHRASES`, REMOVE `"```mermaid"` and `"mermaid diagram"` from the forbidden list. The SDD phase summaries MUST use fenced Mermaid blocks.

3. In `VISUAL_EXPLANATIONS_REQUIRED_SNIPPETS`, add: `"SDD phase summaries"` (to ensure the exception is present).

**Change — orchestrator-content.ts:**

Add new section in ORCHESTRATOR_SKILL_BODY:

```
## Phase Summary Diagrams

After each planning phase (Proposal, Spec, Design, Task), include a concise Mermaid diagram in the user-facing summary:

1. **Proposal summary**: dependency/impact diagram showing affected capabilities.
2. **Spec summary**: requirements capability map.
3. **Design summary**: architecture/component diagram.
4. **Task summary**: task dependency/grouping diagram.

Rules:
- Diagrams are **explanatory and non-authoritative**. OpenSpec artifacts and registry entries are authoritative.
- Diagrams MUST be **runner-agnostic**: use standard Mermaid syntax that renders in supported runners and remains readable as fenced source when not rendered.
- Keep diagrams **concise** — one diagram per phase, focused on structure/relationships.
- Phase agents SHOULD provide Mermaid source or diagram-ready data in their artifacts when the phase output has structural relationships that benefit from visualization.
```

**Change — phase content files** (proposal, spec, design, task):

In each SKILL_BODY output template, add a section:

```
### Mermaid Summary Source

Include a concise Mermaid diagram in the artifact that summarizes the phase output structure. This diagram will be used by the Orchestrator for the user-facing phase summary.
```

And in the Return Contract, add:

```
**Mermaid Source**: {fenced Mermaid diagram summarizing this phase, or "N/A — no structural relationships to diagram"}
```

## Test Strategy

### orchestrator-content.test.ts

Add test cases for each new section:

```typescript
// Need 1: Apply Batching
test("contains apply batching guidance", () => {
  expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Apply Batching");
  expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Group related tasks");
  expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("one agent per task"); // anti-pattern removed
});

// Need 2: Post-Archive Git Suggestions
test("contains post-Archive Git suggestion guidance", () => {
  expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Post-Archive Git Suggestions");
  expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("NEVER");
  expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("advisory");
});

// Need 3: Expanded Triage
test("SDD triage covers workflow and agent config triggers", () => {
  expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("agent configuration");
  expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("workflow internals");
  expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("OpenSpec");
});

// Need 4: Role-Based Delegation
test("contains SDD vs role-based delegation clarification", () => {
  expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("SDD vs. Role-Based Delegation");
  expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("formal pipeline");
});

// Need 5: Self-Verification
test("orchestrator skill contains self-verification guidance", () => {
  expect(ORCHESTRATOR_SKILL_BODY).toContain("Self-Verification");
  expect(ORCHESTRATOR_SKILL_BODY).toContain("Orchestrator Verification Before Phase Advancement");
});

// Need 6: Execution Config
test("contains agent execution configuration guidance", () => {
  expect(ORCHESTRATOR_SKILL_BODY).toContain("Agent Execution Configuration");
  expect(ORCHESTRATOR_SKILL_BODY).toContain("registered configuration");
});

// Need 7: Mermaid Phase Summaries
test("contains phase summary diagram guidance", () => {
  expect(ORCHESTRATOR_SKILL_BODY).toContain("Phase Summary Diagrams");
  expect(ORCHESTRATOR_SKILL_BODY).toContain("explanatory and non-authoritative");
});
```

### visual-explanations-content.test.ts (new file or content-registry.test.ts)

Update assertions:
- Remove assertion that forbids `` ```mermaid ``
- Add assertion that requires "SDD phase summaries" exception text
- Add assertion that Mermaid is required in SDD summaries context

### Phase content tests (proposal, spec, design, task)

Add assertions:
- Contains self-verification step
- Contains Mermaid summary source section in output template
- Return contract includes Mermaid source field

### archive-content.test.ts

Add assertions:
- Contains diff context preparation step
- Return contract includes Git suggestion context

## Dependency Ordering

```
Need 5 (Persistence Hardening — orchestrator) 
  → Need 5 (Persistence Hardening — phase files)
  
Need 7 (Mermaid — visual-explanations reconciliation)
  → Need 7 (Mermaid — orchestrator guidance)
  → Need 7 (Mermaid — phase output templates)

Needs 1, 2, 3, 4, 6 are independent of each other and can be implemented in any order.
```

**Recommended implementation order:**
1. Need 3 (Explorer Triage Expansion) — smallest, isolated in triage sections
2. Need 4 (Role-Based Delegation) — small, isolated in delegation section
3. Need 6 (Execution Config Respect) — small, new subsection
4. Need 1 (Apply Batching) — medium, modifies Apply Routing sections
5. Need 5 (Persistence Hardening — orchestrator first, then phase files) — largest surface area
6. Need 2 (Post-Archive Git Suggestions) — medium, touches orchestrator + archive
7. Need 7 (Mermaid Phase Summaries) — requires visual-explanations reconciliation first, then multi-file changes

## Open Questions Resolved

| Question | Resolution |
|---|---|
| Does `artifact-state-manager.ts` need code changes? | **No.** Text guidance suffices. Verification is a behavior instruction for phase agents, not a code-level enforcement. |
| Should "avoid Mermaid" guidance be narrowed or replaced? | **Narrowed** to non-SDD conversational copy. SDD phase summaries are an explicit exception. |
| Mermaid in both agent artifacts and Orchestrator summaries? | **Agents SHOULD provide** Mermaid source/data. **Orchestrator MUST include** a diagram in summaries. Agents provide source; Orchestrator presents. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Visual explanations Mermaid reconciliation breaks existing tests | High | Update VISUAL_EXPLANATIONS_FORBIDDEN_PHRASES and VISUAL_EXPLANATIONS_REQUIRED_SNIPPETS atomically with the content change |
| Self-verification steps bloat phase content files | Medium | Keep verification step concise (5 lines); reference orchestrator policy for details |
| Apply batching guidance is too vague for agents to follow | Medium | Include explicit criteria checklist in the batching section |
| Content changes are too large for single review | Medium | Implement per-need with tests; each need is a reviewable unit |

## Rollback Plan

Revert changes in `packages/core/src/teams/developer/` content files to prior versions. Re-run adapter to regenerate `.pi/` output. No Git state, configuration files, or database records are modified.
