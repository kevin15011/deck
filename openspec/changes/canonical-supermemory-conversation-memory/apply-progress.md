# Apply Progress: Canonical Supermemory Conversation Memory

## Status

- Phase: Apply
- State: In progress
- Started: 2026-08-11
- Implementation owner: one continuous Apply Deep candidate through the first functional vertical

## Approved defaults

1. Selecting Supermemory enables conversation capture; no additional capture option is shown.
2. Conversation sessions use stable `customId` values and dynamic dreaming.
3. The seven-memory semantic quota is deprecated rather than replaced.
4. Project scope is mandatory and never falls back to `sm_project_default`.
5. Migration is non-destructive and deletion is excluded.

## Progress

| Phase | Status | Evidence |
|---|---|---|
| 0. Provider and baseline evidence | Completed | Official provider-native scope, `customId`, dynamic dreaming, profile, and hybrid-search capabilities were confirmed. No safe runner-authenticated automatic execution boundary was found. |
| 1. Canonical identity vertical | Completed with blocked capture | Canonical Git-remote scope resolution is fail-closed and rejects local/path fallbacks. Native OpenCode scope is configured; automatic conversation execution remains unsupported. |
| 2. Runner parity | Completed for scoped native MCP | OpenCode, Pi, and Codex use the canonical endpoint and project scope contract. Automatic capture/profile/search is classified `unsupported/static-compatible` for all three runners. |
| 3. Conversation/retrieval policy | Completed with blocked execution | Manual topic keys, mandatory summaries, and the seven-memory behavioral quota were removed. Redaction, stable request construction, migration hashing, and retrieval bounds exist, but no automatic provider execution is claimed. |
| 4. Unified installation/diagnostics | Completed | No additional capture option was added. Doctor fails closed without a verified root and reports provider-specific scope/config state without ambient-CWD fallback or false parity claims. |
| 5. Non-destructive migration | Completed for dry-run | Local inventory classification validates destination scope, normalizes hashes, redacts record IDs, and exposes neither copy nor deletion effects. Remote copy remains blocked until authenticated provider enumeration is proven. |
| 6. Verification/review | Passed for partial candidate | Full suite passed 4,507/4,507; TypeScript and diff checks passed. Independent Quality returned GO for the honest partial candidate. |

## Verification evidence

- Focused final Doctor/Codex/Supermemory checks: 55 passed, 0 failed.
- Final repository suite: 4,507 passed, 0 failed across 294 files; 18,416 assertions.
- `bunx tsc --noEmit`: passed.
- `deck openspec validate --change canonical-supermemory-conversation-memory --json`: 0 errors, 0 warnings.
- `git diff --check`: passed.
- Independent Quality result: GO for the scoped, non-destructive, truthfully classified partial candidate.

## Remaining blocked requirements

- REQ-SM-010 through REQ-SM-014: automatic conversation ingestion and executing stable session documents.
- REQ-SM-020 through REQ-SM-021: redaction/projection helpers exist, but there is no automatic remote ingestion boundary.
- REQ-SM-030 through REQ-SM-034: automatic profile load and executing bounded retrieval.
- Full REQ-SM-040: runner-native scoped MCP configuration is aligned; automatic capture/retrieval parity is unsupported.
- REQ-SM-051: remote copy is unavailable until authenticated enumeration/copy capabilities are proven.

## Live runner observation

The session-close adaptive-memory save performed after verification was routed by the currently installed Supermemory MCP environment to `sm_project_default`. This does not invalidate the repository candidate; it confirms that current installed runner configuration has not yet adopted the new canonical scope and that direct provider tools remain outside an automatic Deck execution boundary. The record was not deleted or moved because remote destructive effects were not authorized.

## Current result

The current candidate is safe and mergeable as a partial implementation: it fixes project isolation, endpoint drift, quota/prompt behavior, diagnostics, and migration safety without claiming unavailable automatic behavior. The OpenSpec change remains `Apply / in_progress` and MUST NOT be marked complete or archived until the blocked production execution requirements are resolved or formally superseded.
