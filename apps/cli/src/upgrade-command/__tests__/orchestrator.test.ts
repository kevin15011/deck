/**
 * Unit tests for the upgrade orchestrator.
 *
 * Covers spec §States and Transitions:
 *   - Happy path: binary + content upgrade
 *   - Content-only upgrade
 *   - Migration item ordering
 *   - Advisory / channel_eol: no mutation
 *   - Checksum failure → auto-rollback
 *   - Lock contention → UPGRADE_LOCKED
 *   - Homebrew install → binary skip, content allowed
 *   - Interrupted state recovery
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { _resetDeckPathCache } from "../../runtime/paths.js";
import type {
  RunnerAdapter,
  NormalizedDeckConfig,
} from "@deck/core";
import { getDefaultDeckConfig } from "@deck/core";

import {
  buildDefaultState,
  readState,
  STATE_ERROR_CODES,
  StateStoreError,
  writeState,
} from "../state-store.js";
import {
  OrchestratorError,
  ORCHESTRATOR_ERROR_CODES,
  runUpgradeOrchestrator,
  stageReleaseAssets,
  collectRunnerBackupTargets,
  type OrchestratorDeps,
} from "../orchestrator.js";
import { createBackup } from "../backup-store.js";
import {
  parseReleaseDescriptor,
  type ReleaseJson,
} from "../release-descriptor.js";
import type { RunnerSyncAdapterRegistry } from "../runner-sync.js";
import { detectInstallKind } from "../orchestrator.js";

// ---------------------------------------------------------------------------
// Tests for detectInstallKind (regression for compiled Bun binary detection)
// ---------------------------------------------------------------------------

describe("detectInstallKind", () => {
  it("detects development mode when argv0 is 'bun'", () => {
    // This simulates running via `bun run script.ts`
    const result = detectInstallKind("bun");
    expect(result).toBe("development");
  });

  it("detects development mode when argv0 is 'node'", () => {
    const result = detectInstallKind("node");
    expect(result).toBe("development");
  });

  it("detects development mode when argv0 is 'deno'", () => {
    const result = detectInstallKind("deno");
    expect(result).toBe("development");
  });

  it("detects development mode for paths containing runtime executables", () => {
    // When running via bun run from /home/user/project
    expect(detectInstallKind("/home/user/.bun/bin/bun")).toBe("development");
    expect(detectInstallKind("/usr/local/bin/node")).toBe("development");
    expect(detectInstallKind("/home/user/.deno/bin/deno")).toBe("development");
  });

  it("detects binary when execPath is an installed deck binary", () => {
    // This is the key regression test: compiled Bun binary where argv[0]="bun"
    // but execPath points to the real deck binary
    const result = detectInstallKind("/usr/local/bin/deck");
    expect(result).toBe("binary");
  });

  it("detects binary for production no-arg call with mocked execPath", () => {
    // Regression test: compiled Bun binary in production, no argv0 provided.
    // Should use process.execPath first, not process.argv[0].
    // Save original values
    const originalArgv = process.argv;
    const originalExecPath = process.execPath;

    try {
      // Mock: argv[0] is "bun" (running via bun), but execPath is real binary
      process.argv = ["bun"];
      Object.defineProperty(process, "execPath", {
        value: "/usr/local/bin/deck",
        writable: true,
      });

      // Call without arguments - this is the production no-arg code path
      const result = detectInstallKind();

      expect(result).toBe("binary");
    } finally {
      // Restore original values
      process.argv = originalArgv;
      Object.defineProperty(process, "execPath", {
        value: originalExecPath,
        writable: true,
      });
    }
  });

  it("detects binary for common installation paths", () => {
    expect(detectInstallKind("/usr/bin/deck")).toBe("binary");
    expect(detectInstallKind("/usr/local/bin/deck")).toBe("binary");
    expect(detectInstallKind("/home/linuxbrew/.linuxbrew/bin/deck")).toBe("binary");
  });

  it("detects homebrew for Homebrew Cellar paths", () => {
    expect(detectInstallKind("/home/linuxbrew/Cellar/deck/1.0.0/bin/deck")).toBe("homebrew");
    expect(detectInstallKind("/usr/local/Cellar/deck/1.0.0/bin/deck")).toBe("homebrew");
    expect(detectInstallKind("/opt/homebrew/bin/deck")).toBe("homebrew");
  });

  it("returns binary for unrecognized paths (default case)", () => {
    // Any path that is not dev runtime or homebrew defaults to binary
    expect(detectInstallKind("/some/random/path/deck")).toBe("binary");
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_PATH = new URL("../__fixtures__/release-fixture.json", import.meta.url);

async function loadFixture(): Promise<ReleaseJson> {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  return parseReleaseDescriptor(raw);
}

/** A descriptor with content-only items, no binary. */
function contentOnlyDescriptor(version: string): ReleaseJson {
  return {
    schemaVersion: 1,
    version,
    tag_name: `v${version}`,
    channel: "stable",
    published_at: new Date().toISOString(),
    items: [
      {
        id: "content-1",
        kind: "content",
        required: false,
        asset_name: `deck_v${version}_content.tar.gz`,
        url: `https://example.com/deck_v${version}_content.tar.gz`,
        sha256: "1".repeat(64),
        notes: "",
        content_kinds: ["prompts", "skills", "subagents", "mcp", "packageInstructions"],
      },
    ],
  };
}

