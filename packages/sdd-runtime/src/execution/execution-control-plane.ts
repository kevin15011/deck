import {
  assertDigest,
  assertExactKeys,
  assertId,
  codeValue,
  deepFreeze,
  denseArray,
  enumValue,
  sha256Digest,
  stringArray,
  timestampValue,
  type Sha256Digest,
} from "../contracts/canonical";
import type { ApplyBatchContractV1, BatchId, VerificationStage } from "../contracts/apply-batch";
import {
  parseBlockingRepairProjectionV1,
  validateBlockingRepairProjectionAtEffectBoundaryV1,
  type BlockingRepairProjectionV1,
  type RetryLedgerAuthorityV1,
} from "../contracts/blocking-repair-projection";
import {
  parseCausalContextV1,
  type CausalContextV1,
} from "../contracts/causal-context";
import {
  parseExecutionDossierV1,
  parseExecutionDossierHistoryV1,
  type ExecutionDossierV1,
} from "../contracts/execution-dossier";
import {
  parseExecutionDecisionV1,
  type ExecutionDecisionV1,
  type TerminalGuardResultV1,
} from "../contracts/execution-decision";
import type {
  RepairIncident,
} from "../contracts/repair-incident";
import {
  parseRegistryIntentV1,
  type RegistryIntentV1,
} from "../contracts/registry-intent";
import { parseRegistryAtomicCommitReceiptV1, type RegistryAtomicCommitReceiptV1 } from "../contracts/registry-atomic-commit";
import { isTrustedRegistryCoordinatorV1 } from "../artifact-state/registry-coordinator";
import {
  buildStagedVerificationStateV1,
  type StageStatus,
  type StagedVerificationStateV1,
  type VerificationOmissionEvidenceV1,
} from "../contracts/verification-state";
import {
  parseFailureManifestV1,
  type FailureManifestV1,
  type SafeEvidenceRefV1,
} from "../contracts/failure-manifest";
import {
  parseFindingDispositionEnvelopeV1,
  type DispositionClassificationInputV1,
  type FindingDispositionEnvelopeV1,
  type ProtectedRiskAuthorityContextV1,
} from "../contracts/finding-disposition";
import {
  parseRoutingDecisionV1,
  type RoutingDecisionV1,
  type RoutingPolicyInputV1,
} from "../contracts/routing-decision";
import {
  parseExecutionConvergenceDossierWithAuthorityV1,
  type ConvergenceAuthorityRecordSetV1,
  type ConvergenceTransitionReceiptV1,
  type ExecutionConvergenceDossierV1,
} from "../contracts/execution-convergence";
import {
  parseQaAuthorityBindingV1,
  parseQaAuthoritySnapshotV1,
  parseCandidateRefV1,
  validateCandidateRefV1,
  type CandidateRefV1,
  type QaAuthorityBindingV1,
  type QaAuthoritySnapshotV1,
} from "../contracts/qa-authority";
import {
  joinVerificationStageExecutionV1,
  parseVerificationCheckResultV1,
  parseVerificationStageExecutionPlanV1,
  parseVerificationWaveExecutionReceiptV1,
  type VerificationCheckResultV1,
  type VerificationStageExecutionJoinV1,
  type VerificationStageExecutionPlanV1,
  type VerificationWaveExecutionReceiptV1,
} from "../contracts/verification-stage-execution";
import {
  parseBroadCausalDispositionEnvelopeV1,
  parseReviewConvergenceResultV1,
  type BroadCausalDispositionEnvelopeV1,
  type ReviewConvergenceResultV1,
} from "../orchestrator/broad-causal-disposition";
import { decideQualityReadinessV1, type QualityReadinessInputV1 } from "../orchestrator/quality-readiness";
import {
  evaluateExecutionDecisionV1,
  resolveTerminalGovernanceGuardV1,
} from "../orchestrator/decision-kernel";
import {
  adaptDossierToRepairIncidentV1,
  type RepairGovernanceConfig,
} from "../orchestrator/repair-loop-governance";
import {
  evaluateFreshnessPolicyV1,
  projectCausalContextForRoleV1,
  type FreshReviewTriggerV1,
  type FreshnessPolicyInputV1,
} from "../orchestrator/freshness-policy";
import {
  transitionStagedVerificationV1,
  validateScopedVerificationAcceptanceV1,
  validateVerificationAcceptanceV1,
  type MandatoryBroadReasonV1,
  type StagedVerificationPolicyV1,
} from "../orchestrator/staged-verification";
import {
  parseTargetedRepairCapabilityDescriptorV1,
  type TargetedRepairCapabilityDescriptorV1,
} from "./execution-capability";

import {
  parseQualityDispositionEnvelopeV1,
  type QualityDispositionEnvelopeV1,
} from "../contracts/baseline-evidence";
import { decideQaNextActionV1 } from "./qa-execution-authority";
export type DecisionKernelModeV1 = "legacy" | "shadow" | "active";
export type ExecutionAuthorityStateV1 =
  | { state: "not-applicable"; rationaleCode: "LEGACY_AUTHORITY" }
  | {
      state: "authorized";
      capabilityDigest: Sha256Digest;
      reference: { validation: "accepted" };
    }
  | { state: "missing"; rationaleCode: "AUTHZ_MISSING" }
  | {
      state: "invalid";
      rationaleCode: "AUTHZ_INVALID";
      rejectionCode: string;
      reference: { validation: "rejected" } | null;
    };
export type GitSafetyStateV1 =
  | { state: "not-applicable"; rationaleCode: "LEGACY_AUTHORITY" }
  | { state: "not-required"; policyDigest: Sha256Digest }
  | {
      state: "confirmed";
      commandDigest: Sha256Digest;
      confirmationReceiptDigest: Sha256Digest;
    }
  | {
      state: "confirmation-required";
      commandDigest: Sha256Digest;
      rationaleCode: "GIT_SAFETY_CONFIRMATION_REQUIRED";
    }
  | { state: "invalid"; rationaleCode: "GIT_SAFETY_CONFIRMATION_INVALID" };
export type TerminalGovernanceContextV1 =
  | { kind: "none" }
  | {
      kind: "repair-incident";
      incident: RepairIncident;
      config: RepairGovernanceConfig | "default";
    };
export interface InvalidExecutionInputIdentityV1 {
  readonly boundary: "execution-composition";
  readonly valueClass:
    "nullish" | "primitive" | "array" | "plain-record" | "unclassifiable";
  readonly keyCount: "none" | "one" | "many" | "unknown";
  readonly version: "unsupported" | "unknown";
  readonly failure:
    | "unsupported-version"
    | "exact-keys"
    | "batch-reference"
    | "unsafe-content"
    | "cyclic"
    | "prototype"
    | "identity"
    | "malformed"
    | "unknown";
}
type SafeAuthority = Exclude<
  ExecutionAuthorityStateV1,
  { state: "not-applicable" }
>;
type SafeGit = Exclude<GitSafetyStateV1, { state: "not-applicable" }>;
type SafeBinding = { kind: "none" } | TargetedRepairCapabilityDescriptorV1;
export type ExecutionReplayRecordV1 =
  | {
      readonly schema: "execution-replay-record-v1";
      readonly outcome: "legacy";
      readonly mode: "legacy";
      readonly policyVersion: "execution-decision-policy-v1";
      readonly inputDigest: Sha256Digest;
    }
  | {
      readonly schema: "execution-replay-record-v1";
      readonly outcome: "valid";
      readonly mode: "shadow" | "active";
      readonly policyVersion: "execution-decision-policy-v1";
      readonly dossier: ExecutionDossierV1;
      readonly dossierHistory?: readonly ExecutionDossierV1[];
      readonly authority: SafeAuthority;
      readonly gitSafety: SafeGit;
      readonly terminalGuard: TerminalGuardResultV1;
      readonly effectBinding: SafeBinding;
      readonly inputDigest: Sha256Digest;
    }
  | {
      readonly schema: "execution-replay-record-v1";
      readonly outcome: "invalid";
      readonly mode: DecisionKernelModeV1;
      readonly policyVersion: "execution-decision-policy-v1";
      readonly invalidInput: InvalidExecutionInputIdentityV1;
      readonly inputDigest: Sha256Digest;
    };
export interface ExecutionPlanV1 {
  readonly mode: DecisionKernelModeV1;
  readonly inputDigest: Sha256Digest;
  readonly replayRecord: ExecutionReplayRecordV1;
  readonly decision?: ExecutionDecisionV1;
  readonly dossier?: ExecutionDossierV1;
  readonly dossierHistory?: readonly ExecutionDossierV1[];
  readonly reasonCode?: "invalid-evidence";
  /** Active scheduling must carry the control-plane authority binding. */
  readonly qaAuthorityDigest?: Sha256Digest;
  /** Convergence authority is additive so non-QA active effects retain their existing plan contract. */
  readonly qaExecutionAuthority?: QaAuthoritySnapshotV1;
  replay(): ExecutionDecisionV1 | undefined;
}

export type ExecutionControlRoleV1 = "verify" | "review";

export interface ExecutionRoleInvocationV1 {
  readonly schema: "execution-role-invocation-v1";
  readonly invocationId: `role-invocation:v1:${string}`;
  readonly mode: "shadow" | "active";
  readonly role: ExecutionControlRoleV1;
  readonly agentInstanceId: string;
  readonly batchId: BatchId;
  readonly stage?: VerificationStage;
  readonly checkIds: readonly string[];
  readonly requiresFreshAgent: boolean;
  readonly rationaleCodes: readonly string[];
  readonly causalContext: CausalContextV1;
  readonly qaAuthority: QaAuthorityBindingV1;
  readonly verificationPlan?: VerificationStageExecutionPlanV1;
  readonly dependencies: {
    readonly batchDigest: Sha256Digest;
    readonly dossierDigest: Sha256Digest;
    readonly decisionDigest: Sha256Digest;
    readonly verificationDigest: Sha256Digest;
    readonly qaAuthorityDigest: Sha256Digest;
  };
}

export interface ExecutionRoleSchedulingInputV1 {
  readonly role: ExecutionControlRoleV1;
  readonly agentInstanceId: string;
  readonly freshness: FreshnessPolicyInputV1;
  readonly currentCandidate?: CandidateRefV1;
  readonly verificationPlan?: VerificationStageExecutionPlanV1;
}

