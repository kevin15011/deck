# Design: Pi runner parity

Status: design complete. P1-P8 were resolved by the Phase 0 spike (task 0.6). Evidence references `S§n` point to sections of the spike report `pi-spike-report.md` (session scratchpad, 2026-10-02; harness under `<scratchpad>/spike/`, logs in `spike/logs/`). The spike used pi 1.0.0, an isolated `PI_CODING_AGENT_DIR`, a faux provider, and no network or real LLM. Items the spike could not verify are listed under "Residual risks" and have their own verification tasks (Phase 9).

## Production trace (target)

```
TUI Review & Install (apps/cli)
  -> adapter-pi planner: resolve PiAgentDir (PI_CODING_AGENT_DIR | ~/.pi/agent)
  -> plan: owned binaries (core/owned-tools) + Deck package dir + settings.json packages entry
           + mcp.json Deck servers (exposure "direct") + manifest
           + mandatory removal of Deck-added pi-mcp-adapter; legacy report; foreign-conflict blocks
  -> apply: one transaction per root (Pi agent dir; Deck state dir for backups)
deck pi developer
  -> preflight (pi --version >= 1.0.0) -> session runtime lease
  -> supermemory runtime host + loopback bridge (unchanged) -> token handoff file (0600)
  -> spawn pi --session-dir <dir> --system-prompt <global profile> [--model/--thinking lead]
     stdin ignored; env: DECK_PI_SESSION=1, DECK_PI_ROLE=lead, DECK_RUNNER_MEMORY_ENDPOINT,
     DECK_RUNNER_MEMORY_TOKEN_FILE, TAVILY key; PI_CODING_AGENT_SESSION_DIR (not PI_SESSION_DIR)
  -> Pi loads Deck package (.js bundles): deck-memory, deck-subagents, deck-tool-policy,
     developer-team-execution; skills; prompts; global mcp.json (builtin:mcp)
```

## Verified Pi 1.0.0 contracts (summary)

| ID | Question | Verified answer | Evidence |
|---|---|---|---|
| P1 | Extension event contracts | `input` result discriminant is `action` (`continue`/`transform`/`handled`); Deck's `{type, advisoryText}` is ignored, so current recall is dropped. `before_agent_start` returns `{ message?, systemPrompt? }` and `systemPromptOptions.appendSystemPrompt` is mutable. `systemPrompt`/`appendSystemPrompt` injection is ephemeral (that turn only); `message` is persisted as `custom_message` and replayed, so it accumulates. MCP tools are not yet registered at the first `before_agent_start` and are present by `turn_start`. `turn_end.message` holds the assistant message (text blocks). `agent_end.messages` includes system/custom messages. `session_before_compact` fires with a full `preparation` payload and supports `{ cancel?, compaction? }`. `session_shutdown` fires once on CLI exit in print/json mode; SDK `session.dispose()` does NOT emit it. | S§1, S§2 |
| P2 | CLI flags | Present: `--session-dir`, `--system-prompt` (replaces default), `--append-system-prompt` (repeatable; replaces file-based `APPEND_SYSTEM.md` when given), `-e`, `--model` (unknown model: exit 1), `--thinking` (invalid value: warning only), `-c`, `-r`, `--no-session`, `--tools/-t`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`, `-ne`, `-a`/`-na`, `--offline`, `--mode text|json|rpc`, `-p`. `PI_SESSION_DIR` is NOT honored; the real variable is `PI_CODING_AGENT_SESSION_DIR`, and `--session-dir` overrides it. `pi --version` prints exactly `1.0.0`. | S§3 |
| P3 | Agents in packages | No native agents resource. The `agents` manifest key is ignored; only extensions/skills/prompts/themes are loaded. | S§6 |
| P4 | Package registration | `pi install /abs/path` works offline and writes a path relative to the agent dir into `settings.json` `packages`; extension, skill and prompt load on the next run. Global extension discovery accepts `x.js` and `dir/index.js` only; `x.mjs` is not discovered. | S§1, S§6 |
| P5 | Subagent child flags | `pi --mode json -p --no-session --model M --thinking L --tools a,b --append-system-prompt <tmpfile> "Task: ..."` with stdin ignored (`pi -p` hangs on a non-TTY stdin). Children inherit the parent env and load global extensions/skills/AGENTS. `--tools` also filters extension and MCP tools. Output is JSONL (`message_end`, `turn_end`, `agent_end`, `agent_settled`). Abort: SIGTERM, then SIGKILL after 5s. | S§7 |
| P6 | RTK mutation | In-place mutation of `event.input.command` in `tool_call` changes the executed command with no revalidation; `tool_result.input` reflects the mutation. `{ block: true, reason }` produces an `isError` tool result carrying the reason, and `tool_result` is NOT fired. Built-in `grep`/`find`/`ls` exist but are off by default. | S§1, S§8 |
| P7 | MCP | Global `mcp.json` `mcpServers` with `command/args/env/exposure/description` works. Default exposure is `codemode`, which hides `mcp__*` tools behind a `codemode` tool. `direct` exposes `mcp__<server>__<tool>`, with `-` sanitized to `_`. An extension registering `/mcp` (as pi-mcp-adapter does) disables built-in MCP entirely. **MCP stdio children inherit the parent env, including `DECK_RUNNER_MEMORY_*`.** | S§4 |
| P8 | Trust | In an untrusted project, global skills, prompts, `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, extensions and `mcp.json` all load. Project `.pi/*` loads only with `-a`. `~/.agents/skills` is read from the real `HOME` even with an isolated `PI_CODING_AGENT_DIR`. | S§5 |

