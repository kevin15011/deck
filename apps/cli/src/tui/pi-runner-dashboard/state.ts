import type {
  CapabilityId,
  CapabilityImplementationId,
  CapabilityStatus,
  DeveloperTeamModelAssignments,
  DeveloperTeamThinkingAssignments,
  InstallablePiToolId,
  PiPreflightResult,
  PiRequiredToolsReview,
  RunnerScope,
  TechnicalActionKind,
} from "@deck/adapter-pi";

export type PiRunnerDashboardScreen =
  | "dashboard"
  | "runner-capabilities-detail"
  | "adaptive-memory-detail"
  | "runner-ui-visual-helpers-detail"
  | "teams-detail"
  | "developer-team-detail"
  | "review-plan"
  | "install-progress"
  | "complete";

export const PI_RUNNER_DASHBOARD_SCREENS: PiRunnerDashboardScreen[] = [
  "dashboard",
  "runner-capabilities-detail",
  "adaptive-memory-detail",
  "runner-ui-visual-helpers-detail",
  "teams-detail",
  "developer-team-detail",
  "review-plan",
  "install-progress",
  "complete",
];

export type AdaptiveMemoryProviderChoice = "none" | "engram" | "supermemory";

export type UserSelectableCapabilityId = Exclude<CapabilityId, "runner-mermaid">;

export type RequiredRunnerCapabilityId = Extract<CapabilityId, "runner-mermaid">;

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
  requiredCapabilities: Partial<Record<RequiredRunnerCapabilityId, true>>;
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

export type PiRunnerAction = {
  id: string;
  kind: TechnicalActionKind;
  title: string;
  description?: string;
  capabilityId?: CapabilityId;
  toolId?: InstallablePiToolId;
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
  requiredCapabilities: {
    "runner-mermaid": true,
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
    requiredCapabilities: {
      ...DEFAULT_PI_RUNNER_DASHBOARD_STATE.requiredCapabilities,
      ...overrides.requiredCapabilities,
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
