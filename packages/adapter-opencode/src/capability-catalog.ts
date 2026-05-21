/**
 * User-facing capability IDs for the OpenCode runner dashboard.
 */
export type OpenCodeCapabilityId = "rtk" | "context-mode" | "codebase-memory" | "opencode-mermaid";

export type OpenCodeRunnerScope = "opencode" | "all";

export type OpenCodeCapabilityStatus = "ready" | "missing" | "manual" | "pending";

export type OpenCodeCapabilityInstallKind = "opencode-plugin" | "external" | "pending";

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
    description: "Context-mode runner capability for shared execution context.",
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
    description: "Codebase memory MCP capability; separate from Adaptive Memory providers.",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "codebase-memory",
    source: "DeusData/codebase-memory-mcp",
    installKind: "external",
    detector: { pluginNames: ["codebase-memory"], commands: ["codebase-memory-mcp"] },
  },
  rtk: {
    capabilityId: "rtk",
    label: "RTK",
    description: "RTK runner capability installed and verified outside OpenCode package automation.",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "rtk",
    source: "rtk-ai/rtk",
    installKind: "external",
    detector: { pluginNames: ["rtk"], commands: ["rtk"] },
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
