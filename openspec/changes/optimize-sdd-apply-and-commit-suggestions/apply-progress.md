# Apply Progress: Optimize SDD Apply Dispatch and Commit Suggestions

## Completed Tasks

### Task 1: Task skill — Execution-group output contract and Mermaid data
**Status**: ✅ Complete
**Files Changed**
- `.pi/skills/deck-developer-task/SKILL.md` — modify

**Verification**
- Tests: skipped (prompt/guidance change; no test suite applicable)
- Build: skipped (prompt/guidance change; no build check applicable)
- Typecheck: skipped (prompt/guidance change; no typecheck applicable)

**Notes**
- Added `## Apply Execution Groups` section (Step 7) with explicit table and Mermaid flowchart source.
- Execution Group Table includes all required columns: Group ID, Owner, Ordered Tasks, Depends On, Touched Areas/Files, Contracts Produced, Contracts Consumed, Can Parallel With, Fanout Safety, Verification Scope.
- Added Fanout Safety Classification section (blocked/unblocked/allowed-with-placeholder).
- Added Orchestrator Dispatch Guidance section with batching rules, fanout criteria, default dispatch unit, and backend/frontend parallelization constraints.
- Added `Apply Execution Groups` Mermaid source template in output template.
- Updated Required Self-Check to include verification of execution group table, fanout classification, and Mermaid source presence.
- Updated Return Summary format to include Apply Execution Groups section (Groups Defined, Fanout-safe, Blocked, Allowed-with-placeholder counts).
- Added Rules items: execution-group classification requirement, Mermaid non-authoritative disclaimer.
- No contradiction with existing Shared/Backend/Frontend grouping or dependency-graph sections.

### Task 4: Planning-phase skills — Self-verification and Mermaid data
**Status**: ✅ Complete
**Files Changed**
- `.pi/skills/deck-developer-proposal/SKILL.md` — modify
- `.pi/skills/deck-developer-spec/SKILL.md` — modify
- `.pi/skills/deck-developer-design/SKILL.md` — modify

**Verification**
- Tests: skipped (prompt/guidance change; no test suite applicable)
- Build: skipped (prompt/guidance change; no build check applicable)
- Typecheck: skipped (prompt/guidance change; no typecheck applicable)

**Notes**
- **Proposal** (non-deferred): Added Step 5 (Self-Verification Before Return) with checklist for artifact existence, non-empty size, registry state/event presence, previous phase preservation. Added Completion Evidence format block. Added self-verification Rules item. Mermaid source added to output template (scope flow diagram).
- **Spec** (deferred): Added Mermaid source to output template (requirements/acceptance flow). Added Step 9 (Self-Verification Before Return) with artifact existence check and deferred/non-deferred registry distinction. Added Completion Evidence format with `Registry Mode` field distinguishing deferred vs non-deferred. Added self-verification Rules item.
- **Design** (deferred): Added Mermaid source to output template (architecture/lifecycle flow). Added Step 5 (Self-Verification Before Return) with artifact existence check and deferred/non-deferred registry distinction. Added Completion Evidence format with `Registry Mode` field. Added self-verification Rules item.
- All three skills now require artifact self-verification before claiming completion; deferred modes return intent only, never claiming registry writes.
- Mermaid source in all artifacts is explanatory and non-authoritative.

### Task 5: Supporting-phase skills — Self-verification
**Status**: ✅ Complete
**Files Changed**
- `.pi/skills/deck-developer-explorer/SKILL.md` — modify
- `.pi/skills/deck-developer-verify/SKILL.md` — modify
- `.pi/skills/deck-developer-review/SKILL.md` — modify
- `.pi/skills/deck-developer-archive/SKILL.md` — modify

**Verification**
- Tests: skipped (prompt/guidance change; no test suite applicable)
- Build: skipped (prompt/guidance change; no build check applicable)
- Typecheck: skipped (prompt/guidance change; no typecheck applicable)

