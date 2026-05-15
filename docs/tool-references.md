# Deck — Official Tool References

This document records the canonical upstream projects Deck should use when detecting, installing, or documenting Development Environment tools.

Future agents must prefer these references over package-name guesses.

## Canonical tools

| Tool | Canonical project | Primary command | Role in Deck |
|---|---|---|---|
| RTK | https://github.com/rtk-ai/rtk | `rtk` | Token-optimized CLI proxy for verbose terminal commands. |
| context-mode | https://github.com/mksglu/context-mode | `context-mode` | Context window optimization, sandboxed command execution, indexing/search tools. |
| codebase-memory | https://github.com/DeusData/codebase-memory-mcp | `codebase-memory-mcp` | Code intelligence MCP server and codebase knowledge graph. |
| Engram | https://github.com/Gentleman-Programming/engram | `engram` | Persistent memory system for AI coding agents. |

## Provider-specific notes

### Pi

Pi still needs Pi-native packages for Pi-specific runtime capabilities:

| Capability | Source |
|---|---|
| sub-agents | `npm:pi-subagents` |
| MCP packages | `npm:pi-mcp-adapter` |
| Context7 | `npm:@dreki-gg/pi-context7` |

But RTK, codebase-memory, and Engram are canonical external tools and should be detected by their binaries, not guessed through Pi package names.

### OpenCode

OpenCode configuration must be validated from:

- `~/.config/opencode/opencode.json`
- `~/.config/opencode/package.json`
- available binaries on `PATH`

Do not assume OpenCode tools are installed only as `opencode plugin` modules.

## Current local verification

Verified on this machine:

```txt
rtk -> /home/kevinlb/.local/bin/rtk
context-mode -> /home/kevinlb/.nvm/versions/node/v20.19.4/bin/context-mode
codebase-memory-mcp -> /home/kevinlb/.local/bin/codebase-memory-mcp
engram -> /home/linuxbrew/.linuxbrew/bin/engram
```