export type ExecutionRoleScheduleResultV1 =
  | {
      readonly code: "scheduled" | "shadow-only";
      readonly invocation: ExecutionRoleInvocationV1;
    }
  | {
      readonly code: "not-required" | "invalid-evidence" | "verification-evidence-required" | "lane-floor-violation" | "qa-authority-required";
      readonly rationaleCodes: readonly string[];
      readonly requiredLane?: "full_sdd";
    };

export interface ExecutionRoleResultEnvelopeV1 {
  readonly schema: "execution-role-result-v1";
  readonly digest: Sha256Digest;
  readonly invocationId: ExecutionRoleInvocationV1["invocationId"];
  readonly role: ExecutionControlRoleV1;
  readonly agentInstanceId: string;
  readonly batchId: BatchId;
  readonly stage?: VerificationStage;
  readonly status: StageStatus;
  readonly evidence: readonly SafeEvidenceRefV1[];
  readonly omission?: VerificationOmissionEvidenceV1;
  readonly verificationCheckResults?: readonly VerificationCheckResultV1[];
  readonly verificationWaveReceipts?: readonly VerificationWaveExecutionReceiptV1[];
  readonly failureManifest?: FailureManifestV1;
  readonly reviewConvergence?: ReviewConvergenceResultV1;
  readonly broadCausalDisposition?: BroadCausalDispositionEnvelopeV1;
  readonly qualityDisposition?: QualityDispositionEnvelopeV1;
  readonly provenance: {
    readonly role: ExecutionControlRoleV1;
    readonly agentInstanceId: string;
    readonly issuedAt: string;
  };
  readonly dependencies: ExecutionRoleInvocationV1["dependencies"];
  readonly registryIntents: readonly RegistryIntentV1[];
}

export type ExecutionRoleResultConsumptionV1 =
  | {
      readonly code: "accepted" | "shadow-observed";
      readonly result: ExecutionRoleResultEnvelopeV1;
      readonly verification?: StagedVerificationStateV1;
      readonly verificationJoin?: VerificationStageExecutionJoinV1;
      readonly phaseStatus: "passed" | "passed_with_warnings";
      readonly registryIntents: readonly RegistryIntentV1[];
    }
  | {
      readonly code: "invalid-evidence" | "verification-evidence-required" | "lane-floor-violation" | "role-result-failed";
      readonly rationaleCodes: readonly string[];
    };

export interface ExecutionRegistryCoordinatorPortV1 {
  commit(intent: unknown): Promise<{
    readonly code: "committed" | "replayed" | "distributed-compatible" | "invalid-evidence" | "registry-intent-conflict" | "registry-recovery-required";
    readonly intentId?: string;
  }>;
  commitAll(intents: readonly unknown[]): Promise<readonly {
    readonly code: "committed" | "replayed" | "distributed-compatible" | "invalid-evidence" | "registry-intent-conflict" | "registry-recovery-required";
    readonly intentId?: string;
    readonly transactionId?: string;
    readonly stateDigest?: Sha256Digest;
    readonly eventsDigest?: Sha256Digest;
  }[]>;
  commitAtomicChain(intents: readonly unknown[]): Promise<{
    readonly outcomes: readonly {
      readonly code: "committed" | "replayed" | "distributed-compatible" | "invalid-evidence" | "registry-intent-conflict" | "registry-recovery-required";
      readonly intentId?: string;
      readonly transactionId?: string;
      readonly stateDigest?: Sha256Digest;
      readonly eventsDigest?: Sha256Digest;
    }[];
    readonly receipt?: unknown;
  }>;
}

export interface ExecutionRegistryCommitResultV1 {
  readonly status: "not-applicable" | "committed" | "compatible" | "blocked";
  readonly outcomes: readonly {
    readonly intentId: string;
    readonly code: "committed" | "replayed" | "distributed-compatible" | "invalid-evidence" | "registry-intent-conflict" | "registry-recovery-required";
  }[];
  readonly receipt?: RegistryAtomicCommitReceiptV1;
}

export async function commitExecutionRegistryIntentsV1(
  plan: ExecutionPlanV1,
  coordinator: ExecutionRegistryCoordinatorPortV1,
  readinessValue?: unknown,
): Promise<ExecutionRegistryCommitResultV1> {
  if (plan.mode !== "active" || !plan.dossier) return deepFreeze({ status: "not-applicable", outcomes: [] });
  const safePlan = rolePlan(plan);
  if (!safePlan || safePlan.mode !== "active") return deepFreeze({ status: "blocked", outcomes: [] });
  const dossier = safePlan.dossier;
  if (dossier.registryIntents.length === 0) return deepFreeze({ status: "not-applicable", outcomes: [] });
  if (safePlan.qaExecutionAuthority?.lifecycle !== "registry_commit_pending") {
    return deepFreeze({ status: "blocked", outcomes: [] });
  }
  try {
    const readiness = decideQualityReadinessV1(readinessValue as QualityReadinessInputV1);
    if (
      readiness.kind !== "registry_commit_ready" ||
      readiness.candidateDigest !== safePlan.qaExecutionAuthority.candidateDigest ||
      JSON.stringify(readiness.orderedIntentDigests) !== JSON.stringify(dossier.registryIntents.map((intent) => intent.digest))
    ) return deepFreeze({ status: "blocked", outcomes: [] });
  } catch {
    return deepFreeze({ status: "blocked", outcomes: [] });
  }
  if (!isTrustedRegistryCoordinatorV1(coordinator)) return deepFreeze({ status: "blocked", outcomes: [] });
  let atomicCommit: Awaited<ReturnType<ExecutionRegistryCoordinatorPortV1["commitAtomicChain"]>>;
  try { atomicCommit = await coordinator.commitAtomicChain(dossier.registryIntents); }
  catch {
    return deepFreeze({
      status: "blocked",
      outcomes: [{ intentId: dossier.registryIntents[0]!.intentId, code: "registry-recovery-required" as const }],
    });
  }
  const committed = atomicCommit.outcomes;
  if (committed.length !== dossier.registryIntents.length) {
    return deepFreeze({
      status: "blocked",
      outcomes: [{ intentId: dossier.registryIntents[0]!.intentId, code: "invalid-evidence" as const }],
    });
  }
  const outcomes = dossier.registryIntents.map((intent, index) => {
    const outcome = committed[index]!;
    const code = outcome.intentId !== intent.intentId ? "invalid-evidence" as const : outcome.code;
    return deepFreeze({ intentId: intent.intentId, code });
  });
  if (outcomes.some((outcome) => outcome.code !== "committed" && outcome.code !== "replayed" && outcome.code !== "distributed-compatible")) {
    return deepFreeze({ status: "blocked", outcomes });
  }
  let receipt: RegistryAtomicCommitReceiptV1;
  try { receipt = parseRegistryAtomicCommitReceiptV1(atomicCommit.receipt); }
  catch { return deepFreeze({ status: "blocked", outcomes }); }
  if (
    receipt.changeId !== dossier.batch.changeId ||
    JSON.stringify(receipt.orderedIntentIds) !== JSON.stringify(dossier.registryIntents.map((intent) => intent.intentId)) ||
    JSON.stringify(receipt.orderedIntentDigests) !== JSON.stringify(dossier.registryIntents.map((intent) => intent.digest)) ||
    receipt.base.stateDigest !== safePlan.qaExecutionAuthority.registryBase.stateDigest ||
    receipt.base.eventsDigest !== safePlan.qaExecutionAuthority.registryBase.eventsDigest ||
    (receipt.outcome === "distributed-compatible") !== outcomes.some((outcome) => outcome.code === "distributed-compatible") ||
    receipt.outcome !== "distributed-compatible" && committed.some((outcome) =>
      outcome.transactionId !== receipt.transactionId || outcome.stateDigest !== receipt.next.stateDigest || outcome.eventsDigest !== receipt.next.eventsDigest
    )
  ) return deepFreeze({ status: "blocked", outcomes });
  return deepFreeze({
    status: outcomes.some((outcome) => outcome.code === "distributed-compatible") ? "compatible" : "committed",
    outcomes,
    receipt,
  });
}

function rolePlan(plan: ExecutionPlanV1): {
  mode: "shadow" | "active";
  dossier: ExecutionDossierV1;
  dossierHistory?: readonly ExecutionDossierV1[];
  decision: ExecutionDecisionV1;
  qaExecutionAuthority?: QaAuthoritySnapshotV1;
} | undefined {
  try {
    const record = parseExecutionReplayRecordV1(plan.replayRecord);
    if (
      record.outcome !== "valid" ||
      record.mode !== plan.mode ||
      record.inputDigest !== plan.inputDigest ||
      !plan.dossier ||
      !plan.decision ||
      plan.dossier.digest !== record.dossier.digest
    ) return undefined;
    const decision = replayExecutionDecisionV1(record);
    if (!decision || decision.digest !== plan.decision.digest) return undefined;
    const qaExecutionAuthority = plan.qaExecutionAuthority === undefined
      ? undefined
      : parseQaAuthoritySnapshotV1(plan.qaExecutionAuthority);
    if (qaExecutionAuthority !== undefined && (
      qaExecutionAuthority.changeId !== record.dossier.batch.changeId ||
      qaExecutionAuthority.batchId !== record.dossier.batch.batchId ||
      qaExecutionAuthority.batchDigest !== record.dossier.batch.digest ||
      qaExecutionAuthority.executionDossierDigest !== record.dossier.digest ||
      qaExecutionAuthority.stagedVerificationDigest !== record.dossier.verification.digest
    )) return undefined;
    return {
      mode: record.mode,
      dossier: record.dossier,
      ...(record.dossierHistory === undefined ? {} : { dossierHistory: record.dossierHistory }),
      decision,
      ...(qaExecutionAuthority === undefined ? {} : { qaExecutionAuthority }),
    };
  } catch {
    return undefined;
  }
}

