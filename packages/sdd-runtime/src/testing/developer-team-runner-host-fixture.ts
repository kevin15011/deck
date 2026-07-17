import { expect } from "bun:test";
import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { buildFailureManifestV1, type FailureFindingInputV1 } from "../contracts/failure-manifest";
import { createExecutionDossierV1, reviseExecutionDossierV1, type ExecutionDossierV1 } from "../contracts/execution-dossier";
import { computeFailureDeltaV1 } from "../orchestrator/failure-delta";
import { EXECUTION_V1_FIXTURES } from "../fixtures/execution-v1";
import {
  createInvocationAuthorizationServiceV1,
  type InvocationAuthorizationEnvelopeV1,
} from "../execution/invocation-authorization-service";
import type {
  DeveloperTeamHostExecutionEventV1,
  DeveloperTeamRunnerHostBridgeOptionsV1,
  DeveloperTeamRunnerHostBridgeV1,
} from "../execution/developer-team-runner-host-bridge";
import { createBoundedLocalTelemetrySink, type SafeTelemetrySinkV1 } from "../execution/telemetry";

const sha = (byte: string) => `sha256:${byte.repeat(64)}` as const;
const target = "packages/sdd-runtime";
const blockedTarget = "openspec/changes/runner-capability-standardization";
const taskArtifactPath = "tasks.md";
const receiptDigest = sha("d");

export type RunnerId = "opencode" | "pi";
export type BridgeFactory = (options: Omit<DeveloperTeamRunnerHostBridgeOptionsV1, "runnerId">) => DeveloperTeamRunnerHostBridgeV1;

function makeDossier(withFindings = true): ExecutionDossierV1 {
  const batch = buildApplyBatchContractV1({
    schema: "apply-batch-v1",
    changeId: "bridge-conformance",
    taskIds: ["EG4-T2"],
    dependencies: [],
    ownerRole: "apply-general",
    allowedTargets: [target],
    blockedTargets: [blockedTarget],
    acceptanceObligations: ["REQ-AUTH-004"],
    verificationPlan: [{ stage: "targeted", checkIds: ["bridge-conformance"] }],
    artifactDigests: { [taskArtifactPath]: sha("a") },
    authorizationGrantRef: sha("b"),
    provenance: { actor: "apply-general", issuedAt: "2026-07-16T00:00:00Z" },
  });
  const finding = (severity: "critical" | "low", producedAt: string): FailureFindingInputV1 => ({
    batchId: batch.batchId,
    batchDigest: batch.digest,
    sourcePhase: "verify",
    sourceArtifact: "verify.md",
    severity,
    category: "bridge-conformance",
    rootCause: "implementation",
    requirementIds: ["REQ-AUTH-004"],
    taskIds: ["EG4-T2"],
    locationKeys: [target],
    oracleId: `bridge-${severity}`,
    isSecurityRelevant: false,
    status: "open",
    relationship: "batch_related",
    evidence: [{ kind: "check", checkId: `bridge-${severity}`, artifact: "verify.md" }],
  });
  const manifest = (severity: "critical" | "low", producedAt: string) => buildFailureManifestV1({
    schema: "failure-manifest-v1",
    changeId: batch.changeId,
    batch,
    producerRole: "verify",
    producerInstanceId: "bridge-conformance",
    producedAt,
    findings: withFindings ? [finding(severity, producedAt)] : [],
  });
  const priorManifest = manifest("critical", "2026-07-15T00:00:00Z");
  const currentManifest = manifest("low", "2026-07-16T00:00:00Z");
  return createExecutionDossierV1({
    schema: "execution-dossier-v1",
    batch,
    priorManifest,
    currentManifest,
    delta: computeFailureDeltaV1(priorManifest, currentManifest),
    lane: { schema: "lane-decision-v1", lane: "guarded", riskScore: 1, floorReasons: [], policyOverrides: [], shadowOnly: false },
    verification: { schema: "staged-verification-state-v1", batchId: batch.batchId, stages: [{ stage: "targeted", status: "pending", checkIds: ["bridge-conformance"], evidence: [] }], nextStage: "targeted" },
    causalContext: {
      schema: "causal-context-v1",
      batchDigest: batch.digest,
      priorDecisionDigests: [],
      activeFindingIds: currentManifest.findings.map((entry) => entry.findingId),
      evidenceRefs: [],
      attemptSummaries: [],
    },
    registryIntents: [],
  });
}

