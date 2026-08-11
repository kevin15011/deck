import { describe, expect, test, vi } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { buildDashboardSupermemorySetupUpdate } from "../app";
import { getAdapter } from "../../runner-adapters";
import type { NormalizedDeckConfig } from "@deck/core/config/deck-config";
import {
  getPiRunnerReviewPlanRunBlockDiagnostics,
  runRunnerAction,
  runRunnerReviewPlan,
  runPiRunnerAction,
  runPiRunnerReviewPlan,
} from "./action-runner";
import { createDefaultPiRunnerDashboardState, createDefaultRunnerDashboardState, type PiRunnerReviewPlan } from "./state";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";
import { buildCapabilityInstructionBundle, getEnabledCapabilityInstructionIds, readDeckConfig } from "@deck/core";

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

const SERENA_ROOT = "/fixtures/deck-data/tools/serena";
const SERENA_EVIDENCE = {
  capabilityId: "serena" as const,
  state: "ready" as const,
  resolvedExecutablePath: `${SERENA_ROOT}/bin/serena`,
  source: "installed-deck-tool" as const,
  probe: "serena-help" as const,
  fingerprint: "serena-fingerprint",
};

describe("Pi Runner dashboard action runner Supermemory safety", () => {
  test("round-trips Web Search selection before native materialization", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-dashboard-web-search-"));
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
      const persisted = readDeckConfig(projectRoot);
      expect(persisted.webSearch).toEqual({ enabled: true, provider: "tavily" });
      expect(getEnabledCapabilityInstructionIds(persisted, "pi")).toContain("web-search");
      expect(buildCapabilityInstructionBundle(getEnabledCapabilityInstructionIds(persisted, "pi")).instructions.some((fragment) => fragment.packageId === "web-search")).toBe(true);
      expect(mcpWrites).toHaveLength(1);
      expect(mcpWrites[0]).toMatchObject({
        serverName: "web-search",
        webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR,
        command: ["npx", "-y", "tavily-mcp@0.2.22"],
      });
      expect(readFileSync(join(projectRoot, ".deck", "config.json"), "utf8")).not.toContain("TAVILY_API_KEY");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("materializes OpenCode Web Search from disabled inventory through readiness reinspection", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-web-search-e2e-"));
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
      const persisted = readDeckConfig(projectRoot);
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
      const persisted = readDeckConfig(projectRoot);
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
        "adaptive-memory": true,
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
      "context-mode": false,
      rtk: false,
      "adaptive-memory": true,
      serena: false,
    });
    expect(writes[0]!.packageInstructions.codex).not.toHaveProperty("pi-hud");
  });

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
    expect(diagnostics.join(" ")).not.toContain("userId");
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
    });

expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    expect(setup.values).toMatchObject({
      configured: true,
      hasToken: true,
      diagnostics: [
        "Supermemory token captured ephemerally for Review & Install; no Pi MCP config was written yet."
      ],
    });
    expect(JSON.stringify(setup)).not.toContain(TOKEN_SENTINEL);
    expect(setup.values.diagnostics.join(" ")).toContain("no Pi MCP config was written yet");
  });


  test("Review & Install usa salida real de setup Supermemory sin bloquear diagnóstico informativo", async () => {
    const setup = buildDashboardSupermemorySetupUpdate({
      token: TOKEN_SENTINEL,
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
        return { ...provider, diagnostics: [] } as never;
      },
      installTeamBundle: (projectRoot, options) => {
        order.push("apply-team-bundle");
        teamMemoryProvider = options?.memoryProvider;
        const plan = buildDeveloperTeamInstallPlan(projectRoot, options);
        order.push("build-team-plan");
        return Promise.resolve({ results: [] }) as never;
      },
      validateSupermemoryPiMcpConfig: () => {
        order.push("validate");
        return { ok: true, path: "/tmp/mcp.json", serverName: "supermemory", diagnostics: [] } as never;
      },
    });

    expect(results.map((result) => result.actionId)).toContain("adaptive-memory.supermemory.pi-mcp-config");
    expect(results.map((result) => result.actionId)).toContain("teams.developer-team.apply");
    expect(order).toEqual(["write-deck-config", "write-pi-mcp-config", "resolve-provider", "apply-team-bundle", "build-team-plan", "validate"]);
    expect(teamMemoryProvider).toMatchObject({ id: "supermemory", displayName: "Supermemory" });
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
      status: "skipped",
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
        return { ...provider, diagnostics: [] } as never;
      },
      installTeamBundle: (projectRoot, options) => {
        order.push("apply-team-bundle");
        teamMemoryProvider = options?.memoryProvider;
        const plan = buildDeveloperTeamInstallPlan(projectRoot, options);
        order.push("build-team-plan");
        return Promise.resolve({ results: [] }) as never;
      },
      validateSupermemoryPiMcpConfig: () => {
        order.push("validate");
        return { ok: true, path: "/tmp/mcp.json", serverName: "supermemory", diagnostics: [] } as never;
      },
    });

    expect(results.map((result) => result.actionId)).toContain("teams.developer-team.apply");
    expect(order).toEqual(["write-deck-config", "write-pi-mcp-config", "resolve-provider", "apply-team-bundle", "build-team-plan", "validate"]);
    expect(teamMemoryProvider).toMatchObject({ id: "supermemory", displayName: "Supermemory" });
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
        command: [SERENA_EVIDENCE.resolvedExecutablePath, "start-mcp-server", "--context", "ide", "--project-from-cwd"],
      },
    });
    expect(JSON.stringify(results)).not.toContain(SERENA_ROOT);
    expect(results.find((result) => result.actionId === "capability.serena.mcp-config")?.status).toBe("executed");
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

describe("OpenCode dashboard action runner Supermemory OAuth", () => {
  test("no exige ni persiste API key al escribir y validar la configuración MCP", async () => {
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: false, diagnostics: [] },
      },
    });
    expect(getPiRunnerReviewPlanRunBlockDiagnostics(state)).toEqual([]);

    let writerInput: { serverName: string; token?: string } | undefined;
    const writeResult = await runPiRunnerAction(
      {
        id: "adaptive-memory.supermemory.opencode-mcp-config",
        kind: "write-mcp-config",
        title: "Write Supermemory OpenCode MCP config",
        status: "ready",
      },
      {
        dashboardState: state,
        writeMcpConfig: async (input) => {
          writerInput = input;
          return { ok: true, path: "/tmp/opencode.json", diagnostics: [] };
        },
      },
    );

    expect(writerInput).toEqual({ serverName: "supermemory" });
    expect(writeResult).toMatchObject({ status: "executed" });
    expect(writeResult.message).toContain("OAuth-enabled");

    let validatorInput: { serverName?: string; token?: string } | undefined;
    const validateResult = await runPiRunnerAction(
      {
        id: "adaptive-memory.supermemory.validate",
        kind: "validate",
        title: "Validate Supermemory OpenCode MCP config",
        status: "ready",
      },
      {
        dashboardState: state,
        validateMcpConfig: (input) => {
          validatorInput = input;
          return { ok: true, diagnostics: [] };
        },
      },
    );

    expect(validatorInput).toEqual({ serverName: "supermemory" });
    expect(validateResult).toMatchObject({ status: "executed" });
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
          verificationEvidence: [{ id: "mcp:supermemory" }],
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
