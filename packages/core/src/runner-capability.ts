/**
 * RunnerCapabilities — runner-neutral capability interfaces for the Deck Developer Team.
 *
 * These types define the port that each runner adapter implements and that the
 * CLI/TUI consumes. They are intentionally free of any runner-specific or
 * provider-specific string literals.
 *
 * The aggregate `RunnerCapabilities` is composed of focused facets:
 * - environment inspection
 * - tool installation
 * - team management and Developer Team manifest
 * - model catalog and assignment
 * - memory provider registry
 *
 * Each facet is its own type so callers can consume only what they need.
 */

// ---------------------------------------------------------------------------
// Core IDs
// ---------------------------------------------------------------------------

/** A unique runner identifier, e.g. "pi" or "opencode" */
export type RunnerId = string;

/** A runner-specific environment ID, e.g. "pi-development" */
export type RunnerEnvironmentId = string;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export type RunnerEnvironment = {
  id: RunnerEnvironmentId;
  displayName: string;
  description?: string;
};

export type RunnerEnvironmentInspectInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
};

export type RunnerEnvironmentInspection = {
  environmentId: RunnerEnvironmentId;
  isConfigured: boolean;
  missingTools?: readonly string[];
  diagnostics?: readonly string[];
};

// ---------------------------------------------------------------------------
// Tool capabilities
// ---------------------------------------------------------------------------

export type RunnerInstallationInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
};

export type RunnerToolInstallResult = {
  installed: boolean;
  tool?: string;
};

export type RunnerToolReviewInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
};

export type RunnerToolReviewResult = {
  tools: readonly string[];
  missing: readonly string[];
};

/**
 * Runner tool optional tool entry for UI selection.
 */
export type RunnerToolOptionalTool = {
  id: string;
  name: string;
  source: string;
  installKind: "pi-package" | "external" | "opencode-plugin";
};

export type RunnerToolCapabilities = {
  buildInstallationPlan(input: RunnerInstallationInput): RunnerInstallationPlan;
  installTools(input: RunnerToolInstallInput): Promise<RunnerToolInstallResult>;
  reviewTools(input: RunnerToolReviewInput): Promise<RunnerToolReviewResult>;
  /** Returns the list of optional tools available for selection (excludes required tools). */
  getOptionalTools?(): readonly RunnerToolOptionalTool[];
};

export type RunnerInstallationPlan = {
  steps: readonly InstallationStep[];
};

export type InstallationStep = {
  action: "install" | "configure" | "skip";
  tool: string;
  reason?: string;
};

export type RunnerToolInstallInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
  tools?: readonly string[];
};

// ---------------------------------------------------------------------------
// Team capabilities
// ---------------------------------------------------------------------------

import type { CapabilityInstructionBundle } from "./teams/developer/instruction-bundles/index";

export type DeveloperTeamManifestInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
  modelAssignments?: readonly DeveloperTeamModelAssignmentInput[];
  memoryProviderId?: string;
  /** Optional capability instruction bundle for the manifest */
  capabilityInstructions?: CapabilityInstructionBundle;
};

export type DeveloperTeamModelAssignmentInput = {
  agentId: string;
  modelId: string;
  reasoning?: string;
};

export type DeveloperTeamManifest = {
  team: TeamEntry;
  agents: readonly DeveloperTeamManifestAgent[];
  skills: readonly DeveloperTeamManifestSkill[];
  standaloneSkills?: readonly DeveloperTeamManifestStandaloneSkill[];
  memoryDiagnostics: readonly MemoryDiagnostic[];
};

export type TeamEntry = {
  id: string;
  displayName: string;
  description?: string;
};

export type DeveloperTeamManifestAgent = {
  agentId: string;
  displayName: string;
  instruction: string;
  model?: string;
  reasoning?: string;
  memoryBundle?: MemoryInjectionBundle;
};

export type DeveloperTeamManifestSkill = {
  agentId: string;
  skillId: string;
  body: string;
  memoryBundle?: MemoryInjectionBundle;
};

