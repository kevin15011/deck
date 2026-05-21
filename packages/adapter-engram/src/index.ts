import type {
  AdaptiveMemoryProvider,
  AdaptiveMemoryBuildContext,
  MemoryInjectionBundle,
  MemoryInstructionFragment,
  MemoryToolBinding,
} from "@deck/core/memory/adaptive-memory";
import {
  createAdaptiveMemoryDiagnostic,
  type AdaptiveMemoryAdapter,
  type AdaptiveMemoryCommitRequest,
  type AdaptiveMemoryCommitResult,
  type AdaptiveMemoryConfigureRequest,
  type AdaptiveMemoryContextRequest,
  type AdaptiveMemoryContextResult,
  type AdaptiveMemoryHealthResult,
  type AdaptiveMemorySearchRequest,
  type AdaptiveMemorySearchResult,
} from "@deck/core/memory/adaptive-memory-contract";

const ENGRAM_MCP_SERVER = "engram";
const ENGRAM_SEARCH_TOOLS = ["memory_search"] as const;
const ENGRAM_READ_TOOLS = ["memory_read"] as const;
const ENGRAM_WRITE_TOOLS = ["memory_write"] as const;

const MEMORY_SAFETY_POLICY = [
  "**Memory Safety**: Never store secrets, API keys, credentials, tokens,",
  "private keys, raw customer/PII data, or other sensitive information in",
  "Engram. Store only redacted summaries and non-sensitive context. When in",
  "doubt, omit or redact before storing.",
].join("\n");

const ENGRAM_SESSION_INSTRUCTION: MemoryInstructionFragment = {
  surface: "session",
  markdown: [
    "### Engram Memory (Experimental)",
    "",
    "Engram provides persistent memory across sessions. Use it to store and",
    "retrieve context, decisions, and notes that should persist across agent",
    "restarts. This provider is experimental; tool bindings may change.",
    "",
    "Available commands:",
    "- `memory_search` — Search stored memories by query.",
    "- `memory_read` — Read a specific memory entry by ID.",
    "- `memory_write` — Store a new memory or update an existing one.",
    "",
    "**Important**: Memory contents are auxiliary and never replace required",
    "OpenSpec artifacts or Spec Registry entries. Always record proposals,",
    "specs, designs, and state updates in their canonical OpenSpec locations.",
    "",
    "No Engram-to-Supermemory migration is provided by this adapter.",
    "",
    MEMORY_SAFETY_POLICY,
  ].join("\n"),
  teamId: "developer-team",
};

const ENGRAM_AGENT_INSTRUCTION: MemoryInstructionFragment = {
  surface: "agent",
  markdown: [
    "### Engram Memory (Experimental)",
    "",
    "Use Engram tools to persist and retrieve context between sessions.",
    "Search, read, and write memories as needed for your agent role.",
    "This provider is experimental; tool bindings may change.",
    "",
    "**Remember**: Memory is auxiliary. OpenSpec artifacts and Spec Registry",
    "entries remain the authoritative record.",
    "",
    "No Engram-to-Supermemory migration is provided by this adapter.",
    "",
    MEMORY_SAFETY_POLICY,
  ].join("\n"),
  teamId: "developer-team",
};

const ENGRAM_SKILL_INSTRUCTION: MemoryInstructionFragment = {
  surface: "skill",
  markdown: [
    "### Engram Memory (Experimental)",
    "",
    "During skill execution, use Engram tools to store and look up relevant",
    "context. This provider is experimental; tool bindings may change.",
    "",
    "**Remember**: Memory is auxiliary. Required artifacts and registry entries",
    "must still be written through OpenSpec flows.",
    "",
    "No Engram-to-Supermemory migration is provided by this adapter.",
    "",
    MEMORY_SAFETY_POLICY,
  ].join("\n"),
  teamId: "developer-team",
};

