# Apply Fixes Output: Review Findings Addressed

**Change**: optimize-sdd-apply-and-commit-suggestions
**Agent**: General Apply
**Date**: 2026-05-20
**Registry State Path**: `openspec/changes/optimize-sdd-apply-and-commit-suggestions/state.yaml`
**Registry Events Path**: `openspec/changes/optimize-sdd-apply-and-commit-suggestions/events.yaml`
**Registry Recorded**: apply-fixes phase recorded in state.yaml; `apply.fixes.completed` event appended to events.yaml
**Artifact Path**: `openspec/changes/optimize-sdd-apply-and-commit-suggestions/apply-fixes-output.md`

---

## Summary

All 5 Review findings (1 BLOCKER, 2 MAJOR, 2 MINOR) have been addressed. 8 files modified across 6 skills. No phase advancement — change remains in `review` phase pending re-Verify/Re-Review cycle.

---

## Findings Addressed

### Finding 1 — BLOCKER: Archive Self-Verification Order Is Impossible

**Severity**: BLOCKER
**Status**: ✅ Fixed

**Problem**: Archive required verifying `archive-report.md` at source path after source directory removal — impossible by definition. Step 8 wrote the report after Step 7 verification, and completion evidence referenced source paths after cleanup.

**File Changed**: `.pi/skills/deck-developer-archive/SKILL.md`

**Fix Applied**:
- Reordered 10 steps so write-report (Step 4, source location) → move-to-archive (Step 7) → verify-archive-target (Step 8) → return-archive-paths (Step 10)
- Step 7 notes "Order matters: write the archive report (Step 4) before this step"
- Self-verification checklist (Step 8) checks all paths against `openspec/archive/{change-name}/`, not source
- Completion evidence format and return summary use archive-located paths
- Rules section: "Step ordering is fixed: write report → move to archive → update registry → verify archive target → cleanup source. Do not verify source-path artifacts after source removal."
- Step 8 note explains ordering rationale

**Verification**: Step order is now internally consistent: write→move→verify→return. No source-path contradiction exists. Archive can self-verify successfully.

---

### Finding 2 — MAJOR: Parallel Apply Fanout Shared Writes

**Severity**: MAJOR
**Status**: ✅ Fixed

**Problem**: Parallel Apply agents could concurrently mutate shared `apply-progress.md`, `state.yaml`, and `events.yaml` with no serialization strategy, causing lost updates or registry corruption.

**Files Changed**: `.pi/skills/deck-developer-orchestrator/SKILL.md`, `.pi/skills/deck-developer-apply-general/SKILL.md`

**Fix Applied**:
- Added `### Apply Fanout Safe-Write Strategy` section to Orchestrator with three documented modes:
  - **Sequential** (default): run groups one at a time; no file contention
  - **Per-Group Progress**: each agent writes `apply-progress-{group}.md`; Orchestrator merges after all return
  - **Registry-Deferred**: agents return registry intent only; Orchestrator serializes `state.yaml`/`events.yaml`
- Added selection guidance with default-to-Sequential rule
- Orchestrator obligations when using Per-Group Progress or Registry-Deferred are explicitly documented
- Rule: "Do not launch parallel Apply agents without a confirmed safe-write mode. If safe-write mode cannot be established, run groups sequentially."
- General Apply skill Step 4: added registry-deferred mode support

**Verification**: All three safe-write modes defined. Parallel fanout is now gated on a confirmed mode. Orchestrator owns merge responsibility.

---

### Finding 3 — MAJOR: Deferred Phase Templates Require Registry Recorded

**Severity**: MAJOR
**Status**: ✅ Fixed

**Problem**: Spec, Design, Verify, and Review deferred-mode return templates included `Registry Recorded` as a required field even when `Registry Write: deferred`, inviting false claims of completed registry writes.

**Files Changed**: `.pi/skills/deck-developer-spec/SKILL.md`, `.pi/skills/deck-developer-design/SKILL.md`, `.pi/skills/deck-developer-verify/SKILL.md`, `.pi/skills/deck-developer-review/SKILL.md`

**Fix Applied**: All four deferred-capable phase skills: `Registry Recorded` field annotated with "(non-deferred mode only; deferred mode returns `Registry Recorded: not written (deferred)`)"

**Verification**: All four phase skill return templates now handle deferred mode correctly. Non-deferred mode still requires `Registry Recorded` with actual phase/status/event. `Registry Intent` is the positive claim in deferred mode.

---

### Finding 4 — MINOR: Task Skill Mermaid Syntax Invalid

**Severity**: MINOR
**Status**: ✅ Fixed

**Problem**: Task skill used `subgraph G{A["Group Label"]` — invalid Mermaid syntax that may not render in diagram viewers.

**File Changed**: `.pi/skills/deck-developer-task/SKILL.md`

