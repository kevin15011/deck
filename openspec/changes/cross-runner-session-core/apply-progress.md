# Apply Progress: Cross-Runner Session Core

## Current follow-up — canary feedback (2026-10-13)

The user requested direct local browser access without code entry, removal of the Claude subscription notice, and investigation of slow responses. This feedback reopens Apply for the same candidate and supersedes the earlier manual local-pairing and Claude acknowledgement decisions. Local browser access will bootstrap a device cookie automatically under exact loopback peer/Host/Origin checks; forwarded/remote access retains device authentication. Claude setup/start will no longer require or synthesize acknowledgement; legacy configuration remains readable. Response latency requires measured evidence before attribution or optimization. Earlier completion/review records below describe the pre-feedback candidate.

### Follow-up completion

Implemented and independently approved on 2026-10-13. Final frozen suite: 6,421 pass, 3 skip, 0 fail (473 files); TypeScript, release verification, four-target build, Darwin/Linux arm64 compiled acceptance and desktop browser acceptance passed. Final native managed MCP acceptance: 9,351 ms cold preparation, 11 ms retained health check, canonical cache preserved and owned namespace removed. Both final review blockers were repaired: rejected native drain now persists ownership-unsettled; Claude initialization rejects failed/pending/missing expected MCP status. Full evidence and limits are in the follow-up verification/review sections. Installed canary and existing user daemons remain untouched; no commit or publication.

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
- `TMPDIR=$(realpath /tmp) bun test --timeout 60000 packages/session-host`: 222 tests, 0 fail (repeated 6x, stable; real-process tests ~11 s).
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

## S1b resumption — 2026-10-12

The user requested continuation from `HANDOFF.md`. Initial checks confirmed committed Claude driver (`8457578`) and SessionManager (`5c2b50c`), with unfinished CLI/terminal/self-test/smoke files in the worktree. Unrelated Codex MCP repair, dashboard, and runner documentation changes are preserved. Registry state is reconciled to Apply in progress; earlier sections above remain historical evidence.

### Initial and live evidence

- `bunx tsc --noEmit`: clean on resumption.
- `TMPDIR=$(realpath /tmp) bun test packages/session-host packages/core/src/session`: 322 pass, 0 fail.
- Claude driver focused suite: 51 pass, 0 fail.
- **Task 1.13 / 1.14 live check:** `TMPDIR=$(realpath /tmp) bun run scripts/session-contract-live.ts claude --model haiku`, bounded by a 100-second parent timeout, exited 0. All eight checks passed against Claude 2.1.296: version probe; first turn completion; explicit MCP set exactly `deck`; caller-assigned native session id; no marker hooks/hook diagnostic; mapped assistant text; retained context on resume; cooperative SIGINT interruption. The script used two small test exchanges and interrupted the third turn after four seconds. Temporary script artifacts were cleaned up.
- **Safe-mode decision:** existing recorded `safe-mode-init.jsonl` and its fixture README document that Claude 2.1.296 drops the explicit MCP set under `--safe-mode`. The driver therefore uses strict MCP config and disabled hooks. That historical safe-mode probe was not repeated in this resumption.
- Docker runtime check failed because the local daemon socket is absent. Linux runtime smoke remains pending, independently of cross-compilation.

### Independent review and repair in progress

- SessionManager reused task id `lead` across sessions while credential revocation and approval cancellation were globally keyed by task id. Scope cleanup to session plus task.
- Approval responses checked session ownership after mutating the broker. Reject foreign-session approvals before any effect.
- Terminal reattach replayed only the last 100 events, losing earlier pending approvals/task state; reconstruct state from complete replay while limiting displayed conversation history.
- Terminal lifecycle and approval retry need explicit coverage for ended sessions, disconnected daemon, and rejected responses.
- CLI composition supplied only the Deck MCP bridge. Ordinary configured runner packages must be composed explicitly to satisfy XR-4.4; memory/web broker work retains its S3 scope.
- Smoke helper must copy its fixture outside the repository and own spawned process handles so failures cannot leave terminal/daemon processes behind or signal stale persisted PIDs.

### Completed repairs and focused verification

