import { describe, expect, test } from "bun:test";
import {
  buildBaselineEvidenceEnvelopeV1,
  buildNormalizedFindingFingerprintV1,
  parseBaselineEvidenceEnvelopeV1,
} from "./baseline-evidence";
import { sha256Digest } from "./canonical";

const digest = (value: unknown) => sha256Digest(value);

const fingerprintInput = {
  policyVersion: "baseline-disposition-policy-v1" as const,
  normalizerVersion: "baseline-fingerprint-normalizer-v1" as const,
  suiteId: "runtime",
  checkId: "quality",
  diagnosticName: "keeps identity stable",
  location: "packages/sdd-runtime/src/example.test.ts",
  oracleId: "bun-test",
  category: "assertion",
  stableErrorSignatureDigest: digest("expected:true actual:false E_ASSERT"),
};

function evidenceInput() {
  const normalizedFingerprint = buildNormalizedFindingFingerprintV1(fingerprintInput);
  const baselineDigest = digest("baseline-subject");
  const candidateDigest = digest("candidate-subject");
  const environment = {
    cohort: { os: "linux", arch: "x64", runtimeName: "bun", runtimeMajor: 1 },
    toolVersionsDigest: digest("tools"),
    lockfileDigest: digest("lockfile"),
    commandPlanDigest: digest("commands"),
    locale: "C",
    timezone: "UTC",
    environmentValuesDigest: digest("environment"),
  };
  const freshness = {
    producedAt: "2026-07-20T00:00:00Z",
    expiresAt: "2026-08-03T00:00:00Z",
    policyDigest: digest("policy"),
    normalizerDigest: digest("normalizer"),
    commandDigest: digest("commands"),
    testDigest: digest("test"),
    oracleDigest: digest("oracle"),
    dependencyDigest: digest("dependency"),
    configurationDigest: digest("configuration"),
    lockfileDigest: environment.lockfileDigest,
    protectedPolicyDigest: digest("protected-policy"),
    candidateDigest,
    environmentDigest: digest(environment),
    producerIdentityDigest: digest("verify-instance"),
    linkedArtifactDigest: digest("linked-artifacts"),
    invalidationTriggers: [] as string[],
  };
  return {
    schema: "baseline-evidence-envelope-v1" as const,
    policyVersion: "baseline-disposition-policy-v1" as const,
    normalizerVersion: "baseline-fingerprint-normalizer-v1" as const,
    normalizedFingerprint,
    findingMode: "deterministic" as const,
    baselineSubject: {
      kind: "immutable_baseline" as const,
      ref: "refs/heads/main",
      digest: baselineDigest,
      treeDigest: digest("baseline-tree"),
      capturedAt: "2026-07-01T00:00:00Z",
      candidateFirstRelevantModificationAt: "2026-07-10T00:00:00Z",
    },
    candidateSubject: {
      kind: "active_candidate" as const,
      batchId: `batch:v1:${"a".repeat(32)}` as const,
      batchDigest: digest("batch"),
      treeDigest: candidateDigest,
      firstRelevantModificationAt: "2026-07-10T00:00:00Z",
    },
    baselineObservations: [1, 2].map((runIndex) => ({
      runIndex,
      outcome: "matched" as const,
      normalizedFingerprint,
      subjectDigest: baselineDigest,
      commandPlanDigest: environment.commandPlanDigest,
      environmentDigest: digest(environment),
      durationMs: 100,
      resourceUnits: 10,
      observedAt: `2026-07-0${runIndex}T00:00:00Z`,
    })),
    candidateObservations: [1, 2].map((runIndex) => ({
      runIndex,
      outcome: "matched" as const,
      normalizedFingerprint,
      subjectDigest: candidateDigest,
      commandPlanDigest: environment.commandPlanDigest,
      environmentDigest: digest(environment),
      durationMs: 100,
      resourceUnits: 10,
      observedAt: `2026-07-1${runIndex}T00:00:00Z`,
    })),
    environmentEquivalence: {
      baseline: environment,
      candidate: environment,
      permittedDifferences: [],
    },
    causalIsolation: {
      candidateDiffDigest: digest("diff"),
      allowlistDigest: digest("allowlist"),
      affectedAreaDigest: digest("affected"),
      callGraphDigest: digest("calls"),
      dataFlowDigest: digest("flow"),
      configurationAnalysisDigest: digest("config-analysis"),
      oracleAnalysisDigest: digest("oracle-analysis"),
      overlappingLocations: [],
      overlappingDependencies: [],
      overlappingConfigurations: [],
      overlappingOracles: [],
      credibleCausalPath: false,
    },
    nonRegression: {
      baselineSeverity: "medium" as const,
      candidateSeverity: "medium" as const,
      baselineOccurrenceCount: 2,
      candidateOccurrenceCount: 2,
      baselineReachability: 1,
      candidateReachability: 1,
      baselineDurationMs: 100,
      candidateDurationMs: 100,
      baselineResourceUnits: 10,
      candidateResourceUnits: 10,
      baselineProtectedRisk: "none" as const,
      candidateProtectedRisk: "none" as const,
      skippedChecks: false,
      weakenedChecks: false,
      filteredChecks: false,
      relabeledChecks: false,
    },
    ledgerAuthority: {
      schema: "baseline-ledger-authority-ref-v1" as const,
      ledgerPath: "openspec/baseline-health.yaml" as const,
      entryDigest: digest("ledger-entry"),
      normalizedFingerprint,
      policyVersion: "baseline-disposition-policy-v1" as const,
      normalizerVersion: "baseline-fingerprint-normalizer-v1" as const,
      immutableSubjectDigest: baselineDigest,
      environmentCohort: "linux+x64+bun-1",
      evidenceDigest: digest("durable-evidence"),
      approvalIdentity: "baseline-review-1",
      approvalTransactionId: "baseline-admission-1",
      approvalCandidateDigest: digest("older-candidate"),
      admittedAt: "2026-07-05T00:00:00Z",
      expiresAt: "2026-08-03T00:00:00Z",
      status: "active" as const,
      replacesBaselineRuns: false,
      permittedEnvironmentDifferences: [],
      invalidationTriggers: [],
    },
    freshness,
  };
}

