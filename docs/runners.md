# Runners

Deck is runner-aware rather than runner-agnostic. The CLI registers operational adapters for Pi, OpenCode, Codex, and Claude (global plugin files); other detected binaries remain visible without being represented as Deck execution targets.

> **Audience:** People choosing or diagnosing a Deck runner.
> **Authority:** Runner boundary reference; adapter registries and preflight code define current behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [runtime detection](../apps/cli/src/runtime-detection.ts), [adapter registry](../apps/cli/src/runner-adapters.ts), [Pi adapter](../packages/adapter-pi/src/runner-adapter.ts), [OpenCode adapter](../packages/adapter-opencode/src/runner-adapter.ts), [Codex adapter](../packages/adapter-codex/src/runner-adapter.ts), [Claude adapter](../packages/adapter-claude/src/runner-adapter.ts), and [capability registry](../packages/core/src/runner-capability-registry.ts).

## Support status

| Runtime | Status | Deck behavior |
|---|---|---|
| Pi | **Supported** | Detects the binary, runs preflight, reviews packages and MCP, configures capabilities, materializes the Developer Team, and can launch `deck pi developer`. |
| OpenCode | **Supported** | Detects the binary, reads runner configuration and package evidence, configures capabilities, and materializes the Developer Team through the TUI. |
| Claude | **Supported with route limits** | A Deck-owned global plugin carries the Developer Team files, pinned shared tools, and the official Supermemory plugin; the Deck CLI starts limited sessions. Protected execution controls and Deck's memory runtime are not part of this route. |
| Codex | **Supported with route limits** | Deck can configure and launch the Developer Team for Codex through the TUI and the Deck CLI: native roles and skills, shared tools pinned to verified executables, an RTK `PreToolUse` hook, and the official Supermemory plugin hooks. Protected execution controls remain static-compatible. |

Detection is not parity. A detected binary does not imply that Deck can install packages, write runner configuration, launch a team, or verify runner-specific effects for that runtime. Codex has a Developer Team adapter with shared tool installs, owned hooks, and the official Supermemory plugin, but it still does not claim first-class protected execution controls.

## Pi

Pi preflight reads the Pi version and searches the supported configuration candidates under the home directory. It can report whether configuration exists, whether the MCP configuration is present, stale package references are visible, nested skill directories exist, legacy SDD files remain, and whether the Pi binary is usable.

Pi-specific setup can include:

- required package review, including sub-agents and MCP packages;
- shared `context-mode`, Codebase Memory, RTK, Context7, and Supermemory evidence;
- MCP configuration for shared services;
- model/provider discovery from Pi settings, `pi --list-models`, and configured environment variables;
- per-agent model and thinking assignments;
- project-local Developer Team materialization.

Pi's standalone launch path is explicit:

```sh
deck pi developer
deck pi developer --continue
deck pi developer --resume
deck pi developer --memory=supermemory
deck pi developer --memory=none
```

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

Codex preflight requires Codex 0.145.0 or newer, checks the launch routes (`exec`, `resume`, `resume --last`) from the installed help output, and verified the config, hooks, custom-agent, and `codex debug models` contracts against 0.159.x. Materialization is project-local: `.codex/agents/*.toml` (one custom agent per canonical role, named by its role id, with the model and `model_reasoning_effort` assigned in the model screen), `.agents/skills/`, `.codex/config.toml`, and an ownership manifest. Model choices come from `codex debug models` for the signed-in account.

Before the first launch, sign in with `codex login` and trust the project in Codex: project-level `.codex/config.toml` (MCP servers, hooks, custom agents) is ignored by Codex until the project is trusted, and Deck never changes trust.

Review & Install for Codex can include:

