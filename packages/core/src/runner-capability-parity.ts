/**
 * Runner Capability Parity Resolver
 *
 * Resolves parity status for a runner against canonical capabilities,
 * producing a ParityReport with gaps, blockers, and diagnostics.
 */

import type {
  CanonicalRunnerCapability,
  RunnerCapabilityMapping,
  ParityRuntimeHints,
} from "./runner-capability-registry";
import {
  getCanonicalRunnerCapabilities,
  getRunnerMappings,
  getCanonicalCapability,
} from "./runner-capability-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity levels for parity report entries */
export type ParityReportSeverity = "info" | "warning" | "error";

/** Error codes from the spec */
export type ParityErrorCode =
  | "missing-runner-mapping"
  | "first-class-capability-mapping-missing"
  | "silent-package-not-modeled"
  | "shared-binary-not-usable"
  | "pi-context-mode-mcp-missing"
  | "codebase-memory-mcp-missing"
  | "codebase-memory-index-unverified"
  | "pi-rtk-mapping-missing"
  | "pi-supermemory-extra-gate-present"
  | "mcp-standard-blocked"
  | "memory-tools-unverified"
  | "pi-serena-not-satisfied";

/** A single entry in the parity report */
export type ParityReportEntry = {
  capabilityId: string;
  runnerId: string;
  status: string;
  severity: ParityReportSeverity;
  code?: ParityErrorCode;
  message: string;
  recommendedAction?: string;
};

/** Complete parity report for a runner */
export type ParityReport = {
  runnerId: string;
  capabilities: readonly ParityReportEntry[];
  gaps: readonly ParityReportEntry[];
  blockers: readonly ParityReportEntry[];
  silentPackages: readonly ParityReportEntry[];
};

// ---------------------------------------------------------------------------
// Parity Resolution Logic
// ---------------------------------------------------------------------------

/**
 * Check if a binary is usable based on runtime hints
 */
function isBinaryUsable(
  command: string,
  runtimeHints?: ParityRuntimeHints
): boolean {
  if (!runtimeHints?.binariesInPath) return false;
  return runtimeHints.binariesInPath.includes(command);
}

/**
 * Check if an MCP server is configured based on runtime hints
 */
function isMcpServerConfigured(
  serverName: string,
  runtimeHints?: ParityRuntimeHints
): boolean {
  if (!runtimeHints?.mcpServersConfigured) return false;
  return runtimeHints.mcpServersConfigured.includes(serverName);
}

/**
 * Resolve a single capability's parity status
 */
