import type { RunnerCapabilities } from "./runner-capability.js";

// Required capabilities that every runner must implement
export const REQUIRED_CAPABILITIES = [
  "id",
  "displayName",
  "environments",
  "inspectEnvironment",
  "tools",
  "teams",
  "models",
  "memory",
] as const;

// Optional capabilities that may be absent without invalidating the runner
export const OPTIONAL_CAPABILITIES = [
  "install",
  "developerTeam",
  "modelConfig",
  "capabilities",
] as const;

export interface ValidationResult {
  isValid: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Validate that a RunnerCapabilities object has all required capabilities
 * and report warnings for missing optional ones.
 */
export function validateRunnerCapabilities(capabilities: RunnerCapabilities): ValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required capabilities
  for (const key of REQUIRED_CAPABILITIES) {
    if (!(key in capabilities) || capabilities[key as keyof RunnerCapabilities] === undefined) {
      missing.push(key);
    }
  }

  // Check optional capabilities (warning if missing)
  for (const key of OPTIONAL_CAPABILITIES) {
    if (!(key in capabilities) || capabilities[key as keyof RunnerCapabilities] === undefined) {
      warnings.push(key);
    }
  }

  return {
    isValid: missing.length === 0,
    missing,
    warnings,
  };
}