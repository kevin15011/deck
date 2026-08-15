import {
  defineRunnerCapabilityContribution,
  getCanonicalCapability,
  type RunnerCapabilityMapping,
  type RunnerCapabilitySupportStatus,
} from "@deck/core";
import type { InstallablePiToolId } from "./installation-plan";
import { TAVILY_IMPLEMENTATION_ID, TAVILY_MCP_SERVER_ID } from "@deck/provider-tavily";

/**
 * User-facing capability IDs exposed in the Pi dashboard.
 * Includes canonical capability IDs from registry for parity tracking.
 */
export type CapabilityId =
  | "rtk"
  | "context-mode"
  | "codebase-memory-mcp"
  | "serena"
   | "context7"
   | "web-search"
   | "pi-hud"
  | "runner-mermaid";

/**
 * Internal capability IDs used for inventory tracking but NOT exposed
 * in user-facing dashboard selectors or capability summaries.
 * `runner-mermaid` is internal: it maps to `pi-mermaid` detection via the
 * internal runner packages module (internal-runner-packages.ts).
 *
 * @internal
 */
export type InternalCapabilityId = "runner-mermaid";

export type RunnerScope = "pi" | "opencode" | "all";

export type CapabilityRequirementLevel = "required" | "optional" | "configurable";

export type CapabilityStatus = "ready" | "missing" | "manual" | "pending-source" | "blocked" | "disabled" | "unsupported" | "enabled-unconfigured" | "configured-but-not-materialized";

export type TechnicalActionKind =
  | "install-pi-package"
  | "manual-external-install"
  | "write-deck-config"
  | "write-pi-mcp-config"
  | "apply-team-bundle"
  | "validate"
  | "pending-source"
  | "noop";

/**
 * Dashboard section for user-facing capability grouping.
 * `runner-ui-visual-helpers` is deprecated and should not be used for new entries.
 */
export type CapabilityDashboardSection = "runner-capabilities" | "runner-ui-visual-helpers";

export type CapabilityInstallKind =
  | "pi-package"
  | "external"
  | "pending"
  | "python-tool"
  | "shared-binary-plus-mcp"
  | "shared-binary"
  | "manual-verified"
  | "manual"
  | "npm-package-plus-mcp"
  | "npm-package"
   | "mcp-server";

export type CapabilityRunnerImplementationTarget = string;

export type CapabilityImplementationId = "pi-mermaid" | "TBD" | (string & {});

export type CapabilityImplementationMapping = {
  id: CapabilityImplementationId;
  source: string;
  installKind: CapabilityInstallKind;
  note?: string;
};

export type CapabilityDetector = {
  piPackageNames?: string[];
  commands?: string[];
  mcpServerNames?: string[];
  note?: string;
};

/**
 * Capability entry for the user-facing Pi runner capability catalog.
 * Internal/deprecated capabilities (`runner-mermaid`) are tracked in
 * `INTERNAL_CAPABILITY_ENTRIES` but excluded from user-facing selectors.
 */
export type CapabilityToolMapping = {
  capabilityId: CapabilityId;
  label: string;
  description: string;
  section: CapabilityDashboardSection;
  runnerScope: RunnerScope;
  requirementLevel: CapabilityRequirementLevel;
  toolId?: InstallablePiToolId;
  source?: string;
  installKind: CapabilityInstallKind;
  detector: CapabilityDetector;
  implementationId?: CapabilityImplementationId;
  implementations?: Partial<Record<CapabilityRunnerImplementationTarget, CapabilityImplementationMapping>>;
  /**
   * When true, this capability is internal and must not appear in
   * user-facing dashboard selectors or capability summaries.
   * REQ-DASH-001: Mermaid must not be a configurable dashboard capability.
   */
  isInternal?: boolean;
};

/**
 * Internal-only capability entries used for inventory tracking.
 * These are not user-facing and do not appear in dashboard selectors.
 *
 * @internal
 */
export type InternalCapabilityToolMapping = {
  capabilityId: InternalCapabilityId;
  label: string;
  description: string;
  section: CapabilityDashboardSection;
  runnerScope: RunnerScope;
  requirementLevel: CapabilityRequirementLevel;
  source?: string;
  installKind: CapabilityInstallKind;
  detector: CapabilityDetector;
  implementations?: Partial<Record<CapabilityRunnerImplementationTarget, CapabilityImplementationMapping>>;
  isInternal: true;
};

// ---------------------------------------------------------------------------
// Full catalog (includes internal entries; use USER_FACING_IDS for selectors)
// ---------------------------------------------------------------------------

