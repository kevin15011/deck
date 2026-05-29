# Exploration: context-mode Adapter Implementation

## Goal

Understand how context-mode is currently structured and installed as a plugin, and assess feasibility of converting it to an MCP adapter approach.

## Current State

**context-mode is currently installed as an OpenCode plugin, not an MCP server.**

1. **Plugin Registration**: In `~/.config/opencode/opencode.json` line 275, `context-mode` is listed in the `"plugin"` array
2. **Installation Flow**: The adapter uses `opencode plugin <module> --global` OR directly modifies opencode.json plugin array
3. **Detection**: Capability-inventory.ts checks for `pluginNames: ["context-mode"]` in the plugin array
4. **Instruction Bundles**: Agents receive context-mode tool guidance via `instruction-bundles/context-mode.ts`

## Relevant Files

| File | Role |
|------|------|
| `/home/kevinlb/deck/packages/adapter-opencode/src/installation-plan.ts` | Defines `context-mode` with `installKind: "opencode-plugin"` |
| `/home/kevinlb/deck/packages/adapter-opencode/src/install-tools.ts` | Installs via `opencode plugin` CLI or patches opencode.json |
| `/home/kevinlb/deck/packages/adapter-opencode/src/capability-catalog.ts` | Detector: `pluginNames: ["context-mode"]` |
| `/home/kevinlb/deck/packages/adapter-opencode/src/capability-inventory.ts` | Checks plugin array for presence |
| `/home/kevinlb/deck/packages/adapter-opencode/src/opencode-mcp-config.ts` | Existing MCP config writer (used by serena, context7, codebase-memory) |
| `/home/kevinlb/deck/packages/core/src/teams/developer/instruction-bundles/context-mode.ts` | Tool instructions injected into agents |
| `/home/kevinlb/.config/opencode/opencode.json` | Contains both `plugin: ["context-mode", ...]` and `mcp: { ... }` |

## Constraints

- **OpenCode plugin vs MCP server**: Two distinct registration mechanisms in opencode.json
- **Plugin system**: `plugin: ["context-mode"]` registers in-process tools directly
- **MCP servers**: `mcp: { "server-name": { command: [...] } }` launches external processes
- **Current architecture**: Both arrays can coexist but OpenCode has a known issue where duplicate entries suppress tool registration
- **Codebase already has MCP config patterns**: codebase-memory, serena, context7 use MCP installKind; context-mode is the exception

## Risks

- Changing installKind may break existing user setups that rely on plugin entry
- OpenCode may treat MCP and plugin entries differently (blocking issue noted in config-merge.ts lines 141-148)
- Tool availability depends on OpenCode runner's native plugin loading

## Options and Tradeoffs

1. **Keep as opencode-plugin (current)**
   - Pros: Works, agents get instructions via bundle
   - Cons: Not aligned with MCP pattern used by other tools; less flexible
   - Effort: None (status quo)

2. **Convert to MCP adapter (installKind: "mcp-server")**
   - Pros: Consistent pattern, easier to manage as external process
   - Cons: Requires reconfiguration of detection, may need existing context-mode pre-installed or new install path
   - Effort: Medium - change in installation-plan.ts + capability-catalog.ts + capability-inventory.ts

3. **Dual support (detect both)**
   - Checks plugin array OR mcp config entry
   - Most flexible but adds complexity
   - Effort: Low-Medium

## Recommendation

Convert to MCP adapter IF context-mode is already installed separately as an MCP process. Otherwise keep as plugin. The codebase already supports both patterns—see how `codebase-memory` shifts from shell-script to mcp-server depending on detection.

## Registry

- Artifact Path: `openspec/changes/add-serena-package/exploration.md`
- State Path: `openspec/changes/add-serena-package/state.yaml`
- Events Path: `openspec/changes/add-serena-package/events.yaml`
- Recorded: phase `explore`, status `completed`