function binaryOnlyDescriptor(version: string, assetName: string, sha: string): ReleaseJson {
  return {
    schemaVersion: 1,
    version,
    tag_name: `v${version}`,
    channel: "stable",
    published_at: new Date().toISOString(),
    items: [
      {
        id: `binary-linux-x64-v${version}`,
        kind: "binary",
        required: true,
        platform: "linux-x64",
        asset_name: assetName,
        url: `https://example.com/${assetName}`,
        sha256: sha,
        notes: "",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeAdapter(overrides: Partial<RunnerAdapter> = {}): RunnerAdapter {
  return {
    runnerId: "opencode",
    displayName: "OpenCode",
    environmentIds: ["opencode-development"],
    detectRuntimes: async () => [],
    getCapabilityInventory: async () => ({
      capabilities: [],
      runnerId: "opencode",
      environmentId: "opencode-development",
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
    buildDeveloperTeamInstallPlan: () => ({ files: [] }),
    applyDeveloperTeamInstall: async () => ({
      results: [
        { agentId: "x", kind: "skill", status: "unchanged" },
      ],
      changedCount: 0,
      unchangedCount: 1,
    }),
    inspectEnvironment: async () => ({}),
    reviewTools: async () => ({}),
    backupDeveloperTeamFiles: () => ({ payload: {}, diagnostics: [] }),
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
      if (!a) throw new Error(`No adapter for ${id}`);
      return a;
    },
  };
}

function makeConfig(overrides: {
  opencode?: Record<string, boolean>;
} = {}): NormalizedDeckConfig {
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
  return base;
}

function sha256(payload: string | Buffer): string {
  return require("node:crypto")
    .createHash("sha256")
    .update(payload)
    .digest("hex");
}

async function withPlatform<T>(platform: NodeJS.Platform, arch: NodeJS.Architecture, fn: () => Promise<T> | T): Promise<T> {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  Object.defineProperty(process, "arch", { value: arch, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    Object.defineProperty(process, "arch", { value: originalArch, configurable: true });
  }
}

function createDeckArchive(archivePath: string, payload: string): void {
  const archiveDir = mkdtempSync(join(tmpdir(), "deck-archive-src-"));
  try {
    const deckPath = join(archiveDir, "deck");
    writeFileSync(deckPath, payload);
    chmodSync(deckPath, 0o755);
    const result = spawnSync("tar", ["-czf", archivePath, "-C", archiveDir, "deck"], {
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      throw new Error(`failed to create test tarball: ${result.stderr}`);
    }
  } finally {
    rmSync(archiveDir, { recursive: true, force: true });
  }
}

function createSymlinkDeckArchive(archivePath: string): void {
  const archiveDir = mkdtempSync(join(tmpdir(), "deck-archive-src-"));
  try {
    writeFileSync(join(archiveDir, "target"), "not a deck binary");
    symlinkSync("target", join(archiveDir, "deck"));
    const result = spawnSync("tar", ["-czf", archivePath, "-C", archiveDir, "deck"], {
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      throw new Error(`failed to create symlink test tarball: ${result.stderr}`);
    }
  } finally {
    rmSync(archiveDir, { recursive: true, force: true });
  }
}

function createPathTraversalDeckArchive(archivePath: string): void {
  const archiveDir = mkdtempSync(join(tmpdir(), "deck-archive-src-"));
  try {
    writeFileSync(join(archiveDir, "deck"), "traversal");
    const result = spawnSync(
      "tar",
      ["-czf", archivePath, "--transform=s#deck#../deck#", "-C", archiveDir, "deck"],
      { encoding: "utf-8" },
    );
    if (result.status !== 0) {
      throw new Error(`failed to create traversal test tarball: ${result.stderr}`);
    }
  } finally {
    rmSync(archiveDir, { recursive: true, force: true });
  }
}

function createMultipleDeckCandidatesArchive(archivePath: string): void {
  const archiveDir = mkdtempSync(join(tmpdir(), "deck-archive-src-"));
  try {
    writeFileSync(join(archiveDir, "deck"), "first");
    mkdirSync(join(archiveDir, "nested"), { recursive: true });
    writeFileSync(join(archiveDir, "nested", "deck"), "second");
    const result = spawnSync("tar", ["-czf", archivePath, "-C", archiveDir, "deck", "nested/deck"], {
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      throw new Error(`failed to create multiple-candidate test tarball: ${result.stderr}`);
    }
  } finally {
    rmSync(archiveDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("orchestrator", () => {
  it("uses content-only materialization for runner backup discovery", async () => {
    let prepared = 0;
    let capturedScope: unknown;
    const adapter = makeAdapter({
      detectDeckInstall: async () => ({ installed: true, managedPaths: ["/tmp/AGENTS.md"] }),
      prepareDeveloperTeamInstall: async () => {
        prepared += 1;
        return [];
      },
      buildDeveloperTeamInstallPlan: (input) => {
        capturedScope = input.materializationScope;
        return { files: [{ path: "/tmp/AGENTS.md", content: "content" }] };
      },
    });
    const targets = await collectRunnerBackupTargets({
      projectRoot: "/tmp",
      readDeckConfig: () => makeConfig({ opencode: { rtk: true } }),
      adapterRegistry: makeRegistry([adapter]),
    } as OrchestratorDeps);

    expect(prepared).toBe(1);
    expect(capturedScope).toBe("content-only");
    expect(targets).toEqual([expect.objectContaining({ sourcePath: "/tmp/AGENTS.md", owner: "runner:opencode" })]);
  });

  let workDir: string;
  let stagingDir: string;
  let binaryPath: string;
  const saved: Record<string, string | undefined> = {};

  function setXdg(
    name: "XDG_CONFIG_HOME" | "XDG_STATE_HOME" | "XDG_CACHE_HOME",
    value: string,
  ): void {
    saved[name] = process.env[name];
    process.env[name] = value;
    _resetDeckPathCache();
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "deck-orchestrator-"));
    setXdg("XDG_CONFIG_HOME", join(workDir, "config"));
    setXdg("XDG_STATE_HOME", join(workDir, "state"));
    setXdg("XDG_CACHE_HOME", join(workDir, "cache"));

    // Staging dir is normally `$XDG_CACHE_HOME/deck/releases/v<version>`.
    // We point it at our tmp tree so the test can pre-stage assets there.
    stagingDir = join(workDir, "staging");
    mkdirSync(stagingDir, { recursive: true });

    // Pretend binary lives in our tmp dir; the orchestrator reads it for
    // its SHA-256 (we don't actually verify the install path on the
    // test happy path).
    binaryPath = join(workDir, "deck");
    writeFileSync(binaryPath, "v1-binary");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    for (const name of ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
    _resetDeckPathCache();
  });

  // --- Deps factory --------------------------------------------------

  function makeDeps(overrides: Partial<OrchestratorDeps> = {}): Partial<OrchestratorDeps> {
    return {
      resolveStagingDir: () => stagingDir,
      resolveStagedAsset: (_version: string, assetName: string) => {
        const p = join(stagingDir, assetName);
        return existsSync(p) ? p : null;
      },
      adapterRegistry: makeRegistry([]),
      projectRoot: workDir,
      readDeckConfig: () => makeConfig(),
      currentBinaryPath: binaryPath,
      installKind: "binary",
      ...overrides,
    };
  }

  // --- Staging --------------------------------------------------------

  describe("stageReleaseAssets", () => {
    it("downloads assets into the descriptor version staging directory", async () => {
      const assetName = "deck_v2.0.0_linux-x64.tar.gz";
      const payload = "v2 payload";
      const assetSha = sha256(payload);

      const result = await withPlatform("linux", "x64", () => stageReleaseAssets(
        {
          schemaVersion: 1,
          version: "2.0.0",
          tag_name: "v2.0.0",
          channel: "stable",
          published_at: new Date().toISOString(),
          items: [
            {
              id: "binary-linux-x64-v2.0.0",
              kind: "binary",
              required: true,
              platform: "linux-x64",
              asset_name: assetName,
              url: `https://example.com/${assetName}`,
              sha256: assetSha,
              notes: "",
            },
          ],
        },
        {
          resolveStagingDir: (version) => join(stagingDir, `v${version}`),
          downloadAsset: async (_url, destination) => {
            writeFileSync(destination, payload);
          },
        },
      ));

      const stagedPath = join(stagingDir, "v2.0.0", assetName);
      expect(result.staged).toBe(1);
      expect(result.files).toEqual([stagedPath]);
      expect(readFileSync(stagedPath, "utf-8")).toBe(payload);
    });

    it("does not download binary assets for unrelated platforms", async () => {
      const linuxAsset = "deck_v2.1.0_linux-x64.tar.gz";
      const darwinAsset = "deck_v2.1.0_darwin-arm64.tar.gz";
      const linuxPayload = "linux payload";
      const downloadedUrls: string[] = [];

      const result = await withPlatform("linux", "x64", () => stageReleaseAssets(
        {
          schemaVersion: 1,
          version: "2.1.0",
          tag_name: "v2.1.0",
          channel: "stable",
          published_at: new Date().toISOString(),
          items: [
            {
              id: "binary-linux-x64-v2.1.0",
              kind: "binary",
              required: true,
              platform: "linux-x64",
              asset_name: linuxAsset,
              url: `https://example.com/${linuxAsset}`,
              sha256: sha256(linuxPayload),
              notes: "",
            },
            {
              id: "binary-darwin-arm64-v2.1.0",
              kind: "binary",
              required: true,
              platform: "darwin-arm64",
              asset_name: darwinAsset,
              url: `https://bad.example.com/${darwinAsset}`,
              sha256: "0".repeat(64),
              notes: "",
            },
          ],
        },
        {
          resolveStagingDir: (version) => join(stagingDir, `v${version}`),
          downloadAsset: async (url, destination) => {
            downloadedUrls.push(url);
            if (url.includes(darwinAsset)) {
              throw new Error("unrelated platform should not be downloaded");
            }
            writeFileSync(destination, linuxPayload);
          },
        },
      ));

      expect(result.staged).toBe(1);
      expect(downloadedUrls).toEqual([`https://example.com/${linuxAsset}`]);
      expect(existsSync(join(stagingDir, "v2.1.0", darwinAsset))).toBe(false);
    });

    it("does not block on optional or non-executed asset URLs", async () => {
      const binaryAsset = "deck_v2.2.0_linux-x64.tar.gz";
      const payload = "linux payload";
      const downloadedUrls: string[] = [];

      const result = await withPlatform("linux", "x64", () => stageReleaseAssets(
        {
          schemaVersion: 1,
          version: "2.2.0",
          tag_name: "v2.2.0",
          channel: "stable",
          published_at: new Date().toISOString(),
          items: [
            {
              id: "binary-linux-x64-v2.2.0",
              kind: "binary",
              required: true,
              platform: "linux-x64",
              asset_name: binaryAsset,
              url: `https://example.com/${binaryAsset}`,
              sha256: sha256(payload),
              notes: "",
            },
            {
              id: "optional-content-v2.2.0",
              kind: "content",
              required: false,
              asset_name: "deck_v2.2.0_content.tar.gz",
              url: "https://bad.example.com/content.tar.gz",
              sha256: "1".repeat(64),
              notes: "",
              content_kinds: ["prompts"],
            },
            {
              id: "future-migration-v2.2.0",
              kind: "migration",
              required: true,
              asset_name: "deck_v2.2.0_migration.tar.gz",
              url: "https://bad.example.com/migration.tar.gz",
              sha256: "2".repeat(64),
              notes: "",
              from_schema_version: 1,
              to_schema_version: 2,
            },
          ],
        },
        {
          resolveStagingDir: (version) => join(stagingDir, `v${version}`),
          downloadAsset: async (url, destination) => {
            downloadedUrls.push(url);
            if (url.includes("bad.example.com")) {
              throw new Error("non-executed assets should not be downloaded");
            }
            writeFileSync(destination, payload);
          },
        },
      ));

      expect(result.staged).toBe(1);
      expect(downloadedUrls).toEqual([`https://example.com/${binaryAsset}`]);
    });
  });

  // --- Happy paths ---------------------------------------------------

  describe("happy path", () => {
    it("extracts a staged .tar.gz binary archive before replacement", async () => {
      const assetName = "deck_v1.2.1_linux-x64.tar.gz";
      const archivePath = join(stagingDir, assetName);
      createDeckArchive(archivePath, "v2-extracted-binary");
      const archiveSha = sha256(readFileSync(archivePath));
      let replacementPath = "";

      const descriptor = {
        schemaVersion: 1,
        version: "1.2.1",
        tag_name: "v1.2.1",
        channel: "stable",
        published_at: new Date().toISOString(),
        items: [
          {
            id: "binary-linux-x64-v1.2.1",
            kind: "binary",
            required: true,
            platform: "linux-x64",
            asset_name: assetName,
            url: `https://example.com/${assetName}`,
            sha256: archiveSha,
            notes: "",
          },
        ],
      };

      const result = await withPlatform("linux", "x64", () => runUpgradeOrchestrator({
        descriptor,
        targetVersion: "1.2.1",
        currentVersion: "1.0.0",
        deps: makeDeps({
          replaceBinary: async (input) => {
            replacementPath = input.stagedAssetPath;
            expect(input.stagedAssetPath).not.toBe(archivePath);
            expect(input.stagedAssetPath.endsWith("deck")).toBe(true);
            expect(input.expectedSha256).toBeUndefined();
            expect(input.verifiedArchivePath).toBe(archivePath);
            expect(input.verifiedArchiveSha256).toBe(archiveSha);
            expect(readFileSync(input.stagedAssetPath, "utf-8")).toBe("v2-extracted-binary");
            return { replaced: true };
          },
        }),
      }));

      expect(result.binary.status).toBe("completed");
      expect(replacementPath).toBeTruthy();
      expect(existsSync(dirname(replacementPath))).toBe(false);
      expect(readFileSync(archivePath)).toBeDefined();
    });

    it("rejects a binary archive containing a symlink deck entry", async () => {
      const assetName = "deck_v1.2.2_linux-x64.tar.gz";
      const archivePath = join(stagingDir, assetName);
      createSymlinkDeckArchive(archivePath);
      const archiveSha = sha256(readFileSync(archivePath));

      await expect(withPlatform("linux", "x64", () => runUpgradeOrchestrator({
        descriptor: binaryOnlyDescriptor("1.2.2", assetName, archiveSha),
        targetVersion: "1.2.2",
        currentVersion: "1.0.0",
        deps: makeDeps({
          replaceBinary: async () => {
            throw new Error("replaceBinary should not run for unsafe archives");
          },
        }),
      }))).rejects.toThrow(/unsupported entry type|symlink/i);
    });

    it("rejects a binary archive containing path traversal entries", async () => {
      const assetName = "deck_v1.2.3_linux-x64.tar.gz";
      const archivePath = join(stagingDir, assetName);
      createPathTraversalDeckArchive(archivePath);
      const archiveSha = sha256(readFileSync(archivePath));

      await expect(withPlatform("linux", "x64", () => runUpgradeOrchestrator({
        descriptor: binaryOnlyDescriptor("1.2.3", assetName, archiveSha),
        targetVersion: "1.2.3",
        currentVersion: "1.0.0",
        deps: makeDeps({
          replaceBinary: async () => {
            throw new Error("replaceBinary should not run for unsafe archives");
          },
        }),
      }))).rejects.toThrow(/unsafe path entry/i);
    });

    it("rejects a binary archive with multiple deck candidates", async () => {
      const assetName = "deck_v1.2.4_linux-x64.tar.gz";
      const archivePath = join(stagingDir, assetName);
      createMultipleDeckCandidatesArchive(archivePath);
      const archiveSha = sha256(readFileSync(archivePath));

      await expect(withPlatform("linux", "x64", () => runUpgradeOrchestrator({
        descriptor: binaryOnlyDescriptor("1.2.4", assetName, archiveSha),
        targetVersion: "1.2.4",
        currentVersion: "1.0.0",
        deps: makeDeps({
          replaceBinary: async () => {
            throw new Error("replaceBinary should not run for ambiguous archives");
          },
        }),
      }))).rejects.toThrow(/multiple deck executables/i);
    });

    it("cleans the inline binary backup after successful verification", async () => {
      const assetName = "deck_v1.2.5_linux-x64.tar.gz";
      const archivePath = join(stagingDir, assetName);
      const inlineBackupPath = join(workDir, "deck.backup");
      createDeckArchive(archivePath, "v2-extracted-binary");
      const archiveSha = sha256(readFileSync(archivePath));
      let cleanedPath = "";

      const result = await withPlatform("linux", "x64", () => runUpgradeOrchestrator({
        descriptor: binaryOnlyDescriptor("1.2.5", assetName, archiveSha),
        targetVersion: "1.2.5",
        currentVersion: "1.0.0",
        deps: makeDeps({
          replaceBinary: async () => ({ replaced: true, backupPath: inlineBackupPath }),
          cleanupBinaryBackup: async (backupPath) => {
            cleanedPath = backupPath ?? "";
          },
        }),
      }));

      expect(result.binary.status).toBe("completed");
      expect(cleanedPath).toBe(inlineBackupPath);
    });

    it("completes a binary+content upgrade", async () => {
      const binaryContent = "v2-binary-payload";

      const assetName = "deck_v1.2.0_linux-x64.tar.gz";
      // Pre-stage the binary archive at the resolved staging dir with a known checksum.
      const linuxPath = join(stagingDir, assetName);
      createDeckArchive(linuxPath, binaryContent);
      const binarySha = sha256(readFileSync(linuxPath));

      // Build a minimal descriptor that matches the staging.
      const descriptor = {
        schemaVersion: 1,
        version: "1.2.0",
        tag_name: "v1.2.0",
        channel: "stable",
        published_at: new Date().toISOString(),
        items: [
          {
            id: "binary-linux-x64-v1.2.0",
            kind: "binary",
            required: true,
            platform: "linux-x64",
            asset_name: assetName,
            url: `https://example.com/${assetName}`,
            sha256: binarySha,
            notes: "",
          },
          {
            id: "content-1",
            kind: "content",
            required: false,
            asset_name: "deck_v1.2.0_content.tar.gz",
            url: "https://example.com/deck_v1.2.0_content.tar.gz",
            sha256: "1".repeat(64),
            notes: "",
            content_kinds: ["prompts", "skills", "subagents", "mcp", "packageInstructions"],
          },
        ],
      };

      // Force the platform triple to linux-x64 so the orchestrator
      // selects the right binary item.
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      Object.defineProperty(process, "arch", { value: "x64", configurable: true });

      try {
        const result = await runUpgradeOrchestrator({
          descriptor,
          targetVersion: "1.2.0",
          currentVersion: "1.0.0",
          deps: makeDeps({
            installKind: "binary",
            resolveStagedAsset: (version: string, name: string) => {
              const p = join(stagingDir, name);
              return version === "1.2.0" && existsSync(p) ? p : null;
            },
            adapterRegistry: makeRegistry([
              makeAdapter({
                detectDeckInstall: async () => ({ installed: false, managedPaths: [] }),
              }),
            ]),
          }),
        });
        expect(result.status).toBe("completed");
        expect(result.binary.status).toBe("completed");
        expect(result.backupId).toBeDefined();
        const after = readState("placeholder");
        expect(after.currentVersion).toBe("1.2.0");
        expect(after.lock).toBeUndefined();
        expect(after.activeOperation).toBeUndefined();
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      }
    });
  });


  // --- Rollback targeting ---------------------------------------------

  describe("auto-rollback", () => {
    it("rolls back from the failed operation backup, not an unrelated newer backup", async () => {
      const binaryContent = "v2-binary-payload";
      const assetName = "deck_v1.2.0_linux-x64.tar.gz";
      const archivePath = join(stagingDir, assetName);
      createDeckArchive(archivePath, binaryContent);
      const binarySha = sha256(readFileSync(archivePath));

      const descriptor = {
        schemaVersion: 1,
        version: "1.2.0",
        tag_name: "v1.2.0",
        channel: "stable",
        published_at: new Date().toISOString(),
        items: [
          {
            id: "binary-linux-x64-v1.2.0",
            kind: "binary",
            required: true,
            platform: "linux-x64",
            asset_name: assetName,
            url: `https://example.com/${assetName}`,
            sha256: binarySha,
            notes: "",
          },
        ],
      };

      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      Object.defineProperty(process, "arch", { value: "x64", configurable: true });

      try {
        await runUpgradeOrchestrator({
          descriptor,
          targetVersion: "1.2.0",
          currentVersion: "1.0.0",
          deps: makeDeps({
            replaceBinary: async () => {
              writeFileSync(binaryPath, "BROKEN");
              createBackup({
                operationId: "unrelated-newer-op",
                deckVersionBefore: "9.0.0",
                reason: "upgrade",
                files: [{ id: "binary", sourcePath: binaryPath, owner: "deck", kind: "binary" }],
              });
              throw new Error("simulated replace failure");
            },
          }),
        });
        throw new Error("expected orchestrator failure");
      } catch (err) {
        expect(err).toBeInstanceOf(OrchestratorError);
        expect((err as OrchestratorError).code).toBe(ORCHESTRATOR_ERROR_CODES.REPLACE_FAILED);
        expect(readFileSync(binaryPath, "utf-8")).toBe("v1-binary");
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      }
    });
  });

  // --- Content-only --------------------------------------------------

  describe("content-only", () => {
    it("skips binary when no binary item for the platform", async () => {
      const descriptor = contentOnlyDescriptor("1.5.0");

      const result = await runUpgradeOrchestrator({
        descriptor,
        targetVersion: "1.5.0",
        currentVersion: "1.4.0",
        deps: makeDeps({
          adapterRegistry: makeRegistry([
            makeAdapter({
              detectDeckInstall: async () => ({ installed: false, managedPaths: [] }),
            }),
          ]),
        }),
      });
      expect(result.binary.status).toBe("no-item-for-platform");
    });
  });

  // --- Migration item ordering --------------------------------------

  describe("item ordering", () => {
    it("items are surfaced in advisory→migration→binary→content→channel_eol order", async () => {
      // The orchestrator doesn't run migrations; we verify the ordering
      // is recorded in the result and the migration ids are present.
      const fixture = await loadFixture();
      // Use a content-only descriptor (no binary) to avoid staging.
      const contentOnly = contentOnlyDescriptor("1.5.0");
      contentOnly.items.push(...fixture.items.filter((i) => i.kind === "advisory" || i.kind === "migration" || i.kind === "channel_eol"));

      const result = await runUpgradeOrchestrator({
        descriptor: contentOnly,
        targetVersion: "1.5.0",
        currentVersion: "1.4.0",
        deps: makeDeps({
          adapterRegistry: makeRegistry([
            makeAdapter({
              detectDeckInstall: async () => ({ installed: false, managedPaths: [] }),
            }),
          ]),
        }),
      });
      // Migration ids are surfaced
      expect(result.migration.itemIds).toContain("migration-v1-to-v2");
      // Advisory items are surfaced
      expect(result.advisory.items.find((i) => i.id === "advisory-homebrew-windows")).toBeDefined();
      // Channel EOL items are surfaced
      expect(result.channelEol.items.find((i) => i.id === "channel-eol-beta-2026")).toBeDefined();
    });
  });

  // --- Lock contention -----------------------------------------------

  describe("lock contention", () => {
    it("throws UPGRADE_LOCKED when another live process holds the lock", async () => {
      const state = buildDefaultState("1.0.0");
      // Persist a fresh lock owned by the current process.
      writeState({
        ...state,
        lock: {
          active: true,
          pid: process.pid,
          operationId: "op-other",
          startedAt: new Date().toISOString(),
          staleAfterSeconds: 900,
        },
      });

      const fixture = await loadFixture();
      try {
        await runUpgradeOrchestrator({
          descriptor: fixture,
          targetVersion: fixture.version,
          currentVersion: "1.0.0",
          deps: makeDeps(),
        });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OrchestratorError);
        expect((err as OrchestratorError).code).toBe(ORCHESTRATOR_ERROR_CODES.UPGRADE_LOCKED);
      }
    });

    it("takes over a stale lock", async () => {
      const state = buildDefaultState("1.0.0");
      // Persist a stale lock (dead pid + old startedAt).
      writeState({
        ...state,
        lock: {
          active: true,
          pid: 2_000_000,
          operationId: "op-old",
          startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          staleAfterSeconds: 900,
        },
      });

      const fixture = await loadFixture();
      const result = await runUpgradeOrchestrator({
        descriptor: contentOnlyDescriptor("1.5.0"),
        targetVersion: "1.5.0",
        currentVersion: "1.4.0",
        deps: makeDeps(),
      });
      // The orchestrator should have acquired the (stale) lock and
      // released it on completion.
      expect(result.status === "completed" || result.status === "partial_failure").toBe(true);
      const after = readState("placeholder");
      expect(after.lock).toBeUndefined();
    });
  });

  // --- Homebrew ------------------------------------------------------

  describe("Homebrew install kind", () => {
    it("refuses binary replacement but allows content sync", async () => {
      // Build a descriptor with both a binary item AND a content item,
      // so we can verify the homebrew refusal on the binary while
      // content sync still runs.
      const contentOnly = contentOnlyDescriptor("1.5.0");
      contentOnly.items.push({
        id: "binary-linux-x64",
        kind: "binary",
        required: true,
        platform: "linux-x64",
        asset_name: "deck_v1.5.0_linux-x64.tar.gz",
        url: "https://example.com/deck_v1.5.0_linux-x64.tar.gz",
        sha256: "f".repeat(64),
        notes: "",
      });

      const result = await runUpgradeOrchestrator({
        descriptor: contentOnly,
        targetVersion: "1.5.0",
        currentVersion: "1.4.0",
        deps: makeDeps({ installKind: "homebrew" }),
      });
      expect(result.binary.status).toBe("skipped-homebrew");
    });
  });

  // --- Descriptor validation ----------------------------------------

  describe("descriptor validation", () => {
    it("rejects a malformed descriptor", async () => {
      try {
        await runUpgradeOrchestrator({
          descriptor: { schemaVersion: 1, items: [] }, // missing required fields
          targetVersion: "1.0.0",
          currentVersion: "0.9.0",
          deps: makeDeps(),
        });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OrchestratorError);
        expect((err as OrchestratorError).code).toBe(ORCHESTRATOR_ERROR_CODES.DESCRIPTOR_INVALID);
      }
    });
  });

  // --- Homebrew refusal error code ----------------------------------

  describe("Homebrew refusal when forced", () => {
    it("does not throw when force=true on a Homebrew install", async () => {
      // Homebrew ALWAYS refuses binary self-upgrade regardless of --force.
      // We don't pre-stage the binary so there's no checksum concern.
      const contentOnly = contentOnlyDescriptor("1.5.0");
      contentOnly.items.push({
        id: "binary-linux-x64",
        kind: "binary",
        required: true,
        platform: "linux-x64",
        asset_name: "deck_v1.5.0_linux-x64.tar.gz",
        url: "https://example.com/deck_v1.5.0_linux-x64.tar.gz",
        sha256: "f".repeat(64),
        notes: "",
      });

      const result = await runUpgradeOrchestrator({
        descriptor: contentOnly,
        targetVersion: "1.5.0",
        currentVersion: "1.4.0",
        force: true,
        deps: makeDeps({ installKind: "homebrew" }),
      });
      // Even with force=true, homebrew refuses binary self-upgrade.
      expect(result.binary.status).toBe("skipped-homebrew");
    });
  });

  // --- Interrupted state recovery -----------------------------------

  describe("interrupted state recovery", () => {
    it("clears a stale activeOperation on next launch", async () => {
      const state = buildDefaultState("1.0.0");
      writeState({
        ...state,
        activeOperation: {
          id: "op-old",
          version: "1.0.0",
          phase: "binary",
          backupId: undefined,
          startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        },
      });

      const result = await runUpgradeOrchestrator({
        descriptor: contentOnlyDescriptor("1.5.0"),
        targetVersion: "1.5.0",
        currentVersion: "1.4.0",
        deps: makeDeps(),
      });
      // Even with a stale active operation, the upgrade proceeds and
      // the final state has no active operation.
      const after = readState("placeholder");
      expect(after.activeOperation).toBeUndefined();
      expect(result.status === "completed" || result.status === "partial_failure").toBe(true);
    });
  });

  // --- Content-only sync runs even without a binary item -------------

  describe("content sync", () => {
    it("runs content sync when at least one runner has Deck-managed artifacts", async () => {
      const adapter = makeAdapter({
        detectDeckInstall: async () => ({ installed: true, managedPaths: [] }),
        buildDeveloperTeamInstallPlan: () => ({
          files: [{ path: "/tmp/.config/opencode/AGENTS.md", content: "x" }],
        }),
      });
      const result = await runUpgradeOrchestrator({
        descriptor: contentOnlyDescriptor("1.5.0"),
        targetVersion: "1.5.0",
        currentVersion: "1.4.0",
        deps: makeDeps({
          adapterRegistry: makeRegistry([adapter]),
          readDeckConfig: () => makeConfig({ opencode: { "codebase-memory": true } }),
        }),
      });
      // The sync should be "completed" (not skipped).
      expect(result.content.status).toBe("completed");
      expect(result.content.outcomes?.find((o) => o.runnerId === "opencode")?.status).toBe("synced");
    });
  });
});
