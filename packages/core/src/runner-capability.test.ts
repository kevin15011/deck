import { describe, expect, test } from "bun:test";

import type {
  RunnerCapabilities,
  RunnerId,
  RunnerEnvironmentId,
  RunnerEnvironment,
  RunnerEnvironmentInspectInput,
  RunnerEnvironmentInspection,
  RunnerToolCapabilities,
  RunnerTeamCapabilities,
  RunnerModelCapabilities,
  RunnerMemoryCapabilities,
  ReasoningLevel,
  ModelCatalog,
  ModelCatalogEntry,
  ModelProviderEntry,
  DeveloperTeamDefaultModelAssignment,
} from "./runner-capability";

describe("RunnerCapabilities core types", () => {
  describe("type exports exist and are well-structured", () => {
    test("RunnerId is a string type alias", () => {
      const runnerId: RunnerId = "test-runner";
      expect(typeof runnerId).toBe("string");
    });

    test("RunnerEnvironmentId is a string type alias", () => {
      const envId: RunnerEnvironmentId = "test-environment";
      expect(typeof envId).toBe("string");
    });

    test("ReasoningLevel covers all expected levels", () => {
      const levels: ReasoningLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
      expect(levels).toHaveLength(6);
    });

    test("ModelCatalogEntry has required fields", () => {
      const entry: ModelCatalogEntry = {
        id: "test/model",
        displayName: "Test Model",
        providerId: "test-provider",
        capabilities: ["tool-use"],
        supportsReasoning: true,
      };

      expect(entry.id).toBe("test/model");
      expect(entry.displayName).toBe("Test Model");
      expect(entry.providerId).toBe("test-provider");
      expect(entry.capabilities).toContain("tool-use");
      expect(entry.supportsReasoning).toBe(true);
    });

    test("ModelProviderEntry has required fields", () => {
      const entry: ModelProviderEntry = {
        id: "test-provider",
        displayName: "Test Provider",
      };

      expect(entry.id).toBe("test-provider");
      expect(entry.displayName).toBe("Test Provider");
    });

    test("DeveloperTeamDefaultModelAssignment has required fields", () => {
      const entry: DeveloperTeamDefaultModelAssignment = {
        agentId: "deck-developer-orchestrator",
        modelId: "test/model",
        reasoning: "high",
      };

      expect(entry.agentId).toBe("deck-developer-orchestrator");
      expect(entry.modelId).toBe("test/model");
      expect(entry.reasoning).toBe("high");
    });

    test("ModelCatalog is an object with providers, models, and defaults", () => {
      const catalog: ModelCatalog = {
        providers: [{ id: "test-provider", displayName: "Test" }],
        models: [{ id: "test/model", displayName: "Test", providerId: "test-provider", capabilities: [] }],
        developerTeamDefaults: [],
      };

      expect(catalog.providers).toHaveLength(1);
      expect(catalog.models).toHaveLength(1);
      expect(Array.isArray(catalog.developerTeamDefaults)).toBe(true);
    });
  });

  describe("RunnerCapabilities aggregate structure", () => {
    test("RunnerCapabilities interface requires id, displayName, environments, and all facets", () => {
      const capabilities: RunnerCapabilities = {
        id: "test-runner",
        displayName: "Test Runner",
        environments: [{ id: "test-env", displayName: "Test Environment" }],
        inspectEnvironment: async () => ({ environmentId: "test-env", isConfigured: true }),
        tools: {
          buildInstallationPlan: () => ({ steps: [] }),
          installTools: async () => ({ installed: false }),
          reviewTools: async () => ({ tools: [], missing: [] }),
        },
        teams: {
          getTeamsForEnvironment: () => [],
          buildDeveloperTeamManifest: () => ({
            team: { id: "developer-team", displayName: "Developer Team" },
            agents: [],
            skills: [],
            memoryDiagnostics: [],
          }),
          buildDeveloperTeamInstallPlan: () => ({ files: [] }),
          applyDeveloperTeamInstall: async () => ({ success: true }),
          verifyDeveloperTeamInstall: async () => ({ isInstalled: false }),
        },
        models: {
          getCatalog: () => ({ providers: [], models: [], developerTeamDefaults: [] }),
          readAssignments: () => ({ assignments: [] }),
          resolveAssignment: () => ({ agentId: "test", modelId: "test/model" }),
        },
        memory: {
          getProviders: () => [],
          getSupportedProviderIds: () => [],
        },
      };

      expect(capabilities.id).toBe("test-runner");
      expect(capabilities.displayName).toBe("Test Runner");
      expect(capabilities.environments).toHaveLength(1);
      expect(typeof capabilities.inspectEnvironment).toBe("function");
      expect(typeof capabilities.tools.buildInstallationPlan).toBe("function");
      expect(typeof capabilities.teams.getTeamsForEnvironment).toBe("function");
      expect(typeof capabilities.models.getCatalog).toBe("function");
      expect(typeof capabilities.memory.getProviders).toBe("function");
    });
  });
});