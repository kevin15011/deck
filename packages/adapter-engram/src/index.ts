import type {
  AdaptiveMemoryProvider,
  AdaptiveMemoryBuildContext,
  MemoryInjectionBundle,
  MemoryInstructionFragment,
  MemoryToolBinding,
} from "@deck/core/memory/adaptive-memory";

// ---------------------------------------------------------------------------
// Engram Memory Provider — EXPERIMENTAL
// ---------------------------------------------------------------------------

/**
 * ⚠️ EXPERIMENTAL: The Engram memory provider is experimental.
 *
 * Engram MCP tool names have NOT been validated against the Engram runtime.
 * The `--memory=engram` flag and this provider are provided for evaluation only.
 * Tool bindings may change once the actual Engram MCP server contract is confirmed.
 * Do not rely on these tool names in production configurations.
 */

// ---------------------------------------------------------------------------
// Engram MCP Tool Names
// ---------------------------------------------------------------------------

/**
 * Engram MCP tool names for memory operations.
 *
 * These names use the `memory_*` prefix convention and have NOT been validated
 * against the Engram MCP server runtime. Only the `memory_*` names are included;
 * generic aliases (such as "read", "write", "search") are intentionally excluded
 * to avoid collisions with built-in runtime tools.
 *
 * TODO: Validate exact tool names against the Engram MCP server runtime and
 * update these bindings accordingly. Once validated, remove the EXPERIMENTAL
 * marker from the provider.
 */
const ENGRAM_MCP_SERVER = "engram";
const ENGRAM_SEARCH_TOOLS = ["memory_search"] as const;
const ENGRAM_READ_TOOLS = ["memory_read"] as const;
const ENGRAM_WRITE_TOOLS = ["memory_write"] as const;

// ---------------------------------------------------------------------------
// Memory Safety Policy
// ---------------------------------------------------------------------------

/**
 * Shared memory safety guidance appended to every Engram instruction fragment.
 *
 * REQ-ENG-002 / REQ-OSA-001: Memory is auxiliary; OpenSpec remains authoritative.
 * Safety: Never store secrets, credentials, tokens, private keys, or PII/raw
 * customer data in external memory. Prefer redacted summaries.
 */
const MEMORY_SAFETY_POLICY = [
  "**Memory Safety**: Never store secrets, API keys, credentials, tokens,",
  "private keys, raw customer/PII data, or other sensitive information in",
  "Engram. Store only redacted summaries and non-sensitive context. When in",
  "doubt, omit or redact before storing.",
].join("\n");

// ---------------------------------------------------------------------------
// Engram Instruction Fragments
// ---------------------------------------------------------------------------

/**
 * Session-level instruction for Engram memory.
 */
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
    MEMORY_SAFETY_POLICY,
  ].join("\n"),
  teamId: "developer-team",
};

/**
 * Agent-level instruction for Engram memory.
 */
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
    MEMORY_SAFETY_POLICY,
  ].join("\n"),
  teamId: "developer-team",
};

/**
 * Skill-level instruction for Engram memory.
 */
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
    MEMORY_SAFETY_POLICY,
  ].join("\n"),
  teamId: "developer-team",
};

/**
 * Tool bindings mapping neutral capabilities to Engram MCP tool names.
 *
 * Only `memory_*` prefixed names are used. Generic tool name aliases
 * (e.g. "read", "write", "search") are intentionally excluded to avoid
 * collisions with built-in runtime tools.
 */
const ENGRAM_TOOL_BINDINGS: readonly MemoryToolBinding[] = [
  {
    capability: "memory.search",
    serverName: ENGRAM_MCP_SERVER,
    toolNames: ENGRAM_SEARCH_TOOLS,
  },
  {
    capability: "memory.read",
    serverName: ENGRAM_MCP_SERVER,
    toolNames: ENGRAM_READ_TOOLS,
  },
  {
    capability: "memory.write",
    serverName: ENGRAM_MCP_SERVER,
    toolNames: ENGRAM_WRITE_TOOLS,
  },
];

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

/**
 * Creates an Engram memory provider implementing the AdaptiveMemoryProvider contract.
 *
 * This is the only package that holds Engram-specific names and instructions.
 * Core Developer Team prompts remain provider-neutral (REQ-DTC-001).
 *
 * EXPERIMENTAL: The provider and its tool bindings have not been validated
 * against the Engram MCP server runtime. Use `--memory=engram` for evaluation
 * only; tool names may change once the Engram server contract is confirmed.
 */
export function createEngramMemoryProvider(): AdaptiveMemoryProvider {
  return {
    id: "engram",
    displayName: "Engram Memory (Experimental)",

    buildInjection(context: AdaptiveMemoryBuildContext): MemoryInjectionBundle {
      const fragments: MemoryInstructionFragment[] = [
        ENGRAM_SESSION_INSTRUCTION,
        ENGRAM_AGENT_INSTRUCTION,
        ENGRAM_SKILL_INSTRUCTION,
      ];

      // Filter by team ID if specified — note this uses the context teamId,
      // not a hardcoded value, so future teams can also receive fragments.
      const contextTeamId = context.teamId;
      const filteredFragments = contextTeamId
        ? fragments.filter((f) => f.teamId === undefined || f.teamId === contextTeamId)
        : fragments;

      return {
        instructions: filteredFragments,
        toolBindings: ENGRAM_TOOL_BINDINGS,
      };
    },
  };
}

// Re-export types for consumer convenience
export type {
  AdaptiveMemoryProvider,
  AdaptiveMemoryBuildContext,
  MemoryInjectionBundle,
  MemoryInstructionFragment,
  MemoryToolBinding,
};