/**
 * Runtime-agnostic dashboard reducer.
 *
 * Works with any runner (Pi, OpenCode, etc.).
 * Plan building is injected via the `planBuilder` parameter.
 */

import {
  createDefaultRunnerDashboardState,
  CANONICAL_INSTRUCTION_PACKAGE_IDS,
  runnerRequiresExternalSupermemoryToken,
  type AdaptiveMemoryProviderChoice,
  type CapabilityId,
  type CapabilityStatus,
  type CanonicalInstructionPackageId,
  type RunnerDashboardScreen,
  type RunnerDashboardState,
  type RunnerOperationIdentity,
  type RunnerReviewPlan,
  type SupermemorySetupState,
  createRunnerReviewPlanFailure,
} from "./state";
import { clampCursor, getCursorLimit, type CapabilityResolver } from "./selectors";

export type RunnerDashboardAction =
  | { type: "navigate"; screen: RunnerDashboardScreen }
  | { type: "back" }
  | { type: "go-dashboard" }
  | { type: "cursor"; cursor: number }
  | { type: "cursor-up" }
  | { type: "cursor-down" }
  | { type: "cursor-up-with-limit"; packageCount: number }
  | { type: "cursor-down-with-limit"; packageCount: number }
  | { type: "toggle-capability"; capabilityId: CapabilityId }
  | { type: "set-capability"; capabilityId: CapabilityId; selected: boolean }
  | { type: "set-capability-statuses"; statuses: Partial<Record<CapabilityId, CapabilityStatus>> }
  | { type: "select-adaptive-memory"; provider: AdaptiveMemoryProviderChoice }
  | { type: "update-supermemory"; values: Partial<SupermemorySetupState> }
  | { type: "toggle-team"; teamId: string }
  | { type: "set-team-selected"; teamId: string; selected: boolean }
  | { type: "toggle-package-instruction"; packageId: CanonicalInstructionPackageId }
  | { type: "set-package-instruction"; packageId: CanonicalInstructionPackageId; enabled: boolean }
  | { type: "set-runner"; runnerScope: RunnerDashboardState["runnerScope"]; operationId?: string }
  | { type: "set-runner-scope"; runnerScope: RunnerDashboardState["runnerScope"]; operationId?: string }
  | { type: "new-operation"; runnerScope?: Exclude<RunnerDashboardState["runnerScope"], "all">; operationId: string }
  | { type: "start-operation"; runnerScope?: Exclude<RunnerDashboardState["runnerScope"], "all">; operationId: string }
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
    case "cursor-up-with-limit":
      return withClampedCursor({ ...state, cursor: state.cursor - 1 }, action.packageCount);
    case "cursor-down-with-limit":
      return withClampedCursor({ ...state, cursor: state.cursor + 1 }, action.packageCount);
    case "toggle-capability":
      return setCapability(state, action.capabilityId, !state.selectedCapabilities[action.capabilityId], true);
    case "set-capability":
      return setCapability(state, action.capabilityId, action.selected, false);
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
    case "set-runner":
    case "set-runner-scope":
      return beginRunnerOperation(state, action.runnerScope, action.operationId);
    case "new-operation":
    case "start-operation":
      return beginRunnerOperation(state, action.runnerScope ?? state.runnerScope, action.operationId);
    case "enter-review":
      return enterReview(state, action.inventory, planBuilder);
    case "regenerate-plan":
      return withCurrentPlan(state, action.inventory, planBuilder);
    case "start-install":
      return hasCurrentPlan(state) && state.screen === "review-plan" ? navigate(state, "install-progress") : state;
    case "complete":
      return navigate(state, "complete");
    case "reset":
      return {
        ...createDefaultRunnerDashboardState(action.state),
        explicitlySelectedCapabilities: {},
        operationId: undefined,
        currentOperation: undefined,
      };
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
  fromUserToggle: boolean,
): RunnerDashboardState {
  const currentSelected = Boolean(state.selectedCapabilities[capabilityId]);
  const currentExplicit = Boolean(state.explicitlySelectedCapabilities[capabilityId]);
  const explicitlySelectedCapabilities = { ...state.explicitlySelectedCapabilities };
  let currentOperation = state.currentOperation;

  if (capabilityId === "serena") {
    if (!selected) {
      delete explicitlySelectedCapabilities.serena;
      if (currentOperation) currentOperation = { ...currentOperation, explicitlySelected: false };
    } else if (fromUserToggle && isCurrentOperation(state)) {
      explicitlySelectedCapabilities.serena = true;
      currentOperation = {
        ...getCurrentOperation(state)!,
        explicitlySelected: true,
      };
    }
  }

  const explicitChanged = currentExplicit !== Boolean(explicitlySelectedCapabilities[capabilityId])
    || currentOperation !== state.currentOperation;
  if (currentSelected === selected && !explicitChanged) return state;

  return invalidatePlan({
    ...state,
    selectedCapabilities: {
      ...state.selectedCapabilities,
      [capabilityId]: selected,
    },
    explicitlySelectedCapabilities,
    currentOperation,
  });
}

