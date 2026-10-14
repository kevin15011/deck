# Tasks: Cross-Runner Session Core

> Grouped by stage; every task fits one session and names its verification. TDD is mandatory ([config.yaml](../../config.yaml): write the failing test first). Requirement IDs refer to [spec.md](spec.md); decisions (`D-*`) refer to [design.md](design.md).
>
> **Standing rules for every task:** no network in `bun test`; no real installs; no writes outside temp dirs in tests; never edit `packages/adapter-pi` or generated files by hand; never read runner credential files.
>
> **Binary gate (`BIN`)** — run at the end of every stage:
> 1. `bun run scripts/build-binaries.ts` builds all four targets (linux-x64, linux-arm64, darwin-x64, darwin-arm64).
> 2. Host smoke: copy the host binary to a temp dir, run with `HOME`, `XDG_*_HOME` and `cwd` set to fresh temp dirs: `deck --version`, `deck session self-test` (from S1), stage-specific smoke listed below. Assert the repository is not used at runtime: grep stdout, logs, and the produced state dir for the repository path (must be absent), and run once with the repository temporarily unreadable to the test user or from a machine/container without it.
> 3. Linux smoke: run the same smoke for `linux-<host arch>` in the Docker sandbox (`scripts/linux-install-sandbox.sh` image); the other-arch Linux binary and the non-host Darwin binary are build-verified only (record this limitation in apply-progress).
> 4. `bunx tsc --noEmit` and `bun run test` pass with no new failures versus `openspec/baseline-health.yaml`.

---

## Final status (2026-10-13 UTC)

S0–S5 are complete within the accepted scope. Final verification and independent review passed; see [verify-report.md](verify-report.md) and [review-report.md](review-report.md). The final four-target/host/Linux gate supersedes intermediate partial stage gates. Task 4.10 is explicitly deferred as optional. The manual canary launch in 0.10 remains excluded by instruction; native Codex contracts and compiled session flows passed instead. Historical checkpoints below remain for traceability.

## S0 — Contracts and configuration (no runtime behavior change)

- **0.1 Session event types and validator** (XR-1.1–1.4)
  Add `packages/core/src/session/events.ts`: envelope, kind union, per-kind `data` validators, `raw` bounding.
  *Verify:* `bun test packages/core/src/session/events.test.ts` — valid/invalid envelopes, seq rules, 64 KiB truncation flag, unknown kind rejected, `runner.unmapped` accepted.
- **0.2 Command types and validator** (XR-1.5)
  Add `session/commands.ts` with `commandId` UUID requirement.
  *Verify:* `bun test packages/core/src/session/commands.test.ts`.
- **0.3 Redaction rules in core** (XR-1.3, design §12)
  Port the Pi `clean()` rules (read-only reference: `packages/adapter-pi/src/pi-extensions/subagents/jobs.ts`) into `session/redaction.ts`; do not import from Pi.
  *Verify:* table-driven test covering Bearer/Basic, `api_key=`, JSON `"token":`, ANSI/bidi stripping, cap.
- **0.4 Runner-qualified assignments** (XR-1.6, D-4)
  Add `session/assignments.ts` with `RunnerQualifiedAssignment`, `CrossTeamAssignments`, `qualifyAssignments`, `projectForRunner`. `DeveloperTeamModelAssignments` unchanged.
  *Verify:* unit tests; `bunx tsc --noEmit` proves no adapter signature changed.
- **0.5 `RunnerSessionDriver` interface + optional `getSessionDriver()`** (XR-4.1, D-6)
  Types only in `session/driver.ts`; optional member on `RunnerAdapter`.
  *Verify:* `bun test packages/core/src/runner-adapter.test.ts` still passes; type test that an adapter without the method compiles.
- **0.6 Child MCP set computation (pure)** (XR-4.4)
  `computeChildMcpSet({runnerPackages, memoryProviderIds, webSearch, sessionMcp, role})` → explicit list; Lead gets delegation tools, others do not (XR-6.3).
  *Verify:* unit tests incl. "memory provider removed", "web search included only when enabled".
