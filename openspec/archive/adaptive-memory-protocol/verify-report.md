# Verify Report: Adaptive Memory Protocol — Package Instruction Model

## Summary

**Overall Result**: FAIL
**Tasks Complete**: 8 / 8
**Tests**: 222 / 226 passed (4 failures)
**Build**: ✅ PASS
**Typecheck**: ✅ PASS

## Task Completion

| Task | Status | Owner |
|---|---|---|
| Task 1: Create adaptive-memory instruction bundle | ✅ Complete | General Apply |
| Task 2: Create git utility for project name extraction | ✅ Complete | General Apply |
| Task 3: Register adaptive-memory and remove stale packages from index.ts | ✅ Complete | General Apply |
| Task 4: Update deck-config.ts constants and defaults | ✅ Complete | General Apply |
| Task 5: Update CLI TUI state constants | ✅ Complete | General Apply |
| Task 6: Update test files for new package IDs | ⚠️ Partial | General Apply |
| Task 7: Delete stale routing files and update project config | ✅ Complete | General Apply |
| Task 8: Build verification and broken-reference scan | ⚠️ Partial | General Apply |

## Test Results

| Test Suite | Pass | Fail | Skip |
|---|---|---|---|
| Unit: git.test.ts | 14 | 0 | 0 |
| Unit: index.test.ts | ~25 | 0 | 0 |
| Unit: deck-config.test.ts | ~25 | 0 | 0 |
| Unit: adapter-pi | 79 | 0 | 0 |
| Unit: adapter-opencode | ~40 | 0 | 0 |
| Unit: manifest.test.ts | ~15 | 1 | 0 |
| Unit: content-registry.test.ts | ~15 | 1 | 0 |
| Unit: reducer.test.ts | ~12 | 1 | 0 |
| Unit: input-handler.test.ts | ~12 | 1 | 0 |

**Total**: 222 pass / 4 fail / 0 skip

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| TypeScript Build (`bun run tsc --noEmit`) | ✅ PASS | Zero errors |
| TypeScript Typecheck | ✅ PASS | Same command, zero errors |

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-BUNDLE-001 | File inspection | ✅ PASS | `buildAdaptiveMemoryInstructionBundle()` exports a builder returning `CapabilityInstructionBundle` |
| REQ-BUNDLE-002 | File inspection | ✅ PASS | Bundle contains fragments for `surface: "agent"` and `surface: "skill"` |
| REQ-BUNDLE-003 | Content review | ✅ PASS | Save triggers list 7 proactive categories (architectural decisions, bug fixes, patterns, config changes, discoveries, preferences, gotchas) |
| REQ-BUNDLE-004 | Content review | ✅ PASS | Save format defines What, Why, Where, Learned |
| REQ-BUNDLE-005 | Content review | ✅ PASS | Reactive and proactive search triggers documented |
| REQ-BUNDLE-006 | Content review | ✅ PASS | Session-close summary covers Goal, Instructions, Discoveries, Accomplished, Next Steps, Relevant Files |
| REQ-BUNDLE-007 | Content review | ✅ PASS | Authority rule states OpenSpec artifacts are ALWAYS authoritative |
| REQ-BUNDLE-008 | Content review | ✅ PASS | Fail-open rule documented |
| REQ-BUNDLE-009 | Grep verification | ✅ PASS | No provider names found in markdown |
| REQ-BUNDLE-010 | Content review | ✅ PASS | Topic keys guidance included |
| REQ-BUNDLE-011 | Content review | ✅ PASS | Soft max of 7 memories per session documented |
| REQ-BUNDLE-012 | Content review | ✅ PASS | Scope hierarchy documented (personal, project, team, org) |
| REQ-REG-001 | File inspection | ✅ PASS | `CapabilityInstructionPackageId` includes `"adaptive-memory"` |
| REQ-REG-002 | File inspection | ✅ PASS | `PACKAGE_BUILDERS["adaptive-memory"]` maps to builder function |
| REQ-REG-003 | File inspection | ✅ PASS | `PACKAGE_ORDER` is `["codebase-memory", "adaptive-memory"]` |
| REQ-REG-004 | File inspection | ✅ PASS | `PACKAGE_INSTRUCTION_PACKAGE_IDS` is `["codebase-memory", "adaptive-memory"]` |
| REQ-REG-005 | File inspection | ✅ PASS | `CANONICAL_INSTRUCTION_PACKAGE_IDS` is `["codebase-memory", "adaptive-memory"]` |
| REQ-REG-006 | File inspection | ✅ PASS | Default config has `"adaptive-memory": false` for both runners |
| REQ-SCOPE-001 | File inspection | ✅ PASS | `.deck/config.json` has `"projectId": "deck"` under `adaptiveMemory.supermemory` |
| REQ-SCOPE-002 | Test execution | ✅ PASS | `extractProjectNameFromGitRemote` supports SSH, HTTPS, local paths |
| REQ-SCOPE-003 | Test execution | ✅ PASS | Fallback to directory basename when parsing fails |
| REQ-SCOPE-004 | Code review | ✅ PASS | `getProjectFallbackName` uses `path.basename(projectRoot)` |
| REQ-CLEANUP-001 | File existence check | ✅ PASS | `context-mode.ts` and `rtk.ts` deleted from instruction-bundles/ |
| REQ-CLEANUP-002 | Grep verification | ✅ PASS | No imports or references to deleted builders in `index.ts` |
| REQ-CLEANUP-003 | Grep verification | ✅ PASS | Stale IDs removed from `PACKAGE_BUILDERS`, `PACKAGE_ORDER`, `PACKAGE_INSTRUCTION_PACKAGE_IDS`, defaults |
| REQ-CLEANUP-004 | File inspection | ✅ PASS | `CapabilityInstructionPackageId` contains exactly `"codebase-memory"` and `"adaptive-memory"` |
| REQ-CLEANUP-005 | Grep verification | ✅ PASS | No `.ts` source files reference deleted builders or package IDs |
| REQ-COMPAT-001 | Grep verification | ✅ PASS | Existing skill language remains compatible |
| REQ-COMPAT-002 | Content review | ✅ PASS | Authority rule is consistent with existing renderer rule |
| Scenario: Bundle produces agent and skill fragments | Test + inspection | ✅ PASS | |
| Scenario: Protocol markdown contains no provider names | Grep | ✅ PASS | |
| Scenario: adaptive-memory appears in config validation | Test | ✅ PASS | |
| Scenario: adaptive-memory defaults to disabled | Test | ✅ PASS | |
| Scenario: Bundle builder is registered | Test | ✅ PASS | |
| Scenario: Package order is deterministic | Test | ✅ PASS | |
| Scenario: CLI TUI includes adaptive-memory | Test | ✅ PASS | |
| Scenario: Project ID extracted from SSH git remote | Test | ✅ PASS | |
| Scenario: Project ID extracted from HTTPS git remote | Test | ✅ PASS | |
| Scenario: Project ID extracted from local path remote | Test | ✅ PASS | |
| Scenario: Stale bundle files are deleted | File check | ✅ PASS | |
| Scenario: Stale references removed from index | Grep | ✅ PASS | |
| Scenario: Stale IDs removed from config schema | Test | ✅ PASS | |
| Scenario: Stale IDs removed from CLI TUI | Test | ✅ PASS | |
| Scenario: No deck file references deleted bundles | Grep | ✅ PASS | |
| Scenario: Existing skill language works with new protocol | Grep | ✅ PASS | |
| Scenario: Authority rule is consistent between systems | Content review | ✅ PASS | |
| Scenario: Routing is omitted when no provider is active | Design review | ✅ PASS | Provider routing handled by existing `MemoryInjectionBundle` pipeline |

