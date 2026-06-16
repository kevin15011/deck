# Apply Progress: Exploration lifecycle states

## Completed Tasks

### Task 1: Add failing registry lifecycle schema tests first
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/spec-registry/validator.test.ts` — modify (added 10 lifecycle tests)

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
- Added tests for exploration_context (sdd, delegated), lifecycle_status values, warning-level unknown values, missing next_action, and canonical phase/status errors remaining strict.

### Task 2: Implement shared lifecycle constants and warning rule types
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/spec-registry/schema.ts` — modify (added lifecycle constants and rule codes)

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
- Added VALID_EXPLORATION_CONTEXTS, VALID_LIFECYCLE_STATUSES, ExplorationContext, LifecycleStatus types.
- Added lifecycle warning rule codes to ValidationRuleCode type.

### Task 3: Implement warning-only lifecycle validation when fields or lifecycle events are present
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/spec-registry/validator.ts` — modify (added lifecycle validation)

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
- Validates exploration_context and lifecycle_status only when present.
- Emits warnings for unknown values, missing context/status, missing next_action, missing reason/reference.
- Canonical phase/status errors remain strict errors.

### Task 4: Document optional lifecycle registry shape and events
**Status**: ✅ Complete
**Files Changed**
- `openspec/registry-schema.md` — modify (added lifecycle documentation)

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
- Documented optional fields: exploration_context, lifecycle_status, next_action, lifecycle_reason, lifecycle_ref.
- Documented warning-level semantics and anti-bureaucracy constraints.
- Added lifecycle validation rule codes to schema reference.

### Task 5: Add failing Explorer content tests for diagnostic outcome reporting
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/explorer-content.test.ts` — modify (added 4 lifecycle tests)

**Verification**
- Tests: pass (all 36 explorer tests pass)
- Build: pass
- Typecheck: pass

**Notes**
- Added tests for actionable diagnosis guidance, diagnostic outcome in return format, Orchestrator decides lifecycle.

### Task 6: Update Explorer content with diagnostic outcome guidance
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/explorer-content.ts` — modify (added Step 5 and output sections)

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
- Added Step 5: Assess Actionable Diagnosis guidance.
- Added Actionable Diagnosis and Suggested Lifecycle Outcome sections in return format.
- Explorer reports evidence and recommendation; Orchestrator decides lifecycle.

### Task 7: Add failing Orchestrator content tests for SDD and delegated lifecycle branches
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-content.test.ts` — modify (added 12 lifecycle branch tests)

**Verification**
- Tests: pass (all 99 orchestrator tests pass)
- Build: pass
- Typecheck: pass

**Notes**
- Added tests for SDD vs delegated Explorer distinction, lifecycle applies/does not apply scenarios.

### Task 8: Update Orchestrator content for minimal lifecycle handling
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-content.ts` — modify (added Exploration Lifecycle section in 2 places)

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
- Added Exploration Lifecycle (Optional) section with when applies/does NOT apply, lifecycle fields, interactive options, anti-bureaucracy rule.
- Added in both system prompt and skill body sections.

### Task 9: Add invariant tests for anti-bureaucracy and canonical phase preservation
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-content.test.ts` — modify (added 7 anti-bureaucracy tests)

**Verification**
- Tests: pass (all 166 tests pass)
- Build: pass
- Typecheck: pass

**Notes**
- Added tests verifying no new SDD phase, no Apply gate, no historical migration, lifecycle is optional.

### Task 10: Confirm no frontend implementation is required
**Status**: ✅ Complete (NO-OP)
**Files Changed**
- None — no frontend files modified

**Verification**
- Manual inspection: confirmed no UI/TUI surface in spec, design, or tasks
- apps/ directory: unchanged
- Design explicitly states: "Accessibility: no UI changes"
- Task 10 was defined as "documentation-only verification"

**Notes**
- Change is purely backend/registry/data: Explorer content, Orchestrator content, registry validator, schema docs.
- No client state, accessibility, or frontend test impact.
- Frontend no-op confirmation complete.

## In-Progress Tasks

- None — all Backend tasks complete.

## Blocked Tasks

- None.

## Remaining Tasks

- None — all tasks complete.

## Summary

**Change**: exploration-lifecycle-states
**Agent**: Backend Apply + Frontend Apply
**Phase**: batch 3 Frontend no-op
**Status**: ✅ completed
**Files Modified**: 0 (Frontend no-op)
**Tests Run**: 0 (Frontend no-op)
**Registry Updated**: state.yaml + events.yaml (pending update for Backend phase)

---

## Pre-Archive Fix (2026-06-15)

**Issue**: Dead rule codes in schema not emitted by validator
- `lifecycle.non_actionable` — never emitted
- `lifecycle.missing_decision_required` — never emitted (validator checks next_action, not decision_required)
- `lifecycle.event_metadata_incomplete` — never emitted

**Fix Applied**: Removed dead rule codes from:
- `packages/core/src/spec-registry/schema.ts` — removed from type and array
- `openspec/registry-schema.md` — removed from docs
- `openspec/changes/exploration-lifecycle-states/spec.md` — removed from error contract table

**Verification**
- Tests: pass (24 validator tests pass)
- Build: pass
- Typecheck: pass

**Registry Updated**: state.yaml (completed) + events.yaml (fix event)

---

## Frontend No-Op Confirmation (Task 10)

**Outcome**: ✅ confirmed no frontend implementation required

**Reasoning**:
- Spec explicitly: "Accessibility: no UI changes"
- Design explicitly: "Accessibility: no UI changes"  
- Task 10 defined as "documentation-only verification after shared/backend contracts settle"
- Change affects: registry schema, validator, Explorer content, Orchestrator content
- No UI components, client state, accessibility, or TUI impacted
- apps/ directory completely untouched

---

## Pre-Archive Fix (2026-06-16)

**Issue**: Validator/CLI pre-archive smoke found two noisy validation gaps:
- Valid registry event names such as `spec.repaired`, `design.repaired`, `preconditions.created`, and `apply.general.fix_completed` triggered false `events.event.name_mismatch` warnings.
- `deck openspec validate --json --change <id>` only resolved active changes by default, so archived changes such as `openspec-registry-schema-validator` returned `change.not_found`.

**Fix Applied**:
- `packages/core/src/spec-registry/validator.ts` — expanded known event-name pattern validation and changed single-change lookup to include archive by default while still preferring active `openspec/changes/<id>`.
- `packages/core/src/spec-registry/types.ts` — aligned `includeArchive` option docs with archived single-change lookup behavior.
- `packages/core/src/spec-registry/validator.test.ts` — added coverage for valid repaired/preconditions/apply owner event names and default archived lookup.
- `apps/cli/src/openspec-validate-command.test.ts` — added coverage that `--change` finds an archived change.

**Verification**
- Validator tests: pass (`bun test packages/core/src/spec-registry/validator.test.ts`, 27/27)
- CLI validate command tests: pass (`bun test apps/cli/src/openspec-validate-command.test.ts`, 8/8)
- Smoke active change: pass (`bun run deck:run -- openspec validate --json --change exploration-lifecycle-states`, 0 errors, 0 warnings, 0 `events.event.name_mismatch`)
- Smoke archived change: pass (`bun run deck:run -- openspec validate --json --change openspec-registry-schema-validator`, location `archive`, no `change.not_found`)

**Registry Updated**: state.yaml (backend fix provenance) + events.yaml (`apply.backend.fix_completed`)
