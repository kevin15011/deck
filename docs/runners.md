# Runners

Deck is runner-aware rather than runner-agnostic. The CLI registers operational adapters for Pi, OpenCode, Codex, and Claude (global plugin files); other detected binaries remain visible without being represented as Deck execution targets.

> **Audience:** People choosing or diagnosing a Deck runner.
> **Authority:** Runner boundary reference; adapter registries and preflight code define current behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [runtime detection](../apps/cli/src/runtime-detection.ts), [adapter registry](../apps/cli/src/runner-adapters.ts), [Pi adapter](../packages/adapter-pi/src/runner-adapter.ts), [OpenCode adapter](../packages/adapter-opencode/src/runner-adapter.ts), [Codex adapter](../packages/adapter-codex/src/runner-adapter.ts), [Claude adapter](../packages/adapter-claude/src/runner-adapter.ts), and [capability registry](../packages/core/src/runner-capability-registry.ts).

## Support status

| Runtime | Status | Deck behavior |
|---|---|---|
| Pi | **Supported** (Pi >= 1.0.0) | Detects the binary, enforces the minimum version, reviews tools and MCP, configures capabilities, materializes the Developer Team globally under the Pi agent directory, and launches `deck pi developer` with Pi's normal interactive TUI. |
| OpenCode | **Supported** | Detects the binary, reads runner configuration and package evidence, configures capabilities, and materializes the Developer Team through the TUI. |
| Claude | **Supported with route limits** | A Deck-owned global plugin carries the Developer Team files, pinned shared tools, and the official Supermemory plugin; the Deck CLI starts limited sessions. Protected execution controls and Deck's memory runtime are not part of this route. |
| Codex | **Supported with route limits** | Deck can configure and launch the Developer Team for Codex through the TUI and the Deck CLI: native roles and skills, shared tools pinned to verified executables, an RTK `PreToolUse` hook, and the official Supermemory plugin hooks. Protected execution controls remain static-compatible. |

Detection is not parity. A detected binary does not imply that Deck can install packages, write runner configuration, launch a team, or verify runner-specific effects for that runtime. Codex has a Developer Team adapter with shared tool installs, owned hooks, and the official Supermemory plugin, but it still does not claim first-class protected execution controls.

## Pi

Deck supports **Pi 1.0.0 or newer** (`@earendil-works/pi-coding-agent`). Preflight and `deck doctor` parse `pi --version`; an older, unparseable or missing Pi blocks install and launch with an upgrade hint (`npm install -g @earendil-works/pi-coding-agent@latest`). The older `@mariozechner/*` distributions and Pi < 1.0.0 are not supported.

### Where Deck installs

Everything Deck installs is global and manifest-owned; the install writes no project files (`<project>/.pi` is never written, and no Deck package, agent, skill or profile goes into `<project>/.deck`). The only project-side artifact is Pi's own session store for `--continue` and `--resume`, `<project>/.deck/pi/sessions/developer-team`, created at launch.

| What | Location |
|---|---|
| Pi agent directory | `$PI_CODING_AGENT_DIR` when set (must be an absolute path), otherwise `~/.pi/agent` |
| Deck package (agents, skills, prompts, extensions) | `<agent dir>/deck/package`, registered once in `<agent dir>/settings.json` `packages` as `deck/package` |
| Extensions | `<agent dir>/deck/package/extensions/<name>/{index.js,impl.js}`: `developer-team-execution` and `deck-subagents` (lead only), `deck-memory` and `deck-tool-policy` (lead and children) |
| Lead system prompt | `<agent dir>/deck/profiles/developer-team/system-prompt.md`, passed with `--system-prompt`; `SYSTEM.md` and `APPEND_SYSTEM.md` are never written |
| Deck MCP servers | `<agent dir>/mcp.json`, absolute commands, `"exposure": "direct"` (tool names look like `mcp__codebase_memory__search_graph`) |
| Ownership manifest | `<agent dir>/deck/manifest.json` (content hashes; Deck replaces or removes only what it recorded) |

Deck replaces or removes only files whose hashes match its manifest; a Deck file you edited blocks the plan with a clear message instead of being overwritten. Your own `settings.json` values and `mcp.json` servers are preserved.

### Deck-session activation guard

The Deck extensions do nothing unless a Deck launch sets `DECK_PI_SESSION=1` (and `DECK_PI_ROLE`, plus `DECK_PI_CHILD=1` in subagent children). A plain `pi` in the same agent directory still loads the package, so it lists the Deck skills and the extension names, but it evaluates none of the extension code and does not load the Deck system prompt, delegation tool, tool interception or memory. Deck therefore never changes how Pi behaves outside `deck pi developer`; Deck skills and agent definitions remain discoverable, which the design allows.

