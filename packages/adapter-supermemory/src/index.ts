import type { AdaptiveMemoryProvider, MemoryInjectionBundle, MemoryInstructionFragment, MemoryToolBinding } from "@deck/core/memory/adaptive-memory";
import { createAdaptiveMemoryDiagnostic, type AdaptiveMemoryAdapter, type AdaptiveMemoryCommitRequest, type AdaptiveMemoryCommitResult, type AdaptiveMemoryConfigureRequest, type AdaptiveMemoryContextRequest, type AdaptiveMemoryContextResult, type AdaptiveMemoryHealthResult, type AdaptiveMemorySearchRequest, type AdaptiveMemorySearchResult, type AdaptiveMemorySource } from "@deck/core/memory/adaptive-memory-contract";
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
  /** Supermemory API key. Falls back to process.env.SUPERMEMORY_API_KEY if not provided. */
  apiKey?: string;
  /** Override for the Supermemory MCP server URL. Defaults to SUPERMEMORY_MCP_SERVER_URL. */
  mcpServerUrl?: string;
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

function createAdapter(
  config: Required<Pick<SupermemoryMemoryProviderConfig, "userId" | "mcpServerName">> & Omit<SupermemoryMemoryProviderConfig, "mcpServerUrl"> & { mcpServerUrl: string },
  _authenticatedRuntimeValidated: { current: boolean },
): AdaptiveMemoryAdapter {
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
        return { savedCount: 0, discardedCount: request.candidates.length, decisions: request.candidates.map((candidate) => ({ accepted: false, scope: candidate.scope.scope as "personal" | "team" | "org" | "project", source: candidate.metadata.source as AdaptiveMemorySource, reason: "Rejected by adaptive memory governance." })), diagnostics: [diagnostic("Supermemory commit candidates failed governance validation.", "ADAPTIVE_MEMORY_GOVERNANCE_REJECTED")] };
      }

      // apiKey falls back to environment variable
      const apiKey = config.apiKey ?? process.env.SUPERMEMORY_API_KEY;
      const mcpServerUrl = config.mcpServerUrl;

      if (!apiKey?.trim()) {
        return {
          savedCount: 0,
          discardedCount: request.candidates.length,
          decisions: request.candidates.map((candidate) => ({ accepted: false, scope: candidate.scope.scope as "personal" | "team" | "org" | "project", source: candidate.metadata.source as AdaptiveMemorySource, reason: "Supermemory API key is missing or invalid." })),
          diagnostics: [diagnostic("Supermemory API key is missing or invalid — skipping memory persistence.")],
        };
      }

      const decisions: Array<{ accepted: boolean; scope: "personal" | "team" | "org" | "project"; source: AdaptiveMemorySource; reason: string }> = [];
      let savedCount = 0;
      let discardedCount = 0;

      for (const candidate of request.candidates) {
        // TODO: Confirm exact Supermemory REST endpoint schema for add/update.
        // Currently using interim endpoints: POST {mcpServerUrl}/api/memories/add (create)
        // and POST {mcpServerUrl}/api/memories/update (update).
        // NOTE: existingMemoryId may not exist on all candidate types; use any to access it.
        const existingMemoryId = (candidate as unknown as { existingMemoryId?: string }).existingMemoryId;
        const endpoint = existingMemoryId
          ? `${mcpServerUrl}/api/memories/update`
          : `${mcpServerUrl}/api/memories/add`;

        const payload = {
          containerTag: candidate.containerTag,
          content: candidate.content,
          // topicKey may not exist on all candidate metadata types
          ...(("topicKey" in candidate.metadata) ? { topicKey: (candidate.metadata as unknown as { topicKey?: string }).topicKey } : {}),
          type: candidate.metadata.type,
          confidence: candidate.metadata.confidence,
          source: candidate.metadata.source,
          ...(existingMemoryId ? { memoryId: existingMemoryId } : {}),
        };

        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-supermemory-api-key": apiKey,
            },
            body: JSON.stringify(payload),
          });

          if (response.ok) {
            decisions.push({ accepted: true, scope: candidate.scope.scope as "personal" | "team" | "org" | "project", source: candidate.metadata.source as AdaptiveMemorySource, reason: "Memory persisted successfully." });
            savedCount++;
          } else {
            const errorText = await response.text().catch(() => "Unknown error");
            decisions.push({ accepted: false, scope: candidate.scope.scope as "personal" | "team" | "org" | "project", source: candidate.metadata.source as AdaptiveMemorySource, reason: `HTTP ${response.status}: ${errorText.slice(0, 200)}` });
            discardedCount++;
          }
        } catch (error) {
          decisions.push({ accepted: false, scope: candidate.scope.scope as "personal" | "team" | "org" | "project", source: candidate.metadata.source as AdaptiveMemorySource, reason: `Fetch error: ${error instanceof Error ? error.message : String(error)}` });
          discardedCount++;
        }
      }

      return {
        savedCount,
        discardedCount,
        decisions,
        diagnostics: [diagnostic(`Committed ${savedCount} memories; ${discardedCount} discarded.`)],
      };
    },
    async configure(request: AdaptiveMemoryConfigureRequest): Promise<void> {
      if (typeof request.providerState?.authenticatedRuntimeValidated === "boolean") {
        _authenticatedRuntimeValidated.current = request.providerState.authenticatedRuntimeValidated;
      }
    },
    async health(): Promise<AdaptiveMemoryHealthResult> {
      return { providerId: "supermemory", status: _authenticatedRuntimeValidated.current ? "available" : "degraded", diagnostics: _authenticatedRuntimeValidated.current ? [] : [diagnostic("Supermemory requires authenticated runtime validation through an execute read-only probe before full availability.", "ADAPTIVE_MEMORY_HEALTH_UNKNOWN")] };
    },
  };
}