describe("BaselineEvidenceEnvelopeV1", () => {
  test("normalizes cross-subject identity without batch or producer data", () => {
    const one = buildNormalizedFindingFingerprintV1(fingerprintInput);
    const two = buildNormalizedFindingFingerprintV1({ ...fingerprintInput });
    expect(one).toBe(two);
    expect(() => buildNormalizedFindingFingerprintV1({ ...fingerprintInput, batchDigest: digest("unsafe") } as never)).toThrow("invalid-evidence");
    expect(() => buildNormalizedFindingFingerprintV1({ ...fingerprintInput, location: "/tmp/absolute.test.ts" })).toThrow("invalid-evidence");
  });

  test("builds an immutable digest-bound envelope and rejects mutation", () => {
    const envelope = buildBaselineEvidenceEnvelopeV1(evidenceInput());
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(parseBaselineEvidenceEnvelopeV1(envelope).digest).toBe(envelope.digest);
    expect(() => parseBaselineEvidenceEnvelopeV1({ ...envelope, normalizedFingerprint: digest("forged") })).toThrow("invalid-evidence");
  });

  test("rejects mutable subjects, environment mismatch, and declared invalidation", () => {
    const input = evidenceInput();
    expect(() => buildBaselineEvidenceEnvelopeV1({ ...input, baselineSubject: { ...input.baselineSubject, kind: "active_candidate" } } as never)).toThrow("invalid-evidence");
    expect(() => buildBaselineEvidenceEnvelopeV1({ ...input, environmentEquivalence: { ...input.environmentEquivalence, candidate: { ...input.environmentEquivalence.candidate, cohort: { ...input.environmentEquivalence.candidate.cohort, arch: "arm64" } } } })).toThrow("invalid-evidence");
    expect(() => buildBaselineEvidenceEnvelopeV1({ ...input, freshness: { ...input.freshness, invalidationTriggers: ["oracle_changed"] } })).toThrow("invalid-evidence");
  });
});

export { evidenceInput };
