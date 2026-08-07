import { describe, expect, test } from "bun:test";
import type { PiRunnerCapabilityInventory } from "@deck/adapter-pi";
import { reduce } from "./reducer";
import {
  getPiRunnerDashboardContinueEffect,
  getPiRunnerDashboardToggleAction,
} from "./input-handler";
import { createDefaultPiRunnerDashboardState } from "./state";
import { getAdapter } from "../../runner-adapters";
import { getDashboardSectionSummaries, getToggleablePackageInstructionIds, type CapabilityResolver } from "./selectors";

const inventory: PiRunnerCapabilityInventory = {
  "context-mode": { capabilityId: "context-mode", status: "missing", runnerScope: "pi", installed: false, toolId: "context-mode", source: "npm:context-mode", diagnostics: [] },
  "codebase-memory-mcp": { capabilityId: "codebase-memory-mcp", status: "manual", runnerScope: "pi", installed: false, toolId: "codebase-memory-mcp", source: "DeusData/codebase-memory-mcp", diagnostics: [] },
  rtk: { capabilityId: "rtk", status: "manual", runnerScope: "pi", installed: false, toolId: "rtk", source: "rtk-ai/rtk", diagnostics: [] },
  serena: { capabilityId: "serena", status: "manual", runnerScope: "pi", installed: false, toolId: "serena", source: "oraios/serena", diagnostics: [] },
  "pi-hud": { capabilityId: "pi-hud", status: "pending-source", runnerScope: "pi", installed: false, source: "TBD", diagnostics: [] },
};

describe("Pi Runner dashboard input mapping", () => {
  test("dashboard cursor abre secciones y Review genera plan", () => {
    let state = createDefaultPiRunnerDashboardState();
    // REQ-DASH-002: Section 0 is Packages (packages-detail)
    // Section 3 is Review & Install (index 3 in 4-section dashboard)
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

  test("Pi, OpenCode, and Codex expose the same five package-instruction toggles", () => {
    const expected = ["codebase-memory", "context-mode", "rtk", "adaptive-memory", "serena"] as const;
    for (const runnerId of ["pi", "opencode", "codex"] as const) {
      const adapter = getAdapter(runnerId);
      const resolver: CapabilityResolver = {
        getSupportedPackageInstructionIds: () => adapter.packageInstructionIds ?? [],
      };
      const state = createDefaultPiRunnerDashboardState({ runnerScope: runnerId, screen: "packages-detail" });
      expect(getToggleablePackageInstructionIds(state, resolver)).toEqual([...expected]);
      expect(getDashboardSectionSummaries(state, resolver)[0]).toMatchObject({ totalCount: 5, selectedCount: 0 });
    }
  });

  test("package input toggles packageInstructions without selecting runtime capabilities", () => {
    const adapter = getAdapter("pi");
    const resolver: CapabilityResolver = {
      getSupportedPackageInstructionIds: () => adapter.packageInstructionIds ?? [],
    };
    let state = createDefaultPiRunnerDashboardState({ screen: "packages-detail", cursor: 0 });
    const selectedBefore = state.selectedCapabilities["codebase-memory"];
    const action = getPiRunnerDashboardToggleAction(state, resolver);
    expect(action).toEqual({ type: "toggle-package-instruction", packageId: "codebase-memory" });

    state = reduce(state, action!);
    expect(state.packageInstructions["codebase-memory"]).toBe(true);
    expect(state.selectedCapabilities["codebase-memory"]).toBe(selectedBefore);
  });

  test("synthetic adapter support is intersected with canonical package metadata order", () => {
    const resolver: CapabilityResolver = {
      getSupportedPackageInstructionIds: () => ["serena", "code-economy", "rtk", "codebase-memory"],
    };
    const state = createDefaultPiRunnerDashboardState({ runnerScope: "synthetic", screen: "packages-detail" });
    expect(getToggleablePackageInstructionIds(state, resolver)).toEqual(["codebase-memory", "rtk", "serena"]);
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
    state = {
      ...state,
      cursor: 0,
      plan: { ready: true, diagnostics: [], groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] } },
      planGeneratedForRevision: state.planRevision,
    };

    expect(getPiRunnerDashboardContinueEffect(state, { inventory, canRunPlan: false })).toEqual({
      type: "block-review-install",
      status: "Supermemory requires token captured before executing Review & Install.",
    });
  });

  test("OpenCode selecciona Supermemory con OAuth nativo sin pedir API key", () => {
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      screen: "adaptive-memory-detail",
      cursor: 2,
    });

    expect(getPiRunnerDashboardContinueEffect(state, { inventory })).toEqual({
      type: "dispatch",
      action: { type: "select-adaptive-memory", provider: "supermemory" },
    });
  });

  test("Codex selects Supermemory with native OAuth and never requests an external token", () => {
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "codex",
      runnerUi: getAdapter("codex").ui,
      screen: "adaptive-memory-detail",
      cursor: 2,
    });

    expect(getPiRunnerDashboardContinueEffect(state, { inventory })).toEqual({
      type: "dispatch",
      action: { type: "select-adaptive-memory", provider: "supermemory" },
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

    const reviewState = createDefaultPiRunnerDashboardState({
      screen: "review-plan",
      cursor: 0,
      plan: { ready: true, diagnostics: [], groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] } },
      planGeneratedForRevision: 0,
    });
    expect(getPiRunnerDashboardContinueEffect(reviewState, { inventory, canRunPlan: true })).toEqual({ type: "dispatch", action: { type: "start-install" } });
    expect(getPiRunnerDashboardContinueEffect(reviewState, { inventory, canRunPlan: false }).type).toBe("block-review-install");
  });

  test("allows reviewed static-compatible gaps while keeping their diagnostic visible", () => {
    const reviewState = createDefaultPiRunnerDashboardState({
      runnerScope: "codex",
      runnerUi: getAdapter("codex").ui,
      screen: "review-plan",
      cursor: 0,
      plan: {
        ready: true,
        diagnostics: [{
          code: "static-compatible-gap:trusted-runner-host-bridge",
          severity: "warning",
          message: "Trusted Runner Host Bridge remains a static-compatible Codex gap.",
        }],
        groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] },
      },
      planGeneratedForRevision: 0,
    });

    expect(getPiRunnerDashboardContinueEffect(reviewState, { inventory, canRunPlan: true }))
      .toEqual({ type: "dispatch", action: { type: "start-install" } });
  });

  test("does not dispatch installation for a non-ready review plan even when an external caller says it can run", () => {
    const reviewState = createDefaultPiRunnerDashboardState({
      screen: "review-plan",
      cursor: 0,
      plan: {
        ready: false,
        diagnostics: [{ code: "codex-runtime-unsupported", severity: "error", message: "Codex 0.144.0 is below the supported version." }],
        groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] },
      },
      planGeneratedForRevision: 0,
    });

    expect(getPiRunnerDashboardContinueEffect(reviewState, { inventory, canRunPlan: true })).toEqual({
      type: "block-review-install",
      status: "Codex 0.144.0 is below the supported version.",
    });
  });
});