export function bindExecutionPlanQaAuthorityV1(
  plan: ExecutionPlanV1,
  snapshotValue: unknown,
): ExecutionPlanV1 {
  const safePlan = rolePlan(plan);
  if (!safePlan || safePlan.mode !== "active") throw new Error("QA_AUTHORITY_ACTIVE_PLAN_REQUIRED");
  const snapshot = parseQaAuthoritySnapshotV1(snapshotValue);
  if (
    snapshot.changeId !== safePlan.dossier.batch.changeId ||
    snapshot.batchId !== safePlan.dossier.batch.batchId ||
    snapshot.batchDigest !== safePlan.dossier.batch.digest ||
    snapshot.executionDossierDigest !== safePlan.dossier.digest ||
    snapshot.stagedVerificationDigest !== safePlan.dossier.verification.digest
  ) throw new Error("QA_AUTHORITY_PLAN_MISMATCH");
  return freeze({
    ...plan,
    qaExecutionAuthority: snapshot,
    qaAuthorityDigest: qaAuthorityPlanDigest(safePlan.dossier, safePlan.decision, snapshot),
  });
}

function qaAuthorityPlanDigest(
  dossier: ExecutionDossierV1,
  decision: ExecutionDecisionV1,
  snapshot?: QaAuthoritySnapshotV1,
): Sha256Digest {
  return sha256Digest({
    schema: "qa-execution-authority-binding-v1",
    batchDigest: dossier.batch.digest,
    dossierDigest: dossier.digest,
    decisionDigest: decision.digest,
    verificationDigest: dossier.verification.digest,
    ...(snapshot === undefined ? {} : { snapshotDigest: snapshot.digest }),
  });
}

function invocationId(payload: Omit<ExecutionRoleInvocationV1, "invocationId">): ExecutionRoleInvocationV1["invocationId"] {
  return `role-invocation:v1:${sha256Digest(payload).slice(7, 39)}`;
}

function derivedFreshReviewTriggers(dossier: ExecutionDossierV1): FreshReviewTriggerV1[] {
  const triggers = new Set<FreshReviewTriggerV1>();
  const mappings: ReadonlyArray<readonly [string, FreshReviewTriggerV1]> = [
    ["INCIDENT", "incident"],
    ["MATERIAL_REPAIR", "material_repair"],
    ["SECURITY_FLOOR", "security_finding"],
    ["AUTHORIZATION_FLOOR", "authorization_rejection"],
    ["PUBLIC_API_FLOOR", "public_contract_repair"],
    ["MIGRATION_FLOOR", "migration_repair"],
    ["CROSS_PACKAGE_ARCHITECTURE_FLOOR", "cross_package_repair"],
    ["MULTI_PACKAGE", "multi_package_repair"],
    ["HIGH_RISK_FLOOR", "high_risk_repair"],
    ["CRITICAL_RISK_FLOOR", "high_risk_repair"],
  ];
  for (const [reason, trigger] of mappings) if (dossier.lane.floorReasons.includes(reason)) triggers.add(trigger);
  return [...triggers];
}

function derivedMandatoryBroadReasons(dossier: ExecutionDossierV1): MandatoryBroadReasonV1[] {
  const reasons = new Set<MandatoryBroadReasonV1>();
  const mappings: ReadonlyArray<readonly [string, MandatoryBroadReasonV1]> = [
    ["SECURITY_FLOOR", "security"],
    ["AUTHORIZATION_FLOOR", "authorization"],
    ["DATA_LOSS_FLOOR", "data_loss"],
    ["MIGRATION_FLOOR", "migration"],
    ["DESTRUCTIVE_FLOOR", "destructive"],
    ["PUBLIC_API_FLOOR", "public_api"],
    ["CROSS_PACKAGE_ARCHITECTURE_FLOOR", "cross_package_architecture"],
    ["INCIDENT", "incident"],
    ["MATERIAL_REPAIR", "material_repair"],
  ];
  for (const [reason, mandatory] of mappings) if (dossier.lane.floorReasons.includes(reason)) reasons.add(mandatory);
  return [...reasons];
}

export function parseExecutionRoleInvocationV1(value: unknown): ExecutionRoleInvocationV1 {
  assertExactKeys(value, [
    "schema", "invocationId", "mode", "role", "agentInstanceId", "batchId", "stage", "checkIds",
    "requiresFreshAgent", "rationaleCodes", "causalContext", "qaAuthority", "verificationPlan", "dependencies",
  ], "role invocation");
  if (value.schema !== "execution-role-invocation-v1") throw new Error("unsupported-contract-version");
  assertId(value.invocationId, "role-invocation:v1:", "role invocation.invocationId");
  assertId(value.batchId, "batch:v1:", "role invocation.batchId");
  const mode = enumValue(value.mode, ["shadow", "active"] as const, "role invocation.mode");
  const role = enumValue(value.role, ["verify", "review"] as const, "role invocation.role");
  const stage = value.stage === undefined
    ? undefined
    : enumValue(value.stage, ["targeted", "affected_area", "broad"] as const, "role invocation.stage");
  if ((role === "verify") !== (stage !== undefined)) throw new Error("invalid-evidence: role invocation.stage");
  if (typeof value.requiresFreshAgent !== "boolean") throw new Error("invalid-evidence: role invocation.requiresFreshAgent");
  const qaAuthority = parseQaAuthorityBindingV1(value.qaAuthority);
  if (mode === "active" && qaAuthority.kind !== "convergence" || mode === "shadow" && qaAuthority.kind !== "legacy_compatibility") {
    throw new Error("invalid-evidence: role invocation.qaAuthority");
  }
  assertExactKeys(value.dependencies, ["batchDigest", "dossierDigest", "decisionDigest", "verificationDigest", "qaAuthorityDigest"], "role invocation.dependencies");
  const dependencies = {
    batchDigest: value.dependencies.batchDigest,
    dossierDigest: value.dependencies.dossierDigest,
    decisionDigest: value.dependencies.decisionDigest,
    verificationDigest: value.dependencies.verificationDigest,
    qaAuthorityDigest: value.dependencies.qaAuthorityDigest,
  } as ExecutionRoleInvocationV1["dependencies"];
  for (const [name, digest] of Object.entries(dependencies)) assertDigest(digest, `role invocation.dependencies.${name}`);
  const expectedAuthorityDigest = qaAuthority.kind === "convergence"
    ? qaAuthority.snapshot.digest
    : sha256Digest(qaAuthority);
  if (dependencies.qaAuthorityDigest !== expectedAuthorityDigest) throw new Error("invalid-evidence: role invocation.qaAuthority");
  if (qaAuthority.kind === "convergence") {
    const action = decideQaNextActionV1({ snapshot: qaAuthority.snapshot });
    if (
      qaAuthority.snapshot.batchId !== value.batchId ||
      qaAuthority.snapshot.batchDigest !== dependencies.batchDigest ||
      qaAuthority.snapshot.executionDossierDigest !== dependencies.dossierDigest ||
      qaAuthority.snapshot.stagedVerificationDigest !== dependencies.verificationDigest ||
      role === "verify" && (action.kind !== "run_verify_stage" || action.stage !== stage) ||
      role === "review" && action.kind !== "run_review"
    ) throw new Error("invalid-evidence: role invocation.qaAuthority");
  }
  const checkIds = stringArray(value.checkIds, "role invocation.checkIds", true);
  const verificationPlan = value.verificationPlan === undefined
    ? undefined
    : parseVerificationStageExecutionPlanV1(value.verificationPlan);
  if (mode === "active" && role === "verify" && verificationPlan === undefined) {
    throw new Error("invalid-evidence: role invocation.verificationPlan");
  }
  if (role === "review" && verificationPlan !== undefined) throw new Error("invalid-evidence: role invocation.verificationPlan");
  if (verificationPlan !== undefined && (
    verificationPlan.stage !== stage ||
    verificationPlan.qaAuthorityDigest !== dependencies.qaAuthorityDigest ||
    qaAuthority.kind === "convergence" && (
      verificationPlan.generation !== qaAuthority.snapshot.generation ||
      verificationPlan.implementationSubjectDigest !== qaAuthority.snapshot.implementationSubjectDigest ||
      verificationPlan.dependencySetDigest !== qaAuthority.snapshot.dependencySetDigest
    ) ||
    JSON.stringify(verificationPlan.checks.map((check) => check.checkId)) !== JSON.stringify(checkIds)
  )) throw new Error("invalid-evidence: role invocation.verificationPlan");
  const causalContext = parseCausalContextV1(value.causalContext);
  if (causalContext.batchDigest !== dependencies.batchDigest) throw new Error("invalid-evidence: role invocation.causalContext");
  const payload = {
    schema: "execution-role-invocation-v1" as const,
    mode,
    role,
    agentInstanceId: codeValue(value.agentInstanceId, "role invocation.agentInstanceId"),
    batchId: value.batchId as BatchId,
    ...(stage === undefined ? {} : { stage }),
    checkIds,
    requiresFreshAgent: value.requiresFreshAgent,
    rationaleCodes: stringArray(value.rationaleCodes, "role invocation.rationaleCodes", true),
    causalContext,
    qaAuthority,
    ...(verificationPlan === undefined ? {} : { verificationPlan }),
    dependencies,
  };
  if (value.invocationId !== invocationId(payload)) throw new Error("invalid-evidence: role invocation identity");
  return deepFreeze({ ...payload, invocationId: value.invocationId }) as ExecutionRoleInvocationV1;
}

