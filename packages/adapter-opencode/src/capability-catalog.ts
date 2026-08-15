/**
 * User-facing capability IDs for the OpenCode runner dashboard.
 * These map to canonical capability IDs in the Core registry.
 */
export type OpenCodeCapabilityId = "rtk" | "context-mode" | "codebase-memory" | "context7" | "opencode-mermaid" | "serena" | "web-search";

import {
  TAVILY_IMPLEMENTATION_ID,
  TAVILY_MCP_SERVER_ID,
} from "@deck/provider-tavily";

export type OpenCodeRunnerScope = "opencode" | "all";

export type OpenCodeCapabilityStatus = "ready" | "missing" | "manual" | "pending" | "blocked" | "disabled" | "unsupported" | "enabled-unconfigured" | "configured-but-not-materialized";

export type OpenCodeCapabilityInstallKind =
  | "opencode-plugin" // OpenCode plugin (in-process) added to plugin array in opencode.json
  | "external" // Manual install required from external source
  | "pending" // Install pending / not yet determined
  | "mcp-server" // MCP server configured via mcp array in opencode.json
  | "npm-package" // npm global package via `npm install -g`
  | "npm-package-plus-mcp" // npm global package + MCP server configuration
  | "shell-script" // Binary installed via shell script (curl -fsSL <url> | sh)
  | "shell-script-plus-mcp" // Shell script + MCP server configuration (e.g., rtk)
  | "serena-agent"; // Serena package installed through the Core-controlled uv flow

/** Canonical capability ID from Core registry - maps to runner-capability-registry.ts */
export type CanonicalCapabilityId =
  | "rtk"
  | "context-mode"
  | "codebase-memory"
  | "codebase-memory-mcp"
  | "context7"
  | "opencode-mermaid"
  | "pi-mermaid"
  | "serena"
  | "supermemory-tool-bindings"
  | "pi-orchestrator-prompt-persistence"
   | "opencode-primary-orchestrator"
   | "deck-setup"
   | "web-search";

export type OpenCodeCapabilityToolMapping = {
  capabilityId: OpenCodeCapabilityId;
  /** Canonical capability ID from Core registry - used for registry validation */
  canonicalCapabilityId?: CanonicalCapabilityId;
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
  implementationId?: string;
  /** When true, this capability is internal and must not appear in user-facing selectors. */
  isInternal?: boolean;
};

// ---------------------------------------------------------------------------
// Full catalog
// ---------------------------------------------------------------------------

