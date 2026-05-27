import { describe, expect, test } from "bun:test";
import {
  buildDeveloperTeamInstallPlan,
  type DeveloperTeamInstallPlan,
  type DeveloperTeamModelAssignments,
  type DeveloperTeamThinkingAssignments,
} from "@deck/adapter-pi";
import { buildDashboardSupermemorySetupUpdate } from "../app";
import type { NormalizedDeckConfig } from "@deck/core/config/deck-config";
import {
  getPiRunnerReviewPlanRunBlockDiagnostics,
  runPiRunnerAction,
  runPiRunnerReviewPlan,
} from "./action-runner";
import { createDefaultPiRunnerDashboardState, type PiRunnerReviewPlan } from "./state";

const TOKEN_SENTINEL = "sk-sm-test-SHOULD-NOT-LEAK";

const supermemoryPlan: PiRunnerReviewPlan = {
  ready: true,
  diagnostics: [],
  groups: {
    automaticInstalls: [],
    manualSteps: [],
    configWrites: [
      {
        id: "adaptive-memory.supermemory.deck-config",
        kind: "write-deck-config",
        title: "Write Supermemory non-secret Deck config",
        status: "ready",
      },
      {
        id: "adaptive-memory.supermemory.pi-mcp-config",
        kind: "write-pi-mcp-config",
        title: "Write Supermemory Pi MCP credentials",
        status: "ready",
      },
    ],
    teamApplications: [],
    validations: [
      {
        id: "adaptive-memory.supermemory.validate",
        kind: "validate",
        title: "Validate Supermemory Pi MCP config",
        status: "ready",
      },
    ],
  },
};

