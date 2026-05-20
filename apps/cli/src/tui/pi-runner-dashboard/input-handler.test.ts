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
  "runner-mermaid": { capabilityId: "runner-mermaid", status: "pending-source", runnerScope: "pi", installed: false, source: "TBD", implementationId: "pi-mermaid", diagnostics: [] },
};

describe("Pi Runner dashboard input mapping", () => {
  test("dashboard cursor abre secciones y Review genera plan", () => {
    let state = createDefaultPiRunnerDashboardState();
    expect(getPiRunnerDashboardContinueEffect(state, { inventory })).toEqual({
      type: "dispatch",
      action: { type: "navigate", screen: "runner-capabilities-detail" },
    });

    state = createDefaultPiRunnerDashboardState({ cursor: 4 });
    const effect = getPiRunnerDashboardContinueEffect(state, { inventory });
    expect(effect).toMatchObject({ type: "dispatch", action: { type: "enter-review" } });
    if (effect.type === "dispatch") {
      state = reduce(state, effect.action);
      expect(state.screen).toBe("review-plan");
      expect(state.plan).toBeDefined();
    }
  });

  test("space/enter togglea pi-hud desde visual helpers", () => {
    let state = createDefaultPiRunnerDashboardState({ screen: "runner-ui-visual-helpers-detail", cursor: 0 });
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
      status: "Supermemory requiere userId y token efímero capturado antes de ejecutar Review/Install; Pi MCP config se escribe durante Review & Install.",
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
