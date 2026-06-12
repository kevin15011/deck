/**
 * Shared runner-install preflight types.
 *
 * These types define the contract between adapters (Pi/OpenCode) and TUI/Verify for
 * structured preflight checks that validate installation readiness before allowing
 * the install/review flow to complete.
 *
 * Types are runner-agnostic and have no dependencies on CLI/adapters.
 */

// Required preflight check identifiers
export type RunnerInstallPreflightCheckId =
  | "mcp-config-persistence" // MCP config file exists and is valid
  | "stale-package-replacement" // No obsolete package references
  | "nested-skills-cleanup" // No nested skill directories
  | "legacy-sdd-cleanup" // No legacy SDD agent files
  | "shared-binary-usability" // Required binaries are executable
  | "config-manifest-presence"; // Config/manifest files present (OpenCode)

// Status of an individual preflight check
export type RunnerInstallPreflightStatus =
  | "pass" // Check passed
  | "warn" // Check passed with warnings
  | "fail" // Check failed
  | "not-applicable"; // Check not applicable for this runner

// Severity level for preflight diagnostics
export type RunnerInstallPreflightSeverity = "info" | "warning" | "error";

// Individual preflight check result
export type RunnerInstallPreflightCheck = {
  /** Unique check identifier */
  id: RunnerInstallPreflightCheckId;
  /** Runner this check applies to */
  runner: "pi" | "opencode";
  /** Check result status */
  status: RunnerInstallPreflightStatus;
  /** Severity of the check result */
  severity: RunnerInstallPreflightSeverity;
  /** Human-readable message describing the check result */
  message: string;
  /** File path or location related to this check (if applicable) */
  path?: string;
  /** Suggested remediation action */
  remediation?: string;
  /** Additional diagnostic details */
  diagnostics?: string[];
};

// Summary of preflight checks for a runner
export type RunnerInstallPreflightSummary = {
  /** Whether the runner is ready to proceed with install */
  ready: boolean;
  /** Number of failed checks */
  failed: number;
  /** Number of warning checks */
  warnings: number;
};

/**
 * Creates an empty preflight summary.
 */
export function createEmptyPreflightSummary(): RunnerInstallPreflightSummary {
  return {
    ready: true,
    failed: 0,
    warnings: 0,
  };
}

/**
 * Computes a preflight summary from a list of checks.
 */
export function computePreflightSummary(
  checks: RunnerInstallPreflightCheck[],
): RunnerInstallPreflightSummary {
  const summary: RunnerInstallPreflightSummary = {
    ready: true,
    failed: 0,
    warnings: 0,
  };

  for (const check of checks) {
    if (check.status === "fail") {
      summary.failed++;
      summary.ready = false;
    } else if (check.status === "warn") {
      summary.warnings++;
    }
  }

  return summary;
}