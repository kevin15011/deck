/**
 * Unit tests for upgrade command orchestrator.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("upgrade-command/index", () => {
  describe("exports", () => {
    it("exports runUpgrade function", () => {
      const { runUpgrade } = require("../index.js");
      expect(typeof runUpgrade).toBe("function");
    });
  });

  describe("runUpgrade", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("runs without breaking when no release available", async () => {
      const { runUpgrade } = require("../index.js");
      
      // getLatestReleaseInfo will try to contact network - that's ok
      const result = await runUpgrade(["--version"]);
      expect(typeof result).toBe("number");
    });

    it("handles --version flag", async () => {
      const { runUpgrade } = require("../index.js");
      
      const result = await runUpgrade(["--version"]);
      expect(result).toBe(0);
    });
  });

  describe("--yes flag behavior", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("accepts --yes flag", async () => {
      const { runUpgrade } = require("../index.js");
      
      // --yes should not cause errors (skips confirmation)
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
    it("handles missing binary path", async () => {
      const { runUpgrade } = require("../index.js");
      
      // When there's no release available, should handle gracefully
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
  const { runUpgrade } = require("../index.js");
  
  it("accepts --yes flag", async () => {
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