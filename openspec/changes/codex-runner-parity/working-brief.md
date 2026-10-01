# Working Brief: Codex runner parity

Status: implementation committed on branch `feat/codex-parity`; v0.8.0 release preparation in progress. The user will create the PR manually. Route: Working Brief (no Full SDD; no durable cross-package contract beyond the decisions below).

## Intent

A user can run `bun run canary:install`, complete Review & Install for Codex in the TUI with every shared tool provisioned, and start `deck-canary codex developer` with the same shared-install, hook and memory behavior Claude and OpenCode already have.

## Acceptance

- Phase 0 contracts verified against Codex CLI 0.159.3 (binary available locally): hooks flag is `[features].hooks` (`codex_hooks` is a deprecated alias; hooks default on); inline `[[hooks.X]]` / `[[hooks.X.hooks]]` and the legacy `hooks = [...]` form both load, from every source together; non-managed hooks are `untrusted` until reviewed, trust is persisted per `hooks.state` hash and can be skipped per process with `--dangerously-bypass-hook-trust`; skills live in `.agents/skills`; a custom agent needs `name`, `description`, `developer_instructions` and is identified by `name`; `codex debug models` yields `models[].slug/display_name/supported_reasoning_levels[].effort`; `[agents]` accepts `max_threads`/`max_concurrent_threads_per_session` (not written; defaults suffice).
- RTK, Codebase Memory, Context Mode and Serena are shared installs: Deck-owned pinned RTK and Codebase Memory (existing shared Codebase Memory wins), shared-or-owned Context Mode, Serena through the owned proxy. MCP entries never contain bare `PATH` names.
- RTK runs as a Deck-owned `PreToolUse` hook (`rtk hook codex` via a Node bridge, rewrite returned through `updatedInput` with the executable word pinned to the owned binary).
- Supermemory is only the pinned official `codex-supermemory@1.0.19` hooks (recall, flush); credential from the shared profile store reaches only the child process env (`SUPERMEMORY_CODEX_API_KEY`); no raw MCP entry, no Deck loopback beside it; foreign Supermemory registrations block the launch.
- Hook merging adds, replaces in place and removes only marker-delimited Deck blocks; user hooks and `hooks.json` are preserved; legacy single-block form migrates.

## Decisions and rationale

- Hook trust: launch passes `--dangerously-bypass-hook-trust` only when Deck-owned RTK/Supermemory hooks exist and the installed Codex advertises the flag. Alternative (write `hooks.state` hashes into the user's `~/.codex/config.toml` through app-server `config/batchWrite`) was rejected: it mutates user-global Codex state and the hashes change with every path change. Residual risk: all non-managed hooks skip review for that process (consistent with the existing always-on sandbox/approval bypass).
- Shared artifact code (`OWNED_RTK_*`, `OWNED_CODEBASE_*`, `pinRtkRewrite`, `rtkHookScript`) moved to `@deck/core/owned-tools`; Claude keeps thin aliases.
- Codex custom agents are now named by role id (`deck-lead`) with the catalog description, because Codex identifies agents by `name`.
- `mergeCodexProjectConfig` extends an existing `[features]` table instead of opening a duplicate header.
- Context Mode's own Codex hooks are not installed (compete with the RTK rewrite on `PreToolUse`; not part of the Claude/OpenCode routes).
- `adaptive-memory` instruction prose is not materialized for Codex: the plugin owns recall and capture.

## Risks

- RTK `updatedInput` rewrite was verified against the pinned 0.50.0 binary and the documented payload, not inside a live model turn (no authenticated session was available).
- Machine-specific absolute paths in project `.codex/config.toml`; use `--local-only` or keep it untracked when sharing a repository.
- Official plugin scripts also read `~/.codex/supermemory.json` / credentials if present; the process env credential takes precedence.

## Evidence

See `apply-progress.md`.

## Global install (user decision)

- Roots: Codex home (`CODEX_HOME`, default `~/.codex`) for `agents/`, `config.toml` blocks and `deck/{manifest.json,hooks/*}`; user home for `~/.agents/skills/**`. The planner keeps a virtual `.codex/**` / `.agents/skills/**` layout; the adapter maps it to the two roots and applies one transaction per root (skills first, rolled back if the Codex-home transaction fails).
- Ownership: manifest hashes as before; a foreign file or skill with a Deck name blocks the plan; `hooks.json`, `AGENTS.md`, foreign agents and MCP servers are never edited; duplicate detection compares only against the user's own entries in the global config.
- Verified on codex 0.159.3: `~/.agents/skills` and `$CODEX_HOME/skills` both load as user skills; global inline hooks (source `user`, untrusted until reviewed) and global MCP servers load in any project. Global agents rely on the documented `$CODEX_HOME/agents` location (not observable through the app-server).
- Migration: legacy per-project installs are detected through `.codex/deck-manifest.json`, reported on each plan, and removed only by `--cleanup-legacy` (unmodified Deck files only, transactional; config.toml loses only Deck's marker blocks).
- Not done: `sandbox_mode = "read-only"` on Investigate/Quality (could not verify it is honored under the sandbox bypass); documented as a limit.

## Follow-up findings (real-install validation)

- Web Search: credential via `webSearchCredential` (env, then Deck-owned shell profile) -> child env through binding `deck-codex-launch-v1` (Tavily + Supermemory keys only); MCP command pinned to the resolved `npx`; `env_vars` forwarding and server start verified on codex 0.159.3.
- Foreign duplicates: a non-Deck registration (user config or unmarked project entry) of the same executable suppresses Deck's own server entry with an info diagnostic; foreign blocks are read-only.
- Scan limit: `CodexProjectScanLimitError` becomes a blocked plan before mutation.
- `rtk hook codex` needs the standard `permission_mode` field (always sent by Codex); minimal smoke payloads without it get no rewrite, `echo` has no RTK equivalent. Nothing to fix.
- Pre-parity Deck-owned `supermemory` MCP blocks and the v1 hook block are retired on the next plan; other worktrees still holding them upgrade on their next run.
