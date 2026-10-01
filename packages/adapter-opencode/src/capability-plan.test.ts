import { describe, expect, test } from "bun:test";

import { buildOpenCodeRunnerReviewPlan } from "./capability-plan";
import type { OpenCodeRunnerCapabilityInventory } from "./capability-inventory";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";

const operation = {
  runner: "opencode" as const,
  operationId: "operation-1",
  explicitlySelected: true,
};

function inventory(overrides: Partial<OpenCodeRunnerCapabilityInventory["serena"]> = {}): OpenCodeRunnerCapabilityInventory {
  return {
    serena: {
      capabilityId: "serena",
      status: "missing",
      runnerScope: "opencode",
      installed: false,
      toolId: "serena",
      source: "serena-agent",
      diagnostics: [],
      ...overrides,
    },
  };
}

function state(overrides: Record<string, unknown> = {}): any {
  return {
    runnerScope: "opencode",
    selectedCapabilities: { serena: true },
    explicitlySelectedCapabilities: { serena: true },
    operationId: operation.operationId,
    currentOperation: operation,
    ...overrides,
  };
}

describe("buildOpenCodeRunnerReviewPlan Serena authorization", () => {
  test("keeps default-only Serena selection inert", () => {
    const plan = buildOpenCodeRunnerReviewPlan(
      state({ explicitlySelectedCapabilities: undefined, currentOperation: undefined }),
      inventory(),
    );

    expect(plan.groups.automaticInstalls.filter((action) => action.capabilityId === "serena")).toEqual([]);
    expect(plan.groups.configWrites.filter((action) => action.capabilityId === "serena")).toEqual([]);
  });

  test("requires the current OpenCode operation to carry explicit Serena selection", () => {
    for (const override of [
      { runnerScope: "pi", currentOperation: operation },
      { runnerScope: "opencode", currentOperation: { ...operation, runner: "pi" as const } },
      { runnerScope: "opencode", currentOperation: { ...operation, operationId: "other-operation" } },
      { runnerScope: "opencode", currentOperation: { ...operation, explicitlySelected: false } },
    ]) {
      const plan = buildOpenCodeRunnerReviewPlan(state(override), inventory(),);
      expect(plan.groups.automaticInstalls.some((action) => action.capabilityId === "serena")).toBe(false);
      expect(plan.groups.configWrites.some((action) => action.capabilityId === "serena")).toBe(false);
    }
  });

  test("orders missing Serena installation before its config write", () => {
    const plan = buildOpenCodeRunnerReviewPlan(state(), inventory(),);
    const install = plan.groups.automaticInstalls.find((action) => action.capabilityId === "serena");
    const config = plan.groups.configWrites.find((action) => action.capabilityId === "serena");

    expect(install).toMatchObject({
      id: "capability.serena.install",
      kind: "install-opencode-plugin",
      source: "serena-agent",
      status: "ready",
    });
    expect(config).toMatchObject({
      id: "capability.serena.mcp-config",
      kind: "write-mcp-config",
      status: "ready",
      dependencies: ["capability.serena.install"],
    });
    expect(plan.groups.automaticInstalls.indexOf(install!)).toBeGreaterThanOrEqual(0);
    expect(plan.groups.configWrites.indexOf(config!)).toBeGreaterThanOrEqual(0);
  });

  test("routes a ready Serena reuse path through readiness before config", () => {
    const plan = buildOpenCodeRunnerReviewPlan(
      state(),
      inventory({ status: "ready", installed: true }),
    );

    expect(plan.groups.automaticInstalls).toContainEqual(expect.objectContaining({
      id: "capability.serena.install",
      title: "Validate Serena readiness",
    }));
    expect(plan.groups.configWrites).toContainEqual(expect.objectContaining({
      id: "capability.serena.mcp-config",
      capabilityId: "serena",
      dependencies: ["capability.serena.install"],
    }));
  });

  test("does not manufacture Serena readiness for blocked or failed inventory", () => {
    for (const status of ["blocked", "pending", "manual", "failed"] as const) {
      const plan = buildOpenCodeRunnerReviewPlan(state(), inventory({ status: status as never }));
      expect(plan.groups.automaticInstalls.some((action) => action.capabilityId === "serena")).toBe(false);
      expect(plan.groups.configWrites.some((action) => action.capabilityId === "serena")).toBe(false);
    }
  });

  test("continues unrelated selected capability planning", () => {
    const plan = buildOpenCodeRunnerReviewPlan(
      state({ selectedCapabilities: { serena: true, context7: true } }),
      {
        ...inventory(),
        context7: {
          capabilityId: "context7",
          status: "missing",
          runnerScope: "opencode",
          installed: false,
          toolId: "context7",
          source: "@upstash/context7-mcp",
          diagnostics: [],
        },
      },
    );

    expect(plan.groups.automaticInstalls).toContainEqual(expect.objectContaining({ capabilityId: "context7" }));
    expect(plan.groups.automaticInstalls).toContainEqual(expect.objectContaining({ capabilityId: "serena" }));
  });
});

