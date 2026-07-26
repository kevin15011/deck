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
} from "./runner-capability";
import type { AdaptiveMemoryProvider } from "./memory/adaptive-memory";
import type { CapabilityInstructionBundle } from "./teams/developer/instruction-bundles";
import type { SkillDiscoverySourceProviderV1 } from "./skill-discovery/contracts";

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


/** A runner-defined reasoning variant key; dynamic runners are not closed unions. */
export type RunnerVariantKey = string;

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
// Model inventory (getModelInventory)
// ---------------------------------------------------------------------------

/**
 * Source of model inventory data.
 */
export type RunnerModelSource =
  | "runner-resolved"
  // Legacy sources remain readable during the staged adapter migration. New
  // discovery results must use "runner-resolved".
  | "runner-cache"
  | "runner-config";

/**
 * Provider in the model inventory.
 */
export type RunnerModelProvider = {
  id: string;
  displayName: string;
  envVars?: readonly string[];
  source: RunnerModelSource;
};

/**
 * Model entry in the inventory.
 */
export type RunnerModelEntry = {
  /** Exact canonical provider/model identifier reported by the runner. */
  id: string;
  providerId: string;
  /** The portion after the first slash for runner-resolved entries. */
  modelId?: string;
  displayName: string;
  supportsTools?: boolean;
  /** Presentation metadata only; it cannot authorize variants. */
  supportsReasoning?: boolean | null;
  /** Runner-defined keys; an empty array means no selectable variants. */
  variants?: readonly RunnerVariantKey[];
  /** Metadata may enrich a matching runner entry but cannot add authority. */
  metadataSource?: "runner" | "runner+cache";
  source: RunnerModelSource;
};

/**
 * Model inventory for TUI consumption.
 */
export type RunnerModelInventory = {
  providers: readonly RunnerModelProvider[];
  modelsByProvider: Readonly<Record<string, readonly RunnerModelEntry[]>>;
  diagnostics?: readonly string[];
};


export type RunnerModelDiscoveryError = {
  code:
    | "runner-not-found"
    | "timeout"
    | "command-failed"
    | "output-too-large"
    | "malformed-output"
    | "incompatible-snapshot";
  /** Sanitized and actionable; never raw subprocess output. */
  message: string;
  retryable: boolean;
};

export type RunnerModelDiscoveryRequest = {
  projectRoot: string;
  /** Rescan bypasses Deck caches; it never authorizes a runner network refresh. */
  mode?: "prefer-cache" | "rescan";
};

export type RunnerModelInventoryResult =
  | {
      state: "ready";
      inventory: RunnerModelInventory;
      source: "live" | "memory";
      discoveredAt: number;
      fingerprint: string;
    }
  | {
      state: "stale";
      inventory: RunnerModelInventory;
      source: "last-known-good";
      discoveredAt: number;
      fingerprint: string;
      error: RunnerModelDiscoveryError;
    }
  | {
      state: "blocked";
      inventory: null;
      source: "none";
      error: RunnerModelDiscoveryError;
    };

export type RunnerModelAssignmentValidationInput = {
  projectRoot: string;
  modelAssignments: DeveloperTeamModelAssignments;
  thinkingAssignments: DeveloperTeamThinkingAssignments;
  changedAgentIds: readonly string[];
  expectedFingerprint?: string;
};

export type RunnerModelAssignmentIssue = {
  agentId: string;
  code: "model-unavailable" | "variant-unavailable" | "inventory-not-ready";
  message: string;
};

export type RunnerModelAssignmentValidationResult =
  | { valid: true; fingerprint: string }
  | { valid: false; issues: readonly RunnerModelAssignmentIssue[] };

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
  /** Agents changed by the user; unchanged persisted assignments stay untouched. */
  changedAgentIds?: readonly string[];
  /** Evidence from successful dynamic-inventory validation, if the runner uses it. */
  validatedInventoryFingerprint?: string;
  memoryProvider?: AdaptiveMemoryProvider;
  capabilityInstructions?: CapabilityInstructionBundle;
  standaloneSkills?: readonly { skillId: string; body: string; files?: Record<string, string> }[];
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
  getThinkingLevels(modelId?: string): readonly RunnerVariantKey[];

  /**
   * Check whether a given model supports thinking/reasoning.
   */
  supportsThinking(modelId: string): boolean;

  /**
   * Discover runner-owned model availability. Dynamic adapters always resolve
   * asynchronously; adapters without dynamic inventory (such as Pi) omit it.
   */
  getModelInventory?(
    request: RunnerModelDiscoveryRequest,
  ): Promise<RunnerModelInventoryResult>;

  /**
   * Validate only changed assignments against a ready runner inventory before
   * a write. Runners without dynamic inventory may omit this port.
   */
  validateModelAssignments?(
    input: RunnerModelAssignmentValidationInput,
  ): Promise<RunnerModelAssignmentValidationResult>;


  /**
   * Optional read-only provider for active-runner skill discovery.
   * Adapters that do not expose discovery remain valid RunnerAdapter values.
   */
  readonly skillDiscovery?: SkillDiscoverySourceProviderV1;

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
  // Detection (optional — added by `add-self-update-system` / T2.9)
  // -------------------------------------------------------------------------

  /**
   * Detect whether Deck-managed artifacts are installed for this runner.
   *
   * Optional. When implemented, the upgrade orchestrator uses it to filter
   * which runners receive a content sync update. Adapters that do not
   * implement this method opt out of detection-driven sync.
   */
  detectDeckInstall?(input: RunnerDeckInstallInput): Promise<RunnerDeckInstallStatus>;

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

// ---------------------------------------------------------------------------
// Detection facet (optional — added by `add-self-update-system` / T2.9)
// ---------------------------------------------------------------------------

/**
 * Result of `RunnerAdapter.detectDeckInstall`.
 *
 * Returned by an adapter when it can confirm a Deck-managed install is
 * present at the runner's known config root. The upgrade sync uses this
 * to filter which runners receive a sync update.
 */
export type RunnerDeckInstallStatus = {
  /** True if Deck-managed artifacts were found for this runner. */
  installed: boolean;
  /**
   * Absolute paths of the Deck-managed files detected at the runner's
   * config root. Used by the backup step to capture the pre-sync state.
   */
  managedPaths: readonly string[];
  /** Optional diagnostics explaining why detection succeeded/failed. */
  diagnostics?: readonly string[];
};

/**
 * Input for `RunnerAdapter.detectDeckInstall`.
 */
export type RunnerDeckInstallInput = {
  /** The project root, if the runner uses project-scoped config. */
  projectRoot?: string;
};
