/**
 * Unit tests for the `RunnerAdapter` detection facet added by T2.9.
 *
 * Validates that:
 *   - The optional `detectDeckInstall` method slot exists in the interface.
 *   - Adapters that omit it remain valid.
 *   - A fake adapter that implements the method returns the expected status.
 */

import { describe, expect, it } from "bun:test";

import {
  isSerenaReadinessEvidence,
  isSuccessfulSerenaBootstrapResult,
  revalidateSerenaReadiness,
  runEvidenceGatedSerenaWriter,
  validateSerenaOperationAuthorization,
  type RunnerAdapter,
  type RunnerDeckInstallInput,
  type RunnerDeckInstallStatus,
  type SerenaMcpWriteResult,
  type SerenaReadinessEvidence,
  type SerenaReadinessRevalidator,
} from "./runner-adapter";

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

  it("accepts valid current-operation authorization and rejects default, runner, and stale identities", () => {
    const authorization = {
      kind: "interactive-tui-explicit-selection" as const,
      runner: "opencode" as const,
      operationId: "operation-1",
    };

    expect(
      validateSerenaOperationAuthorization(authorization, {
        runner: "opencode",
        operationId: "operation-1",
        explicitlySelected: true,
      }),
    ).toEqual({ valid: true, authorization });
    expect(
      validateSerenaOperationAuthorization(authorization, {
        runner: "pi",
        operationId: "operation-1",
        explicitlySelected: true,
      }).valid,
    ).toBe(false);
    expect(
      validateSerenaOperationAuthorization(authorization, {
        runner: "opencode",
        operationId: "operation-2",
        explicitlySelected: true,
      }).valid,
    ).toBe(false);
    expect(
      validateSerenaOperationAuthorization(
        { kind: "default-selection" },
        { runner: "opencode", operationId: "operation-1", explicitlySelected: true },
      ).valid,
    ).toBe(false);
  });

  it("accepts only contained ready Serena evidence and rejects stale or unsafe evidence", () => {
    const evidence: SerenaReadinessEvidence = {
      capabilityId: "serena",
      state: "ready",
      resolvedExecutablePath: "/fixtures/deck-data/tools/serena/bin/serena",
      source: "existing-deck-tool",
      probe: "serena-help",
      fingerprint: "fingerprint-1",
    };

    expect(isSerenaReadinessEvidence(evidence, "/fixtures/deck-data/tools/serena")).toBe(true);
    expect(
      isSerenaReadinessEvidence(
        { ...evidence, capabilityId: "other" },
        "/fixtures/deck-data/tools/serena",
      ),
    ).toBe(false);
    expect(
      isSerenaReadinessEvidence(
        { ...evidence, resolvedExecutablePath: "relative/serena" },
        "/fixtures/deck-data/tools/serena",
      ),
    ).toBe(false);
    expect(
      isSerenaReadinessEvidence(
        { ...evidence, resolvedExecutablePath: "/fixtures/deck-data/tools/serena/bin/../escape" },
        "/fixtures/deck-data/tools/serena",
      ),
    ).toBe(false);
    expect(
      isSerenaReadinessEvidence(
        { ...evidence, fingerprint: "" },
        "/fixtures/deck-data/tools/serena",
      ),
    ).toBe(false);
    expect(
      isSuccessfulSerenaBootstrapResult(
        { outcome: "failed", evidence } as unknown,
        "/fixtures/deck-data/tools/serena",
      ),
    ).toBe(false);
    expect(
      isSuccessfulSerenaBootstrapResult(
        { outcome: "cancelled", evidence } as unknown,
        "/fixtures/deck-data/tools/serena",
      ),
    ).toBe(false);
    expect(
      isSuccessfulSerenaBootstrapResult(
        { outcome: "partial", evidence } as unknown,
        "/fixtures/deck-data/tools/serena",
      ),
    ).toBe(false);
  });

  it("keeps revalidation and writer results typed, including unchanged no-op results", async () => {
    const readiness: SerenaReadinessEvidence = {
      capabilityId: "serena",
      state: "ready",
      resolvedExecutablePath: "/fixtures/deck-data/tools/serena/bin/serena",
      source: "installed-deck-tool",
      probe: "serena-help",
      fingerprint: "fingerprint-2",
    };
    const revalidate: SerenaReadinessRevalidator = async (evidence) => ({
      valid: true,
      evidence,
    });
    const unchanged: SerenaMcpWriteResult = { ok: true, status: "unchanged" };
    const updated: SerenaMcpWriteResult = { ok: true, status: "updated" };
    const created: SerenaMcpWriteResult = { ok: true, status: "created" };

    await expect(revalidate(readiness)).resolves.toEqual({ valid: true, evidence: readiness });
    expect(unchanged).toEqual({ ok: true, status: "unchanged" });
    expect(updated.status).toBe("updated");
    expect(created.status).toBe("created");

    const stale = await revalidateSerenaReadiness(
      readiness,
      async (current) => ({
        valid: true,
        evidence: { ...current, fingerprint: "changed-fingerprint" },
      }),
      "/fixtures/deck-data/tools/serena",
    );
    expect(stale).toMatchObject({ valid: false, code: "stale-readiness-evidence" });

    let writerCalls = 0;
    const writerInput = {
      authorization: {
        kind: "interactive-tui-explicit-selection" as const,
        runner: "opencode" as const,
        operationId: "operation-1",
      },
      operation: {
        runner: "opencode" as const,
        operationId: "operation-1",
        explicitlySelected: true,
      },
      readiness,
      command: readiness.resolvedExecutablePath,
      args: ["start-mcp-server", "--context", "ide", "--project-from-cwd"] as const,
      revalidate,
    };
    const writerResult = await runEvidenceGatedSerenaWriter(
      writerInput,
      async () => {
        writerCalls += 1;
        return unchanged;
      },
      "/fixtures/deck-data/tools/serena",
    );
    expect(writerResult).toEqual(unchanged);
    expect(writerCalls).toBe(1);

    const blockedWriterResult = await runEvidenceGatedSerenaWriter(
      { ...writerInput, args: ["serena"] },
      async () => {
        writerCalls += 1;
        return created;
      },
      "/fixtures/deck-data/tools/serena",
    );
    expect(blockedWriterResult.ok).toBe(false);
    expect(writerCalls).toBe(1);
  });
});
