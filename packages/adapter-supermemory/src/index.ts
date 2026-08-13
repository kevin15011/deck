import type { AdaptiveMemoryProvider, MemoryInjectionBundle, MemoryInstructionFragment, MemoryToolBinding } from "@deck/core/memory/adaptive-memory";
import { createAdaptiveMemoryDiagnostic, type AdaptiveMemoryAdapter, type AdaptiveMemoryCommitRequest, type AdaptiveMemoryCommitResult, type AdaptiveMemoryConfigureRequest, type AdaptiveMemoryContextRequest, type AdaptiveMemoryContextResult, type AdaptiveMemoryHealthResult, type AdaptiveMemorySearchRequest, type AdaptiveMemorySearchResult, type AdaptiveMemorySource } from "@deck/core/memory/adaptive-memory-contract";
import { validateAdaptiveMemoryCommitRequest, validateAdaptiveMemorySearchFilters, validateAdaptiveMemoryScope } from "@deck/core/memory/adaptive-memory-governance";
import { isCanonicalSupermemoryProjectScope, renderProjectBoundAdaptiveMemoryInstructions } from "@deck/core";

export * from "./conversation";

export const SUPERMEMORY_MCP_SERVER_URL = "https://mcp.supermemory.ai/mcp";
export const SUPERMEMORY_MCP_TOOLS = [
  "supermemory_add_memory",
  "supermemory_search_memory",
  "supermemory_listMemories",
  "supermemory_listDocuments",
  "supermemory_fetch-graph-data",
  "supermemory_memory-graph",
  "supermemory_save-memory",
] as const;

/** Specific metadata shape used by Supermemory tool bindings. */
export type SupermemoryToolBindingMetadata = {
  endpoint: string;
  requiresAuthenticatedExecuteProbe: boolean;
  authenticatedRuntimeValidated: boolean;
  serverQualifiedToolNamesRequired: boolean;
  serverQualifiedToolNames: readonly string[];
  conversationCaptureDefault?: boolean;
  conversationCaptureSupport?: Readonly<Record<"opencode" | "pi" | "codex", "unsupported/static-compatible">>;
  dreamingDefault?: "dynamic" | "instant";
  maxResultsDefault?: number;
  maxContextTokensDefault?: number;
  scopedTools?: readonly string[];
  accountOnlyTools?: readonly string[];
  activeSpaceOnlyToolsForbidden?: readonly string[];
  documentIdToolsRequireScopedPredecessor?: readonly string[];
};

/**
 * Supermemory MCP-only Memory Provider Configuration.
 *
 * CONTRACT (Repair 2026-05-29):
 * - No userId/teamId/orgId manual: user identity is derived from the token/OAuth account.
 * - Project memory requires Deck's canonical containerTag argument on every scoped tool call.
 * - x-sm-project is diagnostic/transport metadata only and never supplies omitted tool arguments.
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
  /** Repository-derived canonical project scope materialized by Deck. */
  projectScope?: string;
  /** Scope observed in configured MCP transport; when present it must match projectScope. */
  configuredProjectScope?: string;
};

/**
 * Creates memory instruction fragments for Supermemory MCP.
 * CONTRACT: Project memory is scoped by Deck's canonical containerTag argument.
 * x-sm-project is transport diagnostics/config parity only.
 */
