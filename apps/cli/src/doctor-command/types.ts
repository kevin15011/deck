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
  /** Latest available version (optional, for upgrade reporting) */
  latestVersion?: string;
  /** Latest release commit (optional, for upgrade reporting) */
  latestCommit?: string;
  /** Reason for upgrade availability decision (optional) */
  reason?: string;
}

/**
 * Summary of all diagnostics with counts by severity.
 */
export interface DoctorSummary {
  ok: number;
  warning: number;
  error: number;
  sections: string[];
}

/**
 * Presentation model for CLI/TUI rendering.
 * Contains summary + ordered sections for consistent display.
 */
export interface DoctorPresentationModel {
  summary: DoctorSummary;
  sections: DoctorCategoryResult[];
  hasCriticalErrors: boolean;
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
  /** Manifest/State/XDG checks (optional, added by redesign) */
  deck?: DoctorCategoryResult[];
  /** Binary validation results (optional, added by redesign) */
  binaryCheck?: DoctorCategoryResult[];
  /** Runner config validation results (optional, added by redesign) */
  runnerConfig?: DoctorCategoryResult[];
  /** Summary with counts by severity (optional, added by redesign) */
  summary?: DoctorSummary;
}