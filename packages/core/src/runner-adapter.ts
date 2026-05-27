/**
 * RunnerAdapter — TUI-facing runner abstraction for the Deck Developer Team.
 *
 * This interface is the stable port through which the TUI layer (app.tsx,
 * runner-dashboard, developer-team-screens) delegates all runner-specific
 * operations. It is completely agnostic of any specific runner (Pi, OpenCode, etc.).
 *
 * The interface composes lower-level capability facets (from runner-capability.ts)
 * with TUI-specific types (Dashboard, ReviewPlan, InstallationPlan, FlowState).
 *
 * Design: runner-decoupling-refactor / design.md § RunnerAdapter Contract
 */

import type {
  RunnerEnvironmentId,
  TeamEntry,
  ModelCatalog,
  ReasoningLevel,
  RunnerDeveloperTeamInstallPlan,
  DeveloperTeamApplyInput,
  DeveloperTeamApplyResult,
  AdaptiveMemoryProvider,
} from "./runner-capability";
import type { CapabilityInstructionBundle } from "./teams/developer/instruction-bundles";

// ---------------------------------------------------------------------------
// Aliases for ergonomic use in adapter consumers
// ---------------------------------------------------------------------------

/** Unique runner identifier (e.g. "pi", "opencode") */
export type RunnerId = string;

/** Runner-specific environment (e.g. "pi-development") */
export type EnvironmentId = string;

// ---------------------------------------------------------------------------
// Shared assignment types (moved from adapter packages to @deck/core)
// These are runner-agnostic; adapters map their native thinking levels to these.
// ---------------------------------------------------------------------------

/**
 * Model assignments for Developer Team agents.
 * Record<agentId, modelId>
 *
 * Moved from @deck/adapter-pi and @deck/adapter-opencode model-config.ts
 * to eliminate cross-adapter type dependency.
 */
export type DeveloperTeamModelAssignments = Record<string, string>;

/**
 * Thinking level assignments for Developer Team agents.
 * Record<agentId, thinkingLevel>
 *
 * Moved from @deck/adapter-pi and @deck/adapter-opencode model-config.ts
 * to eliminate cross-adapter type dependency.
 *
 * Uses string (instead of RunnerThinkingLevel) because thinking levels differ
 * across runners: Pi uses "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
 * while OpenCode uses "off" | "low" | "medium" | "high". Adapters handle the
 * mapping to their specific types internally.
 */
export type DeveloperTeamThinkingAssignments = Record<string, string>;

/**
 * Runner-agnostic thinking level.
 * Adapters map their native thinking levels (PiThinkingLevel, OpenCodeThinkingLevel)
 * to this canonical type.
 */
export type RunnerThinkingLevel = ReasoningLevel;

// ---------------------------------------------------------------------------
// Runtime detection (detectRuntimes)
// ---------------------------------------------------------------------------

export type RuntimeDetectionInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
};

export type RuntimeStatus = {
  runtimeId: string;
  displayName: string;
  isAvailable: boolean;
  version?: string;
  diagnostics?: readonly string[];
};

// ---------------------------------------------------------------------------
// Capability inventory (getCapabilityInventory)
// ---------------------------------------------------------------------------

export type CapabilityInventoryInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
  runnerId: RunnerId;
};

/**
 * Minimal capability inventory structure for core-facing TUI consumption.
 * Adapters transform their native capability catalogs into this shape.
 */
export type CapabilityInventory = {
  capabilities: readonly CapabilityCatalogEntry[];
  runnerId: RunnerId;
  environmentId: RunnerEnvironmentId;
};

export type CapabilityCatalogEntry = {
  capabilityId: string;
  label: string;
  description: string;
  section: string;
  requirementLevel: "required" | "optional" | "configurable";
  toolId?: string;
  source?: string;
  installKind: "pi-package" | "external" | "opencode-plugin";
  isInstalled: boolean;
  isBlocked: boolean;
  diagnostics?: readonly string[];
};

// ---------------------------------------------------------------------------
// Dashboard state (passed to buildReviewPlan / buildInstallationPlan)
// Minimal core-facing DTO — adapter transforms this into runner-specific plans.
// ---------------------------------------------------------------------------

