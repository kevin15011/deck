import { describe, expect, test, vi } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDeveloperTeamInstallPlan,
  buildPiRunnerCapabilityInventory,
  buildPiRunnerReviewPlan,
  inspectPiWebSearchMcpConfig,
  resolvePiWebSearchReadiness,
  writePiWebSearchMcpConfig,
  type DeveloperTeamInstallPlan,
  type DeveloperTeamModelAssignments,
  type DeveloperTeamThinkingAssignments,
} from "@deck/adapter-pi";
import {
  buildOpenCodeRunnerCapabilityInventory,
  buildOpenCodeRunnerReviewPlan,
  inspectOpenCodeWebSearchMcpConfig,
  resolveOpenCodeWebSearchReadiness,
  writeOpenCodeWebSearchMcpConfig,
} from "@deck/adapter-opencode";
import { getAdapter } from "../../runner-adapters";
import type { NormalizedDeckConfig } from "@deck/core/config/deck-config";
import {
  runRunnerAction,
  runRunnerReviewPlan,
  runPiRunnerAction,
  runPiRunnerReviewPlan,
} from "./action-runner";
import { createDefaultPiRunnerDashboardState, createDefaultRunnerDashboardState, type PiRunnerReviewPlan } from "./state";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";
import { buildCapabilityInstructionBundle, getEnabledCapabilityInstructionIds } from "@deck/core";
import { createDeckConfigStore } from "../../deck-config-store";

const TOKEN_SENTINEL = "sk-sm-test-SHOULD-NOT-LEAK";

function testConfigStore(projectRoot: string) {
  const canonicalProjectRoot = realpathSync(projectRoot);
  return createDeckConfigStore({ homeDir: join(canonicalProjectRoot, "home"), xdgConfigHome: join(canonicalProjectRoot, "xdg"), projectRoot: canonicalProjectRoot });
}

const SERENA_ROOT = "/fixtures/deck-data/tools/serena";
const SERENA_EVIDENCE = {
  capabilityId: "serena" as const,
  state: "ready" as const,
  resolvedExecutablePath: `${SERENA_ROOT}/bin/serena`,
  source: "installed-deck-tool" as const,
  probe: "serena-help" as const,
  fingerprint: "serena-fingerprint",
};

