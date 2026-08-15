# Runners

Deck is runner-aware rather than runner-agnostic. The CLI registers operational adapters for Pi and OpenCode; other detected binaries remain visible without being represented as supported Deck execution targets.

> **Audience:** People choosing or diagnosing a Deck runner.
> **Authority:** Runner boundary reference; adapter registries and preflight code define current behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [runtime detection](../apps/cli/src/runtime-detection.ts), [adapter registry](../apps/cli/src/runner-adapters.ts), [Pi adapter](../packages/adapter-pi/src/runner-adapter.ts), [OpenCode adapter](../packages/adapter-opencode/src/runner-adapter.ts), and [capability registry](../packages/core/src/runner-capability-registry.ts).

## Support status

| Runtime | Status | Deck behavior |
|---|---|---|
| Pi | **Supported** | Detects the binary, runs preflight, reviews packages and MCP, configures capabilities, materializes the Developer Team, and can launch `deck pi developer`. |
| OpenCode | **Supported** | Detects the binary, reads runner configuration and package evidence, configures capabilities, and materializes the Developer Team through the TUI. |
| Claude | **Detection only** | Deck can observe the `claude` command in `PATH`; no operational adapter is registered. |
| Codex | **Supported with route limits** | Deck can configure and launch the Developer Team for Codex. Deck-supervised launches bind the Supermemory runtime through the same ephemeral loopback bridge used by runner hooks; protected execution controls remain static-compatible. |

Detection is not parity. A detected binary does not imply that Deck can install packages, write runner configuration, launch a team, or verify runner-specific effects for that runtime. Codex has a Developer Team adapter and a Deck-supervised memory loopback, but it still does not claim first-class protected execution controls.

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

## Shared capabilities, runner-specific effects

The capability registry uses scoped statuses such as `supported`, `shared`, `runner-specific`, `manual-verified`, `gap`, and `not-applicable`. Examples:

| Capability | Pi | OpenCode | Interpretation |
|---|---|---|---|
| RTK | Shared binary | Shared binary through the OpenCode hook | Reuse is checked instead of blindly reinstalling a usable binary. |
| Serena | Shared MCP capability with manual-verification fallback | Configured MCP capability | The adapter owns the runner-specific configuration and readiness evidence. |
| Context7 | Shared MCP capability | Configured MCP capability | The server entry is validated in the active runner's configuration. |
| Mermaid package | Pi-specific | OpenCode-specific | These are internal runner packages, not a universal product package. |
| Developer Team | Runner-native materialization | Runner-native materialization | The canonical seven-role inventory is shared; file/config effects are not. |

Read [Configuration](configuration.md) before changing a package selection and [Support matrix](reference/support-matrix.md) for the full status vocabulary.

## Skill discovery boundary

Discovery is scoped to the active runner. Generic project roots can be combined with the selected runner's declared sources, but exclusive roots belonging to another runner are not aggregated. Validation and direct discovery are read-only; refresh is a separate explicitly authorized operation.

This local discovery index is separate from Deck's bundled external-skill distribution catalog and from OpenSpec. See [Skills](skills.md) and [Project workflows](project-workflows.md).