const FULL_CAPABILITY_CATALOG: Record<CapabilityId, CapabilityToolMapping | InternalCapabilityToolMapping> = {
  "context-mode": {
    capabilityId: "context-mode",
    label: "context-mode",
    description: "Context-mode runner capability for shared execution context. Requires local MCP config.",
    section: "runner-capabilities",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "context-mode",
    source: "context-mode (shared binary)",
    installKind: "shared-binary-plus-mcp",
    detector: { piPackageNames: ["context-mode"], commands: ["context-mode"] },
  },
  "codebase-memory-mcp": {
    capabilityId: "codebase-memory-mcp",
    label: "codebase-memory-mcp",
    description: "Codebase Memory MCP local server backed by shared binary. Aligns with OpenCode naming.",
    section: "runner-capabilities",
    runnerScope: "all",
    requirementLevel: "configurable",
    source: "DeusData/codebase-memory-mcp",
    installKind: "shared-binary-plus-mcp",
    detector: { commands: ["codebase-memory-mcp"] },
  },
  rtk: {
    capabilityId: "rtk",
    label: "RTK",
    description: "RTK (Token Killer) - first-class Deck capability for CLI token optimization. Shared binary reuse.",
    section: "runner-capabilities",
    runnerScope: "all",
    requirementLevel: "optional",
    toolId: "rtk",
    source: "rtk-ai/rtk",
    installKind: "shared-binary",
    detector: { piPackageNames: ["rtk"], commands: ["rtk"] },
  },
  serena: {
    capabilityId: "serena",
    label: "Serena",
    description: "Serena symbolic editing capability with managed MCP integration.",
    section: "runner-capabilities",
    runnerScope: "pi",
    requirementLevel: "configurable",
    toolId: "serena",
    source: "serena-agent",
    installKind: "shared-binary-plus-mcp",
    detector: { commands: ["serena"] },
  },
  context7: {
    capabilityId: "context7",
    label: "Context7",
    description: "Context7 MCP using standard @upstash/context7-mcp package. Standard preferred over wrapper.",
    section: "runner-capabilities",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "context7",
    source: "npm:@upstash/context7-mcp",
    installKind: "npm-package-plus-mcp",
    detector: { mcpServerNames: ["context7"] },
    /**
     * Falls back to @dreki-gg/pi-context7 if standard MCP blocked.
     * REQ-MCP-001: Converge to standard @upstash/context7-mcp unless blocker confirmed.
     */
  },
  "web-search": {
    capabilityId: "web-search",
    label: "Web Search",
    description: "Optional compact web search and point extraction through native MCP configuration.",
    section: "runner-capabilities",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "web-search" as InstallablePiToolId,
    source: TAVILY_IMPLEMENTATION_ID,
    implementationId: TAVILY_IMPLEMENTATION_ID,
    installKind: "mcp-server",
    detector: { commands: ["npx"], mcpServerNames: [TAVILY_MCP_SERVER_ID] },
  },
  /**
   * runner-mermaid is INTERNAL.
   * Pi visual support is detected via `pi-mermaid` in internal-runner-packages.ts.
   * This entry is excluded from user-facing capability summaries and selectors.
   * REQ-DASH-001: Mermaid must not appear as a user-facing capability choice.
   */
  "runner-mermaid": {
    capabilityId: "runner-mermaid",
    label: "Mermaid",
    description: "Internal runner visual documentation capability. Detected via internal-runner-packages.ts.",
    section: "runner-ui-visual-helpers",
    runnerScope: "all",
    requirementLevel: "required",
    source: "npm:pi-mermaid",
    installKind: "pending",
    isInternal: true,
    detector: {
      note: "Internal only; detection delegates to internal-runner-packages.ts.",
    },
    implementations: {
      pi: {
        id: "pi-mermaid",
        source: "npm:pi-mermaid",
        installKind: "pending",
        note: "Pi-only implementation. OpenCode renderer deferred.",
      },
      opencode: {
        id: "TBD",
        source: "TBD",
        installKind: "pending",
        note: "OpenCode Mermaid implementation mapping is not defined yet.",
      },
    },
  },
  "pi-hud": {
    capabilityId: "pi-hud",
    label: "pi-hud",
    description: "Optional Pi-only runner HUD helper with source and detector pending.",
    section: "runner-ui-visual-helpers",
    runnerScope: "pi",
    requirementLevel: "optional",
    source: "TBD",
    installKind: "pending",
    detector: { note: "Pending canonical Pi-only source and detector." },
  },
} as const satisfies Record<CapabilityId, CapabilityToolMapping | InternalCapabilityToolMapping>;

// ---------------------------------------------------------------------------
// User-facing public catalog (excludes internal entries)
// ---------------------------------------------------------------------------

export const PI_RUNNER_CAPABILITY_CATALOG: Record<
  Exclude<CapabilityId, InternalCapabilityId>,
  CapabilityToolMapping
