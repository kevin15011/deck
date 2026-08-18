import { describe, expect, test, vi } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  getRunnerReviewPlanRunBlockDiagnostics,
  getRunnerReviewPlanRunBlockPreflight,
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
  return createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome: join(projectRoot, "xdg"), projectRoot });
}

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
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-web-search-e2e-"));
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

  test("global preference write derives from the locked current config and preserves unrelated runner settings", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-action-runner-config-"));
    try {
      const store = testConfigStore(projectRoot);
      store.write({
        adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "custom-sm", searchMode: "documents" } },
        packageInstructions: { opencode: { "context-mode": true } },
        orchestratorPersonality: "guia",
      });
      const state = createDefaultPiRunnerDashboardState({
        runnerScope: "codex",
        adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, diagnostics: [] } },
        packageInstructions: { "codebase-memory": true, serena: true } as any,
      });

      await runRunnerAction({ id: "package-instructions.codex.deck-config", kind: "write-deck-config", title: "Write package instructions", status: "ready" }, {
        projectRoot,
        dashboardState: state,
        packageInstructionIds: getAdapter("codex").packageInstructionIds,
        configStore: store,
      });

      const config = store.read();
      expect(config.adaptiveMemory.supermemory).toEqual(expect.objectContaining({ mcpServerName: "custom-sm", searchMode: "documents" }));
      expect(config.packageInstructions.opencode["context-mode"]).toBe(true);
      expect(config.packageInstructions.codex["codebase-memory"]).toBe(true);
      expect(config.orchestratorPersonality).toBe("guia");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
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
      hasToken: false,
      runtimeCredentialStored: true,
      ephemeralTokenAvailable: false,
      diagnostics: [
        "Supermemory Deck runtime API credential validated and stored; Pi MCP config remains credential-free."
      ],
    });
    expect(JSON.stringify(setup)).not.toContain(TOKEN_SENTINEL);
    expect(setup.values.diagnostics.join(" ")).toContain("runtime API credential validated and stored");
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
      validateSupermemoryReadOnlyApi: async () => {
        order.push("api-validate");
        return { ok: true };
      },
      secretStore: { write: () => { order.push("secret-store"); return { backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }; }, read: () => TOKEN_SENTINEL },
    });

    expect(results.map((result) => result.actionId)).toContain("adaptive-memory.supermemory.pi-mcp-config");
    expect(results.map((result) => result.actionId)).toContain("teams.developer-team.apply");
    expect(order).toEqual(["write-deck-config", "write-pi-mcp-config", "resolve-provider", "apply-team-bundle", "build-team-plan", "validate", "api-validate", "secret-store"]);
    expect(teamMemoryProvider).toMatchObject({ id: "supermemory", displayName: "Supermemory" });
    expect(JSON.stringify(results)).not.toContain(TOKEN_SENTINEL);
  });

  test("allows Review & Install with stored Supermemory runtime credential and cleared ephemeral token", async () => {
    const state = createDefaultPiRunnerDashboardState({
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: false, runtimeCredentialStored: true, ephemeralTokenAvailable: false, diagnostics: [] },
      },
    });
    const order: string[] = [];

    const results = await runPiRunnerReviewPlan(supermemoryPlan, {
      projectRoot: "/tmp/project",
      dashboardState: state,
      writeDeckConfig: (_root, config) => {
        order.push("deck");
        return config as NormalizedDeckConfig;
      },
      writeSupermemoryPiMcpConfig: () => {
        order.push("mcp");
        return { ok: true, action: "updated", path: "/tmp/mcp.json", serverName: "supermemory", diagnostics: [] } as never;
      },
      validateSupermemoryPiMcpConfig: () => { order.push("validate-mcp"); return { ok: true, diagnostics: [] }; },
      validateSupermemoryReadOnlyApi: async ({ apiKey }) => { order.push("api"); expect(apiKey).toBe(TOKEN_SENTINEL); return { ok: true }; },
      secretStore: { read: () => TOKEN_SENTINEL, write: () => { order.push("secret"); return { backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }; } },
    });

    expect(results.map((result) => result.status)).not.toContain("failed");
    expect(order).toContain("api");
  });

  test("blocks Review & Install when Supermemory runtime credential is not stored", async () => {
    const state = createDefaultPiRunnerDashboardState({
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: false, runtimeCredentialStored: false, diagnostics: [] },
      },
    });

    const results = await runPiRunnerReviewPlan(supermemoryPlan, { projectRoot: "/tmp/project", dashboardState: state });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ actionId: "review-plan.preflight", status: "failed" });
    expect(results[0]?.diagnostics.join(" ")).toContain("Deck runtime API credential must be validated and stored");
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
      validateSupermemoryReadOnlyApi: async () => {
        order.push("api-validate");
        return { ok: true };
      },
      secretStore: { write: () => { order.push("secret-store"); return { backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }; }, read: () => TOKEN_SENTINEL },
    });

    expect(results.map((result) => result.actionId)).toContain("teams.developer-team.apply");
    expect(order).toEqual(["write-deck-config", "write-pi-mcp-config", "resolve-provider", "apply-team-bundle", "build-team-plan", "validate", "api-validate", "secret-store"]);
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

  test("validates Supermemory token with injectable read-only API before storing", async () => {
    const state = createDefaultPiRunnerDashboardState({
      adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: true, userId: "user-1", diagnostics: [] } },
    });
    const action = supermemoryPlan.groups.validations[0]!;
    const order: string[] = [];
    const failed = await runPiRunnerAction(action, {
      projectRoot: "/tmp/project",
      dashboardState: state,
      supermemoryToken: TOKEN_SENTINEL,
      validateSupermemoryPiMcpConfig: () => { order.push("mcp"); return { ok: true, diagnostics: [] }; },
      validateSupermemoryReadOnlyApi: async () => { order.push("api"); return { ok: false, diagnostics: [`bad ${TOKEN_SENTINEL}`] }; },
      secretStore: { write: () => { order.push("secret"); throw new Error("must not store"); }, read: () => undefined },
    });
    expect(failed).toMatchObject({ status: "failed", message: expect.stringContaining("read-only API validation failed") });
    expect(order).toEqual(["mcp", "api"]);
    expect(JSON.stringify(failed)).not.toContain(TOKEN_SENTINEL);

    order.length = 0;
    const ok = await runPiRunnerAction(action, {
      projectRoot: "/tmp/project",
      dashboardState: state,
      supermemoryToken: TOKEN_SENTINEL,
      validateSupermemoryPiMcpConfig: () => { order.push("mcp"); return { ok: true, diagnostics: [] }; },
      validateSupermemoryReadOnlyApi: async () => { order.push("api"); return { ok: true }; },
      secretStore: { write: () => { order.push("secret"); return { backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }; }, read: () => undefined },
    });
    expect(ok.status).toBe("executed");
    expect(order).toEqual(["mcp", "api", "secret"]);
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
  test("DECK_DEBUG ready Supermemory runtime diagnostics do not block review/install", async () => {
    const previous = process.env.DECK_DEBUG;
    process.env.DECK_DEBUG = "1";
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: false, runtimeCredentialStored: true, ephemeralTokenAvailable: false, diagnostics: [] },
      },
    });
    const plan: PiRunnerReviewPlan = {
      ready: true,
      diagnostics: [],
      groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] },
    };

    try {
      expect(getRunnerReviewPlanRunBlockDiagnostics(state, { secretStore: { read: () => TOKEN_SENTINEL } })).toEqual([]);
      const results = await runRunnerReviewPlan(plan, { dashboardState: state, secretStore: { read: () => TOKEN_SENTINEL, write: () => ({ backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }) } });
      expect(results).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.DECK_DEBUG;
      else process.env.DECK_DEBUG = previous;
    }
  });

  test("DECK_DEBUG missing Supermemory runtime secret blocks with actionable runtime wording only", () => {
    const previous = process.env.DECK_DEBUG;
    process.env.DECK_DEBUG = "1";
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, diagnostics: [] },
      },
    });

    try {
      const diagnostics = getRunnerReviewPlanRunBlockDiagnostics(state, { secretStore: { read: () => undefined } });
      expect(diagnostics.join(" ")).toContain("Deck runtime API credential must be validated and stored");
      expect(diagnostics.join(" ")).not.toContain("Supermemory runtime readiness");
    } finally {
      if (previous === undefined) delete process.env.DECK_DEBUG;
      else process.env.DECK_DEBUG = previous;
    }
  });

  test("stale cached Supermemory runtime credential flags are downgraded by the secret store", () => {
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: true, runtimeCredentialStored: true, ephemeralTokenAvailable: false, diagnostics: [] },
      },
    });

    const diagnostics = getRunnerReviewPlanRunBlockDiagnostics(state, { secretStore: { read: () => undefined } });

    expect(diagnostics.join(" ")).toContain("Deck runtime API credential must be validated and stored");
  });

  test("credential preflight returns evidence without mutating frozen dashboard state", () => {
    const setup = Object.freeze({ configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, diagnostics: Object.freeze([] as string[]) });
    const state = Object.freeze(createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      adaptiveMemory: Object.freeze({ provider: "supermemory" as const, supermemory: setup }) as any,
    }));

    expect(() => getRunnerReviewPlanRunBlockPreflight(state, { secretStore: { read: () => TOKEN_SENTINEL } })).not.toThrow();
    const preflight = getRunnerReviewPlanRunBlockPreflight(state, { secretStore: { read: () => TOKEN_SENTINEL } });

    expect(preflight.diagnostics).toEqual([]);
    expect(preflight.evidence).toMatchObject({ runtimeCredentialStored: true, runtimeCredentialVerification: "verified-present" });
    expect("runtimeCredentialVerification" in setup).toBe(false);
  });

  test("aborted Review preflight returns before credential evidence can be read or emitted", async () => {
    const controller = new AbortController();
    controller.abort();
    let reads = 0;
    const evidence: unknown[] = [];
    const setup = { configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, diagnostics: [] };
    const state = createDefaultPiRunnerDashboardState({ runnerScope: "opencode", adaptiveMemory: { provider: "supermemory", supermemory: setup } });

    const results = await runRunnerReviewPlan(supermemoryPlan, {
      dashboardState: state,
      signal: controller.signal,
      secretStore: { read: () => { reads += 1; return TOKEN_SENTINEL; }, write: () => ({ backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }) },
      onSupermemoryRuntimeCredentialEvidence: (item) => evidence.push(item),
    });

    expect(results).toEqual([]);
    expect(reads).toBe(0);
    expect(evidence).toEqual([]);
    expect(setup).not.toHaveProperty("runtimeCredentialVerification");
  });

  test("stale runner operation cannot emit credential evidence", async () => {
    let reads = 0;
    const evidence: unknown[] = [];
    const setup = { configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, diagnostics: [] };
    const currentOperation = { runner: "opencode" as const, operationId: "opencode-current-operation", explicitlySelected: false };
    const staleOperation = { runner: "opencode" as const, operationId: "opencode-stale-operation", explicitlySelected: false };
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      operationId: currentOperation.operationId,
      currentOperation,
      plan: supermemoryPlan,
      planGeneratedForRevision: 0,
      planRevision: 0,
      adaptiveMemory: { provider: "supermemory", supermemory: setup },
    });

    const results = await runRunnerReviewPlan(supermemoryPlan, {
      dashboardState: state,
      runnerId: "opencode",
      operationId: staleOperation.operationId,
      currentOperation: staleOperation,
      secretStore: { read: () => { reads += 1; return TOKEN_SENTINEL; }, write: () => ({ backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }) },
      onSupermemoryRuntimeCredentialEvidence: (item) => evidence.push(item),
    });

    expect(results).toEqual([]);
    expect(reads).toBe(0);
    expect(evidence).toEqual([]);
    expect(setup).not.toHaveProperty("runtimeCredentialVerification");
  });

  test("stale runner cannot read or emit credential evidence", async () => {
    let reads = 0;
    const evidence: unknown[] = [];
    const setup = { configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, diagnostics: [] };
    const operation = { runner: "opencode" as const, operationId: "opencode-current-operation", explicitlySelected: false };
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      operationId: operation.operationId,
      currentOperation: operation,
      plan: supermemoryPlan,
      planGeneratedForRevision: 0,
      planRevision: 0,
      adaptiveMemory: { provider: "supermemory", supermemory: setup },
    });

    const results = await runRunnerReviewPlan(supermemoryPlan, {
      dashboardState: state,
      runnerId: "codex",
      operationId: operation.operationId,
      secretStore: { read: () => { reads += 1; return TOKEN_SENTINEL; }, write: () => ({ backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }) },
      onSupermemoryRuntimeCredentialEvidence: (item) => evidence.push(item),
    });

    expect(results).toEqual([]);
    expect(reads).toBe(0);
    expect(evidence).toEqual([]);
    expect(setup).not.toHaveProperty("runtimeCredentialVerification");
  });

  test("stale generation before credential read cannot read or emit evidence", async () => {
    let reads = 0;
    const evidence: unknown[] = [];
    const setup = { configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, diagnostics: [] };
    const operation = { runner: "opencode" as const, operationId: "opencode-current-operation", explicitlySelected: false };
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      operationId: operation.operationId,
      currentOperation: operation,
      plan: supermemoryPlan,
      planGeneratedForRevision: 0,
      planRevision: 1,
      adaptiveMemory: { provider: "supermemory", supermemory: setup },
    });

    const results = await runRunnerReviewPlan(supermemoryPlan, {
      dashboardState: state,
      runnerId: "opencode",
      operationId: operation.operationId,
      currentOperation: operation,
      secretStore: { read: () => { reads += 1; return TOKEN_SENTINEL; }, write: () => ({ backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }) },
      onSupermemoryRuntimeCredentialEvidence: (item) => evidence.push(item),
    });

    expect(results).toEqual([]);
    expect(reads).toBe(0);
    expect(evidence).toEqual([]);
    expect(setup).not.toHaveProperty("runtimeCredentialVerification");
  });

  test("stale generation during credential read rejects evidence after the read", async () => {
    let reads = 0;
    const evidence: unknown[] = [];
    const setup = { configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, diagnostics: [] };
    const operation = { runner: "opencode" as const, operationId: "opencode-current-operation", explicitlySelected: false };
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      operationId: operation.operationId,
      currentOperation: operation,
      plan: supermemoryPlan,
      planGeneratedForRevision: 0,
      planRevision: 0,
      adaptiveMemory: { provider: "supermemory", supermemory: setup },
    });

    const results = await runRunnerReviewPlan(supermemoryPlan, {
      dashboardState: state,
      runnerId: "opencode",
      operationId: operation.operationId,
      currentOperation: operation,
      secretStore: { read: () => { reads += 1; state.planRevision = 1; return TOKEN_SENTINEL; }, write: () => ({ backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }) },
      onSupermemoryRuntimeCredentialEvidence: (item) => evidence.push(item),
    });

    expect(results).toEqual([]);
    expect(reads).toBe(1);
    expect(evidence).toEqual([]);
    expect(setup).not.toHaveProperty("runtimeCredentialVerification");
  });

  test("Supermemory runtime credential store read errors block with redacted diagnostics", () => {
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: true, runtimeCredentialStored: true, diagnostics: [] },
      },
    });

    const diagnostics = getRunnerReviewPlanRunBlockDiagnostics(state, { secretStore: { read: () => { throw new Error(`failed to read ${TOKEN_SENTINEL}`); } } });

    expect(diagnostics.join(" ")).toContain("credential could not be read");
    expect(diagnostics.join(" ")).not.toContain(TOKEN_SENTINEL);
  });

  test("keeps MCP OAuth separate while requiring Deck runtime token validation", async () => {
    const order: string[] = [];
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: true, diagnostics: [] },
      },
    });
    expect(getPiRunnerReviewPlanRunBlockDiagnostics(state).join(" ")).toContain("no Deck secret store was available");
    expect(getPiRunnerReviewPlanRunBlockDiagnostics(state, { supermemoryToken: TOKEN_SENTINEL }).join(" ")).toContain("no Deck secret store was available");
    expect(getPiRunnerReviewPlanRunBlockDiagnostics(state, { secretStore: { read: () => TOKEN_SENTINEL } })).toEqual([]);

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
          return { ok: true, path: "/tmp/opencode.json", diagnostics: ["Retired stale Deck-managed OpenCode Supermemory MCP entry 'supermemory'."] };
        },
      },
    );

    expect(writerInput).toEqual({ serverName: "supermemory" });
    expect(writeResult).toMatchObject({ status: "executed" });
    expect(writeResult.message).toContain("Retired stale Deck-managed raw Supermemory MCP entry");
    expect(writeResult.message).not.toContain("Supermemory MCP config written successfully");

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
        supermemoryToken: TOKEN_SENTINEL,
        validateMcpConfig: (input) => {
          order.push("mcp");
          validatorInput = input;
          return { ok: true, diagnostics: [] };
        },
        validateSupermemoryReadOnlyApi: async ({ apiKey }) => {
          order.push("api");
          expect(apiKey).toBe(TOKEN_SENTINEL);
          return { ok: true };
        },
        secretStore: { write: () => { order.push("secret"); return { backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }; }, read: () => undefined },
      },
    );

    expect(validatorInput).toEqual({ serverName: "supermemory" });
    expect(validateResult).toMatchObject({ status: "executed" });
    expect(order).toEqual(["mcp", "api", "secret"]);
    expect(validateResult.message).toContain("Deck runtime API credential was validated and stored");
  });

  test("synthetic Supermemory write-MCP action reports absent-safe without claiming a write", async () => {
    const result = await runPiRunnerAction(
      {
        id: "adaptive-memory.supermemory.opencode-mcp-config",
        kind: "write-mcp-config",
        title: "Write Supermemory OpenCode MCP config",
        status: "ready",
      },
      {
        writeMcpConfig: async () => ({
          ok: true,
          path: "/tmp/opencode.json",
          diagnostics: ["Raw OpenCode Supermemory MCP is absent-safe; no config directory was provided and no user config was inspected or written."],
        }),
      },
    );

    expect(result).toMatchObject({ status: "skipped" });
    expect(result.message).toContain("absent-safe");
    expect(result.message).not.toContain("Supermemory MCP config written successfully");
  });

  test("synthetic Supermemory write-MCP action preserves unmanaged entries without claiming a write", async () => {
    const result = await runPiRunnerAction(
      {
        id: "adaptive-memory.supermemory.opencode-mcp-config",
        kind: "write-mcp-config",
        title: "Write Supermemory OpenCode MCP config",
        status: "ready",
      },
      {
        writeMcpConfig: async () => ({
          ok: false,
          path: "/tmp/opencode.json",
          diagnostics: ["Existing OpenCode Supermemory MCP entry 'supermemory' is unmanaged or ambiguous; Deck left it unchanged and did not authorize raw Supermemory MCP."],
        }),
      },
    );

    expect(result).toMatchObject({ status: "skipped" });
    expect(result.message).toContain("unchanged");
    expect(result.message).not.toContain("Supermemory MCP config written successfully");
  });

  test("native-OAuth OpenCode validation still fails without Deck runtime API key", async () => {
    const order: string[] = [];
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: true, diagnostics: [] },
      },
    });

    const validateResult = await runPiRunnerAction(
      {
        id: "adaptive-memory.supermemory.validate",
        kind: "validate",
        title: "Validate Supermemory OpenCode MCP config",
        status: "ready",
      },
      {
        dashboardState: state,
        validateMcpConfig: () => {
          order.push("mcp");
          return { ok: true, diagnostics: [] };
        },
        validateSupermemoryReadOnlyApi: async () => {
          order.push("api");
          return { ok: true };
        },
        secretStore: { write: () => { order.push("secret"); return { backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }; }, read: () => undefined },
      },
    );

    expect(validateResult.status).toBe("failed");
    expect(String(validateResult.message)).toContain("runtime API key is required");
    expect(String(validateResult.message)).toContain("runner-native MCP OAuth does not make Deck runtime-ready");
    expect(order).toEqual(["mcp"]);
  });

  test("Supermemory validation does not require raw OpenCode MCP when Deck Runtime credential is present", async () => {
    const order: string[] = [];
    const state = createDefaultPiRunnerDashboardState({
      runnerScope: "opencode",
      runnerUi: getAdapter("opencode").ui,
      adaptiveMemory: {
        provider: "supermemory",
        supermemory: { configured: true, hasToken: true, diagnostics: [] },
      },
    });

    const validateResult = await runPiRunnerAction(
      {
        id: "adaptive-memory.supermemory.validate",
        kind: "validate",
        title: "Validate Supermemory provider configuration",
        status: "ready",
      },
      {
        dashboardState: state,
        supermemoryToken: TOKEN_SENTINEL,
        validateSupermemoryReadOnlyApi: async ({ apiKey }) => {
          order.push("api");
          expect(apiKey).toBe(TOKEN_SENTINEL);
          return { ok: true };
        },
        secretStore: { write: () => { order.push("secret"); return { backend: "owner-only-file", path: "/tmp/secret", limitation: "test" }; }, read: () => undefined },
      },
    );

    expect(validateResult).toMatchObject({ status: "executed" });
    expect(validateResult.message).toContain("Deck runtime API credential was validated and stored");
    expect(validateResult.message).not.toContain("MCP config validated");
    expect(order).toEqual(["api", "secret"]);
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
