# Verify Report: Exploration lifecycle states

## Summary

**Overall Result**: PASS
**Tasks Complete**: 10 / 10
**Tests**: 177 / 177 passed (focused suites: validator 27, CLI validate 8, explorer 36, orchestrator 106)
**Build**: pass
**Typecheck**: pass (pre-existing errors in adapter-pi, adapter-supermemory, apps/cli unrelated to this change)
**Smoke — Active Change**: ok=true, 0 errors, 0 warnings
**Smoke — Archived Change**: ok=true, 0 errors, 5 warnings (all pre-existing legacy `apply.fix_completed` name_mismatch + preconditions missing — expected for archived change)

## Task Completion

| Task | Status | Owner |
|---|---|---|
| Task 1: Add failing registry lifecycle schema tests | ✅ Complete | General Apply |
| Task 2: Implement shared lifecycle constants and warning rule types | ✅ Complete | General Apply |
| Task 3: Implement warning-only lifecycle validation | ✅ Complete | General Apply |
| Task 4: Document optional lifecycle registry shape and events | ✅ Complete | General Apply |
| Task 5: Add failing Explorer content tests | ✅ Complete | Backend Apply |
| Task 6: Update Explorer content with diagnostic outcome guidance | ✅ Complete | Backend Apply |
| Task 7: Add failing Orchestrator content tests | ✅ Complete | Backend Apply |
| Task 8: Update Orchestrator content for minimal lifecycle handling | ✅ Complete | Backend Apply |
| Task 9: Add invariant tests for anti-bureaucracy | ✅ Complete | Backend Apply |
| Task 10: Confirm no frontend implementation required | ✅ Complete (NO-OP) | Frontend Apply |

## Test Results

