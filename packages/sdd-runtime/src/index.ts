/**
 * @deck/sdd-runtime — Resilience layer for SDD orchestration.
 *
 * Provides contracts, risk scoring, quality routing, loop breaking,
 * runner recovery, artifact state management, and budget watchdogs.
 */

// Contracts
export * from "./contracts/self-audit";
export * from "./contracts/risk";
export * from "./contracts/outcome";
export * from "./contracts/state-update";
export * from "./contracts/repair-incident";
export type { Sha256Digest } from "./contracts/canonical";
export { buildApplyBatchContractV1, parseApplyBatchContractV1 } from "./contracts/apply-batch";
export type { ApplyBatchContractV1, ApplyBatchInputV1, BatchId, ProvenanceRefV1, VerificationStage, VerificationStagePlanV1 } from "./contracts/apply-batch";
export { adaptRepairIncidentToFailureManifestV1, buildFailureManifestV1, parseFailureManifestV1 } from "./contracts/failure-manifest";
export type { FailureFindingInputV1, FailureFindingV1, FailureManifestInputV1, FailureManifestV1, FailureRelationshipV1, FailureRootCause, FailureSeverity, FindingId, SafeEvidenceRefV1 } from "./contracts/failure-manifest";
export { parseFailureDeltaV1 } from "./contracts/failure-delta";
export type { FailureDeltaV1, RiskVectorV1 } from "./contracts/failure-delta";
export { buildExecutionDecisionV1, parseExecutionDecisionV1 } from "./contracts/execution-decision";
export type { ExecutionActionV1, ExecutionDecisionInputV1, ExecutionDecisionV1, FreshnessRequirementV1, TerminalGuardResultV1 } from "./contracts/execution-decision";
export { buildAuthorizationReferenceV1, buildInvocationAuthorizationClaimsV1, parseAuthorizationReferenceV1, parseInvocationAuthorizationClaimsV1 } from "./contracts/invocation-authorization";
export type { AuthorizationReferenceV1, InvocationAuthorizationClaimsInputV1, InvocationAuthorizationClaimsV1 } from "./contracts/invocation-authorization";
export { buildRegistryIntentV1, parseRegistryIntentV1 } from "./contracts/registry-intent";
export type { RegistryIntentInputV1, RegistryIntentV1 } from "./contracts/registry-intent";
export { parseRegistryAtomicCommitReceiptV1 } from "./contracts/registry-atomic-commit";
export type { RegistryAtomicCommitReceiptV1 } from "./contracts/registry-atomic-commit";
export { buildStagedVerificationStateV1, parseStagedVerificationStateV1 } from "./contracts/verification-state";
export type { StageStatus, StagedVerificationStateInputV1, StagedVerificationStateV1, VerificationOmissionEvidenceV1, VerificationOmissionReasonV1, VerificationStageStateV1 } from "./contracts/verification-state";
export { buildCausalContextV1, parseCausalContextV1 } from "./contracts/causal-context";
export type { CausalContextInputV1, CausalContextV1 } from "./contracts/causal-context";
export { buildLaneDecisionV1, parseLaneDecisionV1 } from "./contracts/execution-lane";
export type { ExecutionLane, LaneDecisionInputV1, LaneDecisionV1 } from "./contracts/execution-lane";
export { createExecutionDossierV1, parseExecutionDossierHistoryV1, parseExecutionDossierV1, reviseExecutionDossierV1 } from "./contracts/execution-dossier";
export type { ExecutionDossierHistoryV1, ExecutionDossierInputV1, ExecutionDossierV1 } from "./contracts/execution-dossier";
export * from "./contracts/approval-receipt";
export * from "./contracts/authoritative-outcome";
export * from "./contracts/baseline-evidence";
export * from "./contracts/legacy-genesis";
export {
  assertCriticalApplyPreflightV1,
  buildApplyPreflightReceiptV1,
  buildCandidateRefV1,
  buildProtectedRequirementSnapshotV1,
  deriveQaImpactInvalidationV1,
  parseCandidateRefV1,
  parseQaAuthorityBindingV1,
  parseQaAuthoritySnapshotV1,
  validateCandidateRefV1,
} from "./contracts/qa-authority";
export type {
  ApplyPreflightReceiptV1,
  CandidateRefV1,
  ProtectedRequirementSnapshotV1,
  QaAuthorityBindingV1,
  QaAuthoritySnapshotV1,
  QaConvergenceAuthoritySourceV1,
  QaEvidenceReuseReceiptV1,
  QaFreshnessAuthorityV1,
  QaImpactInvalidationV1,
  QaStageV1,
} from "./contracts/qa-authority";
export * from "./contracts/registry-lifecycle-intent";
export * from "./contracts/session-change-selection";
export {
  buildVerificationCheckResultV1,
  buildVerificationStageExecutionPlanV1,
  joinVerificationStageExecutionV1,
  parseVerificationCheckResultV1,
  parseVerificationStageExecutionJoinV1,
  parseVerificationStageExecutionPlanV1,
  parseVerificationWaveExecutionReceiptV1,
} from "./contracts/verification-stage-execution";
export type {
  CheckEffectProfileV1,
  VerificationCheckDescriptorV1,
  VerificationCheckOutcomeV1,
  VerificationCheckResultV1,
  VerificationStageExecutionJoinV1,
  VerificationStageExecutionPlanV1,
  VerificationWaveExecutionReceiptV1,
} from "./contracts/verification-stage-execution";

