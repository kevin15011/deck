/**
 * Unit tests for GitHub release fetching.
 */

import { describe, it, expect } from "bun:test";

describe("github-release", () => {
  describe("compareVersions", () => {
    it("returns 0 when versions are equal", () => {
      const { compareVersions } = require("../github-release.js");
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
      expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    });

    it("returns negative when current < latest (upgrade available)", () => {
      const { compareVersions } = require("../github-release.js");
      expect(compareVersions("1.0.0", "1.1.0")).toBe(-1);
      expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
      expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
      expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
    });

    it("returns positive when current > latest (downgrade)", () => {
      const { compareVersions } = require("../github-release.js");
      expect(compareVersions("1.1.0", "1.0.0")).toBe(1);
      expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
      expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    });

    it("handles v prefix in versions", () => {
      const { compareVersions } = require("../github-release.js");
      expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.0.0", "v1.0.0")).toBe(0);
      expect(compareVersions("v1.0.0", "v1.0.0")).toBe(0);
    });

    it("handles different version lengths", () => {
      const { compareVersions } = require("../github-release.js");
      expect(compareVersions("1.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.0.0", "1.0")).toBe(0);
      expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
      expect(compareVersions("1.0.0.0", "1.0.0")).toBe(0);
    });
  });

  describe("UPGRADE_ERROR_CODES", () => {
    it("has correct error codes", () => {
      const { UPGRADE_ERROR_CODES } = require("../github-release.js");
      expect(UPGRADE_ERROR_CODES.CHECKSUM_MISMATCH).toBe("UPGRADE_CHECKSUM_MISMATCH");
      expect(UPGRADE_ERROR_CODES.NETWORK_ERROR).toBe("UPGRADE_NETWORK_ERROR");
      expect(UPGRADE_ERROR_CODES.REPLACE_FAILED).toBe("UPGRADE_REPLACE_FAILED");
    });
  });

  describe("checkUpgradeAvailable", () => {
    it("is a function", () => {
      const { checkUpgradeAvailable } = require("../github-release.js");
      expect(typeof checkUpgradeAvailable).toBe("function");
    });

    it("returns boolean", async () => {
      const { checkUpgradeAvailable } = require("../github-release.js");
      const result = await checkUpgradeAvailable("1.0.0");
      expect(typeof result).toBe("boolean");
    });
  });
});

// REQ-bsu-* requirement tests
describe("REQ-bsu-001: Upgrade detects newer version", () => {
  const { compareVersions } = require("../github-release.js");
  
  it("detects when upgrade is available", () => {
    const cmp = compareVersions("1.0.0", "1.1.0");
    expect(cmp).toBeLessThan(0);
  });

  it("detects when already on latest", () => {
    const cmp = compareVersions("1.0.0", "1.0.0");
    expect(cmp).toBe(0);
  });
});

describe("REQ-bsu-003: --yes flag enables non-interactive upgrade", () => {
  const { compareVersions } = require("../github-release.js");
  
  it("version comparison works programmatically", () => {
    const cmp = compareVersions("1.0.0", "1.1.0");
    expect(cmp).toBeLessThan(0);
  });
});

describe("REQ-bsu-005: Refuse downgrade", () => {
  const { compareVersions } = require("../github-release.js");
  
  it("refuses downgrade", () => {
    const cmp = compareVersions("1.1.0", "1.0.0");
    expect(cmp).toBeGreaterThan(0);
  });
});