# Apply Progress: Strengthen SDD Triage Gate (INV-004) — Second Fix Pass

## Completed Tasks

### Task 1 (First Pass): Fix ORCHESTRATOR_AGENT_BODY triage gate (MAJOR review finding)
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-content.ts` — modify (1 line)

**Verification**
- Tests: `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` — ✅ 51 pass, 0 fail
- Tests: `bun test packages/core/src/teams/developer/` — ✅ 510 pass, 0 fail

**Notes**
REVIEW MAJOR: `ORCHESTRATOR_AGENT_BODY` was not updated with strengthened triage gate wording, violating REQ-TRIAGE-005 consistency across surfaces.
Fixed by updating the triage bullet in `ORCHESTRATOR_AGENT_BODY` from:
  "Run SDD triage before asking for execution mode or launching phases."
To:
  "Run SDD triage before asking for execution mode, launching phases, or taking/delegating any step that may modify code, configuration, prompts, OpenSpec artifacts, or project files. Do not modify or delegate modifying work until this classification is made."

### Task 2 (First Pass): Add INV-004 strengthened assertions to orchestrator-invariants.test.ts (MINOR review finding)
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-invariants.test.ts` — modify

**Verification**
- Tests: `bun test packages/core/src/teams/developer/orchestrator-invariants.test.ts` — ✅ 68 pass, 0 fail (incl. new assertions)

**Notes**
REVIEW MINOR: Add/update assertions for strengthened INV_004 condition/requiredAction to catch future divergence.
Added 3 new assertions:
1. `condition should reference modification/delegation of any step that may modify`
2. `condition should enumerate protected artifact types` ("code, configuration, prompts, OpenSpec artifacts, or project files")
3. `requiredAction should prohibit modification before classification` ("Do not modify or delegate modifying work until this classification is made")

### Task 3 (First Pass): Update INV_004 in orchestrator-invariants.ts to match strengthened content.ts
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-invariants.ts` — modify

**Verification**
- Tests: `bun test packages/core/src/teams/developer/orchestrator-invariants.test.ts packages/core/src/teams/developer/orchestrator-invariants.task2.test.ts` — ✅ 68 pass, 0 fail

**Notes**
The INV_004 record was also updated to match the strengthened wording from content.ts:
- `condition`: expanded to include "taking/delegating any step that may modify code, configuration, prompts, OpenSpec artifacts, or project files"
- `requiredAction`: added "Do not modify or delegate modifying work until this classification is made"
- `rationale`: extended to mention "bypassing triage and modifying files directly undermines workflow safety"
- `violationConsequence`: extended to include "The orchestrator may modify or delegate work without proper classification"

### Task 4 (Second Pass): Update ORCHESTRATOR_SYSTEM_PROMPT triage gate (BLOCKER review finding)
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-content.ts` — modify SDD Triage Gate section (lines 146-158)

**Verification**
- Tests: `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` — ✅ 56 pass, 0 fail
- Tests: `bun test packages/core/src/teams/developer/` — ✅ 515 pass, 0 fail

**Notes**
BLOCKER: `ORCHESTRATOR_SYSTEM_PROMPT` still contained old triage wording ("Before asking for Execution Mode or launching SDD phases, classify the user request"). Updated SDD Triage Gate to strengthened INV-004 wording:
  Before asking for execution mode, launching SDD phases, or taking/delegating any step that may modify code, configuration, prompts, OpenSpec artifacts, or project files, classify the current user request as **Direct**, **Specialist only**, **Recommend SDD**, or **Run SDD**. Do not ask Automatic vs Interactive unless triage says Run SDD. Do not modify or delegate modifying work until this classification is made.

### Task 5 (Second Pass): Update ORCHESTRATOR_PROMPT_GUIDA triage gate (BLOCKER review finding)
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-content.ts` — modify SDD Triage Gate section (lines 432-452)

**Verification**
- Tests: `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` — ✅ 56 pass, 0 fail

**Notes**
BLOCKER: `ORCHESTRATOR_PROMPT_GUIDA` SDD Triage Gate had identical old wording. Updated to strengthened INV-004 wording matching SKILL.md and ORCHESTRATOR_SYSTEM_PROMPT.

### Task 6 (Second Pass): Update ORCHESTRATOR_SKILL_BODY triage gate (BLOCKER/MAJOR review finding)
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-content.ts` — modify Triage Gate section (lines 696-706)

**Verification**
- Tests: `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` — ✅ 56 pass, 0 fail