export function scheduleExecutionRoleInvocationV1(
  plan: ExecutionPlanV1,
  input: ExecutionRoleSchedulingInputV1,
): ExecutionRoleScheduleResultV1 {
  const safePlan = rolePlan(plan);
  if (!safePlan) return deepFreeze({ code: "invalid-evidence", rationaleCodes: ["EXECUTION_PLAN_INVALID"] });
  const expectedQaAuthorityDigest = qaAuthorityPlanDigest(safePlan.dossier, safePlan.decision, safePlan.qaExecutionAuthority);
  if (safePlan.mode === "active" && (
    plan.qaAuthorityDigest !== expectedQaAuthorityDigest ||
    safePlan.qaExecutionAuthority === undefined
  )) {
    return deepFreeze({ code: "qa-authority-required", rationaleCodes: ["QA_AUTHORITY_REQUIRED"] });
  }
  try {
    assertExactKeys(input, ["role", "agentInstanceId", "freshness", "currentCandidate", "verificationPlan"], "role scheduling input");
    const role = enumValue(input.role, ["verify", "review"] as const, "role scheduling.role");
    const agentInstanceId = codeValue(input.agentInstanceId, "role scheduling.agentInstanceId");
    if (safePlan.mode === "active" && (
      input.currentCandidate === undefined ||
      validateCandidateRefV1(safePlan.qaExecutionAuthority!.candidate, parseCandidateRefV1(input.currentCandidate)).ok !== true
    )) return deepFreeze({ code: "invalid-evidence", rationaleCodes: ["CANDIDATE_AUTHORITY_MISMATCH"] });
    if (
      safePlan.mode === "active" &&
      sha256Digest(input.freshness) !== sha256Digest(safePlan.qaExecutionAuthority!.freshness)
    ) return deepFreeze({ code: "invalid-evidence", rationaleCodes: ["FRESHNESS_AUTHORITY_MISMATCH"] });
    const qaAuthority: QaAuthorityBindingV1 = safePlan.mode === "active"
      ? { kind: "convergence", snapshot: safePlan.qaExecutionAuthority! }
      : { kind: "legacy_compatibility", nonAuthoritative: true };
    const qaAction = qaAuthority.kind === "convergence"
      ? decideQaNextActionV1({ snapshot: qaAuthority.snapshot })
      : undefined;
    if (
      qaAction !== undefined &&
      (role === "verify" && qaAction.kind !== "run_verify_stage" || role === "review" && qaAction.kind !== "run_review")
    ) return deepFreeze({ code: "not-required", rationaleCodes: ["QA_ROLE_NOT_AUTHORIZED"] });
    const freshnessInput: FreshnessPolicyInputV1 = {
      ...input.freshness,
      reviewRequired: input.freshness.reviewRequired || safePlan.dossier.lane.lane !== "fast",
      freshReviewTriggers: [...new Set([
        ...input.freshness.freshReviewTriggers,
        ...derivedFreshReviewTriggers(safePlan.dossier),
      ])],
    };
    if (
      role === "verify" && freshnessInput.verifyInstanceId !== agentInstanceId ||
      role === "review" && freshnessInput.reviewInstanceId !== agentInstanceId
    ) return deepFreeze({ code: "invalid-evidence", rationaleCodes: ["ROLE_IDENTITY_MISMATCH"] });

    const freshness = evaluateFreshnessPolicyV1(freshnessInput);
    if (freshness.code !== "accepted") {
      if (freshness.code === "invalid-evidence") {
        return deepFreeze({ code: "invalid-evidence", rationaleCodes: freshness.rationaleCodes });
      }
      return deepFreeze({
        code: freshness.code === "shadow-full-sdd" ? "lane-floor-violation" : "verification-evidence-required",
        rationaleCodes: freshness.rationaleCodes,
        requiredLane: "full_sdd" as const,
      });
    }

    let stage: VerificationStage | undefined;
    let verificationPlan: VerificationStageExecutionPlanV1 | undefined;
    let checkIds: readonly string[];
    let requiresFreshAgent: boolean;
    let rationaleCodes: readonly string[];
    if (role === "verify") {
      stage = qaAction?.kind === "run_verify_stage"
        ? qaAction.stage
        : safePlan.decision.action === "advance_verification"
          ? safePlan.decision.requiredVerificationStage
          : undefined;
      if (!stage || stage !== safePlan.dossier.verification.nextStage) {
        return deepFreeze({ code: "not-required", rationaleCodes: ["VERIFY_STAGE_NOT_REQUESTED"] });
      }
      const stageState = safePlan.dossier.verification.stages.find((entry) => entry.stage === stage);
      if (!stageState || stageState.status !== "pending") {
        return deepFreeze({ code: "invalid-evidence", rationaleCodes: ["VERIFY_STAGE_STATE_INVALID"] });
      }
      if (safePlan.mode === "active") {
        if (input.verificationPlan === undefined) {
          return deepFreeze({ code: "verification-evidence-required", rationaleCodes: ["VERIFY_STAGE_PLAN_REQUIRED"] });
        }
        verificationPlan = parseVerificationStageExecutionPlanV1(input.verificationPlan);
        if (
          verificationPlan.stage !== stage ||
          verificationPlan.qaAuthorityDigest !== safePlan.qaExecutionAuthority!.digest ||
          verificationPlan.generation !== safePlan.qaExecutionAuthority!.generation ||
          verificationPlan.implementationSubjectDigest !== safePlan.qaExecutionAuthority!.implementationSubjectDigest ||
          verificationPlan.dependencySetDigest !== safePlan.qaExecutionAuthority!.dependencySetDigest ||
          JSON.stringify(verificationPlan.checks.map((check) => check.checkId)) !== JSON.stringify([...stageState.checkIds].sort())
        ) return deepFreeze({ code: "invalid-evidence", rationaleCodes: ["VERIFY_STAGE_PLAN_INVALID"] });
        checkIds = verificationPlan.checks.map((check) => check.checkId);
      } else {
        checkIds = stageState.checkIds;
      }
      requiresFreshAgent = freshness.freshVerifyRequired;
      rationaleCodes = ["VERIFY_STAGE_ADVANCE", ...freshness.rationaleCodes];
    } else {
      if (input.verificationPlan !== undefined) {
        return deepFreeze({ code: "invalid-evidence", rationaleCodes: ["REVIEW_STAGE_PLAN_FORBIDDEN"] });
      }
      if (safePlan.dossier.verification.nextStage !== "broad" || !freshness.freshReviewRequired) {
        return deepFreeze({ code: "not-required", rationaleCodes: ["REVIEW_NOT_REQUIRED"] });
      }
      if (qaAuthority.kind !== "convergence") {
        return deepFreeze({ code: "invalid-evidence", rationaleCodes: ["REVIEW_AUTHORITY_REQUIRED"] });
      }
      checkIds = qaAuthority.snapshot.reviewCheckIds;
      requiresFreshAgent = freshness.freshReviewRequired;
      rationaleCodes = ["REVIEW_REQUIRED", ...freshness.rationaleCodes];
    }

    const payload: Omit<ExecutionRoleInvocationV1, "invocationId"> = {
      schema: "execution-role-invocation-v1",
      mode: safePlan.mode,
      role,
      agentInstanceId,
      batchId: safePlan.dossier.batch.batchId,
      ...(stage === undefined ? {} : { stage }),
      checkIds,
      requiresFreshAgent,
      rationaleCodes: [...new Set(rationaleCodes)],
      causalContext: projectCausalContextForRoleV1(safePlan.dossier, role, safePlan.dossierHistory),
      qaAuthority,
      ...(verificationPlan === undefined ? {} : { verificationPlan }),
      dependencies: {
        batchDigest: safePlan.dossier.batch.digest,
        dossierDigest: safePlan.dossier.digest,
        decisionDigest: safePlan.decision.digest,
        verificationDigest: safePlan.dossier.verification.digest,
        qaAuthorityDigest: qaAuthority.kind === "convergence"
          ? qaAuthority.snapshot.digest
          : sha256Digest(qaAuthority),
      },
    };
    const invocation = parseExecutionRoleInvocationV1({ ...payload, invocationId: invocationId(payload) });
    return deepFreeze({ code: safePlan.mode === "shadow" ? "shadow-only" : "scheduled", invocation });
  } catch {
    return deepFreeze({ code: "invalid-evidence", rationaleCodes: ["ROLE_SCHEDULING_INVALID"] });
  }
}

