/**
 * Runtime-agnostic dashboard reducer.
 *
 * Works with any runner (Pi, OpenCode, etc.).
 * Plan building is injected via the `planBuilder` parameter.
 */

import {
  createDefaultRunnerDashboardState,
  type AdaptiveMemoryProviderChoice,
  type CapabilityId,
  type CapabilityStatus,
  type RunnerDashboardScreen,
  type RunnerDashboardState,
  type RunnerReviewPlan,
  type SupermemorySetupState,
} from "./state";
import { clampCursor, getCursorLimit, type CapabilityResolver } from "./selectors";

export type RunnerDashboardAction =
  | { type: "navigate"; screen: RunnerDashboardScreen }
  | { type: "back" }
  | { type: "go-dashboard" }
  | { type: "cursor"; cursor: number }
  | { type: "cursor-up" }
  | { type: "cursor-down" }
  | { type: "toggle-capability"; capabilityId: CapabilityId }
  | { type: "set-capability"; capabilityId: CapabilityId; selected: boolean }
  | { type: "set-capability-statuses"; statuses: Partial<Record<CapabilityId, CapabilityStatus>> }
  | { type: "select-adaptive-memory"; provider: AdaptiveMemoryProviderChoice }
  | { type: "update-supermemory"; values: Partial<SupermemorySetupState> }
  | { type: "toggle-team"; teamId: string }
  | { type: "set-team-selected"; teamId: string; selected: boolean }
  | { type: "toggle-package-instruction"; packageId: CapabilityId }
  | { type: "set-package-instruction"; packageId: CapabilityId; enabled: boolean }
  | { type: "enter-review"; inventory: unknown }
  | { type: "regenerate-plan"; inventory: unknown }
  | { type: "start-install" }
  | { type: "complete" }
  | { type: "reset"; state?: Partial<RunnerDashboardState> };

export type PlanBuilderFn = (
  state: RunnerDashboardState,
  inventory: unknown,
) => RunnerReviewPlan;

const noopPlanBuilder: PlanBuilderFn = () => ({
  groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] },
  diagnostics: [],
  ready: false,
});

export function reduceRunnerDashboard(
  state: RunnerDashboardState,
  action: RunnerDashboardAction,
  planBuilder: PlanBuilderFn = noopPlanBuilder,
): RunnerDashboardState {
  switch (action.type) {
    case "navigate":
      return navigate(state, action.screen);
    case "back":
      return goBack(state);
    case "go-dashboard":
      return { ...state, screen: "dashboard", backStack: [], cursor: 0 };
    case "cursor":
      return withClampedCursor({ ...state, cursor: action.cursor });
    case "cursor-up":
      return withClampedCursor({ ...state, cursor: state.cursor - 1 });
    case "cursor-down":
      return withClampedCursor({ ...state, cursor: state.cursor + 1 });
    case "toggle-capability":
      return setCapability(state, action.capabilityId, !state.selectedCapabilities[action.capabilityId]);
    case "set-capability":
      return setCapability(state, action.capabilityId, action.selected);
    case "set-capability-statuses":
      return invalidatePlan({
        ...state,
        capabilityStatuses: {
          ...state.capabilityStatuses,
          ...action.statuses,
        },
      });
    case "select-adaptive-memory":
      return selectAdaptiveMemoryProvider(state, action.provider);
    case "update-supermemory":
      return updateSupermemory(state, action.values);
    case "toggle-team":
      return setTeamSelected(state, action.teamId, !state.teams[action.teamId]?.selected);
    case "set-team-selected":
      return setTeamSelected(state, action.teamId, action.selected);
    case "toggle-package-instruction":
      return setPackageInstruction(state, action.packageId, !state.packageInstructions[action.packageId]);
    case "set-package-instruction":
      return setPackageInstruction(state, action.packageId, action.enabled);
    case "enter-review":
      return enterReview(state, action.inventory, planBuilder);
    case "regenerate-plan":
      return withCurrentPlan(state, action.inventory, planBuilder);
    case "start-install":
      return hasCurrentPlan(state) && state.screen === "review-plan" ? navigate(state, "install-progress") : state;
    case "complete":
      return navigate(state, "complete");
    case "reset":
      return createDefaultRunnerDashboardState(action.state);
    default:
      return state;
  }
}

export const reduce = reduceRunnerDashboard;

// ---------------------------------------------------------------------------
// Backward-compatible alias for Pi-specific tests
// ---------------------------------------------------------------------------

