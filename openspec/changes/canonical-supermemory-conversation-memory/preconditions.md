# Preconditions: Canonical Supermemory Conversation Memory

## Required before Apply

| Precondition | Status | Resolution |
|---|---|---|
| Supermemory selection implies capture | Approved 2026-08-11 | Do not add another capture option or installation step. |
| Conversation ingestion model | Approved 2026-08-11 | Follow official Supermemory guidance: stable session `customId`, canonical container, dynamic dreaming. |
| Fixed seven-memory limit | Rejected 2026-08-11 | Deprecate it as behavioral policy; do not replace it with another semantic quota. |
| Remote deletion | Not authorized | Migration remains dry-run/copy-only; no source deletion. |
| Transport capability | Required Phase 0 | Prove official MCP/API support and authentication handoff before implementing the production boundary. |
| Baseline health | Clean working tree; branch ahead 4 | Preserve current user commits and compare focused/broad evidence. |
| Test isolation | Required | No external network, real installation, or real user-home writes in automated tests. |

## Apply gate

The user authorized implementation on 2026-08-11. Apply may begin with RED tests and the transport capability spike. Any need to introduce a new hosted service, store a new category of credential, delete remote data, or add a capture choice requires a new product/security decision.