export function createSupermemoryMemoryProvider(config: SupermemoryMemoryProviderConfig): AdaptiveMemoryProvider {
  const userId = requireNonEmpty(config.userId, "userId");
  const normalized = { ...config, userId, mcpServerName: config.mcpServerName?.trim() || "supermemory", maxMemoriesPerSession: config.maxMemoriesPerSession ?? 7, mcpServerUrl: config.mcpServerUrl ?? SUPERMEMORY_MCP_SERVER_URL };
  validatedContainer(personalContainer(normalized.userId));
  if (normalized.teamId) validatedContainer(`t:${normalized.teamId}`);
  if (normalized.orgId) validatedContainer(`o:${normalized.orgId}`);
  const _authenticatedRuntimeValidated = { current: config.authenticatedRuntimeValidated ?? false };
  const adapter = createAdapter(normalized as Required<Pick<SupermemoryMemoryProviderConfig, "userId" | "mcpServerName">> & Omit<SupermemoryMemoryProviderConfig, "mcpServerUrl"> & { mcpServerUrl: string }, _authenticatedRuntimeValidated);
  return {
    id: "supermemory",
    displayName: "Supermemory MCP",
    adapter,
    health: () => adapter.health(),
    buildInjection(): MemoryInjectionBundle {
      const bindings: readonly MemoryToolBinding[] = [{
        capability: "memory.search",
        serverName: normalized.mcpServerName,
        toolNames: SUPERMEMORY_MCP_TOOLS,
        metadata: {
          endpoint: SUPERMEMORY_MCP_SERVER_URL,
          requiresAuthenticatedExecuteProbe: true,
          authenticatedRuntimeValidated: _authenticatedRuntimeValidated.current,
          serverQualifiedToolNamesRequired: true,
          serverQualifiedToolNames: [normalized.mcpServerName + ".execute", normalized.mcpServerName + ".search_docs"],
        },
      }];
      return { instructions: createFragments(normalized), toolBindings: bindings };
    },
  };
}

/**
 * Provider metadata for CLI registration.
 * The CLI composition root uses this to discover and register available memory providers.
 */
export const SUPERMEMORY_MEMORY_PROVIDER_ID = "supermemory";
export const SUPERMEMORY_MEMORY_PROVIDER_METADATA = {
  id: SUPERMEMORY_MEMORY_PROVIDER_ID,
  displayName: "Supermemory MCP",
  description: "MCP-based adaptive memory with personal container and team scoping.",
} as const;
