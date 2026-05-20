# Tasks: Optimize SDD v2 Core Implementation

## Review Workload Forecast

- **Estimated changed lines**: ~600–800 (content text + tests)
- **Estimated changed files**: 14 (7 content files + 5 test files + 2 new test assertions)
- **Chained PRs recommended**: No — all changes are in the same package, same domain, and tightly coupled. Single PR with per-need commits is appropriate.
- **400-line budget risk**: Low-Medium — content additions are text-heavy but bounded. Exception approved.

## Execution Groups

### Group A: Orchestrator Core Guidance (Needs 3, 4, 6)

Independent, small, isolated sections in orchestrator-content.ts.

### Group B: Apply Batching (Need 1)

Independent, medium — modifies Apply Routing in both SYSTEM_PROMPT and SKILL_BODY.

### Group C: Persistence Hardening (Need 5)

Largest surface — orchestrator guidance + self-verification steps in all phase content files.

### Group D: Post-Archive Git Suggestions (Need 2)

Medium — touches orchestrator + archive.

### Group E: Mermaid Phase Summaries (Need 7)

Requires visual-explanations reconciliation first, then multi-file phase template changes.

---

## Tasks

### Task 1: Expand Explorer Triage Triggers (Need 3)

**Owner**: General Apply
**Depends on**: None
**Files**:
- `packages/core/src/teams/developer/orchestrator-content.ts`
- `packages/core/src/teams/developer/orchestrator-content.test.ts`

**Description**:

In `ORCHESTRATOR_SYSTEM_PROMPT` "SDD Triage Gate" section, expand the "Recommend SDD" bullet to include: codebase structure, agent configuration, prompts, SDD workflow internals, OpenSpec/routing behavior, and broad project impact.

Expand the "Specialist only" bullet to include: evaluating agent configuration, assessing workflow internals.

In `ORCHESTRATOR_SKILL_BODY` "Triage Gate" section, make the same expansions.

**Verification**:
- `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` passes
- New test assertions:
  - `ORCHESTRATOR_SYSTEM_PROMPT` contains "agent configuration"
  - `ORCHESTRATOR_SYSTEM_PROMPT` contains "workflow internals"
  - `ORCHESTRATOR_SYSTEM_PROMPT` contains "OpenSpec"
  - `ORCHESTRATOR_SKILL_BODY` contains the same triggers

---

### Task 2: Add SDD vs Role-Based Delegation Clarification (Need 4)

**Owner**: General Apply
**Depends on**: None
**Files**:
- `packages/core/src/teams/developer/orchestrator-content.ts`
- `packages/core/src/teams/developer/orchestrator-content.test.ts`

**Description**:

In `ORCHESTRATOR_SYSTEM_PROMPT`, add a subsection "### SDD vs. Role-Based Delegation" after "### Cost and Context Balance" in the Delegation Rules section.

Content:
- SDD is the formal pipeline — do not skip phases because of delegation rules during SDD.
- Role-based delegation applies outside SDD when delegation rules trigger.
- SDD delegation rules (4-file, multi-file write, PR, incident, long-session) remain active during SDD — they are orthogonal.

In `ORCHESTRATOR_SKILL_BODY`, add equivalent clarification in the "Sub-Agent Context Protocol" section.

**Verification**:
- `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` passes
- New test assertions:
  - `ORCHESTRATOR_SYSTEM_PROMPT` contains "SDD vs. Role-Based Delegation"
  - `ORCHESTRATOR_SYSTEM_PROMPT` contains "formal pipeline"
  - `ORCHESTRATOR_SKILL_BODY` contains "SDD is the formal pipeline" or equivalent

---

### Task 3: Add Agent Execution Configuration Guidance (Need 6)

**Owner**: General Apply
**Depends on**: None
**Files**:
- `packages/core/src/teams/developer/orchestrator-content.ts`
- `packages/core/src/teams/developer/orchestrator-content.test.ts`

**Description**:

In `ORCHESTRATOR_SKILL_BODY`, add a new subsection "### Agent Execution Configuration" under "SDD Workflow" (after "Verify and Review" or before "Artifact Persistence Policy").

