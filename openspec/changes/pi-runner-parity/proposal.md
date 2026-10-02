# Proposal: Pi runner parity

Change ID: `pi-runner-parity`
Route: Full SDD (multiple verticals, durable runner contracts, migration of user-global state, cross-change boundaries).
Precedent: `openspec/changes/codex-runner-parity/` (Working Brief + apply evidence; global materialization, owned binaries, hook rewrite, legacy cleanup).
Evidence brief: `pi-parity-research-brief.md` (session scratchpad, 2026-10-02). Adaptive context was not loaded; official context only.

## Intent

A user on Pi >= 1.0.0 (`@earendil-works/pi-coding-agent`) can complete Review & Install for Pi in the TUI and start `deck pi developer` with the same shared-install, hook-equivalent, subagent, web-search and automatic-memory behavior that Claude, OpenCode and Codex already have, with every Deck artifact materialized globally under the Pi agent directory and nothing written into project-trust-gated `.pi/*` paths.

## User decisions (authoritative)

1. **Subagents**: Deck owns a Pi subagent extension. Deck MUST NOT depend on the community `pi-subagents` package. The design is based on Pi's official `examples/extensions/subagent` (one `pi` subprocess per subagent; markdown agents with `name`/`description`/`tools`/`model` frontmatter; single, parallel and chain modes).
2. **Install scope**: everything is global under `~/.pi/agent/`, honoring `PI_CODING_AGENT_DIR`, to avoid project-trust gating of `.pi/*` (same posture as Codex global materialization).
3. **Supported Pi**: `>= 1.0.0` only. `@mariozechner/*` legacy distributions are dropped.

## Problem (code-traced gaps)

- **Memory is likely off on a clean install**: `apps/cli/src/pi-launch-command.ts:412-423` still requires `validateSupermemoryPiMcpConfig`, but `pi-mcp-config.ts` no longer writes a Supermemory MCP entry, so the provider resolves to "unavailable".
- **Extension contract drift**: `packages/adapter-pi/assets/pi/extensions/developer-team-execution.ts` returns `{ type: "continue", advisoryText }` from `input`, which is not Pi's contract; recall text is likely dropped. There is no assistant capture, no compaction handling, and tests use a fake host. `PiExtensionApi` is hand-rolled rather than typed against the Pi SDK.
- **Third-party dependencies**: `npm:pi-subagents` and `npm:pi-mcp-adapter` are required (`installation-plan.ts:32-33`, `required-tools.ts`), although Pi ships `builtin:mcp` since 0.99.0.
- **Model routing**: only the lead receives `--model`/`--thinking` (`pi-team-launch.ts:134-141`).
- **Missing hooks**: no RTK rewrite, no Grep/Glob graph redirection, no read-only enforcement for Investigate/Quality.
- **Web search** is absent from `PI_INSTALLABLE_TOOLS`.
- **Preflight** checks only `pi --version` without a minimum (`preflight.ts`).
- **Scope contradiction**: project-local writes (`.pi/agents`, `.pi/skills`, `.deck/pi/profiles`) contradict the documented "global" install and fall under Pi project trust.
- **Stale docs**: `docs/runners.md`, `docs/reference/support-matrix.md` (no Claude column; Pi memory "MCP handoff"), `docs/adaptive-memory.md`.

## Scope

| Capability (delta spec) | Summary |
|---|---|
| `pi-global-materialization` | One Deck-managed local Pi package under the Pi agent dir (agents, skills, extensions, prompts), `settings.json` `packages` entry, manifest-hash ownership, `PI_CODING_AGENT_DIR` aware, team profile moved out of the project. |
| `pi-native-mcp` | Global `mcp.json` via Pi `builtin:mcp`; Deck-owned pinned binaries (RTK, Codebase Memory) and shared tools; Tavily web search with credential injected only into the child env; `pi-mcp-adapter` removed. |
| `pi-subagent-extension` | Deck-owned subagent tool (single/parallel/chain) spawning `pi` children with per-role model/thinking and per-role tool policy; Investigate and Quality are read-only. |
| `pi-adaptive-memory` | Deck memory extension over the existing loopback host: recall on `before_agent_start` and on subagent role start, user + assistant capture, pre-compaction drain, shutdown flush; removal of the stale MCP gate. |
| `pi-tool-interception` | `tool_call` handler: RTK rewrite pinned to the owned binary, Grep/Glob redirection to codebase-memory graph search, read-only blocking. |
| `pi-version-and-migration` | `>= 1.0.0` preflight and doctor; detection and transactional cleanup of legacy project-local `.pi` artifacts and of Deck-written `pi-subagents` / `pi-mcp-adapter` entries. |
| `pi-runner-documentation` | `docs/runners.md`, `docs/runner-support.md`, `docs/reference/support-matrix.md` (add Claude column), `docs/adaptive-memory.md`. |