- Scoped credential revocation and approval cancellation by `(sessionId, taskId)`; denied cross-session approval responses before broker mutation. Regression tests demonstrated the previous failures.
- Terminal state now replays the complete event history with a bounded display tail. Failed approval responses remain retryable; daemon disconnect and session-end stop further input commands.
- `ClaudeSessionMcpAdapter.readSessionMcpServers()` reuses authenticated Deck selection, canonical executable verification and read-only Serena readiness. It resolves ordinary MCP packages without installation or credential reads. The shared `RunnerAdapter` interface is unchanged.
- Production composition resolves MCP packages for each turn through an async factory returning an isolated `ChildMcpResolver`. Missing/untrusted selected tooling fails before driver startup. Concurrent-session tests prove that resolved package snapshots do not mix.
- Smoke copies its fixture into temporary storage, retains subprocess handles for cleanup, and scans all command/daemon output, fake invocation logs and persisted state for repository paths. It explicitly starts the daemon; auto-start remains covered by the existing daemon tests.
- Final owner-focused suite: **204 pass, 0 fail, 562 assertions, 11 files**. Independent Quality: **110 pass** for host/terminal repairs, then **59 pass** for final manager/service/Claude MCP composition. No unresolved blocker in the reviewed S1 candidate.
- Final Lead `bunx tsc --noEmit` and `git diff --check`: clean.

### Binary gate evidence

- `npx -y bun@1.3.12 run scripts/build-binaries.ts`: all four targets built successfully. Archives and `checksums.txt` are in `dist/cli`; no tracked generated-file diff was produced.
- **Darwin arm64:** extracted binary outside the repository, fresh HOME/XDG/cwd, fake Claude, **19/19 smoke checks passed**. Includes self-test, ToS command, daemon status, prompt/response, detach/list/stop, private state modes, strict MCP flags, credential cleanup and no repository paths.
- **Linux arm64:** the same **19/19 checks passed** as unprivileged `bun` in a disposable `oven/bun:1.3.12` container, `--network none`, with no repository or credential mounts. Only the compiled binary and smoke harness/fixture were copied in. Container removed after exit. This supplies actual no-repository runtime evidence; the other-architecture Linux and Darwin binaries are build-verified only.
- Environment deviation: used the minimal Bun container instead of building the repository installation-sandbox image, which was not cached. The smoke uses a fake runner and requires no installation of real runner CLIs.
- Live configured third-party MCP combinations were not exercised; their composition is verified by focused tests. The live Claude check used the explicit `deck` MCP fixture. S3 remains responsible for shared memory/web integration.

### Broad-suite reconciliation

`TMPDIR=$(realpath /tmp) npx -y bun@1.3.12 test --timeout 30000`: **6230 pass, 3 skip, 3 fail**, 454 files, 329.86 seconds. Failures:

1. OpenCode SSH-alias profile launch expectation: previously recorded in the S0/S1a baseline above; unrelated files preserved.
2. Pi production preference audit: previously recorded in the S0/S1a baseline above; Pi source untouched.
3. Obsolete S1a assertion expecting `session-manager-unavailable`; production now correctly returns `cross-runner-not-configured`. Updated assertion/comment without product changes; focused recheck recorded below.

Pinned Bun removed the older skill-bundle toolchain failure; the earlier Codex timeout did not recur. The repository-wide ledger remains stale relative to this branch; the two remaining baseline failures are referenced to the historical evidence above, not relabeled as passes. The full suite was not rerun after the assertion-only correction.

After the broad run finished, `TMPDIR=$(realpath /tmp) bun test apps/cli/src/internal-session-commands.test.ts`: **4 pass, 0 fail, 15 assertions**. No production change was needed, so the compiled-binary evidence remains applicable. OpenSpec validation: 1 change, 0 errors, 0 warnings.

**Checkpoint:** tasks 1.11–1.19 implemented and verified with the documented baseline/platform limitations. Continue at S2 (2.1–2.8). This is not full-feature or release approval: delegation, shared services, web client and cross-runner TUI remain S3–S5 work. Resumption edits remain uncommitted; no push or canary installation occurred.

## S2 — In progress (2026-10-12)

The user explicitly instructed continuation through **all remaining phases**, not a stop after each stage. Codex and OpenCode driver implementations have separate owners; the Lead centralizes contracts, evidence and lifecycle records.

- Codex isolation design correction: `--ignore-user-config` is an `exec` option, unavailable on app-server 0.162.1. Independent synthetic-config probe confirmed that empty MCP/plugin table overrides merge, while hooks/multi-agent boolean overrides take effect. Updated design/spec/task mechanism; readiness remains contingent on fail-closed effective and actual MCP-set checks plus live verification.
- Shared composition is extending the existing read-only ordinary-MCP resolver to all registered drivers without changing native runner installation behavior.
- S3 investigation identified the per-task host refactor and existing shared-memory composition seams; implementation follows S2 verification.
- Additional Codex 0.162.1 synthetic-config evidence: quoting a segment in the dotted CLI override path creates a literal quoted key and does not disable the original plugin. A nonempty inline TOML table override (`plugins={"sentinel@fixture"={enabled=false}}`) correctly disables it, as does an equivalent MCP table. Driver serialization must handle names inside TOML values and verify effective specs, not trust an emitted flag or names alone.