// Orchestrator
export * from "./orchestrator/risk-scorer";
export * from "./orchestrator/quality-router";
export * from "./orchestrator/loop-breaker";
export * from "./orchestrator/budget-watchdog";
export * from "./orchestrator/orchestrator-pipeline";
export * from "./orchestrator/project-discovery";
export * from "./orchestrator/enforcement-mode";
export * from "./orchestrator/failure-delta";
export * from "./orchestrator/protected-risk";
export * from "./orchestrator/repair-loop-governance";
export { evaluateExecutionDecisionV1 } from "./orchestrator/decision-kernel";
export type { ExecutionDecisionKernelInputV1 } from "./orchestrator/decision-kernel";
export { createStagedVerificationScheduleV1, transitionStagedVerificationV1, validateVerificationAcceptanceV1, validateVerificationDisciplineV1 } from "./orchestrator/staged-verification";
export type { MandatoryBroadReasonV1, StagedVerificationPolicyV1, StagedVerificationTransitionResultV1, VerificationDisciplineEvidenceV1, VerificationStageTransitionV1 } from "./orchestrator/staged-verification";
export { evaluateFreshnessPolicyV1, projectCausalContextForRoleV1 } from "./orchestrator/freshness-policy";
export type { FreshReviewTriggerV1, FreshnessPolicyInputV1, FreshnessPolicyResultV1 } from "./orchestrator/freshness-policy";
export { adaptLaneToCheckPlanV1, assignExecutionLaneCohortV1, selectExecutionLaneV1 } from "./orchestrator/execution-lane-router";
export type { ExecutionLaneFactsV1, ExecutionLanePolicyV1, LaneCheckPlanV1, RoutePolicyV1, SelectExecutionLaneInputV1 } from "./orchestrator/execution-lane-router";
export * from "./orchestrator/broad-causal-disposition";
export * from "./orchestrator/coordination-assessment";
export * from "./orchestrator/developer-team-leadership";
export * from "./orchestrator/finding-disposition-service";
export * from "./orchestrator/governance-recovery";
export * from "./orchestrator/outcome-reconciliation";
export * from "./orchestrator/process-posture";
export * from "./orchestrator/quality-readiness";
export * from "./orchestrator/verification-stage-executor";

// Runner
export * from "./runner/runner-recovery";
export * from "./runner/runner-pipeline";

