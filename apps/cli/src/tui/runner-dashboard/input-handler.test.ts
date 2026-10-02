import { describe, expect, test } from "bun:test";
import type { PiRunnerCapabilityInventory } from "@deck/adapter-pi";
import { buildOpenCodeRunnerReviewPlan } from "@deck/adapter-opencode";
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

    // cursor: 4 = Review & Install after the first-class Web Search section
    state = createDefaultPiRunnerDashboardState({ cursor: 4 });
    const effect = getPiRunnerDashboardContinueEffect(state, { inventory });
    expect(effect).toMatchObject({ type: "dispatch", action: { type: "enter-review" } });
    if (effect.type === "dispatch") {
      state = reduce(state, effect.action);
      expect(state.screen).toBe("review-plan");
      expect(state.plan).toBeDefined();
    }
  });

  test("OpenCode omits Deck adaptive-memory instructions while Pi and Codex retain them", () => {
    const expected = ["codebase-memory", "context-mode", "rtk", "adaptive-memory", "serena"] as const;
    for (const runnerId of ["pi", "opencode", "codex"] as const) {
      const adapter = getAdapter(runnerId);
      const resolver: CapabilityResolver = {
        getSupportedPackageInstructionIds: () => adapter.packageInstructionIds ?? [],
      };
      const state = createDefaultPiRunnerDashboardState({ runnerScope: runnerId, screen: "packages-detail" });
      const runnerExpected = runnerId === "opencode" ? expected.filter((id) => id !== "adaptive-memory") : [...expected];
      expect(getToggleablePackageInstructionIds(state, resolver)).toEqual(runnerExpected);
      expect(getDashboardSectionSummaries(state, resolver)[0]).toMatchObject({ totalCount: runnerExpected.length, selectedCount: runnerExpected.length });
    }
  });

  test("package input toggles packageInstructions without selecting runtime capabilities", () => {
    const adapter = getAdapter("pi");
    const resolver: CapabilityResolver = {
      getSupportedPackageInstructionIds: () => adapter.packageInstructionIds ?? [],
    };
    let state = createDefaultPiRunnerDashboardState({
      screen: "packages-detail",
      cursor: 0,
      packageInstructions: { "codebase-memory": false },
    });
    const selectedBefore = state.selectedCapabilities["codebase-memory"];
    const action = getPiRunnerDashboardToggleAction(state, resolver);
    expect(action).toEqual({ type: "toggle-package-instruction", packageId: "codebase-memory" });

    state = reduce(state, action!);
    expect(state.packageInstructions["codebase-memory"]).toBe(true);
    expect(state.selectedCapabilities["codebase-memory"]).toBe(selectedBefore);
  });

  test("a current-operation Serena package toggle explicitly selects it for installation", () => {
    const adapter = getAdapter("opencode");
    const resolver: CapabilityResolver = {
      getSupportedPackageInstructionIds: () => adapter.packageInstructionIds ?? [],
    };
    const operation = {
      runner: "opencode" as const,
      operationId: "opencode-serena-package-selection",
      explicitlySelected: false,
    };
    let state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      screen: "packages-detail",
      cursor: 3,
      operationId: operation.operationId,
      currentOperation: operation,
      selectedCapabilities: { serena: false },
      packageInstructions: { serena: false },
    });

    const selectAction = getPiRunnerDashboardToggleAction(state, resolver);
    expect(selectAction).toBeDefined();
    state = reduce(state, selectAction!);

    expect(state.packageInstructions.serena).toBe(true);
    expect(state.selectedCapabilities.serena).toBe(true);
    expect(state.explicitlySelectedCapabilities.serena).toBe(true);
    expect(state.currentOperation).toEqual({ ...operation, explicitlySelected: true });

    const plan = buildOpenCodeRunnerReviewPlan({
      runnerScope: state.runnerScope,
      operationId: state.operationId,
      currentOperation: { ...operation, explicitlySelected: true },
      selectedCapabilities: { serena: state.selectedCapabilities.serena === true },
      explicitlySelectedCapabilities: { serena: state.explicitlySelectedCapabilities.serena === true },
    }, {
      serena: {
        capabilityId: "serena",
        status: "missing",
        runnerScope: "opencode",
        installed: false,
        toolId: "serena",
        source: "serena-agent",
        diagnostics: [],
      },
    });
    expect(plan.groups.automaticInstalls).toContainEqual(expect.objectContaining({
      id: "capability.serena.install",
      source: "serena-agent",
    }));

    const clearAction = getPiRunnerDashboardToggleAction(state, resolver);
    expect(clearAction).toBeDefined();
    state = reduce(state, clearAction!);

    expect(state.packageInstructions.serena).toBe(false);
    expect(state.selectedCapabilities.serena).toBe(false);
    expect(state.explicitlySelectedCapabilities.serena).toBeUndefined();
    expect(state.currentOperation).toEqual(operation);
  });

  test("a Serena package toggle without a current operation cannot authorize installation", () => {
    const adapter = getAdapter("opencode");
    const resolver: CapabilityResolver = {
      getSupportedPackageInstructionIds: () => adapter.packageInstructionIds ?? [],
    };
    let state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      screen: "packages-detail",
      cursor: 3,
      operationId: undefined,
      currentOperation: undefined,
      selectedCapabilities: { serena: false },
      packageInstructions: { serena: false },
    });

    const action = getPiRunnerDashboardToggleAction(state, resolver);
    expect(action).toBeDefined();
    state = reduce(state, action!);

    expect(state.packageInstructions.serena).toBe(true);
    expect(state.explicitlySelectedCapabilities.serena).toBeUndefined();
    expect(state.currentOperation).toBeUndefined();
  });

  test("Web Search opens masked credential setup only when enablement lacks a credential", () => {
    const missingCredential = createDefaultPiRunnerDashboardState({
      screen: "web-search-detail",
      cursor: 0,
      selectedCapabilities: { "web-search": false },
      webSearch: {
        provider: "tavily",
        credentialAvailable: false,
        runnerSupported: true,
        mcpConfigured: false,
        mcpConfigConflict: false,
        readiness: "enabled-unconfigured",
      },
    });
    const availableCredential = {
      ...missingCredential,
      webSearch: { ...missingCredential.webSearch, credentialAvailable: true },
    };

    expect(getPiRunnerDashboardContinueEffect(missingCredential, { inventory })).toEqual({
      type: "open-web-search-credential",
    });
    expect(getPiRunnerDashboardContinueEffect(availableCredential, { inventory })).toEqual({
      type: "dispatch",
      action: { type: "set-capability", capabilityId: "web-search", selected: true },
    });
  });

  test("synthetic adapter support is intersected with canonical package metadata order", () => {
    const resolver: CapabilityResolver = {
      getSupportedPackageInstructionIds: () => ["serena", "code-economy", "rtk", "codebase-memory"],
    };
    const state = createDefaultPiRunnerDashboardState({ runnerScope: "synthetic", screen: "packages-detail" });
    expect(getToggleablePackageInstructionIds(state, resolver)).toEqual(["codebase-memory", "rtk", "serena"]);
  });

  test("seleccionar Supermemory abre setup y bloquea ejecución hasta configurar", () => {
    let state = createDefaultPiRunnerDashboardState({ screen: "adaptive-memory-detail", cursor: 1 });
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

  test("OpenCode Supermemory selection opens runtime token setup before optional OAuth", () => {
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      screen: "adaptive-memory-detail",
      cursor: 1,
    });

    expect(getPiRunnerDashboardContinueEffect(state, { inventory })).toEqual({
      type: "select-supermemory-and-open-setup",
      action: { type: "select-adaptive-memory", provider: "supermemory" },
    });
  });

  test("Codex Supermemory selection opens runtime token setup before optional OAuth", () => {
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "codex",
      runnerUi: getAdapter("codex").ui,
      screen: "adaptive-memory-detail",
      cursor: 1,
    });

    expect(getPiRunnerDashboardContinueEffect(state, { inventory })).toEqual({
      type: "select-supermemory-and-open-setup",
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

  test("stale Review screen regenerates current plan before blocking or running", () => {
    const reviewState = createDefaultPiRunnerDashboardState({
      screen: "review-plan",
      cursor: 0,
      plan: { ready: false, diagnostics: [{ code: "old", severity: "warning", message: "old stale diagnostic" }], groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] } },
      planRevision: 2,
      planGeneratedForRevision: 1,
    });

    expect(getPiRunnerDashboardContinueEffect(reviewState, { inventory, canRunPlan: true })).toEqual({
      type: "dispatch",
      action: { type: "enter-review", inventory, confirmSelectedPackages: true },
    });
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