function getCurrentOperation(state: RunnerDashboardState): RunnerOperationIdentity | undefined {
  if (state.currentOperation) return state.currentOperation;
  if (
    state.runnerScope !== "all"
    && typeof state.operationId === "string"
    && state.operationId.length > 0
  ) {
    return {
      runner: state.runnerScope,
      operationId: state.operationId,
      explicitlySelected: false,
    };
  }
  return undefined;
}

function isCurrentOperation(state: RunnerDashboardState): boolean {
  const operation = getCurrentOperation(state);
  return Boolean(
    operation
    && state.runnerScope !== "all"
    && operation.runner === state.runnerScope
    && operation.operationId.length > 0,
  );
}

function beginRunnerOperation(
  state: RunnerDashboardState,
  runnerScope: RunnerDashboardState["runnerScope"],
  operationId?: string,
): RunnerDashboardState {
  const currentOperation = runnerScope !== "all"
    ? operationId
      ? { runner: runnerScope, operationId, explicitlySelected: false }
      : undefined
    : undefined;

  return invalidatePlan({
    ...state,
    runnerScope,
    operationId,
    currentOperation,
    explicitlySelectedCapabilities: {},
  });
}

function selectAdaptiveMemoryProvider(
  state: RunnerDashboardState,
  provider: AdaptiveMemoryProviderChoice,
): RunnerDashboardState {
  if (provider === state.adaptiveMemory.provider) return state;

  if (provider === "supermemory") {
    const supermemoryUi = state.runnerUi?.adaptiveMemory?.supermemory;
    const nativeOAuth = !runnerRequiresExternalSupermemoryToken(state);
    const next = invalidatePlan({
      ...state,
      adaptiveMemory: {
        provider,
        supermemory: nativeOAuth
          ? {
              configured: true,
              hasToken: false,
              runtimeCredentialStored: false,
              ephemeralTokenAvailable: false,
              mcpOAuthReady: false,
              diagnostics: [...(supermemoryUi?.configuredDiagnostics ?? [])],
            }
          : createEmptySupermemorySetup(),
        status: "Supermemory selected; provide a Deck runtime API token for read-only validation and secret-store persistence. Optional runner MCP OAuth is configured separately.",
      },
    });
    return nativeOAuth ? navigate(next, "dashboard") : next;
  }

  // After selecting a non-supermemory provider, go back to dashboard
  return navigate(
    invalidatePlan({
      ...state,
      adaptiveMemory: {
        provider,
        status: "No adaptive memory provider selected.",
      },
    }),
    "dashboard",
  );
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
          status: "Supermemory selected; secrets remain outside Deck config.",
      supermemory: {
        ...current,
        ...values,
        diagnostics: values.diagnostics ?? current.diagnostics,
        configured: values.configured ?? current.configured,
        runtimeCredentialStored: values.runtimeCredentialStored ?? values.hasToken ?? current.runtimeCredentialStored ?? current.hasToken,
        ephemeralTokenAvailable: values.ephemeralTokenAvailable ?? false,
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

function setPackageInstruction(state: RunnerDashboardState, packageId: CanonicalInstructionPackageId, enabled: boolean): RunnerDashboardState {
  if (!CANONICAL_INSTRUCTION_PACKAGE_IDS.includes(packageId)) return state;
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
  let plan: RunnerReviewPlan;
  try {
    plan = planBuilder(state, inventory);
  } catch {
    plan = createRunnerReviewPlanFailure();
  }
  return {
    ...state,
    plan,
    planGeneratedForRevision: state.planRevision,
  };
}

function hasCurrentPlan(state: RunnerDashboardState): boolean {
  return state.plan?.ready === true && state.planGeneratedForRevision === state.planRevision;
}

function invalidatePlan(state: RunnerDashboardState): RunnerDashboardState {
  return {
    ...state,
    plan: undefined,
    planRevision: state.planRevision + 1,
    planGeneratedForRevision: undefined,
  };
}

function withClampedCursor(state: RunnerDashboardState, packageCount?: number): RunnerDashboardState {
  // Use provided packageCount if available, otherwise fall back to default
  // For packages-detail screen, this should be the toggleable count (configurable + optional)
  const effectivePackageCount = packageCount ?? 5;
  const limit = getCursorLimit(state, effectivePackageCount);
  if (limit <= 0) return { ...state, cursor: 0 };
  return { ...state, cursor: clampCursor(state.cursor, state, effectivePackageCount) };
}

function createEmptySupermemorySetup(): SupermemorySetupState {
  return {
    configured: false,
    hasToken: false,
    runtimeCredentialStored: false,
    ephemeralTokenAvailable: false,
    mcpOAuthReady: false,
    diagnostics: [],
  };
}
