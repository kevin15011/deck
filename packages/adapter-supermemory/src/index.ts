import type { AdaptiveMemoryProvider, MemoryInjectionBundle, MemoryInstructionFragment, MemoryToolBinding } from "@deck/core/memory/adaptive-memory";
import { createAdaptiveMemoryDiagnostic, type AdaptiveMemoryAdapter, type AdaptiveMemoryCommitRequest, type AdaptiveMemoryCommitResult, type AdaptiveMemoryConfigureRequest, type AdaptiveMemoryContextRequest, type AdaptiveMemoryContextResult, type AdaptiveMemoryHealthResult, type AdaptiveMemorySearchRequest, type AdaptiveMemorySearchResult } from "@deck/core/memory/adaptive-memory-contract";
import { validateAdaptiveMemoryCommitRequest, validateAdaptiveMemorySearchFilters, validateAdaptiveMemoryScope, validateContainerTag } from "@deck/core/memory/adaptive-memory-governance";

export const SUPERMEMORY_MCP_SERVER_URL = "https://supermemory-new.stlmcp.com";
export const SUPERMEMORY_MCP_TOOLS = ["execute", "search_docs"] as const;

export type SupermemoryMemoryProviderConfig = {
  userId: string;
  teamId?: string;
  orgId?: string;
  mcpServerName?: string;
  searchMode?: "memories" | "documents";
  maxMemoriesPerSession?: number;
  authenticatedRuntimeValidated?: boolean;
};

function requireNonEmpty(value: string | undefined, field: string): string {
  if (!value?.trim()) throw new Error(`Supermemory ${field} is required.`);
  return value.trim();
}

function personalContainer(userId: string) {
  return `u:${userId}`;
}

function validatedContainer(tag: string): string {
  const result = validateContainerTag(tag);
  if (!result.valid) throw new Error(result.issues.map((issue) => issue.message).join(" "));
  return tag;
}

function createFragments(config: Required<Pick<SupermemoryMemoryProviderConfig, "userId" | "mcpServerName">> & SupermemoryMemoryProviderConfig): MemoryInstructionFragment[] {
  const container = validatedContainer(personalContainer(config.userId));
  const optionalScopes = [config.teamId ? `team container t:${config.teamId} (team memories are candidate only)` : undefined, config.orgId ? `org container o:${config.orgId}` : undefined].filter(Boolean).join("; ") || "none configured";
  const markdown = [
    "### Supermemory MCP Adaptive Memory",
    "",
    "Supermemory is advisory only. OFFICIAL CONTEXT and OpenSpec artifacts remain authoritative.",
    `Use MCP server \`${config.mcpServerName}\` with validated tools only: \`${config.mcpServerName}.execute\` and \`${config.mcpServerName}.search_docs\` when Pi exposes server-qualified tool names.`,
    "Do not call or reference provisional MCP tools named `context`, `recall`, or `memory`.",
    `Use \`${config.mcpServerName}.execute\` only for scoped Supermemory SDK operations such as \`client.profile\`, \`client.search.memories\`, \`client.search.documents\`, \`client.add\`, \`client.memories.updateMemory\`, and \`client.memories.forget\`.`,
    `Use \`${config.mcpServerName}.search_docs\` only when SDK documentation lookup is needed.`,
    `Default personal containerTag: \`${container}\`.`,
    `Optional scoped containers: ${optionalScopes}.`,
    "Apply metadata filters before using memories: source, scope, type, confidence, creator, project/change/phase/artifact, and promotionStatus when known.",
    "Save only high-signal learnings such as explicit user corrections, repeated rejections, preferences, project heuristics, candidate conventions, and retrospectives.",
    `Commit at most ${config.maxMemoriesPerSession ?? 7} memories per session; prefer 3 only when at least 3 high-signal learnings exist.`,
    "Team-scoped writes must use promotionStatus `candidate` unless an explicit future approval flow marks them approved.",
    "Never store active specs/tasks, raw chats, secrets, credentials, sensitive code, unapproved requirements, experimental deltas, or Engram migration payloads.",
  ].join("\n");
  return ["session", "agent", "skill"].map((surface) => ({ surface: surface as "session" | "agent" | "skill", teamId: "developer-team", markdown }));
}

function diagnostic(message: string, code: "ADAPTIVE_MEMORY_HEALTH_UNKNOWN" | "ADAPTIVE_MEMORY_OPERATION_UNSUPPORTED" | "ADAPTIVE_MEMORY_GOVERNANCE_REJECTED" = "ADAPTIVE_MEMORY_OPERATION_UNSUPPORTED") {
  return createAdaptiveMemoryDiagnostic(code, message, { severity: code === "ADAPTIVE_MEMORY_GOVERNANCE_REJECTED" ? "error" : "warning", providerId: "supermemory", recoverable: true });
}

