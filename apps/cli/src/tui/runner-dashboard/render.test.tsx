import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { RunnerDashboardScreens, PiRunnerDashboardScreens } from "../screens/runner-dashboard-screens";
import { createDefaultPiRunnerDashboardState, type PiRunnerReviewPlan } from "./state";

/**
 * Pi Runner dashboard render tests.
 *
 * Dashboard sections (4): Packages, Adaptive Memory, Teams, Review & Install
 */
const plan: PiRunnerReviewPlan = {
  ready: false,
  diagnostics: [
    {
      code: "CAPABILITY_SOURCE_UNKNOWN",
      severity: "warning",
      message: "Some capability sources are pending.",
    },
  ],
  groups: {
    automaticInstalls: [
      {
        id: "prerequisite.sub-agents",
        kind: "install-pi-package",
        title: "Install sub-agents",
        status: "ready",
        toolId: "sub-agents",
        source: "npm:pi-subagents",
        required: true,
      },
    ],
    manualSteps: [
      {
        id: "capability.rtk.manual-install",
        kind: "manual-external-install",
        title: "Install RTK manually",
        status: "manual",
        capabilityId: "rtk",
        toolId: "rtk",
        source: "rtk-ai/rtk",
      },
    ],
    configWrites: [
      {
        id: "adaptive-memory.supermemory.deck-config",
        kind: "write-deck-config",
        title: "Write Supermemory non-secret Deck config",
        status: "pending",
        required: true,
      },
    ],
    teamApplications: [
      {
        id: "team.developer-team.apply",
        kind: "apply-team-bundle",
        title: "Apply Developer Team bundle",
        status: "ready",
      },
    ],
    validations: [
      {
        id: "validate.pi-runner-dashboard",
        kind: "validate",
        title: "Validate Pi Runner dashboard configuration",
        status: "ready",
      },
    ],
  },
};

describe("Pi Runner dashboard render", () => {
  test("dashboard principal muestra las cuatro secciones con estados y contadores", () => {
    const state = createDefaultPiRunnerDashboardState({ plan });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Pi Runner Setup Dashboard");
    expect(output).toContain("Packages");
    expect(output).toContain("Adaptive Memory");
    expect(output).toContain("Teams");
    expect(output).toContain("Review & Install");
    expect(output).toContain("Configure packages, Adaptive Memory, Teams and Review & Install.");
    expect(output).toContain("actions:");
  });

  test("Packages detail muestra packages sin resolver (cursor 0 = back)", () => {
    const state = createDefaultPiRunnerDashboardState({
      screen: "packages-detail",
      selectedCapabilities: { rtk: true, "context-mode": false, "codebase-memory": false },
    });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Packages");
    expect(output).toContain("Back to dashboard");
  });

  test("Adaptive Memory detail muestra None Engram Supermemory", () => {
    const state = createDefaultPiRunnerDashboardState({ screen: "adaptive-memory-detail" });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Adaptive Memory");
    expect(output).toContain("None");
    expect(output).toContain("Engram");
    expect(output).toContain("Supermemory");
    expect(output).toContain("Back to dashboard");
    expect(output).toContain("No adaptive memory active by default");
  });

  test("Teams detail muestra Developer Team y back", () => {
    const state = createDefaultPiRunnerDashboardState({
      screen: "teams-detail",
      teams: {
        "developer-team": {
          teamId: "developer-team",
          label: "Developer Team",
          selected: true,
        },
      },
    });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Teams");
    expect(output).toContain("[x] Developer Team");
    expect(output).toContain("Developer Team detail");
    expect(output).toContain("Back to dashboard");
  });

  test("Review & Install muestra conteos de acciones", () => {
    const state = createDefaultPiRunnerDashboardState({
      screen: "review-plan",
      plan,
    });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Review & Install");
    expect(output).toContain("5 actions planned");
    expect(output).toContain("1 automatic");
    expect(output).toContain("Run install");
  });

  test("Complete muestra pantalla de completado", () => {
    const state = createDefaultPiRunnerDashboardState({ screen: "complete" });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Pi Runner setup complete");
    expect(output).toContain("Press Enter to return to the home screen.");
  });
});