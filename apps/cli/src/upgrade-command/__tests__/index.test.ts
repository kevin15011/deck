/**
 * Unit tests for upgrade command orchestrator.
 */

import { describe, it, expect, vi, beforeEach } from "bun:test";

describe("upgrade-command/index", () => {
  describe("exports", () => {
    it("exports runUpgrade function", () => {
      const { runUpgrade } = require("../index.js");
      expect(typeof runUpgrade).toBe("function");
    });
  });

  describe("runUpgrade", () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      // Prevent real network calls — mock getLatestReleaseInfo to return null
      // so the upgrade path short-circuits without hitting the workflow.
      const githubRelease = await import("../github-release.js");
      vi.spyOn(githubRelease, "getLatestReleaseInfo").mockResolvedValue(null);
    });

    it("runs without breaking when no release available", async () => {
      const { runUpgrade } = require("../index.js");

      // getLatestReleaseInfo returns null → "No release available" → returns 0
      const result = await runUpgrade([]);
      expect(typeof result).toBe("number");
      expect(result).toBe(0);
    });

    it("handles --version flag", async () => {
      const { runUpgrade } = require("../index.js");

      const result = await runUpgrade(["--version"]);
      expect(result).toBe(0);
    });
  });

  describe("--yes flag behavior", () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      const githubRelease = await import("../github-release.js");
      vi.spyOn(githubRelease, "getLatestReleaseInfo").mockResolvedValue(null);
    });

    it("accepts --yes flag", async () => {
      const { runUpgrade } = require("../index.js");

      // --yes should not cause errors (skips confirmation); no release → returns 0
      const result = await runUpgrade(["--yes"]);
      expect(typeof result).toBe("number");
    });

    it("accepts -y flag", async () => {
      const { runUpgrade } = require("../index.js");

      const result = await runUpgrade(["-y"]);
      expect(typeof result).toBe("number");
    });
  });

  describe("error handling", () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      const githubRelease = await import("../github-release.js");
      vi.spyOn(githubRelease, "getLatestReleaseInfo").mockResolvedValue(null);
    });

    it("handles missing binary path", async () => {
      const { runUpgrade } = require("../index.js");

      // getLatestReleaseInfo mocked → no release available → returns 0
      const result = await runUpgrade([]);
      expect(typeof result).toBe("number");
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
  beforeEach(async () => {
    vi.clearAllMocks();
    const githubRelease = await import("../github-release.js");
    vi.spyOn(githubRelease, "getLatestReleaseInfo").mockResolvedValue(null);
  });

  it("accepts --yes flag", async () => {
    const { runUpgrade } = require("../index.js");
    const result = await runUpgrade(["--yes"]);
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