# Verify Report: Expose Managed Project Memory Recall

## Verdict

**PASS**

## Evidence

- Tool registration requires a complete managed bridge; standalone and partial environments expose no tool.
- The model controls only a bounded query. Shared plugin/runtime validation rejects raw oversized, control-bearing, secret, auth, DSN, URI-userinfo, and database-path inputs before provider effects.
- Successful output is restricted to the bounded untrusted-advisory envelope. Failures use a distinct bounded redacted result.
- Explicit recall succeeds only when focused search contributes substantive renderable context; unrelated profile context cannot satisfy an empty focused search.
- Explicit recall fixes lead role and Deck-owned project authority; no scope/provider/container/credential/limit/rewrite/rerank fields are accepted.
- Every new attempt counts toward six per session/minute; in-flight duplicates coalesce; only successful bounded results replay; runtime replay preserves the original response; failed IDs remain retryable.
- Custom tool execution emits explicit recall and no role-start recall. Raw Supermemory MCP remains absent.
- Context Mode remains available for local/indexed/session knowledge and is not used as the Deck cross-session project-memory boundary.

## Commands and live gate

- Final union affected suite: 203 passed, 0 failed across 8 files.
- `bunx tsc --noEmit` — passed.
- Compiled Supermemory runtime verification — passed.
- Canonical generated/installed asset parity — passed; 302,329 bytes, SHA-256 `36b985b0bfe5ed08031e2b374efc987856cb654041c57bd29d0d2cd6cbefcf98`, and no bundled Zod.
- `deck openspec validate --change expose-managed-project-memory-recall` — 0 errors, 0 warnings.
- `git diff --check` — passed.
- Hermetic no-match gate: empty focused search plus unrelated non-empty profile returned `ok: false`, `advisoryPresent: false`, no advisory text, and zero injected context.
- Exact OpenCode 1.18.18 managed canary after the no-match repair: registered and completed `deck_project_memory_recall`; native tool output and final answer contained Orion and Nebula Boundary; runtime ready; no provider failure, Context Mode, schema error, or role-start recall. The final run performed ancillary local architecture inspection after successful recall; an immediately preceding exact run with identical model-facing wording did not.

## Observability note

The post-repair explicit-recall telemetry recorded one sequence: profile 5 results/~132 prepared tokens, search 5/~247, and bounded composite 10/~553. Actual delivery is proved separately by the completed native tool record and model-visible Orion/Nebula output. Prepared-token telemetry is not treated as universal proof of model consumption.
