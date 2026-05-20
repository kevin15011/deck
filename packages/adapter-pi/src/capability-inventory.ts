import {
  getPiRunnerCapability,
  PI_RUNNER_CAPABILITY_IDS,
  type CapabilityId,
  type CapabilityStatus,
  type RunnerScope,
} from "./capability-catalog";
import type { PiPreflightResult } from "./preflight";
import {
  getCapabilityDetectorMappings,
  type PiRequiredToolsReview,
} from "./required-tools";

export type PiRunnerCapabilityInventoryEntry = {
  capabilityId: CapabilityId;
  status: CapabilityStatus;
  runnerScope: RunnerScope;
  installed: boolean;
  toolName?: string;
  toolId?: string;
  source?: string;
  implementationId?: string;
  diagnostics: string[];
};

export type PiRunnerCapabilityInventory = Partial<Record<CapabilityId, PiRunnerCapabilityInventoryEntry>>;

export type BuildPiRunnerCapabilityInventoryConfig = {
  runnerScope?: RunnerScope;
};

export function buildPiRunnerCapabilityInventory(
  review: PiRequiredToolsReview | undefined,
  _preflight?: PiPreflightResult,
  config: BuildPiRunnerCapabilityInventoryConfig = {},
): PiRunnerCapabilityInventory {
  const runnerScope = config.runnerScope ?? "pi";
  const installedNames = buildInstalledNameSet(review);
  const detectorMappings = getCapabilityDetectorMappings();
  const inventory: PiRunnerCapabilityInventory = {};

  for (const capabilityId of PI_RUNNER_CAPABILITY_IDS) {
    const capability = getPiRunnerCapability(capabilityId);

    if (!isCapabilityInScope(capability.runnerScope, runnerScope)) continue;

    if (capabilityId === "runner-mermaid") {
      const implementation = runnerScope === "pi" ? capability.implementations?.pi : capability.implementations?.opencode;
      inventory[capabilityId] = {
        capabilityId,
        runnerScope,
        installed: false,
        status: runnerScope === "pi" ? "pending-source" : "blocked",
        source: implementation?.source ?? "TBD",
        implementationId: implementation?.id ?? "TBD",
        diagnostics: [
          runnerScope === "pi"
            ? "Mermaid is required for the Pi runner; pi-mermaid is the Pi implementation, but source/detection are pending."
            : "Mermaid is required for this runner, but the OpenCode implementation mapping is TBD.",
        ],
      };
      continue;
    }

    if (capabilityId === "pi-hud") {
      inventory[capabilityId] = {
        capabilityId,
        runnerScope,
        installed: false,
        status: "pending-source",
        source: capability.source,
        diagnostics: ["pi-hud is optional and Pi-only; source/detection are pending."],
      };
      continue;
    }

    const mapping = detectorMappings.find((entry) => entry.capabilityId === capabilityId);
    const installed = isCapabilityInstalled(capabilityId, installedNames, mapping?.detectorNames ?? []);
    const status: CapabilityStatus = installed ? "ready" : capability.installKind === "external" ? "manual" : "missing";

    inventory[capabilityId] = {
      capabilityId,
      runnerScope,
      installed,
      status,
      toolName: mapping?.toolName,
      toolId: capability.toolId,
      source: capability.source,
      diagnostics: installed
        ? []
        : [
            capability.installKind === "external"
              ? `${capability.label} requires external/manual installation or verification.`
              : `${capability.label} is missing and can be installed by Pi package automation if selected.`,
          ],
    };
  }

  return inventory;
}

function buildInstalledNameSet(review: PiRequiredToolsReview | undefined): Set<string> {
  const values = [
    ...(review?.installedPackages ?? []),
    ...(review?.requiredTools.filter((tool) => tool.installed).map((tool) => tool.name) ?? []),
    ...(review?.tools.filter((tool) => tool.available === "found" || tool.ready === "ready").map((tool) => tool.name) ?? []),
  ];

  return new Set(values.map(normalizeName));
}

function isCapabilityInstalled(capabilityId: CapabilityId, installedNames: Set<string>, detectorNames: string[]): boolean {
  const capability = getPiRunnerCapability(capabilityId);
  const candidates = [
    capabilityId,
    capability.toolId,
    capability.label,
    capability.source,
    ...(capability.detector.piPackageNames ?? []),
    ...(capability.detector.commands ?? []),
    ...detectorNames,
  ].filter((value): value is string => Boolean(value));

  return candidates.some((candidate) => installedNames.has(normalizeName(candidate)));
}

function isCapabilityInScope(capabilityScope: RunnerScope, runnerScope: RunnerScope): boolean {
  return capabilityScope === "all" || capabilityScope === runnerScope;
}

function normalizeName(value: string): string {
  return value
    .replace(/^npm:/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
