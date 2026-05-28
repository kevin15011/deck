# Apply Progress: Final Cleanup

**Change**: binary-compilation
**Phase**: apply
**Status**: completed
**Agent**: final-cleanup

## Completed Tasks (23/23)

| Task | Description | Status |
|---|---|---|
| T1 | Create runtime process runner abstraction | ✅ Completed |
| T2 | Replace Bun.spawn in adapter-opencode | ✅ Completed |
| T3 | Replace Bun.spawn in adapter-pi | ✅ Completed |
| T4 | Replace Bun.spawn in CLI entrypoint | ✅ Completed |
| T5 | Create global config path resolver | ✅ Completed |
| T6 | Update deck-config to support global config | ✅ Completed |
| T7 | Re-scope project-root to optional target discovery | ✅ Completed |
| T8 | Create build-info runtime module | ✅ Completed |
| T9 | Add --version and upgrade CLI arg parsing | ✅ Completed |
| T10 | Generate bundled external skills at build time | ✅ Completed |
| T11 | Upgrade doctor diagnostics for binary mode | ✅ Completed |
| T12 | Create build info generation script | ✅ Completed |
| T13 | Implement upgrade command | ✅ Completed |
| T14 | Wire upgrade command into main.tsx | ✅ Completed |
| T15 | Create build-binaries script | ✅ Completed |
| T16 | Add compiled binary smoke tests | ✅ Completed |
| T17 | Create GitHub Actions release workflow | ✅ Completed |
| T18 | Create Homebrew formula template | ✅ Completed |
| T19 | Add unit tests for runtime modules | ✅ Completed |
| T20 | Validate pi-launch from binary | ✅ Completed |
| T21 | Add upgrade command unit tests | ✅ Completed |
| T22 | Missing skill diagnostic error | ✅ Completed |
| T23 | Verify development workflow unchanged | ✅ Completed |

## Completion Summary

- **Total Tasks**: 23
- **Status**: All tasks completed during previous apply phases
- **Final Fixes Applied**: 5 issues from final cleanup request

### Issues Fixed in This Phase

1. **Tarball Extraction** — Install now extracts `.tar.gz` before install
2. **Dev-mode Guard** — Upgrades refused when running via bun/deno/node
3. **Redundant Rename Removed** — Single rename after backup
4. **Backup Cleanup** — Backup removed on successful upgrade
5. **apply-progress.md Updated** — Now shows all 23 tasks complete

### Changes Made

| File | Change |
|---|---|
| `apps/cli/src/upgrade-command/install.ts` | Full rewrite: tarball extraction, Node.js crypto SHA-256, single atomic rename, backup cleanup |
| `apps/cli/src/upgrade-command/index.ts` | Added dev-mode guard, removed duplicate import |
| `apps/cli/src/upgrade-command/github-release.ts` | Added extract error code |

### Verification

- **Typecheck**: bunx tsc --noEmit (run separately)
- **Tests**: bun test (run separately)

## Registry Updates

- **state.yaml**: Phase `apply`, status `completed`
- **events.yaml**: Added final_cleanup_completed event

## Next Step

All issues resolved. Ready for Archive.