> = {
  "context-mode": FULL_CAPABILITY_CATALOG["context-mode"] as CapabilityToolMapping,
  "codebase-memory-mcp": FULL_CAPABILITY_CATALOG["codebase-memory-mcp"] as CapabilityToolMapping,
  rtk: FULL_CAPABILITY_CATALOG.rtk as CapabilityToolMapping,
  serena: FULL_CAPABILITY_CATALOG.serena as CapabilityToolMapping,
  context7: FULL_CAPABILITY_CATALOG.context7 as CapabilityToolMapping,
  "web-search": FULL_CAPABILITY_CATALOG["web-search"] as CapabilityToolMapping,
  "pi-hud": FULL_CAPABILITY_CATALOG["pi-hud"] as CapabilityToolMapping,
} as const satisfies Record<Exclude<CapabilityId, InternalCapabilityId>, CapabilityToolMapping>;

/**
 * Internal-only capability entries.
 * Used by the inventory for tracking but NOT exposed in user-facing selectors.
 *
 * @internal
 */
export const INTERNAL_CAPABILITY_ENTRIES: Record<InternalCapabilityId, InternalCapabilityToolMapping> = {
  "runner-mermaid": FULL_CAPABILITY_CATALOG["runner-mermaid"] as InternalCapabilityToolMapping,
} as const satisfies Record<InternalCapabilityId, InternalCapabilityToolMapping>;

/**
 * User-facing capability IDs — excludes internal/deprecated entries.
 * Dashboard selectors and capability summaries should use this array.
 * REQ-DASH-001: runner-mermaid must not appear in user-facing capability summaries.
 */
export const PI_RUNNER_CAPABILITY_IDS = Object.keys(PI_RUNNER_CAPABILITY_CATALOG) as Exclude<
  CapabilityId,
  InternalCapabilityId
>[];

/**
 * All capability IDs including internal ones.
 * Use PI_RUNNER_CAPABILITY_IDS for user-facing display.
 */
export const ALL_PI_RUNNER_CAPABILITY_IDS = Object.keys(FULL_CAPABILITY_CATALOG) as CapabilityId[];

/**
 * Returns the capability entry, or undefined if not found.
 */
export function getPiRunnerCapability(capabilityId: CapabilityId): (CapabilityToolMapping | InternalCapabilityToolMapping) | undefined {
  return FULL_CAPABILITY_CATALOG[capabilityId];
}

/**
 * Returns a user-facing capability entry, or undefined if not found or internal.
 */
export function getUserFacingCapability(
  capabilityId: CapabilityId,
): CapabilityToolMapping | undefined {
  const entry = FULL_CAPABILITY_CATALOG[capabilityId];
  if (entry && !entry.isInternal) {
    return entry as CapabilityToolMapping;
  }
  return undefined;
}

/**
 * Resolve a Pi capability ID to its canonical registry capability ID.
 * Returns the capability if it exists in the canonical registry.
 * REQ-MAP-004: codebase-memory, codebase-memory-mcp, and rtk must map to their canonical IDs.
 */
export function resolveToCanonicalCapabilityId(
  capabilityId: CapabilityId,
): string | undefined {
  const canonical = getCanonicalCapability(capabilityId, [PI_RUNNER_CAPABILITY_CONTRIBUTION]);
  return canonical?.id;
}

/**
 * Validate that a Pi capability entry has a valid mapping to the canonical registry.
 * Returns true if the capability exists in the registry or is a Pi-specific capability.
 */
export function validatePiCapabilityMapping(capabilityId: CapabilityId): boolean {
  // These are Pi-specific capabilities not in the canonical registry
  const piSpecificIds = ["pi-hud", "runner-mermaid"];

  if (piSpecificIds.includes(capabilityId)) {
    return true;
  }

  // All other capabilities must exist in the canonical registry
  return resolveToCanonicalCapabilityId(capabilityId) !== undefined;
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
  runnerId: "pi",
  status: "supported",
  adapterSource: "@deck/adapter-pi",
  installKind: "native-extension-bridge",
}));

