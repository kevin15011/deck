import {
  PACKAGE_INSTRUCTION_CONFIGURATION_METADATA,
  PACKAGE_INSTRUCTION_PACKAGE_IDS,
  normalizeSupportedPackageInstructionSelection,
  type PackageInstructionPackageId,
  type WebSearchProviderDescriptorV1,
} from "@deck/core";

/**
 * Runtime-agnostic runner dashboard state.
 *
 * Supports any runner (Pi, OpenCode, etc.) via the `runnerScope` field.
 * Capability IDs, action kinds, and tool IDs are generic strings to avoid
 * coupling to a specific adapter.
 */

export type RunnerDashboardScreen =
  | "dashboard"
  | "packages-detail"
  | "adaptive-memory-detail"
  | "web-search-detail"
  | "teams-detail"
  | "developer-team-detail"
  | "review-plan"
  | "install-progress"
  | "complete";

export const RUNNER_DASHBOARD_SCREENS: RunnerDashboardScreen[] = [
  "dashboard",
  "packages-detail",
  "adaptive-memory-detail",
  "web-search-detail",
  "teams-detail",
  "developer-team-detail",
  "review-plan",
  "install-progress",
  "complete",
];

export type AdaptiveMemoryProviderChoice = "none" | "supermemory";

export type SupermemorySetupValues = {
  userId?: string;
  teamId?: string;
  organizationId?: string;
  /** @deprecated Use runtimeCredentialStored for persisted Deck runtime readiness. */
  hasToken?: boolean;
  /** Deck runtime API key has been validated and stored in Deck's owner-only secret store. */
  runtimeCredentialStored?: boolean;
  /** Ephemeral token input is currently present in TUI state; cleared after storage. */
  ephemeralTokenAvailable?: boolean;
  /** Current-run evidence from an authoritative Deck secret-store read. */
  runtimeCredentialVerification?: "verified-present" | "verified-missing" | "verified-error";
  /** Optional runner-native MCP OAuth status; not required for Deck runtime memory. */
  mcpOAuthReady?: boolean;
};

export type SupermemorySetupState = SupermemorySetupValues & {
  configured: boolean;
  diagnostics: string[];
};

export type SupermemoryRuntimeCredentialEvidence = {
  configured: boolean;
  runtimeCredentialStored: boolean;
  runtimeCredentialVerification: NonNullable<SupermemorySetupValues["runtimeCredentialVerification"]>;
  ephemeralTokenAvailable: false;
  diagnostics: string[];
};

export type RunnerDashboardEvidenceIdentity = {
  runnerId: Exclude<RunnerScope, "all">;
  operation: RunnerOperationIdentity;
  planRevision: number;
  planGeneratedForRevision: number;
};

/** Non-secret Web Search facts projected from adapter inventory for the dashboard. */
export type WebSearchDashboardState = {
  provider?: string;
  credentialAvailable: boolean;
  runnerSupported: boolean;
  mcpConfigured: boolean;
  mcpConfigConflict: boolean;
  readiness: import("@deck/core").WebSearchReadinessState;
};

export type RunnerTeamState = {
  teamId: string;
  label: string;
  selected: boolean;
  modelAssignments?: Record<string, string>;
  thinkingAssignments?: Record<string, string>;
  capabilityProfile?: TeamCapabilityProfile;
  status?: string;
};

/**
 * Generic capability ID — adapters define their own concrete IDs.
 */
export type CapabilityId = string;

/**
 * Generic capability status used in the dashboard.
 */
export type CapabilityStatus = "ready" | "missing" | "manual" | "pending-source" | "blocked";

/**
 * Generic action kind — adapters define their own concrete kinds.
 */
export type ActionKind = string;

/**
 * Generic tool ID — adapters define their own concrete tool IDs.
 */
export type ToolId = string;

/**
 * Generic package ID — adapters define their own concrete package IDs.
 */
export type PackageId = string;

/**
 * Generic implementation ID — adapters define their own concrete implementation IDs.
 */
export type ImplementationId = string;

/**
 * Canonical package instruction IDs for instruction injection.
 * These are the packages that can be toggled via Configure Packages.
 */
export const CANONICAL_INSTRUCTION_PACKAGE_IDS = PACKAGE_INSTRUCTION_CONFIGURATION_METADATA
  .filter((entry) => entry.configurable)
  .map((entry) => entry.id) as readonly Exclude<PackageInstructionPackageId, "code-economy">[];
export type CanonicalInstructionPackageId = Exclude<PackageInstructionPackageId, "code-economy">;

/**
 * Loads package instructions from a deck config for a specific runner scope.
 * Used to initialize dashboard state from existing Deck config.
 */
