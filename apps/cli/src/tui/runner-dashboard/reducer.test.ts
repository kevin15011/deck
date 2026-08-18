import { describe, expect, test } from "bun:test";
import { buildPiRunnerReviewPlan, type PiRunnerCapabilityInventory } from "@deck/adapter-pi";
import { reduce, type PlanBuilderFn } from "./reducer";
import { createDefaultPiRunnerDashboardState, type PiRunnerReviewPlan, type RunnerDashboardState } from "./state";
import { getAdapter } from "../../runner-adapters";

const piPlanBuilder: PlanBuilderFn = (state, inventory) => buildPiRunnerReviewPlan(state as any, inventory as PiRunnerCapabilityInventory);

// REQ-DASH-001: runner-mermaid is internal, not in user-facing inventory
// REQ-DASH-002: Packages section replaces Runner Capabilities + visual helpers
const inventory: PiRunnerCapabilityInventory = {
  "context-mode": {
    capabilityId: "context-mode",
    status: "missing",
    runnerScope: "pi",
    installed: false,
    toolId: "context-mode",
    source: "npm:context-mode",
    diagnostics: [],
  },
  "codebase-memory-mcp": {
    capabilityId: "codebase-memory-mcp",
    status: "manual",
    runnerScope: "pi",
    installed: false,
    toolId: "codebase-memory-mcp",
    source: "DeusData/codebase-memory-mcp",
    diagnostics: [],
  },
  rtk: {
    capabilityId: "rtk",
    status: "manual",
    runnerScope: "pi",
    installed: false,
    toolId: "rtk",
    source: "rtk-ai/rtk",
    diagnostics: [],
  },
  serena: {
    capabilityId: "serena",
    status: "manual",
    runnerScope: "pi",
    installed: false,
    toolId: "serena",
    source: "serena-dev/serena",
    diagnostics: [],
  },
  "pi-hud": {
    capabilityId: "pi-hud",
    status: "pending-source",
    runnerScope: "pi",
    installed: false,
    source: "TBD",
    diagnostics: ["pi-hud pending"],
  },
};

function allActionIds(plan: PiRunnerReviewPlan | undefined): string[] {
  if (!plan) return [];
  return Object.values(plan.groups).flat().map((action) => action.id);
}