export type DashboardState = {
  runnerId: RunnerId;
  environmentId: RunnerEnvironmentId;
  selectedCapabilities: Record<string, boolean>;
  packageInstructions: Record<string, boolean>;
  adaptiveMemory: {
    provider: "none" | "engram" | "supermemory";
    supermemory?: {
      configured: boolean;
      userId?: string;
      teamId?: string;
      organizationId?: string;
      hasToken?: boolean;
    };
  };
};

// ---------------------------------------------------------------------------
// Review and Installation plans (buildReviewPlan / buildInstallationPlan)
// ---------------------------------------------------------------------------

export type ReviewPlan = {
  groups: {
    automaticInstalls: readonly RunnerAction[];
    manualSteps: readonly RunnerAction[];
    configWrites: readonly RunnerAction[];
    teamApplications: readonly RunnerAction[];
    validations: readonly RunnerAction[];
  };
  diagnostics: readonly RunnerPlanDiagnostic[];
  ready: boolean;
};

export type InstallationPlan = {
  steps: readonly InstallationStep[];
  estimatedDuration?: string;
};

export type InstallationStep = {
  action: "install" | "configure" | "skip" | "validate";
  tool: string;
  reason?: string;
  capabilityId?: string;
};

// ---------------------------------------------------------------------------
// Action execution (runAction)
// ---------------------------------------------------------------------------

export type RunnerActionContext = {
  projectRoot: string;
  runnerId: RunnerId;
  environmentId: RunnerEnvironmentId;
  runnerCommand?: string;
  dashboardState?: DashboardState;
  supermemoryToken?: string;
  /** Resolved adaptive memory provider — set by action-runner before calling runAction */
  resolvedMemoryProvider?: import("./memory/adaptive-memory").AdaptiveMemoryProvider;
};

export type RunnerActionRunResult = {
  actionId: string;
  status: "executed" | "informational" | "skipped" | "failed";
  message: string;
  diagnostics: readonly string[];
  raw?: unknown;
};

// ---------------------------------------------------------------------------
// Model catalog (getModelCatalog, readModelAssignments, readThinkingAssignments)
// ---------------------------------------------------------------------------

export type ModelCatalogContext = {
  projectRoot?: string;
  environmentId?: RunnerEnvironmentId;
  runnerId?: RunnerId;
};

// ---------------------------------------------------------------------------
// Developer Team install (buildDeveloperTeamInstallPlan / applyDeveloperTeamInstall)
// ---------------------------------------------------------------------------

export type DeveloperTeamAdapterInstallInput = {
  projectRoot: string;
  environmentId: RunnerEnvironmentId;
  modelAssignments?: DeveloperTeamModelAssignments;
  thinkingAssignments?: DeveloperTeamThinkingAssignments;
  memoryProvider?: AdaptiveMemoryProvider;
  capabilityInstructions?: CapabilityInstructionBundle;
  standaloneSkills?: readonly { skillId: string; body: string }[];
};

// ---------------------------------------------------------------------------
// MCP config (writeMcpConfig)
// ---------------------------------------------------------------------------

export type RunnerMcpConfigInput = {
  serverName: string;
  token?: string;
  type?: "local" | "remote";
  command?: readonly string[];
  url?: string;
  headers?: Record<string, string>;
};

export type RunnerMcpConfigResult = {
  ok: boolean;
  path: string;
  diagnostics?: string[];
};

// ---------------------------------------------------------------------------
// Flow state and next screen (getNextScreen)
// ---------------------------------------------------------------------------

/**
 * Minimal flow state passed to getNextScreen.
 * Adapters use this to determine the next TUI screen based on their
 * runner-specific flow logic.
 */
export type FlowState = {
  currentScreen: NextScreen;
  runnerId: RunnerId;
  environmentId: RunnerEnvironmentId;
  selectedEnvironments?: readonly string[];
  selectedTeams?: readonly string[];
  installProgress?: {
    completed: number;
    total: number;
  };
  /** Optional context passed through the flow */
  context?: Record<string, unknown>;
};

/**
 * Screen labels for the developer team flow.
 * Runner-specific screens (pi-preflight-checking, opencode-preflight-checking)
 * are generalized here as generic flow labels that adapters resolve from their
 * runner-specific screen names.
 */