export const reducePiRunnerDashboard = reduceRunnerDashboard;

function navigate(state: RunnerDashboardState, screen: RunnerDashboardScreen): RunnerDashboardState {
  if (screen === state.screen) return state;

  return withClampedCursor({
    ...state,
    screen,
    cursor: 0,
    backStack: [...state.backStack, state.screen],
  });
}

function goBack(state: RunnerDashboardState): RunnerDashboardState {
  const previous = state.backStack.at(-1) ?? "dashboard";
  return withClampedCursor({
    ...state,
    screen: previous,
    cursor: 0,
    backStack: state.backStack.slice(0, -1),
  });
}

function setCapability(
  state: RunnerDashboardState,
  capabilityId: CapabilityId,
  selected: boolean,
): RunnerDashboardState {
  if (Boolean(state.selectedCapabilities[capabilityId]) === selected) return state;

  return invalidatePlan({
    ...state,
    selectedCapabilities: {
      ...state.selectedCapabilities,
      [capabilityId]: selected,
    },
  });
}

function selectAdaptiveMemoryProvider(
  state: RunnerDashboardState,
  provider: AdaptiveMemoryProviderChoice,
): RunnerDashboardState {
  if (provider === state.adaptiveMemory.provider) return state;

  if (provider === "supermemory") {
    return invalidatePlan({
      ...state,
      adaptiveMemory: {
        provider,
        supermemory: createEmptySupermemorySetup(),
        status: "Supermemory selected; configure non-secret identity and provide token through MCP handoff.",
      },
    });
  }

  return invalidatePlan({
    ...state,
    adaptiveMemory: {
      provider,
      status: provider === "none" ? "No adaptive memory provider selected." : "Engram selected; engram-memory action is derived by the plan.",
    },
  });
}

function updateSupermemory(
  state: RunnerDashboardState,
  values: Partial<SupermemorySetupState>,
): RunnerDashboardState {
  const current = state.adaptiveMemory.supermemory ?? createEmptySupermemorySetup();

  return invalidatePlan({
    ...state,
    adaptiveMemory: {
      provider: "supermemory",
      status: "Supermemory selected; secrets remain outside .deck/config.json.",
      supermemory: {
        ...current,
        ...values,
        diagnostics: values.diagnostics ?? current.diagnostics,
        configured: values.configured ?? current.configured,
      },
    },
  });
}

function setTeamSelected(state: RunnerDashboardState, teamId: string, selected: boolean): RunnerDashboardState {
  const existing = state.teams[teamId] ?? { teamId, label: teamId, selected: false };
  if (existing.selected === selected) return state;

  return invalidatePlan({
    ...state,
    teams: {
      ...state.teams,
      [teamId]: {
        ...existing,
        selected,
      },
    },
  });
}

function setPackageInstruction(state: RunnerDashboardState, packageId: CapabilityId, enabled: boolean): RunnerDashboardState {
  if (Boolean(state.packageInstructions[packageId]) === enabled) return state;

  return invalidatePlan({
    ...state,
    packageInstructions: {
      ...state.packageInstructions,
      [packageId]: enabled,
    },
  });
}

function enterReview(state: RunnerDashboardState, inventory: unknown, planBuilder: PlanBuilderFn): RunnerDashboardState {
  return withCurrentPlan(navigate(state, "review-plan"), inventory, planBuilder);
}

function withCurrentPlan(state: RunnerDashboardState, inventory: unknown, planBuilder: PlanBuilderFn): RunnerDashboardState {
  const plan = planBuilder(state, inventory);
  return {
    ...state,
    plan,
    planGeneratedForRevision: state.planRevision,
  };
}

function hasCurrentPlan(state: RunnerDashboardState): boolean {
  return Boolean(state.plan) && state.planGeneratedForRevision === state.planRevision;
}

function invalidatePlan(state: RunnerDashboardState): RunnerDashboardState {
  return {
    ...state,
    plan: undefined,
    planRevision: state.planRevision + 1,
    planGeneratedForRevision: undefined,
  };
}

function withClampedCursor(state: RunnerDashboardState): RunnerDashboardState {
  // Use a default package count for cursor clamping (will be overridden by the UI)
  const limit = getCursorLimit(state, 5);
  if (limit <= 0) return { ...state, cursor: 0 };
  return { ...state, cursor: clampCursor(state.cursor, state, 5) };
}

function createEmptySupermemorySetup(): SupermemorySetupState {
  return {
    configured: false,
    hasToken: false,
    diagnostics: [],
  };
}
