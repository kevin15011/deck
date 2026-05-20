import type { InstallablePiToolId } from "./installation-plan";

export type CapabilityId = "rtk" | "context-mode" | "codebase-memory" | "pi-hud" | "runner-mermaid";

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

export type CapabilityDashboardSection = "runner-capabilities" | "runner-ui-visual-helpers";

export type CapabilityInstallKind = "pi-package" | "external" | "pending";

export type CapabilityRunnerImplementationTarget = Extract<RunnerScope, "pi" | "opencode">;

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
};

export const PI_RUNNER_CAPABILITY_CATALOG = {
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
  "runner-mermaid": {
    capabilityId: "runner-mermaid",
    label: "Mermaid",
    description: "Mandatory runner visual documentation capability. Runner implementations are mapped explicitly per runner.",
    section: "runner-ui-visual-helpers",
    runnerScope: "all",
    requirementLevel: "required",
    source: "TBD",
    installKind: "pending",
    detector: {
      note: "Global Mermaid capability is required; consumers must choose a runner-scoped implementation mapping.",
    },
    implementations: {
      pi: {
        id: "pi-mermaid",
        source: "TBD",
        installKind: "pending",
        note: "Pi-only implementation placeholder; do not apply to OpenCode.",
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
} as const satisfies Record<CapabilityId, CapabilityToolMapping>;

export const PI_RUNNER_CAPABILITY_IDS = Object.keys(PI_RUNNER_CAPABILITY_CATALOG) as CapabilityId[];

export function getPiRunnerCapability(capabilityId: CapabilityId): CapabilityToolMapping {
  return PI_RUNNER_CAPABILITY_CATALOG[capabilityId];
}
