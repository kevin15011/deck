# Support matrix

Support labels are scoped to a surface. “Supported” for one capability does not imply universal runner parity, and “detected” does not imply an operational adapter.

> **Audience:** People evaluating whether Deck covers a runner or capability.
> **Authority:** Current product boundary; source registries, adapters, tests, and runner evidence define status.
> **Maintainer:** Deck maintainers.
> **Evidence:** [runner capability registry](../../packages/core/src/runner-capability-registry.ts), [runtime detection](../../apps/cli/src/runtime-detection.ts), [adapter registry](../../apps/cli/src/runner-adapters.ts), [canonical catalogs](../../packages/core/src/teams/developer/catalog.ts), and [documentation governance](../../tests/documentation-governance.test.ts).

## Status vocabulary

| Label | Meaning |
|---|---|
| **Supported** | The product has an implemented path and source-backed checks for the named surface. |
| **Runner-specific** | The capability exists only through a particular runner's native package, configuration, or effect. |
| **Experimental** | The path is intentionally available but its contract or runtime validation is not considered stable. |
| **Manual verification required** | Automated evidence is incomplete; the user or maintainer must verify the result. |
| **Detection only** | Deck can observe presence but does not configure, launch, or verify the runtime as an operational target. |
| **Known gap** | The boundary is recognized and not represented as a complete supported path. |
| **Not shipped** | The named product surface is not part of the current Deck distribution. |

## Operational runner matrix

Pi and OpenCode are operational Deck runners. Codex and Claude have route-limited adapters; Codex adds Deck-owned shared tools, hooks, and the official Supermemory plugin, and Claude carries the Developer Team in a Deck-owned global plugin. The cells use the status vocabulary above; runner-specific details are described below the table.