- **RTK**: a Deck-owned pinned binary (the same reviewed release Claude uses) under the Deck data root, plus a Deck-owned `PreToolUse` hook for `Bash` that asks `rtk hook codex` for a rewrite and returns it through `updatedInput`, with the executable word pinned to the owned binary. The hook needs a Node.js 18+ runtime.
- **Codebase Memory**: an existing shared executable is reused (the per-user daemon must match the client version); otherwise the pinned native release is installed into the Deck data root. The MCP entry always stores the resolved absolute path.
- **Context Mode**: a usable shared executable is reused; otherwise the pinned npm release is installed into the Deck data root. The MCP entry stores the resolved absolute path. Context Mode's own Codex hooks are not installed: they would compete with the RTK `PreToolUse` rewrite and are not part of the Claude or OpenCode routes.
- **Serena**: Deck's owned launcher through Deck's hidden Serena MCP proxy, after explicit selection.
- **Supermemory**: only the official `supermemoryai/codex-supermemory` plugin, pinned to one npm release and limited to its two documented lifecycle hooks (`UserPromptSubmit` recall and `Stop` flush). The profile credential entered in the TUI is stored in Deck's protected profile store and injected into the Codex process Deck starts, and nowhere else (`SUPERMEMORY_CODEX_API_KEY`); it is never written to Codex configuration. Deck does not register the Supermemory MCP server or its own memory loopback beside the plugin, and a launch is blocked if another Supermemory plugin or MCP registration exists in your Codex configuration.

Deck adds and removes only its own marker-delimited hook blocks (`# deck-codex-hook:<id>:start` … `:end`) in `.codex/config.toml`, so your inline hooks and `hooks.json` entries keep working beside them. Codex requires review of non-managed hooks; the Deck CLI launch passes `--dangerously-bypass-hook-trust` when Deck-owned hooks are present, so they run without per-hook review for that process. When you start `codex` directly instead, open `/hooks` and trust Deck's entries. The launch continues to pass `--dangerously-bypass-approvals-and-sandbox`.

```sh
deck codex developer --dry-run
deck codex developer --yes
```

Add the `--install-only` flag to apply and verify without starting Codex, or `--memory=supermemory` to select the memory provider for one run.

## Shared capabilities, runner-specific effects

The capability registry uses scoped statuses such as `supported`, `shared`, `runner-specific`, `manual-verified`, `gap`, and `not-applicable`. Examples:

| Capability | Pi | OpenCode | Codex | Interpretation |
|---|---|---|---|---|
| RTK | Shared binary | Shared binary through the OpenCode hook | Deck-owned pinned binary plus a `PreToolUse` rewrite hook | Reuse is checked instead of blindly reinstalling a usable binary. |
| Context Mode / Codebase Memory | Shared binary and MCP | Shared binary and MCP | Shared binary reused, otherwise a Deck-owned pinned install; MCP pinned to the absolute path | A bare `PATH` name is never persisted for Codex. |
| Serena | Shared MCP capability with manual-verification fallback | Configured MCP capability | Deck-owned launcher through the Deck proxy | The adapter owns the runner-specific configuration and readiness evidence. |
| Supermemory | Pi MCP handoff | Official plugin | Official plugin hooks | One memory integration per runner; no raw MCP beside a plugin. |
| Context7 | Shared MCP capability | Configured MCP capability | Configured MCP capability | The server entry is validated in the active runner's configuration. |
| Mermaid package | Pi-specific | OpenCode-specific | These are internal runner packages, not a universal product package. |
| Developer Team | Runner-native materialization | Runner-native materialization | The canonical seven-role inventory is shared; file/config effects are not. |

Read [Configuration](configuration.md) before changing a package selection and [Support matrix](reference/support-matrix.md) for the full status vocabulary.

## Skill discovery boundary

Discovery is scoped to the active runner. Generic project roots can be combined with the selected runner's declared sources, but exclusive roots belonging to another runner are not aggregated. Validation and direct discovery are read-only; refresh is a separate explicitly authorized operation.

This local discovery index is separate from Deck's bundled external-skill distribution catalog and from OpenSpec. See [Skills](skills.md) and [Project workflows](project-workflows.md).
