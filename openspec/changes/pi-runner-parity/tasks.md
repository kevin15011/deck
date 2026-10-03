# Tasks: Pi runner parity

Rules: strict TDD (failing test first, then implementation, then refactor). Test gates use temp `PI_CODING_AGENT_DIR` **and** temp `HOME`, fake `pi` binaries, the Pi faux provider for SDK contract tests, an in-process fake loopback host, and stdin ignored on any spawned `pi`. No real installs, no network, no writes to the user filesystem. Each task fits one session. Evidence tags `S§n` refer to the spike report sections cited in `design.md`.

## Phase 0 — Contract verification (spike) [done]

- [x] 0.1 P1 extension event contracts (S§1, S§2).
- [x] 0.2 P2 CLI flags and P5 child-process flags (S§3, S§7).
- [x] 0.3 P3 package agent delivery and P4 package registration (S§6).
- [x] 0.4 P6 `tool_call` mutation and block semantics (S§8).
- [x] 0.5 P7 MCP exposure/env/conflict and P8 trust (S§4, S§5).
- [x] 0.6 Fold the spike report into `design.md` and the specs; residual risks R1-R8 recorded.
- [x] 0.7 Copy the reusable spike harness pieces (faux-provider extension factory, tiny stdio MCP server that echoes env) into test fixtures under `packages/adapter-pi` (test-only).

## Phase 1 — Foundations (version, agent dir, session dir, manifest, types)

- [x] 1.1 Min-version preflight: semver parse of `pi --version`, `>= 1.0.0`, upgrade hint (`preflight.test.ts` first).
- [x] 1.2 `resolvePiAgentDir` with `PI_CODING_AGENT_DIR` validation; thread through planner/verifier/launcher; tests isolate `HOME`.
- [x] 1.3 Replace `PI_SESSION_DIR` with `--session-dir` / `PI_CODING_AGENT_SESSION_DIR` in `packages/adapter-pi/src/pi-team-launch.ts:154`, `packages/adapter-pi/src/runner-adapter.ts:1051` and `packages/core/src/config/env-sanitizer.ts:17` (failing launch/sanitizer tests first).
- [x] 1.4 Pi manifest (hashes plus owned `settings.json` `packages` key and `mcp.json` server names) and transactional apply/rollback.
- [x] 1.5 Add `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai` as dev dependencies for types and the faux provider; replace the hand-rolled `PiExtensionApi` with `ExtensionAPI`/`ExtensionFactory`; keep the canonical bundle build emitting `.js`.

## Phase 2 — Global package materialization

- [x] 2.1 Package layout writer: `package.json` pi manifest, peer deps, `extensions/*.js`, `skills/`, `prompts/`, `agents/*.md` (package-internal).
- [x] 2.2 `settings.json` `packages` merge: a relative path in `pi install` format; add/remove only the Deck entry; preserve user values.
- [x] 2.3 Move the team profile to a global location; lead uses `--system-prompt`; never write `SYSTEM.md`/`APPEND_SYSTEM.md`.
- [x] 2.4 Activation guard helper (`DECK_PI_SESSION`, `DECK_PI_ROLE`, `DECK_PI_CHILD`) shared by all Deck extensions.
- [x] 2.5 Remove project-local writes from `developer-team-install.ts`; contract test asserts no `<project>/.pi` or `.deck/pi` writes.

## Phase 3 — Native MCP, owned binaries, web search

- [x] 3.1 Global `mcp.json` writer: Deck servers with absolute commands, `"exposure": "direct"`, and `env` blanking `DECK_RUNNER_MEMORY_*`.
- [x] 3.2 Remove `pi-subagents`/`pi-mcp-adapter` from `PI_INSTALLABLE_TOOLS` and `required-tools.ts`.
- [x] 3.3 Mandatory, transactional removal of Deck-added `pi-mcp-adapter`/`pi-subagents` entries in the install plan; a user-added `pi-mcp-adapter` produces a blocking MCP diagnostic.
- [x] 3.4 Web Search (Tavily) installable tool; credential via shared resolution into the child env only.
- [x] 3.5 Generate role prompts and read-only `--tools` allowlists from the Deck server catalog using direct-exposure `mcp__*` names (with `-` mapped to `_`).

## Phase 4 — Subagent extension and per-role routing [done]

