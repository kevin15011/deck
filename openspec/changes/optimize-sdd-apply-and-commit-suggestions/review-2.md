# Re-Review Report: Optimize SDD Apply Dispatch and Commit Suggestions

## Summary

**Overall Rating**: REQUEST CHANGES
**Scope**: general / integration
**Files Reviewed**: 21 (12 skill files + 9 OpenSpec/registry artifacts)
**Re-Review Trigger**: Re-assess 5 original findings after Apply-fixes pass; check for new contradictions, regressions, overreach.

## Executive Finding

**CRITICAL**: None of the 5 original Apply task implementations or 5 Review fixes are present in the actual skill files on disk. The apply-progress.md and apply-fixes-output.md artifacts describe changes that were never persisted to the target `.pi/skills/` files. All 12 skill files remain in their original pre-Apply state. The Re-Verify phase (verify-2.md) independently confirms this finding and has already marked all tasks as FAIL.

Because no implementation exists on disk, the 5 original findings cannot be assessed for resolution — the base changes they referenced were never applied, and the fixes themselves were also never applied. This is a foundational integrity issue, not a quality gap.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ❌ Weak | No implementation exists to evaluate. Design artifact remains sound but unimplemented. |
| Security | ⚠️ Adequate | Advisory Git suggestion design is safe; config override provenance design is sound. Neither exists on disk. |
| Scalability | ⚠️ Adequate | Apply batching design is well-conceived; safe-write strategy design addresses real concurrency risks. Neither exists on disk. |
| Maintainability | ❌ Weak | Artifact-registry integrity is broken: state.yaml records completions with byte counts that do not match actual files. |
| Code Quality | ❌ Weak | No implementation to evaluate. Artifact documentation quality is high, but documentation without implementation is misleading. |
| Backend | N/A | Prompt/guidance-only change. |
| Frontend | N/A | Prompt/guidance-only change. |
| Integration | ❌ Weak | Cross-phase handoff integrity is broken. Apply → Verify → Review all reported success on phantom work. |

## Re-Assessment of 5 Original Findings

### Finding 1 — BLOCKER: Archive Self-Verification Order Is Impossible
**Resolution**: ❌ NOT ASSESSED — neither the original change nor the fix exists on disk.

**Evidence**:
- Archive skill (9,825 bytes vs. state.yaml claim of 12,077 bytes) retains original step order:
  - Step 4: "Move to Archive and Update Registry" (move comes before write)
  - Step 7: "Write the Archive Report" (write comes after move)
  - Step 8: "Persist Artifact"
- No "Order matters", "Step ordering is fixed", "Self-Verification Before Return", or "Completion Evidence" sections exist.
- Completion evidence and return summary paths still reference `openspec/changes/{change-name}/` — no archive-located path references.

**Verdict**: The underlying issue (verify-after-delete impossibility) remains present in the unmodified skill file. Cannot confirm fix.

### Finding 2 — MAJOR: Parallel Apply Fanout Shared Writes
**Resolution**: ❌ NOT ASSESSED — neither the original change nor the fix exists on disk.

**Evidence**:
- Orchestrator skill (14,550 bytes vs. state.yaml claim of 22,045 bytes) contains:
  - Zero references to "Apply Fanout Safe-Write Strategy"
  - Zero references to "Apply Execution Groups", "Sequential" mode, "Per-Group Progress", or fanout-safe serialization
  - No rule stating "Do not launch parallel Apply agents without a confirmed safe-write mode"
- Apply-General skill (7,883 bytes vs. state.yaml claim of 9,875 bytes) has no registry-deferred mode support.

**Verdict**: Parallel fanout shared-write hazard remains unaddressed. No safe-write strategy exists anywhere on disk.

### Finding 3 — MAJOR: Deferred Phase Templates Still Require Registry Recorded
**Resolution**: ❌ NOT ASSESSED — neither the original change nor the fix exists on disk.

**Evidence**: All four deferred-capable phase skills (Spec, Design, Verify, Review) still have bare `Registry Recorded` template fields without "(non-deferred mode only)" annotation or "not written (deferred)" fallback text:
- Spec skill line 256: `**Registry Recorded**: phase \`spec\`, status \`{completed|blocked}\`, event \`{event name}\``
- Design skill line 208: `**Registry Recorded**: phase \`design\`...`
- Verify skill line 179: `**Registry Recorded**: phase \`verify\`...`
- Review skill line 201: `**Registry Recorded**: phase \`review\`...`

None include the deferred-mode distinction.

**Verdict**: False-positive registry-write claims remain possible in deferred mode.

### Finding 4 — MINOR: Task Skill Mermaid Subgraph Syntax Invalid
**Resolution**: ❌ NOT ASSESSED — neither the original change nor the fix exists on disk.

**Evidence**: Task skill (14,477 bytes vs. state.yaml claim of 20,711 bytes) contains no execution-group Mermaid templates at all. The `subgraph G{A["..."]` syntax described in the original finding was never introduced (because Task 1 was never applied), so there is nothing to fix or assess.

**Verdict**: The invalid syntax is not present, but only because the entire execution-group feature was never implemented.

### Finding 5 — MINOR: Override Provenance Requires Source/Fields/Reason/Scope
**Resolution**: ❌ NOT ASSESSED — neither the original change nor the fix exists on disk.

