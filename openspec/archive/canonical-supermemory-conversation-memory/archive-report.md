# Archive Report: Canonical Supermemory Conversation Memory

## Result

**Status**: Archived

**Archive location**: `openspec/archive/canonical-supermemory-conversation-memory/`

**Implementation commit**: `cb3d267`

## Outcome

Deck now provides one first-class, runner-neutral Supermemory runtime for automatic role-aware recall and capture. Deck owns lifecycle, canonical project scope, stable session identity, security, context budgets, permissions, fail-open behavior, and content-free observability. Supermemory remains responsible for extraction, profiles, graph relationships, ranking, temporal updates, deduplication, and forgetting.

The change removes Engram and provider selection, preserves optional project-scoped MCP for ad-hoc recall, adds owner-only runtime credential storage, and integrates authenticated lifecycle bridges for OpenCode, Pi, and Codex according to their available native boundaries. The standalone release path, Doctor, TUI installation, migration diagnostics, DeckMemoryBench, and cross-runner contracts were updated accordingly.

## Closure evidence

- Independent Quality verification: PASS.
- Independent release review: GO.
- Final repository suite: 4,627 passed, 0 failed; 19,413 assertions across 301 files.
- TypeScript, compiled runtime, release smoke, OpenSpec validation, benchmark, and diff checks passed.
- Real OpenCode Review & Install completed successfully with all six plan actions ready and zero blockers under `DECK_DEBUG=1`.
- Installed OpenCode plugin matched the repository-generated asset; MCP config carried canonical scope without a runtime credential; the secret-store file was owner-only (`0600`).
- Authenticated live Supermemory health/profile/capture/search and OpenCode loopback canary recall passed within the configured context ceiling.

## Requirement disposition

- Canonical project isolation, stable conversation identity, bounded role-aware retrieval, central capture policy, secret rejection, fail-open behavior, and content-free observability are implemented and verified.
- OpenCode, Pi, and Codex use the shared runtime contract while reporting unsupported native lifecycle boundaries honestly.
- No default-space fallback, arbitrary semantic quota, mandatory session summary, secondary provider, or Deck-owned semantic engine was introduced.
- Engram and provider selection were removed from product/runtime composition.
- Standalone compiled artifacts require no Node/npm or separately installed Supermemory SDK.

## Residual limitations

- Non-host release targets are compile-only in the current Linux environment.
- External ad-hoc MCP activity is outside Deck Runtime observability.
- Live acceptance proves authenticated endpoint operation and canary recall, not broad production ranking quality.
- Remote legacy record copy and deletion remain unavailable and unauthorized; source records were left untouched.

## Follow-up posture

No follow-up blocks closure. Cross-platform execution, broader live ranking evaluation, and any future remote migration capability require separate scope and authorization.
