# Proposal: Expose Managed Project Memory Recall

## Intent

Expose Deck Runtime's existing project-scoped explicit recall capability to OpenCode as one safe model-visible tool. Historical project decisions must be queried through the active managed runtime rather than inferred from repository inspection or delegated to raw provider MCP access.

## Problem

Automatic Recall is intentionally bounded to five search results and uses no query rewriting or reranking. In a project containing several semantically similar valid memories, a broad task prompt can omit the requested prior decision from the top results. Deck Runtime already supports focused `explicit_recall`, but OpenCode cannot invoke it. The model therefore falls back to Context Mode or repository inspection, neither of which is the authoritative cross-session project-memory channel.

## Scope

- Add one conditional OpenCode tool, `deck_project_memory_recall`.
- Accept only one bounded semantic query; Deck Runtime continues to own scope, provider, credentials, role, limits, and observability.
- Return only the existing bounded untrusted-advisory envelope or a stable redacted failure.
- Add instructions that distinguish Deck project history from Context Mode's local/indexed knowledge.
- Preserve raw Supermemory MCP absence and standalone degradation.

## Non-goals

- Query rewriting, reranking, or increasing Automatic Recall limits.
- Model-selectable scope, provider, container, credential, result limit, or role.
- A second runtime, MCP facade, daemon, or provider client in the plugin.
- Changing Context Mode implementation or removing repository inspection for current-state verification.
