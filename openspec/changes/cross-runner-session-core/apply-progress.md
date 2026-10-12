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

## S0 BIN gate follow-up (Lead, 2026-10-12)
- Host Bun is 1.3.11; the release toolchain pins 1.3.12 (`.bun-version`). Ran the build through `npx -y bun@1.3.12 run scripts/build-binaries.ts --dry-run` (npm cache only, no global change): darwin-arm64 build, codesign and tarball succeeded.
- Host smoke: tarball extracted to a temp dir; the binary started with `env -i`, fresh HOME/XDG and cwd, no repository access.
- The build regenerated the tracked Pi and OpenCode developer-team-execution bundles (they were stale versus source); committed as a regeneration.
- Still not run: 4-target build, Docker linux smoke, canary install (per stage rules).
- D-5 in design.md reworded: older binaries reject unknown `crossRunner` (DECK_CONFIG_UNKNOWN_FIELD).

## Stage S1a — Host core, no drivers (2026-10-12)

New package `@deck/session-host` (`packages/session-host`), plus hidden CLI routes `deck internal child-anchor|session-daemon|session-mcp`. Only a test-only stub service is used where a SessionManager/driver would be (`src/testing/stub-service.ts`, not exported). S1b (Claude driver, SessionManager, `deck cross`/`deck session`) is untouched.

| Task | Status | Evidence |
|---|---|---|
| 1.1 scaffold + import boundary | done | `import-boundary.test.ts` (RED shown with a planted adapter import) |
| 1.2 paths and permissions | done | `paths.ts`; 0700/0600, strict tmp-fallback dir, Darwin 104-byte `sun_path` fallback to `$TMPDIR/deck-<uid>/daemon.sock` (unit tests + a real daemon process on a too-long state path) |
| 1.3 EventLog | done | `event-log.ts`; ordering, crash-truncated/NUL tail repaired with diagnostic, mid-file corruption and gaps fatal, rotation boundary reads, batched fsync (fake clock), failed-write rollback |
| 1.4 ledger + snapshot | done | `ledger.ts`; replay, legal task transitions, D-12 recorded-runner continuation, digest-verified snapshot with rebuild on corrupt/ahead/mismatch |
| 1.5 child anchor | done | `anchor.ts`, `supervisor.ts`, real fake-child (`bun` child + grandchild) integration tests: own process group, IPC loss and daemon SIGKILL kill the whole group, SIGINT reaches the CLI only, group TERM then KILL, drain timeout = failure (never success), no early exit before cleanup ack, nonce not leaked |
| 1.6 recovery | done | `recovery.ts`, `process-probe.ts`, `lease.ts`; synthetic Linux/Darwin leases, kill() typed to signal 0 and spy-asserted, static check that recovery sources contain no signalling; real daemon-crash integration test |
| 1.7 daemon + single instance | done | `daemon.ts`, `daemon-lock.ts`, `daemon-client.ts`, `daemon-main.ts`, `idle-monitor.ts`; second start exits "already running", racing starters/reclaimers, idle timer (fake clock), auto-start waits <=5 s, version-skew restart (never when busy), SIGTERM cleanup |
| 1.8 control server | done | `control-server.ts`, `control-client.ts`, `protocol.ts`; idempotent commandId (incl. in-flight), attach backlog-to-live gap-free under concurrent appends across rotation, overflow -> `resync` -> reattach |
| 1.9 session MCP bridge | done | `mcp-bridge.ts`, `bridge-service.ts`, `credentials.ts`, `bridge-config.ts`; real subprocess driven over stdio, revoked credential -> tool error, token never in argv/env/ps |
| 1.10 ApprovalBroker | done | `approval-broker.ts`; fake-clock timeout deny, first response wins, cancel on disconnect/task end/shutdown |

