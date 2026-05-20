import { describe, expect, test } from "bun:test";
import type { PiRunnerCapabilityInventory } from "@deck/adapter-pi";
import { reduce } from "./reducer";
import {
  getPiRunnerDashboardContinueEffect,
  getPiRunnerDashboardToggleAction,
} from "./input-handler";
import { createDefaultPiRunnerDashboardState } from "./state";

const inventory: PiRunnerCapabilityInventory = {
  "context-mode": { capabilityId: "context-mode", status: "missing", runnerScope: "pi", installed: false, toolId: "context-mode", source: "npm:context-mode", diagnostics: [] },
  "codebase-memory": { capabilityId: "codebase-memory", status: "manual", runnerScope: "pi", installed: false, toolId: "codebase-memory", source: "DeusData/codebase-memory-mcp", diagnostics: [] },
  rtk: { capabilityId: "rtk", status: "manual", runnerScope: "pi", installed: false, toolId: "rtk", source: "rtk-ai/rtk", diagnostics: [] },
  "pi-hud": { capabilityId: "pi-hud", status: "pending-source", runnerScope: "pi", installed: false, source: "TBD", diagnostics: [] },
};

describe("Pi Runner dashboard input mapping", () => {
  test("dashboard cursor abre secciones y Review genera plan", () => {
    let state = createDefaultPiRunnerDashboardState();
    // REQ-DASH-002: Section 0 is Packages (packages-detail), not Runner Capabilities
    expect(getPiRunnerDashboardContinueEffect(state, { inventory })).toEqual({
      type: "dispatch",
      action: { type: "navigate", screen: "packages-detail" },
    });

    // cursor: 3 = Review & Install (index 3 in 4-section dashboard)
    state = createDefaultPiRunnerDashboardState({ cursor: 3 });
    const effect = getPiRunnerDashboardContinueEffect(state, { inventory });
    expect(effect).toMatchObject({ type: "dispatch", action: { type: "enter-review" } });
    if (effect.type === "dispatch") {
      state = reduce(state, effect.action);
      expect(state.screen).toBe("review-plan");
      expect(state.plan).toBeDefined();
    }
  });

  test("space/enter togglea pi-hud desde Packages detail (no visual helpers)", () => {
    // REQ-DASH-002: Runner UI/visual helpers merged into Packages section
    // REQ-DASH-001: Mermaid not present; pi-hud is toggled from packages-detail
    let state = createDefaultPiRunnerDashboardState({ screen: "packages-detail", cursor: 3 }); // cursor 3 = pi-hud
    const action = getPiRunnerDashboardToggleAction(state);
    expect(action).toEqual({ type: "toggle-capability", capabilityId: "pi-hud" });

    state = reduce(state, action!);
    expect(state.selectedCapabilities["pi-hud"]).toBe(true);

    const enterEffect = getPiRunnerDashboardContinueEffect(state, { inventory });
    expect(enterEffect).toEqual({ type: "dispatch", action: { type: "toggle-capability", capabilityId: "pi-hud" } });
  });

  test("seleccionar Supermemory abre setup y bloquea ejecución hasta configurar", () => {
    let state = createDefaultPiRunnerDashboardState({ screen: "adaptive-memory-detail", cursor: 2 });
    const setupEffect = getPiRunnerDashboardContinueEffect(state, { inventory });
    expect(setupEffect).toMatchObject({
      type: "select-supermemory-and-open-setup",
      action: { type: "select-adaptive-memory", provider: "supermemory" },
    });

    if (setupEffect.type === "select-supermemory-and-open-setup") state = reduce(state, setupEffect.action);
    state = reduce(state, { type: "enter-review", inventory });
    state = { ...state, cursor: 0 };

    expect(getPiRunnerDashboardContinueEffect(state, { inventory, canRunPlan: false })).toEqual({
      type: "block-review-install",
      status: "Supermemory requires userId and ephemeral token captured before executing Review & Install; Pi MCP config is written during Review & Install.",
    });
  });

  test("Developer Team detail model config/back y Review blocked/unblocked mapean acciones críticas", () => {
    expect(getPiRunnerDashboardContinueEffect(createDefaultPiRunnerDashboardState({ screen: "teams-detail", cursor: 1 }), { inventory })).toEqual({
      type: "dispatch",
      action: { type: "navigate", screen: "developer-team-detail" },
    });
    expect(getPiRunnerDashboardContinueEffect(createDefaultPiRunnerDashboardState({ screen: "developer-team-detail", cursor: 0 }), { inventory })).toEqual({ type: "open-developer-team-model-config" });
    expect(getPiRunnerDashboardContinueEffect(createDefaultPiRunnerDashboardState({ screen: "developer-team-detail", cursor: 1 }), { inventory })).toEqual({ type: "reuse-developer-team-model-config" });
    expect(getPiRunnerDashboardContinueEffect(createDefaultPiRunnerDashboardState({ screen: "developer-team-detail", cursor: 2 }), { inventory })).toEqual({ type: "dispatch", action: { type: "back" } });

    const reviewState = createDefaultPiRunnerDashboardState({ screen: "review-plan", cursor: 0 });
    expect(getPiRunnerDashboardContinueEffect(reviewState, { inventory, canRunPlan: true })).toEqual({ type: "dispatch", action: { type: "start-install" } });
    expect(getPiRunnerDashboardContinueEffect(reviewState, { inventory, canRunPlan: false }).type).toBe("block-review-install");
  });
});