export const PI_RUNNER_CAPABILITY_CONTRIBUTION = defineRunnerCapabilityContribution({
  runnerId: "pi",
  capabilities: [
    { id: "pi-orchestrator-prompt-persistence", label: "Orchestrator Prompt Persistence", category: "prompts-profiles", requirement: "required", userFacing: false, requiredSurfaces: ["prompt-profile"] },
    { id: "pi-mermaid", label: "Pi Mermaid", category: "runner-silent-packages", requirement: "internal-required", userFacing: false },
    { id: "pi-hud", label: "Pi HUD", category: "packages", requirement: "optional", userFacing: true },
  ],
  mappings: [
    ...protectedControlMappings,
    { capabilityId: "code-economy", runnerId: "pi", status: "supported", adapterSource: "@deck/adapter-pi", installKind: "native-instruction-composition", provisionMode: "native-instruction-composition", parityChecks: ["instruction-bundle-present"] },
    { capabilityId: "context-mode", runnerId: "pi", status: "shared", adapterSource: "context-mode", installKind: "shared-binary-plus-mcp", provisionMode: "reuse-shared-binary-plus-mcp", detectors: { commands: ["context-mode"], mcpServerNames: ["context-mode"] }, parityChecks: ["binary-usable", "mcp-config-present", "no-unnecessary-reinstall"] },
    { capabilityId: "codebase-memory", runnerId: "pi", status: "shared", adapterSource: "codebase-memory-mcp", installKind: "shared-binary-plus-mcp", provisionMode: "reuse-shared-binary-plus-mcp", detectors: { commands: ["codebase-memory-mcp"], mcpServerNames: ["codebase-memory"] }, parityChecks: ["binary-usable", "mcp-config-present", "no-unnecessary-reinstall"] },
    { capabilityId: "codebase-memory-mcp", runnerId: "pi", status: "shared", adapterSource: "codebase-memory-mcp", installKind: "shared-binary-plus-mcp", provisionMode: "reuse-shared-binary-plus-mcp", detectors: { commands: ["codebase-memory-mcp"], mcpServerNames: ["codebase-memory"] }, parityChecks: ["binary-usable", "mcp-config-present"] },
    { capabilityId: "rtk", runnerId: "pi", status: "shared", adapterSource: "rtk", installKind: "shared-binary", provisionMode: "reuse-shared-binary", detectors: { commands: ["rtk"] }, parityChecks: ["binary-usable", "no-unnecessary-reinstall"] },
    { capabilityId: "serena", runnerId: "pi", status: "shared", adapterSource: "serena", installKind: "python-tool", provisionMode: "python-tool", detectors: { commands: ["serena"], mcpServerNames: ["serena"] }, parityChecks: ["binary-usable", "mcp-config-present", "instruction-bundle-present"] },
    { capabilityId: "context7", runnerId: "pi", status: "shared", adapterSource: "@upstash/context7-mcp", installKind: "npm-package-plus-mcp", provisionMode: "npm-package-plus-mcp", detectors: { mcpServerNames: ["context7"] }, parityChecks: ["mcp-config-present"] },
    { capabilityId: "web-search", runnerId: "pi", status: "supported", adapterSource: "@deck/provider-tavily", installKind: "native-mcp", provisionMode: "native-mcp", implementationId: TAVILY_IMPLEMENTATION_ID, detectors: { mcpServerNames: [TAVILY_MCP_SERVER_ID] }, parityChecks: ["mcp-config-present", "instruction-bundle-present"] },
    { capabilityId: "supermemory-tool-bindings", runnerId: "pi", status: "shared", adapterSource: "supermemory", installKind: "mcp-server", provisionMode: "mcp-server", detectors: { mcpServerNames: ["supermemory"] }, parityChecks: ["mcp-config-present"] },
    { capabilityId: "pi-orchestrator-prompt-persistence", runnerId: "pi", status: "supported", adapterSource: "pi-team-profile", installKind: "manual", provisionMode: "profile-prompt", parityChecks: ["instruction-bundle-present"] },
    { capabilityId: "pi-mermaid", runnerId: "pi", status: "runner-specific", adapterSource: "pi-mermaid", installKind: "internal-required", provisionMode: "internal-required" },
    { capabilityId: "pi-hud", runnerId: "pi", status: "gap", adapterSource: "pi-hud", installKind: "user-optional", provisionMode: "user-optional" },
    { capabilityId: "opencode-primary-orchestrator", runnerId: "pi", status: "not-applicable", adapterSource: "@deck/adapter-pi", provisionMode: "foreign-runner-capability" },
    { capabilityId: "opencode-mermaid", runnerId: "pi", status: "not-applicable", adapterSource: "@deck/adapter-pi", provisionMode: "foreign-runner-capability" },
    { capabilityId: "opencode-mermaid-renderer", runnerId: "pi", status: "not-applicable", adapterSource: "@deck/adapter-pi", provisionMode: "foreign-runner-capability" },
    { capabilityId: "deck-model-variants", runnerId: "pi", status: "not-applicable", adapterSource: "@deck/adapter-pi", provisionMode: "foreign-runner-capability" },
    { capabilityId: "deck-setup", runnerId: "pi", status: "supported", adapterSource: "deck-setup", installKind: "npm-package", provisionMode: "npm-package" },
  ],
});

export const PI_ADAPTER_CAPABILITY_DISPOSITIONS = Object.freeze([
  { capabilityId: "pi-hud", status: "gap", installKind: "user-optional" },
] as const);
