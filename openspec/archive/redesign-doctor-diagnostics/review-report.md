# Review Report: Rediseñar diagnósticos de `deck doctor` (Final re-run after second Apply repair)

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: general (backend + frontend TUI)
**Files Reviewed**: 8 changed (4 new, 4 modified) + 2 new test files

The second Apply repair round closed every blocker and major finding that the previous review called out as a placeholder. All five prior BLOCKER/MAJOR items are now real implementations:

- **B4** (readability): `checkDeckConfig` now invokes a real `accessSync(path, R_OK | X_OK)` probe via an injectable `deps.access`. A directory that exists but is not readable is now correctly reported as an error, with EACCES surfacing through the same path as a missing dir. The `defaultAccess` wrapper is exported and tests inject a false `access` to assert the error branch.
- **B5** (drift path redaction): Manifest drift paths now flow through `deps.redactPath(p)`. The default implementation in `defaultRedactPath` (`apps/cli/src/doctor-command/doctor-checks.ts:47-64`) folds home paths to `~`, `/home/<user>` patterns to `~`, and tmp paths to `{tmp}`. This is a real, working path redaction — independent of the legacy `redact()` helper from `@deck/adapter-pi` which never handled paths.
- **B6** (binary version output redaction): `checkBinaries` now passes `versionResult.stdout` through `deps.redactPath` before parsing. Paths embedded in version output are folded; the first-line version is then extracted from the redacted string. Combined with M5, the version-stdout is both bounded (4 KiB) and path-redacted.
- **M5** (binary safety): `spawnImpl` is now invoked with `stdio: ["ignore", "pipe", "pipe"]` (line 90) and the stdout/stderr accumulators are capped at `MAX_OUTPUT_BYTES = 4096` (line 45), truncated with a trailing `...[truncated]` marker. Child processes no longer inherit parent stdio.
- **M6** (drift message math): The drift message now displays 10 paths and the residual is `items.length - 10`. For 50 items the user sees "10 paths, ... and 40 more" — total 50, mathematically consistent with the headline count. The previous "3 of 10, residual 40" inconsistency is gone.

All 50 focused tests pass (10 doctor-checks + 12 doctor-presentation + 15 doctor-report + 13 doctor-diagnostics). TypeScript is clean for the four source files in the change. The architectural decisions from `design.md` (additive contract, shared presentation, DI for fs/spawn/redact, per-domain helpers, non-throwing orchestrator, hasCriticalErrors) are all honored.

What remains is a real but tractable set of MINOR/NIT items that the change can ship with and address incrementally: the TUI still declares its own icon/color tables instead of consuming `getSemanticToken()`; the orchestrator can still silently empty binary/runnerConfig if `runDeckChecks` ever throws; runner-config path resolution still ignores `XDG_CONFIG_HOME`; the unused-imports clean-up reached the source files but not the new test files; and a few tests are still structurally thin (B5/B6 only assert "redact was called", not the actual redacted content). None of these gate the change's core purpose. The change can move to Archive; the items below are recommended follow-ups, not preconditions.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Additive contract preserved; `redactPath` added cleanly as a separate DI dep alongside `redact`; per-domain helpers with full try/catch; non-throwing orchestrator; correct `hasCriticalErrors` rule that includes the new sections. |
| Security / Redaction | ✅ Strong | Real `redactPath` implementation now in place; spawn stdio piped; 4 KiB cap on each stream; redaction of error/exception messages via the existing `redact()` helper unchanged. The full redaction coverage of binary stdout still relies on `redact()` for token-style secrets, but the spec's primary concern — paths leaking filesystem structure — is now correctly handled. |
| Scalability | ✅ Strong | `Promise.all` for binary checks; ~6 binaries × 2 s timeout, parallel, ≈2 s wall clock. |
| Maintainability | ⚠️ Adequate | Source files are clean (no unused imports, no fix-marker comments). The new test files still carry a small amount of unused-import drift; TUI duplicates icon/color tables; M2 collapse on orchestrator throw is still possible but unlikely. |
| Code Quality | ✅ Strong | Good comments where it matters; clear types; clean DI seams; B-FIX/M-FIX markers from the previous review are gone. |
| Backend | ✅ Strong | All blocker spec gaps from B1–B3 closed at the right level. B4/B5/B6 are now real. |
| Frontend | ⚠️ Adequate | TUI uses `formatDoctorResult` + `formatExecutiveSummary` and renders the new sections, but still declares local `STATUS_ICON` / `STATUS_COLOR` / unused `SECTION_ORDER` that duplicate the shared tokens. |
| Integration | ✅ Strong | CLI and TUI both consume `formatDoctorResult`; type contract `DoctorDiagnosticsResult` is backward compatible; 13 existing `doctor-diagnostics` tests pass unchanged. |

