import type { AdaptiveMemoryProvider, MemoryInjectionBundle, MemoryInstructionFragment, MemoryToolBinding } from "@deck/core/memory/adaptive-memory";
import { createAdaptiveMemoryDiagnostic, type AdaptiveMemoryAdapter, type AdaptiveMemoryCommitRequest, type AdaptiveMemoryCommitResult, type AdaptiveMemoryConfigureRequest, type AdaptiveMemoryContextResult, type AdaptiveMemoryHealthResult, type AdaptiveMemorySearchRequest, type AdaptiveMemorySearchResult, type AdaptiveMemorySource } from "@deck/core/memory/adaptive-memory-contract";
import { validateAdaptiveMemoryCommitRequest, validateAdaptiveMemorySearchFilters, validateAdaptiveMemoryScope } from "@deck/core/memory/adaptive-memory-governance";

export const SUPERMEMORY_MCP_SERVER_URL = "https://mcp.supermemory.ai/mcp";
export const SUPERMEMORY_MCP_TOOLS = ["memory", "recall", "whoAmI"] as const;

/**
 * Supermemory MCP-only Memory Provider Configuration.
 *
 * CONTRACT (Repair 2026-05-29):
 * - No userId/teamId/orgId manual: el usuario se deriva del token/API key.
 * - No containerTag manual: el scoping es automático (token → usuario, x-sm-project → proyecto).
 * - Solo token/API key es input manual.
 */
export type SupermemoryMemoryProviderConfig = {
  /** Optional MCP server name. Defaults to "supermemory". */
  mcpServerName?: string;
  maxMemoriesPerSession?: number;
  authenticatedRuntimeValidated?: boolean;
  /** Supermemory API key. Falls back to process.env.SUPERMEMORY_API_KEY if not provided. */
  apiKey?: string;
  /** Override for the Supermemory MCP server URL. Defaults to SUPERMEMORY_MCP_SERVER_URL. */
  mcpServerUrl?: string;
};

/**
 * Creates memory instruction fragments for Supermemory MCP.
 * CONTRACT: No container tags. Scoping is automatic:
 * - User identity derived from token/API key
 * - Project scoping via x-sm-project header in MCP config
 */
function createFragments(config: { mcpServerName: string; maxMemoriesPerSession: number }): MemoryInstructionFragment[] {
  const markdown = [
    "### Supermemory MCP Adaptive Memory",
    "",
    "Supermemory is advisory only. OFFICIAL CONTEXT and OpenSpec artifacts remain authoritative.",
    `Use MCP server \`${config.mcpServerName}\` with these validated MCP tools:`,
    `- \`${config.mcpServerName}.memory\` — save (action=save) or forget (action=forget) memories`,
    `- \`${config.mcpServerName}.recall\` — search memories`,
    `- \`${config.mcpServerName}.whoAmI\` — get current user identity`,
    "",
    "Memory scoping rules (automatic):",
    "- User identity: derived from your Supermemory token/API key (no manual containerTag needed).",
    "- Project scoping: via x-sm-project header in MCP config (automatic, no manual containerTag).",
    "- No manual container tags (`u:`, `p:`, `t:`, `o:`) — memories save as content, scoping is automatic.",
    "",
    "Save only high-signal learnings: explicit user corrections, preferences, architectural decisions, bug fixes with root cause, project conventions, and retrospectives.",
    `Commit at most ${config.maxMemoriesPerSession ?? 7} memories per session; prefer quality over quantity.`,
    "Never store: active specs/tasks, raw chats, secrets, credentials, sensitive code, or unapproved requirements.",
  ].join("\n");

  return ["session", "agent", "skill"].map((surface) => ({
    surface: surface as "session" | "agent" | "skill",
    teamId: "developer-team",
    markdown,
  }));
}

function diagnostic(
  message: string,
  code: "ADAPTIVE_MEMORY_HEALTH_UNKNOWN" | "ADAPTIVE_MEMORY_OPERATION_UNSUPPORTED" | "ADAPTIVE_MEMORY_GOVERNANCE_REJECTED" = "ADAPTIVE_MEMORY_OPERATION_UNSUPPORTED",
) {
  return createAdaptiveMemoryDiagnostic(code, message, {
    severity: code === "ADAPTIVE_MEMORY_GOVERNANCE_REJECTED" ? "error" : "warning",
    providerId: "supermemory",
    recoverable: true,
  });
}