const ENGRAM_TOOL_BINDINGS: readonly MemoryToolBinding[] = [
  { capability: "memory.search", serverName: ENGRAM_MCP_SERVER, toolNames: ENGRAM_SEARCH_TOOLS },
  { capability: "memory.read", serverName: ENGRAM_MCP_SERVER, toolNames: ENGRAM_READ_TOOLS },
  { capability: "memory.write", serverName: ENGRAM_MCP_SERVER, toolNames: ENGRAM_WRITE_TOOLS },
];

function unsupportedEngramDiagnostic(operation: string) {
  return createAdaptiveMemoryDiagnostic(
    "ADAPTIVE_MEMORY_OPERATION_UNSUPPORTED",
    `Engram adapter operation "${operation}" is not implemented in Deck; use existing Engram MCP tool bindings instead.`,
    { severity: "info", providerId: "engram", recoverable: true },
  );
}

function createEngramAdapter(): AdaptiveMemoryAdapter {
  return {
    identity: { id: "engram", displayName: "Engram Memory (Experimental)" },
    async loadContext(_request: AdaptiveMemoryContextRequest): Promise<AdaptiveMemoryContextResult> {
      return { providerId: "engram", items: [], diagnostics: [unsupportedEngramDiagnostic("loadContext")] };
    },
    async search(_request: AdaptiveMemorySearchRequest): Promise<AdaptiveMemorySearchResult> {
      return { providerId: "engram", items: [], diagnostics: [unsupportedEngramDiagnostic("search")] };
    },
    async commit(request: AdaptiveMemoryCommitRequest): Promise<AdaptiveMemoryCommitResult> {
      return {
        savedCount: 0,
        discardedCount: request.candidates.length,
        decisions: request.candidates.map((candidate) => ({
          accepted: false,
          scope: candidate.scope.scope,
          source: candidate.metadata.source,
          reason: "Engram common-contract commit is a safe no-op; no migration or automatic write path is provided.",
        })),
        diagnostics: [unsupportedEngramDiagnostic("commit")],
      };
    },
    async configure(_request: AdaptiveMemoryConfigureRequest): Promise<void> {},
    async health(): Promise<AdaptiveMemoryHealthResult> {
      return {
        providerId: "engram",
        status: "unknown",
        diagnostics: [createAdaptiveMemoryDiagnostic(
          "ADAPTIVE_MEMORY_HEALTH_UNKNOWN",
          "Engram runtime health is not validated by Deck; existing MCP tool bindings are preserved.",
          { severity: "warning", providerId: "engram", recoverable: true },
        )],
      };
    },
  };
}

export function createEngramMemoryProvider(): AdaptiveMemoryProvider {
  const adapter = createEngramAdapter();
  return {
    id: "engram",
    displayName: "Engram Memory (Experimental)",
    adapter,
    health: () => adapter.health(),
    buildInjection(context: AdaptiveMemoryBuildContext): MemoryInjectionBundle {
      const fragments = [ENGRAM_SESSION_INSTRUCTION, ENGRAM_AGENT_INSTRUCTION, ENGRAM_SKILL_INSTRUCTION];
      const contextTeamId = context.teamId;
      const filteredFragments = contextTeamId
        ? fragments.filter((f) => f.teamId === undefined || f.teamId === contextTeamId)
        : fragments;
      return { instructions: filteredFragments, toolBindings: ENGRAM_TOOL_BINDINGS };
    },
  };
}

export type {
  AdaptiveMemoryProvider,
  AdaptiveMemoryBuildContext,
  MemoryInjectionBundle,
  MemoryInstructionFragment,
  MemoryToolBinding,
};

/**
 * Provider metadata for CLI registration.
 * The CLI composition root uses this to discover and register available memory providers.
 */
export const ENGRAM_MEMORY_PROVIDER_ID = "engram";
export const ENGRAM_MEMORY_PROVIDER_METADATA = {
  id: ENGRAM_MEMORY_PROVIDER_ID,
  displayName: "Engram Memory (Experimental)",
  description: "Experimental persistent memory provider with session search and write capabilities.",
} as const;
