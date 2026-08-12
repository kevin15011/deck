import type {
  CapabilityInstructionBundle,
  CapabilityInstructionFragment,
} from "./index";

/**
 * Canonical instruction content for the adaptive-memory package.
 *
 * Adaptive memory persists decisions, discoveries, and context across sessions.
 * It is ADVISORY — OpenSpec artifacts and Spec Registry are ALWAYS authoritative.
 *
 * CONTRACT (2026-05-29): No manual container tag prefixes.
 * - User identity is derived from the Supermemory token/API key.
 * - Project scoping is automatic via x-sm-project header in MCP config.
 * - Memories are saved as normal content without prefixes.
 */
export function buildAdaptiveMemoryInstructionBundle(): CapabilityInstructionBundle {
  const common = `Adaptive memory is provided by the runner's configured memory system. Supermemory conversation capture is not production-wired on current OpenCode, Pi, or Codex static-compatible paths because no trusted authenticated MCP execution boundary is exposed to Deck hooks.

### Conversation Capture

- Selecting Supermemory remains the only memory provider decision; do not add or ask for a second capture toggle, consent screen, quota, or mode selector.
- Supermemory token or OAuth credentials identify the account; Deck supplies project isolation through the canonical x-sm-project scope.
- Automatic scoping contract: once a real executing transport exists, one runner session must be captured as one conversation document with a stable customId and canonical project scope.
- Supermemory owns extraction, profiles, graph updates, ranking, temporal updates, and deduplication.
- Agents must not manually extract routine facts, create topic keys, fill a semantic memory quota, or write mandatory session summaries.

### Retrieval

- Load bounded project-profile context once on start/resume when healthy.
- Search only when prior context is materially relevant or the user requests recall.
- Keep recall advisory, scoped to the canonical project container, limited to five results and about 1,500 tokens by default.
- Keep query rewriting and reranking disabled unless benchmark evidence enables them.

### Privacy and Authority

- Reject or redact credentials, private keys, authorization headers, and raw environment dumps before ingestion.
- Do not automatically ingest OpenSpec artifacts, provider responses, web content, tool output, or raw logs merely because they appear in conversation.
- OPENSPEC IS OFFICIAL CONTEXT — ADAPTIVE MEMORY IS ADVISORY. OpenSpec artifacts, source, tests, and current runner evidence win.
- Fail-open: memory errors must not block coding work, continue working normally, and diagnostics must be redacted.

### Provider: Supermemory

Use the runner-exposed Supermemory tools only for bounded recall, account readiness, and explicit user forget requests. Do not pass arbitrary containerTag values; Deck owns the canonical project scope. Do not claim automatic conversation capture on unsupported/static-compatible runners.`;

  const fragments: CapabilityInstructionFragment[] = ["agent", "session", "skill"].map((surface) => ({
    packageId: "adaptive-memory",
    surface: surface as "agent" | "session" | "skill",
    markdown: common,
  }));

  return { instructions: Object.freeze(fragments) };
}
