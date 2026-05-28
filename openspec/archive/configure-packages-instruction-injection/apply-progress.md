# Apply Progress: configure-packages-instruction-injection (General Apply - Fixes)

## Completed Tasks

### Issue 1: DeveloperTeamManifestInput uses canonical CapabilityInstructionBundle
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/runner-capability.ts` — modify `DeveloperTeamManifestInput` to import and use `CapabilityInstructionBundle` from `@deck/core` instead of duplicating the inline shape
- `packages/core/src/runner-capability.test.ts` — add tests verifying `capabilityInstructions` uses the canonical type

**Verification**
- Tests: pass (26 tests across runner-capability.test.ts and prompt-generation.test.ts)
- Build: pass (bun test packages/adapter-opencode/ — 114 pass)
- Typecheck: pass (bunx tsc --noEmit — no errors)

**Notes**
Changed `DeveloperTeamManifestInput.capabilityInstructions` from an inline anonymous object to `CapabilityInstructionBundle` imported from `./teams/developer/instruction-bundles/index`. This ensures type一致性 with other usages across the codebase.

### Issue 2: OpenCode prompt generation passes capabilityInstructions through
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-opencode/src/developer-team-install.ts` — add `capabilityInstructions?: CapabilityInstructionBundle` to `OpenCodeDeveloperTeamInstallPlan`, capture it in the plan return, and use it when calling `getAgentContent` in `verifyOpenCodeDeveloperTeamInstall`
- `packages/adapter-opencode/src/prompt-generation.test.ts` — add tests verifying capability instructions are passed through to orchestrator and all agent prompt generation

**Verification**
- Tests: pass (114 tests across adapter-opencode package)
- Build: pass
- Typecheck: pass

**Notes**
The `buildPromptGenerationPlan` already accepted `capabilityInstructions` and passed it to `buildPromptContent` → `getAgentContent`. The fix ensures the bundle is preserved through the install plan and verification uses the same bundle for content reconciliation.

## In-Progress Tasks

None — both issues are resolved.

## Blocked Tasks

None.

## Remaining Tasks

None for General Apply. The fixes are complete.

## Summary

Fixed two type inconsistency issues reported in Verify/Review:

1. **Issue 1 (MAJOR)**: `DeveloperTeamManifestInput` in `runner-capability.ts` duplicated the `CapabilityInstructionBundle` shape inline. Fixed by importing and using the canonical `CapabilityInstructionBundle` type from `@deck/core`.

2. **Issue 2 (MAJOR)**: OpenCode adapter's `verifyOpenCodeDeveloperTeamInstall` called `getAgentContent` without passing through the `capabilityInstructions` bundle. Fixed by storing the bundle in the install plan and using it during verification.

Both fixes maintain backward compatibility and pass all existing tests.