export type NextScreen =
  | "team-selection"
  | "developer-team-review"
  | "developer-team-installing"
  | "environment-selection"
  | "personality-selection"
  | "preflight-checking"
  | "complete";

// ---------------------------------------------------------------------------
// RunnerAction — generic action structure used in ReviewPlan
// ---------------------------------------------------------------------------

export type RunnerActionStatus = "ready" | "manual" | "pending" | "blocked" | "complete" | "failed";

export type RunnerAction = {
  id: string;
  kind: string;
  title: string;
  description?: string;
  capabilityId?: string;
  toolId?: string;
  /** Identifies internal package install actions */
  internalPackageId?: string;
  implementationId?: string;
  source?: string;
  status: RunnerActionStatus;
  required?: boolean;
  dependencies?: readonly string[];
  unresolvedCapabilities?: readonly string[];
  diagnostics?: readonly string[];
};

export type RunnerPlanDiagnosticSeverity = "info" | "warning" | "error";

export type RunnerPlanDiagnostic = {
  code: string;
  message: string;
  severity: RunnerPlanDiagnosticSeverity;
  capabilityId?: string;
  actionId?: string;
};

// ---------------------------------------------------------------------------
// RunnerAdapter interface
// ---------------------------------------------------------------------------

/**
 * RunnerAdapter — the primary abstraction for runner-specific behavior in the TUI.
 *
 * This interface is implemented by concrete adapters (PiRunnerAdapter, OpenCodeRunnerAdapter)
 * and consumed by the TUI layer without any knowledge of the specific runner.
 *
 * Design: runner-decoupling-refactor / design.md § RunnerAdapter Contract
 */
export interface RunnerAdapter {
  /** Unique identifier for this runner (e.g. "pi", "opencode") */
  readonly runnerId: RunnerId;

  /** Human-readable display name for UI rendering */
  readonly displayName: string;

  /** Environment IDs supported by this runner */
  readonly environmentIds: readonly RunnerEnvironmentId[];

  // -------------------------------------------------------------------------
  // Runtime detection
  // -------------------------------------------------------------------------

  /**
   * Detect available runtimes for this runner.
   * Returns runtime status including availability, version, and diagnostics.
   */
  detectRuntimes(input?: RuntimeDetectionInput): Promise<readonly RuntimeStatus[]>;

  // -------------------------------------------------------------------------
  // Capability inventory
  // -------------------------------------------------------------------------

  /**
   * Build the capability inventory for the dashboard review screen.
   * Returns a structured inventory of all capabilities for this runner/environment.
   */
  getCapabilityInventory(input: CapabilityInventoryInput): Promise<CapabilityInventory>;

  // -------------------------------------------------------------------------
  // Review and installation planning
  // -------------------------------------------------------------------------

  /**
   * Build a review plan from the current dashboard state and capability inventory.
   * The plan groups actions by execution phase (automaticInstalls, manualSteps, etc.).
   */
  buildReviewPlan(state: DashboardState, inventory: CapabilityInventory): ReviewPlan;

  /**
   * Build an installation plan from the current dashboard state.
   * Returns ordered installation steps for execution.
   */
  buildInstallationPlan(state: DashboardState): InstallationPlan;

  // -------------------------------------------------------------------------
  // Action execution
  // -------------------------------------------------------------------------

  /**
   * Execute a single runner action (install, configure, validate, etc.).
   * Returns the result of the action execution.
   */
  runAction(action: RunnerAction, context: RunnerActionContext): Promise<RunnerActionRunResult>;

  // -------------------------------------------------------------------------
  // Team management
  // -------------------------------------------------------------------------

  /**
   * Enumerate available teams for the given environment.
   */
  getTeams(environmentId: RunnerEnvironmentId): readonly TeamEntry[];

  // -------------------------------------------------------------------------
  // Model catalog and assignments
  // -------------------------------------------------------------------------

  /**
   * Get the model catalog for this runner.
   * Returns canonical model data with runner-specific annotations.
   */
  getModelCatalog(context?: ModelCatalogContext): ModelCatalog;

  /**
   * Read current model assignments for the developer team from project config.
   * Returns a record mapping agentId → modelId.
   * If projectRoot is not provided, adapters should resolve it internally.
   */
  readModelAssignments(projectRoot?: string): DeveloperTeamModelAssignments;