- **0.7 `crossRunner` config schema + normalization** (XR-2.1–2.2, D-5)
  Extend `packages/core/src/config/deck-config.ts` validate/normalize; legacy string member → qualified + `CROSS_ASSIGNMENT_LEGACY_SHAPE` warning; defaults per design §3.4.
  *Verify:* `bun test packages/core/src/config/deck-config.test.ts` new cases; round-trip write persists qualified shape.
- **0.8 Downgrade behavior check** (rollback plan)
  Test that documents what the pre-change normalizer does with an unknown `crossRunner` key (preserve vs drop) using the current `validateDeckConfig` path; record outcome in apply-progress and adjust proposal rollback wording if needed.
  *Verify:* the test itself.
- **0.9 Generated JSON Schemas for events/commands** (D-20)
  Generator script → `packages/core/src/session/schema.generated.ts`; wire into build prep.
  *Verify:* snapshot test that schema matches validators on fixture set; regeneration is idempotent.
- **0.10 Codex 0.162.1 adapter compatibility audit** (design §11)
  Using fixtures captured from 0.162.1 (`codex --version`, help output, vendor layout), test executable detection, version parse, model discovery parsing, `--dangerously-bypass-hook-trust` presence, duplicate-hook warning handling. Fix only what fails.
  *Verify:* `bun test packages/adapter-codex/src` + new fixture cases; manual `deck-canary codex developer` launch on the host.
- **0.11 S0 BIN gate** — smoke: `deck --version`; config with `crossRunner` loads in `deck doctor` without error.

## S1 — Daemon core, Claude driver, terminal client