Content:
- Use registered configuration by default (model, context, thinking, tools).
- Do not override unless user explicitly requests OR documented workflow rule requires.
- When override is used, identify the basis in delegation context/summary.
- Adapter preserves registered config via `readDeveloperTeamModelAssignments()`.

**Verification**:
- `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` passes
- New test assertions:
  - `ORCHESTRATOR_SKILL_BODY` contains "Agent Execution Configuration"
  - `ORCHESTRATOR_SKILL_BODY` contains "registered configuration"
  - `ORCHESTRATOR_SKILL_BODY` contains "readDeveloperTeamModelAssignments"

---

### Task 4: Add Apply Batching Guidance (Need 1)

**Owner**: General Apply
**Depends on**: None
**Files**:
- `packages/core/src/teams/developer/orchestrator-content.ts`
- `packages/core/src/teams/developer/orchestrator-content.test.ts`

**Description**:

In `ORCHESTRATOR_SYSTEM_PROMPT` "Apply Routing" section, add a subsection "### Apply Batching" after the blocker classification guidance and before "When Tasks recommends an owner".

Content (numbered rules):
1. Group related tasks by owner, context, dependency chain, file area, component, or service.
2. Assign an ordered task list to one agent when tasks are related.
3. Do NOT default to one agent per task for related work.
4. Launch multiple Apply agents only when: independent, non-overlapping, no ordering dependency, low conflict risk, independently verifiable.
5. Respect dependency ordering: shared/contracts before backend/frontend.
6. Use Task artifact execution groups as primary source for batching decisions.

In `ORCHESTRATOR_SKILL_BODY` "Apply Routing" section, add equivalent batching guidance.

**Verification**:
- `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` passes
- New test assertions:
  - `ORCHESTRATOR_SYSTEM_PROMPT` contains "Apply Batching"
  - `ORCHESTRATOR_SYSTEM_PROMPT` contains "Group related tasks"
  - `ORCHESTRATOR_SYSTEM_PROMPT` contains "ordered task list"
  - `ORCHESTRATOR_SKILL_BODY` contains "Apply Batching"

---

### Task 5: Add Persistence Hardening to Orchestrator (Need 5 — Part 1)

**Owner**: General Apply
**Depends on**: None
**Files**:
- `packages/core/src/teams/developer/orchestrator-content.ts`
- `packages/core/src/teams/developer/orchestrator-content.test.ts`

**Description**:

In `ORCHESTRATOR_SKILL_BODY` "Artifact Persistence Policy" section, add two new subsections after the existing "The Spec Registry is the phase gate" content:

**"### Self-Verification Before Phase Completion"**:
- Phase agent must verify artifact exists on disk (file exists + byte count > 0)
- Non-deferred: verify registry state/event
- Deferred: verify artifact, return intent, don't claim writes
- Include completion evidence: path, exists, bytes, status, registry intent, blockers
- If verification fails, do NOT claim completion

**"### Orchestrator Verification Before Phase Advancement"**:
- Verify official artifact path exists
- Verify state.yaml records expected phase/status/artifact
- Verify events.yaml records corresponding event
- Verify state.yaml preserves prior artifacts/provenance
- Verify events.yaml preserves prior events
- If any check fails, do NOT advance

**Verification**:
- `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` passes
- New test assertions:
  - `ORCHESTRATOR_SKILL_BODY` contains "Self-Verification Before Phase Completion"
  - `ORCHESTRATOR_SKILL_BODY` contains "Orchestrator Verification Before Phase Advancement"
  - `ORCHESTRATOR_SKILL_BODY` contains "completion evidence"

---

### Task 6: Add Self-Verification Steps to Phase Content Files (Need 5 — Part 2)

**Owner**: General Apply
**Depends on**: Task 5
**Files**:
- `packages/core/src/teams/developer/proposal-content.ts`
- `packages/core/src/teams/developer/proposal-content.test.ts`
- `packages/core/src/teams/developer/spec-content.ts`
- `packages/core/src/teams/developer/spec-content.test.ts`
- `packages/core/src/teams/developer/design-content.ts`
- `packages/core/src/teams/developer/design-content.test.ts`
- `packages/core/src/teams/developer/task-content.ts`
- `packages/core/src/teams/developer/task-content.test.ts`
- `packages/core/src/teams/developer/archive-content.ts`
- `packages/core/src/teams/developer/archive-content.test.ts`
- `packages/core/src/teams/developer/apply-general-content.ts` (+ test)
- `packages/core/src/teams/developer/verify-content.ts` (+ test)
- `packages/core/src/teams/developer/review-content.ts` (+ test)