function resolveCapabilityParity(
  capability: CanonicalRunnerCapability,
  mapping: RunnerCapabilityMapping | undefined,
  runtimeHints?: ParityRuntimeHints
): ParityReportEntry {
  const capabilityId = capability.id;
  const runnerId = mapping?.runnerId ?? "unknown";

  // Handle runner-specific silent packages - these are NOT gaps
  if (capability.category === "runner-silent-packages") {
    // If no mapping exists for a silent package, that's a gap - must be explicitly modeled
    if (!mapping) {
      return {
        capabilityId,
        runnerId,
        status: "gap",
        severity: "error",
        code: "silent-package-not-modeled",
        message: `Silent package ${capabilityId} must be modeled explicitly`,
        recommendedAction: `Add runner-specific mapping for ${capabilityId}`,
      };
    }
    return {
      capabilityId,
      runnerId,
      status: mapping.status ?? "runner-specific",
      severity: "info",
      message: `${capability.label} is a runner-specific silent package`,
    };
  }

  // No mapping exists - this is a gap
  if (!mapping) {
    return {
      capabilityId,
      runnerId,
      status: "gap",
      severity: "error",
      code: "missing-runner-mapping",
      message: `Runner mapping missing for required capability: ${capabilityId}`,
      recommendedAction: `Add mapping for ${capabilityId} in runner capability registry`,
    };
  }

  // Check binary usability for shared capabilities
  if (capability.sharedBinary) {
    const binaryUsable = isBinaryUsable(capability.sharedBinary.command, runtimeHints);

    if (mapping.status === "shared" && !binaryUsable) {
      return {
        capabilityId,
        runnerId,
        status: "gap",
        severity: "error",
        code: "shared-binary-not-usable",
        message: `Shared binary ${capability.sharedBinary.command} exists but failed usability checks`,
        recommendedAction: `Install or verify ${capability.sharedBinary.command} is in PATH and responds to --version/--help`,
      };
    }

    // Check MCP config for MCP-enabled shared binaries
    if (capability.sharedBinary.mcpServerName && mapping.status === "shared") {
      const mcpConfigured = isMcpServerConfigured(capability.sharedBinary.mcpServerName, runtimeHints);
      if (!mcpConfigured && binaryUsable) {
        const errorCode = capabilityId === "codebase-memory-mcp"
          ? "codebase-memory-mcp-missing"
          : capabilityId === "context-mode"
          ? "pi-context-mode-mcp-missing"
          : undefined;

        return {
          capabilityId,
          runnerId,
          status: "gap",
          severity: "error",
          code: errorCode,
          message: `${capability.label} requires local MCP integration for this runner`,
          recommendedAction: `Configure MCP server ${capability.sharedBinary.mcpServerName} in runner config`,
        };
      }
    }
  }

  // Handle specific capability checks
  switch (capabilityId) {
    case "rtk": {
      const rtkUsable = isBinaryUsable("rtk", runtimeHints);
      if (mapping.status === "gap") {
        return {
          capabilityId,
          runnerId,
          status: "gap",
          severity: "error",
          code: "pi-rtk-mapping-missing",
          message: "RTK capability must be supported, shared, blocked, or explicitly mapped",
          recommendedAction: "Add RTK as shared binary with reuse/no-reinstall logic",
        };
      }
      if (mapping.status === "shared" && !rtkUsable) {
        return {
          capabilityId,
          runnerId,
          status: "gap",
          severity: "error",
          code: "shared-binary-not-usable",
          message: "RTK binary not usable in PATH",
          recommendedAction: "Install rtk or add to PATH",
        };
      }
      break;
    }

    case "serena": {
      const serenaUsable = isBinaryUsable("serena", runtimeHints);
      if ((mapping.status === "gap" || mapping.status === "shared") && !serenaUsable) {
        return {
          capabilityId,
          runnerId,
          status: "gap",
          severity: "error",
          code: "pi-serena-not-satisfied",
          message: "Serena is mandatory for Pi parity but binary not detected in PATH",
          recommendedAction: "Install serena via uv tool install or pipx, or configure as manual-verified",
        };
      }
      break;
    }

    case "context7": {
      const context7Configured = isMcpServerConfigured("context7", runtimeHints);
      if ((mapping.status === "gap" || mapping.status === "shared") && !context7Configured) {
        return {
          capabilityId,
          runnerId,
          status: "gap",
          severity: "error",
          code: "mcp-standard-blocked",
          message: "Context7 MCP not configured; fallback required",
          recommendedAction: "Configure @upstash/context7-mcp or use fallback wrapper",
        };
      }
      break;
    }

    case "supermemory-tool-bindings": {
      const supermemoryConfigured = runtimeHints?.supermemoryConfigured;
      if ((mapping.status === "gap" || mapping.status === "shared") && !supermemoryConfigured) {
        return {
          capabilityId,
          runnerId,
          status: "gap",
          severity: "error",
          code: "memory-tools-unverified",
          message: "Memory tools could not be verified; explicit action required",
          recommendedAction: "Configure Supermemory MCP with valid credentials",
        };
      }
      break;
    }

    case "codebase-memory": {
      if (mapping.status === "shared") {
        const cbmMcpUsable = isBinaryUsable("codebase-memory-mcp", runtimeHints);
        const cbmMcpConfigured = isMcpServerConfigured("codebase-memory", runtimeHints);

        if (!cbmMcpUsable) {
          return {
            capabilityId,
            runnerId,
            status: "gap",
            severity: "error",
            code: "shared-binary-not-usable",
            message: "codebase-memory-mcp binary not usable",
            recommendedAction: "Install codebase-memory-mcp binary",
          };
        }

        if (!cbmMcpConfigured) {
          return {
            capabilityId,
            runnerId,
            status: "gap",
            severity: "error",
            code: "codebase-memory-mcp-missing",
            message: "codebase-memory requires local MCP integration for this runner",
            recommendedAction: "Configure codebase-memory MCP in runner config",
          };
        }

        // Check index status
        if (runtimeHints?.projectIndexVerified === false) {
          return {
            capabilityId,
            runnerId,
            status: "gap",
            severity: "warning",
            code: "codebase-memory-index-unverified",
            message: "codebase-memory project index is required but not verified",
            recommendedAction: "Run codebase-memory index command or verify index exists",
          };
        }
      }
      break;
    }
  }

  // Default: mapping exists and appears satisfied
  return {
    capabilityId,
    runnerId,
    status: mapping.status,
    severity: "info",
    message: `${capability.label} is ${mapping.status} for ${runnerId}`,
  };
}

/**
 * Resolve parity for a runner given runtime hints
 */
export function resolveRunnerParity(
  runnerId: string,
  runtimeHints?: ParityRuntimeHints
): ParityReport {
  const capabilities = getCanonicalRunnerCapabilities();
  const mappings = getRunnerMappings(runnerId);

  const entries: ParityReportEntry[] = [];
  const gaps: ParityReportEntry[] = [];
  const blockers: ParityReportEntry[] = [];
  const silentPackages: ParityReportEntry[] = [];

  for (const capability of capabilities) {
    const mapping = mappings.find((m) => m.capabilityId === capability.id);
    const entry = resolveCapabilityParity(capability, mapping, runtimeHints);

    entries.push(entry);

    // Categorize by severity and status
    if (capability.category === "runner-silent-packages") {
      silentPackages.push(entry);
    } else if (entry.severity === "error" || entry.status === "gap" || entry.status === "blocked") {
      if (entry.code === "mcp-standard-blocked" || entry.status === "blocked") {
        blockers.push(entry);
      } else {
        gaps.push(entry);
      }
    }
  }

  return {
    runnerId,
    capabilities: entries,
    gaps,
    blockers,
    silentPackages,
  };
}

/**
 * Get only the gaps for a runner (excluding info entries)
 */
export function getParityGaps(runnerId: string): readonly ParityReportEntry[] {
  const report = resolveRunnerParity(runnerId);
  return [...report.gaps, ...report.blockers];
}
