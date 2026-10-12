# Apply Progress: Cross-Runner Session Core

## Stage S0 — Contracts and configuration (2026-10-12)

Branch `fix/claude-model-config-blocked-plan`; commits are conventional and local only (nothing pushed).

| Task | Status | Evidence |
|---|---|---|
| 0.1 events + validator | done | `packages/core/src/session/events.ts`; `events.test.ts` |
| 0.2 commands + validator | done | `commands.ts`; `commands.test.ts` |
| 0.3 redaction | done | `redaction.ts` (Pi `clean()` rules ported, no Pi import); `redaction.test.ts` |
| 0.4 qualified assignments | done | `assignments.ts`; flat `DeveloperTeamModelAssignments` untouched; `tsc` clean |
| 0.5 driver interface | done | `driver.ts` (types only) + optional `getSessionDriver?()` on `RunnerAdapter`; `driver.test.ts`, `runner-adapter.test.ts` pass |
| 0.6 child MCP set | done | `mcp.ts` (`computeChildMcpSet`); `mcp.test.ts` |
| 0.7 `crossRunner` config | done | `deck-config.ts` (+ `CROSS_RUNNER_CONFIG_INVALID`, `CROSS_ASSIGNMENT_LEGACY_SHAPE` via `diagnoseDeckConfigDeprecations`); tests in `config/deck-config-cross-runner.test.ts` (new file, not appended to `deck-config.test.ts`) |
| 0.8 downgrade check | done | see finding below |
| 0.9 JSON Schemas | done | `session/schema.ts`, `scripts/generate-session-schemas.ts` (idempotent, wired into `prepareStandaloneBinaryBuild` and the dry-run/build loop), `schema.generated.ts`; `schema.test.ts` compares schema with validators on a fixture set |
| 0.10 Codex 0.162.1 audit | done, no adapter fix needed | `packages/adapter-codex/src/codex-0162-compat.test.ts` + `__fixtures__/codex/release-0.162.1.ts` |
| 0.11 BIN gate | partial | see below |

Process note: for 0.9 the generator was written before its idempotency test (the snapshot/validator test was written first and failed until the generator ran). All other tasks were red-first.

### Findings and deviations

1. **0.8 downgrade behavior (design D-5 assumption was wrong).** Pre-change `validateDeckConfig` rejects any unknown top-level key with `DECK_CONFIG_UNKNOWN_FIELD`; it neither preserves nor drops it. A binary without this change cannot read a `config.json` that contains `crossRunner`. Proposal rollback text updated; D-5 in `design.md` still says "drop" and should be reworded (not edited here). Pinned by a test on an arbitrary unknown key.
2. **`DriverProtocol` is `string` in core, not the literal union of design 3.1/4.** The core-purity audit forbids concrete runner strings in core source; drivers declare their protocol ids.
3. **`schema.generated.ts` is force-added** (`git add -f`) because `*.generated.ts` is gitignored; `content.generated.ts` is tracked the same way. Tests import it, so a clean checkout needs it tracked.
4. Doctor suggestion text now branches on the diagnostic code (it hardcoded a Supermemory message).
5. **0.10:** audit found nothing to fix. Executable detection is PATH-based (`codex` shim), so the vendor layout move (`.../codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`) is irrelevant to Deck; version parse, exec/resume/`--last`, `--dangerously-bypass-hook-trust`, features (hooks, multi_agent stable) and `debug models --bundled` parsing all pass on real captured output (model ids are provider-qualified `openai-codex/<slug>`). The duplicate-hook coexistence diagnostic (`codex-hooks-json-coexistence`) is covered by an existing test (`developer-team-install.test.ts:409`); the 0.162.1 runtime warning itself is not parsed by Deck.
6. Task 0.10 "manual `deck-canary codex developer` launch" was **skipped** by instruction.

### Verification evidence

Environment: macOS; `TMPDIR` pointed at a non-symlinked path because `/var/folders` is a symlink and 15 pre-existing config tests fail with `DECK_CONFIG_UNSAFE_PATH` otherwise (host quirk, unrelated).

- `bunx tsc --noEmit`: 0 errors.
- Focused: `bun test packages/core/src/session packages/core/src/config packages/core/src/runner-adapter.test.ts packages/adapter-codex/src apps/cli/src/doctor-command scripts` all pass.
- Full: `bun test --timeout 30000` on the branch: 5824 pass, 4 fail (before the purity fix). Same command on the pre-change commit `144f6ea` (temporary worktree): 5754 pass, 3 fail. The 3 are pre-existing and not caused by this change:
  - `external/skills content > generated bundle is idempotent` (needs Bun 1.3.12; host has 1.3.11)
  - `production Deck preference source audit > forbids argv-dependent config behavior in runner adapters` (flags `packages/adapter-pi/src/pi-extensions/subagents/supervisor.ts`, existing wip Pi commit)
  - `runRunnerLaunch ... OpenCode uses the exact SSH-alias profile ...` (Supermemory project tag)
  The 4th (core purity: `opencode` literal in `session/events.ts`) was new, introduced by this change, and fixed in the last commit; core purity and session tests then pass.
  Baseline ledger says 4020 pass/0 fail (2026-07-28); it is stale versus the current tree (5754 pass at HEAD~ with 3 failures).
- Smoke (source, not compiled): with temp `HOME`/`XDG_*`, `doctor` loads a config with `crossRunner` (global config "ready"; legacy bare-string member yields the `CROSS_ASSIGNMENT_LEGACY_SHAPE` warning).

### BIN gate — what was and was not run

- Run: `tsc`, affected tests, full test suite, source-level doctor smoke.
- `bun run scripts/build-binaries.ts --dry-run`: **failed before building** in the pre-existing `generate-runner-execution-assets` step (requires Bun 1.3.12 per `.github/workflows/release.yml`, host has 1.3.11). The session-schema generation step runs after it and was verified separately. No binary was built, so compiled-binary smoke (`deck --version`, repo-path-absence, unreadable-repo run) is **not done**.
- Not run: 4-target build, Docker Linux smoke, `canary:install`.
- Blocker for completing BIN: a Bun 1.3.12 toolchain on the host.
