/**
 * User-facing capability IDs for the OpenCode runner dashboard.
 */
export type OpenCodeCapabilityId = "rtk" | "context-mode" | "codebase-memory" | "context7" | "opencode-mermaid" | "serena";

export type OpenCodeRunnerScope = "opencode" | "all";

export type OpenCodeCapabilityStatus = "ready" | "missing" | "manual" | "pending" | "blocked";

export type OpenCodeCapabilityInstallKind =
  | "opencode-plugin" // OpenCode plugin (in-process) added to plugin array in opencode.json
  | "external" // Manual install required from external source
  | "pending" // Install pending / not yet determined
  | "mcp-server" // MCP server configured via mcp array in opencode.json
  | "npm-package" // npm global package via `npm install -g`
  | "shell-script"; // Binary installed via shell script (curl -fsSL <url> | sh)

export type OpenCodeCapabilityToolMapping = {
  capabilityId: OpenCodeCapabilityId;
  label: string;
  description: string;
  runnerScope: OpenCodeRunnerScope;
  requirementLevel: "required" | "optional" | "configurable";
  toolId?: string;
  source?: string;
  installKind: OpenCodeCapabilityInstallKind;
  detector: {
    pluginNames?: string[];
    commands?: string[];
    mcpServerNames?: string[];
    note?: string;
  };
  /** When true, this capability is internal and must not appear in user-facing selectors. */
  isInternal?: boolean;
};

// ---------------------------------------------------------------------------
// Full catalog
// ---------------------------------------------------------------------------

const FULL_OPENCODE_CAPABILITY_CATALOG: Record<OpenCodeCapabilityId, OpenCodeCapabilityToolMapping> = {
  "context-mode": {
    capabilityId: "context-mode",
    label: "context-mode",
    description: "Context-mode plugin for context window optimization and knowledge base.",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "context-mode",
    source: "context-mode",
    installKind: "opencode-plugin",
    detector: { pluginNames: ["context-mode"] },
  },
  "codebase-memory": {
    capabilityId: "codebase-memory",
    label: "codebase-memory",
    description: "Codebase memory MCP capability for code intelligence. Binary MCP server installed via shell script.",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "codebase-memory",
    source: "DeusData/codebase-memory-mcp",
    installKind: "shell-script",
    detector: { commands: ["codebase-memory-mcp"] },
  },
  rtk: {
    capabilityId: "rtk",
    label: "RTK",
    description: "RTK token optimizer for CLI commands. Installs as OpenCode plugin via rtk init.",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "rtk",
    source: "rtk-ai/rtk",
    installKind: "shell-script-plus-mcp",
    detector: { commands: ["rtk"] },
  },
  serena: {
    capabilityId: "serena",
    label: "Serena",
    description: "Semantic code retrieval, editing and refactoring via LSP. MCP server providing IDE-level symbol operations.",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "serena",
    source: "oraios/serena",
    installKind: "mcp-server",
    detector: { commands: ["serena"], mcpServerNames: ["serena"] },
  },
  context7: {
    capabilityId: "context7",
    label: "Context7",
    description: "Context7 MCP server for enhanced context retrieval and management.",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "context7",
    source: "@upstash/context7-mcp",
    installKind: "mcp-server",
    detector: { mcpServerNames: ["context7"] },
  },
  "opencode-mermaid": {
    capabilityId: "opencode-mermaid",
    label: "Mermaid",
    description: "OpenCode visual documentation capability. Renders mermaid diagrams as ASCII art.",
    runnerScope: "opencode",
    requirementLevel: "required",
    source: "opencode-mermaid-renderer",
    installKind: "pending",
    isInternal: true,
    detector: {
      note: "Internal only; detection delegates to internal-opencode-packages.ts.",
    },
  },
} as const satisfies Record<OpenCodeCapabilityId, OpenCodeCapabilityToolMapping>;

// ---------------------------------------------------------------------------
// User-facing public catalog (excludes internal entries)
// ---------------------------------------------------------------------------

export const OPENCODE_RUNNER_CAPABILITY_CATALOG: Record<
  Exclude<OpenCodeCapabilityId, "opencode-mermaid">,
  OpenCodeCapabilityToolMapping
> = {
  "context-mode": FULL_OPENCODE_CAPABILITY_CATALOG["context-mode"] as OpenCodeCapabilityToolMapping,
  "codebase-memory": FULL_OPENCODE_CAPABILITY_CATALOG["codebase-memory"] as OpenCodeCapabilityToolMapping,
  rtk: FULL_OPENCODE_CAPABILITY_CATALOG.rtk as OpenCodeCapabilityToolMapping,
  serena: FULL_OPENCODE_CAPABILITY_CATALOG.serena as OpenCodeCapabilityToolMapping,
  context7: FULL_OPENCODE_CAPABILITY_CATALOG.context7 as OpenCodeCapabilityToolMapping,
} as const satisfies Record<Exclude<OpenCodeCapabilityId, "opencode-mermaid">, OpenCodeCapabilityToolMapping>;

export const OPENCODE_RUNNER_CAPABILITY_IDS = Object.keys(OPENCODE_RUNNER_CAPABILITY_CATALOG) as Exclude<OpenCodeCapabilityId, "opencode-mermaid">[];

export const ALL_OPENCODE_RUNNER_CAPABILITY_IDS = Object.keys(FULL_OPENCODE_CAPABILITY_CATALOG) as OpenCodeCapabilityId[];

export function getOpenCodeRunnerCapability(capabilityId: OpenCodeCapabilityId): OpenCodeCapabilityToolMapping | undefined {
  return FULL_OPENCODE_CAPABILITY_CATALOG[capabilityId];
}

export function getUserFacingOpenCodeCapability(capabilityId: OpenCodeCapabilityId): OpenCodeCapabilityToolMapping | undefined {
  const entry = FULL_OPENCODE_CAPABILITY_CATALOG[capabilityId];
  if (entry && !entry.isInternal) {
    return entry;
  }
  return undefined;
}