describe("buildOpenCodeRunnerReviewPlan Web Search materialization", () => {
  test("plans native MCP configuration for an enabled but incomplete capability", () => {
    const plan = buildOpenCodeRunnerReviewPlan(
      { runnerScope: "opencode", selectedCapabilities: { "web-search": true }, webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR },
      {
        "web-search": {
          capabilityId: "web-search",
          status: "enabled-unconfigured",
          runnerScope: "opencode",
          installed: false,
          source: "tavily-mcp",
          webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR,
          diagnostics: ["credential-missing"],
        },
      },
    );

    expect(plan.groups.configWrites).toContainEqual(expect.objectContaining({
      id: "capability.web-search.mcp-config",
      kind: "write-mcp-config",
      capabilityId: "web-search",
    }));
  });

  test("plans Web Search materialization when enabled selection replaces disabled inventory", () => {
    const plan = buildOpenCodeRunnerReviewPlan(
      { runnerScope: "opencode", selectedCapabilities: { "web-search": true }, webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR },
      {
        "web-search": {
          capabilityId: "web-search",
          status: "disabled",
          runnerScope: "opencode",
          installed: false,
          diagnostics: ["Web Search is disabled; no provider or runner setup is required."],
        },
      },
    );

    expect(plan.groups.configWrites.map((action) => action.id)).toEqual([
      "capability.web-search.deck-config",
      "capability.web-search.mcp-config",
    ]);
    expect(plan.groups.configWrites.every((action) => action.status === "ready")).toBe(true);
  });

  test("does not schedule Web Search MCP writes without a selected supported provider", () => {
    const plan = buildOpenCodeRunnerReviewPlan(
      { runnerScope: "opencode", selectedCapabilities: { "web-search": true } },
      {
        "web-search": {
          capabilityId: "web-search",
          status: "enabled-unconfigured",
          runnerScope: "opencode",
          installed: false,
          diagnostics: ["provider-unconfigured"],
        },
      },
    );

    expect(plan.groups.configWrites.some((action) => action.capabilityId === "web-search")).toBe(false);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "WEB_SEARCH_PROVIDER_UNAVAILABLE" }));
  });
});

describe("buildOpenCodeRunnerReviewPlan official Supermemory plugin UX", () => {
  test("stored plugin profile credential is ready without a Deck memory validation action", () => {
    const plan = buildOpenCodeRunnerReviewPlan(
      state({
        adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: false, runtimeCredentialStored: true, mcpOAuthReady: false } },
        selectedCapabilities: {},
        explicitlySelectedCapabilities: {},
      }),
      {},
    );

    expect(plan.ready).toBe(true);
    expect(plan.groups.automaticInstalls).toContainEqual(expect.objectContaining({
      id: "adaptive-memory.supermemory.install-official-plugin",
      kind: "install-opencode-plugin",
      toolId: "opencode-supermemory",
      source: "opencode-supermemory@2.0.15",
      status: "ready",
      required: true,
    }));
    expect(JSON.stringify(plan)).not.toContain("adaptive-memory.supermemory.opencode-mcp-config");
    expect(JSON.stringify(plan)).not.toContain("Configure Supermemory OpenCode MCP");
    expect(plan.groups.configWrites).toContainEqual(expect.objectContaining({ id: "adaptive-memory.supermemory.retire-legacy-opencode-mcp", status: "ready", dependencies: ["adaptive-memory.supermemory.install-official-plugin"] }));
    expect(plan.groups.configWrites).toContainEqual(expect.objectContaining({
      id: "adaptive-memory.supermemory.deck-config",
      dependencies: ["adaptive-memory.supermemory.install-official-plugin", "adaptive-memory.supermemory.retire-legacy-opencode-mcp"],
    }));
    expect(plan.groups.validations).not.toContainEqual(expect.objectContaining({ id: "adaptive-memory.supermemory.validate" }));
    expect(JSON.stringify(plan)).toContain("official Supermemory plugin credential is validated and stored");
    expect(JSON.stringify(plan)).toContain("co-loaded global or project plugins can access the selected process credential");
    expect(JSON.stringify(plan)).not.toContain("uses OpenCode native OAuth; no API key or package install action is generated");
  });

  test("missing plugin profile credential blocks the plan", () => {
    const plan = buildOpenCodeRunnerReviewPlan(
      state({
        adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: false, runtimeCredentialStored: false, mcpOAuthReady: true } },
        selectedCapabilities: {},
        explicitlySelectedCapabilities: {},
      }),
      {},
    );

    expect(plan.ready).toBe(false);
    expect(plan.groups.automaticInstalls).toContainEqual(expect.objectContaining({
      id: "adaptive-memory.supermemory.install-official-plugin",
      status: "pending",
      required: true,
    }));
    expect(plan.groups.configWrites).toContainEqual(expect.objectContaining({ id: "adaptive-memory.supermemory.retire-legacy-opencode-mcp", status: "pending" }));
    expect(plan.groups.validations).not.toContainEqual(expect.objectContaining({ id: "adaptive-memory.supermemory.validate" }));
    expect(JSON.stringify(plan)).toContain("official Supermemory plugin profile credential must be validated and stored");
  });

  test("marks external Supermemory registrations as blockers without scheduling a duplicate loader", () => {
    const plan = buildOpenCodeRunnerReviewPlan(
      state({
        adaptiveMemory: {
          provider: "supermemory",
          supermemory: {
            configured: true,
            runtimeCredentialStored: true,
            registrationConflicts: ["opencode-supermemory@2.0.15"],
          },
        },
        selectedCapabilities: {},
      }),
      {},
    );

    expect(plan.ready).toBe(false);
    expect(plan.groups.automaticInstalls).toContainEqual(expect.objectContaining({
      id: "adaptive-memory.supermemory.install-official-plugin",
      status: "blocked",
    }));
    expect(plan.groups.configWrites.every((action) => action.status === "blocked")).toBe(true);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({
      code: "SUPERMEMORY_PLUGIN_REGISTRATION_CONFLICT",
      severity: "error",
    }));
  });
});