### What the Deck session adds

- **Subagents.** The lead gets a Deck `subagent` tool (single, parallel with up to 8 tasks and 4 at a time, and chain modes). Each role runs as a separate `pi --mode json -p --no-session` child with that role's model and thinking level from the Deck model configuration; unassigned roles inherit the lead's. Children never get the delegation tool.
- **Tool interception** (one `tool_call` handler in `deck-tool-policy`): role policy first, then RTK, then graph guidance. Read-only roles (Investigate and Quality) are blocked from mutating tools and have no shell; `bash` commands of the other roles are rewritten to the Deck-owned RTK binary when RTK is selected; and the first code-structure `grep`/`rg`/`find` search of a session runs normally and gains one concise note pointing at the Codebase Memory graph tools. Graph guidance never blocks a search, and non-code files and literal strings are untouched.
- **Adaptive memory** (`deck-memory`): see [Adaptive memory](adaptive-memory.md#pi-event-flow). The extension also registers the explicit tools `memory_search` and `memory_save` (see [Explicit memory tools](adaptive-memory.md#explicit-memory-tools-on-demand-search-and-save)); read-only roles get only `memory_search`.
- **Web Search**: the Tavily credential reaches only the launched Pi process environment, bound to that launch; it is never written to `mcp.json`, settings or agent files.

### Setup and launch

Pi-specific setup can include:

- tool review and the shared `context-mode`, Codebase Memory, RTK, Context7, Serena and Web Search capabilities (Deck-owned pinned binaries where applicable);
- model/provider discovery from Pi settings, `pi --list-models`, and configured environment variables;
- per-agent model and thinking assignments;
- global Developer Team materialization (the review plan lists every path under the agent directory).

```sh
deck pi developer
deck pi developer --continue
deck pi developer --resume
deck pi developer --memory=supermemory
deck pi developer --memory=none
deck pi developer --cleanup-legacy
```

`deck pi developer` plans and applies the global install when needed and then starts Pi's normal interactive TUI as the Deck lead session; Deck sessions are stored through `--session-dir`, so `--continue` and `--resume` use Pi's own session handling.

### Migrating from earlier Pi installs

Earlier Deck versions wrote `.pi/agents`, `.pi/skills` and `.deck/pi/profiles` into projects, loose Deck agents and skills into `<agent dir>/agents` and `<agent dir>/skills`, and required the community `pi-subagents` and `pi-mcp-adapter` packages.

- **Mandatory, on install:** a `pi-mcp-adapter` or `pi-subagents` entry that Deck added is removed transactionally with a backup, because `pi-mcp-adapter` disables Pi's built-in MCP and `pi-subagents` would register a second `subagent` tool. An entry you added yourself is never removed: a `pi-mcp-adapter` entry produces a blocking MCP diagnostic, a `pi-subagents` entry a warning.
- **Detected on every plan:** the legacy project and loose global files above are listed with their state and a cleanup hint; nothing is deleted automatically.
- **Opt-in cleanup:** run `deck pi developer --cleanup-legacy` once from the project (an interactive run asks for confirmation first, and the launch continues afterwards). Files that still match the current Deck templates (ignoring your `model`, `thinking` and `tools` frontmatter lines), global `deck-*` agent/skill files in the Pi agent directory that are demonstrably Deck-authored by an older version (a `deck-*` name, the Deck contract marker and a matching frontmatter name), and package entries Deck added are removed; each removed item is backed up first under `$XDG_STATE_HOME/deck/backups/pi-legacy/` (default `~/.local/state/deck/backups/pi-legacy/`), and any failure restores everything. Other files that differ from the templates (no Deck marker, a mismatching name, or project-local copies) are kept and listed: delete them yourself if unwanted. `~/.agents/skills` belongs to the Codex install and is never touched.

`deck doctor` reports the Pi version and minimum, the resolved agent directory, package registration (cross-checked with `pi list`), manifest drift, extension files and their `source-sha256` header, the pinned RTK binary, the MCP entries (absolute command, direct exposure, blanked memory variables), the `pi-mcp-adapter` conflict, stale `pi-memory-*` token directories, and legacy artifacts.

### Known limits (Pi)

- Pi >= 1.0.0 only.
- Subagent children are started with `--append-system-prompt`, which **replaces** your `APPEND_SYSTEM.md` for those children (the lead keeps it).
- MCP servers started by Pi inherit Pi's environment, including non-memory secrets such as the Web Search key; the memory bearer token is withheld (file handoff plus blanked `DECK_RUNNER_MEMORY_*` entries).
- Investigate and Quality have no shell, so Quality cannot run test suites.
- Delegating to `deck-setup` through the Deck `subagent` tool fails closed (`modification-not-authorized`) until `developer-team-execution-convergence` wires its authorization provider.
- The graph guidance classification is a conservative heuristic; it may miss a code search or add its note to a borderline one.
- Legacy cleanup matches the current Deck templates only.

## OpenCode

OpenCode preflight reads the runner version, searches the supported configuration candidates, and checks for the OpenCode package manifest. Package evidence is resolved from configuration, `PATH`, and canonical targets without treating a declaration alone as proof that a tool is usable.

OpenCode-specific setup can include:

- package and MCP configuration review;
- `context-mode`, Codebase Memory, RTK, Context7, and Serena evidence;
- runner-native model discovery and model-specific reasoning variants;
- Developer Team installation through OpenCode's native surfaces;
- runner-exposed skill inventory discovery.

The interactive dashboard presents packages, adaptive memory, teams, and a review/install plan. A plan can be blocked when required setup evidence, such as Supermemory configuration, is incomplete.

## Codex

Codex preflight requires Codex 0.145.0 or newer, checks the launch routes (`exec`, `resume`, `resume --last`) from the installed help output, and verified the config, hooks, custom-agent, and `codex debug models` contracts against 0.159.x. Materialization is global, like the Claude plugin and the OpenCode config, and never touches a project: custom agents in `$CODEX_HOME/agents/deck-*.toml` (default `~/.codex`; one per canonical role, named by its role id, with the model and `model_reasoning_effort` assigned in the model screen), skills in `~/.agents/skills/`, marker-delimited blocks in `$CODEX_HOME/config.toml`, and Deck's own files (ownership manifest, hook scripts) under `$CODEX_HOME/deck/`. Model choices come from `codex debug models` for the signed-in account and are global. Running the Deck CLI in any project creates or changes no project files.

Before the first launch, sign in with `codex login`. Because the configuration is global, project trust is not required for Deck's agents, skills, MCP servers or hooks, and Deck never changes trust.

Ownership is strict: Deck writes only files recorded in its manifest (with their hashes) and its own marker blocks in `config.toml`. Your `hooks.json`, `AGENTS.md`, other agents and skills, and your own MCP servers are never edited; a file or skill that already uses a Deck name blocks the plan with a clear message instead of being overwritten. If you already registered the same executable as one of Deck's MCP servers (for example `codebase-memory-mcp`), Deck leaves yours in place and does not add a second server.

Review & Install for Codex can include:

- **RTK**: a Deck-owned pinned binary (the same reviewed release Claude uses) under the Deck data root, plus a Deck-owned `PreToolUse` hook for `Bash` that asks `rtk hook codex` for a rewrite and returns it through `updatedInput`, with the executable word pinned to the owned binary. The hook needs a Node.js 18+ runtime.
- **Codebase Memory**: an existing shared executable is reused (the per-user daemon must match the client version); otherwise the pinned native release is installed into the Deck data root. The MCP entry always stores the resolved absolute path.
- **Context Mode**: a usable shared executable is reused; otherwise the pinned npm release is installed into the Deck data root. The MCP entry stores the resolved absolute path. Context Mode's own Codex hooks are not installed: they would compete with the RTK `PreToolUse` rewrite and are not part of the Claude or OpenCode routes.
- **Serena**: Deck's owned launcher through Deck's hidden Serena MCP proxy, after explicit selection.
- **Explicit memory tools**: a Deck-owned stdio MCP server `deck-memory` (the hidden `memory-mcp` internal subcommand, pinned to the running Deck binary) exposes `memory_search` and `memory_save` through the Deck loopback host when Supermemory is selected. It holds no Supermemory credential, receives only the loopback endpoint and a token-file path, and lists no tools outside a Deck launch. See [Adaptive memory](adaptive-memory.md#explicit-memory-tools-on-demand-search-and-save).
- **Supermemory**: only the official `supermemoryai/codex-supermemory` plugin, pinned to one npm release and limited to its two documented lifecycle hooks (`UserPromptSubmit` recall and `Stop` flush). The profile credential entered in the TUI is stored in Deck's protected profile store and injected into the Codex process Deck starts, and nowhere else (`SUPERMEMORY_CODEX_API_KEY`); it is never written to Codex configuration. Deck does not register the Supermemory MCP server or its own memory loopback beside the plugin, and a launch is blocked if another Supermemory plugin or MCP registration exists in your Codex configuration.

Deck adds and removes only its own marker-delimited hook blocks (`# deck-codex-hook:<id>:start` … `:end`) in the global `config.toml`, so your inline hooks and `hooks.json` entries keep working beside them. Codex requires review of non-managed hooks; the Deck CLI launch passes `--dangerously-bypass-hook-trust` when Deck-owned hooks are present, so they run without per-hook review for that process. When you start `codex` directly instead, open `/hooks` and trust Deck's entries. The launch continues to pass `--dangerously-bypass-approvals-and-sandbox`.

```sh
deck codex developer --dry-run
deck codex developer --yes
```

Add the `--install-only` flag to apply and verify without starting Codex, or `--memory=supermemory` to select the memory provider for one run. The `--local-only` flag is accepted for compatibility but has no effect, because nothing is written into projects.

A normal launch prints only a few plain lines: what is starting, the adaptive-memory status, a one-line reminder that Codex runs with sandboxing and approvals disabled, a short summary when team files change (with the usual confirmation prompt), and anything that needs your action. Routine notes and the exact file list with ownership hashes appear with the `--verbose` flag or in a dry run; the same diagnostics remain available to `deck doctor`. For `exec` runs this status goes to stderr, so stdout carries only Codex's own output.

### Migrating a previous per-project install

Earlier versions wrote `.codex/`, `.agents/skills/` and a manifest into each project. Those project files override the global agents and skills that share a name, so they shadow the global install in that project. Deck detects them through the old manifest, reports them on every plan, and never deletes them by itself. Run the Codex developer command once from that project with the `--cleanup-legacy` flag (add `--yes` to skip the prompt) to remove only the files whose bytes still match what Deck recorded and Deck's marker blocks from the project `config.toml`; anything you changed is kept. If the files are tracked in Git, the removal shows up as ordinary deletions you can review and commit, or restore. You can also delete them yourself.

### Known limits

- Deck does not set `sandbox_mode = "read-only"` on the Investigate and Quality agents: the launch runs with the sandbox bypass, and Deck could not verify that a per-agent sandbox setting is honored under it, so read-only behavior remains guidance in the agent instructions, not enforcement.
- Serena resolves the project from the working directory of the Codex process, so one global entry serves every project.

## Shared capabilities, runner-specific effects

The capability registry uses scoped statuses such as `supported`, `shared`, `runner-specific`, `manual-verified`, `gap`, and `not-applicable`. Examples:

| Capability | Pi | OpenCode | Codex | Interpretation |
|---|---|---|---|---|
| RTK | Deck-owned pinned binary through a `tool_call` rewrite | Shared binary through the OpenCode hook | Deck-owned pinned binary plus a `PreToolUse` rewrite hook | Reuse is checked instead of blindly reinstalling a usable binary. |
| Context Mode / Codebase Memory | Shared binary or Deck-owned pinned install; built-in MCP with direct exposure | Shared binary and MCP | Shared binary reused, otherwise a Deck-owned pinned install; MCP pinned to the absolute path | A bare `PATH` name is never persisted for Codex. |
| Serena | Shared MCP capability with manual-verification fallback | Configured MCP capability | Deck-owned launcher through the Deck proxy | The adapter owns the runner-specific configuration and readiness evidence. |
| Supermemory | Deck loopback memory through the `deck-memory` extension | Official plugin | Official plugin hooks | One memory integration per runner; no raw MCP beside a plugin. |
| Context7 | Shared MCP capability | Configured MCP capability | Configured MCP capability | The server entry is validated in the active runner's configuration. |
| Mermaid package | Pi-specific | OpenCode-specific | These are internal runner packages, not a universal product package. |
| Developer Team | Runner-native materialization | Runner-native materialization | The canonical seven-role inventory is shared; file/config effects are not. |

Read [Configuration](configuration.md) before changing a package selection and [Support matrix](reference/support-matrix.md) for the full status vocabulary.

## Skill discovery boundary

Discovery is scoped to the active runner. Generic project roots can be combined with the selected runner's declared sources, but exclusive roots belonging to another runner are not aggregated. Validation and direct discovery are read-only; refresh is a separate explicitly authorized operation.

This local discovery index is separate from Deck's bundled external-skill distribution catalog and from OpenSpec. See [Skills](skills.md) and [Project workflows](project-workflows.md).