TDD note: for 1.5 the anchor and fixtures were drafted before their tests; I then wrote the tests and validated them by mutation (removing the disconnect handler, honouring early cleanup, promoting drain timeout to success, routing SIGINT to the group each made a test fail). The control-server concurrency test was strengthened after mutants (late subscribe, no dedupe) initially survived.

### Verification evidence
- `bunx tsc --noEmit`: 0 errors.
- `TMPDIR=$(realpath /tmp) bun test --timeout 60000 packages/session-host`: 224 tests, 0 fail (repeated 6x, stable; real-process tests ~11 s).
- `apps/cli/src/cli-args.test.ts` (+ new cases) and `apps/cli/src/internal-session-commands.test.ts` (main.tsx routes: daemon start/refuse/SIGTERM, anchor behind IPC, MCP stdio, no repo path in state dir): pass.
- Full `bun test --timeout 30000`: 6051 pass, 4 fail = the 3 known failures (skill bundle idempotency, Pi supervisor preference audit, OpenCode SSH alias) plus `codex-supermemory-launch.test.ts` "Web Search and Supermemory credentials..." which timed out at 120 s inside the full run but passes alone (11/11); treated as a pre-existing load/flake, not related to this change.
- `npx -y bun@1.3.12 run scripts/build-binaries.ts --dry-run`: darwin-arm64 build OK. Compiled binary smoke in a temp HOME/XDG: `internal session-daemon` auto-started and answered status (0.10.0), `internal child-anchor` reported ready, and `disconnect()` of IPC killed the worker; daemon SIGTERM cleaned the daemon dir; no repository path found in the state dir. (`dist/` is gitignored; nothing committed from the build.)
- `deck openspec validate --change cross-runner-session-core`: 1 change, 0 errors, 0 warnings.

### Deviations and decisions needed
1. **Approve vocabulary:** core's `approval.respond` uses `allow|deny` (S0) while XR-5.1/spec scenario uses `allow-once`. Broker accepts both and emits `allow-once|deny` in events.
2. **Different boot session = `ownership-unsettled` forever** (design 6.1 read strictly). After a reboot every previously running task stays unsettled and cannot be continued. A reboot is actually proof of death; recommend allowing `boot-changed` to settle (one line in `verifyLeaseSettled`). Not changed without a decision.
3. **Idempotency cache is in memory** (1000 per session): a duplicate `commandId` after a daemon restart can re-execute. SessionManager (S1b) should persist accepted commandIds if that matters.
4. **D-3 compaction** is not implemented (task 1.3 covers rotation only). `client.attached/detached` events are not emitted (SessionManager concern).
5. Added beyond the task list because needed for a usable daemon: daemon JSONL logger (XR-11.1 subset, day-rotated), `daemon.restart` frame for version skew, `DECK_SESSION_DAEMON_IDLE_MS` env knob (test/ops), startup `recoverAllSessions`, approval denial on bridge disconnect.
6. `SessionService` is the port S1b implements (`execute`, `openLog`, `hasRunningWork`, optional `taskStatus`/`close`); `UnavailableSessionService` ships in the daemon until then (every command returns `session-manager-unavailable`).
7. **Bun pitfalls found:** Bun pipe stdout is async, so a child that calls `process.exit` right after writing can truncate its own output under load (affects fixtures; real CLIs are unaffected, the anchor flushes before reporting). `net.connect` to a missing socket path emits 'error' before a post-hoc listener exists; `ControlClient` creates the socket first.
8. **`bun install` hazard:** `apps/cli` depends on `ink`/`react` at `latest`; a bare `bun install` after editing its package.json bumped ink 7->8 and react 19.2->19.3 and broke `tsc`. I reverted and hand-added the single `@deck/session-host` line to `bun.lock`; use `--frozen-lockfile`.

### Not run
- Real Linux execution (Linux `/proc` identity path is tested only with synthetic stat data; Docker sandbox not run). Windows is unsupported (the supervisor throws).
- 4-target build, Docker Linux smoke, `canary:install`, S1 BIN gate items for fake `claude` (1.19), live provider calls.