**Fix Applied**: Both occurrences (lines 136 and 249) replaced with valid syntax: `subgraph G["Group Label"]`

**Verification**: All subgraph declarations use valid `subgraph G["Group Label"]` form. No `subgraph G{` patterns remain.

---

### Finding 5 — MINOR: Execution Config Override Provenance Too Broad

**Severity**: MINOR
**Status**: ✅ Fixed

**Problem**: Overrides were allowed for "documented workflow rule" without requiring rule ID, exact fields overridden, reason, or scope.

**File Changed**: `.pi/skills/deck-developer-orchestrator/SKILL.md`

**Fix Applied**:
- Override provenance rules expanded to require: **Source** (user request or rule ID/path), **Fields overridden** (exact field names), **Reason** (why registered config insufficient), **Scope** (which agents/phases/change)
- Added example provenance block with all four fields
- Added rule: "Overrides that expand tool permissions require explicit authorization and are reported in provenance"
- Preserved existing "Undocumented overrides are not used" rule

**Verification**: Override provenance now requires all four fields. Example block shows required format.

---

## Files Changed Summary

| Finding | File | Change Type |
|---|---|---|
| BLOCKER | `.pi/skills/deck-developer-archive/SKILL.md` | Reordered 10 steps; write-report-before-move; verify-archive-target; return-archive-paths |
| MAJOR | `.pi/skills/deck-developer-orchestrator/SKILL.md` | Added `Apply Fanout Safe-Write Strategy` section (3 modes, selection guidance, Orchestrator obligations, gate rule); tightened override provenance (Source/Fields/Reason/Scope + example) |
| MAJOR | `.pi/skills/deck-developer-apply-general/SKILL.md` | Added registry-deferred mode support in Step 4 |
| MAJOR | `.pi/skills/deck-developer-spec/SKILL.md` | `Registry Recorded` annotated as non-deferred-only |
| MAJOR | `.pi/skills/deck-developer-design/SKILL.md` | `Registry Recorded` annotated as non-deferred-only |
| MAJOR | `.pi/skills/deck-developer-verify/SKILL.md` | `Registry Recorded` annotated as non-deferred-only |
| MAJOR | `.pi/skills/deck-developer-review/SKILL.md` | `Registry Recorded` annotated as non-deferred-only |
| MINOR | `.pi/skills/deck-developer-task/SKILL.md` | Fixed `subgraph G{A["..."]` → `subgraph G["..."]` (2 occurrences) |
| MINOR | `.pi/skills/deck-developer-orchestrator/SKILL.md` | (combined with MAJOR fix above) |

**Total**: 8 files across 6 skills.

---

## Verification Evidence

| Check | Status | Evidence |
|---|---|---|
| Unit tests | skipped | Prompt/guidance-only changes; no code test suite applicable |
| Build check | skipped | Prompt/guidance-only changes; no build target applicable |
| Typecheck | skipped | Prompt/guidance-only changes; no type system applicable |
| Archive step ordering | ✅ pass | Steps 4→7→8 order verified; write→move→verify→return with no source-path contradiction |
| Archive completion paths | ✅ pass | All evidence/return paths reference `openspec/archive/{change-name}/...` |
| Apply fanout safe-write modes | ✅ pass | Three modes documented; Sequential is default; Orchestrator owns merge |
| Apply registry-deferred mode | ✅ pass | General Apply supports deferred mode; Orchestrator serializes |
| Deferred registry recorded | ✅ pass | All 4 phase skills: "(non-deferred mode only; deferred mode returns `Registry Recorded: not written (deferred)`)" |
| Task Mermaid syntax | ✅ pass | All `subgraph G[...]` valid; no `subgraph G{` remains |
| Override provenance | ✅ pass | Source/Fields/Reason/Scope required; example block provided |
| state.yaml valid | ✅ pass | Parses cleanly; apply_fixes phase recorded; 9 artifacts tracked |
| events.yaml valid | ✅ pass | Parses cleanly; 14 events preserved + `apply.fixes.completed` appended |
| Apply-progress updated | ✅ pass | Fixes pass section appended to `apply-progress.md` |
| Output artifact exists | ✅ pass | `apply-fixes-output.md` written and verified |

---

## Registry Updates

**state.yaml**: Added `apply_fixes` phase entry with status `completed`, artifact reference, provenance, findings addressed summary, and verification data. Added `apply_fixes_output` to artifacts map. `current_phase` remains `review` (no phase advancement).

**events.yaml**: Appended `apply.fixes.completed` event with type, phase, subtype, artifact, actor, note, findings_fixed counts, files_changed list, and verification data.

**Registry Blocker**: None.

---

## Blockers Remaining

**None** — all 5 Review findings (1 BLOCKER, 2 MAJOR, 2 MINOR) have been resolved.

---

## Next Step

Ready for re-Verify and re-Review cycle. Change is positioned for re-verification of all 5 fixes before Archive.