Resume status (2026-10-12): implemented and verified with the known broad-suite limitations recorded in [apply-progress.md](apply-progress.md#s1b-resumption--2026-10-12). Host and Linux arm64 compiled smoke passed; other architectures are build-verified. Continue implementation at S2.

- **1.1 Package scaffold `@deck/session-host`** (D-1) — workspace entry, tsconfig, no adapter imports (add an import-boundary test like existing core-purity tests).
  *Verify:* boundary test; `bunx tsc --noEmit`.
- **1.2 Paths and permissions** (XR-3.2) — resolver for sessions/daemon/web/logs under `$XDG_STATE_HOME/deck`; `0700`/`0600` enforcement; Darwin `sun_path` fallback (design §6.2).
  *Verify:* tests with temp XDG; long-path fallback test; permission assertions.
- **1.3 EventLog** (XR-3.3, 3.5, D-3) — append-only JSONL, monotonic `seq`, batched fsync, rotation at 16 MiB, `readAfter(seq)`.
  *Verify:* tests for ordering, crash-truncated last line (ignored + diagnostic), rotation boundary reads, no gaps across segments.
- **1.4 Ledger projection + snapshot** (XR-3.3, D-12, D-15) — task attempts, native ids, states; rebuild on snapshot mismatch.
  *Verify:* replay tests; snapshot corruption → rebuild.
- **1.5 Child anchor** (XR-3.6, D-14) — `deck internal child-anchor`: detached group, IPC-loss group kill, EOF drain, no early exit.
  *Verify:* integration tests with a fake child (`sleep` + grandchild) on the host: kill the parent → whole group gone; interrupt reaches CLI pid only; drain timeout yields failure not success.
- **1.6 Recovery** (XR-3.7) — startup scan; Linux identity check, Darwin absence-only; never signal persisted PIDs.
  *Verify:* tests with synthetic persisted leases: absent → `interrupted`, live/reused/unknown → `ownership-unsettled`; spy asserts no `process.kill(pid, sig≠0)`.
- **1.7 Daemon process + single instance** (XR-3.1) — `deck internal session-daemon`, lock (pid+nonce), readiness, idle shutdown, version handshake.
  *Verify:* tests: second start exits with "already running"; idle timer with fake clock; client auto-start helper waits ≤5 s.
- **1.8 Local control server** (XR-8.1) — Unix socket, JSON frames, command dispatch with idempotency, attach with backlog→live and `resync` on overflow.
  *Verify:* integration tests: duplicate `commandId`; reattach `after=N` gap-free with concurrent appends; overflow → resync → reattach.
- **1.9 Session MCP bridge (approve + status only)** (D-11, XR-4.7) — `deck internal session-mcp`; credential file read; MCP stdio framing (initialize, tools/list, tools/call).
  *Verify:* tests driving stdio frames (based on `spike/deck-mcp.mjs`); credential revoked → tool error; credential never in argv (assert spawn args).
- **1.10 ApprovalBroker** (XR-5.1–5.2) — request/resolve, timeout deny, first-response-wins.
  *Verify:* fake-clock tests.
- **1.11 Claude driver: parser and mapper** (XR-1.4, XR-4.5) — map stream-json `system/init`, `assistant`, `user`, `result` (incl. `permission_denials`, `error_during_execution`) to normalized events with raw.
  *Verify:* fixtures recorded from `spike/` runs at 2.1.296 under `packages/adapter-claude/src/session-driver/__fixtures__/2.1.296/`; `bun test packages/adapter-claude/src/session-driver`.
- **1.12 Claude driver: launch args and isolation** (XR-4.3, D-9 analog) — per-turn argv (`--session-id` then `--resume`), `--strict-mcp-config --mcp-config <file>`, hooks disabled via settings file, `--permission-prompt-tool mcp__deck__deck_approve`, `--disallowedTools` for native delegation; never `--bare`; keep `claude-launch-plan.ts` interactive lane unchanged.
  *Verify:* argv snapshot tests incl. "no `--bare`", "no token in argv"; live probe task 1.13.
- **1.13 Claude probe + live isolation check** — probe: version range, init MCP list equals expected set, hooks not executed (marker hook), `--safe-mode`+explicit MCP compatibility decision recorded.
  *Verify:* `bun run scripts/session-contract-live.ts claude` (opt-in, manual) passes; result recorded in apply-progress.
- **1.14 Claude interrupt** (XR-5.4) — SIGINT to CLI pid, 10 s escalation.
  *Verify:* fake-child test for escalation; live script check of `error_during_execution`.
- **1.15 ToS acknowledgement gate** (XR-12.1) — `claude-session-tos-unacknowledged` block; `deck session ack-claude-tos` records timestamp in `crossRunner`.
  *Verify:* tests for blocked/unblocked.
- **1.16 SessionManager: single-member Lead session** — create/attach/prompt/interrupt/stop using driver + broker + log.
  *Verify:* integration test with a fake driver: full lifecycle event sequence.
- **1.17 CLI commands** (XR-9.1–9.2) — `deck cross developer`, `deck session list|attach|stop|status|self-test|prune`; terminal client renders normalized events, `/interrupt`, approval y/n, `/detach`.
  *Verify:* `bun test apps/cli/src/cli-args.test.ts` new cases; client render tests with a scripted event stream.
- **1.18 Embedded self-test manifest** (XR-10.3) — `deck session self-test` checks embedded schema digests (web assets added in S4).
  *Verify:* unit test; BIN smoke.
- **1.19 S1 BIN gate** — smoke: `deck session self-test`; start daemon, `deck session status --json`, stop; with a fake `claude` on `PATH` (fixture replayer) run one prompt end-to-end and check state dir contents and no repo paths.

## S2 — Codex and OpenCode drivers

- **2.1 Codex app-server JSON-RPC client** — framing, request ids, server-request handling, notification mapping.
  *Verify:* fixtures from `spike/codex-app-server.mjs`, `codex-approval.mjs`, `codex-interrupt.mjs` at 0.162.1; mapper tests.
- **2.2 Codex launch + isolation** — own stdin pipe, effective-config inventory plus inherited MCP/plugin suppression, `-c mcp_servers.*` from the child set (credential file path only), hooks/native delegation off, approval policy per `crossRunner.approvals.codex` (default bypass, D-16). Follow the verified-version correction in design §4.1; app-server has no `--ignore-user-config`.
  *Verify:* argv/config snapshot tests; fail closed on unexpected enabled MCPs; live probe confirms native auth still works and no user MCP/hooks appear.
- **2.3 Codex approvals (accept + decline) and interrupt** — `requestApproval` → broker; `turn/interrupt`.
  *Verify:* fixture tests; live script exercises **decline** (previously unverified) and records fixture.
- **2.4 OpenCode serve client** — port 0/random on 127.0.0.1, readiness, `POST /session`, message, SSE `/event` parsing, abort, permission list/reply.
  *Verify:* fake HTTP+SSE server tests built from `spike/opencode-*.mjs` captures at 1.18.31.
- **2.5 OpenCode isolation via Deck-owned config dir** (D-9) — per-task config home, data home untouched, config content from child set, `task: deny`, server password if supported.
  *Verify:* env snapshot tests; live probe asserts tool list contains only the explicit set (user MCPs absent).
- **2.6 Driver registration** — `getSessionDriver()` on Codex/OpenCode adapters; probes in `deck session status`.
  *Verify:* `bun test apps/cli/src/runner-adapters.codex.test.ts` + new registry tests.
- **2.7 Live contract script coverage** — `scripts/session-contract-live.ts codex|opencode` shape diff.
  *Verify:* manual run; outputs recorded.
- **2.8 S2 BIN gate** — smoke: single-member sessions with fake `codex` and fake `opencode` replayers.

## S3 — Proxied Lead, delegation, shared services

- **3.1 Delegation tools in the bridge** (XR-6.2–6.3) — `deck_delegate`, `deck_task_wait` (≤50 s), `deck_task_result`, `deck_task_cancel`; Lead-only.
  *Verify:* bridge tests; non-Lead credential gets `tool not allowed`.
- **3.2 Task scheduler** (XR-6.8) — concurrency cap, queueing, per-task process lifecycle.
  *Verify:* fake-driver tests: 6 delegations → 4 running, 2 queued.
- **3.3 Lead wake** (XR-6.4) — bounded completion notice when Lead idle.
  *Verify:* tests: wake once per completion batch; no wake while Lead running.
- **3.4 Owner-contract continuation** (XR-6.5, D-12) — recorded runner/model/native id; refuse running; assignment change affects new tasks only.
  *Verify:* tests across fake Claude/Codex drivers.
- **3.5 Reseed on resume failure** (XR-6.6) — bounded summary from event log; `continuity: reseeded`.
  *Verify:* test with driver returning "session not found".
- **3.6 Native delegation disable per runner** (XR-6.7) — apply flags/config; `native-delegation-not-disabled` diagnostic when unverifiable.
  *Verify:* argv/config tests per runner.
- **3.7 Change binding** (XR-7.1) — `session.bindChange`, immutability, change path injected into role prompts.
  *Verify:* tests incl. second bind rejected.
- **3.8 MemoryBroker** (XR-7.2–7.3, D-18) — port in session-host; adapter in apps/cli composing `SupermemoryRuntimeHost`; `deck_memory_recall`/`deck_memory_propose`; dedupe; single writer.
  *Verify:* tests with a fake runtime host; assert no memory MCP/plugin in any child set when enabled.
- **3.9 Web search in child set** (XR-7.4) — credential via env overlay, never argv.
  *Verify:* child-set and argv tests.
- **3.10 Cross-runner end-to-end (fake drivers)** — Lead on fake Claude delegates to fake Codex and fake OpenCode, approval relay, interrupt, disconnect/reattach, daemon kill → recovery → continuation.
  *Verify:* `bun test packages/session-host/src/__tests__/cross-runner.e2e.test.ts`.
- **3.11 Live 3-runner acceptance (manual)** — real CLIs, trivial prompts, as in spike rounds; record evidence including the previously unverified "memory inside delegated children" path.
  *Verify:* apply-progress evidence log.
- **3.12 S3 BIN gate** — smoke: fake-driver cross session from the compiled binary.

## S4 — Desktop web client over the local service

> Nothing in this stage requires Tailscale or any network tool. All verification runs on loopback.

- **4.1 `apps/web` scaffold + build** (D-20, D-23) — React desktop client (no service worker, no PWA manifest), `Bun.build` output.
  *Verify:* build script test; bundle has no external URLs (scan).
- **4.2 Embedded asset generator** — `apps/cli/src/runtime/web-assets.generated.ts` with digest manifest; wired into `prepareStandaloneBinaryBuild`; `self-test` covers it.
  *Verify:* generator idempotency test; self-test detects a tampered digest.
- **4.3 Loopback web listener** (XR-8.2, 8.7, D-19) — `127.0.0.1` only, starts with the daemon, restricted API, WebSocket events with cursor.
  *Verify:* tests: non-loopback bind config refused; bridge/admin routes 404.
- **4.4 Pairing and devices** (XR-8.3) — one-time code and single-use pairing link, TTL, attempts, hashed device tokens, revoke; cookie `Secure` only over HTTPS.
  *Verify:* tests for expiry, reuse, brute-force lockout, revoke, cookie attributes on http loopback.
- **4.5 Host, Origin, CSP, forwarding checks** (XR-8.4–8.6) — Host allowlist (DNS rebinding), exact Origin, CSP headers, reject `Forwarded`/`X-Forwarded-*`/Funnel marker unless `trustedProxy`/`allowedOrigins`/`allowFunnel` configured.
  *Verify:* header matrix tests (rebinding Host, foreign Origin, forwarded without trust, forwarded with trust + same auth still required).
- **4.6 Desktop client UI** — session list, event stream with resume, prompt box, interrupt, approval cards, task panel, raw payload viewer; untrusted text rendering. Narrow-screen layout is a nice-to-have, not a gate.
  *Verify:* component tests; Playwright (desktop viewport) against the host binary covering pair → prompt → approve → close tab → reopen and resume.
- **4.7 `deck session web disable|enable|pair|devices` and pairing link from `deck cross developer`** (XR-9.2) — opens the default browser only on user confirmation.
  *Verify:* CLI tests; assert no network-exposure command is ever spawned.
- **4.8 Doctor web checks** (XR-11.2) — listener bind/port, exposure configuration warnings; no Tailscale probing.
  *Verify:* tests with stubbed config.
- **4.9 S4 BIN gate** — smoke: start the daemon from the compiled binary, fetch `/` on `127.0.0.1`, verify digest-matched assets, 401 on API without device cookie, Host-rebinding rejection.
- **4.10 (Optional, last) `deck cross expose` helper** (XR-9.5, D-24) — prints the reverse-proxy command for the chosen tool (`tailscale serve` first), runs it only after explicit confirmation, writes `trustedProxy`/`allowedOrigins`; never enables Funnel by default; no auth changes. May be dropped without affecting any other task.
  *Verify:* tests with a stubbed command runner: print-only by default, run only after confirmation, Funnel never invoked without `--allow-funnel`; auth tests from 4.4–4.5 still pass with exposure configured. Manual check with a real tailnet is optional and not a gate.

## S5 — TUI cross runner and documentation

- **5.1 Picker target refactor** (design §10) — replace implicit `modelConfigRuntime` dependency in the picker with an explicit target; runner-native behavior unchanged.
  *Verify:* existing TUI tests (`apps/cli/src/tui/__tests__/`) pass unchanged; new unit tests for target routing.
- **5.2 Cross entry in Start installation** (XR-9.3, D-21) — members list → runner list → models → thinking → review → save `crossRunner`.
  *Verify:* render-only TUI tests (pattern: `runner-install-e2e.test.tsx`) for the full path and for "runner not installed" and "no driver" states.
- **5.3 Review screen without installs** (XR-9.4) — shows prerequisite runners and Claude ToS acknowledgement; asserts no install actions.
  *Verify:* contract test that the cross plan has zero install steps.
- **5.4 Doctor + status integration** (XR-11.2).
  *Verify:* `bun test apps/cli/src/doctor-command` new cases.
- **5.5 Docs** — `docs/architecture.md` (daemon boundary, D-1), `docs/runners.md` (cross sessions), `docs/reference/support-matrix.md` (driver versions, approvals, isolation status per runner), a security/ToS page with the non-goal list; AGENTS.md architecture bullet for `@deck/session-host`.
  *Verify:* link check; review against spec XR-12.
- **5.6 Final BIN gate + release-readiness** — full four-target build, host + Linux sandbox smoke covering S1–S4 flows (loopback only, 4.10 excluded), `bun run release:verify`.

---

## Dependencies

```
S0 ──► S1 ──► S2 ──► S3 ──► S4 ──► S5
          └─────────────► S4 (web needs only S1 core; can start after S1 if S2/S3 slip)
S0.10 (Codex audit) is independent and may ship first.
```

## Canary feedback follow-up — complete (2026-10-13)

This supersedes historical manual local pairing and Claude acknowledgement tasks above.

- [x] Automatic direct-loopback browser access; preserve forwarded authentication and revocation.
- [x] Remove Claude subscription notice and acknowledgement gates without fabricating consent.
- [x] Measure native latency; stream Claude partial text and show failed turns.
- [x] Implement D-25 managed Codebase Memory compatibility, health, ownership and recovery.
- [x] Independently review error paths; pass full suite, TypeScript, release/build and compiled acceptance gates.

Evidence and limits: `verify-report.md`, `review-report.md`. Installation/publication remains outside this completed implementation.

## Duplicate completion wake follow-up — complete (2026-10-13)

- [x] Reproduce the single-worker result-delivered-then-wake incident.
- [x] Acknowledge terminal Lead-tool results by attempt; preserve unseen/aborted/future-attempt notifications.
- [x] Cover synchronous delivery/enqueue and scheduled-wake races, observer isolation and socket delivery.
- [x] Pass affected suites, TypeScript, four-target build, extracted host cross smoke and independent review.

## Public daemon commands follow-up — complete (2026-10-13)

- [x] Add daemon start/status/stop/restart grammar, help, JSON and compiled production wiring.
- [x] Reuse graceful control shutdown with busy refusal, bounded settlement and strict replacement attribution.
- [x] Fence control/web/bridge admission atomically after accepted shutdown.
- [x] Verify absent/idempotent/timeout/ownership/concurrent cases and preserved real session history.
- [x] Pass affected suites, TypeScript, four-target build, macOS/Linux lifecycle, host cross/web and independent review.
- [x] Document lifecycle, Ctrl+C behavior, restart after installation and unchanged session runner ownership.

## Web workspace redesign follow-up — complete (2026-10-13)

- [x] Diagnose mixed conversation events and research primary AI-chat/responsive/accessibility patterns.
- [x] Record replacement visual agreement and session-scoped OpenSpec read contract.
- [x] Implement Lead conversation separation, safe Markdown, collapsible navigation and responsive workspace tabs.
- [x] Implement bounded authenticated OpenSpec artifact catalog/read and visible refresh.
- [x] Verify classification/replay, Markdown safety, artifact path/auth boundaries and desktop/mobile interactions.
- [x] Inspect rendered desktop/mobile output, pass TypeScript/distribution checks and independent review.
- [x] Update user documentation, verification evidence and handoff; preserve installed user runtime.