function createAdapter(config: SupermemoryMemoryProviderConfig): AdaptiveMemoryAdapter {
  return {
    identity: { id: "supermemory", displayName: "Supermemory MCP" },
    async loadContext(request: AdaptiveMemoryContextRequest): Promise<AdaptiveMemoryContextResult> {
      const issues = request.scopes.flatMap((scope) => validateAdaptiveMemoryScope(scope).issues);
      if (request.filters) issues.push(...validateAdaptiveMemorySearchFilters(request.filters).issues);
      return { providerId: "supermemory", items: [], diagnostics: issues.length ? [diagnostic("Supermemory context request failed governance validation.", "ADAPTIVE_MEMORY_GOVERNANCE_REJECTED")] : [diagnostic("Runtime context loading is performed by Pi MCP tool bindings.")] };
    },
    async search(request: AdaptiveMemorySearchRequest): Promise<AdaptiveMemorySearchResult> {
      const issues = request.scopes.flatMap((scope) => validateAdaptiveMemoryScope(scope).issues);
      if (request.filters) issues.push(...validateAdaptiveMemorySearchFilters(request.filters).issues);
      return { providerId: "supermemory", items: [], diagnostics: issues.length ? [diagnostic("Supermemory search request failed governance validation.", "ADAPTIVE_MEMORY_GOVERNANCE_REJECTED")] : [diagnostic("Runtime search is performed through the validated execute MCP tool.")] };
    },
    async commit(request: AdaptiveMemoryCommitRequest): Promise<AdaptiveMemoryCommitResult> {
      const validation = validateAdaptiveMemoryCommitRequest(request);
      if (!validation.valid) {
        return { savedCount: 0, discardedCount: request.candidates.length, decisions: request.candidates.map((candidate) => ({ accepted: false, scope: candidate.scope.scope, source: candidate.metadata.source, reason: "Rejected by adaptive memory governance." })), diagnostics: [diagnostic("Supermemory commit candidates failed governance validation.", "ADAPTIVE_MEMORY_GOVERNANCE_REJECTED")] };
      }
      return { savedCount: 0, discardedCount: request.candidates.length, decisions: request.candidates.map((candidate) => ({ accepted: false, scope: candidate.scope.scope, source: candidate.metadata.source, reason: "Commit guidance is emitted for Pi MCP execution; adapter does not persist memories directly." })), diagnostics: [diagnostic("Runtime commits are performed through the validated execute MCP tool.")] };
    },
    async configure(_request: AdaptiveMemoryConfigureRequest): Promise<void> {},
    async health(): Promise<AdaptiveMemoryHealthResult> {
      return { providerId: "supermemory", status: config.authenticatedRuntimeValidated ? "available" : "degraded", diagnostics: config.authenticatedRuntimeValidated ? [] : [diagnostic("Supermemory requires authenticated runtime validation through an execute read-only probe before full availability.", "ADAPTIVE_MEMORY_HEALTH_UNKNOWN")] };
    },
  };
}

export function createSupermemoryMemoryProvider(config: SupermemoryMemoryProviderConfig): AdaptiveMemoryProvider {
  const userId = requireNonEmpty(config.userId, "userId");
  const normalized = { ...config, userId, mcpServerName: config.mcpServerName?.trim() || "supermemory", maxMemoriesPerSession: config.maxMemoriesPerSession ?? 7 };
  validatedContainer(personalContainer(normalized.userId));
  if (normalized.teamId) validatedContainer(`t:${normalized.teamId}`);
  if (normalized.orgId) validatedContainer(`o:${normalized.orgId}`);
  const adapter = createAdapter(normalized);
  return {
    id: "supermemory",
    displayName: "Supermemory MCP",
    adapter,
    health: () => adapter.health(),
    buildInjection(): MemoryInjectionBundle {
      if (!normalized.authenticatedRuntimeValidated) {
        throw new Error("Supermemory authenticated runtime validation is required before MCP tool injection.");
      }
      const bindings: readonly MemoryToolBinding[] = [{ capability: "memory.search", serverName: normalized.mcpServerName, toolNames: SUPERMEMORY_MCP_TOOLS, metadata: { endpoint: SUPERMEMORY_MCP_SERVER_URL, requiresAuthenticatedExecuteProbe: true, authenticatedRuntimeValidated: true, serverQualifiedToolNamesRequired: true } }];
      return { instructions: createFragments(normalized), toolBindings: bindings };
    },
  };
}
