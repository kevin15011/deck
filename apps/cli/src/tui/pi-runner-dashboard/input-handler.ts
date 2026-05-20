import type { PiRunnerCapabilityInventory } from "@deck/adapter-pi";
import type { PiRunnerDashboardAction } from "./reducer";
import { getDashboardSectionSummaries } from "./selectors";
import type { PiRunnerDashboardState } from "./state";

export type PiRunnerDashboardContinueEffect =
  | { type: "dispatch"; action: PiRunnerDashboardAction }
  | { type: "select-supermemory-and-open-setup"; action: PiRunnerDashboardAction }
  | { type: "open-developer-team-model-config" }
  | { type: "reuse-developer-team-model-config" }
  | { type: "block-review-install"; status: string }
  | { type: "complete-dashboard" }
  | { type: "none" };

/**
 * Returns the toggle action for the current cursor position.
 *
 * Changes from previous version (REQ-DASH-001, REQ-DASH-002):
 * - Removed runner-ui-visual-helpers-detail handling (visual helpers section removed).
 * - Runner Capabilities detail renamed to packages-detail.
 * REQ-DASH-003: Visual support is internal; no toggleable Mermaid option.
 */
export function getPiRunnerDashboardToggleAction(
  state: PiRunnerDashboardState,
): PiRunnerDashboardAction | undefined {
  if (state.screen === "packages-detail") {
    const capabilities = ["rtk", "context-mode", "codebase-memory", "pi-hud"] as const;
    const capabilityId = capabilities[state.cursor];
    return capabilityId ? { type: "toggle-capability", capabilityId } : undefined;
  }

  if (state.screen === "teams-detail" && state.cursor === 0) {
    return { type: "toggle-team", teamId: "developer-team" };
  }

  return undefined;
}

export function getPiRunnerDashboardContinueEffect(
  state: PiRunnerDashboardState,
  options: { inventory: PiRunnerCapabilityInventory; canRunPlan?: boolean },
): PiRunnerDashboardContinueEffect {
  if (state.screen === "dashboard") {
    const section = getDashboardSectionSummaries(state)[state.cursor];
    if (!section) return { type: "none" };
    if (section.screen === "review-plan") {
      return { type: "dispatch", action: { type: "enter-review", inventory: options.inventory } };
    }
    return { type: "dispatch", action: { type: "navigate", screen: section.screen } };
  }

  if (state.screen === "packages-detail") {
    // 0=rtk, 1=context-mode, 2=codebase-memory, 3=pi-hud, 4=back
    if (state.cursor === 4) return { type: "dispatch", action: { type: "go-dashboard" } };
    const action = getPiRunnerDashboardToggleAction(state);
    return action ? { type: "dispatch", action } : { type: "none" };
  }

  if (state.screen === "adaptive-memory-detail") {
    const providers = ["none", "engram", "supermemory"] as const;
    const provider = providers[state.cursor];
    if (!provider) return { type: "dispatch", action: { type: "go-dashboard" } };
    const action: PiRunnerDashboardAction = { type: "select-adaptive-memory", provider };
    return provider === "supermemory"
      ? { type: "select-supermemory-and-open-setup", action }
      : { type: "dispatch", action };
  }

  if (state.screen === "teams-detail") {
    if (state.cursor === 0) {
      const action = getPiRunnerDashboardToggleAction(state);
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
          status: "Supermemory requires userId and ephemeral token captured before executing Review & Install; Pi MCP config is written during Review & Install.",
        };
      }
      return { type: "dispatch", action: { type: "start-install" } };
    }
    if (state.cursor === 1) return { type: "dispatch", action: { type: "back" } };
    return { type: "dispatch", action: { type: "go-dashboard" } };
  }

  if (state.screen === "complete") return { type: "complete-dashboard" };

  return { type: "none" };
}