**Notes**
- **Explorer** (non-deferred): Added Step 5 (Self-Verification Before Return) with checklist for `exploration.md` existence, non-empty size, registry state/event presence, previous phase preservation. Added Completion Evidence format. Added self-verification Rules item.
- **Verify** (deferred): Added Step 9 (Self-Verification Before Return) with artifact existence check and deferred/non-deferred registry distinction. Added Completion Evidence format with `Registry Mode` field. Added self-verification Rules item.
- **Review** (deferred): Added Step 7 (Self-Verification Before Return) with artifact existence check and deferred/non-deferred registry distinction. Added Completion Evidence format with `Registry Mode` field. Added self-verification Rules item.
- **Archive** (non-deferred): Added Step 7 (Self-Verification Before Return) with checklist including `archive-report.md` existence, archive target existence, source cleanup confirmation, registry state/event presence. Added Completion Evidence format. Added Git Suggestions Ownership Clarification section in archive report template. Added self-verification Rules item.
- Completion evidence format is consistent across all four supporting-phase skills.
- Archive clarifies that post-Archive Git suggestions are Orchestrator-owned behavior, not Archive-owned.

### Task 2: Orchestrator skill — Full orchestration update
**Status**: ✅ Complete
**Files Changed**
- `.pi/skills/deck-developer-orchestrator/SKILL.md` — modify

**Verification**
- Tests: skipped (prompt/guidance change; no test suite applicable)
- Build: skipped (prompt/guidance change; no build check applicable)
- Typecheck: skipped (prompt/guidance change; no typecheck applicable)

**Notes**
- Added **Explorer-before-Proposal triage** section (`### Triage Gate — Explorer Routing`) with explicit triggers for codebase/architecture, agent config/prompts, SDD workflow internals, OpenSpec/routing, and broad-impact changes. REQ-TRIAGE-001 and REQ-TRIAGE-002 satisfied.
- Added **Role-Based Delegation Outside SDD** section: clarifies specialized delegation applies outside formal SDD/direct workflows while formal SDD phase sequence remains authoritative. REQ-DELEGATION-001 and REQ-DELEGATION-002 satisfied.
- Added **Agent Execution Configuration** section: states registered agent config is default, overrides require explicit user request or documented workflow rule, provenance required. REQ-CONFIG-001, REQ-CONFIG-002, REQ-CONFIG-003 satisfied.
- Added **Apply Execution Groups** section with batching rules, fanout criteria, default dispatch unit, ordering constraints, and execution group format table. REQ-APPLY-001 through REQ-APPLY-005 satisfied.
- Added **Post-Archive Advisory Git Suggestions** section with advisory-only guidance, no Git mutation rule, ambiguity handling, and PR metadata optionality. REQ-GIT-001 through REQ-GIT-004 satisfied.
- Renamed `Artifact Persistence Policy` section header to `Artifact Persistence Policy` and added `Artifact and Registry Gate Verification` section to clarify REQ-VERIFY-004 strengthening.
- Added **SDD Phase Mermaid Summaries** section with phase agent responsibilities, Orchestrator presentation rules, and authority reconciliation. REQ-MERMAID-001 through REQ-MERMAID-005 satisfied.
- Updated `Visual Output Rules` table: replaced absolute "Avoid Mermaid syntax in user-facing copy" with nuanced rule: SDD phase summaries allow Mermaid; non-SDD summaries avoid it.
- No internal contradictions. All 7 capability areas addressed coherently in one file.

### Task 3: Apply skills — Ordered task group acceptance
**Status**: ✅ Complete
**Files Changed**
- `.pi/skills/deck-developer-apply-general/SKILL.md` — modify
- `.pi/skills/deck-developer-apply-backend/SKILL.md` — modify
- `.pi/skills/deck-developer-apply-frontend/SKILL.md` — modify

**Verification**
- Tests: skipped (prompt/guidance change; no test suite applicable)
- Build: skipped (prompt/guidance change; no build check applicable)
- Typecheck: skipped (prompt/guidance change; no typecheck applicable)

