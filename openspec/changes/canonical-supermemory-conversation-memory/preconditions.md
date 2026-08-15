# Preconditions: Canonical Supermemory Conversation Memory

## Required before Apply

| Precondition | Status | Resolution |
|---|---|---|
| Supermemory selection implies capture | Approved 2026-08-11 | Do not add another capture option or installation step. |
| Conversation ingestion model | Approved 2026-08-11 | Follow official Supermemory guidance: stable session `customId`, canonical container, dynamic dreaming. |
| Fixed seven-memory limit | Rejected 2026-08-11 | Deprecate it as behavioral policy; do not replace it with another semantic quota. |
| Remote deletion | Not authorized | Migration remains dry-run/copy-only; no source deletion. |
| Transport capability | Required Phase 0 | Prove official MCP/API support and authentication handoff before implementing the production boundary. |
| First-class runtime supersession | Approved 2026-08-15 | User explicitly replaced the MCP-primary limitation with a Deck-owned automatic runtime and retained MCP only for ad-hoc recall. |
| Engram/provider removal | Approved 2026-08-15 | Remove Engram and expose only Adaptive Memory Enabled/Disabled; legacy Engram migrates to disabled with warning. |
| Standalone integration | Required | No manual SDK, Node/npm, runner-file editing, or out-of-band setup may be required. |
| Semantic authority | Required | Deck decides capture/recall boundaries but MUST NOT duplicate Supermemory extraction, ranking, graph, updates, temporal logic, or forgetting. |
| Baseline health | Clean working tree; branch ahead 4 | Preserve current user commits and compare focused/broad evidence. |
| Test isolation | Required | No external network, real installation, or real user-home writes in automated tests. |

## Apply gate

The user authorized implementation on 2026-08-11. Apply may begin with RED tests and the transport capability spike. Any need to introduce a new hosted service, store a new category of credential, delete remote data, or add a capture choice requires a new product/security decision.