**Description**:

In each phase content file's SKILL_BODY, add a self-verification step before the final "Return Summary" step:

```
### Step N: Self-Verify Artifact

Before returning completion:
1. Verify the required artifact file exists at the expected path.
2. Verify the artifact has content (byte count > 0).
3. Verify registry state/event persistence (or return registry intent if in deferred mode).
4. Include completion evidence in the return contract: artifact path, \`exists=true\`, byte count, phase status, registry status, any blocker.
5. If verification fails, do NOT claim completion. Report the failure as a blocker.
```

Adjust step numbers to maintain sequential ordering.

For each phase test file, add assertion:
- `SKILL_BODY` contains "Self-Verify Artifact"

**Verification**:
- `bun test packages/core/src/teams/developer/` — all tests pass

---

### Task 7: Add Post-Archive Git Suggestions (Need 2)

**Owner**: General Apply
**Depends on**: None
**Files**:
- `packages/core/src/teams/developer/orchestrator-content.ts`
- `packages/core/src/teams/developer/orchestrator-content.test.ts`
- `packages/core/src/teams/developer/archive-content.ts`
- `packages/core/src/teams/developer/archive-content.test.ts`

**Description**:

**orchestrator-content.ts:**

Add new section `## Post-Archive Git Suggestions` in both `ORCHESTRATOR_SYSTEM_PROMPT` (after "Recovery Rule") and `ORCHESTRATOR_SKILL_BODY` (after "Recovery Rule"):
- Suggest conventional commit message(s) based on change scope/diff
- Optionally suggest PR title/body
- Label as advisory when ambiguous; present multiple candidates
- NEVER auto-commit, push, branch change, or create PR

**archive-content.ts:**

In `ARCHIVE_SKILL_BODY`, add a new step between current Step 7 (Write Report) and Step 8 (Persist Artifact):
- "### Step 7.5: Prepare Diff Context for Post-Archive Git Suggestions"
- Collect change scope, affected capabilities, modified files
- Summarize implied conventional commit type
- Note ambiguities
- Include in Return Summary under "Git Suggestion Context"

Renumber subsequent steps.

**Verification**:
- `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` passes
- `bun test packages/core/src/teams/developer/archive-content.test.ts` passes
- New test assertions:
  - Orchestrator contains "Post-Archive Git Suggestions"
  - Orchestrator contains "NEVER" in git context
  - Archive SKILL_BODY contains "Prepare Diff Context"
  - Archive SKILL_BODY contains "Git Suggestion Context"

---

### Task 8: Reconcile Mermaid Guidance in Visual Explanations (Need 7 — Part 1)

**Owner**: General Apply
**Depends on**: None
**Files**:
- `packages/core/src/teams/developer/visual-explanations-content.ts`
- `packages/core/src/teams/developer/content-registry.test.ts` (if visual explanations tests live here)

**Description**:

**visual-explanations-content.ts:**

1. In `VISUAL_EXPLANATIONS_SKILL_FRAGMENT` "Visual Output Rules" table, change the Mermaid rule:
   - FROM: `| Avoid Mermaid syntax in user-facing copy | Users should not need to read or configure diagram syntax (REQ-VISUAL-004) |`
   - TO: `| Avoid Mermaid syntax in non-SDD conversational copy. SDD phase summaries REQUIRE concise Mermaid diagrams as an explicit exception. | SDD summaries benefit from structural diagrams; other copy stays prose-first |`

2. In `VISUAL_EXPLANATIONS_FORBIDDEN_PHRASES`, REMOVE `"```mermaid"` and `"mermaid diagram"` from the array.

3. In `VISUAL_EXPLANATIONS_REQUIRED_SNIPPETS`, ADD `"SDD phase summaries"`.

4. Update the file-level docblock comment to note the Mermaid exception for SDD summaries.

