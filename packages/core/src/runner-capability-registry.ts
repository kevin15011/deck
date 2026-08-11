/** Runner-neutral capability contracts and immutable adapter contribution composition. */

export type CanonicalCapabilityCategory =
  | "agents"
  | "skills"
  | "mcps"
  | "packages"
  | "shared-binaries"
  | "runner-silent-packages"
  | "prompts-profiles"
  | "memory-tool-bindings"
  | "execution-controls";

export type RunnerCapabilitySupportStatus =
  | "supported"
  | "runner-specific"
  | "shared"
  | "manual-verified"
  | "gap"
  | "blocked"
  | "unsupported"
  | "not-applicable";

export type InstructionBundleId = "adaptive-memory" | "codebase-memory" | "context-mode" | "rtk" | "serena" | "web-search";
export type CapabilitySurface = "agent" | "skill" | "session" | "mcp" | "install" | "prompt-profile";

export type SharedBinaryConfig = {
  command: string;
  usabilityCheck: readonly string[];
  mcpServerName?: string;
};

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

export type RunnerCapabilityMapping = {
  capabilityId: string;
  runnerId: string;
  status: RunnerCapabilitySupportStatus;
  adapterSource?: string;
  installKind?: string;
  provisionMode?: string;
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

export type RunnerCapabilityContribution = Readonly<{
  runnerId: string;
  capabilities?: readonly CanonicalRunnerCapability[];
  mappings: readonly RunnerCapabilityMapping[];
}>;

export type RunnerCapabilityCompositionErrorCode =
  | "mapping-runner-mismatch"
  | "duplicate-runner-capability-mapping"
  | "duplicate-capability-definition";

export class RunnerCapabilityCompositionError extends Error {
  constructor(
    readonly code: RunnerCapabilityCompositionErrorCode,
    readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = "RunnerCapabilityCompositionError";
  }
}

export type ParityRuntimeHints = {
  binariesInPath?: readonly string[];
  mcpServersConfigured?: readonly string[];
  packagesInstalled?: readonly string[];
  projectIndexVerified?: boolean;
  supermemoryConfigured?: boolean;
  profilePromptPath?: string;
  authenticatedRuntimeValidated?: boolean;
  codebaseMemoryIndexed?: boolean;
  unusableBinaries?: readonly string[];
  /** Boolean-only readiness evidence for the optional semantic Web Search capability. */
  webSearch?: import("./web-search-capability").WebSearchReadinessEvidence;
};

const CORE_CAPABILITIES: readonly CanonicalRunnerCapability[] = Object.freeze([
  {
    id: "context-mode",
    label: "Context Mode",
    category: "shared-binaries",
    requirement: "configurable",
    userFacing: true,
    instructionBundleId: "context-mode",
    requiredSurfaces: ["install", "mcp", "session"],
    sharedBinary: { command: "context-mode", usabilityCheck: ["--version", "--help"], mcpServerName: "context-mode" },
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
    sharedBinary: { command: "codebase-memory-mcp", usabilityCheck: ["--version", "--help"], mcpServerName: "codebase-memory" },
  },
  {
    id: "rtk",
    label: "RTK (Token Killer)",
    category: "shared-binaries",
    requirement: "optional",
    userFacing: true,
    instructionBundleId: "rtk",
    requiredSurfaces: ["install", "session"],
    sharedBinary: { command: "rtk", usabilityCheck: ["--help"] },
  },
  {
    id: "serena",
    label: "Serena",
    category: "mcps",
    requirement: "configurable",
    userFacing: true,
    instructionBundleId: "serena",
    requiredSurfaces: ["install", "mcp", "session"],
    sharedBinary: { command: "serena", usabilityCheck: ["--version", "--help"], mcpServerName: "serena" },
  },
  {
    id: "web-search",
    label: "Web Search",
    category: "mcps",
    requirement: "optional",
    userFacing: true,
    instructionBundleId: "web-search",
    requiredSurfaces: ["agent", "skill", "session", "mcp", "install"],
  },
  { id: "context7", label: "Context7", category: "mcps", requirement: "configurable", userFacing: true, requiredSurfaces: ["install", "mcp"] },
  {
    id: "supermemory-tool-bindings",
    label: "Supermemory Tool Bindings",
    category: "memory-tool-bindings",
    requirement: "configurable",
    userFacing: true,
    instructionBundleId: "adaptive-memory",
    requiredSurfaces: ["mcp", "session"],
  },
  { id: "code-economy", label: "Code Economy", category: "packages", requirement: "required", userFacing: true, requiredSurfaces: ["agent", "skill", "session"] },
  { id: "trusted-runner-host-bridge", label: "Trusted Runner Host Bridge", category: "execution-controls", requirement: "required", userFacing: false },
  { id: "invocation-authorization", label: "Invocation Authorization", category: "execution-controls", requirement: "required", userFacing: false },
  { id: "execution-dossier", label: "Execution Dossier", category: "execution-controls", requirement: "required", userFacing: false },
  { id: "controlled-effects", label: "Controlled Effects", category: "execution-controls", requirement: "required", userFacing: false },
  { id: "registry-coordination", label: "Registry Coordination", category: "execution-controls", requirement: "required", userFacing: false },
  { id: "bound-verification", label: "Bound Verification", category: "execution-controls", requirement: "required", userFacing: false },
  { id: "deck-setup", label: "Deck Setup", category: "agents", requirement: "configurable", userFacing: true },
]);

const freezeCapability = (capability: CanonicalRunnerCapability): CanonicalRunnerCapability => Object.freeze({
  ...capability,
  ...(capability.requiredSurfaces ? { requiredSurfaces: Object.freeze([...capability.requiredSurfaces]) } : {}),
  ...(capability.sharedBinary ? {
    sharedBinary: Object.freeze({ ...capability.sharedBinary, usabilityCheck: Object.freeze([...capability.sharedBinary.usabilityCheck]) }),
  } : {}),
});

const freezeMapping = (mapping: RunnerCapabilityMapping): RunnerCapabilityMapping => Object.freeze({
  ...mapping,
  ...(mapping.configTargets ? { configTargets: Object.freeze([...mapping.configTargets]) } : {}),
  ...(mapping.detectors ? {
    detectors: Object.freeze({
      ...(mapping.detectors.commands ? { commands: Object.freeze([...mapping.detectors.commands]) } : {}),
      ...(mapping.detectors.mcpServerNames ? { mcpServerNames: Object.freeze([...mapping.detectors.mcpServerNames]) } : {}),
      ...(mapping.detectors.packages ? { packages: Object.freeze([...mapping.detectors.packages]) } : {}),
    }),
  } : {}),
  ...(mapping.parityChecks ? { parityChecks: Object.freeze([...mapping.parityChecks]) } : {}),
});

export function defineRunnerCapabilityContribution(contribution: RunnerCapabilityContribution): RunnerCapabilityContribution {
  const mappingKeys = new Set<string>();
  for (const mapping of contribution.mappings) {
    if (mapping.runnerId !== contribution.runnerId) {
      throw new RunnerCapabilityCompositionError(
        "mapping-runner-mismatch",
        `${mapping.runnerId}:${mapping.capabilityId}`,
        `Capability mapping ${mapping.capabilityId} belongs to ${mapping.runnerId}, not ${contribution.runnerId}.`,
      );
    }
    const key = `${mapping.runnerId}:${mapping.capabilityId}`;
    if (mappingKeys.has(key)) {
      throw new RunnerCapabilityCompositionError("duplicate-runner-capability-mapping", key, `Duplicate capability mapping: ${key}.`);
    }
    mappingKeys.add(key);
  }
  const capabilityIds = new Set<string>();
  for (const capability of contribution.capabilities ?? []) {
    if (capabilityIds.has(capability.id)) {
      throw new RunnerCapabilityCompositionError("duplicate-capability-definition", capability.id, `Duplicate capability definition: ${capability.id}.`);
    }
    capabilityIds.add(capability.id);
  }
  return Object.freeze({
    runnerId: contribution.runnerId,
    capabilities: Object.freeze((contribution.capabilities ?? []).map(freezeCapability)),
    mappings: Object.freeze(contribution.mappings.map(freezeMapping)),
  });
}

type ComposedCapabilities = Readonly<{
  capabilities: readonly CanonicalRunnerCapability[];
  mappings: readonly RunnerCapabilityMapping[];
}>;

export function composeRunnerCapabilityContributions(
  contributions: readonly RunnerCapabilityContribution[] = [],
): ComposedCapabilities {
  const capabilities = new Map(CORE_CAPABILITIES.map((capability) => [capability.id, capability]));
  const mappings = new Map<string, RunnerCapabilityMapping>();
  for (const contribution of contributions) {
    for (const capability of contribution.capabilities ?? []) {
      if (capabilities.has(capability.id)) {
        throw new RunnerCapabilityCompositionError("duplicate-capability-definition", capability.id, `Duplicate capability definition: ${capability.id}.`);
      }
      capabilities.set(capability.id, capability);
    }
    for (const mapping of contribution.mappings) {
      const key = `${mapping.runnerId}:${mapping.capabilityId}`;
      if (mappings.has(key)) {
        throw new RunnerCapabilityCompositionError("duplicate-runner-capability-mapping", key, `Duplicate capability mapping: ${key}.`);
      }
      mappings.set(key, mapping);
    }
  }
  return Object.freeze({
    capabilities: Object.freeze([...capabilities.values()].sort((left, right) => left.id.localeCompare(right.id))),
    mappings: Object.freeze([...mappings.values()].sort((left, right) => `${left.runnerId}:${left.capabilityId}`.localeCompare(`${right.runnerId}:${right.capabilityId}`))),
  });
}

export function getCanonicalRunnerCapabilities(
  contributions: readonly RunnerCapabilityContribution[] = [],
): readonly CanonicalRunnerCapability[] {
  return composeRunnerCapabilityContributions(contributions).capabilities;
}

export function getCanonicalCapability(
  id: string,
  contributions: readonly RunnerCapabilityContribution[] = [],
): CanonicalRunnerCapability | undefined {
  return getCanonicalRunnerCapabilities(contributions).find((capability) => capability.id === id);
}

export function getRunnerMappings(
  runnerId: string,
  contributions: readonly RunnerCapabilityContribution[] = [],
): readonly RunnerCapabilityMapping[] {
  return composeRunnerCapabilityContributions(contributions).mappings.filter((mapping) => mapping.runnerId === runnerId);
}

export function getRunnerCapabilityMapping(
  capabilityId: string,
  runnerId: string,
  contributions: readonly RunnerCapabilityContribution[] = [],
): RunnerCapabilityMapping | undefined {
  return getRunnerMappings(runnerId, contributions).find((mapping) => mapping.capabilityId === capabilityId);
}

export type AdapterCapabilitySemantics = {
  capabilityId: string;
  status: RunnerCapabilitySupportStatus;
  provisionMode?: string;
  executable?: string;
  mcpServerName?: string;
};

export function validateRunnerCapabilitySemantics(
  runnerId: string,
  adapterEntries: readonly AdapterCapabilitySemantics[],
  contributions: readonly RunnerCapabilityContribution[] = [],
): readonly string[] {
  const issues: string[] = [];
  const mappings = new Map(getRunnerMappings(runnerId, contributions).map((mapping) => [mapping.capabilityId, mapping]));
  const entries = new Map(adapterEntries.map((entry) => [entry.capabilityId, entry]));
  for (const mapping of mappings.values()) {
    if (!entries.has(mapping.capabilityId)) issues.push(`${mapping.capabilityId}: parity mapping is missing from the adapter semantic catalog.`);
  }
  for (const entry of adapterEntries) {
    const mapping = mappings.get(entry.capabilityId);
    if (!mapping) continue;
    if (mapping.status !== entry.status) issues.push(`${entry.capabilityId}: adapter status ${entry.status} differs from mapping ${mapping.status}.`);
    if (mapping.provisionMode !== entry.provisionMode) issues.push(`${entry.capabilityId}: provision mode ${entry.provisionMode ?? "missing"} differs from mapping ${mapping.provisionMode ?? "missing"}.`);
    const commands = mapping.detectors?.commands ?? [];
    if ((entry.executable ?? null) !== (commands[0] ?? null)) issues.push(`${entry.capabilityId}: executable ${entry.executable ?? "missing"} differs from mapping ${commands[0] ?? "missing"}.`);
    const servers = mapping.detectors?.mcpServerNames ?? [];
    if ((entry.mcpServerName ?? null) !== (servers[0] ?? null)) issues.push(`${entry.capabilityId}: MCP server ${entry.mcpServerName ?? "missing"} differs from mapping ${servers[0] ?? "missing"}.`);
    if (mapping.parityChecks?.includes("binary-usable") && !entry.executable) issues.push(`${entry.capabilityId}: binary readiness requires executable metadata.`);
    if (mapping.parityChecks?.includes("mcp-config-present") && !entry.mcpServerName) issues.push(`${entry.capabilityId}: MCP readiness requires server metadata.`);
    if (!entry.provisionMode) issues.push(`${entry.capabilityId}: provision metadata is missing.`);
  }
  return issues;
}

export const CANONICAL_CATEGORIES: readonly CanonicalCapabilityCategory[] = Object.freeze([
  "agents",
  "skills",
  "mcps",
  "packages",
  "shared-binaries",
  "runner-silent-packages",
  "prompts-profiles",
  "memory-tool-bindings",
  "execution-controls",
]);

export const SUPPORT_STATUSES: readonly RunnerCapabilitySupportStatus[] = Object.freeze([
  "supported",
  "runner-specific",
  "shared",
  "manual-verified",
  "gap",
  "blocked",
  "unsupported",
  "not-applicable",
]);