export function consumeExecutionRoleResultV1(
  plan: ExecutionPlanV1,
  invocationValue: unknown,
  resultValue: unknown,
  verificationPolicy: StagedVerificationPolicyV1,
): ExecutionRoleResultConsumptionV1 {
  const safePlan = rolePlan(plan);
  if (!safePlan) return deepFreeze({ code: "invalid-evidence", rationaleCodes: ["EXECUTION_PLAN_INVALID"] });
  try {
    const invocation = parseExecutionRoleInvocationV1(invocationValue);
    if (
      invocation.mode !== safePlan.mode ||
      invocation.batchId !== safePlan.dossier.batch.batchId ||
      invocation.dependencies.batchDigest !== safePlan.dossier.batch.digest ||
      invocation.dependencies.dossierDigest !== safePlan.dossier.digest ||
      invocation.dependencies.decisionDigest !== safePlan.decision.digest ||
      invocation.dependencies.verificationDigest !== safePlan.dossier.verification.digest ||
      safePlan.mode === "active" && (
        safePlan.qaExecutionAuthority === undefined ||
        invocation.qaAuthority.kind !== "convergence" ||
        invocation.qaAuthority.snapshot.digest !== safePlan.qaExecutionAuthority.digest ||
        invocation.dependencies.qaAuthorityDigest !== safePlan.qaExecutionAuthority.digest
      ) ||
      safePlan.mode === "shadow" && invocation.qaAuthority.kind !== "legacy_compatibility"
    ) throw new Error("invalid-evidence: role result plan binding");

    assertExactKeys(resultValue, [
      "schema", "digest", "invocationId", "role", "agentInstanceId", "batchId", "stage", "status", "evidence",
      "omission", "verificationCheckResults", "verificationWaveReceipts", "failureManifest", "reviewConvergence", "broadCausalDisposition", "qualityDisposition",
      "provenance", "dependencies", "registryIntents",
    ], "role result");
    if (resultValue.schema !== "execution-role-result-v1") throw new Error("unsupported-contract-version");
    assertDigest(resultValue.digest, "role result.digest");
    const role = enumValue(resultValue.role, ["verify", "review"] as const, "role result.role");
    const stage = resultValue.stage === undefined
      ? undefined
      : enumValue(resultValue.stage, ["targeted", "affected_area", "broad"] as const, "role result.stage");
    const status = enumValue(
      resultValue.status,
      role === "verify" ? ["passed", "failed", "skipped", "deferred"] as const : ["passed", "failed"] as const,
      "role result.status",
    );
    const agentInstanceId = codeValue(resultValue.agentInstanceId, "role result.agentInstanceId");
    if (
      resultValue.invocationId !== invocation.invocationId ||
      role !== invocation.role ||
      agentInstanceId !== invocation.agentInstanceId ||
      resultValue.batchId !== invocation.batchId ||
      stage !== invocation.stage
    ) throw new Error("invalid-evidence: role result identity");

    assertExactKeys(resultValue.provenance, ["role", "agentInstanceId", "issuedAt"], "role result.provenance");
    if (resultValue.provenance.role !== role || resultValue.provenance.agentInstanceId !== agentInstanceId) {
      throw new Error("invalid-evidence: role result provenance");
    }
    const provenance = {
      role,
      agentInstanceId,
      issuedAt: timestampValue(resultValue.provenance.issuedAt, "role result.provenance.issuedAt"),
    };
    assertExactKeys(resultValue.dependencies, ["batchDigest", "dossierDigest", "decisionDigest", "verificationDigest", "qaAuthorityDigest"], "role result.dependencies");
    for (const [key, digest] of Object.entries(invocation.dependencies)) {
      assertDigest(resultValue.dependencies[key], `role result.dependencies.${key}`);
      if (resultValue.dependencies[key] !== digest) throw new Error("invalid-evidence: role result dependency");
    }

    const authorityCandidate = invocation.qaAuthority.kind === "convergence"
      ? invocation.qaAuthority.snapshot.candidate
      : undefined;
    const failureManifest = resultValue.failureManifest === undefined
      ? undefined
      : parseFailureManifestV1(resultValue.failureManifest, safePlan.dossier.batch);
    if (
      role === "verify" && stage === "broad" && safePlan.mode === "active" && failureManifest === undefined ||
      (role !== "verify" || stage !== "broad") && failureManifest !== undefined ||
      failureManifest !== undefined && (
        failureManifest.producerRole !== "verify" ||
        failureManifest.producerInstanceId !== agentInstanceId ||
        failureManifest.producedAt !== provenance.issuedAt
      )
    ) throw new Error("invalid-evidence: broad failure manifest");
    const reviewConvergence = resultValue.reviewConvergence === undefined
      ? undefined
      : (() => {
          if (!authorityCandidate) throw new Error("invalid-evidence: review convergence authority");
          return parseReviewConvergenceResultV1(resultValue.reviewConvergence, authorityCandidate);
        })();
    if (
      safePlan.mode === "active" && role === "review" && reviewConvergence === undefined ||
      role !== "review" && reviewConvergence !== undefined ||
      reviewConvergence !== undefined && invocation.qaAuthority.kind === "convergence" &&
        reviewConvergence.checklistDigest !== invocation.qaAuthority.snapshot.reviewChecklistDigest
    ) throw new Error("invalid-evidence: review convergence required");
    const broadCausalDisposition = resultValue.broadCausalDisposition === undefined
      ? undefined
      : (() => {
          if (!authorityCandidate) throw new Error("invalid-evidence: broad disposition authority");
          return parseBroadCausalDispositionEnvelopeV1(resultValue.broadCausalDisposition, authorityCandidate);
        })();
    if (
      safePlan.mode === "active" && role === "verify" && stage === "broad" && broadCausalDisposition === undefined ||
      (role !== "verify" || stage !== "broad") && broadCausalDisposition !== undefined ||
      broadCausalDisposition !== undefined && invocation.qaAuthority.kind === "convergence" &&
        broadCausalDisposition.reviewDigest !== invocation.qaAuthority.snapshot.reviewDigest
    ) throw new Error("invalid-evidence: broad causal disposition required");

    const omitted = status === "skipped" || status === "deferred";
    const rawOmission = resultValue.omission;
    if (omitted) {
      if (rawOmission === undefined) throw new Error("invalid-evidence: role result omission");
      assertExactKeys(rawOmission, ["reasonCode", "evidence", "policyId", "expiresAt", "nextTrigger", "riskAcceptance"], "role result.omission");
    }
    else if (rawOmission !== undefined) throw new Error("invalid-evidence: role result omission");
    const omissionReason = omitted
      ? enumValue((rawOmission as Record<string, unknown>).reasonCode, ["not_applicable", "not_available", "blocked_by_prior_stage", "policy_deferred"] as const, "role result.omission.reasonCode")
      : undefined;
    let verificationCheckResults: readonly VerificationCheckResultV1[] | undefined;
    let verificationWaveReceipts: readonly VerificationWaveExecutionReceiptV1[] | undefined;
    let verificationJoin: VerificationStageExecutionJoinV1 | undefined;
    if (invocation.verificationPlan !== undefined) {
      if (omitted || resultValue.verificationCheckResults === undefined) {
        return deepFreeze({ code: "verification-evidence-required", rationaleCodes: ["VERIFY_CHECK_RESULTS_REQUIRED"] });
      }
      verificationCheckResults = denseArray(resultValue.verificationCheckResults, "role result.verificationCheckResults")
        .map((value) => parseVerificationCheckResultV1(value, invocation.verificationPlan!));
      const executionIdentityDigest = sha256Digest({ invocationId: invocation.invocationId, role, agentInstanceId });
      const parsedWaveReceipts: VerificationWaveExecutionReceiptV1[] = [];
      for (const value of denseArray(resultValue.verificationWaveReceipts, "role result.verificationWaveReceipts")) {
        const previous = parsedWaveReceipts[parsedWaveReceipts.length - 1];
        const receipt = parseVerificationWaveExecutionReceiptV1(value, invocation.verificationPlan, previous);
        if (receipt.executionIdentityDigest !== executionIdentityDigest) throw new Error("invalid-evidence: wave execution identity");
        parsedWaveReceipts.push(receipt);
      }
      verificationWaveReceipts = parsedWaveReceipts;
      const joined = joinVerificationStageExecutionV1(
        invocation.verificationPlan,
        verificationCheckResults,
        failureManifest?.digest,
        verificationWaveReceipts,
        executionIdentityDigest,
      );
      if (joined.status === "incomplete") {
        return deepFreeze({ code: "verification-evidence-required", rationaleCodes: ["VERIFY_CHECK_RESULTS_INCOMPLETE"] });
      }
      verificationJoin = joined;
    } else if (resultValue.verificationCheckResults !== undefined || resultValue.verificationWaveReceipts !== undefined) {
      throw new Error("invalid-evidence: role result verification check results");
    }
    const parsedStage = buildStagedVerificationStateV1({
      schema: "staged-verification-state-v1",
      batchId: invocation.batchId,
      stages: [{
        stage: invocation.stage ?? "targeted",
        status,
        checkIds: invocation.checkIds,
        evidence: denseArray(resultValue.evidence, "role result.evidence") as unknown as SafeEvidenceRefV1[],
        ...(omitted
          ? { skipReason: omissionReason!, omission: rawOmission as unknown as VerificationOmissionEvidenceV1 }
          : {}),
      }],
    }).stages[0]!;
    const manifest = failureManifest;
    if (verificationJoin !== undefined && verificationJoin.status !== "incomplete") {
      const evidenceSet = [...parsedStage.evidence].sort((a, b) => sha256Digest(a).localeCompare(sha256Digest(b)));
      if (sha256Digest(evidenceSet) !== verificationJoin.evidenceSetDigest) throw new Error("invalid-evidence: verification join evidence");
    }
    const hasRawFailure = verificationJoin?.status === "failed" || role === "verify" && stage === "broad" && (manifest?.findings.length ?? 0) > 0 || parsedStage.evidence.some(
      (item) => item.resultCode !== undefined && item.resultCode.toLowerCase() !== "passed",
    );
    const qualityDisposition = resultValue.qualityDisposition === undefined
      ? undefined
      : (() => {
          const quality = parseQualityDispositionEnvelopeV1(resultValue.qualityDisposition, manifest);
          if (
            quality.batchId !== invocation.batchId ||
            quality.batchDigest !== invocation.dependencies.batchDigest ||
            quality.verificationDigest !== invocation.dependencies.verificationDigest ||
            quality.producerRole !== role ||
            quality.producerInstanceId !== agentInstanceId ||
            quality.producedAt !== provenance.issuedAt ||
            (quality.status === "failed") !== (status === "failed") ||
            (quality.status !== "failed" && status !== "passed")
          ) throw new Error("invalid-evidence: quality disposition binding");
          return quality;
        })();
    if (
      qualityDisposition !== undefined && (role !== "verify" || stage !== "broad") ||
      broadCausalDisposition !== undefined && qualityDisposition?.digest !== broadCausalDisposition.qualityDispositionDigest
    ) throw new Error("invalid-evidence: quality disposition stage binding");
    if (broadCausalDisposition !== undefined && (
      invocation.qaAuthority.kind !== "convergence" || verificationJoin === undefined || verificationJoin.status === "incomplete" ||
      failureManifest === undefined || broadCausalDisposition.batchDigest !== invocation.dependencies.batchDigest ||
      broadCausalDisposition.generation !== invocation.qaAuthority.snapshot.generation ||
      broadCausalDisposition.implementationSubjectDigest !== invocation.qaAuthority.snapshot.implementationSubjectDigest ||
      broadCausalDisposition.dependencySetDigest !== invocation.qaAuthority.snapshot.dependencySetDigest ||
      broadCausalDisposition.broadStageJoinDigest !== verificationJoin.digest ||
      broadCausalDisposition.broadManifestDigest !== failureManifest.digest ||
      broadCausalDisposition.protectedPolicyDigest !== invocation.qaAuthority.snapshot.protectedPolicyDigest
    )) throw new Error("invalid-evidence: broad causal disposition binding");
    if (
      verificationJoin?.status === "passed" && status !== "passed" ||
      verificationJoin?.status === "failed" && status === "passed" && qualityDisposition?.status !== "passed_with_warnings"
    ) throw new Error("invalid-evidence: verification join status");
    if (hasRawFailure && qualityDisposition === undefined) throw new Error("invalid-evidence: quality disposition required");
    const registryIntents = denseArray(resultValue.registryIntents, "role result.registryIntents").map((value) => {
      const intent = parseRegistryIntentV1(value);
      if (
        intent.changeId !== safePlan.dossier.batch.changeId ||
        intent.batchId !== invocation.batchId ||
        intent.batchDigest !== invocation.dependencies.batchDigest ||
        intent.decisionDigest !== invocation.dependencies.decisionDigest
      ) throw new Error("invalid-evidence: role result registry intent");
      return intent;
    });
    if (
      registryIntents.some((intent) => intent.status === "passed_with_warnings") !== (qualityDisposition?.status === "passed_with_warnings" && registryIntents.length > 0) ||
      qualityDisposition?.status === "passed_with_warnings" && registryIntents.some((intent) => intent.status === "passed" || intent.status === "failed")
    ) throw new Error("invalid-evidence: quality disposition registry intent");
    if (broadCausalDisposition?.entries.some((entry) => entry.kind === "warning" && !registryIntents.some((intent) =>
      intent.intentId === entry.followUpRef && intent.status === "passed_with_warnings" &&
      intent.artifact.kind === "warning-follow-up" && intent.event.notes.includes(entry.findingId)
    ))) {
      throw new Error("invalid-evidence: warning follow-up intent");
    }
    const normalizedPayload = {
      schema: "execution-role-result-v1" as const,
      invocationId: invocation.invocationId,
      role,
      agentInstanceId,
      batchId: invocation.batchId,
      ...(stage === undefined ? {} : { stage }),
      status,
      evidence: parsedStage.evidence,
      ...(parsedStage.omission === undefined ? {} : { omission: parsedStage.omission }),
      ...(verificationCheckResults === undefined ? {} : { verificationCheckResults }),
      ...(verificationWaveReceipts === undefined ? {} : { verificationWaveReceipts }),
      ...(failureManifest === undefined ? {} : { failureManifest }),
      ...(reviewConvergence === undefined ? {} : { reviewConvergence }),
      ...(broadCausalDisposition === undefined ? {} : { broadCausalDisposition }),
      ...(qualityDisposition === undefined ? {} : { qualityDisposition }),
      provenance,
      dependencies: invocation.dependencies,
      registryIntents,
    };
    if (resultValue.digest !== sha256Digest(normalizedPayload)) throw new Error("invalid-evidence: role result digest");
    const normalizedResult = deepFreeze({ ...normalizedPayload, digest: resultValue.digest }) as ExecutionRoleResultEnvelopeV1;

    let verification: StagedVerificationStateV1 | undefined;
    const effectiveVerificationPolicy: StagedVerificationPolicyV1 = {
      ...verificationPolicy,
      mandatoryBroadReasons: [...new Set([
        ...verificationPolicy.mandatoryBroadReasons,
        ...derivedMandatoryBroadReasons(safePlan.dossier),
      ])],
    };
    if (effectiveVerificationPolicy.lane !== safePlan.dossier.lane.lane || effectiveVerificationPolicy.lane !== "fast" && !effectiveVerificationPolicy.broadRequired) {
      return deepFreeze({ code: "lane-floor-violation", rationaleCodes: ["VERIFY_POLICY_LANE_MISMATCH"] });
    }
    if (qualityDisposition?.status === "failed") {
      return deepFreeze({ code: "role-result-failed", rationaleCodes: ["QUALITY_DISPOSITION_BLOCKING"] });
    }
    if (role === "verify") {
      const transition = transitionStagedVerificationV1(safePlan.dossier.verification, {
        stage: invocation.stage!,
        status,
        evidence: parsedStage.evidence,
        ...(parsedStage.omission === undefined ? {} : { omission: parsedStage.omission }),
      }, effectiveVerificationPolicy);
      if (transition.code !== "advanced" && transition.code !== "complete") {
        return deepFreeze({ code: transition.code, rationaleCodes: [transition.rationaleCode] });
      }
      verification = transition.state;
    } else {
      const acceptance = validateScopedVerificationAcceptanceV1(safePlan.dossier.verification, effectiveVerificationPolicy);
      if (acceptance.code !== "advanced") {
        const code = acceptance.code === "complete" ? "invalid-evidence" : acceptance.code;
        return deepFreeze({ code, rationaleCodes: [acceptance.rationaleCode] });
      }
      if (status !== "passed") return deepFreeze({ code: "role-result-failed", rationaleCodes: ["REVIEW_FAILED"] });
      if (parsedStage.evidence.length === 0 || invocation.checkIds.some((checkId) => !parsedStage.evidence.some((item) => item.checkId === checkId))) {
        return deepFreeze({ code: "verification-evidence-required", rationaleCodes: ["REVIEW_EVIDENCE_MISSING"] });
      }
    }

    return deepFreeze({
      code: safePlan.mode === "shadow" ? "shadow-observed" : "accepted",
      result: normalizedResult,
      ...(verification === undefined ? {} : { verification }),
      ...(verificationJoin === undefined ? {} : { verificationJoin }),
      phaseStatus: qualityDisposition?.status === "passed_with_warnings" ? "passed_with_warnings" : "passed",
      registryIntents: safePlan.mode === "shadow" ? [] : registryIntents,
    });
  } catch {
    return deepFreeze({ code: "invalid-evidence", rationaleCodes: ["ROLE_RESULT_INVALID"] });
  }
}