| Surface | Pi | OpenCode | Codex | Claude |
|---|---|---|---|---|
| Binary detection | Supported | Supported | Supported | Supported |
| Version/config preflight | Supported; **Pi >= 1.0.0 only** (`@earendil-works/pi-coding-agent`), older or unparseable versions block install and launch | Supported | Supported; Codex 0.145.0+ | Detection and launch-route checks only |
| Package and MCP review | Supported; built-in MCP (Deck servers in the global `mcp.json`, absolute commands, direct exposure) | Supported | Supported with static-compatible route limits | Supported with route limits |
| Developer Team materialization | Supported; **global** under the Pi agent directory (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`) as one Deck-owned package, never into projects | Supported | Supported with static-compatible route limits; global (Codex home and `~/.agents/skills`), never into projects | Global Deck-owned plugin files |
| Subagents and per-role models | Supported; Deck-owned `subagent` extension, one child `pi` process per role with that role's model and thinking level | Supported; native agents | Supported; native custom agents | Supported; plugin agents |
| Model discovery and per-role assignment | Supported | Supported | Supported | Supported |
| Adaptive-memory runner configuration | Runner-specific; Deck loopback memory through the `deck-memory` extension (see below) | Runner-specific | Runner-specific; the pinned official plugin hooks receive the stored profile credential in the started process only | Runner-specific; official Supermemory plugin |
| Explicit memory tools (on-demand search and save) | Supported; `memory_search` and `memory_save` tools registered by `deck-memory` over the Deck loopback host (read-only roles get search only; no Supermemory credential in Pi) | Supported; the official plugin's `supermemory` tool | Supported; Deck-owned stdio MCP server `deck-memory` (`memory_search`, `memory_save`) over the Deck loopback host; calls are authorized as the lead because Codex passes no agent identity, read-only roles are told not to save | Supported; the official plugin's Supermemory MCP tools |
| Shared tool installs (RTK, Codebase Memory, Context Mode) | Supported; Deck-owned pinned binaries, MCP commands pinned to absolute paths | Supported | Supported; Deck-owned pinned binaries, MCP and hooks pinned to verified absolute paths | Supported; pinned shared tools |
| Tool interception: RTK command rewrite | Supported in Deck sessions; the `deck-tool-policy` extension rewrites `bash` commands in `tool_call`, pinned to the owned RTK binary | Runner-specific; OpenCode hook | Runner-specific; marker-owned `PreToolUse` hook | Runner-specific; plugin `PreToolUse` hook |
| Tool interception: Grep/Glob graph guidance | Advisory; the search always runs and one concise Codebase Memory note is appended to its result, at most once per session (code-structure searches only) | Not shipped | Not shipped | Advisory; the Codebase Memory integration adds graph context and the search still runs |
| Tool interception: read-only role enforcement | Enforced for Investigate and Quality children (`tool_call` block plus a `--tools` allowlist); these roles have no shell | Not documented as enforced | Instruction-level only (no sandbox override) | Not documented as enforced |
| Developer Team execution controls | Static-compatible `developer-team-execution` extension in the lead session | Runner-specific hooks | Static-compatible | Not part of this route |
| Project-local skill discovery | Supported | Supported | Supported | Supported |

Project-local discovery is always scoped to the active runner. Pi and OpenCode can share a capability ID while using different configuration files, package systems, model discovery, and verification effects.

### Pi in detail

- **Global install.** `Review & Install` and `deck pi developer` write one manifest-owned package under `<agent dir>/deck/package` (agents, skills, prompts, and the `deck-*` extensions), a lead profile under `<agent dir>/deck/profiles`, one `packages` entry in `settings.json`, and the Deck servers in `mcp.json`. Nothing is written into `<project>/.pi`, and the install writes no Deck files into `<project>/.deck` (only Pi's session store for `--continue`/`--resume` lives under `<project>/.deck/pi/sessions`).
- **Deck-session activation guard.** Deck extensions are inert unless `DECK_PI_SESSION`, `DECK_PI_ROLE` or `DECK_PI_CHILD` is set by a Deck launch; a plain `pi` lists the Deck skills and extension names but runs none of the extension code.
- **Memory.** In a Deck-managed session the `deck-memory` extension recalls through the Deck loopback host (an ephemeral system-prompt append, never a stored message) and captures the user prompt and each completed assistant turn. The bearer token travels through a `0600` file, never the environment. Child roles recall once at start and never capture.
- **MCP.** Pi's built-in MCP is used. Deck removes the `pi-mcp-adapter` entry it added in earlier versions (it disables built-in MCP); a user-added entry is reported as a blocking diagnostic.

## Route-limited runtimes

| Runtime | Status | Deck scope |
|---|---|---|
| Claude | Supported with route limits | Global plugin files, pinned shared tools, and the official Supermemory plugin; limited Claude sessions started through the Deck CLI. |
| Codex | Supported with route limits | Deck can configure and launch the Developer Team, install the shared tools, and register the official Supermemory plugin hooks; protected execution controls remain static-compatible. |

## Runner-independent surfaces

| Surface | Status | Boundary |
|---|---|---|
| Deck self-update | Supported | Operates on compatible Deck binary installations independently of which runner is detected. |

## Capability matrix

| Capability | Product status | Boundary |
|---|---|---|
| Context Mode | Supported | Shared binary and MCP capability; effect and persistence are runner-specific. |
| Codebase Memory | Supported | Shared binary/MCP integration where the active runner exposes the required surface. |
| RTK | Supported | Optional shared binary; OpenCode uses its hook integration, Pi uses a Deck-owned pinned binary through a `tool_call` rewrite, and Codex uses a Deck-owned pinned binary with a `PreToolUse` rewrite hook. |
| Serena | Supported | MCP and symbol-editing capability; Pi can require manual verification when automatic installation is unavailable. |
| Context7 | Supported | MCP server configuration is validated by the active adapter. |
| Supermemory | Supported with route limits | OpenCode, Claude, and Codex use the pinned official plugin with a profile credential injected into the started process only; Pi uses Deck's loopback memory runtime through the `deck-memory` extension (no Supermemory credential in Pi configuration, no raw MCP entry). A raw Supermemory MCP entry is never registered beside a plugin. |
| Developer Team | Supported | Seven canonical roles plus separate Onboard and Archive lifecycle skills. |
| Bundled external skills | Supported | 29 standalone content bundles; separate from project-local discovery. |
| Local skill registry | Supported | Read-only validation/discovery is bounded; refresh requires explicit authority and complete evidence. |

## Explicit limits

- Claude and Codex routes are static-compatible: protected execution controls are not enforced by a host lifecycle. Codex hook trust review is bypassed per process for Deck-owned hooks only when launched through Deck.
- Pi and OpenCode can share a capability ID while using different config files, package systems, model discovery, and verification effects.
- Pi: Deck supports Pi >= 1.0.0 only. Subagent children are started with `--append-system-prompt`, which replaces the user's `APPEND_SYSTEM.md` for those children. MCP servers started by Pi inherit the non-memory secrets of Pi's environment (for example the Web Search key); the memory token is withheld from them. Read-only roles have no shell, so Quality cannot run test suites. Delegation to `deck-setup` through the Deck `subagent` tool is fail-closed until `developer-team-execution-convergence` wires its authorization provider.
- Adaptive memory never outranks OpenSpec, source, tests, or current runner evidence.
- Project-local skill metadata is discovery input, not runtime authority or bundled Deck content.
- Generated bundles and build metadata remain generator-owned.

Use [Runners](../runners.md) for operational details, [Skills](../skills.md) for the bundled inventory, and [Troubleshooting](../troubleshooting.md) when evidence is manual, incomplete, or indeterminate.
