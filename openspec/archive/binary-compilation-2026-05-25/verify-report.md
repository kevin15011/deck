# Verify Report: binary-compilation

## Summary

**Overall Result**: FAIL  
**Tasks Complete**: 23 / 23 per `apply-progress.md`  
**Tests**: 1650 pass / 37 fail (`bun test`)  
**Build**: FAIL (`bun run --cwd apps/cli build:binary --dry-run`)  
**Typecheck**: FAIL (`bunx tsc --noEmit`)

## Task Completion

| Source | Result |
|---|---|
| `apply-progress.md` | ✅ Completed Tasks (23/23) |
| `state.yaml` pre-verify | ❌ phase `review`, status `approved_with_changes`; not requested phase `apply`, status `completed` |

## Test Results

| Test Suite | Pass | Fail | Notes |
|---|---:|---:|---|
| Full suite: `bun test` | 1650 | 37 | Exit 1 |
| Upgrade command targeted: `bun test apps/cli/src/upgrade-command` | 30 | 0 | Tarball extraction path covered by implementation inspection and targeted suite |
| Binary smoke/pi targeted | 12 | 2 | `--version` and `--doctor` binary smoke tests fail |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | ❌ FAIL | `build:binary --dry-run` fails compiling linux-x64: `Could not resolve: "./install-plan"`; `Could not resolve: "react-devtools-core"` |
| Typecheck | ❌ FAIL | `bunx tsc --noEmit` exits 2; errors include `adapter-opencode/src/install-tools.ts`, `adapter-opencode/src/preflight.ts`, `adapter-opencode/src/runner-capabilities.test.ts`, `adapter-pi/src/runner-capabilities.ts` |

## Compliance Matrix

| Requirement | Status | Verification Method | Notes |
|---|---|---|---|
| REQ-sbd-001 | ❌ FAIL | Build dry-run | Standalone binary build does not complete. |
| REQ-bsu-001 | ✅ PASS | Targeted tests + code inspection | Upgrade detects newer versions. |
| REQ-bsu-002 | ✅ PASS | Targeted tests + code inspection | Checksum failure code/path present. |
| REQ-bsu-003 | ✅ PASS | Targeted tests | `--yes` flag accepted. |
| REQ-bsu-004 | ✅ PASS | Targeted tests + code inspection | Rollback/backup restore path present. |
| REQ-bsu-005 | ✅ PASS | Code inspection | Downgrade refusal implemented. |
| REQ-bsu-006 | ⚠️ WARN | Code inspection | Tarball extraction added, but full suite/build still fail; extraction has no direct passing integration install test. |
| REQ-bsr-001 | ✅ PASS | Code inspection | Generated bundled skill content exists. |
| REQ-bsr-002 | ✅ PASS | Code inspection | Runtime skill bundle accessor present. |
| REQ-bsr-003 | ✅ PASS | Code inspection | Runtime avoids repo-relative skill reads. |
| REQ-bsr-004 | ⚠️ WARN | Full tests | Missing-skill related test fails: `verifyOpenCodeDeveloperTeamInstall > fails when skill file is missing`. |
| REQ-bvm-001 | ✅ PASS | Code inspection | Build-info generation script present. |
| REQ-bvm-002 | ⚠️ WARN | Targeted binary smoke | `--version` smoke test fails. |
| REQ-bvm-003 | ✅ PASS | Code inspection | Platform/version metadata path present. |
| REQ-cpl-001 | ⚠️ WARN | Tests | Pi-launch targeted suite has binary smoke failures. |
| REQ-cpl-002 | ✅ PASS | Code inspection | Runtime process wrapper uses `child_process`. |
| REQ-cpl-003 | ⚠️ WARN | Typecheck | `install-tools.ts` process wrapper typings fail. |
| REQ-rcr-001 | ⚠️ WARN | Full tests | `resolveProjectRoot` tests fail. |
| REQ-rcr-002 | ✅ PASS | Code inspection | Global config resolution path present. |
| REQ-rcr-003 | ✅ PASS | Code inspection | Project-root fallback logic present. |
| REQ-rcr-004 | ⚠️ WARN | Full tests | Config read/write tests fail. |
| REQ-rcr-005 | ⚠️ WARN | Full tests | Config/provider fallback tests fail. |
| REQ-doc-001 | ⚠️ WARN | Targeted binary smoke | `--doctor` binary smoke test fails. |
| REQ-doc-002 | ✅ PASS | Code inspection | Doctor diagnostic types/report updates present. |
| REQ-doc-003 | ✅ PASS | Code inspection | Diagnostic reporting path present. |
| REQ-doc-004 | ✅ PASS | Code inspection | Missing skill diagnostic path present, but related full test failure noted under REQ-bsr-004. |
| REQ-pil-001 | ⚠️ WARN | Targeted tests | Pi-launch suite partially passes; binary smoke failures remain. |
| REQ-pil-002 | ⚠️ WARN | Targeted tests | Pi-launch not fully verified due smoke failures. |

## Findings

### CRITICAL

- `bun test` fails: 1650 pass / 37 fail. Reproduce: `bun test`.
- Typecheck fails. Reproduce: `bunx tsc --noEmit`.
- Binary build fails. Reproduce: `bun run --cwd apps/cli build:binary --dry-run`.
- Registry pre-verify state does not match requested state: actual `state.yaml` was phase `review`, status `approved_with_changes`, not phase `apply`, status `completed`.

### WARNING

- Tarball extraction is present in `apps/cli/src/upgrade-command/install.ts`, but no successful end-to-end binary upgrade install was verified because build/full tests fail.
- Targeted binary smoke/pi tests fail 2 tests (`--version`, `--doctor`).

### SUGGESTION

- Add a direct tar.gz extraction/install integration test for `performUpgrade` with a local archive fixture.

## Open Questions

None.
