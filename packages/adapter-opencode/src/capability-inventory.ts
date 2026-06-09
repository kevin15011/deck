import {
  ALL_OPENCODE_RUNNER_CAPABILITY_IDS,
  getUserFacingOpenCodeCapability,
  OPENCODE_RUNNER_CAPABILITY_IDS,
  type OpenCodeCapabilityId,
  type OpenCodeCapabilityStatus,
  type OpenCodeRunnerScope,
} from "./capability-catalog";
import {
  INTERNAL_OPENCODE_PACKAGE_IDS,
  type InternalOpenCodePackageId,
} from "./internal-opencode-packages";
import type { OpenCodeToolsReview } from "./required-tools";

export type OpenCodeRunnerCapabilityInventoryEntry = {
  capabilityId: OpenCodeCapabilityId;
  status: OpenCodeCapabilityStatus;
  runnerScope: OpenCodeRunnerScope;
  installed: boolean;
  toolName?: string;
  toolId?: string;
  source?: string;
  implementationId?: string;
  diagnostics: string[];
  /** Commands provided by this capability (for runtime detection hints) */
  commands?: readonly string[];
  /** MCP servers provided by this capability (for runtime detection hints) */
  mcpServers?: readonly string[];
};

export type OpenCodeRunnerInternalCapabilityInventoryEntry = {
  capabilityId: "opencode-mermaid";
  status: "ready" | "missing";
  runnerScope: "opencode";
  installed: boolean;
  implementationId: "opencode-mermaid-renderer";
  source: "opencode-mermaid-renderer";
  diagnostics: string[];
};

export type OpenCodeRunnerCapabilityInventory = Partial<Record<OpenCodeCapabilityId, OpenCodeRunnerCapabilityInventoryEntry>>;

export type OpenCodeRunnerFullCapabilityInventory = OpenCodeRunnerCapabilityInventory & {
  _internal?: Partial<Record<"opencode-mermaid", OpenCodeRunnerInternalCapabilityInventoryEntry>>;
};

export type BuildOpenCodeRunnerCapabilityInventoryConfig = {
  runnerScope?: OpenCodeRunnerScope;
  includeInternal?: boolean;
};

const INTERNAL_PACKAGE_TO_CAPABILITY: Record<InternalOpenCodePackageId, "opencode-mermaid"> = {
  "opencode-mermaid-renderer": "opencode-mermaid",
};

export function buildOpenCodeRunnerCapabilityInventory(
  review: OpenCodeToolsReview | undefined,
  config: BuildOpenCodeRunnerCapabilityInventoryConfig = {},
): OpenCodeRunnerFullCapabilityInventory {
  const runnerScope = config.runnerScope ?? "opencode";
  const installedNames = buildInstalledNameSet(review);
  const inventory: OpenCodeRunnerFullCapabilityInventory = {};

  for (const capabilityId of OPENCODE_RUNNER_CAPABILITY_IDS) {
    const capability = getUserFacingOpenCodeCapability(capabilityId);
    if (!capability) continue;
    if (!isCapabilityInScope(capability.runnerScope, runnerScope)) continue;

    const installed = isCapabilityInstalled(capabilityId, installedNames, capability.detector.pluginNames ?? []);
    const status: OpenCodeCapabilityStatus = installed
      ? "ready"
      : capability.installKind === "external"
        ? "manual"
        : "missing";

    inventory[capabilityId] = {
      capabilityId,
      runnerScope,
      installed,
      status,
      toolId: capability.toolId,
      source: capability.source,
      diagnostics: installed
        ? []
        : [
            capability.installKind === "external"
              ? `${capability.label} requires external/manual installation or verification.`
              : `${capability.label} is missing and can be installed by OpenCode package automation if selected.`,
          ],
    };
  }

  if (config.includeInternal && runnerScope === "opencode") {
    const internalEntries: OpenCodeRunnerFullCapabilityInventory["_internal"] = {};

    for (const packageId of INTERNAL_OPENCODE_PACKAGE_IDS) {
      const capabilityId = INTERNAL_PACKAGE_TO_CAPABILITY[packageId];
      // For now, detect based on installed packages
      const installed = installedNames.has(normalizeName("opencode-mermaid-renderer"));
      const status: "ready" | "missing" = installed ? "ready" : "missing";

      internalEntries[capabilityId] = {
        capabilityId,
        status,
        runnerScope: "opencode",
        installed: status === "ready",
        implementationId: "opencode-mermaid-renderer",
        source: "opencode-mermaid-renderer",
        diagnostics: [status === "ready" ? "Mermaid plugin is installed." : "Mermaid plugin is not installed."],
      };
    }

    inventory._internal = internalEntries;
  }

  return inventory;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInstalledNameSet(review: OpenCodeToolsReview | undefined): Set<string> {
  const values = [
    ...(review?.installedPackages ?? []),
    ...(review?.tools.filter((tool) => tool.installed).map((tool) => tool.name) ?? []),
  ];

  return new Set(values.map(normalizeName));
}

function isCapabilityInstalled(capabilityId: OpenCodeCapabilityId, installedNames: Set<string>, detectorNames: string[]): boolean {
  const capability = getUserFacingOpenCodeCapability(capabilityId);
  if (!capability) return false;

  // For npm-package-plus-mcp kind, detect via mcpServerNames and commands only (not pluginNames)
  // This ensures context-mode detection uses MCP config, not legacy plugin array
  const useMcpBasedDetection = capability.installKind === "npm-package-plus-mcp";

  const candidates = [
    capabilityId,
    capability.toolId,
    capability.label,
    capability.source,
    ...(useMcpBasedDetection ? [] : capability.detector.pluginNames ?? []),
    ...(capability.detector.commands ?? []),
    ...(capability.detector.mcpServerNames ?? []),
    ...detectorNames,
  ].filter((value): value is string => Boolean(value));

  return candidates.some((candidate) => installedNames.has(normalizeName(candidate)));
}

function isCapabilityInScope(capabilityScope: OpenCodeRunnerScope, runnerScope: OpenCodeRunnerScope): boolean {
  return capabilityScope === "all" || capabilityScope === runnerScope;
}

function normalizeName(value: string): string {
  return value
    .replace(/^npm:/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
