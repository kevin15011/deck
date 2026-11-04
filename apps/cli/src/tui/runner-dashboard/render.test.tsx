import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { RunnerDashboardScreens, PiRunnerDashboardScreens } from "../screens/runner-dashboard-screens";
import { createDefaultPiRunnerDashboardState, type PiRunnerReviewPlan } from "./state";

/**
 * Pi Runner dashboard render tests.
 *
 * Dashboard sections (4): Packages, Web Search, Teams, Review & Install
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
        id: "package-instructions.pi.deck-config",
        kind: "write-deck-config",
        title: "Write package preferences",
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
  });

  test("OpenCode runner muestra OpenCode Runner Setup Dashboard", () => {
    const state = createDefaultPiRunnerDashboardState({ plan, runnerScope: "opencode", runnerDisplayName: "OpenCode" });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("OpenCode Runner Setup Dashboard");
    expect(output).toContain("Packages");
    expect(output).toContain("Web Search");
    expect(output).toContain("Teams");
    expect(output).toContain("Review & Install");
    expect(output).toContain("Configure Packages, Web Search, Teams and Review & Install.");
    expect(output).toContain("actions:");
  });

  test("Web Search detail exposes provider, credential, runner MCP conflict, and readiness without a secret", () => {
    const state = createDefaultPiRunnerDashboardState({
      screen: "web-search-detail",
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
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Web Search");
    expect(output).toContain("Provider: Tavily");
    expect(output).toContain("Credential: missing");
    expect(output).toContain("Runner support: supported");
    expect(output).toContain("MCP materialization: not configured");
    expect(output).toContain("Readiness: enabled-unconfigured");
    expect(output).toContain("does not delete a saved shell-profile credential");
  });

  test("Packages detail muestra packages sin resolver (cursor 0 = back)", () => {
    const state = createDefaultPiRunnerDashboardState({
      screen: "packages-detail",
      selectedCapabilities: { rtk: true, "context-mode": false, "codebase-memory": false },
    });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Package instructions");
    expect(output).toContain("Back to dashboard");
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
    expect(output).toContain("Blocked");
  });

  test("Complete muestra pantalla de completado", () => {
    const state = createDefaultPiRunnerDashboardState({ screen: "complete" });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Pi Runner setup complete");
    expect(output).toContain("Press Enter to return to the home screen.");
  });

  test("completion retains long MCP conflict remediation and still redacts secrets", () => {
    const state = createDefaultPiRunnerDashboardState({ screen: "complete" });
    const message = `Runner installation is blocked. ${"Existing MCP configuration differs. ".repeat(9)} Back up config.toml and align the selected tool. token=private-value`;
    const output = renderToString(<RunnerDashboardScreens state={state} installResults={[{ actionId: "codex-developer-team", status: "failed", message, diagnostics: [] }]} />);
    expect(output.replace(/\s+/g, " ")).toContain("Back up config.toml and align the selected tool.");
    expect(output).not.toContain("private-value");
  });
});
