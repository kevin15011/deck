import {
  ALL_PI_RUNNER_CAPABILITY_IDS,
  getUserFacingCapability,
  PI_RUNNER_CAPABILITY_IDS,
  type CapabilityId,
  type CapabilityStatus,
  type InternalCapabilityId,
  type RunnerScope,
} from "./capability-catalog";
import { checkSharedBinaryUsability } from "@deck/core";
import {
  detectInternalRunnerPackageStatus,
  INTERNAL_RUNNER_PACKAGE_IDS,
  type InternalRunnerPackageId,
  type InternalRunnerPackageStatus,
} from "./internal-runner-packages";
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

/**
 * Internal capability entry used for pi-mermaid detection via internal-runner-packages.
 * These entries track internal/deprecated capabilities not shown in user-facing summaries.
 */
export type PiRunnerInternalCapabilityInventoryEntry = {
  capabilityId: InternalCapabilityId;
  status: "ready" | "missing" | "installing" | "installed" | "unchanged" | "skipped" | "updated" | "created" | "failed" | "conflict";
  runnerScope: "pi";
  installed: boolean;
  implementationId: "pi-mermaid";
  source: "npm:pi-mermaid";
  diagnostics: string[];
};

export type PiRunnerCapabilityInventory = Partial<Record<CapabilityId, PiRunnerCapabilityInventoryEntry>>;

/**
 * Combined inventory including internal capabilities.
 */
export type PiRunnerFullCapabilityInventory = PiRunnerCapabilityInventory & {
  _internal?: Partial<Record<InternalCapabilityId, PiRunnerInternalCapabilityInventoryEntry>>;
};

/**
 * Codebase-memory index lifecycle status.
 * REQ-CBM-003: Report observable index lifecycle state.
 */
export type CodebaseMemoryIndexStatus =
  | "not-indexed"
  | "indexed-verified"
  | "blocked"
  | "gap";

/**
 * Codebase-memory index information for inventory.
 */
export type CodebaseMemoryIndexInfo = {
  status: CodebaseMemoryIndexStatus;
  recommendedAction?: string;
  indexPath?: string;
};

export type BuildPiRunnerCapabilityInventoryConfig = {
  runnerScope?: RunnerScope;
  /** When true, also populates _internal with internal capability entries. */
  includeInternal?: boolean;
};

/**
 * Maps internal runner package IDs to internal capability IDs.
 * pi-mermaid (package) maps to runner-mermaid (capability).
 */
const INTERNAL_PACKAGE_TO_CAPABILITY: Record<InternalRunnerPackageId, InternalCapabilityId> = {
  "pi-mermaid": "runner-mermaid",
};

/**
 * Maps an InternalRunnerPackageStatus to the subset that maps to inventory status.
 */
function toInternalCapabilityStatus(
  status: InternalRunnerPackageStatus,
): PiRunnerInternalCapabilityInventoryEntry["status"] {
  // Map any terminal/in-progress status to the entry status union
  switch (status) {
    case "ready":
    case "missing":
    case "installing":
    case "installed":
    case "unchanged":
    case "skipped":
    case "updated":
    case "created":
    case "failed":
    case "conflict":
      return status;
    // "not-checked" falls through — treat as missing for inventory purposes
    case "not-checked":
      return "missing";
  }
}

/**
 * Builds a user-facing capability inventory for the Pi runner dashboard.
 *
 * Changes from previous version (REQ-DASH-001):
 * - `runner-mermaid` is no longer treated as `pending-source` or `blocked`.
 * - Pi visual support is detected via `pi-mermaid` in internal-runner-packages.ts.
 * - Internal capabilities are returned separately in `_internal` when `includeInternal: true`.
 *
 * @param review     - Preflight/required-tools review data.
 * @param preflight  - Optional full preflight result for additional diagnostics.
 * @param config     - Inventory build configuration.
 */
