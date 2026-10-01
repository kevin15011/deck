# Working Brief: macOS Release Signing and Local Build Readiness

## Intent and authorization

Repair the macOS release path after `v0.4.0` published unsigned Darwin binaries that Apple Silicon terminates before Deck can start. The user authorized implementation and complete local verification. Stable tagging, pushing, publication, and replacement of existing `v0.4.0` assets are not authorized without a separate confirmation.

Base: `fefa543f691f82e79cc13b1ca7e35d37cf386738`.

## Observed failure

1. `.github/workflows/release.yml` invokes `bun build --compile` directly and bypasses the existing `codeSign()` path in `scripts/build-binaries.ts`.
2. The installed arm64 Mach-O reports `code object is not signed at all` and `invalid or unsupported format for signature`; `deck version` is terminated with `SIGKILL`.
3. `bun run canary:install` reaches compilation before detecting absent workspace dependency links and reports unresolved `@deck/adapter-codex` and `@deck/provider-tavily` imports.
4. Local generation requires Bun 1.3.12, but the repository has no developer-facing toolchain pin and `CONTRIBUTING.md` only says to use a current Bun runtime.
5. Installer verification discards the candidate exit status when command output is empty, producing an unactionable error before rollback.

## Acceptance

1. Release jobs MUST invoke the same target-aware build implementation used by local release builds rather than duplicate compilation and packaging commands.
2. Darwin builds MUST be ad-hoc signed and MUST pass `codesign --verify` before archive creation; signing or verification failure MUST abort the build.
3. The workflow MUST verify each extracted archive and MUST run `deck version` whenever the runner architecture matches the artifact architecture.
4. The Darwin installer MUST reject a candidate with an invalid code signature before backing up or replacing an existing binary.
5. Installer smoke failures MUST retain the process exit status and identify signal 9 for status 137 when no diagnostic output exists.
6. Canary installation MUST detect unresolved workspace dependencies before compilation and direct the developer to `bun install --frozen-lockfile` without installing dependencies implicitly.
7. The repository MUST expose one Bun 1.3.12 toolchain contract consistently through local metadata, contributor documentation, generation guards, and every release job.
8. Focused tests, TypeScript, shell syntax, the full suite, and a real Darwin arm64 compile/sign/archive/install smoke MUST pass before release preparation.

## Decisions and boundaries

- Extend `scripts/build-binaries.ts` with one exact `--target` selector and make the release matrix consume its archive and checksum outputs.
- Keep ad-hoc signing as the existing distribution policy; notarization and Developer ID signing remain out of scope.
- Fail closed on signing problems. A warning is insufficient for a release artifact that cannot execute on Apple Silicon.
- Do not mutate or republish `v0.4.0`. Prepare source for a new patch release after verification.
- Do not auto-run `bun install`, change the user's global Bun, edit shell profiles, or replace the user's installed stable Deck binary during implementation.

## Verification and rollback

The workflow and installer are release security boundaries. Regression tests will first fail against the duplicated unsigned path, then verify strict signing, dependency readiness, toolchain consistency, and pre-replacement rejection. Rollback is a normal revert of this focused source change; no release asset or user installation is modified as part of implementation.

## Progress

- Root cause reproduced from the installed binary and localized to workflow drift from the canonical build script.
- The canonical build now removes Bun 1.3.12's malformed Mach-O placeholder signature, applies an ad-hoc signature, verifies it, archives it, and emits a checksum. The release workflow consumes that path and verifies the extracted artifact before upload.
- Stable and canary binaries embed immutable build metadata. A hostile runtime `DECK_COMPILED_BUILD_*` environment did not alter the signed stable binary's reported `0.4.0` metadata during pre-version-bump verification.
- The installer verifies Darwin signatures before backup/replacement and reports status 137 as `SIGKILL`. Canary installation now reports missing workspace packages before compilation.
- Bun 1.3.12 is pinned in `.bun-version`, `package.json`, the release workflow, contributor guidance, and shared generator guards. Bun 1.3.11 was verified to fail before mutating generated build metadata.
- macOS portability repairs cover signed compiled smokes, canonical temporary paths, BSD tar fixtures, platform-specific release fixtures, deterministic TUI MCP writes, and runner PAT sanitization. These were required to obtain an honest native macOS broad gate.
- Native Darwin arm64 canary and release archive smokes passed: code signature verification, checksum verification, extraction, transactional local installation, and `deck version` all succeeded from temporary paths without replacing the user's stable binary.
- Final broad verification with isolated Bun 1.3.12 on macOS arm64 passed: 4,887 tests, two existing skips, zero failures across 314 files; TypeScript, shell syntax, and diff whitespace checks also passed.
- Source is prepared as `v0.4.1`. Tag creation, push, GitHub release publication, and mutation of existing `v0.4.0` assets remain unexecuted pending the explicit remote-effect gate.
