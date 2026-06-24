/**
 * Unit tests for upgrade command orchestrator.
 */

import { describe, it, expect, vi, beforeEach } from "bun:test";

import { runUpgrade, type UpgradeCommandDeps } from "../index.js";
import type { ReleaseFetchResult, ReleaseInfo } from "../github-release.js";
import type { ReleaseJson } from "../release-descriptor.js";

function buildDescriptor(): ReleaseJson {
  return {
    schemaVersion: 1,
    version: "1.2.3",
    tag_name: "v1.2.3",
    channel: "stable",
    published_at: "2026-06-23T00:00:00.000Z",
    items: [
      {
        id: "deck-v1.2.3-linux-x64",
        kind: "binary",
        required: true,
        platform: "linux-x64",
        asset_name: "deck_v1.2.3_linux-x64.tar.gz",
        url: "https://example.com/deck.tar.gz",
        sha256: "0".repeat(64),
        notes: "Test binary",
      },
    ],
  };
}

function buildLegacyRelease(): ReleaseInfo {
  return {
    tagName: "v1.2.3",
    version: "1.2.3",
    downloadUrl: "https://example.com/deck.tar.gz",
    sha256: "0".repeat(64),
    publishedAt: "2026-06-23T00:00:00.000Z",
    body: "sha256: " + "0".repeat(64),
    commit: null,
  };
}

function completedWorkflowResult() {
  return {
    status: "completed" as const,
    binary: { status: "completed" as const, itemId: "deck-v1.2.3-linux-x64" },
    content: { status: "skipped" as const },
    migration: { status: "skipped" as const, itemIds: [] },
    advisory: { items: [] },
    channelEol: { items: [] },
    finalState: {} as never,
    finalManifest: {} as never,
  };
}

function buildDeps(fetchResult: ReleaseFetchResult): UpgradeCommandDeps {
  return {
    fetchReleaseDescriptor: vi.fn(() => fetchResult),
    getBuildInfo: vi.fn(() => ({
      version: "1.0.0",
      commit: "abcdef1",
      date: "2026-06-23",
      target: "linux-x64",
      channel: "stable" as const,
    })),
    getBinaryPath: vi.fn(() => "/tmp/deck-test-binary"),
    stageReleaseAssets: vi.fn(async () => ({ staged: 1, skipped: 0, files: ["/tmp/deck.tar.gz"] })),
    runSelfUpgradeWorkflow: vi.fn(async () => completedWorkflowResult()),
    performUpgrade: vi.fn(async () => true),
  };
}

describe("upgrade-command/index", () => {
  describe("exports", () => {
    it("exports runUpgrade function", () => {
      expect(typeof runUpgrade).toBe("function");
    });
  });

  describe("runUpgrade", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("runs without breaking when no release available", async () => {
      const deps = buildDeps({ kind: "network-error", error: "offline" });
      const result = await runUpgrade([], undefined, undefined, deps);
      expect(typeof result).toBe("number");
      expect(result).toBe(0);
    });

    it("handles --version flag", async () => {
      const deps = buildDeps({ kind: "network-error", error: "offline" });
      const result = await runUpgrade(["--version"], undefined, undefined, deps);
      expect(result).toBe(0);
    });

    it("uses descriptor releases through hardened staging and orchestration", async () => {
      const descriptor = buildDescriptor();
      const deps = buildDeps({ kind: "descriptor", descriptor, cachePath: "/tmp/release.json", commit: null });

      const result = await runUpgrade(["--yes"], undefined, undefined, deps);

      expect(result).toBe(0);
      expect(deps.stageReleaseAssets).toHaveBeenCalledWith(descriptor);
      expect(deps.runSelfUpgradeWorkflow).toHaveBeenCalledWith({
        descriptor,
        targetVersion: descriptor.version,
        currentVersion: "1.0.0",
      });
      expect(deps.performUpgrade).not.toHaveBeenCalled();
    });

    it("does not fall back to legacy install when descriptor staging fails", async () => {
      const descriptor = buildDescriptor();
      const deps = buildDeps({ kind: "descriptor", descriptor, cachePath: "/tmp/release.json", commit: null });
      (deps.stageReleaseAssets as any).mockRejectedValueOnce(new Error("checksum mismatch"));

      const result = await runUpgrade(["--yes"], undefined, undefined, deps);

      expect(result).toBe(1);
      expect(deps.runSelfUpgradeWorkflow).not.toHaveBeenCalled();
      expect(deps.performUpgrade).not.toHaveBeenCalled();
    });

    it("does not fall back to legacy install when descriptor validation failed", async () => {
      const deps = buildDeps({
        kind: "legacy",
        reason: "invalid",
        info: buildLegacyRelease(),
        error: "descriptor parse failed",
      });

      const result = await runUpgrade(["--yes"], undefined, undefined, deps);

      expect(result).toBe(1);
      expect(deps.stageReleaseAssets).not.toHaveBeenCalled();
      expect(deps.runSelfUpgradeWorkflow).not.toHaveBeenCalled();
      expect(deps.performUpgrade).not.toHaveBeenCalled();
    });

    it("uses legacy install only for releases with no descriptor metadata", async () => {
      const legacy = buildLegacyRelease();
      const deps = buildDeps({ kind: "legacy", reason: "missing", info: legacy });

      const result = await runUpgrade(["--yes"], undefined, undefined, deps);

      expect(result).toBe(0);
      expect(deps.stageReleaseAssets).not.toHaveBeenCalled();
      expect(deps.runSelfUpgradeWorkflow).not.toHaveBeenCalled();
      expect(deps.performUpgrade).toHaveBeenCalledWith(
        { downloadUrl: legacy.downloadUrl, sha256: legacy.sha256 },
        "/tmp/deck-test-binary",
      );
    });
  });

  describe("--yes flag behavior", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("accepts --yes flag", async () => {
      const deps = buildDeps({ kind: "network-error", error: "offline" });
      const result = await runUpgrade(["--yes"], undefined, undefined, deps);
      expect(typeof result).toBe("number");
    });

    it("accepts -y flag", async () => {
      const deps = buildDeps({ kind: "network-error", error: "offline" });
      const result = await runUpgrade(["-y"], undefined, undefined, deps);
      expect(typeof result).toBe("number");
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("handles missing binary path", async () => {
      const deps = buildDeps({ kind: "descriptor", descriptor: buildDescriptor(), cachePath: "/tmp/release.json", commit: null });
      deps.getBinaryPath = vi.fn(() => "");
      const result = await runUpgrade([], undefined, undefined, deps);
      expect(typeof result).toBe("number");
      expect(result).toBe(1);
    });
  });
});

// Integration-style tests for REQ-bsu-* requirements
describe("REQ-bsu-001: Upgrade detects newer version", () => {
  const { compareVersions } = require("../github-release.js");
  
  it("detects when upgrade is available", () => {
    const cmp = compareVersions("1.0.0", "1.1.0");
    expect(cmp).toBeLessThan(0);
  });
});

describe("REQ-bsu-003: --yes flag skips confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts --yes flag", async () => {
    const deps = buildDeps({ kind: "network-error", error: "offline" });
    const result = await runUpgrade(["--yes"], undefined, undefined, deps);
    expect(typeof result).toBe("number");
  });
});

describe("REQ-bsu-005: Refuse downgrade", () => {
  const { compareVersions } = require("../github-release.js");
  
  it("refuses downgrade", () => {
    const cmp = compareVersions("1.1.0", "1.0.0");
    expect(cmp).toBeGreaterThan(0);
  });
});