  /**
   * Read current thinking level assignments for the developer team from project config.
   * Returns a record mapping agentId → thinkingLevel.
   * If projectRoot is not provided, adapters should resolve it internally.
   */
  readThinkingAssignments(projectRoot?: string): DeveloperTeamThinkingAssignments;

  /**
   * Get the available thinking levels for this runner.
   * Optionally filtered by a specific modelId.
   */
  getThinkingLevels(modelId?: string): readonly RunnerThinkingLevel[];

  /**
   * Check whether a given model supports thinking/reasoning.
   */
  supportsThinking(modelId: string): boolean;

  // -------------------------------------------------------------------------
  // Developer Team installation
  // -------------------------------------------------------------------------

  /**
   * Build an installation plan for the developer team.
   * Considers model assignments, thinking assignments, memory provider, and
   * capability instructions.
   */
  buildDeveloperTeamInstallPlan(input: DeveloperTeamAdapterInstallInput): RunnerDeveloperTeamInstallPlan;

  /**
   * Apply the developer team installation plan to disk.
   */
  applyDeveloperTeamInstall(input: DeveloperTeamApplyInput): Promise<DeveloperTeamApplyResult>;

  // -------------------------------------------------------------------------
  // MCP config (optional — some runners may not support MCP)
  // -------------------------------------------------------------------------

  /**
   * Write MCP configuration for the given server.
   * Returns the result of the config write operation.
   */
  writeMcpConfig?(input: RunnerMcpConfigInput): Promise<RunnerMcpConfigResult>;

  // -------------------------------------------------------------------------
  // Flow routing
  // -------------------------------------------------------------------------

  /**
   * Resolve the next TUI screen based on the current flow state.
   * Adapters use their runner-specific screen resolution logic here.
   */
  getNextScreen(state: FlowState): NextScreen;

  // -------------------------------------------------------------------------
  // Environment inspection (wraps inspectPiEnvironment / inspectOpenCodeEnvironment)
  // -------------------------------------------------------------------------

  /**
   * Inspect the runner environment for configuration, version, and readiness.
   * Returns runner-specific preflight result.
   */
  inspectEnvironment(): Promise<unknown>;

  // -------------------------------------------------------------------------
  // Tool review (wraps reviewPiRequiredTools / reviewOpenCodeTools)
  // -------------------------------------------------------------------------

  /**
   * Review the status of required and optional tools for this runner.
   * Returns runner-specific tools review.
   */
  reviewTools(): Promise<unknown>;

  // -------------------------------------------------------------------------
  // Team file backup/restore (wraps backup/restore functions)
  // -------------------------------------------------------------------------

  /**
   * Backup developer team files before making changes.
   * Returns backup metadata for potential rollback.
   */
  backupDeveloperTeamFiles(plan: unknown): unknown;

  /**
   * Rollback developer team files from a previous backup.
   * Restores files to their state before installation.
   */
  rollbackDeveloperTeamFiles(backup: unknown): void;

  // -------------------------------------------------------------------------
  // Developer team verification
  // -------------------------------------------------------------------------

  /**
   * Verify the developer team installation is valid and complete.
   * Returns verification result with valid flag and diagnostics.
   */
  verifyDeveloperTeamInstall(plan: unknown): { valid: boolean; diagnostics: readonly string[] };

  // -------------------------------------------------------------------------
  // Thinking resolution (wraps resolveThinking functions)
  // -------------------------------------------------------------------------

  /**
   * Resolve the thinking/reasoning level for a given model.
   * Returns the resolved thinking level or undefined.
   */
  resolveThinking(modelId: string, existingAssignment?: string): string | undefined;

  /**
   * Get the default thinking level for a model.
   */
  getDefaultThinking(modelId: string): string;

  // -------------------------------------------------------------------------
  // Capability catalog access
  // -------------------------------------------------------------------------

  /**
   * Get a capability entry by ID from the runner's capability catalog.
   */
  getCapability(capabilityId: string): unknown;

  /**
   * Get all user-facing capability IDs for this runner.
   */
  getCapabilityIds(): readonly string[];

  // -------------------------------------------------------------------------
  // Selectable tools
  // -------------------------------------------------------------------------

  /**
   * Get the list of selectable/installable tools for this runner.
   */
  getSelectableTools(): unknown[];
}