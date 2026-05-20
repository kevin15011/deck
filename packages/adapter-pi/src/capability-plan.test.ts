import { describe, expect, test } from "bun:test";

import { buildPiRunnerCapabilityInventory, type PiRunnerCapabilityInventory } from "./capability-inventory";
import { buildPiRunnerReviewPlan, type PiRunnerReviewPlan } from "./capability-plan";
import { buildDeveloperTeamInstallPlan } from "./developer-team-install";
import type { PiRequiredToolsReview } from "./required-tools";
import { createToolStatus } from "./tool-status";

function review(installedPackages: string[] = []): PiRequiredToolsReview {
  const requiredNames = ["sub-agents", "MCP packages", "context-mode", "codebase-memory", "RTK", "Context7", "Engram memory"];
  return {
    installedPackages,
    requiredTools: requiredNames.map((name) => ({ name, installed: installedPackages.some((pkg) => normalize(pkg) === normalize(name)) })),
    tools: requiredNames.map((name) => {
      const installed = installedPackages.some((pkg) => normalize(pkg) === normalize(name));
      return createToolStatus(name, installed ? "found" : "missing", installed ? "configured" : "missing");
    }),
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function baseState(overrides: Parameters<typeof buildPiRunnerReviewPlan>[0] = {}): Parameters<typeof buildPiRunnerReviewPlan>[0] {
  return {
    runnerScope: "pi",
    selectedCapabilities: {},
    adaptiveMemory: { provider: "none" },
    teams: {},
    runtime: { toolsReview: review(["sub-agents", "MCP packages"]) },
    ...overrides,
  };
}

function allActions(plan: PiRunnerReviewPlan) {
  return Object.values(plan.groups).flat();
}

function actionText(plan: PiRunnerReviewPlan): string {
  return JSON.stringify({ groups: plan.groups, diagnostics: plan.diagnostics });
}

describe("buildPiRunnerReviewPlan", () => {
  test("Adaptive Memory none generates no Engram or Supermemory actions", () => {
    const inventory = buildPiRunnerCapabilityInventory(review(["sub-agents", "MCP packages"]), undefined, { runnerScope: "pi" });
    const plan = buildPiRunnerReviewPlan(baseState(), inventory);
    const text = actionText(plan).toLowerCase();

    expect(text).not.toContain("engram");
    expect(text).not.toContain("supermemory");
  });

  test("Adaptive Memory Engram conditionally adds only Engram manual action when missing", () => {
    const toolsReview = review(["sub-agents", "MCP packages"]);
    const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
    const plan = buildPiRunnerReviewPlan(baseState({ adaptiveMemory: { provider: "engram" }, runtime: { toolsReview } }), inventory);

    expect(plan.groups.manualSteps.some((action) => action.toolId === "engram-memory" && action.kind === "manual-external-install")).toBe(true);
    expect(actionText(plan).toLowerCase()).not.toContain("supermemory");
    expect(plan.ready).toBe(false);
  });

  test("Adaptive Memory Supermemory adds config writes and validation without package install", () => {
    const toolsReview = review(["sub-agents", "MCP packages"]);
    const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
    const plan = buildPiRunnerReviewPlan(
      baseState({
        adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: true, userId: "user-1" } },
        runtime: { toolsReview },
      }),
      inventory,
    );

    expect([...plan.groups.configWrites.map((action) => action.kind)].sort()).toEqual(["write-deck-config", "write-pi-mcp-config"]);
    expect(plan.groups.validations.some((action) => action.id === "adaptive-memory.supermemory.validate")).toBe(true);
    expect(allActions(plan).some((action) => action.toolId === "engram-memory")).toBe(false);
    expect(allActions(plan).filter((action) => action.title.toLowerCase().includes("supermemory")).every((action) => action.kind !== "install-pi-package")).toBe(true);
  });

  test("switching from Engram to Supermemory removes Engram and adds Supermemory", () => {
    const toolsReview = review(["sub-agents", "MCP packages"]);
    const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
    const engramPlan = buildPiRunnerReviewPlan(baseState({ adaptiveMemory: { provider: "engram" }, runtime: { toolsReview } }), inventory);
    const supermemoryPlan = buildPiRunnerReviewPlan(
      baseState({ adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: true } }, runtime: { toolsReview } }),
      inventory,
    );

    expect(actionText(engramPlan).toLowerCase()).toContain("engram");
    expect(actionText(supermemoryPlan).toLowerCase()).not.toContain("engram");
    expect(actionText(supermemoryPlan).toLowerCase()).toContain("supermemory");
  });

  test("selected capabilities map ready, manual, pending, and automatic install actions into readiness", () => {
    const toolsReview = review(["sub-agents", "MCP packages", "context-mode"]);
    const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
    const plan = buildPiRunnerReviewPlan(
      baseState({
        selectedCapabilities: { "context-mode": true, rtk: true, "codebase-memory": true, "pi-hud": true },
        runtime: { toolsReview },
      }),
      inventory,
    );

    expect(plan.groups.automaticInstalls.some((action) => action.capabilityId === "context-mode")).toBe(false);
    expect(plan.groups.manualSteps.some((action) => action.capabilityId === "rtk" && action.status === "manual")).toBe(true);
    expect(plan.groups.manualSteps.some((action) => action.capabilityId === "codebase-memory" && action.status === "manual")).toBe(true);
    expect(plan.groups.manualSteps.some((action) => action.capabilityId === "pi-hud" && action.status === "pending")).toBe(true);
    expect(plan.ready).toBe(false);
  });

  test("missing selected pi-package capability becomes automatic install", () => {
    const toolsReview = review(["sub-agents", "MCP packages"]);
    const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
    const plan = buildPiRunnerReviewPlan(baseState({ selectedCapabilities: { "context-mode": true }, runtime: { toolsReview } }), inventory);

    expect(plan.groups.automaticInstalls).toContainEqual(
      expect.objectContaining({ capabilityId: "context-mode", toolId: "context-mode", kind: "install-pi-package", status: "ready" }),
    );
  });

  test("plan includes prerequisite automatic installs when sub-agents and MCP packages are missing", () => {
    const toolsReview = review([]);
    const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
    const plan = buildPiRunnerReviewPlan(baseState({ runtime: { toolsReview } }), inventory);

    expect(plan.groups.automaticInstalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolId: "sub-agents", source: "npm:pi-subagents" }),
        expect.objectContaining({ toolId: "mcp-packages", source: "npm:pi-mcp-adapter" }),
      ]),
    );
  });

  test("dashboard plan excludes rpiv todo, ask-user-question, and context7 regressions", () => {
    const toolsReview = review(["sub-agents", "MCP packages", "context7"]);
    const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
    const plan = buildPiRunnerReviewPlan(
      baseState({
        selectedCapabilities: { "context-mode": true, rtk: true, "codebase-memory": true, "pi-hud": true },
        adaptiveMemory: { provider: "none" },
        runtime: { toolsReview },
      }),
      inventory,
    );
    const text = actionText(plan).toLowerCase();

    expect(text).not.toContain("rpiv-todo");
    expect(text).not.toContain("rpiv-ask-user-question");
    expect(text).not.toContain("context7");
    expect(text).not.toContain("engram");
    expect(text).not.toContain("supermemory");
  });
});