describe("Pi Runner dashboard action runner Supermemory safety", () => {
  test("bloquea Review & Install cuando Supermemory no tiene configuración completa", async () => {
    const state = createDefaultPiRunnerDashboardState({
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: {
          configured: true,
          hasToken: true,
          diagnostics: [`token: ${TOKEN_SENTINEL}`],
        },
      },
    });

    const diagnostics = getPiRunnerReviewPlanRunBlockDiagnostics(state);
    expect(diagnostics.join(" ")).toContain("userId");
    expect(diagnostics.join(" ")).not.toContain(TOKEN_SENTINEL);

    const writes: NormalizedDeckConfig[] = [];
    const results = await runPiRunnerReviewPlan(supermemoryPlan, {
      projectRoot: "/tmp/project",
      dashboardState: state,
      supermemoryToken: TOKEN_SENTINEL,
      writeDeckConfig: (_root, config) => {
        writes.push(config as NormalizedDeckConfig);
        return config as NormalizedDeckConfig;
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ actionId: "review-plan.preflight", status: "failed" });
    expect(JSON.stringify(results)).not.toContain(TOKEN_SENTINEL);
    expect(writes).toHaveLength(0);
  });


  test("dashboard Supermemory setup stores only ephemeral/redacted state and does not call Pi MCP writer before Run", () => {
    const setup = buildDashboardSupermemorySetupUpdate({
      token: TOKEN_SENTINEL,
      userId: "user-1",
      teamId: "team-1",
      orgId: "org-1",
    });

    expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    expect(setup.values).toMatchObject({
      configured: true,
      hasToken: true,
      userId: "user-1",
      teamId: "team-1",
      organizationId: "org-1",
    });
    expect(JSON.stringify(setup)).not.toContain(TOKEN_SENTINEL);
    expect(setup.values.diagnostics.join(" ")).toContain("no Pi MCP config was written yet");
  });


  test("Review & Install usa salida real de setup Supermemory sin bloquear diagnóstico informativo", async () => {
    const setup = buildDashboardSupermemorySetupUpdate({
      token: TOKEN_SENTINEL,
      userId: "user-1",
      teamId: "team-1",
      orgId: "",
    });
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;

    const order: string[] = [];
    const provider = {
      id: "supermemory",
      displayName: "Supermemory",
      buildInjection: () => ({ instructions: [], toolBindings: [] }),
    };
    const state = createDefaultPiRunnerDashboardState({
      adaptiveMemory: { provider: "supermemory", supermemory: setup.values },
      teams: {
        "developer-team": { teamId: "developer-team", label: "Developer Team", selected: true },
      },
    });
    const planWithTeam: PiRunnerReviewPlan = {
      ...supermemoryPlan,
      groups: {
        ...supermemoryPlan.groups,
        teamApplications: [
          {
            id: "teams.developer-team.apply",
            kind: "apply-team-bundle",
            title: "Apply Developer Team bundle",
            status: "ready",
          },
        ],
      },
    };
    let teamMemoryProvider: unknown;

    const results = await runPiRunnerReviewPlan(planWithTeam, {
      projectRoot: "/tmp/project",
      dashboardState: state,
      supermemoryToken: TOKEN_SENTINEL,
      writeDeckConfig: (_root, config) => {
        order.push("write-deck-config");
        return config as NormalizedDeckConfig;
      },
      writeSupermemoryPiMcpConfig: ({ token }) => {
        order.push("write-pi-mcp-config");
        expect(token).toBe(TOKEN_SENTINEL);
        return { ok: true, action: "updated", path: "/tmp/mcp.json", serverName: "supermemory", diagnostics: [] } as never;
      },
      resolveAdaptiveMemoryProvider: () => {
        order.push("resolve-provider");
        return { provider, diagnostics: [] } as never;
      },
      buildDeveloperTeamInstallPlan: (projectRoot, options) => {
        order.push("build-team-plan");
        teamMemoryProvider = options?.memoryProvider;
        return buildDeveloperTeamInstallPlan(projectRoot, options);
      },
      applyDeveloperTeamInstall: () => {
        order.push("apply-team-bundle");
        return { results: [] } as never;
      },
      validateSupermemoryPiMcpConfig: () => {
        order.push("validate");
        return { ok: true, path: "/tmp/mcp.json", serverName: "supermemory", diagnostics: [] } as never;
      },
    });

    expect(results.map((result) => result.actionId)).toContain("adaptive-memory.supermemory.pi-mcp-config");
    expect(results.map((result) => result.actionId)).toContain("teams.developer-team.apply");
    expect(order).toEqual(["write-deck-config", "write-pi-mcp-config", "resolve-provider", "build-team-plan", "apply-team-bundle", "validate"]);
    expect(teamMemoryProvider).toBe(provider);
    expect(JSON.stringify(results)).not.toContain(TOKEN_SENTINEL);
  });

  test("bloquea Run cuando hasToken quedó true pero falta token efímero real", async () => {
    const state = createDefaultPiRunnerDashboardState({
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: true, userId: "user-1", diagnostics: [] },
      },
    });
    const writes: string[] = [];

    const results = await runPiRunnerReviewPlan(supermemoryPlan, {
      projectRoot: "/tmp/project",
      dashboardState: state,
      writeDeckConfig: (_root, config) => {
        writes.push("deck");
        return config as NormalizedDeckConfig;
      },
      writeSupermemoryPiMcpConfig: () => {
        writes.push("mcp");
        return { ok: true, action: "updated", path: "/tmp/mcp.json", serverName: "supermemory", diagnostics: [] } as never;
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ actionId: "review-plan.preflight", status: "failed" });
    expect(results[0]?.diagnostics.join(" ")).toContain("ephemeral credential is no longer available");
    expect(writes).toEqual([]);
  });

  test("write-pi-mcp-config sin token falla para handoff Supermemory requerido", async () => {
    const result = await runPiRunnerAction(supermemoryPlan.groups.configWrites[1], {});
    expect(result).toMatchObject({
      actionId: "adaptive-memory.supermemory.pi-mcp-config",
      status: "failed",
    });
  });

  test("redacta token Supermemory standalone sk-sm en action-runner", async () => {
    const result = await runPiRunnerAction(
      {
        id: "adaptive-memory.supermemory.validate",
        kind: "validate",
        title: "Validate Supermemory Pi MCP config",
        status: "ready",
        diagnostics: [`external diagnostic ${TOKEN_SENTINEL}`],
      },
      {
        validateSupermemoryPiMcpConfig: () => ({
          ok: false,
          path: "/tmp/mcp.json",
          serverName: "supermemory",
          diagnostics: [{ code: "TOKEN_ECHO", severity: "error", message: `standalone ${TOKEN_SENTINEL}` }],
        } as never),
      },
    );

    expect(JSON.stringify(result)).not.toContain(TOKEN_SENTINEL);
    expect(JSON.stringify(result)).toContain("[REDACTED]");
  });

  test("Review & Install writes Pi MCP config before resolving provider and applying Developer Team", async () => {
    const order: string[] = [];
    const provider = {
      id: "supermemory",
      displayName: "Supermemory",
      buildInjection: () => ({ instructions: [], toolBindings: [] }),
    };
    const state = createDefaultPiRunnerDashboardState({
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: true, userId: "user-1", diagnostics: [] },
      },
      teams: {
        "developer-team": { teamId: "developer-team", label: "Developer Team", selected: true },
      },
    });
    const planWithTeam: PiRunnerReviewPlan = {
      ...supermemoryPlan,
      groups: {
        ...supermemoryPlan.groups,
        teamApplications: [
          {
            id: "teams.developer-team.apply",
            kind: "apply-team-bundle",
            title: "Apply Developer Team bundle",
            status: "ready",
          },
        ],
      },
    };
    let teamMemoryProvider: unknown;

    const results = await runPiRunnerReviewPlan(planWithTeam, {
      projectRoot: "/tmp/project",
      dashboardState: state,
      supermemoryToken: TOKEN_SENTINEL,
      writeDeckConfig: (_root, config) => {
        order.push("write-deck-config");
        expect(JSON.stringify(config)).not.toContain(TOKEN_SENTINEL);
        return config as NormalizedDeckConfig;
      },
      writeSupermemoryPiMcpConfig: ({ token }) => {
        order.push("write-pi-mcp-config");
        expect(token).toBe(TOKEN_SENTINEL);
        return { ok: true, action: "updated", path: "/tmp/mcp.json", serverName: "supermemory", diagnostics: [] } as never;
      },
      resolveAdaptiveMemoryProvider: () => {
        order.push("resolve-provider");
        return { provider, diagnostics: [] } as never;
      },
      buildDeveloperTeamInstallPlan: (projectRoot, options) => {
        order.push("build-team-plan");
        teamMemoryProvider = options?.memoryProvider;
        return buildDeveloperTeamInstallPlan(projectRoot, options);
      },
      applyDeveloperTeamInstall: (installPlan) => {
        order.push("apply-team-bundle");
        return { results: [] } as never;
      },
      validateSupermemoryPiMcpConfig: () => {
        order.push("validate");
        return { ok: true, path: "/tmp/mcp.json", serverName: "supermemory", diagnostics: [] } as never;
      },
    });

    expect(results.map((result) => result.actionId)).toContain("teams.developer-team.apply");
    expect(order).toEqual(["write-deck-config", "write-pi-mcp-config", "resolve-provider", "build-team-plan", "apply-team-bundle", "validate"]);
    expect(teamMemoryProvider).toBe(provider);
    expect(JSON.stringify(results)).not.toContain(TOKEN_SENTINEL);
  });

  test("redacta token sentinela en resultados raw/diagnostics y escribe solo config no secreta", async () => {
    const state = createDefaultPiRunnerDashboardState({
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: {
          configured: true,
          hasToken: true,
          userId: "user-1",
          teamId: "team-1",
          diagnostics: [],
        },
      },
    });

    const deckResult = await runPiRunnerAction(supermemoryPlan.groups.configWrites[0], {
      projectRoot: "/tmp/project",
      dashboardState: state,
      supermemoryToken: TOKEN_SENTINEL,
      writeDeckConfig: (_root, config) => config as NormalizedDeckConfig,
    });
    expect(JSON.stringify(deckResult)).not.toContain(TOKEN_SENTINEL);
    expect(deckResult.raw).toMatchObject({
      adaptiveMemory: {
        activeProvider: "supermemory",
        supermemory: { userId: "user-1", teamId: "team-1" },
      },
    });

    const mcpResult = await runPiRunnerAction(supermemoryPlan.groups.configWrites[1], {
      supermemoryToken: TOKEN_SENTINEL,
      writeSupermemoryPiMcpConfig: ({ token }) => ({
        ok: true,
        action: "updated",
        path: "/home/pi/.pi/agent/mcp.json",
        serverName: "supermemory",
        diagnostics: [
          {
            code: "PI_MCP_CONFIG_UPDATED",
            severity: "info",
            message: `wrote x-supermemory-api-key: ${token}`,
          },
        ],
        tokenEcho: token,
      } as never),
    });

    expect(JSON.stringify(mcpResult)).not.toContain(TOKEN_SENTINEL);
    expect(JSON.stringify(mcpResult)).toContain("[REDACTED]");
  });
});