**Verification**:
- `bun test packages/core/src/teams/developer/content-registry.test.ts` passes
- `VISUAL_EXPLANATIONS_FORBIDDEN_PHRASES` no longer contains `` ```mermaid ``
- `VISUAL_EXPLANATIONS_REQUIRED_SNIPPETS` contains "SDD phase summaries"

---

### Task 9: Add Mermaid Phase Summary Guidance to Orchestrator (Need 7 — Part 2)

**Owner**: General Apply
**Depends on**: Task 8
**Files**:
- `packages/core/src/teams/developer/orchestrator-content.ts`
- `packages/core/src/teams/developer/orchestrator-content.test.ts`

**Description**:

In `ORCHESTRATOR_SKILL_BODY`, add new section `## Phase Summary Diagrams` (after "Artifact Persistence Policy" or before "Project AI Notes"):

- After each planning phase (Proposal, Spec, Design, Task), include concise Mermaid in summary
- Proposal → dependency/impact diagram
- Spec → requirements capability map
- Design → architecture/component diagram
- Task → task dependency/grouping diagram
- Diagrams are explanatory, non-authoritative
- Runner-agnostic: standard Mermaid, readable as fenced source
- One diagram per phase, focused on structure/relationships
- Phase agents SHOULD provide Mermaid source/data in artifacts

**Verification**:
- `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` passes
- New test assertions:
  - `ORCHESTRATOR_SKILL_BODY` contains "Phase Summary Diagrams"
  - `ORCHESTRATOR_SKILL_BODY` contains "explanatory and non-authoritative"
  - `ORCHESTRATOR_SKILL_BODY` contains "runner-agnostic"

---

### Task 10: Add Mermaid Source Guidance to Phase Output Templates (Need 7 — Part 3)

**Owner**: General Apply
**Depends on**: Task 9
**Files**:
- `packages/core/src/teams/developer/proposal-content.ts`
- `packages/core/src/teams/developer/proposal-content.test.ts`
- `packages/core/src/teams/developer/spec-content.ts`
- `packages/core/src/teams/developer/spec-content.test.ts`
- `packages/core/src/teams/developer/design-content.ts`
- `packages/core/src/teams/developer/design-content.test.ts`
- `packages/core/src/teams/developer/task-content.ts`
- `packages/core/src/teams/developer/task-content.test.ts`

**Description**:

In each of the 4 phase SKILL_BODY output templates (proposal, spec, design, task):

1. Add a `## Mermaid Summary Source` section in the output template:
   ```
   ## Mermaid Summary Source

   \`\`\`mermaid
   {concise diagram summarizing this phase output — e.g., capability map, architecture, task dependency graph}
   \`\`\`
   ```

2. In the Return Contract, add:
   ```
   **Mermaid Source**: {fenced Mermaid diagram summarizing this phase, or "N/A — no structural relationships to diagram"}
   ```

3. In the "Critical rules" or equivalent section, add:
   - "Include a concise Mermaid diagram in the artifact when the phase output has structural relationships that benefit from visualization."

For each test file, add assertions:
- `SKILL_BODY` contains "Mermaid Summary Source"
- `SKILL_BODY` contains "Mermaid Source" in the return contract

**Verification**:
- `bun test packages/core/src/teams/developer/` — all tests pass

---

## Open Questions / Blockers

- **None** — all open questions from spec/proposal resolved in design.

## Summary

| Task | Need | Files | Est. Lines | Dependencies |
|---|---|---|---|---|
| 1 | 3 (Triage) | 2 | ~40 | None |
| 2 | 4 (Delegation) | 2 | ~30 | None |
| 3 | 6 (Config) | 2 | ~25 | None |
| 4 | 1 (Apply Batching) | 2 | ~50 | None |
| 5 | 5 (Persistence — Orchestrator) | 2 | ~50 | None |
| 6 | 5 (Persistence — Phase files) | 14 | ~120 | Task 5 |
| 7 | 2 (Git Suggestions) | 4 | ~70 | None |
| 8 | 7 (Mermaid Reconcile) | 1-2 | ~20 | None |
| 9 | 7 (Mermaid Orchestrator) | 2 | ~40 | Task 8 |
| 10 | 7 (Mermaid Phase Templates) | 8 | ~60 | Task 9 |
| **Total** | | | **~505** | |
