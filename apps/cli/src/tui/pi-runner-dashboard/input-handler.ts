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

export function getPiRunnerDashboardToggleAction(
  state: PiRunnerDashboardState,
): PiRunnerDashboardAction | undefined {
  if (state.screen === "runner-capabilities-detail") {
    const capabilities = ["rtk", "context-mode", "codebase-memory"] as const;
    const capabilityId = capabilities[state.cursor];
    return capabilityId ? { type: "toggle-capability", capabilityId } : undefined;
  }

  if (state.screen === "runner-ui-visual-helpers-detail" && state.cursor === 0) {
    return { type: "toggle-capability", capabilityId: "pi-hud" };
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

  if (state.screen === "runner-capabilities-detail") {
    if (state.cursor >= 3) return { type: "dispatch", action: { type: "go-dashboard" } };
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

  if (state.screen === "runner-ui-visual-helpers-detail") {
    if (state.cursor === 0) {
      const action = getPiRunnerDashboardToggleAction(state);
      return action ? { type: "dispatch", action } : { type: "none" };
    }
    return { type: "dispatch", action: { type: "go-dashboard" } };
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
          status: "Supermemory requiere userId y token efímero capturado antes de ejecutar Review/Install; Pi MCP config se escribe durante Review & Install.",
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