export function loadRunnerPackageInstructionsFromConfig(
  config: { packageInstructions?: Record<string, Record<string, boolean>> },
  runnerScope: RunnerScope,
  supportedIds: readonly PackageInstructionPackageId[] = PACKAGE_INSTRUCTION_PACKAGE_IDS,
): Partial<Record<PackageInstructionPackageId, boolean>> {
  const runnerConfig = config?.packageInstructions?.[runnerScope];
  return normalizeSupportedPackageInstructionSelection(runnerConfig, supportedIds);
}

export type RunnerScope = import("@deck/core").RunnerId | "all";

/**
 * Ephemeral identity for one interactive Review & Install operation.
 * This is never derived from persisted config, inventory, or preferences.
 */
export type RunnerOperationIdentity = {
  runner: import("@deck/core").RunnerId;
  operationId: string;
  explicitlySelected: boolean;
};

export type RunnerDashboardOperation = RunnerOperationIdentity;

export type RunnerDashboardState = {
  screen: RunnerDashboardScreen;
  backStack: RunnerDashboardScreen[];
  cursor: number;
  runnerScope: RunnerScope;
  runnerDisplayName?: string;
  runnerUi?: import("@deck/core").RunnerUiMetadata;
  selectedCapabilities: Partial<Record<CapabilityId, boolean>>;
  /** Current-operation provenance; never persisted or populated from config. */
  explicitlySelectedCapabilities: Partial<Record<CapabilityId, boolean>>;
  operationId?: string;
  currentOperation?: RunnerOperationIdentity;
  /** Opaque provider selection persisted with the dashboard state. */
  webSearchProvider?: string;
  /** Runtime-only descriptor selected by CLI composition. */
  webSearchProviderDescriptor?: WebSearchProviderDescriptorV1;
  /** Presentation/readiness facts only; credentials never enter dashboard state. */
  webSearch: WebSearchDashboardState;
  capabilityStatuses: Partial<Record<CapabilityId, CapabilityStatus>>;
  adaptiveMemory: {
    provider: AdaptiveMemoryProviderChoice;
    supermemory?: SupermemorySetupState;
    status?: string;
  };
  teams: Record<string, RunnerTeamState>;
  runtime: {
    runnerCommand?: string;
    preflight?: unknown;
    toolsReview?: unknown;
    inspectionState?: "ready" | "degraded" | "blocked" | "unsupported";
    projectIdentity?: "verified" | "unverified" | "deferred";
    diagnostics?: string[];
    executionRoutes?: Partial<Record<"interactive" | "exec" | "resume-by-id" | "resume-latest", "first-class" | "static-compatible" | "unsupported" | "blocked">>;
  };
  /** Canonical package-instruction toggles; code-economy is persisted as the always-on baseline. */
  packageInstructions: Partial<Record<PackageInstructionPackageId, boolean>>;
  plan?: RunnerReviewPlan;
  planRevision: number;
  planGeneratedForRevision?: number;
};

export function runnerRequiresExternalSupermemoryToken(state?: Pick<RunnerDashboardState, "runnerUi">): boolean {
  void state;
  return true;
}

export type RunnerActionStatus = "ready" | "manual" | "pending" | "blocked" | "complete" | "failed";

export type RunnerAction = {
  id: string;
  kind: ActionKind;
  title: string;
  description?: string;
  capabilityId?: CapabilityId;
  toolId?: ToolId;
  /** Identifies internal package install actions for the action-runner executor. */
  internalPackageId?: PackageId;
  implementationId?: ImplementationId;
  source?: string;
  status: RunnerActionStatus;
  required?: boolean;
  dependencies?: CapabilityId[];
  unresolvedCapabilities?: CapabilityId[];
  diagnostics?: string[];
};

export type RunnerPlanDiagnosticSeverity = "info" | "warning" | "error";

export type RunnerPlanDiagnostic = {
  code: string;
  message: string;
  severity: RunnerPlanDiagnosticSeverity;
  capabilityId?: CapabilityId;
  actionId?: string;
};

export type RunnerReviewPlan = {
  groups: {
    automaticInstalls: RunnerAction[];
    manualSteps: RunnerAction[];
    configWrites: RunnerAction[];
    teamApplications: RunnerAction[];
    validations: RunnerAction[];
  };
  diagnostics: RunnerPlanDiagnostic[];
  ready: boolean;
};

export function createRunnerReviewPlanFailure(
  code = "plan-build-failed",
  message = "Could not build the review plan. Return to Dashboard and retry.",
): RunnerReviewPlan {
  return {
    groups: {
      automaticInstalls: [],
      manualSteps: [],
      configWrites: [],
      teamApplications: [],
      validations: [],
    },
    diagnostics: [{ code, message, severity: "error" }],
    ready: false,
  };
}

export type TeamCapabilityConsumption =
  | "required"
  | "consumes-directly"
  | "inherits-runner"
  | "compatible"
  | "not-used"
  | "unknown";

