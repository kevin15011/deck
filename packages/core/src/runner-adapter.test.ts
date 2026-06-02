/**
 * Unit tests for the `RunnerAdapter` detection facet added by T2.9.
 *
 * Validates that:
 *   - The optional `detectDeckInstall` method slot exists in the interface.
 *   - Adapters that omit it remain valid.
 *   - A fake adapter that implements the method returns the expected status.
 */

import { describe, expect, it } from "bun:test";

import type { RunnerAdapter, RunnerDeckInstallInput, RunnerDeckInstallStatus } from "./runner-adapter";

describe("runner-adapter / detection facet (T2.9)", () => {
  it("accepts an adapter that omits detectDeckInstall", () => {
    const adapter: RunnerAdapter = {
      runnerId: "stub-no-detect",
      displayName: "Stub (no detection)",
      environmentIds: ["stub-development"],
      detectRuntimes: async () => [],
      getCapabilityInventory: async () => ({
        capabilities: [],
        runnerId: "stub-no-detect",
        environmentId: "stub-development",
      }),
      buildReviewPlan: () => ({
        groups: {
          automaticInstalls: [],
          manualSteps: [],
          configWrites: [],
          teamApplications: [],
          validations: [],
        },
        diagnostics: [],
        ready: true,
      }),
      buildInstallationPlan: () => ({ steps: [] }),
      runAction: async () => ({
        actionId: "x",
        status: "skipped",
        message: "",
        diagnostics: [],
      }),
      getTeams: () => [],
      getModelCatalog: () => ({ providers: [], models: [], developerTeamDefaults: [] }),
      readModelAssignments: () => ({}),
      readThinkingAssignments: () => ({}),
      getThinkingLevels: () => [],
      supportsThinking: () => false,
      buildDeveloperTeamInstallPlan: () => ({ files: [] }),
      applyDeveloperTeamInstall: async () => ({ results: [], changedCount: 0, unchangedCount: 0 }),
      inspectEnvironment: async () => ({}),
      reviewTools: async () => ({}),
      backupDeveloperTeamFiles: () => ({}),
      rollbackDeveloperTeamFiles: () => undefined,
      verifyDeveloperTeamInstall: () => ({ valid: true, diagnostics: [] }),
      resolveThinking: () => undefined,
      getDefaultThinking: () => "off",
      getCapability: () => undefined,
      getCapabilityIds: () => [],
      getSelectableTools: () => [],
      getNextScreen: () => "complete",
    };
    // The omission is the contract — this must type-check.
    expect(adapter.detectDeckInstall).toBeUndefined();
  });

  it("accepts an adapter that implements detectDeckInstall", async () => {
    const status: RunnerDeckInstallStatus = {
      installed: true,
      managedPaths: ["/tmp/.config/opencode/AGENTS.md"],
      diagnostics: ["found deck-managed AGENTS.md"],
    };

    const adapter: RunnerAdapter = {
      runnerId: "stub-with-detect",
      displayName: "Stub (with detection)",
      environmentIds: ["stub-development"],
      detectRuntimes: async () => [],
      getCapabilityInventory: async () => ({
        capabilities: [],
        runnerId: "stub-with-detect",
        environmentId: "stub-development",
      }),
      buildReviewPlan: () => ({
        groups: {
          automaticInstalls: [],
          manualSteps: [],
          configWrites: [],
          teamApplications: [],
          validations: [],
        },
        diagnostics: [],
        ready: true,
      }),
      buildInstallationPlan: () => ({ steps: [] }),
      runAction: async () => ({
        actionId: "x",
        status: "skipped",
        message: "",
        diagnostics: [],
      }),
      getTeams: () => [],
      getModelCatalog: () => ({ providers: [], models: [], developerTeamDefaults: [] }),
      readModelAssignments: () => ({}),
      readThinkingAssignments: () => ({}),
      getThinkingLevels: () => [],
      supportsThinking: () => false,
      buildDeveloperTeamInstallPlan: () => ({ files: [] }),
      applyDeveloperTeamInstall: async () => ({ results: [], changedCount: 0, unchangedCount: 0 }),
      inspectEnvironment: async () => ({}),
      reviewTools: async () => ({}),
      backupDeveloperTeamFiles: () => ({}),
      rollbackDeveloperTeamFiles: () => undefined,
      verifyDeveloperTeamInstall: () => ({ valid: true, diagnostics: [] }),
      resolveThinking: () => undefined,
      getDefaultThinking: () => "off",
      getCapability: () => undefined,
      getCapabilityIds: () => [],
      getSelectableTools: () => [],
      getNextScreen: () => "complete",
      detectDeckInstall: async (_input: RunnerDeckInstallInput) => status,
    };

    expect(adapter.detectDeckInstall).toBeDefined();
    const result = await adapter.detectDeckInstall!({});
    expect(result.installed).toBe(true);
    expect(result.managedPaths).toContain("/tmp/.config/opencode/AGENTS.md");
  });
});
