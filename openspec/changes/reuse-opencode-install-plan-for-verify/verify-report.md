# Verify Report: reuse-opencode-install-plan-for-verify

## Summary

**Overall Result**: FAIL  
**Tasks Complete**: 8 / 8 marked complete in `apply-progress.md`  
**Tests**: focused suites pass; adapter suite has 1 unrelated baseline failure  
**Build**: PASS (`bun run build`)  
**Typecheck**: FAIL (`bunx tsc --noEmit`; broad baseline failures plus changed-file test/type errors)

Verification conclusion: the implementation does **not** satisfy the SDD change. The exact-match verifier is still preserved and detects real drift, but the runner-capabilities apply→verify path is not proven/fixed: apply fails in manual capability-path verification, the native snapshot is module-scoped rather than per factory instance, verify fallback does not accept/rebuild with the full runtime option set, and required regression tests are mostly superficial.

Registry-deferred mode: only this `verify-report.md` was written. `state.yaml` / `events.yaml` were not modified.

## Task Completion

| Task | Marked Status | Verified Result | Notes |
|---|---:|---:|---|
| Task 1: per-instance native snapshot | ✅ Complete | ❌ FAIL | Snapshot variables are module-level (`runner-capabilities.ts:42-43`), not closure-per-instance inside `createOpenCodeRunnerCapabilities()`. |
| Task 2: `verifyTeamInstallFromPlan` uses snapshot | ✅ Complete | ⚠️ PARTIAL | It reads cache, but cache is global/module-scoped and `applyTeamInstallFromPlan` rebuilds a partial plan instead of preserving the native plan. |
| Task 3: `verifyTeamInstall` uses snapshot/fallback | ✅ Complete | ⚠️ PARTIAL | It reads cache, but fallback only passes `capabilityInstructions`, not full runtime options. |
| Task 4: regression test for `capabilityInstructions` | ✅ Complete | ❌ FAIL | Added test only constructs a bundle; it does not build/apply/verify or assert no content mismatch. |
| Task 5: regression test for `personality` | ✅ Complete | ❌ FAIL | No personality apply→verify regression test found. |
| Task 6: drift still detected/rollback | ✅ Complete | ⚠️ PARTIAL | Exact-match drift test exists in `developer-team-install.test.ts`; no new runner-capabilities rollback/drift test. |
| Task 7: fallback without prior apply | ✅ Complete | ❌ FAIL | No functional fallback test found. |
| Task 8: adapter-opencode suite | ✅ Complete | ⚠️ WARN | Suite has 1 unrelated baseline failure in `install-tools.test.ts`. |

## Test Results

| Command | Result | Evidence |
|---|---:|---|
| `bun test packages/adapter-opencode/src/runner-capabilities.test.ts` | ✅ PASS | 22 pass, 0 fail, 59 expects |
| `bun test packages/adapter-opencode/src/developer-team-install.test.ts` | ✅ PASS | 55 pass, 0 fail, 359 expects |
| `bun test packages/adapter-opencode/src/` | ⚠️ WARN | 166 pass, 1 fail; failure: `install-tools.test.ts:37` expected message containing `Added 'context-mode' to plugin array`, got `Installed context-mode via opencode plugin` — unrelated baseline per apply-progress |
| Manual capability path: `developerTeam.buildInstallPlan` → `applyInstall` with non-default `capabilityInstructions` | ❌ FAIL | `TypeError: {} is not iterable` at `developer-team-install.ts:487` from `applyTeamInstallFromPlan()` reconstructed plan with `promptGenerationPlan: {}` |
| Manual capability path: `teams.buildDeveloperTeamInstallPlan` → `applyDeveloperTeamInstall` | ❌ FAIL | `teams apply failed: {} is not iterable` |

## Build / Typecheck