export type TeamCapabilityProfile = {
  teamId: string;
  installable: boolean;
  capabilities: Partial<Record<CapabilityId | "adaptive-memory", TeamCapabilityConsumption>>;
  diagnostics: string[];
};

export const DEFAULT_RUNNER_REVIEW_PLAN: RunnerReviewPlan = {
  groups: {
    automaticInstalls: [],
    manualSteps: [],
    configWrites: [],
    teamApplications: [],
    validations: [],
  },
  diagnostics: [],
  ready: false,
};

/**
 * Default state for the runner dashboard.
 *
 * Dashboard sections: Packages, Adaptive Memory, Web Search, Teams, Review & Install.
 */
export const DEFAULT_RUNNER_DASHBOARD_STATE: RunnerDashboardState = {
  screen: "dashboard",
  backStack: [],
  cursor: 0,
  runnerScope: "pi",
  runnerDisplayName: "Pi",
  selectedCapabilities: {
    "context-mode": true,
    "codebase-memory-mcp": true,
    "codebase-memory": true,
    rtk: true,
    serena: false,
    context7: true,
  },
  explicitlySelectedCapabilities: {},
  operationId: undefined,
  currentOperation: undefined,
  webSearch: {
    credentialAvailable: false,
    runnerSupported: false,
    mcpConfigured: false,
    mcpConfigConflict: false,
    readiness: "disabled",
  },
  capabilityStatuses: {},
  adaptiveMemory: {
    provider: "none",
  },
  teams: {
    "developer-team": {
      teamId: "developer-team",
      label: "Developer Team",
      selected: false,
    },
  },
  runtime: {},
  packageInstructions: { "code-economy": true },
  plan: undefined,
  planRevision: 0,
  planGeneratedForRevision: undefined,
};

export function createDefaultRunnerDashboardState(
  overrides: Partial<RunnerDashboardState> = {},
): RunnerDashboardState {
  return {
    ...DEFAULT_RUNNER_DASHBOARD_STATE,
    ...overrides,
    backStack: overrides.backStack ?? [...DEFAULT_RUNNER_DASHBOARD_STATE.backStack],
    selectedCapabilities: {
      ...DEFAULT_RUNNER_DASHBOARD_STATE.selectedCapabilities,
      ...overrides.selectedCapabilities,
    },
    explicitlySelectedCapabilities: {
      ...DEFAULT_RUNNER_DASHBOARD_STATE.explicitlySelectedCapabilities,
      ...overrides.explicitlySelectedCapabilities,
    },
    operationId: overrides.operationId,
    currentOperation: overrides.currentOperation,
    webSearch: {
      ...DEFAULT_RUNNER_DASHBOARD_STATE.webSearch,
      ...overrides.webSearch,
    },
    capabilityStatuses: {
      ...DEFAULT_RUNNER_DASHBOARD_STATE.capabilityStatuses,
      ...overrides.capabilityStatuses,
    },
    adaptiveMemory: {
      ...DEFAULT_RUNNER_DASHBOARD_STATE.adaptiveMemory,
      ...overrides.adaptiveMemory,
    },
    teams: {
      ...DEFAULT_RUNNER_DASHBOARD_STATE.teams,
      ...overrides.teams,
    },
    runtime: {
      ...DEFAULT_RUNNER_DASHBOARD_STATE.runtime,
      ...overrides.runtime,
    },
    packageInstructions: {
      ...DEFAULT_RUNNER_DASHBOARD_STATE.packageInstructions,
      ...overrides.packageInstructions,
    },
    plan: overrides.plan,
    planRevision: overrides.planRevision ?? DEFAULT_RUNNER_DASHBOARD_STATE.planRevision,
    planGeneratedForRevision: overrides.planGeneratedForRevision,
  };
}

// ---------------------------------------------------------------------------
// Backward-compatible type aliases for Pi-specific code
// ---------------------------------------------------------------------------

export type PiRunnerDashboardScreen = RunnerDashboardScreen;
export type PiRunnerTeamState = RunnerTeamState;
export type PiRunnerDashboardState = RunnerDashboardState;
export type PiRunnerActionStatus = RunnerActionStatus;
export type PiRunnerAction = RunnerAction;
export type PiRunnerPlanDiagnosticSeverity = RunnerPlanDiagnosticSeverity;
export type PiRunnerPlanDiagnostic = RunnerPlanDiagnostic;
export type PiRunnerReviewPlan = RunnerReviewPlan;

export const PI_RUNNER_DASHBOARD_SCREENS = RUNNER_DASHBOARD_SCREENS;
export const DEFAULT_PI_RUNNER_REVIEW_PLAN = DEFAULT_RUNNER_REVIEW_PLAN;
export const DEFAULT_PI_RUNNER_DASHBOARD_STATE = DEFAULT_RUNNER_DASHBOARD_STATE;
export const createDefaultPiRunnerDashboardState = createDefaultRunnerDashboardState;