### S2 verification checkpoint

- Codex adapter suite: 212 passed; final driver lifecycle suite: 22 passed. OpenCode final driver suite: 25 passed. Host manager lifecycle suite: 56 passed. Quality independently ran 98 targeted checks and required a final Codex shared drain barrier; its two delayed-drain regressions reproduced failure before the repair and now pass.
- Native OpenCode 1.18.31 with `opencode/big-pickle`: 9/9 checks passed, including exact MCP/config/tool/schema isolation, native continuation and interruption. The harness had incorrectly queried `/tool/ids` (HTML fallback); the native OpenAPI document identifies `/experimental/tool/ids`, now used without relaxing the assertion.
- Codex native isolation, continuation and interruption passed; decline coverage and versioned shape comparison are still pending, so S2 is not yet closed.
- Four targets compiled. Extracted Darwin arm64 and unprivileged, network-disabled Linux arm64 each passed all 19 checks for each of Claude, Codex and OpenCode (57 per platform), with temporary HOME/XDG/project directories and no repository runtime paths. Linux has no repository or credential mounts. This build precedes the final Codex drain delta; the next stage build will include it. Other architectures remain build-only.
- Evidence logs: `/tmp/deck-s2-four-target-build.log`, `/tmp/deck-s2-host-{claude,codex,opencode}.json`, `/tmp/deck-s2-linux-smoke.log`, `/tmp/deck-s2-opencode-live-fixed.log`. Broad suite is in progress in `/tmp/deck-s2-full-suite.log`.

## S3 — In progress (2026-10-12)

Host implementation and CLI shared-service composition have separate owners. The host owns task scheduling, authenticated delegation, lifecycle/continuity, deduplicated serialized memory writes and normalized events. CLI composition injects role prompts, the existing project-scoped Supermemory runtime and the configured web-search provider. Resume reseeding requires a typed `native-session-not-found` reason; authentication or transport errors do not trigger context replacement. S2's final native/shape checks continue independently.

S2 native verification now passes: Codex **9/9**, including an actual escalated command request declined by the broker, and OpenCode **10/10**. Safe versioned shape manifests contain field paths/types only (Claude 219, Codex 295, OpenCode 125); default comparison rejects added/changed observed shapes while permitting absent optional fields. Three comparator/fixture tests passed. Capture proposals were reviewed and promoted; there was no additional provider call solely to rerun comparison against the just-captured baseline.

The broad S2 run completed with **6297 pass, 3 skip, 4 fail**, 460 files, 340.80 seconds. Two match the previously documented OpenCode SSH-alias and Pi preference-audit failures. Two occurred while the workspace was being edited: the binary smoke detected repository changes in its containment snapshot, and the Codex drain regression ran against the earlier loaded source. The final pinned-Bun Codex focused suite independently passes **22/22**. Final broad verification must run with all source writers paused; these transient failures are not recorded as baseline exceptions.

S4's loopback service is now being implemented in parallel, as allowed by the S1→S4 dependency. Its HTTP/WS boundary is recorded in design.md. Optional task 4.10 is deferred; no exposure command will be added or run for this delivery.

### Existing broad-suite failures repaired without changing runner behavior

- The OpenCode SSH-alias test changed `HOME` but canonical identity intentionally obtains the trusted home from the OS account database. Its generic `work` alias could therefore resolve through the real account configuration. The test now uses a unique untrusted alias while retaining the exact credential-profile and absent-canonical-tag assertions. No account files were read for diagnosis or modified.
- The preference audit treated the embedded Pi process anchor's child-command forwarding expression as preference-dependent behavior. The audit now excludes only that exact forwarding expression in that exact file; all other argv references remain forbidden. Pi source is unchanged.
- Both failures were reproduced in the S1/S2 broad runs. After the test-only corrections, the two complete affected files pass: **67 tests, 354 assertions** (`/tmp/deck-baseline-fixture-fixes.log`). No baseline exception or reduced product assertion was introduced.

