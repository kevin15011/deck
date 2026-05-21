import { describe, expect, test } from "bun:test";
import { buildPiRunnerReviewPlan, type PiRunnerCapabilityInventory } from "@deck/adapter-pi";
import { reduce, type PlanBuilderFn } from "./reducer";
import { createDefaultPiRunnerDashboardState, type PiRunnerReviewPlan, type RunnerDashboardState } from "./state";

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
  "codebase-memory": {
    capabilityId: "codebase-memory",
    status: "manual",
    runnerScope: "pi",
    installed: false,
    toolId: "codebase-memory",
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
    // Dashboard has 5 sections: Packages, Adaptive Memory, Teams, Configure Packages, Review & Install
    state = reduce(state, { type: "cursor", cursor: 99 });
    expect(state.cursor).toBe(4);

    state = reduce(state, { type: "navigate", screen: "adaptive-memory-detail" });
    state = reduce(state, { type: "cursor", cursor: 99 });
    expect(state.cursor).toBe(3);

    state = reduce(state, { type: "cursor-up" });
    expect(state.cursor).toBe(2);

    state = reduce(state, { type: "cursor", cursor: -10 });
    expect(state.cursor).toBe(0);
  });

  test("togglea RTK, context-mode, codebase-memory y pi-hud", () => {
    let state = createDefaultPiRunnerDashboardState();

    state = reduce(state, { type: "toggle-capability", capabilityId: "rtk" });
    state = reduce(state, { type: "toggle-capability", capabilityId: "context-mode" });
    state = reduce(state, { type: "toggle-capability", capabilityId: "codebase-memory" });
    state = reduce(state, { type: "toggle-capability", capabilityId: "pi-hud" });

    expect(state.selectedCapabilities.rtk).toBe(true);
    expect(state.selectedCapabilities["context-mode"]).toBe(true);
    expect(state.selectedCapabilities["codebase-memory"]).toBe(true);
    expect(state.selectedCapabilities["pi-hud"]).toBe(true);

    state = reduce(state, { type: "toggle-capability", capabilityId: "rtk" });
    expect(state.selectedCapabilities.rtk).toBe(false);
  });

  test("Adaptive Memory inicia en None y no agrega acciones de memoria", () => {
    let state = createDefaultPiRunnerDashboardState();
    expect(state.adaptiveMemory.provider).toBe("none");

    state = reduce(state, { type: "enter-review", inventory }, piPlanBuilder);

    const ids = allActionIds(state.plan);
    expect(ids.some((id) => id.includes("engram"))).toBe(false);
    expect(ids.some((id) => id.includes("supermemory"))).toBe(false);
  });

  test("Adaptive Memory es single-choice y cambiar provider limpia configuración previa", () => {
    let state = createDefaultPiRunnerDashboardState();

    state = reduce(state, { type: "select-adaptive-memory", provider: "supermemory" });
    state = reduce(state, {
      type: "update-supermemory",
      values: { configured: true, hasToken: true, userId: "user-1", diagnostics: ["ok"] },
    });
    expect(state.adaptiveMemory.provider).toBe("supermemory");
    expect(state.adaptiveMemory.supermemory?.userId).toBe("user-1");

    state = reduce(state, { type: "select-adaptive-memory", provider: "engram" });
    expect(state.adaptiveMemory.provider).toBe("engram");
    expect(state.adaptiveMemory.supermemory).toBeUndefined();

    state = reduce(state, { type: "enter-review", inventory }, piPlanBuilder);
    expect(allActionIds(state.plan).some((id) => id.includes("engram"))).toBe(true);
    expect(allActionIds(state.plan).some((id) => id.includes("supermemory"))).toBe(false);

    state = reduce(state, { type: "select-adaptive-memory", provider: "none" });
    state = reduce(state, { type: "regenerate-plan", inventory }, piPlanBuilder);
    expect(state.adaptiveMemory.provider).toBe("none");
    expect(allActionIds(state.plan).some((id) => id.includes("engram") || id.includes("supermemory"))).toBe(false);
  });

  test("cambiar de Engram a Supermemory remueve Engram y prepara Supermemory", () => {
    let state = createDefaultPiRunnerDashboardState();
    state = reduce(state, { type: "select-adaptive-memory", provider: "engram" });
    state = reduce(state, { type: "enter-review", inventory }, piPlanBuilder);
    expect(allActionIds(state.plan).some((id) => id.includes("engram"))).toBe(true);

    state = reduce(state, { type: "back" });
    state = reduce(state, { type: "select-adaptive-memory", provider: "supermemory" });
    state = reduce(state, { type: "enter-review", inventory }, piPlanBuilder);

    const ids = allActionIds(state.plan);
    expect(state.adaptiveMemory.provider).toBe("supermemory");
    expect(state.adaptiveMemory.supermemory).toMatchObject({ configured: false, hasToken: false });
    expect(ids.some((id) => id.includes("engram"))).toBe(false);
    expect(ids.some((id) => id.includes("supermemory"))).toBe(true);
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