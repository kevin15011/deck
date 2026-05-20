import { buildPiRunnerReviewPlan, type CapabilityId } from "@deck/adapter-pi";
import type { PiRunnerCapabilityInventory } from "@deck/adapter-pi";
import {
  createDefaultPiRunnerDashboardState,
  type AdaptiveMemoryProviderChoice,
  type PiRunnerDashboardScreen,
  type PiRunnerDashboardState,
  type SupermemorySetupState,
  type UserSelectableCapabilityId,
} from "./state";
import { clampCursor, getCursorLimit } from "./selectors";

export type PiRunnerDashboardAction =
  | { type: "navigate"; screen: PiRunnerDashboardScreen }
  | { type: "back" }
  | { type: "go-dashboard" }
  | { type: "cursor"; cursor: number }
  | { type: "cursor-up" }
  | { type: "cursor-down" }
  | { type: "toggle-capability"; capabilityId: UserSelectableCapabilityId }
  | { type: "set-capability"; capabilityId: UserSelectableCapabilityId; selected: boolean }
  | { type: "set-capability-statuses"; statuses: Partial<Record<CapabilityId, PiRunnerDashboardState["capabilityStatuses"][CapabilityId]>> }
  | { type: "select-adaptive-memory"; provider: AdaptiveMemoryProviderChoice }
  | { type: "update-supermemory"; values: Partial<SupermemorySetupState> }
  | { type: "toggle-team"; teamId: string }
  | { type: "set-team-selected"; teamId: string; selected: boolean }
  | { type: "enter-review"; inventory: PiRunnerCapabilityInventory }
  | { type: "regenerate-plan"; inventory: PiRunnerCapabilityInventory }
  | { type: "start-install" }
  | { type: "complete" }
  | { type: "reset"; state?: Partial<PiRunnerDashboardState> };

export function reducePiRunnerDashboard(
  state: PiRunnerDashboardState,
  action: PiRunnerDashboardAction,
): PiRunnerDashboardState {
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
    case "enter-review":
      return enterReview(state, action.inventory);
    case "regenerate-plan":
      return withCurrentPlan(state, action.inventory);
    case "start-install":
      return hasCurrentPlan(state) && state.screen === "review-plan" ? navigate(state, "install-progress") : state;
    case "complete":
      return navigate(state, "complete");
    case "reset":
      return createDefaultPiRunnerDashboardState(action.state);
    default:
      return state;
  }
}

export const reduce = reducePiRunnerDashboard;

function navigate(state: PiRunnerDashboardState, screen: PiRunnerDashboardScreen): PiRunnerDashboardState {
  if (screen === state.screen) return state;

  return withClampedCursor({
    ...state,
    screen,
    cursor: 0,
    backStack: [...state.backStack, state.screen],
  });
}

function goBack(state: PiRunnerDashboardState): PiRunnerDashboardState {
  const previous = state.backStack.at(-1) ?? "dashboard";
  return withClampedCursor({
    ...state,
    screen: previous,
    cursor: 0,
    backStack: state.backStack.slice(0, -1),
  });
}

function setCapability(
  state: PiRunnerDashboardState,
  capabilityId: UserSelectableCapabilityId,
  selected: boolean,
): PiRunnerDashboardState {
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
  state: PiRunnerDashboardState,
  provider: AdaptiveMemoryProviderChoice,
): PiRunnerDashboardState {
  if (provider === state.adaptiveMemory.provider) return state;

  if (provider === "supermemory") {
    return invalidatePlan({
      ...state,
      adaptiveMemory: {
        provider,
        supermemory: createEmptySupermemorySetup(),
        status: "Supermemory selected; configure non-secret identity and provide token through Pi MCP handoff.",
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
  state: PiRunnerDashboardState,
  values: Partial<SupermemorySetupState>,
): PiRunnerDashboardState {
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

function setTeamSelected(state: PiRunnerDashboardState, teamId: string, selected: boolean): PiRunnerDashboardState {
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

function enterReview(state: PiRunnerDashboardState, inventory: PiRunnerCapabilityInventory): PiRunnerDashboardState {
  return withCurrentPlan(navigate(state, "review-plan"), inventory);
}

function withCurrentPlan(state: PiRunnerDashboardState, inventory: PiRunnerCapabilityInventory): PiRunnerDashboardState {
  const plan = buildPiRunnerReviewPlan(state, inventory);
  return {
    ...state,
    plan,
    planGeneratedForRevision: state.planRevision,
  };
}

function hasCurrentPlan(state: PiRunnerDashboardState): boolean {
  return Boolean(state.plan) && state.planGeneratedForRevision === state.planRevision;
}

function invalidatePlan(state: PiRunnerDashboardState): PiRunnerDashboardState {
  return {
    ...state,
    plan: undefined,
    planRevision: state.planRevision + 1,
    planGeneratedForRevision: undefined,
  };
}

function withClampedCursor(state: PiRunnerDashboardState): PiRunnerDashboardState {
  const limit = getCursorLimit(state);
  if (limit <= 0) return { ...state, cursor: 0 };
  return { ...state, cursor: clampCursor(state.cursor, state) };
}

function createEmptySupermemorySetup(): SupermemorySetupState {
  return {
    configured: false,
    hasToken: false,
    diagnostics: [],
  };
}
