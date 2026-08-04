import { describe, expect, test } from "bun:test";

import { runSerenaAdapterAction } from "./app";
import { runRunnerReviewPlan } from "./runner-dashboard/action-runner";
import { createDefaultRunnerDashboardState, type RunnerReviewPlan } from "./runner-dashboard/state";

describe("OpenCode Serena production bridge", () => {
  test("preserves already-present as reuse so the following MCP action runs", async () => {
    const operation = {
      runner: "opencode" as const,
      operationId: "opencode-serena-reuse",
      explicitlySelected: true,
    };
    const authorization = {
      kind: "interactive-tui-explicit-selection" as const,
      runner: "opencode" as const,
      operationId: operation.operationId,
    };
    const plan: RunnerReviewPlan = {
      ready: true,
      diagnostics: [],
      groups: {
        automaticInstalls: [{
          id: "capability.serena.install",
          kind: "install-opencode-plugin",
          title: "Validate Serena readiness",
          capabilityId: "serena",
          toolId: "serena",
          source: "serena-agent",
          status: "ready",
        }],
        manualSteps: [],
        configWrites: [{
          id: "capability.serena.mcp-config",
          kind: "write-mcp-config",
          title: "Configure Serena MCP",
          capabilityId: "serena",
          toolId: "serena",
          source: "serena-agent",
          status: "ready",
        }],
        teamApplications: [],
        validations: [],
      },
    };
    const state = createDefaultRunnerDashboardState({
      runnerScope: "opencode",
      selectedCapabilities: { serena: true },
      explicitlySelectedCapabilities: { serena: true },
      operationId: operation.operationId,
      currentOperation: operation,
      plan,
      planGeneratedForRevision: 0,
    });
    const calls: string[] = [];
    const adapter = {
      runAction: async (action: { id: string }) => {
        calls.push(action.id);
        if (action.id === "capability.serena.install") {
          return {
            actionId: action.id,
            status: "skipped" as const,
            message: "Serena is already present.",
            diagnostics: [],
            raw: { id: "serena", outcome: "already-present" },
          };
        }
        return {
          actionId: action.id,
          status: "executed" as const,
          message: "Serena MCP configuration updated.",
          diagnostics: [],
        };
      },
    };

    const results = await runRunnerReviewPlan(plan, {
      dashboardState: state,
      runnerId: "opencode",
      operationId: operation.operationId,
      currentOperation: operation,
      serenaAuthorization: authorization,
      runnerAction: (action, context) => runSerenaAdapterAction(
        adapter as never,
        action,
        context,
        state,
        "opencode",
      ),
    });

    expect(calls).toEqual([
      "capability.serena.install",
      "capability.serena.mcp-config",
    ]);
    expect(results.find((result) => result.actionId === "capability.serena.install")).toMatchObject({
      status: "skipped",
      serenaOutcome: "reused",
    });
    expect(results.find((result) => result.actionId === "capability.serena.mcp-config")?.status).toBe("executed");
  });
});