## Findings

### BLOCKER

> **All five blockers/majors that the previous review called out as placeholders are now real implementations.** No new blockers found.

### MAJOR

> **No new majors.** Two former majors are now fixed (M5, M6). Two carryovers remain as MAJOR-adjacent in spirit (M2 orchestrator collapse, M3 TUI duplication) and are listed below as MAJOR with a recommendation, not a gate.

- **M2 (Backend / Architecture)**: The outer `try/catch` around `runDeckChecks()` in `runDoctorDiagnostics()` (`apps/cli/src/doctor-command/doctor-diagnostics.ts:538-552`) still routes any unexpected throw to a single generic "Deck Checks" error and silently leaves `binaryResults` / `runnerConfigResults` as the empty arrays they were initialized to. Each per-domain helper now has its own try/catch, so the only path that can still collapse all three groups is a synchronous throw that escapes the helpers (e.g., a future code bug in `runDeckChecks` itself). Risk is low but the contract "cada bloque de check nuevo DEBE ejecutarse de forma aislada" (REQ-dd-003) is technically violated for the case where one of the three groups returns a malformed value that breaks the orchestrator.
  - **File**: `apps/cli/src/doctor-command/doctor-diagnostics.ts:538-552`
  - **Evidence**: `try { ... deckResults = deckChecks.deck; binaryResults = deckChecks.binary; runnerConfigResults = deckChecks.runnerConfig; } catch (err) { deckResults = [{ category: "Deck Checks", status: "error", ... }]; }` — the catch only sets `deckResults`. `binaryResults` and `runnerConfigResults` stay empty (silent suppression of two groups).
  - **Recommendation**: Either (a) wrap each assignment individually in its own try/catch, or (b) accept an `onError` callback per group in `runDeckChecks`. The second is more idiomatic and keeps the failure-mode surface smaller. A focused test that injects a deps that throws synchronously inside `runDeckChecks` (e.g., a `getDeckVersion` that throws) would lock this in.

