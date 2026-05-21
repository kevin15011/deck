import { describe, expect, test } from "bun:test";
import { createRunnerCapabilityRegistry, createMemoryProviders, type MemoryProviderRegistration, type RunnerCapabilityCatalog } from "./runner-capability-registry";
import { createEngramMemoryProvider } from "@deck/adapter-engram";

describe("runner-capability-registry", () => {
  describe("createMemoryProviders", () => {
    test("creates engram memory provider", () => {
      const providers = createMemoryProviders();
      const engram = providers.find((p) => p.id === "engram");
      expect(engram).toBeDefined();
      expect(engram?.id).toBe("engram");
      expect(engram?.displayName).toContain("Engram");
    });

    test("creates supermemory memory provider factory", () => {
      const providers = createMemoryProviders();
      const supermemoryFactory = providers.find((p) => p.id === "supermemory");
      expect(supermemoryFactory).toBeDefined();
      expect(supermemoryFactory?.id).toBe("supermemory");
    });

    test("returns array of memory provider registrations", () => {
      const providers = createMemoryProviders();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThanOrEqual(2);
    });

    test("each provider has required metadata fields", () => {
      const providers = createMemoryProviders();
      for (const provider of providers) {
        expect(typeof provider.id).toBe("string");
        expect(provider.id.length).toBeGreaterThan(0);
        expect(typeof provider.displayName).toBe("string");
      }
    });
  });

  describe("createRunnerCapabilityRegistry", () => {
    test("creates registry with pi runner capabilities", () => {
      const catalog = createRunnerCapabilityRegistry();
      const pi = catalog.runners["pi"];

      expect(pi).toBeDefined();
      expect(pi.id).toBe("pi");
      expect(pi.displayName).toBe("Pi");
      expect(typeof pi.inspectEnvironment).toBe("function");
      expect(pi.environments).toContainEqual(expect.objectContaining({ id: "pi-development" }));
    });

    test("creates registry with opencode runner capabilities", () => {
      const catalog = createRunnerCapabilityRegistry();
      const opencode = catalog.runners["opencode"];

      expect(opencode).toBeDefined();
      expect(opencode.id).toBe("opencode");
      expect(opencode.displayName).toBe("OpenCode");
      expect(typeof opencode.inspectEnvironment).toBe("function");
      expect(opencode.environments).toContainEqual(expect.objectContaining({ id: "opencode-development" }));
    });

    test("catalog contains both runners", () => {
      const catalog = createRunnerCapabilityRegistry();
      const runnerIds = Object.keys(catalog.runners);

      expect(runnerIds).toContain("pi");
      expect(runnerIds).toContain("opencode");
      expect(runnerIds.length).toBe(2);
    });

    test("each runner has all required capability facets", () => {
      const catalog = createRunnerCapabilityRegistry();

      for (const runner of Object.values(catalog.runners)) {
        expect(runner).toHaveProperty("tools");
        expect(runner).toHaveProperty("teams");
        expect(runner).toHaveProperty("models");
        expect(runner).toHaveProperty("memory");

        // Tool capabilities
        expect(typeof runner.tools.buildInstallationPlan).toBe("function");
        expect(typeof runner.tools.installTools).toBe("function");
        expect(typeof runner.tools.reviewTools).toBe("function");

        // Team capabilities
        expect(typeof runner.teams.getTeamsForEnvironment).toBe("function");
        expect(typeof runner.teams.buildDeveloperTeamManifest).toBe("function");
        expect(typeof runner.teams.buildDeveloperTeamInstallPlan).toBe("function");
        expect(typeof runner.teams.applyDeveloperTeamInstall).toBe("function");
        expect(typeof runner.teams.verifyDeveloperTeamInstall).toBe("function");

        // Model capabilities
        expect(typeof runner.models.getCatalog).toBe("function");
        expect(typeof runner.models.readAssignments).toBe("function");
        expect(typeof runner.models.resolveAssignment).toBe("function");

        // Memory capabilities
        expect(typeof runner.memory.getProviders).toBe("function");
        expect(typeof runner.memory.getSupportedProviderIds).toBe("function");
      }
    });

    test("each runner returns supported provider IDs", () => {
      const catalog = createRunnerCapabilityRegistry();

      for (const runner of Object.values(catalog.runners)) {
        const supportedIds = runner.memory.getSupportedProviderIds();
        expect(Array.isArray(supportedIds)).toBe(true);
        expect(supportedIds).toContain("engram");
        expect(supportedIds).toContain("supermemory");
      }
    });

    test("catalog exposes runner IDs", () => {
      const catalog = createRunnerCapabilityRegistry();
      expect(catalog.runnerIds).toEqual(["pi", "opencode"]);
    });

    test("catalog exposes memory provider registrations", () => {
      const catalog = createRunnerCapabilityRegistry();
      expect(Array.isArray(catalog.memoryProviders)).toBe(true);
      expect(catalog.memoryProviders.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("memory provider registration", () => {
    test("memory providers are registered with engram and supermemory IDs", () => {
      const providers = createMemoryProviders();
      const ids = providers.map((p) => p.id);

      expect(ids).toContain("engram");
      expect(ids).toContain("supermemory");
    });

    test("engram provider can be created without config", () => {
      const engram = createEngramMemoryProvider();
      expect(engram.id).toBe("engram");
      expect(typeof engram.buildInjection).toBe("function");
    });
  });

  describe("catalog lookup", () => {
    test("getRunner returns runner by ID", () => {
      const catalog = createRunnerCapabilityRegistry();
      const pi = catalog.getRunner("pi");

      expect(pi).toBeDefined();
      expect(pi?.id).toBe("pi");
    });

    test("getRunner returns undefined for unknown runner", () => {
      const catalog = createRunnerCapabilityRegistry();
      const unknown = catalog.getRunner("unknown");

      expect(unknown).toBeUndefined();
    });

    test("hasRunner returns true for known runner", () => {
      const catalog = createRunnerCapabilityRegistry();
      expect(catalog.hasRunner("pi")).toBe(true);
      expect(catalog.hasRunner("opencode")).toBe(true);
    });

    test("hasRunner returns false for unknown runner", () => {
      const catalog = createRunnerCapabilityRegistry();
      expect(catalog.hasRunner("unknown")).toBe(false);
    });
  });
});