**Notes**
BLOCKER/MAJOR: `ORCHESTRATOR_SKILL_BODY` was out of alignment with `.opencode/skills/deck-developer-orchestrator/SKILL.md`. Updated Triage Gate to match strengthened SKILL.md wording. SKILL.md is the source of truth; ORCHESTRATOR_SKILL_BODY now aligns with it.

### Task 7 (Second Pass): Add INV-004 strengthened assertions to orchestrator-content.test.ts (MAJOR review finding)
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-content.test.ts` — modify

**Verification**
- Tests: `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` — ✅ 56 pass, 0 fail

**Notes**
MAJOR: Task 4 required assertions proving strengthened wording exists on all content surfaces. Added focused assertions (key clauses, not full paragraphs) for:
1. `ORCHESTRATOR_SYSTEM_PROMPT`: "taking/delegating any step that may modify code, configuration, prompts, OpenSpec artifacts, or project files" + "Do not modify or delegate modifying work until this classification is made" + "Do not ask Automatic vs Interactive unless triage says Run SDD"
2. `ORCHESTRATOR_AGENT_BODY`: same clauses (already had strengthened wording from first pass)
3. `ORCHESTRATOR_PROMPT_GUIDA`: same clauses + all four categories
4. `ORCHESTRATOR_SKILL_BODY`: same clauses

Also updated existing test to use strengthened phrasing "Do not ask Automatic vs Interactive unless triage says Run SDD" (matching SKILL.md) instead of old "Do not ask for Automatic vs Interactive until this triage says **Run SDD**".

## In-Progress Tasks
None — all tasks complete.

## Blocked Tasks
None.

## Verification Results

### Tests Run
| Test File | Result |
|---|---|
| `packages/core/src/teams/developer/orchestrator-content.test.ts` | ✅ 56 pass, 0 fail |
| `packages/core/src/teams/developer/orchestrator-invariants.test.ts` | ✅ 68 pass, 0 fail |
| `packages/core/src/teams/developer/orchestrator-invariants.task2.test.ts` | (included above) |
| `packages/adapter-opencode/src/developer-team-install.test.ts` | ✅ 45 pass, 0 fail |
| `packages/adapter-pi/src/developer-team-install.test.ts` | ⚠️ 56 pass, 8 fail (pre-existing baseline failures) |
| `packages/core/src/teams/developer/` (full suite) | ✅ 515 pass, 0 fail |

### Adapter PI Install Test Failure Analysis
**Finding**: 8 failures in `packages/adapter-pi/src/developer-team-install.test.ts` are **pre-existing baseline failures** — unrelated to this change.

**Evidence**:
- Same 8 failures observed in clean git state (no changes from this fix pass applied)
- Failures are in idempotency tests: "re-applying unchanged files is idempotent", "second apply produces changedCount === 0", "file status is 'unchanged' when content matches", "detects updated files when content differs"
- Root cause: idempotency logic issue in adapter-pi's install logic (file content comparison not working as expected)
- Not triggered by or related to triage gate wording changes (these tests verify file-write idempotency, not prompt content)

**Conclusion**: Adapter PI test failures are baseline/out-of-scope — not caused by this change. No test updates warranted.

### Typecheck
**Result**: ⚠️ Pre-existing baseline errors (not caused by this change)

`bunx tsc --noEmit` fails with 12+ errors in `apps/cli/src/tui/app.tsx` and related files — type incompatibilities involving `string | null` vs `string`, `readonly` array assignments, etc. These errors existed before this change and are unrelated to orchestrator content or invariants.

**Evidence**: Errors are in TUI app components (not in `packages/core` or the changed files).

**Conclusion**: Typecheck failures are baseline — not caused by this change. Not fixed as per instruction to not fix unrelated baseline errors.

## Summary
Second fix pass complete:
1. ✅ ORCHESTRATOR_SYSTEM_PROMPT updated with strengthened triage gate (BLOCKER)
2. ✅ ORCHESTRATOR_PROMPT_GUIDA updated with strengthened triage gate (BLOCKER)
3. ✅ ORCHESTRATOR_SKILL_BODY updated and aligned with SKILL.md (BLOCKER/MAJOR)
4. ✅ orchestrator-content.test.ts strengthened assertions for all 4 surfaces (MAJOR)
5. ✅ All 515 developer team tests pass
6. ⚠️ Adapter PI install test failures: pre-existing baseline, not caused by this change
7. ⚠️ Typecheck failures: pre-existing baseline, not caused by this change

## Registry Updates

- `state.yaml`: phase=apply, agent=general, status=completed, artifact=apply-progress.md (updated)
- `events.yaml`: phase=apply event appended with second fix-pass note

## Deviations
None — all review findings addressed as specified.