export function createRunnerHostFixtureV1(runnerId: RunnerId, factory: BridgeFactory, options: { delegateThrows?: boolean; hostHookSupported?: boolean; bindCapabilityForInvocation?: DeveloperTeamRunnerHostBridgeOptionsV1["bindCapabilityForInvocation"]; dossier?: ExecutionDossierV1; telemetry?: SafeTelemetrySinkV1 } = {}) {
  let randomCounter = runnerId === "opencode" ? 1 : 101;
  let delegationCount = 0;
  const authorizationService = createInvocationAuthorizationServiceV1({
    now: () => new Date("2026-07-16T12:00:00Z"),
    randomBytes: (length) => Uint8Array.from({ length }, () => (randomCounter++ % 251) + 1),
  });
  const bridge = factory({
    authorizationService,
    telemetry: options.telemetry,
    hostHookSupported: options.hostHookSupported,
    bindCapabilityForInvocation: options.bindCapabilityForInvocation,
    delegate: async () => {
      delegationCount += 1;
      if (options.delegateThrows) throw new Error("runner-delegate-failed");
    },
  });
  const dossier = options.dossier ?? makeDossier();

  function authorization(value: ExecutionDossierV1 = dossier): InvocationAuthorizationEnvelopeV1 {
    return authorizationService.issue({
      invocationId: `${runnerId}-execution-1`,
      changeId: value.batch.changeId,
      batchId: value.batch.batchId,
      batchDigest: value.batch.digest,
      role: value.batch.ownerRole,
      taskArtifactDigest: value.batch.artifactDigests[taskArtifactPath]!,
      allowedActions: ["targeted_repair"],
      allowedTargets: [target],
      blockedTargets: [blockedTarget],
      userAuthorizationReceiptDigest: receiptDigest,
    });
  }

  function event(overrides: Partial<DeveloperTeamHostExecutionEventV1> = {}, value: ExecutionDossierV1 = dossier): DeveloperTeamHostExecutionEventV1 {
    return {
      schema: "developer-team-host-execution-event-v1",
      runnerId,
      executionId: `${runnerId}-execution-1`,
      mode: "active",
      legacyInput: EXECUTION_V1_FIXTURES.pipelineInputs[0]!,
      dossier: { kind: "execution-dossier-v1", value },
      authorization: authorization(value),
      taskArtifactPath,
      target,
      userAuthorizationReceiptDigest: receiptDigest,
      policy: { allowedTargets: [target], blockedTargets: [blockedTarget] },
      gitSafety: { state: "not-required", policyDigest: sha("e") },
      gitEffect: { kind: "non-destructive" },
      governance: { kind: "none" },
      ...overrides,
    };
  }

  return { authorizationService, bridge, event, dossier, authorization, delegationCount: () => delegationCount };
}

export async function assertBridgeValidActive(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory);
  const outcome = await fixture.bridge.execute(fixture.event());
  expect(outcome.code).toBe("executed");
  expect(outcome.effect).toEqual({ invoked: true });
  expect(outcome.composition?.plan.decision?.action).toBe("targeted_repair");
  expect(fixture.delegationCount()).toBe(1);
}

export async function assertBridgeMissingAuthorization(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory);
  const outcome = await fixture.bridge.execute(fixture.event({ authorization: null }));
  expect(outcome.code).toBe("modification-not-authorized");
  expect(outcome.authorizationCode).toBe("AUTHZ_MISSING");
  expect(outcome.effect).toEqual({ invoked: false, reasonCode: "modification-not-authorized" });
  expect(fixture.delegationCount()).toBe(0);
}

