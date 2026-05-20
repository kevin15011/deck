import { describe, expect, test } from "bun:test";
import { buildDeveloperTeamInstallPlan, type DeveloperTeamModelAssignments, type DeveloperTeamThinkingAssignments } from "@deck/adapter-pi";
import { renderToString } from "ink";
import React from "react";
import {
  AgentModelConfigListScreen,
  DeveloperTeamReviewScreen,
  NoProvidersScreen,
} from "./developer-team-screens";

const orchestratorAssignments = { "deck-developer-orchestrator": "anthropic/claude-sonnet-4" };
const orchestratorThinking = { "deck-developer-orchestrator": "medium" as const };

describe("Developer Team screens dashboard context regression", () => {
  test("Home Configure models no muestra contexto del dashboard ni cambia opciones", () => {
    const output = renderToString(
      <AgentModelConfigListScreen
        cursor={0}
        modelAssignments={orchestratorAssignments}
        thinkingAssignments={orchestratorThinking}
      />,
    );

    expect(output).toContain("Select an agent to configure");
    expect(output).toContain("Orchestrator Agent");
    expect(output).toContain("anthropic/claude-sonnet-4 · thinking medium");
    expect(output).toContain("Finish configuration");
    expect(output).not.toContain("Dashboard context");
    expect(output).not.toContain("Adaptive Memory selected in dashboard");
  });

  test("Developer Team detail acepta contexto dashboard opcional sin cambiar provider/model/thinking", () => {
    const output = renderToString(
      <AgentModelConfigListScreen
        cursor={0}
        modelAssignments={orchestratorAssignments}
        thinkingAssignments={orchestratorThinking}
        dashboardContext={{
          source: "dashboard",
          adaptiveMemoryProvider: "supermemory",
          capabilityStatuses: { "runner-mermaid": "pending-source", rtk: "manual" },
          returnLabel: "Volver al dashboard",
        }}
      />,
    );

    expect(output).toContain("Dashboard context");
    expect(output).toContain("Adaptive Memory selected in dashboard: supermemory");
    expect(output).toContain("Capability states: runner-mermaid=pending-source, rtk=manual");
    expect(output).toContain("Model provider/model/thinking semantics are reused unchanged");
    expect(output).toContain("anthropic/claude-sonnet-4 · thinking medium");
    expect(output).toContain("Finish configuration");
    expect(output).toContain("Volver al dashboard");
  });

  test("dashboard context es aditivo: frontmatter de modelo/thinking coincide con ruta Home", () => {
    const modelAssignments: DeveloperTeamModelAssignments = {
      "deck-developer-orchestrator": "openai-codex/gpt-5.5",
      "deck-developer-apply-backend": "opencode-go/kimi-k2.6",
    };
    const thinkingAssignments: DeveloperTeamThinkingAssignments = {
      "deck-developer-orchestrator": "high",
      "deck-developer-apply-backend": "high",
    };

    const homePlan = buildDeveloperTeamInstallPlan("/tmp/project", { modelAssignments, thinkingAssignments });
    const dashboardPlan = buildDeveloperTeamInstallPlan("/tmp/project", { modelAssignments, thinkingAssignments });

    const homeAgents = Object.fromEntries(homePlan.agents.map((agent) => [agent.agent.id, agent.content]));
    const dashboardAgents = Object.fromEntries(dashboardPlan.agents.map((agent) => [agent.agent.id, agent.content]));

    expect(dashboardAgents["deck-developer-orchestrator"]).toBe(homeAgents["deck-developer-orchestrator"]);
    expect(dashboardAgents["deck-developer-orchestrator"]).toContain("model: openai-codex/gpt-5.5");
    expect(dashboardAgents["deck-developer-orchestrator"]).toContain("thinking: high");
    expect(dashboardAgents["deck-developer-apply-backend"]).toBe(homeAgents["deck-developer-apply-backend"]);
    expect(dashboardAgents["deck-developer-apply-backend"]).toContain("model: opencode-go/kimi-k2.6");
    expect(dashboardAgents["deck-developer-apply-backend"]).toContain("thinking: off");
  });

  test("DeveloperTeamReviewScreen preserva Home install/skip y solo agrega contexto cuando viene del dashboard", () => {
    const homeOutput = renderToString(<DeveloperTeamReviewScreen projectRoot="/tmp/project" cursor={0} />);

    expect(homeOutput).toContain("Install Developer Team now");
    expect(homeOutput).toContain("Skip Developer Team");
    expect(homeOutput).not.toContain("Dashboard context");

    const dashboardOutput = renderToString(
      <DeveloperTeamReviewScreen
        projectRoot="/tmp/project"
        cursor={1}
        dashboardContext={{
          source: "dashboard",
          adaptiveMemoryProvider: "engram",
          capabilityStatuses: { "context-mode": "ready" },
          returnLabel: "Volver a Teams",
        }}
      />,
    );

    expect(dashboardOutput).toContain("Install Developer Team now");
    expect(dashboardOutput).toContain("Volver a Teams");
    expect(dashboardOutput).toContain("Dashboard context");
    expect(dashboardOutput).toContain("Adaptive Memory selected in dashboard: engram");
    expect(dashboardOutput).toContain("Capability states: context-mode=ready");
  });

  test("NoProvidersScreen mantiene ruta Home sin contexto y muestra contexto dashboard solo si se pasa", () => {
    const homeOutput = renderToString(<NoProvidersScreen />);
    expect(homeOutput).toContain("No Pi providers detected");
    expect(homeOutput).toContain("Press Enter to skip model assignment");
    expect(homeOutput).not.toContain("Dashboard context");

    const dashboardOutput = renderToString(
      <NoProvidersScreen
        dashboardContext={{
          source: "dashboard",
          adaptiveMemoryProvider: "none",
          capabilityStatuses: { "runner-mermaid": "blocked" },
        }}
      />,
    );
    expect(dashboardOutput).toContain("No Pi providers detected");
    expect(dashboardOutput).toContain("Dashboard context");
    expect(dashboardOutput).toContain("Adaptive Memory selected in dashboard: none");
    expect(dashboardOutput).toContain("runner-mermaid=blocked");
  });
});