describe("Pi Runner dashboard reducer", () => {
  test("tracks an operation for an arbitrary registered runner identity", () => {
    const state = reduce(createDefaultPiRunnerDashboardState(), {
      type: "set-runner",
      runnerScope: "atlas",
      operationId: "atlas-operation-1",
    });

    expect(state.currentOperation).toEqual({
      runner: "atlas",
      operationId: "atlas-operation-1",
      explicitlySelected: false,
    });
  });

  test("ignores stale review-plan state evidence from an old runner operation", () => {
    const current = reduce(createDefaultPiRunnerDashboardState(), {
      type: "set-runner",
      runnerScope: "opencode",
      operationId: "opencode-current-operation",
    });
    const builder: PlanBuilderFn = () => ({
      plan: { ready: true, diagnostics: [], groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] } },
      state: { adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, runtimeCredentialVerification: "verified-present", diagnostics: [] } } },
    });

    const stale = reduce(current, {
      type: "enter-review",
      inventory,
      operation: { runner: "opencode", operationId: "opencode-previous-operation", explicitlySelected: false },
    }, builder);

    expect(stale).toBe(current);
    expect(stale.screen).toBe("dashboard");
    expect(stale.plan).toBeUndefined();
    expect(stale.adaptiveMemory.provider).toBe("none");
  });

  test("ignores stale credential evidence action for a different operation", () => {
    const currentOperation = { runner: "opencode" as const, operationId: "opencode-current-operation", explicitlySelected: false };
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      operationId: currentOperation.operationId,
      currentOperation,
      adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: false, runtimeCredentialStored: false, diagnostics: [] } },
    });

    const stale = reduce(state, {
      type: "apply-supermemory-runtime-credential-evidence",
      evidence: { configured: true, runtimeCredentialStored: true, runtimeCredentialVerification: "verified-present", ephemeralTokenAvailable: false, diagnostics: [] },
      identity: {
        runnerId: "opencode",
        operation: { runner: "opencode", operationId: "opencode-stale-operation", explicitlySelected: false },
        planRevision: 0,
        planGeneratedForRevision: 0,
      },
    });

    expect(stale).toBe(state);
    expect(stale.adaptiveMemory.supermemory).not.toHaveProperty("runtimeCredentialVerification");
    expect(stale.adaptiveMemory.supermemory?.runtimeCredentialStored).toBe(false);
  });

  test("ignores credential evidence action after plan generation changes", () => {
    const currentOperation = { runner: "opencode" as const, operationId: "opencode-current-operation", explicitlySelected: false };
    const plan = { ready: true, diagnostics: [], groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] } };
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      operationId: currentOperation.operationId,
      currentOperation,
      plan,
      planRevision: 1,
      planGeneratedForRevision: 1,
      adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: false, runtimeCredentialStored: false, diagnostics: [] } },
    });

    const stale = reduce(state, {
      type: "apply-supermemory-runtime-credential-evidence",
      evidence: { configured: true, runtimeCredentialStored: true, runtimeCredentialVerification: "verified-present", ephemeralTokenAvailable: false, diagnostics: [] },
      identity: {
        runnerId: "opencode",
        operation: currentOperation,
        planRevision: 0,
        planGeneratedForRevision: 0,
      },
    });

    expect(stale).toBe(state);
    expect(stale.adaptiveMemory.supermemory).not.toHaveProperty("runtimeCredentialVerification");
    expect(stale.adaptiveMemory.supermemory?.runtimeCredentialStored).toBe(false);
  });

  test("uses adapter-owned memory behavior for an arbitrary runner identity", () => {
    const nativeOAuthUi = getAdapter("opencode").ui!;
    const state = reduce(createDefaultPiRunnerDashboardState({
      runnerScope: "atlas",
      runnerUi: { ...nativeOAuthUi, environmentLabels: { "atlas-development": "Atlas Development" } },
      screen: "adaptive-memory-detail",
      backStack: ["dashboard"],
    }), { type: "select-adaptive-memory", provider: "supermemory" });

    expect(state.screen).toBe("adaptive-memory-detail");
    expect(state.adaptiveMemory.supermemory).toMatchObject({ configured: false, hasToken: false });
    expect(state.adaptiveMemory.status).toContain("runtime API token");
  });

  test("keeps Serena explicit authorization separate from defaults and config state", () => {
    const state = createDefaultPiRunnerDashboardState({
      operationId: "pi-operation-1",
      currentOperation: { runner: "pi", operationId: "pi-operation-1", explicitlySelected: false },
      selectedCapabilities: { serena: true },
      packageInstructions: { serena: true },
      capabilityStatuses: { serena: "ready" },
    });

    expect(state.selectedCapabilities.serena).toBe(true);
    expect(state.explicitlySelectedCapabilities.serena).toBeUndefined();

    const selected = reduce(state, { type: "toggle-capability", capabilityId: "serena" });
    expect(selected.selectedCapabilities.serena).toBe(false);
    expect(selected.explicitlySelectedCapabilities.serena).toBeUndefined();

    const reselected = reduce(selected, { type: "toggle-capability", capabilityId: "serena" });
    expect(reselected.selectedCapabilities.serena).toBe(true);
    expect(reselected.explicitlySelectedCapabilities.serena).toBe(true);
    expect(reselected.currentOperation).toEqual({ runner: "pi", operationId: "pi-operation-1", explicitlySelected: true });
  });

  test("does not treat a state/config projection as an explicit Serena selection", () => {
    const state = createDefaultPiRunnerDashboardState({
      operationId: "pi-operation-1",
      currentOperation: { runner: "pi", operationId: "pi-operation-1", explicitlySelected: false },
      selectedCapabilities: { serena: true },
      packageInstructions: { serena: true },
    });

    const projected = reduce(state, { type: "set-capability", capabilityId: "serena", selected: true });

    expect(projected.explicitlySelectedCapabilities.serena).toBeUndefined();
    expect(projected.currentOperation?.explicitlySelected).toBe(false);
  });

  test("runner changes and new operations clear ephemeral Serena authorization and stale plans", () => {
    const plan: PiRunnerReviewPlan = {
      groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] },
      diagnostics: [],
      ready: true,
    };
    let state = createDefaultPiRunnerDashboardState({
      operationId: "pi-operation-1",
      currentOperation: { runner: "pi", operationId: "pi-operation-1", explicitlySelected: true },
      explicitlySelectedCapabilities: { serena: true },
      selectedCapabilities: { serena: true },
      plan,
      planGeneratedForRevision: 0,
    });

    state = reduce(state, { type: "set-runner", runnerScope: "opencode", operationId: "opencode-operation-1" });
    expect(state.runnerScope).toBe("opencode");
    expect(state.explicitlySelectedCapabilities).toEqual({});
    expect(state.currentOperation).toEqual({ runner: "opencode", operationId: "opencode-operation-1", explicitlySelected: false });
    expect(state.plan).toBeUndefined();

    state = reduce(state, { type: "set-capability", capabilityId: "serena", selected: false });
    state = reduce(state, { type: "toggle-capability", capabilityId: "serena" });
    expect(state.explicitlySelectedCapabilities.serena).toBe(true);

    state = reduce(state, { type: "new-operation", runnerScope: "opencode", operationId: "opencode-operation-2" });
    expect(state.explicitlySelectedCapabilities).toEqual({});
    expect(state.currentOperation).toEqual({ runner: "opencode", operationId: "opencode-operation-2", explicitlySelected: false });
    expect(state.plan).toBeUndefined();
  });

  test("navega dashboard → sección → dashboard conservando selecciones y back stack", () => {
    let state = createDefaultPiRunnerDashboardState();

    state = reduce(state, { type: "set-capability", capabilityId: "rtk", selected: true });
    state = reduce(state, { type: "set-team-selected", teamId: "developer-team", selected: true });
    // REQ-DASH-002: packages-detail replaces runner-capabilities-detail
    state = reduce(state, { type: "navigate", screen: "packages-detail" });

    expect(state.screen).toBe("packages-detail");
    expect(state.backStack).toEqual(["dashboard"]);

    state = reduce(state, { type: "back" });

    expect(state.screen).toBe("dashboard");
    expect(state.backStack).toEqual([]);
    expect(state.selectedCapabilities.rtk).toBe(true);
    expect(state.teams["developer-team"]?.selected).toBe(true);
  });

  test("back stack vuelve por pantallas previas y cursor se resetea", () => {
    let state = createDefaultPiRunnerDashboardState();
    state = reduce(state, { type: "navigate", screen: "teams-detail" });
    state = reduce(state, { type: "navigate", screen: "developer-team-detail" });
    state = reduce(state, { type: "cursor", cursor: 2 });

    state = reduce(state, { type: "back" });
    expect(state.screen).toBe("teams-detail");
    expect(state.cursor).toBe(0);
    expect(state.backStack).toEqual(["dashboard"]);

    state = reduce(state, { type: "back" });
    expect(state.screen).toBe("dashboard");
    expect(state.backStack).toEqual([]);
  });

  test("cursor se limita por sección", () => {
    let state = createDefaultPiRunnerDashboardState();
    // Dashboard has 5 sections: Packages, Adaptive Memory, Web Search, Teams, Review & Install
    state = reduce(state, { type: "cursor", cursor: 99 });
    expect(state.cursor).toBe(4);

    state = reduce(state, { type: "navigate", screen: "adaptive-memory-detail" });
    state = reduce(state, { type: "cursor", cursor: 99 });
    expect(state.cursor).toBe(2);

    state = reduce(state, { type: "cursor-up" });
    expect(state.cursor).toBe(1);

    state = reduce(state, { type: "cursor", cursor: -10 });
    expect(state.cursor).toBe(0);
  });

  test("togglea RTK, context-mode, codebase-memory-mcp, serena y pi-hud", () => {
    let state = createDefaultPiRunnerDashboardState({
      operationId: "pi-operation-toggle",
      currentOperation: { runner: "pi", operationId: "pi-operation-toggle", explicitlySelected: false },
    });

    state = reduce(state, { type: "toggle-capability", capabilityId: "rtk" });
    state = reduce(state, { type: "toggle-capability", capabilityId: "context-mode" });
    // Only codebase-memory-mcp is available (not codebase-memory) for OpenCode parity
    state = reduce(state, { type: "toggle-capability", capabilityId: "codebase-memory-mcp" });
    state = reduce(state, { type: "toggle-capability", capabilityId: "serena" });
    state = reduce(state, { type: "toggle-capability", capabilityId: "pi-hud" });

    expect(state.selectedCapabilities.rtk).toBe(false);
    expect(state.selectedCapabilities["context-mode"]).toBe(false);
    expect(state.selectedCapabilities["codebase-memory-mcp"]).toBe(false);
    expect(state.selectedCapabilities.serena).toBe(true);
    expect(state.selectedCapabilities["pi-hud"]).toBe(true);

    // Toggle back on
    state = reduce(state, { type: "toggle-capability", capabilityId: "rtk" });
    expect(state.selectedCapabilities.rtk).toBe(true);

    state = reduce(state, { type: "toggle-capability", capabilityId: "serena" });
    expect(state.selectedCapabilities.serena).toBe(false);
  });

  test("Adaptive Memory inicia en None y no agrega acciones de memoria", () => {
    let state = createDefaultPiRunnerDashboardState();
    expect(state.adaptiveMemory.provider).toBe("none");

    state = reduce(state, { type: "enter-review", inventory }, piPlanBuilder);

    const ids = allActionIds(state.plan);
    expect(ids.some((id) => id.includes("engram"))).toBe(false);
    expect(ids.some((id) => id.includes("supermemory"))).toBe(false);
  });

  test("Adaptive Memory can be disabled after Supermemory and clears configuration", () => {
    let state = createDefaultPiRunnerDashboardState();

    state = reduce(state, { type: "select-adaptive-memory", provider: "supermemory" });
    state = reduce(state, {
      type: "update-supermemory",
      values: { configured: true, hasToken: true, diagnostics: ["ok"] },
    });
    expect(state.adaptiveMemory.provider).toBe("supermemory");
    expect(state.adaptiveMemory.supermemory?.hasToken).toBe(true);

    state = reduce(state, { type: "select-adaptive-memory", provider: "none" });
    state = reduce(state, { type: "regenerate-plan", inventory }, piPlanBuilder);
    expect(state.adaptiveMemory.provider).toBe("none");
    expect(allActionIds(state.plan).some((id) => id.includes("engram") || id.includes("supermemory"))).toBe(false);
  });

  test("OpenCode requires runtime token setup before optional MCP OAuth", () => {
    let state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      screen: "adaptive-memory-detail",
      backStack: ["dashboard"],
    });

    state = reduce(state, { type: "select-adaptive-memory", provider: "supermemory" });

    expect(state.screen).toBe("adaptive-memory-detail");
    expect(state.adaptiveMemory.provider).toBe("supermemory");
    expect(state.adaptiveMemory.supermemory).toMatchObject({
      configured: false,
      hasToken: false,
    });
    expect(state.adaptiveMemory.status).toContain("runtime API token");
  });

  test("Developer Team se selecciona y deselecciona; el plan lo refleja", () => {
    let state = createDefaultPiRunnerDashboardState();

    state = reduce(state, { type: "toggle-team", teamId: "developer-team" });
    expect(state.teams["developer-team"]?.selected).toBe(true);
    state = reduce(state, { type: "enter-review", inventory }, piPlanBuilder);
    expect(state.plan?.groups.teamApplications.some((action) => action.id === "team.developer-team.apply")).toBe(true);

    state = reduce(state, { type: "set-team-selected", teamId: "developer-team", selected: false });
    state = reduce(state, { type: "regenerate-plan", inventory }, piPlanBuilder);
    expect(state.teams["developer-team"]?.selected).toBe(false);
    expect(state.plan?.groups.teamApplications).toEqual([]);
  });

  test("Review & Install regenera plan y bloquea instalación con plan stale", () => {
    let state = createDefaultPiRunnerDashboardState();
    state = reduce(state, { type: "select-adaptive-memory", provider: "supermemory" });
    state = reduce(state, { type: "enter-review", inventory }, piPlanBuilder);

    const firstRevision = state.planGeneratedForRevision;
    expect(state.screen).toBe("review-plan");
    expect(firstRevision).toBe(state.planRevision);
    expect(allActionIds(state.plan).some((id) => id.includes("supermemory"))).toBe(true);

    // Toggle OFF first (context-mode is already true by default), then back ON to invalidate
    state = reduce(state, { type: "set-capability", capabilityId: "context-mode", selected: false });
    expect(state.plan).toBeUndefined();
    state = reduce(state, { type: "set-capability", capabilityId: "context-mode", selected: true });
    expect(state.plan).toBeUndefined();
    expect(state.planGeneratedForRevision).toBeUndefined();

    const blocked = reduce(state, { type: "start-install" });
    expect(blocked.screen).toBe("review-plan");

    state = reduce(state, { type: "regenerate-plan", inventory }, piPlanBuilder);
    expect(state.planGeneratedForRevision).toBe(state.planRevision);
    expect(state.planGeneratedForRevision).not.toBe(firstRevision);
    expect(state.plan?.groups.automaticInstalls.some((action) => action.capabilityId === "context-mode")).toBe(true);
  });

  test("contains plan-builder failures in a non-ready plan and never starts installation", () => {
    const failingPlanBuilder: PlanBuilderFn = () => {
      throw new Error("adapter inventory contract mismatch");
    };
    let state = createDefaultPiRunnerDashboardState({ cursor: 3 });

    state = reduce(state, { type: "enter-review", inventory: {} }, failingPlanBuilder);

    expect(state.screen).toBe("review-plan");
    expect(state.plan).toMatchObject({
      ready: false,
      diagnostics: [{ code: "plan-build-failed", severity: "error" }],
    });

    state = reduce(state, { type: "start-install" }, failingPlanBuilder);
    expect(state.screen).toBe("review-plan");
  });

  test("toggle-package-instruction actualiza packageInstructions y invalida plan", () => {
    let state = createDefaultPiRunnerDashboardState();
    const initialRevision = state.planRevision;

    state = reduce(state, { type: "toggle-package-instruction", packageId: "codebase-memory" });
    expect(state.packageInstructions["codebase-memory"]).toBe(true);
    expect(state.plan).toBeUndefined();
    expect(state.planRevision).toBe(initialRevision + 1);

    state = reduce(state, { type: "toggle-package-instruction", packageId: "context-mode" });
    expect(state.packageInstructions["context-mode"]).toBe(true);
    expect(state.packageInstructions["codebase-memory"]).toBe(true);
    expect(state.planRevision).toBe(initialRevision + 2);

    state = reduce(state, { type: "toggle-package-instruction", packageId: "codebase-memory" });
    expect(state.packageInstructions["codebase-memory"]).toBe(false);
    expect(state.plan).toBeUndefined();
    expect(state.planRevision).toBeGreaterThanOrEqual(initialRevision + 3);
  });

  test("set-package-instruction establece valor explícito y invalida plan", () => {
    let state = createDefaultPiRunnerDashboardState();

    state = reduce(state, { type: "set-package-instruction", packageId: "rtk", enabled: true });
    expect(state.packageInstructions.rtk).toBe(true);

    state = reduce(state, { type: "set-package-instruction", packageId: "rtk", enabled: false });
    expect(state.packageInstructions.rtk).toBe(false);

    expect(state.plan).toBeUndefined();
  });

  test("rejects baseline and non-package IDs at the reducer boundary", () => {
    const state = createDefaultPiRunnerDashboardState();
    expect(reduce(state, { type: "toggle-package-instruction", packageId: "code-economy" } as any)).toBe(state);
    expect(reduce(state, { type: "toggle-package-instruction", packageId: "pi-hud" } as any)).toBe(state);
  });

  test("packageInstructions es independiente de selectedCapabilities", () => {
    let state = createDefaultPiRunnerDashboardState();

    // selectedCapabilities controls installation; packageInstructions controls instruction injection
    state = reduce(state, { type: "set-capability", capabilityId: "codebase-memory", selected: true });
    state = reduce(state, { type: "toggle-package-instruction", packageId: "codebase-memory" });

    expect(state.selectedCapabilities["codebase-memory"]).toBe(true);
    expect(state.packageInstructions["codebase-memory"]).toBe(true);

    // Toggle one does not affect the other
    state = reduce(state, { type: "set-capability", capabilityId: "codebase-memory", selected: false });
    expect(state.selectedCapabilities["codebase-memory"]).toBe(false);
    expect(state.packageInstructions["codebase-memory"]).toBe(true);
  });
});