export async function assertBridgeGitMismatch(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory);
  const outcome = await fixture.bridge.execute(fixture.event({
    gitSafety: { state: "confirmed", commandDigest: sha("f"), confirmationReceiptDigest: sha("1") },
    gitEffect: { kind: "destructive", commandDigest: sha("0") },
  }));
  expect(outcome.code).toBe("modification-not-authorized");
  expect(outcome.effect).toEqual({ invoked: false, reasonCode: "modification-not-authorized" });
  expect(fixture.delegationCount()).toBe(0);
}

export async function assertBridgeShadow(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory);
  const outcome = await fixture.bridge.execute(fixture.event({ mode: "shadow" }));
  expect(outcome.code).toBe("shadow-complete");
  expect(outcome.composition?.authoritative).toBe("legacy");
  expect(outcome.composition?.comparison.v1Action).toBe("targeted_repair");
  expect(fixture.delegationCount()).toBe(0);
}

export async function assertBridgeShadowTelemetry(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const telemetry = createBoundedLocalTelemetrySink(1);
  const fixture = createRunnerHostFixtureV1(runnerId, factory, { telemetry });
  const outcome = await fixture.bridge.execute(fixture.event({ mode: "shadow" }));
  expect(outcome.code).toBe("shadow-complete");
  expect(telemetry.snapshot()).toEqual([
    expect.objectContaining({
      schema: "safe-execution-telemetry-v1",
      event: "shadow-compared",
      runner: runnerId,
      phase: "apply",
      riskTier: "low",
      wouldBeLane: "guarded",
      outcomeCode: "shadow-completed-targeted_repair",
      count: 1,
    }),
  ]);
  expect(fixture.delegationCount()).toBe(0);
}

export async function assertBridgeShadowTelemetryFailure(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  let emitCalls = 0;
  const fixture = createRunnerHostFixtureV1(runnerId, factory, {
    telemetry: {
      async emit() {
        emitCalls += 1;
        throw new Error("TELEMETRY_SECRET_MUST_NOT_ESCAPE");
      },
    },
  });
  const outcome = await fixture.bridge.execute(fixture.event({ mode: "shadow" }));
  expect(emitCalls).toBe(1);
  expect(outcome.code).toBe("shadow-complete");
  expect(JSON.stringify(outcome)).not.toContain("TELEMETRY_SECRET_MUST_NOT_ESCAPE");
  expect(fixture.delegationCount()).toBe(0);
}

export async function assertBridgeLegacy(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory);
  const outcome = await fixture.bridge.execute(fixture.event({
    mode: "legacy",
    dossier: { kind: "none" },
    authorization: null,
    taskArtifactPath: null,
    target: null,
    userAuthorizationReceiptDigest: null,
    policy: { allowedTargets: [], blockedTargets: [] },
    gitSafety: { state: "not-applicable", rationaleCode: "LEGACY_AUTHORITY" },
    gitEffect: null,
  }));
  expect(outcome.code).toBe("legacy-complete");
  expect(outcome.composition?.mode).toBe("legacy");
  expect(outcome.composition?.authoritative).toBe("legacy");
  expect(fixture.delegationCount()).toBe(0);
}

export async function assertBridgeNonDelegatingAction(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory);
  const noFindings = makeDossier(false);
  const outcome = await fixture.bridge.execute(fixture.event({ authorization: fixture.authorization(noFindings) }, noFindings));
  expect(outcome.code).toBe("effect-not-permitted");
  expect(outcome.composition?.plan.decision?.action).toBe("advance_verification");
  expect(fixture.delegationCount()).toBe(0);
}