// ---------------------------------------------------------------------------
// Task 5: Silent internal visual support — capability-plan
// REQ-PIINSTALL-001, REQ-PIINSTALL-002, REQ-PIINSTALL-003
// Replaces runner-mermaid manual pending-source flow with automatic silent
// internal support via pi-mermaid internal runner packages.
// ---------------------------------------------------------------------------

describe("Task 5: silent internal visual support", () => {
  describe("missing pi-mermaid", () => {
    test("generates automatic silent install action titled 'Install visual explanation support'", () => {
      const toolsReview = review(["sub-agents", "MCP packages"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
      const plan = buildPiRunnerReviewPlan(baseState({ runtime: { toolsReview } }), inventory);

      const visualAction = plan.groups.automaticInstalls.find(
        (action) => action.title === "Install visual explanation support",
      );

      expect(visualAction).toBeDefined();
      expect(visualAction?.kind).toBe("install-pi-package");
      expect(visualAction?.toolId).toBeUndefined();  // pi-mermaid is internal, not in PI_INSTALLABLE_TOOLS
      expect(visualAction?.source).toBe("npm:pi-mermaid");
      expect(visualAction?.status).toBe("ready");
      expect(visualAction?.required).toBe(true);
    });

    test("does not add manual pending-source action for runner-mermaid", () => {
      const toolsReview = review(["sub-agents", "MCP packages"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
      const plan = buildPiRunnerReviewPlan(baseState({ runtime: { toolsReview } }), inventory);

      const manualMermaid = plan.groups.manualSteps.filter(
        (action) => action.capabilityId === "runner-mermaid",
      );
      expect(manualMermaid).toHaveLength(0);
    });

    test("does not add validation action when pi-mermaid is missing", () => {
      const toolsReview = review(["sub-agents", "MCP packages"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
      const plan = buildPiRunnerReviewPlan(baseState({ runtime: { toolsReview } }), inventory);

      const validateAction = plan.groups.validations.find(
        (action) => action.id === "capability.runner-mermaid.validate",
      );
      expect(validateAction).toBeUndefined();
    });

    test("plan is not blocked by missing pi-mermaid (automatic install resolves it)", () => {
      const toolsReview = review(["sub-agents", "MCP packages"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
      const plan = buildPiRunnerReviewPlan(baseState({ runtime: { toolsReview } }), inventory);

      const hasPendingBlock = [...plan.groups.manualSteps, ...plan.groups.validations].some(
        (action) =>
          action.status === "pending" ||
          action.status === "blocked" ||
          action.kind === "pending-source",
      );

      expect(hasPendingBlock).toBe(false);
      expect(plan.ready).toBe(true);
    });
  });

  describe("present pi-mermaid (ready)", () => {
    test("generates validation/ready feedback only — no automatic install action", () => {
      const toolsReview = review(["sub-agents", "MCP packages", "pi-mermaid"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
      const plan = buildPiRunnerReviewPlan(baseState({ runtime: { toolsReview } }), inventory);

      const visualAction = plan.groups.automaticInstalls.find(
        (action) => action.title === "Install visual explanation support",
      );
      expect(visualAction).toBeUndefined();

      const validateAction = plan.groups.validations.find(
        (action) => action.id === "capability.runner-mermaid.validate",
      );
      expect(validateAction).toBeDefined();
      expect(validateAction?.status).toBe("ready");
      // Fix #2: implementationId is intentionally omitted for internal actions in user-facing output
      expect(validateAction?.implementationId).toBeUndefined();
    });
    // Fix #2: User-facing title uses neutral visual explanation language; implementationId hidden
    test("validation action has correct metadata (Fix #2: neutral title, no implementationId)", () => {
      const toolsReview = review(["sub-agents", "MCP packages", "pi-mermaid"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
      const plan = buildPiRunnerReviewPlan(baseState({ runtime: { toolsReview } }), inventory);

      const validateAction = plan.groups.validations.find(
        (action) => action.id === "capability.runner-mermaid.validate",
      );

      // Fix #2: User-facing title uses neutral visual explanation language
      expect(validateAction?.title).toBe("Validate visual explanation support");
      // Fix #2: description uses neutral language
      expect(validateAction?.description).toBe("Visual explanation support is required and already satisfied.");
      // capabilityId and source remain for internal tracking; implementationId hidden per Fix #2
      expect(validateAction).toEqual(expect.objectContaining({
        id: "capability.runner-mermaid.validate",
        kind: "validate",
        capabilityId: "runner-mermaid",
        source: "npm:pi-mermaid",
        status: "ready",
        required: true,
      }));
      expect(validateAction?.implementationId).toBeUndefined();
    });
    test("Developer Team application is NOT blocked by missing pi-mermaid visual support", () => {
      const toolsReview = review(["sub-agents", "MCP packages"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
      const plan = buildPiRunnerReviewPlan(
        baseState({
          teams: { "developer-team": { selected: true } },
          runtime: { toolsReview },
        }),
        inventory,
      );

      const teamAction = plan.groups.teamApplications.find(
        (action) => action.id === "team.developer-team.apply",
      );

      expect(teamAction).toBeDefined();
      // REQ-TEAMINSTALL-003: Developer Team must not be blocked by visual support status.
      // With no unresolved user-facing required capabilities, team is ready.
      expect(teamAction?.status).toBe("ready");
      expect(teamAction?.unresolvedCapabilities).toHaveLength(0);
    });

    test("Developer Team is ready when all user-facing required capabilities are ready", () => {
      const toolsReview = review(["sub-agents", "MCP packages"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
      const plan = buildPiRunnerReviewPlan(
        baseState({
          teams: { "developer-team": { selected: true } },
          runtime: { toolsReview },
        }),
        inventory,
      );

      expect(plan.groups.teamApplications).toContainEqual(
        expect.objectContaining({ id: "team.developer-team.apply", status: "ready" }),
      );
      expect(plan.ready).toBe(true);
    });

    test("Developer Team unresolvedCapabilities does not include runner-mermaid", () => {
      const toolsReview = review(["sub-agents", "MCP packages"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
      const plan = buildPiRunnerReviewPlan(
        baseState({
          teams: { "developer-team": { selected: true } },
          runtime: { toolsReview },
        }),
        inventory,
      );

      const teamAction = plan.groups.teamApplications.find(
        (action) => action.id === "team.developer-team.apply",
      );

      expect(teamAction?.unresolvedCapabilities ?? []).not.toContain("runner-mermaid");
    });

    test("Developer Team dependencies no longer reference runner-mermaid", () => {
      const toolsReview = review(["sub-agents", "MCP packages"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
      const plan = buildPiRunnerReviewPlan(
        baseState({
          teams: { "developer-team": { selected: true } },
          runtime: { toolsReview },
        }),
        inventory,
      );

      const teamAction = plan.groups.teamApplications.find(
        (action) => action.id === "team.developer-team.apply",
      );

      expect(teamAction?.dependencies).toBeUndefined();
    });

    test("no TEAM_CAPABILITY_UNSATISFIED diagnostic when pi-mermaid is missing", () => {
      const toolsReview = review(["sub-agents", "MCP packages"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
      const plan = buildPiRunnerReviewPlan(
        baseState({
          teams: { "developer-team": { selected: true } },
          runtime: { toolsReview },
        }),
        inventory,
      );

      const teamDiags = plan.diagnostics.filter(
        (d) => d.code === "TEAM_CAPABILITY_UNSATISFIED",
      );
      expect(teamDiags).toHaveLength(0);
    });
  });

  describe("OpenCode runner scope — pi-mermaid not applicable", () => {
    test("no visual support action generated for opencode runner scope", () => {
      const toolsReview = review(["sub-agents", "MCP packages"]);
      const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "opencode" });
      const plan = buildPiRunnerReviewPlan(
        baseState({
          runnerScope: "opencode",
          runtime: { toolsReview },
        }),
        inventory,
      );

      const visualAction = plan.groups.automaticInstalls.find(
        (action) => action.title === "Install visual explanation support",
      );
      const validateAction = plan.groups.validations.find(
        (action) => action.id === "capability.runner-mermaid.validate",
      );

      expect(visualAction).toBeUndefined();
      expect(validateAction).toBeUndefined();
    });
  });
});

describe("buildDeveloperTeamInstallPlan dashboard memory regression", () => {
  test("dashboardMemoryProvider preserves comparable output to memoryProvider for same assignments", () => {
    const provider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "engram",
      displayName: "Engram",
      buildInjection: () => ({
        instructions: [
          { surface: "agent", markdown: "Dashboard provider memory instructions.", teamId: "developer-team" },
          { surface: "skill", markdown: "Dashboard provider skill memory instructions.", teamId: "developer-team" },
        ],
        toolBindings: [{ capability: "memory.search", serverName: "engram", toolNames: ["memory_search"] }],
      }),
    };
    const assignments = { "deck-developer-orchestrator": "openai-codex/gpt-5.5" } as const;
    const thinking = { "deck-developer-orchestrator": "high" } as const;

    const memoryProviderPlan = buildDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: provider,
      modelAssignments: assignments,
      thinkingAssignments: thinking,
    });
    const dashboardProviderPlan = buildDeveloperTeamInstallPlan("/tmp/project", {
      dashboardMemoryProvider: provider,
      modelAssignments: assignments,
      thinkingAssignments: thinking,
    });

    expect(dashboardProviderPlan.memoryDiagnostics).toEqual(memoryProviderPlan.memoryDiagnostics);
    expect(dashboardProviderPlan.agents.map((agent) => ({ id: agent.agent.id, content: agent.content }))).toEqual(
      memoryProviderPlan.agents.map((agent) => ({ id: agent.agent.id, content: agent.content })),
    );
    expect(dashboardProviderPlan.skills.map((skill) => ({ id: skill.agent.id, content: skill.content }))).toEqual(
      memoryProviderPlan.skills.map((skill) => ({ id: skill.agent.id, content: skill.content })),
    );
  });
});

describe("buildPiRunnerReviewPlan security and structural regressions", () => {
  test("Supermemory with token but missing userId remains not ready and warns", () => {
    const toolsReview = review(["sub-agents", "MCP packages"]);
    const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
    const plan = buildPiRunnerReviewPlan(
      baseState({
        adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: true } },
        runtime: { toolsReview },
      }),
      inventory,
    );

    expect(plan.ready).toBe(false);
    expect(plan.groups.configWrites).toContainEqual(
      expect.objectContaining({ id: "adaptive-memory.supermemory.deck-config", kind: "write-deck-config", status: "pending" }),
    );
    expect(plan.groups.configWrites).toContainEqual(
      expect.objectContaining({ id: "adaptive-memory.supermemory.pi-mcp-config", kind: "write-pi-mcp-config", status: "ready" }),
    );
    expect(plan.groups.validations).toContainEqual(
      expect.objectContaining({ id: "adaptive-memory.supermemory.validate", kind: "validate", status: "pending" }),
    );
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SUPERMEMORY_CONFIGURATION_REQUIRED", severity: "warning", actionId: "adaptive-memory.supermemory.deck-config" }),
    );
  });

  test("plan actions expose structured providers/exclusions metadata", () => {
    const toolsReview = review(["sub-agents", "MCP packages"]);
    const inventory = buildPiRunnerCapabilityInventory(toolsReview, undefined, { runnerScope: "pi" });
    const plan = buildPiRunnerReviewPlan(
      baseState({
        selectedCapabilities: { "context-mode": true, rtk: true, "codebase-memory": true, "pi-hud": true },
        adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: true, userId: "user-1" } },
        runtime: { toolsReview },
      }),
      inventory,
    );

    expect(plan.groups.automaticInstalls).toContainEqual(
      expect.objectContaining({ capabilityId: "context-mode", toolId: "context-mode", kind: "install-pi-package", source: "npm:context-mode" }),
    );
    expect(plan.groups.automaticInstalls).toContainEqual(
      expect.objectContaining({ title: "Install visual explanation support", source: "npm:pi-mermaid" }),
    );
    expect(plan.groups.manualSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capabilityId: "rtk", toolId: "rtk", kind: "manual-external-install", source: "rtk-ai/rtk" }),
        expect.objectContaining({ capabilityId: "codebase-memory", toolId: "codebase-memory", kind: "manual-external-install", source: "DeusData/codebase-memory-mcp" }),
        expect.objectContaining({ capabilityId: "pi-hud", kind: "pending-source", source: "TBD" }),
      ]),
    );
    expect(plan.groups.configWrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "adaptive-memory.supermemory.deck-config", kind: "write-deck-config", status: "ready" }),
        expect.objectContaining({ id: "adaptive-memory.supermemory.pi-mcp-config", kind: "write-pi-mcp-config", status: "ready" }),
      ]),
    );
    expect(plan.groups.validations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "adaptive-memory.supermemory.validate", kind: "validate", status: "ready" }),
        expect.objectContaining({ id: "validation.pi-runner-capabilities", kind: "validate", status: "ready" }),
      ]),
    );
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MANUAL_TOOL_REQUIRED", severity: "warning", capabilityId: "rtk" }),
        expect.objectContaining({ code: "MANUAL_TOOL_REQUIRED", severity: "warning", capabilityId: "codebase-memory" }),
        expect.objectContaining({ code: "CAPABILITY_SOURCE_UNKNOWN", severity: "warning", capabilityId: "pi-hud" }),
        expect.objectContaining({ code: "SUPERMEMORY_CONFIGURATION_REQUIRED", severity: "info" }),
      ]),
    );

    for (const action of allActions(plan)) {
      expect(action.toolId).not.toBe("engram-memory");
      expect(action.toolId).not.toBe("context7");
      expect(action.source?.toLowerCase() ?? "").not.toContain("context7");
    }
  });
});