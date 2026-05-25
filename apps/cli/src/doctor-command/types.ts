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
 * Result of binary-specific diagnostics.
 */
export interface DoctorBinaryResult {
  /** Build info (version, commit, date, target, channel) */
  buildInfo: {
    version: string;
    commit: string;
    date: string;
    target: string;
    channel: string;
  } | null;
  /** Path to the running executable */
  executablePath: string | null;
  /** Global config directory path */
  globalConfigDir: string;
  /** Whether global config directory exists */
  globalConfigExists: boolean;
  /** Number of bundled skills */
  bundledSkillCount: number;
  /** Whether upgrade check is available */
  upgradeAvailable: boolean;
}

/**
 * Complete result of the doctor diagnostics run.
 */
export interface DoctorDiagnosticsResult {
  runtimes: DoctorRuntimeResult[];
  memory: DoctorCategoryResult[];
  mcp: DoctorCategoryResult[];
  binary?: DoctorBinaryResult;
  hasCriticalErrors: boolean;
}