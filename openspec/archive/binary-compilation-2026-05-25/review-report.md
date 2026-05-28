# Review Report: Binary Compilation

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: general
**Files Reviewed**: 12

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Clean runtime abstractions, good separation of concerns |
| Security | ✅ Strong | Checksum fails closed, dev-mode guard, no shell injection |
| Scalability | ✅ Strong | 4-target matrix, async I/O where appropriate |
| Maintainability | ✅ Strong | Readable, well-commented, centralized error codes |
| Code Quality | ✅ Strong | Good naming, consistent style, minimal duplication |
| Backend | ✅ Strong | Build scripts and CLI logic are sound |
| Frontend | N/A | Not in scope |
| Integration | ⚠️ Adequate | Two functional mismatches between build output and upgrade lookup |

## Findings

### BLOCKER
None.

### MAJOR
- **Integration**: Release asset naming mismatch breaks upgrade asset lookup
  - **File**: `apps/cli/src/upgrade-command/github-release.ts` — lines 119-125, 129-133
  - **Evidence**: `getPlatformTriple()` returns `macos-x86_64` / `linux-x86_64`, but `.github/workflows/release.yml` uploads assets named `deck_v1.0.0_darwin-x64.tar.gz` and `deck_v1.0.0_linux-x64.tar.gz`. The `includes(triplePattern)` and `startsWith(osPrefix)` checks will never match release asset names.
  - **Recommendation**: Align asset naming convention. Either rename release assets to use `macos_x86_64` style, or update `github-release.ts` `getOsName`/`getArchName` to match the release workflow's `darwin-x64` naming.

- **Integration**: Tarball extraction expects binary named `deck`, but archives contain platform-specific names
  - **File**: `apps/cli/src/upgrade-command/install.ts` — lines 92-114
  - **Evidence**: `extractTarball` searches for an entry named exactly `deck` (`entries.find((name) => name === "deck")`). However, `scripts/build-binaries.ts` archives `deck_1.0.0_darwin_x64`, and `.github/workflows/release.yml` archives `./deck-darwin-x64`. Neither produces an entry named `deck`.
  - **Recommendation**: Normalize the binary name inside the archive to `deck` before/after extraction, or update `extractTarball` to find the actual binary entry (e.g., by filtering executable files or known prefixes).

### MINOR
- **Maintainability**: Mixed test frameworks (`bun:test` vs `vitest`) across CLI tests
  - **File**: `apps/cli/src/runtime/__tests__/build-info.test.ts` (bun:test), `apps/cli/src/upgrade-command/__tests__/install.test.ts` (vitest)
  - **Recommendation**: Standardize on a single test framework for the CLI package to reduce CI configuration complexity.

### NIT
- **Code Quality**: Dev default channel is `"stable"` instead of `"dev"`
  - **File**: `apps/cli/src/runtime/build-info.ts` — line 34
  - **Recommendation**: Consider defaulting dev builds to `"dev"` channel to distinguish them from production stable builds.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes (based on checklist artifacts and code structure)
- **Deviations**: None observed in core architecture. The two MAJOR findings above are integration gaps between build output and runtime consumption, not architectural deviations.

## Open Questions

- Is the asset naming mismatch (`macos_x86_64` vs `darwin-x64`) already tracked in a follow-up task?
- Should the release workflow rename binaries to `deck` inside the tar archive, or should the extraction logic adapt to the existing names?

> These are functional bugs in the upgrade path. They do not affect the core binary compilation feature (builds produce valid executables), but they prevent `deck upgrade` from working against GitHub releases.