## Architecture decisions

### D1. One Deck-managed local Pi package, globally registered (revised by P3/P4)

Deck writes `<PiAgentDir>/deck/package/` with `package.json` `pi: { extensions, skills, prompts }`, keyword `pi-package`, and `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai` as `peerDependencies: "*"`. Extensions are bundled as `extensions/<name>.js` (never `.mjs`, P4).

- **Registration**: Deck writes the `packages` entry itself in the same format `pi install` produces, a path relative to the agent dir (`"deck/package"`), as a manifest-owned key. Rationale: `pi install` behavior for a local path is fully captured by that settings entry (S§6), and writing it directly keeps install hermetic and testable without a Pi binary. `deck doctor` cross-checks with `pi list` at runtime; this is not a test gate.
- **Agents**: there is no native agent resource (P3). Agent markdown files live inside the package at `<package>/agents/*.md` and are discovered by `deck-subagents` relative to its own module path. `$PI_CODING_AGENT_DIR/agents/` is rejected because it is shared with user agents and with the official example extension.
- **Prompts**: the lead uses `--system-prompt <profile>`, which replaces the default prompt. Deck never writes `SYSTEM.md` or `APPEND_SYSTEM.md`, because those would affect every non-Deck session.
- Alternatives rejected: loose files in `extensions/`/`skills/` (ownership guessing); npm publication (network, release coupling); `pi -e` per launch (fallback only).

### D2. PiAgentDir is a single resolved value object

`resolvePiAgentDir(env, homedir)` returns `{ ok, dir }` or a blocking diagnostic, and is passed explicitly to the planner, verifier, launcher and cleanup. Tests isolate both `PI_CODING_AGENT_DIR` and `HOME`, because Pi reads `~/.agents/skills` from the real home (P8). Deck does not write to `~/.agents/skills` for Pi.

### D3. Manifest ownership reuses the Codex pattern

The manifest lives at `<PiAgentDir>/deck/manifest.json` and records file hashes plus the Deck-owned keys in `settings.json` (`packages` entry) and `mcp.json` (server names). Merges add, replace or remove only manifest keys. A foreign entry with a Deck-reserved name blocks the plan.

### D4. Extensions split by responsibility, guarded by role env

