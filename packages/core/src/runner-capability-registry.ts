/**
 * Runner Capability / Parity Registry
 *
 * Canonical registry of Deck capabilities with per-runner mappings.
 * Provides source of truth for parity checks between OpenCode, Pi, and future runners.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Canonical capability categories in Deck */
export type CanonicalCapabilityCategory =
  | "agents"
  | "skills"
  | "mcps"
  | "packages"
  | "shared-binaries"
  | "runner-silent-packages"
  | "prompts-profiles"
  | "memory-tool-bindings";

/** Support status for a capability in a specific runner */
export type RunnerCapabilitySupportStatus =
  | "supported"
  | "runner-specific"
  | "shared"
  | "manual-verified"
  | "gap"
  | "blocked"
  | "not-applicable";

/** Instruction bundle IDs that can be associated with capabilities */
export type InstructionBundleId =
  | "adaptive-memory"
  | "codebase-memory"
  | "context-mode"
  | "rtk"
  | "serena";

/** Surfaces where a capability may be required */
export type CapabilitySurface = "agent" | "skill" | "session" | "mcp" | "install" | "prompt-profile";

/** Shared binary configuration for a capability */
export type SharedBinaryConfig = {
  command: string;
  usabilityCheck: readonly string[];
  mcpServerName?: string;
};

/** A canonical Deck capability definition */
export type CanonicalRunnerCapability = {
  id: string;
  label: string;
  category: CanonicalCapabilityCategory;
  requirement: "required" | "configurable" | "optional" | "internal-required";
  userFacing: boolean;
  instructionBundleId?: InstructionBundleId;
  requiredSurfaces?: readonly CapabilitySurface[];
  sharedBinary?: SharedBinaryConfig;
};

/** A mapping of a capability to a specific runner */
export type RunnerCapabilityMapping = {
  capabilityId: string;
  runnerId: string;
  status: RunnerCapabilitySupportStatus;
  adapterSource?: string;
  installKind?: string;
  implementationId?: string;
  configTargets?: readonly string[];
  detectors?: {
    commands?: readonly string[];
    mcpServerNames?: readonly string[];
    packages?: readonly string[];
  };
  parityChecks?: readonly (
    | "binary-usable"
    | "mcp-config-present"
    | "no-unnecessary-reinstall"
    | "instruction-bundle-present"
  )[];
  notes?: string;
};

// ---------------------------------------------------------------------------
// Helper Types for runtime hints
// ---------------------------------------------------------------------------

/** Runtime hints for parity resolution - provided by adapter inventory */
export type ParityRuntimeHints = {
  binariesInPath?: readonly string[];
  mcpServersConfigured?: readonly string[];
  packagesInstalled?: readonly string[];
  projectIndexVerified?: boolean;
  supermemoryConfigured?: boolean;
  profilePromptPath?: string;
  // Additional hints for specific scenarios
  authenticatedRuntimeValidated?: boolean;
  codebaseMemoryIndexed?: boolean;
  unusableBinaries?: readonly string[];
};

// ---------------------------------------------------------------------------
// Canonical Capability Catalog
// ---------------------------------------------------------------------------

const CANONICAL_RUNNER_CAPABILITIES: readonly CanonicalRunnerCapability[] = [
  // Shared binaries with MCP integration
  {
    id: "context-mode",
    label: "Context Mode",
    category: "shared-binaries",
    requirement: "configurable",
    userFacing: true,
    instructionBundleId: "context-mode",
    requiredSurfaces: ["install", "mcp", "session"],
    sharedBinary: {
      command: "context-mode",
      usabilityCheck: ["--version", "--help"],
      mcpServerName: "context-mode",
    },
  },
  {
    id: "codebase-memory",
    label: "Codebase Memory",
    category: "shared-binaries",
    requirement: "configurable",
    userFacing: true,
    instructionBundleId: "codebase-memory",
    requiredSurfaces: ["install", "mcp", "session"],
  },
  {
    id: "codebase-memory-mcp",
    label: "Codebase Memory MCP",
    category: "mcps",
    requirement: "configurable",
    userFacing: true,
    instructionBundleId: "codebase-memory",
    requiredSurfaces: ["install", "mcp"],
    sharedBinary: {
      command: "codebase-memory-mcp",
      usabilityCheck: ["--version", "--help"],
      mcpServerName: "codebase-memory",
    },
  },
  {
    id: "rtk",
    label: "RTK (Token Killer)",
    category: "shared-binaries",
    requirement: "optional",
    userFacing: true,
    instructionBundleId: "rtk",
    requiredSurfaces: ["install", "session"],
    sharedBinary: {
      command: "rtk",
      usabilityCheck: ["--help"],
    },
  },
  // MCP servers
  {
    id: "serena",
    label: "Serena",
    category: "mcps",
    requirement: "configurable",
    userFacing: true,
    instructionBundleId: "serena",
    requiredSurfaces: ["install", "mcp", "session"],
    sharedBinary: {
      command: "serena",
      usabilityCheck: ["--version", "--help"],
      mcpServerName: "serena",
    },
  },
  {
    id: "context7",
    label: "Context7",
    category: "mcps",
    requirement: "configurable",
    userFacing: true,
    requiredSurfaces: ["install", "mcp"],
  },
  {
    id: "supermemory-tool-bindings",
    label: "Supermemory Tool Bindings",
    category: "memory-tool-bindings",
    requirement: "configurable",
    userFacing: true,
    instructionBundleId: "adaptive-memory",
    requiredSurfaces: ["mcp", "session"],
  },
  // Prompts and profiles
  {
    id: "pi-orchestrator-prompt-persistence",
    label: "Orchestrator Prompt Persistence",
    category: "prompts-profiles",
    requirement: "required",
    userFacing: false,
    requiredSurfaces: ["prompt-profile"],
  },
  {
    id: "opencode-primary-orchestrator",
    label: "OpenCode Primary Orchestrator",
    category: "agents",
    requirement: "required",
    userFacing: true,
  },
  // Runner-specific silent packages
  {
    id: "opencode-mermaid",
    label: "OpenCode Mermaid",
    category: "runner-silent-packages",
    requirement: "internal-required",
    userFacing: false,
  },
  {
    id: "pi-mermaid",
    label: "Pi Mermaid",
    category: "runner-silent-packages",
    requirement: "internal-required",
    userFacing: false,
  },
  {
    id: "deck-init",
    label: "Deck Init",
    category: "skills",
    requirement: "configurable",
    userFacing: true,
  },
];