- [x] 4.1 `deck-subagents` single mode: discover `<package>/agents/*.md`; spawn `pi --mode json -p --no-session ... --append-system-prompt <tmpfile>` with stdin ignored and no shell; parse JSONL `message_end`; map errors (exit 1 on unknown model).
- [x] 4.2 Parallel (max 8, 4 concurrent) and chain modes; abort with SIGTERM then SIGKILL after 5s; temp-file cleanup.
- [x] 4.3 Per-role `--model`/`--thinking` from model config for all roles; pre-validate thinking levels; unassigned roles inherit.
- [x] 4.4 Child env (`DECK_PI_CHILD=1`, `DECK_PI_ROLE`, endpoint, token-file path); no tool registration in children.
- [x] 4.5 Read-only roles: `--tools read,grep,find,ls,<allowlisted mcp tools>`; write roles get no allowlist.

## Phase 5 — Memory extension and launch gate removal [done]

- [x] 5.1 Remove the `validateSupermemoryPiMcpConfig` gate from `pi-launch-command.ts`; route Pi through the host env overlay (failing launch test first).
- [x] 5.2 Token handoff: the CLI writes a 0600 per-session token file, passes `DECK_RUNNER_MEMORY_TOKEN_FILE`, never puts the token in the env, and deletes the file on host close.
- [x] 5.3 `deck-memory` lead recall: `session_start` on the first `before_agent_start`, `recall` afterwards; ephemeral `systemPrompt` append; `injection_ack`; test that no recall is persisted as `custom_message`.
- [x] 5.4 Child `role_start` recall plus ephemeral injection; children never capture.
- [x] 5.5 Capture: user prompt from `before_agent_start.prompt`; assistant text buffered from `turn_end.message`; capture on `agent_end`; stable event ids; 64 KiB truncation.
- [x] 5.6 Bounded drain on `session_before_compact` (never cancels compaction); flush, drain and `shutdown_flush` on `session_shutdown`.
- [x] 5.7 Remove memory code and the incorrect `input` handler from `developer-team-execution.ts` without changing its execution-evidence schema (coordinate with `developer-team-execution-convergence`).
- [x] 5.8 Token isolation test: the fake env-echo MCP server sees no token; `process.env` is scrubbed after factory load; verify extension-factory vs builtin-MCP spawn order (R6) and record the result.
- [x] 5.9 Real-runtime contract test: `DefaultResourceLoader({ extensionFactories })` + `createAgentSession` with the faux provider and fake loopback host; explicit shutdown invocation; skips with a reason if the dev dependency is absent.

## Phase 6 — Tool interception [done]

- [x] 6.1 `deck-tool-policy`: read-only enforcement via `{ block: true, reason }`; assert the model receives an error result and no `tool_result` is required.
- [x] 6.2 RTK rewrite by in-place `event.input.command` mutation, pinned to the owned binary; pass-through and failure paths.
- [x] 6.3 Graph redirection for `bash` `grep`/`rg`/`find` over code paths and the `grep`/`find` built-ins (advisory; non-code untouched).
- [x] 6.4 Coexistence test with the execution extension: handler order, and evidence preserved for non-blocked calls.

## Phase 7 — Migration and doctor [done]

- [x] 7.1 Legacy detection in every plan (project `.pi/agents|skills`, `.deck/pi/profiles`, Deck-added package entries).
- [x] 7.2 Opt-in transactional cleanup of project-local legacy artifacts with backup and hash matching (`--cleanup-legacy` parity).
- [x] 7.3 `deck doctor` Pi coverage: version, agent dir, package registration (cross-check via `pi list` at runtime only), manifest drift, MCP absolute commands and direct exposure, `/mcp` conflict, memory extension, legacy artifacts.

## Phase 8 — Documentation and closure

- [ ] 8.1 Update `docs/reference/support-matrix.md` (add Claude column, Pi cells) after rebasing on `deck-product-documentation`.
- [ ] 8.2 Update `docs/runners.md`, `docs/runner-support.md`, `docs/adaptive-memory.md`. Document that `--append-system-prompt` in subagent children replaces the user's `APPEND_SYSTEM.md`, and that MCP servers inherit non-memory env secrets.
- [ ] 8.3 Run the gates: `bun test packages/adapter-pi`, the config strict TDD gates, `tsc --noEmit`, baseline ledger comparison; record results in `apply-progress.md`.

## Phase 9 — Residual-risk verification (manual canary; evidence, not test gates)

- 9.1 R1: full compaction cycle in a long canary session; recall reappears and no captures are lost.
- 9.2 R2/R8: real-provider canary (`deck-canary pi developer`); inspect the provider payload for a single recall block; observe thinking levels per role.
- 9.3 R3: real `pi-mcp-adapter` upgrade path (old Deck install, then new) restores built-in MCP.
- 9.4 R4: child tool turn; confirm the JSONL tool events the subagent tool relies on (or confirm it relies on `message_end` only).
- 9.5 R5: interactive TUI and `--resume` picker with the Deck extensions loaded.
