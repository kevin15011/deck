/**
 * Unit tests for runner-sync — content-only re-apply of Deck-managed
 * artifacts to installed runners.
 */

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getDefaultDeckConfig, prepareAndBuildDeveloperTeamInstallPlan, type RunnerAdapter } from "@deck/core";
import { createCodexRunnerAdapter } from "@deck/adapter-codex";
import { createOpenCodeRunnerAdapter } from "@deck/adapter-opencode";
import { createPiRunnerAdapter } from "@deck/adapter-pi";

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
    backupDeveloperTeamFiles: () => ({ payload: { snapshot: "v1" }, diagnostics: [] }),
    rollbackDeveloperTeamFiles: async () => ({ status: "rolled-back", conflicts: [], diagnostics: [] }),
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

async function initCanonicalRemote(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, ".git", "objects", "info"), { recursive: true });
  await mkdir(join(projectRoot, ".git", "objects", "pack"), { recursive: true });
  await mkdir(join(projectRoot, ".git", "refs", "heads"), { recursive: true });
  await writeFile(join(projectRoot, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  await writeFile(join(projectRoot, ".git", "config"), [
    "[core]",
    "\trepositoryformatversion = 0",
    "\tfilemode = true",
    "\tbare = false",
    "\tlogallrefupdates = true",
    "[remote \"origin\"]",
    "\turl = https://github.com/kevin15011/deck.git",
    "\tfetch = +refs/heads/*:refs/remotes/origin/*",
    "",
  ].join("\n"), "utf8");
}

async function writeOpenCodeSupermemoryConfig(configDir: string, projectScope: string): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "opencode.json"), `${JSON.stringify({
    mcp: {
      supermemory: {
        type: "remote",
        url: "https://mcp.supermemory.ai/mcp",
        headers: { "x-sm-project": projectScope },
      },
    },
  }, null, 2)}\n`, "utf8");
}

