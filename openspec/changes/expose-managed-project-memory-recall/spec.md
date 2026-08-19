# Spec: Expose Managed Project Memory Recall

## Requirements

**REQ-MPR-001 (MUST):** OpenCode MUST expose `deck_project_memory_recall` only when a complete Deck-managed memory bridge endpoint and token are present. Standalone or partial environments MUST expose no managed recall tool.

**REQ-MPR-002 (MUST):** The tool input MUST contain exactly one required `query` string. The plugin and runtime MUST reject empty, control-bearing, sensitive, or greater-than-1,024-byte queries before provider search.

**REQ-MPR-003 (MUST):** Model input MUST NOT select or override project scope, provider, credential, container, role, reranking, rewriting, or result limits. Explicit recall MUST use the immutable active Deck Runtime authority.

**REQ-MPR-004 (MUST):** A successful tool result MUST contain only the existing bounded `DECK_ADAPTIVE_CONTEXT_JSON_V1` untrusted-advisory envelope. Raw provider responses and unbounded content MUST NOT reach the model.

**REQ-MPR-005 (MUST):** No-match, unavailable, invalid, authentication, transport, and throttling outcomes MUST return stable redacted actionable failures. Coding may continue, but the model MUST NOT claim project-history knowledge from a failed recall.

**REQ-MPR-006 (MUST):** Invoking the custom recall tool MUST emit exactly one explicit-recall event and zero role-start recall events. Existing replay, in-flight coalescing, cleanup, and metadata-only observability guarantees remain authoritative.

**REQ-MPR-007 (MUST):** Agent instructions MUST direct explicit prior-decision, naming, convention, rationale, discovery, and earlier-session requests to `deck_project_memory_recall` first when available. Context Mode remains for local/indexed documents, command output, and session knowledge. OpenSpec, source, and tests remain authoritative over advisory memory.

**REQ-MPR-008 (MUST):** Raw Supermemory MCP MUST remain absent. The plugin MUST NOT create a provider client, second loopback protocol, runtime, daemon, or standalone autobootstrap path.

**REQ-MPR-009 (SHOULD):** Explicit recall SHOULD be locally rate-bounded per native session to prevent model retry storms without changing provider-owned ranking or result limits.

## Acceptance Scenarios

### Managed focused recall

**Given** a Deck-managed OpenCode session and a project decision omitted from broad Automatic Recall
**When** the model calls `deck_project_memory_recall` with a focused non-sensitive query
**Then** Deck Runtime searches only the active project scope
**And** the bounded advisory is returned as tool output
**And** no raw provider response, scope, credential, or role-start event is exposed.

### Standalone degradation

**Given** OpenCode starts without the complete managed bridge environment
**When** plugins are loaded
**Then** `deck_project_memory_recall` is absent
**And** no runtime or provider effect is attempted.

### Safe no-match

**Given** a valid focused query with no project-scoped result
**When** explicit recall completes
**Then** the tool returns a stable actionable no-match failure
**And** the model does not claim a historical decision.

### Context Mode coexistence

**Given** both managed recall and Context Mode are available
**When** the user asks about an earlier project decision
**Then** managed project recall is preferred
**But** Context Mode remains available for local indexed material and session knowledge.
