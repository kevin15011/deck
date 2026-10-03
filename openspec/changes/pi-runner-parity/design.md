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

## Implementation deviations

Recorded during apply (Phases 1-3). Each entry is the smallest safe adjustment to the design above.

1. **Execution bundle is adapted for Pi's Node runtime (new finding).** The generated `developer-team-execution.generated.js` is built with `bun build --target=bun`, which emits the Bun-only `import.meta.require`. Pi 1.0.0 runs on Node, and loading the bundle fails with `Failed to load extension: N0 is not a function` (verified against the installed Pi, with and without the global package). The generated asset must not be hand-edited and its source digest is pinned by reachability tests, so `pi-bundle-compat.ts` rewrites `import.meta.require` to a `createRequire(import.meta.url)` shim in the *materialized copy* (`impl.js`). Tests prove the adapted bundle imports under Node and that the original fails.
2. **`PiExtensionApi` in `developer-team-execution.ts` is not replaced (task 1.5, partial).** That file belongs to `developer-team-execution-convergence`, and changing it alters the pinned generated-asset digest; regenerating requires Bun 1.3.12 (the environment has 1.4.0 and the generator refuses to run). New Deck extensions are typed against Pi's `ExtensionAPI`/`ExtensionFactory` through `pi-extension-types.ts`; the legacy type disappears when that file is next regenerated by its owner.
3. **Extension layout is `extensions/<name>/index.js` + `impl.js`.** `index.js` is a generated guard (`renderGuardedExtensionEntry`) that checks `DECK_PI_SESSION`/`DECK_PI_CHILD`/`DECK_PI_ROLE` *before* dynamically importing `impl.js`, so a plain `pi` session never evaluates Deck extension code. The execution extension is `scope: "lead"` (children never register execution-authorization hooks).
4. **"Deck-added" provenance for `pi-subagents`/`pi-mcp-adapter` has two sources.** The manifest records `settings.addedPackages` going forward, but earlier Deck versions kept no manifest. Their presence is inferred from leftover Deck artifacts (`<agentDir>/agents/deck-lead.md` or `<agentDir>/skills/deck-lead/SKILL.md`). Without either, entries are treated as user-installed and kept.
5. **A user-added `pi-mcp-adapter` blocks the whole plan only when MCP servers are being configured.** With no Deck MCP server selected it is a warning, because nothing would be disabled that Deck relies on.
6. **Legacy project-local APIs are retained, deprecated, and off the production path.** `buildPiTeamLaunchPlan` without `agentDir`, `materializeTeamProfile`, `applyDeveloperTeamInstall` and `runPiLaunch` (which has no production caller) keep their project layout for the existing execution-reachability and legacy-launch tests owned by other changes. `createPiRunnerAdapter` (the production composition) uses only the global layout; a contract test asserts that plan/apply/verify/rollback/launch touch nothing under the project or `HOME`. `runner-capabilities.ts` (unused by the CLI) was not migrated.
7. **Skill discovery gains a `pi-deck-package-skills` source** (`<agentDir>/deck/package/skills`), and `pi-user-agent-skills` follows the resolved agent dir. Without it the skill registry would lose every Deck/standalone skill that moved into the package.
8. **Persisted model/thinking assignments are read from the package agents first, then from the pre-package `<agentDir>/agents` and project `.pi/agents`**, so assignments survive the upgrade.
9. **The lead system prompt now composes capability instructions and the orchestrator personality.** The old apply path only composed the memory bundle into `system-prompt.md`.
10. **Package `version` is the constant `0.0.0`.** Pi does not use it for local paths and it avoids a release-coupled diff on every update.
11. **Core allowlist additions are additive:** `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `DECK_PI_SESSION`, `DECK_PI_ROLE`, `DECK_PI_CHILD` (the `DECK_PI_SESSION` name otherwise matches the session-key secret heuristic and would be dropped from the launch environment). `PI_SESSION_DIR` is removed because Pi ignores it.
12. **Old loose Deck files in `<agentDir>/agents` and `<agentDir>/skills` are not removed yet.** They are legacy artifacts handled by Phase 7 (detection and opt-in cleanup); until then Pi may report duplicate skill names.
13. **Per-capability `write-pi-mcp-config` actions no longer write `mcp.json` for Pi (except Serena).** Context Mode, Codebase Memory, Context7 and Web Search are materialized together with the Deck package in the manifest-owned transaction; their review-plan action only verifies that the server can be configured (resolvable absolute command, Tavily provider and credential) and reports it as applied with the package install. Serena keeps its evidence-gated writer (authorization and readiness evidence cannot be recreated at plan time); the next plan adopts that entry, adds `exposure: "direct"` and the memory `env` blanks, and records it in the manifest.
14. **MCP server selection.** An explicit TUI selection (`capabilityIds`) is authoritative: only those servers exist and an unselected owned server is removed. A launch-time plan (no explicit selection) adds the servers implied by enabled instruction packages and Web Search and keeps every server Deck already owns, so a TUI-only choice survives `deck pi developer`. A selected server whose binary cannot be resolved is skipped with a warning; if Deck already owns it, its existing entry is kept.
15. **Verified against Pi 1.0.0 during apply (hermetic, faux provider).** Direct-exposed tools are named `mcp__<server>__<tool>` with `-` sanitized in both parts (`context-mode` + `web-search` -> `mcp__context_mode__web_search`). An `env` entry of `""` overrides the inherited variable in the MCP child (`DECK_RUNNER_MEMORY_TOKEN` seen as empty even when set in the Pi environment); other inherited secrets (for example the Tavily key) remain visible, which matches residual R7. A real `deck`-materialized global package loads in a Deck lead session with the guard entry, skills, the lead profile and the MCP tools, and loads nothing outside a Deck session.
16. **Web Search is an `installKind: "mcp-server"` installable tool.** Its install step only checks that `npx` is available (Tavily runs through `npx` at session start). The credential comes from the shared resolution (`webSearchCredential`, composition root) and reaches only the launched Pi process through a sensitive env overlay bound by `deck-pi-web-search-v1`; it is never written to `mcp.json`, settings, agent files or logs. A missing credential produces a launch diagnostic and no variable.
17. **Owned binaries are used when the adapter supplies `piTools`.** `installPiTools` keeps its shared-binary behavior for callers that do not (the legacy `installing` screen in `apps/cli/src/tui/app.tsx` still calls it without `piTools`); the production adapter always passes the Deck-owned resolver, so RTK is always the pinned artifact and Codebase Memory prefers a usable shared binary before the pinned release.
18. **Read-only roles get the D7 allowlist as agent frontmatter.** `deck-investigate` and `deck-quality` are written with `tools: read,grep,find,ls,<mcp read-only names>` (no `bash`/`edit`/`write`). Note for Phases 4 and 6: with no `bash`, Quality cannot run test suites; if that is not intended, widen the allowlist in `pi-mcp-catalog.ts`/`global-materialization.ts` and the tool-policy extension together.
19. **Deck Pi extensions are authored in TypeScript and bundled by a new generator.** Sources live in `packages/adapter-pi/src/pi-extensions/` (typed against Pi's `ExtensionAPI`, unit-tested directly); `scripts/generate-pi-extension-assets.ts` bundles `entries/<name>.ts` with `Bun.build({ target: "node" })` into `assets/pi/extensions/<name>.generated.js` (unminified, never `import.meta.require`), embedded in the compiled CLI by `pi-extension-assets.ts` (`with { type: "file" }`). It is separate from the canonical-Bun `generate-runner-execution-assets.ts` (whose pinned digests are untouched); staleness is detected by a `source-sha256` header over all non-test sources, so the test does not depend on the bundler version.
20. **Subagent tool details.** Parameters are plain JSON Schema (no `typebox` import; verified against Pi 1.0.0); no custom renderers. Per-role model/thinking/read-only tools come from the generated agent frontmatter (which already carries the user's Deck config); read-only roles use the frontmatter `tools:` (fallback `read,grep,find,ls`), write roles get no `--tools`. `deck-lead` is not delegable; `investigate` and `deck-investigate` are both accepted. `DECK_PI_ROLE` carries the short role name. An invalid thinking level is a tool error before spawn. Children have a 30 min safety timeout. Agents are re-read on every call. The process-local memory handoff (`Symbol.for("deck.pi.memory-handoff")`) lets `deck-subagents` forward the endpoint and token-file path after `deck-memory` scrubs `process.env`.
21. **Real-runtime evidence for Phase 4.** `pi-cli.contract.test.ts` runs the real Pi 1.0.0 binary hermetically (isolated HOME and agent dir, faux provider, stdin ignored): delegation, per-role model/thinking/`--tools`, unknown role, unstartable child model, and inert outside a Deck session. Skipped with a reason if no `pi` binary is found.
22. **5.7 is satisfied by neutralization, not source removal.** `developer-team-execution.ts` and its generated bundle are owned by `developer-team-execution-convergence`; the generator (`generate-runner-execution-assets.ts`) refuses to run without the canonical Bun 1.3.12 (the environment has 1.4.0) and regenerates all three runners' pinned assets, so the bundle was left byte-identical. Its legacy memory paths (`input` recall/capture, `role_start`, `shutdown_flush`) read the bearer token only from `DECK_RUNNER_MEMORY_TOKEN`, which Deck never exports to Pi (D11), so they send nothing. `execution-memory-neutralization.test.ts` pins that against the real bundle (and shows it would send if a token were present). The dead `input` handler and memory code disappear whenever the owner next regenerates the bundle under the canonical Bun; no execution-evidence schema was touched.
23. **5.1: the gate lives only in the legacy `runPiLaunch`.** `apps/cli/src/pi-launch-command.ts` has no production caller, and its tests are owned by earlier changes, so it is left as is. The production path (`runRunnerLaunch` -> `executeRunnerLaunchPlan`) never consulted `mcp.json` for memory: availability already comes from Deck config plus the runtime host. What was wrong there was the credential transport (a bearer token env var), now replaced for the Pi runner only: `createPiMemoryTokenHandoff` writes `<stateHome>/runtime/pi-memory-*/token` (0600 file in a 0700 dir, stale sweep after 24 h), `withPiMemoryLoopback` exports `DECK_RUNNER_MEMORY_ENDPOINT` + `DECK_RUNNER_MEMORY_TOKEN_FILE` only (no token, no Codex bridge variables), and the directory is removed in the launch `finally` after the host closes. `DECK_RUNNER_MEMORY_TOKEN_FILE` is added to the core runner env allowlist (additive; the name matches the token-secret heuristic). `pi-memory-launch.test.ts` drives the real Pi adapter, the real host and the real Pi binary (faux provider) end to end.
24. **`DECK_PI_MEMORY=disabled` launch switch (new).** The Pi launch plan sets it when adaptive memory is disabled or the provider is not Supermemory, so `deck-memory` stays silent instead of emitting its "endpoint absent" diagnostic on every launch. With memory enabled but no endpoint (for example host start failure) the extension still emits exactly one diagnostic.
25. **Memory extension details.** The loopback host only registers expected injections when events carry `logicalTurnId` and `snapshotGeneration`, so Pi sends `t<n>` and the per-session run counter on `session_start`/`recall`/`role_start` and the matching `injection_ack` (hash of the exact advisory text). `session_shutdown` with `reason: "reload"` drains but sends no `shutdown_flush` (the session continues; the host would retire it). Captures are retried once with the same event id; they are subject to the host's high-signal capture eligibility (low-signal text is skipped host-side and visible in host metrics). Children also send `shutdown_flush` for their role session. The Pi system prompt arrives as a `system` message in the provider context (`context.systemPrompt` is empty), which is where tests read the injected recall.
26. **R6 resolved (verified on Pi 1.0.0):** extension factories run, and scrub `DECK_RUNNER_MEMORY_TOKEN*` from `process.env`, before Pi spawns stdio MCP servers (an MCP child with no env blanks saw both variables as unset; the non-secret endpoint remains visible and is blanked by the `mcp.json` env entries). Defense in depth (file handoff plus blanks) is kept regardless.
27. **`deck-tool-policy` is one handler with a fixed pipeline and a package-local `config.json`.** The extension runs policy, then RTK, then graph in a single `tool_call` handler (so the order is deterministic regardless of extension load order). Its static configuration (`rtkBinary`, `graphRedirect`) is written by the installer to `extensions/deck-tool-policy/config.json` (manifest-owned like every package file): `rtkBinary` is the Deck-owned RTK path when RTK is selected (an explicit selection must include `rtk`; a launch-time plan keeps using a usable owned binary), `graphRedirect` follows the `codebase-memory` server selection. `buildDeckPiPackageFiles` gained `extraFiles` for this. The extension registers no handler when nothing applies (lead without RTK or graph).
28. **Policy and RTK details.** Read-only roles (`investigate`, `quality`) are deny-by-default: only `read/grep/find/ls` and the catalog's read-only MCP tools proceed, so every `bash` call is blocked (consistent with deviation 18; Quality still cannot run test suites). RTK uses the `rtk hook claude` JSON protocol that the Claude/Codex hooks use, with the existing `pinRtkRewrite` from `@deck/core` bundled in; it runs asynchronously with a 3 s cap, and any failure, timeout or unpinnable rewrite leaves the command unchanged. A missing binary produces one diagnostic per session (UI notification, else stderr).
29. **Graph guidance is advisory and never blocks (revised during Phase 7/8 to match the Claude parity target).** An earlier Phase 6 implementation blocked the first code-structure search per query; the lead decision is that the search always runs. For the first code-structure search in a session (`grep`/`rg`/`egrep`/`find` commands over source paths or symbol-shaped patterns, and the `grep`/`find` built-ins), the `tool_call` handler records the call id and a `tool_result` handler appends one concise text part naming the `mcp__codebase_memory__*` tools to the successful result (failed searches get nothing). The advisory is added at most once per session. Non-code files (yaml, json, md, lock, logs...), literal strings and complex shell pipelines are never touched. The classification is a heuristic (`graph.ts`), deliberately conservative.
30. **Coexistence (6.4).** Verified with the real execution bundle in both load orders and against the real runtime: bash rewriting does not disturb the execution hooks, `subagent` delegation to apply and QA roles is not blocked in static-compatible mode, and the interception never writes any evidence field (`deck*` inputs are only ever created by the execution extension). Note for `developer-team-execution-convergence`: delegation to `deck-setup` through the Deck `subagent` tool is still fail-closed by that extension's preparation-authorization (`modification-not-authorized:AUTHZ_PROVIDER_MISSING`) until its provider is wired; policy blocks produce no `tool_result`, as design D8 states.
31. **Legacy detection works by probing known Deck names and matching current Deck templates (Phase 7).** Earlier Deck versions kept no manifest for project-local files, so "unmodified" means "equal to what the current templates would write" (hashes of the legacy-layout and package-layout builds, ignoring the per-user `model`/`thinking`/`tools` frontmatter lines; the profile and the execution extension are compared the same way). `pi-legacy.ts` probes only the agent/skill/profile names the current Deck knows (`defaultLegacyProbeKeys`) in `<project>/.pi`, `<project>/.deck/pi/profiles` and the pre-package `<agentDir>/agents|skills`. Files written by an older Deck version whose templates differ are reported and kept (never deleted), which is the fail-safe direction required by `pi-version-and-migration`. Cleanup needs the Deck config to rebuild the templates, so the Core contract is `cleanupLegacyInstall(projectRoot, { deckConfig })` (the production-preference audit forbids an optional `deckConfig`); without it nothing is provably unmodified and nothing is removed.
32. **Cleanup transaction.** Everything that will change (files and project `settings.json`) is backed up under `<stateDir>/backups/pi-legacy/pi-legacy-<timestamp>/` first (an unwritable backup aborts before any mutation), each file is re-verified immediately before removal, and any failure restores every original. Project package entries (`pi-subagents`, `pi-mcp-adapter`) are removed only when Deck artifacts in the same scope prove Deck added them; the global entries are handled by the install plan itself (mandatory removal, deviation 4) and are labelled so in the legacy report.
33. **Doctor.** `pi-doctor.ts` is a pure inspection over the installer's `PiFileIO` seam; `apps/cli` supplies the real inputs (`pi --version`, `pi list` as the only runtime cross-check, executable checks, the state runtime directory, and the `source-sha256` headers of the extension bundles embedded in the running Deck build). `deck pi developer --cleanup-legacy` is the user-facing opt-in flag (parsed for Pi like the Codex flag and routed through the same `runRunnerLaunch` cleanup step).
34. **Legacy TUI screens are unreachable.** `pi-preflight-checking`, `pi-preflight`, `required-tools`, `optional-tools`, `installation-review` and `installing` (the screens that call `installPiTools` without owned tools) are never entered by `resetCursor`; Environment selection leads to the personality screen and then to the adapter-driven Setup Dashboard (`composeRegisteredRunnerDashboard` -> `runRunnerReviewPlan` -> `applyDeveloperTeamInstall`), which goes through the new global install. The dashboard's Supermemory flow for Pi stores the credential in Deck's secret store only; `writeSupermemoryPiMcpConfig` is reachable only from the unreachable `memory-provider-selection` screen. The `deck-pi-web-search-v1` binding is wired end to end (adapter overlay, `executeRunnerLaunchPlan`) and covered by tests.
35. **A plain `pi` still lists the Deck skills and extension names** (the package is registered globally), but evaluates none of the extension code and loads no Deck system prompt; this matches the requirement that skills and agent definitions MAY remain discoverable. Verified against the real Pi 1.0.0 in a temp HOME. Pi's own session store for `--continue`/`--resume` lives at `<project>/.deck/pi/sessions/developer-team`; the install writes nothing else into projects.
36. **Skill precedence in Deck sessions (real-machine defect).** Pi 1.0.0 keeps the first skill per name; merge order is CLI package sources, then settings packages, then auto-discovered `<agentDir>/skills` and `~/.agents/skills`. Stale legacy `deck-*` skills and Codex-written `~/.agents/skills/deck-*` therefore beat the package. The global lead launch now also passes `--extension <agentDir>/deck/package` (Pi dedupes it against the settings entry; verified with Pi's `DefaultResourceLoader` in a hermetic HOME: package wins, user skills such as `my-own` still load, the extension loads once). `--skill` entries lose to auto-discovery and `-ns` would drop all user skills, so they were rejected; collisions are still listed as warnings (Pi has no per-launch exclusion), and an optional `"skills": ["!skills/deck-*"]` settings line is documented in troubleshooting.
37. **Legacy cleanup extended.** Global `deck-*` agent/skill files that differ from every template but carry the Deck contract marker and a matching name are state `stale` and removed by `--cleanup-legacy` (backup first, hash re-verified before removal). Project copies, unmarked files and `~/.agents/skills` are never removed. Doctor and the install plan state that legacy skills shadow the package.
38. **Quiet startup.** Pi has `quietStartup` (settings only; no CLI flag, `--verbose` overrides it) but it hides the header and resource listing while still showing skill-conflict diagnostics, and it can only be set in settings files. Not applied; reported only.
39. **Deck-owned skill exclusions in `settings.json` (supersedes the optional `"!skills/deck-*"` line of deviation 36).** Verified with Pi 1.0.0's `DefaultResourceLoader` (hermetic HOME and agent dir, `pi-skill-precedence.test.ts`): top-level `skills` settings entries are matched against auto-discovered skills (`<agentDir>/skills`, `~/.agents/skills`) by relative path, file name, skill directory name or absolute path, and do not apply to skills a package ships (those use per-package filters). Both `"!skills/deck-*"` and the bare directory name `"!deck-lead"` hide the non-package copies with no collision diagnostics, keep package skills loaded, keep user skills (including a user `deck-mine`, for exact names) and work in plain and Deck sessions. The wildcard would also hide a user's own `deck-*` skill, so the install writes exact names, one `!<name>` per skill the package ships (derived from the package skill list). Entries are recorded in `manifest.settings.skillExclusions` (absent in older manifests parses as empty), added without duplicating user entries, never tracked or removed when the user already had the identical entry, dropped when no longer shipped, removed on uninstall (an emptied `skills` key is removed), and a non-array `skills` blocks the plan. `deck doctor` warns when an owned exclusion has disappeared from settings; `verifyPiGlobalInstall` reports it too.
