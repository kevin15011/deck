import { describe, it, expect } from "bun:test";
import type { RunnerCapabilities } from "./runner-capability";
import { validateRunnerCapabilities } from "./runner-capability-validation";
import { createOpenCodeRunnerCapabilities } from "../../adapter-opencode/src/runner-capabilities";
import { createPiRunnerCapabilities } from "../../adapter-pi/src/runner-capabilities";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal complete adapter — all required capabilities present */
function makeCompleteAdapter(): RunnerCapabilities {
  return {
    id: "test",
    displayName: "Test Runner",
    environments: [],
    inspectEnvironment: async () => ({ environmentId: "test", isConfigured: true }),
    tools: {
      buildInstallationPlan: () => ({ steps: [] }),
      installTools: async () => ({ installed: false }),
      reviewTools: async () => ({ tools: [], missing: [] }),
    },
    teams: {
      getTeamsForEnvironment: () => [],
      buildDeveloperTeamManifest: () => {
        throw new Error("not implemented");
      },
      buildDeveloperTeamInstallPlan: () => ({ files: [] }),
      applyDeveloperTeamInstall: async () => ({ success: false }),
      verifyDeveloperTeamInstall: async () => ({ isInstalled: false }),
    },
    models: {
      getCatalog: () => ({ providers: [], agents: [], models: [], developerTeamDefaults: [] }),
      readAssignments: () => ({ assignments: [] }),
      resolveAssignment: () => ({ agentId: "", modelId: "" }),
    },
    memory: {
      getProviders: () => [],
      getSupportedProviderIds: () => [],
    },
  };
}

/** Adapter missing a required capability */
function makeAdapterMissingRequired(key: keyof RunnerCapabilities): RunnerCapabilities {
  const adapter = makeCompleteAdapter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (adapter as any)[key];
  return adapter;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateRunnerCapabilities", () => {
  describe("adapter completo → isValid: true", () => {
    it("returns isValid: true when all required capabilities are present", () => {
      const adapter = makeCompleteAdapter();
      const result = validateRunnerCapabilities(adapter);
      expect(result.isValid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });
  });

  describe("capacidad obligatoria faltante → isValid: false, missing incluye la key", () => {
    it("returns isValid: false with missing key when a required capability is absent", () => {
      const adapter = makeAdapterMissingRequired("tools");
      const result = validateRunnerCapabilities(adapter);
      expect(result.isValid).toBe(false);
      expect(result.missing).toContain("tools");
    });

    it("returns isValid: false when id capability is missing", () => {
      const adapter = makeAdapterMissingRequired("id");
      const result = validateRunnerCapabilities(adapter);
      expect(result.isValid).toBe(false);
      expect(result.missing).toContain("id");
    });
  });

  describe("múltiples capacidades faltantes → missing incluye todas", () => {
    it("reports all missing required capabilities", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adapter = makeCompleteAdapter() as any;
      delete adapter.id;
      delete adapter.displayName;
      delete adapter.environments;

      const result = validateRunnerCapabilities(adapter);
      expect(result.isValid).toBe(false);
      expect(result.missing).toContain("id");
      expect(result.missing).toContain("displayName");
      expect(result.missing).toContain("environments");
    });
  });

  describe("capacidad opcional ausente → isValid: true, warnings incluye la key", () => {
    it("returns isValid: true with warning when an optional capability is absent", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adapter = makeCompleteAdapter() as any;
      delete adapter.install;
      delete adapter.developerTeam;

      const result = validateRunnerCapabilities(adapter);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("install");
      expect(result.warnings).toContain("developerTeam");
    });
  });

  describe("no mutación del objeto de entrada", () => {
    it("does not mutate the input capabilities object", () => {
      const adapter = makeCompleteAdapter();
      const jsonBefore = JSON.stringify(adapter);
      validateRunnerCapabilities(adapter);
      const jsonAfter = JSON.stringify(adapter);
      expect(jsonAfter).toBe(jsonBefore);
    });
  });

  describe("test contra adapter OpenCode (createOpenCodeRunnerCapabilities)", () => {
    it("opencode adapter is valid", () => {
      const adapter = createOpenCodeRunnerCapabilities();
      const result = validateRunnerCapabilities(adapter);
      expect(result.isValid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });
  });

  describe("test contra adapter PI (createPiRunnerCapabilities)", () => {
    it("pi adapter is valid", () => {
      const adapter = createPiRunnerCapabilities();
      const result = validateRunnerCapabilities(adapter);
      expect(result.isValid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });
  });
});