async function writePiSupermemoryConfig(configPath: string, projectScope: string): Promise<void> {
  await mkdir(join(configPath, ".."), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({
    mcpServers: {
      supermemory: {
        transport: "http",
        url: "https://mcp.supermemory.ai/mcp",
        headers: { "x-sm-project": projectScope, "x-supermemory-api-key": "redacted-test-token" },
      },
    },
  }, null, 2)}\n`, "utf8");
}

function supermemorySyncConfig(runner: "opencode" | "pi") {
  const config = makeConfig({ [runner]: { "adaptive-memory": true, "codebase-memory": true } });
  config.adaptiveMemory = { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } };
  return config;
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

  it("synchronizes base managed content when no optional package instructions are enabled", async () => {
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
    expect(result.outcomes[0]?.status).toBe("synced");
    expect(result.manifestEntries).toHaveLength(1);
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

  it("sync includes capability-scoped Web Search instructions when enabled", async () => {
    let capturedPackageIds: readonly string[] = [];
    const adapter = makeAdapter({
      detectDeckInstall: async () => ({
        installed: true,
        managedPaths: ["/tmp/.config/opencode/AGENTS.md"],
      }),
      buildDeveloperTeamInstallPlan: (input) => {
        capturedPackageIds = input.capabilityInstructions?.instructions.map((fragment) => fragment.packageId) ?? [];
        return { files: [{ path: "/tmp/.config/test-runner/AGENTS.md", content: "ok" }] };
      },
    });
    const config = makeConfig();
    config.webSearch = { enabled: true, provider: "tavily" };

    const result = await runRunnerSync({
      config,
      registry: makeRegistry([adapter]),
      projectRoot: "/tmp",
      deckVersion: "1.0.0",
      runnerIds: ["opencode"],
    });

    expect(result.outcomes[0]?.status).toBe("synced");
    expect(capturedPackageIds).toContain("web-search");
  });

  it("OpenCode content-only sync preserves scoped Supermemory guidance and unrelated package fragments when configured scope matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-opencode-sync-supermemory-"));
    const configDir = join(root, ".config", "opencode");
    try {
      await initCanonicalRemote(root);
      await writeOpenCodeSupermemoryConfig(configDir, "sm_project_v1_kevin15011_deck");
      const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: configDir });
      const result = await runRunnerSync({
        config: supermemorySyncConfig("opencode"),
        registry: makeRegistry([adapter]),
        projectRoot: root,
        deckVersion: "next",
        runnerIds: ["opencode"],
      });

      expect(result.outcomes[0]?.status).toBe("synced");
      const content = [
        await readFile(join(configDir, "prompts", "deck-team", "deck-lead.md"), "utf8"),
        await readFile(join(configDir, "skills", "api-and-interface-design", "SKILL.md"), "utf8"),
        await readFile(join(configDir, "skills", "deck-onboard", "SKILL.md"), "utf8"),
      ].join("\n");
      expect(content).toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(content).toContain("Codebase Memory Package");
      expect(content).not.toContain("Adaptive-memory project operations are disabled");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("OpenCode content-only sync fails closed for mismatched/default Supermemory scopes while preserving unrelated package fragments", async () => {
    for (const [name, projectScope, expectedReason] of [
      ["mismatch", "sm_project_v1_other_repo", "scope mismatch"],
      ["default", "sm_project_default", "configured scope missing"],
    ] as const) {
      const root = await mkdtemp(join(tmpdir(), `deck-opencode-sync-supermemory-${name}-`));
      const configDir = join(root, ".config", "opencode");
      try {
        await initCanonicalRemote(root);
        await writeOpenCodeSupermemoryConfig(configDir, projectScope);
        const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: configDir });
        const result = await runRunnerSync({
          config: supermemorySyncConfig("opencode"),
          registry: makeRegistry([adapter]),
          projectRoot: root,
          deckVersion: "next",
          runnerIds: ["opencode"],
        });

        expect(result.outcomes[0]?.status).toBe("synced");
        const content = [
          await readFile(join(configDir, "prompts", "deck-team", "deck-lead.md"), "utf8"),
          await readFile(join(configDir, "skills", "api-and-interface-design", "SKILL.md"), "utf8"),
          await readFile(join(configDir, "skills", "deck-onboard", "SKILL.md"), "utf8"),
        ].join("\n");
        expect(content).toContain("Adaptive-memory project operations are disabled");
        if (expectedReason === "scope mismatch") {
          expect(content).toMatch(/scope mismatch|configured scope missing/);
        } else {
          expect(content).toContain(expectedReason);
        }
        expect(content).toContain("Codebase Memory Package");
        expect(content).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
        expect(content).not.toContain(projectScope);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it("Pi content-only sync preserves scoped Supermemory guidance and unrelated package fragments when configured scope matches", async () => {
      const root = await mkdtemp(join(tmpdir(), "deck-pi-sync-supermemory-"));
      const home = join(root, "home");
      try {
        await initCanonicalRemote(root);
        await writePiSupermemoryConfig(join(home, ".pi", "agent", "mcp.json"), "sm_project_v1_kevin15011_deck");
        const adapter = createPiRunnerAdapter({ homeDirectory: home });
      const detectedAdapter = Object.assign(adapter, { detectDeckInstall: async () => ({ installed: true, managedPaths: [join(home, ".pi", "agent", "mcp.json")] }) }) as RunnerAdapter;
      const result = await runRunnerSync({
        config: supermemorySyncConfig("pi"),
        registry: makeRegistry([detectedAdapter]),
        projectRoot: root,
        deckVersion: "next",
        runnerIds: ["pi"],
      });

      expect(result.outcomes[0]?.status).toBe("synced");
      const content = [
        await readFile(join(home, ".pi", "agent", "agents", "deck-lead.md"), "utf8"),
        await readFile(join(home, ".pi", "agent", "skills", "deck-apply-fast", "SKILL.md"), "utf8"),
        await readFile(join(home, ".pi", "agent", "skills", "deck-onboard", "SKILL.md"), "utf8"),
      ].join("\n");
      expect(content).toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(content).toContain("Codebase Memory Package");
      expect(content).not.toContain("Adaptive-memory project operations are disabled");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Pi content-only sync fails closed for mismatched/default Supermemory scopes while preserving unrelated package fragments", async () => {
    for (const [name, projectScope, expectedReason] of [
      ["mismatch", "sm_project_v1_other_repo", "scope mismatch"],
      ["default", "sm_project_default", "configured scope missing"],
    ] as const) {
      const root = await mkdtemp(join(tmpdir(), `deck-pi-sync-supermemory-${name}-`));
      const home = join(root, "home");
      try {
        await initCanonicalRemote(root);
        await writePiSupermemoryConfig(join(home, ".pi", "agent", "mcp.json"), projectScope);
        const adapter = createPiRunnerAdapter({ homeDirectory: home });
        const detectedAdapter = Object.assign(adapter, { detectDeckInstall: async () => ({ installed: true, managedPaths: [join(home, ".pi", "agent", "mcp.json")] }) }) as RunnerAdapter;
        const result = await runRunnerSync({
          config: supermemorySyncConfig("pi"),
          registry: makeRegistry([detectedAdapter]),
          projectRoot: root,
          deckVersion: "next",
          runnerIds: ["pi"],
        });

        expect(result.outcomes[0]?.status).toBe("synced");
        const content = [
          await readFile(join(home, ".pi", "agent", "agents", "deck-lead.md"), "utf8"),
          await readFile(join(home, ".pi", "agent", "skills", "deck-apply-fast", "SKILL.md"), "utf8"),
          await readFile(join(home, ".pi", "agent", "skills", "deck-onboard", "SKILL.md"), "utf8"),
        ].join("\n");
        expect(content).toContain("Adaptive-memory project operations are disabled");
        if (expectedReason === "scope mismatch") {
          expect(content).toMatch(/scope mismatch|configured scope missing/);
        } else {
          expect(content).toContain(expectedReason);
        }
        expect(content).toContain("Codebase Memory Package");
        expect(content).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
        expect(content).not.toContain(projectScope);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it("Codex content-only sync repairs owned roles, support files, and bootstrap content with no optional selections", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-codex-sync-"));
    const journalRoot = join(root, "journals");
    try {
      const adapter = createCodexRunnerAdapter({ journalRoot });
      const initial = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: getDefaultDeckConfig() });
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "codex-development", plan: initial });
      const paths = [
        ".codex/agents/deck-lead.toml",
        ".agents/skills/idea-refine/examples.md",
        ".agents/skills/deck-onboard/SKILL.md",
      ];
      const manifestPath = join(root, ".codex", "deck-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: Record<string, string> };
      const removedPath = ".agents/skills/removed-skill/reference.md";
      await mkdir(join(root, ".agents", "skills", "removed-skill"), { recursive: true });
      await writeFile(join(root, removedPath), "owned removed content", "utf8");
      manifest.files[removedPath] = createHash("sha256").update("owned removed content").digest("hex");
      for (const relativePath of paths) {
        const path = join(root, relativePath);
        const old = `${await readFile(path, "utf8")}\n# old-release-content\n`;
        await writeFile(path, old, "utf8");
        manifest.files[relativePath] = createHash("sha256").update(old).digest("hex");
      }
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      const config = getDefaultDeckConfig();
      for (const key of Object.keys(config.packageInstructions.codex)) config.packageInstructions.codex[key as keyof typeof config.packageInstructions.codex] = false;
      const result = await runRunnerSync({ config, registry: makeRegistry([adapter]), projectRoot: root, deckVersion: "next", runnerIds: ["codex"] });
      expect(result.outcomes[0]?.status).toBe("synced");
      expect(result.outcomes[0]?.filesWritten).toEqual(expect.arrayContaining(paths));
      for (const relativePath of paths) expect(await readFile(join(root, relativePath), "utf8")).not.toContain("old-release-content");
      expect(existsSync(join(root, removedPath))).toBe(false);
      expect(result.manifestRemovals).toContainEqual({ path: removedPath, owner: "runner:codex" });
      expect(result.outcomes[0]?.diagnostics.join(" ")).not.toMatch(/install runtime|install MCP|reinstall/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("treats a fully current verified Codex installation as a successful no-op sync", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-codex-sync-current-"));
    try {
      const adapter = createCodexRunnerAdapter({ journalRoot: join(root, "journals") });
      const initial = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: getDefaultDeckConfig(), capabilityInstructions: { instructions: [] } });
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "codex-development", plan: initial });
      const config = getDefaultDeckConfig();
      for (const key of Object.keys(config.packageInstructions.codex)) config.packageInstructions.codex[key as keyof typeof config.packageInstructions.codex] = false;

      const result = await runRunnerSync({ config, registry: makeRegistry([adapter]), projectRoot: root, deckVersion: "next", runnerIds: ["codex"] });
      expect(result.outcomes[0]).toMatchObject({ status: "synced", filesWritten: [] });
      expect(result.outcomes[0]?.diagnostics).not.toContainEqual(expect.stringContaining("changedCount=0"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);


  it("keeps Codex runtime config and manifest ownership unchanged during content-only sync, then migrates on a later full install", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-codex-content-only-runtime-"));
    let resolverCalls = 0;
    let bootstrapCalls = 0;
    const readiness = () => {
      const evidence: import("@deck/core").SerenaReadinessEvidence = {
        capabilityId: "serena",
        state: "ready",
        resolvedExecutablePath: "/fixtures/deck-data/tools/serena/bin/serena",
        source: "existing-deck-tool",
        probe: "serena-help",
        fingerprint: "fixture",
      };
      return { state: "ready" as const, evidence, revalidate: async (value: import("@deck/core").SerenaReadinessEvidence) => ({ valid: true as const, evidence: value }) };
    };
    try {
      const adapter = createCodexRunnerAdapter({
        journalRoot: join(root, "journals"),
        mcpCapabilityIds: ["serena"],
        serenaReadinessResolver: async () => {
          resolverCalls += 1;
          return readiness();
        },
        serenaProxyProbe: async () => ({ state: "ready" as const }),
        serenaBootstrap: async () => {
          bootstrapCalls += 1;
          return { outcome: "failed", diagnostic: { code: "unexpected", message: "bootstrap must not run" } } as never;
        },
      });
      const installInput = { projectRoot: root, environmentId: "codex-development" as const, deckConfig: getDefaultDeckConfig() };
      const initial = await prepareAndBuildDeveloperTeamInstallPlan(adapter, installInput);
      expect(initial.plan.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "codex-development", plan: initial.plan });

      const configPath = join(root, ".codex", "config.toml");
      const manifestPath = join(root, ".codex", "deck-manifest.json");
      const originalManifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: Record<string, string> };
      const legacyConfig = [
        "[features]",
        "multi_agent = false",
        "",
        "# deck-codex-mcp:serena",
        "[mcp_servers.serena]",
        'command = "/legacy/user/tools/serena/bin/serena"',
        'args = ["start-mcp-server", "--context", "ide", "--project-from-cwd"]',
        "",
      ].join("\n");
      await writeFile(configPath, legacyConfig, "utf8");
      await chmod(configPath, 0o600);
      const configMode = (await stat(configPath)).mode & 0o777;
      resolverCalls = 0;

      const config = getDefaultDeckConfig();
      for (const key of Object.keys(config.packageInstructions.codex)) config.packageInstructions.codex[key as keyof typeof config.packageInstructions.codex] = false;
      const sync = await runRunnerSync({ config, registry: makeRegistry([adapter]), projectRoot: root, deckVersion: "next", runnerIds: ["codex"] });

      expect(sync.outcomes[0]).toMatchObject({ status: "synced" });
      expect(resolverCalls).toBe(0);
      expect(bootstrapCalls).toBe(0);
      expect(await readFile(configPath, "utf8")).toBe(legacyConfig);
      expect((await stat(configPath)).mode & 0o777).toBe(configMode);
      const syncedManifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: Record<string, string> };
      expect(syncedManifest.files[".codex/config.toml"]).toBe(originalManifest.files[".codex/config.toml"]);

      const migrated = await prepareAndBuildDeveloperTeamInstallPlan(adapter, installInput);
      expect(resolverCalls).toBe(1);
      expect(migrated.plan.blocked).toBe(false);
      const migratedConfig = migrated.plan.files.find((file) => file.path === ".codex/config.toml")?.content ?? "";
      expect(migratedConfig).toContain('command = "deck"');
      expect(migratedConfig).not.toContain("/legacy/user");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("records the backup so the orchestrator can roll back per-runner", async () => {
    let captured: unknown;
    const adapter = makeAdapter({
      detectDeckInstall: async () => ({ installed: true, managedPaths: [] }),
      backupDeveloperTeamFiles: (plan) => {
        captured = plan;
        return { payload: { snapshot: "BACKUP" }, diagnostics: [] };
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
    expect(result.outcomes[0]?.adapterBackup).toEqual({ payload: { snapshot: "BACKUP" }, diagnostics: [] });
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

  it("rolls back the adapter backup when apply throws after a partial mutation", async () => {
    let rollbackCalls = 0;
    const adapter = makeAdapter({
      detectDeckInstall: async () => ({ installed: true, managedPaths: [] }),
      applyDeveloperTeamInstall: async () => {
        throw new Error("partial apply failed");
      },
      rollbackDeveloperTeamFiles: async () => {
        rollbackCalls += 1;
        return { status: "rolled-back", conflicts: [], diagnostics: [] };
      },
    });
    const result = await runRunnerSync({
      config: makeConfig(),
      registry: makeRegistry([adapter]),
      projectRoot: "/tmp",
      deckVersion: "1.0.0",
      runnerIds: ["opencode"],
    });
    expect(rollbackCalls).toBe(1);
    expect(result.outcomes[0]).toMatchObject({ status: "failed", diagnostics: [expect.stringContaining("partial apply failed")] });
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
    const removed = applyRunnerSyncToManifest(next, { outcomes: [], manifestEntries: [], manifestRemovals: [{ path: file.path, owner: "runner:test-runner" }] }, "1.0.0");
    expect(removed.files).toHaveLength(0);
  });
});
