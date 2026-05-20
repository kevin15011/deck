/**
 * Phase outcome contracts — status, artifact refs, hashes, validation results.
 */

export type OutcomeStatus =
  | "success"
  | "partial"
  | "failed"
  | "transport_unknown"
  | "budget_exceeded";

export interface ArtifactRef {
  path: string;
  hash: string;
}

export interface PhaseBudgetReport {
  used: number;
  limit: number;
  unit: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PhaseOutcome {
  status: OutcomeStatus;
  phase: string;
  artifactRefs: ArtifactRef[];
  validationResult: ValidationResult;
  phaseBudgetReport?: PhaseBudgetReport;
  timestamp: string;
}

export interface OutcomeValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_STATUSES: OutcomeStatus[] = [
  "success",
  "partial",
  "failed",
  "transport_unknown",
  "budget_exceeded",
];

export function validatePhaseOutcome(outcome: unknown): OutcomeValidationResult {
  const record = outcome as Record<string, unknown>;
  const errors: string[] = [];

  // Status validation
  if (!VALID_STATUSES.includes(record.status as OutcomeStatus)) {
    errors.push("invalid status");
  }

  // Phase required
  if (!record.phase || typeof record.phase !== "string" || (record.phase as string).trim() === "") {
    errors.push("missing phase");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