const FULL_OPENCODE_CAPABILITY_CATALOG: Record<OpenCodeCapabilityId, OpenCodeCapabilityToolMapping> = {
  "context-mode": {
    capabilityId: "context-mode",
    canonicalCapabilityId: "context-mode",
    label: "context-mode",
    description: "Context-mode MCP server for context window optimization and knowledge base.",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "context-mode",
    source: "context-mode",
    installKind: "npm-package-plus-mcp",
    detector: { commands: ["context-mode"], mcpServerNames: ["context-mode"] },
  },
  "codebase-memory": {
    capabilityId: "codebase-memory",
    canonicalCapabilityId: "codebase-memory",
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
    canonicalCapabilityId: "rtk",
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
    canonicalCapabilityId: "serena",
    label: "Serena",
    description: "Semantic code retrieval, editing and refactoring through Serena.",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "serena",
    source: "serena-agent",
    installKind: "serena-agent",
    detector: { commands: ["serena"], mcpServerNames: ["serena"] },
  },
  context7: {
    capabilityId: "context7",
    canonicalCapabilityId: "context7",
    label: "Context7",
    description: "Context7 MCP server for enhanced context retrieval and management.",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "context7",
    source: "@upstash/context7-mcp",
    installKind: "mcp-server",
    detector: { mcpServerNames: ["context7"] },
  },
  "web-search": {
    capabilityId: "web-search",
    canonicalCapabilityId: "web-search",
    label: "Web Search",
    description: "Optional compact web search and point extraction through native MCP configuration.",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "web-search",
    source: TAVILY_IMPLEMENTATION_ID,
    implementationId: TAVILY_IMPLEMENTATION_ID,
    installKind: "mcp-server",
    detector: { commands: ["npx"], mcpServerNames: [TAVILY_MCP_SERVER_ID] },
  },
  "opencode-mermaid": {
    capabilityId: "opencode-mermaid",
    canonicalCapabilityId: "opencode-mermaid",
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
  "web-search": FULL_OPENCODE_CAPABILITY_CATALOG["web-search"] as OpenCodeCapabilityToolMapping,
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

// ---------------------------------------------------------------------------
// Registry Validation
// ---------------------------------------------------------------------------

import {
  defineRunnerCapabilityContribution,
  getCanonicalCapability,
  getRunnerCapabilityMapping,
  type RunnerCapabilityMapping,
} from "@deck/core";

/**
 * Validates that all OpenCode catalog entries have a corresponding canonical capability mapping.
 * Returns an array of warnings for entries that don't map to the registry.
 */
export function validateOpenCodeCatalogAgainstRegistry(): readonly string[] {
  const warnings: string[] = [];

  for (const [id, entry] of Object.entries(FULL_OPENCODE_CAPABILITY_CATALOG) as [OpenCodeCapabilityId, OpenCodeCapabilityToolMapping][]) {
    const canonicalId = entry.canonicalCapabilityId;
    if (!canonicalId) {
      warnings.push(`OpenCode capability '${id}' has no canonicalCapabilityId defined`);
      continue;
    }

    // Check that the canonical capability exists in the registry
    const canonical = getCanonicalCapability(canonicalId, [OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION]);
    if (!canonical) {
      warnings.push(`OpenCode capability '${id}' maps to canonical '${canonicalId}' but that capability does not exist in registry`);
      continue;
    }

    // Check that there's a mapping for OpenCode runner
    const mapping = getRunnerCapabilityMapping(canonicalId, "opencode", [OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION]);
    if (!mapping) {
      warnings.push(`OpenCode capability '${id}' (canonical: ${canonicalId}) has no mapping for runner 'opencode' in registry`);
    }
  }

  return warnings;
}

/**
 * Get the canonical capability ID for an OpenCode capability.
 * Returns undefined if no mapping exists.
 */
export function getCanonicalCapabilityId(capabilityId: OpenCodeCapabilityId): CanonicalCapabilityId | undefined {
  const entry = FULL_OPENCODE_CAPABILITY_CATALOG[capabilityId];
  return entry?.canonicalCapabilityId;
}

const protectedControlMappings = [
  "trusted-runner-host-bridge",
  "invocation-authorization",
  "execution-dossier",
  "controlled-effects",
  "registry-coordination",
  "bound-verification",
].map((capabilityId): RunnerCapabilityMapping => ({
  capabilityId,
  runnerId: "opencode",
  status: "supported",
  adapterSource: "@deck/adapter-opencode",
  installKind: "native-plugin-bridge",
}));

export const OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION = defineRunnerCapabilityContribution({
  runnerId: "opencode",
  capabilities: [
    { id: "opencode-primary-orchestrator", label: "OpenCode Primary Orchestrator", category: "agents", requirement: "required", userFacing: true },
    { id: "opencode-mermaid", label: "OpenCode Mermaid", category: "runner-silent-packages", requirement: "internal-required", userFacing: false },
    { id: "opencode-mermaid-renderer", label: "OpenCode Mermaid Renderer", category: "runner-silent-packages", requirement: "internal-required", userFacing: false },
    { id: "deck-model-variants", label: "Deck Model Variants", category: "runner-silent-packages", requirement: "internal-required", userFacing: false },
  ],
  mappings: [
    ...protectedControlMappings,
    { capabilityId: "code-economy", runnerId: "opencode", status: "supported", adapterSource: "@deck/adapter-opencode", installKind: "native-instruction-composition", provisionMode: "native-instruction-composition", parityChecks: ["instruction-bundle-present"] },
    { capabilityId: "context-mode", runnerId: "opencode", status: "supported", adapterSource: "opencode-mcp-config", installKind: "npm-package-plus-mcp", provisionMode: "npm-package-plus-mcp", detectors: { commands: ["context-mode"], mcpServerNames: ["context-mode"] }, parityChecks: ["binary-usable", "mcp-config-present", "instruction-bundle-present"] },
    { capabilityId: "codebase-memory", runnerId: "opencode", status: "supported", adapterSource: "codebase-memory-mcp", installKind: "shared-binary-plus-mcp", provisionMode: "shared-binary-plus-mcp", detectors: { commands: ["codebase-memory-mcp"], mcpServerNames: ["codebase-memory"] }, parityChecks: ["binary-usable", "mcp-config-present", "instruction-bundle-present"] },
    { capabilityId: "codebase-memory-mcp", runnerId: "opencode", status: "supported", adapterSource: "codebase-memory-mcp", installKind: "shared-binary-plus-mcp", provisionMode: "shared-binary-plus-mcp", detectors: { commands: ["codebase-memory-mcp"], mcpServerNames: ["codebase-memory"] }, parityChecks: ["binary-usable", "mcp-config-present"] },
    { capabilityId: "rtk", runnerId: "opencode", status: "shared", adapterSource: "rtk", installKind: "shared-binary", provisionMode: "shared-binary", detectors: { commands: ["rtk"] }, parityChecks: ["binary-usable", "no-unnecessary-reinstall"] },
    { capabilityId: "serena", runnerId: "opencode", status: "supported", adapterSource: "serena", installKind: "python-tool", provisionMode: "python-tool", detectors: { commands: ["serena"], mcpServerNames: ["serena"] }, parityChecks: ["binary-usable", "mcp-config-present", "instruction-bundle-present"] },
    { capabilityId: "context7", runnerId: "opencode", status: "supported", adapterSource: "@upstash/context7-mcp", installKind: "mcp-server", provisionMode: "mcp-server", detectors: { mcpServerNames: ["context7"] }, parityChecks: ["mcp-config-present"] },
    { capabilityId: "web-search", runnerId: "opencode", status: "supported", adapterSource: "@deck/provider-tavily", installKind: "native-mcp", provisionMode: "native-mcp", implementationId: TAVILY_IMPLEMENTATION_ID, detectors: { mcpServerNames: [TAVILY_MCP_SERVER_ID] }, parityChecks: ["mcp-config-present", "instruction-bundle-present"] },
    { capabilityId: "supermemory-tool-bindings", runnerId: "opencode", status: "supported", adapterSource: "supermemory", installKind: "mcp-server", provisionMode: "mcp-server", detectors: { mcpServerNames: ["supermemory"] }, parityChecks: ["mcp-config-present"] },
    { capabilityId: "opencode-primary-orchestrator", runnerId: "opencode", status: "supported", adapterSource: "opencode-primary-orchestrator", installKind: "opencode-plugin", provisionMode: "opencode-plugin" },
    { capabilityId: "opencode-mermaid", runnerId: "opencode", status: "runner-specific", adapterSource: "opencode-mermaid-renderer", installKind: "internal-required", provisionMode: "internal-required" },
    { capabilityId: "opencode-mermaid-renderer", runnerId: "opencode", status: "runner-specific", adapterSource: "opencode-mermaid-renderer", installKind: "internal-required", provisionMode: "internal-required" },
    { capabilityId: "deck-model-variants", runnerId: "opencode", status: "runner-specific", adapterSource: "deck-model-variants", installKind: "internal-required", provisionMode: "internal-required" },
    { capabilityId: "pi-orchestrator-prompt-persistence", runnerId: "opencode", status: "not-applicable", adapterSource: "@deck/adapter-opencode", provisionMode: "foreign-runner-capability" },
    { capabilityId: "pi-mermaid", runnerId: "opencode", status: "not-applicable", adapterSource: "@deck/adapter-opencode", provisionMode: "foreign-runner-capability" },
    { capabilityId: "pi-hud", runnerId: "opencode", status: "not-applicable", adapterSource: "@deck/adapter-opencode", provisionMode: "foreign-runner-capability" },
    { capabilityId: "deck-setup", runnerId: "opencode", status: "supported", adapterSource: "deck-setup", installKind: "npm-package", provisionMode: "npm-package" },
  ],
});

export const OPENCODE_ADAPTER_CAPABILITY_DISPOSITIONS = Object.freeze([
  { capabilityId: "opencode-mermaid-renderer", status: "runner-specific", installKind: "internal-required" },
  { capabilityId: "deck-model-variants", status: "runner-specific", installKind: "internal-required" },
  { capabilityId: "pi-hud", status: "not-applicable" },
] as const);