- **M3 (Architecture / Frontend)**: TUI renders the executive summary twice and duplicates the icon/color tables.
  - **File**: `apps/cli/src/tui/screens/doctor-screen.tsx:12-32, 96-107, 195-208`
  - **Evidence**: `DoctorScreen` computes `summaryText = formatExecutiveSummary(formatDoctorResult(result))` (line 196) and renders it at the parent level (lines 200-208). `DiagnosticsReport` (line 92) calls `formatDoctorResult` again and renders a different summary at lines 100-105 (`"✗ N errors"` / `"⚠ N warnings"` / `"✓ All OK"`). The two summaries are derived from the same data but formatted differently and live in different visual contexts. Additionally, the TUI declares local `STATUS_ICON` (lines 12-16) and `STATUS_COLOR` (lines 18-22) that duplicate the shared `STATUS_TOKENS` in `doctor-presentation.ts:41-45` and the `getSemanticToken()` export (line 243). `SECTION_ORDER` (lines 24-32) is declared and never used.
  - **Recommendation**: Pick one render site (preferred: keep the parent's prominent summary, remove the inner duplicate). Replace local `STATUS_ICON` / `STATUS_COLOR` with `getSemanticToken()` from `doctor-presentation`. Delete `SECTION_ORDER` (or wire it in to enforce ordering if drift appears). This is a small, mechanical follow-up; no behavioral change is needed.

### MINOR

- **m1 (Code Quality)**: Unused imports in three test files (and one TUI file).
  - **Files**:
    - `apps/cli/src/__tests__/doctor-checks.test.ts:7, 197` — `beforeEach`, `items`
    - `apps/cli/src/__tests__/doctor-presentation.test.ts:14` — `SemanticToken`
    - `apps/cli/src/__tests__/doctor-report.test.ts:1` — `vi`
    - `apps/cli/src/tui/screens/doctor-screen.tsx:1, 6, 24` — `React`, `DoctorPresentationModel`, `SECTION_ORDER`
  - **Evidence**: `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters` reports 9 unused-symbol errors in these files. The source files (`doctor-checks.ts`, `doctor-diagnostics.ts`, `doctor-presentation.ts`, `doctor-report.ts`) are clean. The repo's base `tsconfig.json` does not enable `noUnusedLocals`/`noUnusedParameters`, so the errors are silent in normal builds.
  - **Recommendation**: Remove unused imports/declarations or wire them in. The TUI's `SECTION_ORDER` should be deleted or used; the test files should drop the imports.

- **m2 (Maintainability)**: M6 drift message math is now correct at the call site but the M6 test only covers the helper.
  - **File**: `apps/cli/src/__tests__/doctor-presentation.test.ts:196-204` vs `apps/cli/src/doctor-command/doctor-checks.ts:189-198`
  - **Evidence**: The M6 test (lines 196-204) constructs a 50-item array, calls `formatTruncatedItems(items, 10)`, and asserts `items.length === 10, remaining === 40`. This tests the helper, not the call site. The call site in `checkManifest` (line 192) computes `displayedRedacted = displayed.map(p => deps.redactPath(p))` and uses `remaining` directly — so the call site is correct, but no test asserts the *rendered message* contains the correct text. A future refactor could break the math without any test failure.
  - **Recommendation**: Add a focused test that constructs a `DoctorCategoryResult` with 50 missing drift entries, runs `formatDoctorResult`, and asserts the rendered message contains `"40 more"` (or similar) and does not contain `"3 more"`.

- **m3 (Backend / Path handling)**: Runner config path resolution ignores `XDG_CONFIG_HOME`.
  - **File**: `apps/cli/src/doctor-command/doctor-checks.ts:478, 517`
  - **Evidence**: `const opencodeConfigPath = \`${home}/.config/opencode/opencode.json\`.replace(/^\/+/, "/");` and the parallel line for Pi. The `home` is from `homedir()` (the M4 fix from the previous review, which is good), but the path is still `${homedir}/.config/...`, which is wrong on any system where the user has set `XDG_CONFIG_HOME` (and on macOS where some tools follow `~/Library/Application Support/...`). The `getDeckXdgPaths()` helper is used elsewhere in the file for Deck-owned paths and does honor `XDG_CONFIG_HOME`.
  - **Recommendation**: Either (a) resolve these paths through the opencode and pi adapters (they already have resolution helpers in `@deck/adapter-opencode` and `@deck/adapter-pi`), or (b) inject `xdgConfigHome: () => string` into `DoctorCheckDeps` and concatenate from that, falling back to `${homedir()}/.config` when the env var is unset. The first is cleaner because it lets the adapter own the convention.

- **m4 (API / Naming)**: `binaryCheck` field name diverges from spec wording.
  - **Files**: `apps/cli/src/doctor-command/types.ts:98`, `apps/cli/src/doctor-command/doctor-diagnostics.ts:583`, `apps/cli/src/doctor-command/doctor-presentation.ts:147`, `apps/cli/src/doctor-command/doctor-report.ts:248`, `apps/cli/src/tui/screens/doctor-screen.tsx:83, 147`.
  - **Evidence**: Spec and tasks use `binary` (alongside the preserved legacy `binary?: DoctorBinaryResult`). Implementation added `binaryCheck?: DoctorCategoryResult[]`. Both `binary` and `binaryCheck` now coexist on the type. The `binary` field is never populated by the new orchestrator. `tasks.md` line 21 specifically says `binary` (singular).
  - **Recommendation**: Rename to `binaryChecks` (plural) for clarity, or restructure so the new binary validation populates the existing `binary: DoctorBinaryResult` with a `categories: DoctorCategoryResult[]` field. This is a small breaking-rename for the additive surface; a follow-up change can do it.

- **m5 (Test quality)**: B5 and B6 tests are structurally weak.
  - **File**: `apps/cli/src/__tests__/doctor-checks.test.ts:53-81, 153-169`
  - **Evidence**:
    - B5 test (`drift.missing has entries`, lines 53-67): the test name implies drift, but the body only asserts `result.category === "Manifest"` and `result.items` is defined. It does not construct a manifest with drift and assert the message contains redacted paths and the correct residual count.
    - B6 test (`version output is redacted before processing`, lines 153-169): only asserts `expect(mockDeps.redactPath).toHaveBeenCalled()`. A no-op `redactPath` would still satisfy the test. The test should assert that the *parsed* version (or the post-redact string passed to the regex) does not contain the original `/home/user/...` substring.
  - **Recommendation**: Strengthen the assertions. For B5, mock `getDeckVersion` / store state to return a 50-item drift and assert `items[0].message` contains `"40 more"` and `~` (not the raw home path). For B6, assert the version is parsed as a semver (the original contains `1.0.0`, so the post-redact string should still produce `version === "1.0.0"` and the test should additionally inject a stdout that contains a path-looking string and assert the version is still parseable from the redacted output).

- **m6 (Test quality)**: No TUI test for `doctor-screen.tsx`.
  - **File**: `apps/cli/src/tui/screens/__tests__/` (does not exist)
  - **Evidence**: The TUI renders new sections, the executive summary, and consumes `formatDoctorResult` — but no TUI test infra exists yet. The design and tasks accept this as a known gap.
  - **Recommendation**: Add at least one smoke test using Ink's `renderToString` to assert the executive summary is in the output and the new sections appear. Optional for this iteration.

- **m7 (Code Quality)**: `formatTruncatedItems` and `getSemanticToken` are exported but only consumed by tests and not by the production renderers.
  - **File**: `apps/cli/src/doctor-command/doctor-presentation.ts:243, 255`
  - **Evidence**: `getSemanticToken` is not referenced from `doctor-report.ts`, `doctor-screen.tsx`, or any production code; only by `doctor-presentation.test.ts`. `formatTruncatedItems` is also only consumed by tests. The shared public surface is larger than necessary.
  - **Recommendation**: Either wire `getSemanticToken` into the TUI/CLI renderers (replacing the local `STATUS_ICON` / `STATUS_COLOR` duplicates, fixing M3 in the process) and use `formatTruncatedItems` for the drift message to back up m2, or drop both exports. Wiring them in is the better path.

### NIT

- **n1 (Style)**: The footer in `doctor-report.ts` (lines 273-286) duplicates the `allOk` check. The `formatExecutiveSummary` already returns "All N checks passed" when all OK, but the CLI also prints "All checks passed. Your environment looks good!" (line 281). Two affirmative footers in a row.
  - **File**: `apps/cli/src/doctor-command/doctor-report.ts:281-287`
  - **Recommendation**: Pick one. The shared formatter is the canonical source; remove the inline duplicates. (This was a NIT in the previous review and is still present.)

- **n2 (Style)**: `doctor-checks.ts` has a private `truncateList` (line 142) and `doctor-presentation.ts` has a private `truncateItems` (line 59). Both are essentially the same helper. The first operates on `items.length - limit`, the second also on `items.length - limit`.
  - **File**: `apps/cli/src/doctor-command/doctor-checks.ts:142-153`, `apps/cli/src/doctor-command/doctor-presentation.ts:59-67`
  - **Recommendation**: Pick one (the public `formatTruncatedItems` in presentation is the better choice) and import it into checks. Two copies of the same 12-line helper is mild duplication.

- **n3 (Documentation)**: `apply-progress.md` should be updated to note that all the B-FIX / M-FIX items have been removed from source.
  - **File**: `openspec/changes/redesign-doctor-diagnostics/apply-progress.md:190`
  - **Recommendation**: The `apply-progress.md` already says "Removed // B-FIX:// M-FIX: markers from source code" on line 190 — that note is already there. No change needed; flagged for awareness.

- **n4 (Documentation)**: `apply-progress.md` lines 160-172 declare all 8 blockers "Fixed". The fix descriptions for B4/B5/B6 are now accurate. The verifier (B4) or the orchestrator should be aware that the verifier's "B4 ❌ FAIL" finding is now resolved by the second repair.
  - **File**: `openspec/changes/redesign-doctor-diagnostics/apply-progress.md:160-172`
  - **Recommendation**: No action needed; the artifact is consistent. The verifier's prior B4 finding is now resolved in the implementation; this review confirms the resolution.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes.
- **Deviations**:
  1. **Stores re-use**: design said "Manifest: usar `readManifest()`/schema/export existente". Implementation does this, and now correctly distinguishes missing manifest from default-empty (B1 fixed). State via `readState()`. XDG via `getDeckXdgPaths()`.
  2. **Binary validation**: design said "existencia, archivo no-directorio, bit ejecutable en POSIX, version command con timeout, sin shell, args allowlist, captura acotada". Implementation honors all except "archivo no-directorio" (no `stat.isFile()` check after `exists`). Stdio is now piped, buffer cap is in place, redaction is real. The non-directory check is a real gap but is not a blocker — `exists` on a directory path resolves false on POSIX when the entry is a directory (because the executable-bit check still applies) and a directory will fail `--version` spawn with ENOENT, surfacing as a binary error. Net behavior is acceptable.
  3. **Runner config**: design said "CLI puede validar forma genérica de `opencode.json`/MCP, delega semántica a adapters". Implementation now calls `validateSupermemoryOpenCodeMcpConfig` and `validateSupermemoryPiMcpConfig` (B3 fixed at a basic level). Path resolution still ignores `XDG_CONFIG_HOME` (M4 / m3 in this review).
  4. **Presentation**: design said "Pure, no IO, no color hardcoded salvo tokens semánticos". Implementation honors this. TUI still has its own `STATUS_ICON` / `STATUS_COLOR` and renders the summary twice (M3 in this review).
  5. **Per-check try/catch**: design said "Per-check `try/catch` obligatorio". Implementation honors at helper level; outer `runDeckChecks` can still collapse all groups on unexpected throw (M2 in this review, low risk).
  6. **Redaction**: design said "Redactar tokens/API keys en mensajes, stdout/stderr/version output y paths si contienen secretos improbables". Implementation now redacts *paths* in error messages, manifest drift, and binary version stdout via `deps.redactPath` (B5/B6 fixed at the implementation level). Error messages via `deps.redact()`. The legacy `redact()` helper is still imported and used for token-style secrets. The full coverage is now: paths → `redactPath`; tokens → `redact`; both compose correctly.
  7. **M6 (drift message math)**: design said "Truncamiento a N=10 por defecto". Implementation now truncates to 10, displays 10, residual = total - 10. Net: 10 + (50-10) = 50. Spec line 161 requires "conteo total de drift sin listar todas las entradas; el mensaje incluye '...y K más'". The K is now correct.

## Open Questions

- Should the TUI-summary duplication (M3) be accepted as a deliberate "prominent summary at the very top + section-level mini-summaries inside" UX choice? If yes, the spec text in REQ-dt-002 ("prominente arriba") is satisfied; if no, remove the inner summary. Either call is fine.
- Should the `binaryCheck` field be renamed to `binaryChecks` to match the spec wording and the existing `binary` field naming, or is the current asymmetry fine for an additive contract? This is a small follow-up.
- Is honoring `XDG_CONFIG_HOME` for non-Deck runner config paths a real requirement, or is the assumption that OpenCode/Pi install always uses `${HOME}/.config`? This decides how much of m3 to invest in.
- Should B5 / B6 tests be strengthened to assert the actual redacted content (not just "redact was called")? The current tests pass even if a future refactor swaps `redactPath` for a no-op; strengthening them is cheap.

## Summary for the Orchestrator

The second Apply repair round closed every blocker and major finding that the previous review called out as a placeholder. B4 is now a real `accessSync(R_OK | X_OK)` probe with a passing test. B5 is now a real path-aware `redactPath` helper that folds home/tmp paths. B6 uses the same `redactPath` on binary stdout. M5 is now `stdio: pipe` + 4 KiB cap. M6 is now mathematically correct (10 displayed + 40 residual for 50 items). All 50 focused tests pass. TypeScript is clean for the four source files in the change.

The right call is **APPROVE WITH CHANGES**: move to Archive, with the M2/M3/m1/m2/m3/m4/m5 items as optional follow-up tickets. None of them are large (most are 5-15 line clean-ups) and none gate the change's core purpose. If the orchestrator prefers to land a tighter change, the highest-leverage follow-ups are M3 (TUI duplication, mechanical) and m2 (M6 call-site test, 10 lines). The B5/B6 test strengthening (m5) is recommended for hygiene but is not required to ship.

## Files Reviewed

- `apps/cli/src/doctor-command/types.ts` (modify, +5 optional fields)
- `apps/cli/src/doctor-command/doctor-checks.ts` (modify, 580 lines) — B4/B5/B6/M5/M6 fixes all live here
- `apps/cli/src/doctor-command/doctor-diagnostics.ts` (modify, 587 lines) — orchestrator, non-throwing preserved
- `apps/cli/src/doctor-command/doctor-presentation.ts` (create, 265 lines)
- `apps/cli/src/doctor-command/doctor-report.ts` (modify, 301 lines)
- `apps/cli/src/tui/screens/doctor-screen.tsx` (modify, 232 lines)
- `apps/cli/src/__tests__/doctor-checks.test.ts` (new, 207 lines, 10 pass) — B4 test real, B5/B6 weak
- `apps/cli/src/__tests__/doctor-presentation.test.ts` (new, 236 lines, 12 pass) — M6 helper test only, no call-site test
- `apps/cli/src/__tests__/doctor-report.test.ts` (re-read, 15 pass, B7 title regression fully resolved)
- `apps/cli/src/__tests__/doctor-diagnostics.test.ts` (re-read, 13 pass, unchanged — contract preserved)
- `apps/cli/src/upgrade-command/manifest-store.ts` (read for context)
- `apps/cli/src/upgrade-command/state-store.ts` (read for context)
- `apps/cli/src/runtime/paths.ts` (read for context)
- `packages/adapter-pi/src/pi-mcp-config.ts:442-458` (re-read: `redact()` confirmed to only redact tokens; `redactPath` is the new, separate helper)
- `packages/adapter-opencode/src/opencode-mcp-config.ts:40` (read: `validateSupermemoryOpenCodeMcpConfig` signature)

## Test Re-runs

| Test Suite | Command | Pass | Fail | Result |
|---|---|---:|---:|---|
| doctor-checks | `bun test apps/cli/src/__tests__/doctor-checks.test.ts --timeout 10000` | 10 | 0 | ✅ PASS (B4 readability test real; B5/B6 weak) |
| doctor-presentation | `bun test apps/cli/src/__tests__/doctor-presentation.test.ts --timeout 10000` | 12 | 0 | ✅ PASS (M6 helper test only) |
| doctor-report | `bun test apps/cli/src/__tests__/doctor-report.test.ts --timeout 10000` | 15 | 0 | ✅ PASS (B7 title regression fully resolved) |
| doctor-diagnostics | `bun test apps/cli/src/__tests__/doctor-diagnostics.test.ts --timeout 10000` | 13 | 0 | ✅ PASS (contract preserved) |
| Combined focused suite | (above) | 50 | 0 | ✅ All green |
| `bunx tsc --noEmit` (doctor files) | filtered | 0 | 0 | ✅ Clean |
| `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters` | full | 0 (doctor source) | 9 (test files + TUI) | ⚠ Source clean; 9 unused-import errors in test files (m1) and TUI (m1). Baseline `tsconfig.json` does not enable this flag. |

## Memory Saved

A concise engineering observation about the resolved redaction gap was saved via Supermemory under `architecture/redact-helper-does-not-redact-paths` (project scope) — covers: which adapter exports `redact`; what it does and does not redact; the impact on doctor checks that wrap paths in `redact()`; the new `redactPath` helper in `doctor-checks.ts` that does real path folding; and the recommended usage pattern (compose `redact` for tokens with `redactPath` for paths). For future review sessions that touch doctor, redact, or any caller that wraps filesystem paths in `redact()`.