describe("Pi Runner dashboard action runner Developer Team model preservation", () => {
  function frontmatterFor(plan: DeveloperTeamInstallPlan, agentId: string): string {
    const agent = plan.agents.find((entry) => entry.agent.id === agentId);
    expect(agent).toBeTruthy();
    return agent!.content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  }

  test("apply-team-bundle usa assignments del dashboard y preserva frontmatter observable de Configure Models", async () => {
    const modelAssignments: DeveloperTeamModelAssignments = {
      "deck-developer-orchestrator": "openai-codex/gpt-5.5",
      "deck-developer-apply-backend": "opencode-go/kimi-k2.6",
    };
    const thinkingAssignments: DeveloperTeamThinkingAssignments = {
      "deck-developer-orchestrator": "high",
      "deck-developer-apply-backend": "high",
    };
    const dashboardState = createDefaultPiRunnerDashboardState({
      teams: {
        "developer-team": {
          teamId: "developer-team",
          label: "Developer Team",
          selected: true,
          modelAssignments,
          thinkingAssignments,
        },
      },
    });
    const homeConfigureModelsPlan = buildDeveloperTeamInstallPlan("/tmp/project", {
      modelAssignments,
      thinkingAssignments,
    });
    let dashboardPlan: DeveloperTeamInstallPlan | undefined;

    const result = await runPiRunnerAction(
      {
        id: "teams.developer-team.apply",
        kind: "apply-team-bundle",
        title: "Apply Developer Team bundle",
        status: "ready",
      },
      {
        projectRoot: "/tmp/project",
        dashboardState,
        buildDeveloperTeamInstallPlan: (projectRoot, options) => {
          dashboardPlan = buildDeveloperTeamInstallPlan(projectRoot, options);
          return dashboardPlan;
        },
        applyDeveloperTeamInstall: (plan) => {
          dashboardPlan = plan as unknown as DeveloperTeamInstallPlan;
          return { results: [] } as never;
        },
      },
    );

    expect(result).toMatchObject({ actionId: "teams.developer-team.apply", status: "executed" });
    expect(dashboardPlan).toBeDefined();
    expect(frontmatterFor(dashboardPlan!, "deck-developer-orchestrator")).toBe(
      frontmatterFor(homeConfigureModelsPlan, "deck-developer-orchestrator"),
    );
    expect(frontmatterFor(dashboardPlan!, "deck-developer-apply-backend")).toBe(
      frontmatterFor(homeConfigureModelsPlan, "deck-developer-apply-backend"),
    );
    expect(frontmatterFor(dashboardPlan!, "deck-developer-orchestrator")).toContain("model: openai-codex/gpt-5.5");
    expect(frontmatterFor(dashboardPlan!, "deck-developer-orchestrator")).toContain("thinking: high");
    expect(frontmatterFor(dashboardPlan!, "deck-developer-apply-backend")).toContain("model: opencode-go/kimi-k2.6");
    expect(frontmatterFor(dashboardPlan!, "deck-developer-apply-backend")).not.toContain("thinking:");
  });
});

