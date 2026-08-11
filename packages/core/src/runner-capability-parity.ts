/**
 * Runner Capability Parity Resolver
 *
 * Resolves parity status for a runner against canonical capabilities,
 * producing a ParityReport with gaps, blockers, and diagnostics.
 */

import type {
  CanonicalRunnerCapability,
  RunnerCapabilityMapping,
  RunnerCapabilityContribution,
  ParityRuntimeHints,
} from "./runner-capability-registry";
import {
  getCanonicalRunnerCapabilities,
  getRunnerMappings,
} from "./runner-capability-registry";
import { resolveWebSearchReadiness } from "./web-search-capability";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity levels for parity report entries */
export type ParityReportSeverity = "info" | "warning" | "error";

/** Error codes from the spec */
export type ParityErrorCode =
  | "missing-runner-mapping"
  | "silent-package-not-modeled"
  | "capability-binary-not-usable"
  | "capability-mcp-not-configured"
  | "capability-mapping-gap"
  | "capability-blocked"
  | "capability-index-unverified"
  | "capability-configuration-unverified"
  | "capability-unsupported"
  | "web-search-disabled"
  | "web-search-enabled-unconfigured"
  | "web-search-not-materialized"
  | "web-search-ready";

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
  runnerId: string,
  capability: CanonicalRunnerCapability,
  mapping: RunnerCapabilityMapping | undefined,
  runtimeHints?: ParityRuntimeHints,
): ParityReportEntry {
  const capabilityId = capability.id;
  const failure = (
    code: ParityErrorCode,
    detail: string,
    recommendedAction: string,
    severity: ParityReportSeverity = "error",
  ): ParityReportEntry => ({
    capabilityId,
    runnerId,
    status: "gap",
    severity,
    code,
    message: `Runner ${runnerId} capability ${capabilityId}: ${detail}`,
    recommendedAction,
  });

  if (capabilityId === "web-search") {
    const evidence = runtimeHints?.webSearch ?? {
      enabled: false,
      runnerSupported: mapping?.status !== "unsupported" && mapping?.status !== "not-applicable",
      providerConfigured: false,
      credentialAvailable: false,
      executableAvailable: false,
      mcpConfigured: false,
    };

    if (!evidence.enabled) {
      return {
        capabilityId,
        runnerId,
        status: "disabled",
        severity: "info",
        code: "web-search-disabled",
        message: `Runner ${runnerId} capability ${capabilityId}: Web Search is disabled; the optional capability does not affect baseline runner readiness.`,
      };
    }

    if (!mapping || mapping.status === "unsupported" || mapping.status === "not-applicable") {
      return {
        capabilityId,
        runnerId,
        status: "unsupported",
        severity: "warning",
        code: "capability-unsupported",
        message: `Runner ${runnerId} does not expose the MCP/materialization surface required by ${capabilityId}.`,
        recommendedAction: `Use a runner with native MCP materialization for ${capabilityId}`,
      };
    }

    const readiness = resolveWebSearchReadiness({ ...evidence, runnerSupported: true });
    const status = readiness.state;
    const severity: ParityReportSeverity = readiness.state === "ready" ? "info" : "warning";
    const code: ParityErrorCode = readiness.state === "ready"
      ? "web-search-ready"
      : readiness.state === "configured-but-not-materialized"
        ? "web-search-not-materialized"
        : "web-search-enabled-unconfigured";
    return {
      capabilityId,
      runnerId,
      status,
      severity,
      code,
      message: `Runner ${runnerId} capability ${capabilityId}: ${readiness.diagnostics.join(" ")}`,
      recommendedAction: readiness.state === "ready" ? undefined : `Resolve Web Search readiness for runner ${runnerId}`,
    };
  }

  if (capability.category === "runner-silent-packages") {
    if (!mapping) {
      return failure(
        "silent-package-not-modeled",
        "the runner-specific silent package is not explicitly modeled",
        `Add a ${runnerId} mapping for ${capabilityId}`,
      );
    }
    return {
      capabilityId,
      runnerId,
      status: mapping.status,
      severity: "info",
      message: `${capability.label} is ${mapping.status} for ${runnerId}`,
    };
  }

  if (!mapping) {
    return failure(
      "missing-runner-mapping",
      "the required runner mapping is missing",
      `Add a ${runnerId} mapping for ${capabilityId}`,
    );
  }

  if (mapping.status === "gap") {
    return failure(
      "capability-mapping-gap",
      "the adapter mapping declares an unresolved capability gap",
      `Provide or explicitly resolve the ${runnerId} mapping for ${capabilityId}`,
    );
  }

  if (mapping.status === "blocked") {
    return {
      ...failure(
        "capability-blocked",
        "the adapter mapping declares this capability blocked",
        `Resolve the ${runnerId} blocker for ${capabilityId}`,
      ),
      status: "blocked",
    };
  }

  if (mapping.status === "unsupported") {
    return {
      capabilityId,
      runnerId,
      status: "unsupported",
      severity: "warning",
      code: "capability-unsupported",
      message: `${capability.label} is unsupported by ${runnerId}.`,
      recommendedAction: `Use a runner that supports ${capabilityId}`,
    };
  }

  if (mapping.status === "not-applicable") {
    return {
      capabilityId,
      runnerId,
      status: "not-applicable",
      severity: "info",
      message: `${capability.label} is not applicable to ${runnerId}`,
    };
  }

  const binaryCommands = mapping.status === "shared" && mapping.parityChecks?.includes("binary-usable")
    ? mapping.detectors?.commands ?? (capability.sharedBinary ? [capability.sharedBinary.command] : [])
    : capability.sharedBinary && mapping.status === "shared"
      ? [capability.sharedBinary.command]
      : [];
  const unusableCommand = binaryCommands.find((command) => !isBinaryUsable(command, runtimeHints));
  if (unusableCommand) {
    return failure(
      "capability-binary-not-usable",
      `required binary ${unusableCommand} is not usable`,
      `Install or verify ${unusableCommand} is available to runner ${runnerId}`,
    );
  }

  const mcpServerNames = mapping.status === "shared" && mapping.parityChecks?.includes("mcp-config-present")
    ? mapping.detectors?.mcpServerNames ?? (capability.sharedBinary?.mcpServerName ? [capability.sharedBinary.mcpServerName] : [])
    : capability.sharedBinary?.mcpServerName && mapping.status === "shared"
      ? [capability.sharedBinary.mcpServerName]
      : [];
  const missingMcpServer = mcpServerNames.find((serverName) => !isMcpServerConfigured(serverName, runtimeHints));
  if (missingMcpServer && !(capabilityId === "supermemory-tool-bindings" && runtimeHints?.supermemoryConfigured === true)) {
    return failure(
      "capability-mcp-not-configured",
      `required MCP server ${missingMcpServer} is not configured`,
      `Configure MCP server ${missingMcpServer} for runner ${runnerId}`,
    );
  }

  if (capabilityId === "supermemory-tool-bindings" && runtimeHints?.supermemoryConfigured === false) {
    return failure(
      "capability-configuration-unverified",
      "required runtime configuration could not be verified",
      `Verify configuration for ${capabilityId} on runner ${runnerId}`,
    );
  }

  if (capabilityId === "codebase-memory" && runtimeHints?.projectIndexVerified === false) {
    return failure(
      "capability-index-unverified",
      "the required project index is not verified",
      `Verify the project index for ${capabilityId} on runner ${runnerId}`,
      "warning",
    );
  }

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
  runtimeHints?: ParityRuntimeHints,
  contributions: readonly RunnerCapabilityContribution[] = [],
): ParityReport {
  const capabilities = getCanonicalRunnerCapabilities(contributions);
  const mappings = getRunnerMappings(runnerId, contributions);

  const entries: ParityReportEntry[] = [];
  const gaps: ParityReportEntry[] = [];
  const blockers: ParityReportEntry[] = [];
  const silentPackages: ParityReportEntry[] = [];

  for (const capability of capabilities) {
    const mapping = mappings.find((m) => m.capabilityId === capability.id);
    const entry = resolveCapabilityParity(runnerId, capability, mapping, runtimeHints);

    entries.push(entry);

    // Categorize by severity and status. Optional unsupported/configuration states
    // remain visible as warnings without becoming baseline-required blockers.
    if (capability.category === "runner-silent-packages") {
      silentPackages.push(entry);
    } else if (
      entry.severity === "error"
      || entry.status === "gap"
      || entry.status === "blocked"
      || entry.status === "unsupported"
      || entry.status === "enabled-unconfigured"
      || entry.status === "configured-but-not-materialized"
    ) {
      if (entry.status === "blocked") {
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
export function getParityGaps(
  runnerId: string,
  contributions: readonly RunnerCapabilityContribution[] = [],
): readonly ParityReportEntry[] {
  const report = resolveRunnerParity(runnerId, undefined, contributions);
  return [...report.gaps, ...report.blockers].filter((entry) => entry.severity !== "info");
}