| Extension | Owner | Events |
|---|---|---|
| `developer-team-execution` | `developer-team-execution-convergence` | `tool_call`, `tool_result`, `session_shutdown` (evidence only; memory code removed; `input` handler removed) |
| `deck-memory` | this change | `before_agent_start`, `turn_end`, `agent_end`, `session_before_compact`, `session_shutdown` |
| `deck-subagents` | this change | `registerTool` (lead only) |
| `deck-tool-policy` | this change | `tool_call` |

All four are inert unless `DECK_PI_SESSION=1`. Children inherit env and load global extensions (P5), so role gating uses `DECK_PI_ROLE` and `DECK_PI_CHILD=1`, which the subagent tool sets explicitly on each child. Extensions are typed against the exported `ExtensionAPI`/`ExtensionFactory` types (S§1); the hand-rolled `PiExtensionApi` is deleted.

### D5. Memory over the existing loopback host, no protocol change (revised by P1)

| Pi moment | Loopback event | Injection |
|---|---|---|
| lead, first `before_agent_start` | `session_start` (query = `event.prompt`) | return `{ systemPrompt: event.systemPrompt + block }` (ephemeral); then `injection_ack` |
| lead, later `before_agent_start` | `recall` (query = `event.prompt`) | same ephemeral append each run |
| child (`DECK_PI_CHILD=1`), first `before_agent_start` | `role_start` (role = `DECK_PI_ROLE`, query = task) | ephemeral append; `injection_ack` |
| lead `before_agent_start` | `capture` `trusted-user-prompt` (`event.prompt`) | none |
| `turn_end` (lead) | buffer the assistant text from `event.message.content` text blocks | none |
| `agent_end` (lead) | `capture` `trusted-final-assistant` (last buffered text) | none |
| `session_before_compact` | drain in-flight captures (bounded; never cancels compaction) | none |
| `session_shutdown` | flush buffer, drain, `shutdown_flush` | none |

- **Ephemeral rather than persisted** (P1): `message` injection accumulates in the session and is replayed by `--continue`, which would duplicate memory. Ephemeral system-prompt injection is reapplied on every agent start, so compaction cannot strip it. No special re-recall after compaction is needed.
- **Prompt capture** uses `before_agent_start.prompt` instead of `input`, because `input` also carries `source: "extension"` text and the old handler shape was wrong. Deck no longer handles `input` for memory.
- Recall does not depend on MCP tool presence at `before_agent_start` (P1 timing).
- Children never capture. The stale `validateSupermemoryPiMcpConfig` gate in `apps/cli/src/pi-launch-command.ts:412-423` is removed, and Pi availability comes from Deck provider config plus host start, through the `runner-launch-command.ts` env overlay.
- **Tests**: SDK `dispose()` does not emit `session_shutdown`, so contract tests invoke the shutdown path explicitly (S§1). The faux provider (`createFauxCore` from `@earendil-works/pi-ai`, S§Method) makes a real-runtime contract test feasible offline.

### D6. Subagents: Deck-owned, subprocess per role (confirmed by P5)

The spawn contract is `pi --mode json -p --no-session [--model M] [--thinking L] [--tools <list>] --append-system-prompt <tmpfile> "Task: ..."` with `stdio: ["ignore","pipe","pipe"]` and `shell: false`. The binary is `process.execPath` plus `process.argv[1]` when available, falling back to `pi`.

- The child env is the parent env plus `DECK_PI_CHILD=1` and `DECK_PI_ROLE=<role>`. The memory loopback endpoint and token file propagate (D11).
- The role prompt is written to a temp file and deleted afterwards. Because `--append-system-prompt` replaces the user's `APPEND_SYSTEM.md` in children, this is documented.
- The child result is parsed from JSONL `message_end` (final assistant text and usage). Tool events are informational only (`tool_result_end` is unverified, R4).
- Modes: single, parallel (max 8 tasks, 4 concurrent), chain. Abort: SIGTERM, then SIGKILL after 5s. `deck-subagents` does not register when `DECK_PI_CHILD=1`.
- Model and thinking come from Deck model config for every role. An unknown model makes the child exit 1, which is mapped to a tool error; an invalid thinking level is pre-validated by Deck.

