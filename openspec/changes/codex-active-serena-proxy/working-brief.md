# Codex Serena proxy uses the active Deck executable

## Problem and evidence

Codex review/install blocks Serena in the Linux canary sandbox because its proxy probe invokes bare `deck`, which is absent. The same hardcoded command is written into MCP configuration and checked for readiness. Claude's CLI composition already resolves the active executable. The reported existing sandbox was closed; a separate temporary Docker reproduction confirmed `deck` absent and `/home/tester/.local/bin/deck-canary internal serena-mcp --probe` returning `deck-serena-mcp-proxy-v1` with exit0. The temporary container was removed.

## Acceptance and boundaries

The CLI supplies one active Deck command vector to Codex. Probe, generated MCP configuration, install preparation, and readiness use that same vector. Source invocation may include the CLI entrypoint; compiled invocation uses the active binary. Preserve bounded probing, argv boundaries, standalone adapter defaults, dependency injection, and user MCP collision protection. Marker-owned old routes may migrate through the existing merge mechanism; unmanaged differing configurations remain blocked and unchanged. Do not add a sandbox alias to conceal the bug.

## Routing and source evidence

Lead owns this brief and final verification. Investigate traced probe, configuration generation, exact readiness checks and marker-owned replacement; Apply Fast owns the adapter/CLI vertical slice. Graph project deck generation2026-08-20 is stale; current targeted source fallback defines findings. Existing pending TUI label/activity changes remain separate.

## Validation

Regression tests demonstrated RED for the missing active command and source argv before implementation; final combined focused suites passed all 44 tests across runner-adapters.codex, mcp-config, and runner-adapter. Coverage includes generated command/readiness agreement, marker-owned migration/unmanaged preservation, canary install roundtrip and postinstall verification. Independent Quality source/test review passed with no blocking findings. Final TypeScript and git diff --check passed. Rebuilt and installed canary; a clean-container probe without any deck alias returned the expected token and exit0, and the temporary container was removed. This fix does not claim a full real Codex installation has been repeated or that control-plane gaps are resolved.