export type DeveloperTeamManifestStandaloneSkill = {
  skillId: string;
  /** Verbatim SKILL.md content including frontmatter. */
  body: string;
  /** Support files keyed by relative POSIX path. Core emits {} when none exist. */
  files?: Record<string, string>;
};

export type MemoryDiagnostic = {
  code: string;
  message: string;
  providerId?: string;
  details?: Readonly<Record<string, unknown>>;
};

export type MemoryInjectionBundle = {
  instructions: readonly MemoryInstructionFragment[];
  toolBindings: readonly MemoryToolBinding[];
};

export type MemoryInstructionFragment = {
  surface: "session" | "agent" | "skill";
  markdown: string;
  teamId?: string;
  agentIds?: readonly string[];
  skillIds?: readonly string[];
};

export type MemoryToolBinding = {
  capability: string;
  serverName: string;
  toolNames: readonly string[];
  metadata?: Readonly<Record<string, unknown>>;
};

export type DeveloperTeamInstallPlanInput = {
  projectRoot: string;
  manifest: DeveloperTeamManifest;
  environmentId: RunnerEnvironmentId;
  capabilityInstructions?: import("./teams/developer/instruction-bundles/index").CapabilityInstructionBundle;
};

export type RunnerDeveloperTeamInstallPlan = {
  files: readonly DeveloperTeamInstallFile[];
};

export type DeveloperTeamInstallFile = {
  path: string;
  content: string;
  kind?: "agent" | "skill" | "standalone-skill" | "command" | "prompt" | "other";
  skillId?: string;
  packagePath?: string;
};

export type DeveloperTeamApplyInput = {
  projectRoot: string;
  plan: RunnerDeveloperTeamInstallPlan;
  environmentId: RunnerEnvironmentId;
};

export type RunnerDeveloperTeamApplyResult = {
  success: boolean;
  appliedFiles?: readonly string[];
  errors?: readonly string[];
};

export type DeveloperTeamVerifyInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
  capabilityInstructions?: import("./teams/developer/instruction-bundles/index").CapabilityInstructionBundle;
};

export type RunnerDeveloperTeamVerifyResult = {
  isInstalled: boolean;
  missingFiles?: readonly string[];
};

export type RunnerTeamCapabilities = {
  getTeamsForEnvironment(environmentId: RunnerEnvironmentId): readonly TeamEntry[];
  buildDeveloperTeamManifest(input: DeveloperTeamManifestInput): DeveloperTeamManifest;
  buildDeveloperTeamInstallPlan(input: DeveloperTeamInstallPlanInput): RunnerDeveloperTeamInstallPlan;
  applyDeveloperTeamInstall(input: DeveloperTeamApplyInput): Promise<RunnerDeveloperTeamApplyResult>;
  verifyDeveloperTeamInstall(input: DeveloperTeamVerifyInput): Promise<RunnerDeveloperTeamVerifyResult>;
};

// ---------------------------------------------------------------------------
// Model capabilities
// ---------------------------------------------------------------------------

// Import canonical model types from model-catalog
import type {
  ModelProviderEntry,
  ModelEntry,
  DeveloperTeamDefaultModelAssignment,
  ModelCatalog,
  ReasoningLevel,
} from "./model-catalog";

export type { ReasoningLevel };

export type {
  ModelProviderEntry,
  ModelEntry as ModelCatalogEntry,
  DeveloperTeamDefaultModelAssignment,
  ModelCatalog,
};

export type RunnerModelCatalogInput = {
  projectRoot?: string;
  environmentId?: RunnerEnvironmentId;
};

export type RunnerModelResolveInput = {
  agentId: string;
  modelId?: string;
  reasoning?: ReasoningLevel;
  environmentId: RunnerEnvironmentId;
};

export type RunnerResolvedModelAssignment = {
  agentId: string;
  modelId: string;
  reasoning?: ReasoningLevel;
};

