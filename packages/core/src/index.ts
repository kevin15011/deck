// Backward-compatible re-exports from old flat paths
export * from "./developer-team-catalog";
export * from "./explorer-prompt";
export * from "./orchestrator-prompt";

// Re-export team-catalog but hide TeamEntry (conflicts with runner-capability)
export { getTeamById, getTeamsForEnvironment, ALL_TEAMS, DEVELOPER_TEAM } from "./team-catalog";
export type { TeamId } from "./team-catalog";

// New canonical exports from teams/developer/ structure
export {
  getAgentContent,
  getTeamSessionInstructions,
  type AgentContent,
} from "./teams/developer/content-registry";

// Runner-neutral capability interface — export aggregate type plus only the types
// needed by consumers of the capability interface. Avoid re-exporting types that
// have canonical definitions elsewhere (model-catalog, adaptive-memory).
export type { RunnerCapabilities } from "./runner-capability";
export {
  validateRunnerCapabilities,
  REQUIRED_CAPABILITIES,
  OPTIONAL_CAPABILITIES,
} from "./runner-capability-validation";
export type { ValidationResult } from "./runner-capability-validation";
export type {
  RunnerId,
  RunnerEnvironmentId,
  RunnerEnvironment,
  RunnerEnvironmentInspectInput,
  RunnerEnvironmentInspection,
  RunnerToolCapabilities,
  RunnerToolOptionalTool,
  RunnerTeamCapabilities,
  RunnerModelCapabilities,
  RunnerMemoryCapabilities,
  RunnerCapabilityCatalogEntry,
  RunnerCapabilityResolver,
  ReasoningLevel,
  ModelCatalog,
  ModelCatalogEntry,
  ModelProviderEntry,
  DeveloperTeamDefaultModelAssignment,
  RunnerInstallationInput,
  RunnerToolInstallInput,
  RunnerToolInstallResult,
  RunnerToolReviewInput,
  RunnerToolReviewResult,
  RunnerDeveloperTeamInstallPlan,
  RunnerDeveloperTeamApplyResult,
  RunnerDeveloperTeamVerifyResult,
  DeveloperTeamManifest,
  DeveloperTeamManifestInput,
  DeveloperTeamInstallPlanInput,
  DeveloperTeamApplyInput,
  DeveloperTeamVerifyInput,
  DeveloperTeamInstallFile,
  TeamEntry,
  RunnerModelCatalogInput,
  RunnerModelResolveInput,
  RunnerResolvedModelAssignment,
  RunnerModelAssignmentReadInput,
  RunnerModelAssignments,
  RunnerMemoryProviderInput,
  RunnerInstallPlanInput,
  RunnerInstallPlan,
  RunnerInstallApplyOptions,
  InstallableTool,
  RunnerInstallResult,
  RunnerToolsReviewInput,
  RunnerToolsReviewResult,
  RunnerInstallCapabilities,
  DeveloperTeamInstallInput,
  BackupManifest,
  BackupFileEntry,
  DeveloperTeamApplyResult,
  DeveloperTeamApplyAgentResult,
  DeveloperTeamVerifyResult,
  DeveloperTeamVerifySkillResult,
  DeveloperTeamVerifyAgentResult,
  RunnerDeveloperTeamCapabilities,
  ModelConfigAssignmentsResult,
  ModelOverrideOptions,
  ModelConfigResult,
  RunnerModelConfigCapabilities,
} from "./runner-capability";

// Canonical model catalog
export * from "./model-catalog";

// Model reasoning capability resolver (hybrid runner > catalog > unknown)
export * from "./model-reasoning-capability";

// Developer Team manifest builder
export {
  buildDeveloperTeamManifest,
  buildDeveloperTeamManifestLegacy,
  getDeveloperTeamAgentIds,
  isManifestModelComplete,
  type ManifestBuildResult,
} from "./teams/developer/manifest";

// Instruction bundle helpers (capability instruction injection)
export {
  buildCapabilityInstructionBundle,
  getEnabledPackageInstructionIds,
  composeCapabilityInstructions,
  type CapabilityInstructionSurface,
  type CapabilityInstructionPackageId,
  type CapabilityInstructionFragment,
  type CapabilityInstructionBundle,
  type CapabilityInstructionCompositionContext,
} from "./teams/developer/instruction-bundles/index";

// Deck project config contracts
export * from "./config/deck-config";

// Adaptive memory provider-neutral contracts, governance, rendering, and compositor
export * from "./memory/adaptive-memory";
export * from "./memory/adaptive-memory-contract";
export * from "./memory/adaptive-memory-governance";
export * from "./memory/adaptive-context-renderer";

// Runner adapter interface and DTOs (TUI-facing runner abstraction)
// Note: RunnerId is already exported from runner-capability.ts (this avoids duplicate export)
export type {
  RunnerAdapter,
  EnvironmentId,
  DeveloperTeamModelAssignments,
  DeveloperTeamThinkingAssignments,
  RunnerThinkingLevel,
  RuntimeDetectionInput,
  RuntimeStatus,
  CapabilityInventoryInput,
  CapabilityInventory,
  CapabilityCatalogEntry,
  DashboardState,
  ReviewPlan,
  InstallationPlan,
  InstallationStep,
  RunnerActionContext,
  RunnerActionRunResult,
  ModelCatalogContext,
  DeveloperTeamAdapterInstallInput,
  RunnerMcpConfigInput,
  RunnerMcpConfigResult,
  FlowState,
  NextScreen,
  RunnerAction,
  RunnerActionStatus,
  RunnerPlanDiagnostic,
  RunnerPlanDiagnosticSeverity,
  RunnerDeckInstallInput,
  RunnerDeckInstallStatus,
} from "./runner-adapter";
// Adapter registry — CLI-side registration with runtime lookup
export {
  createAdapterRegistry,
  type AdapterRegistry,
  RunnerNotRegisteredError,
  DuplicateRunnerError,
} from "./adapter-registry";

// Spec Registry — OpenSpec types, path helpers, and event model
export * from "./spec-registry";

// Bootstrap skills — deck-init and deck-onboard
export * from "./skills/bootstrap";

// Runner Capability / Parity Registry (Batch A - Core foundation)
export * from "./runner-capability-registry";
export * from "./runner-capability-parity";
export * from "./shared-binary-usability";