**Notes**
- **General Apply**: Added `Ordered Task Groups and Execution Groups` section. Clarifies it may receive ordered task lists or execution groups. Describes in-order execution, per-task/group progress reporting, group-boundary stop-on-blocker behavior, and non-expansion beyond assigned group. Multi-agent fanout is explicitly an Orchestrator decision. Updated `What You Receive` to mention execution groups. Updated return summary to include execution group, group tasks completed, and group status fields. Updated Rules to include group execution constraints.
- **Backend Apply**: Same as General Apply plus: notes groups are gated by shared/API contracts being explicit. Backend/frontend parallelism requires explicit contracts and is an Orchestrator scheduling decision. Return summary includes `Contract Gate` field. Updated Rules accordingly.
- **Frontend Apply**: Same as General Apply plus: notes groups are gated by shared/API contracts being explicit. Backend/frontend parallelism requires explicit contracts and is an Orchestrator scheduling decision. Return summary includes `Contract Gate` field. Updated Rules accordingly.
- No contradiction with existing single-task assignment behavior. A single task remains a degenerate one-task execution group.

## In-Progress Tasks

(none — all tasks complete)

## Blocked Tasks

(none)

## Remaining Tasks

(none — all 5 tasks complete)

## Execution Group Summary

| Group | Tasks | Status | Files Changed |
|---|---|---|---|
| A — Contracts + Independent phases | 1, 4, 5 | ✅ Complete | Task, Proposal, Spec, Design, Explorer, Verify, Review, Archive skills (8 files) |
| B — Orchestration consumers | 2, 3 | ✅ Complete | Orchestrator, General Apply, Backend Apply, Frontend Apply skills (4 files) |

## Verification Summary

| Check | Status | Reason |
|---|---|---|
| Unit tests | skipped | Prompt/guidance-only changes; no code test suite |
| Build check | skipped | Prompt/guidance-only changes; no build target |
| Typecheck | skipped | Prompt/guidance-only changes; no type system |
| File existence | ✅ pass | All 12 skill files written and confirmed present |
| File non-empty | ✅ pass | All files >0 bytes |

## Notes

- All 5 tasks implemented as specified. No deviations from task requirements.
- All 12 skill files modified across both execution groups.
- No file overlap within Group B; Tasks 2 and 3 touch different skill files.
- Orchestrator skill update addresses all 7 capability areas in one coherent file.
- Apply skills (General/Backend/Frontend) all updated with consistent ordered-group and execution group guidance.
- No registry updates needed for this Apply phase — the change's current phase is `apply`, and the apply-progress artifact is a work-in-progress record. The Orchestrator coordinates final apply-phase registry completion.
- All Apply tasks complete. Change is ready for Verify/Review.
---

## Fixes Pass: Review Findings Addressed (Apply Fixes Phase)

### Finding 1 — BLOCKER: Archive Self-Verification Order (Fixed ✅)

**Problem**: Archive required verifying `archive-report.md` at source path (`openspec/changes/{change-name}/archive-report.md`) after source directory removal — impossible by definition.

**Fix applied to**: `.pi/skills/deck-developer-archive/SKILL.md`

**Changes**:
- Reordered steps: write report to source (Step 4) → move to archive target with all artifacts (Step 7) → verify against archive target (Step 8) → return archive-located paths.
- Step 7 explicitly notes "Order matters: write the archive report (Step 4) before this step."
- Self-verification checklist (Step 8) now checks all paths against `openspec/archive/{change-name}/`, not source path.
- Completion evidence format uses archive-located paths (`openspec/archive/{change-name}/...`).
- Return summary uses archive-located artifact/registry paths.
- Rule added: "Step ordering is fixed: write report → move to archive → update registry → verify archive target → cleanup source. Do not verify source-path artifacts after source removal."
- Note in Step 8 explains the ordering rationale.

**Verification**: Step order is now coherent: write → move → verify → return. No source-path contradiction exists.