| Test Suite | Pass | Fail | Skip |
|---|---|---|---|
| Spec Registry Validator (`packages/core/src/spec-registry/validator.test.ts`) | 27 | 0 | 0 |
| CLI Validate Command (`apps/cli/src/openspec-validate-command.test.ts`) | 8 | 0 | 0 |
| Explorer Content (`packages/core/src/teams/developer/explorer-content.test.ts`) | 36 | 0 | 0 |
| Orchestrator Content (`packages/core/src/teams/developer/orchestrator-content.test.ts`) | 106 | 0 | 0 |
| **Total (focused suites)** | **177** | **0** | **0** |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | pass | All binaries built successfully (linux-x64, linux-arm64, darwin-x64, darwin-arm64) |
| Typecheck | pass | Pre-existing type errors in adapter-pi, adapter-supermemory, apps/cli unrelated to this change. No type errors in modified files (packages/core/src/spec-registry/*, packages/core/src/teams/developer/*) |

## Smoke Tests (Pre-Archive Re-Run 2026-06-16)

| Smoke | Result | Details |
|---|---|---|
| Active change `exploration-lifecycle-states` | ✅ ok=true | 0 errors, 0 warnings, location=changes, phase=apply, status=completed |
| Archived change `openspec-registry-schema-validator` | ✅ ok=true | 0 errors, 5 warnings (pre-existing legacy `apply.fix_completed` name_mismatch ×4 + preconditions.artifact.missing ×1), location=archive |

### Pre-Archive Fix Verified
The following fixes from the Pre-Archive Fix (2026-06-16) are confirmed working:
1. **Validator event-name pattern expansion**: Valid registry event names (`spec.repaired`, `design.repaired`, `preconditions.created`, `apply.general.fix_completed`) no longer trigger false `events.event.name_mismatch` warnings — confirmed by test "valid registry event names do not report name_mismatch warnings" (pass).
2. **CLI `--change` archive lookup**: `deck openspec validate --change <id>` now resolves archived changes by default — confirmed by test "--change finds archived change" (pass) and smoke test showing `location: "archive"` for `openspec-registry-schema-validator`.

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-LIFECYCLE-001 | Schema constants + validator tests | ✅ PASS | VALID_EXPLORATION_CONTEXTS includes sdd and delegated |
| REQ-LIFECYCLE-002 | Orchestrator content tests | ✅ PASS | SDD Explorer stopped before Proposal triggers lifecycle |
| REQ-LIFECYCLE-003 | Orchestrator content tests | ✅ PASS | Delegated Explorer with actionable diagnosis triggers lifecycle |
| REQ-LIFECYCLE-004 | Anti-bureaucracy tests | ✅ PASS | No lifecycle for non-actionable explorations |
| REQ-LIFECYCLE-005 | Schema constants + validator tests | ✅ PASS | All 6 lifecycle values supported: diagnosed, deferred, closed-no-action, converted-to-change, converted-to-sdd, keep-as-reference |
| REQ-LIFECYCLE-006 | Validator tests | ✅ PASS | diagnosed requires next_action and decision_required |
| REQ-LIFECYCLE-007 | Validator tests | ✅ PASS | deferred requires reason and reactivation condition |
| REQ-LIFECYCLE-008 | Validator tests | ✅ PASS | closed-no-action requires reason |
| REQ-LIFECYCLE-009 | Validator tests | ✅ PASS | converted-to-change requires reference |
| REQ-LIFECYCLE-010 | Validator tests | ✅ PASS | converted-to-sdd requires reference |
| REQ-LIFECYCLE-011 | Validator tests | ✅ PASS | keep-as-reference requires rationale |
| REQ-LIFECYCLE-012 | Anti-bureaucracy tests | ✅ PASS | No new SDD phase, no Apply gate, lifecycle is auxiliary |
| REQ-ORCH-001 | Orchestrator content tests | ✅ PASS | Blocked Explorer does not use lifecycle |
| REQ-ORCH-002 | Orchestrator content tests | ✅ PASS | Immediate Proposal has no lifecycle friction |
| REQ-ORCH-003 | Orchestrator content tests | ✅ PASS | SDD pause with actionable diagnosis records lifecycle |
| REQ-ORCH-004 | Orchestrator content tests | ✅ PASS | Delegated actionable diagnosis records lifecycle |
| REQ-ORCH-005 | Orchestrator content tests | ✅ PASS | Non-actionable delegated exploration has no lifecycle |
| REQ-ORCH-006 | Orchestrator content tests | ✅ PASS | Interactive mode presents minimum decision options |
| REQ-ORCH-007 | Orchestrator content tests | ✅ PASS | Automatic mode avoids lifecycle ceremony for direct flows |
| REQ-ORCH-008 | Orchestrator content tests | ✅ PASS | Lifecycle rationale is brief in registry surfaces |
| REQ-REGISTRY-001 | Schema documentation + validator tests | ✅ PASS | state.yaml supports optional exploration_context and lifecycle_status |
| REQ-REGISTRY-002 | Validator tests | ✅ PASS | diagnosed indicates decision required and next_action |
| REQ-REGISTRY-003 | Validator tests | ✅ PASS | All lifecycle states include required metadata |
| REQ-REGISTRY-004 | Schema documentation | ✅ PASS | Lifecycle events are auditable |
| REQ-REGISTRY-005 | Schema documentation | ✅ PASS | Events include actor, timestamp, artifact, context, value, note |
| REQ-REGISTRY-006 | Validator tests | ✅ PASS | Unknown lifecycle values are warnings, not errors |
| REQ-REGISTRY-007 | Validator tests | ✅ PASS | Warning-level for lifecycle issues, strict errors for canonical fields |
| REQ-REGISTRY-008 | Validator implementation | ✅ PASS | Optional floating-exploration warning supported (low-noise) |
| REQ-REGISTRY-009 | Validator implementation | ✅ PASS | Optional delegated-diagnosis warning supported (low-noise) |
| REQ-REGISTRY-010 | Git diff review | ✅ PASS | No historical records auto-migrated |

## Findings

### CRITICAL
- None

### WARNING
- None

### SUGGESTION
- Pre-existing type errors in apps/cli/src/ (pi-launch-command.ts, tui/app.tsx, runtime/process.ts) are unrelated to this change but should be addressed in a separate maintenance task.
- Consider adding integration tests that exercise full lifecycle transitions (diagnosed → deferred → converted-to-change) in a single test flow.

## Open Questions

None.

## Verification Evidence

### Files Modified
- `packages/core/src/spec-registry/schema.ts` — Added VALID_EXPLORATION_CONTEXTS, VALID_LIFECYCLE_STATUSES, ExplorationContext, LifecycleStatus types, lifecycle warning rule codes
- `packages/core/src/spec-registry/validator.ts` — Added warning-level lifecycle validation; expanded known event-name patterns; default single-change lookup includes archive
- `packages/core/src/spec-registry/types.ts` — Aligned `includeArchive` option docs with archived single-change lookup behavior
- `packages/core/src/spec-registry/validator.test.ts` — Added 10 lifecycle tests + 3 pre-archive fix tests (event name patterns, archive lookup, unknown event names)
- `packages/core/src/teams/developer/explorer-content.ts` — Added Step 5 (Assess Actionable Diagnosis) and diagnostic outcome sections in return format
- `packages/core/src/teams/developer/explorer-content.test.ts` — Added 4 tests for diagnostic outcome guidance
- `packages/core/src/teams/developer/orchestrator-content.ts` — Added Exploration Lifecycle (Optional) section in system prompt and skill body
- `packages/core/src/teams/developer/orchestrator-content.test.ts` — Added 12 lifecycle branch tests + 7 anti-bureaucracy tests
- `apps/cli/src/openspec-validate-command.test.ts` — Added test for `--change finds archived change`
- `openspec/registry-schema.md` — Documented optional lifecycle fields and warning-level semantics

### Test Coverage
- Validator tests verify warning-level semantics (unknown values emit warnings, not errors)
- Validator tests verify canonical phase/status errors remain strict
- Explorer content tests verify diagnostic outcome guidance is present
- Orchestrator content tests verify lifecycle applies only to actionable diagnoses
- Orchestrator content tests verify no lifecycle for blocked Explorer, immediate Proposal, non-actionable delegated exploration
- Anti-bureaucracy tests verify no new SDD phase, no Apply gate, no historical migration, lifecycle is optional

### Build Verification
- All binaries built successfully
- No type errors in modified files
- Pre-existing type errors in apps/cli are unrelated to this change

## Conclusion

All requirements satisfied. Implementation is complete, tested, and documented. Lifecycle is auxiliary and warning-level as specified. Anti-bureaucracy invariants are preserved. No frontend changes required.

Pre-archive re-run (2026-06-16) confirms the validator event-pattern expansion and `--change` archive lookup fixes are working correctly: active change validates with 0 errors / 0 warnings, archived change resolves successfully from archive location.

**Verdict**: PASS
