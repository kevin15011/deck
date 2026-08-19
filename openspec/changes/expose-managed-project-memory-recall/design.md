# Design: Expose Managed Project Memory Recall

## Interface

The existing `developer-team-execution` plugin conditionally registers:

```ts
deck_project_memory_recall({ query: string }): Promise<string>
```

The tool description tells the model to use it for earlier project decisions, names, conventions, rationale, discoveries, and prior-session work before local fallback tools.

## Boundary

The plugin normalizes and validates the query, then sends the existing authenticated `explicit_recall` loopback event with runner `opencode`, the native session identifier, fixed lead role, a plugin-owned event/correlation identifier, and no scope-like fields. Deck Runtime independently validates the query and retains all provider/scope authority.

The tool returns only a validated, bounded `DECK_ADAPTIVE_CONTEXT_JSON_V1` envelope. Redacted stable text represents failures. The tool is not registered unless both ephemeral bridge values exist.

## Safety and limits

- Query: 1–1,024 UTF-8 bytes, no control characters or high-confidence secret material.
- Output: existing five-item, approximately 1,500-token, 6,000-byte advisory ceiling.
- Rate: bounded unique calls per native session per rolling minute; failed calls remain retryable without unbounded loops.
- Observability: operation, status, duration, counts, and fingerprints only; never query, content, raw scope, native session ID, token, or provider response.
- The custom tool bypasses delegation-role inference and emits no `role_start` recall.

## Rejected alternatives

- Automatic query expansion: this is benchmark-gated query rewriting and adds cost/noise to every session.
- Raw Supermemory MCP: it permits model-selected provider/scope arguments.
- Context Mode: it does not represent Deck-owned cross-session project memory.
- A separate plugin/runtime/facade: it duplicates lifecycle and authority ownership.