function failureClass(
  failure: unknown,
): InvalidExecutionInputIdentityV1["failure"] {
  const message =
    typeof failure === "string"
      ? failure
      : failure instanceof Error
        ? failure.message
        : "";
  if (/cyclic/i.test(message)) return "cyclic";
  if (/prototype|plain object/i.test(message)) return "prototype";
  if (/unsupported.*version/i.test(message)) return "unsupported-version";
  if (/exact.*key/i.test(message)) return "exact-keys";
  if (/batch.*reference/i.test(message)) return "batch-reference";
  if (/unsafe|secret/i.test(message)) return "unsafe-content";
  if (/identity|digest/i.test(message)) return "identity";
  if (/invalid|malformed/i.test(message)) return "malformed";
  return "unknown";
}
/** Never walks rejected content or hashes raw input/error text. */
export function classifyInvalidExecutionInputV1(
  value: unknown,
  failure: unknown,
): InvalidExecutionInputIdentityV1 {
  try {
    const valueClass =
      value == null
        ? "nullish"
        : Array.isArray(value)
          ? "array"
          : typeof value === "object"
            ? "plain-record"
            : "primitive";
    if (valueClass === "plain-record") {
      const proto = Object.getPrototypeOf(value as object);
      if (proto !== Object.prototype && proto !== null)
        return deepFreeze({
          boundary: "execution-composition",
          valueClass: "unclassifiable",
          keyCount: "unknown",
          version: "unknown",
          failure: "prototype",
        });
      const keys = Object.keys(value as object);
      const schema = Object.getOwnPropertyDescriptor(value as object, "schema");
      const unsupportedVersion =
        schema &&
        "value" in schema &&
        typeof schema.value === "string" &&
        /^execution-dossier-v\d+$/.test(schema.value) &&
        schema.value !== "execution-dossier-v1";
      return deepFreeze({
        boundary: "execution-composition",
        valueClass,
        keyCount:
          keys.length === 0 ? "none" : keys.length === 1 ? "one" : "many",
        version: unsupportedVersion ? "unsupported" : "unknown",
        failure: unsupportedVersion
          ? "unsupported-version"
          : failureClass(failure),
      });
    }
    return deepFreeze({
      boundary: "execution-composition",
      valueClass,
      keyCount: "none",
      version: "unknown",
      failure: failureClass(failure),
    });
  } catch {
    return deepFreeze({
      boundary: "execution-composition",
      valueClass: "unclassifiable",
      keyCount: "unknown",
      version: "unknown",
      failure: "unknown",
    });
  }
}
function freeze<T extends object>(value: T): T {
  return deepFreeze(value) as T;
}
function safeAuthority(value: unknown): SafeAuthority {
  assertExactKeys(
    value,
    [
      "state",
      "capabilityDigest",
      "reference",
      "rationaleCode",
      "rejectionCode",
    ],
    "authority",
  );
  const raw = value as Record<string, unknown>;
  const state = enumValue(
    raw.state,
    ["authorized", "missing", "invalid"] as const,
    "authority.state",
  );
  if (state === "authorized") {
    assertDigest(raw.capabilityDigest, "authority.capabilityDigest");
    assertExactKeys(raw.reference, ["validation"], "authority.reference");
    if ((raw.reference as Record<string, unknown>).validation !== "accepted")
      throw new Error("invalid-evidence: authority.reference");
    return freeze({
      state,
      capabilityDigest: raw.capabilityDigest as Sha256Digest,
      reference: { validation: "accepted" as const },
    });
  }
  if (state === "missing") {
    if (raw.rationaleCode !== "AUTHZ_MISSING")
      throw new Error("invalid-evidence: authority");
    return freeze({ state, rationaleCode: "AUTHZ_MISSING" as const });
  }
  if (
    raw.rationaleCode !== "AUTHZ_INVALID" ||
    (raw.reference !== null &&
      (!(raw.reference instanceof Object) ||
        (raw.reference as Record<string, unknown>).validation !== "rejected"))
  )
    throw new Error("invalid-evidence: authority");
  return freeze({
    state,
    rationaleCode: "AUTHZ_INVALID" as const,
    rejectionCode: codeValue(raw.rejectionCode, "authority.rejectionCode"),
    reference:
      raw.reference === null ? null : { validation: "rejected" as const },
  });
}
function safeGit(value: unknown): SafeGit {
  assertExactKeys(
    value,
    [
      "state",
      "policyDigest",
      "commandDigest",
      "confirmationReceiptDigest",
      "rationaleCode",
    ],
    "gitSafety",
  );
  const raw = value as Record<string, unknown>;
  const state = enumValue(
    raw.state,
    ["not-required", "confirmed", "confirmation-required", "invalid"] as const,
    "gitSafety.state",
  );
  if (state === "not-required") {
    assertDigest(raw.policyDigest, "gitSafety.policyDigest");
    return freeze({ state, policyDigest: raw.policyDigest as Sha256Digest });
  }
  if (state === "confirmed") {
    assertDigest(raw.commandDigest, "gitSafety.commandDigest");
    assertDigest(
      raw.confirmationReceiptDigest,
      "gitSafety.confirmationReceiptDigest",
    );
    return freeze({
      state,
      commandDigest: raw.commandDigest as Sha256Digest,
      confirmationReceiptDigest: raw.confirmationReceiptDigest as Sha256Digest,
    });
  }
  if (state === "confirmation-required") {
    assertDigest(raw.commandDigest, "gitSafety.commandDigest");
    if (raw.rationaleCode !== "GIT_SAFETY_CONFIRMATION_REQUIRED")
      throw new Error("invalid-evidence: gitSafety");
    return freeze({
      state,
      commandDigest: raw.commandDigest as Sha256Digest,
      rationaleCode: "GIT_SAFETY_CONFIRMATION_REQUIRED" as const,
    });
  }
  if (raw.rationaleCode !== "GIT_SAFETY_CONFIRMATION_INVALID")
    throw new Error("invalid-evidence: gitSafety");
  return freeze({
    state,
    rationaleCode: "GIT_SAFETY_CONFIRMATION_INVALID" as const,
  });
}
function safeBinding(value: unknown): SafeBinding {
  assertExactKeys(
    value,
    [
      "kind",
      "runnerId",
      "invocationId",
      "batchId",
      "batchDigest",
      "dossierDigest",
      "decisionDigest",
      "action",
      "target",
      "gitEffect",
      "capabilityDigest",
    ],
    "effectBinding",
  );
  return (value as Record<string, unknown>).kind === "none"
    ? freeze({ kind: "none" as const })
    : parseTargetedRepairCapabilityDescriptorV1(value);
}
function safeGovernance(value: unknown): TerminalGovernanceContextV1 {
  assertExactKeys(value, ["kind", "incident", "config"], "governance");
  const raw = value as Record<string, unknown>;
  const kind = enumValue(
    raw.kind,
    ["none", "repair-incident"] as const,
    "governance.kind",
  );
  if (kind === "none") {
    if (raw.incident !== undefined || raw.config !== undefined)
      throw new Error("invalid-evidence: governance");
    return { kind };
  }
  assertExactKeys(
    raw.incident,
    [
      "schema",
      "incidentId",
      "changeId",
      "status",
      "createdFrom",
      "budgets",
      "failures",
      "lifecycle",
      "runtimeBudget",
    ],
    "governance.incident",
  );
  if ((raw.incident as Record<string, unknown>).schema !== "repair-incident-v1")
    throw new Error("invalid-evidence: governance.incident");
  if (raw.config !== "default") {
    assertExactKeys(
      raw.config,
      [
        "incidentBudgets",
        "loopBreakerConfig",
        "budgetConfig",
        "operatingMode",
        "hardStopOverride",
      ],
      "governance.config",
    );
  }
  return {
    kind,
    incident: raw.incident as unknown as RepairIncident,
    config: raw.config as RepairGovernanceConfig | "default",
  };
}
function safeGuard(value: unknown): TerminalGuardResultV1 {
  assertExactKeys(value, ["outcome", "rationaleCodes"], "terminalGuard");
  const raw = value as Record<string, unknown>;
  const outcome = enumValue(
    raw.outcome,
    ["permit", "checkpoint", "replan", "escalate", "stop"] as const,
    "terminalGuard.outcome",
  );
  if (
    !Array.isArray(raw.rationaleCodes) ||
    raw.rationaleCodes.some(
      (code) => typeof code !== "string" || !/^[A-Z0-9_:-]+$/.test(code),
    )
  )
    throw new Error("invalid-evidence: terminalGuard.rationaleCodes");
  return freeze({ outcome, rationaleCodes: [...raw.rationaleCodes] });
}
function recordDigest(
  record: Omit<ExecutionReplayRecordV1, "inputDigest">,
): Sha256Digest {
  return sha256Digest(record);
}
export function parseExecutionReplayRecordV1(
  value: unknown,
): ExecutionReplayRecordV1 {
  assertExactKeys(
    value,
    [
      "schema",
      "outcome",
      "mode",
      "policyVersion",
      "dossier",
      "dossierHistory",
      "authority",
      "gitSafety",
      "terminalGuard",
      "effectBinding",
      "invalidInput",
      "inputDigest",
    ],
    "replayRecord",
  );
  const raw = value as Record<string, unknown>;
  if (
    raw.schema !== "execution-replay-record-v1" ||
    raw.policyVersion !== "execution-decision-policy-v1"
  )
    throw new Error("invalid-evidence: replayRecord");
  assertDigest(raw.inputDigest, "replayRecord.inputDigest");
  const outcome = enumValue(
    raw.outcome,
    ["valid", "invalid", "legacy"] as const,
    "replayRecord.outcome",
  );
  if (outcome === "valid") {
    const mode = enumValue(
      raw.mode,
      ["shadow", "active"] as const,
      "replayRecord.mode",
    );
    const effectBinding = safeBinding(raw.effectBinding);
    if (mode === "shadow" && effectBinding.kind !== "none")
      throw new Error("invalid-evidence: shadow effect binding");
    const dossierHistory = raw.dossierHistory === undefined
      ? undefined
      : parseExecutionDossierHistoryV1(raw.dossierHistory);
    const record = freeze({
      schema: "execution-replay-record-v1" as const,
      outcome,
      mode,
      policyVersion: "execution-decision-policy-v1" as const,
      dossier: parseExecutionDossierV1(raw.dossier, dossierHistory),
      ...(dossierHistory === undefined ? {} : { dossierHistory }),
      authority: safeAuthority(raw.authority),
      gitSafety: safeGit(raw.gitSafety),
      terminalGuard: safeGuard(raw.terminalGuard),
      effectBinding,
    });
    if (raw.inputDigest !== recordDigest(record))
      throw new Error("invalid-evidence: replayRecord.digest");
    return freeze({ ...record, inputDigest: raw.inputDigest as Sha256Digest });
  }
  if (outcome === "legacy") {
    if (raw.mode !== "legacy")
      throw new Error("invalid-evidence: replayRecord.mode");
    const record = {
      schema: "execution-replay-record-v1" as const,
      outcome,
      mode: "legacy" as const,
      policyVersion: "execution-decision-policy-v1" as const,
    };
    if (raw.inputDigest !== recordDigest(record))
      throw new Error("invalid-evidence: replayRecord.digest");
    return freeze({ ...record, inputDigest: raw.inputDigest as Sha256Digest });
  }
  const mode = enumValue(
    raw.mode,
    ["legacy", "shadow", "active"] as const,
    "replayRecord.mode",
  );
  assertExactKeys(
    raw.invalidInput,
    ["boundary", "valueClass", "keyCount", "version", "failure"],
    "replayRecord.invalidInput",
  );
  const invalidInput =
    raw.invalidInput as unknown as InvalidExecutionInputIdentityV1;
  const record = freeze({
    schema: "execution-replay-record-v1" as const,
    outcome,
    mode,
    policyVersion: "execution-decision-policy-v1" as const,
    invalidInput,
  });
  if (raw.inputDigest !== recordDigest(record))
    throw new Error("invalid-evidence: replayRecord.digest");
  return freeze({ ...record, inputDigest: raw.inputDigest as Sha256Digest });
}
export function replayExecutionDecisionV1(
  record: unknown,
): ExecutionDecisionV1 | undefined {
  try {
    const safe = parseExecutionReplayRecordV1(record);
    if (safe.outcome !== "valid") return undefined;
    return evaluateExecutionDecisionV1({
      dossier: safe.dossier,
      authority: safe.authority,
      gitSafety: safe.gitSafety,
      policyVersion: safe.policyVersion,
      terminalGuard: safe.terminalGuard,
    });
  } catch {
    return undefined;
  }
}
export function parseActiveExecutionPlanV1(value: unknown): ExecutionPlanV1 {
  assertExactKeys(
    value,
    [
      "mode",
      "inputDigest",
      "replayRecord",
      "decision",
      "dossier",
      "dossierHistory",
      "reasonCode",
      "replay",
      "qaAuthorityDigest",
      "qaExecutionAuthority",
    ],
    "execution plan",
  );
  const raw = value as Record<string, unknown>;
  if (
    raw.mode !== "active" ||
    raw.reasonCode !== undefined ||
    typeof raw.replay !== "function"
  ) {
    throw new Error("invalid-evidence: execution plan");
  }
  assertDigest(raw.inputDigest, "execution plan.inputDigest");
  const replayRecord = parseExecutionReplayRecordV1(raw.replayRecord);
  if (
    replayRecord.outcome !== "valid" ||
    replayRecord.mode !== "active" ||
    replayRecord.inputDigest !== raw.inputDigest
  ) {
    throw new Error("invalid-evidence: execution plan replay");
  }
  const rawHistory = raw.dossierHistory === undefined
    ? undefined
    : parseExecutionDossierHistoryV1(raw.dossierHistory);
  if ((rawHistory === undefined) !== (replayRecord.dossierHistory === undefined)) {
    throw new Error("invalid-evidence: execution plan history");
  }
  if (rawHistory?.some((entry, index) => entry.digest !== replayRecord.dossierHistory?.[index]?.digest)) {
    throw new Error("invalid-evidence: execution plan history");
  }
  const dossier = parseExecutionDossierV1(raw.dossier, replayRecord.dossierHistory);
  const decision = parseExecutionDecisionV1(raw.decision);
  const qaExecutionAuthority = raw.qaExecutionAuthority === undefined
    ? undefined
    : parseQaAuthoritySnapshotV1(raw.qaExecutionAuthority);
  const replayedDecision = replayExecutionDecisionV1(replayRecord);
  const expectedQaAuthorityDigest = replayedDecision
    ? qaAuthorityPlanDigest(replayRecord.dossier, replayedDecision, qaExecutionAuthority)
    : undefined;
  if (
    !replayedDecision ||
    dossier.digest !== replayRecord.dossier.digest ||
    decision.digest !== replayedDecision.digest ||
    raw.qaAuthorityDigest !== expectedQaAuthorityDigest ||
    qaExecutionAuthority !== undefined && (
      qaExecutionAuthority.changeId !== dossier.batch.changeId ||
      qaExecutionAuthority.batchId !== dossier.batch.batchId ||
      qaExecutionAuthority.batchDigest !== dossier.batch.digest ||
      qaExecutionAuthority.executionDossierDigest !== dossier.digest ||
      qaExecutionAuthority.stagedVerificationDigest !== dossier.verification.digest
    )
  ) {
    throw new Error("invalid-evidence: execution plan identity");
  }
  return freeze({
    mode: "active" as const,
    inputDigest: replayRecord.inputDigest,
    replayRecord,
    decision: replayedDecision,
    dossier: replayRecord.dossier,
    qaAuthorityDigest: expectedQaAuthorityDigest,
    ...(qaExecutionAuthority === undefined ? {} : { qaExecutionAuthority }),
    ...(replayRecord.dossierHistory === undefined ? {} : { dossierHistory: replayRecord.dossierHistory }),
    replay: () => replayExecutionDecisionV1(replayRecord),
  });
}
export function planExecutionDecisionV1(
  mode: "shadow" | "active",
  dossierValue: unknown,
  authority: unknown,
  gitSafety: unknown,
  effectBinding: unknown,
  governance: TerminalGovernanceContextV1,
  dossierHistoryValue?: unknown,
): ExecutionPlanV1 {
  try {
    const safeMode = enumValue(mode, ["shadow", "active"] as const, "mode");
    const dossierHistory = dossierHistoryValue === undefined
      ? undefined
      : parseExecutionDossierHistoryV1(Array.isArray(dossierHistoryValue) ? dossierHistoryValue : [dossierHistoryValue]);
    const dossier = parseExecutionDossierV1(dossierValue, dossierHistory),
      safeAuth = safeAuthority(authority),
      safeGitState = safeGit(gitSafety),
      binding = safeBinding(effectBinding);
    const safeGovernanceState = safeGovernance(governance);
    if (safeMode === "shadow" && binding.kind !== "none")
      throw new Error("invalid-evidence: shadow effect binding");
    const incident =
      safeGovernanceState.kind === "repair-incident"
        ? adaptDossierToRepairIncidentV1(dossier, safeGovernanceState.incident)
        : undefined;
    const terminalGuard = resolveTerminalGovernanceGuardV1({
      dossier,
      authority: safeAuth,
      gitSafety: safeGitState,
      policyVersion: "execution-decision-policy-v1",
      incident,
      governanceConfig:
        safeGovernanceState.kind === "repair-incident" &&
        safeGovernanceState.config !== "default"
          ? safeGovernanceState.config
          : undefined,
    });
    const base = {
      schema: "execution-replay-record-v1" as const,
      outcome: "valid" as const,
      mode: safeMode,
      policyVersion: "execution-decision-policy-v1" as const,
      dossier,
      ...(dossierHistory === undefined || dossierHistory.length === 0 ? {} : { dossierHistory }),
      authority: safeAuth,
      gitSafety: safeGitState,
      terminalGuard,
      effectBinding: binding,
    };
    const replayRecord = freeze({
      ...base,
      inputDigest: recordDigest(base),
    }) as ExecutionReplayRecordV1;
    const decision = replayExecutionDecisionV1(replayRecord);
    if (!decision) throw new Error("invalid-evidence: replay");
    return freeze({
      mode: safeMode,
      inputDigest: replayRecord.inputDigest,
      replayRecord,
      decision,
      dossier,
      ...(safeMode === "active" ? { qaAuthorityDigest: qaAuthorityPlanDigest(dossier, decision) } : {}),
      ...(dossierHistory === undefined || dossierHistory.length === 0 ? {} : { dossierHistory }),
      replay: () => replayExecutionDecisionV1(replayRecord),
    });
  } catch (failure) {
    const invalidInput = classifyInvalidExecutionInputV1(dossierValue, failure);
    const base = {
      schema: "execution-replay-record-v1" as const,
      outcome: "invalid" as const,
      mode,
      policyVersion: "execution-decision-policy-v1" as const,
      invalidInput,
    };
    const replayRecord = freeze({
      ...base,
      inputDigest: recordDigest(base),
    }) as ExecutionReplayRecordV1;
    return freeze({
      mode,
      inputDigest: replayRecord.inputDigest,
      replayRecord,
      reasonCode: "invalid-evidence" as const,
      replay: () => undefined,
    });
  }
}