/**
 * Get all canonical Deck capabilities
 */
export function getCanonicalRunnerCapabilities(): readonly CanonicalRunnerCapability[] {
  return CANONICAL_RUNNER_CAPABILITIES;
}

/**
 * Get a specific capability by ID
 */
export function getCanonicalCapability(id: string): CanonicalRunnerCapability | undefined {
  return CANONICAL_RUNNER_CAPABILITIES.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// Per-Runner Mappings
// ---------------------------------------------------------------------------

const RUNNER_CAPABILITY_MAPPINGS: readonly RunnerCapabilityMapping[] = [
  // OpenCode mappings
  {
    capabilityId: "context-mode",
    runnerId: "opencode",
    status: "supported",
    adapterSource: "opencode-mcp-config",
    installKind: "npm-package-plus-mcp",
    detectors: {
      commands: ["context-mode"],
      mcpServerNames: ["context-mode"],
    },
    parityChecks: ["binary-usable", "mcp-config-present", "instruction-bundle-present"],
  },
  {
    capabilityId: "codebase-memory",
    runnerId: "opencode",
    status: "supported",
    adapterSource: "codebase-memory-mcp",
    installKind: "shared-binary-plus-mcp",
    detectors: {
      commands: ["codebase-memory-mcp"],
      mcpServerNames: ["codebase-memory"],
    },
    parityChecks: ["binary-usable", "mcp-config-present", "instruction-bundle-present"],
  },
  {
    capabilityId: "codebase-memory-mcp",
    runnerId: "opencode",
    status: "supported",
    adapterSource: "codebase-memory-mcp",
    installKind: "shared-binary-plus-mcp",
    detectors: {
      commands: ["codebase-memory-mcp"],
      mcpServerNames: ["codebase-memory"],
    },
    parityChecks: ["binary-usable", "mcp-config-present"],
  },
  {
    capabilityId: "rtk",
    runnerId: "opencode",
    status: "shared",
    adapterSource: "rtk",
    installKind: "shared-binary",
    detectors: {
      commands: ["rtk"],
    },
    parityChecks: ["binary-usable", "no-unnecessary-reinstall"],
    notes: "RTK via Bash hook in OpenCode",
  },
  {
    capabilityId: "serena",
    runnerId: "opencode",
    status: "supported",
    adapterSource: "serena",
    installKind: "python-tool",
    detectors: {
      commands: ["serena"],
      mcpServerNames: ["serena"],
    },
    parityChecks: ["binary-usable", "mcp-config-present", "instruction-bundle-present"],
  },
  {
    capabilityId: "context7",
    runnerId: "opencode",
    status: "supported",
    adapterSource: "@upstash/context7-mcp",
    installKind: "mcp-server",
    detectors: {
      mcpServerNames: ["context7"],
    },
    parityChecks: ["mcp-config-present"],
  },
  {
    capabilityId: "supermemory-tool-bindings",
    runnerId: "opencode",
    status: "supported",
    adapterSource: "supermemory",
    installKind: "mcp-server",
    detectors: {
      mcpServerNames: ["supermemory"],
    },
    parityChecks: ["mcp-config-present"],
    notes: "No extra runtime gate required",
  },
  {
    capabilityId: "opencode-primary-orchestrator",
    runnerId: "opencode",
    status: "supported",
    installKind: "opencode-plugin",
  },
  {
    capabilityId: "opencode-mermaid",
    runnerId: "opencode",
    status: "runner-specific",
    notes: "OpenCode Mermaid renderer - internal runner-specific package",
  },
  {
    capabilityId: "deck-init",
    runnerId: "opencode",
    status: "supported",
    adapterSource: "deck-init",
    installKind: "npm-package",
    notes: "Deck init is bundled with OpenCode",
  },
  {
    capabilityId: "deck-init",
    runnerId: "pi",
    status: "supported",
    adapterSource: "deck-init",
    installKind: "npm-package",
    notes: "Deck init available via npm",
  },
  // Pi mappings
  {
    capabilityId: "context-mode",
    runnerId: "pi",
    status: "shared",
    adapterSource: "context-mode",
    installKind: "shared-binary-plus-mcp",
    detectors: {
      commands: ["context-mode"],
      mcpServerNames: ["context-mode"],
    },
    parityChecks: ["binary-usable", "mcp-config-present", "no-unnecessary-reinstall"],
    notes: "Shared binary plus local MCP config in ~/.pi/agent/mcp.json",
  },
  {
    capabilityId: "codebase-memory",
    runnerId: "pi",
    status: "shared",
    adapterSource: "codebase-memory-mcp",
    installKind: "shared-binary-plus-mcp",
    detectors: {
      commands: ["codebase-memory-mcp"],
      mcpServerNames: ["codebase-memory"],
    },
    parityChecks: ["binary-usable", "mcp-config-present", "no-unnecessary-reinstall"],
    notes: "Shared binary plus local MCP config - parity with OpenCode",
  },
  {
    capabilityId: "codebase-memory-mcp",
    runnerId: "pi",
    status: "shared",
    adapterSource: "codebase-memory-mcp",
    installKind: "shared-binary-plus-mcp",
    detectors: {
      commands: ["codebase-memory-mcp"],
      mcpServerNames: ["codebase-memory"],
    },
    parityChecks: ["binary-usable", "mcp-config-present"],
    notes: "Codebase-memory MCP local with shared binary",
  },
  {
    capabilityId: "rtk",
    runnerId: "pi",
    status: "shared",
    adapterSource: "rtk",
    installKind: "shared-binary",
    detectors: {
      commands: ["rtk"],
    },
    parityChecks: ["binary-usable", "no-unnecessary-reinstall"],
    notes: "Shared binary reuse - no reinstall if usable",
  },
  {
    capabilityId: "serena",
    runnerId: "pi",
    status: "shared",
    adapterSource: "serena",
    installKind: "python-tool",
    detectors: {
      commands: ["serena"],
      mcpServerNames: ["serena"],
    },
    parityChecks: ["binary-usable", "mcp-config-present", "instruction-bundle-present"],
    notes: "Serena mandatory for Pi parity - requires python-tool install with uv/pipx fallback to manual-verified. Implementation: uv/pipx + manual-verified fallback; runtime hint detects binary.",
  },
  {
    capabilityId: "context7",
    runnerId: "pi",
    status: "shared",
    adapterSource: "@upstash/context7-mcp",
    installKind: "npm-package-plus-mcp",
    detectors: {
      mcpServerNames: ["context7"],
    },
    parityChecks: ["mcp-config-present"],
    notes: "Standard @upstash/context7-mcp preferred; wrapper @dreki-gg/pi-context7 as fallback if blocked. Runtime hint detects MCP server entry.",
  },
  {
    capabilityId: "supermemory-tool-bindings",
    runnerId: "pi",
    status: "shared",
    adapterSource: "supermemory",
    installKind: "mcp-server",
    detectors: {
      mcpServerNames: ["supermemory"],
    },
    parityChecks: ["mcp-config-present"],
    notes: "No Pi-only runtime gate (authenticatedRuntimeValidated removed). Gate removed; runtime hint validates MCP config structurally.",
  },
  {
    capabilityId: "pi-orchestrator-prompt-persistence",
    runnerId: "pi",
    status: "supported",
    adapterSource: "pi-team-profile",
    installKind: "manual",
    parityChecks: ["instruction-bundle-present"],
    notes: "Profile system prompt as source of truth + --system-prompt launch",
  },
  {
    capabilityId: "pi-mermaid",
    runnerId: "pi",
    status: "runner-specific",
    notes: "Pi Mermaid - internal runner-specific package",
  },
];

/**
 * Get all mappings for a specific runner
 */
export function getRunnerMappings(runnerId: string): readonly RunnerCapabilityMapping[] {
  return RUNNER_CAPABILITY_MAPPINGS.filter((m) => m.runnerId === runnerId);
}

/**
 * Get a specific capability mapping for a runner
 */
export function getRunnerCapabilityMapping(
  capabilityId: string,
  runnerId: string
): RunnerCapabilityMapping | undefined {
  return RUNNER_CAPABILITY_MAPPINGS.find(
    (m) => m.capabilityId === capabilityId && m.runnerId === runnerId
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CANONICAL_CATEGORIES: readonly CanonicalCapabilityCategory[] = [
  "agents",
  "skills",
  "mcps",
  "packages",
  "shared-binaries",
  "runner-silent-packages",
  "prompts-profiles",
  "memory-tool-bindings",
];

export const SUPPORT_STATUSES: readonly RunnerCapabilitySupportStatus[] = [
  "supported",
  "runner-specific",
  "shared",
  "manual-verified",
  "gap",
  "blocked",
  "not-applicable",
];
