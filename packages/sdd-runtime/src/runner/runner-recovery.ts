/**
 * Runner recovery — classifies transport vs implementation failure;
 * validates artifact structure, freshness, hash; retry/resume from latest valid.
 */

// ── Context ──

export interface TransportFailureContext {
  transportDisconnected: boolean;
  artifactPresent: boolean;
  artifactValid: boolean;
  artifactFresh: boolean;
}

/**
 * Validates a TransportFailureContext — rejects null/undefined/primitive inputs.
 * Ensures all boolean fields are actually booleans.
 */
export function validateTransportContext(ctx: unknown): TransportFailureContext | null {
  if (ctx === null || ctx === undefined || typeof ctx !== "object" || Array.isArray(ctx)) {
    return null;
  }
  const record = ctx as Record<string, unknown>;
  if (
    typeof record.transportDisconnected !== "boolean" ||
    typeof record.artifactPresent !== "boolean" ||
    typeof record.artifactValid !== "boolean" ||
    typeof record.artifactFresh !== "boolean"
  ) {
    return null;
  }
  return {
    transportDisconnected: record.transportDisconnected,
    artifactPresent: record.artifactPresent,
    artifactValid: record.artifactValid,
    artifactFresh: record.artifactFresh,
  };
}

// ── Artifact validation ──

export interface ArtifactValidationResult {
  hasRequiredSections: boolean;
  parseable: boolean;
  schemaVersion?: string;
  hash?: string;
  registryConsistent: boolean;
  /** Epoch timestamp (ms) when the artifact was created/last modified */
  timestamp?: number;
  /** Idempotency key or content hash for replay dedup */
  idempotencyKey?: string;
}

// ── Config ──

export interface RecoveryConfig {
  maxRetryAttempts: number;
  retryDelayMs: number;
  artifactFreshnessMaxMs: number;
}

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  maxRetryAttempts: 3,
  retryDelayMs: 1000,
  artifactFreshnessMaxMs: 300000, // 5 minutes
};

// ── Classification ──

export type FailureClassification =
  | "transport_failure_no_artifact"
  | "artifact_present_valid"
  | "artifact_present_unvalidated"
  | "implementation_failure"
  | "stale_write_conflict"
  | "budget_exhausted";

export interface FailureClassificationResult {
  classification: FailureClassification;
  canRetry: boolean;
  canResume: boolean;
}

export function classifyTransportFailure(
  context: TransportFailureContext,
): FailureClassificationResult {
  if (!context.transportDisconnected) {
    return {
      classification: "implementation_failure",
      canRetry: false,
      canResume: false,
    };
  }

  if (!context.artifactPresent) {
    return {
      classification: "transport_failure_no_artifact",
      canRetry: true,
      canResume: false,
    };
  }

  if (context.artifactValid && context.artifactFresh) {
    return {
      classification: "artifact_present_valid",
      canRetry: false,
      canResume: true,
    };
  }

  return {
    classification: "artifact_present_unvalidated",
    canRetry: true,
    canResume: false,
  };
}

// ── Resume validation ──

export interface ResumeValidationResult {
  /** All recovery gates passed */
  canResume: boolean;
  /** Specific gates that failed */
  failedChecks: string[];
}

/**
 * Validates artifact before resuming — does NOT trust caller booleans.
 * Checks: sections, parseability, schema/version, hash/idempotency,
 * freshness, registry consistency.
 */
export function validateArtifactForResume(
  artifact: ArtifactValidationResult,
  config: RecoveryConfig,
): ResumeValidationResult {
  const failedChecks: string[] = [];

  if (!artifact.hasRequiredSections) {
    failedChecks.push("missing_required_sections");
  }

  if (!artifact.parseable) {
    failedChecks.push("not_parseable");
  }

  if (!artifact.schemaVersion || typeof artifact.schemaVersion !== "string" || artifact.schemaVersion.trim() === "") {
    failedChecks.push("missing_schema_version");
  }

  if (!artifact.hash || typeof artifact.hash !== "string" || artifact.hash.trim() === "") {
    failedChecks.push("missing_hash");
  }

  if (!artifact.registryConsistent) {
    failedChecks.push("registry_inconsistent");
  }

  // Freshness check: artifact must not be older than artifactFreshnessMaxMs
  if (artifact.timestamp === undefined || artifact.timestamp === null) {
    failedChecks.push("missing_timestamp");
  } else if (typeof artifact.timestamp !== "number" || !Number.isFinite(artifact.timestamp)) {
    failedChecks.push("invalid_timestamp");
  } else {
    const age = Date.now() - artifact.timestamp;
    if (age < 0) {
      // Future / skewed timestamp — clock drift or tampering
      failedChecks.push("future_timestamp");
    } else if (age > config.artifactFreshnessMaxMs) {
      failedChecks.push("artifact_stale");
    }
  }

  // Idempotency key: required for safe replay
  if (artifact.idempotencyKey === undefined || artifact.idempotencyKey === null) {
    failedChecks.push("missing_idempotency_key");
  } else if (typeof artifact.idempotencyKey !== "string" || artifact.idempotencyKey.trim() === "") {
    failedChecks.push("invalid_idempotency_key");
  }

  return {
    canResume: failedChecks.length === 0,
    failedChecks,
  };
}

// ── Resume attempt ──

export interface ResumeResult {
  resumed: boolean;
  fromArtifact: boolean;
  relaunch: boolean;
  retryAllowed: boolean;
  requiresReplan: boolean;
  /** When resume is blocked, lists which validation checks failed */
  failedChecks?: string[];
}

export function attemptResume(
  failure: FailureClassificationResult,
  artifactValidation: ArtifactValidationResult,
  config: RecoveryConfig,
): ResumeResult {
  switch (failure.classification) {
    case "artifact_present_valid": {
      // Validate independently — do not trust caller booleans
      const validation = validateArtifactForResume(artifactValidation, config);
      if (!validation.canResume) {
        return {
          resumed: false,
          fromArtifact: false,
          relaunch: true,
          retryAllowed: true,
          requiresReplan: false,
          failedChecks: validation.failedChecks,
        };
      }
      return {
        resumed: true,
        fromArtifact: true,
        relaunch: false,
        retryAllowed: false,
        requiresReplan: false,
      };
    }

    case "transport_failure_no_artifact":
      return {
        resumed: false,
        fromArtifact: false,
        relaunch: true,
        retryAllowed: true,
        requiresReplan: false,
      };

    case "artifact_present_unvalidated":
      return {
        resumed: false,
        fromArtifact: false,
        relaunch: true,
        retryAllowed: true,
        requiresReplan: false,
      };

    case "stale_write_conflict":
      return {
        resumed: false,
        fromArtifact: false,
        relaunch: false,
        retryAllowed: false,
        requiresReplan: true,
      };

    case "budget_exhausted":
      // Budget is gone — no retry, no resume, no replan.
      // Conservative: do not attempt any recovery action.
      return {
        resumed: false,
        fromArtifact: false,
        relaunch: false,
        retryAllowed: false,
        requiresReplan: false,
      };

    case "implementation_failure":
    default:
      return {
        resumed: false,
        fromArtifact: false,
        relaunch: false,
        retryAllowed: false,
        requiresReplan: false,
      };
  }
}