describe("Runner dashboard action execution", () => {
  test("round-trips Web Search selection before native materialization", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-dashboard-web-search-"));
    const configStore = testConfigStore(projectRoot);
    const mcpWrites: Array<Record<string, unknown>> = [];
    const state = createDefaultPiRunnerDashboardState({
      selectedCapabilities: { "web-search": true },
      webSearchProvider: "tavily",
      webSearchProviderDescriptor: TAVILY_PROVIDER_DESCRIPTOR,
    });
    const plan: PiRunnerReviewPlan = {
      ready: true,
      diagnostics: [],
      groups: {
        automaticInstalls: [],
        manualSteps: [],
        configWrites: [
          { id: "capability.web-search.deck-config", kind: "write-deck-config", title: "Persist Web Search selection", capabilityId: "web-search", status: "ready" },
          { id: "capability.web-search.mcp-config", kind: "write-pi-mcp-config", title: "Configure Web Search MCP", capabilityId: "web-search", status: "ready" },
        ],
        teamApplications: [],
        validations: [],
      },
    };
    try {
      const results = await runRunnerReviewPlan(plan, {
        projectRoot,
        configStore,
        dashboardState: state,
        webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR,
        writeMcpConfig: async (options) => {
          mcpWrites.push(options as Record<string, unknown>);
          return { ok: true, path: join(projectRoot, "mcp.json"), diagnostics: [] };
        },
      });

      const resultsById = new Map(results.map((result) => [result.actionId, result]));
      expect(resultsById.get("capability.web-search.deck-config")).toMatchObject({ status: "executed" });
      expect(resultsById.get("capability.web-search.mcp-config")).toMatchObject({ status: "executed" });
      const persisted = configStore.read();
      expect(persisted.webSearch).toEqual({ enabled: true, provider: "tavily" });
      expect(getEnabledCapabilityInstructionIds(persisted, "pi")).toContain("web-search");
      expect(buildCapabilityInstructionBundle(getEnabledCapabilityInstructionIds(persisted, "pi")).instructions.some((fragment) => fragment.packageId === "web-search")).toBe(true);
      expect(mcpWrites).toHaveLength(1);
      expect(mcpWrites[0]).toMatchObject({
        serverName: "web-search",
        webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR,
        command: ["npx", "-y", "tavily-mcp@0.2.22"],
      });
      expect(existsSync(join(projectRoot, ".deck", "config.json"))).toBe(false);
      expect(readFileSync(configStore.paths.canonicalPath, "utf8")).not.toContain("TAVILY_API_KEY");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("materializes OpenCode Web Search from disabled inventory through readiness reinspection", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "deck-opencode-web-search-e2e-")));
    const configStore = testConfigStore(projectRoot);
    const configPath = join(projectRoot, "opencode.json");
    const state = createDefaultRunnerDashboardState({
      runnerScope: "opencode",
      selectedCapabilities: {
        "context-mode": false,
        "codebase-memory-mcp": false,
        "codebase-memory": false,
        rtk: false,
        serena: false,
        context7: false,
        "web-search": true,
      },
      webSearchProvider: "tavily",
      webSearchProviderDescriptor: TAVILY_PROVIDER_DESCRIPTOR,
    });
    const disabledInventory = buildOpenCodeRunnerCapabilityInventory(undefined, { runnerScope: "opencode" });
    expect(disabledInventory["web-search"]).toMatchObject({ status: "disabled", installed: false });

    const plan = buildOpenCodeRunnerReviewPlan(
      { runnerScope: "opencode", selectedCapabilities: { "web-search": true }, webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR },
      disabledInventory,
    );
    const webSearchActions = plan.groups.configWrites.filter((action) => action.capabilityId === "web-search");
    expect(webSearchActions.map((action) => action.id)).toEqual([
      "capability.web-search.deck-config",
      "capability.web-search.mcp-config",
    ]);

    try {
      const results = await runRunnerReviewPlan(plan, {
        projectRoot,
        configStore,
        dashboardState: state,
        webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR,
        writeMcpConfig: async (options) => {
          const result = writeOpenCodeWebSearchMcpConfig({ configPath, provider: options.webSearchProvider });
          return { ok: result.ok, path: result.path, diagnostics: [...result.diagnostics] };
        },
      });

      const resultsById = new Map(results.map((result) => [result.actionId, result]));
      expect(resultsById.get("capability.web-search.deck-config")).toMatchObject({ status: "executed" });
      expect(resultsById.get("capability.web-search.mcp-config")).toMatchObject({ status: "executed" });
      const persisted = configStore.read();
      expect(persisted.webSearch).toEqual({ enabled: true, provider: "tavily" });
      const instructionIds = getEnabledCapabilityInstructionIds(persisted, "opencode");
      expect(instructionIds).toContain("web-search");
      expect(buildCapabilityInstructionBundle(instructionIds).instructions.some((fragment) => fragment.packageId === "web-search")).toBe(true);

      const inspected = inspectOpenCodeWebSearchMcpConfig(configPath, TAVILY_PROVIDER_DESCRIPTOR);
      expect(inspected).toEqual({ configured: true, conflict: false });
      const readiness = resolveOpenCodeWebSearchReadiness({
        enabled: persisted.webSearch.enabled,
        provider: TAVILY_PROVIDER_DESCRIPTOR,
        credentialEnvironment: { [TAVILY_PROVIDER_DESCRIPTOR.credentialEnvVar]: "synthetic-e2e-credential" },
        executableAvailable: true,
        mcpConfigured: inspected.configured,
        mcpConfigConflict: inspected.conflict,
      });
      expect(readiness.readiness).toMatchObject({ state: "ready", code: "ready" });
      const enabledInventory = buildOpenCodeRunnerCapabilityInventory(undefined, {
        runnerScope: "opencode",
        webSearch: {
          provider: TAVILY_PROVIDER_DESCRIPTOR,
          readiness: readiness.readiness,
          evidence: {
            enabled: true,
            providerConfigured: true,
            credentialAvailable: true,
            executableAvailable: true,
            mcpConfigured: true,
            mcpConfigConflict: false,
          },
        },
      });
      expect(enabledInventory["web-search"]).toMatchObject({ status: "ready", installed: true });
      expect(JSON.stringify({ results, persisted })).not.toContain("synthetic-e2e-credential");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("materializes Pi Web Search from disabled inventory through readiness reinspection", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-pi-web-search-e2e-"));
    const configStore = testConfigStore(projectRoot);
    const configPath = join(projectRoot, "pi-mcp.json");
    const state = createDefaultRunnerDashboardState({
      runnerScope: "pi",
      selectedCapabilities: {
        "context-mode": false,
        "codebase-memory-mcp": false,
        "codebase-memory": false,
        rtk: false,
        serena: false,
        context7: false,
        "web-search": true,
      },
      webSearchProvider: "tavily",
      webSearchProviderDescriptor: TAVILY_PROVIDER_DESCRIPTOR,
    });
    const disabledInventory = buildPiRunnerCapabilityInventory(undefined, undefined, { runnerScope: "pi" });
    expect(disabledInventory["web-search"]).toMatchObject({ status: "disabled", installed: false });

    const plan = buildPiRunnerReviewPlan(
      {
        runnerScope: "pi",
        selectedCapabilities: { "web-search": true },
        webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR,
      },
      disabledInventory,
    );
    const webSearchActions = plan.groups.configWrites.filter((action) => action.capabilityId === "web-search");
    expect(webSearchActions.map((action) => action.id)).toEqual([
      "capability.web-search.deck-config",
      "capability.web-search.mcp-config",
    ]);

    try {
      const results = await runRunnerReviewPlan(plan, {
        projectRoot,
        configStore,
        dashboardState: state,
        webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR,
        writeMcpConfig: async (options) => {
          const result = writePiWebSearchMcpConfig({
            configPath,
            provider: options.webSearchProvider,
            credentialEnvironment: { [TAVILY_PROVIDER_DESCRIPTOR.credentialEnvVar]: "synthetic-e2e-credential" },
          });
          return { ok: result.ok, path: result.path, diagnostics: result.diagnostics.map((diagnostic) => diagnostic.message) };
        },
      });

      const resultsById = new Map(results.map((result) => [result.actionId, result]));
      expect(resultsById.get("capability.web-search.deck-config")).toMatchObject({ status: "executed" });
      expect(resultsById.get("capability.web-search.mcp-config")).toMatchObject({ status: "executed" });
      const persisted = configStore.read();
      expect(persisted.webSearch).toEqual({ enabled: true, provider: "tavily" });
      const instructionIds = getEnabledCapabilityInstructionIds(persisted, "pi");
      expect(instructionIds).toContain("web-search");
      expect(buildCapabilityInstructionBundle(instructionIds).instructions.some((fragment) => fragment.packageId === "web-search")).toBe(true);

      const inspected = inspectPiWebSearchMcpConfig(configPath, TAVILY_PROVIDER_DESCRIPTOR);
      expect(inspected).toEqual({ configured: true, conflict: false });
      const readiness = resolvePiWebSearchReadiness({
        enabled: persisted.webSearch.enabled,
        provider: TAVILY_PROVIDER_DESCRIPTOR,
        credentialEnvironment: { [TAVILY_PROVIDER_DESCRIPTOR.credentialEnvVar]: "synthetic-e2e-credential" },
        executableAvailable: true,
        mcpConfigured: inspected.configured,
        mcpConfigConflict: inspected.conflict,
      });
      expect(readiness.readiness).toMatchObject({ state: "ready", code: "ready" });
      const enabledInventory = buildPiRunnerCapabilityInventory(undefined, undefined, {
        runnerScope: "pi",
        webSearch: {
          provider: TAVILY_PROVIDER_DESCRIPTOR,
          readiness: readiness.readiness,
          evidence: {
            enabled: true,
            providerConfigured: true,
            credentialAvailable: true,
            executableAvailable: true,
            mcpConfigured: true,
            mcpConfigConflict: false,
          },
        },
      });
      expect(enabledInventory["web-search"]).toMatchObject({ status: "ready", installed: true });
      expect(readFileSync(configPath, "utf8")).toContain("$TAVILY_API_KEY");
      expect(readFileSync(configPath, "utf8")).not.toContain("synthetic-e2e-credential");
      expect(JSON.stringify({ results, persisted })).not.toContain("synthetic-e2e-credential");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("persists only canonical package instructions and keeps code-economy enabled", async () => {
    const plan: PiRunnerReviewPlan = {
      ready: true,
      diagnostics: [],
      groups: {
        automaticInstalls: [],
        manualSteps: [],
        configWrites: [{ id: "package-instructions.codex.deck-config", kind: "write-deck-config", title: "Write package instructions", status: "ready" }],
        teamApplications: [],
        validations: [],
      },
    };
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "codex",
      packageInstructions: {
        "codebase-memory": true,
        "code-economy": false,
          "pi-hud": true,
      } as any,
    });
    const writes: NormalizedDeckConfig[] = [];

    await runRunnerReviewPlan(plan, {
      projectRoot: "/tmp/project",
      dashboardState: state,
      packageInstructionIds: getAdapter("codex").packageInstructionIds,
      writeDeckConfig: (_root, config) => {
        writes.push(config as NormalizedDeckConfig);
        return config as NormalizedDeckConfig;
      },
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.packageInstructions.codex).toEqual({
      "codebase-memory": true,
      "code-economy": true,
      rtk: true,
    });
    expect(writes[0]!.packageInstructions.codex).not.toHaveProperty("pi-hud");
  });

  test("global preference write derives from the locked current config and preserves unrelated runner settings", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-action-runner-config-"));
    try {
      const store = testConfigStore(projectRoot);
      store.write({
        packageInstructions: { opencode: { "rtk": true } },
        orchestratorPersonality: "guia",
      });
      const state = createDefaultPiRunnerDashboardState({
        runnerScope: "codex",
        packageInstructions: { "codebase-memory": true, serena: true } as any,
      });

      await runRunnerAction({ id: "package-instructions.codex.deck-config", kind: "write-deck-config", title: "Write package instructions", status: "ready" }, {
        projectRoot,
        dashboardState: state,
        packageInstructionIds: getAdapter("codex").packageInstructionIds,
        configStore: store,
      });

      const config = store.read();
      expect(config.packageInstructions.opencode["rtk"]).toBe(true);
      expect(config.packageInstructions.codex["codebase-memory"]).toBe(true);
      expect(config.orchestratorPersonality).toBe("guia");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("Review plan action dependencies", () => {
  const dependencyPlan = {
    ready: true,
    diagnostics: [],
    groups: {
      automaticInstalls: [{ id: "plugin.install", kind: "install-opencode-plugin", title: "Install plugin", toolId: "context-mode", source: "plugin-package", status: "ready" }],
      manualSteps: [],
      configWrites: [
        { id: "plugin.retire", kind: "write-mcp-config", title: "Retire legacy plugin", status: "ready", dependencies: ["plugin.install"] },
        { id: "plugin.enable", kind: "write-deck-config", title: "Enable plugin", status: "ready", dependencies: ["plugin.install", "plugin.retire"] },
      ],
      teamApplications: [],
      validations: [],
    },
  } as PiRunnerReviewPlan;

  test("does not run dependent config writes after package installation fails", async () => {
    let configWrites = 0;
    const results = await runRunnerReviewPlan(dependencyPlan, {
      runnerCommand: "opencode",
      installPackages: async () => [{ id: "context-mode", outcome: "failed", success: false, message: "install failed" }],
      writeMcpConfig: async () => { configWrites += 1; return { status: "updated", diagnostics: [] } as any; },
      writeDeckConfig: () => { configWrites += 1; return {} as NormalizedDeckConfig; },
    });

    expect(configWrites).toBe(0);
    expect(results.map((result) => [result.actionId, result.status])).toEqual([
      ["plugin.install", "failed"],
      ["plugin.retire", "skipped"],
      ["plugin.enable", "skipped"],
    ]);
  });

  test("does not enable config after legacy retirement fails", async () => {
    let deckWrites = 0;
    const results = await runRunnerReviewPlan(dependencyPlan, {
      runnerCommand: "opencode",
      installPackages: async () => [{ id: "context-mode", outcome: "executed", success: true, message: "installed" }],
      writeMcpConfig: async () => { throw new Error("retirement failed"); },
      writeDeckConfig: () => { deckWrites += 1; return {} as NormalizedDeckConfig; },
    });

    expect(deckWrites).toBe(0);
    expect(results.map((result) => [result.actionId, result.status])).toEqual([
      ["plugin.install", "executed"],
      ["plugin.retire", "failed"],
      ["plugin.enable", "skipped"],
    ]);
  });
});

describe("Serena action-runner evidence and cancellation gates", () => {
  test("routes an explicitly authorized Codex Serena action through its adapter without a runner-specific executor", async () => {
    const operation = { runner: "codex" as const, operationId: "codex-serena-operation", explicitlySelected: true };
    const authorization = {
      kind: "interactive-tui-explicit-selection" as const,
      runner: "codex" as const,
      operationId: operation.operationId,
    };
    let receivedContext: unknown;

    const result = await runRunnerAction({
      id: "codex-serena-bootstrap",
      kind: "install",
      title: "Reuse Serena",
      capabilityId: "serena",
      status: "ready",
    }, {
      runnerId: "codex",
      projectRoot: "/tmp/codex-serena-action",
      currentOperation: operation,
      serenaAuthorization: authorization,
      serenaExecutionState: { attempted: false, succeeded: false },
      runnerAdapter: {
        runAction: async (_action: unknown, context: unknown) => {
          receivedContext = context;
          return { actionId: "codex-serena-bootstrap", status: "executed", message: "reused", diagnostics: [], raw: { outcome: "reused" } };
        },
      } as never,
    });

    expect(result).toMatchObject({ status: "executed", serenaOutcome: "reused" });
    expect(receivedContext).toMatchObject({ runnerId: "codex", environmentId: "codex-development", serenaAuthorization: authorization });
  });

  function serenaPlan() : PiRunnerReviewPlan {
    return {
      ready: true,
      diagnostics: [],
      groups: {
        automaticInstalls: [{
          id: "capability.serena.install",
          kind: "install-pi-package",
          title: "Install Serena",
          capabilityId: "serena",
          toolId: "serena",
          source: "serena-agent",
          status: "ready",
        }],
        manualSteps: [],
        configWrites: [{
          id: "capability.serena.mcp-config",
          kind: "write-pi-mcp-config",
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
  }

  test("passes one explicit operation context through install and config without exposing readiness paths", async () => {
    const plan = serenaPlan();
    const operation = { runner: "pi" as const, operationId: "pi-serena-operation", explicitlySelected: true };
    const authorization = {
      kind: "interactive-tui-explicit-selection" as const,
      runner: "pi" as const,
      operationId: operation.operationId,
    };
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "pi",
      operationId: operation.operationId,
      currentOperation: operation,
      explicitlySelectedCapabilities: { serena: true },
      selectedCapabilities: { serena: true },
      plan,
      planGeneratedForRevision: 0,
    });
    const calls: string[] = [];
    const writerInputs: unknown[] = [];

    const results = await runRunnerReviewPlan(plan, {
      dashboardState: state,
      runnerId: "pi",
      currentOperation: operation,
      serenaAuthorization: authorization,
      installPackages: async (_command, packages, _onResult, context) => {
        calls.push(`install:${context?.currentOperation?.operationId}`);
        return [{
          id: packages[0]!.id,
          outcome: "executed" as const,
          success: true,
          message: "Serena installed and validated.",
          serenaBootstrapOutcome: "installed" as const,
          serenaReadiness: SERENA_EVIDENCE,
        }];
      },
      writeMcpConfig: async (options, context) => {
        calls.push(`config:${context?.currentOperation?.operationId}`);
        writerInputs.push({ options, context });
        return { ok: true, path: "/fixtures/pi/mcp.json", diagnostics: [] };
      },
    });

    expect(calls).toEqual(["install:pi-serena-operation", "config:pi-serena-operation"]);
    expect(writerInputs[0]).toMatchObject({
      options: {
        serverName: "serena",
        command: [SERENA_EVIDENCE.resolvedExecutablePath, "start-mcp-server", "--context", "ide", "--project-from-cwd", "--open-web-dashboard", "false"],
      },
    });
    expect(JSON.stringify(results)).not.toContain(SERENA_ROOT);
    expect(results.find((result) => result.actionId === "capability.serena.mcp-config")?.status).toBe("executed");
  });

  test("does not gate Pi named MCP readiness on a PATH lookup of the Deck-owned executables", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-deck-path";
    try {
      for (const capabilityId of ["codebase-memory-mcp", "context-mode", "rtk"]) {
        const plan: PiRunnerReviewPlan = {
          ready: true,
          diagnostics: [],
          groups: {
            automaticInstalls: [],
            manualSteps: [],
            configWrites: [{
              id: `${capabilityId}.mcp-config`,
              kind: "write-pi-mcp-config",
              title: `Configure ${capabilityId}`,
              capabilityId,
              status: "ready",
            }],
            teamApplications: [],
            validations: [],
          },
        } as never;
        const runnerActions: string[] = [];
        const results = await runRunnerReviewPlan(plan, {
          dashboardState: createDefaultPiRunnerDashboardState({ runnerScope: "pi", plan, planGeneratedForRevision: 0 }),
          runnerId: "pi",
          runnerAdapter: {
            runAction: async (action: { id: string }) => {
              runnerActions.push(action.id);
              return { actionId: action.id, status: "executed", message: "ok", diagnostics: [] };
            },
          } as never,
          writeMcpConfig: async (options: { serverName: string }) => {
            runnerActions.push(`writer:${options.serverName}`);
            return { ok: true, path: "/fixtures/pi/mcp.json", diagnostics: [] };
          },
        });
        expect(results[0]?.message ?? "").not.toContain("not found on PATH");
        expect(results[0]?.status).not.toBe("failed");
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });

  test("skips the Serena writer for failed, cancelled, partial, stale, and malformed outcomes", async () => {
    const scenarios = [
      { label: "failed", outcome: "failed" as const, status: "failed" as const },
      { label: "cancelled", outcome: "cancelled" as const, status: "skipped" as const },
      { label: "partial", outcome: "partial" as const, status: "failed" as const },
    ];
    for (const scenario of scenarios) {
      const plan = serenaPlan();
      const operation = { runner: "opencode" as const, operationId: `op-${scenario.label}`, explicitlySelected: true };
      const writes: string[] = [];
      const results = await runRunnerReviewPlan(plan, {
        dashboardState: createDefaultPiRunnerDashboardState({
          runnerScope: "opencode",
          operationId: operation.operationId,
          currentOperation: operation,
          explicitlySelectedCapabilities: { serena: true },
          selectedCapabilities: { serena: true },
          plan,
          planGeneratedForRevision: 0,
        }),
        runnerId: "opencode",
        currentOperation: operation,
        serenaAuthorization: {
          kind: "interactive-tui-explicit-selection",
          runner: "opencode",
          operationId: operation.operationId,
        },
        installPackages: async (_command, packages) => [{
          id: packages[0]!.id,
          outcome: scenario.status === "skipped" ? "skipped" : "failed",
          success: false,
          message: `Serena ${scenario.label}.`,
          serenaBootstrapOutcome: scenario.outcome,
        }],
        writeMcpConfig: async () => {
          writes.push(scenario.label);
          return { ok: true, path: "/fixtures/mcp.json", diagnostics: [] };
        },
      });

      expect(writes, scenario.label).toEqual([]);
      expect(results.find((result) => result.actionId === "capability.serena.mcp-config")?.status, scenario.label).toBe("skipped");
    }

    const staleWrites: string[] = [];
    const malformedResults = await runRunnerReviewPlan(serenaPlan(), {
      dashboardState: createDefaultPiRunnerDashboardState({
        runnerScope: "pi",
        operationId: "stale-operation",
        currentOperation: { runner: "pi", operationId: "stale-operation", explicitlySelected: true },
        explicitlySelectedCapabilities: { serena: true },
        selectedCapabilities: { serena: true },
      }),
      runnerId: "pi",
      currentOperation: { runner: "pi", operationId: "different-operation", explicitlySelected: true },
      serenaAuthorization: {
        kind: "interactive-tui-explicit-selection",
        runner: "pi",
        operationId: "different-operation",
      },
      installPackages: async () => [{
        id: "serena",
        outcome: "executed" as const,
        success: true,
        message: "malformed evidence",
        serenaBootstrapOutcome: "installed" as const,
        serenaReadiness: { ...SERENA_EVIDENCE, resolvedExecutablePath: "relative/serena" },
      }],
      writeMcpConfig: async () => {
        staleWrites.push("write");
        return { ok: true, path: "/fixtures/mcp.json", diagnostics: [] };
      },
    });
    expect(staleWrites).toEqual([]);
    expect(malformedResults.some((result) => result.status === "failed")).toBe(true);
  });
});

describe("dashboard post-install follow-ups", () => {
  function teamInstallPlan(): PiRunnerReviewPlan {
    return {
      ready: true,
      diagnostics: [],
      groups: {
        automaticInstalls: [],
        manualSteps: [],
        configWrites: [],
        teamApplications: [{
          id: "codex-developer-team",
          kind: "apply-team-bundle",
          title: "Apply Codex Developer Team content",
          status: "ready",
        }],
        validations: [],
      },
    };
  }

  function reviewedState(plan: PiRunnerReviewPlan, overrides: Record<string, unknown> = {}) {
    return createDefaultPiRunnerDashboardState({
      runnerScope: "pi",
      runnerUi: getAdapter("pi").ui,
      plan,
      planRevision: 0,
      planGeneratedForRevision: 0,
      operationId: "post-install-operation",
      currentOperation: { runner: "pi", operationId: "post-install-operation", explicitlySelected: true },
      ...overrides,
    } as any);
  }

  test("retains user follow-ups only after a successful current team application", async () => {
    const plan = teamInstallPlan();
    const state = reviewedState(plan);
    const success = await runRunnerReviewPlan(plan, {
      projectRoot: "/tmp/project",
      dashboardState: state,
      installTeamBundle: async () => {
        return {
          results: [],
          verificationEvidence: [{ id: "mcp:codebase-memory" }],
          postInstallFollowUps: [{ id: "user-authorization", message: "Run the native authorization command when ready." }],
        } as any;
      },
      operationId: "post-install-operation",
      currentOperation: { runner: "pi", operationId: "post-install-operation", explicitlySelected: true },
    } as any);
    const failedPlan = teamInstallPlan();
    const failed = await runRunnerReviewPlan(failedPlan, {
      projectRoot: "/tmp/project",
      dashboardState: reviewedState(failedPlan),
      operationId: "post-install-operation",
      currentOperation: { runner: "pi", operationId: "post-install-operation", explicitlySelected: true },
      installTeamBundle: async () => { throw new Error("configuration apply failed"); },
    } as any);
    const stalePlan = teamInstallPlan();
    let staleTeamApplications = 0;
    const stale = await runRunnerReviewPlan(stalePlan, {
      projectRoot: "/tmp/project",
      dashboardState: reviewedState(stalePlan, { planRevision: 1, planGeneratedForRevision: 0 }),
      operationId: "post-install-operation",
      currentOperation: { runner: "pi", operationId: "post-install-operation", explicitlySelected: true },
      installTeamBundle: async () => {
        staleTeamApplications += 1;
        return { results: [] } as any;
      },
    } as any);

    expect(success).toContainEqual(expect.objectContaining({
      status: "executed",
      postInstallFollowUps: [{ id: "user-authorization", message: "Run the native authorization command when ready." }],
    }));
    expect(JSON.stringify(failed)).not.toContain("Run the native authorization command when ready.");
    expect(JSON.stringify(stale)).not.toContain("Run the native authorization command when ready.");
    expect(staleTeamApplications).toBe(0);
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
      "deck-lead": "openai-codex/gpt-5.5",
      "deck-apply-deep": "opencode-go/kimi-k2.6",
    };
    const thinkingAssignments: DeveloperTeamThinkingAssignments = {
      "deck-lead": "high",
      "deck-apply-deep": "high",
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
        installTeamBundle: (projectRoot, options) => {
          dashboardPlan = buildDeveloperTeamInstallPlan(projectRoot, options);
          return Promise.resolve({ results: [] }) as never;
        },
      },
    );

    expect(result).toMatchObject({ actionId: "teams.developer-team.apply", status: "executed" });
    expect(dashboardPlan).toBeDefined();
    expect(frontmatterFor(dashboardPlan!, "deck-lead")).toBe(
      frontmatterFor(homeConfigureModelsPlan, "deck-lead"),
    );
    expect(frontmatterFor(dashboardPlan!, "deck-apply-deep")).toBe(
      frontmatterFor(homeConfigureModelsPlan, "deck-apply-deep"),
    );
    expect(frontmatterFor(dashboardPlan!, "deck-lead")).toContain("model: openai-codex/gpt-5.5");
    expect(frontmatterFor(dashboardPlan!, "deck-lead")).toContain("thinking: high");
    expect(frontmatterFor(dashboardPlan!, "deck-apply-deep")).toContain("model: opencode-go/kimi-k2.6");
    expect(frontmatterFor(dashboardPlan!, "deck-apply-deep")).not.toContain("thinking:");
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
