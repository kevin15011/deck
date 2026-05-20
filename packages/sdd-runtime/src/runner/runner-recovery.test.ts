import { describe, expect, test } from "bun:test";

import {
  classifyTransportFailure,
  attemptResume,
  validateArtifactForResume,
  validateTransportContext,
  type TransportFailureContext,
  type ArtifactValidationResult,
  type RecoveryConfig,
  DEFAULT_RECOVERY_CONFIG,
} from "./runner-recovery";

describe("runner-recovery", () => {
  describe("validateTransportContext", () => {
    test("accepts valid context", () => {
      const result = validateTransportContext({
        transportDisconnected: true,
        artifactPresent: false,
        artifactValid: false,
        artifactFresh: false,
      });
      expect(result).not.toBeNull();
      expect(result!.transportDisconnected).toBe(true);
    });

    test("rejects null", () => {
      expect(validateTransportContext(null)).toBeNull();
    });

    test("rejects undefined", () => {
      expect(validateTransportContext(undefined)).toBeNull();
    });

    test("rejects primitive string", () => {
      expect(validateTransportContext("bad")).toBeNull();
    });

    test("rejects array", () => {
      expect(validateTransportContext([1, 2, 3])).toBeNull();
    });

    test("rejects context with non-boolean fields", () => {
      expect(validateTransportContext({
        transportDisconnected: "yes",
        artifactPresent: true,
        artifactValid: true,
        artifactFresh: true,
      })).toBeNull();
    });

    test("rejects context with missing fields", () => {
      expect(validateTransportContext({
        transportDisconnected: true,
      })).toBeNull();
    });
  });

  describe("validateArtifactForResume", () => {
    test("passes for fully valid artifact", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(true);
      expect(result.failedChecks).toEqual([]);
    });

    test("fails when sections missing", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: false,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("missing_required_sections");
    });

    test("fails when not parseable", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: false,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("not_parseable");
    });

    test("fails when schema version missing", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: undefined,
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("missing_schema_version");
    });

    test("fails when hash missing", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: undefined,
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("missing_hash");
    });

    test("fails when registry inconsistent", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: false,
          timestamp: Date.now(),
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("registry_inconsistent");
    });

    test("collects multiple failures at once", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: false,
          parseable: false,
          schemaVersion: undefined,
          hash: undefined,
          registryConsistent: false,
          timestamp: undefined,
          idempotencyKey: undefined,
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      // 5 original + missing_timestamp + missing_idempotency_key = 7
      expect(result.failedChecks.length).toBe(7);
    });

    // ── Freshness tests ──

    test("fails when timestamp is missing", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: undefined,
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("missing_timestamp");
    });

    test("fails when timestamp is stale (older than artifactFreshnessMaxMs)", () => {
      const staleTimestamp = Date.now() - DEFAULT_RECOVERY_CONFIG.artifactFreshnessMaxMs - 1000;
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: staleTimestamp,
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("artifact_stale");
    });

    test("fails when timestamp is not a number", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: "not-a-number" as unknown as number,
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("invalid_timestamp");
    });

    // ── Invalid / edge-case timestamps (Third Review) ──

    test("rejects NaN timestamp", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: NaN,
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("invalid_timestamp");
    });

    test("rejects Infinity timestamp", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Infinity,
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("invalid_timestamp");
    });

    test("rejects -Infinity timestamp", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: -Infinity,
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("invalid_timestamp");
    });

    test("rejects future timestamp (clock skew / tampering)", () => {
      const futureTimestamp = Date.now() + 60000; // 1 minute in the future
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: futureTimestamp,
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("future_timestamp");
    });

    test("passes when timestamp is fresh (within artifactFreshnessMaxMs)", () => {
      const freshTimestamp = Date.now() - 1000;
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: freshTimestamp,
          idempotencyKey: "idem-123",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(true);
    });

    // ── Idempotency key tests ──

    test("fails when idempotency key is missing", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: undefined,
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("missing_idempotency_key");
    });

    test("fails when idempotency key is empty string", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "",
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("invalid_idempotency_key");
    });

    test("fails when idempotency key is non-string", () => {
      const result = validateArtifactForResume(
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: 42 as unknown as string,
        },
        DEFAULT_RECOVERY_CONFIG,
      );
      expect(result.canResume).toBe(false);
      expect(result.failedChecks).toContain("invalid_idempotency_key");
    });
  });

  describe("classifyTransportFailure", () => {
    test("classifies no-artifact when transport disconnects before artifact found", () => {
      const context: TransportFailureContext = {
        transportDisconnected: true,
        artifactPresent: false,
        artifactValid: false,
        artifactFresh: false,
      };

      const result = classifyTransportFailure(context);

      expect(result.classification).toBe("transport_failure_no_artifact");
      expect(result.canRetry).toBe(true);
    });

    test("classifies artifact-present-valid when valid artifact exists after disconnect", () => {
      const context: TransportFailureContext = {
        transportDisconnected: true,
        artifactPresent: true,
        artifactValid: true,
        artifactFresh: true,
      };

      const result = classifyTransportFailure(context);

      expect(result.classification).toBe("artifact_present_valid");
      expect(result.canResume).toBe(true);
    });

    test("classifies artifact-present-unvalidated for partial/malformed artifact", () => {
      const context: TransportFailureContext = {
        transportDisconnected: true,
        artifactPresent: true,
        artifactValid: false,
        artifactFresh: true,
      };

      const result = classifyTransportFailure(context);

      expect(result.classification).toBe("artifact_present_unvalidated");
      expect(result.canRetry).toBe(true);
      expect(result.canResume).toBe(false);
    });

    test("classifies implementation_failure when transport is fine but artifact is invalid", () => {
      const context: TransportFailureContext = {
        transportDisconnected: false,
        artifactPresent: true,
        artifactValid: false,
        artifactFresh: true,
      };

      const result = classifyTransportFailure(context);

      expect(result.classification).toBe("implementation_failure");
      expect(result.canRetry).toBe(false);
    });
  });

  describe("attemptResume", () => {
    test("resumes from valid artifact with full validation passing", () => {
      const artifactValidation: ArtifactValidationResult = {
        hasRequiredSections: true,
        parseable: true,
        schemaVersion: "1.0",
        hash: "sha256:abc123",
        registryConsistent: true,
        timestamp: Date.now(),
        idempotencyKey: "idem-resume-1",
      };

      const result = attemptResume(
        { classification: "artifact_present_valid", canResume: true, canRetry: true },
        artifactValidation,
        DEFAULT_RECOVERY_CONFIG,
      );

      expect(result.resumed).toBe(true);
      expect(result.fromArtifact).toBe(true);
      expect(result.relaunch).toBe(false);
    });

    test("does not resume when artifact validation fails — missing sections", () => {
      const artifactValidation: ArtifactValidationResult = {
        hasRequiredSections: false,
        parseable: true,
        schemaVersion: "1.0",
        hash: "sha256:abc",
        registryConsistent: true,
        timestamp: Date.now(),
        idempotencyKey: "idem-test",
      };

      const result = attemptResume(
        { classification: "artifact_present_valid", canResume: true, canRetry: true },
        artifactValidation,
        DEFAULT_RECOVERY_CONFIG,
      );

      expect(result.resumed).toBe(false);
      expect(result.relaunch).toBe(true);
      expect(result.failedChecks).toContain("missing_required_sections");
    });

    test("does not resume when artifact validation fails — no hash", () => {
      const artifactValidation: ArtifactValidationResult = {
        hasRequiredSections: true,
        parseable: true,
        schemaVersion: "1.0",
        hash: undefined,
        registryConsistent: true,
        timestamp: Date.now(),
        idempotencyKey: "idem-test",
      };

      const result = attemptResume(
        { classification: "artifact_present_valid", canResume: true, canRetry: true },
        artifactValidation,
        DEFAULT_RECOVERY_CONFIG,
      );

      expect(result.resumed).toBe(false);
      expect(result.relaunch).toBe(true);
      expect(result.failedChecks).toContain("missing_hash");
    });

    test("does not resume when artifact is unvalidated", () => {
      const artifactValidation: ArtifactValidationResult = {
        hasRequiredSections: false,
        parseable: false,
        schemaVersion: undefined,
        hash: undefined,
        registryConsistent: false,
        timestamp: undefined,
        idempotencyKey: undefined,
      };

      const result = attemptResume(
        { classification: "artifact_present_unvalidated", canResume: false, canRetry: true },
        artifactValidation,
        DEFAULT_RECOVERY_CONFIG,
      );

      expect(result.resumed).toBe(false);
      expect(result.relaunch).toBe(true);
    });

    test("retries on transport failure without artifact", () => {
      const result = attemptResume(
        { classification: "transport_failure_no_artifact", canResume: false, canRetry: true },
        {
          hasRequiredSections: false,
          parseable: false,
          schemaVersion: undefined,
          hash: undefined,
          registryConsistent: false,
          timestamp: undefined,
          idempotencyKey: undefined,
        },
        DEFAULT_RECOVERY_CONFIG,
      );

      expect(result.resumed).toBe(false);
      expect(result.relaunch).toBe(true);
      expect(result.retryAllowed).toBe(true);
    });

    test("stops for stale state conflict", () => {
      const result = attemptResume(
        { classification: "stale_write_conflict", canResume: false, canRetry: false },
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:old",
          registryConsistent: false,
          timestamp: Date.now(),
          idempotencyKey: "idem-old",
        },
        DEFAULT_RECOVERY_CONFIG,
      );

      expect(result.resumed).toBe(false);
      expect(result.relaunch).toBe(false);
      expect(result.requiresReplan).toBe(true);
    });

    // ── Budget exhausted (Third Review) ──

    test("returns conservative non-resumable decision for budget_exhausted", () => {
      const result = attemptResume(
        { classification: "budget_exhausted", canResume: false, canRetry: false },
        {
          hasRequiredSections: true,
          parseable: true,
          schemaVersion: "1.0",
          hash: "sha256:abc",
          registryConsistent: true,
          timestamp: Date.now(),
          idempotencyKey: "idem-budget",
        },
        DEFAULT_RECOVERY_CONFIG,
      );

      expect(result.resumed).toBe(false);
      expect(result.fromArtifact).toBe(false);
      expect(result.relaunch).toBe(false);
      expect(result.retryAllowed).toBe(false);
      expect(result.requiresReplan).toBe(false);
    });
  });
});