### D7. Read-only roles enforced twice (confirmed by P5/P6)

Investigate and Quality children get `--tools read,grep,find,ls,<allowlisted Deck MCP tool names>`; `--tools` filters MCP tools too, so the graph and search tool names are generated from the Deck server catalog. `deck-tool-policy` also blocks `edit`, `write`, `bash` and any non-allowlisted mutating tool when `DECK_PI_ROLE` is read-only. Write-capable roles omit `--tools` and keep all tools.

### D8. tool_call pipeline order: policy -> RTK -> graph (confirmed by P6)

- **Policy**: returns `{ block: true, reason }`, which reaches the model as an `isError` result. The execution bridge never sees a `tool_result` for blocked calls; that is acceptable and consistent with Pi semantics, and is documented for `developer-team-execution-convergence`.
- **RTK**: mutates `event.input.command` in place with the owned pinned binary (`@deck/core/owned-tools` `pinRtkRewrite`).
- **Graph redirection**: applies to `bash` commands invoking `grep`/`rg`/`find` over code paths, and to the `grep`/`find` built-ins when enabled. It is advisory and never blocks non-code paths.

### D9. MCP: direct exposure for Deck servers; pi-mcp-adapter removal is mandatory (revised by P7)

- Deck servers are written with `"exposure": "direct"`, so `mcp__<server>__<tool>` names exist for prompts and the `--tools` allowlists. User servers keep their own exposure.
- An extension registering `/mcp` disables built-in MCP. If Deck previously added `npm:pi-mcp-adapter`, removing it is part of the install plan, not optional cleanup (transactional, backed up). If the user installed it themselves, the plan reports a blocking MCP diagnostic with a hint; Deck never removes user entries.
- Tavily: the credential reaches only the Pi child env (D11 covers MCP inheritance). Commands are absolute, and npx-based servers pin the resolved `npx`.

### D10. Version gate, session dir and legacy cleanup

- Preflight parses semver from `pi --version` (exact `1.0.0` output, P2), with minimum `1.0.0`.
- **Session dir fix**: Deck currently sets `PI_SESSION_DIR`, which Pi ignores, in `packages/adapter-pi/src/pi-team-launch.ts:154`, `packages/adapter-pi/src/runner-adapter.ts:1051` and `packages/core/src/config/env-sanitizer.ts:17`. Launch relies on `--session-dir`; env handling switches to `PI_CODING_AGENT_SESSION_DIR`, and the sanitizer recognizes the real name.
- Legacy detection runs on every plan, and cleanup of project-local artifacts stays opt-in. The exception is Deck-added pi-mcp-adapter (D9), whose removal is mandatory. The Deck-added `pi-subagents` entry is removed with the package migration because it would register a conflicting subagent tool.

### D11. Memory token isolation from MCP children (new, from P7)

MCP stdio servers inherit the Pi process env (S§4), so a token in the env would leak to every MCP server. Decision:

1. Deck does not put `DECK_RUNNER_MEMORY_TOKEN` in the Pi env. It writes the per-session bearer token to a 0600 handoff file in the Deck session runtime dir and passes `DECK_RUNNER_MEMORY_TOKEN_FILE`. The file is deleted when the host closes, and the token is already per-session and loopback-only.
2. At factory time, `deck-memory` reads the file into memory and deletes `DECK_RUNNER_MEMORY_TOKEN*` from `process.env`. The subagent tool passes the token-file path explicitly in child env.
3. Defense in depth: Deck `mcp.json` entries set `env` overrides of `""` for the memory variables.

A test with a fake MCP server that echoes its env asserts that no token value is visible. Whether extension factories run before builtin MCP spawns stdio servers is unverified (R6); points 1 and 3 hold regardless of load order. Other inherited secrets (the Tavily key) are visible to all MCP servers, which is an accepted residual (R7).

## Sequence diagram: memory flow

