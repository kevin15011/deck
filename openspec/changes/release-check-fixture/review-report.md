# Review Report: release-check-fixture

## Summary

**Overall Rating**: APPROVE WITH CHANGES  
**Scope**: general  
**Files Reviewed**: 5 (1 implementation, 1 test, 3 fixtures)

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Fixture mode cleanly separated at entry point, no coupling to normal flow |
| Security | ✅ Strong | Env var explicit, local file only, no network when active, clear errors |
| Scalability | ✅ Strong | N/A for this feature - local file read only |
| Maintainability | ⚠️ Adequate | Test structure issue (nested describe), some duplication in error handling |
| Code Quality | ⚠️ Adequate | Clear naming, good comments, minor type assertion and duplication |
| Backend | N/A | CLI tool, not backend |
| Frontend | N/A | CLI tool, not frontend |
| Integration | ✅ Strong | No integration concerns - isolated feature |
| Economy / Critical Judgment | ✅ Strong | Minimal code, localized, no over-engineering |

### Economy / Critical Judgment

**Rating**: ✅ Strong

The implementation is minimal and localized:
- ~110 lines for `loadFixtureDescriptor` function
- ~5 lines to integrate into `fetchReleaseDescriptor`
- 3 fixture files for testing
- No new dependencies, no abstractions, no "just-in-case" code

The volume is justified by the need to support multiple fixture scenarios (upgrade/no-upgrade/invalid) and provide clear error messages.

## Findings

### BLOCKER
None.

### MAJOR

**Code Quality**: Test structure - fixture tests nested inside wrong describe block  
- **File**: `apps/cli/src/upgrade-command/__tests__/github-release.test.ts` — lines 193-279
- **Evidence**: The `describe("DECK_RELEASE_CHECK_FIXTURE", ...)` block (lines 194-278) is nested inside `describe("decideReleaseAvailability", ...)` (line 193). This is structurally incorrect - fixture tests are unrelated to `decideReleaseAvailability`.
- **Recommendation**: Move the `DECK_RELEASE_CHECK_FIXTURE` describe block outside of `decideReleaseAvailability`. Place it at the top level or create a dedicated `describe("fetchReleaseDescriptor", ...)` wrapper.

### MINOR

**Code Quality**: Magic string in test - platform triple construction  
- **File**: `apps/cli/src/upgrade-command/__tests__/github-release.test.ts` — line 214
- **Evidence**: `const triple = \`${process.platform}-${process.arch === "x64" ? "x64" : "arm64"}\`` manually constructs the triple instead of using the actual `getPlatformTriple()` function or asserting against known values.
- **Recommendation**: Either import and use `getPlatformTriple()` from the module, or hardcode the expected value based on the test environment. The current approach could mask bugs if the platform mapping logic changes.

**Code Quality**: Error handling duplication  
- **File**: `apps/cli/src/upgrade-command/github-release.ts` — lines 333-364
- **Evidence**: The error handling for `ReleaseDescriptorError` (lines 334-348) and generic `Error` (lines 350-363) returns nearly identical objects, differing only in the error message extraction.
- **Recommendation**: Extract a helper function or consolidate the error handling:
  ```typescript
  const errorMessage = err instanceof ReleaseDescriptorError ? err.message : (err as Error).message;
  return {
    kind: "legacy",
    reason: "invalid",
    info: { /* ... */ },
    error: `Fixture validation failed: ${errorMessage}`,
  };
  ```

**Test Coverage**: Missing test for cachePath isolation  
- **File**: `apps/cli/src/upgrade-command/__tests__/github-release.test.ts`
- **Evidence**: No test verifies that when `DECK_RELEASE_CHECK_FIXTURE` is NOT set, the `cachePath` returned is the default XDG path (not the fixture path).
- **Recommendation**: Add a test that calls `fetchReleaseDescriptor()` without the env var and verifies `result.cachePath` equals `getDefaultReleaseCachePath()`.

**Code Quality**: Type assertion could be improved  
- **File**: `apps/cli/src/upgrade-command/github-release.ts` — line 331
- **Evidence**: `normalizeCommit((descriptor as { commit?: string }).commit ?? null)` uses a type assertion.
- **Recommendation**: If `ReleaseJson` type doesn't include `commit`, consider extending the type definition or using a type guard. This is minor since the assertion is safe and localized.

**Documentation**: Long docstring for `loadFixtureDescriptor`  
- **File**: `apps/cli/src/upgrade-command/github-release.ts` — lines 219-257
- **Evidence**: The docstring is 38 lines and includes a full JSON example. While thorough, it could be more concise.
- **Recommendation**: Consider moving the JSON example to a separate documentation file or README, keeping the docstring focused on the function's purpose and parameters. Alternatively, keep it as-is since it's internal and the example is valuable for developers.

### NIT

**Code Quality**: Legacy fallback asset_name format  
- **File**: `apps/cli/src/upgrade-command/github-release.ts` — line 315
- **Evidence**: `asset_name: \`deck_v${obj.version || "0.0.0"}_${platform}.tar.gz\`` uses a hardcoded format.
- **Recommendation**: This is acceptable for a fixture fallback, but consider adding a comment noting that this matches the CI release naming convention.

## Design Fidelity

**Aligned**: Yes

The implementation matches the stated goal: "support for `DECK_RELEASE_CHECK_FIXTURE` to test release check/TUI/doctor without publishing a GitHub release."

**Deviations**: None

The implementation is straightforward and doesn't deviate from the expected approach.

## Open Questions

None.

## Security Assessment

✅ **Strong**

- **Env var explicit**: `DECK_RELEASE_CHECK_FIXTURE` is clear and self-documenting
- **Local file only**: No network calls when fixture is active (lines 376-379 return early)
- **No secrets exposure**: Fixture files are test data, no credentials
- **Clear errors**: Invalid fixtures return descriptive errors without leaking internals
- **No production risk**: Requires explicit env var set, cannot be triggered accidentally

## Test Adequacy

✅ **Strong**

Coverage includes:
- ✅ Upgrade scenario (version 99.99.99 > current)
- ✅ No-upgrade scenario (version 0.0.1 < current)
- ✅ Invalid JSON handling
- ✅ Missing file handling
- ✅ Network isolation verification
- ✅ Descriptor shape validation
- ✅ Commit extraction

Missing but non-critical:
- ⚠️ CachePath isolation test (when fixture NOT active)
- ⚠️ Legacy alias test (`tagName` → `tag_name`)
- ⚠️ Legacy fallback construction test (items array missing)

## Production Risk Assessment

✅ **No risk**

The fixture mode:
1. Requires explicit env var `DECK_RELEASE_CHECK_FIXTURE` to be set
2. Is clearly named and documented
3. Returns early without affecting normal flow when not set
4. Uses local files only, no network side effects
5. Cannot be triggered accidentally in production

The env var name is self-documenting and includes "FIXTURE" to signal test-only usage.
