import type {
  CapabilityId,
  CapabilityImplementationId,
  CapabilityStatus,
  DeveloperTeamModelAssignments,
  DeveloperTeamThinkingAssignments,
  InstallablePiToolId,
  InternalRunnerPackageId,
  PiPreflightResult,
  PiRequiredToolsReview,
  RunnerScope,
  TechnicalActionKind,
} from "@deck/adapter-pi";

export type PiRunnerDashboardScreen =
  | "dashboard"
  | "packages-detail"
  | "adaptive-memory-detail"
  | "teams-detail"
  | "developer-team-detail"
  | "review-plan"
  | "install-progress"
  | "complete";

export const PI_RUNNER_DASHBOARD_SCREENS: PiRunnerDashboardScreen[] = [
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

/**
 * User-selectable capability IDs for the Packages section.
 * Excludes runner-mermaid (internal silent support, not user-configurable).
 * REQ-DASH-001: Mermaid is not a configurable dashboard capability.
 */
export type UserSelectableCapabilityId = Exclude<CapabilityId, "runner-mermaid">;

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

export type PiRunnerTeamState = {
  teamId: string;
  label: string;
  selected: boolean;
  modelAssignments?: DeveloperTeamModelAssignments;
  thinkingAssignments?: DeveloperTeamThinkingAssignments;
  capabilityProfile?: TeamCapabilityProfile;
  status?: string;
};

export type PiRunnerDashboardState = {
  screen: PiRunnerDashboardScreen;
  backStack: PiRunnerDashboardScreen[];
  cursor: number;
  runnerScope: RunnerScope;
  selectedCapabilities: Partial<Record<UserSelectableCapabilityId, boolean>>;
  capabilityStatuses: Partial<Record<CapabilityId, CapabilityStatus>>;
  adaptiveMemory: {
    provider: AdaptiveMemoryProviderChoice;
    supermemory?: SupermemorySetupState;
    status?: string;
  };
  teams: Record<string, PiRunnerTeamState>;
  runtime: {
    piCommand?: string;
    preflight?: PiPreflightResult;
    toolsReview?: PiRequiredToolsReview;
  };
  plan?: PiRunnerReviewPlan;
  planRevision: number;
  planGeneratedForRevision?: number;
};

export type PiRunnerActionStatus = "ready" | "manual" | "pending" | "blocked" | "complete" | "failed";

/**
 * Action produced by the Pi Runner review plan.
 *
 * Fix #1: `internalPackageId` is set on automatic install actions for internal
 * runner packages (pi-mermaid) to signal the action-runner to route execution
 * through `installInternalRunnerPackages()` instead of `buildInstallableTool()`.
 */
export type PiRunnerAction = {
  id: string;
  kind: TechnicalActionKind;
  title: string;
  description?: string;
  capabilityId?: CapabilityId;
  toolId?: InstallablePiToolId;
  /** Fix #1: Identifies internal package install actions for the action-runner executor. */
  internalPackageId?: InternalRunnerPackageId;
  implementationId?: CapabilityImplementationId;
  source?: string;
  status: PiRunnerActionStatus;
  required?: boolean;
  dependencies?: CapabilityId[];
  unresolvedCapabilities?: CapabilityId[];
  diagnostics?: string[];
};

export type PiRunnerPlanDiagnosticSeverity = "info" | "warning" | "error";

export type PiRunnerPlanDiagnostic = {
  code: string;
  message: string;
  severity: PiRunnerPlanDiagnosticSeverity;
  capabilityId?: CapabilityId;
  actionId?: string;
};

export type PiRunnerReviewPlan = {
  groups: {
    automaticInstalls: PiRunnerAction[];
    manualSteps: PiRunnerAction[];
    configWrites: PiRunnerAction[];
    teamApplications: PiRunnerAction[];
    validations: PiRunnerAction[];
  };
  diagnostics: PiRunnerPlanDiagnostic[];
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

export const DEFAULT_PI_RUNNER_REVIEW_PLAN: PiRunnerReviewPlan = {
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
 * Default state for the Pi Runner dashboard.
 *
 * Changes from previous version (REQ-DASH-001, REQ-DASH-002):
 * - Removed `runner-mermaid` from requiredCapabilities (internal silent support).
 * - Replaced `runner-capabilities-detail` and `runner-ui-visual-helpers-detail` screens
 *   with `packages-detail` (REQ-DASH-002: Packages grouping).
 * - Dashboard sections are now: Packages, Adaptive Memory, Teams, Review & Install.
 */
export const DEFAULT_PI_RUNNER_DASHBOARD_STATE: PiRunnerDashboardState = {
  screen: "dashboard",
  backStack: [],
  cursor: 0,
  runnerScope: "pi",
  selectedCapabilities: {
    "context-mode": false,
    "codebase-memory": false,
    rtk: false,
    "pi-hud": false,
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
  plan: undefined,
  planRevision: 0,
  planGeneratedForRevision: undefined,
};

export function createDefaultPiRunnerDashboardState(
  overrides: Partial<PiRunnerDashboardState> = {},
): PiRunnerDashboardState {
  return {
    ...DEFAULT_PI_RUNNER_DASHBOARD_STATE,
    ...overrides,
    backStack: overrides.backStack ?? [...DEFAULT_PI_RUNNER_DASHBOARD_STATE.backStack],
    selectedCapabilities: {
      ...DEFAULT_PI_RUNNER_DASHBOARD_STATE.selectedCapabilities,
      ...overrides.selectedCapabilities,
    },
    capabilityStatuses: {
      ...DEFAULT_PI_RUNNER_DASHBOARD_STATE.capabilityStatuses,
      ...overrides.capabilityStatuses,
    },
    adaptiveMemory: {
      ...DEFAULT_PI_RUNNER_DASHBOARD_STATE.adaptiveMemory,
      ...overrides.adaptiveMemory,
    },
    teams: {
      ...DEFAULT_PI_RUNNER_DASHBOARD_STATE.teams,
      ...overrides.teams,
    },
    runtime: {
      ...DEFAULT_PI_RUNNER_DASHBOARD_STATE.runtime,
      ...overrides.runtime,
    },
    plan: overrides.plan,
    planRevision: overrides.planRevision ?? DEFAULT_PI_RUNNER_DASHBOARD_STATE.planRevision,
    planGeneratedForRevision: overrides.planGeneratedForRevision,
  };
}