export type RunnerModelCapabilities = {
  getCatalog(input?: RunnerModelCatalogInput): ModelCatalog;
  readAssignments(input: RunnerModelAssignmentReadInput): RunnerModelAssignments;
  resolveAssignment(input: RunnerModelResolveInput): RunnerResolvedModelAssignment;
};

export type RunnerModelAssignmentReadInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
};

export type RunnerModelAssignments = {
  assignments: readonly DeveloperTeamDefaultModelAssignment[];
};

// ---------------------------------------------------------------------------
// Memory capabilities
// ---------------------------------------------------------------------------

export type RunnerMemoryProviderInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
};

export type AdaptiveMemoryProvider = {
  id: string;
  displayName: string;
  buildInjection(context: { teamId?: string }): MemoryInjectionBundle;
  health?(): Promise<AdaptiveMemoryHealthResult> | AdaptiveMemoryHealthResult;
};

export type AdaptiveMemoryHealthResult = {
  providerId: string;
  status: "available" | "unavailable" | "degraded" | "unknown";
  checkedAt?: string;
  diagnostics?: readonly MemoryDiagnostic[];
};

export type RunnerMemoryCapabilities = {
  getProviders(input: RunnerMemoryProviderInput): readonly AdaptiveMemoryProvider[];
  getSupportedProviderIds(): readonly string[];
};

// ---------------------------------------------------------------------------
// Capability catalog (for dashboard / UI)
// ---------------------------------------------------------------------------

/**
 * A user-facing capability entry returned by the runner's capability catalog.
 * Used by the dashboard UI to display capability summaries and selection state.
 */
export type RunnerCapabilityCatalogEntry = {
  capabilityId: string;
  label: string;
  description: string;
  section: string;
  runnerScope: string;
  requirementLevel: "required" | "optional" | "configurable";
  toolId?: string;
  source?: string;
  installKind: "pi-package" | "external" | "opencode-plugin" | "pending";
  isInternal?: boolean;
};

/**
 * Resolver for looking up capability entries and getting user-facing IDs.
 * The TUI dashboard uses this to display capability selections without
 * importing from adapters directly.
 */
export type RunnerCapabilityResolver = {
  /** Returns the full capability entry, or undefined if not found. */
  getCapability(capabilityId: string): RunnerCapabilityCatalogEntry | undefined;
  /** Returns the list of user-facing capability IDs (excludes internal). */
  getUserFacingIds(): readonly string[];
};

// ---------------------------------------------------------------------------
// Install capabilities (tool installation operations)
// ---------------------------------------------------------------------------

export type RunnerInstallPlanInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
  requiredTools?: readonly string[];
  selectedOptionalToolIds?: readonly string[];
};

export type RunnerInstallPlan = {
  steps: readonly InstallationStep[];
};

export type RunnerInstallApplyOptions = {
  command: string;
  tools: readonly InstallableTool[];
  onResult?: (result: RunnerInstallResult) => void;
};

export type InstallableTool = {
  id: string;
  name: string;
  source: string;
  installKind: "pi-package" | "external" | "opencode-plugin";
};

export type RunnerInstallResult = {
  tool: string;
  success: boolean;
  status?: string;
  message?: string;
};

export type RunnerToolsReviewInput = {
  command: string;
};

export type RunnerToolsReviewResult = {
  tools: readonly string[];
  missing: readonly string[];
  installedPackages: readonly string[];
};

export type RunnerInstallCapabilities = {
  /** Build an installation plan for required and optional tools. */
  buildPlan(input: RunnerInstallPlanInput): RunnerInstallPlan;
  /** Execute an installation plan. */
  applyPlan(options: RunnerInstallApplyOptions): Promise<readonly RunnerInstallResult[]>;
  /** Review required tools for the environment. */
  reviewTools(input: RunnerToolsReviewInput): Promise<RunnerToolsReviewResult>;
  /** Install tools directly (convenience wrapper). */
  installTools(input: RunnerToolInstallInput): Promise<RunnerToolInstallResult>;
};

// ---------------------------------------------------------------------------
// Developer Team capabilities (install, backup, rollback)
// ---------------------------------------------------------------------------