export interface DeterministicTargetedRepairAuthorityV1 {
  readonly schema: "deterministic-targeted-repair-authority-v1";
  readonly manifest: FailureManifestV1;
  readonly classification: DispositionClassificationInputV1;
  readonly protectedRiskAuthority: ProtectedRiskAuthorityContextV1;
  readonly disposition: FindingDispositionEnvelopeV1;
  readonly routingPolicy: RoutingPolicyInputV1;
  readonly routing: RoutingDecisionV1;
  readonly projection: BlockingRepairProjectionV1;
  readonly retryLedger: RetryLedgerAuthorityV1;
  readonly convergence: {
    readonly current: ExecutionConvergenceDossierV1;
    readonly history: readonly ExecutionConvergenceDossierV1[];
    readonly receipts: readonly ConvergenceTransitionReceiptV1[];
    readonly records: ConvergenceAuthorityRecordSetV1;
  };
  readonly authorizationRef: Sha256Digest;
  readonly effectCapabilityBinding: string;
  readonly excludedChangeTargets: readonly string[];
  readonly target: string;
}

export type DeterministicTargetedRepairAuthorityResultV1 =
  | {
      readonly accepted: true;
      readonly manifest: FailureManifestV1;
      readonly disposition: FindingDispositionEnvelopeV1;
      readonly routing: RoutingDecisionV1;
      readonly projection: BlockingRepairProjectionV1;
      readonly convergence: ExecutionConvergenceDossierV1;
    }
  | {
      readonly accepted: false;
      readonly outcome: "invalid-evidence";
      readonly rationaleCodes: readonly string[];
    };

