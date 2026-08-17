# Apply Progress: Adaptive Memory Project Isolation and Automatic Recall Evidence

## Result

The P0 candidate is implemented. Project identity is resolved from the verified current Git repository, Runtime Recall and capture share the same server-bound scope, raw model-selectable Supermemory MCP materialization is retired, and runtime/MCP observability channels are distinct.

## Exact root cause

The observed Project A → Deck scope leak was a combination of boundaries rather than one runtime lookup:

1. Deck had materialized raw Supermemory MCP entries into global runner configuration for OpenCode and Pi. An entry created while configuring Deck could remain available in a later repository.
2. `x-sm-project` was only metadata; the remote MCP tool schema still exposed model-controlled `containerTag`. Prompt instructions therefore could not enforce isolation.
3. stale-entry recognition originally compared the stored scope to the current scope, so the exact cross-project stale case could be preserved as "ambiguous."
4. project-root and Git invocation seams accepted ambient fallback/configuration influence, and prebuilt memory bundles could bypass trusted composition.
5. Automatic Runtime Recall existed on supervised lifecycle paths, but one OpenCode composition path rejected the runtime-generated bundle and aggregate evidence did not cover every direct/loopback outcome.

The Deck Runtime provider boundary itself already bound canonical scope server-side; the leak evidence came from raw MCP materialization outside that boundary.

## Implemented changes

- Hardened canonical identity against ambient CWD/package fallbacks and Git configuration/environment poisoning.
- Bound runtime scope and session continuity to the verified canonical project; resume verifies the original identity and new sessions recompute the current project.
- Rejected nested caller-supplied scope-like loopback fields before provider effects.
- Trusted only Deck Runtime-generated prebuilt memory bundles.
- Removed Deck-generated raw Supermemory MCP tool bindings and fresh OpenCode/Pi/Codex materialization.
- Retired exact stale Deck-managed global entries, including old-scope entries, with atomic mode-preserving/CAS/post-write verification; ambiguous external entries remain preserved and unmanaged.
- Added aggregate metadata-only Runtime Recall attempted/skipped/succeeded/failed evidence with stable one-way scope fingerprints; external MCP remains explicitly unobservable rather than fabricated.
- Deferred observability sink creation for disabled memory and made all direct/transitive launch tests independent of real credentials, state, and provider network.

## Test coverage added

- Project A/B scope isolation and capture/recall scope equality.
- No Deck/default fallback.
- Prompt mentions of `deck`, `kevin15011/deck`, and `sm_project_v1_kevin15011_deck` remain inert.
- Previous Deck session does not contaminate a fresh project; resume and new-session behavior are distinct.
- Git environment/config poisoning cannot rewrite canonical identity.
- nested/array caller scope fields are rejected with zero provider calls.
- exact stale old-scope MCP entries retire idempotently; ambiguous/unrelated entries are preserved.
- eligible Runtime Recall precedes agent processing and MCP count is zero.
- Quick Fix policy skip performs zero provider recall and zero MCP calls.
- direct and loopback recall success/skip/failure emit correlated redacted metadata.
- structural hermeticity guard covers 80 direct/transitive runtime creation sites with zero skipped or unsafe current sites.

## Scope discipline

No retrieval tuning, reranking, query rewriting, `entityContext`, Profile Buckets, Mem0, memory benchmark, remote migration, or unrelated refactor was introduced.

## Post-install verification delta

Live installation inspection showed that the runtime/hook materialization and raw-MCP retirement were correct, but Doctor and the OpenCode review plan still treated a missing raw Supermemory MCP as a problem. The delta:

- makes raw OpenCode Supermemory MCP absence the expected safe state;
- removes required/pending raw-MCP actions from Start/Review Installation;
- reports exact stale managed entries as retireable and ambiguous external entries as unmanaged/external-unobservable;
- makes the legacy synthetic write-MCP route retirement-only with absent-safe/unmanaged/failure wording;
- prevents default-HOME config inspection or writes without an explicit config directory;
- avoids rewriting equivalent OpenCode configuration bytes; and
- avoids session-store persistence when Adaptive Memory Runtime is disabled.

The first independent verification exposed a test path that touched the real OpenCode config mtime. The path was isolated and repaired; final focused, compiled, and full verification left all protected user configuration/state metadata unchanged.
