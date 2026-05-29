/**
 * Runtime-agnostic dashboard input handler.
 *
 * Works with any runner (Pi, OpenCode, etc.).
 * Capability IDs are derived from the state's selectedCapabilities keys.
 */

import type { RunnerDashboardAction } from "./reducer";
import { getDashboardSectionSummaries, type CapabilityResolver } from "./selectors";
import type { RunnerDashboardState } from "./state";

export type RunnerDashboardContinueEffect =
  | { type: "dispatch"; action: RunnerDashboardAction }
  | { type: "select-supermemory-and-open-setup"; action: RunnerDashboardAction }
  | { type: "open-developer-team-model-config" }
  | { type: "reuse-developer-team-model-config" }
  | { type: "block-review-install"; status: string }
  | { type: "complete-dashboard" }
  | { type: "none" };

/**
 * Returns the toggle action for the current cursor position.
 */
export function getDashboardToggleAction(
  state: RunnerDashboardState,
  resolver?: CapabilityResolver,
): RunnerDashboardAction | undefined {
  if (!resolver) {
    // Backward-compatible fallback for tests
    const defaultIds = ["rtk", "context-mode", "codebase-memory", "serena", "pi-hud"];
    if (state.screen === "packages-detail") {
      const capabilityId = defaultIds[state.cursor];
      return capabilityId ? { type: "toggle-capability", capabilityId } : undefined;
    }
    if (state.screen === "teams-detail" && state.cursor === 0) {
      return { type: "toggle-team", teamId: "developer-team" };
    }
    return undefined;
  }

  if (state.screen === "packages-detail") {
    const capabilityIds = resolver.getUserFacingIds();
    const capabilityId = capabilityIds[state.cursor];
    return capabilityId ? { type: "toggle-capability", capabilityId } : undefined;
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
    getCapability: () => undefined,
    getUserFacingIds: () => ["rtk", "context-mode", "codebase-memory", "serena", "pi-hud"],
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
    const capabilityIds = effectiveResolver.getUserFacingIds();
    // Last item is "back"
    if (state.cursor === capabilityIds.length) return { type: "dispatch", action: { type: "go-dashboard" } };
    const action = getDashboardToggleAction(state, effectiveResolver);
    return action ? { type: "dispatch", action } : { type: "none" };
  }

  if (state.screen === "adaptive-memory-detail") {
    const providers = ["none", "engram", "supermemory"] as const;
    const provider = providers[state.cursor];
    if (!provider) return { type: "dispatch", action: { type: "go-dashboard" } };
    const action: RunnerDashboardAction = { type: "select-adaptive-memory", provider };
    return provider === "supermemory"
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
      if (!options.canRunPlan) {
        return {
          type: "block-review-install",
          status: "Supermemory requires userId and ephemeral token captured before executing Review & Install.",
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
