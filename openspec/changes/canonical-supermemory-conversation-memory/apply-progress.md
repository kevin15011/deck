# Apply Progress: Canonical Supermemory Conversation Memory

## Status

- Phase: Apply
- State: In progress
- Started: 2026-08-11
- Implementation owner: one continuous Apply Deep candidate through the first functional vertical

## Approved defaults

1. Selecting Supermemory enables agent-mediated automatic high-signal save and materially relevant recall; no additional option is shown.
2. Every project-scoped MCP operation explicitly receives the canonical repository `containerTag`; `x-sm-project` alone is not considered sufficient.
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

## Runtime correction approved on 2026-08-12

Fresh OpenCode testing after reinstall proved:

- Deck correctly writes and OpenCode resolves `x-sm-project: sm_project_v1_kevin15011_deck`.
- `supermemory_add_memory` without `containerTag` still writes to `sm_project_default`.
- The same operation with explicit `containerTag: sm_project_v1_kevin15011_deck` writes to the canonical project space.

The user selected the MCP-only correction: preserve automatic agent save/recall behavior and make Deck materialize the current project's canonical tag into every applicable Supermemory request. No plugin, proxy, per-operation prompt, active-space mutation, or new UI choice is authorized.

## Verification evidence

- Focused final Doctor/Codex/Supermemory checks: 55 passed, 0 failed.
- Final repository suite: 4,507 passed, 0 failed across 294 files; 18,416 assertions.
- `bunx tsc --noEmit`: passed.
- `deck openspec validate --change canonical-supermemory-conversation-memory --json`: 0 errors, 0 warnings.
- `git diff --check`: passed.
- Independent Quality result: GO for the scoped, non-destructive, truthfully classified partial candidate.

## Remaining blocked requirements

- Whole-conversation ingestion, stable session documents, and dynamic dreaming remain outside the MCP-only agent-mediated design.
- Hard transport enforcement remains unavailable because the exposed tool schemas still allow omitted `containerTag`; this candidate enforces scope through project-bound materialized instructions.
- REQ-SM-051: remote copy is unavailable until authenticated enumeration/copy capabilities are proven.

## Live runner observation

The session-close adaptive-memory save performed after verification was routed by the currently installed Supermemory MCP environment to `sm_project_default`. This does not invalidate the repository candidate; it confirms that current installed runner configuration has not yet adopted the new canonical scope and that direct provider tools remain outside an automatic Deck execution boundary. The record was not deleted or moved because remote destructive effects were not authorized.

## Current result

The current candidate is safe and mergeable as a partial implementation: it fixes project isolation, endpoint drift, quota/prompt behavior, diagnostics, and migration safety without claiming unavailable automatic behavior. The OpenSpec change remains `Apply / in_progress` and MUST NOT be marked complete or archived until the blocked production execution requirements are resolved or formally superseded.

## Explicit per-operation scope delta — 2026-08-13

Fresh OpenCode runtime testing established that the active Supermemory tools route an omitted `containerTag` to `sm_project_default` even when the MCP connection has the correct `x-sm-project` header. Passing `containerTag: sm_project_v1_kevin15011_deck` explicitly routes correctly.

The implemented delta now:

- derives one canonical scope from the verified repository root;
- requires an observed configured canonical scope and exact agreement with the derived scope before operational memory guidance or bindings are materialized;
- rebinds caller-supplied adaptive-memory fragments while preserving unrelated package instructions;
- propagates the exact tag to Lead/session, specialists, delegation, agent-bound skills, standalone skills, and bootstrap skills for OpenCode, Pi, and Codex;
- emits exact scoped examples for add, search, memory/document listing, graph, and save operations;
- prohibits active/default-space fallback and constrains document-ID reads to IDs returned by a scoped predecessor;
- fails closed for memory and fail-open for coding when scope is absent, default, invalid, or mismatched;
- makes Doctor compare derived and observed runner scopes using the verified project root;
- regenerates tracked Codex/agent guidance through the canonical runner-sync path.

Final evidence for this delta:

- Full repository suite: 4,541 passed, 0 failed across 295 files; 18,746 assertions.
- `bunx tsc --noEmit`: passed.
- `deck openspec validate --change canonical-supermemory-conversation-memory --json`: 0 errors, 0 warnings.
- `git diff --check`: passed.
- Independent Quality: GO after verifying Codex first-install post-merge scope, generated-content integrity, launch/sync negative paths, Doctor root plumbing, and corrected Pi setup wording.

Residual limitation: enforcement is instruction/tool-binding based. The upstream tool schemas still permit omitted `containerTag`, so Deck cannot technically prevent an external or non-compliant caller from issuing an unscoped operation without a trusted authenticated interceptor. This limitation remains explicit and no plugin/proxy was added.
