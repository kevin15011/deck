# Apply Progress: Expose Managed Project Memory Recall

## Status

Functional candidate complete. Independent Quality returned final GO after the focused no-match repair. The change remains unarchived.

## Evidence

- Automatic Capture persisted the Orion/Nebula decision in the canonical Esprit scope.
- Broad Automatic Recall returned bounded same-project context but omitted Orion/Nebula under semantically similar canary history.
- Focused Deck Runtime explicit recall returned Orion/Nebula.
- OpenCode exposed no managed explicit-recall tool and therefore fell back to repository inspection.
- The original conditional Spanish prompt now selects managed project recall and forms a concise project-history query that preserves name/denomination and convention facets.

## Implemented

- Added managed-only OpenCode tool `deck_project_memory_recall` with exactly one model-controlled query field.
- Added one canonical plugin/runtime validator for raw byte limits, controls, normalization, and high-confidence secret/DSN/URI/path rejection.
- Kept scope, provider, role, credentials, result limits, reranking, and rewriting under Deck Runtime authority.
- Added distinct bounded failure output, actual transport/auth/no-match classification, six-attempt rolling session limits, in-flight coalescing, success-only TTL/cap replay, response-preserving runtime replay, and session cleanup.
- Updated Adaptive Memory instructions to prefer managed project memory for earlier decisions and preserve Context Mode for local/indexed/session material.
- Added model-facing guidance to preserve requested historical facets while omitting incidental hypothetical implementation terms from focused recall queries.
- Required a substantive focused-search result before explicit recall can succeed, so unrelated profile context cannot turn an empty search into a false positive.
- Kept raw Supermemory MCP absent and standalone OpenCode free of managed recall claims.

## Verification

- Final union affected suite: 203 passed, 0 failed across 8 files.
- TypeScript, compiled runtime verification, generated parity, OpenSpec validation, and diff checking passed.
- A hermetic regression proves empty focused search plus unrelated non-empty profile returns actionable no-match with no advisory or injected context.
- Exact OpenCode 1.18.18 canary registered and completed `deck_project_memory_recall`; the managed tool output and final answer contained Orion and Nebula Boundary with no Context Mode, provider failure, schema error, or role-start recall. The final post-repair run performed ancillary local architecture inspection after recall; the immediately preceding identical-wording run did not, and the managed tool output independently contained both terms.
- The final model-generated query was 73 bytes, preserved name/denomination/convention/memory/project facets, and omitted incidental provider/integration/separation/core/adapter terms.
- Generated and installed plugin artifacts are identical at 302,329 bytes with SHA-256 `36b985b0bfe5ed08031e2b374efc987856cb654041c57bd29d0d2cd6cbefcf98` and contain no bundled Zod.
- No release, publication, commit, push, or archive occurred.