## Findings

### CRITICAL
- **Test failure: `reducer.test.ts:190`**  
  The "Review & Install regenera plan y bloquea instalación con plan stale" test expects `codebase-memory` to appear in `plan.groups.automaticInstalls`. However, `codebase-memory` has `status: "manual"` in the test inventory, so the plan builder places it in `manualSteps`, not `automaticInstalls`. The original test used `context-mode` (status: `"missing"`), which the plan builder placed in `automaticInstalls`. When the test was updated to replace `context-mode` with `codebase-memory`, the inventory status difference was not accounted for.  
  **Fix**: Either change the test inventory `codebase-memory` status from `"manual"` to `"missing"`, or change the assertion to check `manualSteps` instead of `automaticInstalls`.

- **Test failure: `input-handler.test.ts:50`**  
  The "space/enter togglea pi-hud desde Packages detail" test uses `cursor: 3` expecting it to map to `pi-hud`. However, `input-handler.ts` fallback `defaultIds` is now `["adaptive-memory", "codebase-memory", "pi-hud"]`, so `pi-hud` is at index 2, not 3.  
  **Fix**: Change `cursor: 3` to `cursor: 2` in the test.

- **Test failure: `manifest.test.ts:220`**  
  The "multiple packages produce multiple instruction sections in manifest" test asserts `explorer!.instruction).toContain("Context Mode")`. Since `context-mode` was deleted and replaced with `adaptive-memory`, the instruction text now contains "Adaptive Memory", not "Context Mode".  
  **Fix**: Change the assertion from `"Context Mode"` to `"Adaptive Memory"`.

- **Test failure: `content-registry.test.ts:419`**  
  The "multiple packages produce both instruction sections in agent body" test asserts `content!.agentBody).toContain("Context Mode")`. Same root cause as manifest.test.ts — stale reference to deleted bundle heading.  
  **Fix**: Change the assertion from `"Context Mode"` to `"Adaptive Memory"`.

### WARNING
- None.

### SUGGESTION
- None.

## Open Questions

None.
