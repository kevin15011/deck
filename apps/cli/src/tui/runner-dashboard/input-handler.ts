/**
 * Runtime-agnostic dashboard input handler.
 *
 * Works with any runner (Pi, OpenCode, etc.).
 * Package instruction IDs come from canonical config metadata plus adapter support.
 */

import type { RunnerDashboardAction } from "./reducer";
import { PACKAGE_INSTRUCTION_PACKAGE_IDS } from "@deck/core";
import { getDashboardSectionSummaries, getToggleablePackageInstructionIds, type CapabilityResolver } from "./selectors";
import { runnerRequiresExternalSupermemoryToken, type RunnerDashboardState } from "./state";

export type RunnerDashboardContinueEffect =
  | { type: "dispatch"; action: RunnerDashboardAction }
  | { type: "select-supermemory-and-open-setup"; action: RunnerDashboardAction }
  | { type: "open-developer-team-model-config" }
  | { type: "reuse-developer-team-model-config" }
  | { type: "block-review-install"; status: string }
  | { type: "complete-dashboard" }
  | { type: "none" };

export function getReviewPlanBlockerReason(plan: RunnerDashboardState["plan"]): string | undefined {
  if (!plan || plan.ready) return undefined;
  const diagnostic = plan.diagnostics.find((entry) => entry.severity === "error");
  if (diagnostic) return diagnostic.message;
  for (const actions of Object.values(plan.groups)) {
    const action = actions.find((entry) => entry.status === "blocked" || entry.status === "failed");
    if (action) return action.diagnostics?.[0] ?? `${action.title} is blocked.`;
  }
  return undefined;
}

/**
 * Returns the toggle action for the current cursor position.
 */
export function getDashboardToggleAction(
  state: RunnerDashboardState,
  resolver?: CapabilityResolver,
): RunnerDashboardAction | undefined {
  if (state.screen === "packages-detail") {
    const effectiveResolver = resolver ?? {
      getSupportedPackageInstructionIds: () => PACKAGE_INSTRUCTION_PACKAGE_IDS,
    };
    const packageIds = getToggleablePackageInstructionIds(state, effectiveResolver);
    const packageId = packageIds[state.cursor];
    return packageId ? { type: "toggle-package-instruction", packageId } : undefined;
  }

  if (state.screen === "teams-detail" && state.cursor === 0) {
    return { type: "toggle-team", teamId: "developer-team" };
  }

  return undefined;
}

export function getDashboardContinueEffect(
  state: RunnerDashboardState,
  options: { inventory: unknown; canRunPlan?: boolean },
  resolver?: CapabilityResolver,
): RunnerDashboardContinueEffect {
  // Backward-compatible default resolver for tests
  const effectiveResolver = resolver ?? {
    getSupportedPackageInstructionIds: () => PACKAGE_INSTRUCTION_PACKAGE_IDS,
  };

  if (state.screen === "dashboard") {
    const sections = getDashboardSectionSummaries(state, effectiveResolver);
    const section = sections[state.cursor];
    if (!section) return { type: "none" };
    if (section.screen === "review-plan") {
      return { type: "dispatch", action: { type: "enter-review", inventory: options.inventory } };
    }
    return { type: "dispatch", action: { type: "navigate", screen: section.screen } };
  }

  if (state.screen === "packages-detail") {
    // Use toggleable capability IDs to match UI rendering (configurable + optional + back)
    const toggleableIds = getToggleablePackageInstructionIds(state, effectiveResolver);
    // Last item is "Back to dashboard" at index toggleableIds.length
    if (state.cursor === toggleableIds.length) return { type: "dispatch", action: { type: "go-dashboard" } };
    const action = getDashboardToggleAction(state, effectiveResolver);
    return action ? { type: "dispatch", action } : { type: "none" };
  }

  if (state.screen === "adaptive-memory-detail") {
    const providers = ["none", "engram", "supermemory"] as const;
    const provider = providers[state.cursor];
    if (!provider) return { type: "dispatch", action: { type: "go-dashboard" } };
    const action: RunnerDashboardAction = { type: "select-adaptive-memory", provider };
    return provider === "supermemory" && runnerRequiresExternalSupermemoryToken(state)
      ? { type: "select-supermemory-and-open-setup", action }
      : { type: "dispatch", action };
  }

  if (state.screen === "teams-detail") {
    if (state.cursor === 0) {
      const action = getDashboardToggleAction(state, effectiveResolver);
      return action ? { type: "dispatch", action } : { type: "none" };
    }
    if (state.cursor === 1) return { type: "dispatch", action: { type: "navigate", screen: "developer-team-detail" } };
    return { type: "dispatch", action: { type: "go-dashboard" } };
  }

  if (state.screen === "developer-team-detail") {
    if (state.cursor === 0) return { type: "open-developer-team-model-config" };
    if (state.cursor === 1) return { type: "reuse-developer-team-model-config" };
    if (state.cursor === 2) return { type: "dispatch", action: { type: "back" } };
    return { type: "none" };
  }

  if (state.screen === "review-plan") {
    if (state.cursor === 0) {
      if (state.plan?.ready !== true) {
        return {
          type: "block-review-install",
          status: getReviewPlanBlockerReason(state.plan) ?? "Review plan is not ready. Resolve plan diagnostics before executing Review & Install.",
        };
      }
      if (!options.canRunPlan) {
        return {
          type: "block-review-install",
          status: "Supermemory requires token captured before executing Review & Install.",
        };
      }
      return { type: "dispatch", action: { type: "start-install" } };
    }
    return { type: "dispatch", action: { type: "go-dashboard" } };
  }

  if (state.screen === "complete") return { type: "complete-dashboard" };

  return { type: "none" };
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases for Pi-specific tests
// ---------------------------------------------------------------------------

export const getPiRunnerDashboardToggleAction = getDashboardToggleAction;
export const getPiRunnerDashboardContinueEffect = getDashboardContinueEffect;
export type PiRunnerDashboardContinueEffect = RunnerDashboardContinueEffect;
