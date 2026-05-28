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
  | "teams-detail"
  | "developer-team-detail"
  | "review-plan"
  | "install-progress"
  | "complete";

export const RUNNER_DASHBOARD_SCREENS: RunnerDashboardScreen[] = [
  "dashboard",
  "packages-detail",
  "adaptive-memory-detail",
  "teams-detail",
  "developer-team-detail",
  "review-plan",
  "install-progress",
  "complete",
];

export type AdaptiveMemoryProviderChoice = "none" | "engram" | "supermemory";

export type SupermemorySetupValues = {
  userId?: string;
  teamId?: string;
  organizationId?: string;
  hasToken?: boolean;
};

export type SupermemorySetupState = SupermemorySetupValues & {
  configured: boolean;
  diagnostics: string[];
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
export const CANONICAL_INSTRUCTION_PACKAGE_IDS = ["codebase-memory", "context-mode", "rtk", "serena"] as const;
export type CanonicalInstructionPackageId = (typeof CANONICAL_INSTRUCTION_PACKAGE_IDS)[number];

/**
 * Loads package instructions from a deck config for a specific runner scope.
 * Used to initialize dashboard state from existing .deck/config.json.
 */
export function loadRunnerPackageInstructionsFromConfig(
  config: { packageInstructions?: Record<string, Record<string, boolean>> },
  runnerScope: RunnerScope,
): Partial<Record<CapabilityId, boolean>> {
  const runner = runnerScope as "pi" | "opencode";
  const runnerConfig = config?.packageInstructions?.[runner];
  if (!runnerConfig) return {};
  return { ...runnerConfig };
}

export type RunnerScope = "pi" | "opencode" | "all";

export type RunnerDashboardState = {
  screen: RunnerDashboardScreen;
  backStack: RunnerDashboardScreen[];
  cursor: number;
  runnerScope: RunnerScope;
  selectedCapabilities: Partial<Record<CapabilityId, boolean>>;
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
  };
  /** Package instruction injection toggles for canonical packages: codebase-memory, context-mode, rtk. */
  packageInstructions: Partial<Record<CapabilityId, boolean>>;
  plan?: RunnerReviewPlan;
  planRevision: number;
  planGeneratedForRevision?: number;
};

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
 * Dashboard sections: Packages, Adaptive Memory, Teams, Review & Install.
 */
export const DEFAULT_RUNNER_DASHBOARD_STATE: RunnerDashboardState = {
  screen: "dashboard",
  backStack: [],
  cursor: 0,
  runnerScope: "pi",
  selectedCapabilities: {
    "context-mode": true,
    "codebase-memory": true,
    rtk: true,
    serena: true,
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
  packageInstructions: {},
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
