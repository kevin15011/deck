import type { InstallablePiToolId } from "./installation-plan";

/**
 * User-facing capability IDs exposed in the Pi dashboard.
 * Excludes internal/deprecated capabilities like `runner-mermaid`.
 */
export type CapabilityId = "rtk" | "context-mode" | "codebase-memory" | "pi-hud" | "runner-mermaid";

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

export type CapabilityStatus = "ready" | "missing" | "manual" | "pending-source" | "blocked";

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

export type CapabilityInstallKind = "pi-package" | "external" | "pending";

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
    description: "Context-mode runner capability for shared execution context.",
    section: "runner-capabilities",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "context-mode",
    source: "npm:context-mode",
    installKind: "pi-package",
    detector: { piPackageNames: ["context-mode"] },
  },
  "codebase-memory": {
    capabilityId: "codebase-memory",
    label: "codebase-memory",
    description: "Codebase memory MCP capability; separate from Adaptive Memory providers.",
    section: "runner-capabilities",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "codebase-memory",
    source: "DeusData/codebase-memory-mcp",
    installKind: "external",
    detector: { piPackageNames: ["codebase-memory", "codebase-memory-mcp"], commands: ["codebase-memory-mcp"] },
  },
  rtk: {
    capabilityId: "rtk",
    label: "RTK",
    description: "RTK runner capability installed and verified outside Pi package automation.",
    section: "runner-capabilities",
    runnerScope: "all",
    requirementLevel: "configurable",
    toolId: "rtk",
    source: "rtk-ai/rtk",
    installKind: "external",
    detector: { piPackageNames: ["rtk"], commands: ["rtk"] },
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
  "codebase-memory": FULL_CAPABILITY_CATALOG["codebase-memory"] as CapabilityToolMapping,
  rtk: FULL_CAPABILITY_CATALOG.rtk as CapabilityToolMapping,
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