```mermaid
sequenceDiagram
  autonumber
  participant CLI as Deck CLI (launch)
  participant Host as Supermemory runtime host<br/>(loopback 127.0.0.1)
  participant Lead as Pi lead + deck-memory ext
  participant Sub as deck-subagents tool
  participant Child as Pi child + deck-memory ext
  participant SM as Supermemory API

  CLI->>Host: start host (canonical scope; API key stays in CLI)
  Host-->>CLI: endpoint + per-session bearer token
  CLI->>CLI: write token handoff file (0600)
  CLI->>Lead: spawn pi (stdin ignored; DECK_PI_SESSION, DECK_PI_ROLE=lead, ENDPOINT, TOKEN_FILE)
  Lead->>Lead: factory: read token file, scrub memory env
  Lead->>Lead: before_agent_start(prompt)
  Lead->>Host: session_start {role: lead, query: prompt}
  Host->>SM: profile + search (scoped)
  SM-->>Host: memories
  Host-->>Lead: recall context + receipt
  Lead->>Lead: return {systemPrompt: base + recall} (ephemeral)
  Lead->>Host: injection_ack
  Lead->>Host: capture trusted-user-prompt
  Host->>SM: add memory
  Lead->>Sub: subagent(role=investigate, task)
  Sub->>Child: spawn pi --mode json -p --no-session --tools ro-list (DECK_PI_CHILD=1, DECK_PI_ROLE=investigate, TOKEN_FILE)
  Child->>Host: role_start {role: investigate, query: task}
  Host-->>Child: role-scoped recall (or role_policy_skip)
  Child->>Child: ephemeral systemPrompt append
  Child->>Host: injection_ack
  Note over Child: no capture; no subagent tool
  Child-->>Sub: JSONL message_end (final text)
  Sub-->>Lead: tool result
  Lead->>Lead: turn_end (buffer assistant text)
  Lead->>Lead: agent_end
  Lead->>Host: capture trusted-final-assistant
  Lead->>Lead: session_before_compact
  Lead->>Host: drain in-flight captures (bounded)
  Lead->>Lead: next before_agent_start
  Lead->>Host: recall {query: prompt} -> ephemeral append
  Lead->>Lead: session_shutdown (CLI exit)
  Lead->>Host: flush buffer, drain, shutdown_flush
  CLI->>Host: close (drain in-flight, 1s cap); delete token file
```

## Residual risks (not verified by the spike)

| ID | Risk | Mitigation / verification task |
|---|---|---|
| R1 | Full compaction cycle (the spike only observed `session_before_compact`, then a shutdown race) | 9.1 |
| R2 | Raw provider wire payload (the faux provider bypasses `before_provider_request`; Pi-level messages were verified) | 9.2 canary with a real provider |
| R3 | Real `pi-mcp-adapter` conflict (only stub-simulated) | 9.3 |
| R4 | `tool_result_end` in child JSON output (no tool turn was run in a child) | 9.4; D6 does not depend on it |
| R5 | Interactive TUI and `--resume` picker behavior with Deck extensions | 9.5 |
| R6 | Extension factory vs builtin MCP spawn order (affects env scrub point 2 of D11) | 5.8 |
| R7 | MCP servers still inherit other env secrets (Tavily key) | documented; per-server env scoping is a follow-up if Pi adds env isolation |
| R8 | Real thinking-level effects per model | 9.2 |

## Verification strategy

- Strict TDD per `openspec/config.yaml`. Tests use temp `PI_CODING_AGENT_DIR` **and** temp `HOME`, a fake loopback `Bun.serve` on 127.0.0.1, fake `pi` binaries for version and child spawn, stdin ignored on any real spawn, and no network or real installs.
- The real-runtime contract test loads Deck extensions through `DefaultResourceLoader({ extensionFactories })` + `createAgentSession` with the faux provider (S§Method) and calls the shutdown path explicitly. It is gated to skip with a reason if `@earendil-works/pi-coding-agent` is not installed as a dev dependency.
- Gates: `bun test packages/adapter-pi`, the config strict TDD gates, `tsc --noEmit`, baseline ledger comparison. The manual canary is recorded as evidence only.