function createAdapter(
  config: { mcpServerName: string; mcpServerUrl: string },
  _authenticatedRuntimeValidated: { current: boolean },
): AdaptiveMemoryAdapter {
  return {
    identity: { id: "supermemory", displayName: "Supermemory MCP" },
    async loadContext(_request: { scopes?: Array<{ scope: string }>; filters?: Record<string, unknown> }): Promise<AdaptiveMemoryContextResult> {
      return {
        providerId: "supermemory",
        items: [],
        diagnostics: [diagnostic("Runtime context loading is performed via MCP `memory` tool bindings.")],
      };
    },
    async search(request: AdaptiveMemorySearchRequest): Promise<AdaptiveMemorySearchResult> {
      const issues = request.scopes.flatMap((scope) => validateAdaptiveMemoryScope(scope).issues);
      if (request.filters) issues.push(...validateAdaptiveMemorySearchFilters(request.filters).issues);
      return {
        providerId: "supermemory",
        items: [],
        diagnostics: issues.length
          ? [diagnostic("Supermemory search request failed governance validation.", "ADAPTIVE_MEMORY_GOVERNANCE_REJECTED")]
          : [diagnostic("Runtime search is performed through the MCP `recall` tool.")],
      };
    },
    async commit(request: AdaptiveMemoryCommitRequest): Promise<AdaptiveMemoryCommitResult> {
      const validation = validateAdaptiveMemoryCommitRequest(request);
      if (!validation.valid) {
        return {
          savedCount: 0,
          discardedCount: request.candidates.length,
          decisions: request.candidates.map((candidate) => ({
            accepted: false,
            scope: candidate.scope.scope as "personal" | "team" | "org" | "project",
            source: candidate.metadata.source as AdaptiveMemorySource,
            reason: "Rejected by adaptive memory governance.",
          })),
          diagnostics: [diagnostic("Supermemory commit candidates failed governance validation.", "ADAPTIVE_MEMORY_GOVERNANCE_REJECTED")],
        };
      }

      // MCP-only: commit operations are delegated to runtime MCP tool calls.
      // The adapter does NOT make direct REST calls. Memory persistence is handled by the MCP server.
      return {
        savedCount: 0,
        discardedCount: request.candidates.length,
        decisions: request.candidates.map((candidate) => ({
          accepted: false,
          scope: candidate.scope.scope as "personal" | "team" | "org" | "project",
          source: candidate.metadata.source as AdaptiveMemorySource,
          reason: "Memory persistence is performed via MCP `memory` tool at runtime; adapter does not persist directly.",
        })),
        diagnostics: [
          diagnostic(
            "MCP-only mode: memory commit deferred to runtime MCP `memory` tool. " +
              "Adapter does not persist directly. " +
              `Valid ${request.candidates.length} candidates queued for runtime persistence.`,
          ),
        ],
      };
    },
    async configure(request: AdaptiveMemoryConfigureRequest): Promise<void> {
      if (typeof request.providerState?.authenticatedRuntimeValidated === "boolean") {
        _authenticatedRuntimeValidated.current = request.providerState.authenticatedRuntimeValidated;
      }
    },
    async health(): Promise<AdaptiveMemoryHealthResult> {
      return {
        providerId: "supermemory",
        status: _authenticatedRuntimeValidated.current ? "available" : "degraded",
        diagnostics: _authenticatedRuntimeValidated.current
          ? []
          : [diagnostic("Supermemory MCP server requires authentication validation for full availability.", "ADAPTIVE_MEMORY_HEALTH_UNKNOWN")],
      };
    },
  };
}

export function createSupermemoryMemoryProvider(config: SupermemoryMemoryProviderConfig = {}): AdaptiveMemoryProvider {
  const normalized = {
    mcpServerName: config.mcpServerName?.trim() || "supermemory",
    maxMemoriesPerSession: config.maxMemoriesPerSession ?? 7,
    mcpServerUrl: config.mcpServerUrl ?? SUPERMEMORY_MCP_SERVER_URL,
  };

  const _authenticatedRuntimeValidated = { current: config.authenticatedRuntimeValidated ?? false };
  const adapter = createAdapter(
    normalized,
    _authenticatedRuntimeValidated,
  );

  return {
    id: "supermemory",
    displayName: "Supermemory MCP",
    adapter,
    health: () => adapter.health(),
    buildInjection(): MemoryInjectionBundle {
      const bindings: readonly MemoryToolBinding[] = [
        {
          capability: "memory.write",
          serverName: normalized.mcpServerName,
          toolNames: SUPERMEMORY_MCP_TOOLS,
          metadata: {
            endpoint: SUPERMEMORY_MCP_SERVER_URL,
            requiresAuthenticatedExecuteProbe: true,
            authenticatedRuntimeValidated: _authenticatedRuntimeValidated.current,
            serverQualifiedToolNamesRequired: false,
            serverQualifiedToolNames: [
              normalized.mcpServerName + ".memory",
              normalized.mcpServerName + ".recall",
              normalized.mcpServerName + ".whoAmI",
            ],
          },
        },
      ];
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
  description: "MCP-based adaptive memory with user and project/repository scoping.",
} as const;