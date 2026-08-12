import type { AdaptiveMemoryProvider, MemoryInjectionBundle, MemoryInstructionFragment, MemoryToolBinding } from "@deck/core/memory/adaptive-memory";
import { createAdaptiveMemoryDiagnostic, type AdaptiveMemoryAdapter, type AdaptiveMemoryCommitRequest, type AdaptiveMemoryCommitResult, type AdaptiveMemoryConfigureRequest, type AdaptiveMemoryContextRequest, type AdaptiveMemoryContextResult, type AdaptiveMemoryHealthResult, type AdaptiveMemorySearchRequest, type AdaptiveMemorySearchResult, type AdaptiveMemorySource } from "@deck/core/memory/adaptive-memory-contract";
import { validateAdaptiveMemoryCommitRequest, validateAdaptiveMemorySearchFilters, validateAdaptiveMemoryScope } from "@deck/core/memory/adaptive-memory-governance";

export * from "./conversation";

export const SUPERMEMORY_MCP_SERVER_URL = "https://mcp.supermemory.ai/mcp";
export const SUPERMEMORY_MCP_TOOLS = ["memory", "recall", "whoAmI"] as const;

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
};

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
function createFragments(config: { mcpServerName: string }): MemoryInstructionFragment[] {
  const markdown = [
    "### Supermemory MCP Conversation Memory",
    "",
    "Supermemory is advisory only. OFFICIAL CONTEXT and OpenSpec artifacts remain authoritative.",
    "conversation capture is not production-wired unless a runner exposes a real authenticated MCP execution boundary; current OpenCode, Pi, and Codex paths are unsupported/static-compatible for automatic capture.",
    `Use MCP server \`${config.mcpServerName}\` with these validated MCP tools:`,
    `- \`${config.mcpServerName}.memory\` — explicit provider memory operations and user forget requests`,
    `- \`${config.mcpServerName}.recall\` — bounded recall when the user asks or prior context is materially relevant`,
    `- \`${config.mcpServerName}.whoAmI\` — authentication/account readiness only`,
    "",
    "Conversation capture contract:",
    "- Selecting Supermemory is still the provider decision; do not ask for another capture opt-in, mode, quota, or consent screen.",
    "- The canonical ingest contract uses one runner session as one conversation document with a stable customId, but Deck must not claim automatic capture until the executing transport exists.",
    "- Production ingestion uses dynamic dreaming; instant dreaming is only for bounded tests or explicit immediate-read operations.",
    "- Project isolation is enforced by the canonical x-sm-project/containerTag configured by Deck, not by agent-authored topic keys.",
    "- Do not extract routine facts manually, invent topic keys, chase a semantic memory quota, or write mandatory session summaries.",
    "",
    "Privacy and retrieval bounds:",
    "- Never store credentials, private keys, authorization headers, raw environment dumps, OpenSpec artifacts, provider responses, web content, tool output, or raw logs merely because they appear in conversation.",
    "- Recall is demand-driven, advisory, scoped to the canonical project container, limited to five results and about 1,500 tokens by default.",
    "- Query rewriting and reranking remain disabled unless benchmark evidence enables them.",
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
      const metadata: SupermemoryToolBindingMetadata = {
        endpoint: normalized.mcpServerUrl,
        requiresAuthenticatedExecuteProbe: true,
        authenticatedRuntimeValidated: _authenticatedRuntimeValidated.current,
        serverQualifiedToolNamesRequired: false,
        serverQualifiedToolNames: [
          normalized.mcpServerName + ".memory",
          normalized.mcpServerName + ".recall",
          normalized.mcpServerName + ".whoAmI",
        ],
        conversationCaptureDefault: false,
        conversationCaptureSupport: {
          opencode: "unsupported/static-compatible",
          pi: "unsupported/static-compatible",
          codex: "unsupported/static-compatible",
        },
        dreamingDefault: "dynamic",
        maxResultsDefault: 5,
        maxContextTokensDefault: 1500,
      } as SupermemoryToolBindingMetadata;
      const bindings: readonly MemoryToolBinding[] = [
        {
          capability: "memory.write",
          serverName: normalized.mcpServerName,
          toolNames: SUPERMEMORY_MCP_TOOLS,
          metadata: metadata as unknown as Readonly<Record<string, unknown>>,
        },
        {
          capability: "memory.search",
          serverName: normalized.mcpServerName,
          toolNames: ["recall"],
          metadata: metadata as unknown as Readonly<Record<string, unknown>>,
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