**Evidence**: Orchestrator skill contains no override provenance section, no Source/Fields/Reason/Scope requirement, no example provenance block, and no rule about tool-permission expansion requiring explicit authorization.

**Verdict**: Config override provenance remains unspecified.

## New Findings

### BLOCKER

- **Architecture / Integrity / Implementation**: All 5 task implementations and all 5 Review fixes are missing from disk. The apply-progress.md and apply-fixes-output.md artifacts describe detailed changes to 12 skill files, but those files remain in their original pre-Apply state.
  - **File**: All 12 `.pi/skills/deck-developer-*/SKILL.md` files
  - **Evidence**: File sizes are 15–34% smaller than state.yaml records; grep for claimed sections returns zero results; `git status` shows no changes to `.pi/skills/`; `git log` shows no commits touching any skill files. The verify-2.md artifact independently confirms all 0/5 tasks present on disk.
  - **Recommendation**: Return to Apply phase. All 5 tasks must be implemented from scratch. The registry (state.yaml, events.yaml) should be repaired to reflect that Apply and Apply-fixes phases did not produce durable changes. Consider adding a disk-persistence verification gate after Apply completes — the current REQ-VERIFY-001 requires artifact existence checks but the apply-progress artifact existed while the actual skill-file changes did not.

- **Maintainability / Registry Integrity**: state.yaml records byte counts, file lists, and task completions that do not match actual files on disk.
  - **File**: `openspec/changes/optimize-sdd-apply-and-commit-suggestions/state.yaml`
  - **Evidence**: state.yaml claims `.pi/skills/deck-developer-orchestrator/SKILL.md` has byte_count 22,045; actual is 14,550. Same mismatch for all 12 skill files. The `apply_fixes` phase status is `completed` but no fixes exist.
  - **Recommendation**: Before re-running Apply, repair state.yaml to mark the apply and apply_fixes phases as `failed` or `not_persisted`, or reset them to allow re-application. Events.yaml should be similarly corrected.

### MAJOR

- **Architecture / Process**: The Verify phase (verify.md) produced a false-positive PASS report, confirming all 26 REQ checks passed and all 5 tasks complete despite the implementations being absent from disk.
  - **File**: `openspec/changes/optimize-sdd-apply-and-commit-suggestions/verify.md`
  - **Evidence**: verify.md reports "Static file/content verification: 12 pass, 0 fail, 0 skip" and all compliance matrix rows as ✅ PASS. But the actual skill files contain none of the claimed content. The verify agent apparently inspected apply-progress.md text descriptions rather than verifying the actual skill file contents.
  - **Recommendation**: Verify phase should be required to grep/read the actual target files for claimed sections/patterns, not just the apply-progress artifact. This is the exact problem REQ-VERIFY-001 was designed to prevent, but the requirement targets the agent's own artifact rather than the implementation files.

### MINOR

- **Architecture / Process**: The original Review phase (review.md) correctly identified 5 real findings in the apply-progress descriptions, but could not have known those descriptions described changes that were never persisted.
  - **File**: `openspec/changes/optimize-sdd-apply-and-commit-suggestions/review.md`
  - **Evidence**: The review findings were accurate relative to the described changes. The blocker finding about Archive step ordering was correct for the described implementation. But the described implementation didn't exist.
  - **Recommendation**: Review agents should verify at least one sampled target file for claimed changes before rating. This is an aspirational improvement, not a current requirement.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Not assessable — no implementation exists on disk.
- **Deviations**: The Design artifact is well-structured and comprehensive. It accurately identifies 12 skill files to modify, correctly scopes changes to prompt/guidance only, and properly addresses all 7 capability areas. The design remains valid; it simply has not been implemented.

## Observations on Artifact Quality

Despite the critical implementation gap, the OpenSpec planning artifacts are high quality:

- **Spec**: Thorough requirements with 26 REQ-IDs, clear validation rules, error contracts, state transitions, and compliance matrix. Well-structured acceptance scenarios.
- **Design**: Sound architecture with clear component boundaries, data flow, API/contract implications, and tradeoffs. Correctly identifies distributed skill-file updates as the approach.
- **Tasks**: Well-decomposed into 5 atomic tasks with clear dependency graph, execution groups, and parallelization plan. Task 2 flagging for potential splitting was appropriate.
- **First Review (review.md)**: Accurately identified 5 substantive findings. Correctly rated as REQUEST CHANGES.
- **Apply-fixes-output.md**: Detailed and well-structured description of fixes — the content is technically correct; it simply was never persisted to target files.

The problem is not in planning or analysis quality, but in the persistence bridge between agent workspace and durable filesystem.

## Open Questions

- Was the implementation ever written to disk during Apply sessions, or did agents report completion without persisting? This has implications for workspace isolation and sub-agent write semantics.
- Should the SDD workflow add a post-Apply content verification step that reads actual target files and compares against claimed changes?
- Should verify agents be required to sample actual implementation files rather than relying solely on apply-progress descriptions?

## Completion Evidence

- **Artifact Path**: `openspec/changes/optimize-sdd-apply-and-commit-suggestions/review-2.md`
- **Artifact Exists**: true
- **Artifact Byte Count**: (to be determined after write)
- **Registry Mode**: deferred
- **Registry Intent**: artifact `review-2.md`, phase `review`, status `changes_requested`, event `review.rerequested`
- **Phase Status**: changes_requested
- **Registry Blocker**: none; registry write intentionally deferred
