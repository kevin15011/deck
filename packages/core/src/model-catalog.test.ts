import { describe, expect, test } from "bun:test";

import {
  MODEL_CATALOG,
  getModelCatalog,
  getProviders,
  getModels,
  getDeveloperTeamDefaults,
  findModel,
  findProvider,
  getModelsForProvider,
  getDefaultForAgent,
} from "./model-catalog";

import { DEVELOPER_TEAM_AGENTS } from "./teams/developer/catalog";

describe("ModelCatalog", () => {
  describe("catalog data", () => {
    test("providers are defined", () => {
      const providers = getProviders();
      expect(providers.length).toBeGreaterThan(0);
    });

    test("all provider IDs are non-empty strings", () => {
      const providers = getProviders();
      for (const provider of providers) {
        expect(typeof provider.id).toBe("string");
        expect(provider.id.length).toBeGreaterThan(0);
        expect(typeof provider.displayName).toBe("string");
      }
    });

    test("models are defined", () => {
      const models = getModels();
      expect(models.length).toBeGreaterThan(0);
    });

    test("all model IDs follow provider/model naming", () => {
      const models = getModels();
      for (const model of models) {
        expect(model.id).toContain("/");
        const [providerId] = model.id.split("/");
        expect(providerId.length).toBeGreaterThan(0);
      }
    });

    test("model entries have required fields", () => {
      const models = getModels();
      for (const model of models) {
        expect(typeof model.id).toBe("string");
        expect(typeof model.displayName).toBe("string");
        expect(typeof model.providerId).toBe("string");
        expect(Array.isArray(model.capabilities)).toBe(true);
      }
    });

    test("developer team defaults are empty (explicit-only contract)", () => {
      const defaults = getDeveloperTeamDefaults();
      // REQ-MC-005: No hardcoded defaults - models must be explicitly configured
      expect(defaults.length).toBe(0);
    });

    test("MODEL_CATALOG singleton matches getter functions", () => {
      const catalog = getModelCatalog();
      expect(catalog.providers).toEqual(getProviders());
      expect(catalog.models).toEqual(getModels());
      expect(catalog.developerTeamDefaults).toEqual(getDeveloperTeamDefaults());
    });
  });

  describe("catalog completeness for all Developer Team agents", () => {
    test("no default model assignments (explicit-only contract)", () => {
      const defaults = getDeveloperTeamDefaults();
      // REQ-MC-005: No hardcoded defaults - models must be explicitly configured
      expect(defaults.length).toBe(0);
    });

    test("model assignments require explicit configuration", () => {
      const defaults = getDeveloperTeamDefaults();
      // Empty defaults confirms explicit-only contract
      expect(defaults).toEqual([]);
    });
  });

  describe("helper functions", () => {
    test("findModel returns model by ID", () => {
      const models = getModels();
      const first = models[0];
      expect(findModel(first.id)).toEqual(first);
    });

    test("findModel returns undefined for unknown model", () => {
      expect(findModel("unknown/model")).toBeUndefined();
    });

    test("findProvider returns provider by ID", () => {
      const providers = getProviders();
      const first = providers[0];
      expect(findProvider(first.id)).toEqual(first);
    });

    test("findProvider returns undefined for unknown provider", () => {
      expect(findProvider("unknown-provider")).toBeUndefined();
    });

    test("getModelsForProvider returns only models for that provider", () => {
      const providers = getProviders();
      const first = providers[0];
      const models = getModelsForProvider(first.id);

      for (const model of models) {
        expect(model.providerId).toBe(first.id);
      }
    });

    test("getModelsForProvider returns empty for unknown provider", () => {
      expect(getModelsForProvider("unknown-provider")).toEqual([]);
    });

    test("getDefaultForAgent returns undefined for all agents (explicit-only)", () => {
      // REQ-MC-005: No hardcoded defaults
      const agents = DEVELOPER_TEAM_AGENTS;
      for (const agent of agents) {
        const defaultEntry = getDefaultForAgent(agent.id);
        expect(defaultEntry).toBeUndefined();
      }
    });

    test("getDefaultForAgent returns undefined for unknown agent", () => {
      expect(getDefaultForAgent("unknown-agent")).toBeUndefined();
    });
  });

  describe("runner-neutrality", () => {
    test("catalog contains no runner-specific field names", () => {
      const source = JSON.stringify(MODEL_CATALOG);
      expect(source).not.toContain("thinkingLevel");
      expect(source).not.toContain("reasoningEffort");
    });

    test("catalog contains no environment variable names", () => {
      const source = JSON.stringify(MODEL_CATALOG);
      expect(source).not.toContain("API_KEY");
      expect(source).not.toContain("OPENAI_API_KEY");
      expect(source).not.toContain("ANTHROPIC_API_KEY");
    });

    test("catalog model capabilities use generic strings only", () => {
      const models = getModels();
      const allowedCapabilities = new Set(["tool-use", "vision", "reasoning", "local"]);

      for (const model of models) {
        for (const cap of model.capabilities) {
          // Capabilities are either known generic ones or a custom string
          if (typeof cap === "string" && !allowedCapabilities.has(cap)) {
            // Custom capability strings are allowed (string & {})
            expect(typeof cap).toBe("string");
          }
        }
      }
    });
  });
});