export function buildPiRunnerCapabilityInventory(
  review: PiRequiredToolsReview | undefined,
  _preflight?: PiPreflightResult,
  config: BuildPiRunnerCapabilityInventoryConfig = {},
): PiRunnerFullCapabilityInventory {
  const runnerScope = config.runnerScope ?? "pi";
  const installedNames = buildInstalledNameSet(review);
  const detectorMappings = getCapabilityDetectorMappings();
  const inventory: PiRunnerFullCapabilityInventory = {};

  // -----------------------------------------------------------------------
  // User-facing capabilities (excludes internal/deprecated like runner-mermaid)
  // -----------------------------------------------------------------------

  for (const capabilityId of PI_RUNNER_CAPABILITY_IDS) {
    const capability = getUserFacingCapability(capabilityId);

    if (!capability) continue;
    if (!isCapabilityInScope(capability.runnerScope, runnerScope)) continue;

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

    // Map install kinds to status - external/manual require manual setup
    // shared-binary and shared-binary-plus-mcp are treated as missing until verified (they may be reused)
    const isExternalOrManual = capability.installKind === "external" ||
      capability.installKind === "manual-verified" ||
      capability.installKind === "manual";

    const status: CapabilityStatus = installed
      ? "ready"
      : isExternalOrManual
        ? "manual"
        : capability.installKind.startsWith("shared-")
          ? "manual"  // Shared binaries may need setup/config even if they exist
          : "missing";

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

  // -----------------------------------------------------------------------
  // Internal capabilities (pi-mermaid detection via internal runner packages)
  // REQ-PIINSTALL-001, REQ-PIINSTALL-002: delegate detection to internal-runner-packages.ts
  // -----------------------------------------------------------------------

  if (config.includeInternal && runnerScope === "pi") {
    const internalEntries: PiRunnerFullCapabilityInventory["_internal"] = {};

    for (const packageId of INTERNAL_RUNNER_PACKAGE_IDS) {
      const state = detectInternalRunnerPackageStatus(packageId, review, _preflight);
      const capabilityId = INTERNAL_PACKAGE_TO_CAPABILITY[packageId];
      const mappedStatus = toInternalCapabilityStatus(state.status);

      internalEntries[capabilityId] = {
        capabilityId,
        status: mappedStatus,
        runnerScope: "pi",
        installed: state.status === "ready",
        implementationId: "pi-mermaid",
        source: "npm:pi-mermaid",
        diagnostics: state.diagnostics,
      };
    }

    inventory._internal = internalEntries;
  }

  return inventory;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInstalledNameSet(review: PiRequiredToolsReview | undefined): Set<string> {
  const values = [
    ...(review?.installedPackages ?? []),
    ...(review?.requiredTools.filter((tool) => tool.installed).map((tool) => tool.name) ?? []),
    ...(review?.tools.filter((tool) => tool.available === "found" || tool.ready === "ready").map((tool) => tool.name) ?? []),
  ];

  return new Set(values.map(normalizeName));
}

function isCapabilityInstalled(capabilityId: CapabilityId, installedNames: Set<string>, detectorNames: string[]): boolean {
  const capability = getUserFacingCapability(capabilityId);
  if (!capability) return false;

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

// ---------------------------------------------------------------------------
// Codebase-memory index lifecycle detection
// ---------------------------------------------------------------------------

/**
 * Check the index lifecycle status of codebase-memory.
 * REQ-CBM-003: Report observable index lifecycle.
 *
 * @param projectPath - Optional path to check for index. Defaults to current directory.
 */
export async function checkCodebaseMemoryIndexStatus(
  projectPath?: string,
): Promise<CodebaseMemoryIndexInfo> {
  // Check for common index locations
  const searchPaths = [
    projectPath ? `${projectPath}/.codebase-memory` : undefined,
    `${process.env.HOME ?? ""}/.codebase-memory`,
    ".codebase-memory",
  ].filter(Boolean) as string[];

  for (const indexPath of searchPaths) {
    try {
      const { existsSync } = await import("node:fs");
      if (existsSync(indexPath)) {
        return {
          status: "indexed-verified",
          indexPath,
          recommendedAction: undefined,
        };
      }
    } catch {
      // Continue checking other paths
    }
  }

  return {
    status: "not-indexed",
    recommendedAction: "Run 'codebase-memory-mcp index' to index the project for codebase memory",
  };
}

// ---------------------------------------------------------------------------
// Binary detection helpers
// ---------------------------------------------------------------------------

/**
 * Check if a shared binary is available and usable.
 * Used for detecting rtk, serena, codebase-memory-mcp, context-mode.
 */
export async function checkBinaryUsability(
  command: string,
): Promise<{ available: boolean; usable: boolean }> {
  try {
    const result = await checkSharedBinaryUsability(command, {
      healthcheckArgs: ["--version", "--help"],
      timeoutMs: 3000,
    });

    return {
      available: result.status !== "missing",
      usable: result.status === "ready",
    };
  } catch {
    return { available: false, usable: false };
  }
}