### Finding 2 — MAJOR: Parallel Apply Fanout Shared Writes (Fixed ✅)

**Problem**: Parallel Apply agents could concurrently mutate shared `apply-progress.md`, `state.yaml`, and `events.yaml` with no serialization strategy.

**Fix applied to**: `.pi/skills/deck-developer-orchestrator/SKILL.md` + `.pi/skills/deck-developer-apply-general/SKILL.md`

**Changes**:
- Added `### Apply Fanout Safe-Write Strategy` section to Orchestrator with three modes:
  - **Sequential**: run groups one at a time; no contention.
  - **Per-Group Progress**: each agent writes `apply-progress-{group}.md`; Orchestrator merges after all return.
  - **Registry-Deferred**: agents return registry intent only; Orchestrator serializes `state.yaml`/`events.yaml`.
- Added selection guidance, default-to-sequential rule, and Orchestrator obligations when using Per-Group Progress or Registry-Deferred.
- Added rule: "Do not launch parallel Apply agents without a confirmed safe-write mode. If safe-write mode cannot be established, run groups sequentially."
- Added registry-deferred mode support to General Apply skill Step 4.

**Verification**: All three safe-write modes documented. Orchestrator owns serialization responsibility. Parallel fanout is now gated on a confirmed safe-write mode.

### Finding 3 — MAJOR: Deferred Phase Templates Still Require Registry Recorded (Fixed ✅)

**Problem**: Spec, Design, Verify, and Review deferred-mode return templates included `Registry Recorded` as a required field even when `Registry Write: deferred`, inviting false claims of registry writes.

**Fix applied to**: `.pi/skills/deck-developer-spec/SKILL.md`, `.pi/skills/deck-developer-design/SKILL.md`, `.pi/skills/deck-developer-verify/SKILL.md`, `.pi/skills/deck-developer-review/SKILL.md`

**Changes**:
- All four deferred-capable phase skills updated: `Registry Recorded` field now annotated with "(non-deferred mode only; deferred mode returns `Registry Recorded: not written (deferred)`)".
- Non-deferred mode still requires proper `Registry Recorded` with actual phase/status/event.
- `Registry Intent` field remains the positive claim in deferred mode.
- Self-verification checklist (Step 9 in Spec/Verify, Step 5/7 in Design/Review) already distinguishes deferred vs non-deferred; no change needed there.

**Verification**: All four phase skill return templates now handle deferred mode without claiming registry writes.

### Finding 4 — MINOR: Task Skill Mermaid Syntax Invalid (Fixed ✅)

**Problem**: Task skill used `subgraph G{A["Group Label"]` — invalid Mermaid syntax that may not render.

**Fix applied to**: `.pi/skills/deck-developer-task/SKILL.md`

**Changes**:
- Both occurrences (lines 136, 249) replaced with valid syntax: `subgraph G["Group Label"]`.
- Remaining subgraph content (T1, T2 nodes, edges, and G2 placeholders) unchanged and now syntactically valid.

**Verification**: All subgraph declarations use `subgraph G["Group Label"]` form. Mermaid validation: ✅

### Finding 5 — MINOR: Execution Config Override Provenance (Fixed ✅)

**Problem**: Orchestrator allowed overrides for "documented workflow rule" without requiring rule ID, exact fields, reason, or scope.

**Fix applied to**: `.pi/skills/deck-developer-orchestrator/SKILL.md`

**Changes**:
- Override provenance rules expanded: require **Source** (user request or rule ID/path), **Fields overridden** (exact field names), **Reason** (why registered config insufficient), **Scope** (which agents/phases/change).
- Added example provenance block showing all four fields.
- Added rule: "Overrides that expand tool permissions require explicit authorization and are reported in provenance."
- Existing "Undocumented overrides are not used" rule preserved.

**Verification**: Override provenance now requires all four fields. Example block shows the required format.

## Fixes Pass Files Changed