S3 CLI composition: **25 focused tests** pass, including the actual Supermemory runtime with a fake transport and authenticated production SessionManager memory operations/deduplication. S4 backend initial candidate: **87 focused tests** pass across security, WebSocket behavior, CLI parsing/commands and Doctor. Final integration review and frozen-source verification remain pending.

## S4/S5 integration checkpoint

- Web backend final initial candidate: **88 focused tests** pass. Desktop Playwright passed both the actual WebService/embedded assets flow and the source daemon with real session MCP approval relay. Compiled acceptance scripts are ready; these source-wrapper runs are not reported as compiled evidence.
- Independent review found and fixed the task rail's `model`/`modelId` mismatch and interrupted partial text merging into the next attempt. A real-shape Playwright assertion failed before the model fix and passes after asset regeneration. Interrupted→continued replay regression failed before the boundary fix; five state tests now pass. Empty-state instructions now name the real `deck cross developer` command.
- CLI aliases `deck session pair` and `deck session devices` now match XR-9.2; the added alias regression failed before implementation and all **67 parser tests** pass.
- S5 TUI: **430 tests across 33 files** pass, including native-flow regressions and the interactive cross path. Final **22 cross/store tests** pass. Atomic save preserves current cross settings and native assignments. Migration projection now preserves `crossRunner`; the regression demonstrated the earlier loss before repair. No install effects occur in the cross flow.
- Dependencies are exact additions for the web workspace (React DOM 19.2.8, its types and Playwright 1.58.2); the lockfile adds entries only and preserves existing versions. No browser download or global install was needed.
- Reviewer-approved interpretation is explicit in XR-6.8/design: the cap covers delegated tasks, with a separate Lead slot, matching task 3.2's original acceptance. Default execution can include four workers plus the Lead.
- Remaining integration evidence: final host race/wake repairs, real Codex delegated memory calls, compiled host/Linux cross+web flows, final frozen-source broad suite and release verification.

## Final integration gates

- S3 native three-runner acceptance passed: Claude Lead delegated to Codex and OpenCode; both workers completed and physically called both shared-memory tools. One serialized write remained after deduplication, cursor replay was gap-free, and no unexpected task was created. Memory used a synthetic host port; no provider memory write was performed. Evidence: `/tmp/deck-s3-cross-live-final.log`.
- Native Codex 0.162.1 uses `mcpServer/elicitation/request` with a `mcp_tool_call` form for MCP permissions, in addition to command/file approval messages. The new exact isolated-form handler relays one-shot accept/decline and rejects unrelated/stale requests. A real gpt-6-luna probe recorded both memory calls without changing MCP aliases. Evidence: `/tmp/deck-codex-memory-repaired.log`; 32 focused tests passed. Independent review subsequently required nonempty active/request turn IDs during pending start and rejection of array-valued schema properties; final verification follows that repair.
- Host creation now shares in-flight duplicate command results, refuses conflicting create payloads and rechecks shutdown after readiness. Queued cancellation persists its matching receipt and wakes an idle Lead. Regression suites passed. Claude cross configuration filters the native `inherit` sentinel and rejects stale saved drafts without changing the native picker.
- Four targets built, and preliminary compiled Darwin/Linux arm64 passed all three single-runner smoke flows (57 checks per platform), cross delegation/continuation (6), and web HTTP/security/approval replay (11). Compiled Darwin desktop Playwright passed pairing, prompt, approval through the actual session bridge, tab-close replay, allow-once, and native fixture response. Linux used an unprivileged Bun 1.3.12 container with networking disabled and no repository or credential mounts. These binaries precede the last approval guard repair and will be rebuilt/rechecked before closure.

### Final result — 2026-10-13 UTC

**Required S0–S5 scope complete; verification passed; independent review approved.** Final evidence and limits are consolidated in [verify-report.md](verify-report.md) and [review-report.md](review-report.md). This result supersedes all intermediate pending/failed checkpoints above.