/**
 * Resolves every authority source required before a deterministic repair effect.
 * The input is self-contained so the bundled runner plugin never imports the Deck checkout.
 */
export function validateDeterministicTargetedRepairAuthorityV1(
  input: unknown,
  batch: ApplyBatchContractV1,
): DeterministicTargetedRepairAuthorityResultV1 {
  try {
    assertExactKeys(
      input,
      [
        "schema",
        "manifest",
        "classification",
        "protectedRiskAuthority",
        "disposition",
        "routingPolicy",
        "routing",
        "projection",
        "retryLedger",
        "convergence",
        "authorizationRef",
        "effectCapabilityBinding",
        "excludedChangeTargets",
        "target",
      ],
      "deterministic targeted repair authority",
    );
    if (input.schema !== "deterministic-targeted-repair-authority-v1") {
      throw new Error("unsupported-contract-version");
    }
    assertExactKeys(
      input.convergence,
      ["current", "history", "receipts", "records"],
      "deterministic targeted repair convergence",
    );
    const manifest = parseFailureManifestV1(input.manifest, batch);
    const disposition = parseFindingDispositionEnvelopeV1(
      input.disposition,
      manifest,
      batch,
      input.classification as DispositionClassificationInputV1,
      input.protectedRiskAuthority as ProtectedRiskAuthorityContextV1,
    );
    const routing = parseRoutingDecisionV1(
      input.routing,
      manifest,
      disposition,
      batch,
      input.routingPolicy as RoutingPolicyInputV1,
      input.protectedRiskAuthority as ProtectedRiskAuthorityContextV1,
    );
    const routingPolicy = input.routingPolicy as RoutingPolicyInputV1;
    const convergence = parseExecutionConvergenceDossierWithAuthorityV1(
      input.convergence.current,
      denseArray(input.convergence.history, "deterministic convergence.history") as unknown as readonly ExecutionConvergenceDossierV1[],
      denseArray(input.convergence.receipts, "deterministic convergence.receipts") as unknown as readonly ConvergenceTransitionReceiptV1[],
      input.convergence.records as ConvergenceAuthorityRecordSetV1,
    );
    assertExactKeys(
      input.retryLedger,
      [
        "retryLedgerDigests",
        "attemptRecords",
        "currentConvergenceRevision",
        "currentConvergenceDigest",
        "currentDossier",
        "dossierHistory",
        "transitionReceipts",
        "convergenceAuthorityRecords",
        "projectionRecords",
      ],
      "deterministic retry ledger",
    );
    const retryLedger = input.retryLedger as unknown as RetryLedgerAuthorityV1;
    if (
      retryLedger.currentDossier?.digest !== convergence.digest ||
      retryLedger.currentConvergenceRevision !== convergence.revision ||
      retryLedger.currentConvergenceDigest !== convergence.digest
    ) {
      throw new Error("invalid-evidence: RETRY_LEDGER_MISMATCH");
    }
    assertDigest(input.authorizationRef, "deterministic authority.authorizationRef");
    if (input.authorizationRef !== batch.authorizationGrantRef) {
      throw new Error("invalid-evidence: STALE_AUTHORIZATION");
    }
    const effectCapabilityBinding = codeValue(
      input.effectCapabilityBinding,
      "deterministic authority.effectCapabilityBinding",
    );
    if (effectCapabilityBinding !== "targeted-repair-v1") {
      throw new Error("invalid-evidence: EFFECT_CAPABILITY_MISMATCH");
    }
    const excludedChangeTargets = stringArray(
      input.excludedChangeTargets,
      "deterministic authority.excludedChangeTargets",
      true,
    );
    const target = codeValue(input.target, "deterministic authority.target");
    const projection = parseBlockingRepairProjectionV1(
      input.projection,
      batch,
      routing,
      {
        routingPolicyVersion: routingPolicy.routingPolicyVersion,
        manifest,
        disposition,
        retryLedger,
        protectedRiskAuthority: input.protectedRiskAuthority as ProtectedRiskAuthorityContextV1,
      },
    );
    if (!projection.allowedTargets.includes(target)) {
      throw new Error("invalid-evidence: TARGET_OUTSIDE_PROJECTION");
    }
    const effect = validateBlockingRepairProjectionAtEffectBoundaryV1({
      projection,
      batch,
      routing,
      manifest,
      disposition,
      expectedConvergenceDossierDigest: convergence.digest,
      expectedRoutingDecisionDigest: routing.digest,
      expectedAuthorizationRef: input.authorizationRef,
      expectedEffectCapabilityBinding: effectCapabilityBinding,
      excludedChangeTargets,
      routingPolicyVersion: routingPolicy.routingPolicyVersion,
      retryLedger,
      protectedRiskAuthority: input.protectedRiskAuthority as ProtectedRiskAuthorityContextV1,
    });
    if (!effect.accepted) return effect;
    return deepFreeze({ accepted: true, manifest, disposition, routing, projection, convergence });
  } catch {
    return deepFreeze({
      accepted: false,
      outcome: "invalid-evidence" as const,
      rationaleCodes: ["DETERMINISTIC_REPAIR_AUTHORITY_INVALID"],
    });
  }
}