| Check | Result | Details |
|---|---:|---|
| `bun run build` | ✅ PASS | Built linux-x64, linux-arm64, darwin-x64, darwin-arm64 artifacts and checksums. |
| `bunx tsc --noEmit` | ❌ FAIL | Many existing repo-wide errors. Changed-file relevant errors include `packages/adapter-opencode/src/runner-capabilities.test.ts(5,50): Cannot find module '@deck/core/teams/developer/instruction-bundles/index'` and missing `environmentId` in existing manifest calls. Treat repo-wide failures as baseline, but changed-file errors remain verification evidence. |

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---:|---|
| REQ-OIV-001 | Code inspection + manual apply→verify | ❌ FAIL | Capability apply path fails before verify; same-content comparison not demonstrated. |
| REQ-OIV-002 | Code inspection | ❌ FAIL | Snapshot is module-scoped, not per instance; apply paths overwrite/rebuild partial plans. |
| REQ-OIV-003 | Code inspection | ❌ FAIL | Verify fallback accepts/passes only `capabilityInstructions`; no `memoryProvider`, `personality`, `modelAssignments`, `thinkingAssignments`, `standaloneSkills`. |
| REQ-OIV-004 | Code inspection + `developer-team-install.test.ts` | ✅ PASS | `content !== planned.content` exact-match preserved; drift test passes. |
| REQ-OIV-005 | Code inspection | ⚠️ WARN | Cached plan path exists, but not per-instance and not safely preserved through apply. |
| REQ-OIR-001 | Manual test + code inspection | ❌ FAIL | False rollback root cause not fully fixed because post-apply verify path cannot complete via runner-capabilities apply. |
| REQ-OIR-002 | Artifact/code review | ✅ PASS | No manual `~/.config/opencode` workaround required by implementation/tests. |
| REQ-TC-001 | Test review | ❌ FAIL | Required runtime option tests (`personality`, `memoryProvider`, meaningful `capabilityInstructions`) are missing/superficial. |
| REQ-TC-002 | Test review | ⚠️ WARN | Native exact-match drift test exists; no runner-capabilities rollback activation test. |
| REQ-TC-003 | Test review | ❌ FAIL | No functional fallback-without-apply test found. |
| Scenario: verify uses same content as apply with runtime options | Manual capability path | ❌ FAIL | Apply throws `{} is not iterable`. |
| Scenario: defaults apply→verify | Manual capability path | ❌ FAIL | Same apply path construction problem. |
| Scenario: pre-built plan | Code inspection | ⚠️ WARN | Cache path exists, but partial-plan reconstruction in apply invalidates confidence. |
| Scenario: real drift detected | Focused test | ✅ PASS | `verify fails when installed content differs from planned content` passes. |
| Scenario: file deleted after apply | Existing suite | ✅ PASS | Covered in `developer-team-install.test.ts` suite. |
| Scenario: fallback without prior apply | Test/code review | ❌ FAIL | No functional test; fallback incomplete options. |
| Scenario: rollback not triggered by runtime options | Manual capability path | ❌ FAIL | Cannot verify because apply fails. |
| Scenario: rollback triggered by real drift | Test review | ⚠️ WARN | Exact-match invalid result covered; rollback activation via capabilities not covered. |

## Findings

### CRITICAL

- `runner-capabilities.ts` snapshot is module-scoped (`lastAppliedNativePlan` / `lastAppliedProjectRoot` at lines 42-43), not per `createOpenCodeRunnerCapabilities()` instance as required. This permits cross-instance contamination and fails Task 1 / REQ-OIV-002.
- Functional apply→verify path through runner capabilities fails before verification: manual `developerTeam.buildInstallPlan()` → `developerTeam.applyInstall()` with non-default `capabilityInstructions` throws `TypeError: {} is not iterable` at `developer-team-install.ts:487`, because `applyTeamInstallFromPlan()` reconstructs an incomplete native plan with `promptGenerationPlan: {}`.
- Required runtime options are not accepted/passed in verify fallback. `verifyTeamInstall()` / `verifyTeamInstallFromPlan()` only pass `capabilityInstructions`, not `memoryProvider`, `personality`, `modelAssignments`, `thinkingAssignments`, or `standaloneSkills` (REQ-OIV-003).
- Required regression tests were not implemented. `runner-capabilities.test.ts` only checks method existence and bundle construction; it does not run build→apply→verify with non-default runtime options, personality, fallback, or runner-capabilities drift/rollback.

### WARNING

- Broader adapter-opencode suite has 1 unrelated/baseline failure in `install-tools.test.ts` message expectation.
- Typecheck fails repo-wide with many baseline errors; changed-file test import/type errors are present and should be resolved or separated.

### SUGGESTION

- Add a test that creates two independent `createOpenCodeRunnerCapabilities()` instances to prove snapshot isolation.
- Prefer storing the native plan returned by build and using it for apply, rather than reconstructing partial plans from `{ files }`.

## Open Questions

- Should `DeveloperTeamVerifyInput` be extended to include all runtime options, or should verify rely exclusively on an applied native-plan snapshot for same-session apply→verify?

## Self-Verification

- Artifact written: `openspec/changes/reuse-opencode-install-plan-for-verify/verify-report.md`
- Registry writes: deferred by request; no `state.yaml` / `events.yaml` changes made by Verify.