export type DeveloperTeamInstallInput = {
  projectRoot: string;
  modelAssignments?: readonly DeveloperTeamModelAssignmentInput[];
  reasoningEffortOverrides?: readonly DeveloperTeamModelAssignmentInput[];
  memoryProviderId?: string;
  capabilityInstructions?: import("./teams/developer/instruction-bundles/index").CapabilityInstructionBundle;
};

export type BackupManifest = {
  files: readonly BackupFileEntry[];
  createdAt: string;
};

export type BackupFileEntry = {
  path: string;
  originalContent?: string;
  backupPath: string;
};

export type DeveloperTeamApplyResult = {
  results: readonly DeveloperTeamApplyAgentResult[];
  changedCount: number;
  unchangedCount: number;
};

export type DeveloperTeamApplyAgentResult = {
  agentId: string;
  kind: string;
  status: "unchanged" | "updated" | "added" | "created";
};

export type DeveloperTeamVerifyResult = {
  valid: boolean;
  skillResults?: readonly DeveloperTeamVerifySkillResult[];
  agentResults?: readonly DeveloperTeamVerifyAgentResult[];
};

export type DeveloperTeamVerifySkillResult = {
  agentId: string;
  valid: boolean;
};

export type DeveloperTeamVerifyAgentResult = {
  agentId: string;
  valid: boolean;
};

export type RunnerDeveloperTeamCapabilities = {
  /** Build an installation plan for the developer team. */
  buildInstallPlan(input: DeveloperTeamInstallInput): RunnerDeveloperTeamInstallPlan;
  /** Apply the installation plan to disk. */
  applyInstall(input: DeveloperTeamApplyInput): Promise<DeveloperTeamApplyResult>;
  /** Verify the installation was successful. */
  verifyInstall(input: DeveloperTeamVerifyInput): Promise<DeveloperTeamVerifyResult>;
  /** Create a backup of existing files before applying changes. */
  backupFiles(plan: RunnerDeveloperTeamInstallPlan): BackupManifest;
  /** Rollback changes using a backup manifest. */
  rollbackFiles(backup: BackupManifest): void;
};

// ---------------------------------------------------------------------------
// Model Config capabilities
// ---------------------------------------------------------------------------

export type ModelConfigAssignmentsResult = {
  modelAssignments: Record<string, string>;
  thinkingAssignments: Record<string, string>;
};

export type ModelOverrideOptions = {
  modelId?: string;
  reasoning?: ReasoningLevel;
};

export type ModelConfigResult = {
  agentId: string;
  modelId: string;
  reasoning?: ReasoningLevel;
};

export type RunnerModelConfigCapabilities = {
  /** Read model assignments from the project's config. */
  readAssignments(projectRoot: string): ModelConfigAssignmentsResult;
  /** Resolve the model for an agent, applying overrides to defaults. */
  resolveModel(agentId: string, overrides?: ModelOverrideOptions): ModelConfigResult;
};

// ---------------------------------------------------------------------------
// Aggregate RunnerCapabilities
// ---------------------------------------------------------------------------

export type RunnerCapabilities = {
  id: RunnerId;
  displayName: string;
  environments: readonly RunnerEnvironment[];
  inspectEnvironment(
    input: RunnerEnvironmentInspectInput,
  ): Promise<RunnerEnvironmentInspection>;
  tools: RunnerToolCapabilities;
  teams: RunnerTeamCapabilities;
  models: RunnerModelCapabilities;
  memory: RunnerMemoryCapabilities;
  /** Dashboard UI capability resolver — adapters provide their own catalogs. */
  capabilities?: {
    getCapability(capabilityId: string): RunnerCapabilityCatalogEntry | undefined;
    getUserFacingIds(): readonly string[];
  };
  /** Tool installation operations. */
  install?: RunnerInstallCapabilities;
  /** Developer Team installation, backup, and rollback. */
  developerTeam?: RunnerDeveloperTeamCapabilities;
  /** Model configuration read and resolve. */
  modelConfig?: RunnerModelConfigCapabilities;
};
