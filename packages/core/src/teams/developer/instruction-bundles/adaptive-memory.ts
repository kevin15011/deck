import type {
  CapabilityInstructionBundle,
  CapabilityInstructionFragment,
} from "./index";
import {
  isCanonicalSupermemoryProjectScope,
  type CanonicalSupermemoryProjectScope,
} from "../../../memory/canonical-supermemory-project";

export type ProjectBoundAdaptiveMemoryInstructionOptions = {
  supermemoryProjectScope?: string;
  configuredSupermemoryProjectScope?: string;
};

/**
 * Canonical instruction content for the adaptive-memory package.
 *
 * Adaptive memory persists decisions, discoveries, and context across sessions.
 * It is ADVISORY — OpenSpec artifacts and Spec Registry are ALWAYS authoritative.
 *
 * CONTRACT: Deck materializes the exact canonical Supermemory containerTag for
 * project memory. Transport headers are diagnostic/config parity only and never
 * supply omitted tool arguments.
 */
export function renderProjectBoundAdaptiveMemoryInstructions(options: ProjectBoundAdaptiveMemoryInstructionOptions = {}): string {
  const resolved = resolveProjectBoundSupermemoryInstructionScope(options);
  const scopePolicy = resolved.authorized
    ? renderAuthorizedSupermemoryPolicy(resolved.scope)
    : renderFailClosedSupermemoryPolicy(resolved.reason);

  return `Adaptive memory is provided by the runner's configured memory system. Supermemory conversation capture is not production-wired on current OpenCode, Pi, or Codex static-compatible paths because no trusted authenticated MCP execution boundary is exposed to Deck hooks.

### Conversation Capture

- Selecting Supermemory remains the only memory provider decision; do not add or ask for a second capture toggle, consent screen, quota, or mode selector.
- Supermemory token or OAuth credentials identify the account; Deck supplies project isolation through one Deck-materialized canonical project scope.
- Automatic scoping contract: once a real executing transport exists, one runner session must be captured as one conversation document with a stable customId and canonical project scope.
- Supermemory owns extraction, profiles, graph updates, ranking, temporal updates, and deduplication.
- Agents must not manually extract routine facts, create topic keys, fill a semantic memory quota, or write mandatory session summaries.

### Project Scope Binding

${scopePolicy}

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
}

export function buildAdaptiveMemoryInstructionBundle(options: ProjectBoundAdaptiveMemoryInstructionOptions = {}): CapabilityInstructionBundle {
  const common = renderProjectBoundAdaptiveMemoryInstructions(options);

  const fragments: CapabilityInstructionFragment[] = ["agent", "session", "skill"].map((surface) => ({
    packageId: "adaptive-memory",
    surface: surface as "agent" | "session" | "skill",
    markdown: common,
  }));

  return { instructions: Object.freeze(fragments) };
}

function resolveProjectBoundSupermemoryInstructionScope(
  options: ProjectBoundAdaptiveMemoryInstructionOptions,
): { authorized: true; scope: CanonicalSupermemoryProjectScope } | { authorized: false; reason: "missing" | "mismatch" | "invalid" } {
  const derived = options.supermemoryProjectScope?.trim();
  const configured = options.configuredSupermemoryProjectScope?.trim();
  if (!derived || !configured) return { authorized: false, reason: "missing" };
  if (!isCanonicalSupermemoryProjectScope(derived) || !isCanonicalSupermemoryProjectScope(configured)) {
    return { authorized: false, reason: "invalid" };
  }
  if (configured !== derived) return { authorized: false, reason: "mismatch" };
  return { authorized: true, scope: derived };
}

function renderAuthorizedSupermemoryPolicy(scope: CanonicalSupermemoryProjectScope): string {
  return [
    `- The only authorized project container is \`containerTag: "${scope}"\`.`,
    "- Agents MUST NOT derive, replace, or omit this value; if this value is unavailable, skip the memory operation and continue coding.",
    "- x-sm-project is diagnostic/transport metadata only; it does not supply an omitted tool argument; project scoping requires this header plus the explicit canonical `containerTag` on each scoped operation.",
    "- Every automatic save, recall, list, document, graph, or save-equivalent operation that accepts `containerTag` must pass the exact value above.",
    "- Exact scoped examples:",
    `  - \`supermemory_add_memory({ content, containerTag: "${scope}" })\``,
    `  - \`supermemory_search_memory({ query, containerTag: "${scope}" })\``,
    `  - \`supermemory_listMemories({ containerTag: "${scope}" })\``,
    `  - \`supermemory_listDocuments({ containerTag: "${scope}" })\``,
    `  - \`supermemory_fetch-graph-data({ containerTag: "${scope}" })\``,
    `  - \`supermemory_memory-graph({ containerTag: "${scope}" })\``,
    `  - \`supermemory_save-memory({ content, containerTag: "${scope}" })\``,
    "- Use `supermemory_add_memory` only for durable high-signal project information and `supermemory_search_memory` only when prior context is materially relevant or requested.",
    "- Account-only readiness tools that do not accept project scope may be used only for authentication/status.",
    "- Never use active-space-only tools, and never change active space, for automatic project memory.",
    "- Use `supermemory_getDocument` only after the document id came from a scoped predecessor in the same workflow.",
  ].join("\n");
}

function renderFailClosedSupermemoryPolicy(reason: "missing" | "mismatch" | "invalid"): string {
  const detail = reason === "mismatch"
    ? "scope mismatch"
    : reason === "invalid"
      ? "scope invalid"
      : "configured scope missing";
  return [
    `- Adaptive-memory project operations are disabled because Deck detected ${detail}.`,
    "- Fail closed for memory and fail open for coding work: do not save, search, list, document, graph, or use save equivalents for project memory.",
    "- Do not use a default container, active space, or an agent-derived replacement scope.",
    "- Account-only readiness checks may still be used for authentication/status when exposed by the runner.",
  ].join("\n");
}
