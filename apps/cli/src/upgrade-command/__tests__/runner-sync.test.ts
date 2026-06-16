/**
 * Unit tests for runner-sync — content-only re-apply of Deck-managed
 * artifacts to installed runners.
 */

import { describe, expect, it } from "bun:test";

import { getDefaultDeckConfig, type RunnerAdapter } from "@deck/core";

import {
  applyRunnerSyncToManifest,
  runRunnerSync,
  type RunnerSyncAdapterRegistry,
} from "../runner-sync.js";
import { buildDefaultManifest } from "../manifest-store.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: {
  opencode?: Record<string, boolean>;
  pi?: Record<string, boolean>;
} = {}) {
  const base = getDefaultDeckConfig();
  base.packageInstructions.opencode = {
    "codebase-memory": false,
    "context-mode": false,
    rtk: false,
    "adaptive-memory": false,
    serena: false,
    "code-economy": false,
    ...(overrides.opencode ?? {}),
  };
  base.packageInstructions.pi = {
    "codebase-memory": false,
    "context-mode": false,
    rtk: false,
    "adaptive-memory": false,
    serena: false,
    "code-economy": false,
    ...(overrides.pi ?? {}),
  };
  return base;
}

function makeAdapter(overrides: Partial<RunnerAdapter> = {}): RunnerAdapter {
  return {
    runnerId: "opencode",
    displayName: "Test Runner",
    environmentIds: ["opencode-development"],
    detectRuntimes: async () => [],
    getCapabilityInventory: async () => ({
      capabilities: [],
      runnerId: "test-runner",
      environmentId: "test-development",
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
    getModelCatalog: () => ({ providers: [], models: [], defaultAssignments: [] }) as unknown as import("@deck/core").ModelCatalog,
    readModelAssignments: () => ({}),
    readThinkingAssignments: () => ({}),
    getThinkingLevels: () => [],
    supportsThinking: () => false,
    buildDeveloperTeamInstallPlan: () => ({
      files: [{ path: "/tmp/.config/test-runner/AGENTS.md", content: "ok" }],
    }),
    applyDeveloperTeamInstall: async () => ({
      results: [
        { agentId: "x", kind: "skill", status: "unchanged" },
      ],
      changedCount: 0,
      unchangedCount: 1,
    }),
    inspectEnvironment: async () => ({}),
    reviewTools: async () => ({}),
    backupDeveloperTeamFiles: () => ({ snapshot: "v1" }),
    rollbackDeveloperTeamFiles: () => undefined,
    verifyDeveloperTeamInstall: () => ({ valid: true, diagnostics: [] }),
    resolveThinking: () => undefined,
    getDefaultThinking: () => "off",
    getCapability: () => undefined,
    getCapabilityIds: () => [],
    getSelectableTools: () => [],
    getNextScreen: () => "complete",
    ...overrides,
  };
}

function makeRegistry(adapters: RunnerAdapter[]): RunnerSyncAdapterRegistry {
  return {
    list: () => adapters,
    has: (id) => adapters.some((a) => a.runnerId === id),
    get: (id) => {
      const a = adapters.find((x) => x.runnerId === id);
      if (!a) throw new Error(`No adapter registered for ${id}`);
      return a;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runner-sync", () => {
  it("skips adapters that do not implement detectDeckInstall", async () => {
    const adapter = makeAdapter(); // no detectDeckInstall
    const config = makeConfig({ opencode: { "codebase-memory": true } });
    const result = await runRunnerSync({
      config,
      registry: makeRegistry([adapter]),
      projectRoot: "/tmp",
      deckVersion: "1.0.0",
      runnerIds: ["opencode"],
    });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.status).toBe("skipped");
    expect(result.outcomes[0]?.skippedReason).toBe("not-detected");
  });

  it("skips adapters that return installed=false", async () => {
    const adapter = makeAdapter({
      detectDeckInstall: async () => ({ installed: false, managedPaths: [] }),
    });
    const config = makeConfig({ opencode: { "codebase-memory": true } });
    const result = await runRunnerSync({
      config,
      registry: makeRegistry([adapter]),
      projectRoot: "/tmp",
      deckVersion: "1.0.0",
      runnerIds: ["opencode"],
    });
    expect(result.outcomes[0]?.status).toBe("skipped");
    expect(result.outcomes[0]?.skippedReason).toBe("not-detected");
  });

  it("skips when the user has no enabled package instructions", async () => {
    const adapter = makeAdapter({
      detectDeckInstall: async () => ({
        installed: true,
        managedPaths: ["/tmp/.config/opencode/AGENTS.md"],
      }),
    });
    const config = makeConfig(); // nothing enabled
    const result = await runRunnerSync({
      config,
      registry: makeRegistry([adapter]),
      projectRoot: "/tmp",
      deckVersion: "1.0.0",
      runnerIds: ["opencode"],
    });
    expect(result.outcomes[0]?.status).toBe("skipped");
    expect(result.outcomes[0]?.skippedReason).toBe("no-selections");
  });

  it("syncs when the runner is detected and selections are enabled", async () => {
    const adapter = makeAdapter({
      detectDeckInstall: async () => ({
        installed: true,
        managedPaths: ["/tmp/.config/opencode/AGENTS.md"],
      }),
    });
    const config = makeConfig({ opencode: { "codebase-memory": true } });
    const result = await runRunnerSync({
      config,
      registry: makeRegistry([adapter]),
      projectRoot: "/tmp",
      deckVersion: "1.0.0",
      runnerIds: ["opencode"],
    });
    expect(result.outcomes[0]?.status).toBe("synced");
    expect(result.manifestEntries).toHaveLength(1);
  });

  it("records the backup so the orchestrator can roll back per-runner", async () => {
    let captured: unknown;
    const adapter = makeAdapter({
      detectDeckInstall: async () => ({ installed: true, managedPaths: [] }),
      backupDeveloperTeamFiles: (plan) => {
        captured = plan;
        return { snapshot: "BACKUP" };
      },
    });
    const config = makeConfig({ opencode: { rtk: true } });
    const result = await runRunnerSync({
      config,
      registry: makeRegistry([adapter]),
      projectRoot: "/tmp",
      deckVersion: "1.0.0",
      runnerIds: ["opencode"],
    });
    expect(captured).toBeDefined();
    expect(result.outcomes[0]?.adapterBackup).toEqual({ snapshot: "BACKUP" });
  });

  it("marks a runner as failed when verify returns invalid", async () => {
    const adapter = makeAdapter({
      detectDeckInstall: async () => ({ installed: true, managedPaths: [] }),
      verifyDeveloperTeamInstall: () => ({
        valid: false,
        diagnostics: ["AGENTS.md missing"],
      }),
    });
    const config = makeConfig({ opencode: { rtk: true } });
    const result = await runRunnerSync({
      config,
      registry: makeRegistry([adapter]),
      projectRoot: "/tmp",
      deckVersion: "1.0.0",
      runnerIds: ["opencode"],
    });
    expect(result.outcomes[0]?.status).toBe("failed");
    expect(result.outcomes[0]?.diagnostics.join("\n")).toContain("AGENTS.md");
  });

  it("preserves model and memory settings (does not touch the config)", async () => {
    // runner-sync must NOT mutate config.packageInstructions beyond reading.
    const adapter = makeAdapter({
      detectDeckInstall: async () => ({ installed: true, managedPaths: [] }),
    });
    const config = makeConfig({ opencode: { "codebase-memory": true } });
    const before = JSON.stringify(config.packageInstructions);
    await runRunnerSync({
      config,
      registry: makeRegistry([adapter]),
      projectRoot: "/tmp",
      deckVersion: "1.0.0",
      runnerIds: ["opencode"],
    });
    expect(JSON.stringify(config.packageInstructions)).toBe(before);
  });

  it("does not call any install-style action; only the developer-team install API", async () => {
    let runActionCalled = false;
    const adapter = makeAdapter({
      detectDeckInstall: async () => ({ installed: true, managedPaths: [] }),
      runAction: async () => {
        runActionCalled = true;
        return {
          actionId: "x",
          status: "executed",
          message: "",
          diagnostics: [],
        };
      },
    });
    const config = makeConfig({ opencode: { rtk: true } });
    await runRunnerSync({
      config,
      registry: makeRegistry([adapter]),
      projectRoot: "/tmp",
      deckVersion: "1.0.0",
      runnerIds: ["opencode"],
    });
    expect(runActionCalled).toBe(false);
  });

  it("handles a missing adapter registration gracefully", async () => {
    const config = makeConfig({ opencode: { rtk: true } });
    const result = await runRunnerSync({
      config,
      registry: makeRegistry([]),
      projectRoot: "/tmp",
      deckVersion: "1.0.0",
      runnerIds: ["unknown-runner"],
    });
    expect(result.outcomes[0]?.status).toBe("skipped");
    expect(result.outcomes[0]?.skippedReason).toBe("not-detected");
  });
});

describe("applyRunnerSyncToManifest", () => {
  it("writes the file entries into the manifest", () => {
    const base = buildDefaultManifest("1.0.0");
    const file = {
      path: "/tmp/.config/test-runner/AGENTS.md",
      owner: "runner:test-runner" as const,
      checksum: { algorithm: "sha256" as const, value: "0".repeat(64) },
      deck_version: "1.0.0",
      kind: "content" as const,
      lastWrittenAt: new Date().toISOString(),
    };
    const next = applyRunnerSyncToManifest(
      base,
      { outcomes: [], manifestEntries: [file] },
      "1.0.0",
    );
    expect(next.files).toHaveLength(1);
    expect(next.files[0]?.path).toBe("/tmp/.config/test-runner/AGENTS.md");
  });
});
