/**
 * Public barrel export for the `deck doctor` sub-system.
 *
 * Re-exports the diagnostics orchestrator, report formatter, and all shared
 * types so consumers only need to import from `./doctor-command`.
 */

// Diagnostics orchestrator
export { runDoctorDiagnostics } from "./doctor-diagnostics";

// Report formatter
export { renderDoctorReport, shouldExitWithError } from "./doctor-report";

// Shared types
export type {
  DoctorStatus,
  DoctorCheckItem,
  DoctorCategoryResult,
  DoctorRuntimeResult,
  DoctorDiagnosticsResult,
} from "./types";