- Final Codex approval repair added three RED/GREEN guards: nonempty active/request native turn IDs, exact turn object identity across broker await, and rejection of array schema properties. Owner suite: 35 passed; independent final review: 26 passed. All four binaries were rebuilt and compiled host/Linux/browser flows repeated successfully after the repair.
- First frozen broad run: 6,371 pass, 3 skip, 2 fail. Corrected only the two failing fixtures: explicit runtime fields and temporary state for the memory hermeticity audit; empty tool inventory without a session credential. Targeted rechecks: 24 and 4 passed respectively. No production behavior or audit guard was relaxed.
- Final repeated frozen suite with Bun 1.3.12: **6,373 pass, 3 skip, 0 fail**, 43,389 assertions across 470 files in 340.03 seconds. Required project gates: 64 passed. TypeScript and `release:verify` passed. No baseline exception was added.
- Final compiled Darwin/Linux arm64: 57 single-runner + 6 cross-runner + 11 web checks passed per platform. Desktop Chromium: all six compiled acceptance steps passed. Both x64 platforms remain build-only. The Linux container had no network/repository/credential mounts and was removed after exit 0.
- Optional exposure helper 4.10 is deferred. No canary/global installation, native credential-file access, commit, push or publication was performed. Continuation changes and unrelated WIP remain uncommitted.

### Measured latency and prevention scope

The user's two canary Claude turns spent 33.390 s and 31.673 s from prompt to native initialization, versus native reported work of 2.858 s and 2.109 s. Both reported the selected Codebase Memory MCP server failed. An initialize-only probe of the selected Deck-owned 0.11.0 executable reproduced 32.998–33.010 s before JSON-RPC -32001: an existing account daemon endpoint did not answer rendezvous within 30,000 ms. The shared 0.9.0 executable answered the same handshake in 9 ms. Version difference alone does not prove causation; the proven fault is the unresponsive endpoint and repeated per-turn startup. No native credential or prompt content was inspected, and no existing process was stopped.

The user explicitly requested prevention and management within Deck rather than a one-off local restart. Architecture investigation therefore covers actual MCP readiness, compatible runtime selection, bounded/coalesced checks, actionable failed capability state and ownership-safe recovery. Unknown future incompatibilities must fail predictably rather than be claimed universally solved. Existing selected tools must not silently disappear.

The Claude streaming correction is separate: native `--include-partial-messages` is supported by installed help; text deltas now flow before the authoritative final snapshot. A controlled delayed-child regression observed its first delta immediately versus the final message after about 102 ms; this does not claim to repair the measured 30-second MCP startup timeout.

### Supported recovery evidence

A private `CBM_RUNTIME_DIR` using the selected exact 0.11.0 executable and unchanged canonical cache initialized in 8.947 s; tools/list took 28 ms. A second MCP frontend while the first remained connected initialized in 2.964 s; tools/list took 31 ms. Both frontends and their new daemon exited naturally after closing stdin, with the pre-existing unhealthy endpoint untouched. Evidence: `/tmp/deck-cbm-cold-warm-evidence.json`. These are native MCP timings, not an end-to-end model-response claim.

Implementation follows D-25: keep the supervised frontend, use real protocol health checks, scope recovery to its private runtime, and retain task leases so an active native consumer is never killed merely because another turn changes configuration or requests recovery. The documented 15-second cold deadline accommodates the measured healthy initialization; the 2-second deadline applies only to an existing connection's health request.

### Integrated native readiness acceptance

The implemented `SessionCodebaseReadiness` passed a real native acceptance using Deck's actual Supervisor/compiled child anchor and the exact pinned 0.11.0 executable. Cold preparation (including artifact verification and protocol negotiation) took **9,470 ms**; the next retained-connection health check took **12 ms**. Both returned the same private runtime, the canonical cache stayed unchanged, both task leases released, and shutdown removed the owned runtime directory. No model inference or tool operation was requested, and the earlier unhealthy shared daemon was untouched. Evidence: `/tmp/deck-managed-cbm-acceptance.ts` and `/tmp/deck-managed-cbm-acceptance.log`. Final race regressions and frozen-source checks remain in progress.

## Duplicate delegation completion wake — complete

Actual canary events 779/782/785/791 establish worker completion, delivery through `deck_task_wait`, Lead completion, and a redundant daemon-authored prompt 23 ms later. This caused an additional approximately 38-second native turn. The completion queue ignores whether a result was already returned. Repair scope: acknowledge terminal results returned through Lead tools by task attempt; preserve unseen completions, partial-timeout results, future attempts and observer isolation; cover synchronous append/subscriber ordering and scheduled-wake races. No generic transport protocol redesign or installed canary replacement.

Completion evidence: exact incident reproduced RED, then 104 owner tests and 425 broader affected tests passed. TypeScript and four-target build passed; extracted host binary cross smoke passed six checks. Independent Quality approved with 19 independently run cross-runner tests. Production change is localized to session-manager.ts; no bridge contract changed. Installation and live user sessions remain untouched.

## Public daemon lifecycle commands — complete