| Finding | File | Change |
|---|---|---|
| BLOCKER: Archive self-verification order | `.pi/skills/deck-developer-archive/SKILL.md` | Reordered 10 steps; write-report-before-move; verify-archive-target; return-archive-paths |
| MAJOR: Apply fanout shared writes | `.pi/skills/deck-developer-orchestrator/SKILL.md` | Added `Apply Fanout Safe-Write Strategy` section with 3 modes, selection guidance, Orchestrator obligations |
| MAJOR: Apply fanout shared writes | `.pi/skills/deck-developer-apply-general/SKILL.md` | Added registry-deferred mode support in Step 4 |
| MAJOR: Deferred registry recorded | `.pi/skills/deck-developer-spec/SKILL.md` | `Registry Recorded` annotated as non-deferred-only |
| MAJOR: Deferred registry recorded | `.pi/skills/deck-developer-design/SKILL.md` | `Registry Recorded` annotated as non-deferred-only |
| MAJOR: Deferred registry recorded | `.pi/skills/deck-developer-verify/SKILL.md` | `Registry Recorded` annotated as non-deferred-only |
| MAJOR: Deferred registry recorded | `.pi/skills/deck-developer-review/SKILL.md` | `Registry Recorded` annotated as non-deferred-only |
| MINOR: Task Mermaid syntax | `.pi/skills/deck-developer-task/SKILL.md` | Fixed `subgraph G{A["..."]` → `subgraph G["..."]` (2 occurrences) |
| MINOR: Override provenance | `.pi/skills/deck-developer-orchestrator/SKILL.md` | Expanded override provenance to require Source/Fields/Reason/Scope + example |

**Total files changed**: 8 files across 6 skills.

## Fixes Pass Verification

| Check | Status | Reason |
|---|---|---|
| Unit tests | skipped | Prompt/guidance-only changes; no test suite applicable |
| Build check | skipped | Prompt/guidance-only changes; no build target |
| Typecheck | skipped | Prompt/guidance-only changes; no type system |
| Archive step ordering | ✅ pass | Steps 4→7→8 order: write→move→verify; no source-path contradiction |
| Archive completion paths | ✅ pass | All evidence/return paths reference `openspec/archive/{change-name}/...` |
| Apply fanout safe-write modes | ✅ pass | Three modes defined; Sequential is default; Orchestrator owns merge |
| Apply registry-deferred mode | ✅ pass | General Apply supports deferred mode; Orchestrator serializes |
| Deferred registry recorded | ✅ pass | All 4 phase skills: "non-deferred mode only; deferred mode returns `not written (deferred)`" |
| Task Mermaid syntax | ✅ pass | All `subgraph G[...]` declarations valid; no `subgraph G{` remains |
| Override provenance | ✅ pass | Source/Fields/Reason/Scope required; example provided |
| File existence | ✅ pass | All 8 changed files confirmed present on disk |
| File non-empty | ✅ pass | All files >0 bytes |

## Registry Updates

- **state.yaml**: No phase change — this is an Apply fixes sub-phase. Current phase remains `review` (status: `changes_requested`). No new phase artifact written.
- **events.yaml**: No new event — fixes pass does not advance phase. New `apply.fixes.completed` event recorded in `apply-fixes-output.md` artifact.
- **apply-fixes-output.md**: This document serves as the fixes-pass artifact, listing all findings addressed, files changed, and verification evidence.

## Blockers Remaining

**None** — all 5 Review findings (1 BLOCKER, 2 MAJOR, 2 MINOR) have been addressed.

## Notes

- Changes are limited to skill prompt/guidance files only. No product code, test files, or build configuration modified.
- Registry state (`review` phase, `changes_requested` status) preserved; no phase advancement implied by this fixes pass.
- Changes are additive: existing correct behavior is preserved; identified gaps are filled.
- Orchestrator fanout-safe-write strategy defaults to Sequential as the safest option; Per-Group Progress and Registry-Deferred are available when conditions are clearly met.