function createFragments(config: { mcpServerName: string; projectScope?: string; configuredProjectScope?: string }): MemoryInstructionFragment[] {
  const scopeAuthorized = Boolean(
    config.projectScope &&
      config.configuredProjectScope &&
      isCanonicalSupermemoryProjectScope(config.projectScope) &&
      isCanonicalSupermemoryProjectScope(config.configuredProjectScope) &&
      config.configuredProjectScope === config.projectScope,
  );
  const markdown = [
    "### Supermemory MCP Conversation Memory",
    "",
    renderProjectBoundAdaptiveMemoryInstructions({
      supermemoryProjectScope: config.projectScope,
      configuredSupermemoryProjectScope: config.configuredProjectScope,
    }),
    "Use these active runner-exposed Supermemory tools when available:",
    "- `supermemory_add_memory` — explicit durable memory save; pass the canonical `containerTag` argument",
    "- `supermemory_search_memory` — bounded recall/search; pass the canonical `containerTag` argument",
    "- `supermemory_listMemories` and `supermemory_listDocuments` — scoped list operations; pass the canonical `containerTag` argument when the schema accepts it",
    "- `supermemory_fetch-graph-data` and `supermemory_memory-graph` — scoped graph operations; pass the canonical `containerTag` argument when the schema accepts it",
    "- `supermemory_save-memory` — save-equivalent scoped operation; pass the canonical `containerTag` argument",
    "- `supermemory_getDocument` — document fetch only after the document id came from a scoped predecessor in the same workflow",
    "- Supermemory account/active-space tools are for account readiness only and must not be used as project isolation.",
    "",
    "Tool examples:",
    scopeAuthorized
      ? `- supermemory_add_memory({ content, containerTag: \"${config.projectScope}\" })`
      : "- supermemory_add_memory is disabled until Deck provides a canonical containerTag.",
    scopeAuthorized
      ? `- supermemory_search_memory({ query, containerTag: \"${config.projectScope}\" })`
      : "- supermemory_search_memory is disabled until Deck provides a canonical containerTag.",
    scopeAuthorized
      ? `- supermemory_listMemories({ containerTag: \"${config.projectScope}\" })`
      : "- supermemory_listMemories is disabled until Deck provides a canonical containerTag.",
    scopeAuthorized
      ? `- supermemory_listDocuments({ containerTag: \"${config.projectScope}\" })`
      : "- supermemory_listDocuments is disabled until Deck provides a canonical containerTag.",
    scopeAuthorized
      ? `- supermemory_fetch-graph-data({ containerTag: \"${config.projectScope}\" })`
      : "- supermemory_fetch-graph-data is disabled until Deck provides a canonical containerTag.",
    scopeAuthorized
      ? `- supermemory_memory-graph({ containerTag: \"${config.projectScope}\" })`
      : "- supermemory_memory-graph is disabled until Deck provides a canonical containerTag.",
    scopeAuthorized
      ? `- supermemory_save-memory({ content, containerTag: \"${config.projectScope}\" })`
      : "- supermemory_save-memory is disabled until Deck provides a canonical containerTag.",
    "- supermemory_getDocument({ documentId }) only after a scoped predecessor returned that document id.",
    "",
    "Tool semantics:",
    "- add/search/list memory, document, graph, and save equivalents are project-scoped only when the exposed schema accepts `containerTag` and the exact Deck value is passed.",
    "- Account-readiness tools are account-only and exempt from project scope only for non-memory effects.",
    "- Never use active-space-only tools for automatic memory; active space is not project isolation.",
    "- Use document fetch only after the document id came from a scoped predecessor in the same workflow.",
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
  _config: { mcpServerName: string; mcpServerUrl: string },
  _authenticatedRuntimeValidated: { current: boolean },
): AdaptiveMemoryAdapter {
  return {
    identity: { id: "supermemory", displayName: "Supermemory MCP" },
    async loadContext(_request: AdaptiveMemoryContextRequest): Promise<AdaptiveMemoryContextResult> {
      return {
        providerId: "supermemory",
        items: [],
        diagnostics: [diagnostic("Supermemory automatic context execution is unsupported/static-compatible; use MCP tool bindings explicitly when the active runner exposes them.")],
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
          : [diagnostic("Supermemory automatic search execution is unsupported/static-compatible; zero items were returned because the static-compatible adapter does not execute MCP tools.")],
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
          reason: "Automatic persistence is unsupported/static-compatible; adapter saved zero candidates and discarded this candidate without executing MCP tools.",
        })),
        diagnostics: [
          diagnostic(
            `Supermemory automatic execution is unsupported/static-compatible; zero candidates were saved and ${request.candidates.length} candidates were discarded because the adapter does not execute MCP tools.`,
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
    mcpServerUrl: config.mcpServerUrl ?? SUPERMEMORY_MCP_SERVER_URL,
    projectScope: config.projectScope?.trim(),
    configuredProjectScope: config.configuredProjectScope?.trim(),
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
    buildInjection(context = {}): MemoryInjectionBundle {
      const projectScope = normalized.projectScope ?? context.supermemoryProjectScope?.trim();
      const configuredProjectScope = normalized.configuredProjectScope ?? context.configuredSupermemoryProjectScope?.trim();
      const scopeAuthorized = Boolean(
        projectScope &&
          configuredProjectScope &&
          isCanonicalSupermemoryProjectScope(projectScope) &&
          isCanonicalSupermemoryProjectScope(configuredProjectScope) &&
          configuredProjectScope === projectScope,
      );
      const metadata: SupermemoryToolBindingMetadata = {
        endpoint: normalized.mcpServerUrl,
        requiresAuthenticatedExecuteProbe: true,
        authenticatedRuntimeValidated: _authenticatedRuntimeValidated.current,
        serverQualifiedToolNamesRequired: false,
        serverQualifiedToolNames: [...SUPERMEMORY_MCP_TOOLS],
        conversationCaptureDefault: false,
        conversationCaptureSupport: {
          opencode: "unsupported/static-compatible",
          pi: "unsupported/static-compatible",
          codex: "unsupported/static-compatible",
        },
        dreamingDefault: "dynamic",
        maxResultsDefault: 5,
        maxContextTokensDefault: 1500,
        scopedTools: [...SUPERMEMORY_MCP_TOOLS],
        accountOnlyTools: ["supermemory account/active-space readiness tools"],
        activeSpaceOnlyToolsForbidden: ["active-space mutation or selection tools"],
        documentIdToolsRequireScopedPredecessor: ["document fetch tools"],
      } as SupermemoryToolBindingMetadata;
      const bindings: readonly MemoryToolBinding[] = scopeAuthorized ? [
        {
          capability: "memory.write",
          serverName: normalized.mcpServerName,
          toolNames: SUPERMEMORY_MCP_TOOLS,
          metadata: metadata as unknown as Readonly<Record<string, unknown>>,
        },
        {
          capability: "memory.search",
          serverName: normalized.mcpServerName,
          toolNames: ["supermemory_search_memory"],
          metadata: metadata as unknown as Readonly<Record<string, unknown>>,
        },
      ] : [];
      return { instructions: createFragments({ ...normalized, projectScope, configuredProjectScope }), toolBindings: bindings };
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