User requested public lifecycle controls following the canary restart diagnosis. Acceptance is XR-9.6 and design D-26. Implementation owner covers CLI/parser/help/runtime lifecycle and deterministic plus actual-process tests; Lead covers docs/registry. Verification will use temporary HOME/state and compiled binaries, preserving the installed canary and live user daemon. Prior completed verification is unchanged historical evidence.

Completion: public parser/help/main and daemon command handler landed with compatibility via the existing restart shutdown handshake. New-daemon admission is fenced synchronously across control, web and bridge, including asynchronous pending admissions. Strict spawned-PID attribution closes the competing-start race. Owner verification: 134 pass; independent Quality: 110 pass; Root affected suite: 497 pass/0 fail, TypeScript clean. Four targets built; extracted Darwin/Linux arm64 lifecycle acceptance passed 16 checks each; host cross/web acceptance passed 6/11 checks. No installed canary or live user daemon was changed. See final report sections for scope and logs.

## Web workspace redesign — complete

The user's next increment replaces the whole visual direction and introduces safe Markdown, provenance-based conversation separation, responsive panes, collapsible navigation and read-only OpenSpec artifacts. Primary research and its limits are in `web-ux-research.md`; the current visual agreement is the final section of `working-brief.md`. XR-8.9/8.10 and D-27 define acceptance and boundaries.

Frontend owner: `deck_apply_deep_web_workspace` (`apps/web`, targeted Markdown dependencies). Backend owner: `deck_apply_deep_openspec_viewer` (host helper, trusted query dispatch, authenticated routes and tests). Independent review: `deck_quality_web_workspace`. Lead owns documentation, generated assets and compiled acceptance. All work uses temporary browser/daemon fixtures; installed canary and existing sessions remain untouched.

Initial Root backend check: 40 tests passed across artifact reader and web boundary suites. Registry validation: 0 errors/0 warnings. These are intermediate checks, not final candidate approval; browser, TypeScript and compiled verification remain pending.

Completion: source and generated assets are aligned. The light responsive workspace separates Lead prose, operational activity, delegated transcripts/results and live OpenSpec documents. Shared react-markdown/remark-gfm rendering blocks raw HTML, unsafe URLs and remote images. Artifact APIs enforce trusted session scope, bounded Markdown reads and symlink/path checks. Review repairs prevent duplicate Enter submissions, retain mobile drawer labels after desktop collapse and preserve deleted document/change selection with an unavailable state. Visible polling and stale-response guards were exercised in the browser.

Final affected suites passed 442 tests across 31 files (412 host, 12 UI/assets, 18 documentation), TypeScript clean. Independent Quality approved after 104 backend tests, 10 frontend tests and 22 browser checks. All four targets built; extracted Darwin/Linux arm64 HTTP acceptance passed 16 checks each, and compiled browser acceptance passed eight including actual project artifact render/refresh. Root inspected desktop/mobile screenshots. No installed user runtime changes; full repository/native-model checks from earlier increments were not repeated.

## Dark palette and compact header — complete (2026-10-14)

User accepted the composition and components, requesting only dark colors and a smaller header. Lead applied a localized palette/header refinement with existing frontend design and accessibility guidance. Current agreement is in `working-brief.md`; dark screenshots and exact validation are in the latest handoff. Canonical web assets regenerated; 12 UI/asset tests, TypeScript and 22 existing browser checks passed. No new behavior tests, full suite, native rebuild or independent review cycle was needed for this reversible presentation change. Installed canary and user daemon unchanged.

## Persistent theme switch — complete (2026-10-14)

Retained dark as default and restored the exact previous light palette behind a compact header button. Browser-local selection survives reload/new tabs; invalid or inaccessible storage defaults safely and switching remains usable. Expanded production-transport browser acceptance to 27 checks with exact palette, keyboard, persistence and blocked-storage coverage; all passed, alongside 12 UI/asset tests and TypeScript. Lead inspected light desktop and dark mobile screenshots. Canonical assets regenerated; no native rebuild or installed-runtime mutation.

## Compact auto-growing input — complete (2026-10-14)

Implemented a one-line composer with inline accessible send/interrupt controls, automatic growth to four lines and internal scrolling thereafter. Native textarea semantics support multiline paste/IME/Shift+Enter while the manual resize affordance is removed. Height follows text changes and width changes, resets after sending, and Jump to latest follows the actual composer height. Verification: 12 UI/asset tests, TypeScript and 30 browser checks passed; rendered mobile inspected. Generated assets updated; installed runtime untouched.