// Artifact state
export * from "./artifact-state/artifact-state-manager";
export { createRegistryCoordinatorV1, isTrustedRegistryCoordinatorV1 } from "./artifact-state/registry-coordinator";
export type { RegistryCoordinatorCodeV1, RegistryCoordinatorOptionsV1, RegistryCoordinatorResultV1, RegistryCoordinatorV1 } from "./artifact-state/registry-coordinator";
export { createFileSystemRegistryStoreV1, createNodeRegistryFileSystemPortV1 } from "./artifact-state/filesystem-registry-store";
export type { FileSystemRegistryStoreOptionsV1, RegistryFileStatV1, RegistryFileSystemPortV1 } from "./artifact-state/filesystem-registry-store";
export { buildRegistryPairTransactionV1, classifyRegistryRecoveryV1, markRegistryTransactionCommittedV1, parseRegistryPairTransactionV1 } from "./artifact-state/registry-transaction";
export type { RegistryRecoveryActionV1 } from "./artifact-state/registry-transaction";
export { bindExecutionPlanQaAuthorityV1, classifyInvalidExecutionInputV1, commitExecutionRegistryIntentsV1, consumeExecutionRoleResultV1, parseExecutionRoleInvocationV1, planExecutionDecisionV1, replayExecutionDecisionV1, scheduleExecutionRoleInvocationV1 } from "./execution/execution-control-plane";
export type { DecisionKernelModeV1, ExecutionAuthorityStateV1, ExecutionControlRoleV1, ExecutionPlanV1, ExecutionRegistryCommitResultV1, ExecutionRegistryCoordinatorPortV1, ExecutionReplayRecordV1, ExecutionRoleInvocationV1, ExecutionRoleResultConsumptionV1, ExecutionRoleResultEnvelopeV1, ExecutionRoleScheduleResultV1, ExecutionRoleSchedulingInputV1, GitSafetyStateV1, InvalidExecutionInputIdentityV1, TerminalGovernanceContextV1 } from "./execution/execution-control-plane";
export * from "./execution/qa-execution-authority";
export * from "./execution/qa-runner-host-authority";
export { composeDeveloperTeamExecutionV1, runProductionExecutionDecisionPipelineV1 } from "./execution/execution-composition";
export type { DeveloperTeamExecutionCompositionInputV1, DeveloperTeamExecutionCompositionResultV1 } from "./execution/execution-composition";
export { capabilityDescriptorDigestV1, executeDeveloperTeamStepV1, executeTargetedRepairV1 } from "./execution/execution-adapter-port";
export type { EffectResultV1, ExecutionAdapterPortV1, TargetedRepairCapabilityDescriptorV1, TargetedRepairCapabilityV1, TargetedRepairRequestV1 } from "./execution/execution-adapter-port";
export { createInvocationAuthorizationServiceV1 } from "./execution/invocation-authorization-service";
export type { InvocationAuthorizationEnvelopeV1, InvocationAuthorizationExpectationV1, InvocationAuthorizationIssueInputV1, InvocationAuthorizationRejectionCodeV1, InvocationAuthorizationServiceOptionsV1, InvocationAuthorizationServiceV1, InvocationAuthorizationValidationResultV1 } from "./execution/invocation-authorization-service";
export { aggregateDeckPreparationHandoffV1, buildSessionPreparationDelegationDigestV1, consumeSessionPreparationAuthorizationV1, createSessionPreparationAuthorizationServiceV1, createSessionPreparationStateV1, parseDeckPreparationHandoffV1, parseSessionPreparationRequestV1 } from "./execution/session-preparation";
export type { DeckPreparationComponentHandoffV1, DeckPreparationComponentStatusV1, DeckPreparationHandoffBaseV1, DeckPreparationHandoffV1, DeckPreparationNextActionV1, DeckPreparationTelemetryV1, OpenSpecPreparationStatusV1, SessionPreparationAuthorizationClaimsV1, SessionPreparationAuthorizationEnvelopeV1, SessionPreparationAuthorizationExpectationV1, SessionPreparationAuthorizationIssueInputV1, SessionPreparationAuthorizationRejectionCodeV1, SessionPreparationAuthorizationServiceOptionsV1, SessionPreparationAuthorizationServiceV1, SessionPreparationAuthorizationValidationResultV1, SessionPreparationCompletionResultV1, SessionPreparationDelegationV1, SessionPreparationNeedV1, SessionPreparationOperationV1, SessionPreparationRequestV1, SessionPreparationStateResultV1, SessionPreparationStateV1, SkillDiscoveryContextV1, SkillRegistryStatusV1 } from "./execution/session-preparation";
export { createDeveloperTeamRunnerHostBridgeV1 } from "./execution/developer-team-runner-host-bridge";
export type { DeveloperTeamHostExecutionEventV1, DeveloperTeamHostExecutionResultV1, DeveloperTeamRunnerHostBridgeOptionsV1, DeveloperTeamRunnerHostBridgeV1 } from "./execution/developer-team-runner-host-bridge";
export { aggregateRolloutTelemetryV1, aggregateUserOutcomeTelemetryV1, assignExecutionCohort, createBoundedLocalTelemetrySink, createConfiguredTelemetrySinkV1, createNoopTelemetrySink, probeRunnerExecutionCapabilities, recordBoundedBaseline, serializeSafeTelemetryEvent, serializeUserOutcomeTelemetryAggregateV1, serializeUserOutcomeTelemetryEventV1 } from "./execution/telemetry";
export type { ConfiguredTelemetrySinkV1, RolloutMetricObservationV1, RolloutObservationV1, RolloutSafetyObservationV1, SafeExecutionBaselineTelemetryEventV1, SafeExecutionTelemetryEventV1, SafeRolloutExecutionTelemetryEventV1, SafeTelemetrySinkV1, TelemetryLaneV1, TelemetryPhaseV1, TelemetryRiskTierV1, TelemetryRunnerV1, UserOutcomeMetricObservationV1, UserOutcomeTelemetryAggregateV1, UserOutcomeTelemetryEventNameV1, UserOutcomeTelemetryEventV1 } from "./execution/telemetry";
export { evaluateCompactPromptActivationV1, evaluateRolloutGateV1, resolvePromptProfileActivationV1, transitionRolloutStateV1 } from "./execution/rollout-policy";
export type { PromptProfileActivationV1, RolloutCohortPercentV1, RolloutControlsV1, RolloutEfficiencyV1, RolloutGateDecisionV1, RolloutGateStatusV1, RolloutHistoryEventV1, RolloutResponsibleControlV1, RolloutStateV1 } from "./execution/rollout-policy";
