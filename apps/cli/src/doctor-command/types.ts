/**
 * Shared types for `deck doctor` diagnostics.
 *
 * These types form the contract boundary between the diagnostics orchestrator
 * (doctor-diagnostics.ts) and the report formatter (doctor-report.ts).
 */

/**
 * Status level for a single diagnostic check.
 */
export type DoctorStatus = "ok" | "warning" | "error";

/**
 * A single diagnostic check item with optional fix suggestion.
 */
export interface DoctorCheckItem {
  status: DoctorStatus;
  message: string;
  suggestion?: string;
}

/**
 * A category of checks within a diagnostic group (e.g., "Packages", "MCP Servers").
 */
export interface DoctorCategoryResult {
  category: string;
  status: DoctorStatus;
  items: DoctorCheckItem[];
}

/**
 * Diagnostic results for a single runtime environment.
 */
export interface DoctorRuntimeResult {
  runtimeId: string;
  name: string;
  installed: boolean;
  version?: string;
  checks: DoctorCategoryResult[];
}

/**
 * Complete result of the doctor diagnostics run.
 */
export interface DoctorDiagnosticsResult {
  runtimes: DoctorRuntimeResult[];
  memory: DoctorCategoryResult[];
  mcp: DoctorCategoryResult[];
  hasCriticalErrors: boolean;
}