// ---------------------------------------------------------------------------
// Fix #1: Internal package install action routing
// Tests that missing pi-mermaid plan/action is executed via installInternalRunnerPackages()
// and preserves visual_support_install_failed on failure.
// ---------------------------------------------------------------------------

describe("Fix #1: internal package install action routing", () => {
  /**
   * Test that an action-runner action with internalPackageId invokes
   * installInternalRunnerPackages() (not buildInstallableTool()) and that
   * the pi install npm:pi-mermaid command is correctly dispatched.
   */
  test("missing pi-mermaid plan action executes pi install npm:pi-mermaid via installInternalRunnerPackages", async () => {
    const calls: string[][] = [];

    const result = await runPiRunnerAction(
      {
        id: "internal.pi-mermaid.install",
        kind: "install-pi-package",
        title: "Install visual explanation support",
        internalPackageId: "pi-mermaid",
        source: "npm:pi-mermaid",
        status: "ready",
      },
      {
        piCommand: "pi",
        installInternalRunnerPackages: (command, actions, onResult) => {
          return Promise.resolve(
            actions.map((action) => {
              calls.push([command!, "install", action.source]);
              const success = command === "pi" && action.source === "npm:pi-mermaid";
              const installResult = {
                packageId: action.packageId,
                success,
                actionKind: "install-pi-package" as const,
                status: success ? "installed" as const : "failed" as const,
                errorCode: success ? undefined : "visual_support_install_failed",
              };
              onResult(installResult);
              return installResult;
            }),
          );
        },
      },
    );

    // Verify the command was dispatched correctly
    expect(calls).toEqual([["pi", "install", "npm:pi-mermaid"]]);

    // Verify execution result
    expect(result).toMatchObject({
      actionId: "internal.pi-mermaid.install",
      status: "executed",
    });
    expect(result.message).toBe("Installed visual explanation support.");
  });

  /**
   * Test that a failing internal package install surfaces the correct error code.
   * REQ-PIINSTALL-004: install failures surface visual_support_install_failed.
   */
  test("missing pi-mermaid install failure surfaces visual_support_install_failed error code", async () => {
    const result = await runPiRunnerAction(
      {
        id: "internal.pi-mermaid.install",
        kind: "install-pi-package",
        title: "Install visual explanation support",
        internalPackageId: "pi-mermaid",
        source: "npm:pi-mermaid",
        status: "ready",
      },
      {
        piCommand: "pi",
        installInternalRunnerPackages: (_command, actions, onResult) => {
          return Promise.resolve(
            actions.map((action) => {
              const installResult = {
                packageId: action.packageId,
                success: false,
                actionKind: "install-pi-package" as const,
                status: "failed" as const,
                message: "npm error E404: package not found",
                errorCode: "visual_support_install_failed",
              };
              onResult(installResult);
              return installResult;
            }),
          );
        },
      },
    );

    expect(result).toMatchObject({
      actionId: "internal.pi-mermaid.install",
      status: "failed",
    });
    expect(result.message).toBe("Visual explanation support install failed.");
    expect(result.diagnostics.some(d => d.includes("npm error E404") || d.includes("unavailable"))).toBe(true);
  });

  /**
   * Test that missing pi-mermaid install with no piCommand still reports failure gracefully.
   */
  test("missing pi-mermaid install with no piCommand reports failure gracefully", async () => {
    const result = await runPiRunnerAction(
      {
        id: "internal.pi-mermaid.install",
        kind: "install-pi-package",
        title: "Install visual explanation support",
        internalPackageId: "pi-mermaid",
        source: "npm:pi-mermaid",
        status: "ready",
      },
      {
        piCommand: undefined,
        installInternalRunnerPackages: (command, _actions, onResult) => {
          // Like the real implementation: when piCommand is unavailable, return
          // a failed result and invoke the callback
          const installResult = {
            packageId: "pi-mermaid",
            success: false,
            actionKind: "install-pi-package" as const,
            status: "failed" as const,
            message: command ? "pi install failed" : "Pi install command is unavailable.",
            errorCode: "visual_support_install_failed",
          };
          onResult(installResult);
          return Promise.resolve([installResult]);
        },
      },
    );

    expect(result).toMatchObject({
      actionId: "internal.pi-mermaid.install",
      status: "failed",
    });
    // The mock returns a result with the "Pi install command is unavailable." message
    expect(result.message).toBe("Visual explanation support install failed.");
  });
});
