# Measurement slice preconditions

Recorded during final bookkeeping; this is not evidence of a separate pre-implementation gate.

- User authorized proceeding with cross-runner preparation/startup investigation and minimal missing measurements.
- Work is isolated on `fix/session-pending-issues`, based on updated main at `fc667aadbb052e2e4515889e425848762769c838`. The separate memory feature is outside scope.
- Runtime scope is an optional, bounded preparation-stage callback and one metadata-only diagnostic per observed resolver call. Context ownership, permissions, durability barriers and process lifetime remain unchanged.
- The graph generation is stale for the relevant files; targeted source fallback and coverage limitations are recorded in the investigation.
- Tests use fake native drivers and effects. Separate local production preparation probes use owned temporary Codebase runtimes and guaranteed cleanup; no model inference, daemon replacement or installation is part of this slice.
- Validation and remaining deployment/benchmark limits are recorded in `preparation-progress.md`. Undoing the candidate would remove the callback, diagnostic collection and corresponding tests; no state migration is required, and already-written diagnostic events remain harmless historical metadata.