export async function assertBridgeTaskMismatch(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory);
  const outcome = await fixture.bridge.execute(fixture.event({ taskArtifactPath: "missing-task.md" }));
  expect(outcome.code).toBe("invalid-evidence");
  expect(outcome.composition).toBeUndefined();
  expect(fixture.delegationCount()).toBe(0);
}

export async function assertBridgeCapabilityMismatch(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory, { bindCapabilityForInvocation: (descriptor) => ({ ...descriptor, target: "packages/core" }) });
  const outcome = await fixture.bridge.execute(fixture.event());
  expect(outcome.code).toBe("modification-not-authorized");
  expect(outcome.effect).toEqual({ invoked: false, reasonCode: "modification-not-authorized" });
  expect(fixture.delegationCount()).toBe(0);
}

export async function assertBridgeAdapterError(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory, { delegateThrows: true });
  const outcome = await fixture.bridge.execute(fixture.event());
  expect(outcome.code).toBe("adapter-error");
  expect(outcome.effect).toEqual({ invoked: false, reasonCode: "adapter-error" });
  expect(fixture.delegationCount()).toBe(1);
}

export async function assertBridgeUnsupportedHook(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory, { hostHookSupported: false });
  const outcome = await fixture.bridge.execute(fixture.event());
  expect(fixture.bridge.capabilities).toEqual({ invocationAuthorizationV1: false, perExecutionDossierV1: false, targetedRepairCapabilityV1: false });
  expect(outcome.code).toBe("host-hook-unsupported");
  expect(outcome.effect).toEqual({ invoked: false, reasonCode: "effect-not-permitted" });
  expect(fixture.delegationCount()).toBe(0);
}

export async function assertBridgeAuthorizationReplay(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory);
  const event = fixture.event();
  const first = await fixture.bridge.execute(event);
  const replay = await fixture.bridge.execute(event);
  expect(first.code).toBe("executed");
  expect(replay.code).toBe("modification-not-authorized");
  expect(replay.authorizationCode).toBe("AUTHZ_REPLAYED");
  expect(replay.effect).toEqual({ invoked: false, reasonCode: "modification-not-authorized" });
  expect(fixture.delegationCount()).toBe(1);
}

export async function assertBridgeAuthorizationTamper(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory);
  const authorization = fixture.authorization();
  const replacement = authorization.proof.value.startsWith("0") ? "1" : "0";
  const tampered: InvocationAuthorizationEnvelopeV1 = {
    ...authorization,
    proof: {
      ...authorization.proof,
      value: `${replacement}${authorization.proof.value.slice(1)}`,
    },
  };
  const outcome = await fixture.bridge.execute(fixture.event({ authorization: tampered }));
  expect(outcome.code).toBe("modification-not-authorized");
  expect(outcome.authorizationCode).toBe("AUTHZ_PROOF_INVALID");
  expect(outcome.effect).toEqual({ invoked: false, reasonCode: "modification-not-authorized" });
  expect(fixture.delegationCount()).toBe(0);
}

export async function assertBridgeRevisedDossierHistory(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const fixture = createRunnerHostFixtureV1(runnerId, factory);
  const revised = reviseExecutionDossierV1(fixture.dossier, {});
  const missingHistory = await fixture.bridge.execute(fixture.event({
    dossier: { kind: "execution-dossier-v1", value: revised },
    authorization: fixture.authorization(revised),
  }, revised));
  expect(missingHistory.code).toBe("invalid-evidence");
  expect(fixture.delegationCount()).toBe(0);

  const outcome = await fixture.bridge.execute(fixture.event({
    dossier: { kind: "execution-dossier-v1", value: revised, history: [fixture.dossier] },
    authorization: fixture.authorization(revised),
  }, revised));
  expect(outcome.code).toBe("executed");
  expect(outcome.composition?.plan.dossier?.revision).toBe(2);
  expect(outcome.composition?.plan.dossierHistory).toEqual([fixture.dossier]);
  expect(fixture.delegationCount()).toBe(1);
}