## Non-goals

- No change to the Supermemory loopback wire protocol (`deck-runner-memory-loopback-v1`) or to canonical project scope derivation; Pi consumes them as-is.
- No support for Pi < 1.0.0 or `@mariozechner/*`; no compatibility shim for `pi-subagents`.
- No project-scoped (`-l`) Pi package or `.pi/mcp.json`; no change to user `defaultProjectTrust`.
- No Pi SDK embedding (`createAgentSession()`) inside the Deck CLI; Pi remains a spawned process.
- No changes to OpenCode, Codex or Claude adapters beyond shared `@deck/core` helpers that are additive.
- No OAuth MCP servers in this change.

## Overlaps with active changes (boundaries respected)

| Change | State | Overlap | Boundary |
|---|---|---|---|
| `developer-team-execution-convergence` | apply, passed_with_warnings | Owns the Pi execution bridge (`developer-team-execution.ts`, `REQ-AUTH-004`, Batch D host reachability `RQH-BC-001..003`). | This change MUST NOT alter execution-authorization semantics or the host execution event schema. It moves memory responsibilities out of that extension into a separate Deck memory extension and only fixes Pi event return shapes; execution-dossier evidence stays byte-compatible. `invocation-required` activation stays gated by that change. |
| `opencode-supermemory-plugin-profiles` | apply, in_progress | Shares `apps/cli/src/supermemory-runtime-host.ts` and the loopback bridge. | Read-only consumer: no host contract edits. Any host change is additive, runner-gated to `pi`, and coordinated before merge. |
| `canonical-deck-managed-session-runtime` | review, completed (not archived) | Pi launch lifecycle (`runPiLaunch`, separate spawn path). | Launch changes stay inside the session-runtime lease shape it defined; no second host is created. |
| `fix-supermemory-userid-validation` | exploring | Supermemory identity. | Pi uses the canonical host identity only; no Pi-specific identity logic. |
| `deck-product-documentation` | apply, in_progress | `docs/runners.md`, support matrix. | Docs tasks are sequenced last and rebased on that change's edits. |
| `pi-support-parity-opencode` | archived (still under `changes/`) | Defined project-relative Pi paths (`.pi/agents`, `.pi/skills`, `.deck/pi/profiles`) and `pi-mcp-adapter` usage. | Superseded by user decision 2; historical records are preserved, not edited. |

## Rollback plan

- **Feature boundary**: the global package is a single directory plus one `settings.json` `packages` entry and Deck-marked `mcp.json` servers, all recorded in a Deck manifest. Rollback = run the uninstall/cleanup path, which removes only manifest-matching files and Deck entries, restoring the pre-install `settings.json`/`mcp.json` byte content for user entries.
- **Legacy cleanup is transactional**: Deck-added `pi-mcp-adapter`/`pi-subagents` entries are removed during install with a backup; project-local artifacts are reported on every plan and removed only via an explicit cleanup action; each cleanup writes a backup under the Deck state dir before deletion, and a failed step restores the backup.
- **Release rollback**: reverting the release restores the previous adapter, which still understands its own project-local layout; global files are inert for older Deck versions (they are not referenced by old launch args) and can be removed with the documented cleanup command.
- **Memory**: if the Pi memory extension fails at runtime it degrades to "launched without adaptive-memory injection" with a diagnostic; it never blocks a session.

## Risks

- Phase 0 spike (2026-10-02) verified extension contracts, CLI flags, packages, MCP and trust on pi 1.0.0 with a faux provider; full compaction, raw provider payload, real `pi-mcp-adapter`, child `tool_result_end` and interactive TUI/`--resume` remain unverified (design R1-R8, Phase 9).
- MCP stdio servers inherit the Pi env; the loopback token is moved to a handoff file and scrubbed (design D11).
- Deck-added `pi-mcp-adapter` disables built-in MCP, so its removal is mandatory during install rather than opt-in.
- Subagent children inherit env and global extensions; recursion and duplicate memory capture are prevented through `DECK_PI_CHILD`/`DECK_PI_ROLE`.
- Deck currently sets `PI_SESSION_DIR`, which Pi ignores (real variable: `PI_CODING_AGENT_SESSION_DIR`).
- Global materialization affects every project the user opens in Pi, including projects that never ran Deck.
- MCP `codemode` default exposure changes tool naming visible to agents; prompts must match the chosen exposure.
