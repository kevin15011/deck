import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { PiRunnerDashboardScreens } from "../screens/pi-runner-dashboard-screens";
import { createDefaultPiRunnerDashboardState, type PiRunnerReviewPlan } from "./state";

const plan: PiRunnerReviewPlan = {
  ready: false,
  diagnostics: [
    {
      code: "CAPABILITY_SOURCE_UNKNOWN",
      severity: "warning",
      message: "Mermaid is required; pi-mermaid implementation source is pending.",
      capabilityId: "runner-mermaid",
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
        id: "capability.runner-mermaid.pending-source",
        kind: "pending-source",
        title: "Resolve Mermaid runner implementation",
        status: "pending",
        capabilityId: "runner-mermaid",
        implementationId: "pi-mermaid",
        source: "TBD",
        required: true,
      },
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
        status: "blocked",
        unresolvedCapabilities: ["runner-mermaid"],
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
  test("dashboard principal muestra las cinco secciones con estados y contadores", () => {
    const state = createDefaultPiRunnerDashboardState({ plan });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Pi Runner Capability Dashboard");
    expect(output).toContain("Runner Capabilities globales");
    expect(output).toContain("Adaptive Memory global");
    expect(output).toContain("Runner UI / visual helpers");
    expect(output).toContain("Teams");
    expect(output).toContain("Review & Install");
    expect(output).toContain("acciones:");
    expect(output).toContain("manual");
    expect(output).toContain("pending");
  });

  test("Runner Capabilities muestra configurables y Mermaid obligatorio separado de pi-mermaid", () => {
    const state = createDefaultPiRunnerDashboardState({
      screen: "runner-capabilities-detail",
      capabilityStatuses: {
        rtk: "manual",
        "context-mode": "missing",
        "codebase-memory": "manual",
        "runner-mermaid": "pending-source",
      },
      selectedCapabilities: { rtk: true, "context-mode": false, "codebase-memory": false },
    });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("[x] RTK");
    expect(output).toContain("[ ] context-mode");
    expect(output).toContain("[ ] codebase-memory");
    expect(output).toContain("Mermaid: required/no toggleable");
    expect(output).toContain("implementación pi-mermaid");
    expect(output).toContain("Source: TBD");
    expect(output).toContain("paquete opcional");
    expect(output).toContain("manual");
    expect(output).toContain("missing");
    expect(output).toContain("pending-source");
  });

  test("Runner UI/visual helpers muestra pi-hud opcional Pi-only y Mermaid requerido", () => {
    const state = createDefaultPiRunnerDashboardState({
      screen: "runner-ui-visual-helpers-detail",
      selectedCapabilities: { "pi-hud": true },
      capabilityStatuses: {
        "pi-hud": "pending-source",
        "runner-mermaid": "pending-source",
      },
    });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Runner UI / visual helpers");
    expect(output).toContain("[x] pi-hud");
    expect(output).toContain("optional");
    expect(output).toContain("Pi-only");
    expect(output).toContain("Mermaid required/no toggleable");
    expect(output).toContain("Implementación Pi: pi-mermaid");
    expect(output).toContain("source TBD");
  });

  test("Adaptive Memory muestra None/Engram/Supermemory single-choice con None default", () => {
    const state = createDefaultPiRunnerDashboardState({ screen: "adaptive-memory-detail" });
    const output = renderToString(<PiRunnerDashboardScreens state={state} />);

    expect(output).toContain("Single-choice exacto");
    expect(output).toContain("(●) None");
    expect(output).toContain("( ) Engram");
    expect(output).toContain("( ) Supermemory");
    expect(output).toContain("Provider activo: none");
    expect(output).toContain("Sin memoria adaptativa activa por default");
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

    expect(output).toContain("Provider activo: supermemory");
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
    expect(output).toContain("Abrir Developer Team detail");
    expect(output).toContain("Consumo/compatibilidad explícita");
    expect(output).toContain("runner-mermaid: inherits-runner");
    expect(output).toContain("codebase-memory: consumes-directly");
    expect(output).toContain("adaptive-memory: consumes-directly");
  });

  test("Review & Install agrupa acciones y muestra manuales/pendientes como texto visible", () => {
    const state = createDefaultPiRunnerDashboardState({ screen: "review-plan", plan });
    const output = renderToString(<PiRunnerDashboardScreens state={state} canRunPlan={false} runBlockDiagnostics={[{ message: "Supermemory config pendiente" }]} />);

    expect(output).toContain("Review & Install");
    expect(output).toContain("Instalaciones automáticas");
    expect(output).toContain("Pasos manuales / pendientes");
    expect(output).toContain("Escritura de configuración");
    expect(output).toContain("Aplicación de team");
    expect(output).toContain("Validación");
    expect(output).toContain("pending · pending-source · Resolve Mermaid runner implementation (pi-mermaid)");
    expect(output).toContain("manual · manual-external-install · Install RTK manually");
    expect(output).toContain("blocked · apply-team-bundle · Apply Developer Team bundle");
    expect(output).toContain("Bloqueos de ejecución");
    expect(output).toContain("Supermemory config pendiente");
    expect(output).toContain("Configurar Supermemory antes de ejecutar");
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

    expect(output).toContain("Pi Runner dashboard complete");
    expect(output).toContain("adaptive-memory.supermemory.pi-mcp-config");
    expect(output).toContain("diagnóstico:");
    expect(output).not.toContain(tokenSentinel);
    expect(output).toContain("[redacted]");
  });

});
