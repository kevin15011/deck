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

  return `Adaptive Memory is enabled or disabled by Deck. When enabled, Supermemory is the only durable backend and automatic profile/search/capture runs through a Deck-owned runtime for Deck-supervised runner launches. Direct runner launches must not claim automatic memory unless the Deck runtime bridge is active.

### Conversation Capture

- Selecting Supermemory remains the only memory provider decision; do not add or ask for a second capture toggle, consent screen, quota, or mode selector.
- Supermemory token or OAuth credentials identify the account; Deck supplies project isolation through one verified Git repository identity held by Runtime, not through prompt text or model-selected tool arguments.
- Automatic scoping contract and conversation capture: one runner session/change is captured as one conversation document with a stable customId and immutable project scope when Deck supervises the runner runtime.
- Supermemory owns extraction, profiles, graph updates, ranking, temporal updates, and deduplication.
- Agents must not manually extract routine facts, create topic keys, fill a semantic memory quota, or write mandatory session summaries.

### Project Scope Binding

${scopePolicy}

### Retrieval

- Load bounded project-profile context once on start/resume when healthy and policy-eligible.
- When available, use \`deck_project_memory_recall\` first for earlier project decisions, names, conventions, rationale, discoveries, or prior-session work.
- When available, call \`deck_project_memory_recall\` before answering whether a project-specific prior decision, name, terminology, convention, rationale, discovery, or established architecture exists or applies, including conditional phrasing such as "si existe", "si aplica", "if any", or "if applicable". Example trigger: "Si existe alguna denominación o convención del proyecto relacionada con esta arquitectura, inclúyela únicamente si realmente aplica."
- Build concise and discriminative focused recall queries from requested historical facets + relevant project subject, not by paraphrasing the full current task; preserve every historical facet requested by the user rather than collapsing to one.
- If a request asks about project-specific name/denomination/terminology and convention, include both facets and the relevant subject in the query. For that Spanish shape, use exactly: "nombre interno denominación convención arquitectura de memoria proyecto"; omit incidental hypothetical implementation terms such as provider externo, integración, separación, core/adapters, unless those are themselves the historical fact being sought.
- Preserve requested names, conventions, rationale, decisions, and discoveries as separate query facets; do not insert facts or proper nouns the user did not provide.
- Repository inspection may verify current implementation but must not be used to conclude that no historical convention exists before managed recall.
- Do not force recall for ordinary current-state implementation questions with no historical/project-convention aspect.
- Context Mode remains for local/indexed documentation, command output, and current session knowledge; it is not the Deck-owned cross-session project-memory channel.
- Search only when prior context is materially relevant or the user requests recall.
- Keep recall advisory, scoped by Deck Runtime, limited to five results and about 1,500 tokens by default.
- Keep query rewriting and reranking disabled unless benchmark evidence enables them.

### Privacy and Authority

- Reject or redact credentials, private keys, authorization headers, and raw environment dumps before ingestion.
- Do not automatically ingest OpenSpec artifacts, provider responses, web content, tool output, or raw logs merely because they appear in conversation.
- OPENSPEC IS OFFICIAL CONTEXT — ADAPTIVE MEMORY IS ADVISORY. OpenSpec artifacts, source, tests, and current runner evidence win.
- Fail-open: memory errors must not block coding work, continue working normally, and diagnostics must be redacted.

### Provider: Supermemory

Use Deck Runtime for project recall/capture. Raw provider MCP is unmanaged external capability and must not be used as a Deck project-memory isolation boundary.`;
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
  if (!derived) return { authorized: false, reason: "missing" };
  if (!isCanonicalSupermemoryProjectScope(derived)) return { authorized: false, reason: "invalid" };
  if (configured !== undefined && configured !== "") {
    if (!isCanonicalSupermemoryProjectScope(configured)) return { authorized: false, reason: "invalid" };
    if (configured !== derived) return { authorized: false, reason: "mismatch" };
  }
  return { authorized: true, scope: derived };
}

function renderAuthorizedSupermemoryPolicy(_scope: CanonicalSupermemoryProjectScope): string {
  return [
    "- Deck has resolved a verified project identity for this supervised launch; the raw scope is held inside Deck Runtime and is not a model-controlled tool argument.",
    "- Runtime-managed recall and capture bind project scope server-side. Runner events, prompts, agents, and tools MUST NOT provide or override any scope-like field.",
    "- Raw provider MCP tools are not materialized or authorized for Deck project memory because their schemas permit model-selected project scope.",
    "- If an external provider MCP entry is visible, treat it as unmanaged and external-unobservable; do not use it for automatic project memory.",
    "- Automatic capture and explicit remember are routed through Deck Runtime to prevent duplicates and preserve one immutable top-level session scope.",
    "- Account-only readiness checks may still be used for authentication/status when exposed by the runner, but active space is not project isolation.",
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
