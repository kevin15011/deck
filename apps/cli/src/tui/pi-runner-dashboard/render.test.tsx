import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { PiRunnerDashboardScreens } from "../screens/pi-runner-dashboard-screens";
import { createDefaultPiRunnerDashboardState, type PiRunnerReviewPlan } from "./state";

/**
 * Pi Runner dashboard render tests.
 *
 * Changes from previous version (REQ-DASH-001, REQ-DASH-002):
 * - Tests for `runner-capabilities-detail` renamed to `packages-detail`.
 * - Tests for `runner-ui-visual-helpers-detail` removed (merged into Packages).
 * - runner-mermaid is NOT shown as mandatory/toggleable in Packages detail.
 * - Dashboard shows 4 sections: Packages, Adaptive Memory, Teams, Review & Install.
 * REQ-DASH-003: Visual support feedback appears only in Review, not as a selectable option.
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
    // REQ-DASH-002: Four sections: Packages, Adaptive Memory, Teams, Review & Install
    const state = createDefaultPiRunnerDashboardState({ plan });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Pi Runner Setup Dashboard");
    expect(output).toContain("Packages");
    expect(output).toContain("Adaptive Memory");
    expect(output).toContain("Teams");
    expect(output).toContain("Review & Install");
    // Fix #2: user-facing copy uses neutral language, no Mermaid terminology
    expect(output).toContain("Configure runner packages, Adaptive Memory, Teams and Review & Install.");
    expect(output).toContain("actions:");
  });

  test("Packages detail muestra configurables y NO Mermaid como obligatorio", () => {
    // REQ-DASH-001: runner-mermaid is NOT a selectable/configurable package
    // REQ-DASH-002: Runner Capabilities + visual helpers merged into Packages
    const state = createDefaultPiRunnerDashboardState({
      screen: "packages-detail",
      capabilityStatuses: {
        rtk: "manual",
        "context-mode": "missing",
        "codebase-memory": "manual",
        "pi-hud": "pending-source",
      },
      selectedCapabilities: { rtk: true, "context-mode": false, "codebase-memory": false },
    });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("[x] RTK");
    expect(output).toContain("[ ] context-mode");
    expect(output).toContain("[ ] codebase-memory");
    // Fix #2: Mermaid is not mentioned in Packages detail user-facing copy
    expect(output).not.toContain("Mermaid");
    expect(output).not.toContain("Mermaid: required/no toggleable");
    expect(output).not.toContain("Source: TBD");
    expect(output).not.toContain("paquete opcional");
  });

  test("Packages detail incluye pi-hud para Pi scope sin Mermaid como opción", () => {
    // REQ-DASH-001: pi-hud remains optional; runner-mermaid is not shown
    const state = createDefaultPiRunnerDashboardState({
      screen: "packages-detail",
      selectedCapabilities: { "pi-hud": true },
      capabilityStatuses: {
        "pi-hud": "pending-source",
      },
    });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Packages");
    expect(output).toContain("[x] pi-hud");
    expect(output).not.toContain("Mermaid required");
    expect(output).not.toContain("runner-mermaid");
  });

  test("Adaptive Memory muestra None/Engram/Supermemory single-choice con None default", () => {
    const state = createDefaultPiRunnerDashboardState({ screen: "adaptive-memory-detail" });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Single-choice");
    expect(output).toContain("(●) None");
    expect(output).toContain("( ) Engram");
    expect(output).toContain("( ) Supermemory");
    expect(output).toContain("Active provider: none");
    expect(output).toContain("No adaptive memory active by default");
  });

  test("Adaptive Memory/Supermemory renderiza estado no secreto y nunca token sentinela", () => {
    const tokenSentinel = "sk-sm-test-SHOULD-NOT-RENDER";
    const state = createDefaultPiRunnerDashboardState({
      screen: "adaptive-memory-detail",
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: {
          configured: false,
          hasToken: false,
          userId: "user-visible",
          diagnostics: [`token=${tokenSentinel}`],
        },
        status: "Supermemory selected; token [redacted].",
      },
    });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Active provider: supermemory");
    expect(output).toContain("user-visible");
    expect(output).toContain("token [redacted]");
    expect(output).not.toContain(tokenSentinel);
  });

  test("Teams muestra Developer Team y consumo de capabilities", () => {
    const state = createDefaultPiRunnerDashboardState({
      screen: "teams-detail",
      selectedCapabilities: {
        "context-mode": true,
        "codebase-memory": true,
        rtk: true,
        "pi-hud": false,
      },
      adaptiveMemory: { provider: "engram" },
      teams: {
        "developer-team": {
          teamId: "developer-team",
          label: "Developer Team",
          selected: true,
        },
      },
    });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("[x] Developer Team");
    expect(output).toContain("Open Developer Team detail");
    expect(output).toContain("Explicit consumption/compatibility");
    expect(output).toContain("codebase-memory: consumes-directly");
    expect(output).toContain("adaptive-memory: consumes-directly");
    // REQ-DASH-001: runner-mermaid no longer in capability profile
    expect(output).not.toContain("runner-mermaid: inherits-runner");
  });

  test("Review & Install agrupa acciones y muestra sección de visualización mínima", () => {
    // REQ-DASH-003: Visual support appears only as minimal feedback
    // REQ-DASH-004: Review distinguishes user selections from internal support
    const state = createDefaultPiRunnerDashboardState({ screen: "review-plan", plan });
    const output = renderToString(<PiRunnerDashboardScreens state={state} canRunPlan={false} runBlockDiagnostics={[{ message: "Supermemory config pending" }]} />);

    expect(output).toContain("Review & Install");
    expect(output).toContain("Automatic installs");
    expect(output).toContain("Manual / pending steps");
    expect(output).toContain("Config writes");
    expect(output).toContain("Team applications");
    expect(output).toContain("Validation");
    expect(output).toContain("manual · manual-external-install · Install RTK manually");
    expect(output).toContain("ready · apply-team-bundle · Apply Developer Team bundle");
    expect(output).toContain("Execution blocks");
    expect(output).toContain("Configure Supermemory before running");
    // REQ-DASH-003: No Mermaid pending-source in manual steps
    expect(output).not.toContain("pending · pending-source");
    expect(output).not.toContain("Resolve Mermaid");
  });

  test("Complete muestra mensajes y diagnósticos redactados sin filtrar token", () => {
    const tokenSentinel = "sk-sm-test-SHOULD-NOT-RENDER";
    const state = createDefaultPiRunnerDashboardState({ screen: "complete" });
    const output = renderToString(
      <PiRunnerDashboardScreens
        state={state}
        installResults={[
          {
            actionId: "adaptive-memory.supermemory.pi-mcp-config",
            status: "executed",
            message: `wrote token=${tokenSentinel}`,
            diagnostics: [`Bearer ${tokenSentinel}`],
          },
        ]}
      />,
    );

    expect(output).toContain("Runner setup complete");
    expect(output).toContain("adaptive-memory.supermemory.pi-mcp-config");
    expect(output).toContain("diagnostic:");
    expect(output).not.toContain(tokenSentinel);
    expect(output).toContain("[redacted]");
  });
});